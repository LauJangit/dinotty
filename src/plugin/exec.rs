#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use dashmap::DashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex as TokioMutex;

use crate::{platform::process::CommandNoWindowExt, session::SessionManager};

use super::helpers::plugin_err;
use super::manager::PluginManagerState;
use super::types::{
    ExecRequest, ExecResult, ManagedProcess, ProcessInfo, ProcessStartRequest, ProcessState,
    SpawnQuery,
};

pub async fn plugin_exec(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
    Json(body): Json<ExecRequest>,
) -> Response {
    let Some(info) = pm.registry.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    };
    let bin = match &info.manifest.bin {
        Some(b) if b.mode == "cli" => b,
        _ => return plugin_err(StatusCode::BAD_REQUEST, "plugin has no CLI bin"),
    };

    let bin_path = pm.plugin_dir.join(&id).join(&bin.entry);
    let mut cmd = Command::new(&bin_path);
    cmd.no_window();
    cmd.args(&body.args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    if let Some(ref cwd) = body.cwd {
        cmd.current_dir(cwd);
    }
    for key in crate::pty::claude_session_env_keys_to_strip() {
        cmd.env_remove(key);
    }
    if let Some(ref env) = body.env {
        cmd.envs(env);
    }

    let timeout_ms = body.timeout.unwrap_or(30_000);
    let timeout_dur = std::time::Duration::from_millis(timeout_ms);

    match tokio::time::timeout(timeout_dur, cmd.output()).await {
        Ok(Ok(output)) => Json(ExecResult {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
        .into_response(),
        Ok(Err(e)) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        Err(_) => Json(ExecResult {
            code: -1,
            stdout: String::new(),
            stderr: format!("timeout after {timeout_ms}ms"),
        })
        .into_response(),
    }
}

/// # Panics
/// Panics if the child process stdout cannot be captured.
#[allow(clippy::unused_async)]
pub async fn plugin_spawn_ws(
    Path(id): Path<String>,
    Query(params): Query<SpawnQuery>,
    State(pm): State<PluginManagerState>,
    State(settings): State<crate::settings::SettingsState>,
    ws: axum::extract::WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
) -> Response {
    let s = settings.read().await;
    let allowed_origins = s.auth.allowed_origins.clone();
    let trusted_proxies = s.auth.trusted_proxies.clone();
    drop(s);
    let real_ip = crate::auth::real_client_ip(&headers, addr.ip(), &trusted_proxies);
    if !crate::auth::check_ws_origin(&headers, &allowed_origins, real_ip, &trusted_proxies) {
        return plugin_err(StatusCode::FORBIDDEN, "origin not allowed");
    }
    let Some(info) = pm.registry.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    };
    let bin = match &info.manifest.bin {
        Some(b) if b.mode == "cli" => b.clone(),
        _ => return plugin_err(StatusCode::BAD_REQUEST, "plugin has no CLI bin"),
    };
    let plugin_dir = pm.plugin_dir.join(&id);

    let args: Vec<String> = match serde_json::from_str(&params.args) {
        Ok(a) => a,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid args: {e}")),
    };

    ws.on_upgrade(move |mut socket| async move {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let bin_path = plugin_dir.join(&bin.entry);
        let mut cmd = Command::new(&bin_path);
        for key in crate::pty::claude_session_env_keys_to_strip() {
            cmd.env_remove(key);
        }
        cmd.no_window().args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = socket
                    .send(axum::extract::ws::Message::Text(
                        serde_json::json!({"type": "stderr", "data": e.to_string()}).to_string(),
                    ))
                    .await;
                let _ = socket
                    .send(axum::extract::ws::Message::Text(
                        serde_json::json!({"type": "done"}).to_string(),
                    ))
                    .await;
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        let tx2 = tx.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stdout_reader.next_line().await {
                if tx2
                    .send(serde_json::json!({"type": "stdout", "data": line + "\n"}).to_string())
                    .is_err()
                {
                    break;
                }
            }
        });

        tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                if tx
                    .send(serde_json::json!({"type": "stderr", "data": line + "\n"}).to_string())
                    .is_err()
                {
                    break;
                }
            }
        });

        loop {
            tokio::select! {
                Some(msg) = rx.recv() => {
                    if socket.send(axum::extract::ws::Message::Text(msg)).await.is_err() {
                        let _ = child.kill().await;
                        break;
                    }
                }
                msg = socket.recv() => {
                    if msg.is_none() {
                        let _ = child.kill().await;
                        break;
                    }
                }
                status = child.wait() => {
                    let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
                    let _ = socket
                        .send(axum::extract::ws::Message::Text(
                            serde_json::json!({"type": "done", "code": code}).to_string(),
                        ))
                        .await;
                    break;
                }
            }
        }
    })
}

#[allow(clippy::unused_async)]
pub async fn plugin_process_start(
    Path(id): Path<String>,
    State((pm, manager)): State<(PluginManagerState, Arc<SessionManager>)>,
    Json(body): Json<ProcessStartRequest>,
) -> Response {
    let Some(info) = pm.registry.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    };
    let bin = match &info.manifest.bin {
        Some(b) if b.mode == "cli" => b,
        _ => return plugin_err(StatusCode::BAD_REQUEST, "plugin has no CLI bin"),
    };

    let bin_path = pm.plugin_dir.join(&id).join(&bin.entry);
    let mut cmd = Command::new(&bin_path);
    for key in crate::pty::claude_session_env_keys_to_strip() {
        cmd.env_remove(key);
    }
    cmd.no_window();
    cmd.args(&body.args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    if let Some(ref cwd) = body.cwd {
        cmd.current_dir(cwd);
    }
    if let Some(ref env) = body.env {
        cmd.envs(env);
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let Some(pid) = child.id() else {
        return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, "failed to get process id");
    };
    let proc_id = pid.to_string();
    let child_arc = Arc::new(TokioMutex::new(Some(child)));

    let managed_proc = ManagedProcess {
        info: ProcessInfo {
            pid,
            command: bin_path.to_string_lossy().into_owned(),
            args: body.args.clone(),
            state: ProcessState::Running,
            exit_code: None,
        },
        child: child_arc.clone(),
    };

    pm.processes
        .entry(id.clone())
        .or_insert_with(DashMap::new)
        .insert(proc_id.clone(), managed_proc);

    let pm_clone = Arc::clone(&pm);
    let manager_clone = Arc::clone(&manager);
    let plugin_id = id.clone();
    tokio::spawn(async move {
        let exit_code = {
            let mut child_guard = child_arc.lock().await;
            if let Some(ref mut c) = *child_guard {
                c.wait().await.ok().and_then(|s| s.code())
            } else {
                None
            }
        };

        if let Some(proc_map) = pm_clone.processes.get(&plugin_id) {
            if let Some(mut entry) = proc_map.get_mut(&proc_id) {
                entry.info.state = ProcessState::Exited;
                entry.info.exit_code = exit_code;
            }
        }

        manager_clone.broadcast_sync(&crate::session::SyncMsg::ProcessExited {
            plugin_id,
            pid,
            exit_code,
        });
    });

    Json(serde_json::json!({
        "pid": pid,
        "command": bin_path.to_string_lossy(),
        "args": body.args,
        "state": "running"
    }))
    .into_response()
}

#[allow(clippy::unused_async)]
pub async fn plugin_process_list(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
) -> Response {
    let Some(proc_map) = pm.processes.get(&id) else {
        return Json(serde_json::json!([])).into_response();
    };
    let list: Vec<ProcessInfo> = proc_map.iter().map(|e| e.value().info.clone()).collect();
    Json(list).into_response()
}

pub async fn plugin_process_stop(
    Path((id, pid_str)): Path<(String, String)>,
    State(pm): State<PluginManagerState>,
) -> Response {
    let Some(proc_map) = pm.processes.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "no processes for plugin");
    };
    let Some(entry) = proc_map.get_mut(&pid_str) else {
        return plugin_err(StatusCode::NOT_FOUND, "process not found");
    };
    let mut child = entry.child.lock().await;
    if let Some(ref mut c) = *child {
        let _ = c.kill().await;
    }
    StatusCode::NO_CONTENT.into_response()
}

pub async fn plugin_process_stop_all(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
) -> Response {
    pm.kill_plugin_processes(&id).await;
    StatusCode::NO_CONTENT.into_response()
}
