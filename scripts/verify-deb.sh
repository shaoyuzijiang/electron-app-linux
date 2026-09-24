#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_NAME="tencent-meeting-sdk-linux-demo"
VERSION="$(node -p "require('$ROOT/package.json').version")~demo"
DEB="${1:-$ROOT/dist-demo/${PACKAGE_NAME}_${VERSION}_arm64.deb}"

fail() { echo "Demo DEB 校验失败: $*" >&2; exit 1; }
[[ -f "$DEB" ]] || fail "找不到 DEB: $DEB"
[[ -f "$DEB.sha256" ]] || fail "找不到 SHA-256: $DEB.sha256"
command -v dpkg-deb >/dev/null 2>&1 || fail "缺少 dpkg-deb"
(
  cd "$(dirname "$DEB")"
  sha256sum -c "$(basename "$DEB").sha256"
)
CONTROL="$(dpkg-deb --field "$DEB")"
grep -Fx "Package: $PACKAGE_NAME" <<<"$CONTROL" >/dev/null || fail "包名错误"
grep -Fx "Version: $VERSION" <<<"$CONTROL" >/dev/null || fail "版本错误"
grep -Fx 'Architecture: arm64' <<<"$CONTROL" >/dev/null || fail "架构错误"
grep -F 'Backend security tests were not run for this demo artifact.' <<<"$CONTROL" >/dev/null || fail "缺少 Demo 用途边界声明"
CONTENTS="$(dpkg-deb --contents "$DEB")"
for item in \
  "./opt/$PACKAGE_NAME/runtime/electron" \
  "./opt/$PACKAGE_NAME/runtime/resources/wemeet-sdk/linux/wemeet_electron_sdk.node" \
  "./opt/$PACKAGE_NAME/runtime/resources/wemeet-sdk/linux/libwemeetsdk.so" \
  "./opt/$PACKAGE_NAME/runtime/resources/wemeet-sdk/linux/Release/QtWebEngineProcess" \
  "./opt/$PACKAGE_NAME/app/main.js" \
  "./opt/$PACKAGE_NAME/app/platform/linux-arm64/main.js" \
  "./opt/$PACKAGE_NAME/app/platform/linux-arm64/sdk-adapter.js" \
  "./opt/$PACKAGE_NAME/app/bootstrap/preload.js" \
  "./opt/$PACKAGE_NAME/app/renderer/index.html" \
  "./opt/$PACKAGE_NAME/graphics-env.sh" \
  "./opt/$PACKAGE_NAME/DEMO_BUILD_ONLY.txt" \
  "./usr/bin/$PACKAGE_NAME"; do
  grep -F " $item" <<<"$CONTENTS" >/dev/null || fail "缺少运行文件: $item"
done
if grep -Ei '(/| )(\.env|saas_sdk_env\.json|[^ ]+\.(pem|key|p12|pfx))$' <<<"$CONTENTS" >/dev/null; then
  fail "发现禁止的凭据文件"
fi
echo "Demo DEB 校验通过: $DEB"
