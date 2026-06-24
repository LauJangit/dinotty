use super::*;

// ── constant_time_eq ────────────────────────────────────────────

#[test]
fn constant_time_eq_equal_strings() {
    assert!(constant_time_eq("hello", "hello"));
}

#[test]
fn constant_time_eq_different_strings() {
    assert!(!constant_time_eq("hello", "world"));
}

#[test]
fn constant_time_eq_different_lengths() {
    assert!(!constant_time_eq("short", "longer string"));
}

#[test]
fn constant_time_eq_empty_strings() {
    assert!(constant_time_eq("", ""));
}

#[test]
fn constant_time_eq_single_char_diff() {
    assert!(!constant_time_eq("abc", "abd"));
}

// ── matches_wildcard ────────────────────────────────────────────

#[test]
fn wildcard_exact_match() {
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    assert!(matches_wildcard(ip, "192.168.1.100"));
}

#[test]
fn wildcard_star_matches_any_octet() {
    let ip: IpAddr = "192.168.1.42".parse().unwrap();
    assert!(matches_wildcard(ip, "192.168.*.*"));
}

#[test]
fn wildcard_star_last_octet() {
    let ip: IpAddr = "10.0.0.255".parse().unwrap();
    assert!(matches_wildcard(ip, "10.0.0.*"));
}

#[test]
fn wildcard_mismatch() {
    let ip: IpAddr = "192.168.2.1".parse().unwrap();
    assert!(!matches_wildcard(ip, "192.168.1.*"));
}

#[test]
fn wildcard_ipv6_returns_false() {
    let ip: IpAddr = "::1".parse().unwrap();
    assert!(!matches_wildcard(ip, "*.*.*.*"));
}

#[test]
fn wildcard_invalid_pattern() {
    let ip: IpAddr = "192.168.1.1".parse().unwrap();
    assert!(!matches_wildcard(ip, "192.168.*")); // only 3 parts
}

#[test]
fn wildcard_non_numeric_non_star() {
    let ip: IpAddr = "192.168.1.1".parse().unwrap();
    assert!(!matches_wildcard(ip, "192.168.1.abc"));
}

// ── matches_cidr ────────────────────────────────────────────────

#[test]
fn cidr_matches_in_range() {
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    assert!(matches_cidr(ip, "192.168.1.0/24"));
}

#[test]
fn cidr_rejects_out_of_range() {
    let ip: IpAddr = "192.168.2.1".parse().unwrap();
    assert!(!matches_cidr(ip, "192.168.1.0/24"));
}

#[test]
fn cidr_prefix_32_exact() {
    let ip: IpAddr = "10.0.0.1".parse().unwrap();
    assert!(matches_cidr(ip, "10.0.0.1/32"));
    assert!(!matches_cidr("10.0.0.2".parse().unwrap(), "10.0.0.1/32"));
}

#[test]
fn cidr_prefix_0_matches_all() {
    let ip: IpAddr = "255.255.255.255".parse().unwrap();
    assert!(matches_cidr(ip, "0.0.0.0/0"));
}

#[test]
fn cidr_ipv6() {
    let ip: IpAddr = "fe80::1".parse().unwrap();
    assert!(matches_cidr(ip, "fe80::/10"));
}

#[test]
fn cidr_ipv6_out_of_range() {
    let ip: IpAddr = "2001:db8::1".parse().unwrap();
    assert!(!matches_cidr(ip, "fe80::/10"));
}

#[test]
fn cidr_invalid_prefix_len() {
    let ip: IpAddr = "192.168.1.1".parse().unwrap();
    assert!(!matches_cidr(ip, "192.168.1.0/33")); // > 32
}

#[test]
fn cidr_mixed_v4_v6() {
    let ip: IpAddr = "192.168.1.1".parse().unwrap();
    assert!(!matches_cidr(ip, "::1/128")); // mismatched families
}

#[test]
fn cidr_no_slash() {
    let ip: IpAddr = "192.168.1.1".parse().unwrap();
    assert!(!matches_cidr(ip, "192.168.1.0"));
}

// ── is_ip_whitelisted ───────────────────────────────────────────

#[test]
fn whitelist_exact_match() {
    let ip: IpAddr = "127.0.0.1".parse().unwrap();
    let whitelist = vec!["127.0.0.1".into()];
    assert!(is_ip_whitelisted(ip, &whitelist));
}

#[test]
fn whitelist_cidr_match() {
    let ip: IpAddr = "192.168.1.50".parse().unwrap();
    let whitelist = vec!["192.168.1.0/24".into()];
    assert!(is_ip_whitelisted(ip, &whitelist));
}

#[test]
fn whitelist_wildcard_match() {
    let ip: IpAddr = "10.0.0.99".parse().unwrap();
    let whitelist = vec!["10.0.0.*".into()];
    assert!(is_ip_whitelisted(ip, &whitelist));
}

#[test]
fn whitelist_no_match() {
    let ip: IpAddr = "172.16.0.1".parse().unwrap();
    let whitelist = vec!["127.0.0.1".into(), "::1".into()];
    assert!(!is_ip_whitelisted(ip, &whitelist));
}

#[test]
fn whitelist_empty_list() {
    let ip: IpAddr = "127.0.0.1".parse().unwrap();
    assert!(!is_ip_whitelisted(ip, &[]));
}

#[test]
fn whitelist_multiple_entries() {
    let ip: IpAddr = "192.168.1.5".parse().unwrap();
    let whitelist = vec!["127.0.0.1".into(), "::1".into(), "192.168.0.0/16".into()];
    assert!(is_ip_whitelisted(ip, &whitelist));
}

#[test]
fn whitelist_whitespace_trimmed() {
    let ip: IpAddr = "127.0.0.1".parse().unwrap();
    let whitelist = vec!["  127.0.0.1  ".into()];
    assert!(is_ip_whitelisted(ip, &whitelist));
}

// ── check_token ─────────────────────────────────────────────────

#[test]
fn check_token_bearer_header() {
    let req = Request::builder()
        .header(header::AUTHORIZATION, "Bearer my-secret-token")
        .body(Body::empty())
        .unwrap();
    assert!(check_token(&req, "my-secret-token"));
}

#[test]
fn check_token_bearer_wrong_token() {
    let req = Request::builder()
        .header(header::AUTHORIZATION, "Bearer wrong-token")
        .body(Body::empty())
        .unwrap();
    assert!(!check_token(&req, "my-secret-token"));
}

#[test]
fn check_token_query_param() {
    let req =
        Request::builder().uri("/api/something?token=my-secret-token").body(Body::empty()).unwrap();
    assert!(check_token(&req, "my-secret-token"));
}

#[test]
fn check_token_query_param_wrong() {
    let req = Request::builder().uri("/api/something?token=wrong").body(Body::empty()).unwrap();
    assert!(!check_token(&req, "my-secret-token"));
}

#[test]
fn check_token_no_auth_returns_false() {
    let req = Request::builder().uri("/api/something").body(Body::empty()).unwrap();
    assert!(!check_token(&req, "my-secret-token"));
}

#[test]
fn check_token_url_encoded_query() {
    let req = Request::builder()
        .uri("/api/something?token=my%2Dsecret%2Dtoken")
        .body(Body::empty())
        .unwrap();
    assert!(check_token(&req, "my-secret-token"));
}
