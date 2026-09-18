#!/bin/sh
set -eu
if [ -z "${SUPERCHARGE_PASSWORD:-}" ]; then
  echo "Set SUPERCHARGE_PASSWORD" >&2
  exit 1
fi
export HOME="${HOME:-/home/supercharge}"
export SUPERCHARGE_HOME="${SUPERCHARGE_HOME:-$HOME/.supercharge}"
export SUPERCHARGE_WORKSPACE="${SUPERCHARGE_WORKSPACE:-/workspace}"
mkdir -p "$HOME" "$SUPERCHARGE_HOME" "$SUPERCHARGE_WORKSPACE"
cd "$SUPERCHARGE_WORKSPACE"
if command -v supercharge >/dev/null 2>&1 && supercharge agent daemon --help >/dev/null 2>&1; then
  exec supercharge agent --always-approve daemon --bind 0.0.0.0:6767 --secret "$SUPERCHARGE_PASSWORD"
fi
exec node /opt/supercharge-daemon/daemon.mjs
