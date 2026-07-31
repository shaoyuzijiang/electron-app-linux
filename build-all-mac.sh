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
#   dist/symbols/                      ← 编译生成的原生模块符号表（每次构建更新）
#     ├── arm64/
#     │   └── wemeet_electron_sdk.arm64.dSYM
#     └── x64/
#         └── wemeet_electron_sdk.x64.dSYM
#   dSYM/mac/                          ← 下载的 Electron 符号表（持久化，不重复下载）
#     ├── arm64/
#     │   ├── .version                          ← Electron 版本标记
#     │   ├── Electron.app.dSYM                 ← Electron 主程序
#     │   └── Electron Framework.framework.dSYM ← Electron 核心框架
#     └── x64/
#         ├── .version
#         ├── Electron.app.dSYM
#         └── Electron Framework.framework.dSYM
#===============================================================================
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_DIR="$(pwd)"
BUILD_DIR="${PROJECT_DIR}/build"
# 编译生成的原生模块 dSYM（每次构建更新，放在 dist 下）
SYMBOLS_DIR="${PROJECT_DIR}/dist/symbols"
# 下载的 Electron dSYM 持久化存储（不重复下载，不被清理）
DSYM_STORE_DIR="${PROJECT_DIR}/dSYM/mac"

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
# 步骤 2: 下载 Electron dSYM（完整应用符号表）
#===============================================================================
if [[ "${SKIP_DSYM}" == "false" ]]; then
  log "步骤 2: 检查/下载 Electron dSYM 符号表..."

  mkdir -p "${DSYM_STORE_DIR}/arm64"
  mkdir -p "${DSYM_STORE_DIR}/x64"

  # 检查指定架构的 dSYM 是否已存在且版本匹配
  # 匹配条件: .version 文件记录的版本 == 当前 Electron 版本，且 dSYM 文件存在
  check_dsym_version() {
    local arch="$1"
    local arch_dir="${DSYM_STORE_DIR}/${arch}"
    local version_file="${arch_dir}/.version"

    if [[ ! -f "${version_file}" ]]; then
      return 1  # 无版本文件，需下载
    fi

    local cached_version
    cached_version=$(cat "${version_file}" 2>/dev/null | tr -d '[:space:]')
    if [[ "${cached_version}" != "${ELECTRON_VERSION}" ]]; then
      return 1  # 版本不匹配，需重新下载
    fi

    # 版本匹配，检查是否有 dSYM 文件
    local dsym_count
    dsym_count=$(find "${arch_dir}" -name "*.dSYM" -type d 2>/dev/null | wc -l | tr -d ' ')
    if [[ "${dsym_count}" -eq 0 ]]; then
      return 1  # 无 dSYM 文件，需重新下载
    fi

    return 0  # 版本匹配且有 dSYM 文件，无需下载
  }

  # 下载并解压指定架构的 Electron dSYM
  download_electron_dsym() {
    local arch="$1"   # arm64 或 x64
    local arch_dir="${DSYM_STORE_DIR}/${arch}"

    # 检查版本是否匹配
    if check_dsym_version "${arch}"; then
      ok "  ${arch}: dSYM 已存在且版本匹配 (v${ELECTRON_VERSION})，跳过下载"
      return 0
    fi

    local dsym_zip="electron-v${ELECTRON_VERSION}-darwin-${arch}-dsym.zip"
    local dsym_url="https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${dsym_zip}"
    local tmp_zip
    tmp_zip=$(mktemp)

    log "  ${arch}: 下载 ${dsym_url}"
    curl -fSL --progress-bar -o "${tmp_zip}" "${dsym_url}" || {
      warn "  ${arch}: 下载失败"
      rm -f "${tmp_zip}"
      return 1
    }

    # 清理旧版本文件
    rm -rf "${arch_dir}"
    mkdir -p "${arch_dir}"

    # 解压到目标目录
    unzip -q -o "${tmp_zip}" -d "${arch_dir}"
    rm -f "${tmp_zip}"

    # 写入版本标记
    echo "${ELECTRON_VERSION}" > "${arch_dir}/.version"

    # 统计下载的 dSYM
    local count
    count=$(find "${arch_dir}" -name "*.dSYM" -type d | wc -l | tr -d ' ')
    ok "  ${arch}: 下载完成，共 ${count} 个 dSYM (v${ELECTRON_VERSION})"
  }

  download_electron_dsym "arm64" || warn "arm64 Electron dSYM 下载失败，跳过"
  download_electron_dsym "x64"   || warn "x64 Electron dSYM 下载失败，跳过"
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

# 拷贝下载的 Electron dSYM
for arch in arm64 x64; do
  if [[ -d "${DSYM_STORE_DIR}/${arch}" ]]; then
    cp -R "${DSYM_STORE_DIR}/${arch}"/* "${MERGE_DIR}/${arch}/" 2>/dev/null || true
  fi
done
# 拷贝编译的原生模块 dSYM
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
# 步骤 8: 汇总产物
#===============================================================================
log "步骤 8: 汇总打包产物..."

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
echo "📋 符号表明细:"
echo "   ── Electron dSYM (dSYM/mac/, 下载) ──"
for arch in arm64 x64; do
  sym_arch_dir="${DSYM_STORE_DIR}/${arch}"
  if [[ -d "${sym_arch_dir}" ]]; then
    echo "   ${arch}:"
    find "${sym_arch_dir}" -name "*.dSYM" -type d 2>/dev/null | sort | while read -r dsym; do
      SIZE=$(du -sh "$dsym" | awk '{print $1}')
      NAME=$(basename "$dsym")
      echo "      ${SIZE}   ${NAME}"
    done
  fi
done
echo "   ── 原生模块 dSYM (dist/symbols/, 编译) ──"
for arch in arm64 x64; do
  sym_arch_dir="${SYMBOLS_DIR}/${arch}"
  if [[ -d "${sym_arch_dir}" ]]; then
    echo "   ${arch}:"
    find "${sym_arch_dir}" -name "*.dSYM" -type d 2>/dev/null | sort | while read -r dsym; do
      SIZE=$(du -sh "$dsym" | awk '{print $1}')
      NAME=$(basename "$dsym")
      echo "      ${SIZE}   ${NAME}"
    done
  fi
done
echo ""
echo "📁 .app 产物:"
[[ -d "${PROJECT_DIR}/dist/mac-arm64/腾讯会议SDK Demo.app" ]] && echo "   arm64: dist/mac-arm64/腾讯会议SDK Demo.app"
[[ -d "${PROJECT_DIR}/dist/mac/腾讯会议SDK Demo.app" ]] && echo "   x64:   dist/mac/腾讯会议SDK Demo.app"
echo ""
echo "版本: SDK ${SDK_VERSION} / Electron ${ELECTRON_VERSION}  日期: ${BUILD_DATE}"
echo "================================================================"
