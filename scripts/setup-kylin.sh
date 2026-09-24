#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="$ROOT/vendor/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz"
BUILD_ONLY=0
STAGE="启动"
TRANSACTION_ACTIVE=0
BUILD_COMMITTED=0
OUTPUT_BACKUP="$ROOT/output/.linux-backup.$$"
INCLUDE_BACKUP="$ROOT/native/.include-backup.$$"

fail() { echo "错误[$STAGE]: $*" >&2; exit 1; }
rollback_build() {
  [[ "$TRANSACTION_ACTIVE" -eq 1 && "$BUILD_COMMITTED" -ne 1 ]] || return
  rm -rf "$ROOT/output/linux" "$ROOT/native/include"
  [[ ! -e "$OUTPUT_BACKUP" ]] || mv "$OUTPUT_BACKUP" "$ROOT/output/linux"
  [[ ! -e "$INCLUDE_BACKUP" ]] || mv "$INCLUDE_BACKUP" "$ROOT/native/include"
}
on_error() {
  local code=$?
  rollback_build
  echo "失败阶段: $STAGE（行 $1，退出码 $code）" >&2
  echo "已恢复上一次构建产物；修复后可重新运行，SDK 缓存会复用。" >&2
  exit "$code"
}
trap 'on_error $LINENO' ERR INT TERM

for arg in "$@"; do
  case "$arg" in
    --build-only) BUILD_ONLY=1 ;;
    *) fail "未知参数: $arg；V1.0 只允许 vendor 中固定哈希的 SDK 包" ;;
  esac
done

STAGE="环境体检"
bash "$ROOT/scripts/kylin-doctor.sh" --build || fail "麒麟构建环境不满足要求"

STAGE="检查系统"
[[ "$(id -u)" -ne 0 ]] || fail "禁止使用 root/sudo 运行，请在目标桌面普通用户下执行"
[[ "$(uname -s)" == "Linux" ]] || fail "只能在 Linux 上运行"
[[ "$(uname -m)" == "aarch64" ]] || fail "需要 aarch64，当前为 $(uname -m)"
[[ -f /etc/os-release ]] || fail "缺少 /etc/os-release"
grep -Eiq 'kylin|银河麒麟' /etc/os-release || fail "正式构建只允许银河麒麟基线机"
grep -Eiq 'V10|VERSION_ID="?10' /etc/os-release || fail "正式构建要求银河麒麟 V10"
[[ -f "$ARCHIVE" ]] || fail "找不到 SDK 包: $ARCHIVE"
for command in node npm python3 make g++ ld as realpath tar unzip sha256sum file readelf ldd strings timeout awk grep getconf; do
  command -v "$command" >/dev/null 2>&1 || fail "缺少命令 $command。请安装 Node.js 24、npm、python3、python3-dev、build-essential、binutils、file、unzip"
done
PYTHON_BIN="$(command -v python3)"
PYTHON_VERSION="$("$PYTHON_BIN" --version 2>&1 || true)"
[[ "$PYTHON_VERSION" == Python\ 3.* ]] || fail "python3 无法运行；请让管理员安装或修复 python3、python3-dev"
# kysec 可能禁止 Python `-c`，但 node-gyp 可通过该绝对路径运行 gyp_main.py。
export PYTHON="$PYTHON_BIN"
export npm_config_python="$PYTHON_BIN"
STAGE="检查 node-gyp Python 兼容性"
bash "$ROOT/scripts/check-python-node-gyp.sh" "$PYTHON_BIN"
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
NPM_MAJOR="$(npm --version | cut -d. -f1)"
[[ "$NODE_MAJOR" -ge 22 && "$NODE_MAJOR" -lt 25 ]] || fail "构建需要 Node.js >=22.12 且 <25，推荐 24.x，当前为 $(node --version)"
[[ "$NPM_MAJOR" -ge 10 ]] || fail "需要 npm 10 或更高版本，当前为 $(npm --version)"
GLIBC_VERSION="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')"
[[ "$GLIBC_VERSION" == "2.31" ]] || fail "正式目标基线固定 glibc 2.31，当前为 ${GLIBC_VERSION:-unknown}；请在银河麒麟 V10 SP1 基线机构建"

STAGE="校验供应包"
(cd "$ROOT/vendor" && sha256sum -c SHA256SUMS && sha256sum -c ELECTRON_SHA256SUMS && sha256sum -c ELECTRON_HEADERS_SHA256SUMS)
RUNTIME_FILE="$(node -p "require('$ROOT/vendor/electron-manifest.json').runtime.file")"
HEADERS_FILE="$(node -p "require('$ROOT/vendor/electron-manifest.json').headers.file")"
[[ "$(sha256sum "$ROOT/vendor/$RUNTIME_FILE" | awk '{print $1}')" == "$(node -p "require('$ROOT/vendor/electron-manifest.json').runtime.sha256")" ]] || fail "Electron 运行时摘要与供应清单不一致"
[[ "$(sha256sum "$ROOT/vendor/$HEADERS_FILE" | awk '{print $1}')" == "$(node -p "require('$ROOT/vendor/electron-manifest.json').headers.sha256")" ]] || fail "Electron headers 摘要与供应清单不一致"
if ! tar -tzf "$ARCHIVE" | awk -F/ '$1 == "" { exit 1 } { for (i=1; i<=NF; i++) if ($i == "..") exit 1 }'; then
  fail "SDK 压缩包包含不安全路径"
fi

ARCHIVE_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
CACHE_ROOT="$ROOT/.sdk-cache/$ARCHIVE_SHA"
SDK_DIR="$CACHE_ROOT/TMSDK_0300000000_3.26.100.14_arm64_default.publish"
STAGE="解压可信 SDK"
CACHE_STAGE="$ROOT/.sdk-cache/.stage.$$"
rm -rf "$CACHE_STAGE"
mkdir -p "$CACHE_STAGE"
tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE" -C "$CACHE_STAGE"
[[ -d "$CACHE_STAGE/TMSDK_0300000000_3.26.100.14_arm64_default.publish/SDK" ]] || fail "SDK 目录结构不符合预期"
mkdir -p "$ROOT/.sdk-cache"
rm -rf "$CACHE_ROOT"
mv "$CACHE_STAGE" "$CACHE_ROOT"

cd "$ROOT"
STAGE="离线安装 npm 依赖"
npm ci --ignore-scripts --include=dev --offline --cache "$ROOT/vendor/npm-cache" --engine-strict=true
STAGE="离线安装 Electron"
bash "$ROOT/scripts/install-electron-runtime.sh"
STAGE="离线安装 Electron headers"
bash "$ROOT/scripts/install-electron-headers.sh"

# 从 SDK 准备到构建门禁形成事务；失败恢复上一版 output/include。
TRANSACTION_ACTIVE=1
rm -rf "$OUTPUT_BACKUP" "$INCLUDE_BACKUP"
[[ ! -e "$ROOT/output/linux" ]] || mv "$ROOT/output/linux" "$OUTPUT_BACKUP"
[[ ! -e "$ROOT/native/include" ]] || mv "$ROOT/native/include" "$INCLUDE_BACKUP"
STAGE="准备腾讯会议 SDK"
bash "$ROOT/scripts/prepare-sdk.sh" "$SDK_DIR"
STAGE="编译原生 addon"
bash "$ROOT/scripts/build-native.sh"
STAGE="源码校验"
npm run verify:source
STAGE="构建产物检查"
bash "$ROOT/scripts/check-build.sh"
BUILD_COMMITTED=1
TRANSACTION_ACTIVE=0
rm -rf "$OUTPUT_BACKUP" "$INCLUDE_BACKUP"

if [[ "$BUILD_ONLY" -eq 1 ]]; then
  echo "构建与非图形检查完成。请在桌面普通用户会话执行: npm run verify:desktop"
  exit 0
fi
if [[ -z "${DISPLAY:-}" ]]; then
  echo "构建成功，但当前终端没有 DISPLAY，已跳过桌面验证。"
  echo "请在麒麟桌面普通用户终端执行: npm run verify:desktop"
  exit 0
fi

STAGE="桌面运行验证"
npm run verify:desktop

echo
 echo "全部自动门禁通过。构建阶段未启动 Electron 或 SDK。运行应用:"
 echo "  cd '$ROOT' && npm start"
