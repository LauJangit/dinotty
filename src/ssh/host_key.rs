use base64::Engine;
use std::path::PathBuf;
use tracing::info;

/// Host key 验证错误
#[derive(Debug)]
pub enum HostKeyError {
    /// 首次连接，host key 未知
    UnknownHost { host: String, port: u16, fingerprint: String },
    /// host key 与已知的不匹配（可能被篡改）
    KeyMismatch { host: String, stored_fingerprint: String, received_fingerprint: String },
}

/// `known_hosts` 文件中的条目
struct KnownHostEntry {
    host: String,
    port: u16,
    _key_type: String,
    key_data: String,
}

/// Host key 验证器
pub struct HostKeyVerifier {
    known_hosts_path: PathBuf,
    #[cfg(test)]
    _temp_dir: Option<tempfile::TempDir>,
}

impl Default for HostKeyVerifier {
    fn default() -> Self {
        Self::new()
    }
}

impl HostKeyVerifier {
    #[must_use]
    pub fn new() -> Self {
        let config_dir = crate::settings::config_dir();
        std::fs::create_dir_all(&config_dir).ok();
        Self {
            known_hosts_path: config_dir.join("known_hosts"),
            #[cfg(test)]
            _temp_dir: None,
        }
    }

    #[cfg(test)]
    pub fn new_temp() -> Self {
        let dir = tempfile::tempdir().unwrap();
        Self { known_hosts_path: dir.path().join("known_hosts"), _temp_dir: Some(dir) }
    }

    /// 验证 host key
    ///
    /// # Errors
    /// Returns `HostKeyError` if the key is unknown or mismatched.
    pub fn verify(
        &self,
        host: &str,
        port: u16,
        key_bytes: &[u8],
        _key_type: &str,
    ) -> Result<(), HostKeyError> {
        let entries = self.load_known_hosts();

        // 查找匹配的 host:port
        if let Some(entry) =
            entries.iter().find(|e| e.host == host && (e.port == port || e.port == 22))
        {
            if entry.key_data == base64_encode(key_bytes) {
                return Ok(());
            }
            return Err(HostKeyError::KeyMismatch {
                host: host.to_string(),
                stored_fingerprint: format!("SHA256:{}", sha256_fingerprint(&entry.key_data)),
                received_fingerprint: format!(
                    "SHA256:{}",
                    sha256_fingerprint_from_bytes(key_bytes)
                ),
            });
        }

        // 首次连接
        Err(HostKeyError::UnknownHost {
            host: host.to_string(),
            port,
            fingerprint: format!("SHA256:{}", sha256_fingerprint_from_bytes(key_bytes)),
        })
    }

    /// 接受并保存 host key
    ///
    /// # Errors
    /// Returns an error if the file I/O fails.
    pub fn accept_and_save(
        &self,
        host: &str,
        port: u16,
        key_bytes: &[u8],
        key_type: &str,
    ) -> Result<(), std::io::Error> {
        let entry = format_host_entry(host, port, key_bytes, key_type);

        let mut content = if self.known_hosts_path.exists() {
            std::fs::read_to_string(&self.known_hosts_path)?
        } else {
            String::new()
        };

        // 移除旧条目（如果有）
        let old_entry_prefix = format_host_prefix(host, port);
        content = content
            .lines()
            .filter(|line| !line.starts_with(&old_entry_prefix))
            .collect::<Vec<_>>()
            .join("\n");

        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&entry);
        content.push('\n');

        std::fs::write(&self.known_hosts_path, content)?;

        crate::platform::fs::set_private_file_permissions(&self.known_hosts_path)?;

        info!("Saved host key for {}:{}", host, port);
        Ok(())
    }

    fn load_known_hosts(&self) -> Vec<KnownHostEntry> {
        let Ok(content) = std::fs::read_to_string(&self.known_hosts_path) else {
            return Vec::new();
        };

        content
            .lines()
            .filter_map(|line| {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    return None;
                }
                let parts: Vec<&str> = line.splitn(3, ' ').collect();
                if parts.len() < 3 {
                    return None;
                }
                let (host, port) = parse_host_port(parts[0]);
                Some(KnownHostEntry {
                    host,
                    port,
                    _key_type: parts[1].to_string(),
                    key_data: parts[2].to_string(),
                })
            })
            .collect()
    }
}

fn parse_host_port(host_field: &str) -> (String, u16) {
    if let Some(bracket_start) = host_field.find('[') {
        if let Some(bracket_end) = host_field.find(']') {
            let host = &host_field[bracket_start + 1..bracket_end];
            let port_str = &host_field[bracket_end + 1..];
            let port = port_str.trim_start_matches(':').parse::<u16>().unwrap_or(22);
            return (host.to_string(), port);
        }
    }
    (host_field.to_string(), 22)
}

fn format_host_prefix(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

fn format_host_entry(host: &str, port: u16, key_bytes: &[u8], key_type: &str) -> String {
    let host_field = format_host_prefix(host, port);
    let key_data = base64_encode(key_bytes);
    format!("{host_field} {key_type} {key_data}")
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn sha256_fingerprint(key_data: &str) -> String {
    use base64::Engine;
    use sha2::Digest;
    let decoded = base64::engine::general_purpose::STANDARD.decode(key_data).unwrap_or_default();
    let hash = sha2::Sha256::digest(&decoded);
    base64::engine::general_purpose::STANDARD.encode(hash)
}

fn sha256_fingerprint_from_bytes(key_bytes: &[u8]) -> String {
    use sha2::Digest;
    let hash = sha2::Sha256::digest(key_bytes);
    base64::engine::general_purpose::STANDARD.encode(hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_host_key_verifier_unknown_host() {
        let verifier = HostKeyVerifier::new_temp();
        let key_bytes = b"test-key-data";
        assert!(matches!(
            verifier.verify("unknown.host", 22, key_bytes, "ssh-rsa"),
            Err(HostKeyError::UnknownHost { .. })
        ));
    }

    #[test]
    fn test_host_key_verifier_mismatch() {
        let verifier = HostKeyVerifier::new_temp();
        let key1 = b"key-data-1";
        let key2 = b"key-data-2";
        verifier.accept_and_save("host", 22, key1, "ssh-rsa").unwrap();
        assert!(matches!(
            verifier.verify("host", 22, key2, "ssh-rsa"),
            Err(HostKeyError::KeyMismatch { .. })
        ));
    }

    #[test]
    fn test_host_key_verifier_match() {
        let verifier = HostKeyVerifier::new_temp();
        let key = b"test-key-data";
        verifier.accept_and_save("host", 22, key, "ssh-rsa").unwrap();
        assert!(verifier.verify("host", 22, key, "ssh-rsa").is_ok());
    }

    #[test]
    fn test_host_key_custom_port() {
        let verifier = HostKeyVerifier::new_temp();
        let key = b"test-key-data";
        verifier.accept_and_save("host", 2222, key, "ssh-rsa").unwrap();
        assert!(verifier.verify("host", 2222, key, "ssh-rsa").is_ok());
    }
}
