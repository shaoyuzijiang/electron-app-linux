#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:---build}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAILED=0
ok() { printf 'OK    %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*" >&2; FAILED=1; }
need() { command -v "$1" >/dev/null 2>&1 && ok "命令 $1" || fail "缺少命令 $1"; }

[[ "$(id -u)" -ne 0 ]] && ok "普通用户 $(id -un)" || fail "禁止使用 root/sudo 运行"
[[ "$(uname -s)" == Linux ]] && ok "系统 Linux" || fail "当前不是 Linux"
[[ "$(uname -m)" == aarch64 ]] && ok "架构 aarch64" || fail "架构必须为 aarch64，当前 $(uname -m)"
if [[ -f /etc/os-release ]] && grep -Eiq 'kylin|银河麒麟' /etc/os-release && grep -Eiq 'V10|VERSION_ID="?10' /etc/os-release; then
  ok "银河麒麟 V10"
else
  fail "正式基线必须为银河麒麟 V10"
fi
GLIBC_VERSION="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')"
[[ "$GLIBC_VERSION" == 2.31 ]] && ok "glibc 2.31" || fail "glibc 必须为 2.31，当前 ${GLIBC_VERSION:-unknown}"

for command in node npm python3 make g++ ld as realpath tar unzip sha256sum file readelf ldd strings timeout awk grep getconf; do
  need "$command"
done

NODE_VERSION="$(node --version 2>/dev/null || true)"
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ && "$NODE_MAJOR" -ge 22 && "$NODE_MAJOR" -lt 25 ]] && ok "Node $NODE_VERSION" || fail "Node 必须 >=22.12 且 <25，当前 ${NODE_VERSION:-unknown}"
NPM_MAJOR="$(npm --version 2>/dev/null | cut -d. -f1)"
[[ "$NPM_MAJOR" =~ ^[0-9]+$ && "$NPM_MAJOR" -ge 10 ]] && ok "npm $(npm --version)" || fail "npm 必须 >=10"
PYTHON_BIN="$(command -v python3 2>/dev/null || true)"
PYTHON_VERSION="${PYTHON_BIN:+$($PYTHON_BIN --version 2>&1 || true)}"
[[ "$PYTHON_VERSION" == Python\ 3.* ]] && ok "$PYTHON_VERSION ($PYTHON_BIN)" || fail "Python 3 无法运行；请安装或修复 python3、python3-dev"

CPP_TEST="$(mktemp /tmp/wemeet-cpp2a.XXXXXX.o)"
if g++ -std=gnu++2a -x c++ -c /dev/null -o "$CPP_TEST" >/dev/null 2>&1; then
  ok "GCC 支持 -std=gnu++2a"
else
  fail "当前 GCC 不支持 Linux SDK addon 所需的 C++20 别名 -std=gnu++2a"
fi
rm -f "$CPP_TEST"

if [[ "$MODE" == --desktop ]]; then
  [[ -n "${DISPLAY:-}" ]] && ok "DISPLAY=$DISPLAY" || fail "缺少 DISPLAY，请在桌面终端运行"
  if command -v xdpyinfo >/dev/null 2>&1; then
    timeout 10 xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && ok "XWayland 可连接" || fail "无法连接 XWayland DISPLAY=$DISPLAY"
  fi
fi
if [[ "$MODE" == --release ]]; then
  need dpkg-shlibdeps
  need dpkg-deb
fi

if [[ "$FAILED" -ne 0 ]]; then
  cat >&2 <<'EOF'

修复建议：
- Python 报 kysec 时，不要使用 python3 -c；只需确保 python3 --version 成功。
- Python 缺失/损坏时让管理员执行：sudo apt install --reinstall python3 python3-minimal python3-dev
- GCC 不支持 gnu++2a 时，需由管理员安装麒麟 V10 可用的 C++20 工具链后再构建。
- 不要使用 sudo npm run setup:kylin，也不要使用 --no-sandbox。
EOF
fi
exit "$FAILED"
