#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]

use dinotty_server::{
    auth, file_watcher, history, monitor, notification, openapi, plugin, proxy, session, settings,
    tabs, workspace, ws,
};

use axum::{
    body::Body,
    extract::{ConnectInfo, Path, State},
    http::{header, HeaderValue, Response, StatusCode},
    middleware,
    response::{Html, IntoResponse},
    routing::{any, delete, get, post, put},
    Json, Router,
};
use rust_embed::Embed;
use std::fs;
use std::net::SocketAddr;

use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::file_watcher::FileWatcherState;
use crate::history::HistoryState;
use crate::monitor::MonitorState;
use crate::notification::NotificationBroadcast;
use crate::plugin::PluginManagerState;
use crate::session::SessionManager;
use crate::settings::SettingsState;

async fn index(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let content = StaticFiles::get("index.html").expect("index.html must exist in frontend/dist/");
    let html = String::from_utf8_lossy(&content.data);

    // Only embed token if ?token=xxx matches the server token
    let stored_token = state.auth_token.read().await.clone();
    let token_value = params
        .get("token")
        .filter(|t| urlencoding::decode(t).is_ok_and(|d| d == stored_token))
        .map(|_| stored_token)
        .unwrap_or_default();

    let tag = format!("<meta name=\"auth-token\" content=\"{token_value}\">\n</head>");
    let html = html.replace("</head>", &tag);
    ([(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))], Html(html))
}

#[derive(Embed)]
#[folder = "frontend/dist/"]
pub struct StaticFiles;

#[derive(Clone, serde::Serialize)]
pub struct GitInfo {
    pub version: String,
    pub repo_url: String,
}

fn read_git_info() -> GitInfo {
    let lines: Vec<String> = fs::read_to_string("VERSION")
        .ok()
        .map(|s| s.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
        .unwrap_or_default();

    let version = lines
        .first()
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());

    let repo_url = lines
        .get(1)
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| env!("CARGO_PKG_REPOSITORY").to_string());

    GitInfo { version, repo_url }
}

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<SessionManager>,
    pub settings: SettingsState,
    pub file_watcher: Arc<FileWatcherState>,
    pub monitor: MonitorState,
    pub notifier: Arc<NotificationBroadcast>,
    pub history: HistoryState,
    pub auth_token: Arc<tokio::sync::RwLock<String>>,
    pub port: u16,
    pub plugins: PluginManagerState,
    pub git_info: GitInfo,
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

impl axum::extract::FromRef<AppState> for MonitorState {
    fn from_ref(state: &AppState) -> Self {
        state.monitor.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<NotificationBroadcast> {
    fn from_ref(state: &AppState) -> Self {
        state.notifier.clone()
    }
}

impl axum::extract::FromRef<AppState> for HistoryState {
    fn from_ref(state: &AppState) -> Self {
        state.history.clone()
    }
}

impl axum::extract::FromRef<AppState> for PluginManagerState {
    fn from_ref(state: &AppState) -> Self {
        state.plugins.clone()
    }
}

impl axum::extract::FromRef<AppState> for (PluginManagerState, Arc<SessionManager>) {
    fn from_ref(state: &AppState) -> Self {
        (state.plugins.clone(), state.manager.clone())
    }
}

async fn static_handler(Path(path): Path<String>) -> impl IntoResponse {
    let lookup = format!("assets/{path}");
    match StaticFiles::get(&lookup) {
        Some(content) => {
            let mime = mime_guess::from_path(&lookup).first_or_octet_stream();
            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => {
            Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("not found")).unwrap()
        }
    }
}

async fn manifest_handler() -> impl IntoResponse {
    match StaticFiles::get("manifest.json") {
        Some(content) => Response::builder()
            .header(header::CONTENT_TYPE, "application/manifest+json")
            .body(Body::from(content.data.into_owned()))
            .unwrap(),
        None => {
            Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("not found")).unwrap()
        }
    }
}

async fn icon_handler(Path(path): Path<String>) -> impl IntoResponse {
    let lookup = format!("icons/{path}");
    match StaticFiles::get(&lookup) {
        Some(content) => {
            let mime = mime_guess::from_path(&lookup).first_or_octet_stream();
            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .header(header::CACHE_CONTROL, "public, max-age=86400")
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => {
            Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("not found")).unwrap()
        }
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
    let lan_ip =
        local_ip_address::local_ip().map_or_else(|_| "127.0.0.1".to_string(), |ip| ip.to_string());
    Json(serde_json::json!({
        "lan_ip": lan_ip,
        "port": state.port,
        "version": state.git_info.version,
        "repo_url": state.git_info.repo_url,
    }))
}

#[derive(serde::Deserialize)]
struct UpdateTokenRequest {
    token: String,
}

async fn check_auth(State(state): State<AppState>) -> impl IntoResponse {
    let _ = state;
    StatusCode::OK
}

async fn get_token(State(state): State<AppState>) -> impl IntoResponse {
    let token = state.auth_token.read().await;
    Json(serde_json::json!({ "token": *token }))
}

async fn token_configured(State(state): State<AppState>) -> impl IntoResponse {
    let token = state.auth_token.read().await;
    Json(serde_json::json!({ "configured": !token.is_empty() }))
}

async fn update_token(
    State(state): State<AppState>,
    Json(body): Json<UpdateTokenRequest>,
) -> impl IntoResponse {
    let new_token = body.token.trim().to_string();
    if new_token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "token cannot be empty"})),
        )
            .into_response();
    }
    // Update in-memory token
    *state.auth_token.write().await = new_token.clone();
    // Persist to dedicated token file
    if let Err(e) = settings::save_token(&new_token) {
        tracing::error!("Failed to persist token: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "failed to save"})),
        )
            .into_response();
    }
    StatusCode::OK.into_response()
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

    let monitor_state = MonitorState::new();
    monitor_state.clone().start_collector();

    let notifier = Arc::new(NotificationBroadcast::new());
    let settings_state = settings::create_settings_state();
    notifier.set_settings(settings_state.clone());
    let history_state = HistoryState::new();

    // Load token from dedicated file or env var; empty means first-time setup
    let initial_token =
        settings::load_token().or_else(|| std::env::var("DINOTTY_TOKEN").ok()).unwrap_or_default();
    if initial_token.is_empty() {
        tracing::info!("No auth token configured — first-time setup required");
    } else {
        tracing::info!("Auth token loaded (length={})", initial_token.len());
    }
    let auth_token = Arc::new(tokio::sync::RwLock::new(initial_token));

    let plugins = Arc::new(plugin::PluginManager::new());
    plugins.scan();
    tracing::info!("Loaded {} plugins", plugins.list().len());

    let git_info = read_git_info();
    tracing::info!("Git info: {}", git_info.version);

    let state = AppState {
        manager,
        settings: settings_state,
        file_watcher: Arc::new(FileWatcherState::new()),
        monitor: monitor_state,
        notifier,
        history: history_state,
        auth_token: auth_token.clone(),
        port,
        plugins,
        git_info,
    };

    state.plugins.watch_changes(state.manager.clone());

    let app =
        Router::new()
            .route("/ws", get(ws::ws_handler))
            .route("/ws/sync", get(ws::sync_handler))
            .route("/ws/watch", get(file_watcher::watch_handler))
            .route("/ws/monitor", get(monitor::ws_monitor_handler))
            .route("/ws/notify", get(ws::notification_ws_handler))
            .route("/api/notify", post(notification::post_notify))
            .route("/api/input", post(ws::post_input))
            // Open API
            .route("/api/sessions", get(openapi::list_sessions))
            .route("/api/sessions/:pane_id/screen", get(openapi::get_screen))
            .route("/api/sessions/:pane_id/scrollback", get(openapi::get_scrollback))
            .route("/api/sessions/:pane_id/input", post(openapi::session_input))
            .route("/api/sessions/:pane_id/resize", post(openapi::session_resize))
            .route("/ws/api/sessions/:pane_id/stream", get(openapi::session_stream))
            // Tab/Pane management
            .route("/api/tabs", get(tabs::list_tabs).post(tabs::create_tab))
            .route("/api/tabs/:tab_id", delete(tabs::close_tab))
            .route("/api/tabs/:tab_id/pane", post(tabs::split_pane))
            .route("/api/tabs/:tab_id/pane/:pane_id", delete(tabs::close_pane))
            .route("/api/tabs/:tab_id/pane/:pane_id/activate", put(tabs::activate_pane))
            .route("/api/tabs/:tab_id/layout", put(tabs::update_layout))
            .route("/api/auth", post(check_auth))
            .route("/api/token-configured", get(token_configured))
            .route("/api/settings", get(settings::get_settings).put(settings::put_settings))
            .route(
                "/api/settings/background",
                post(settings::upload_background).get(settings::get_background),
            )
            .route("/api/workspace/resolve", get(workspace::workspace_resolve))
            .route("/api/workspace/list", get(workspace::workspace_list))
            .route("/api/workspace/meta", get(workspace::workspace_meta))
            .route("/api/workspace/raw", get(workspace::workspace_raw))
            .merge(
                Router::new()
                    .route("/api/workspace/upload", post(workspace::workspace_upload))
                    .layer(axum::extract::DefaultBodyLimit::max(512 * 1024 * 1024)),
            )
            .route("/api/workspace/create", post(workspace::workspace_create_entry))
            .route("/api/workspace/file", put(workspace::workspace_put_file))
            .route("/api/workspace/delete", delete(workspace::workspace_delete))
            .route("/api/workspace/rename", post(workspace::workspace_rename))
            .route("/api/workspace/move", post(workspace::workspace_move))
            .route("/api/workspace/git-status", get(workspace::workspace_git_status))
            .route("/api/workspace/git-diff", get(workspace::workspace_git_diff))
            .route("/api/workspace/git-stage-lines", post(workspace::workspace_git_stage_lines))
            .route("/api/workspace/git-revert-lines", post(workspace::workspace_git_revert_lines))
            .route("/api/workspace/syntax-check", post(workspace::workspace_syntax_check))
            .route("/ws/history", get(history::ws_history_handler))
            .route("/api/history", get(history::get_history).delete(history::delete_history))
            .route("/api/proxy", any(proxy::external_proxy_handler))
            .route("/api/info", get(server_info))
            .route("/api/token", get(get_token).put(update_token))
            // Plugin management
            .route("/api/plugins", get(plugin::list_plugins))
            .route("/api/plugins/market", get(plugin::get_market_registry))
            .route("/api/plugins/market/:id/readme", get(plugin::get_market_readme))
            .route("/api/plugins/dev-link", post(plugin::dev_link_plugin))
            .route("/api/plugins/install-dir", post(plugin::install_from_dir))
            .merge(
                Router::new()
                    .route("/api/plugins/install", post(plugin::install_plugin))
                    .route("/api/plugins/install-git", post(plugin::install_from_git))
                    .route("/api/plugins/:id/update", post(plugin::update_plugin))
                    .layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024)),
            )
            .route("/api/plugins/:id", get(plugin::plugin_detail).delete(plugin::delete_plugin))
            .route("/api/plugins/:id/exec", post(plugin::plugin_exec))
            .route("/api/plugins/:id/spawn", get(plugin::plugin_spawn_ws))
            .route("/api/plugins/:id/process/start", post(plugin::plugin_process_start))
            .route(
                "/api/plugins/:id/process",
                get(plugin::plugin_process_list).delete(plugin::plugin_process_stop_all),
            )
            .route("/api/plugins/:id/process/:pid", delete(plugin::plugin_process_stop))
            .route("/api/plugins/:id/storage", get(plugin::plugin_storage_list))
            .route(
                "/api/plugins/:id/storage/:key",
                get(plugin::plugin_storage_get)
                    .put(plugin::plugin_storage_set)
                    .delete(plugin::plugin_storage_delete),
            )
            .route("/api/plugins/:id/*path", get(plugin::plugin_asset))
            .route("/preview/:port", any(proxy::proxy_handler_root))
            .route("/preview/:port/", any(proxy::proxy_handler_root))
            .route("/preview/:port/*path", any(proxy::proxy_handler_wildcard))
            .route("/assets/*path", get(static_handler))
            .route("/icons/*path", get(icon_handler))
            .route("/manifest.json", get(manifest_handler))
            .route(
                "/logo.png",
                get(|| async {
                    match StaticFiles::get("logo.png") {
                        Some(content) => Response::builder()
                            .header(header::CONTENT_TYPE, "image/png")
                            .header(header::CACHE_CONTROL, "public, max-age=86400")
                            .body(Body::from(content.data.into_owned()))
                            .unwrap(),
                        None => Response::builder()
                            .status(StatusCode::NOT_FOUND)
                            .body(Body::from("not found"))
                            .unwrap(),
                    }
                }),
            )
            .route("/", get(index))
            .layer(middleware::from_fn_with_state(
                state.clone(),
                |State(s): State<AppState>,
                 ConnectInfo(addr): ConnectInfo<SocketAddr>,
                 req,
                 next| async move {
                    let token = s.auth_token.read().await.clone();
                    auth::auth_middleware(req, next, &token, &s.settings, addr.ip()).await
                },
            ))
            .layer(CorsLayer::permissive())
            .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Listening on http://0.0.0.0:{}", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
}
