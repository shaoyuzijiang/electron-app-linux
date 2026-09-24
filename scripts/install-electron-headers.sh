#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/vendor/electron-manifest.json"
VERSION="$(node -p "require('$MANIFEST').version")"
HEADERS_FILE="$(node -p "require('$MANIFEST').headers.file")"
ARCHIVE="$ROOT/vendor/$HEADERS_FILE"
CHECKSUMS="$ROOT/vendor/ELECTRON_HEADERS_SHA256SUMS"
TARGET="$ROOT/.electron-headers"
STAGE="$ROOT/.electron-headers.stage.$$"

fail() { echo "Electron headers 安装失败: $*" >&2; exit 1; }
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

[[ -f "$ARCHIVE" ]] || fail "缺少 $ARCHIVE"
[[ -f "$CHECKSUMS" ]] || fail "缺少 $CHECKSUMS"
[[ "$(node -p "require('$ROOT/package.json').devDependencies.electron")" == "$VERSION" ]] || fail "package.json 与供应清单版本不一致"
(cd "$ROOT/vendor" && sha256sum -c ELECTRON_HEADERS_SHA256SUMS)
[[ "$(sha256sum "$ARCHIVE" | awk '{print $1}')" == "$(node -p "require('$MANIFEST').headers.sha256")" ]] || fail "headers 摘要与供应清单不一致"
if ! tar -tzf "$ARCHIVE" | awk '$0 ~ /^\// { exit 1 } { n=split($0,p,"/"); for(i=1;i<=n;i++) if(p[i]=="..") exit 1 }'; then
  fail "headers 归档包含不安全路径"
fi
mkdir -p "$STAGE"
tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE" -C "$STAGE"
HEADER_ROOT="$STAGE/node_headers"
[[ -f "$HEADER_ROOT/include/node/node.h" ]] || fail "归档缺少 include/node/node.h"
[[ -f "$HEADER_ROOT/include/node/config.gypi" ]] || fail "归档缺少 config.gypi"
[[ -f "$HEADER_ROOT/include/node/common.gypi" ]] || fail "归档缺少 common.gypi"
rm -rf "$TARGET.old"
[[ ! -e "$TARGET" ]] || mv "$TARGET" "$TARGET.old"
if ! mv "$HEADER_ROOT" "$TARGET"; then
  [[ ! -e "$TARGET.old" ]] || mv "$TARGET.old" "$TARGET"
  fail "无法原子替换 headers"
fi
rm -rf "$TARGET.old"
echo "Electron $VERSION 编译头文件离线安装完成: $TARGET"
