# Notification System

Dinotty has a built-in notification system supporting terminal bell detection and custom notification push, designed for AI agent and automation tool integration.

## HTTP API

Send notifications via `POST /api/notify`:

```bash
curl -s -X POST http://127.0.0.1:8999/api/notify \
  -H "Content-Type: application/json" \
  -d '{"body": "Task completed", "title": "My Agent", "notification_type": "info"}'
```

Request body fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `body` | string | ✅ | Notification body |
| `title` | string | ❌ | Notification title |
| `pane_id` | string | ❌ | Associated pane ID |
| `notification_type` | string | ❌ | Type: `info` (default) / `warning` / `error` |

## Claude Code Integration

When running Claude Code in a dinotty terminal, you can use hooks to automatically send notifications at key moments:

```jsonc
// .claude/settings.json
{
  "hooks": {
    "Notification": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:8999/api/notify -H 'Content-Type: application/json' -d '{\"body\":\"Claude needs your input\",\"title\":\"Claude Code\",\"notification_type\":\"warning\"}'" }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:8999/api/notify -H 'Content-Type: application/json' -d '{\"body\":\"Task completed\",\"title\":\"Claude Code\",\"notification_type\":\"info\"}'" }]
    }]
  }
}
```

| Hook | Purpose |
|------|---------|
| `Notification` | Alert when Claude needs user input or permission confirmation |
| `Stop` | Alert when a task completes |

Other AI agents and automation scripts can also call the HTTP API to send notifications without additional configuration.

## Notification Command Hooks

You can configure shell commands in Settings that execute automatically when notification events fire. Useful for triggering system-level alerts (e.g., macOS `osascript`, `notify-send`, etc.).

## Open API (External Device Control)

The `POST /api/input` endpoint allows external devices (Stream Deck, iOS Shortcuts, automation scripts, etc.) to send input to the terminal for remote control.

Open API must be enabled in Settings.

```bash
# Send input to the active pane
curl -X POST http://127.0.0.1:8999/api/input \
  -H "Content-Type: application/json" \
  -d '{"data": "ls -la\n"}'

# Send input to a specific pane
curl -X POST http://127.0.0.1:8999/api/input \
  -H "Content-Type: application/json" \
  -d '{"data": "echo hello\n", "pane_id": "pane-1"}'
```
