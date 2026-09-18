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
exec node /opt/supercharge-daemon/daemon.mjs
