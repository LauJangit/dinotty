# Deployment Guide

## Linux (systemd) One-Click Deploy

```bash
# Build binary
./build.sh native

# One-click install as systemd service (auto-start + process supervision)
sudo bash deploy/systemd/install.sh --bin target/release/dinotty-server --token your-secret-token

# Management commands
systemctl status dinotty       # Check status
systemctl restart dinotty      # Restart
systemctl stop dinotty         # Stop
journalctl -u dinotty -f       # View live logs

# Update config and restart
vim /etc/dinotty/env           # Edit port, token, log level
systemctl restart dinotty

# Uninstall
sudo bash deploy/systemd/uninstall.sh
```

## Linux deb Package (dinotty-server)

The repository already includes `cargo-deb` metadata, so the server deb package can be built from the repository root:

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm run build
cd ..

cargo install cargo-deb --locked
cargo deb --profile release --package dinotty-server

mkdir -p dist
cp target/debian/dinotty-server_*.deb dist/
```

The package is written to `target/debian/`, and the copy command also places it in `dist/`. Installing the deb deploys `dinotty-server`, the systemd unit, and `/etc/dinotty/env.example`, then enables and starts `dinotty.service`.

## Windows Native Run

Windows can run the native server directly. Build the frontend first, then build the release binary with Cargo:

```powershell
cd frontend
pnpm install
pnpm run build
cd ..
cargo build --release -p dinotty-server
.\target\release\dinotty-server.exe -p 8999
```

The default shell is detected in this order: `DINOTTY_SHELL` → `pwsh.exe` → `powershell.exe` → `%ComSpec%` / `cmd.exe`. To override it:

```powershell
$env:DINOTTY_SHELL = "C:\Program Files\PowerShell\7\pwsh.exe"
.\target\release\dinotty-server.exe
```

For auto-start on Windows, wrap the command with Task Scheduler, NSSM, or WinSW. The one-click installer scripts in this repository currently target Linux systemd only.

## Docker Deploy

```bash
cd deploy/docker

# Configure environment variables
cp .env.example .env
# Edit .env to set DINOTTY_TOKEN, WORKSPACE_DIR, etc.

# Build and start (supports amd64 and arm64)
docker compose up -d --build

# Management commands
docker compose logs -f         # View logs
docker compose restart         # Restart
docker compose down            # Stop and remove

# Multi-arch build and push
docker buildx build --platform linux/amd64,linux/arm64 \
  -t your-registry/dinotty:latest --push \
  -f deploy/docker/Dockerfile .
```

On Windows, use Docker Desktop with Linux containers. Set workspace paths in `.env` using paths visible inside Docker Desktop mounts.

## Cross-Platform Build

```bash
# List targets supported by build.sh
./build.sh list

# Cross-compile for Linux musl (static linking, no glibc dependency)
./build.sh cross

# Build all platforms covered by build.sh
./build.sh all
```

`build.sh` is primarily for Unix shells. The current `dist/` outputs are:

- `dinotty-server-x86_64-unknown-linux-musl`
- `dinotty-server-aarch64-unknown-linux-musl`
- `dinotty-server-x86_64-apple-darwin`
- `dinotty-server-aarch64-apple-darwin`

For a native Windows binary, run `cargo build --release -p dinotty-server` on Windows. The output is `target\release\dinotty-server.exe`.

## Configuration

| Parameter | Method | Default | Description |
|-----------|--------|---------|-------------|
| Port | `--port` / `-p` | 8999 | Server listen port |
| Token | `DINOTTY_TOKEN` env var or config file | Unconfigured / first-time setup | Access auth token; when empty, Dinotty starts the first-time setup flow |
| Log level | `RUST_LOG` env var | info | trace / debug / info / warn / error |
| Shell | Unix: `SHELL`; Windows: `DINOTTY_SHELL` | Auto-detect | Windows tries `DINOTTY_SHELL`, then `pwsh.exe`, `powershell.exe`, `%ComSpec%` / `cmd.exe` |

### Config And Data Directories

| Platform | Config directory | Plugin directory |
|----------|------------------|------------------|
| Linux | `~/.config/dinotty` | `~/.dinotty/plugins` |
| macOS | `~/Library/Application Support/dinotty` | `~/.dinotty/plugins` |
| Windows | `%APPDATA%\dinotty` | `%USERPROFILE%\.dinotty\plugins` |

Tokens, `settings.json`, audit logs, and webhook secrets are stored in the config directory. Plugin persistent data lives under `.dinotty/plugin-data` in the user's home directory.
