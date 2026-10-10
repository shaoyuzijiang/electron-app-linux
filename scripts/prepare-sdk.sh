#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_ROOT="${1:-${WEMEET_SDK_ROOT:-}}"
# vendor 下应恰好有一个 Linux SDK 归档（文件名含版本号，升级 SDK 只需替换该文件）
SDK_ARCHIVE_MATCHES=()
if compgen -G "$ROOT/vendor/TMSDK_*_arm64_default.publish.tar.gz" >/dev/null; then
  readarray -t SDK_ARCHIVE_MATCHES < <(ls "$ROOT"/vendor/TMSDK_*_arm64_default.publish.tar.gz)
fi
SDK_ARCHIVE="${SDK_ARCHIVE_MATCHES[0]:-}"
OUTPUT="$ROOT/output/linux"
INCLUDE="$ROOT/native/include"
OUTPUT_STAGE="$ROOT/output/.linux-stage.$$"
INCLUDE_STAGE="$ROOT/native/.include-stage.$$"

fail() { echo "SDK 准备失败: $*" >&2; exit 1; }
cleanup() { rm -rf "$OUTPUT_STAGE" "$INCLUDE_STAGE"; }
trap cleanup EXIT

[[ -n "$SDK_ROOT" ]] || fail "SDK 准备参数缺失，请执行 npm run setup:kylin"
[[ ${#SDK_ARCHIVE_MATCHES[@]} -eq 1 && -n "$SDK_ARCHIVE" ]] \
  || fail "vendor/ 下应恰好有一个 TMSDK_*_arm64_default.publish.tar.gz，当前 ${#SDK_ARCHIVE_MATCHES[@]} 个"
SDK_ROOT="$(cd "$SDK_ROOT" && pwd)"
SOURCE_SDK="$SDK_ROOT/SDK"
SOURCE_DEMO="$SDK_ROOT/Electron_Demo"
for item in "$SOURCE_SDK/libwemeetsdk.so" "$SOURCE_SDK/libwemeet_base.so" \
  "$SOURCE_SDK/Release" "$SOURCE_SDK/include/wemeet_sdk.h" "$SOURCE_DEMO/include/json/json.h"; do
  [[ -e "$item" ]] || fail "缺少 SDK 文件: $item"
done

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
echo "SDK 3.26 运行依赖已准备到: $OUTPUT"
