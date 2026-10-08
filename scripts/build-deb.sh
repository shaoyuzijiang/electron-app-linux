#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_NAME="tencent-meeting-sdk-linux-demo"
APP_HOME="opt/$PACKAGE_NAME"
VERSION="$(node -p "require('$ROOT/package.json').version")~demo"
OUT_DIR="$ROOT/dist-demo"
ARTIFACT="$OUT_DIR/${PACKAGE_NAME}_${VERSION}_arm64.deb"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/${PACKAGE_NAME}.XXXXXX")"
DATA="$WORK"
CONTROL="$WORK/DEBIAN"
SDK_SOURCE="$ROOT/output/linux"
SDK_TARGET="$DATA/$APP_HOME/runtime/resources/wemeet-sdk/linux"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "Demo DEB 构建失败: $*" >&2; exit 1; }

[[ "$(uname -s)" == Linux && "$(uname -m)" == aarch64 ]] || fail "只能在 Linux aarch64 构建"
for command in unzip dpkg-deb npm node; do command -v "$command" >/dev/null 2>&1 || fail "缺少命令: $command"; done
[[ -f "$ROOT/vendor/electron-v33.4.11-linux-arm64.zip" ]] || fail "缺少 Electron ARM64 runtime"
[[ -d "$ROOT/vendor/npm-cache/_cacache" ]] || fail "缺少 npm 离线缓存"

required_sdk=(wemeet_electron_sdk.node libwemeetsdk.so libwemeet_base.so Release)
for item in "${required_sdk[@]}"; do [[ -e "$SDK_SOURCE/$item" ]] || fail "缺少本次构建产物: output/linux/$item"; done

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR" "$CONTROL" "$DATA/$APP_HOME/app" "$DATA/$APP_HOME/runtime" "$DATA/usr/bin" "$DATA/usr/share/applications"
unzip -q "$ROOT/vendor/electron-v33.4.11-linux-arm64.zip" -d "$DATA/$APP_HOME/runtime"
chmod 0755 "$DATA/$APP_HOME/runtime/electron" "$DATA/$APP_HOME/runtime/chrome-sandbox" 2>/dev/null || true
install -m 0644 "$ROOT/renderer/assets/app.png" "$DATA/$APP_HOME/runtime/resources/app.png"

for relative in main.js main-darwin-win32.js ipc-handlers.js package.json package-lock.json; do
  install -D -m 0644 "$ROOT/$relative" "$DATA/$APP_HOME/app/$relative"
done
for directory in backend_api bootstrap common platform renderer sdk_mgmt utils; do
  cp -a "$ROOT/$directory" "$DATA/$APP_HOME/app/$directory"
done
rm -rf "$DATA/$APP_HOME/app/renderer/.DS_Store"
(
  cd "$DATA/$APP_HOME/app"
  npm ci --omit=dev --ignore-scripts --offline --cache "$ROOT/vendor/npm-cache" --engine-strict=true
)

mkdir -p "$SDK_TARGET"
for item in "${required_sdk[@]}"; do cp -a "$SDK_SOURCE/$item" "$SDK_TARGET/"; done
printf '%s\n' 'DEMO BUILD: local ARM64 build and package verification only; backend security tests were not run.' > "$DATA/$APP_HOME/DEMO_BUILD_ONLY.txt"

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
Architecture: arm64
Section: net
Priority: optional
Maintainer: Tencent Meeting SDK Demo Team <noreply@example.invalid>
Depends: libc6 (>= 2.31), libstdc++6, libasound2, libatk-bridge2.0-0, libatk1.0-0, libcairo2, libcups2, libdbus-1-3, libdrm2, libexpat1, libgbm1, libglib2.0-0, libgtk-3-0, libnspr4, libnss3, libpango-1.0-0, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2
Recommends: xwayland
Installed-Size: $(du -sk "$DATA" | awk '{print $1}')
Description: 银河麒麟 ARM64 腾讯会议 SDK Electron Demo
 Demo package using Electron 33.4.11 and Tencent Meeting SDK 3.26.100.14.
 Backend security tests were not run for this demo artifact.
EOF
install -m 0755 "$ROOT/packaging/postinst" "$CONTROL/postinst"
install -m 0755 "$ROOT/packaging/postrm" "$CONTROL/postrm"
dpkg-deb --root-owner-group --build "$WORK" "$ARTIFACT" >/dev/null
echo "Demo DEB: $ARTIFACT"
