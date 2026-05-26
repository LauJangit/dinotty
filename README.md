<p align="center">
  <img src="docs/images/logo.png" alt="Dinotty Logo" width="200" />
</p>

<h1 align="center">Dinotty</h1>

<p align="center">
  <a href="./README.en.md">English</a> | 中文
</p>

---

为 **Coding Agent** 打造的**移动优先**终端服务器。在手机上运行 Claude Code、opencode、Codex 或 OpenClaw，获得与电脑上完全一致的体验——利用碎片时间，随时随地编程。

## 截图

<p align="center">
  <img src="docs/images/1.png" alt="手机上运行 Claude Code" width="250" />
  <img src="docs/images/2.png" alt="完整键盘布局与 htop" width="250" />
  <img src="docs/images/3.png" alt="主题设置" width="250" />
</p>
<p align="center">
  <img src="docs/images/4.png" alt="快捷键盘自定义" width="250" />
  <img src="docs/images/5.png" alt="系统监控" width="250" />
  <img src="docs/images/6.png" alt="通知系统" width="250" />
</p>
<p align="center">
  <img src="docs/images/7.png" alt="平板横屏桌面级布局" width="500" />
</p>

## 为什么选择 Dinotty？

终端 Coding Agent（Claude Code、opencode、Codex、OpenClaw 等）功能强大，但它们被束缚在桌面上。如果你可以：

- **在手机上启动编程任务**——排队、通勤、陪女朋友逛街时，掏出手机就能让 agent 干活
- **随时查看长时间运行的 agent**——不用打开笔记本电脑
- **直接在手机上验证 agent 产出**——代码 diff、渲染的网页、生成的文件，浏览器里一目了然
- **永远不会丢失会话**——手机息屏、切换 App、地铁里断网——回来后一切都在原处

Dinotty 就是为此而生。它是一个移动优先的 Web 终端，让你在**任何有浏览器的设备上获得完整的桌面级 Coding Agent 体验**。

### 移动优先，桌面同样完美

界面自适应你的设备：

- **响应式布局**——竖屏时终端和预览面板上下排列；横屏时左右并排，和桌面 IDE 一样
- **触控优化**——终端视口触摸滚动、触控友好的按钮、支持触摸拖拽的面板缩放
- **可自定义的快捷键盘**——手机没有 Ctrl、Esc、功能键；Dinotty 提供完全自定义的快捷按钮栏，可以为任意按键组合或转义序列定义按钮
- **一致的 agent 体验**——Claude Code、opencode、Codex、OpenClaw 在手机和电脑上的行为完全相同，终端感知不到区别

### 轻量级——不是远程桌面

你可能会想："为什么不直接用 VNC / RDP / 远程桌面连到电脑上？" 你可以，但：

| | Dinotty | 远程桌面 (VNC/RDP/Parsec) |
|---|---|---|
| **传输数据** | 纯文本（JSON，字节流） | 全屏像素流，30-60 fps |
| **带宽消耗** | 通常 ~1–10 KB/s | ~1–10 MB/s（多 100–1000 倍） |
| **移动网络友好** | ✅ 3G/4G 下流畅无延迟 | ❌ 卡顿、高延迟、流量消耗大 |
| **弱信号容忍度** | ✅ 自动重连，无画面丢失 | ❌ 画面冻结、输入延迟 |
| **电量消耗** | 低（文本渲染） | 高（视频解码） |
| **分辨率适配** | 任意尺寸下原生文本渲染 | 位图缩放，手机上模糊 |
| **交互方式** | 原生触控 + 自定义键盘 | 模拟鼠标，桌面 UI 在手机上很小 |

远程桌面把整个屏幕当作视频流传输——即使画面没有变化也在持续传输。Dinotty 只传输**实际发生变化的文本**，效率高出几个数量级。在不稳定的移动网络下，几 KB 的 JSON 和持续的视频流之间的差距就是"能用"和"不能用"的差距。

### 虚拟终端（VT Screen）

后端维护了一个完整的**服务端虚拟终端仿真器**（`vt_screen.rs`，600+ 行代码），使用 VTE 状态机实时解析 PTY 输出。每个字符、每个转义序列、每次光标移动都在服务端被跟踪。这意味着：

- 服务端始终掌握精确的屏幕状态——不是原始字节，而是带属性（颜色、粗体、斜体等）的结构化字符网格
- 滚动历史在服务端以环形缓冲区保留
- 可随时按需生成 ANSI 编码的屏幕快照

### 会话持久化与自动重连

会话在网络断开时不会丢失。当客户端重新连接时：

1. PTY 进程在服务端持续运行——不会被中断
2. 服务端分块回放滚动历史，然后发送当前屏幕快照
3. 客户端终端恢复到断开前的精确状态

前端实现了**指数退避自动重连**（1s → 30s 上限）。或者，直接刷新浏览器页面即可恢复完整会话——不需要重启进程或重建终端。

### 多面板同步

多面板通过 `SessionManager` 管理，使用 `DashMap` 映射 pane-id → PTY。专用的 `/ws/sync` WebSocket 保持所有连接客户端的标签页状态同步，你可以从多个浏览器窗口打开同一个服务器。

### 可自定义的快捷键盘

手机没有终端依赖的 Ctrl、Esc、Alt 和功能键。Dinotty 提供了**完全可自定义的快捷键盘**来解决这个问题：

- **快捷面板**——开箱即用的一键按钮：Ctrl+C、Ctrl+D、Escape、Tab 等终端常用操作
- **完全自定义**——在设置中添加、删除、重新排列快捷按钮；每个按钮可设置自定义标签和发送任意原始转义序列
- **发送任何内容**——配置按钮发送任意按键组合或转义序列（如 `\x03` 表示 Ctrl+C，`\x1b[A` 表示方向上键），打造专属工作流的快捷按钮栏
- **修饰键状态跟踪**——粘滞 Ctrl/Alt/Shift 修饰键，配合完整键盘布局使用
- 完整按键布局，包含所有可打印字符、功能键（F1–F12）和专用方向键区

### 内建文件和网页浏览器

Coding Agent 会生成代码、文档和网页——但验证产出通常需要切换到单独的文件管理器或浏览器。Dinotty 将两者都直接嵌入到终端旁边：

- **文件工作区**——树形文件浏览器，支持文件列表、上传、重命名和删除。点击任意文件即可预览
- **代码编辑器**——基于 Monaco Editor 的代码编辑器，支持语法高亮、自动补全
- **Git 变更指示**——编辑器左侧 gutter 显示新增（绿色）、修改（蓝色）、删除（红色）行标记；点击可展开 inline diff 查看器，支持 Stage/Revert 单个 hunk；文件树同步显示 M/U/A/D 徽标和染色
- **Markdown 预览**——实时渲染 Markdown，带 HTML 净化（marked + DOMPurify）
- **Office 文档**——直接在浏览器中预览 Word、Excel、PowerPoint 文件（officeparser）
- **媒体播放**——内建音频/视频播放器，支持进度条、音量和播放控制
- **图片预览**——支持常见格式的内联图片渲染
- **网页预览**——输入 URL 或本地端口号，在嵌入式 iframe 中浏览；内建反向代理（`/preview/:port/*`）路由到本地开发服务器，无需离开终端即可查看应用运行效果
- **地址栏**——输入 URL 或端口进行导航，自动检测网页/文件预览

这意味着 agent 可以执行 `npm run dev`、编写代码，用户可以立即验证结果——全部在一个浏览器标签页内完成。

## 与其他终端的对比

| 能力 | Dinotty | ttyd | gotty | Wetty | 传统终端（iTerm2 等） |
|---|---|---|---|---|---|
| 服务端虚拟终端（VT Screen） | ✅ 完整 VTE 解析，服务端掌握屏幕状态 | ❌ | ❌ | ❌ | N/A |
| 会话在断网后存活 | ✅ 自动重连 + 屏幕恢复 | ❌ 会话丢失 | ❌ 会话丢失 | ❌ 会话丢失 | 需要 tmux/screen |
| 刷新页面 = 恢复会话 | ✅ 回放滚动历史 + 屏幕快照 | ❌ 新建会话 | ❌ 新建会话 | ❌ 新建会话 | N/A |
| 内建文件浏览器和预览 | ✅ 代码、Markdown、Office、图片、音视频 | ❌ | ❌ | ❌ | ❌ |
| Git 变更指示 | ✅ Gutter 标记 + inline diff + Stage/Revert | ❌ | ❌ | ❌ | ❌ |
| 内建网页预览（反向代理） | ✅ 在 iframe 中嵌入本地开发服务器 | ❌ | ❌ | ❌ | ❌ |
| 文件变更监听 | ✅ 通过 WebSocket 实时推送 | ❌ | ❌ | ❌ | ❌ |
| 可自定义快捷键盘 | ✅ 用户定义按键，支持原始转义序列 | ❌ | ❌ | ❌ | N/A |
| 多服务器管理 | ✅ 保存并切换服务器 | ❌ | ❌ | ❌ | N/A |
| 多面板 + 标签页同步 | ✅ DashMap 会话 + 同步 WebSocket | ❌ | ❌ | ❌ | ✅ 仅限本地 |
| 终端通知（bell / OSC） | ✅ 检测 + 声音 + 面板 | ❌ | ❌ | ❌ | ✅ 仅限本地 |
| 系统监控（CPU/内存/磁盘/网络） | ✅ 实时图表 | ❌ | ❌ | ❌ | ❌ |
| 命令面板 | ✅ | ❌ | ❌ | ❌ | ✅ |
| Token 认证 | ✅ | ✅ | ❌ | ✅ | N/A |
| 桌面应用 | ✅ Tauri | ❌ | ❌ | ❌ | 原生 |
| 插件系统 | ✅ JS 插件 + CLI 桥接，热重载 | ❌ | ❌ | ❌ | ❌ |
| Open API（外部控制） | ✅ HTTP 端点远程输入 | ❌ | ❌ | ❌ | ❌ |
| 终端链接点击 | ✅ 点击链接在预览面板打开 | ❌ | ❌ | ❌ | ❌ |

**核心差异**：其他 Web 终端（ttyd、gotty、Wetty）只是 WebSocket 到 PTY 的透传管道——它们传输原始字节，对屏幕上显示的内容一无所知。Dinotty 在服务端运行**完整的虚拟终端仿真器**，这使得会话恢复、屏幕快照成为可能，提供了其他方案需要配合 tmux/screen 才能达到的弹性。结合内建的文件/网页浏览器，它提供了一个自包含的环境——Coding Agent 在其中工作，用户在其中验证结果——无需切换工具。

## 全部功能

- **虚拟终端仿真** — 服务端 VT Screen，完整支持 ANSI/SGR
- **会话持久化** — PTY 进程在断网后存活，自动重连并恢复状态
- **多面板会话** — 分屏管理多个终端面板，标签页同步
- **文件工作区** — 浏览、编辑、上传、预览文件（代码高亮、Markdown、Office 文档）
- **Git 变更指示** — 编辑器 gutter 显示增/改/删行标记，支持 inline diff、Stage 和 Revert；文件树显示 git 状态徽标
- **网页预览** — 内建反向代理，预览本地开发服务器
- **通知系统** — 终端 bell 和 OSC 通知检测，WebSocket 实时推送，可配置声音提醒和面板展示
- **系统监控** — 通过 vue-chartjs 实时展示 CPU/内存/网络图表
- **命令面板** — 快速访问命令启动器
- **可自定义快捷键盘** — 为移动端和触屏设备添加 Ctrl/Esc/自定义转义序列按钮
- **设置与国际化** — 持久化设置，多语言支持
- **身份认证** — 基于 Token 的访问控制
- **桌面应用** — 可选的 Tauri 原生客户端
- **插件系统** — 可安装第三方插件扩展界面与功能；内置 CC Switch、JSON Formatter、Command Bookmarks、Text Diff
- **Open API** — HTTP 输入端点，支持外部设备（Stream Deck、快捷指令等）远程控制终端
- **终端链接点击** — 终端中的链接可直接点击，在预览面板中打开
- **通知命令钩子** — 通知事件触发时自动执行自定义 shell 命令

## 通知系统

dinotty 内建通知系统，支持终端 bell 检测和自定义通知推送，适用于 AI agent 和自动化工具集成。

### HTTP API

通过 `POST /api/notify` 发送通知：

```bash
curl -s -X POST http://127.0.0.1:8999/api/notify \
  -H "Content-Type: application/json" \
  -d '{"body": "任务完成", "title": "My Agent", "notification_type": "info"}'
```

请求体字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `body` | string | ✅ | 通知正文 |
| `title` | string | ❌ | 通知标题 |
| `pane_id` | string | ❌ | 关联的面板 ID |
| `notification_type` | string | ❌ | 类型：`info`（默认）/ `warning` / `error` |

### 与 Claude Code 集成

在 dinotty 终端中运行 Claude Code 时，可通过 hook 在关键节点自动发送通知：

```jsonc
// .claude/settings.json
{
  "hooks": {
    "Notification": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:8999/api/notify -H 'Content-Type: application/json' -d '{\"body\":\"Claude 需要你的输入\",\"title\":\"Claude Code\",\"notification_type\":\"warning\"}'" }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:8999/api/notify -H 'Content-Type: application/json' -d '{\"body\":\"任务已完成\",\"title\":\"Claude Code\",\"notification_type\":\"info\"}'" }]
    }]
  }
}
```

| Hook | 用途 |
|------|------|
| `Notification` | Claude 需要用户输入或确认权限时通知 |
| `Stop` | 任务完成时通知 |

其他 AI agent 或自动化脚本同样可以调用 HTTP API 发送通知，无需额外配置。

### 通知命令钩子

可在设置中配置 shell 命令，当通知事件发生时自动执行。适用于触发系统级提醒（如 macOS `osascript`、`notify-send` 等）。

## Open API（外部设备控制）

通过 `POST /api/input` 端点，外部设备（Stream Deck、iOS 快捷指令、自动化脚本等）可以向终端发送输入，实现远程控制。

需要在设置中启用 Open API 功能。

```bash
# 向活跃面板发送输入
curl -X POST http://127.0.0.1:8999/api/input \
  -H "Content-Type: application/json" \
  -d '{"data": "ls -la\n"}'

# 向指定面板发送输入
curl -X POST http://127.0.0.1:8999/api/input \
  -H "Content-Type: application/json" \
  -d '{"data": "echo hello\n", "pane_id": "pane-1"}'
```

## 插件系统

Dinotty 支持通过插件扩展功能。插件在独立标签页中运行，使用 Vue 3 渲染 UI，可调用终端、通知、持久化存储等内建 API。

### 安装插件

**方式一：上传安装包**

在 设置 → 插件 中上传 `.tar.gz` 压缩包（包含 `plugin.json`）。

**方式二：开发模式链接**

```bash
# 将本地目录链接为插件（开发时使用）
curl -X POST http://127.0.0.1:8999/api/plugins/dev-link \
  -H "Content-Type: application/json" \
  -d '{"path": "/your/plugin/dir"}'
```

**方式三：手动放置**

将插件目录直接放入 `~/.dinotty/plugins/<plugin-id>/`，文件监听器会自动检测。

插件支持**热重载**——修改插件文件后无需重启服务器，浏览器自动加载最新版本。

### 插件清单（plugin.json）

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 唯一标识，小写字母 + 连字符，须与目录名一致 |
| `name` | ✅ | 显示名称 |
| `version` | ✅ | 语义化版本 |
| `entry` | ❌ | JS 入口文件，默认 `./main.js` |
| `styles` | ❌ | CSS 文件路径 |
| `icon` | ❌ | 图标标识符（如 `braces`、`repeat`） |
| `bin` | ❌ | CLI 二进制配置 `{ "mode": "cli", "entry": "./bin/xxx" }` |
| `commands` | ❌ | 注册到命令面板的命令列表 `[{ "id": "...", "title": "..." }]` |
| `permissions` | ❌ | 声明插件所需权限（如 `["terminal.output"]`） |
| `description` | ❌ | 插件描述，显示在下拉菜单中 |

### 插件 API

插件 JS 入口导出 `activate(context)` 函数，`context` 提供以下 API：

| 类别 | API | 说明 |
|------|-----|------|
| **Vue** | `ref`, `reactive`, `computed`, `watch`, `h`, `onMounted` | 完整 Vue 3 响应式与渲染 API |
| **终端** | `terminal.send(paneId, data)` | 向指定终端面板发送输入 |
| | `terminal.activePaneId()` | 获取当前活跃面板 ID |
| | `terminal.createTab(command?)` | 创建新终端标签页 |
| | `terminal.listPanes()` | 查询所有终端面板列表 |
| | `terminal.onOutput(paneId, cb)` | 监听终端输出广播 |
| **存储** | `storage.get(key)` | 读取持久化值 |
| | `storage.set(key, value)` | 写入持久化值 |
| | `storage.list()` | 列举所有已存储的 key |
| **命令** | `commands.register(id, handler)` | 注册命令面板命令，返回 `Disposable` |
| **CLI 执行** | `exec.run(args, options?)` | 调用插件附带的 CLI 二进制（同步，返回 `{code, stdout, stderr}`） |
| | `exec.spawn(args)` | 流式调用 CLI（WebSocket，返回 `ReadableStream`） |
| **UI** | `ui.notify(message, level?)` | 显示通知（info / warn / error） |
| | `ui.confirm(message)` | 显示确认对话框，返回 `Promise<boolean>` |
| **设置** | `settings.get()` | 读取应用设置 |
| | `settings.onDidChange(cb)` | 监听设置变更 |

`activate(context)` 返回值可包含：
- `component`：一个 Vue 组件，将在插件标签页中渲染
- `dispose()`：插件卸载时的清理函数

### 内置插件

| 插件 | 功能 |
|------|------|
| **CC Switch** | 管理多个 Claude Code API Provider，一键切换；依赖 [cc-switch CLI](https://github.com/SaladDay/cc-switch-cli) |
| **JSON Formatter** | JSON 格式化、压缩与验证工具 |
| **Command Bookmarks** | 命令收藏夹，支持批量发送到多个终端 |
| **Text Diff** | 文本差异对比工具，支持逐行对比与高亮显示 |

完整的插件开发文档见 [docs/plugin-development.md](docs/plugin-development.md)。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Rust, Axum 0.7, Tokio, portable-pty, vte |
| 前端 | Vue 3, TypeScript, Vite, xterm.js 5 |
| 桌面端 | Tauri |

## 快速开始

### 前置条件

- Rust 工具链（stable）
- Node.js + pnpm（或 npm）

### 构建与运行

```bash
# 构建前端
cd frontend && pnpm install && pnpm run build && cd ..

# 运行服务器
cargo run
```

在浏览器中打开 http://127.0.0.1:8999 。

### 开发

```bash
# 带调试日志运行后端
RUST_LOG=debug cargo run

# 前端类型检查
cd frontend && npx vue-tsc --noEmit
```

## 项目结构

```
src/               # Rust 后端
  main.rs          # Axum 路由与服务入口
  ws.rs            # WebSocket ↔ PTY 桥接
  vt_screen.rs     # 虚拟终端仿真器（基于 VTE）
  session.rs       # 会话管理器（多面板）
  workspace.rs     # 文件工作区 API
  proxy.rs         # 反向代理（预览）
  monitor.rs       # 系统监控
  notification.rs  # 通知广播（bell/OSC 检测）
  plugin.rs        # 插件系统管理
  settings.rs      # 设置持久化
  auth.rs          # 身份认证
  file_watcher.rs  # 文件变更监听

frontend/          # Vue 3 SPA
  src/
    App.vue
    components/    # TabBar, TerminalPane, MobileKeyboard 等
    composables/   # useTerminal, useTransport, useSettings 等

src-tauri/         # Tauri 桌面客户端
docs/              # 设计文档
```

## WebSocket 协议

通过 `/ws` 传输的 JSON 消息：

| 方向 | `type` | 字段 |
|------|--------|------|
| 客户端 → 服务端 | `input` | `data: String` |
| 客户端 → 服务端 | `resize` | `cols: u16, rows: u16` |
| 服务端 → 客户端 | `output` | `data: String` |
| 服务端 → 客户端 | `shell_info` | `shell_type: String` |

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=xichan96/dinotty&type=Date)](https://star-history.com/#xichan96/dinotty&Date)

## 许可证

MIT

