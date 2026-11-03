/**
 * 应用设置（持久化）
 * - 服务端 URL 等可配置项
 * - 存储在 userData/app-settings.json
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const net = require('net');

// 默认服务端 URL（生产环境）
const DEFAULT_BASE_URL = 'https://wemeetsdkdemo-prod.liuqi92.cn:7443';
const ALLOWED_HTTPS_PORTS = new Set(['', '443', '7443']);
const INSECURE_DEV_URL_ENV = 'WEMEET_ALLOW_INSECURE_SERVER_URL';

function isInsecureDevUrlEnabled() {
  return process.env[INSECURE_DEV_URL_ENV] === '1';
}

function ipv4ToInt(address) {
  return address.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

function isIpv4InCidr(address, network, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(network) & mask);
}

/**
 * 判断 IP 是否属于不能作为生产服务端的本机、私网、链路本地或保留网段。
 */
function isPrivateAddress(address) {
  const normalized = String(address || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const family = net.isIP(normalized);
  if (family === 4) {
    return [
      ['0.0.0.0', 8], ['9.0.0.0', 8], ['10.0.0.0', 8], ['11.0.0.0', 8],
      ['21.0.0.0', 8], ['30.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
      ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
      ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4],
    ].some(([network, prefix]) => isIpv4InCidr(normalized, network, prefix));
  }
  if (family === 6) {
    if (normalized === '::' || normalized === '::1') return true;
    if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized) || /^ff/.test(normalized)) return true;
    if (normalized.startsWith('::ffff:')) {
      const suffix = normalized.slice(7);
      if (net.isIP(suffix) === 4) return isPrivateAddress(suffix);
      const parts = suffix.split(':');
      if (parts.length === 2 && parts.every((part) => /^[0-9a-f]{1,4}$/.test(part))) {
        const value = (parseInt(parts[0], 16) * 0x10000) + parseInt(parts[1], 16);
        return isPrivateAddress(`${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`);
      }
    }
  }
  return false;
}

function isLocalHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal')
    || normalized.endsWith('.lan');
}

/**
 * 校验并规范化服务端根 URL。开发联调如需 HTTP、内网地址或自定义端口，必须显式设置
 * WEMEET_ALLOW_INSECURE_SERVER_URL=1；用户信息、query、hash 和非根路径始终禁止。
 */
function validateBaseUrl(value) {
  if (!value || typeof value !== 'string') {
    return { success: false, message: 'URL 不能为空' };
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { success: false, message: 'URL 格式无效' };
  }

  if (parsed.username || parsed.password) {
    return { success: false, message: 'URL 不能包含用户名或密码' };
  }
  if (parsed.search || parsed.hash) {
    return { success: false, message: 'URL 不能包含查询参数或片段' };
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    return { success: false, message: 'URL 必须是服务端根地址，不能包含路径' };
  }

  const allowInsecure = isInsecureDevUrlEnabled();
  if (parsed.protocol !== 'https:' && !(allowInsecure && parsed.protocol === 'http:')) {
    return { success: false, message: '服务端 URL 必须使用 HTTPS' };
  }
  if (!allowInsecure && !ALLOWED_HTTPS_PORTS.has(parsed.port)) {
    return { success: false, message: '服务端 URL 端口仅允许 443 或 7443' };
  }
  if (!allowInsecure && (isLocalHostname(parsed.hostname) || isPrivateAddress(parsed.hostname))) {
    return { success: false, message: '服务端 URL 不能指向本机、私网或链路本地地址' };
  }

  parsed.pathname = '';
  return { success: true, baseUrl: parsed.toString().replace(/\/$/, '') };
}

let settings = null;
let settingsPath = null;

function getSettingsPath() {
  if (!settingsPath) {
    // app.whenReady() 之前 getPath 可能不可用，降级使用默认值
    try {
      settingsPath = path.join(app.getPath('userData'), 'app-settings.json');
    } catch {
      settingsPath = null; // app 未就绪，使用默认值
    }
  }
  return settingsPath;
}

function loadSettings() {
  if (settings) return settings;
  const p = getSettingsPath();
  if (!p) {
    // app 尚未就绪，返回默认设置（后续首次调用 setBaseUrl 会触发持久化）
    settings = { baseUrl: DEFAULT_BASE_URL };
    return settings;
  }
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    settings = {};
  }
  const validated = validateBaseUrl(settings.baseUrl);
  if (!validated.success) {
    settings.baseUrl = DEFAULT_BASE_URL;
  } else {
    settings.baseUrl = validated.baseUrl;
  }
  return settings;
}

function saveSettings() {
  const p = getSettingsPath();
  if (!p) {
    // app 尚未就绪，仅更新内存（下次调用时会被覆盖）
    return;
  }
  try {
    fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Settings] 保存失败:', err.message);
  }
}

/**
 * 获取服务端 URL（去除末尾斜杠）
 */
function getBaseUrl() {
  const s = loadSettings();
  const validated = validateBaseUrl(s.baseUrl);
  if (!validated.success) {
    s.baseUrl = DEFAULT_BASE_URL;
    return DEFAULT_BASE_URL;
  }
  return validated.baseUrl;
}

/**
 * 设置服务端 URL
 * @returns {{success: boolean, message?: string, baseUrl: string}}
 */
function setBaseUrl(url) {
  const validated = validateBaseUrl(url);
  if (!validated.success) {
    return { success: false, message: validated.message, baseUrl: getBaseUrl() };
  }
  const s = loadSettings();
  s.baseUrl = validated.baseUrl;
  saveSettings();
  console.log(`[Settings] 服务端 URL 已更新: ${validated.baseUrl}`);
  return { success: true, baseUrl: validated.baseUrl };
}

function resetBaseUrl() {
  const s = loadSettings();
  s.baseUrl = DEFAULT_BASE_URL;
  saveSettings();
  console.log(`[Settings] 服务端 URL 已重置为默认: ${DEFAULT_BASE_URL}`);
  return { success: true, baseUrl: DEFAULT_BASE_URL };
}

module.exports = {
  DEFAULT_BASE_URL,
  INSECURE_DEV_URL_ENV,
  getBaseUrl,
  setBaseUrl,
  resetBaseUrl,
  validateBaseUrl,
  isPrivateAddress,
  isInsecureDevUrlEnabled,
};
