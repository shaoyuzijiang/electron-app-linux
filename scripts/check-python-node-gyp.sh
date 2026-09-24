#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_BIN="${1:-${PYTHON:-$(command -v python3 2>/dev/null || true)}}"
WRAPPER="$ROOT/scripts/python-node-gyp-wrapper.sh"

fail() { echo "node-gyp Python 预检失败: $*" >&2; exit 1; }
[[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || fail "找不到可执行 Python 3"
[[ -x "$WRAPPER" ]] || fail "Python wrapper 不可执行: $WRAPPER"

PYTHON_VERSION="$("$PYTHON_BIN" --version 2>&1 || true)"
[[ "$PYTHON_VERSION" == Python\ 3.* ]] || fail "Python 3 无法运行: $PYTHON_BIN"

if "$PYTHON_BIN" -c 'import sys; sys.stdout.write(sys.executable)' >/dev/null 2>&1; then
  echo "Python 预检: 允许 Python -c，node-gyp 可直接使用 $PYTHON_BIN"
else
  echo "Python 预检: 检测到 Python -c 受策略限制，将使用项目 wrapper"
fi

EXPECTED_WRAPPER="$(realpath "$WRAPPER")"
ACTUAL_WRAPPER="$(WEMEET_REAL_PYTHON="$PYTHON_BIN" "$WRAPPER" -c "import sys; sys.stdout.buffer.write(sys.executable.encode('utf-8'));" )"
[[ "$ACTUAL_WRAPPER" == "$EXPECTED_WRAPPER" ]] || fail "wrapper 未返回自身绝对路径: $ACTUAL_WRAPPER"

WRAPPER_VERSION="$(WEMEET_REAL_PYTHON="$PYTHON_BIN" "$WRAPPER" -c 'import sys; print("%s.%s.%s" % sys.version_info[:3]);')"
[[ "$WRAPPER_VERSION" =~ ^3\.[0-9]+\.[0-9]+$ ]] || fail "wrapper 无法执行 Python 版本探测: $WRAPPER_VERSION"

node - "$WRAPPER" "$PYTHON_BIN" <<'NODE'
'use strict';
const { execFileSync } = require('child_process');
const [wrapper, python] = process.argv.slice(2);
const output = execFileSync(wrapper, [
  '-c',
  'import sys; print("%s.%s.%s" % sys.version_info[:3]);',
], {
  encoding: 'utf8',
  env: { ...process.env, WEMEET_REAL_PYTHON: python },
}).trim();
if (!/^3\.\d+\.\d+$/.test(output)) {
  throw new Error(`node 子进程无法通过 wrapper 执行 Python: ${output}`);
}
NODE

echo "node-gyp Python 预检通过: $PYTHON_VERSION"
