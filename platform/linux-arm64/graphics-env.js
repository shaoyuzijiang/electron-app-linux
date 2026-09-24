'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

const PATCH_PATH = '/opt/x11-wayland/x11-ext.sh';
const PATCH_ENV_KEYS = new Set([
  'LD_LIBRARY_PATH',
  'MESA_LOADER_DRIVER_OVERRIDE',
  'LP_NUM_THREADS',
  'QT_QPA_PLATFORM',
  'EGL_PLATFORM',
  'LIBGL_ALWAYS_SOFTWARE',
  'LIBGL_ALWAYS_INDIRECT',
  'XDG_SESSION_TYPE',
  'WAYLAND_DISPLAY',
]);

function isWaylandSession(env) {
  return env.XDG_SESSION_TYPE === 'wayland' || Boolean(env.WAYLAND_DISPLAY);
}

function parseNullEnvironment(buffer) {
  const values = {};
  for (const entry of Buffer.from(buffer || '').toString('utf8').split('\0')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    const key = entry.slice(0, separator);
    if (PATCH_ENV_KEYS.has(key)) values[key] = entry.slice(separator + 1);
  }
  return values;
}

function sourcePatchEnvironment({ env, patchPath = PATCH_PATH, existsSync = fs.existsSync, run = spawnSync } = {}) {
  if (!isWaylandSession(env) || env.WEMEET_X11_WAYLAND_PATCH === '1') return { applied: false, reason: 'not-required' };
  if (!existsSync(patchPath)) return { applied: false, reason: 'missing', patchPath };
  const result = run('/bin/bash', ['-c', 'source "$1"; env -0', 'wemeet-x11-wayland', patchPath], {
    env,
    encoding: null,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return { applied: false, reason: 'failed', patchPath, error: result.error ? result.error.message : `exit ${result.status}` };
  }
  Object.assign(env, parseNullEnvironment(result.stdout));
  env.WEMEET_X11_WAYLAND_PATCH = '1';
  env.WEMEET_X11_WAYLAND_PATCH_PATH = patchPath;
  return { applied: true, patchPath };
}

function shouldUseZink({ env, existsSync = fs.existsSync, readFileSync = fs.readFileSync } = {}) {
  if (env.MESA_LOADER_DRIVER_OVERRIDE || !existsSync('/usr/lib/aarch64-linux-gnu/dri/zink_dri.so')) return false;
  let cpuInfo = '';
  try { cpuInfo = readFileSync('/proc/cpuinfo', 'utf8'); } catch {}
  return !/(Kirin\s+(9006C|990)|PANGU\s+M900)/i.test(cpuInfo);
}

function configureGraphicsEnvironment({ env = process.env, sdkRoot, patchPath = PATCH_PATH, existsSync, run } = {}) {
  if (!sdkRoot) throw new TypeError('缺少 Linux SDK 运行目录');
  const patch = sourcePatchEnvironment({ env, patchPath, existsSync, run });
  // 官方要求 SDK 私有路径排最前，防止系统同名库抢占 Release/lib 内的库。
  env.LD_LIBRARY_PATH = [sdkRoot, `${sdkRoot}/Release/lib`, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  env.PATH = [`${sdkRoot}/Release`, env.PATH].filter(Boolean).join(':');
  env.QT_PLUGIN_PATH = `${sdkRoot}/Release/plugins`;
  env.QT_QPA_PLATFORM = 'xcb';
  env.EGL_PLATFORM = 'x11';
  env.LD_PRELOAD = '';
  env.XDG_SESSION_TYPE = 'x11';
  delete env.WAYLAND_DISPLAY;
  return patch;
}

module.exports = { PATCH_PATH, isWaylandSession, parseNullEnvironment, sourcePatchEnvironment, configureGraphicsEnvironment };
