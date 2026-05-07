use axum::{
    http::{header, HeaderValue},
    response::{Html, IntoResponse},
};

use crate::StaticFiles;

pub async fn index() -> impl IntoResponse {
    let content = StaticFiles::get("index.html")
        .expect("index.html must exist in frontend/dist/");
    (
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Html(String::from_utf8_lossy(&content.data).into_owned()),
    )
}
