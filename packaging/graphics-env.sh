#!/usr/bin/env bash

# 腾讯会议 Linux SDK 仅支持 X11。麒麟 Wayland 会话需先执行系统厂商的
# x11-wayland 补丁，使 Mesa EGL/Wayland 库优先于 Mali 厂商栈；之后再追加 SDK 私有库。
wemeet_prepare_x11_wayland() {
  local sdk_root="$1"
  local sdk_lib="$sdk_root/Release/lib"
  local patch="/opt/x11-wayland/x11-ext.sh"
  local was_wayland=0

  if [[ "${XDG_SESSION_TYPE:-}" == "wayland" || -n "${WAYLAND_DISPLAY:-}" ]]; then
    was_wayland=1
  fi
  if [[ "$was_wayland" -eq 1 && "${WEMEET_X11_WAYLAND_PATCH:-}" != 1 ]]; then
    if [[ -f "$patch" ]]; then
      if [[ "${WEMEET_SYSTEM_X11_WAYLAND:-1}" == "1" ]]; then
        if [[ "$(stat -c %U "$patch" 2>/dev/null || echo unknown)" != "root" ]]; then
          echo "警告: $patch 属主不是 root，已跳过加载" >&2
        else
          # shellcheck disable=SC1090
          . "$patch"
          export WEMEET_X11_WAYLAND_PATCH=1
          export WEMEET_X11_WAYLAND_PATCH_PATH="$patch"
          echo "已加载麒麟 XWayland 补丁: $patch" >&2
        fi
      fi
    else
      echo "警告：当前为 Wayland 会话，但缺少麒麟补丁 $patch；请安装或联系麒麟厂商补齐，不要在应用层继续加参数。" >&2
    fi
  fi

  # 官方手册要求：SDK 私有路径必须排在 LD_LIBRARY_PATH 最前，防止 Release/lib
  # 内与系统重名的库被系统版本抢占导致 tmsdkapp 启动失败（ipc connect failed）。
  # EGL/Wayland-EGL 不在 Release/lib 中，仍会按补丁路径解析到 Mesa。
  # 补丁是覆盖式赋值，必须先 source 再前插私有路径。
  export LD_LIBRARY_PATH="$sdk_root:$sdk_lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export PATH="$sdk_root/Release:${PATH:-}"
  export QT_PLUGIN_PATH="$sdk_root/Release/plugins"
  export QT_QPA_PLATFORM=xcb
  export EGL_PLATFORM=x11
  export LD_PRELOAD=
  export XDG_SESSION_TYPE=x11
  unset WAYLAND_DISPLAY
}
