use xterm_server::{auth, session, settings, ws, proxy, workspace, file_watcher, monitor};
mod routes;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, Response, StatusCode},
    middleware,
    response::IntoResponse,
    Json, Router,
    routing::{any, delete, get, post, put},
};
use rust_embed::Embed;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::session::SessionManager;
use crate::settings::SettingsState;
use crate::file_watcher::FileWatcherState;

#[derive(Embed)]
#[folder = "frontend/dist/"]
pub struct StaticFiles;

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<SessionManager>,
    pub settings: SettingsState,
    pub file_watcher: Arc<FileWatcherState>,
    pub auth_token: Arc<String>,
    pub port: u16,
}

// Allow extracting Arc<SessionManager> from AppState for ws handlers
impl axum::extract::FromRef<AppState> for Arc<SessionManager> {
    fn from_ref(state: &AppState) -> Self {
        state.manager.clone()
    }
}

// Allow extracting (Arc<SessionManager>, SettingsState) for settings handlers
impl axum::extract::FromRef<AppState> for (Arc<SessionManager>, SettingsState) {
    fn from_ref(state: &AppState) -> Self {
        (state.manager.clone(), state.settings.clone())
    }
}

// Allow extracting (Arc<SessionManager>, Arc<FileWatcherState>) for file watcher handlers
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

fn parse_port() -> u16 {
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--port" | "-p" => {
                if let Some(v) = args.get(i + 1) {
                    return v.parse().expect("invalid port number");
                }
            }
            s if s.starts_with("--port=") => {
                return s[7..].parse().expect("invalid port number");
            }
            _ => {}
        }
        i += 1;
    }
    8999
}

async fn server_info(State(state): State<AppState>) -> Json<serde_json::Value> {
    let lan_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());
    Json(serde_json::json!({
        "lan_ip": lan_ip,
        "port": state.port,
    }))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let port = parse_port();
    let manager = Arc::new(SessionManager::new());
    manager.start_cleanup_task();

    let auth_token = {
        let mut buf = [0u8; 32];
        rand::fill(&mut buf);
        let token: String = buf.iter().map(|b| format!("{:02x}", b)).collect();
        Arc::new(token)
    };
    tracing::info!("Auth token: {}", &*auth_token);

    let state = AppState {
        manager,
        settings: settings::create_settings_state(),
        file_watcher: Arc::new(FileWatcherState::new()),
        auth_token: auth_token.clone(),
        port,
    };

    let app = Router::new()
        .route("/ws", get(ws::ws_handler))
        .route("/ws/sync", get(ws::sync_handler))
        .route("/ws/watch", get(file_watcher::watch_handler))
        .route("/ws/monitor", get(monitor::ws_monitor_handler))
        .route("/api/settings", get(settings::get_settings).put(settings::put_settings))
        .route("/api/settings/background", post(settings::upload_background).get(settings::get_background))
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
        .route("/api/info", get(server_info))
        .route("/preview/:port", any(proxy::proxy_handler_root))
        .route("/preview/:port/", any(proxy::proxy_handler_root))
        .route("/preview/:port/*path", any(proxy::proxy_handler_wildcard))
        .route("/assets/*path", get(static_handler))
        .route("/", get(routes::index))
        .layer(middleware::from_fn(move |req, next| {
            let token = auth_token.clone();
            async move { auth::auth_middleware(req, next, &token).await }
        }))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Listening on http://0.0.0.0:{}", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
