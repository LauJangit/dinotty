use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};

use super::types::PluginManifest;

pub fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.id.is_empty() {
        return Err("id is required".into());
    }
    if !manifest
        .id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("id must match [a-z0-9-]".into());
    }
    if manifest.name.is_empty() {
        return Err("name is required".into());
    }
    if manifest.version.is_empty() {
        return Err("version is required".into());
    }
    Ok(())
}

pub fn set_executable(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).map_err(|e| e.to_string())
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

pub fn extract_tar_gz(data: &[u8], dest: &std::path::Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use std::io::Cursor;
    let decoder = GzDecoder::new(Cursor::new(data));
    let mut archive = tar::Archive::new(decoder);
    archive.set_overwrite(false);

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        if path
            .components()
            .any(|c| c == std::path::Component::ParentDir)
        {
            return Err("archive contains path traversal (..)".into());
        }
    }

    let decoder2 = GzDecoder::new(Cursor::new(data));
    let mut archive2 = tar::Archive::new(decoder2);
    archive2.unpack(dest).map_err(|e| e.to_string())
}

pub fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn plugin_err(status: StatusCode, msg: &str) -> Response {
    (status, Json(serde_json::json!({ "error": msg }))).into_response()
}

pub fn is_safe_segment(s: &str) -> bool {
    !s.is_empty() && !s.contains('/') && !s.contains('\\') && s != ".." && s != "."
}

pub fn extract_zip(data: &[u8], dest: &std::path::Path) -> Result<(), String> {
    use std::io::Cursor;
    let mut archive =
        zip::ZipArchive::new(Cursor::new(data)).map_err(|e| format!("invalid zip: {e}"))?;

    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| format!("zip read error: {e}"))?;
        let outpath = match file.enclosed_name() {
            Some(p) => dest.join(p),
            None => continue,
        };
        if outpath
            .components()
            .any(|c| c == std::path::Component::ParentDir)
        {
            return Err("archive contains path traversal (..)".into());
        }
    }

    let mut archive2 =
        zip::ZipArchive::new(Cursor::new(data)).map_err(|e| format!("invalid zip: {e}"))?;
    archive2
        .extract(dest)
        .map_err(|e| format!("zip extract error: {e}"))
}

pub fn find_plugin_root(
    base: &std::path::Path,
    subdir: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let top_level = std::fs::read_dir(base)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .find(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path());

    let root = match (&top_level, subdir) {
        (Some(top), Some(sub)) => top.join(sub),
        (Some(top), None) => top.clone(),
        (None, Some(sub)) => base.join(sub),
        (None, None) => base.to_path_buf(),
    };

    if root.join("plugin.json").exists() {
        Ok(root)
    } else {
        Err("plugin.json not found in downloaded archive".into())
    }
}

pub fn version_gt(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.trim_start_matches('v')
            .split('.')
            .filter_map(|p| p.parse().ok())
            .collect()
    };
    parse(a) > parse(b)
}
