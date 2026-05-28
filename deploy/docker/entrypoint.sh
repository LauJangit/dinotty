#!/bin/sh
set -e

# 将 DINOTTY_PORT 环境变量映射为 --port 参数
PORT="${DINOTTY_PORT:-8999}"

exec "$@" --port "$PORT"
