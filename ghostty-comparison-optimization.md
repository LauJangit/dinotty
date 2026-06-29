# Ghostty 对标分析与优化建议

对比项目: [Ghostty](https://github.com/ghostty-org/ghostty) — Zig 实现的高性能终端模拟器

## 1. IME / 中文输入处理

### Ghostty 的做法

Ghostty 的 IME 处理采用**分层架构**：

- **平台层 (apprt)** 负责跟踪 IME 状态，通过 `preeditCallback` 上报预编辑文本
- **编码层 (key_encode.zig)** 负责拦截，当 `composing=true` 时：
  - Legacy 协议：直接 `return`，所有按键事件全部吞掉
  - Kitty 协议：只放行纯修饰键 (Shift/Ctrl/Alt)，其余吞掉
- **渲染层** 负责显示预编辑文本（preedit），光标强制切换为 block 样式

关键设计：composing 状态的拦截发生在**编码层**而非输入层，职责分离清晰。

### Dinotty 现状

- **桌面端 (Tauri WebView)**：前端运行在 WKWebView (macOS) / WebView2 (Windows) / WebKitGTK (Linux) 中，IME 事件先经过平台 WebView 再到 xterm.js
- **Web 端**：`useTerminal.ts:238-279` 监听 `compositionstart`/`compositionend`，`useTerminal.ts:493/564` 的 `onData` 回调中通过 `_compositionGuard` 拦截
- `pty.rs` — 后端 `configure_utf8_locale()` 确保 UTF-8 locale

**已有防御机制**（经四轮迭代）：

1. **1000ms 安全定时器**（`useTerminal.ts:247-250`）：WebKit Bug 224932 的防护，`compositionend` 不触发时自动重置 `isComposing` 状态，避免输入永久卡死
2. **compositionend 直接 sendData**（`useTerminal.ts:58-63` standalone 版本）：绕过 xterm.js 的 broken 机制，committed text 不经 `onData` 而是直接通过 `sendData` 发送，这是第四轮修复的核心
3. **50ms cooldown 去重**（`useTerminal.ts:257-260`）：`compositionend` 后设 `compositionJustEnded=true`，50ms 内 guard 返回 `false`，阻止 xterm.js 通过 `setTimeout(0)` 重放的重复 `onData`
4. **数据比对去重**（`useTerminal.ts:272-276` in-class 版本）：额外记录 `compositionData`，如果 `onData` 传入的数据与已发送的 committed text 相同则丢弃

**测试覆盖**：`frontend/src/test/compositionGuard.test.ts`（208 行）覆盖 shift+标点、真 IME、普通输入、安全定时器、取消、清理等场景

### 差距与优化建议

| # | 问题 | 建议 | 优先级 |
|---|------|------|--------|
| 1 | **无 inline 预编辑文本显示** — 用户输入中文时系统 IME 候选窗口可用（由操作系统管理），但终端区域内无 inline preedit 显示（带下划线的拼音/候选文本）。桌面端 WebView 的 IME 处理比原生窗口多一层抽象，难度更大 | 桌面端：尝试 Tauri WebView 的 `input` 事件钩子，或注入 JS 拦截 IME 候选窗口位置；Web 端：xterm.js overlay 或 DOM overlay | 中 |
| 2 | **composition 拦截在 onData 层** — 依赖 xterm.js 先处理再拦截，可能有泄漏。注意：现有 1000ms 安全定时器和 50ms cooldown 已提供基本防护，但拦截位置不如 ghostty 的编码层拦截彻底 | 参考 ghostty 在编码层拦截的思路；桌面端可考虑 Tauri IPC 层面拦截 | 中 |
| 3 | **WebKit Bug 224932** — 桌面端 macOS WKWebView 受影响最直接。已有 1s 安全定时器 workaround（`useTerminal.ts:247-250`） | 持续关注 WebKit 进展；现有 workaround 已足够，如需更强防护可加 MutationObserver 监听 textarea 变化作为后备 | 低 |

## 2. 快捷键系统

### Ghostty 的做法

- **声明式配置**：INI 格式 `keybind = ctrl+shift+c=copy_to_clipboard`
- **物理按键映射**：基于 W3C key code，不依赖布局
- **consumed 机制**：每个 binding 有 `consumed` 标志，决定是否吞掉按键
  - `performable:` 前缀 — 只在动作成功时吞掉（如复制只在有选区时生效）
  - `unconsumed:` 前缀 — 执行动作同时仍发送到终端
- **多键序列**：`ctrl+a>n=new_window` 支持类 vim 的多键组合
- **按键表 (key tables)**：`copy_mode/ctrl+a=select_all` 支持 modal 输入
- **~60+ 内置动作**：copy、paste、new_window、goto_split 等

### Dinotty 现状

快捷键需要区分两条路径：
- **桌面端 (Tauri)**：通过 `tauri-plugin-global-shortcut` 注册系统级快捷键（如 Quake 唤起），走 Tauri IPC 通道，不受 WebView 焦点限制
- **两端共有 (xterm.js)**：在 WebView/浏览器页面内拦截，需要终端组件有焦点才生效

当前状态：
- 14 个可配置快捷键（`useKeybindings.ts:16-102` `defs` 数组），全部需要 Cmd/Ctrl 修饰符
- 用户可通过设置 UI 自定义按键（`KeyboardTab.vue`）
- `switchTab` (Cmd+1~9) 是 readonly 的
- 额外硬编码了 Cmd+Option+Arrow（pane 焦点）和 Cmd+Option+Shift+Arrow（pane 调整大小）（`App.vue:1063-1099`）
- **桌面端全局快捷键插件已注册但完全未使用**：`tauri-plugin-global-shortcut` 在 `main.rs:318` 以 `Builder::new().build()` 注册，无 `.with_handler()` / `.with_shortcut()` 调用；前端 `package.json` 无 `@tauri-apps/plugin-global-shortcut` 依赖（项目通过 `withGlobalTauri: true` 使用 `window.__TAURI__` 全局注入，无任何 `@tauri-apps/*` npm 包）
- **tray-icon feature 已启用但从未使用**：`Cargo.toml:8` 启用 `tray-icon` feature，但 `main.rs` 无 `TrayIconBuilder`、无 menu 构造、`tauri.conf.json` 无 `app.trayIcon` 配置——不是"有图标但没菜单"，是完全未实现

### 差距与优化建议

| # | 问题 | 建议 | 实现路径 | 优先级 |
|---|------|------|----------|--------|
| 1 | **缺少常用终端快捷键** — 无 Ctrl+Shift+C/V (Linux 风格复制粘贴)、无字体大小调整 | 添加 Ctrl+Shift+C/V 复制粘贴，Cmd+/Cmd- 字体缩放 | xterm.js 层（两端共有） | 高 |
| 2 | **桌面端全局快捷键完全未接入** — `tauri-plugin-global-shortcut` 已注册 (`main.rs:318`) 但以空 Builder 注册，无任何绑定；tray-icon feature 已启用但无任何 tray 相关代码；前端无 `@tauri-apps/plugin-global-shortcut` 依赖 | 需先决定架构方向：Rust 侧注册全局快捷键（不需要前端 npm 包，通过 `app.global_shortcut().register()` + Tauri event 通知前端）或 JS 侧调用（需加 `@tauri-apps/plugin-global-shortcut` 依赖）。推荐 Rust 侧注册，避免引入新前端依赖。然后注册 Quake 唤起/隐藏；添加 `TrayIconBuilder` 构建托盘菜单 | Tauri IPC（桌面端专属） | 高 |
| 3 | **快捷键数量偏少 (14个)** — ghostty 有 60+ 动作 | 逐步扩展：字体缩放、全屏切换、clear terminal、detach pane 等 | 两端分别扩展 | 中 |

## 3. 架构差异：Tauri WebView vs 原生窗口

dinotty 桌面端与 Ghostty 之间最根本的差距。WebView 架构的优势是跨平台复用前端代码和内嵌 Web 服务，代价是平台原生能力的天花板较低。

核心差异：
- **IME 处理**：IME 事件先经过 WebView 再到 JS，多一层抽象，中文输入体验是最大痛点
- **渲染管线**：xterm.js Canvas/WebGL 渲染受 WebView 性能约束，大量输出时体感差距明显
- **IPC 延迟**：Tauri IPC 调用（微秒级）比原生函数调用（纳秒级）慢，PTY 通信链路更长

对于 IME、渲染性能等关键体验，需要在 WebView 约束下寻找最优解，而非追求与原生应用完全对齐。

## 4. 可参考的其他优化方向

### 4.1 Bracketed Paste

Ghostty 有专门的 `paste.zig` 处理 bracketed paste 模式（`\x1b[200~` ... `\x1b[201~`）。这可以防止粘贴的文本被终端当作命令执行。

**建议**：确认 xterm.js 已默认启用 bracketed paste，后端 WS 转发不做截断。

### 4.2 Shell Integration

Ghostty 的 `termio/` 层有深度 shell 集成（OSC 133 标记、命令追踪、CWD 检测）。

**现状**：dinotty 已有 OSC 133 支持和 Agent API，基本持平。

## 5. 优先级排序

### 高优先级（近期可做）

1. **字体缩放快捷键** — Cmd+=/Cmd+-/Cmd+0，用户高频需求（xterm.js 层，两端共有）
2. **Linux 风格复制粘贴** — Ctrl+Shift+C/V 兼容（xterm.js 层，两端共有）
3. **桌面端全局快捷键** — Quake 模式唤起/隐藏（Tauri IPC，桌面端专属）
4. **预编辑文本显示** — 提升中文/日文输入体验（桌面端 WebView 难度高于纯 Web，需分别攻关）

### 中优先级（规划中）

5. **更多内置快捷键** — 全屏、clear、detach pane 等

## 6. 实现参考

### 预编辑文本显示方案

```
xterm.js 的 textarea 是隐藏的，IME 候选窗口由系统管理（用户可以看到系统候选窗）。
需要做的是在终端区域内渲染 inline preedit 文本（带下划线），
以提供与原生终端一致的输入体验。

方案 A：xterm.js addon — 注册 DecorationOverlay，在光标位置渲染
方案 B：DOM overlay — 在 xterm canvas 上方绝对定位一个 span
方案 C：WebGL 渲染 — 在 xterm.js 的 WebGL addon 中注入 preedit 渲染
```

参考 ghostty 的 `addPreeditCell` 实现，preedit 文本应该：
- 显示在光标位置
- 带下划线样式
- 光标切换为 block 样式
- 宽度按 Unicode 规则计算

### 快捷键扩展参考列表

**xterm.js 层（两端共有，需要终端焦点）：**
```
Cmd + =          字体放大
Cmd + -          字体缩小
Cmd + 0          字体重置
Ctrl + Shift + C 复制 (Linux 风格)
Ctrl + Shift + V 粘贴 (Linux 风格)
Cmd + Shift + K  清屏
Cmd + Enter      全屏切换
Cmd + Shift + P  命令面板 (备选)
Cmd + \          水平分割 (备选)
```

**Tauri 全局快捷键（桌面端专属，无需焦点）：**
```
Ctrl + ~ / Cmd + ~    Quake 模式唤起/隐藏
Cmd + Shift + N       新窗口
```

**全局快捷键实现方向**：推荐 Rust 侧注册，流程如下：
```
1. main.rs setup 闭包中调用 app.global_shortcut().register("Cmd+~", handler)
2. handler 中 emit 自定义 Tauri event（如 "toggle-quake"）
3. 前端 listenTauriEvent("toggle-quake") 处理窗口显示/隐藏逻辑
4. 无需引入 @tauri-apps/plugin-global-shortcut 前端依赖
```

---

## 7. 终端核心稳定性与可用性

### 7.0 输出管线优化

**桌面端**（Tauri IPC）链路比 Web 端多一跳：

```
PTY read loop → broadcast (unbounded channel)
  → Tauri forwarder: spawn_tauri_output_forwarder (src-tauri/src/main.rs:24)
    → app.emit("pty-output", payload)  — 每条消息一次 JS 事件
      → 前端 listenTauriEvent → xterm.write(data) — fire-and-forget
```

**问题**：
- Tauri `app.emit()` 逐条触发 WebView JS 事件（`main.rs:34`），PTY read loop 每读 4KB 就触发一次 emit，大量输出时性能瓶颈明显
- `xterm.write()` 无回调、无 chunking（`useTerminal.ts:474,540,551` 均未传 `callback` 参数），大量数据瞬间灌入。但 xterm.js 内部有渲染队列和 rAF 合并，`write()` 把数据推入内部 buffer 后即返回，不会阻塞主线程——真正的瓶颈在 Tauri 侧逐条 emit，而非前端 write

**建议**：
1. **Tauri 侧 batching**（桌面端，~30 行） — forwarder 收到第一条后 drain 合并，类似 PTY 输入侧 WS 路径已有的 batch 方案（`ws/mod.rs:396-404`），减少 emit 次数。**这是输出管线的主要瓶颈，应优先处理**
2. **前端 chunked write**（两端共有，~15 行） — `xterm.write(data, callback)` 用回调驱动下一批，提供 backpressure。但实际收益取决于 Tauri 侧 batching 是否已减少数据量，优先级低于 #1

### 7.1 PTY 读写模型

| 维度 | Ghostty | Dinotty | 差距分析 |
|------|---------|---------|----------|
| **读循环** | 专用 `std.Thread`，非阻塞 read + poll，栈上 1KB buffer | `tokio::task::spawn_blocking`，阻塞 read，4KB buffer | 功能等价。Ghostty 用 poll+quit-pipe 可优雅退出；dinotty 依赖 channel drop 退出 |
| **写路径** | xev 异步写队列，64B 分块，buffer pool 复用 | 两条路径差异显著：**WS 路径** (`ws/mod.rs:395-405`) batch drain + mutex + `write_all`，有 batching；**Tauri 路径** (`main.rs:88-100`) 无 batching，每次 `pty_write` command 直接 `writer.lock().unwrap()` + `write_all` | WS 路径的 batch 方案已够用；Tauri 路径单次写入开销可接受（前端 input 事件频率低），但缺少 exited 防护（见 7.2） |
| **resize 合并** | 25ms timer 合并连续 resize 事件 | 前端已有 `requestAnimationFrame` 单帧合并（`useTerminal.ts:619`），后端每次 resize 立即执行 3 个 mutex 锁 | **可优化**：前端 rAF 已过滤同帧内的多次 resize，但跨帧连续 resize（如拖拽窗口）仍逐次发到后端。后端侧加 debounce 可进一步减少 PTY resize 调用 |

**建议**：
1. **Resize debounce** — 参考 ghostty 的 25ms 合并机制，在后端侧对 resize 请求做 debounce（前端 rAF 已做单帧合并，后端 debounce 做跨帧合并）
2. **优雅退出** — 当前 read loop 靠 Ok(0)/Err 退出，可考虑加 quit signal（类似 ghostty 的 quit-pipe），让 cleanup 路径更确定

### 7.2 进程生命周期管理

| 维度 | Ghostty | Dinotty | 差距分析 |
|------|---------|---------|----------|
| **退出检测** | xev.Process watcher 回调，异步通知 | read loop 返回 Ok(0) 时同步检测 | 都能工作，ghostty 更实时 |
| **僵尸清理** | `killpg` + `waitpid(WNOHANG)` 循环重试，处理 setsid 竞态 | `Session::drop()` / `kill_child()` 中 `child.kill()` + `child.wait()`，仅杀直接子进程 | **差距**：`portable_pty` 在 Unix 上内部已创建新 session（setsid），但 dinotty 未跟踪进程组 ID（pgid）。`child.kill()` 只杀直接子进程，孙子进程（如 vim 里 `:!cmd`、npm 子进程）会变孤儿。`Cargo.toml` 无 `nix`/`libc` 依赖，需先添加才能用 `killpg` |
| **detach 后清理** | 无（单进程模型） | 30s 轮询，5 分钟无连接则 kill | dinotty 的方案适合服务端场景，已够用 |
| **写入防护** | `if (exited) return;` 静默丢弃 | mutex + `write_all`，无 exited 检查。`Session` 结构体（`session/mod.rs:26-40`）无 `exited`/`exit_flag` 字段 | **风险**：进程退出后写入——WS 路径 `let _ = w.write_all(...)` 静默吞掉错误但 write task 不会退出（直到 `input_rx` 返回 None）；Tauri 路径 `w.write_all(...).map_err(...)` 将错误传播到前端。均无预写入存活检查 |

**建议**：
1. **写入防护** — 在 `Session` 中加 `exited: Mutex<bool>` 标志，read loop 检测到退出时设为 true，写入前检查。WS 写 task 检查 exited 后可主动退出，而非依赖 channel drop
2. **进程组清理** — 添加 `nix` 依赖，用 `killpg` 替代单进程 kill，确保子进程的子进程也被清理。`portable_pty` 已做 setsid，需要 spawn 后获取 child 的 pgid
3. **setsid 竞态** — spawn 后等待一小段时间再获取 pgid，或 retry 获取

### 7.3 Mutex 中毒风险

**现状**：`session/mod.rs`、`pty.rs`、`ws/mod.rs` 中大量使用 `.expect("mutex poisoned")` / `.unwrap()` 获取 mutex 锁，任一 panic 会级联崩溃所有后续操作。

**根因**：`pty.rs:1` 和 `session/mod.rs:1` 有全局抑制：
```rust
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
```
这不是个别遗漏，而是**有意识地关闭了安全检查**。受影响的 mutex 包括：`writer`、`master`、`child`、`screen`、`clients`、`input_tx`、`status`、`size`、`cwd_state`、`tauri_on_exit`——覆盖 Session 的全部 Mutex 字段。

**风险链**：如果某线程在持锁期间 panic（如 `VirtualScreen` 序列化 `expect`、索引越界），下一个获取该锁的操作会 panic with "mutex poisoned"，级联到 Tauri command handler 或 WS handler，导致 IPC 调用失败。

**建议**：
1. **移除全局 clippy allow** — 恢复 `clippy::unwrap_used` 和 `clippy::expect_used` lint
2. **逐个替换为 `lock().unwrap_or_else(|e| e.into_inner())`** — 获取 poisoned mutex 的内部数据继续使用，而非 panic。对于 `child`/`writer` 等关键字段，可在 recover 后设置 `exited` 标志
3. **与写入防护合并实施** — mutex poisoning 的常见触发点之一就是对已退出进程的写入 panic，两个问题紧密关联

### 7.4 同步输出模式 (Synchronized Output)

**Ghostty**：实现了 DEC mode 2026，带 **1 秒安全超时**。程序启用同步输出后，渲染暂停直到禁用；如果程序忘记禁用（bug 或崩溃），1 秒后自动重置，防止界面冻结。

**Dinotty**：**未实现**。代码中无 `2026`/`synchronized`/`SyncUpdate`/`BSU`/`ESU` 相关引用，`VirtualScreen`（`vt_screen.rs`）和前端 xterm 配置（`useTerminal.ts:169-211`）均未处理 DECSET/DECRST 2026。xterm.js 也无 first-party synchronized-output addon。

这意味着：
- 使用 `bat`、`lazygit` 等支持同步输出的 TUI 工具时，可能出现闪烁/撕裂
- 由于 dinotty 的输出是直接 broadcast 到 WebSocket，前端 xterm.js 自行渲染，撕裂现象可能不明显
- 但桌面端 PTY→Tauri IPC→WebView 链路更长，无 batching 的逐条 emit 加剧了撕裂风险

**建议**：
- **中期优先级**：实现 mode 2026 + 1s 超时保护，桌面端和 Web 端共享同一后端逻辑
- 实现位置：后端 `VirtualScreen` 跟踪 mode 2026 状态，前端 xterm.js 侧需自行实现帧合并逻辑（xterm.js 无现成 addon）

### 7.5 WS 路径代码重复

`ws/mod.rs` 中 resize、write batch、session 创建逻辑各重复 3 次（`435-444`/`535-547`/`765-776`、`395-405`/`505-513`/`745-754`），代码结构高度相似。这不直接影响用户体验，但增加维护成本——修一处忘另一处的风险高。

**建议**：提取公共函数，消除三处重复。低优先级，但每次修改 WS 路径时应同步处理。

## 8. 更新后的优先级排序

### 高优先级（稳定性）

1. **Session 生命周期安全** — 加 `exited: Mutex<bool>` 标志，写入前检查；移除 `clippy::unwrap_used`/`clippy::expect_used` 全局抑制，逐个替换 `.expect()` 为 `.unwrap_or_else(|e| e.into_inner())`。两个问题紧密关联，应合并实施（~50 行代码）
2. **Resize debounce** — 后端侧 25ms 合并窗口，减少 PTY resize 调用（~30 行代码）。注意：前端已有 rAF 单帧合并，此处补后端跨帧合并
3. **桌面端输出 batching** — Tauri forwarder 逐条 emit（`main.rs:34`），大量输出时性能瓶颈，需 drain 合并。参考 WS 路径已有的 batch 模式（`ws/mod.rs:396-404`）（~30 行）

### 高优先级（可用性）

4. **字体缩放快捷键** — Cmd+=/Cmd+-/Cmd+0（xterm.js 层，两端共有）
5. **Linux 风格复制粘贴** — Ctrl+Shift+C/V（xterm.js 层，两端共有）
6. **桌面端全局快捷键** — Quake 模式唤起/隐藏。需决定 Rust 侧注册（推荐）vs JS 侧调用，然后注册系统级快捷键 + 构建托盘菜单。`tauri-plugin-global-shortcut` 已注册但无绑定，`tray-icon` feature 已启用但无任何 tray 代码
7. **预编辑文本显示** — 中文输入 inline preedit 体验（桌面端 WebView 实现难度高于纯 Web）。注意：系统 IME 候选窗口本身可用，此项为体验优化而非功能缺失

### 中优先级

8. **前端 xterm.js chunked write** — 当前 fire-and-forget，提供 backpressure。但 xterm.js 内部有渲染队列，实际收益取决于 Tauri 侧 batching 是否已实施
9. **进程组清理** — 添加 `nix` 依赖，`killpg` 替代单进程 kill。`portable_pty` 已做 setsid，需跟踪 pgid
10. **Synchronized Output (mode 2026)** — 桌面端 PTY→IPC→WebView 链路更长，TUI 工具撕裂风险高于纯 Web
11. **WS 路径代码去重** — `ws/mod.rs` 中 resize/write/spawn 逻辑各重复 3 次，提取公共函数
