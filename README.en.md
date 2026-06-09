<p align="center">
  <img src="docs/images/logo.png" alt="Dinotty Logo" width="200" />
</p>

<h1 align="center">Dinotty</h1>

<p align="center">
  English | <a href="./README.md">中文</a>
</p>

---

A **mobile-first** terminal server purpose-built for **coding agents**. Run Claude Code, opencode, Codex, or OpenClaw on your phone with the same experience as on your laptop — use fragmented time to stay productive while you're on the go.

## Screenshots

<p align="center">
  <img src="docs/images/1.png" alt="Running Claude Code on mobile" width="250" />
  <img src="docs/images/2.png" alt="Full keyboard layout with htop" width="250" />
  <img src="docs/images/3.png" alt="Theme settings" width="250" />
</p>
<p align="center">
  <img src="docs/images/4.png" alt="Custom shortcut keyboard" width="250" />
  <img src="docs/images/5.png" alt="System monitor" width="250" />
  <img src="docs/images/6.png" alt="Notification system" width="250" />
</p>
<p align="center">
  <img src="docs/images/7.png" alt="Tablet landscape desktop-class layout" width="500" />
</p>

## Why Dinotty?

Terminal-based coding agents (Claude Code, opencode, Codex, OpenClaw, etc.) are powerful, but they are tethered to your desktop. Dinotty lets you:

- **Kick off a coding task from your phone** while waiting in line, commuting, or walking around
- **Check on a long-running agent** without pulling out your laptop
- **Review and verify agent output** — code diffs, rendered pages, generated files — right from your phone's browser
- **Never lose your session** — put your phone to sleep, switch apps, lose signal — come back and everything is exactly where you left it

### Lightweight — Not a Remote Desktop

| | Dinotty | Remote Desktop (VNC/RDP/Parsec) |
|---|---|---|
| **Data transmitted** | Text only (JSON, bytes) | Full screen pixels at 30-60 fps |
| **Bandwidth** | ~1–10 KB/s typical | ~1–10 MB/s (100–1000x more) |
| **Mobile data friendly** | ✅ Works on 3G/4G without lag | ❌ Choppy, high latency, burns data |
| **Weak signal tolerance** | ✅ Auto-reconnect, no frame loss | ❌ Frozen screen, input lag |
| **Battery consumption** | Low (text rendering) | High (video decoding) |
| **Resolution adaptation** | Native text at any size | Scaled bitmap, blurry on phone |
| **Interaction** | Native touch, custom keyboard | Simulated mouse, tiny desktop UI |

## Key Features

- **Server-side virtual terminal** — full VTE parser, server knows exact screen state, enables session recovery & screen snapshots
- **Session persistence** — PTY processes survive disconnection, auto-reconnect with exponential backoff, refresh page to restore
- **Responsive layout** — portrait stacks vertically, landscape side-by-side; touch-optimized buttons & pane resizing
- **Customizable shortcut keyboard** — add Ctrl/Esc/function keys for mobile, supports arbitrary escape sequences
- **Built-in file browser** — code highlighting, Markdown rendering, Office document preview, audio/video playback
- **Git change indicators** — gutter marks for added/modified/deleted lines, inline diff, Stage/Revert
- **Web preview** — built-in reverse proxy to preview local dev servers in iframe
- **Notification system** — terminal bell/OSC detection, WebSocket push, configurable sound alerts
- **System monitor** — real-time CPU/memory/network charts
- **Plugin system** — JS plugins + CLI bridge, hot-reload; ships with CC Switch, JSON Formatter, etc.
- **Open API** — HTTP endpoint for external device control (Stream Deck, Shortcuts, automation scripts)
- **Command palette** — quick-access command launcher
- **Desktop app** — optional Tauri-based native client

## Comparison with Other Terminals

| Capability | Dinotty | ttyd | gotty | Wetty |
|---|---|---|---|---|
| Server-side virtual terminal (VT Screen) | ✅ | ❌ | ❌ | ❌ |
| Session survives network disconnect | ✅ | ❌ | ❌ | ❌ |
| Refresh page = restore session | ✅ | ❌ | ❌ | ❌ |
| Built-in file browser & preview | ✅ | ❌ | ❌ | ❌ |
| Git change indicators | ✅ | ❌ | ❌ | ❌ |
| Built-in web preview (reverse proxy) | ✅ | ❌ | ❌ | ❌ |
| Customizable shortcut keyboard | ✅ | ❌ | ❌ | ❌ |
| Plugin system | ✅ | ❌ | ❌ | ❌ |
| Token auth | ✅ | ✅ | ❌ | ✅ |

Other web terminals are thin WebSocket-to-PTY pipes. Dinotty runs a **full virtual terminal emulator on the server**, enabling session recovery and screen snapshots. Combined with the built-in file/web browser, it provides a self-contained environment where coding agents work and users verify results.

## Quick Start

```bash
# Build frontend
cd frontend && pnpm install && pnpm run build && cd ..

# Run server
cargo run
```

Open http://127.0.0.1:8999 in your browser.

```bash
# Backend with debug logging
RUST_LOG=debug cargo run

# Frontend type-check
cd frontend && npx vue-tsc --noEmit
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust, Axum 0.7, Tokio, portable-pty, vte |
| Frontend | Vue 3, TypeScript, Vite, xterm.js 5 |
| Desktop | Tauri |

## Project Structure

```
src/               # Rust backend
  main.rs          # Axum router & server entry
  ws.rs            # WebSocket ↔ PTY bridge
  vt_screen.rs     # Virtual terminal emulator (VTE-based)
  session.rs       # Session manager (multi-pane)
  workspace.rs     # File workspace API
  proxy.rs         # Reverse proxy for preview
  monitor.rs       # System monitor
  notification.rs  # Notification broadcast (bell/OSC detection)
  plugin.rs        # Plugin system management
  settings.rs      # Settings persistence
  auth.rs          # Authentication
  file_watcher.rs  # File change watching

frontend/          # Vue 3 SPA
  src/
    App.vue
    components/    # TabBar, TerminalPane, MobileKeyboard, etc.
    composables/   # useTerminal, useTransport, useSettings, etc.

src-tauri/         # Tauri desktop client
docs/              # Design documents
```

## WebSocket Protocol

JSON messages over `/ws`:

| Direction | `type` | Fields |
|-----------|--------|--------|
| Client → Server | `input` | `data: String` |
| Client → Server | `resize` | `cols: u16, rows: u16` |
| Server → Client | `output` | `data: String` |
| Server → Client | `shell_info` | `shell_type: String` |

## More Documentation

- [Deployment Guide](docs/deployment.en.md) — systemd, Docker, cross-platform build, configuration
- [Notification System](docs/notifications.en.md) — HTTP API, Claude Code integration, Open API
- [Plugin System](docs/plugins.en.md) — installation, manifest, API, built-in plugins
- [Plugin Development](docs/plugin-development.md) — full plugin development guide
- [Contributing](docs/contributing.en.md) — branch strategy, commit convention, code style

## Contributors

Thanks to all the people who have contributed to Dinotty!

<a href="https://github.com/xichan96/dinotty/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=xichan96/dinotty" />
</a>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=xichan96/dinotty&type=Date)](https://star-history.com/#xichan96/dinotty&Date)

## License

MIT
