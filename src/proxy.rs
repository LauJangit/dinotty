use axum::{
    body::Body,
    extract::{Path, Request},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::Client;
use std::sync::LazyLock;

static HTTP_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
});

const INJECT_SCRIPT: &str = r#"<script>(function(){
window.parent.postMessage({type:'preview-ready'},'*');
window.addEventListener('error',function(e){
window.parent.postMessage({type:'preview-error',message:e.message,source:e.filename,line:e.lineno},'*');
});
})();</script>"#;

fn make_base_tag(port: u16) -> String {
    format!("<base href=\"/preview/{}/\">", port)
}

pub async fn proxy_handler_root(
    Path(port): Path<u16>,
    req: Request,
) -> impl IntoResponse {
    proxy_internal(port, String::new(), req).await
}

pub async fn proxy_handler_wildcard(
    req: Request,
) -> impl IntoResponse {
    // Manually parse /preview/:port/*path from the URI
    let uri_path = req.uri().path().to_string();
    let after = uri_path.strip_prefix("/preview/").unwrap_or("");
    let (port_str, path) = match after.find('/') {
        Some(i) => (&after[..i], after[i..].to_string()),
        None => (after, String::new()),
    };
    let port: u16 = port_str.parse().unwrap_or(0);
    proxy_internal(port, path, req).await
}

pub async fn proxy_handler(
    Path((port, path)): Path<(u16, String)>,
    req: Request,
) -> impl IntoResponse {
    proxy_internal(port, path, req).await
}

async fn proxy_internal(port: u16, path: String, req: Request) -> Response {
    if port < 1024 {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Invalid port (must be 1024-65535)"))
            .unwrap();
    }

    let query = req.uri().query().map(|q| format!("?{}", q)).unwrap_or_default();
    let path_part = if path.is_empty() || path == "/" { String::from("/") } else if path.starts_with('/') { path.clone() } else { format!("/{}", path) };
    let target_url = format!("http://127.0.0.1:{}{}{}", port, path_part, query);

    let method = req.method().clone();
    let headers = req.headers().clone();
    let body_bytes: Bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Request body too large"))
                .unwrap();
        }
    };

    let mut proxy_req = HTTP_CLIENT.request(
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap(),
        &target_url,
    );

    for (name, value) in headers.iter() {
        let n = name.as_str();
        if n == "host" || n == "connection" || n == "upgrade" {
            continue;
        }
        if let Ok(v) = value.to_str() {
            proxy_req = proxy_req.header(n, v);
        }
    }

    if !body_bytes.is_empty() {
        proxy_req = proxy_req.body(body_bytes);
    }

    let upstream_resp = match proxy_req.send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = if e.is_connect() {
                format!("Cannot connect to localhost:{} — is the server running?", port)
            } else {
                format!("Proxy error: {}", e)
            };
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .body(Body::from(msg))
                .unwrap();
        }
    };

    let status = upstream_resp.status();
    let resp_headers = upstream_resp.headers().clone();
    let content_type = resp_headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let is_html = content_type.contains("text/html");

    let mut builder = Response::builder().status(status.as_u16());
    for (name, value) in resp_headers.iter() {
        let n = name.as_str();
        if n == "transfer-encoding" || n == "connection" {
            continue;
        }
        if is_html && n == "content-length" {
            continue;
        }
        builder = builder.header(n, value);
    }

    if is_html {
        let base_tag = make_base_tag(port);
        let inject = format!("{}{}", base_tag, INJECT_SCRIPT);
        let full_body = upstream_resp.bytes().await.unwrap_or_default();
        let html = String::from_utf8_lossy(&full_body);
        let injected = if let Some(pos) = html.find("<head>") {
            format!("{}{}{}", &html[..pos + 6], inject, &html[pos + 6..])
        } else if let Some(pos) = html.find("</head>") {
            format!("{}{}{}", &html[..pos], inject, &html[pos..])
        } else {
            format!("{}{}", inject, html)
        };
        builder
            .header(header::CONTENT_LENGTH, injected.len())
            .body(Body::from(injected))
            .unwrap()
    } else {
        let stream = upstream_resp.bytes_stream().map(|result| {
            result.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
        });
        builder
            .body(Body::from_stream(stream))
            .unwrap()
    }
}
