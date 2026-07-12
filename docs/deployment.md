# 部署指南

## Linux (systemd) 一键部署

```bash
# 构建二进制
./build.sh native

# 一键安装为 systemd 服务（支持开机自启 + 进程守护）
sudo bash deploy/systemd/install.sh --bin target/release/dinotty-server --token your-secret-token

# 管理命令
systemctl status dinotty       # 查看状态
systemctl restart dinotty      # 重启
systemctl stop dinotty         # 停止
journalctl -u dinotty -f       # 查看实时日志

# 修改配置后重启
vim /etc/dinotty/env           # 编辑端口、Token、日志级别
systemctl restart dinotty

# 卸载
sudo bash deploy/systemd/uninstall.sh
```

## Linux deb 包（dinotty-server）

仓库根目录已配置 `cargo-deb` 元数据，可直接构建服务端 deb 包：

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

产物位于 `target/debian/`，复制后也会出现在 `dist/`。deb 安装后会部署 `dinotty-server`、systemd unit 和 `/etc/dinotty/env.example`，并启用/启动 `dinotty.service`。

## Windows 原生运行

Windows 可以直接运行原生服务器。先构建前端，再用 Cargo 构建 release：

```powershell
cd frontend
pnpm install
pnpm run build
cd ..
cargo build --release -p dinotty-server
.\target\release\dinotty-server.exe -p 8999
```

默认 shell 检测顺序为 `DINOTTY_SHELL` → `pwsh.exe` → `powershell.exe` → `%ComSpec%` / `cmd.exe`。如需指定 shell：

```powershell
$env:DINOTTY_SHELL = "C:\Program Files\PowerShell\7\pwsh.exe"
.\target\release\dinotty-server.exe
```

如需开机自启，可以使用 Windows 任务计划程序、NSSM 或 WinSW 包装上述命令；当前仓库内置的一键安装脚本仅面向 Linux systemd。

## Docker 部署

```bash
cd deploy/docker

# 配置环境变量
cp .env.example .env
# 编辑 .env 设置 DINOTTY_TOKEN、WORKSPACE_DIR 等

# 构建并启动（支持 amd64 和 arm64）
docker compose up -d --build

# 管理命令
docker compose logs -f         # 查看日志
docker compose restart         # 重启
docker compose down            # 停止并移除

# 多架构构建并推送
docker buildx build --platform linux/amd64,linux/arm64 \
  -t your-registry/dinotty:latest --push \
  -f deploy/docker/Dockerfile .
```

Windows 上可通过 Docker Desktop 使用 Linux 容器部署；`.env` 中的工作区路径需要按 Docker Desktop 的挂载路径填写。

## 跨平台构建

```bash
# 列出 build.sh 支持的目标
./build.sh list

# 交叉编译 Linux musl（静态链接，无 glibc 依赖）
./build.sh cross

# 构建 build.sh 覆盖的所有平台
./build.sh all
```

`build.sh` 主要面向 Unix shell，当前输出到 `dist/` 的目标包括：

- `dinotty-server-x86_64-unknown-linux-musl`
- `dinotty-server-aarch64-unknown-linux-musl`
- `dinotty-server-x86_64-apple-darwin`
- `dinotty-server-aarch64-apple-darwin`

Windows 原生二进制请在 Windows 主机上运行 `cargo build --release -p dinotty-server`，产物为 `target\release\dinotty-server.exe`。

## 配置说明

| 参数 | 方式 | 默认值 | 说明 |
|------|------|--------|------|
| 端口 | `--port` / `-p` | 8999 | 服务监听端口 |
| Token | `DINOTTY_TOKEN` 环境变量或配置文件 | 未配置 / 首次设置 | 访问认证令牌，为空时进入首次设置流程 |
| 日志级别 | `RUST_LOG` 环境变量 | info | trace / debug / info / warn / error |
| Shell | Unix: `SHELL`；Windows: `DINOTTY_SHELL` | 自动检测 | Windows 优先 `DINOTTY_SHELL`，再尝试 `pwsh.exe`、`powershell.exe`、`%ComSpec%` / `cmd.exe` |

### 配置与数据目录

| 平台 | 配置目录 | 插件目录 |
|------|----------|----------|
| Linux | `~/.config/dinotty` | `~/.dinotty/plugins` |
| macOS | `~/Library/Application Support/dinotty` | `~/.dinotty/plugins` |
| Windows | `%APPDATA%\dinotty` | `%USERPROFILE%\.dinotty\plugins` |

Token、`settings.json`、审计日志和 webhook secrets 存放在配置目录；插件持久化数据存放在用户目录下的 `.dinotty/plugin-data`。
