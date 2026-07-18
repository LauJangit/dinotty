use super::*;

#[test]
fn client_msg_input_deserializes() {
    let msg: ClientMsg = serde_json::from_str(r#"{"type":"input","data":"ls\n"}"#).unwrap();
    match msg {
        ClientMsg::Input { data } => assert_eq!(data, "ls\n"),
        _ => panic!("expected Input"),
    }
}

#[test]
fn client_msg_resize_deserializes() {
    let msg: ClientMsg = serde_json::from_str(r#"{"type":"resize","cols":120,"rows":40}"#).unwrap();
    match msg {
        ClientMsg::Resize { cols, rows } => {
            assert_eq!(cols, 120);
            assert_eq!(rows, 40);
        }
        _ => panic!("expected Resize"),
    }
}

#[test]
fn sync_client_msg_activate_tab() {
    let msg: SyncClientMsg =
        serde_json::from_str(r#"{"type":"activate_tab","pane_id":"abc"}"#).unwrap();
    match msg {
        SyncClientMsg::ActivateTab { pane_id } => assert_eq!(pane_id, "abc"),
        _ => panic!("expected ActivateTab"),
    }
}

#[test]
fn sync_client_msg_create_tab_with_optional_fields() {
    let msg: SyncClientMsg =
        serde_json::from_str(r#"{"type":"create_tab","layout":{},"tab_id":"t1","pane_id":"p1"}"#)
            .unwrap();
    match msg {
        SyncClientMsg::CreateTab { tab_id, pane_id, .. } => {
            assert_eq!(tab_id.unwrap(), "t1");
            assert_eq!(pane_id.unwrap(), "p1");
        }
        _ => panic!("expected CreateTab"),
    }
}

#[test]
fn sync_client_msg_create_tab_without_optional_fields() {
    let msg: SyncClientMsg = serde_json::from_str(r#"{"type":"create_tab","layout":{}}"#).unwrap();
    match msg {
        SyncClientMsg::CreateTab { tab_id, pane_id, .. } => {
            assert!(tab_id.is_none());
            assert!(pane_id.is_none());
        }
        _ => panic!("expected CreateTab"),
    }
}

#[test]
fn sync_client_msg_close_tab() {
    let msg: SyncClientMsg =
        serde_json::from_str(r#"{"type":"close_tab","pane_id":"p1"}"#).unwrap();
    match msg {
        SyncClientMsg::CloseTab { pane_id } => assert_eq!(pane_id, "p1"),
        _ => panic!("expected CloseTab"),
    }
}

#[test]
fn sync_client_msg_update_layout() {
    let msg: SyncClientMsg = serde_json::from_str(
        r#"{"type":"update_layout","pane_id":"t1","layout":{"type":"leaf"},"active_pane_id":"p1"}"#,
    )
    .unwrap();
    match msg {
        SyncClientMsg::UpdateLayout { pane_id, active_pane_id, .. } => {
            assert_eq!(pane_id, "t1");
            assert_eq!(active_pane_id, "p1");
        }
        _ => panic!("expected UpdateLayout"),
    }
}

#[test]
fn server_msg_output_serializes() {
    let msg = ServerMsg::Output { data: "hello" };
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains(r#""type":"output""#));
    assert!(json.contains(r#""data":"hello""#));
}

#[test]
fn server_msg_shell_info_serializes() {
    let msg = ServerMsg::ShellInfo { shell_type: "zsh" };
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains(r#""type":"shell_info""#));
    assert!(json.contains(r#""shell_type":"zsh""#));
}

#[test]
fn notification_protocol_version_is_fail_closed() {
    assert_eq!(notification_protocol_version(None), 0);
    assert_eq!(notification_protocol_version(Some("malformed-1.0")), 0);
    assert_eq!(notification_protocol_version(Some("0")), 0);
    assert_eq!(notification_protocol_version(Some("1")), MIN_PROTOCOL_VERSION);
    assert_eq!(notification_protocol_version(Some("garbage")), 0);

    assert!(notification_protocol_version(None) < MIN_PROTOCOL_VERSION);
    assert!(notification_protocol_version(Some("0")) < MIN_PROTOCOL_VERSION);
    assert_eq!(CLOSE_UPGRADE_REQUIRED, 4001);

    // The parser verdict reaches the Close(4001, "protocol_upgrade_required") branch in
    // handle_notification_socket. A real upgrade, Ping/Pong, Close handshake, and DRAIN_STALL
    // exercise require a live socket and are intentionally deferred to the QA-stage E2E suite.
}
