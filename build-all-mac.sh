#!/bin/bash
#===============================================================================
# build-all-mac.sh
# 一键完成 macOS arm64 + x64 打包，并生成完整应用符号表 (dSYM)
#
# 符号表包含:
#   1. Electron 主程序 + Electron Framework (从 GitHub releases 下载 dSYM)
#   2. wemeet_electron_sdk.node 原生模块 (编译时生成)
#
# 用法:
#   ./build-all-mac.sh              # 编译 + 打包 + 签名 + 完整符号表
#   ./build-all-mac.sh --no-sign    # 跳过签名
#   ./build-all-mac.sh --skip-build # 跳过原生模块编译（用已有 .node）
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
# 构建完成后自动清理: build/、dist/symbols/、dist/mac-arm64/、dist/mac/
#===============================================================================
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_DIR="$(pwd)"
BUILD_DIR="${PROJECT_DIR}/build"
# 所有解压后的 dSYM（Electron + 原生模块），每次构建重新生成
SYMBOLS_DIR="${PROJECT_DIR}/dist/symbols"
# dSYM zip 下载缓存（持久化，不删除，不重复下载）
DSYM_ZIP_DIR="${PROJECT_DIR}/dSYM/mac"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅ $*${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  $*${NC}"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $*${NC}"; exit 1; }

# 解析参数
SKIP_SIGN=false
SKIP_BUILD=false
SKIP_DSYM=false
for arg in "$@"; do
  case "$arg" in
    --no-sign)     SKIP_SIGN=true ;;
    --skip-build)  SKIP_BUILD=true ;;
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

ok "SDK 版本: ${SDK_VERSION}, Electron 版本: ${ELECTRON_VERSION}, 日期: ${BUILD_DATE}"

#===============================================================================
# 步骤 1: 清理旧产物
#===============================================================================
log "步骤 1: 清理旧编译缓存和打包产物..."

rm -rf "${BUILD_DIR}"
rm -rf "${PROJECT_DIR}/dist"
mkdir -p "${SYMBOLS_DIR}/arm64"
mkdir -p "${SYMBOLS_DIR}/x64"

ok "已清理 build/ 和 dist/"

#===============================================================================
# 步骤 2: 下载/解压 Electron dSYM 符号表
#===============================================================================
if [[ "${SKIP_DSYM}" == "false" ]]; then
  log "步骤 2: 检查/下载 Electron dSYM 符号表..."

  mkdir -p "${DSYM_ZIP_DIR}"
  mkdir -p "${SYMBOLS_DIR}/arm64/electron"
  mkdir -p "${SYMBOLS_DIR}/x64/electron"

  # 处理指定架构的 dSYM
  process_electron_dsym() {
    local arch="$1"  # arm64 或 x64

    local dsym_zip="electron-v${ELECTRON_VERSION}-darwin-${arch}-dsym.zip"
    local dsym_url="https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${dsym_zip}"
    local zip_path="${DSYM_ZIP_DIR}/${dsym_zip}"
    local extract_dir="${SYMBOLS_DIR}/${arch}/electron"

    # 1. 检查 zip 是否已存在（版本通过文件名保证）
    if [[ -f "${zip_path}" ]]; then
      ok "  ${arch}: zip 已存在，跳过下载 (${dsym_zip})"
    else
      # 下载 zip（旧的版本 zip 不匹配文件名，不会被命中）
      log "  ${arch}: 下载 ${dsym_url}"
      curl -fSL --progress-bar -o "${zip_path}" "${dsym_url}" || {
        warn "  ${arch}: 下载失败"
        rm -f "${zip_path}"
        return 1
      }
      ok "  ${arch}: 下载完成 (${dsym_zip})"
    fi

    # 2. 每次先删除旧的解压目录，再重新解压
    rm -rf "${extract_dir}"
    mkdir -p "${extract_dir}"
    unzip -q -o "${zip_path}" -d "${extract_dir}"

    # 3. 统计解压结果
    local count
    count=$(find "${extract_dir}" -name "*.dSYM" -type d | wc -l | tr -d ' ')
    ok "  ${arch}: 解压完成，${count} 个 dSYM"
  }

  process_electron_dsym "arm64" || warn "arm64 Electron dSYM 处理失败，跳过"
  process_electron_dsym "x64"   || warn "x64 Electron dSYM 处理失败，跳过"

  # 清理旧版本的 zip 文件（只保留当前版本的）
  log "  清理旧版本 dSYM zip..."
  find "${DSYM_ZIP_DIR}" -name "electron-v*-darwin-*-dsym.zip" -type f | while read -r old_zip; do
    zip_name=$(basename "${old_zip}")
    if [[ "${zip_name}" != "electron-v${ELECTRON_VERSION}-darwin-arm64-dsym.zip" ]] && \
       [[ "${zip_name}" != "electron-v${ELECTRON_VERSION}-darwin-x64-dsym.zip" ]]; then
      rm -f "${old_zip}"
      log "  已删除旧版本: ${zip_name}"
    fi
  done
else
  warn "跳过 Electron dSYM 下载（--skip-dsym）"
fi

#===============================================================================
# 步骤 3: 编译 arm64 原生模块 + 提取 dSYM
#===============================================================================
if [[ "${SKIP_BUILD}" == "false" ]]; then
  log "步骤 3: 编译 arm64 原生模块..."

  npm run build:native:mac-arm64 || fail "arm64 原生模块编译失败"

  if [[ -d "${BUILD_DIR}/Release/wemeet_electron_sdk.node.dSYM" ]]; then
    rm -rf "${SYMBOLS_DIR}/arm64/wemeet_electron_sdk.arm64.dSYM"
    cp -R "${BUILD_DIR}/Release/wemeet_electron_sdk.node.dSYM" \
          "${SYMBOLS_DIR}/arm64/wemeet_electron_sdk.arm64.dSYM"
    ok "arm64 原生模块符号表已保存到 dist/symbols/arm64/"
  else
    warn "未找到 arm64 dSYM，可能 binding.gyp 未启用 dwarf-with-dsym"
  fi

  #===============================================================================
  # 步骤 4: 编译 x64 原生模块 + 提取 dSYM
  #===============================================================================
  log "步骤 4: 编译 x64 原生模块..."

  npm run build:native:mac-x64 || fail "x64 原生模块编译失败"

  if [[ -d "${BUILD_DIR}/Release/wemeet_electron_sdk.node.dSYM" ]]; then
    rm -rf "${SYMBOLS_DIR}/x64/wemeet_electron_sdk.x64.dSYM"
    cp -R "${BUILD_DIR}/Release/wemeet_electron_sdk.node.dSYM" \
          "${SYMBOLS_DIR}/x64/wemeet_electron_sdk.x64.dSYM"
    ok "x64 原生模块符号表已保存到 dist/symbols/x64/"
  else
    warn "未找到 x64 dSYM"
  fi
else
  warn "跳过原生模块编译（--skip-build）"
fi

#===============================================================================
# 步骤 5: 打包 arm64 DMG
#===============================================================================
log "步骤 5: 打包 macOS arm64..."

if [[ "${SKIP_SIGN}" == "true" ]]; then
  SKIP_SIGN=1 npm run dist:mac:arm64 || fail "arm64 打包失败"
else
  npm run dist:mac:arm64 || fail "arm64 打包失败"
fi

ok "arm64 打包完成"

#===============================================================================
# 步骤 6: 打包 x64 DMG
#===============================================================================
log "步骤 6: 打包 macOS x64..."

if [[ "${SKIP_SIGN}" == "true" ]]; then
  SKIP_SIGN=1 npm run dist:mac:x64 || fail "x64 打包失败"
else
  npm run dist:mac:x64 || fail "x64 打包失败"
fi

ok "x64 打包完成"

#===============================================================================
# 步骤 7: 打包统一符号表 zip
#===============================================================================
log "步骤 7: 打包统一符号表 zip..."

DSYM_ZIP="${PROJECT_DIR}/dist/dSYM-mac-${SDK_VERSION}-${BUILD_DATE}.zip"

# 临时目录合并所有 dSYM
MERGE_DIR=$(mktemp -d)
mkdir -p "${MERGE_DIR}/arm64" "${MERGE_DIR}/x64"

# 拷贝所有解压后的 dSYM（Electron + 原生模块都在 dist/symbols 下）
for arch in arm64 x64; do
  if [[ -d "${SYMBOLS_DIR}/${arch}" ]]; then
    cp -R "${SYMBOLS_DIR}/${arch}"/* "${MERGE_DIR}/${arch}/" 2>/dev/null || true
  fi
done

# 写入版本信息
cat > "${MERGE_DIR}/VERSION.txt" << EOF
SDK Version: ${SDK_VERSION}
Electron Version: ${ELECTRON_VERSION}
Build Date: ${BUILD_DATE}
Architectures: arm64, x64
Contents:
  - Electron.dSYM, Electron Framework.dSYM, Electron Helper*.dSYM (downloaded)
  - wemeet_electron_sdk.{arch}.dSYM (compiled)
EOF

cd "${MERGE_DIR}"
zip -qr "${DSYM_ZIP}" .
cd "${PROJECT_DIR}"
rm -rf "${MERGE_DIR}"

ok "统一符号表已打包: dist/dSYM-mac-${SDK_VERSION}-${BUILD_DATE}.zip"

#===============================================================================
# 步骤 8: 清理中间文件，释放硬盘空间
#===============================================================================
log "步骤 8: 清理中间文件..."

CLEAN_SIZE=0

# 统计并删除 build/ 目录（node-gyp 编译中间产物）
if [[ -d "${BUILD_DIR}" ]]; then
  SIZE=$(du -sh "${BUILD_DIR}" | awk '{print $1}')
  rm -rf "${BUILD_DIR}"
  log "  已删除 build/ (${SIZE})"
fi

# 删除解压的 dSYM（已打包进统一符号表 zip，无需保留）
if [[ -d "${SYMBOLS_DIR}" ]]; then
  SIZE=$(du -sh "${SYMBOLS_DIR}" | awk '{print $1}')
  rm -rf "${SYMBOLS_DIR}"
  log "  已删除 dist/symbols/ (${SIZE})"
fi

# 删除解压的 .app 目录（DMG 已生成，.app 无需保留）
APP_ARM64="${PROJECT_DIR}/dist/mac-arm64"
APP_X64="${PROJECT_DIR}/dist/mac"
for app_dir in "${APP_ARM64}" "${APP_X64}"; do
  if [[ -d "${app_dir}" ]]; then
    SIZE=$(du -sh "${app_dir}" | awk '{print $1}')
    rm -rf "${app_dir}"
    log "  已删除 ${app_dir#${PROJECT_DIR}/}/ (${SIZE})"
  fi
done

ok "中间文件清理完成"

#===============================================================================
# 步骤 9: 汇总产物
#===============================================================================
log "步骤 9: 汇总打包产物..."

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
echo "🗑️  已清理: build/、dist/symbols/、dist/mac-arm64/、dist/mac/"
echo ""
echo "版本: SDK ${SDK_VERSION} / Electron ${ELECTRON_VERSION}  日期: ${BUILD_DATE}"
echo "================================================================"
