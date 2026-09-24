#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

MODE="${1:---check}"
case "$MODE" in
  --check|--system-libraries) shift ;;
  *) echo "用法: $0 [--check|--system-libraries] <ELF目录>..." >&2; exit 2 ;;
esac
[[ "$#" -gt 0 ]] || { echo "缺少 ELF 目录" >&2; exit 2; }
for dir in "$@"; do
  [[ -d "$dir" ]] || { echo "ELF 目录不存在: $dir" >&2; exit 2; }
done
command -v readelf >/dev/null 2>&1 || { echo "缺少 readelf" >&2; exit 3; }
command -v ldconfig >/dev/null 2>&1 || { echo "缺少 ldconfig" >&2; exit 3; }

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# 仅静态读取 ELF 的 NEEDED 字段；不调用 ldd，避免麒麟安全中心把 SDK 私有 Qt 库误认为待执行应用。
declare -A LOCAL_LIBRARIES=()
while IFS=$'\t' read -r name path; do
  [[ -n "$name" && -n "$path" ]] || continue
  LOCAL_LIBRARIES["$name"]="$path"
done < <(find "$@" \( -type f -o -type l \) -printf '%f\t%p\n')

ldconfig -p 2>/dev/null | awk '/=> \/[^[:space:]]+$/ { print $1 "\t" $NF }' > "$TMP/ldconfig"
[[ -s "$TMP/ldconfig" ]] || { echo "ldconfig 缓存为空，无法解析系统动态库" >&2; exit 3; }

resolve_system_library() {
  local library="$1"
  awk -F $'\t' -v name="$library" '$1 == name { print $2; exit }' "$TMP/ldconfig"
}

: > "$TMP/system-libraries"
: > "$TMP/missing"
ELF_COUNT=0
while IFS= read -r -d '' elf; do
  file -b "$elf" | grep -q ELF || continue
  readelf -d "$elf" 2>/dev/null | grep -q '(NEEDED)' || continue
  ELF_COUNT=$((ELF_COUNT + 1))
  while IFS= read -r needed; do
    [[ -n "$needed" ]] || continue
    if [[ -n "${LOCAL_LIBRARIES[$needed]:-}" ]]; then
      continue
    fi
    system_path="$(resolve_system_library "$needed")"
    if [[ -n "$system_path" ]]; then
      printf '%s\n' "$system_path" >> "$TMP/system-libraries"
    else
      printf '%s\t%s\n' "$elf" "$needed" >> "$TMP/missing"
    fi
  done < <(readelf -d "$elf" 2>/dev/null | awk '/\(NEEDED\)/ { gsub(/[\[\]]/, "", $NF); print $NF }')
done < <(find "$@" -type f -print0)

if [[ -s "$TMP/missing" ]]; then
  while IFS=$'\t' read -r elf needed; do
    echo "静态动态库解析失败: $elf 需要 $needed，但它既不在交付目录也不在 ldconfig 缓存中" >&2
  done < "$TMP/missing"
  exit 4
fi

if [[ "$MODE" == --system-libraries ]]; then
  sort -u "$TMP/system-libraries"
else
  echo "静态 ELF 依赖检查通过：$ELF_COUNT 个文件；未执行 SDK、Qt 或 Electron 二进制。"
fi
