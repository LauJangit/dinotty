use axum::{
    body::Body,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::Multipart;
use russh_sftp::client::SftpSession;
use std::path::Path;
use std::sync::Arc;

use crate::session::Session;
use crate::ssh::sftp::{clear_sftp_cache, get_or_create_sftp};
use crate::workspace::{
    detect_language, json_err, media_kind, office_kind, skip_text_preview, DirEntry, ListResponse,
    MetaResponse, PanePathQuery, ResolveResponse, WorkspaceListQuery, MAX_DOWNLOAD,
    MAX_TEXT_PREVIEW,
};

/// Get SFTP session, clearing cache on error and retrying once.
async fn sftp(session: &Session) -> Result<Arc<SftpSession>, Response> {
    match get_or_create_sftp(session).await {
        Ok(s) => Ok(s),
        Err(_e) => {
            clear_sftp_cache(session);
            // Retry once in case the cached session was stale
            get_or_create_sftp(session)
                .await
                .map_err(|e2| json_err(StatusCode::BAD_GATEWAY, &format!("SFTP error: {e2}")))
        }
    }
}

fn sftp_err(e: impl std::fmt::Display) -> Response {
    json_err(StatusCode::BAD_GATEWAY, &format!("SFTP: {e}"))
}

/// Validate that a remote path is under the given root.
fn validate_remote_path(root: &str, path: &str) -> Result<(), Response> {
    let norm_root = root.trim_end_matches('/');
    let norm_path = path.trim_end_matches('/');
    if norm_path != norm_root && !norm_path.starts_with(&format!("{norm_root}/")) {
        return Err(json_err(StatusCode::FORBIDDEN, "outside workspace"));
    }
    Ok(())
}

fn path_after_root(root: &str, full: &str) -> String {
    let norm_root = root.trim_end_matches('/');
    full.strip_prefix(norm_root).unwrap_or(full).trim_start_matches('/').to_string()
}

// ── list ──────────────────────────────────────────────────────────────────

pub async fn remote_list(session: Arc<Session>, q: WorkspaceListQuery) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let root = if q.root.as_deref() == Some("/") {
        "/".to_string()
    } else {
        let state = session.cwd_state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cwd.to_string_lossy().into_owned()
    };
    let target = normalize_remote_join(&root, &q.path);
    let target = match sftp.canonicalize(&target).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    if let Err(e) = validate_remote_path(&root, &target) {
        return e;
    }
    let entries = match sftp.read_dir(&target).await {
        Ok(rd) => rd,
        Err(e) => return sftp_err(e),
    };
    let mut list: Vec<DirEntry> = entries
        .filter(|e| e.file_name() != "." && e.file_name() != "..")
        .map(|e| {
            let ft = e.file_type();
            let meta = e.metadata();
            DirEntry { name: e.file_name(), is_dir: ft.is_dir(), size: meta.size.unwrap_or(0) }
        })
        .collect();
    list.sort_by_key(|e| (!e.is_dir, e.name.to_lowercase()));
    let cwd_display = root;
    let path_display = q.path.trim().trim_start_matches('/').to_string();
    Json(ListResponse { cwd: cwd_display, path: path_display, entries: list }).into_response()
}

// ── meta ──────────────────────────────────────────────────────────────────

pub async fn remote_meta(session: Arc<Session>, q: PanePathQuery) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let root = {
        let state = session.cwd_state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cwd.to_string_lossy().into_owned()
    };
    let target = normalize_remote_join(&root, &q.path);
    let target = match sftp.canonicalize(&target).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    if let Err(e) = validate_remote_path(&root, &target) {
        return e;
    }
    let meta = match sftp.metadata(&target).await {
        Ok(m) => m,
        Err(e) => return sftp_err(e),
    };
    if !meta.file_type().is_file() {
        return json_err(StatusCode::BAD_REQUEST, "not a file");
    }
    let size = meta.size.unwrap_or(0);
    if size > MAX_DOWNLOAD {
        return json_err(StatusCode::BAD_REQUEST, "file too large");
    }
    if let Some((kind, mime)) = media_kind(Path::new(&target)) {
        return Json(MetaResponse::media(kind, mime)).into_response();
    }
    if let Some((kind, mime)) = office_kind(Path::new(&target)) {
        return Json(MetaResponse::media(kind, mime)).into_response();
    }
    if skip_text_preview(Path::new(&target)) {
        return Json(MetaResponse::unsupported()).into_response();
    }
    // Read file content for text preview
    let bytes = match sftp.read(&target).await {
        Ok(b) => b,
        Err(e) => return sftp_err(e),
    };
    let truncated = bytes.len() > MAX_TEXT_PREVIEW;
    let slice = if truncated { &bytes[..MAX_TEXT_PREVIEW] } else { &bytes[..] };
    let text = match std::str::from_utf8(slice) {
        Ok(t) => t.to_string(),
        Err(_) => return Json(MetaResponse::unsupported()).into_response(),
    };
    let lang = detect_language(Path::new(&target));
    let kind = if lang == "markdown" {
        "markdown"
    } else if lang == "html" {
        "html"
    } else {
        "text"
    };
    Json(MetaResponse {
        kind,
        content: Some(text),
        language: Some(lang.into()),
        truncated,
        mime: None,
        message: truncated.then_some("truncated".into()),
    })
    .into_response()
}

// ── raw ───────────────────────────────────────────────────────────────────

pub async fn remote_raw(session: Arc<Session>, q: PanePathQuery) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let root = {
        let state = session.cwd_state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cwd.to_string_lossy().into_owned()
    };
    let target = normalize_remote_join(&root, &q.path);
    let target = match sftp.canonicalize(&target).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    if let Err(e) = validate_remote_path(&root, &target) {
        return e;
    }
    let meta = match sftp.metadata(&target).await {
        Ok(m) => m,
        Err(e) => return sftp_err(e),
    };
    if !meta.file_type().is_file() {
        return json_err(StatusCode::BAD_REQUEST, "not a file");
    }
    let size = meta.size.unwrap_or(0);
    if size > MAX_DOWNLOAD {
        return json_err(StatusCode::BAD_REQUEST, "file too large");
    }
    let mime = media_kind(Path::new(&target)).map_or_else(
        || mime_guess::from_path(&target).first_or_octet_stream().to_string(),
        |(_, m)| m.to_string(),
    );
    // Read full file and stream it
    let bytes = match sftp.read(&target).await {
        Ok(b) => b,
        Err(e) => return sftp_err(e),
    };
    let len = bytes.len();
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&len.to_string()).unwrap_or_else(|_| HeaderValue::from_static("0")),
    );
    (StatusCode::OK, headers, Body::from(bytes)).into_response()
}

// ── put file ──────────────────────────────────────────────────────────────

pub async fn remote_put_file(session: Arc<Session>, q: PanePathQuery, content: String) -> Response {
    if content.len() as u64 > MAX_DOWNLOAD {
        return json_err(StatusCode::BAD_REQUEST, "content too large");
    }
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let root = {
        let state = session.cwd_state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cwd.to_string_lossy().into_owned()
    };
    let target = normalize_remote_join(&root, &q.path);
    // Ensure parent exists by checking canonicalize
    let parent = Path::new(&target)
        .parent()
        .map_or_else(|| "/".to_string(), |p| p.to_string_lossy().into_owned());
    if sftp.canonicalize(&parent).await.is_err() {
        return json_err(StatusCode::NOT_FOUND, "parent directory not found");
    }
    match sftp.write(&target, content.as_bytes()).await {
        Ok(()) => {}
        Err(e) => return sftp_err(e),
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

// ── create entry ──────────────────────────────────────────────────────────

pub async fn remote_create_entry(
    session: Arc<Session>,
    parent: String,
    kind: String,
    name: String,
) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let root = {
        let state = session.cwd_state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cwd.to_string_lossy().into_owned()
    };
    let parent_path = normalize_remote_join(&root, &parent);
    let parent_canon = match sftp.canonicalize(&parent_path).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    if let Err(e) = validate_remote_path(&root, &parent_canon) {
        return e;
    }
    let dest = format!("{}/{}", parent_canon.trim_end_matches('/'), name);
    // Check if already exists
    match sftp.try_exists(&dest).await {
        Ok(true) => return json_err(StatusCode::CONFLICT, "already exists"),
        Ok(false) => {}
        Err(e) => return sftp_err(e),
    }
    if kind == "dir" {
        if let Err(e) = sftp.create_dir(&dest).await {
            return sftp_err(e);
        }
    } else {
        // Create empty file
        match sftp.create(&dest).await {
            Ok(mut file) => {
                use tokio::io::AsyncWriteExt;
                if let Err(e) = file.shutdown().await {
                    return sftp_err(e);
                }
            }
            Err(e) => return sftp_err(e),
        }
    }
    let rel = path_after_root(&root, &dest);
    Json(serde_json::json!({ "rel": rel })).into_response()
}

// ── delete ────────────────────────────────────────────────────────────────

pub async fn remote_delete(session: Arc<Session>, q: PanePathQuery) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let root = {
        let state = session.cwd_state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cwd.to_string_lossy().into_owned()
    };
    let target = normalize_remote_join(&root, &q.path);
    let target = match sftp.canonicalize(&target).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    if let Err(e) = validate_remote_path(&root, &target) {
        return e;
    }
    // Prevent deleting workspace root
    let root_canon = match sftp.canonicalize(&root).await {
        Ok(r) => r,
        Err(e) => return sftp_err(e),
    };
    if target.trim_end_matches('/') == root_canon.trim_end_matches('/') {
        return json_err(StatusCode::BAD_REQUEST, "cannot delete workspace root");
    }
    let meta = match sftp.metadata(&target).await {
        Ok(m) => m,
        Err(e) => return sftp_err(e),
    };
    if meta.file_type().is_file() {
        if let Err(e) = sftp.remove_file(&target).await {
            return sftp_err(e);
        }
    } else if meta.file_type().is_dir() {
        if let Err(e) = remove_dir_recursive(&sftp, &target).await {
            return sftp_err(e);
        }
    } else {
        return json_err(StatusCode::BAD_REQUEST, "not a file or directory");
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

/// Recursively remove a directory via SFTP.
async fn remove_dir_recursive(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let entries = sftp.read_dir(path).await.map_err(|e| format!("read_dir: {e}"))?;
    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let child = format!("{}/{}", path.trim_end_matches('/'), name);
        let meta = entry.metadata();
        if meta.file_type().is_dir() {
            Box::pin(remove_dir_recursive(sftp, &child)).await?;
        } else {
            sftp.remove_file(&child).await.map_err(|e| format!("remove_file: {e}"))?;
        }
    }
    sftp.remove_dir(path).await.map_err(|e| format!("remove_dir: {e}"))
}

// ── rename ────────────────────────────────────────────────────────────────

pub async fn remote_rename(session: Arc<Session>, q: PanePathQuery, new_name: String) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let root = {
        let state = session.cwd_state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cwd.to_string_lossy().into_owned()
    };
    let target = normalize_remote_join(&root, &q.path);
    let target = match sftp.canonicalize(&target).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    if let Err(e) = validate_remote_path(&root, &target) {
        return e;
    }
    let parent = Path::new(&target)
        .parent()
        .map_or_else(|| "/".to_string(), |p| p.to_string_lossy().into_owned());
    let dest = format!("{}/{}", parent.trim_end_matches('/'), new_name);
    // Check if destination exists
    match sftp.try_exists(&dest).await {
        Ok(true) => return json_err(StatusCode::CONFLICT, "already exists"),
        Ok(false) => {}
        Err(e) => return sftp_err(e),
    }
    if let Err(e) = sftp.rename(&target, &dest).await {
        return sftp_err(e);
    }
    let rel = path_after_root(&root, &dest);
    Json(serde_json::json!({ "ok": true, "rel": rel })).into_response()
}

// ── move ──────────────────────────────────────────────────────────────────

pub async fn remote_move(session: Arc<Session>, q: PanePathQuery, dest_dir: String) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let root = {
        let state = session.cwd_state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cwd.to_string_lossy().into_owned()
    };
    let source = normalize_remote_join(&root, &q.path);
    let source = match sftp.canonicalize(&source).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    if let Err(e) = validate_remote_path(&root, &source) {
        return e;
    }
    let dest_path = normalize_remote_join(&root, &dest_dir);
    let dest_canon = match sftp.canonicalize(&dest_path).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    if let Err(e) = validate_remote_path(&root, &dest_canon) {
        return e;
    }
    let file_name = Path::new(&source)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let dest = format!("{}/{}", dest_canon.trim_end_matches('/'), file_name);
    match sftp.try_exists(&dest).await {
        Ok(true) => return json_err(StatusCode::CONFLICT, "already exists in destination"),
        Ok(false) => {}
        Err(e) => return sftp_err(e),
    }
    if let Err(e) = sftp.rename(&source, &dest).await {
        return sftp_err(e);
    }
    let rel = path_after_root(&root, &dest);
    Json(serde_json::json!({ "ok": true, "rel": rel })).into_response()
}

// ── resolve ───────────────────────────────────────────────────────────────

#[allow(dead_code)]
pub async fn remote_resolve(session: Arc<Session>, path: String) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let root = {
        let state = session.cwd_state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cwd.to_string_lossy().into_owned()
    };
    let target = if path.starts_with('/') || path.starts_with('~') {
        let expanded = if let Some(rest) = path.strip_prefix("~/") {
            // Get remote home via canonicalize("~") won't work, use ssh_exec
            format!("/home/{}", session.ssh_params.as_ref().map_or("root", |p| &p.username))
                + "/"
                + rest
        } else if path == "~" {
            format!("/home/{}", session.ssh_params.as_ref().map_or("root", |p| &p.username))
        } else {
            path.clone()
        };
        expanded
    } else {
        normalize_remote_join(&root, &path)
    };
    let canon = match sftp.canonicalize(&target).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    if let Err(e) = validate_remote_path(&root, &canon) {
        return e;
    }
    let rel = path_after_root(&root, &canon);
    Json(ResolveResponse { rel }).into_response()
}

// ── upload ────────────────────────────────────────────────────────────────

pub async fn remote_upload(
    session: Arc<Session>,
    dir: String,
    mut multipart: Multipart,
) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let root = {
        let state = session.cwd_state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cwd.to_string_lossy().into_owned()
    };
    let dest_dir = normalize_remote_join(&root, &dir);
    let dest_dir = match sftp.canonicalize(&dest_dir).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    if let Err(e) = validate_remote_path(&root, &dest_dir) {
        return e;
    }
    let mut saved: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut pending_rel_path: Option<String> = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                errors.push(format!("multipart read error: {e}"));
                break;
            }
        };
        let field_name = field.name().unwrap_or("").to_string();
        if field_name == "path" {
            let text = match field.text().await {
                Ok(t) => t,
                Err(e) => return json_err(StatusCode::BAD_REQUEST, &e.to_string()),
            };
            if !text.is_empty() && text != "." {
                pending_rel_path = Some(text);
            }
            continue;
        }
        let Some(filename) = field.file_name().map(std::string::ToString::to_string) else {
            continue;
        };
        let rel = pending_rel_path.take().unwrap_or_else(|| filename.clone());
        let rel_path = Path::new(&rel);
        if rel_path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return json_err(StatusCode::BAD_REQUEST, "path must not contain ..");
        }
        // Ensure parent directories exist on remote
        let file_dest_dir =
            if let Some(parent) = rel_path.parent().filter(|p| !p.as_os_str().is_empty()) {
                let sub = normalize_remote_join(&dest_dir, &parent.to_string_lossy());
                if let Err(e) = sftp.create_dir(&sub).await {
                    // ignore "already exists" errors
                    if !format!("{e}").contains("exists") {
                        errors.push(format!("mkdir {}: {e}", parent.display()));
                    }
                }
                sub
            } else {
                dest_dir.clone()
            };
        let base = rel_path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
        let path = format!("{}/{}", file_dest_dir.trim_end_matches('/'), base);
        // Read all bytes from the multipart field
        let mut data = Vec::new();
        let mut stream = field;
        loop {
            match stream.chunk().await {
                Ok(Some(chunk)) => data.extend_from_slice(&chunk),
                Ok(None) => break,
                Err(e) => {
                    errors.push(format!("read {base}: {e}"));
                    break;
                }
            }
        }
        match sftp.write(&path, &data).await {
            Ok(()) => {
                if let Some(rel) = path_after_root_checked(&root, &path) {
                    saved.push(rel);
                }
            }
            Err(e) => errors.push(format!("write {base}: {e}")),
        }
    }
    let mut resp = serde_json::json!({ "saved": saved });
    if !errors.is_empty() {
        resp["errors"] = serde_json::json!(errors);
    }
    Json(resp).into_response()
}

// ── helpers ───────────────────────────────────────────────────────────────

fn normalize_remote_join(root: &str, rel: &str) -> String {
    let rel = rel.trim().trim_start_matches('/');
    if rel.split('/').any(|p| p == "..") {
        return root.to_string(); // reject .. traversal
    }
    let mut out = root.trim_end_matches('/').to_string();
    for seg in rel.split('/').filter(|s| !s.is_empty() && *s != ".") {
        out.push('/');
        out.push_str(seg);
    }
    out
}

fn path_after_root_checked(root: &str, full: &str) -> Option<String> {
    let norm_root = root.trim_end_matches('/');
    let norm_full = full.trim_end_matches('/');
    if norm_full.starts_with(norm_root) {
        Some(
            norm_full
                .strip_prefix(norm_root)
                .unwrap_or(norm_full)
                .trim_start_matches('/')
                .to_string(),
        )
    } else {
        None
    }
}
