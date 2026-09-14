'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const SDK_VERSION = '3.26.100.14';

function getRuntimeRoot({ isPackaged = false, resourcesPath = process.resourcesPath, projectRoot = path.resolve(__dirname, '../../..') } = {}) {
  return isPackaged
    ? path.join(resourcesPath, 'tmsdk', 'linux-arm64')
    : path.join(projectRoot, 'output', 'linux-arm64');
}

function detectSessionType(environment = process.env) {
  const sessionType = String(environment.XDG_SESSION_TYPE || '').toLowerCase();
  if (sessionType === 'x11' || sessionType === 'wayland') return sessionType;
  return 'unknown';
}

function assertRealRuntimeSupported(processInfo = process) {
  if (processInfo.platform !== 'linux' || processInfo.arch !== 'arm64') {
    throw new Error(`真实 Linux SDK 仅支持 linux/arm64；当前为 ${processInfo.platform}/${processInfo.arch}`);
  }
}

function assertRuntimeLayout(runtimeRoot) {
  for (const relativePath of ['wemeet_electron_sdk.node', 'libwemeetsdk.so', 'libwemeet_base.so', 'saas_sdk_env.json', 'Release']) {
    if (!fs.existsSync(path.join(runtimeRoot, relativePath))) throw new Error(`SDK 运行时缺少：${relativePath}`);
  }
  return runtimeRoot;
}

async function hasChineseLocale(execFileImpl = execFileAsync) {
  try {
    const { stdout } = await execFileImpl('/usr/bin/locale', ['-a'], { encoding: 'utf8', timeout: 1500, maxBuffer: 128 * 1024 });
    return stdout.split(/\r?\n/).some((value) => /^zh_CN\.utf-?8$/i.test(value.trim()));
  } catch {
    return false;
  }
}

function readSystemValue(filePath, key) {
  try {
    const line = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).find((value) => value.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).replace(/^"|"$/g, '') : '';
  } catch {
    return '';
  }
}

function applyTrustedWaylandEnvironment(environment, runtimeRoot) {
  const scriptPath = path.join(runtimeRoot, 'Release', 'x11-wayland', 'x11-ext.sh');
  if (!fs.existsSync(scriptPath)) return { applied: false, scriptPath: null };
  const osId = readSystemValue('/etc/os-release', 'ID');
  const minorVersion = Number.parseInt(readSystemValue('/etc/os-version', 'MinorVersion'), 10);
  if (osId !== 'uos' || !Number.isInteger(minorVersion) || minorVersion >= 1070) {
    environment.WEMEET_XWAYLAND = '1';
    return { applied: false, scriptPath };
  }
  const releaseVersion = minorVersion < 1050 ? '1040' : '1050';
  const xwaylandLibrary = path.join(runtimeRoot, 'Release', 'x11-wayland', releaseVersion, 'lib', 'aarch64-linux-gnu');
  if (!fs.existsSync(xwaylandLibrary)) throw new Error(`SDK XWayland 资源缺失：${xwaylandLibrary}`);
  environment.LP_NUM_THREADS = '2';
  environment.QT_QPA_PLATFORM = 'xcb';
  environment.XDG_SESSION_TYPE = 'x11';
  delete environment.WAYLAND_DISPLAY;
  environment.LD_LIBRARY_PATH = [xwaylandLibrary, environment.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
  environment.WEMEET_XWAYLAND = '0';
  return { applied: true, scriptPath };
}

async function prepareLinuxRuntime({ processInfo = process, environment = process.env, isPackaged = false, resourcesPath, projectRoot, localeChecker = hasChineseLocale } = {}) {
  assertRealRuntimeSupported(processInfo);
  const runtimeRoot = assertRuntimeLayout(getRuntimeRoot({ isPackaged, resourcesPath, projectRoot }));
  const releaseRoot = path.join(runtimeRoot, 'Release');
  environment.PATH = [runtimeRoot, releaseRoot, environment.PATH].filter(Boolean).join(path.delimiter);
  environment.LD_LIBRARY_PATH = [runtimeRoot, path.join(releaseRoot, 'lib'), environment.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
  environment.QT_PLUGIN_PATH = path.join(releaseRoot, 'plugins');
  environment.TZ = 'Asia/Shanghai';
  if (await localeChecker()) environment.LC_ALL = 'zh_CN.UTF-8';
  const sessionType = detectSessionType(environment);
  const wayland = sessionType === 'wayland' ? applyTrustedWaylandEnvironment(environment, runtimeRoot) : { applied: false, scriptPath: null };
  return { runtimeRoot, sessionType: detectSessionType(environment), wayland };
}

function getRuntimeDiagnostics({ mockEnabled, sdkState, runtime = null } = {}) {
  return {
    platform: process.platform,
    architecture: process.arch,
    electron: process.versions.electron || '未在 Electron 中运行',
    node: process.versions.node,
    napi: process.versions.napi || '未知',
    sessionType: detectSessionType(),
    mockEnabled,
    sdkState,
    target: `Linux ARM64 / SDK ${SDK_VERSION}`,
    actualSdkLoaded: Boolean(runtime?.loaded),
    runtimeRoot: runtime?.runtimeRoot || getRuntimeRoot()
  };
}

module.exports = { SDK_VERSION, applyTrustedWaylandEnvironment, assertRealRuntimeSupported, assertRuntimeLayout, detectSessionType, getRuntimeDiagnostics, getRuntimeRoot, hasChineseLocale, prepareLinuxRuntime };
