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

## Cross-Platform Build

```bash
# List supported targets
./build.sh list

# Cross-compile for Linux musl (static linking, no glibc dependency)
./build.sh cross

# Build for all platforms
./build.sh all
```

Output in `dist/` directory:
- `dinotty-server-x86_64-unknown-linux-musl`
- `dinotty-server-aarch64-unknown-linux-musl`
- `dinotty-server-x86_64-apple-darwin`
- `dinotty-server-aarch64-apple-darwin`

## Configuration

| Parameter | Method | Default | Description |
|-----------|--------|---------|-------------|
| Port | `--port` or `DINOTTY_PORT` | 8999 | Server listen port |
| Token | `DINOTTY_TOKEN` env var | Random | Access auth token; printed in startup log when empty |
| Log level | `RUST_LOG` env var | info | trace / debug / info / warn / error |
| Shell | `SHELL` env var | Auto-detect | Default terminal shell |
