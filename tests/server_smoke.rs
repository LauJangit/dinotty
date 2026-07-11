#[cfg(windows)]
mod windows_smoke {
    use reqwest::blocking::Client;
    use serde_json::Value;
    use std::error::Error;
    use std::fs;
    use std::io;
    use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};
    use tempfile::TempDir;

    type TestResult<T = ()> = Result<T, Box<dyn Error>>;

    struct ChildGuard(Child);

    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    fn test_error(message: impl Into<String>) -> Box<dyn Error> {
        io::Error::other(message.into()).into()
    }

    fn free_loopback_port() -> TestResult<u16> {
        let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))?;
        Ok(listener.local_addr()?.port())
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    fn create_dir(path: &Path) -> TestResult {
        fs::create_dir_all(path)
            .map_err(|err| test_error(format!("create {}: {err}", path.display())))
    }

    #[test]
    fn server_starts_and_serves_core_routes() -> TestResult {
        let server = env!("CARGO_BIN_EXE_dinotty-server");
        let port = free_loopback_port()?;
        let tmp = tempfile::Builder::new().prefix("dinotty-smoke-").tempdir()?;

        let appdata = tmp.path().join("AppData").join("Roaming");
        let localappdata = tmp.path().join("AppData").join("Local");
        let userprofile = tmp.path().join("User");
        create_dir(&appdata)?;
        create_dir(&localappdata)?;
        create_dir(&userprofile)?;

        let mut child =
            spawn_server(server, port, &repo_root(), &tmp, &appdata, &localappdata, &userprofile)?;

        let client = Client::builder().timeout(Duration::from_secs(2)).build()?;
        let base = format!("http://127.0.0.1:{port}");
        wait_until_ready(&client, &base, port, &mut child, tmp.path())?;

        let index = client.get(format!("{base}/")).send()?.error_for_status()?.text()?;
        assert!(index.contains("id=\"app\""), "index body should contain Vue app mount");

        let settings: Value = client
            .get(format!("{base}/api/settings"))
            .bearer_auth("smoke-token")
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)?
            .json()?;
        assert!(settings.get("theme").is_some(), "settings response should include theme");
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn_server(
        server: &str,
        port: u16,
        cwd: &Path,
        tmp: &TempDir,
        appdata: &Path,
        localappdata: &Path,
        userprofile: &Path,
    ) -> TestResult<ChildGuard> {
        let stdout = fs::File::create(tmp.path().join("server.out.log"))?;
        let stderr = fs::File::create(tmp.path().join("server.err.log"))?;

        let mut cmd = Command::new(server);
        cmd.args(["--port", &port.to_string()])
            .current_dir(cwd)
            .env("APPDATA", appdata)
            .env("LOCALAPPDATA", localappdata)
            .env("USERPROFILE", userprofile)
            .env("DINOTTY_TOKEN", "smoke-token")
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }

        Ok(ChildGuard(cmd.spawn()?))
    }

    fn wait_until_ready(
        client: &Client,
        base: &str,
        port: u16,
        child: &mut ChildGuard,
        log_dir: &Path,
    ) -> TestResult {
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut last_error = String::new();

        while Instant::now() < deadline {
            if let Some(status) = child.0.try_wait()? {
                return Err(test_error(format!(
                    "server exited early with {status}; stderr:\n{}",
                    read_log(log_dir, "server.err.log")
                )));
            }

            match client.get(format!("{base}/api/info")).bearer_auth("smoke-token").send() {
                Ok(resp) => match resp.error_for_status() {
                    Ok(resp) => match resp.json::<Value>() {
                        Ok(info) => {
                            let actual = info.get("port").and_then(Value::as_u64);
                            if actual == Some(u64::from(port)) {
                                return Ok(());
                            }
                            return Err(test_error(format!(
                                "unexpected /api/info port: {actual:?}"
                            )));
                        }
                        Err(err) => last_error = err.to_string(),
                    },
                    Err(err) => last_error = err.to_string(),
                },
                Err(err) => last_error = err.to_string(),
            }

            std::thread::sleep(Duration::from_millis(500));
        }

        Err(test_error(format!(
            "server did not become ready: {last_error}; stderr:\n{}",
            read_log(log_dir, "server.err.log")
        )))
    }

    fn read_log(dir: &Path, name: &str) -> String {
        fs::read_to_string(dir.join(name)).unwrap_or_else(|_| "<missing log>".to_string())
    }
}
