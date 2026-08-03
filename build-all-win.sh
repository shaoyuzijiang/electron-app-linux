#!/bin/bash
#===============================================================================
# build-all-win.sh
# 一键完成 Windows x64 打包，并生成完整应用符号表
#
# 符号表包含:
#   1. Electron 核心模块 Breakpad 符号 (.sym) (从 GitHub releases 下载)
#   2. wemeet_electron_sdk.node 原生模块 PDB (编译时生成)
#
# 用法 (在 Git Bash 中运行):
#   ./build-all-win.sh              # 编译 + 打包 + 完整符号表 + 清理中间产物
#   ./build-all-win.sh --skip-build # 跳过原生模块编译（用已有 .node）
#   ./build-all-win.sh --skip-pdb   # 跳过 Electron 符号下载
#   ./build-all-win.sh --no-clean   # 保留中间产物（用于调试构建问题）
#
# 产物:
#   dist/腾讯会议SDK Demo-<version>-<date>-x64.exe   (NSIS 安装包)
#   dist/symbols/win-x64/                             ← 编译生成的原生模块 PDB
#     └── wemeet_electron_sdk.node.pdb
#   pdb/win-x64/                                      ← 下载的 Electron 符号（持久化，不重复下载）
#     ├── .version                                    ← Electron 版本标记
#     └── breakpad_symbols/                           ← Breakpad .sym 符号文件
#         ├── electron.exe.pdb/<hash>/electron.exe.sym
#         └── ...
#===============================================================================
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_DIR="$(pwd)"
BUILD_DIR="${PROJECT_DIR}/build"
# 编译生成的原生模块 PDB（每次构建更新，放在 dist 下）
SYMBOLS_DIR="${PROJECT_DIR}/dist/symbols/win-x64"
# 下载的 Electron 符号持久化存储（不重复下载，不被清理）
SYM_STORE_DIR="${PROJECT_DIR}/pdb/win-x64"

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

# 创建 zip 文件（Git Bash 无 zip 命令时回退到 PowerShell Compress-Archive）
create_zip() {
  local src_dir="$1"
  local dest_zip="$2"

  if command -v zip &>/dev/null; then
    (cd "${src_dir}" && zip -qr "${dest_zip}" .)
    return $?
  fi

  if command -v powershell.exe &>/dev/null; then
    local src_win dest_win
    src_win=$(cygpath -w "${src_dir}" 2>/dev/null || echo "${src_dir}")
    dest_win=$(cygpath -w "${dest_zip}" 2>/dev/null || echo "${dest_zip}")
    powershell.exe -NoProfile -Command \
      "Compress-Archive -Path '${src_win}\*' -DestinationPath '${dest_win}' -Force"
    return $?
  fi

  if command -v 7z &>/dev/null; then
    (cd "${src_dir}" && 7z a -tzip "${dest_zip}" .)
    return $?
  fi

  echo "错误: 找不到 zip / powershell / 7z，无法创建 zip 文件" >&2
  return 1
}

# 解析参数
SKIP_BUILD=false
SKIP_PDB=false
NO_CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --skip-build)  SKIP_BUILD=true ;;
    --skip-pdb)    SKIP_PDB=true ;;
    --no-clean)    NO_CLEAN=true ;;
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
mkdir -p "${SYMBOLS_DIR}"
mkdir -p "${SYM_STORE_DIR}"

ok "已清理 build/ 和 dist/"

#===============================================================================
# 步骤 2: 下载 Electron Breakpad 符号表 (.sym)
#===============================================================================
if [[ "${SKIP_PDB}" == "false" ]]; then
  log "步骤 2: 检查/下载 Electron Breakpad 符号表..."

  # 检查符号是否已存在且版本匹配
  check_sym_version() {
    local version_file="${SYM_STORE_DIR}/.version"

    if [[ ! -f "${version_file}" ]]; then
      return 1  # 无版本文件，需下载
    fi

    local cached_version
    cached_version=$(cat "${version_file}" 2>/dev/null | tr -d '[:space:]')
    if [[ "${cached_version}" != "${ELECTRON_VERSION}" ]]; then
      return 1  # 版本不匹配，需重新下载
    fi

    # 版本匹配，检查是否有 .sym 符号文件
    local sym_count
    sym_count=$(find "${SYM_STORE_DIR}" -name "*.sym" -type f 2>/dev/null | wc -l | tr -d ' ')
    if [[ "${sym_count}" -eq 0 ]]; then
      return 1  # 无符号文件，需重新下载
    fi

    return 0  # 版本匹配且有符号文件，无需下载
  }

  # 下载并解压 Electron 符号表
  download_electron_syms() {
    # 检查版本是否匹配
    if check_sym_version; then
      ok "Electron 符号已存在且版本匹配 (v${ELECTRON_VERSION})，跳过下载"
      return 0
    fi

    local sym_zip="electron-v${ELECTRON_VERSION}-win32-x64-symbols.zip"
    local sym_url="https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${sym_zip}"
    local tmp_zip
    tmp_zip=$(mktemp)

    log "下载 ${sym_url}"
    curl -fSL --progress-bar -o "${tmp_zip}" "${sym_url}" || {
      warn "Electron 符号下载失败"
      rm -f "${tmp_zip}"
      return 1
    }

    # 清理旧版本文件
    rm -rf "${SYM_STORE_DIR}"
    mkdir -p "${SYM_STORE_DIR}"

    # 解压到目标目录
    unzip -q -o "${tmp_zip}" -d "${SYM_STORE_DIR}"
    rm -f "${tmp_zip}"

    # 写入版本标记
    echo "${ELECTRON_VERSION}" > "${SYM_STORE_DIR}/.version"

    # 统计下载的符号文件
    local count
    count=$(find "${SYM_STORE_DIR}" -name "*.sym" -type f | wc -l | tr -d ' ')
    ok "下载完成，共 ${count} 个 Breakpad 符号文件 (v${ELECTRON_VERSION})"
  }

  download_electron_syms || warn "Electron 符号下载失败，跳过"
else
  warn "跳过 Electron 符号下载（--skip-pdb）"
fi

#===============================================================================
# 步骤 3: 编译 x64 原生模块 + 提取 PDB
#===============================================================================
if [[ "${SKIP_BUILD}" == "false" ]]; then
  log "步骤 3: 编译 Windows x64 原生模块..."

  npm run build:native:win-x64 || fail "x64 原生模块编译失败"

  # 查找编译生成的 PDB 文件
  # node-gyp + MSVC 启用 GenerateDebugInformation 后，PDB 生成在 build/Release/ 下
  # 文件名与 .node 相同: wemeet_electron_sdk.node.pdb
  PDB_FOUND=false
  for pdb_file in "${BUILD_DIR}/Release/wemeet_electron_sdk.node.pdb" \
                  "${BUILD_DIR}/Release/"wemeet_electron_sdk*.pdb; do
    if [[ -f "${pdb_file}" ]]; then
      cp -f "${pdb_file}" "${SYMBOLS_DIR}/wemeet_electron_sdk.node.pdb"
      PDB_FOUND=true
      ok "原生模块 PDB 已保存到 dist/symbols/win-x64/"
      break
    fi
  done

  if [[ "${PDB_FOUND}" == "false" ]]; then
    # 搜索 build 目录下的所有 PDB
    found_pdb=$(find "${BUILD_DIR}" -name "wemeet_electron_sdk*.pdb" -type f 2>/dev/null | head -1)
    if [[ -n "${found_pdb}" ]]; then
      cp -f "${found_pdb}" "${SYMBOLS_DIR}/wemeet_electron_sdk.node.pdb"
      ok "原生模块 PDB 已保存到 dist/symbols/win-x64/"
    else
      warn "未找到原生模块 PDB，请检查 binding.gyp 是否启用了调试信息生成"
    fi
  fi
else
  warn "跳过原生模块编译（--skip-build）"
fi

#===============================================================================
# 步骤 4: 打包 Windows x64 NSIS 安装包
#===============================================================================
log "步骤 4: 打包 Windows x64 NSIS 安装包..."

npm run dist:win:x64 || fail "x64 打包失败"

ok "x64 打包完成"

#===============================================================================
# 步骤 5: 打包统一符号表 zip
#===============================================================================
log "步骤 5: 打包统一符号表 zip..."

SYMBOLS_ZIP="${PROJECT_DIR}/dist/symbols-win-${SDK_VERSION}-${BUILD_DATE}.zip"

# 临时目录合并所有符号
MERGE_DIR=$(mktemp -d)
mkdir -p "${MERGE_DIR}/electron-symbols"
mkdir -p "${MERGE_DIR}/native-pdb"

# 拷贝下载的 Electron Breakpad 符号（保留 breakpad_symbols 目录结构）
if [[ -d "${SYM_STORE_DIR}/breakpad_symbols" ]]; then
  cp -R "${SYM_STORE_DIR}/breakpad_symbols" "${MERGE_DIR}/electron-symbols/"
elif [[ -d "${SYM_STORE_DIR}" ]]; then
  # 兼容：如果目录结构不同，拷贝所有 .sym 文件
  cp -R "${SYM_STORE_DIR}"/* "${MERGE_DIR}/electron-symbols/" 2>/dev/null || true
fi

# 拷贝编译的原生模块 PDB
if [[ -d "${SYMBOLS_DIR}" ]]; then
  cp -R "${SYMBOLS_DIR}"/*.pdb "${MERGE_DIR}/native-pdb/" 2>/dev/null || true
fi

# 写入版本信息
cat > "${MERGE_DIR}/VERSION.txt" << EOF
SDK Version: ${SDK_VERSION}
Electron Version: ${ELECTRON_VERSION}
Build Date: ${BUILD_DATE}
Architecture: win-x64
Contents:
  - electron-symbols/ : Electron Breakpad .sym 符号 (downloaded from GitHub releases)
  - native-pdb/        : wemeet_electron_sdk.node PDB (compiled)
EOF

create_zip "${MERGE_DIR}" "${SYMBOLS_ZIP}" || fail "符号表 zip 打包失败"
rm -rf "${MERGE_DIR}"

ok "统一符号表已打包: dist/symbols-win-${SDK_VERSION}-${BUILD_DATE}.zip"

#===============================================================================
# 步骤 6: 汇总产物
#===============================================================================
log "步骤 6: 汇总打包产物..."

echo ""
echo "================================================================"
echo -e "${GREEN}  构建完成！${NC}"
echo "================================================================"
echo ""
echo "📦 NSIS 安装包:"
ls -lh "${PROJECT_DIR}"/dist/*.exe 2>/dev/null | awk '{printf "   %s   %s\n", $5, $NF}'
echo ""
echo "📦 统一符号表 zip:"
[[ -f "${SYMBOLS_ZIP}" ]] && ls -lh "${SYMBOLS_ZIP}" | awk '{printf "   %s   %s\n", $5, $NF}'
echo ""
echo "📋 符号表明细:"
echo "   ── Electron Breakpad 符号 (pdb/win-x64/, 下载) ──"
if [[ -d "${SYM_STORE_DIR}" ]]; then
  find "${SYM_STORE_DIR}" -name "*.sym" -type f 2>/dev/null | sort | while read -r sym; do
    SIZE=$(du -sh "$sym" | awk '{print $1}')
    NAME=$(basename "$sym")
    echo "      ${SIZE}   ${NAME}"
  done
fi
echo "   ── 原生模块 PDB (dist/symbols/win-x64/, 编译) ──"
if [[ -d "${SYMBOLS_DIR}" ]]; then
  find "${SYMBOLS_DIR}" -name "*.pdb" -type f 2>/dev/null | sort | while read -r pdb; do
    SIZE=$(du -sh "$pdb" | awk '{print $1}')
    NAME=$(basename "$pdb")
    echo "      ${SIZE}   ${NAME}"
  done
fi
echo ""
echo "版本: SDK ${SDK_VERSION} / Electron ${ELECTRON_VERSION}  日期: ${BUILD_DATE}"
echo "================================================================"

#===============================================================================
# 步骤 7: 清理中间产物（节省硬盘空间）
#===============================================================================
if [[ "${NO_CLEAN}" == "true" ]]; then
  warn "跳过清理中间产物（--no-clean）"
else
  log "步骤 7: 清理中间产物..."

  SIZE_BEFORE=$(du -sh "${PROJECT_DIR}/dist" 2>/dev/null | awk '{print $1}')

  # 记录已删除的项
  CLEANED_ITEMS=""

  # 1. build/ — node-gyp 编译中间产物（.obj/.lib/.exp 等）
  #    .node 已拷贝到 wemeet_sdk/win/x64/，PDB 已提取到 dist/symbols/
  if [[ -d "${BUILD_DIR}" ]]; then
    rm -rf "${BUILD_DIR}"
    CLEANED_ITEMS+="  ✓ build/                    (node-gyp 编译中间产物)\n"
  fi

  # 2. dist/win-unpacked/ — electron-builder 解包的完整应用目录（~1 GB）
  #    NSIS 安装包已生成，此目录不再需要
  if [[ -d "${PROJECT_DIR}/dist/win-unpacked" ]]; then
    rm -rf "${PROJECT_DIR}/dist/win-unpacked"
    CLEANED_ITEMS+="  ✓ dist/win-unpacked/        (解包的应用目录)\n"
  fi

  # 3. dist/.icon-ico/ — 图标缓存
  if [[ -d "${PROJECT_DIR}/dist/.icon-ico" ]]; then
    rm -rf "${PROJECT_DIR}/dist/.icon-ico"
    CLEANED_ITEMS+="  ✓ dist/.icon-ico/           (图标缓存)\n"
  fi

  # 4. dist/*.blockmap — 用于增量更新，本地构建不需要
  rm -f "${PROJECT_DIR}"/dist/*.blockmap 2>/dev/null
  CLEANED_ITEMS+="  ✓ dist/*.blockmap           (增量更新映射文件)\n"

  # 5. dist/*.__uninstaller.exe — 中间卸载器
  rm -f "${PROJECT_DIR}"/dist/*.__uninstaller.exe 2>/dev/null
  CLEANED_ITEMS+="  ✓ dist/*.__uninstaller.exe  (中间卸载器)\n"

  # 6. dist/builder-effective-config.yaml — 构建配置快照
  rm -f "${PROJECT_DIR}/dist/builder-effective-config.yaml" 2>/dev/null
  CLEANED_ITEMS+="  ✓ dist/builder-effective-config.yaml\n"

  # 7. dist/builder-debug.yml — 构建调试日志
  rm -f "${PROJECT_DIR}/dist/builder-debug.yml" 2>/dev/null
  CLEANED_ITEMS+="  ✓ dist/builder-debug.yml\n"

  SIZE_AFTER=$(du -sh "${PROJECT_DIR}/dist" 2>/dev/null | awk '{print $1}')

  echo ""
  echo -e "${GREEN}已清理:${NC}"
  echo -e "${CLEANED_ITEMS}"
  echo -e "  ${BLUE}清理前 dist/: ${SIZE_BEFORE}  →  清理后: ${SIZE_AFTER}${NC}"
  echo ""
  echo "保留的产物:"
  echo "  ✓ dist/*.exe                    (NSIS 安装包)"
  echo "  ✓ dist/symbols-win-*.zip        (统一符号表 zip)"
  echo "  ✓ dist/symbols/win-x64/         (原生模块 PDB)"
  echo "  ✓ pdb/win-x64/                  (Electron 符号缓存，持久化)"
  echo "================================================================"
fi
