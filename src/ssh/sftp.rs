use crate::session::Session;
use crate::ssh::SshClientHandler;
use russh::client;
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use tracing::info;

/// Open a new SFTP session on the given SSH connection.
/// This creates a separate channel from the terminal I/O channel.
async fn open_sftp_session(
    handle: &client::Handle<SshClientHandler>,
) -> Result<SftpSession, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SFTP channel: {e}"))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("Failed to request SFTP subsystem: {e}"))?;
    SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("Failed to init SFTP session: {e}"))
}

/// Get or create a cached SFTP session for the given SSH session.
/// The SFTP session uses a separate channel from the terminal I/O.
///
/// # Errors
/// Returns an error if the SSH handle is unavailable or SFTP initialization fails.
pub async fn get_or_create_sftp(session: &Session) -> Result<Arc<SftpSession>, String> {
    // Check cache first
    {
        let cache = session.sftp_session.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(ref boxed) = *cache {
            if let Some(sftp) = boxed.downcast_ref::<Arc<SftpSession>>() {
                return Ok(Arc::clone(sftp));
            }
        }
    }

    // Create new SFTP session from the stored SSH handle.
    // tokio::sync::Mutex guard can be held across .await.
    let guard = session.ssh_handle.lock().await;
    let boxed = guard.as_ref().ok_or("No SSH handle available")?;
    let handle = boxed
        .downcast_ref::<client::Handle<SshClientHandler>>()
        .ok_or("SSH handle type mismatch")?;
    let sftp = open_sftp_session(handle).await?;
    drop(guard);
    let sftp = Arc::new(sftp);

    // Cache it
    *session.sftp_session.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some(Box::new(Arc::clone(&sftp)));

    info!("SFTP session created and cached");
    Ok(sftp)
}

/// Clear the cached SFTP session (e.g. on connection error).
pub fn clear_sftp_cache(session: &Session) {
    *session.sftp_session.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
}

/// Execute a command on the remote server via SSH exec channel.
/// Returns `(exit_code, stdout, stderr)`.
///
/// # Errors
/// Returns an error if the SSH handle is unavailable or the exec channel fails.
pub async fn ssh_exec(
    session: &Session,
    command: &str,
    cwd: &str,
) -> Result<(i32, String, String), String> {
    // tokio::sync::Mutex guard can be held across .await.
    let guard = session.ssh_handle.lock().await;
    let boxed = guard.as_ref().ok_or("No SSH handle available")?;
    let handle = boxed
        .downcast_ref::<client::Handle<SshClientHandler>>()
        .ok_or("SSH handle type mismatch")?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open exec channel: {e}"))?;

    let full_cmd = format!("cd {} && {}", shell_escape(cwd), command);
    channel.exec(true, full_cmd.as_bytes()).await.map_err(|e| format!("Failed to exec: {e}"))?;

    // Release the handle lock — the channel is independent now.
    drop(guard);

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code = None;

    loop {
        match channel.wait().await {
            Some(russh::ChannelMsg::Data { data }) => stdout.extend_from_slice(&data),
            Some(russh::ChannelMsg::ExtendedData { data, .. }) => stderr.extend_from_slice(&data),
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status),
            Some(russh::ChannelMsg::Eof | russh::ChannelMsg::Close) | None => break,
            _ => {}
        }
    }

    Ok((
        exit_code.map_or(-1, |c| i32::try_from(c).unwrap_or(-1)),
        String::from_utf8_lossy(&stdout).into_owned(),
        String::from_utf8_lossy(&stderr).into_owned(),
    ))
}

/// Simple shell escaping — wraps in single quotes, escapes embedded single quotes.
fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
