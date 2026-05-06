use axum::{
    http::{header, HeaderValue},
    response::{Html, IntoResponse},
};

pub async fn index() -> impl IntoResponse {
    (
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Html(include_str!("../static/index.html")),
    )
}
