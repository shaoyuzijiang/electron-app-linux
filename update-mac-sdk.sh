#!/bin/bash
#===============================================================================
# update-sdk.sh — 腾讯会议 SDK 一键升级脚本
#
# 自动完成 SDK 分发包到项目的完整更新流程：
#   1. 校验分发包版本（读取 metadata.json）
#   2. 替换 wemeet_sdk/wemeet.cpp（C++ 原生模块封装）
#   3. 运行官方 mac_split_framework 拆分双架构 Framework 为单架构（减小安装包体积）
#   4. 替换 wemeet_sdk/mac/Frameworks/{arm64,x86_64}/TMSDK.framework（单架构）
#   5. 更新 package.json / package-lock.json 版本号
#   6. 清理 Electron.app 旧 framework + 编译缓存
#   7. 重新编译原生模块（arm64 + x64）
#   8. 验证 SDK 版本
#
# 用法:
#   ./update-sdk.sh <SDK分发包目录>
#
# 示例:
#   ./update-sdk.sh TMSDK_MacOS_3.43.112.62_20260910_publish_release
#
# 分发包目录结构要求（腾讯会议官方发布包）:
#   <目录>/
#     ├── metadata.json                      ← 版本信息
#     ├── SDK/TMSDK.framework                ← SDK 动态库（通用二进制）
#     └── tmsdk-node-addon/src/wemeet.cpp    ← C++ 封装层源码
#===============================================================================
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_DIR="$(pwd)"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅ $*${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  $*${NC}"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $*${NC}"; exit 1; }

#===============================================================================
# 参数校验
#===============================================================================
SDK_PACKAGE_DIR="${1:-}"
if [[ -z "${SDK_PACKAGE_DIR}" ]]; then
  echo "用法: $0 <SDK分发包目录>"
  echo "示例: $0 TMSDK_MacOS_3.43.112.62_20260910_publish_release"
  exit 1
fi

# 支持相对路径和绝对路径
if [[ ! "${SDK_PACKAGE_DIR}" = /* ]]; then
  SDK_PACKAGE_DIR="${PROJECT_DIR}/${SDK_PACKAGE_DIR}"
fi

[[ -d "${SDK_PACKAGE_DIR}" ]] || fail "SDK 分发包目录不存在: ${SDK_PACKAGE_DIR}"

log "SDK 分发包: ${SDK_PACKAGE_DIR}"

#===============================================================================
# 步骤 0: 校验分发包结构并读取版本
#===============================================================================
log "步骤 0: 校验分发包结构..."

METADATA="${SDK_PACKAGE_DIR}/metadata.json"
SDK_FRAMEWORK_SRC="${SDK_PACKAGE_DIR}/SDK/TMSDK.framework"
WEMEET_CPP_SRC="${SDK_PACKAGE_DIR}/tmsdk-node-addon/src/wemeet.cpp"

[[ -f "${METADATA}" ]]       || fail "缺少 metadata.json"
[[ -d "${SDK_FRAMEWORK_SRC}" ]] || fail "缺少 SDK/TMSDK.framework"
[[ -f "${WEMEET_CPP_SRC}" ]] || fail "缺少 tmsdk-node-addon/src/wemeet.cpp"

# 读取完整版本号（如 3.43.112.62）
NEW_VERSION_FULL=$(node -p "require('${METADATA}').version")
[[ -n "${NEW_VERSION_FULL}" ]] || fail "metadata.json 中无 version 字段"

# 主版本号（前 3 位，如 3.43.112）用于 package.json
NEW_VERSION=$(echo "${NEW_VERSION_FULL}" | cut -d. -f1-3)

# 当前版本
OLD_VERSION=$(node -p "require('./package.json').version")

ok "新版本: ${NEW_VERSION_FULL} (package.json: ${NEW_VERSION}), 当前版本: ${OLD_VERSION}"

if [[ "${NEW_VERSION}" == "${OLD_VERSION}" ]]; then
  warn "版本号相同（${NEW_VERSION}），仍将继续更新文件"
fi

#===============================================================================
# 步骤 1: 重新拷贝 wemeet.cpp（先删后拷）
#===============================================================================
log "步骤 1: 重新拷贝 wemeet_sdk/wemeet.cpp（先删后拷）..."

rm -f "${PROJECT_DIR}/wemeet_sdk/wemeet.cpp"
cp "${WEMEET_CPP_SRC}" "${PROJECT_DIR}/wemeet_sdk/wemeet.cpp"

ok "wemeet.cpp 已更新"

#===============================================================================
# 步骤 2: 拆分 SDK Framework 为单架构（减小安装包体积）
#===============================================================================
log "步骤 2: 拆分 SDK Framework 为单架构..."

SPLIT_SCRIPT="${SDK_PACKAGE_DIR}/SDK/mac_split_framework"
SDK_FRAMEWORK_ARM64="${SDK_PACKAGE_DIR}/SDK/arm64/TMSDK.framework"
SDK_FRAMEWORK_X86_64="${SDK_PACKAGE_DIR}/SDK/x86_64/TMSDK.framework"

# 检查是否已拆分过（存在单架构目录则跳过）
if [[ -d "${SDK_FRAMEWORK_ARM64}" && -d "${SDK_FRAMEWORK_X86_64}" ]]; then
  ok "已存在单架构 Framework（arm64/ + x86_64/），跳过拆分"
else
  # 需要拆分：检查拆分脚本是否存在
  [[ -f "${SPLIT_SCRIPT}" ]] || fail "缺少 SDK/mac_split_framework 拆分脚本，且无现成的单架构目录"

  # 检查主二进制是否为双架构
  MAIN_BIN="${SDK_FRAMEWORK_SRC}/Versions/A/TMSDK"
  if ! file "${MAIN_BIN}" | grep -q "universal"; then
    warn "Framework 非双架构，无需拆分，直接使用"
  else
    log "  运行官方拆分脚本（lipo 剥离非目标架构，嵌套子 framework 同步拆分）..."
    # 拆分脚本在 SDK 目录内运行，生成 SDK/arm64/ 和 SDK/x86_64/
    (cd "${SDK_PACKAGE_DIR}/SDK" && bash mac_split_framework) || fail "架构拆分失败"

    # 验证拆分结果
    [[ -d "${SDK_FRAMEWORK_ARM64}" ]] || fail "拆分后未找到 SDK/arm64/TMSDK.framework"
    [[ -d "${SDK_FRAMEWORK_X86_64}" ]] || fail "拆分后未找到 SDK/x86_64/TMSDK.framework"
    ok "拆分完成: SDK/arm64/ + SDK/x86_64/"

    # 验证单架构
    ARM_ARCHS=$(lipo -archs "${SDK_FRAMEWORK_ARM64}/Versions/A/TMSDK" 2>/dev/null || echo "未知")
    X86_ARCHS=$(lipo -archs "${SDK_FRAMEWORK_X86_64}/Versions/A/TMSDK" 2>/dev/null || echo "未知")
    ok "arm64 包架构: ${ARM_ARCHS}, x86_64 包架构: ${X86_ARCHS}"
  fi
fi

#===============================================================================
# 步骤 3: 拷贝单架构 Framework 到项目
#===============================================================================
log "步骤 3: 替换 SDK Framework（单架构）..."

# arm64
rm -rf "${PROJECT_DIR}/wemeet_sdk/mac/Frameworks/arm64/TMSDK.framework"
if [[ -d "${SDK_FRAMEWORK_ARM64}" ]]; then
  cp -R "${SDK_FRAMEWORK_ARM64}" "${PROJECT_DIR}/wemeet_sdk/mac/Frameworks/arm64/TMSDK.framework"
else
  # 兜底：单架构目录不存在时使用通用二进制
  warn "SDK/arm64/ 不存在，回退使用通用二进制"
  cp -R "${SDK_FRAMEWORK_SRC}" "${PROJECT_DIR}/wemeet_sdk/mac/Frameworks/arm64/TMSDK.framework"
fi
ok "TMSDK.framework 已替换 -> wemeet_sdk/mac/Frameworks/arm64/"

# x86_64
rm -rf "${PROJECT_DIR}/wemeet_sdk/mac/Frameworks/x86_64/TMSDK.framework"
if [[ -d "${SDK_FRAMEWORK_X86_64}" ]]; then
  cp -R "${SDK_FRAMEWORK_X86_64}" "${PROJECT_DIR}/wemeet_sdk/mac/Frameworks/x86_64/TMSDK.framework"
else
  warn "SDK/x86_64/ 不存在，回退使用通用二进制"
  cp -R "${SDK_FRAMEWORK_SRC}" "${PROJECT_DIR}/wemeet_sdk/mac/Frameworks/x86_64/TMSDK.framework"
fi
ok "TMSDK.framework 已替换 -> wemeet_sdk/mac/Frameworks/x86_64/"

# 显示体积对比
FW_UNIVERSAL_SIZE=$(du -sh "${SDK_FRAMEWORK_SRC}" 2>/dev/null | awk '{print $1}')
FW_ARM64_SIZE=$(du -sh "${PROJECT_DIR}/wemeet_sdk/mac/Frameworks/arm64/TMSDK.framework" 2>/dev/null | awk '{print $1}')
FW_X64_SIZE=$(du -sh "${PROJECT_DIR}/wemeet_sdk/mac/Frameworks/x86_64/TMSDK.framework" 2>/dev/null | awk '{print $1}')
ok "体积: 通用=${FW_UNIVERSAL_SIZE}, arm64=${FW_ARM64_SIZE}, x86_64=${FW_X64_SIZE}"

#===============================================================================
# 步骤 4: 更新版本号
#===============================================================================
log "步骤 4: 更新 package.json / package-lock.json 版本号..."

node -e "
const fs = require('fs');
for (const file of ['package.json', 'package-lock.json']) {
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  data.version = '${NEW_VERSION}';
  if (data.packages && data.packages['']) {
    data.packages[''].version = '${NEW_VERSION}';
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('  已更新 ' + file + ' -> ${NEW_VERSION}');
}
"

ok "版本号已更新为 ${NEW_VERSION}"

#===============================================================================
# 步骤 5: 清理旧缓存
#===============================================================================
log "步骤 5: 清理 Electron.app 旧 framework 和编译缓存..."

ELECTRON_FRAMEWORK="${PROJECT_DIR}/node_modules/electron/dist/Electron.app/Contents/Frameworks/TMSDK.framework"
if [[ -d "${ELECTRON_FRAMEWORK}" ]]; then
  rm -rf "${ELECTRON_FRAMEWORK}"
  ok "已清理 Electron.app 旧 framework"
fi

if [[ -d "${PROJECT_DIR}/build" ]]; then
  rm -rf "${PROJECT_DIR}/build"
  ok "已清理 build/ 编译缓存"
fi

#===============================================================================
# 步骤 6: 重新编译原生模块 + 保存 dSYM（原生模块编译只在此脚本执行）
#   dSYM 保存到 dSYM/mac/native/{arch}/，build-all-mac.sh 会打包进统一符号表
#===============================================================================
log "步骤 6: 重新编译原生模块 (arm64)..."

npm run build:native:mac-arm64 || fail "arm64 原生模块编译失败"
ok "arm64 编译完成"

# 保存 arm64 dSYM（供 build-all-mac.sh 打进统一符号表）
if [[ -d "${PROJECT_DIR}/build/Release/wemeet_electron_sdk.node.dSYM" ]]; then
  rm -rf "${PROJECT_DIR}/dSYM/mac/native/arm64"
  mkdir -p "${PROJECT_DIR}/dSYM/mac/native/arm64"
  cp -R "${PROJECT_DIR}/build/Release/wemeet_electron_sdk.node.dSYM" \
        "${PROJECT_DIR}/dSYM/mac/native/arm64/wemeet_electron_sdk.arm64.dSYM"
  ok "arm64 原生模块 dSYM 已保存到 dSYM/mac/native/arm64/"
fi

log "步骤 6: 重新编译原生模块 (x64)..."

npm run build:native:mac-x64 || fail "x64 原生模块编译失败"
ok "x64 编译完成"

# 保存 x64 dSYM
if [[ -d "${PROJECT_DIR}/build/Release/wemeet_electron_sdk.node.dSYM" ]]; then
  rm -rf "${PROJECT_DIR}/dSYM/mac/native/x64"
  mkdir -p "${PROJECT_DIR}/dSYM/mac/native/x64"
  cp -R "${PROJECT_DIR}/build/Release/wemeet_electron_sdk.node.dSYM" \
        "${PROJECT_DIR}/dSYM/mac/native/x64/wemeet_electron_sdk.x64.dSYM"
  ok "x64 原生模块 dSYM 已保存到 dSYM/mac/native/x64/"
fi

# 编译产物已拷到 output/mac/、dSYM 已保存，删除编译中间文件释放磁盘
if [[ -d "${PROJECT_DIR}/build" ]]; then
  build_size=$(du -sh "${PROJECT_DIR}/build" | awk '{print $1}')
  rm -rf "${PROJECT_DIR}/build"
  ok "build/ 编译中间文件已删除 (${build_size})"
fi

# 用 arm64 版覆盖无后缀的 .node（wemeet-sdk.js 优先加载无后缀版本）
cp "${PROJECT_DIR}/output/mac/wemeet_electron_sdk.arm64.node" \
   "${PROJECT_DIR}/output/mac/wemeet_electron_sdk.node"

ok "已同步 wemeet_electron_sdk.node"

#===============================================================================
# 步骤 7: 验证
#===============================================================================
log "步骤 7: 验证 SDK 版本..."

# 验证源 framework 版本
FW_VERSION=$(PlistBuddy -c "Print CFBundleShortVersionString" \
  "${PROJECT_DIR}/wemeet_sdk/mac/Frameworks/arm64/TMSDK.framework/Versions/A/Resources/Info.plist" 2>/dev/null || echo "未知")

# 验证 .node 编译产物
NODE_ARM64="${PROJECT_DIR}/output/mac/wemeet_electron_sdk.arm64.node"
NODE_X64="${PROJECT_DIR}/output/mac/wemeet_electron_sdk.x64.node"

echo ""
echo "================================================================"
echo -e "${GREEN}  SDK 更新完成！${NC}"
echo "================================================================"
echo ""
echo "📦 版本信息:"
echo "   分发包版本:  ${NEW_VERSION_FULL}"
echo "   package.json: ${NEW_VERSION}"
echo "   Framework:    ${FW_VERSION}"
echo ""
echo "📁 编译产物:"
ls -lh "${NODE_ARM64}" "${NODE_X64}" | awk '{printf "   %s   %s\n", $5, $NF}'
echo ""
echo "📋 变更文件:"
echo "   wemeet_sdk/wemeet.cpp"
echo "   wemeet_sdk/mac/Frameworks/arm64/TMSDK.framework"
echo "   wemeet_sdk/mac/Frameworks/x86_64/TMSDK.framework"
echo "   package.json"
echo "   package-lock.json"
echo "   output/mac/wemeet_electron_sdk.{arm64,x64}.node"
echo ""
echo "🚀 下一步:"
echo "   npm run dev                    # 开发验证"
echo "   ./build-all-mac.sh             # 完整打包"
echo ""
echo "   （可选）同步更新 releasenotes.md 中的 SDK 版本记录"
echo "================================================================"
