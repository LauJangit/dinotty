#![allow(clippy::missing_errors_doc)]

use std::path::Path;

pub fn create_dir_symlink(src: &Path, link: &Path) -> Result<(), String> {
    create_dir_symlink_impl(src, link).map_err(|e| format_symlink_error(&e))
}

#[must_use]
pub fn path_exists_or_symlink(path: &Path) -> bool {
    path.exists() || std::fs::symlink_metadata(path).is_ok()
}

pub fn remove_symlink_or_file(path: &Path) -> Result<(), String> {
    remove_symlink_or_file_impl(path).map_err(|e| format!("remove symlink failed: {e}"))
}

pub fn remove_plugin_path(path: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() || meta.file_type().is_file() {
        remove_symlink_or_file(path)
    } else {
        std::fs::remove_dir_all(path).map_err(|e| e.to_string())
    }
}

pub fn set_executable(path: &Path) -> Result<(), String> {
    set_executable_impl(path).map_err(|e| e.to_string())
}

pub fn validate_private_key_permissions(path: &Path) -> Result<(), String> {
    validate_private_key_permissions_impl(path)
}

#[cfg(unix)]
pub fn set_private_file_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
pub fn set_private_file_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn create_dir_symlink_impl(src: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(src, link)
}

#[cfg(windows)]
fn create_dir_symlink_impl(src: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(src, link)
}

#[cfg(not(any(unix, windows)))]
fn create_dir_symlink_impl(_src: &Path, _link: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "directory symlinks are not supported on this platform",
    ))
}

#[cfg(unix)]
fn remove_symlink_or_file_impl(path: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    let file_type = meta.file_type();
    if file_type.is_symlink() || file_type.is_file() {
        std::fs::remove_file(path)
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "refusing to remove a real directory",
        ))
    }
}

#[cfg(windows)]
fn remove_symlink_or_file_impl(path: &Path) -> std::io::Result<()> {
    use std::os::windows::fs::FileTypeExt;

    let meta = std::fs::symlink_metadata(path)?;
    let file_type = meta.file_type();
    if file_type.is_symlink_dir() {
        std::fs::remove_dir(path)
    } else if file_type.is_symlink_file() || file_type.is_file() {
        std::fs::remove_file(path)
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "refusing to remove a real directory",
        ))
    }
}

#[cfg(not(any(unix, windows)))]
fn remove_symlink_or_file_impl(path: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    if meta.file_type().is_file() {
        std::fs::remove_file(path)
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "refusing to remove a real directory",
        ))
    }
}

#[cfg(unix)]
fn set_executable_impl(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms)
}

#[cfg(not(unix))]
fn set_executable_impl(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn validate_private_key_permissions_impl(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let perms = std::fs::metadata(path)
        .map_err(|e| format!("Cannot read key file metadata: {e}"))?
        .permissions();
    if perms.mode() & 0o077 != 0 {
        return Err("Key file permissions are too open (should be 0600 or 0400)".into());
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_private_key_permissions_impl(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn format_symlink_error(e: &std::io::Error) -> String {
    #[cfg(windows)]
    {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            return format!(
                "symlink failed: {e}. On Windows, enable Developer Mode or run as Administrator."
            );
        }
    }

    format!("symlink failed: {e}")
}
