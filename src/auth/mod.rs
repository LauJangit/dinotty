#![allow(clippy::unwrap_used, clippy::expect_used)]
use axum::{
    body::Body,
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use dashmap::DashMap;
use std::{net::IpAddr, sync::OnceLock, time::Instant};

use crate::settings::SettingsState;

struct FailRecord {
    count: u32,
    last_fail: Instant,
}

fn fail_map() -> &'static DashMap<IpAddr, FailRecord> {
    static MAP: OnceLock<DashMap<IpAddr, FailRecord>> = OnceLock::new();
    MAP.get_or_init(DashMap::new)
}

const MAX_FAILURES: u32 = 5;
const LOCKOUT_SECS: u64 = 60;

/// # Panics
/// Panics if the response builder fails (which should not happen with valid status codes and bodies).
pub async fn auth_middleware(
    request: Request,
    next: Next,
    token: &str,
    settings: &SettingsState,
    client_ip: IpAddr,
) -> Response {
    let path = request.uri().path();

    // No token configured — first-time setup, allow all requests
    if token.is_empty() {
        return next.run(request).await;
    }

    if path == "/"
        || path == "/api/notify"
        || path == "/api/token-configured"
        || path == "/manifest.json"
        || path == "/logo.png"
        || path.starts_with("/assets/")
        || path.starts_with("/preview/")
        || path.starts_with("/icons/")
    {
        return next.run(request).await;
    }

    // IP whitelist check — drop the lock before calling next.run() to avoid
    // deadlocking when a write lock is requested later in the same task chain.
    let whitelisted = {
        let s = settings.read().await;
        is_ip_whitelisted(client_ip, &s.ip_whitelist)
    };
    if whitelisted {
        return next.run(request).await;
    }

    // /api/auth is exempt from the IP whitelist so that users on non-whitelisted
    // IPs (e.g. LAN) can still authenticate. The token is still validated below.
    if path == "/api/auth" {
        let map = fail_map();
        if let Some(rec) = map.get(&client_ip) {
            if rec.count >= MAX_FAILURES {
                let elapsed = rec.last_fail.elapsed().as_secs();
                if elapsed < LOCKOUT_SECS {
                    return Response::builder()
                        .status(StatusCode::TOO_MANY_REQUESTS)
                        .header(header::CONTENT_TYPE, "application/json")
                        .header("Retry-After", (LOCKOUT_SECS - elapsed).to_string())
                        .body(Body::from(
                            r#"{"error":"too many failed attempts, please try again later"}"#,
                        ))
                        .unwrap();
                }
                drop(rec);
                map.remove(&client_ip);
            }
        }
        if check_token(&request, token) {
            map.remove(&client_ip);
            return next.run(request).await;
        }
        {
            let mut rec =
                map.entry(client_ip).or_insert(FailRecord { count: 0, last_fail: Instant::now() });
            rec.count += 1;
            rec.last_fail = Instant::now();
        }
        return Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"error":"unauthorized"}"#))
            .unwrap();
    }

    // Brute-force lockout check
    let map = fail_map();
    if let Some(rec) = map.get(&client_ip) {
        if rec.count >= MAX_FAILURES {
            let elapsed = rec.last_fail.elapsed().as_secs();
            if elapsed < LOCKOUT_SECS {
                return Response::builder()
                    .status(StatusCode::TOO_MANY_REQUESTS)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("Retry-After", (LOCKOUT_SECS - elapsed).to_string())
                    .body(Body::from(
                        r#"{"error":"too many failed attempts, please try again later"}"#,
                    ))
                    .unwrap();
            }
            drop(rec);
            map.remove(&client_ip);
        }
    }

    if check_token(&request, token) {
        map.remove(&client_ip);
        return next.run(request).await;
    }

    // Only count failures from the login endpoint — other endpoints return 401
    // without incrementing the counter, so normal pre-auth API calls (settings,
    // plugins, etc.) don't accidentally trigger the lockout.
    if path == "/api/auth" {
        let mut rec =
            map.entry(client_ip).or_insert(FailRecord { count: 0, last_fail: Instant::now() });
        rec.count += 1;
        rec.last_fail = Instant::now();
    }

    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"error":"unauthorized"}"#))
        .unwrap()
}

fn is_ip_whitelisted(ip: IpAddr, whitelist: &[String]) -> bool {
    for entry in whitelist {
        let entry = entry.trim();
        // CIDR: 192.168.1.0/24
        if entry.contains('/') {
            if matches_cidr(ip, entry) {
                return true;
            }
            continue;
        }
        // Wildcard: 192.168.0.*
        if entry.contains('*') {
            if matches_wildcard(ip, entry) {
                return true;
            }
            continue;
        }
        // Exact match
        if let Ok(listed) = entry.parse::<IpAddr>() {
            if listed == ip {
                return true;
            }
        }
    }
    false
}

// Wildcard match only applies to IPv4
fn matches_wildcard(ip: IpAddr, pattern: &str) -> bool {
    let IpAddr::V4(ipv4) = ip else { return false };
    let octets = ipv4.octets();
    let parts: Vec<&str> = pattern.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    for (i, part) in parts.iter().enumerate() {
        if *part == "*" {
            continue;
        }
        if let Ok(n) = part.parse::<u8>() {
            if octets[i] != n {
                return false;
            }
        } else {
            return false;
        }
    }
    true
}

fn matches_cidr(ip: IpAddr, cidr: &str) -> bool {
    let Some((addr_str, prefix_str)) = cidr.split_once('/') else { return false };
    let Ok(prefix_len) = prefix_str.parse::<u32>() else { return false };
    match (ip, addr_str.parse::<IpAddr>()) {
        (IpAddr::V4(ip4), Ok(IpAddr::V4(net4))) => {
            if prefix_len > 32 {
                return false;
            }
            let mask = if prefix_len == 0 { 0u32 } else { !0u32 << (32 - prefix_len) };
            let ip_bits = u32::from(ip4);
            let net_bits = u32::from(net4);
            (ip_bits & mask) == (net_bits & mask)
        }
        (IpAddr::V6(ip6), Ok(IpAddr::V6(net6))) => {
            if prefix_len > 128 {
                return false;
            }
            let ip_bits = u128::from(ip6);
            let net_bits = u128::from(net6);
            let mask = if prefix_len == 0 { 0u128 } else { !0u128 << (128 - prefix_len) };
            (ip_bits & mask) == (net_bits & mask)
        }
        _ => false,
    }
}

fn check_token(request: &Request, token: &str) -> bool {
    if let Some(auth) = request.headers().get(header::AUTHORIZATION) {
        if let Ok(v) = auth.to_str() {
            if let Some(t) = v.strip_prefix("Bearer ") {
                return constant_time_eq(t.trim(), token);
            }
        }
    }

    if let Some(query) = request.uri().query() {
        for pair in query.split('&') {
            if let Some(val) = pair.strip_prefix("token=") {
                if let Ok(decoded) = urlencoding::decode(val) {
                    return constant_time_eq(&decoded, token);
                }
            }
        }
    }

    false
}

#[must_use]
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests;
