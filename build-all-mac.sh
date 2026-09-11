#!/bin/bash
#===============================================================================
# build-all-mac.sh
# 一键完成 macOS arm64 + x64 打包，并生成完整应用符号表 (dSYM)
#
# 符号表包含:
#   1. Electron 主程序 + Electron Framework (从 GitHub releases 下载 dSYM)
#   2. wemeet_electron_sdk.node 原生模块 (由 update-mac-sdk.sh 编译时保存)
#
# 注意: 原生模块编译只在 update-mac-sdk.sh 中执行，本脚本不重复编译，
#       仅检查 .node 产物存在并把已保存的 dSYM 打进统一符号表
#
# 用法:
#   ./build-all-mac.sh              # 打包 + 签名 + 完整符号表
#   ./build-all-mac.sh --no-sign    # 跳过签名
#   ./build-all-mac.sh --skip-dsym  # 跳过 Electron dSYM 下载
#
# 产物:
#   dist/腾讯会议SDK Demo-<version>-<date>-arm64.dmg
#   dist/腾讯会议SDK Demo-<version>-<date>-x64.dmg
#   dist/dSYM-mac-<version>-<date>.zip       ← 统一符号表（含 Electron + 原生模块）
#   dSYM/mac/                                ← dSYM zip 下载缓存（持久化，不重复下载）
#     ├── electron-v<version>-darwin-arm64-dsym.zip
#     └── electron-v<version>-darwin-x64-dsym.zip
#
# 磁盘优化: 符号表增量追加进统一 zip，中间文件（解压的 dSYM、build/ 编译
# 产物、解压的 .app）在每步完成后立即删除，峰值磁盘占用大幅降低
#===============================================================================
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_DIR="$(pwd)"
BUILD_DIR="${PROJECT_DIR}/build"
# dSYM zip 下载缓存（持久化，不删除，不重复下载）
DSYM_ZIP_DIR="${PROJECT_DIR}/dSYM/mac"
# 统一符号表 zip（步骤 0 之后赋值，增量追加）
DSYM_ZIP=""

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅ $*${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  ${NC} $*"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $*${NC}"; exit 1; }

# 解析参数
SKIP_SIGN=false
SKIP_DSYM=false
for arg in "$@"; do
  case "$arg" in
    --no-sign)     SKIP_SIGN=true ;;
    --skip-dsym)   SKIP_DSYM=true ;;
  esac
done

#===============================================================================
# 步骤 0: 环境检查
#===============================================================================
log "步骤 0: 环境检查..."

[[ -f package.json ]] || fail "未找到 package.json，请在项目根目录运行"
[[ -x node_modules/.bin/node-gyp ]] || fail "node-gyp 未安装，请运行 npm install"
[[ -x node_modules/.bin/electron-builder ]] || fail "electron-builder 未安装，请运行 npm install"

SDK_VERSION=$(node -p "require('./package.json').version")
ELECTRON_VERSION=$(node -p "require('electron/package.json').version")
BUILD_DATE=$(date '+%Y%m%d')
DSYM_ZIP="${PROJECT_DIR}/dist/dSYM-mac-${SDK_VERSION}-${BUILD_DATE}.zip"

ok "SDK 版本: ${SDK_VERSION}, Electron 版本: ${ELECTRON_VERSION}, 日期: ${BUILD_DATE}"

#===============================================================================
# 步骤 1: 清理旧产物
#===============================================================================
log "步骤 1: 清理旧编译缓存和打包产物..."

rm -rf "${BUILD_DIR}"
rm -rf "${PROJECT_DIR}/dist"
mkdir -p "${PROJECT_DIR}/dist"

ok "已清理 build/ 和 dist/"

#===============================================================================
# 步骤 2: 下载 Electron dSYM 并增量追加到统一符号表 zip
#   解压到临时目录 → zip 追加 → 立即删除解压文件（峰值只占一份架构的解压空间）
#===============================================================================
if [[ "${SKIP_DSYM}" == "false" ]]; then
  log "步骤 2: 检查/下载 Electron dSYM 符号表..."

  mkdir -p "${DSYM_ZIP_DIR}"

  process_electron_dsym() {
    local arch="$1"  # arm64 或 x64

    local dsym_zip="electron-v${ELECTRON_VERSION}-darwin-${arch}-dsym.zip"
    local dsym_url="https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${dsym_zip}"
    local zip_path="${DSYM_ZIP_DIR}/${dsym_zip}"

    # 1. 检查 zip 是否已存在（版本通过文件名保证）
    if [[ -f "${zip_path}" ]]; then
      ok "  ${arch}: zip 已存在，跳过下载 (${dsym_zip})"
    else
      log "  ${arch}: 下载 ${dsym_url}"
      curl -fSL --progress-bar -o "${zip_path}" "${dsym_url}" || {
        warn "  ${arch}: 下载失败"
        rm -f "${zip_path}"
        return 1
      }
      ok "  ${arch}: 下载完成 (${dsym_zip})"
    fi

    # 2. 解压到临时目录（保持 <arch>/ 目录结构）
    local tmp_root tmp_dir
    tmp_root=$(mktemp -d)
    tmp_dir="${tmp_root}/${arch}"
    mkdir -p "${tmp_dir}"
    unzip -q -o "${zip_path}" -d "${tmp_dir}"

    # 3. 增量追加到统一符号表 zip
    (cd "${tmp_root}" && zip -qr "${DSYM_ZIP}" .)

    # 4. 统计并立即删除解压的中间文件（不等到最后）
    local count size
    count=$(find "${tmp_dir}" -name "*.dSYM" -type d | wc -l | tr -d ' ')
    size=$(du -sh "${tmp_dir}" | awk '{print $1}')
    rm -rf "${tmp_root}"
    ok "  ${arch}: ${count} 个 dSYM 已追加到统一 zip，解压临时文件已删除 (${size})"
  }

  process_electron_dsym "arm64" || warn "arm64 Electron dSYM 处理失败，跳过"
  process_electron_dsym "x64"   || warn "x64 Electron dSYM 处理失败，跳过"

  # 清理旧版本的 zip 文件（只保留当前版本的）
  find "${DSYM_ZIP_DIR}" -name "electron-v*-darwin-*-dsym.zip" -type f | while read -r old_zip; do
    zip_name=$(basename "${old_zip}")
    if [[ "${zip_name}" != "electron-v${ELECTRON_VERSION}-darwin-arm64-dsym.zip" ]] && \
       [[ "${zip_name}" != "electron-v${ELECTRON_VERSION}-darwin-x64-dsym.zip" ]]; then
      rm -f "${old_zip}"
      log "  已删除旧版本 zip: ${zip_name}"
    fi
  done
else
  warn "跳过 Electron dSYM 下载（--skip-dsym）"
fi

#===============================================================================
# 步骤 3: 检查原生模块产物 + 追加原生模块 dSYM
#   编译只在 update-mac-sdk.sh 中执行，本脚本不重复编译
#===============================================================================
log "步骤 3: 检查原生模块 .node 产物..."

NODE_ARM64="${PROJECT_DIR}/output/mac/wemeet_electron_sdk.arm64.node"
NODE_X64="${PROJECT_DIR}/output/mac/wemeet_electron_sdk.x64.node"

[[ -f "${NODE_ARM64}" ]] || fail "缺少 ${NODE_ARM64}，请先运行 ./update-mac-sdk.sh 编译原生模块"
[[ -f "${NODE_X64}" ]] || fail "缺少 ${NODE_X64}，请先运行 ./update-mac-sdk.sh 编译原生模块"
ok "原生模块 .node 产物已就绪（arm64 + x64）"

# 同步无后缀 .node（wemeet-sdk.js 优先加载）
cp "${NODE_ARM64}" "${PROJECT_DIR}/output/mac/wemeet_electron_sdk.node"

# 追加原生模块 dSYM（由 update-mac-sdk.sh 编译时保存到 dSYM/mac/native/）
if [[ -d "${PROJECT_DIR}/dSYM/mac/native" ]]; then
  (cd "${PROJECT_DIR}/dSYM/mac/native" && zip -qr "${DSYM_ZIP}" .)
  ok "原生模块 dSYM 已追加到统一 zip（来源: dSYM/mac/native/）"
else
  warn "未找到 dSYM/mac/native/，统一符号表将缺少原生模块符号（运行 update-mac-sdk.sh 可生成）"
fi

#===============================================================================
# 步骤 4: 打包 arm64 DMG（DMG 生成后立即删除解压的 .app）
#===============================================================================
log "步骤 4: 打包 macOS arm64..."

if [[ "${SKIP_SIGN}" == "true" ]]; then
  SKIP_SIGN=1 npm run dist:mac:arm64 || fail "arm64 打包失败"
else
  npm run dist:mac:arm64 || fail "arm64 打包失败"
fi

if [[ -d "${PROJECT_DIR}/dist/mac-arm64" ]]; then
  app_size=$(du -sh "${PROJECT_DIR}/dist/mac-arm64" | awk '{print $1}')
  rm -rf "${PROJECT_DIR}/dist/mac-arm64"
  ok "arm64 DMG 已生成，dist/mac-arm64/ 已删除 (${app_size})"
fi

#===============================================================================
# 步骤 5: 打包 x64 DMG（DMG 生成后立即删除解压的 .app）
#===============================================================================
log "步骤 5: 打包 macOS x64..."

if [[ "${SKIP_SIGN}" == "true" ]]; then
  SKIP_SIGN=1 npm run dist:mac:x64 || fail "x64 打包失败"
else
  npm run dist:mac:x64 || fail "x64 打包失败"
fi

if [[ -d "${PROJECT_DIR}/dist/mac" ]]; then
  app_size=$(du -sh "${PROJECT_DIR}/dist/mac" | awk '{print $1}')
  rm -rf "${PROJECT_DIR}/dist/mac"
  ok "x64 DMG 已生成，dist/mac/ 已删除 (${app_size})"
fi

#===============================================================================
# 步骤 6: 写入版本信息到统一符号表 zip
#===============================================================================
log "步骤 6: 写入符号表版本信息..."

if [[ -f "${DSYM_ZIP}" ]]; then
  version_tmp=$(mktemp -d)
  cat > "${version_tmp}/VERSION.txt" << EOF
SDK Version: ${SDK_VERSION}
Electron Version: ${ELECTRON_VERSION}
Build Date: ${BUILD_DATE}
Architectures: arm64, x64
Contents:
  - Electron.dSYM, Electron Framework.dSYM, Electron Helper*.dSYM (downloaded)
  - wemeet_electron_sdk.{arch}.dSYM (compiled)
EOF
  (cd "${version_tmp}" && zip -qj "${DSYM_ZIP}" VERSION.txt)
  rm -rf "${version_tmp}"
  ok "版本信息已写入"
fi

#===============================================================================
# 步骤 7: 汇总产物
#===============================================================================
log "步骤 7: 汇总打包产物..."

echo ""
echo "================================================================"
echo -e "${GREEN}  构建完成！${NC}"
echo "================================================================"
echo ""
echo "📦 DMG 安装包:"
ls -lh "${PROJECT_DIR}"/dist/*.dmg 2>/dev/null | awk '{printf "   %s   %s\n", $5, $NF}'
echo ""
echo "📦 统一符号表 zip:"
[[ -f "${DSYM_ZIP}" ]] && ls -lh "${DSYM_ZIP}" | awk '{printf "   %s   %s\n", $5, $NF}'
echo ""
echo "💾 dSYM zip 缓存 (dSYM/mac/, 持久化):"
find "${DSYM_ZIP_DIR}" -name "electron-v*-dsym.zip" -type f 2>/dev/null | sort | while read -r zip; do
  SIZE=$(du -sh "$zip" | awk '{print $1}')
  NAME=$(basename "$zip")
  echo "      ${SIZE}   ${NAME}"
done
echo ""
echo "🗑️  已即时清理: Electron dSYM 解压文件、dist/mac-arm64/、dist/mac/"
echo ""
echo "版本: SDK ${SDK_VERSION} / Electron ${ELECTRON_VERSION}  日期: ${BUILD_DATE}"
echo "================================================================"
