pub mod agent;
pub mod audit;
pub mod auth;
pub mod event_bus;
pub mod file_watcher;
pub mod history;
pub mod mcp;
pub mod monitor;
pub mod notification;
pub mod openapi;
pub mod platform;
pub mod plugin;
pub mod proxy;
pub mod pty;
pub mod qr_code;
pub mod session;
pub mod settings;
pub mod ssh;
pub mod tabs;
pub mod token;
pub mod util;
pub mod vt_screen;
pub mod webhook;
pub mod workspace;
pub mod workspace_mgmt;
pub mod ws;

#[cfg(test)]
pub(crate) mod test_support {
    use std::ffi::OsString;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    pub(crate) struct EnvGuard {
        _lock: MutexGuard<'static, ()>,
        saved: Vec<(String, Option<OsString>)>,
    }

    impl EnvGuard {
        pub(crate) fn new(keys: &[&str]) -> Self {
            let lock = ENV_LOCK
                .get_or_init(|| Mutex::new(()))
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let saved =
                keys.iter().map(|key| ((*key).to_string(), std::env::var_os(key))).collect();
            Self { _lock: lock, saved }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, value) in &self.saved {
                if let Some(value) = value {
                    std::env::set_var(key, value);
                } else {
                    std::env::remove_var(key);
                }
            }
        }
    }
}
