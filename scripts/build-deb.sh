#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_NAME="tencent-meeting-sdk-linux-demo"
APP_HOME="opt/$PACKAGE_NAME"
VERSION="$(node -p "require('./package.json').version")"
# Electron 版本单一来源：package.json
ELECTRON_VERSION="$(node -p "require('./package.json').devDependencies.electron")"
fail() { echo "Demo DEB 构建失败: $*" >&2; exit 1; }
# 目标架构（arm64 | x64），默认 arm64。
LINUX_ARCH="${LINUX_ARCH:-arm64}"
case "$LINUX_ARCH" in
  arm64) DEB_ARCH="arm64"; ARCH_SUFFIX="arm64"; HOST_ARCH="aarch64"; SDK_ARCH="arm64"; ELF_PATTERN='ARM aarch64|AArch64' ;;
  x64) DEB_ARCH="amd64"; ARCH_SUFFIX="x64"; HOST_ARCH="x86_64"; SDK_ARCH="x86_64"; ELF_PATTERN='x86-64|x86_64' ;;
  *) fail "LINUX_ARCH 仅支持 arm64|x64: $LINUX_ARCH" ;;
esac
BUILD_DATE="$(date +%Y%m%d)"
OUT_DIR="$ROOT/dist-demo"
# 命名规范统一：腾讯会议SDK Demo-<版本>-<日期>-<arm64|x64>.deb
# （与 Mac/Windows 下载页完全一致；GitHub Release 资产名因平台限制
#   不支持中文/空格，CI 上传时会自动派生 ASCII 名，见 build-deb.yml）
ARTIFACT="$OUT_DIR/腾讯会议SDK Demo-${VERSION}-${BUILD_DATE}-${ARCH_SUFFIX}.deb"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/${PACKAGE_NAME}.XXXXXX")"
DATA="$WORK"
CONTROL="$WORK/DEBIAN"
SDK_SOURCE="${WEMEET_OUTPUT_DIR:-$ROOT/output/linux}"
SDK_TARGET="$DATA/$APP_HOME/runtime/resources/wemeet-sdk/linux"
SDK_ARCHIVE_COUNT="$( { ls "$ROOT"/vendor/TMSDK_*_${SDK_ARCH}_default.publish.tar.gz 2>/dev/null || true; } | wc -l | tr -d ' ')"
SDK_ARCHIVE="$( { ls "$ROOT"/vendor/TMSDK_*_${SDK_ARCH}_default.publish.tar.gz 2>/dev/null || true; } | head -1)"
[[ "$SDK_ARCHIVE_COUNT" -eq 1 && -f "$SDK_ARCHIVE" ]] || fail "vendor/ 下应恰好有一个目标架构 SDK 归档，当前 $SDK_ARCHIVE_COUNT 个"
SDK_VERSION="$(basename "$SDK_ARCHIVE" .tar.gz | cut -d_ -f3)"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
assert_elf_arch() {
  local target="$1" description
  description="$(file -b "$target" 2>/dev/null || true)"
  [[ "$description" == *ELF* ]] || fail "不是 ELF 文件: $target ($description)"
  echo "$description" | grep -Eiq "$ELF_PATTERN" || fail "架构不是 $LINUX_ARCH: $target ($description)"
}

[[ "$(uname -s)" == Linux || -n "${WEMEET_CI:-}" ]] || fail "只能在 Linux 构建（云端/非目标机组装请设置 WEMEET_CI=1）"
[[ "$(uname -m)" == "$HOST_ARCH" || -n "${WEMEET_CI:-}" ]] || fail "本机构建 $LINUX_ARCH 需要 $HOST_ARCH（云端组装请设置 WEMEET_CI=1）"
for command in unzip dpkg-deb npm node file; do command -v "$command" >/dev/null 2>&1 || fail "缺少命令: $command"; done
[[ -f "$ROOT/vendor/electron-v${ELECTRON_VERSION}-linux-${LINUX_ARCH}.zip" ]] || fail "缺少 Electron ${LINUX_ARCH} runtime (v${ELECTRON_VERSION})"

required_sdk=(wemeet_electron_sdk.node libwemeetsdk.so libwemeet_base.so Release)
for item in "${required_sdk[@]}"; do [[ -e "$SDK_SOURCE/$item" ]] || fail "缺少本次构建产物: $SDK_SOURCE/$item"; done
for elf in wemeet_electron_sdk.node libwemeetsdk.so libwemeet_base.so Release/QtWebEngineProcess Release/tmsdkapp; do
  assert_elf_arch "$SDK_SOURCE/$elf"
done

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR" "$CONTROL" "$DATA/$APP_HOME/app" "$DATA/$APP_HOME/runtime" "$DATA/usr/bin" "$DATA/usr/share/applications"
unzip -q "$ROOT/vendor/electron-v${ELECTRON_VERSION}-linux-${LINUX_ARCH}.zip" -d "$DATA/$APP_HOME/runtime"
assert_elf_arch "$DATA/$APP_HOME/runtime/electron"
chmod 0755 "$DATA/$APP_HOME/runtime/electron" "$DATA/$APP_HOME/runtime/chrome-sandbox" 2>/dev/null || true
install -m 0644 "$ROOT/renderer/assets/app.png" "$DATA/$APP_HOME/runtime/resources/app.png"

for relative in main.js main-darwin-win32.js ipc-handlers.js package.json package-lock.json; do
  install -m 0644 "$ROOT/$relative" "$DATA/$APP_HOME/app/$relative"
done
for directory in backend_api bootstrap common platform renderer sdk_mgmt utils; do
  cp -a "$ROOT/$directory" "$DATA/$APP_HOME/app/$directory"
done
# 安装包只交付运行所需代码，不带内部接口规格和测试源码
rm -rf "$DATA/$APP_HOME/app/backend_api/docs"
rm -f "$DATA/$APP_HOME/app/backend_api/"*.test.js
rm -rf "$DATA/$APP_HOME/app/renderer/.DS_Store"
(
  cd "$DATA/$APP_HOME/app"
  if [[ -d "$ROOT/vendor/npm-cache/_cacache" ]]; then
    npm ci --omit=dev --ignore-scripts --offline --cache "$ROOT/vendor/npm-cache" --engine-strict=true
  else
    npm ci --omit=dev --ignore-scripts --engine-strict=true
  fi
)

mkdir -p "$SDK_TARGET"
for item in "${required_sdk[@]}"; do cp -a "$SDK_SOURCE/$item" "$SDK_TARGET/"; done
printf 'DEMO BUILD: local Linux %s build and package verification only; Tencent Meeting SDK %s; backend security tests were not run.\n' "$LINUX_ARCH" "$SDK_VERSION" > "$DATA/$APP_HOME/DEMO_BUILD_ONLY.txt"

if find "$DATA" -type f \( -name saas_sdk_env.json -o -name '.env' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' \) | grep -q .; then
  fail "安装包包含禁止的凭据文件"
fi
install -m 0755 "$ROOT/packaging/launcher.sh" "$DATA/$APP_HOME/launcher.sh"
install -m 0644 "$ROOT/packaging/graphics-env.sh" "$DATA/$APP_HOME/graphics-env.sh"
ln -s "/$APP_HOME/launcher.sh" "$DATA/usr/bin/$PACKAGE_NAME"
install -m 0644 "$ROOT/packaging/$PACKAGE_NAME.desktop" "$DATA/usr/share/applications/$PACKAGE_NAME.desktop"
for size in 16 32 48 128 256 512; do
  target="$DATA/usr/share/icons/hicolor/${size}x${size}/apps"
  mkdir -p "$target"
  install -m 0644 "$ROOT/packaging/icons/app-${size}.png" "$target/$PACKAGE_NAME.png"
done

cat > "$CONTROL/control" <<EOF
Package: $PACKAGE_NAME
Version: $VERSION
Architecture: ${DEB_ARCH}
Section: net
Priority: optional
Maintainer: Tencent Meeting SDK Demo Team <noreply@example.invalid>
Depends: libc6 (>= 2.31), libstdc++6, libasound2, libatk-bridge2.0-0, libatk1.0-0, libcairo2, libcups2, libdbus-1-3, libdrm2, libegl1, libexpat1, libgbm1, libglib2.0-0, libgtk-3-0, libnspr4, libnss3, libpango-1.0-0, libpulse0, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2
Recommends: xwayland
Installed-Size: $(du -sk "$DATA" | awk '{print $1}')
Description: 银河麒麟 ${LINUX_ARCH} 腾讯会议 SDK Electron Demo
 Demo package using Electron ${ELECTRON_VERSION} and Tencent Meeting SDK ${SDK_VERSION}.
 Backend security tests were not run for this demo artifact.
EOF
install -m 0755 "$ROOT/packaging/postinst" "$CONTROL/postinst"
install -m 0755 "$ROOT/packaging/postrm" "$CONTROL/postrm"
dpkg-deb --root-owner-group --build "$WORK" "$ARTIFACT" >/dev/null
echo "Demo DEB: $ARTIFACT"
