<p align="center">
  <img src="docs/images/logo.png" alt="Dinotty Logo" width="200" />
</p>

<h1 align="center">Dinotty</h1>

<p align="center">
  English | <a href="./README.md">中文</a>
</p>

---

A **mobile-first** terminal server purpose-built for **coding agents**. Run Claude Code, opencode, Codex, or OpenClaw on your phone with the same experience as on your laptop — use fragmented time to stay productive while you're on the go.

## Why Dinotty?

Terminal-based coding agents (Claude Code, opencode, Codex, OpenClaw, etc.) are powerful, but they are tethered to your desktop. What if you could:

- **Kick off a coding task from your phone** while waiting in line, commuting, or walking around
- **Check on a long-running agent** without pulling out your laptop
- **Review and verify agent output** — code diffs, rendered pages, generated files — right from the browser on your phone
- **Never lose your session** — put your phone to sleep, switch apps, lose signal in the subway — come back and everything is exactly where you left it

Dinotty is designed for this. It's a mobile-first web terminal that gives you the **full desktop coding agent experience on any device with a browser**.

### Mobile-First, Desktop-Complete

The interface adapts to your device:

- **Responsive layout** — portrait mode stacks terminal and preview vertically; landscape mode places them side-by-side, just like a desktop IDE
- **Touch-optimized** — touch scrolling in terminal viewport, touch-friendly buttons, touch-aware pane resizing
- **Customizable shortcut keyboard** — mobile devices lack Ctrl, Esc, and function keys; Dinotty provides a fully customizable shortcut bar where you can define buttons for any key combination or escape sequence
- **Same agent experience** — Claude Code, opencode, Codex, OpenClaw all work identically on mobile and desktop; the terminal doesn't know the difference

### Lightweight — Not a Remote Desktop

You might think: "Why not just VNC / RDP / screen share into my desktop?" You can, but:

| | Dinotty | Remote Desktop (VNC/RDP/Parsec) |
|---|---|---|
| **Data transmitted** | Text only (JSON, bytes) | Full screen pixels at 30-60 fps |
| **Bandwidth** | ~1–10 KB/s typical | ~1–10 MB/s (100–1000x more) |
| **Mobile data friendly** | ✅ Works on 3G/4G without lag | ❌ Choppy, high latency, burns data |
| **Weak signal tolerance** | ✅ Auto-reconnect, no frame loss | ❌ Frozen screen, input lag |
| **Battery consumption** | Low (text rendering) | High (video decoding) |
| **Resolution adaptation** | Native text at any size | Scaled bitmap, blurry on phone |
| **Interaction** | Native touch, custom keyboard | Simulated mouse, tiny desktop UI |

Remote desktop streams the entire screen as video — even when nothing changes. Dinotty only transmits **the text that actually changed**, making it orders of magnitude more efficient. On a spotty mobile connection, the difference between a few KB of JSON and a continuous video stream is the difference between usable and unusable.

### Virtual Terminal (VT Screen)

The backend maintains a full **virtual terminal emulator** (`vt_screen.rs`, 600+ lines) that parses the PTY output in real time using the VTE state machine. Every character, every escape sequence, every cursor movement is tracked server-side. This means:

- The server always knows the exact screen state — not just raw bytes, but a structured grid of characters with attributes (colors, bold, italic, etc.)
- Scrollback history is preserved server-side in a ring buffer
- Screen snapshots can be generated on demand as ANSI-encoded text

### Session Persistence & Auto-Reconnect

Sessions survive network disconnections. When a client reconnects:

1. The PTY process keeps running on the server — nothing is interrupted
2. The server replays the scrollback history in chunks, then sends the current screen snapshot
3. The client terminal is restored to the exact state before disconnection

The frontend implements **automatic reconnection** with exponential backoff (1s → 30s cap). Alternatively, simply refreshing the browser page restores the full session — no need to restart processes or recreate terminals.

### Multi-Pane Sync

Multiple panes are managed via `SessionManager` with a `DashMap` of pane-id → PTY. A dedicated `/ws/sync` WebSocket keeps all connected clients in sync on tab state, so you can open the same server from multiple browser windows.

### Customizable Shortcut Keyboard

Mobile devices lack the Ctrl, Esc, Alt, and function keys that terminals depend on. Dinotty provides a **fully customizable shortcut keyboard** that solves this:

- **Action panel** — one-tap buttons for Ctrl+C, Ctrl+D, Escape, Tab, and other terminal essentials out of the box
- **Fully customizable** — add, remove, and reorder shortcut buttons in Settings; each button has a custom label and can send arbitrary raw escape sequences
- **Send anything** — configure a button to send any key combination or escape sequence (e.g., `\x03` for Ctrl+C, `\x1b[A` for arrow up), so you can build your own shortcut bar for any workflow
- **Modifier state tracking** — sticky Ctrl/Alt/Shift modifiers that work with the full keyboard layout
- Complete key layout with all printable characters, function keys (F1–F12), and a dedicated arrow key cluster

### Built-in File & Web Browser

Coding agents generate code, documents, and web pages — but verifying the output usually means switching to a separate file manager or browser. Dinotty embeds both directly alongside the terminal:

- **File workspace** — tree-view file browser with file listing, upload, rename, and delete. Click any file to preview it instantly
- **Code editor** — Monaco Editor-based code editor with syntax highlighting and auto-completion
- **Git change indicators** — gutter decorations show added (green), modified (blue), and deleted (red) lines; click to open an inline diff viewer with Stage/Revert per hunk; file tree displays M/U/A/D badges with color coding
- **Markdown preview** — live-rendered Markdown with sanitized HTML (marked + DOMPurify)
- **Office documents** — preview Word, Excel, PowerPoint files directly in the browser (officeparser)
- **Media playback** — built-in audio/video player with seek, volume, and playback controls
- **Image preview** — inline image rendering for common formats
- **Web preview** — enter a URL or local port number and browse it in an embedded iframe; a built-in reverse proxy (`/preview/:port/*`) routes to local dev servers, so you can see your app running without leaving the terminal
- **Address bar** — type a URL or port to navigate, with auto-detection of web vs. file preview

This means an agent can `npm run dev`, write code, and the user can immediately verify the results — all within a single browser tab.

## Comparison with Other Terminals

| Capability | Dinotty | ttyd | gotty | Wetty | Traditional terminal (iTerm2, etc.) |
|---|---|---|---|---|---|
| Server-side virtual terminal (VT Screen) | ✅ Full VTE parser, server knows screen state | ❌ | ❌ | ❌ | N/A |
| Session survives network disconnect | ✅ Auto-reconnect + screen restore | ❌ Session lost | ❌ Session lost | ❌ Session lost | Needs tmux/screen |
| Refresh page = restore session | ✅ Scrollback + screen snapshot replayed | ❌ New session | ❌ New session | ❌ New session | N/A |
| Built-in file browser & preview | ✅ Code, Markdown, Office, image, audio/video | ❌ | ❌ | ❌ | ❌ |
| Git change indicators | ✅ Gutter marks + inline diff + Stage/Revert | ❌ | ❌ | ❌ | ❌ |
| Built-in web preview (reverse proxy) | ✅ Embed local dev server in iframe | ❌ | ❌ | ❌ | ❌ |
| File change watching | ✅ Real-time via WebSocket | ❌ | ❌ | ❌ | ❌ |
| Customizable shortcut keyboard | ✅ User-defined keys with raw escape sequences | ❌ | ❌ | ❌ | N/A |
| Multi-server management | ✅ Save & switch between servers | ❌ | ❌ | ❌ | N/A |
| Multi-pane with tab sync | ✅ DashMap sessions + sync WebSocket | ❌ | ❌ | ❌ | ✅ Local only |
| Terminal notifications (bell / OSC) | ✅ Detection + sound + panel | ❌ | ❌ | ❌ | ✅ Local only |
| System monitor (CPU/mem/disk/net) | ✅ Real-time charts | ❌ | ❌ | ❌ | ❌ |
| Command palette | ✅ | ❌ | ❌ | ❌ | ✅ |
| Token auth | ✅ | ✅ | ❌ | ✅ | N/A |
| Desktop app | ✅ Tauri | ❌ | ❌ | ❌ | Native |

**Key differentiator**: Other web terminals (ttyd, gotty, Wetty) are thin WebSocket-to-PTY pipes — they stream raw bytes and have no knowledge of what's on screen. Dinotty runs a **full virtual terminal emulator on the server**, which enables session recovery, screen snapshots, and a level of resilience that other solutions require pairing with tmux/screen to achieve. Combined with the built-in file/web browser, it provides a self-contained environment where coding agents can work and users can verify results — no tool-switching required.

## All Features

- **Virtual terminal emulation** — server-side VT screen with full ANSI/SGR support
- **Session persistence** — PTY processes survive disconnection, auto-reconnect with state recovery
- **Multi-pane sessions** — split and manage multiple terminal panes with tab sync
- **File workspace** — browse, edit, upload, and preview files (code highlighting, Markdown, Office docs)
- **Git change indicators** — gutter decorations for added/modified/deleted lines, inline diff viewer with Stage and Revert; file tree shows git status badges
- **Web preview** — built-in reverse proxy to preview local dev servers
- **Notification system** — terminal bell and OSC notification detection, real-time WebSocket push, configurable sound alerts and notification panel
- **System monitor** — real-time CPU/memory/network charts via vue-chartjs
- **Command palette** — quick-access command launcher
- **Customizable shortcut keyboard** — add Ctrl/Esc/custom escape-sequence buttons for mobile & touch devices
- **Settings & i18n** — persistent settings with multi-language support
- **Authentication** — token-based access control
- **Desktop app** — optional Tauri-based native client

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust, Axum 0.7, Tokio, portable-pty, vte |
| Frontend | Vue 3, TypeScript, Vite, xterm.js 5 |
| Desktop | Tauri |

## Quick Start

### Prerequisites

- Rust toolchain (stable)
- Node.js + pnpm (or npm)

### Build & Run

```bash
# Build frontend
cd frontend && pnpm install && pnpm run build && cd ..

# Run server
cargo run
```

Open http://127.0.0.1:8999 in your browser.

### Development

```bash
# Backend with debug logging
RUST_LOG=debug cargo run

# Frontend type-check
cd frontend && npx vue-tsc --noEmit
```

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

## License

MIT
