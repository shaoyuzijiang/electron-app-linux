#!/usr/bin/env bash
# 统一检测入口：环境、构建产物、DEB、图形要点，一次跑完。
# 用法:
#   bash scripts/check.sh            # 全部适用检查
#   bash scripts/check.sh --verbose  # 附带图形环境详细诊断
#   bash scripts/check.sh --deb /path/to.deb   # 只查指定 DEB
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/output/linux"
ELECTRON_DIST="$ROOT/node_modules/electron/dist"
FAILED=0
VERBOSE=0
DEB_ONLY=0
ONLY_DEB=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose) VERBOSE=1; shift ;;
    --deb)
      DEB_ONLY=1
      shift
      if [[ $# -gt 0 && "$1" != --* ]]; then ONLY_DEB="$1"; shift; fi
      ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

ok() { echo "OK    $*"; }
fail_check() { echo "FAIL  $*" >&2; FAILED=1; }
require_file() { [[ -f "$1" ]] && ok "$1" || fail_check "缺少文件 $1"; }
require_exec() { [[ -x "$1" ]] && ok "$1" || fail_check "不可执行 $1"; }
version_le() { [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" == "$2" ]]; }

# ---------- 1. 环境 ----------
if [[ "$DEB_ONLY" -eq 0 ]]; then
  [[ "$(id -u)" -ne 0 ]] && ok "普通用户 $(id -un)" || fail_check "禁止使用 root/sudo 运行"
  [[ "$(uname -s)" == Linux ]] && ok "系统 Linux" || fail_check "当前不是 Linux"
  case "$(uname -m)" in aarch64|x86_64) ok "架构 $(uname -m)" ;; *) fail_check "架构必须为 aarch64/x86_64，当前 $(uname -m)" ;; esac
  if [[ -f /etc/os-release ]] && grep -Eiq 'kylin|银河麒麟' /etc/os-release && grep -Eiq 'V10|VERSION_ID="?10' /etc/os-release; then
    ok "银河麒麟 V10"
  else
    fail_check "正式基线必须为银河麒麟 V10"
  fi
  GLIBC_VERSION="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}' || true)"
  [[ "$GLIBC_VERSION" == 2.31 ]] && ok "glibc 2.31" || fail_check "glibc 必须为 2.31，当前 ${GLIBC_VERSION:-unknown}"

  for command in node npm python3 make g++ ld as realpath tar unzip file readelf strings timeout awk grep getconf; do
    command -v "$command" >/dev/null 2>&1 && ok "命令 $command" || fail_check "缺少命令 $command"
  done

  NODE_VERSION="$(node --version 2>/dev/null || true)"
  NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
  [[ "$NODE_MAJOR" =~ ^[0-9]+$ && "$NODE_MAJOR" -ge 22 && "$NODE_MAJOR" -lt 25 ]] && ok "Node $NODE_VERSION" || fail_check "Node 必须 >=22.12 且 <25，当前 ${NODE_VERSION:-unknown}"
  NPM_MAJOR="$(npm --version 2>/dev/null | cut -d. -f1)"
  [[ "$NPM_MAJOR" =~ ^[0-9]+$ && "$NPM_MAJOR" -ge 10 ]] && ok "npm $(npm --version)" || fail_check "npm 必须 >=10"
  PYTHON_VERSION="$(python3 --version 2>&1 || true)"
  [[ "$PYTHON_VERSION" == Python\ 3.* ]] && ok "$PYTHON_VERSION" || fail_check "Python 3 无法运行；请安装或修复 python3、python3-dev"
  CPP_TEST="$(mktemp /tmp/wemeet-cpp2a.XXXXXX.o)"
  if g++ -std=gnu++2a -x c++ -c /dev/null -o "$CPP_TEST" >/dev/null 2>&1; then
    ok "GCC 支持 -std=gnu++2a"
  else
    fail_check "当前 GCC 不支持 Linux SDK addon 所需的 C++20 别名 -std=gnu++2a"
  fi
  rm -f "$CPP_TEST"

  # ---------- 2. 构建产物 ----------
  if [[ -d "$OUT" ]]; then
    KEY_FILES=(
      "$ELECTRON_DIST/electron"
      "$OUT/wemeet_electron_sdk.node"
      "$OUT/libwemeetsdk.so"
      "$OUT/libwemeet_base.so"
      "$OUT/Release/QtWebEngineProcess"
      "$OUT/Release/tmsdkapp"
      "$OUT/Release/plugins/platforms/libqxcb.so"
      "$ROOT/node_modules/electron/path.txt"
    )
    for file in "${KEY_FILES[@]}"; do require_file "$file"; done
    require_exec "$ELECTRON_DIST/electron"
    require_exec "$OUT/Release/QtWebEngineProcess"
    require_exec "$OUT/Release/tmsdkapp"
    [[ "$(cat "$ROOT/node_modules/electron/path.txt" 2>/dev/null)" == electron ]] && ok "Electron path.txt" || fail_check "Electron path.txt 无效"

    while IFS= read -r -d '' file; do
      if file -b "$file" | grep -q ELF; then printf '%s\0' "$file"; fi
    done < <(find "$ELECTRON_DIST" "$OUT" -type f -print0) > "$TMP/elf.list"
    [[ -s "$TMP/elf.list" ]] || fail_check "未找到 ELF 运行文件"

    # 不调用 ldd：麒麟安全认证会将 SDK 私有 Qt 库的 ldd 探测识别为未认证执行并反复弹窗。
    # 依赖由 readelf NEEDED + 交付目录 + ldconfig 缓存静态解析，不会执行任何 SDK/Qt/Electron 二进制。
    if ! bash "$ROOT/scripts/resolve-elf-dependencies.sh" --system-libraries "$ELECTRON_DIST" "$OUT" > "$TMP/system-libraries"; then
      fail_check "静态动态库依赖不完整"
    fi

    : > "$TMP/glibc.versions"; : > "$TMP/glibcxx.versions"; : > "$TMP/cxxabi.versions"
    grep -E '/libstdc\+\+\.so\.6$' "$TMP/system-libraries" | sort -u > "$TMP/libstdcxx.paths" || true
    while IFS= read -r -d '' file; do
      machine="$(readelf -h "$file" 2>/dev/null | awk -F: '/Machine:/ {gsub(/^[[:space:]]+/, "", $2); print $2}')"
      case "$machine" in *AArch64*|*x86-64*) ;; *) fail_check "架构错误 $file: ${machine:-unknown}" ;; esac
      readelf --version-info "$file" 2>/dev/null | grep -oE 'GLIBC_[0-9]+(\.[0-9]+)+' | sed 's/^GLIBC_//' >> "$TMP/glibc.versions" || true
      readelf --version-info "$file" 2>/dev/null | grep -oE 'GLIBCXX_[0-9]+(\.[0-9]+)+' | sed 's/^GLIBCXX_//' >> "$TMP/glibcxx.versions" || true
      readelf --version-info "$file" 2>/dev/null | grep -oE 'CXXABI_[0-9]+(\.[0-9]+)+' | sed 's/^CXXABI_//' >> "$TMP/cxxabi.versions" || true
    done < "$TMP/elf.list"

    MAX_GLIBC="$(sort -Vu "$TMP/glibc.versions" | tail -1)"
    if [[ -n "$MAX_GLIBC" ]] && version_le "$MAX_GLIBC" 2.31; then ok "全部 ELF 最高 GLIBC_$MAX_GLIBC"; else
      fail_check "ELF 要求 GLIBC_${MAX_GLIBC:-unknown}，超过目标 2.31"
    fi
    MAX_GLIBCXX="$(sort -Vu "$TMP/glibcxx.versions" | tail -1)"
    MAX_CXXABI="$(sort -Vu "$TMP/cxxabi.versions" | tail -1)"
    sort -u "$TMP/libstdcxx.paths" -o "$TMP/libstdcxx.paths"
    : > "$TMP/available-glibcxx"; : > "$TMP/available-cxxabi"
    while IFS= read -r library; do
      [[ -f "$library" ]] || continue
      strings "$library" | grep -oE '^GLIBCXX_[0-9]+(\.[0-9]+)+$' | sed 's/^GLIBCXX_//' | sort -Vu | tail -1 >> "$TMP/available-glibcxx" || true
      strings "$library" | grep -oE '^CXXABI_[0-9]+(\.[0-9]+)+$' | sed 's/^CXXABI_//' | sort -Vu | tail -1 >> "$TMP/available-cxxabi" || true
    done < "$TMP/libstdcxx.paths"
    AVAILABLE_GLIBCXX="$(sort -Vu "$TMP/available-glibcxx" | head -1)"
    AVAILABLE_CXXABI="$(sort -Vu "$TMP/available-cxxabi" | head -1)"
    [[ -z "$MAX_GLIBCXX" || -n "$AVAILABLE_GLIBCXX" ]] || fail_check "ELF 需要 GLIBCXX，但运行时未解析到 libstdc++.so.6"
    [[ -z "$MAX_CXXABI" || -n "$AVAILABLE_CXXABI" ]] || fail_check "ELF 需要 CXXABI，但运行时未解析到 libstdc++.so.6"
    if [[ -z "$MAX_GLIBCXX" ]] || { [[ -n "$AVAILABLE_GLIBCXX" ]] && version_le "$MAX_GLIBCXX" "$AVAILABLE_GLIBCXX"; }; then
      ok "GLIBCXX 兼容"
    else
      fail_check "GLIBCXX 版本超出构建基线"
    fi
    if [[ -z "$MAX_CXXABI" ]] || { [[ -n "$AVAILABLE_CXXABI" ]] && version_le "$MAX_CXXABI" "$AVAILABLE_CXXABI"; }; then
      ok "CXXABI 兼容"
    else
      fail_check "CXXABI 版本超出构建基线"
    fi

    USERNS_OK=0
    if command -v unshare >/dev/null 2>&1 && timeout 10 unshare --user --map-root-user true >/dev/null 2>&1; then USERNS_OK=1; fi
    if [[ "$USERNS_OK" == 1 ]]; then
      ok "当前用户可实际创建 user namespace"
    else
      SANDBOX="$ELECTRON_DIST/chrome-sandbox"
      OWNER="$(stat -c %u "$SANDBOX" 2>/dev/null || echo -1)"
      MODE="$(stat -c %a "$SANDBOX" 2>/dev/null || echo 0)"
      [[ "$OWNER" == 0 && "$MODE" == 4755 ]] && ok "Chromium SUID sandbox 可用" || fail_check "Chromium sandbox 不可用：请由管理员启用 user namespace；不要使用 --no-sandbox"
    fi
  else
    echo "SKIP  尚无构建产物（output/linux），跳过构建检查"
  fi
fi

# ---------- 3. DEB ----------
DEB="${ONLY_DEB:-$(ls "$ROOT"/dist-demo/*.deb 2>/dev/null | head -1 || true)}"
if [[ "$DEB_ONLY" -eq 1 || -n "$DEB" ]]; then
  PACKAGE_NAME="tencent-meeting-sdk-linux-demo"
  VERSION="$(node -p "require('$ROOT/package.json').version")"
  [[ -n "$DEB" && -f "$DEB" ]] || fail_check "找不到 DEB（请传入路径或先在 dist-demo/ 生成产物）"
  command -v dpkg-deb >/dev/null 2>&1 || fail_check "缺少 dpkg-deb，无法静态检查 DEB"
  if [[ -f "$DEB" ]] && command -v dpkg-deb >/dev/null 2>&1; then
    CONTROL="$(dpkg-deb --field "$DEB")"
    grep -Fx "Package: $PACKAGE_NAME" <<<"$CONTROL" >/dev/null || fail_check "包名错误"
    grep -Fx "Version: $VERSION" <<<"$CONTROL" >/dev/null || fail_check "版本错误"
    DEB_ARCH="$(awk -F': ' '$1 == "Architecture" { print $2 }' <<<"$CONTROL")"
    case "$DEB_ARCH" in
      arm64) EXPECTED_LINUX_ARCH="arm64"; EXPECTED_ELF_PATTERN='AArch64|ARM aarch64'; EXPECTED_SUFFIX='-arm64.deb' ;;
      amd64) EXPECTED_LINUX_ARCH="x64"; EXPECTED_ELF_PATTERN='X86-64|x86-64|x86_64'; EXPECTED_SUFFIX='-x64.deb' ;;
      *) EXPECTED_LINUX_ARCH=""; EXPECTED_ELF_PATTERN='a^'; EXPECTED_SUFFIX=''; fail_check "架构错误: ${DEB_ARCH:-missing}" ;;
    esac
    [[ -n "$EXPECTED_SUFFIX" && "$(basename "$DEB")" == *"$EXPECTED_SUFFIX" ]] || fail_check "文件名与 Architecture 不一致: $(basename "$DEB") / $DEB_ARCH"
    grep -F "Description: 银河麒麟 ${EXPECTED_LINUX_ARCH} 腾讯会议 SDK Electron Demo" <<<"$CONTROL" >/dev/null || fail_check "Description 架构错误"
    for dependency in libegl1 libpulse0; do
      grep -E "^Depends: .*(^|, )${dependency}(,|$)" <<<"$CONTROL" >/dev/null || fail_check "缺少 SDK 运行依赖: $dependency"
    done
    CONTROL_SDK_VERSION="$(sed -n 's/^ Demo package using Electron .* and Tencent Meeting SDK \([0-9][0-9.]*\)\.$/\1/p' <<<"$CONTROL")"
    [[ -n "$CONTROL_SDK_VERSION" ]] || fail_check "Description 缺少 SDK 版本"
    grep -F 'Backend security tests were not run for this demo artifact.' <<<"$CONTROL" >/dev/null || fail_check "缺少 Demo 用途边界声明"

    DEB_ROOT="$TMP/deb-root"
    mkdir -p "$DEB_ROOT"
    dpkg-deb -x "$DEB" "$DEB_ROOT"
    APP_ROOT="$DEB_ROOT/opt/$PACKAGE_NAME"
    required=(
      "$APP_ROOT/runtime/electron"
      "$APP_ROOT/runtime/resources/wemeet-sdk/linux/wemeet_electron_sdk.node"
      "$APP_ROOT/runtime/resources/wemeet-sdk/linux/libwemeetsdk.so"
      "$APP_ROOT/runtime/resources/wemeet-sdk/linux/libwemeet_base.so"
      "$APP_ROOT/runtime/resources/wemeet-sdk/linux/Release/QtWebEngineProcess"
      "$APP_ROOT/runtime/resources/wemeet-sdk/linux/Release/tmsdkapp"
      "$APP_ROOT/app/main.js"
      "$APP_ROOT/app/platform/linux-arm64/main.js"
      "$APP_ROOT/app/platform/linux-arm64/sdk-adapter.js"
      "$APP_ROOT/app/bootstrap/preload.js"
      "$APP_ROOT/app/renderer/index.html"
      "$APP_ROOT/graphics-env.sh"
      "$APP_ROOT/DEMO_BUILD_ONLY.txt"
      "$DEB_ROOT/usr/bin/$PACKAGE_NAME"
    )
    for item in "${required[@]}"; do [[ -e "$item" || -L "$item" ]] || fail_check "缺少运行文件: ${item#"$DEB_ROOT"}"; done
    grep -F "Linux $EXPECTED_LINUX_ARCH build" "$APP_ROOT/DEMO_BUILD_ONLY.txt" >/dev/null || fail_check "DEMO_BUILD_ONLY 架构错误"
    grep -F "Tencent Meeting SDK $CONTROL_SDK_VERSION;" "$APP_ROOT/DEMO_BUILD_ONLY.txt" >/dev/null || fail_check "DEMO_BUILD_ONLY SDK 版本与 Description 不一致"

    ELF_TOOLS=0
    command -v readelf >/dev/null 2>&1 && ELF_TOOLS=1
    command -v file >/dev/null 2>&1 && ELF_TOOLS=1
    command -v objdump >/dev/null 2>&1 && ELF_TOOLS=1
    if [[ "$ELF_TOOLS" -eq 1 && -n "$EXPECTED_LINUX_ARCH" ]]; then
      for elf in \
        "$APP_ROOT/runtime/electron" \
        "$APP_ROOT/runtime/resources/wemeet-sdk/linux/wemeet_electron_sdk.node" \
        "$APP_ROOT/runtime/resources/wemeet-sdk/linux/libwemeetsdk.so" \
        "$APP_ROOT/runtime/resources/wemeet-sdk/linux/libwemeet_base.so" \
        "$APP_ROOT/runtime/resources/wemeet-sdk/linux/Release/QtWebEngineProcess" \
        "$APP_ROOT/runtime/resources/wemeet-sdk/linux/Release/tmsdkapp"; do
        [[ -f "$elf" ]] || continue
        if command -v readelf >/dev/null 2>&1; then
          ELF_INFO="$(readelf -h "$elf" 2>/dev/null | awk -F: '/Machine:/ {gsub(/^[[:space:]]+/, "", $2); print $2}')"
        elif command -v file >/dev/null 2>&1; then
          ELF_INFO="$(file -b "$elf" 2>/dev/null || true)"
        else
          ELF_INFO="$(objdump -f "$elf" 2>/dev/null | awk '/file format/ {print $NF}')"
        fi
        echo "$ELF_INFO" | grep -Eiq "$EXPECTED_ELF_PATTERN" \
          && ok "ELF 架构 $EXPECTED_LINUX_ARCH: ${elf#"$DEB_ROOT"}" \
          || fail_check "ELF 架构不一致: ${elf#"$DEB_ROOT"} (${ELF_INFO:-unknown})"
      done
    else
      echo "WARN  缺少 readelf/file/objdump，跳过 ELF 架构检查"
    fi
    if find "$DEB_ROOT" -type f \( -name saas_sdk_env.json -o -name '.env' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' \) | grep -q .; then
      fail_check "发现禁止的凭据文件"
    fi
    ok "DEB metadata、结构、架构与凭据检查完成（未执行包内二进制）"
  fi
fi

# ---------- 4. 图形要点 ----------
if [[ "$DEB_ONLY" -eq 0 ]]; then
PATCH="/opt/x11-wayland/x11-ext.sh"
if [[ -r "$PATCH" ]]; then
  ok "X11-Wayland 厂商补丁可读: $PATCH"
else
  echo "WARN  厂商补丁缺失: $PATCH（将回退 Mesa 系统路径；桌面异常时优先排查此项）"
fi
if [[ "$VERBOSE" == 1 && -d "$OUT" ]]; then
  echo '---- 图形环境详细诊断 ----'
  printf 'session: XDG_SESSION_TYPE=%s DISPLAY=%s WAYLAND_DISPLAY=%s\n' \
    "${XDG_SESSION_TYPE:-<unset>}" "${DISPLAY:-<unset>}" "${WAYLAND_DISPLAY:-<unset>}"
  # shellcheck disable=SC1091
  source "$ROOT/packaging/graphics-env.sh"
  wemeet_prepare_x11_wayland "$OUT"
  printf 'effective: LD_LIBRARY_PATH=%s\n' "${LD_LIBRARY_PATH:-<unset>}"
  printf 'effective: QT_QPA_PLATFORM=%s EGL_PLATFORM=%s LD_PRELOAD=%s\n' \
    "${QT_QPA_PLATFORM:-<unset>}" "${EGL_PLATFORM:-<unset>}" "${LD_PRELOAD:-<unset>}"
  echo '---- 详细诊断结束（如需加载库追踪：LD_DEBUG=libs npm start）----'
fi
fi

if [[ "$FAILED" -ne 0 ]]; then
  cat >&2 <<'EOF'

修复建议：
- Python 报 kysec 时，不要使用 python3 -c；只需确保 python3 --version 成功。
- Python 缺失/损坏时让管理员执行：sudo apt install --reinstall python3 python3-minimal python3-dev
- GCC 不支持 gnu++2a 时，需由管理员安装麒麟 V10 可用的 C++20 工具链后再构建。
- 不要使用 sudo npm run setup:kylin，也不要使用 --no-sandbox。
EOF
  echo "检测未通过" >&2
else
  echo "全部检测通过"
fi
exit "$FAILED"
