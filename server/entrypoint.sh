#!/bin/sh
set -eu

PASSWORD="${SUPERCHARGE_PASSWORD:-}"
if [ -z "$PASSWORD" ]; then
  echo "Set SUPERCHARGE_PASSWORD before starting the server." >&2
  exit 1
fi

export HOME="${HOME:-/home/supercharge}"
export SUPERCHARGE_HOME="${SUPERCHARGE_HOME:-$HOME/.supercharge}"
mkdir -p "$HOME" "$SUPERCHARGE_HOME" /workspace
cd /workspace

BIND="${SUPERCHARGE_AGENT_BIND:-127.0.0.1:2419}"
MODEL="${SUPERCHARGE_MODEL:-}"

echo "Supercharge server: agent on $BIND, web UI on :6767"

set -- supercharge agent --always-approve serve --bind "$BIND" --secret "$PASSWORD"
if [ -n "$MODEL" ]; then
  set -- supercharge agent --always-approve --model "$MODEL" serve --bind "$BIND" --secret "$PASSWORD"
fi

"$@" &
agent_pid=$!

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

term() {
  kill "$agent_pid" "$caddy_pid" 2>/dev/null || true
  wait || true
}
trap term INT TERM

wait "$agent_pid" "$caddy_pid"
