#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/output/linux"

if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "当前仅支持 aarch64，实际架构: $(uname -m)"
  exit 2
fi

required=(
  "$OUT/wemeet_electron_sdk.node"
  "$OUT/libwemeetsdk.so"
  "$OUT/libwemeet_base.so"
  "$OUT/Release/lib"
  "$OUT/Release/plugins/platforms/libqxcb.so"
  "$OUT/Release/QtWebEngineProcess"
  "$OUT/Release/tmsdkapp"
  "$ROOT/node_modules/.bin/electron"
  "$ROOT/node_modules/electron/dist/electron"
  "$ROOT/node_modules/electron/path.txt"
)
for item in "${required[@]}"; do
  if [[ ! -e "$item" ]]; then
    echo "缺少运行资源: $item"
    echo "请先执行 npm run setup:kylin；不要在麒麟直接运行 npm install"
    exit 3
  fi
done

if [[ -z "${DISPLAY:-}" ]]; then
  echo "当前没有 X11 DISPLAY；麒麟 Wayland 会话需要启用 XWayland。"
  exit 4
fi
if command -v xdpyinfo >/dev/null 2>&1 && ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
  echo "无法连接 X11 DISPLAY=$DISPLAY，请检查 XWayland。"
  exit 5
fi

# 先加载麒麟系统的 X11-Wayland Mesa 补丁，再追加 SDK 私有库；顺序错误会重新命中 mali/libwayland-egl.so.1。
# shellcheck disable=SC1091
source "$ROOT/packaging/graphics-env.sh"
wemeet_prepare_x11_wayland "$OUT"
if [[ "${WEMEET_X11_WAYLAND_PATCH:-}" == 1 ]]; then
  echo "图形栈：系统 Mesa 补丁已生效 (${WEMEET_X11_WAYLAND_PATCH_PATH})" >&2
fi
export TZ="${TZ:-Asia/Shanghai}"
if locale -a 2>/dev/null | grep -qi '^zh_CN\.utf-\?8$'; then
  export LC_ALL="zh_CN.UTF-8"
elif locale -a 2>/dev/null | grep -qi '^C\.utf-\?8$'; then
  export LC_ALL="C.UTF-8"
else
  export LC_ALL="C"
fi

exec "$ROOT/node_modules/.bin/electron" --ozone-platform=x11 "$ROOT"
