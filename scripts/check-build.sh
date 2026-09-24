#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/output/linux"
ELECTRON_DIST="$ROOT/node_modules/electron/dist"
SDK_ARCHIVE="$ROOT/vendor/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz"
FAILED=0
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

ok() { echo "OK    $*"; }
fail_check() { echo "FAIL  $*" >&2; FAILED=1; }
require_file() { [[ -f "$1" ]] && ok "$1" || fail_check "缺少文件 $1"; }
require_exec() { [[ -x "$1" ]] && ok "$1" || fail_check "不可执行 $1"; }
version_le() { [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" == "$2" ]]; }

[[ "$(id -u)" -ne 0 ]] || fail_check "禁止使用 root/sudo"
[[ "$(uname -m)" == aarch64 ]] && ok "系统架构 aarch64" || fail_check "系统架构 $(uname -m)"
GLIBC_VERSION="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')"
[[ "$GLIBC_VERSION" == 2.31 ]] && ok "glibc 基线 $GLIBC_VERSION" || fail_check "正式构建固定 glibc 2.31，当前 ${GLIBC_VERSION:-unknown}"

KEY_FILES=(
  "$ELECTRON_DIST/electron"
  "$OUT/wemeet_electron_sdk.node"
  "$OUT/libwemeetsdk.so"
  "$OUT/libwemeet_base.so"
  "$OUT/Release/QtWebEngineProcess"
  "$OUT/Release/tmsdkapp"
  "$OUT/Release/plugins/platforms/libqxcb.so"
)
for file in "${KEY_FILES[@]}"; do require_file "$file"; done
require_exec "$ELECTRON_DIST/electron"
require_exec "$OUT/Release/QtWebEngineProcess"
require_exec "$OUT/Release/tmsdkapp"
require_file "$ROOT/node_modules/electron/path.txt"
require_file "$OUT/ADDON_BUILD_PROVENANCE.json"
[[ "$(cat "$ROOT/node_modules/electron/path.txt" 2>/dev/null)" == electron ]] && ok "Electron path.txt" || fail_check "Electron path.txt 无效"

while IFS= read -r -d '' file; do
  if file -b "$file" | grep -q ELF; then printf '%s\0' "$file"; fi
done < <(find "$ELECTRON_DIST" "$OUT" -type f -print0) > "$TMP/elf.list"
[[ -s "$TMP/elf.list" ]] || fail_check "未找到 ELF 运行文件"

# 不调用 ldd：麒麟安全认证会将 SDK 私有 Qt 库的 ldd 探测识别为未认证执行并反复弹窗。
# 依赖由 readelf NEEDED + 交付目录 + ldconfig 缓存静态解析，不会执行任何 SDK/Qt/Electron 二进制。
if ! bash "$ROOT/scripts/resolve-elf-dependencies.sh" --system-libraries "$ELECTRON_DIST" "$OUT" > "$TMP/system-libraries"; then
  fail_check "静态动态库依赖不完整"
fi

: > "$TMP/glibc.versions"
: > "$TMP/glibcxx.versions"
: > "$TMP/cxxabi.versions"
grep -E '/libstdc\+\+\.so\.6$' "$TMP/system-libraries" | sort -u > "$TMP/libstdcxx.paths" || true
while IFS= read -r -d '' file; do
  machine="$(readelf -h "$file" 2>/dev/null | awk -F: '/Machine:/ {gsub(/^[[:space:]]+/, "", $2); print $2}')"
  [[ "$machine" == *AArch64* ]] || fail_check "架构错误 $file: ${machine:-unknown}"
  readelf --version-info "$file" 2>/dev/null | grep -oE 'GLIBC_[0-9]+(\.[0-9]+)+' | sed 's/^GLIBC_//' >> "$TMP/glibc.versions" || true
  readelf --version-info "$file" 2>/dev/null | grep -oE 'GLIBCXX_[0-9]+(\.[0-9]+)+' | sed 's/^GLIBCXX_//' >> "$TMP/glibcxx.versions" || true
  readelf --version-info "$file" 2>/dev/null | grep -oE 'CXXABI_[0-9]+(\.[0-9]+)+' | sed 's/^CXXABI_//' >> "$TMP/cxxabi.versions" || true
  if readelf -d "$file" 2>/dev/null | grep -q '(NEEDED)'; then
    set +e
    output=""
    status=$?
    set -e
    if [[ "$status" -ne 0 ]] || grep -q 'not found' <<<"$output"; then
      fail_check "动态依赖不完整 $file"
      echo "$output" >&2
    else
      awk '/libstdc\+\+\.so\.6 => \// {print $3} /^\/.*libstdc\+\+\.so\.6/ {print $1}' <<<"$output" >> "$TMP/libstdcxx.paths"
    fi
  fi
done < "$TMP/elf.list"

MAX_GLIBC="$(sort -Vu "$TMP/glibc.versions" | tail -1)"
if [[ -n "$MAX_GLIBC" ]] && version_le "$MAX_GLIBC" 2.31; then ok "全部 ELF 最高 GLIBC_$MAX_GLIBC"; else
  fail_check "ELF 要求 GLIBC_${MAX_GLIBC:-unknown}，超过目标 2.31"
fi
MAX_GLIBCXX="$(sort -Vu "$TMP/glibcxx.versions" | tail -1)"
MAX_CXXABI="$(sort -Vu "$TMP/cxxabi.versions" | tail -1)"
sort -u "$TMP/libstdcxx.paths" -o "$TMP/libstdcxx.paths"
: > "$TMP/available-glibcxx"
: > "$TMP/available-cxxabi"
while IFS= read -r library; do
  [[ -f "$library" ]] || continue
  strings "$library" | grep -oE '^GLIBCXX_[0-9]+(\.[0-9]+)+$' | sed 's/^GLIBCXX_//' | sort -Vu | tail -1 >> "$TMP/available-glibcxx" || true
  strings "$library" | grep -oE '^CXXABI_[0-9]+(\.[0-9]+)+$' | sed 's/^CXXABI_//' | sort -Vu | tail -1 >> "$TMP/available-cxxabi" || true
done < "$TMP/libstdcxx.paths"
AVAILABLE_GLIBCXX="$(sort -Vu "$TMP/available-glibcxx" | head -1)"
AVAILABLE_CXXABI="$(sort -Vu "$TMP/available-cxxabi" | head -1)"
[[ -z "$MAX_GLIBCXX" || -n "$AVAILABLE_GLIBCXX" ]] || fail_check "ELF 需要 GLIBCXX，但运行时未解析到 libstdc++.so.6"
[[ -z "$MAX_CXXABI" || -n "$AVAILABLE_CXXABI" ]] || fail_check "ELF 需要 CXXABI，但运行时未解析到 libstdc++.so.6"
if [[ -z "$MAX_GLIBCXX" ]] || { [[ -n "$AVAILABLE_GLIBCXX" ]] && version_le "$MAX_GLIBCXX" "$AVAILABLE_GLIBCXX"; }; then
  ok "GLIBCXX_${MAX_GLIBCXX:-none} <= ${AVAILABLE_GLIBCXX:-none}"
else
  fail_check "GLIBCXX 版本超出构建基线"
fi
if [[ -z "$MAX_CXXABI" ]] || { [[ -n "$AVAILABLE_CXXABI" ]] && version_le "$MAX_CXXABI" "$AVAILABLE_CXXABI"; }; then
  ok "CXXABI_${MAX_CXXABI:-none} <= ${AVAILABLE_CXXABI:-none}"
else
  fail_check "CXXABI 版本超出构建基线"
fi

if [[ -f "$OUT/SDK_FILES.sha256" ]]; then
  (cd "$OUT" && sha256sum -c SDK_FILES.sha256 --status) && ok "SDK 文件哈希" || fail_check "SDK 文件哈希失败"
else
  fail_check "缺少 SDK_FILES.sha256"
fi

if [[ -f "$OUT/ADDON_BUILD_PROVENANCE.json" && -f "$OUT/wemeet_electron_sdk.node" ]]; then
  PROVENANCE="$OUT/ADDON_BUILD_PROVENANCE.json"
  EXPECTED_VERSION="$(node -p "require('$ROOT/vendor/electron-manifest.json').version")"
  ACTUAL_ADDON_SHA="$(sha256sum "$OUT/wemeet_electron_sdk.node" | awk '{print $1}')"
  ACTUAL_BUILD_INPUT_SHA="$(node "$ROOT/scripts/hash-tree.js" "$ROOT" binding.gyp native/linux native/include)"
  ACTUAL_SDK_SHA="$(sha256sum "$SDK_ARCHIVE" | awk '{print $1}')"
  HEADERS_FILE="$(node -p "require('$ROOT/vendor/electron-manifest.json').headers.file")"
  ACTUAL_HEADERS_ARCHIVE_SHA="$(sha256sum "$ROOT/vendor/$HEADERS_FILE" | awk '{print $1}')"
  ACTUAL_HEADERS_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$ROOT/.electron-headers" .)"
  SDK_PROVENANCE="$OUT/SDK_SOURCE_PROVENANCE.json"
  require_file "$SDK_PROVENANCE"
  ACTUAL_RUNTIME_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$OUT" libwemeetsdk.so libwemeet_base.so Release)"
  ACTUAL_INCLUDE_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$ROOT/native/include" .)"
  ACTUAL_NODE_GYP_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$ROOT/node_modules/node-gyp" .)"
  ACTUAL_PACKAGE_LOCK_SHA="$(sha256sum "$ROOT/package-lock.json" | awk '{print $1}')"
  ACTUAL_NODE_SHA="$(sha256sum "$(realpath "$(command -v node)")" | awk '{print $1}')"
  ACTUAL_NPM_SHA="$(sha256sum "$(realpath "$(command -v npm)")" | awk '{print $1}')"
  ACTUAL_COMPILER_SHA="$(sha256sum "$(realpath "$(command -v g++)")" | awk '{print $1}')"
  ACTUAL_LINKER_SHA="$(sha256sum "$(realpath "$(command -v ld)")" | awk '{print $1}')"
  ACTUAL_ASSEMBLER_SHA="$(sha256sum "$(realpath "$(command -v as)")" | awk '{print $1}')"
  ACTUAL_TOOLCHAIN_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" / usr/include usr/lib/gcc)"
  [[ "$(node -p "require('$PROVENANCE').electronVersion")" == "$EXPECTED_VERSION" ]] || fail_check "addon Electron 来源不匹配"
  [[ "$(node -p "require('$PROVENANCE').addonSha256")" == "$ACTUAL_ADDON_SHA" ]] || fail_check "addon SHA-256 不匹配"
  [[ "$(node -p "require('$PROVENANCE').buildInputTreeSha256")" == "$ACTUAL_BUILD_INPUT_SHA" ]] || fail_check "addon 实际编译输入不匹配"
  [[ "$(node -p "require('$PROVENANCE').sdkArchiveSha256")" == "$ACTUAL_SDK_SHA" ]] || fail_check "SDK 归档来源不匹配"
  [[ "$(node -p "require('$PROVENANCE').headersArchiveSha256")" == "$ACTUAL_HEADERS_ARCHIVE_SHA" ]] || fail_check "headers 归档来源不匹配"
  [[ "$(node -p "require('$PROVENANCE').headersTreeSha256")" == "$ACTUAL_HEADERS_TREE_SHA" ]] || fail_check "实际 headers 输入不匹配"
  [[ "$(node -p "require('$PROVENANCE').nodeGypTreeSha256")" == "$ACTUAL_NODE_GYP_TREE_SHA" ]] || fail_check "node-gyp 输入不匹配"
  [[ "$(node -p "require('$PROVENANCE').packageLockSha256")" == "$ACTUAL_PACKAGE_LOCK_SHA" ]] || fail_check "package-lock 输入不匹配"
  [[ "$(node -p "require('$PROVENANCE').nodeBinarySha256")" == "$ACTUAL_NODE_SHA" ]] || fail_check "Node 工具链不匹配"
  [[ "$(node -p "require('$PROVENANCE').npmExecutableSha256")" == "$ACTUAL_NPM_SHA" ]] || fail_check "npm 工具链不匹配"
  [[ "$(node -p "require('$PROVENANCE').compilerSha256")" == "$ACTUAL_COMPILER_SHA" ]] || fail_check "编译器不匹配"
  [[ "$(node -p "require('$PROVENANCE').linkerSha256")" == "$ACTUAL_LINKER_SHA" ]] || fail_check "链接器不匹配"
  [[ "$(node -p "require('$PROVENANCE').assemblerSha256")" == "$ACTUAL_ASSEMBLER_SHA" ]] || fail_check "汇编器不匹配"
  [[ "$(node -p "require('$PROVENANCE').systemToolchainTreeSha256")" == "$ACTUAL_TOOLCHAIN_TREE_SHA" ]] || fail_check "系统工具链头文件树不匹配"
  [[ "$(node -p "JSON.stringify(require('$PROVENANCE').buildFlags)")" == '{"cflags":"","cxxflags":"","cppflags":"","ldflags":""}' ]] || fail_check "正式构建包含外部 flags"
  [[ "$(node -p "require('$SDK_PROVENANCE').preparedRuntimeTreeSha256")" == "$ACTUAL_RUNTIME_TREE_SHA" ]] || fail_check "实际 SDK 运行库输入不匹配"
  [[ "$(node -p "require('$SDK_PROVENANCE').preparedIncludeTreeSha256")" == "$ACTUAL_INCLUDE_TREE_SHA" ]] || fail_check "实际 SDK headers 输入不匹配"
  [[ "$(node -p "require('$PROVENANCE').sdkSourceTreeSha256")" == "$(node -p "require('$SDK_PROVENANCE').sourceTreeSha256")" ]] || fail_check "SDK 来源树不匹配"
  [[ "$(node -p "require('$PROVENANCE').glibc")" == 2.31 ]] || fail_check "addon 非 glibc 2.31 基线构建"
  [[ "$(node -p "require('$PROVENANCE').osReleaseSha256")" == "$(sha256sum /etc/os-release | awk '{print $1}')" ]] || fail_check "addon 构建系统身份不匹配"
  [[ "$FAILED" -ne 0 ]] || ok "addon 构建来源完整"
fi

MAX_GLIBC="$MAX_GLIBC" MAX_GLIBCXX="$MAX_GLIBCXX" MAX_CXXABI="$MAX_CXXABI" \
AVAILABLE_GLIBCXX="$AVAILABLE_GLIBCXX" AVAILABLE_CXXABI="$AVAILABLE_CXXABI" \
node -e "const fs=require('fs'),e=process.env; fs.writeFileSync(process.argv[1],JSON.stringify({targetGlibc:'2.31',maxRequiredGlibc:e.MAX_GLIBC,maxRequiredGlibcxx:e.MAX_GLIBCXX,maxRequiredCxxabi:e.MAX_CXXABI,availableGlibcxx:e.AVAILABLE_GLIBCXX,availableCxxabi:e.AVAILABLE_CXXABI,checkedAt:new Date().toISOString()},null,2)+'\n')" "$OUT/ELF_COMPATIBILITY.json"

USERNS_OK=0
if command -v unshare >/dev/null 2>&1 && timeout 10 unshare --user --map-root-user true >/dev/null 2>&1; then USERNS_OK=1; fi
if [[ "$USERNS_OK" == 1 ]]; then
  ok "当前用户可实际创建 user namespace"
else
  SANDBOX="$ELECTRON_DIST/chrome-sandbox"
  OWNER="$(stat -c %u "$SANDBOX" 2>/dev/null || echo -1)"
  MODE="$(stat -c %a "$SANDBOX" 2>/dev/null || echo 0)"
  [[ "$OWNER" == 0 && "$MODE" == 4755 ]] && ok "Chromium SUID sandbox 可用" || fail_check "Chromium sandbox 不可用：请由管理员启用 user namespace；不要使用 --no-sandbox"
fi

exit "$FAILED"
