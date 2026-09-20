#!/usr/bin/env bash
# Repack the Tauri Debian bundle as an Arch Linux binary package.
# Usage: bash scripts/package-arch-linux.sh v0.2.40 [path/to/Supercharge_VERSION_amd64.deb]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="${1:-${TAG:-}}"
if [[ -z "$TAG" ]]; then
  TAG="v$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')"
fi
VER="${TAG#v}"
DEB="${2:-}"
if [[ -z "$DEB" ]]; then
  DEB="$(find src-tauri/target/release/bundle/deb -maxdepth 1 -type f -name "Supercharge_${VER}_amd64.deb" -print -quit 2>/dev/null || true)"
fi
if [[ -z "$DEB" || ! -f "$DEB" ]]; then
  echo "error: Supercharge ${VER} amd64 .deb not found" >&2
  exit 1
fi
for tool in dpkg-deb tar zstd; do
  command -v "$tool" >/dev/null || { echo "error: $tool is required" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ROOTFS="$WORK/root"
mkdir -p "$ROOTFS"
dpkg-deb -x "$DEB" "$ROOTFS"

BIN="$ROOTFS/usr/bin/supercharge-app"
DESKTOP="$ROOTFS/usr/share/applications/Supercharge.desktop"
[[ -x "$BIN" ]] || { echo "error: package binary missing" >&2; exit 1; }
[[ -f "$DESKTOP" ]] || { echo "error: desktop entry missing" >&2; exit 1; }
grep -q '^Exec=supercharge-app' "$DESKTOP" || {
  echo "error: desktop entry does not launch supercharge-app" >&2
  exit 1
}

install -Dm644 LICENSE "$ROOTFS/usr/share/licenses/supercharge-app-bin/LICENSE"

SIZE_KIB="$(du -sk "$ROOTFS" | awk '{print $1}')"
EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || date +%s)}"
cat > "$ROOTFS/.PKGINFO" <<EOF
pkgname = supercharge-app-bin
pkgbase = supercharge-app-bin
pkgver = ${VER}-1
pkgdesc = Supercharge desktop workbench for local coding agents
url = https://github.com/iotserver24/supercharge-app
builddate = ${EPOCH}
packager = Supercharge contributors
size = $((SIZE_KIB * 1024))
arch = x86_64
license = MIT
provides = supercharge-app
conflict = supercharge-app
depend = webkit2gtk-4.1
depend = gtk3
depend = libayatana-appindicator
depend = librsvg
depend = openssl
EOF

OUT="Supercharge-${VER}-1-x86_64.pkg.tar.zst"
# Deterministic metadata/order for reproducible CI rebuilds. Keep .PKGINFO at
# the archive root (not ./PKGINFO); pacman rejects packages without that name.
(
  cd "$ROOTFS"
  find . -mindepth 1 -printf '%P\n' | LC_ALL=C sort \
    | tar --no-recursion -T - --mtime="@${EPOCH}" --owner=0 --group=0 \
        --numeric-owner --format=posix -cf -
) | zstd -T0 -19 -f -o "$OUT"

tar --zstd -tf "$OUT" >/dev/null
ls -lah "$OUT"
