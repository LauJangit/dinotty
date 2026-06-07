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

## 跨平台构建

```bash
# 列出支持的目标
./build.sh list

# 交叉编译 Linux musl（静态链接，无 glibc 依赖）
./build.sh cross

# 构建所有平台
./build.sh all
```

产物输出到 `dist/` 目录：
- `dinotty-server-x86_64-unknown-linux-musl`
- `dinotty-server-aarch64-unknown-linux-musl`
- `dinotty-server-x86_64-apple-darwin`
- `dinotty-server-aarch64-apple-darwin`

## 配置说明

| 参数 | 方式 | 默认值 | 说明 |
|------|------|--------|------|
| 端口 | `--port` 或 `DINOTTY_PORT` | 8999 | 服务监听端口 |
| Token | `DINOTTY_TOKEN` 环境变量 | 随机生成 | 访问认证令牌，为空时启动日志中打印 |
| 日志级别 | `RUST_LOG` 环境变量 | info | trace / debug / info / warn / error |
| Shell | `SHELL` 环境变量 | 自动检测 | 默认终端 Shell |
