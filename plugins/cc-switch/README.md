# CC Switch 插件

dinotty 插件，用于快速切换 Claude Code 的 API Provider 配置。参考 [cc-switch](https://github.com/cc-switch) Tauri 桌面应用的核心功能和 UI 布局实现。

## 功能

- 管理多个 Claude Code API Provider（添加、编辑、删除）
- 一键切换当前使用的 Provider
- 从当前 `~/.claude/settings.json` 配置导入为 Provider
- 循环切换到下一个 Provider
- Command Palette 集成（`打开 CC Switch`、`切换到下一个 Provider`）

## 工作原理

直接读写 `~/.claude/settings.json` 的 `env` 字段来切换 Provider 配置：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.example.com",
    "ANTHROPIC_API_KEY": "sk-xxx",
    "ANTHROPIC_MODEL": "claude-sonnet-4-20250514",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-20250514",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-20250514",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-sonnet-4-20250514"
  }
}
```

Provider 列表存储在 `~/.dinotty/plugin-data/cc-switch/providers.json`。

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

`bin/cc-switch` 是一个 bash 脚本，依赖 `jq`：

| 子命令 | 说明 |
|--------|------|
| `list` | 返回 `{ providers: [...] }` |
| `current` | 返回当前 `~/.claude/settings.json` 的 `env` 对象 |
| `switch <id>` | 将指定 Provider 的配置写入 `~/.claude/settings.json` |
| `add <json>` | 添加新 Provider，返回 `{ ok: true, id: "xxx" }` |
| `update <id> <json>` | 更新指定 Provider |
| `delete <id>` | 删除指定 Provider |
| `import` | 从当前 `~/.claude/settings.json` 导入为新 Provider |
| `next` | 循环切换到下一个 Provider |

## UI 布局

```
┌─────────────────────────────────────────────────┐
│  CC Switch              [导入当前] [切换下一个] [+ 添加] │
├─────────────────────────────────────────────────┤
│  当前配置                                         │
│  https://token-plan-cn.xiaomimimo.com/anthropic  │
│  [mimo-v2-pro]                                   │
├─────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────┐  │
│  │ Official Anthropic             [启用] [编辑] [删除]│
│  │ https://api.anthropic.com                  │  │
│  │ [claude-sonnet-4-20250514]                 │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │ Imported  使用中                            │  │
│  │ https://token-plan-cn.xiaomimimo.com/...   │  │
│  │ [mimo-v2-pro] [Haiku: mimo-v2.5-pro]      │  │
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
│   └── cc-switch       # Bash CLI 脚本
├── src/
│   └── ui.ts           # TypeScript UI 源码
├── dist/
│   └── main.js         # esbuild 编译产物
└── styles.css          # 样式
```

## 安装

```bash
# 从源码目录构建
cd plugins/cc-switch
../../frontend/node_modules/.bin/esbuild src/ui.ts --bundle --format=esm --outfile=dist/main.js --external:none

# 复制到插件目录
cp -r . ~/.dinotty/plugins/cc-switch/
chmod +x ~/.dinotty/plugins/cc-switch/bin/cc-switch
```

或使用 dev-link（需要 dinotty 后端运行）：

```bash
ln -s $(pwd) ~/.dinotty/plugins/cc-switch
```

## 与原 cc-switch 的对应关系

| 原 cc-switch（Tauri） | 本插件（dinotty） |
|----------------------|------------------|
| SQLite 数据库 | `providers.json` 文件 |
| Tauri IPC 命令 | `exec.run()` 调用 bash 脚本 |
| React + shadcn/ui | Vue 3 render functions |
| Full-screen Panel | 内联表单 |
| 系统托盘快捷切换 | Command Palette 命令 |
