#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_ROOT="${1:-${WEMEET_SDK_ROOT:-}}"
SDK_ARCHIVE="$ROOT/vendor/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz"
OUTPUT="$ROOT/output/linux"
INCLUDE="$ROOT/native/include"
OUTPUT_STAGE="$ROOT/output/.linux-stage.$$"
INCLUDE_STAGE="$ROOT/native/.include-stage.$$"
VERIFY_STAGE="$(mktemp -d)"

fail() { echo "SDK 准备失败: $*" >&2; exit 1; }
cleanup() { rm -rf "$OUTPUT_STAGE" "$INCLUDE_STAGE" "$VERIFY_STAGE"; }
trap cleanup EXIT

[[ -n "$SDK_ROOT" ]] || fail "SDK 准备参数缺失，请执行 npm run setup:kylin"
[[ -f "$SDK_ARCHIVE" ]] || fail "缺少固定 SDK 归档: $SDK_ARCHIVE"
SDK_ROOT="$(cd "$SDK_ROOT" && pwd)"
SOURCE_SDK="$SDK_ROOT/SDK"
SOURCE_DEMO="$SDK_ROOT/Electron_Demo"
for item in "$SOURCE_SDK/libwemeetsdk.so" "$SOURCE_SDK/libwemeet_base.so" \
  "$SOURCE_SDK/Release" "$SOURCE_SDK/include/wemeet_sdk.h" "$SOURCE_DEMO/include/json/json.h"; do
  [[ -e "$item" ]] || fail "缺少 SDK 文件: $item"
done

# 无论来源路径为何，实际输入必须与项目中固定摘要的原始 SDK 归档完全一致。
tar --no-same-owner --no-same-permissions -xzf "$SDK_ARCHIVE" -C "$VERIFY_STAGE"
TRUSTED_ROOT="$VERIFY_STAGE/TMSDK_0300000000_3.26.100.14_arm64_default.publish"
HASH_ENTRIES=(SDK/libwemeetsdk.so SDK/libwemeet_base.so SDK/Release SDK/include Electron_Demo/include/json)
SOURCE_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$SDK_ROOT" "${HASH_ENTRIES[@]}")"
TRUSTED_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$TRUSTED_ROOT" "${HASH_ENTRIES[@]}")"
[[ "$SOURCE_TREE_SHA" == "$TRUSTED_TREE_SHA" ]] || fail "指定 SDK 目录与固定供应归档内容不一致"
SDK_ARCHIVE_SHA="$(sha256sum "$SDK_ARCHIVE" | awk '{print $1}')"

mkdir -p "$OUTPUT_STAGE" "$INCLUDE_STAGE/json"
# 正式构建绝不复用旧 addon；必须由本次 Electron headers 重新编译。
cp -f "$SOURCE_SDK/libwemeetsdk.so" "$SOURCE_SDK/libwemeet_base.so" "$OUTPUT_STAGE/"
cp -a "$SOURCE_SDK/Release" "$OUTPUT_STAGE/"
cp -f "$SOURCE_SDK/include/"*.h "$INCLUDE_STAGE/"
cp -f "$SOURCE_DEMO/include/json/"*.h "$INCLUDE_STAGE/json/"
if [[ -n "${WEMEET_SDK_ENV_FILE:-}" ]]; then
  cp -f "$WEMEET_SDK_ENV_FILE" "$OUTPUT_STAGE/saas_sdk_env.json"
  chmod 600 "$OUTPUT_STAGE/saas_sdk_env.json"
  echo "已复制显式指定的 SDK 环境文件；正式 DEB 会拒绝该文件。"
else
  echo "未复制 SDK 包自带 saas_sdk_env.json；Token 由后端动态签发。"
fi
chmod 0755 "$OUTPUT_STAGE/Release/QtWebEngineProcess" "$OUTPUT_STAGE/Release/tmsdkapp" || fail "无法设置 SDK 子进程可执行权限"
[[ -x "$OUTPUT_STAGE/Release/QtWebEngineProcess" && -x "$OUTPUT_STAGE/Release/tmsdkapp" ]] || fail "SDK 子进程不可执行"
RUNTIME_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$OUTPUT_STAGE" libwemeetsdk.so libwemeet_base.so Release)"
INCLUDE_TREE_SHA="$(node "$ROOT/scripts/hash-tree.js" "$INCLUDE_STAGE" .)"
SDK_ARCHIVE_SHA="$SDK_ARCHIVE_SHA" SOURCE_TREE_SHA="$SOURCE_TREE_SHA" RUNTIME_TREE_SHA="$RUNTIME_TREE_SHA" \
INCLUDE_TREE_SHA="$INCLUDE_TREE_SHA" node -e "const fs=require('fs'),e=process.env; fs.writeFileSync(process.argv[1],JSON.stringify({sdkVersion:'3.26.100.14',sdkArchiveSha256:e.SDK_ARCHIVE_SHA,sourceTreeSha256:e.SOURCE_TREE_SHA,preparedRuntimeTreeSha256:e.RUNTIME_TREE_SHA,preparedIncludeTreeSha256:e.INCLUDE_TREE_SHA,preparedAt:new Date().toISOString()},null,2)+'\n')" "$OUTPUT_STAGE/SDK_SOURCE_PROVENANCE.json"
(
  cd "$OUTPUT_STAGE"
  find . -type f ! -name SDK_FILES.sha256 ! -name SDK_SOURCE_PROVENANCE.json ! -name wemeet_electron_sdk.node -print0 | sort -z | xargs -0 sha256sum > SDK_FILES.sha256
)

mkdir -p "$ROOT/output" "$ROOT/native"
rm -rf "$OUTPUT.old" "$INCLUDE.old"
[[ ! -e "$OUTPUT" ]] || mv "$OUTPUT" "$OUTPUT.old"
[[ ! -e "$INCLUDE" ]] || mv "$INCLUDE" "$INCLUDE.old"
if ! mv "$OUTPUT_STAGE" "$OUTPUT" || ! mv "$INCLUDE_STAGE" "$INCLUDE"; then
  rm -rf "$OUTPUT" "$INCLUDE"
  [[ ! -e "$OUTPUT.old" ]] || mv "$OUTPUT.old" "$OUTPUT"
  [[ ! -e "$INCLUDE.old" ]] || mv "$INCLUDE.old" "$INCLUDE"
  fail "无法原子替换 SDK 目录"
fi
rm -rf "$OUTPUT.old" "$INCLUDE.old"
echo "SDK 3.26 可信依赖已准备到: $OUTPUT"
