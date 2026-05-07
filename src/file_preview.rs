use axum::{
    extract::Query,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Deserialize)]
pub struct FileQuery {
    path: String,
}

#[derive(Serialize)]
pub struct FileResponse {
    path: String,
    content: String,
    language: String,
    lines: usize,
}

pub async fn get_file(Query(q): Query<FileQuery>) -> impl IntoResponse {
    let path = shellexpand_path(&q.path);

    if !Path::new(&path).exists() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "file not found"})),
        ).into_response();
    }

    if !Path::new(&path).is_file() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "not a file"})),
        ).into_response();
    }

    // Limit file size to 1MB
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) => return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        ).into_response(),
    };

    if meta.len() > 1_048_576 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "file too large (>1MB)"})),
        ).into_response();
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => {
            // Binary file
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "binary file"})),
            ).into_response();
        }
    };

    let lines = content.lines().count();
    let language = detect_language(&path);

    Json(FileResponse { path: q.path, content, language, lines }).into_response()
}

fn shellexpand_path(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&path[2..]).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

fn detect_language(path: &str) -> String {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    match ext {
        "rs" => "rust",
        "js" | "mjs" | "cjs" => "javascript",
        "ts" | "mts" | "cts" => "typescript",
        "jsx" => "jsx",
        "tsx" => "tsx",
        "py" => "python",
        "go" => "go",
        "rb" => "ruby",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" | "sass" => "scss",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" => "xml",
        "md" | "markdown" => "markdown",
        "sh" | "bash" | "zsh" => "bash",
        "sql" => "sql",
        "dockerfile" | "Dockerfile" => "dockerfile",
        "vue" => "vue",
        "svelte" => "svelte",
        _ => {
            let filename = Path::new(path)
                .file_name()
                .and_then(|f| f.to_str())
                .unwrap_or("");
            match filename {
                "Makefile" | "makefile" | "GNUmakefile" => "makefile",
                "Dockerfile" => "dockerfile",
                "Cargo.toml" | "Cargo.lock" => "toml",
                _ => "plaintext",
            }
        }
    }.to_string()
}
