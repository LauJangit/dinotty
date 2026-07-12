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

#[test]
fn legacy_text_config_without_custom_fonts_deserializes_to_none() {
    let settings: Settings = serde_json::from_str(r#"{"text":{"font_family":"Monaco"}}"#).unwrap();
    assert_eq!(settings.text.custom_fonts, None);
}

#[test]
fn clamp_text_on_load_leaves_missing_custom_fonts_none() {
    let mut text = TextConfig::default();

    assert!(!clamp_text_on_load(&mut text));
    assert_eq!(text.custom_fonts, None);
}

#[test]
fn clamp_text_on_load_keeps_existing_custom_fonts_unchanged() {
    let mut text =
        TextConfig { custom_fonts: Some(vec!["Monaco".into()]), ..TextConfig::default() };

    assert!(!clamp_text_on_load(&mut text));
    assert_eq!(text.custom_fonts, Some(vec!["Monaco".into()]));
}

#[test]
fn clamp_text_on_load_keeps_empty_custom_fonts() {
    let mut text = TextConfig { custom_fonts: Some(Vec::new()), ..TextConfig::default() };

    assert!(!clamp_text_on_load(&mut text));
    assert_eq!(text.custom_fonts, Some(Vec::new()));
}

#[test]
fn clamp_custom_fonts_sanitizes_and_preserves_first_occurrence_order() {
    let too_long = "x".repeat(101);
    let mut fonts = vec![
        "  Fira Code  ".into(),
        "".into(),
        "   ".into(),
        too_long,
        "Bad\"Font".into(),
        "Bad\\Font".into(),
        "Bad\nFont".into(),
        "fira code".into(),
        "Menlo".into(),
        "menlo".into(),
        "monospace".into(),
        "JetBrains Mono".into(),
        "Source Code Pro".into(),
    ];

    assert!(clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts, vec!["Fira Code", "JetBrains Mono", "Source Code Pro"]);
}

#[test]
fn clamp_custom_fonts_drops_anchor_in_stack_form() {
    let mut fonts = vec!["Menlo, monospace".into(), "Foo, Bar".into(), "  Spaced  ".into()];

    assert!(clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts, vec!["Foo", "Spaced"]);
}

#[test]
fn clamp_custom_fonts_extracts_primary_from_quoted_stack() {
    let mut fonts = vec!["\"Fira Code\", monospace".into()];

    assert!(clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts, vec!["Fira Code"]);
}

#[test]
fn clamp_custom_fonts_keeps_plain_non_anchor_unchanged() {
    let mut fonts = vec!["JetBrains Mono".into()];

    assert!(!clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts, vec!["JetBrains Mono"]);
}

#[test]
fn clamp_custom_fonts_caps_at_twenty() {
    let mut fonts: Vec<String> = (0..25).map(|i| format!("Custom Font {i}")).collect();

    assert!(clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts.len(), 20);
    assert_eq!(fonts.first().unwrap(), "Custom Font 0");
    assert_eq!(fonts.last().unwrap(), "Custom Font 19");
}

#[test]
fn clamp_text_config_reports_whether_it_mutated() {
    let mut unchanged =
        TextConfig { custom_fonts: Some(vec!["Monaco".into()]), ..TextConfig::default() };
    assert!(!clamp_text_config(&mut unchanged));

    let mut changed = TextConfig {
        scroll_sensitivity: 5.0,
        scroll_acceleration: f32::NAN,
        scrollbar_width: 2,
        custom_fonts: Some(vec![" Monaco ".into(), "MONACO".into()]),
        ..TextConfig::default()
    };
    assert!(clamp_text_config(&mut changed));
    assert_eq!(changed.scroll_sensitivity, 2.0);
    assert_eq!(changed.scroll_acceleration, default_scroll_acceleration());
    assert_eq!(changed.scrollbar_width, 4);
    assert_eq!(changed.custom_fonts, Some(vec!["Monaco".into()]));
    assert!(!clamp_text_config(&mut changed));
}

#[test]
fn clamp_text_on_load_never_changes_orphan_font_family() {
    let mut text = TextConfig {
        font_family: "Orphan Font, monospace".into(),
        custom_fonts: Some(Vec::new()),
        ..TextConfig::default()
    };

    assert!(!clamp_text_on_load(&mut text));
    assert_eq!(text.font_family, "Orphan Font, monospace");
}

#[test]
fn clamp_text_on_load_preserves_empty_font_family() {
    let mut text = TextConfig::default();

    assert!(!clamp_text_on_load(&mut text));
    assert!(text.font_family.is_empty());
}

#[test]
fn clamp_text_on_load_neutralises_unsafe_font_family() {
    for font_family in ["a;b{}", "Bad\nFont"] {
        let mut text = TextConfig { font_family: font_family.into(), ..TextConfig::default() };

        assert!(clamp_text_on_load(&mut text));
        assert_eq!(text.font_family, "monospace");
    }
}

#[test]
fn clamp_text_on_load_keeps_legit_font_stack() {
    let mut text =
        TextConfig { font_family: "\"Fira Code\", monospace".into(), ..TextConfig::default() };

    assert!(!clamp_text_on_load(&mut text));
    assert_eq!(text.font_family, "\"Fira Code\", monospace");
}

#[test]
fn clamp_text_on_load_keeps_monospace_and_empty_font_family() {
    for font_family in ["monospace", ""] {
        let mut text = TextConfig { font_family: font_family.into(), ..TextConfig::default() };

        assert!(!clamp_text_on_load(&mut text));
        assert_eq!(text.font_family, font_family);
    }
}

#[test]
fn clamp_custom_fonts_drops_css_injection_vectors() {
    let mut fonts = vec![
        "Good Font".into(),
        "Evil<script>".into(),
        "Evil;drop".into(),
        "Evil{bad}".into(),
        "Evil>arrow".into(),
        "Another Good".into(),
    ];

    assert!(clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts, vec!["Good Font", "Another Good"]);
}
