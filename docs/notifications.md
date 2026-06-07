# 通知系统

dinotty 内建通知系统，支持终端 bell 检测和自定义通知推送，适用于 AI agent 和自动化工具集成。

## HTTP API

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

## 与 Claude Code 集成

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

## 通知命令钩子

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
