/**
 * 通用 HTTP 客户端
 * - 统一 fetch 封装
 * - RSA + AES 混合加密请求体
 * - 公钥缓存（并发安全）
 * 供 auth / im / meeting 等业务模块复用
 */

const crypto = require('crypto');
const dnsModule = require('dns');
const http = require('http');
const https = require('https');
const dns = dnsModule.promises;
const fetch = require('node-fetch');
const appSettings = require('../utils/app-settings');

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isDetailedHttpLoggingEnabled() {
  return process.env.WEMEET_DEBUG_HTTP === '1';
}

function getBaseUrl() {
  return appSettings.getBaseUrl();
}

/**
 * 兼容既有调用方：URL 的唯一来源始终是 appSettings，参数仅用于触发缓存失效。
 */
function updateBaseUrl() {
  cachedPublicKey = null;
  publicKeyPromise = null;
}

/**
 * RSA + AES 混合加密请求体
 */
function encryptRequest(publicKeyPem, payload) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ]).toString('base64');

  const encryptedKey = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.concat([aesKey, iv]),
  ).toString('base64');

  const nonce = crypto.randomBytes(12).toString('hex');
  const timestamp = Date.now();

  return { encryptedKey, ciphertext, nonce, timestamp };
}

/**
 * 敏感字段集合（不区分大小小写）
 * 日志打印时命中的字段值统一替换为 ******，避免泄露密码、令牌、证件号等
 */
const SENSITIVE_KEYS = new Set([
  // 凭据 / 令牌
  'password', 'pwd', 'passwd', 'oldpassword', 'newpassword',
  'token', 'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
  'idtoken', 'id_token', 'sdktoken', 'sdk_token', 'authtoken', 'x-token', 'bearer', 'ticket',
  'authorization', 'cookie', 'set-cookie',
  'sessionid', 'session', 'csrf', 'xsrf',
  'ssourl', 'sso_url', 'sso-url', 'ssotoken', 'ssoticket', 'sso',
  // 密钥
  'privatekey', 'secretkey', 'clientsecret', 'client_secret', 'secret', 'apikey', 'api-key',
  // 个人信息
  'phone', 'mobile', 'tel', 'idcard', 'idcardnumber', 'id-number', 'id_number',
  'email', 'mail',
  'realname', 'idname',
]);

const MASK = '******';

/**
 * 递归将对象/数组中敏感字段的值替换为 ******，
 * 非敏感字段递归处理；非对象直接原样返回（不改变原始数据）
 */
function maskSensitive(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (typeof value !== 'object') return value;
  const result = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(String(k).toLowerCase())) {
      result[k] = MASK;
    } else {
      result[k] = maskSensitive(v);
    }
  }
  return result;
}

function formatUrlForLog(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}${parsed.search ? '?<redacted>' : ''}`;
  } catch {
    return '<invalid-url>';
  }
}

function validateRequestUrl(value) {
  let target;
  let base;
  try {
    target = new URL(value);
    base = new URL(getBaseUrl());
  } catch {
    throw new Error('请求 URL 格式无效');
  }
  if (target.username || target.password) {
    throw new Error('请求 URL 不能包含用户名或密码');
  }
  if (target.protocol !== base.protocol || target.origin !== base.origin) {
    throw new Error('请求目标不是当前配置的服务端，已拒绝发送凭据');
  }
  if (!target.pathname.startsWith('/')) {
    throw new Error('请求 URL 路径无效');
  }
  return target;
}

async function assertSafeResolvedHost(target) {
  if (appSettings.isInsecureDevUrlEnabled()) return;
  if (appSettings.isPrivateAddress(target.hostname)) {
    throw new Error('请求目标解析到本机、私网或链路本地地址');
  }

  let addresses;
  try {
    addresses = await dns.lookup(target.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true });
  } catch (err) {
    if (err && err.code === 'ENOTFOUND') throw new Error('域名解析失败，请检查网络连接');
    throw new Error(`域名安全校验失败：${err.message}`);
  }
  if (!addresses.length || addresses.some(({ address }) => appSettings.isPrivateAddress(address))) {
    throw new Error('请求目标解析到本机、私网或链路本地地址');
  }
}

function safeLookup(hostname, options, callback) {
  const lookupOptions = typeof options === 'object' ? options : { family: options };
  dnsModule.lookup(hostname, { ...lookupOptions, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || (!appSettings.isInsecureDevUrlEnabled()
      && addresses.some(({ address }) => appSettings.isPrivateAddress(address)))) {
      const blocked = new Error('请求目标解析到本机、私网或链路本地地址');
      blocked.code = 'ERR_BLOCKED_ADDRESS';
      return callback(blocked);
    }
    if (lookupOptions.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

const safeHttpAgent = new http.Agent({ lookup: safeLookup });
const safeHttpsAgent = new https.Agent({ lookup: safeLookup });

function redirectedOptions(options, status) {
  if (status !== 303 && !((status === 301 || status === 302) && String(options.method || 'GET').toUpperCase() === 'POST')) {
    return options;
  }
  const headers = { ...(options.headers || {}) };
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'content-length' || name.toLowerCase() === 'content-type') delete headers[name];
  }
  return { ...options, method: 'GET', headers, body: undefined };
}

async function fetchWithSafeRedirects(url, options = {}) {
  let target = validateRequestUrl(url);
  let currentOptions = { ...options, redirect: 'manual' };

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertSafeResolvedHost(target);
    const response = await fetch(target.toString(), {
      ...currentOptions,
      agent: target.protocol === 'https:' ? safeHttpsAgent : safeHttpAgent,
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) throw new Error(`服务器返回 HTTP ${response.status}，但未提供重定向地址`);
    if (redirectCount === MAX_REDIRECTS) throw new Error(`服务端重定向次数超过 ${MAX_REDIRECTS} 次`);

    const nextTarget = new URL(location, target);
    validateRequestUrl(nextTarget.toString());
    if (nextTarget.origin !== target.origin) {
      throw new Error('服务端尝试重定向到不同来源，已拒绝发送凭据');
    }
    currentOptions = redirectedOptions(currentOptions, response.status);
    target = nextTarget;
  }
  throw new Error('服务端重定向失败');
}

/**
 * 统一请求封装，包含目标校验、受控重定向和错误处理。
 */
async function request(url, options = {}) {
  const method = options.method || 'GET';
  const safeUrl = formatUrlForLog(url);
  console.log(`[API] >>> ${method} ${safeUrl}`);
  if (options.body && isDetailedHttpLoggingEnabled()) {
    const byteLength = Buffer.isBuffer(options.body)
      ? options.body.length
      : Buffer.byteLength(String(options.body));
    console.log(`[API] >>> Body: <redacted, ${byteLength} bytes>`);
  }

  let res;
  try {
    res = await fetchWithSafeRedirects(url, options);
  } catch (err) {
    const cause = err.cause || err;
    if (cause.code === 'ECONNREFUSED') {
      throw new Error(`无法连接服务器 ${new URL(getBaseUrl()).origin}，请确认后端服务是否已启动`);
    }
    if (cause.code === 'ENOTFOUND') {
      throw new Error('域名解析失败，请检查网络连接');
    }
    if (cause.code === 'CERT_HAS_EXPIRED' || cause.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      throw new Error(`SSL 证书验证失败：${cause.code}`);
    }
    if (cause.code === 'ETIMEDOUT' || cause.code === 'ECONNRESET') {
      throw new Error('连接超时或被重置，请检查网络');
    }
    throw new Error(`网络请求失败：${err.message}`);
  }

  if (!res.ok && res.status !== 400 && res.status !== 401 && res.status !== 429) {
    throw new Error(`服务器返回 HTTP ${res.status}`);
  }

  const json = await res.json();
  console.log(`[API] <<< ${method} ${safeUrl} HTTP ${res.status}`);
  if (isDetailedHttpLoggingEnabled()) {
    console.log(`[API] <<< Headers:`, JSON.stringify(maskSensitive(Object.fromEntries(res.headers.entries())), null, 2));
    console.log(`[API] <<< Body: <redacted>`);
  }
  if (json.code !== 0) {
    throw new Error(json.message || '请求失败');
  }
  return json.data;
}

let cachedPublicKey = null;
let publicKeyPromise = null;

/**
 * 获取 RSA 公钥（按服务端地址缓存，并发安全）。地址切换期间旧请求不会污染新地址缓存。
 */
async function getPublicKey() {
  const baseUrl = getBaseUrl();
  if (cachedPublicKey && cachedPublicKey.baseUrl === baseUrl) return cachedPublicKey.value;
  if (!publicKeyPromise || publicKeyPromise.baseUrl !== baseUrl) {
    const promise = request(`${baseUrl}/api/auth/public-key`)
      .then((data) => {
        if (getBaseUrl() === baseUrl) cachedPublicKey = { baseUrl, value: data.publicKey };
        return data.publicKey;
      })
      .catch((err) => {
        if (publicKeyPromise && publicKeyPromise.promise === promise) publicKeyPromise = null;
        throw err;
      });
    publicKeyPromise = { baseUrl, promise };
  }
  return publicKeyPromise.promise;
}

/**
 * 预取公钥（应用启动时调用，不阻塞）
 */
function prefetchPublicKey() {
  getPublicKey().catch(() => {});
}

const exported = {
  getBaseUrl,
  updateBaseUrl,
  request,
  encryptRequest,
  getPublicKey,
  prefetchPublicKey,
  validateRequestUrl,
  fetchSafeResponse: fetchWithSafeRedirects,
  maskSensitive,
};

// 保留 httpClient.BASE_URL 读取兼容性，同时避免导出加载时快照。
Object.defineProperty(exported, 'BASE_URL', { enumerable: true, get: getBaseUrl });
module.exports = exported;
