#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Electron 版本单一来源：package.json（升级 Electron 只改 package.json 一处；
# package.json 内 build:native:* 的 --target 需人工同步，见 EXECUTION_PLAN 版本红线）
ELECTRON_VERSION="$(node -p "require('$ROOT/package.json').devDependencies.electron")"
HEADERS_FILE="node-v${ELECTRON_VERSION}-headers.tar.gz"
HEADERS="$ROOT/.electron-headers"
OUT="$ROOT/output/linux"
BUILT="$ROOT/build/Release/wemeet_electron_sdk.node"
TEMP_ADDON="$OUT/.wemeet_electron_sdk.node.$$"

fail() { echo "原生 addon 编译失败: $*" >&2; exit 1; }
# 目标架构（arm64 | x64），默认 arm64；x64 需在 x86 银河麒麟基线机构建
TARGET_ARCH="${TARGET_ARCH:-arm64}"
case "$TARGET_ARCH" in arm64) HOST_ARCH="aarch64"; ELF_ARCH="AArch64" ;; x64) HOST_ARCH="x86_64"; ELF_ARCH="x86-64" ;; *) fail "TARGET_ARCH 仅支持 arm64|x64: $TARGET_ARCH" ;; esac
[[ "$(uname -s)" == Linux ]] || fail "只能在 Linux 构建"
[[ "$(uname -m)" == "$HOST_ARCH" ]] || fail "需要 ${HOST_ARCH}（构建目标 ${TARGET_ARCH}），当前 $(uname -m)"
# 基线防线：默认仅允许银河麒麟 V10；容器化 CI 构建可设 ADDON_BASELINE_OVERRIDE=1
# 显式声明基线（glibc 2.31 检查永远保留，不因覆盖而放宽）
if [[ -n "${ADDON_BASELINE_OVERRIDE:-}" ]]; then
  echo "基线覆盖模式：${ADDON_BASELINE_OVERRIDE}（Kylin 检查跳过，glibc 检查保留）"
else
  [[ -f /etc/os-release ]] && grep -Eiq 'kylin|银河麒麟' /etc/os-release && grep -Eiq 'V10|VERSION_ID="?10' /etc/os-release || fail "正式 addon 只允许在银河麒麟 V10 基线机构建（容器 CI 可设 ADDON_BASELINE_OVERRIDE=<说明>）"
fi
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
[[ -f "$OUT/libwemeetsdk.so" && -f "$OUT/libwemeet_base.so" ]] || fail "缺少 SDK 运行库，请执行 npm run setup:kylin"

cd "$ROOT"
rm -rf build "$OUT/wemeet_electron_sdk.node" "$OUT/ADDON_BUILD_PROVENANCE.json" "$OUT/ELF_COMPATIBILITY.json"
node_modules/.bin/node-gyp rebuild \
  --python="$NODE_GYP_PYTHON" \
  --target="$ELECTRON_VERSION" \
  --arch="$TARGET_ARCH" \
  --nodedir="$HEADERS"
[[ -f "$BUILT" ]] || fail "未生成 $BUILT"
MACHINE="$(readelf -h "$BUILT" | awk -F: '/Machine:/ {gsub(/^[[:space:]]+/, "", $2); print $2}')"
# readelf Machine 命名大小写不一（AArch64 / X86-64），统一大小写不敏感匹配
if ! echo "$MACHINE" | grep -qi "${ELF_ARCH}"; then
  fail "addon 架构不是 ${ELF_ARCH}: $MACHINE"
fi
cp -f "$BUILT" "$TEMP_ADDON"
mv -f "$TEMP_ADDON" "$OUT/wemeet_electron_sdk.node"

echo "原生 addon 编译完成: $OUT/wemeet_electron_sdk.node (Electron $ELECTRON_VERSION)"
