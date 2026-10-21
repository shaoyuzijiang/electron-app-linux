#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Electron 版本单一来源：package.json（升级 Electron 只改 package.json 一处）
VERSION="$(node -p "require('$ROOT/package.json').devDependencies.electron")"
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "无法从 package.json 解析 Electron 版本" >&2; exit 1; }
# 目标架构（arm64 | x64），默认 arm64
EARCH="${TARGET_ARCH:-arm64}"
case "$EARCH" in arm64) HOST_ARCH="aarch64"; ELF_ARCH="AArch64" ;; x64) HOST_ARCH="x86_64"; ELF_ARCH="x86-64" ;; *) echo "TARGET_ARCH 仅支持 arm64|x64" >&2; exit 1 ;; esac
ARCHIVE="$ROOT/vendor/electron-v${VERSION}-linux-${EARCH}.zip"
PACKAGE_DIR="$ROOT/node_modules/electron"
DIST_DIR="$PACKAGE_DIR/dist"
PATH_FILE="$PACKAGE_DIR/path.txt"
STAGE="$PACKAGE_DIR/.dist-stage.$$"
BACKUP="$PACKAGE_DIR/.dist-backup.$$"
PATH_BACKUP="$PACKAGE_DIR/.path-backup.$$"
COMMITTED=0

fail() { echo "Electron 运行时安装失败: $*" >&2; exit 1; }
rollback() {
  [[ "$COMMITTED" -eq 1 ]] && return
  rm -rf "$STAGE"
  if [[ -e "$BACKUP" ]]; then rm -rf "$DIST_DIR"; mv "$BACKUP" "$DIST_DIR"; fi
  if [[ -e "$PATH_BACKUP" ]]; then rm -f "$PATH_FILE"; mv "$PATH_BACKUP" "$PATH_FILE"; fi
}
trap rollback EXIT INT TERM

[[ "$(id -u)" -ne 0 ]] || fail "禁止使用 root/sudo"
[[ "$(uname -s)" == "Linux" ]] || fail "仅支持 Linux"
[[ "$(uname -m)" == "$HOST_ARCH" ]] || fail "需要 ${HOST_ARCH}（目标 ${EARCH}），当前为 $(uname -m)"
for command in unzip readelf; do command -v "$command" >/dev/null 2>&1 || fail "缺少 $command"; done
[[ -f "$ARCHIVE" ]] || fail "缺少离线运行时: $ARCHIVE"
[[ -d "$PACKAGE_DIR" ]] || fail "请先执行离线 npm ci"
if ! unzip -Z1 "$ARCHIVE" | awk '$0 ~ /^\// { exit 1 } { n=split($0,p,"/"); for(i=1;i<=n;i++) if(p[i]=="..") exit 1 }'; then
  fail "Electron ZIP 包含不安全路径"
fi
rm -rf "$STAGE"
mkdir -p "$STAGE"
unzip -q "$ARCHIVE" -d "$STAGE"
for item in electron chrome-sandbox resources locales; do [[ -e "$STAGE/$item" ]] || fail "ZIP 缺少顶层 $item"; done
MACHINE="$(readelf -h "$STAGE/electron" | awk -F: '/Machine:/ {gsub(/^[[:space:]]+/, "", $2); print $2}')"
[[ "$MACHINE" == *"${ELF_ARCH}"* ]] || fail "Electron 架构不是 ${ELF_ARCH}: $MACHINE"
chmod +x "$STAGE/electron" "$STAGE/chrome-sandbox" "$STAGE/chrome_crashpad_handler" 2>/dev/null || true

rm -rf "$BACKUP" "$PATH_BACKUP"
[[ ! -e "$DIST_DIR" ]] || mv "$DIST_DIR" "$BACKUP"
[[ ! -e "$PATH_FILE" ]] || mv "$PATH_FILE" "$PATH_BACKUP"
mv "$STAGE" "$DIST_DIR"
printf 'electron' > "$PATH_FILE.tmp.$$"
mv -f "$PATH_FILE.tmp.$$" "$PATH_FILE"
[[ -x "$DIST_DIR/electron" ]] || fail "dist/electron 不可执行"
[[ "$(cat "$PATH_FILE")" == "electron" ]] || fail "path.txt 内容无效"

COMMITTED=1
rm -rf "$BACKUP" "$PATH_BACKUP"
trap - EXIT INT TERM
echo "Electron $VERSION Linux ARM64 离线运行时安装完成"
