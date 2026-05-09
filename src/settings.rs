use axum::{
    body::Body,
    extract::State,
    http::{header, Response, StatusCode},
    response::IntoResponse,
    Json,
};
use axum_extra::extract::Multipart;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::Arc,
};
use tokio::sync::RwLock;
use tracing::{error, info};

use crate::session::SessionManager;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    #[serde(default)]
    pub theme: ThemeConfig,
    #[serde(default)]
    pub background: BackgroundConfig,
    #[serde(default)]
    pub text: TextConfig,
    #[serde(default)]
    pub bookmarks: Vec<CommandBookmark>,
    #[serde(default)]
    pub action_keyboard: Option<ActionKeyboardConfig>,
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default)]
    pub monitor: MonitorConfig,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MonitorConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub cpu: bool,
    #[serde(default = "default_true")]
    pub memory: bool,
    #[serde(default = "default_true")]
    pub disk: bool,
    #[serde(default = "default_true")]
    pub network: bool,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self { enabled: true, cpu: true, memory: true, disk: true, network: true }
    }
}

fn default_locale() -> String {
    "zh".into()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThemeConfig {
    #[serde(default = "default_preset")]
    pub preset: String,
    #[serde(default)]
    pub custom: Option<CustomColors>,
}

fn default_preset() -> String { "dark".into() }

impl Default for ThemeConfig {
    fn default() -> Self {
        Self { preset: default_preset(), custom: None }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CustomColors {
    pub foreground: Option<String>,
    pub background: Option<String>,
    pub cursor: Option<String>,
    pub ansi: Option<Vec<Option<String>>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BackgroundConfig {
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    #[serde(default)]
    pub has_image: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TextConfig {
    #[serde(default = "default_font_size")]
    pub font_size: u8,
    #[serde(default)]
    pub font_family: String,
    #[serde(default = "default_line_height")]
    pub line_height: f32,
    #[serde(default)]
    pub letter_spacing: f32,
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,
    #[serde(default = "default_true")]
    pub cursor_blink: bool,
    #[serde(default = "default_scrollback")]
    pub scrollback: u32,
}

fn default_font_size() -> u8 { 14 }
fn default_line_height() -> f32 { 1.2 }
fn default_cursor_style() -> String { "block".into() }
fn default_true() -> bool { true }
fn default_scrollback() -> u32 { 10000 }

impl Default for TextConfig {
    fn default() -> Self {
        Self {
            font_size: default_font_size(),
            font_family: String::new(),
            line_height: default_line_height(),
            letter_spacing: 0.0,
            cursor_style: default_cursor_style(),
            cursor_blink: true,
            scrollback: default_scrollback(),
        }
    }
}

fn default_mode() -> String { "solid".into() }
fn default_opacity() -> f32 { 1.0 }

impl Default for BackgroundConfig {
    fn default() -> Self {
        Self { mode: default_mode(), color: None, opacity: 1.0, has_image: false }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CommandBookmark {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ActionKey {
    pub label: String,
    pub send: String,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default)]
    pub special: Option<String>,
    #[serde(default)]
    pub auto_enter: bool,
    #[serde(default)]
    pub grow: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ActionKeyboardConfig {
    pub rows: Vec<Vec<ActionKey>>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: ThemeConfig::default(),
            background: BackgroundConfig::default(),
            text: TextConfig::default(),
            bookmarks: vec![],
            action_keyboard: None,
            locale: default_locale(),
            monitor: MonitorConfig::default(),
        }
    }
}

fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("xterm")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

fn bg_image_path() -> PathBuf {
    config_dir().join("bg.webp")
}

pub fn load_settings() -> Settings {
    let path = settings_path();
    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(data) => match serde_json::from_str(&data) {
                Ok(s) => return s,
                Err(e) => error!("parse settings: {}", e),
            },
            Err(e) => error!("read settings: {}", e),
        }
    }
    Settings::default()
}

fn save_settings(settings: &Settings) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(), json).map_err(|e| e.to_string())?;
    Ok(())
}

pub type SettingsState = Arc<RwLock<Settings>>;

pub fn create_settings_state() -> SettingsState {
    Arc::new(RwLock::new(load_settings()))
}

pub async fn get_settings(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
) -> impl IntoResponse {
    let settings = state.1.read().await;
    Json(settings.clone())
}

pub async fn put_settings(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
    Json(new_settings): Json<Settings>,
) -> impl IntoResponse {
    match save_settings(&new_settings) {
        Ok(()) => {
            *state.1.write().await = new_settings;
            StatusCode::OK
        }
        Err(e) => {
            error!("save settings: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

pub async fn upload_background(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("file") {
            let data = match field.bytes().await {
                Ok(d) => d,
                Err(e) => {
                    error!("read upload: {}", e);
                    return StatusCode::BAD_REQUEST;
                }
            };

            let dir = config_dir();
            let _ = std::fs::create_dir_all(&dir);

            // Try to decode and re-encode as WebP for compression
            match image::load_from_memory(&data) {
                Ok(img) => {
                    let resized = if img.width() > 2048 || img.height() > 2048 {
                        img.resize(2048, 2048, image::imageops::FilterType::Lanczos3)
                    } else {
                        img
                    };
                    if let Err(e) = resized.save(bg_image_path()) {
                        error!("save bg image: {}", e);
                        return StatusCode::INTERNAL_SERVER_ERROR;
                    }
                }
                Err(_) => {
                    // Can't decode as image — save raw
                    if let Err(e) = std::fs::write(bg_image_path(), &data) {
                        error!("save bg raw: {}", e);
                        return StatusCode::INTERNAL_SERVER_ERROR;
                    }
                }
            }

            // Update settings
            let mut settings = state.1.write().await;
            settings.background.has_image = true;
            let _ = save_settings(&settings);

            info!("Background image uploaded");
            return StatusCode::OK;
        }
    }
    StatusCode::BAD_REQUEST
}

pub async fn get_background() -> impl IntoResponse {
    let path = bg_image_path();
    if !path.exists() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("no background"))
            .unwrap();
    }
    match std::fs::read(&path) {
        Ok(data) => {
            Response::builder()
                .header(header::CONTENT_TYPE, "image/webp")
                .header(header::CACHE_CONTROL, "no-cache")
                .body(Body::from(data))
                .unwrap()
        }
        Err(_) => {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("read error"))
                .unwrap()
        }
    }
}
