#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
NEOS_DIR="$ROOT_DIR/neos-client"

export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3131}"
export YGOPRO_PROXY_PORT="${YGOPRO_PROXY_PORT:-7911}"
export YGO_SCRIPT_PATH="${YGO_SCRIPT_PATH:-/home/admin/USTC_YGO_CUBE/ygopro/script}"
export YGOPRO_SCRIPT_PATH="${YGOPRO_SCRIPT_PATH:-$YGO_SCRIPT_PATH}"

# (cd "$NEOS_DIR" && npm run build)

cd "$SERVER_DIR"
exec env \
  NODE_ENV="$NODE_ENV" \
  PORT="$PORT" \
  YGOPRO_PROXY_PORT="$YGOPRO_PROXY_PORT" \
  YGO_SCRIPT_PATH="$YGO_SCRIPT_PATH" \
  YGOPRO_SCRIPT_PATH="$YGOPRO_SCRIPT_PATH" \
  npm start
