use super::*;

#[test]
fn test_workspace_serialization_roundtrip() {
    let ws = Workspace {
        id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        name: "dinotty".to_string(),
        path: "/Users/talentc/rust/dinotty".to_string(),
        order: 0,
        connection_id: None,
    };
    let json = serde_json::to_string(&ws).unwrap();
    let deserialized: Workspace = serde_json::from_str(&json).unwrap();
    assert_eq!(ws, deserialized);
}

#[test]
fn test_workspace_serialization_with_connection_id() {
    let ws = Workspace {
        id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        name: "remote-project".to_string(),
        path: "/home/deploy/app".to_string(),
        order: 0,
        connection_id: Some("ssh-profile-123".to_string()),
    };
    let json = serde_json::to_string(&ws).unwrap();
    assert!(json.contains("connection_id"));
    let deserialized: Workspace = serde_json::from_str(&json).unwrap();
    assert_eq!(ws, deserialized);
}

#[test]
fn test_workspace_backward_compat_deserialize_without_connection_id() {
    // Existing workspaces.json files without connection_id should still parse
    let json = r#"{"id":"aaa","name":"test","path":"/tmp","order":0}"#;
    let ws: Workspace = serde_json::from_str(json).unwrap();
    assert_eq!(ws.connection_id, None);
}

#[test]
fn test_workspace_list_serialization() {
    let workspaces = vec![
        Workspace {
            id: "aaa".to_string(),
            name: "first".to_string(),
            path: "/tmp/first".to_string(),
            order: 0,
            connection_id: None,
        },
        Workspace {
            id: "bbb".to_string(),
            name: "second".to_string(),
            path: "/tmp/second".to_string(),
            order: 1,
            connection_id: None,
        },
    ];
    let json = serde_json::to_string(&workspaces).unwrap();
    let deserialized: Vec<Workspace> = serde_json::from_str(&json).unwrap();
    assert_eq!(workspaces, deserialized);
}

#[test]
fn test_derive_name_basic() {
    assert_eq!(derive_name("/Users/talentc/rust/dinotty"), "dinotty");
    assert_eq!(derive_name("/home/user/projects/my-app"), "my-app");
    assert_eq!(derive_name("/tmp"), "tmp");
}

#[test]
fn test_derive_name_trailing_slash() {
    assert_eq!(derive_name("/Users/talentc/rust/dinotty/"), "dinotty");
    assert_eq!(derive_name("/tmp/"), "tmp");
}

#[test]
fn test_derive_name_root() {
    assert_eq!(derive_name("/"), "root");
}

#[test]
fn test_validate_path_rejects_relative() {
    let result = validate_workspace_path("relative/path");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("absolute"));
}

#[test]
fn test_validate_path_rejects_empty() {
    let result = validate_workspace_path("");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("empty"));
}

#[test]
fn test_validate_path_rejects_whitespace_only() {
    let result = validate_workspace_path("   ");
    assert!(result.is_err());
}

#[test]
fn test_validate_path_rejects_sensitive_dirs() {
    for dir in &["/", "/etc", "/sys", "/proc", "/dev", "/bin", "/sbin", "/usr"] {
        let result = validate_workspace_path(dir);
        assert!(result.is_err(), "should reject {dir}");
        assert!(
            result.unwrap_err().contains("sensitive"),
            "error for {dir} should mention sensitive"
        );
    }
}

#[test]
fn test_validate_path_rejects_nonexistent() {
    let result = validate_workspace_path("/nonexistent/path/that/does/not/exist");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("invalid path"));
}

#[test]
fn test_validate_path_accepts_real_dir() {
    let result = validate_workspace_path("/tmp");
    assert!(result.is_ok());
    // Should be canonicalized
    let canonical = result.unwrap();
    assert!(canonical.is_absolute());
    assert!(canonical.is_dir());
}

#[test]
fn test_derive_name_with_special_chars() {
    assert_eq!(derive_name("/home/user/my project"), "my project");
    assert_eq!(derive_name("/home/user/项目"), "项目");
}
