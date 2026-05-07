use xterm_server::{session, settings, file_preview, ws, proxy};
mod routes;

use axum::{
    body::Body,
    extract::Path,
    http::{header, Response, StatusCode},
    response::IntoResponse,
    Router,
    routing::{any, get, post},
};
use rust_embed::Embed;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::session::SessionManager;
use crate::settings::SettingsState;

#[derive(Embed)]
#[folder = "frontend/dist/"]
pub struct StaticFiles;

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<SessionManager>,
    pub settings: SettingsState,
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

    let state = AppState {
        manager,
        settings: settings::create_settings_state(),
    };

    let app = Router::new()
        .route("/ws", get(ws::ws_handler))
        .route("/ws/sync", get(ws::sync_handler))
        .route("/api/settings", get(settings::get_settings).put(settings::put_settings))
        .route("/api/settings/background", post(settings::upload_background).get(settings::get_background))
        .route("/api/file", get(file_preview::get_file))
        .route("/preview/:port", any(proxy::proxy_handler_root))
        .route("/preview/:port/", any(proxy::proxy_handler_root))
        .route("/preview/:port/*path", any(proxy::proxy_handler_wildcard))
        .route("/assets/*path", get(static_handler))
        .route("/", get(routes::index))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Listening on http://0.0.0.0:{}", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
