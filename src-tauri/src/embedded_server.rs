use axum::{
    body::Body,
    extract::Path,
    http::{header, Response, StatusCode},
    response::IntoResponse,
    routing::{any, delete, get, post, put},
    Router,
};
use rust_embed::Embed;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use xterm_server::workspace;
use xterm_server::proxy;
use xterm_server::session::SessionManager;
use xterm_server::settings;
use xterm_server::ws;
use xterm_server::monitor;
use xterm_server::file_watcher::{self, FileWatcherState};

#[derive(Embed)]
#[folder = "../frontend/dist/"]
struct StaticFiles;

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<SessionManager>,
    pub settings: settings::SettingsState,
    pub file_watcher: Arc<FileWatcherState>,
}

impl axum::extract::FromRef<AppState> for Arc<SessionManager> {
    fn from_ref(state: &AppState) -> Self {
        state.manager.clone()
    }
}

impl axum::extract::FromRef<AppState> for (Arc<SessionManager>, settings::SettingsState) {
    fn from_ref(state: &AppState) -> Self {
        (state.manager.clone(), state.settings.clone())
    }
}

impl axum::extract::FromRef<AppState> for (Arc<SessionManager>, Arc<FileWatcherState>) {
    fn from_ref(state: &AppState) -> Self {
        (state.manager.clone(), state.file_watcher.clone())
    }
}

async fn static_handler(Path(path): Path<String>) -> impl IntoResponse {
    let lookup = format!("assets/{}", path);
    match StaticFiles::get(&lookup) {
        Some(content) => {
            let mime = mime_guess::from_path(&lookup).first_or_octet_stream();
            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("not found"))
            .unwrap(),
    }
}

async fn index() -> impl IntoResponse {
    let content = StaticFiles::get("index.html")
        .expect("index.html must exist in frontend/dist/");
    (
        [(header::CACHE_CONTROL, axum::http::HeaderValue::from_static("no-store"))],
        axum::response::Html(String::from_utf8_lossy(&content.data).into_owned()),
    )
}

pub async fn run_server(port: u16, manager: Arc<SessionManager>) {
    let state = AppState {
        manager,
        settings: settings::create_settings_state(),
        file_watcher: Arc::new(FileWatcherState::new()),
    };

    let app = Router::new()
        .route("/ws", get(ws::ws_handler))
        .route("/ws/sync", get(ws::sync_handler))
        .route("/ws/watch", get(file_watcher::watch_handler))
        .route("/ws/monitor", get(monitor::ws_monitor_handler))
        .route(
            "/api/settings",
            get(settings::get_settings).put(settings::put_settings),
        )
        .route(
            "/api/settings/background",
            post(settings::upload_background).get(settings::get_background),
        )
        .route("/api/workspace/resolve", get(workspace::workspace_resolve))
        .route("/api/workspace/list", get(workspace::workspace_list))
        .route("/api/workspace/meta", get(workspace::workspace_meta))
        .route("/api/workspace/raw", get(workspace::workspace_raw))
        .route("/api/workspace/upload", post(workspace::workspace_upload))
        .route("/api/workspace/create", post(workspace::workspace_create_entry))
        .route("/api/workspace/file", put(workspace::workspace_put_file))
        .route("/api/workspace/delete", delete(workspace::workspace_delete))
        .route("/api/workspace/rename", post(workspace::workspace_rename))
        .route("/api/proxy", any(proxy::external_proxy_handler))
        .route("/preview/:port", any(proxy::proxy_handler_root))
        .route("/preview/:port/", any(proxy::proxy_handler_root))
        .route("/preview/:port/*path", any(proxy::proxy_handler_wildcard))
        .route("/assets/*path", get(static_handler))
        .route("/", get(index))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Embedded server listening on http://0.0.0.0:{}", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
