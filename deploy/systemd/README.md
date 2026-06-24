# Dinotty systemd 部署指南

## 默认配置：受控服务终端

deb 安装后默认以独立服务用户 `dinotty` 运行，安全加固如下：

| 指令 | 效果 |
|------|------|
| `User=dinotty` | 独立低权限账户，与宿主用户隔离 |
| `ProtectSystem=strict` | 整个文件系统只读（除显式例外） |
| `ProtectHome=read-only` | `/home` 只读，可浏览但不可写 |
| `NoNewPrivileges=true` | 禁止 `sudo`、setuid 等提权 |
| `ReadWritePaths=/var/lib/dinotty /tmp` | 仅数据目录和 `/tmp` 可写 |

适合场景：多人共享服务器、教学演示、运维跳板机等需要隔离的场景。

## 个人开发终端

如果你希望 Dinotty 直接作为自己的开发终端（等同于通过浏览器访问的 SSH），需要以你的用户身份运行：

```bash
sudo systemctl edit dinotty.service
```

写入以下内容，替换 `<your-username>` 为你的 Linux 用户名：

```ini
[Service]
User=<your-username>
Group=<your-username>
ProtectHome=false
NoNewPrivileges=false
ReadWritePaths=/var/lib/dinotty /tmp /home/<your-username>
WorkingDirectory=/home/<your-username>
```

```bash
# 修改数据目录所有权
sudo chown -R <your-username>:<your-username> /var/lib/dinotty

# 重载并重启
sudo systemctl daemon-reload
sudo systemctl restart dinotty.service
```

改完后 Dinotty 终端的效果：

- `whoami` 返回你的用户名
- 加载你自己的 `~/.bashrc`、工具链（nvm/rbenv/pyenv 等）
- 能直接读写 `~/projects/...` 等项目目录
- 能 `sudo`、能装包

### 安全提示

个人开发终端模式下，Dinotty web 端拥有你账户的完整权限。如果服务暴露在公网：

1. **设置认证 Token** — 编辑 `/etc/dinotty/env`，填写 `DINOTTY_TOKEN=<强密码>`
2. **或限制监听地址** — 只监听 `127.0.0.1`，通过 SSH 隧道或反向代理访问

## 环境变量配置

编辑 `/etc/dinotty/env`（首次使用请先从示例复制）：

```bash
sudo cp /etc/dinotty/env.example /etc/dinotty/env
sudo vim /etc/dinotty/env
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DINOTTY_PORT` | `8999` | 服务端口 |
| `DINOTTY_TOKEN` | （空，自动生成） | 认证 Token |
| `RUST_LOG` | `info` | 日志级别 |
| `SHELL` | `/bin/bash` | 默认 Shell |

## 常用命令

```bash
# 查看服务状态
sudo systemctl status dinotty.service

# 查看日志
sudo journalctl -u dinotty.service -f

# 重启服务
sudo systemctl restart dinotty.service
```
