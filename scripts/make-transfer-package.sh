#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="wemeet-demo"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${1:-$ROOT/../${NAME}-transfer-${STAMP}.tar.gz}"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/${NAME}.XXXXXX")"
PACKAGE_ROOT="$STAGE/$NAME"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT
fail() { echo "离线传输包失败: $*" >&2; exit 1; }

cd "$ROOT"
npm run verify:platform-contract
(cd vendor && sha256sum -c SHA256SUMS && sha256sum -c ELECTRON_SHA256SUMS && sha256sum -c ELECTRON_HEADERS_SHA256SUMS)
[[ -d vendor/npm-cache/_cacache ]] || fail "缺少 npm 离线缓存"

mkdir -p "$PACKAGE_ROOT"
for relative in \
  backend_api bootstrap common native packaging platform renderer scripts sdk_mgmt utils vendor \
  main.js main-darwin-win32.js ipc-handlers.js binding.gyp package.json package-lock.json entitlements.mac.plist; do
  [[ -e "$relative" ]] || fail "缺少交付文件: $relative"
  cp -a "$relative" "$PACKAGE_ROOT/"
done

if find "$PACKAGE_ROOT" -type f \( -name '.env' -o -name 'auth-tokens*' -o -name 'saas_sdk_env.json' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' \) | grep -q .; then
  fail "传输包包含禁止的凭据文件"
fi
if find "$PACKAGE_ROOT" -type d \( -name node_modules -o -name build -o -name dist -o -name dist-demo -o -name output -o -name .electron-headers -o -name .sdk-cache \) | grep -q .; then
  fail "传输包包含禁止的本机构建产物"
fi
mkdir -p "$(dirname "$ARCHIVE")"
if tar --version 2>/dev/null | grep -q 'GNU tar'; then
  tar --owner=0 --group=0 -C "$STAGE" -czf "$ARCHIVE" "$NAME"
else
  tar -C "$STAGE" -czf "$ARCHIVE" "$NAME"
fi
(
  cd "$(dirname "$ARCHIVE")"
  sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256"
)
echo "统一 Linux ARM64 离线传输包: $ARCHIVE"
echo "SHA-256: $ARCHIVE.sha256"
