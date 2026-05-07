# 系统架构设计文档

## 一、项目演进路线

当前项目是一个纯 Axum Web 服务端 + 单 HTML 前端。要支持三份需求，需要演进为：

```
Phase 1: Web 版增强（设置 + 附加功能）  ← 在现有代码基础上迭代
Phase 2: Tauri 桌面客户端（包裹现有 Web 前端 + 新增本地 PTY 模式）
```

---

## 二、项目结构重组

```
xterm/
├── Cargo.toml                    # workspace root
├── crates/
│   ├── xterm-core/               # 共享核心逻辑（PTY管理、Session、协议）
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── session.rs        # 现有 SessionManager + Session
│   │       ├── vt_screen.rs      # 现有 VirtualScreen
│   │       ├── settings.rs       # 【新】设置数据模型 + 持久化
│   │       ├── file_preview.rs   # 【新】文件读取 + 语言检测
│   │       └── protocol.rs       # 【新】统一消息协议定义
│   │
│   ├── xterm-server/             # Axum Web 服务（现有 main 演进）
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs
│   │       ├── ws.rs
│   │       ├── routes.rs
│   │       └── api.rs            # 【新】REST API（设置、文件预览、背景上传）
│   │
│   └── xterm-desktop/            # 【Phase 2】Tauri 桌面客户端
│       ├── Cargo.toml
│       ├── tauri.conf.json
│       └── src/
│           ├── main.rs           # Tauri 入口，--server 模式判断
│           ├── pty.rs            # 本地 PTY（通过 IPC 而非 WS）
│           ├── commands.rs       # Tauri IPC 命令
│           └── embedded_server.rs # 内嵌 Axum 服务启动
│
├── frontend/                     # 【重组】Vue 3 + Vite 前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── App.vue
│   │   ├── main.ts
│   │   ├── composables/
│   │   │   ├── useTerminal.ts    # xterm.js 封装
│   │   │   ├── useWebSocket.ts   # WS 连接管理
│   │   │   ├── useTauriIpc.ts    # Tauri IPC 适配
│   │   │   ├── useSettings.ts    # 设置状态管理
│   │   │   └── useTransport.ts   # 【关键】传输层抽象（WS / IPC 统一接口）
│   │   ├── components/
│   │   │   ├── TerminalPane.vue
│   │   │   ├── TabBar.vue
│   │   │   ├── SplitContainer.vue  # 嵌套分屏组件
│   │   │   ├── SettingsPanel.vue   # 设置侧边栏
│   │   │   ├── FilePreview.vue     # 文件预览弹层
│   │   │   ├── MobileKeyboard.vue  # 移动端虚拟键盘+快捷栏
│   │   │   ├── SelectionOverlay.vue # 文本选择覆盖层
│   │   │   ├── ServerList.vue      # 连接管理
│   │   │   └── CommandBookmarks.vue # 命令收藏
│   │   ├── themes/                 # 主题预设数据
│   │   └── types/
│   │       └── protocol.ts         # 消息类型定义
```

---

## 三、后端新增 API 设计

在现有 Axum 路由上新增 REST API：

```
# 设置
GET    /api/settings                → 获取用户设置
PUT    /api/settings                → 保存用户设置

# 文件预览
GET    /api/file?path=/foo/bar.rs   → 读取文件内容（返回 {content, language}）

# 命令收藏
GET    /api/bookmarks               → 获取收藏列表
POST   /api/bookmarks               → 添加收藏
PUT    /api/bookmarks/:id           → 编辑收藏
DELETE /api/bookmarks/:id           → 删除收藏
```

**设置存储**：服务端本地 JSON 文件 `~/.config/xterm/settings.json`，结构如下：

```rust
// crates/xterm-core/src/settings.rs

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub theme: ThemeConfig,
    pub background: BackgroundConfig,
    pub shortcuts: Vec<ShortcutButton>,
    pub bookmarks: Vec<CommandBookmark>,
    // 桌面版额外字段
    pub desktop: Option<DesktopSettings>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThemeConfig {
    pub preset: String,                  // "dark" | "dracula" | ...
    pub custom: Option<CustomColors>,    // 自定义覆盖
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BackgroundConfig {
    pub mode: String,                    // "solid" | "image"
    pub color: Option<String>,
    pub opacity: f32,                    // 0.0 ~ 1.0
    pub has_image: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShortcutButton {
    pub label: String,
    pub command: String,
    pub auto_enter: bool,
    pub order: u16,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CommandBookmark {
    pub id: String,
    pub name: String,
    pub command: String,
    pub group: Option<String>,
}
```

---

## 四、WebSocket 协议扩展

现有协议基础上新增消息类型：

```
# 新增 client → server
{ "type": "read_file", "path": "/path/to/file" }

# 新增 server → client
{ "type": "file_content", "path": "...", "content": "...", "language": "rust" }
{ "type": "file_error", "path": "...", "error": "..." }
```

文件预览也可以走 REST API（推荐），WS 方案作为备选。

---

## 五、传输层抽象（核心设计决策）

桌面客户端需要同时支持 **Tauri IPC**（本地终端）和 **WebSocket**（连接远程服务），用一个统一接口：

```typescript
// frontend/src/composables/useTransport.ts

interface Transport {
  send(msg: ClientMsg): void
  onMessage(handler: (msg: ServerMsg) => void): void
  disconnect(): void
}

function createTransport(mode: 'ws' | 'ipc', target?: string): Transport {
  if (mode === 'ipc') return new TauriIpcTransport()
  return new WebSocketTransport(target)  // target = ws://ip:port/ws
}
```

**运行时判断**：`window.__TAURI__` 存在 → IPC 模式，否则 → WS 模式。

---

## 六、桌面客户端架构（Phase 2）

```rust
// crates/xterm-desktop/src/main.rs

fn main() {
    let args = parse_args();

    if args.server_only {
        // --server 模式：仅启动 Axum，不打开 Tauri 窗口
        start_axum_server(args.port);
    } else {
        // 默认模式：启动 Tauri GUI + 后台 Axum 服务
        tauri::Builder::default()
            .setup(|app| {
                // 后台启动 Axum 服务（供手机连接）
                tokio::spawn(start_axum_server(args.port));
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                pty_spawn, pty_write, pty_resize, pty_kill,
                get_settings, save_settings,
                read_file,
            ])
            .run(app)
    }
}
```

**Tauri IPC 命令**：

```rust
#[tauri::command]
fn pty_spawn(state: State<PtyManager>) -> Result<String, String> { ... }

#[tauri::command]
fn pty_write(pane_id: String, data: String, state: State<PtyManager>) { ... }

#[tauri::command]
fn pty_resize(pane_id: String, cols: u16, rows: u16, state: State<PtyManager>) { ... }
```

PTY 输出通过 Tauri Event 推送到前端：

```rust
app.emit("pty-output", PtyOutput { pane_id, data });
```

---

## 七、嵌套分屏数据模型

```typescript
// 递归树结构
type SplitNode =
  | { type: 'pane', paneId: string }
  | { type: 'split', direction: 'horizontal' | 'vertical',
      ratio: number, children: [SplitNode, SplitNode] }

// 每个 Tab 持有一棵 SplitNode 树
interface Tab {
  id: string
  label: string
  root: SplitNode
}
```

Vue 组件 `SplitContainer.vue` 递归渲染这棵树，拖拽分割线修改 `ratio`。

---

## 八、关键实现要点

| 功能 | 实现要点 |
|------|---------|
| **文件路径识别** | 前端对终端输出做正则匹配 `/(?:^|\s)((?:\/|\.\/|~\/)[^\s:]+)/`，匹配到的路径渲染为可点击链接 |
| **文件预览** | 前端用 highlight.js（按需加载语言包），弹出全屏 overlay，只读 |
| **剪贴板选择模式** | 在 xterm.js canvas 上叠加一层透明 div，长按触发，计算字符坐标映射 |
| **主题切换** | 前端维护 6 套预设 xterm `ITheme` 对象，切换时调用 `terminal.options.theme = newTheme` |
| **连接管理** | 纯前端，localStorage 存储 `[{name, host, port}]`，切换时重建 WS 连接 |
| **多端 PTY 共享** | 已有 `Session.broadcast()` 机制，天然支持多客户端连到同一 pane_id |
| **全局快捷键** | Tauri 的 `global-shortcut` 插件，注册/注销由用户设置控制 |

---

## 九、前端从单 HTML 迁移到 Vue 的策略

**推荐渐进式迁移**：

1. 先用 Vite 构建，产物仍然嵌入 Axum（`rust-embed` 指向 `frontend/dist/`）
2. 现有 JS 逻辑（`app.js`, `terminal.js`, `tabs.js`, `splits.js`）逐步拆成 Vue composable
3. CSS 文件直接迁入 Vue 项目

这样 Web 版和 Tauri 版共用同一套前端代码，Vite 构建时通过环境变量区分 target。

---

## 十、实现优先级建议

```
P0 - 设置功能（主题 + 背景 + 快捷栏自定义）    ← 最小改动，立刻提升体验
P0 - 前端迁移到 Vue + Vite                     ← 为后续功能打基础
P1 - 文件预览 + 剪贴板增强                      ← 手机端核心痛点
P1 - 命令收藏 + 连接管理                        ← 增强功能
P2 - Tauri 桌面客户端骨架                       ← 新项目初始化
P2 - 桌面端嵌套分屏 + 全局快捷键 + 多 Tab
P3 - 内嵌 Axum 服务 + 多端 PTY 共享             ← 已有基础，集成即可
```
