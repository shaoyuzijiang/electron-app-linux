#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="/opt/x11-wayland/x11-ext.sh"
SDK_ROOT="${WEMEET_SDK_ROOT:-$ROOT/output/linux}"

printf 'build env: arch=%s node=%s npm=%s glibc=%s\n' \
  "$(uname -m)" "$(node --version 2>/dev/null || echo missing)" "$(npm --version 2>/dev/null || echo missing)" \
  "$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}' || echo unknown)"
printf 'session: XDG_SESSION_TYPE=%s DISPLAY=%s WAYLAND_DISPLAY=%s\n' \
  "${XDG_SESSION_TYPE:-<unset>}" "${DISPLAY:-<unset>}" "${WAYLAND_DISPLAY:-<unset>}"
printf 'patch: %s %s\n' "$PATCH" "$( [[ -r "$PATCH" ]] && echo readable || echo missing )"
if [[ -r "$PATCH" ]]; then
  sed -n '1,80p' "$PATCH"
fi
if [[ -e /opt/x11-wayland/lib ]]; then
  echo 'patch library directory: present'
else
  echo 'patch library directory: missing (脚本仍可能通过 Mesa 系统路径生效)'
fi

# shellcheck disable=SC1091
source "$ROOT/packaging/graphics-env.sh"
wemeet_prepare_x11_wayland "$SDK_ROOT"
printf 'effective: LD_LIBRARY_PATH=%s\n' "${LD_LIBRARY_PATH:-<unset>}"
if [[ "${LD_PRELOAD+x}" == x ]]; then PRELOAD_STATE="${LD_PRELOAD:-<empty>}"; else PRELOAD_STATE='<unset>'; fi
printf 'effective: QT_QPA_PLATFORM=%s EGL_PLATFORM=%s LD_PRELOAD=%s\n' \
  "${QT_QPA_PLATFORM:-<unset>}" "${EGL_PLATFORM:-<unset>}" "$PRELOAD_STATE"
for library in \
  /usr/lib/aarch64-linux-gnu/libwayland-egl.so.1 \
  /usr/lib/aarch64-linux-gnu/mali/libwayland-egl.so.1 \
  /usr/lib/aarch64-linux-gnu/libEGL.so.1; do
  [[ -e "$library" ]] || continue
  printf 'library: %s -> %s\n' "$library" "$(readlink -f "$library")"
done

for elf in \
  "$ROOT/node_modules/electron/dist/libEGL.so" \
  /usr/lib/aarch64-linux-gnu/libEGL.so.1 \
  "$SDK_ROOT/Release/tmsdkapp" \
  "$SDK_ROOT/Release/lib/libxcast.so"; do
  [[ -f "$elf" ]] || continue
  echo "ELF dynamic section: $elf"
  readelf -d "$elf" 2>/dev/null | grep -E '(NEEDED|RPATH|RUNPATH)' || true
done

if [[ -d /usr/share/glvnd/egl_vendor.d ]]; then
  echo 'GLVND EGL vendor files:'
  grep -H . /usr/share/glvnd/egl_vendor.d/*.json 2>/dev/null || true
fi

echo '要验证实际加载库，请在同一终端执行：'
echo '  LD_DEBUG=libs npm start 2>&1 | tee /tmp/wemeet-lddebug.log'
echo "  grep -nE 'calling init:.*(mali|libEGL|libwayland-egl|tmsdkapp|libxcast)' /tmp/wemeet-lddebug.log"
echo "  grep -nE 'tmsdkapp|QtWebEngineProcess|InitializeStateIng|ipc connect failed' /tmp/wemeet-lddebug.log"
