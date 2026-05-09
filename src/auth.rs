use axum::{
    body::Body,
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};

pub async fn auth_middleware(
    request: Request,
    next: Next,
    token: &str,
) -> Response {
    let path = request.uri().path();

    if path == "/" || path.starts_with("/assets/") || path.starts_with("/preview/") {
        return next.run(request).await;
    }

    if check_token(&request, token) {
        return next.run(request).await;
    }

    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"error":"unauthorized"}"#))
        .unwrap()
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
                return constant_time_eq(val, token);
            }
        }
    }

    false
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}
