use std::path::Path;

/// Creates a directory symlink from `link` to `src`.
///
/// # Errors
///
/// Returns an error if the platform cannot create the symlink or the OS denies
/// the operation.
pub fn create_dir_symlink(src: &Path, link: &Path) -> Result<(), String> {
    create_dir_symlink_impl(src, link).map_err(|e| format_symlink_error(&e))
}

/// Returns true when the path exists or is a symlink, including a broken one.
#[must_use]
pub fn path_exists_or_symlink(path: &Path) -> bool {
    path.exists() || std::fs::symlink_metadata(path).is_ok()
}

/// Removes a symlink or plain file while refusing to remove real directories.
///
/// # Errors
///
/// Returns an error if metadata lookup or removal fails, or if `path` is a real
/// directory.
pub fn remove_symlink_or_file(path: &Path) -> Result<(), String> {
    remove_symlink_or_file_impl(path).map_err(|e| format!("remove symlink failed: {e}"))
}

/// Marks a file executable on platforms that support executable bits.
///
/// # Errors
///
/// Returns an error if permissions cannot be read or updated.
pub fn set_executable(path: &Path) -> Result<(), String> {
    set_executable_impl(path).map_err(|e| e.to_string())
}

/// Validates private key file permissions.
///
/// # Errors
///
/// Returns an error when file metadata cannot be read or permissions are too
/// open on platforms that enforce private key modes.
pub fn validate_private_key_permissions(path: &Path) -> Result<(), String> {
    validate_private_key_permissions_impl(path)
}

/// Applies private-file permissions to a path.
///
/// # Errors
///
/// Returns an error if the platform fails to update the file permissions.
#[cfg(unix)]
pub fn set_private_file_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

/// Applies private-file permissions to a path.
///
/// # Errors
///
/// This no-op implementation currently does not fail on non-Unix platforms.
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
#[allow(clippy::unnecessary_wraps)]
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
#[allow(clippy::unnecessary_wraps)]
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

#[cfg(test)]
mod tests {
    use super::{path_exists_or_symlink, remove_symlink_or_file, validate_private_key_permissions};
    use std::io::ErrorKind;
    use std::path::Path;

    #[cfg(unix)]
    fn symlink_file(src: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(src, link)
    }

    #[cfg(windows)]
    fn symlink_file(src: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_file(src, link)
    }

    #[cfg(unix)]
    fn symlink_dir(src: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(src, link)
    }

    #[cfg(windows)]
    fn symlink_dir(src: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_dir(src, link)
    }

    fn skip_if_symlink_permission_denied(result: std::io::Result<()>) -> bool {
        match result {
            Ok(()) => false,
            Err(e) if cfg!(windows) && e.kind() == ErrorKind::PermissionDenied => true,
            Err(e) => panic!("failed to create symlink for test: {e}"),
        }
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn path_exists_or_symlink_reports_broken_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("missing-target");
        let link = tmp.path().join("broken-link");
        if skip_if_symlink_permission_denied(symlink_file(&target, &link)) {
            return;
        }

        assert!(!target.exists());
        assert!(path_exists_or_symlink(&link));
    }

    #[test]
    fn remove_symlink_or_file_removes_plain_file() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("plain.txt");
        std::fs::write(&file, "content").unwrap();

        remove_symlink_or_file(&file).unwrap();

        assert!(!path_exists_or_symlink(&file));
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn remove_symlink_or_file_removes_file_symlink_only() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("target.txt");
        let link = tmp.path().join("link.txt");
        std::fs::write(&target, "content").unwrap();
        if skip_if_symlink_permission_denied(symlink_file(&target, &link)) {
            return;
        }

        remove_symlink_or_file(&link).unwrap();

        assert!(!path_exists_or_symlink(&link));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "content");
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn remove_symlink_or_file_removes_directory_symlink_only() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("target-dir");
        let link = tmp.path().join("dir-link");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("child.txt"), "content").unwrap();
        if skip_if_symlink_permission_denied(symlink_dir(&target, &link)) {
            return;
        }

        remove_symlink_or_file(&link).unwrap();

        assert!(!path_exists_or_symlink(&link));
        assert_eq!(std::fs::read_to_string(target.join("child.txt")).unwrap(), "content");
    }

    #[test]
    fn remove_symlink_or_file_rejects_real_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("real-dir");
        std::fs::create_dir(&dir).unwrap();

        let err = remove_symlink_or_file(&dir).unwrap_err();

        assert!(err.contains("refusing to remove a real directory"));
        assert!(dir.is_dir());
    }

    #[cfg(windows)]
    #[test]
    fn symlink_permission_denied_error_mentions_developer_mode_or_admin() {
        let err = std::io::Error::new(ErrorKind::PermissionDenied, "denied");
        let message = super::format_symlink_error(&err);

        assert!(message.contains("Developer Mode"));
        assert!(message.contains("Administrator"));
    }

    #[cfg(not(unix))]
    #[test]
    fn private_key_permissions_are_noop_on_non_unix() {
        assert!(validate_private_key_permissions(Path::new("missing-key")).is_ok());
    }
}
