# Web 预览面板设计

## 背景

用户在手机终端上使用 Claude Code / opencode 开发前端项目时，无法预览开发服务器的页面效果。需要一个内置的 Web 预览能力，让用户不离开 app 即可查看 `localhost:port` 的渲染结果。

## 核心场景

| # | 场景 | 用户行为 | 期望体验 |
|---|------|---------|---------|
| 1 | 前端开发实时预览 | 用 AI 生成页面代码，启动 dev server | 分屏看到页面渲染效果，改代码后自动刷新 |
| 2 | 调试响应式布局 | 需要验证页面在手机上的表现 | 切换不同设备宽度，双指缩放查看细节 |
| 3 | 后端 API 调试 | 写完接口想快速验证返回结果 | 预览面板发送请求，看 JSON 响应 |
| 4 | 静态站点预览 | 生成 markdown/HTML 文档 | 一键预览渲染结果 |
| 5 | 多页面对比 | 同时修改多个页面 | 多端口/多路径预览并排查看 |

## 方案：内置 Web 预览面板 + 端口代理

### 整体架构

```
┌──────────────────────────────────────────────────┐
│  手机浏览器                                        │
│  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  终端面板     │  │  预览面板                  │  │
│  │              │  │  ┌──────────────────────┐ │  │
│  │  $ vite dev  │  │  │ 🔄 localhost:5173/   │ │  │
│  │  > Local:    │  │  ├──────────────────────┤ │  │
│  │  localhost:  │  │  │                      │ │  │
│  │  5173        │  │  │   渲染的页面内容       │ │  │
│  │              │  │  │                      │ │  │
│  │  $ █         │  │  │                      │ │  │
│  └──────────────┘  │  └──────────────────────┘ │  │
│                     │  [375px] [414px] [100%]   │  │
│                     └──────────────────────────┘  │
└──────────────────────────────────────────────────┘
         │                       │
         │ WebSocket             │ HTTP / WS
         ▼                       ▼
┌──────────────────────────────────────────────────┐
│  xterm 后端 (Axum)                                │
│                                                    │
│  /ws              → PTY WebSocket                  │
│  /preview/:port/* → 反向代理 localhost:{port}      │
│  /preview/:port/__hmr → WebSocket 代理 (HMR)      │
│                                                    │
│  PortDetector     → 分析 PTY 输出，识别端口        │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  本地开发服务器                                     │
│  localhost:5173 / localhost:3000 / ...             │
└──────────────────────────────────────────────────┘
```

### 后端设计

#### 1. 端口代理路由（proxy.rs）

新增路由 `ANY /preview/:port/*path`，将请求反向代理到本机对应端口：

**HTTP 代理：**
- 透传所有 HTTP method（GET/POST/PUT/DELETE 等）
- 透传请求 headers、body
- 透传响应 status code、headers、body（流式）
- 处理 `Content-Type` 正确返回（HTML/CSS/JS/图片/字体等）
- 重写响应中的绝对路径引用（`http://localhost:5173/xxx` → `/preview/5173/xxx`）

**WebSocket 代理：**
- 检测 `Upgrade: websocket` 请求头，执行 WS 握手
- 双向透传 WebSocket 帧（支持 Vite HMR / Webpack HMR / Next.js Fast Refresh）
- 代理路径：`/preview/:port/__hmr` → `ws://localhost:{port}/__hmr`

**SSE 代理：**
- 检测 `Accept: text/event-stream`，流式转发 SSE 事件
- 保持连接活跃，支持 Next.js / Webpack 5 的 SSE 热更新

**HTML 响应注入：**
- 在代理返回的 HTML 响应中注入一段脚本，用于：
  - 拦截页面内的 `new WebSocket()` 调用，重写 URL 到代理路径
  - 拦截 `fetch` / `XMLHttpRequest` 中的 localhost 引用
  - 与父窗口（终端面板）通信：页面加载完成、导航变化、错误上报

```javascript
// 注入脚本示意
(function() {
  const PROXY_BASE = '/preview/' + __PORT__ + '/';
  
  // 拦截 WebSocket
  const OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const parsed = new URL(url, location.href);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      url = location.origin + '/preview/' + parsed.port + '/__hmr' + parsed.pathname;
    }
    return new OrigWS(url, protocols);
  };
  
  // 通知父窗口页面就绪
  window.parent.postMessage({ type: 'preview-ready', port: __PORT__ }, '*');
  
  // 捕获未处理错误，上报给终端面板
  window.addEventListener('error', (e) => {
    window.parent.postMessage({ 
      type: 'preview-error', 
      message: e.message, 
      source: e.filename,
      line: e.lineno 
    }, '*');
  });
})();
```

#### 2. 链接点击打开预览（主要交互入口）

终端输出中的 `localhost` / `127.0.0.1` 链接可直接点击，点击后在预览面板中打开，而非在浏览器新标签中打开（手机上 localhost 不可达）。

**实现方式：**
- 使用 xterm.js 的 `WebLinksAddon` 检测终端输出中的 URL
- 自定义 link handler：拦截匹配 `localhost` / `127.0.0.1` / `0.0.0.0` 的链接
- 点击后提取端口和路径，自动打开预览面板并加载 `/preview/{port}/{path}`
- 非本地链接（如 `https://docs.xxx.com`）仍在浏览器中打开

**链接高亮样式：**
- localhost 链接加下划线 + 预览图标提示，区别于普通外部链接
- 长按显示 tooltip："在预览面板中打开"

**常见开发服务器输出示例：**

```
  VITE v5.0.0  ready in 300 ms

  ➜  Local:   http://localhost:5173/     ← 点击直接打开预览
  ➜  Network: http://192.168.1.5:5173/

  ready - started server on 0.0.0.0:3000, url: http://localhost:3000  ← 可点击
```

#### 3. 端口检测器（port_detector.rs）— 辅助入口

作为链接点击的补充，后端仍在 PTY 输出流中扫描端口，用于：
- 用户滚动过了链接看不到时，提供通知入口
- 端口存活状态管理（检测服务关闭）
- 预览面板的端口快速切换列表

在 PTY 输出流中实时扫描，识别开发服务器启动：

**匹配规则（正则）：**

```rust
// 通用模式
r"https?://(localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)"

// 框架特定模式（提高准确率）
r"Local:\s+https?://localhost:(\d+)"          // Vite
r"ready.*started.*on.*:(\d+)"                  // Next.js
r"Server running at.*:(\d+)"                   // 通用
r"Listening on.*:(\d+)"                        // 通用
r"webpack.*compiled.*http://localhost:(\d+)"   // Webpack
```

**检测策略：**
- 去重：同一端口只通知一次（直到端口关闭）
- 延迟确认：检测到端口后等待 500ms，尝试 HTTP HEAD 请求确认服务确实可用
- 端口存活检测：定期（每 10s）检查已知端口是否仍在监听，不在则通知前端移除

#### 4. 端口生命周期管理

```rust
struct PortRegistry {
    // 已检测到的活跃端口
    active_ports: DashMap<u16, PortInfo>,
}

struct PortInfo {
    detected_at: Instant,
    last_checked: Instant,
    source_pane: String,      // 哪个终端 pane 启动的
    framework: Option<String>, // 识别到的框架名称
}
```

### 前端设计

#### 1. 布局模式

**自适应策略（根据屏幕方向 + 用户偏好）：**

| 模式 | 触发条件 | 布局 | 分屏比例 |
|------|---------|------|---------|
| 竖屏分屏 | portrait + 自动 | 上终端 / 下预览 | 40% / 60%（可拖拽） |
| 横屏分屏 | landscape + 自动 | 左终端 / 右预览 | 50% / 50%（可拖拽） |
| 全屏预览 | 用户手动 | 预览独占屏幕 | 浮动返回按钮 |
| 标签模式 | 用户偏好 | 预览作为独立 tab | 底部 tab 切换 |
| 画中画 | 用户手动 | 小窗悬浮在终端上 | 可拖拽、可缩放 |

**分屏拖拽条：**
- 宽度 8px（移动端友好的触摸区域）
- 双击拖拽条：快速切换 50/50 和隐藏预览
- 拖拽时显示百分比提示
- 最小预览高度/宽度：120px（防止误操作完全隐藏）

#### 2. 预览工具栏

```
┌─────────────────────────────────────────────┐
│ ← → 🔄 │ :5173/about        │ ⊡ ▣ ✕ │
├─────────────────────────────────────────────┤
│ [iPhone SE] [iPhone 14] [iPad] [100%] [自定义] │
└─────────────────────────────────────────────┘
```

**控件说明：**

| 控件 | 功能 | 说明 |
|------|------|------|
| ← → | 前进/后退 | 浏览历史导航 |
| 🔄 | 刷新 | 长按可选：普通刷新 / 硬刷新（清缓存） |
| 地址栏 | 显示/输入路径 | 点击可编辑路径部分，端口号可切换 |
| ⊡ | 全屏 | 预览独占屏幕 |
| ▣ | 画中画 | 缩小为悬浮窗 |
| ✕ | 关闭 | 关闭预览面板 |
| 设备宽度 | 模拟设备 | 预设常见设备宽度 |

**设备宽度预设：**

| 名称 | 宽度 | 场景 |
|------|------|------|
| iPhone SE | 375px | 小屏手机 |
| iPhone 14 | 393px | 主流手机 |
| iPhone 14 Pro Max | 430px | 大屏手机 |
| iPad Mini | 768px | 平板 |
| iPad Pro | 1024px | 大平板 |
| 100% | 容器宽度 | 填满预览面板 |
| 自定义 | 用户输入 | 手动输入宽度值 |

#### 3. 端口检测通知 UI

检测到新端口时，从底部滑出 toast 通知：

```
┌──────────────────────────────────────┐
│ 🟢 检测到开发服务器                    │
│ localhost:5173 (Vite)                 │
│                                       │
│     [打开预览]     [忽略]              │
└──────────────────────────────────────┘
```

- 通知 5s 后自动收起（不遮挡操作）
- 如果用户设置了"自动打开预览"，则跳过通知直接打开
- 已忽略的端口不再重复通知（本次会话内）

#### 4. 错误状态处理

| 状态 | 展示 | 操作 |
|------|------|------|
| 端口未启动 | "服务未响应，等待启动..." + 自动轮询 | 每 2s 重试 |
| 加载超时 | "加载超时（>10s）" | [重试] [检查终端] |
| 页面崩溃 | 显示捕获的 JS 错误信息 | [重新加载] [查看控制台] |
| 端口关闭 | "服务已停止" | [关闭预览] [等待重启] |
| 代理错误 | "代理连接失败：{error}" | [重试] |

#### 5. Console 面板（轻量 DevTools）

预览面板底部可展开一个简易控制台，捕获 iframe 内的：

- `console.log/warn/error` 输出
- 未捕获的 JS 异常
- 网络请求失败（通过注入脚本拦截）

```
┌─────────────────────────────────────┐
│  预览页面内容                         │
├─────────────────────────────────────┤
│ ▼ Console (3 errors)                │
│ ❌ TypeError: Cannot read proper... │
│ ❌ Failed to fetch /api/users       │
│ ⚠️  [Deprecation] ...               │
│ > █                                  │
└─────────────────────────────────────┘
```

- 支持在控制台输入 JS 表达式并在 iframe 内执行
- 错误数量 badge 显示在控制台折叠时

### 交互流程

#### 流程 1：点击链接打开预览（主路径）

```
用户操作终端             系统行为                     UI 变化
────────────          ──────────                   ─────────
输入 npm run dev  →   PTY 输出流转发
                      终端渲染 URL 并高亮
                      显示: http://localhost:3000  → 链接加下划线+图标
用户点击链接       →   WebLinksAddon 触发 handler
                      识别为 localhost:3000
                      打开预览面板               →  分屏出现预览面板
                      加载 /preview/3000/        →  iframe 渲染页面
修改代码，保存     →   HMR 通过 WS 代理推送      →  页面自动热更新
```

#### 流程 2：通知入口（链接不可见时）

```
用户操作终端             系统行为                     UI 变化
────────────          ──────────                   ─────────
输入 npm run dev  →   PTY 输出流转发
                      PortDetector 匹配到 :3000
                      用户已滚动，链接不在视野内 →  Toast: "检测到 :3000 [打开预览]"
点击 Toast         →                              分屏打开预览面板
```

#### 流程 3：手动输入端口

```
点击预览按钮       →                              打开预览面板（空白）
                                                  地址栏获得焦点
输入端口 8080     →   HEAD /preview/8080/
                      确认可达               →    加载页面
                      不可达                 →    显示"等待服务启动"
```

### WebSocket 消息协议扩展

| Direction | `type` | Fields | 说明 |
|-----------|--------|--------|------|
| server → client | `port_detected` | `port: u16, framework: Option<String>, pane_id: String` | 检测到新端口 |
| server → client | `port_closed` | `port: u16` | 端口不再可用 |
| client → server | `preview_open` | `port: u16` | 用户打开了预览 |
| client → server | `preview_close` | `port: u16` | 用户关闭了预览 |

### 安全设计

| 层面 | 措施 |
|------|------|
| 端口范围 | 仅代理 1024-65535，拒绝系统端口 |
| 地址限制 | 仅代理 127.0.0.1 / localhost / 0.0.0.0 |
| iframe 沙箱 | `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` |
| CSP | 注入脚本使用 nonce，不降低页面原有 CSP |
| 请求头过滤 | 剥离代理请求中的 Cookie/Auth 头（防止凭据泄漏到被代理服务） |
| 速率限制 | 单端口最大并发请求 50，防止意外 DDoS 本地服务 |
| 超时 | 代理请求 30s 超时，WebSocket 空闲 5min 断开 |

### 性能考量

| 问题 | 方案 |
|------|------|
| 大文件代理（如 source map） | 流式转发，不在内存中缓存整个响应 |
| iframe 内存占用 | 监控内存使用，超阈值提示用户关闭 |
| HMR 频繁更新 | WS 帧直接转发，不做额外处理 |
| 多端口同时代理 | 限制最大同时代理端口数为 5 |
| 移动端渲染性能 | 全屏预览时暂停终端渲染；分屏时降低终端刷新率 |

## 实现优先级

### Phase 1 — 核心可用（MVP）

| 优先级 | 任务 | 预计工作量 |
|--------|------|-----------|
| P0 | HTTP 反向代理路由 `/preview/:port/*` | 后端 1d |
| P0 | 预览 iframe 面板 + 地址栏 + 刷新 | 前端 1d |
| P0 | 竖屏/横屏分屏布局 | 前端 0.5d |
| P0 | 手动输入端口打开预览 | 前端 0.5d |

### Phase 2 — 体验完善

| 优先级 | 任务 | 预计工作量 |
|--------|------|-----------|
| P1 | WebSocket 代理（HMR 支持） | 后端 1d |
| P1 | HTML 注入脚本（WS 重写 + 错误捕获） | 前端 1d |
| P1 | 端口自动检测 + Toast 通知 | 全栈 1d |
| P1 | 拖拽分屏比例 + 全屏模式 | 前端 0.5d |
| P1 | 设备宽度模拟 | 前端 0.5d |

### Phase 3 — 高级功能

| 优先级 | 任务 | 预计工作量 |
|--------|------|-----------|
| P2 | Console 面板（JS 错误捕获 + 日志） | 前端 1.5d |
| P2 | 画中画模式 | 前端 1d |
| P2 | SSE 代理支持 | 后端 0.5d |
| P2 | 多端口管理（预览列表切换） | 全栈 1d |
| P2 | 预览截图/录屏分享 | 全栈 1.5d |

## 与现有功能的集成

| 现有功能 | 集成方式 |
|---------|---------|
| 多标签页（tabs.js） | 预览可作为特殊标签页打开 |
| 分屏（splits.js） | 复用现有分屏机制，预览作为新 pane 类型 |
| 会话持久化（session.rs） | 记住用户上次预览的端口和布局偏好 |
| 设置（settings.rs） | 预览相关配置：自动打开、默认布局、设备宽度 |
| 文件预览（file_preview.rs） | 静态 HTML 文件可直接在预览面板渲染 |

## 配置项

```json
{
  "preview": {
    "auto_open": false,
    "default_layout": "split",
    "default_device": "100%",
    "max_proxy_ports": 5,
    "proxy_timeout_ms": 30000,
    "allowed_ports": [],
    "inject_console": true
  }
}
```
