#!/bin/bash
#===============================================================================
# update-linux-sdk.sh — 腾讯会议 Linux(ARM64/麒麟) SDK 一键升级脚本
#
# 与 update-mac-sdk.sh / update-win-sdk.sh 对标，完成 SDK 分发包到项目的更新：
#   1. 校验分发包结构 + 从文件名解析版本号
#   2. 备份 vendor/ 旧 SDK 归档到 vendor/_backup/
#   3. 替换 vendor/TMSDK_*_arm64_default.publish.tar.gz（唯一归档，先删后拷）
#   4. 麒麟 V10 环境下自动执行 npm run setup:kylin -- --build-only
#      （环境体检 → 离线依赖 → prepare-sdk → addon 重编 → 全部门禁）
#   5. addon 回传：output/linux/wemeet_electron_sdk.node -> packaging/prebuilt/
#      （回传后 push，CI 即用新预编译 addon 组装 DEB）
#   6. 输出版本一致性与下一步清单（更新 vendor-supplies / 同步契约 mock 版本）
#
# 用法:
#   ./update-linux-sdk.sh <TMSDK_*_arm64_default.publish.tar.gz | 解压后目录> [选项]
#
# 选项:
#   -y, --yes        跳过确认提示（非交互终端必加）
#   --dry-run        预览模式，不修改任何文件
#   --no-rebuild     只替换 vendor 归档，不触发构建（跨机升级时用）
#   --no-upload-hint 结束时不打印 Release 上传命令
#   --rollback       回滚到最近一次备份
#   --list-backups   列出所有备份
#   -h, --help       显示帮助
#
# 分发包要求（腾讯会议官方 Linux 发布包）:
#   TMSDK_<产品ID>_<版本>_arm64_default.publish.tar.gz，解压后:
#     <目录>/SDK/libwemeetsdk.so + libwemeet_base.so + Release/ + include/wemeet_sdk.h
#     <目录>/Electron_Demo/include/json/json.h
#
# 注意: Linux SDK(3.26 系) 与 mac/win SDK(3.43/3.45 系) 版本线独立，
#       本脚本【不】修改 package.json 版本号（那是 mac/win SDK 的版本语义）。
#===============================================================================
set -euo pipefail

cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"
VENDOR_DIR="${PROJECT_DIR}/vendor"
BACKUP_ROOT="${VENDOR_DIR}/_backup"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅ $*${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  $*${NC}"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $*${NC}"; exit 1; }

TS="$(date '+%Y%m%d-%H%M%S')"

show_help() { awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"; }

#------------------------------------------------------------------------------
# 参数解析
#------------------------------------------------------------------------------
ARG_PKG=""
ASSUME_YES=0; DRYRUN=0; DO_REBUILD=1; UPLOAD_HINT=1; DO_ROLLBACK=0; DO_LIST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes) ASSUME_YES=1; shift ;;
    --dry-run) DRYRUN=1; shift ;;
    --no-rebuild) DO_REBUILD=0; shift ;;
    --no-upload-hint) UPLOAD_HINT=0; shift ;;
    --rollback) DO_ROLLBACK=1; shift ;;
    --list-backups) DO_LIST=1; shift ;;
    -h|--help) show_help; exit 0 ;;
    -*) fail "未知选项: $1（用 --help 查看用法）" ;;
    *) if [[ -z "${ARG_PKG}" ]]; then ARG_PKG="$1"; else warn "忽略多余参数: $1"; fi; shift ;;
  esac
done

current_archive() {
  # 兼容 macOS 自带 bash 3.2（无 readarray）：用 ls+wc 统计，要求 vendor 下恰好一个
  local count m
  count="$(ls "${VENDOR_DIR}"/TMSDK_*_arm64_default.publish.tar.gz 2>/dev/null | wc -l | tr -d ' ')"
  m="$(ls "${VENDOR_DIR}"/TMSDK_*_arm64_default.publish.tar.gz 2>/dev/null | head -1)"
  [[ "${count}" -eq 1 && -n "${m}" ]] && { echo "${m}"; return 0; }
  return 1
}

list_backups() {
  echo ""; echo "=== Linux SDK 备份列表 ==="
  if [[ ! -d "${BACKUP_ROOT}" ]]; then echo "  （无）"; exit 0; fi
  local found=0 d
  for d in "${BACKUP_ROOT}"/linux-*; do [[ -f "$d" ]] || continue; echo "  $(basename "$d")"; found=1; done
  [[ "${found}" -eq 1 ]] || echo "  （无）"
  exit 0
}

do_rollback() {
  local latest="" d
  for d in "${BACKUP_ROOT}"/linux-*.tar.gz; do [[ -f "$d" ]] || continue; latest="$d"; done
  [[ -n "${latest}" ]] || fail "没有可用备份"
  local old_count=0
  old_count="$(ls "${VENDOR_DIR}"/TMSDK_*_arm64_default.publish.tar.gz 2>/dev/null | wc -l | tr -d ' ')"
  log "回滚: 恢复 $(basename "${latest}")，移除现有 ${old_count} 个归档"
  rm -f "${VENDOR_DIR}"/TMSDK_*_arm64_default.publish.tar.gz
  cp "${latest}" "${VENDOR_DIR}/$(basename "${latest}" | sed -E 's/^linux-[0-9]{8}-[0-9]{6}-//')"
  ok "已恢复 vendor/ 归档。请在麒麟构建机上执行: npm run setup:kylin -- --build-only"
  exit 0
}

[[ "${DO_LIST}" -eq 1 ]] && list_backups
[[ "${DO_ROLLBACK}" -eq 1 ]] && do_rollback

#------------------------------------------------------------------------------
# 步骤 0: 校验分发包 + 解析版本
#------------------------------------------------------------------------------
log "步骤 0: 校验 SDK 分发包..."

[[ -n "${ARG_PKG}" ]] || { show_help; exit 1; }
[[ "${ARG_PKG}" = /* ]] || ARG_PKG="${PROJECT_DIR}/${ARG_PKG}"
[[ -e "${ARG_PKG}" ]] || fail "分发包不存在: ${ARG_PKG}"

STAGE_DIR=""
cleanup_stage() { [[ -n "${STAGE_DIR}" && -d "${STAGE_DIR}" ]] && rm -rf "${STAGE_DIR}"; return 0; }
trap cleanup_stage EXIT

validate_payload() {
  local base="$1"
  for item in "SDK/libwemeetsdk.so" "SDK/libwemeet_base.so" "SDK/Release" \
              "SDK/include/wemeet_sdk.h" "Electron_Demo/include/json/json.h"; do
    [[ -e "${base}/${item}" ]] || fail "分发包缺少: ${item}"
  done
}

if [[ -f "${ARG_PKG}" && "${ARG_PKG}" == *.tar.gz ]]; then
  PKG_ARCHIVE="$(cd "$(dirname "${ARG_PKG}")" && pwd)/$(basename "${ARG_PKG}")"
  PKG_NAME="$(basename "${PKG_ARCHIVE}")"
  [[ "${PKG_NAME}" == TMSDK_*_arm64_default.publish.tar.gz ]] \
    || fail "归档命名应为 TMSDK_*_arm64_default.publish.tar.gz: ${PKG_NAME}"
  NEW_VERSION_FULL="$(echo "${PKG_NAME}" | cut -d_ -f3)"
  [[ "${NEW_VERSION_FULL}" =~ ^[0-9]+(\.[0-9]+)+$ ]] || fail "无法从文件名解析版本号: ${PKG_NAME}"
  if [[ "${DRYRUN}" -eq 0 ]]; then
    STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/linux-sdk-update.XXXXXX")"
    log "  解压分发包以校验内部结构..."
    tar --no-same-owner --no-same-permissions -xzf "${PKG_ARCHIVE}" -C "${STAGE_DIR}"
    INNER="$(basename "$(find "${STAGE_DIR}" -maxdepth 1 -type d ! -path "${STAGE_DIR}" | head -1)")"
    [[ -n "${INNER}" ]] || fail "归档内没有顶层目录"
    validate_payload "${STAGE_DIR}/${INNER}"
    rm -rf "${STAGE_DIR}"  # 校验通过，提前清理
    STAGE_DIR=""
    ok "内部结构校验通过"
  fi
elif [[ -d "${ARG_PKG}" ]]; then
  validate_payload "${ARG_PKG%/}"
  PKG_NAME="$(basename "${ARG_PKG%/}")"
  NEW_VERSION_FULL="$(echo "${PKG_NAME}" | cut -d_ -f3)"
  [[ "${NEW_VERSION_FULL}" =~ ^[0-9]+(\.[0-9]+)+$ ]] || warn "无法从目录名解析版本号，请确认包名"
  # 目录形式：由本脚本代为打包成 vendor 规范归档名
  if [[ "${DRYRUN}" -eq 0 ]]; then
    STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/linux-sdk-update.XXXXXX")"
    PKG_ARCHIVE="${STAGE_DIR}/TMSDK_0300000000_${NEW_VERSION_FULL}_arm64_default.publish.tar.gz"
    log "  打包分发包目录为 vendor 规范归档..."
    tar --no-same-owner --no-same-permissions -czf "${PKG_ARCHIVE}" -C "$(dirname "${ARG_PKG%/}")" "${PKG_NAME}"
    ok "规范归档已生成"
  else
    PKG_ARCHIVE="<目录形式，dry-run 不打包>"
  fi
else
  fail "分发包必须是 .tar.gz 归档或解压后的目录"
fi

OLD_VERSION_FULL="unknown"
if OLD_ARCHIVE="$(current_archive)"; then
  OLD_VERSION_FULL="$(basename "${OLD_ARCHIVE}" .tar.gz | cut -d_ -f3)"
fi

echo ""
echo "  分发包:     ${PKG_NAME}"
echo "  新 SDK 版本: ${NEW_VERSION_FULL}"
echo "  当前版本:   ${OLD_VERSION_FULL}"
[[ "${DRYRUN}" -eq 1 ]] && warn "预览模式（--dry-run），不会修改任何文件"
echo ""
if [[ "${DRYRUN}" -eq 0 && "${ASSUME_YES}" -eq 0 ]]; then
  read -r -p "确认升级？[y/N] " ANS || true
  if [[ ! "${ANS:-}" =~ ^[Yy]$ ]]; then echo "已取消。"; [[ -z "${ANS:-}" ]] && echo "  （非交互终端请加 -y）"; exit 0; fi
fi

#------------------------------------------------------------------------------
# 步骤 1: 备份并替换 vendor 归档
#------------------------------------------------------------------------------
log "步骤 1: 备份旧归档并替换..."
if [[ "${DRYRUN}" -eq 1 ]]; then
  echo -e "  ${YELLOW}[DRYRUN]${NC} 旧归档 -> vendor/_backup/linux-${TS}-${OLD_VERSION_FULL}.tar.gz"
  echo -e "  ${YELLOW}[DRYRUN]${NC} 新归档 -> ${PKG_ARCHIVE}"
else
  mkdir -p "${BACKUP_ROOT}"
  if OLD_ARCHIVE="$(current_archive)"; then
    # 备份保留原始 TMSDK_* 文件名（回滚时据此还原规范名，保证 vendor 下唯一）
    cp "${OLD_ARCHIVE}" "${BACKUP_ROOT}/linux-${TS}-$(basename "${OLD_ARCHIVE}")"
    ok "已备份 -> vendor/_backup/linux-${TS}-$(basename "${OLD_ARCHIVE}")"
  else
    warn "vendor/ 下没有旧归档，跳过备份"
  fi
  # 先删后拷，保证 vendor 下唯一
  compgen -G "${VENDOR_DIR}/TMSDK_*_arm64_default.publish.tar.gz" >/dev/null && \
    rm -f "${VENDOR_DIR}"/TMSDK_*_arm64_default.publish.tar.gz
  cp "${PKG_ARCHIVE}" "${VENDOR_DIR}/$(basename "${PKG_ARCHIVE}")"
  ok "已替换 -> vendor/$(basename "${PKG_ARCHIVE}")"
fi

if [[ "${DRYRUN}" -eq 1 ]]; then
  echo ""; echo "=== 预览结束，未修改任何文件 ==="
  echo "  执行: ./update-linux-sdk.sh ${ARG_PKG} -y"
  exit 0
fi

#------------------------------------------------------------------------------
# 步骤 2: 构建（仅在麒麟 V10 上；其他环境跳过并给出指引）
#------------------------------------------------------------------------------
ADDON_BUILT=0
IS_KYLIN_BUILD_ENV=0
if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "aarch64" ]] \
   && [[ -f /etc/os-release ]] && grep -Eiq 'kylin|银河麒麟' /etc/os-release; then
  IS_KYLIN_BUILD_ENV=1
fi

if [[ "${DO_REBUILD}" -eq 0 ]]; then
  warn "已跳过构建（--no-rebuild）。请在麒麟构建机执行: npm run setup:kylin -- --build-only"
elif [[ "${IS_KYLIN_BUILD_ENV}" -eq 0 ]]; then
  warn "当前非麒麟 aarch64 环境（$(uname -s)/$(uname -m)），跳过构建"
  echo "        请在麒麟构建机执行: npm run setup:kylin -- --build-only"
else
  log "步骤 2: 执行离线构建 + 门禁（setup:kylin --build-only）..."
  npm run setup:kylin -- --build-only || fail "构建失败；vendor 归档已替换，可 --rollback 回退后排查"
  ADDON_BUILT=1
fi

#------------------------------------------------------------------------------
# 步骤 3: addon 回传（预编译产物入库，CI 只组装）
#------------------------------------------------------------------------------
if [[ "${ADDON_BUILT}" -eq 1 ]]; then
  log "步骤 3: addon 回传 packaging/prebuilt/..."
  [[ -f "${PROJECT_DIR}/output/linux/wemeet_electron_sdk.node" ]] \
    || fail "未找到编译产物 output/linux/wemeet_electron_sdk.node"
  cp "${PROJECT_DIR}/output/linux/wemeet_electron_sdk.node" \
     "${PROJECT_DIR}/packaging/prebuilt/wemeet_electron_sdk.arm64.node"
  ok "已回传 -> packaging/prebuilt/wemeet_electron_sdk.arm64.node"
fi

#------------------------------------------------------------------------------
# 摘要与下一步
#------------------------------------------------------------------------------
echo ""
echo "================================================================"
echo -e "${GREEN}  Linux SDK 升级完成！${NC}"
echo "================================================================"
echo ""
echo "📦 版本信息:"
echo "   新 SDK:      ${NEW_VERSION_FULL}"
echo "   旧 SDK:      ${OLD_VERSION_FULL}"
echo "   vendor 归档: $(current_archive >/dev/null 2>&1 && basename "$(current_archive)" || echo '未就位')"
echo ""
echo "📋 变更:"
echo "   vendor/TMSDK_*_arm64_default.publish.tar.gz"
[[ "${ADDON_BUILT}" -eq 1 ]] && echo "   packaging/prebuilt/wemeet_electron_sdk.arm64.node（已回传）"
echo ""
echo "🚀 下一步（缺一不可）:"
echo "   1. 检查 scripts/validate-linux-adapter.js 的 GetSDKVersion mock 是否需同步为 ${NEW_VERSION_FULL}"
echo "   2. 上传供应物（覆盖）:"
echo "      gh release upload vendor-supplies vendor/$(basename "$(current_archive)" 2>/dev/null || echo '<归档名>') --clobber"
echo "   3. 提交变更并 push → CI 自动出包（CI 按 TMSDK_* 通配下载，无需改 yaml）"
if [[ -n "$(ls "${BACKUP_ROOT}"/linux-${TS}-*.tar.gz 2>/dev/null)" ]]; then
  echo ""
  echo "   回滚: ./update-linux-sdk.sh --rollback"
fi
echo "================================================================"
