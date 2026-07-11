#![cfg_attr(
    test,
    allow(
        clippy::cast_precision_loss,
        clippy::manual_string_new,
        clippy::match_wildcard_for_single_variants,
        clippy::missing_panics_doc,
        clippy::must_use_candidate,
        clippy::needless_pass_by_value,
        clippy::redundant_closure_for_method_calls,
        clippy::uninlined_format_args,
        clippy::unwrap_used
    )
)]

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
