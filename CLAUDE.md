# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
cargo build          # build
cargo run            # run server on http://127.0.0.1:8999
RUST_LOG=debug cargo run   # run with debug logging
```

## Architecture

**Stack**: Axum 0.7 (HTTP + WebSocket) · Tokio (async runtime) · portable-pty (PTY spawning) · xterm.js 5 (browser terminal)

**Backend modules** (`src/`):
- `main.rs` — wires together the Axum router: `GET /` → HTML, `GET /ws` → WebSocket handler, `/static/*` → static files
- `terminal.rs` — `TerminalManager`: a `DashMap` of pane-id → PTY writer, used as shared Axum state
- `ws.rs` — core logic: upgrades HTTP to WebSocket, spawns a PTY via `portable-pty`, bridges PTY ↔ WebSocket with a `tokio::task::spawn_blocking` reader and a `mpsc` channel
- `routes.rs` — serves `static/index.html` via `include_str!`

**WebSocket message protocol** (JSON):

| Direction | `type` | Fields |
|-----------|--------|--------|
| client → server | `input` | `data: String` |
| client → server | `resize` | `cols: u16, rows: u16` |
| server → client | `output` | `data: String` |
| server → client | `shell_info` | `shell_type: String` |

**Frontend** (`static/index.html`):
- Single HTML file; loads xterm.js + addon-fit from jsDelivr CDN
- `createPane()` creates an xterm instance, opens a WebSocket to `/ws?paneId=<uuid>`, and sets up a `ResizeObserver` to call `fitAddon.fit()` + send `resize` messages
- "分屏" button calls `createPane()` again; each pane is independent with its own WebSocket + PTY session
