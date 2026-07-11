use axum::{response::IntoResponse, Json};
use serde::{Deserialize, Serialize};

const MAX_SYNTAX_CHECK_SIZE: usize = 512 * 1024;

#[derive(Deserialize)]
pub struct SyntaxCheckBody {
    #[serde(default)]
    pub file_path: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct SyntaxDiagnostic {
    pub severity: &'static str,
    pub message: String,
    pub start_line: usize,
    pub start_col: usize,
    pub end_line: usize,
    pub end_col: usize,
}

#[derive(Serialize)]
pub struct SyntaxCheckResponse {
    pub diagnostics: Vec<SyntaxDiagnostic>,
}

fn check_rust_syntax(content: &str) -> Vec<SyntaxDiagnostic> {
    match syn::parse_file(content) {
        Ok(_) => vec![],
        Err(e) => {
            let start = e.span().start();
            let end = e.span().end();
            vec![SyntaxDiagnostic {
                severity: "error",
                message: e.to_string(),
                start_line: start.line,
                start_col: start.column + 1,
                end_line: end.line,
                end_col: end.column + 1,
            }]
        }
    }
}

fn parse_python_diagnostics(stderr: &str, content: &str) -> Vec<SyntaxDiagnostic> {
    let mut diags = Vec::new();
    let mut lines = stderr.lines().peekable();
    while let Some(line) = lines.next() {
        if let Some(rest) = line.strip_prefix("  File \"<stdin>\", line ") {
            let line_num: usize = match rest.split(',').next().and_then(|s| s.trim().parse().ok()) {
                Some(n) => n,
                None => continue,
            };
            let mut msg = String::new();
            while let Some(next) = lines.peek() {
                if next.starts_with(' ') || next.starts_with('^') {
                    lines.next();
                } else {
                    break;
                }
            }
            if let Some(err_line) = lines.peek() {
                msg = err_line.to_string();
                lines.next();
            }
            if msg.is_empty() {
                msg = "syntax error".to_string();
            }
            let last_col =
                content.lines().nth(line_num.saturating_sub(1)).map_or(1, |l| l.len().max(1));
            diags.push(SyntaxDiagnostic {
                severity: "error",
                message: msg,
                start_line: line_num,
                start_col: 1,
                end_line: line_num,
                end_col: last_col + 1,
            });
        }
    }
    diags
}

fn check_python_syntax(content: &str) -> Vec<SyntaxDiagnostic> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let Ok(mut child) = Command::new("python3")
        .arg("-m")
        .arg("py_compile")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
    else {
        return vec![];
    };
    if let Some(ref mut stdin) = child.stdin {
        let _ = stdin.write_all(content.as_bytes());
    }
    drop(child.stdin.take());
    let Ok(output) = child.wait_with_output() else { return vec![] };
    if output.status.success() {
        return vec![];
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_python_diagnostics(&stderr, content)
}

fn parse_go_diagnostics(stderr: &str, content: &str) -> Vec<SyntaxDiagnostic> {
    let mut diags = Vec::new();
    for line in stderr.lines() {
        let rest = match line.find(".go:") {
            Some(pos) => &line[pos..],
            None => continue,
        };
        let parts: Vec<&str> = rest.splitn(4, ':').collect();
        if parts.len() < 4 {
            continue;
        }
        let line_num: usize = match parts[1].parse().ok() {
            Some(n) => n,
            None => continue,
        };
        let col_num: usize = parts[2].trim().parse().unwrap_or(1);
        let msg = parts[3].trim().to_string();
        let end_col = content
            .lines()
            .nth(line_num.saturating_sub(1))
            .map_or(col_num + 1, |l| l.len().max(col_num).max(col_num + 1));
        diags.push(SyntaxDiagnostic {
            severity: "error",
            message: msg,
            start_line: line_num,
            start_col: col_num,
            end_line: line_num,
            end_col,
        });
    }
    diags
}

fn check_go_syntax(content: &str) -> Vec<SyntaxDiagnostic> {
    use std::process::{Command, Stdio};
    let Ok(tmp) = tempfile::Builder::new().suffix(".go").tempfile() else { return vec![] };
    if std::fs::write(tmp.path(), content.as_bytes()).is_err() {
        return vec![];
    }
    let Ok(output) = Command::new("go")
        .args(["tool", "compile", "-e", "-p", "main"])
        .arg(tmp.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(std::process::Child::wait_with_output)
    else {
        return vec![];
    };
    if output.status.success() {
        return vec![];
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_go_diagnostics(&stderr, content)
}

pub async fn workspace_syntax_check(Json(body): Json<SyntaxCheckBody>) -> impl IntoResponse {
    if body.content.len() > MAX_SYNTAX_CHECK_SIZE {
        return Json(SyntaxCheckResponse { diagnostics: vec![] }).into_response();
    }
    let ext = std::path::Path::new(&body.file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let diagnostics = tokio::task::spawn_blocking(move || match ext.as_str() {
        "rs" => check_rust_syntax(&body.content),
        "py" => check_python_syntax(&body.content),
        "go" => check_go_syntax(&body.content),
        _ => vec![],
    })
    .await
    .unwrap_or_default();
    Json(SyntaxCheckResponse { diagnostics }).into_response()
}
