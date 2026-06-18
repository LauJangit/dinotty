use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

// ─── Core Types ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(rename = "minAppVersion")]
    pub min_app_version: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub entry: Option<String>,
    pub bin: Option<BinConfig>,
    pub commands: Option<Vec<CommandDef>>,
    pub styles: Option<String>,
    pub permissions: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BinConfig {
    pub mode: String,
    pub entry: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandDef {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PluginInfo {
    pub manifest: PluginManifest,
    pub install_date: Option<u64>,
    pub state: PluginStateValue,
    pub error: Option<String>,
    #[serde(rename = "isDevLink", default)]
    pub is_dev_link: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PluginStateValue {
    Active,
    Error,
}

// ─── Request / Response Types ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ExecRequest {
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub timeout: Option<u64>,
}

#[derive(Serialize)]
pub struct ExecResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Deserialize)]
pub struct DevLinkRequest {
    pub path: String,
}

#[derive(Deserialize)]
pub struct InstallDirRequest {
    pub path: String,
    #[serde(default)]
    pub dev_link: bool,
}

#[derive(Deserialize)]
pub struct DeleteQuery {
    #[serde(default)]
    pub keep_data: bool,
}

#[derive(Deserialize)]
pub struct SpawnQuery {
    pub args: String,
}

#[derive(Deserialize)]
pub struct ProcessStartRequest {
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

// ─── Process Types ──────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProcessState {
    Running,
    Exited,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub command: String,
    pub args: Vec<String>,
    pub state: ProcessState,
    pub exit_code: Option<i32>,
}

pub struct ManagedProcess {
    pub info: ProcessInfo,
    pub child: Arc<TokioMutex<Option<tokio::process::Child>>>,
}

// ─── Marketplace Types ──────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegistryPlugin {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub description_zh: Option<String>,
    pub version: String,
    #[serde(default)]
    pub icon: Option<String>,
    pub repo: String,
    #[serde(default = "default_branch")]
    pub branch: String,
    #[serde(default)]
    pub subdir: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
}

pub(super) fn default_branch() -> String {
    "main".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegistryIndex {
    pub plugins: Vec<RegistryPlugin>,
}

#[derive(Deserialize)]
pub struct InstallGitRequest {
    pub repo: String,
    #[serde(default = "default_branch")]
    pub branch: String,
    #[serde(default)]
    pub subdir: Option<String>,
}

#[derive(Serialize)]
pub struct MarketPlugin {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description_zh: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub repo: String,
    pub branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subdir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    pub has_update: bool,
}
