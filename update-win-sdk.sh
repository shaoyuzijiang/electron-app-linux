#!/bin/bash
#===============================================================================
# update-win-sdk.sh — 腾讯会议 Windows SDK 一键升级脚本
#
# 自动完成 SDK 分发包到项目的完整更新流程：
#   1. 校验分发包结构 + 解析版本号（从目录名）
#   2. 备份当前 wemeet_sdk/win 到 wemeet_sdk/_backup/win-<时间>-<旧版本>
#   3. 清空旧内容：wemeet_sdk/win/{include,lib,x64} + wemeet.cpp + jsoncpp.cpp
#      （先删后拷，避免旧版本残留文件；保留 _backup 与 wemeet_sdk/mac）
#   4. 重新拷贝头文件  -> wemeet_sdk/win/include
#   5. 重新拷贝链接库  -> wemeet_sdk/win/lib/x64/release/wemeetsdk_x64.lib
#   6. 重新拷贝运行时  -> wemeet_sdk/win/x64  (dll + Release 资源)
#   7. 保留项目自有文件（copy.bat / killps.bat / config_local_win.json 等）
#   8. 重新拷贝 C++ 源码 -> wemeet_sdk/wemeet.cpp、wemeet_sdk/jsoncpp.cpp
#   9. 更新 package.json / package-lock.json 版本号
#  10. 清理 build 编译缓存 + 重新编译原生模块 (x64)
#
# 用法:
#   ./update-win-sdk.sh <SDK分发包目录> [选项]
#
# 示例:
#   ./update-win-sdk.sh TMSDK_Windows_3.43.112.5_20260910_publish_release_x64
#   ./update-win-sdk.sh /d/sdk/TMSDK_Windows_3.43.112.5_20260910_publish_release_x64 -y
#   ./update-win-sdk.sh --dry-run
#   ./update-win-sdk.sh --rollback
#
# 选项:
#   -y, --yes           跳过确认提示
#   --dry-run           预览模式，不修改任何文件
#   --no-backup         不备份（不可回滚）
#   --no-rebuild        跳过原生模块重新编译
#   --no-version        不更新 package.json / package-lock.json 版本号
#   --keep-cpp          保留本地 wemeet_sdk/wemeet.cpp（默认从分发包覆盖，本地版先备份）
#   --rollback          回滚到最近一次备份
#   --list-backups      列出所有备份
#   -h, --help          显示帮助
#
# 分发包目录结构要求（腾讯会议官方发布包解压后）:
#   <目录>/
#     ├── SDK/x64/include/*.h             ← 头文件
#     ├── SDK/x64/wemeetsdk_x64.lib       ← 链接库
#     ├── SDK/x64/*.dll + Release/        ← 运行时
#     └── tmsdk-node-addon/src/wemeet.cpp ← C++ 封装层源码
#===============================================================================
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_DIR="$(pwd)"
SDK_ROOT="${PROJECT_DIR}/wemeet_sdk"
WIN_SDK="${SDK_ROOT}/win"
BACKUP_ROOT="${SDK_ROOT}/_backup"
INCLUDE_DST="${WIN_SDK}/include"
LIB_DST="${WIN_SDK}/lib/x64/release"
RUNTIME_DST="${WIN_SDK}/x64"

# 项目自有、SDK 发布包不提供的文件：升级后需保留
PRESERVE_FILES=(config_local_win.json copy.bat killps.bat open_sdk_dir.bat open_sdk_dir_release.bat readme.txt .gitkeep)

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

#===============================================================================
# 参数解析
#===============================================================================
ARG_DIR=""
DO_BACKUP=1
DO_REBUILD=1
DO_VERSION=1
DO_CPP=1
DRYRUN=0
ASSUME_YES=0
DO_ROLLBACK=0
DO_LIST=0

# 打印脚本头部注释作为帮助
show_help() {
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)        ASSUME_YES=1; shift ;;
    --dry-run)       DRYRUN=1; shift ;;
    --no-backup)     DO_BACKUP=0; shift ;;
    --no-rebuild)    DO_REBUILD=0; shift ;;
    --no-version)    DO_VERSION=0; shift ;;
    --sync-cpp)      DO_CPP=1; shift ;;   # 默认行为，保留此开关仅为显式声明
    --keep-cpp)      DO_CPP=0; shift ;;
    --rollback)      DO_ROLLBACK=1; shift ;;
    --list-backups)  DO_LIST=1; shift ;;
    -h|--help)       show_help; exit 0 ;;
    -*)              fail "未知选项: $1 （用 --help 查看用法）" ;;
    *)
      if [[ -z "${ARG_DIR}" ]]; then
        ARG_DIR="$1"
      else
        warn "忽略多余参数: $1"
      fi
      shift ;;
  esac
done

TS="$(date '+%Y%m%d-%H%M%S')"

list_backups() {
  echo ""
  echo "=== SDK 备份列表 ==="
  if [[ ! -d "${BACKUP_ROOT}" ]]; then
    echo "  （无）"
    exit 0
  fi
  local found=0
  for d in "${BACKUP_ROOT}"/win-*; do
    [[ -d "$d" ]] || continue
    echo "  $(basename "$d")"
    found=1
  done
  [[ "${found}" -eq 1 ]] || echo "  （无）"
  exit 0
}

do_rollback() {
  local latest=""
  for d in "${BACKUP_ROOT}"/win-*; do
    [[ -d "$d" ]] || continue
    if [[ "$(basename "$d")" == win-rollback-* ]]; then continue; fi
    latest="$d"
  done
  [[ -n "${latest}" ]] || fail "没有可用备份"

  log "回滚到备份: $(basename "${latest}")"
  if [[ -d "${WIN_SDK}" ]]; then
    mv "${WIN_SDK}" "${BACKUP_ROOT}/win-rollback-${TS}" || fail "无法移走当前 SDK 目录"
    ok "当前 SDK 已移至 _backup/win-rollback-${TS}"
  fi
  mv "${latest}" "${WIN_SDK}" || fail "回滚失败"
  ok "回滚完成"
  echo ""
  echo "  注意: package.json / package-lock.json 版本号和 wemeet.cpp 需从 git 或 _backup 手动恢复"
  exit 0
}

if [[ "${DO_LIST:-0}" -eq 1 ]]; then list_backups; fi
if [[ "${DO_ROLLBACK:-0}" -eq 1 ]]; then do_rollback; fi

#===============================================================================
# 步骤 0: 定位并校验分发包
#===============================================================================
log "步骤 0: 校验 SDK 分发包..."

# 未指定目录时自动探测
if [[ -z "${ARG_DIR}" ]]; then
  for d in "${PROJECT_DIR}"/TMSDK_Windows_*; do
    if [[ -d "$d" ]]; then ARG_DIR="$d"; fi
  done
fi
if [[ -z "${ARG_DIR}" ]]; then show_help; exit 1; fi

# 支持相对路径
if [[ ! "${ARG_DIR}" = /* ]]; then
  ARG_DIR="${PROJECT_DIR}/${ARG_DIR}"
fi
SDK_PACKAGE_DIR="${ARG_DIR%/}"

[[ -d "${SDK_PACKAGE_DIR}" ]] || fail "SDK 分发包目录不存在: ${SDK_PACKAGE_DIR}"

SDK_SRC="${SDK_PACKAGE_DIR}/SDK/x64"
WEMEET_CPP_SRC="${SDK_PACKAGE_DIR}/tmsdk-node-addon/src/wemeet.cpp"
JSONCPP_SRC="${SDK_PACKAGE_DIR}/tmsdk-node-addon/src/json/jsoncpp.cpp"

[[ -f "${SDK_SRC}/include/wemeet_sdk.h" ]] || fail "缺少 SDK/x64/include/wemeet_sdk.h: ${SDK_PACKAGE_DIR}"
[[ -f "${SDK_SRC}/wemeetsdk_x64.dll" ]]   || fail "缺少 SDK/x64/wemeetsdk_x64.dll"
[[ -f "${SDK_SRC}/wemeetsdk_x64.lib" ]]   || fail "缺少 SDK/x64/wemeetsdk_x64.lib"
[[ -f "${WEMEET_CPP_SRC}" ]]              || fail "缺少 tmsdk-node-addon/src/wemeet.cpp"

# 从目录名解析版本：TMSDK_Windows_3.43.112.5_20260910_publish_release_x64
DIR_NAME="$(basename "${SDK_PACKAGE_DIR}")"
NEW_VERSION_FULL="$(echo "${DIR_NAME}" | cut -d_ -f3)"
SDK_DATE="$(echo "${DIR_NAME}" | cut -d_ -f4)"
if [[ ! "${NEW_VERSION_FULL}" =~ ^[0-9]+(\.[0-9]+)+$ ]]; then
  warn "无法从目录名解析版本号: ${DIR_NAME}"
  NEW_VERSION_FULL="unknown"
fi
# 主版本号（前 3 段）用于 package.json
NEW_VERSION="$(echo "${NEW_VERSION_FULL}" | cut -d. -f1-3)"

OLD_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo unknown)"

echo ""
echo "  分发包目录: ${SDK_PACKAGE_DIR}"
echo "  SDK 版本:   ${NEW_VERSION_FULL}  (发布日期 ${SDK_DATE})"
echo "  当前版本:   ${OLD_VERSION}"
echo "  目标版本:   ${NEW_VERSION}"
if [[ "${DRYRUN}" -eq 1 ]]; then
  warn "预览模式（--dry-run），不会修改任何文件"
fi
if [[ "${NEW_VERSION}" == "${OLD_VERSION}" ]]; then
  warn "版本号相同（${NEW_VERSION}），仍将继续覆盖文件"
fi

if [[ "${DRYRUN}" -eq 0 && "${ASSUME_YES}" -eq 0 ]]; then
  echo ""
  read -r -p "确认升级？[y/N] " ANS || true
  if [[ ! "${ANS:-}" =~ ^[Yy]$ ]]; then
    echo "已取消。"
    if [[ -z "${ANS:-}" ]]; then echo "  （未读到输入：非交互终端请加 -y）"; fi
    exit 0
  fi
fi

#===============================================================================
# 步骤 1: 备份
#===============================================================================
LAST_BACKUP=""
log "步骤 1: 备份当前 SDK..."

if [[ "${DO_BACKUP}" -eq 1 ]]; then
  BACKUP_DIR="${BACKUP_ROOT}/win-${TS}-${OLD_VERSION}"
  if [[ "${DRYRUN}" -eq 1 ]]; then
    echo -e "  ${YELLOW}[DRYRUN]${NC} mv ${WIN_SDK} -> ${BACKUP_DIR}"
  else
    [[ -d "${WIN_SDK}" ]] || fail "SDK 目录不存在: ${WIN_SDK}"
    mkdir -p "${BACKUP_ROOT}"
    mv "${WIN_SDK}" "${BACKUP_DIR}" || fail "备份失败，请关闭运行中的 Demo / wemeetapp 进程后重试"
    LAST_BACKUP="${BACKUP_DIR}"
    ok "已备份 -> wemeet_sdk/_backup/$(basename "${BACKUP_DIR}")"
  fi
else
  if [[ "${DRYRUN}" -eq 1 ]]; then
    echo -e "  ${YELLOW}[DRYRUN]${NC} rm -rf ${WIN_SDK}"
  else
    rm -rf "${WIN_SDK}"
    warn "已删除旧 SDK（--no-backup），不可回滚"
  fi
fi

#===============================================================================
# 步骤 2: 清空旧内容（先删后拷，避免旧版本残留文件）
#===============================================================================
log "步骤 2: 清空 wemeet_sdk 旧内容（保留 _backup / mac）..."
if [[ "${DRYRUN}" -eq 1 ]]; then
  echo -e "  ${YELLOW}[DRYRUN]${NC} rm -rf wemeet_sdk/win/{include,lib,x64} wemeet_sdk/win/sdk-version.json"
  echo -e "  ${YELLOW}[DRYRUN]${NC} rm -f  wemeet_sdk/wemeet.cpp wemeet_sdk/jsoncpp.cpp"
else
  rm -rf "${INCLUDE_DST}" "${LIB_DST}" "${RUNTIME_DST}"
  rm -f "${WIN_SDK}/sdk-version.json"
  if [[ "${DO_CPP}" -eq 1 ]]; then
    mkdir -p "${BACKUP_ROOT}"
    if [[ -f "${SDK_ROOT}/wemeet.cpp" ]]; then
      cp "${SDK_ROOT}/wemeet.cpp" "${BACKUP_ROOT}/wemeet.cpp.${TS}-${OLD_VERSION}.bak"
      echo "  旧 wemeet.cpp 已备份: wemeet_sdk/_backup/wemeet.cpp.${TS}-${OLD_VERSION}.bak"
    fi
    rm -f "${SDK_ROOT}/wemeet.cpp"
    if [[ -f "${JSONCPP_SRC}" ]]; then
      rm -f "${SDK_ROOT}/jsoncpp.cpp"
    fi
  fi
  ok "旧内容已清空，接下来全部从分发包重新拷贝"
  if [[ "${DO_REBUILD}" -eq 0 ]]; then
    warn "--no-rebuild：wemeet_sdk/win/x64 已清空，需手动编译并放回 wemeet_electron_sdk.node"
  fi
fi

#===============================================================================
# 步骤 3: 头文件
#===============================================================================
log "步骤 3: 重新拷贝头文件..."
if [[ "${DRYRUN}" -eq 1 ]]; then
  echo -e "  ${YELLOW}[DRYRUN]${NC} cp -R ${SDK_SRC}/include -> ${INCLUDE_DST}"
else
  mkdir -p "${INCLUDE_DST}"
  cp -R "${SDK_SRC}/include/." "${INCLUDE_DST}/" || fail "拷贝头文件失败"
  ok "头文件已更新 -> wemeet_sdk/win/include"
fi

#===============================================================================
# 步骤 4: 链接库
#===============================================================================
log "步骤 4: 重新拷贝链接库..."
if [[ "${DRYRUN}" -eq 1 ]]; then
  echo -e "  ${YELLOW}[DRYRUN]${NC} cp ${SDK_SRC}/wemeetsdk_x64.lib -> ${LIB_DST}/"
else
  mkdir -p "${LIB_DST}"
  cp "${SDK_SRC}/wemeetsdk_x64.lib" "${LIB_DST}/" || fail "拷贝 wemeetsdk_x64.lib 失败"
  ok "链接库已更新 -> wemeet_sdk/win/lib/x64/release/wemeetsdk_x64.lib"
fi

#===============================================================================
# 步骤 5: 运行时（dll + Release 资源，约 750MB）
#===============================================================================
log "步骤 5: 重新拷贝运行时文件（DLL + Release 资源，约 750MB，请耐心等待）..."

copy_runtime() {
  local src="$1" dst="$2"
  mkdir -p "$dst"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude 'include/' \
      --exclude '*.lib' \
      --exclude 'wemeetsdk_qt_demo.exe' \
      --exclude 'copy_dependency_qt.bat' \
      "${src}/" "${dst}/"
  else
    cp -R "${src}/." "${dst}/"
    rm -rf "${dst}/include"
    rm -f "${dst}"/*.lib "${dst}/wemeetsdk_qt_demo.exe" "${dst}/copy_dependency_qt.bat"
  fi
}

if [[ "${DRYRUN}" -eq 1 ]]; then
  echo -e "  ${YELLOW}[DRYRUN]${NC} copy_runtime ${SDK_SRC} -> ${RUNTIME_DST} (排除 include/ *.lib Qt demo)"
else
  copy_runtime "${SDK_SRC}" "${RUNTIME_DST}" || fail "拷贝运行时文件失败"
  ok "运行时已更新 -> wemeet_sdk/win/x64"
fi

#===============================================================================
# 步骤 6: 保留项目自有文件
#===============================================================================
log "步骤 6: 保留项目自有文件..."
if [[ "${DRYRUN}" -eq 1 ]]; then
  echo -e "  ${YELLOW}[DRYRUN]${NC} 从备份恢复: ${PRESERVE_FILES[*]}"
else
  if [[ -n "${LAST_BACKUP}" ]]; then
    for f in "${PRESERVE_FILES[@]}"; do
      if [[ -f "${LAST_BACKUP}/x64/${f}" ]]; then
        cp "${LAST_BACKUP}/x64/${f}" "${RUNTIME_DST}/${f}"
        echo "  保留 ${f}"
      fi
    done
  else
    warn "无备份（--no-backup），跳过；copy.bat 和 config_local_win.json 需手动恢复"
  fi
  cat > "${WIN_SDK}/sdk-version.json" <<EOF
{
  "sdkVersion": "${NEW_VERSION_FULL}",
  "releaseDate": "${SDK_DATE}",
  "arch": "x64",
  "upgradedAt": "${TS}",
  "source": "${DIR_NAME}"
}
EOF
fi

#===============================================================================
# 步骤 7: 重新拷贝 C++ 源码（与 mac 脚本一致：始终以分发包为准）
#===============================================================================
log "步骤 7: 重新拷贝原生模块源码..."
if [[ "${DRYRUN}" -eq 1 ]]; then
  echo -e "  ${YELLOW}[DRYRUN]${NC} cp ${WEMEET_CPP_SRC} -> wemeet_sdk/wemeet.cpp"
  if [[ -f "${JSONCPP_SRC}" ]]; then
    echo -e "  ${YELLOW}[DRYRUN]${NC} cp ${JSONCPP_SRC} -> wemeet_sdk/jsoncpp.cpp"
  fi
elif [[ "${DO_CPP}" -eq 0 ]]; then
  mkdir -p "${BACKUP_ROOT}"
  cp "${WEMEET_CPP_SRC}" "${BACKUP_ROOT}/wemeet.official-${NEW_VERSION_FULL}.cpp"
  warn "已保留本地 wemeet.cpp / jsoncpp.cpp（--keep-cpp）；官方版另存 wemeet_sdk/_backup/wemeet.official-${NEW_VERSION_FULL}.cpp"
else
  cp "${WEMEET_CPP_SRC}" "${SDK_ROOT}/wemeet.cpp" || fail "拷贝 wemeet.cpp 失败"
  ok "wemeet_sdk/wemeet.cpp 已从分发包重新拷贝"
  if [[ -f "${JSONCPP_SRC}" ]]; then
    cp "${JSONCPP_SRC}" "${SDK_ROOT}/jsoncpp.cpp" || fail "拷贝 jsoncpp.cpp 失败"
    ok "wemeet_sdk/jsoncpp.cpp 已从分发包重新拷贝"
  else
    warn "分发包未提供 tmsdk-node-addon/src/json/jsoncpp.cpp，保留项目版本"
  fi
fi

#===============================================================================
# 步骤 8: 版本号
#===============================================================================
log "步骤 8: 更新版本号..."
if [[ "${DO_VERSION}" -eq 0 ]]; then
  echo "  已跳过（--no-version）"
elif [[ "${DRYRUN}" -eq 1 ]]; then
  echo -e "  ${YELLOW}[DRYRUN]${NC} package.json / package-lock.json: ${OLD_VERSION} -> ${NEW_VERSION}"
else
  node -e "
const fs = require('fs');
for (const file of ['package.json', 'package-lock.json']) {
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  data.version = '${NEW_VERSION}';
  if (data.packages && data.packages['']) {
    data.packages[''].version = '${NEW_VERSION}';
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('  已更新 ' + file + ' -> ${NEW_VERSION}');
}
" || fail "版本号更新失败"
  ok "版本号已更新为 ${NEW_VERSION}"
fi

if [[ "${DRYRUN}" -eq 1 ]]; then
  echo ""
  echo "=== 预览结束，未修改任何文件 ==="
  echo "  执行: ./update-win-sdk.sh ${SDK_PACKAGE_DIR} -y"
  exit 0
fi

#===============================================================================
# 步骤 9: 清理编译缓存 + 重新编译原生模块
#===============================================================================
log "步骤 9: 清理编译缓存..."
if [[ -d "${PROJECT_DIR}/build" ]]; then
  rm -rf "${PROJECT_DIR}/build"
  ok "已清理 build/ 编译缓存"
else
  echo "  无 build/ 缓存"
fi

# 原生模块只在 Windows 环境（Git Bash / MSYS2 / Cygwin）可编译
IS_WIN_ENV=0
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) IS_WIN_ENV=1 ;;
esac

if [[ "${DO_REBUILD}" -eq 0 ]]; then
  echo "  已跳过编译（--no-rebuild），手动执行: npm run build:native:win-x64"
elif [[ "${IS_WIN_ENV}" -eq 0 ]]; then
  warn "当前非 Windows 环境（$(uname -s)），跳过原生模块编译"
  echo "        SDK 文件已更新，请在 Windows 上执行: npm run build:native:win-x64"
else
  log "重新编译原生模块 (x64)..."
  if ! npm run build:native:win-x64; then
    echo ""
    fail "原生模块编译失败，请检查 Visual Studio / node-gyp 环境。
        SDK 文件已升级，修复后执行: npm run build:native:win-x64
        ${LAST_BACKUP:+回滚: ./update-win-sdk.sh --rollback}"
  fi
  ok "编译完成"

  # 兜底：npm script 末尾的 cmd 复制语句在部分 shell 下不生效，这里确保产物就位
  if [[ -f "${PROJECT_DIR}/build/Release/wemeet_electron_sdk.node" ]]; then
    mkdir -p "${RUNTIME_DST}"
    cp "${PROJECT_DIR}/build/Release/wemeet_electron_sdk.node" "${RUNTIME_DST}/wemeet_electron_sdk.node"
    ok "原生模块已同步 -> wemeet_sdk/win/x64/wemeet_electron_sdk.node"
  else
    warn "未找到 build/Release/wemeet_electron_sdk.node，产物未同步"
  fi
fi

#===============================================================================
# 验证与摘要
#===============================================================================
DLL_VER="unknown"
if [[ -f "${RUNTIME_DST}/wemeetsdk_x64.dll" ]] && command -v powershell >/dev/null 2>&1; then
  DLL_VER="$(powershell -NoProfile -Command "(Get-Item -LiteralPath '${RUNTIME_DST}/wemeetsdk_x64.dll').VersionInfo.ProductVersion" 2>/dev/null || echo unknown)"
fi
if [[ -f "${RUNTIME_DST}/wemeet_electron_sdk.node" ]]; then
  NODE_OK="已生成"
else
  NODE_OK="未生成（需编译）"
fi

echo ""
echo "================================================================"
echo -e "${GREEN}  SDK 升级完成！${NC}"
echo "================================================================"
echo ""
echo "📦 版本信息:"
echo "   分发包版本:   ${NEW_VERSION_FULL}  (发布日期 ${SDK_DATE})"
echo "   package.json: ${NEW_VERSION}"
echo "   wemeetsdk_x64.dll: ${DLL_VER}"
echo "   wemeet_electron_sdk.node: ${NODE_OK}"
echo ""
echo "📋 变更文件（均已先删除再从分发包重新拷贝）:"
echo "   wemeet_sdk/win/include/          头文件"
echo "   wemeet_sdk/win/lib/x64/release/  链接库"
echo "   wemeet_sdk/win/x64/              运行时 DLL + Release 资源"
echo "   wemeet_sdk/wemeet.cpp            原生模块源码"
echo "   wemeet_sdk/jsoncpp.cpp           JSON 库源码"
echo "   package.json / package-lock.json 版本号"
echo ""
echo "🚀 下一步:"
echo "   npm run dev           # 开发验证"
echo "   npm run dist:win:x64  # 完整打包（NSIS 安装包）"
if [[ -n "${LAST_BACKUP}" ]]; then
  echo ""
  echo "   回滚: ./update-win-sdk.sh --rollback   （备份: wemeet_sdk/_backup/$(basename "${LAST_BACKUP}")）"
fi
echo "================================================================"
