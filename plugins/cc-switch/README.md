# CC Switch 插件

dinotty 插件，用于快速切换 Claude Code 的 API Provider 配置。基于 [cc-switch](https://github.com/SaladDay/cc-switch-cli) Rust CLI 实现。

## 功能

- 管理多个 Claude Code API Provider（添加、编辑、删除）
- 一键切换当前使用的 Provider
- 从当前 `~/.claude/settings.json` 配置导入为 Provider
- 循环切换到下一个 Provider
- Command Palette 集成（`打开 CC Switch`、`切换到下一个 Provider`、`导入当前配置`）

## 依赖

- **cc-switch CLI**: 需要安装 cc-switch Rust CLI 工具

```bash
# 安装 cc-switch CLI
curl -fsSL https://github.com/SaladDay/cc-switch-cli/releases/latest/download/install.sh | bash

# 或通过 cargo 安装
cargo install cc-switch
```

## 工作原理

通过调用 cc-switch CLI 来管理 Provider 配置：

- 配置存储：`~/.claude/cc_auto_switch_setting.json`（cc-switch CLI 的存储位置）
- 活动配置：`~/.claude/settings.json` 的 `env` 字段

## 数据结构

### Provider

```typescript
interface Provider {
  id: string          // 唯一标识（自动生成）
  name: string        // 显示名称
  base_url: string    // ANTHROPIC_BASE_URL
  auth_token: string  // ANTHROPIC_API_KEY
  model: string       // ANTHROPIC_MODEL
  haiku_model: string // ANTHROPIC_DEFAULT_HAIKU_MODEL（可选，为空则用 model）
  sonnet_model: string // ANTHROPIC_DEFAULT_SONNET_MODEL（可选）
  opus_model: string  // ANTHROPIC_DEFAULT_OPUS_MODEL（可选）
}
```

### providers.json

```json
{
  "providers": [Provider, ...]
}
```

## CLI 接口

`bin/cc-switch` 是对 cc-switch CLI 的封装，提供统一的 JSON 接口：

| 子命令 | 说明 |
|--------|------|
| `list` | 返回 `{ providers: [...] }` |
| `current` | 返回当前 `~/.claude/settings.json` 的 `env` 对象 |
| `switch <alias>` | 将指定 Provider 的配置写入 `~/.claude/settings.json` |
| `add <json>` | 添加新 Provider，返回 `{ ok: true, id: "xxx" }` |
| `update <alias> <json>` | 更新指定 Provider |
| `delete <alias>` | 删除指定 Provider |
| `import` | 从当前 `~/.claude/settings.json` 导入为新 Provider |
| `next` | 循环切换到下一个 Provider |

### Provider 数据结构

```typescript
interface Provider {
  id: string           // alias 名称
  name: string         // 显示名称（与 id 相同）
  auth_token: string   // API Key
  base_url: string     // API Base URL
  model: string        // 主模型
  haiku_model?: string // Haiku 模型
  sonnet_model?: string // Sonnet 模型
  opus_model?: string  // Opus 模型
}
```

## UI 布局

```
┌─────────────────────────────────────────────────┐
│  CC Switch              [导入当前] [切换下一个] [+ 添加] │
├─────────────────────────────────────────────────┤
│  当前配置                                         │
│  https://api.example.com                          │
│  [claude-sonnet-4-20250514]                      │
├─────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────┐  │
│  │ Official Anthropic             [启用] [编辑] [删除]│
│  │ https://api.anthropic.com                  │  │
│  │ [claude-sonnet-4-20250514]                 │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │ MiniMax                       [启用] [编辑] [删除]│
│  │ https://api.minimax.chat                  │  │
│  │ [minimax-01] [Haiku: minimax-haiku]      │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

- 当前使用的 Provider 卡片有蓝色高亮边框 + "使用中" 标签
- 悬停卡片时显示操作按钮
- 点击 "启用" 切换 Provider
- "添加" 展开内联表单（名称、URL、Key、模型字段）

## 目录结构

```
plugins/cc-switch/
├── README.md           # 本文档
├── plugin.json         # 插件清单
├── bin/
│   └── cc-switch       # cc-switch CLI 封装脚本
├── src/
│   └── ui.ts           # TypeScript UI 源码
├── dist/
│   └── main.js         # esbuild 编译产物
└── styles.css          # 样式
```

## 安装

1. 确保已安装 cc-switch CLI：
```bash
curl -fsSL https://github.com/SaladDay/cc-switch-cli/releases/latest/download/install.sh | bash
```

2. 构建插件 UI：
```bash
cd plugins/cc-switch
../../frontend/node_modules/.bin/esbuild src/ui.ts --bundle --format=esm --outfile=dist/main.js --external:none
```

3. 链接插件（开发模式）：
```bash
ln -s $(pwd) ~/.dinotty/plugins/cc-switch
chmod +x ~/.dinotty/plugins/cc-switch/bin/cc-switch
```

## 与原 cc-switch CLI 的关系

本插件是对 [cc-switch-cli](https://github.com/SaladDay/cc-switch-cli) 的前端封装：

| 功能 | cc-switch CLI | 本插件 |
|------|--------------|--------|
| Provider CRUD | ✅ | ✅ |
| Provider 切换 | ✅ | ✅ |
| 配置存储 | SQLite/JSON | ✅ (共用) |
| 预设模板 | ✅ | ❌ (待实现) |
| MCP 管理 | ✅ | ❌ (待实现) |
| 使用统计 | ✅ | ❌ (待实现) |
| **交互式 UI** | ❌ | ✅ (本插件提供) |
