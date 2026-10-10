#!/bin/bash
#===============================================================================
# symbolicate.sh — 自动符号化 macOS 崩溃报告
#
# 用法:
#   ./symbolicate.sh <crash文件> [架构]
#
# 示例:
#   ./symbolicate.sh ~/Desktop/腾讯会议SDK Demo-2026-07-31.crash
#   ./symbolicate.sh ~/Desktop/some.crash arm64
#
# 会自动:
#   1. 在 dSYM/mac/ 和 dist/symbols/ 中查找匹配的 dSYM
#   2. 解析 crash 报告中的每个模块地址
#   3. 输出带函数名+源码行号的完整调用栈
#===============================================================================
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_DIR="$(pwd)"
DSYM_DOWNLOAD_DIR="${PROJECT_DIR}/dSYM/mac"
DSYM_BUILD_DIR="${PROJECT_DIR}/dist/symbols"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

CRASH_FILE="${1:-}"
if [[ -z "${CRASH_FILE}" ]] || [[ ! -f "${CRASH_FILE}" ]]; then
  echo -e "${RED}用法: $0 <crash文件> [架构]${NC}"
  echo "示例: $0 ~/Desktop/app.crash arm64"
  exit 1
fi

# 自动检测架构
ARCH="${2:-}"
if [[ -z "${ARCH}" ]]; then
  if grep -q "x86_64" "${CRASH_FILE}" 2>/dev/null; then
    ARCH="x64"
  elif grep -q "arm64" "${CRASH_FILE}" 2>/dev/null; then
    ARCH="arm64"
  else
    # 默认 arm64
    ARCH="arm64"
  fi
fi

echo -e "${CYAN}=== 崩溃报告符号化 ===${NC}"
echo "文件: ${CRASH_FILE}"
echo "架构: ${ARCH}"
echo ""

# 收集所有 dSYM 文件路径
collect_dsym_paths() {
  local arch="$1"
  # 下载的 Electron dSYM
  if [[ -d "${DSYM_DOWNLOAD_DIR}/${arch}" ]]; then
    find "${DSYM_DOWNLOAD_DIR}/${arch}" -name "*.dSYM" -type d 2>/dev/null
  fi
  # 编译的原生模块 dSYM
  if [[ -d "${DSYM_BUILD_DIR}/${arch}" ]]; then
    find "${DSYM_BUILD_DIR}/${arch}" -name "*.dSYM" -type d 2>/dev/null
  fi
}

# 构建 模块名 -> dSYM中 DWARF 文件路径 的映射
declare -A DSYM_MAP

build_dsym_map() {
  local arch="$1"
  while IFS= read -r dsym_dir; do
    [[ -z "${dsym_dir}" ]] && continue
    local name
    name=$(basename "${dsym_dir}" .dSYM)
    local dwarf_bin
    dwarf_bin="${dsym_dir}/Contents/Resources/DWARF/"
    if [[ -d "${dwarf_bin}" ]]; then
      local bin_file
      bin_file=$(ls "${dwarf_bin}" 2>/dev/null | head -1)
      if [[ -n "${bin_file}" ]]; then
        DSYM_MAP["${name}"]="${dwarf_bin}${bin_file}"
      fi
    fi
  done < <(collect_dsym_paths "${arch}")
}

echo -e "${CYAN}可用的 dSYM 符号表:${NC}"
build_dsym_map "${ARCH}"
for name in "${!DSYM_MAP[@]}"; do
  echo "  ${name} -> ${DSYM_MAP[$name]#${PROJECT_DIR}/}"
done
echo ""

if [[ ${#DSYM_MAP[@]} -eq 0 ]]; then
  echo -e "${RED}未找到任何 dSYM 文件！${NC}"
  echo "请先运行 ./build-all-mac.sh 生成符号表"
  exit 1
fi

# 从 crash 报告的 Binary Images 行解析模块的加载基址
# 格式示例:
#   0x7fff20000000 - 0x7fff2fffffff  Electron Framework (???) <UUID> /path/to/Electron Framework
#   0x10a0000000 - 0x10a00fffff     wemeet_electron_sdk.node (0) <UUID> /path/to/wemeet_electron_sdk.node
parse_binary_images() {
  local crash_file="$1"
  # 提取: 起始地址 模块名
  # 匹配 "0x... - 0x... 模块名" 格式
  grep -E '^\s*0x[0-9a-f]+' "${crash_file}" | \
    sed -E 's/^\s*(0x[0-9a-f]+)\s*-\s*0x[0-9a-f]+\s+(\S+).*/\1 \2/' | \
    while read -r base_addr module_name; do
      echo "${base_addr} ${module_name}"
    done
}

# 构建 模块名 -> 加载基址 的映射
declare -A MODULE_BASE

echo -e "${CYAN}解析 Binary Images...${NC}"
while IFS=' ' read -r base_addr module_name; do
  MODULE_BASE["${module_name}"]="${base_addr}"
  # 只显示有对应 dSYM 的模块
  if [[ -n "${DSYM_MAP[$module_name]:-}" ]]; then
    echo "  ${module_name}: base=${base_addr}"
  fi
done < <(parse_binary_images "${CRASH_FILE}")
echo ""

# 符号化单个地址
# 参数: 模块名 崩溃地址
symbolicate_address() {
  local module="$1"
  local addr="$2"

  local dsym_bin="${DSYM_MAP[$module]:-}"
  if [[ -z "${dsym_bin}" ]]; then
    echo "  ${addr}  ${module}  (无符号表)"
    return
  fi

  local base="${MODULE_BASE[$module]:-}"
  if [[ -z "${base}" ]]; then
    echo "  ${addr}  ${module}  (无加载基址)"
    return
  fi

  # 转换架构名: x64 -> x86_64
  local atos_arch="${ARCH}"
  [[ "${atos_arch}" == "x64" ]] && atos_arch="x86_64"

  local result
  result=$(atos -arch "${atos_arch}" -o "${dsym_bin}" -l "${base}" "${addr}" 2>/dev/null) || \
    result="(符号化失败)"

  echo "  ${addr}  ${module}  ${result}"
}

# 提取并符号化所有崩溃线程的调用栈
echo -e "${CYAN}=== 崩溃线程调用栈 ===${NC}"
echo ""

# 找到崩溃线程
crash_thread=""
in_crashed_section=false
in_stack=false

while IFS= read -r line; do
  # 检测崩溃线程标记
  if echo "$line" | grep -qE "Thread .* Crashed:"; then
    crash_thread=$(echo "$line" | grep -oE "Thread [0-9]+")
    echo -e "${RED}${crash_thread} Crashed:${NC}"
    in_crashed_section=true
    in_stack=true
    continue
  fi

  # 在崩溃线程的栈帧中
  if [[ "${in_stack}" == "true" ]]; then
    # 空行表示栈结束
    if [[ -z "$(echo "$line" | tr -d '[:space:]')" ]]; then
      in_stack=false
      echo ""
      continue
    fi

    # 解析栈帧: "0 模块名 0x地址 ..."
    if echo "$line" | grep -qE '^\s*[0-9]+\s+\S+\s+0x[0-9a-f]+'; then
      frame_num=$(echo "$line" | awk '{print $1}')
      module=$(echo "$line" | awk '{print $2}')
      addr=$(echo "$line" | awk '{print $3}')

      symbolicate_address "${module}" "${addr}"
    fi
  fi
done < "${CRASH_FILE}"

echo ""
echo -e "${GREEN}=== 符号化完成 ===${NC}"
echo ""
echo "提示: 如果某些地址显示 '(无符号表)'，说明该模块没有对应的 dSYM"
echo "      系统库（libsystem_kernel 等）不需要符号表"
