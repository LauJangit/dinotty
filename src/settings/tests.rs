use super::*;

#[test]
fn old_config_missing_confirm_before_close_tab_defaults_to_true() {
    let old_config = r"{}";
    let settings: Settings = serde_json::from_str(old_config)
        .expect("old config without confirm_before_close_tab should still parse");
    assert!(
        settings.confirm_before_close_tab,
        "missing field should default to true for backward compatibility"
    );
}

#[test]
fn settings_defaults_locale_to_zh() {
    let settings: Settings = serde_json::from_str(r"{}").unwrap();
    assert_eq!(settings.locale, "zh");
}

#[test]
fn settings_empty_json_is_valid() {
    let settings: Settings = serde_json::from_str(r"{}").unwrap();
    assert_eq!(settings.settings_version, 0);
    assert!(!settings.keyboard_sound);
    assert!(!settings.show_virtual_keyboard);
    assert!(!settings.windows_alt_as_cmd);
    assert!(settings.confirm_before_close_tab);
    assert!(settings.bookmarks.is_empty());
    if cfg!(feature = "server") {
        assert!(settings.ip_whitelist.is_empty());
    } else {
        assert_eq!(settings.ip_whitelist, vec!["127.0.0.1", "::1"]);
    }
    assert_eq!(settings.upload_dir, default_upload_dir());
}

// 验证后端能反序列化前端使用的 windowsAltAsCmd camelCase 字段。
#[test]
fn settings_deserializes_windows_alt_as_cmd_camel_case() {
    let settings: Settings = serde_json::from_str(r#"{"windowsAltAsCmd": true}"#).unwrap();

    assert!(settings.windows_alt_as_cmd);
}

// 验证后端序列化仍输出 windowsAltAsCmd，避免生成 snake_case 配置。
#[test]
fn settings_serializes_windows_alt_as_cmd_camel_case() {
    let mut settings: Settings = serde_json::from_str(r#"{}"#).unwrap();
    settings.windows_alt_as_cmd = true;

    let serialized = serde_json::to_string(&settings).unwrap();

    assert!(serialized.contains(r#""windowsAltAsCmd":true"#));
    assert!(!serialized.contains("windows_alt_as_cmd"));
}

#[test]
fn settings_with_custom_values() {
    let json = r#"{
        "theme": {"name": "dracula"},
        "locale": "en",
        "keyboard_sound": true,
        "confirm_before_close_tab": false
    }"#;
    let settings: Settings = serde_json::from_str(json).unwrap();
    assert_eq!(settings.locale, "en");
    assert!(settings.keyboard_sound);
    assert!(!settings.confirm_before_close_tab);
}

#[test]
fn settings_auth_token_is_skipped_in_serde() {
    let json = r#"{"auth_token": "should_be_ignored"}"#;
    let settings: Settings = serde_json::from_str(json).unwrap();
    assert!(settings.auth_token.is_empty());

    let mut settings2: Settings = serde_json::from_str(r"{}").unwrap();
    settings2.auth_token = "my_token".to_string();
    let serialized = serde_json::to_string(&settings2).unwrap();
    assert!(!serialized.contains("my_token"));
}

#[test]
fn settings_monitor_defaults() {
    let settings: Settings = serde_json::from_str(r"{}").unwrap();
    assert!(settings.monitor.enabled);
    assert!(settings.monitor.cpu);
}

#[test]
fn settings_notification_defaults() {
    let settings: Settings = serde_json::from_str(r"{}").unwrap();
    assert!(settings.notification.enabled);
}

#[test]
fn old_settings_migrate_legacy_upload_dir_once() {
    let mut settings = Settings {
        settings_version: 0,
        upload_dir: "~/.dinotty/uploads".into(),
        ..Settings::default()
    };

    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert_eq!(settings.upload_dir, default_upload_dir());
}

#[test]
fn old_settings_migrate_resolved_temp_upload_dir_once() {
    let mut settings = Settings {
        settings_version: 1,
        upload_dir: std::env::temp_dir().join("dinotty").to_string_lossy().into_owned(),
        ..Settings::default()
    };

    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert_eq!(settings.upload_dir, default_upload_dir());
}

#[test]
fn current_settings_keep_explicit_legacy_upload_dir() {
    let mut settings = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        upload_dir: "~/.dinotty/uploads".into(),
        ..Settings::default()
    };

    assert!(!migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert_eq!(settings.upload_dir, "~/.dinotty/uploads");
}
