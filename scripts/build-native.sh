#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/vendor/electron-manifest.json"
ELECTRON_VERSION="$(node -p "require('$MANIFEST').version")"
HEADERS_FILE="$(node -p "require('$MANIFEST').headers.file")"
HEADERS="$ROOT/.electron-headers"
OUT="$ROOT/output/linux"
BUILT="$ROOT/build/Release/wemeet_electron_sdk.node"
TEMP_ADDON="$OUT/.wemeet_electron_sdk.node.$$"
SDK_ARCHIVE="$ROOT/vendor/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz"
SDK_PROVENANCE="$OUT/SDK_SOURCE_PROVENANCE.json"
VERIFY_STAGE="$(mktemp -d)"
cleanup() { rm -rf "$VERIFY_STAGE"; }
trap cleanup EXIT

fail() { echo "原生 addon 编译失败: $*" >&2; exit 1; }
[[ "$(uname -s)" == Linux ]] || fail "只能在 Linux 构建"
[[ "$(uname -m)" == aarch64 ]] || fail "需要 aarch64"
[[ -f /etc/os-release ]] && grep -Eiq 'kylin|银河麒麟' /etc/os-release && grep -Eiq 'V10|VERSION_ID="?10' /etc/os-release || fail "正式 addon 只允许在银河麒麟 V10 基线机构建"
GLIBC_VERSION="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')"
[[ -z "${CFLAGS:-}${CXXFLAGS:-}${CPPFLAGS:-}${LDFLAGS:-}" ]] || fail "正式构建禁止外部 CFLAGS/CXXFLAGS/CPPFLAGS/LDFLAGS"
[[ "$GLIBC_VERSION" == 2.31 ]] || fail "正式 addon 必须在 glibc 2.31 基线机构建，当前为 ${GLIBC_VERSION:-unknown}"
PYTHON_BIN="${PYTHON:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(command -v python3 2>/dev/null || true)"
fi
[[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || fail "未找到可执行 Python 3；请让管理员安装 python3 和 python3-dev"
PYTHON_VERSION="$("$PYTHON_BIN" --version 2>&1 || true)"
[[ "$PYTHON_VERSION" == Python\ 3.* ]] || fail "Python 3 无法运行；请执行 '$PYTHON_BIN --version' 排查或让管理员安装 python3"
# node-gyp 12 内部固定用 Python -c 查询解释器路径和版本。部分麒麟 kysec 策略会阻止该形式，
# 此时用受控 wrapper 将探测转换为临时脚本文件执行；真实 gyp_main.py 仍由系统 Python 运行。
NODE_GYP_PYTHON="$PYTHON_BIN"
if ! "$PYTHON_BIN" -c 'import sys; sys.stdout.write(sys.executable)' >/dev/null 2>&1; then
  NODE_GYP_PYTHON="$ROOT/scripts/python-node-gyp-wrapper.sh"
  export WEMEET_REAL_PYTHON="$PYTHON_BIN"
  echo "检测到 Python -c 受策略限制，node-gyp 将使用兼容 wrapper。"
fi
[[ -x "$NODE_GYP_PYTHON" ]] || fail "node-gyp Python wrapper 不可执行: $NODE_GYP_PYTHON"
export PYTHON="$NODE_GYP_PYTHON"
export npm_config_python="$NODE_GYP_PYTHON"
[[ -f "$HEADERS/include/node/node.h" ]] || fail "缺少离线 Electron headers，请执行 npm run setup:kylin"
[[ -f "$ROOT/native/include/wemeet_sdk.h" ]] || fail "缺少 SDK headers，请执行 npm run setup:kylin"
[[ -f "$OUT/libwemeetsdk.so" && -f "$SDK_PROVENANCE" ]] || fail "缺少可信 SDK 准备结果"
[[ -f "$SDK_ARCHIVE" ]] || fail "缺少固定 SDK 归档"

HEADERS_ARCHIVE_SHA="$(sha256sum "$ROOT/vendor/$HEADERS_FILE" | awk '{print $1}')"
[[ "$HEADERS_ARCHIVE_SHA" == "$(node -p "require('$MANIFEST').headers.sha256")" ]] || fail "headers 归档摘要与供应清单不一致"
tar --no-same-owner --no-same-permissions -xzf "$ROOT/vendor/$HEADERS_FILE" -C "$VERIFY_STAGE"
EXPECTED_HEADERS_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$VERIFY_STAGE/node_headers" .)"
ACTUAL_HEADERS_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$HEADERS" .)"
[[ "$ACTUAL_HEADERS_TREE_SHA" == "$EXPECTED_HEADERS_TREE_SHA" ]] || fail "实际参与编译的 headers 已偏离固定归档"

ACTUAL_RUNTIME_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$OUT" libwemeetsdk.so libwemeet_base.so Release)"
ACTUAL_INCLUDE_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$ROOT/native/include" .)"
[[ "$ACTUAL_RUNTIME_TREE_SHA" == "$(node -p "require('$SDK_PROVENANCE').preparedRuntimeTreeSha256")" ]] || fail "实际 SDK 运行库与准备来源不一致"
[[ "$ACTUAL_INCLUDE_TREE_SHA" == "$(node -p "require('$SDK_PROVENANCE').preparedIncludeTreeSha256")" ]] || fail "实际 SDK headers 与准备来源不一致"
SDK_ARCHIVE_SHA="$(sha256sum "$SDK_ARCHIVE" | awk '{print $1}')"
[[ "$SDK_ARCHIVE_SHA" == "$(node -p "require('$SDK_PROVENANCE').sdkArchiveSha256")" ]] || fail "SDK 归档与准备来源不一致"

cd "$ROOT"
rm -rf build "$OUT/wemeet_electron_sdk.node" "$OUT/ADDON_BUILD_PROVENANCE.json" "$OUT/ELF_COMPATIBILITY.json"
node_modules/.bin/node-gyp rebuild \
  --python="$NODE_GYP_PYTHON" \
  --target="$ELECTRON_VERSION" \
  --arch=arm64 \
  --nodedir="$HEADERS"
[[ -f "$BUILT" ]] || fail "未生成 $BUILT"
MACHINE="$(readelf -h "$BUILT" | awk -F: '/Machine:/ {gsub(/^[[:space:]]+/, "", $2); print $2}')"
[[ "$MACHINE" == *AArch64* ]] || fail "addon 架构不是 AArch64: $MACHINE"
cp -f "$BUILT" "$TEMP_ADDON"
mv -f "$TEMP_ADDON" "$OUT/wemeet_electron_sdk.node"

ADDON_SHA="$(sha256sum "$OUT/wemeet_electron_sdk.node" | awk '{print $1}')"
BUILD_INPUT_SHA="$(node "$ROOT/scripts/hash-tree.js" "$ROOT" binding.gyp native/linux native/include)"
SDK_SOURCE_TREE_SHA="$(node -p "require('$SDK_PROVENANCE').sourceTreeSha256")"
NODE_VERSION="$(node --version)"
NPM_VERSION="$(npm --version)"
PYTHON_VERSION="$PYTHON_VERSION"
NODE_GYP_VERSION="$(node -p "require('./node_modules/node-gyp/package.json').version")"
NODE_GYP_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$ROOT/node_modules/node-gyp" .)"
PACKAGE_LOCK_SHA="$(sha256sum "$ROOT/package-lock.json" | awk '{print $1}')"
NODE_BINARY="$(realpath "$(command -v node)")"
NPM_EXECUTABLE="$(realpath "$(command -v npm)")"
COMPILER_BINARY="$(realpath "$(command -v g++)")"
LINKER_BINARY="$(realpath "$(command -v ld)")"
ASSEMBLER_BINARY="$(realpath "$(command -v as)")"
NODE_BINARY_SHA="$(sha256sum "$NODE_BINARY" | awk '{print $1}')"
NPM_EXECUTABLE_SHA="$(sha256sum "$NPM_EXECUTABLE" | awk '{print $1}')"
COMPILER_SHA="$(sha256sum "$COMPILER_BINARY" | awk '{print $1}')"
LINKER_SHA="$(sha256sum "$LINKER_BINARY" | awk '{print $1}')"
ASSEMBLER_SHA="$(sha256sum "$ASSEMBLER_BINARY" | awk '{print $1}')"
SYSTEM_TOOLCHAIN_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" / usr/include usr/lib/gcc)"
COMPILER="$(g++ --version | head -1)"
OS_RELEASE_SHA="$(sha256sum /etc/os-release | awk '{print $1}')"
OS_PRETTY_NAME="$(. /etc/os-release; printf '%s' "${PRETTY_NAME:-unknown}")"
ADDON_SHA="$ADDON_SHA" BUILD_INPUT_SHA="$BUILD_INPUT_SHA" SDK_ARCHIVE_SHA="$SDK_ARCHIVE_SHA" \
SDK_SOURCE_TREE_SHA="$SDK_SOURCE_TREE_SHA" HEADERS_ARCHIVE_SHA="$HEADERS_ARCHIVE_SHA" \
HEADERS_TREE_SHA="$ACTUAL_HEADERS_TREE_SHA" ELECTRON_VERSION="$ELECTRON_VERSION" NODE_VERSION="$NODE_VERSION" \
NPM_VERSION="$NPM_VERSION" PYTHON_VERSION="$PYTHON_VERSION" NODE_GYP_VERSION="$NODE_GYP_VERSION" \
NODE_GYP_TREE_SHA="$NODE_GYP_TREE_SHA" PACKAGE_LOCK_SHA="$PACKAGE_LOCK_SHA" NODE_BINARY_SHA="$NODE_BINARY_SHA" \
NPM_EXECUTABLE_SHA="$NPM_EXECUTABLE_SHA" COMPILER="$COMPILER" COMPILER_SHA="$COMPILER_SHA" \
LINKER_SHA="$LINKER_SHA" ASSEMBLER_SHA="$ASSEMBLER_SHA" SYSTEM_TOOLCHAIN_TREE_SHA="$SYSTEM_TOOLCHAIN_TREE_SHA" \
CFLAGS="${CFLAGS:-}" CXXFLAGS="${CXXFLAGS:-}" CPPFLAGS="${CPPFLAGS:-}" LDFLAGS="${LDFLAGS:-}" \
GLIBC_VERSION="$GLIBC_VERSION" OS_RELEASE_SHA="$OS_RELEASE_SHA" OS_PRETTY_NAME="$OS_PRETTY_NAME" \
node "$ROOT/scripts/write-addon-provenance.js" "$OUT/ADDON_BUILD_PROVENANCE.json"

echo "原生 addon 编译完成: $OUT/wemeet_electron_sdk.node"
