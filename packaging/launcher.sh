#!/usr/bin/env bash
set -euo pipefail

APP_HOME="/opt/tencent-meeting-sdk-linux-demo"
RUNTIME="$APP_HOME/runtime"
SDK_ROOT="$RUNTIME/resources/wemeet-sdk/linux"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "禁止以 root 用户运行腾讯会议 SDK Linux Demo" >&2
  exit 1
fi
if [[ -z "${DISPLAY:-}" ]]; then
  echo "未检测到 X11 DISPLAY；请在启用了 XWayland 的桌面会话启动" >&2
  exit 2
fi
for item in "$RUNTIME/electron" "$SDK_ROOT/wemeet_electron_sdk.node" "$SDK_ROOT/libwemeetsdk.so" "$SDK_ROOT/Release/lib"; do
  [[ -e "$item" ]] || { echo "安装包缺少运行资源: $item" >&2; exit 3; }
done

# 系统补丁会覆盖 LD_LIBRARY_PATH，因此必须先 source，再追加包内 SDK 私有库。
# shellcheck disable=SC1091
source "$APP_HOME/graphics-env.sh"
wemeet_prepare_x11_wayland "$SDK_ROOT"
if [[ "${WEMEET_X11_WAYLAND_PATCH:-}" == 1 ]]; then
  echo "图形栈：系统 Mesa 补丁已生效 (${WEMEET_X11_WAYLAND_PATCH_PATH})" >&2
fi
export TZ="${TZ:-Asia/Shanghai}"

exec "$RUNTIME/electron" --ozone-platform=x11 "$APP_HOME/app" "$@"
