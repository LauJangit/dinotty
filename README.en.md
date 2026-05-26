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
| Plugin system | ✅ JS plugins + CLI bridge, hot-reload | ❌ | ❌ | ❌ | ❌ |
| Open API (external control) | ✅ HTTP endpoint for remote input | ❌ | ❌ | ❌ | ❌ |
| Terminal link clicking | ✅ Click links to open in preview panel | ❌ | ❌ | ❌ | ❌ |

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
- **Plugin system** — install third-party plugins to extend UI and functionality; ships with CC Switch, JSON Formatter, Command Bookmarks, and Text Diff
- **Open API** — HTTP input endpoint for external device control (Stream Deck, Shortcuts, automation scripts)
- **Terminal link clicking** — clickable links in terminal open directly in the preview panel
- **Notification command hooks** — execute custom shell commands when notification events fire

## Open API (External Device Control)

The `POST /api/input` endpoint allows external devices (Stream Deck, iOS Shortcuts, automation scripts, etc.) to send input to the terminal for remote control.

Open API must be enabled in Settings.

```bash
# Send input to the active pane
curl -X POST http://127.0.0.1:8999/api/input \
  -H "Content-Type: application/json" \
  -d '{"data": "ls -la\n"}'

# Send input to a specific pane
curl -X POST http://127.0.0.1:8999/api/input \
  -H "Content-Type: application/json" \
  -d '{"data": "echo hello\n", "pane_id": "pane-1"}'
```

## Plugin System

Dinotty supports extending functionality through plugins. Plugins run in dedicated tabs, render UI with Vue 3, and have access to built-in APIs for the terminal, notifications, persistent storage, and more.

### Installing Plugins

**Option 1: Upload an archive**

Go to Settings → Plugins and upload a `.tar.gz` package containing a `plugin.json`.

**Option 2: Dev-link a local directory**

```bash
# Link a local directory as a plugin (development)
curl -X POST http://127.0.0.1:8999/api/plugins/dev-link \
  -H "Content-Type: application/json" \
  -d '{"path": "/your/plugin/dir"}'
```

**Option 3: Manual placement**

Drop a plugin directory directly into `~/.dinotty/plugins/<plugin-id>/`. The file watcher detects it automatically.

Plugins support **hot-reload** — edit plugin files and the browser picks up changes instantly without restarting the server.

### Plugin Manifest (plugin.json)

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Unique identifier, lowercase letters + hyphens; must match the directory name |
| `name` | ✅ | Display name |
| `version` | ✅ | Semantic version string |
| `entry` | ❌ | JS entry file, defaults to `./main.js` |
| `styles` | ❌ | CSS file path |
| `icon` | ❌ | Icon identifier (e.g., `braces`, `repeat`) |
| `bin` | ❌ | CLI binary config `{ "mode": "cli", "entry": "./bin/xxx" }` |
| `commands` | ❌ | Commands to register in the command palette `[{ "id": "...", "title": "..." }]` |
| `permissions` | ❌ | Permissions the plugin requires (e.g., `["terminal.output"]`) |
| `description` | ❌ | Plugin description, shown in the dropdown menu |

### Plugin API

A plugin's JS entry exports an `activate(context)` function. The `context` object provides:

| Category | API | Description |
|----------|-----|-------------|
| **Vue** | `ref`, `reactive`, `computed`, `watch`, `h`, `onMounted` | Full Vue 3 reactivity and render API |
| **Terminal** | `terminal.send(paneId, data)` | Send input to a terminal pane |
| | `terminal.activePaneId()` | Get the currently active pane ID |
| | `terminal.createTab(command?)` | Create a new terminal tab |
| | `terminal.listPanes()` | Query all terminal panes |
| | `terminal.onOutput(paneId, cb)` | Subscribe to terminal output broadcast |
| **Storage** | `storage.get(key)` | Read a persisted value |
| | `storage.set(key, value)` | Write a persisted value |
| | `storage.list()` | List all stored keys |
| **Commands** | `commands.register(id, handler)` | Register a command palette command, returns `Disposable` |
| **CLI exec** | `exec.run(args, options?)` | Run the plugin's CLI binary synchronously (`{code, stdout, stderr}`) |
| | `exec.spawn(args)` | Stream CLI output over WebSocket (returns `ReadableStream`) |
| **UI** | `ui.notify(message, level?)` | Show a notification (info / warn / error) |
| | `ui.confirm(message)` | Show a confirm dialog, returns `Promise<boolean>` |
| **Settings** | `settings.get()` | Read app settings |
| | `settings.onDidChange(cb)` | Subscribe to settings changes |

The return value of `activate(context)` may include:
- `component`: A Vue component rendered in the plugin tab
- `dispose()`: Cleanup called when the plugin is unloaded

### Built-in Plugins

| Plugin | Description |
|--------|-------------|
| **CC Switch** | Manage multiple Claude Code API providers and switch between them with one click. Requires the [cc-switch CLI](https://github.com/SaladDay/cc-switch-cli) |
| **JSON Formatter** | Format, minify, and validate JSON |
| **Command Bookmarks** | Command bookmarks with batch execution to multiple terminals |
| **Text Diff** | Text diff comparison tool with line-by-line highlighting |

For the full plugin development guide, see [docs/plugin-development.md](docs/plugin-development.md).

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

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=xichan96/dinotty&type=Date)](https://star-history.com/#xichan96/dinotty&Date)

## License

MIT
