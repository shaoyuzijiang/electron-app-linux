#!/usr/bin/env bash
set -Eeuo pipefail

REAL_PYTHON="${WEMEET_REAL_PYTHON:-/usr/bin/python3}"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

[[ -x "$REAL_PYTHON" ]] || {
  echo "node-gyp Python wrapper 找不到真实 Python: $REAL_PYTHON" >&2
  exit 127
}

if [[ "${1:-}" != "-c" ]]; then
  exec "$REAL_PYTHON" "$@"
fi

CODE="${2:-}"
shift 2

# node-gyp 首次用 sys.executable 寻找解释器；返回 wrapper 本身，确保后续版本探测仍避开 Python -c。
if [[ "$CODE" == *'sys.executable.encode'* ]]; then
  printf '%s' "$SELF"
  exit 0
fi

# 部分麒麟 kysec 策略仅阻止 Python -c，允许执行受控脚本文件。
TEMP_SCRIPT="$(mktemp "${TMPDIR:-/tmp}/wemeet-node-gyp-python.XXXXXX.py")"
cleanup() { rm -f "$TEMP_SCRIPT"; }
trap cleanup EXIT
printf '%s\n' "$CODE" > "$TEMP_SCRIPT"
"$REAL_PYTHON" "$TEMP_SCRIPT" "$@"
