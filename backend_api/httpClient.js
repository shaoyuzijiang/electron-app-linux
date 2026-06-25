/**
 * 通用 HTTP 客户端
 * - 统一 fetch 封装
 * - RSA + AES 混合加密请求体
 * - 公钥缓存（并发安全）
 * 供 auth / im / meeting 等业务模块复用
 */

const crypto = require('crypto');

const BASE_URL = 'https://wemeetapp.liuqi92.cn';

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
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'x-token',
  'authorization', 'cookie', 'set-cookie',
  'sessionid', 'session', 'csrf', 'xsrf',
  'ssourl', 'sso_url', 'sso-url', 'ssotoken', 'ssoticket', 'sso',
  // 密钥
  'privatekey', 'secretkey', 'secret', 'apikey', 'api-key',
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

/**
 * 统一请求封装，包含错误处理
 */
async function request(url, options = {}) {
  const method = options.method || 'GET';
  console.log(`[API] >>> ${method} ${url}`);
  if (options.body) {
    try {
      const bodyObj = JSON.parse(options.body);
      // 加密请求体不打印 ciphertext 和 encryptedKey（太长），仅打印摘要信息
      if (bodyObj.ciphertext) {
        console.log(`[API] >>> Body (encrypted): nonce=${bodyObj.nonce}, timestamp=${bodyObj.timestamp}`);
      } else {
        console.log(`[API] >>> Body:`, JSON.stringify(maskSensitive(bodyObj), null, 2));
      }
    } catch {
      // 非 JSON 原文按字符串原样打印（如表单提交等场景）
      console.log(`[API] >>> Body:`, options.body);
    }
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    const cause = err.cause;
    if (cause) {
      if (cause.code === 'ECONNREFUSED') {
        throw new Error(`无法连接服务器 ${url.split('/api/')[0]}，请确认后端服务是否已启动`);
      }
      if (cause.code === 'ENOTFOUND') {
        throw new Error(`域名解析失败，请检查网络连接`);
      }
      if (cause.code === 'CERT_HAS_EXPIRED' || cause.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        throw new Error(`SSL 证书验证失败：${cause.code}`);
      }
      if (cause.code === 'ETIMEDOUT' || cause.code === 'ECONNRESET') {
        throw new Error(`连接超时或被重置，请检查网络`);
      }
    }
    throw new Error(`网络请求失败：${err.message}`);
  }

  if (!res.ok && res.status !== 400 && res.status !== 401 && res.status !== 429) {
    throw new Error(`服务器返回 HTTP ${res.status}`);
  }

  const json = await res.json();
  console.log(`[API] <<< ${method} ${url} HTTP ${res.status}`);
  console.log(`[API] <<< Headers:`, JSON.stringify(maskSensitive(Object.fromEntries(res.headers.entries())), null, 2));
  console.log(`[API] <<< Body:`, JSON.stringify(maskSensitive(json), null, 2));
  if (json.code !== 0) {
    throw new Error(json.message || '请求失败');
  }
  return json.data;
}

let cachedPublicKey = null;
let publicKeyPromise = null;

/**
 * 获取 RSA 公钥（带缓存，并发安全）
 */
async function getPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  if (!publicKeyPromise) {
    publicKeyPromise = request(`${BASE_URL}/api/auth/public-key`)
      .then((data) => {
        cachedPublicKey = data.publicKey;
        return cachedPublicKey;
      })
      .catch((err) => {
        publicKeyPromise = null; // 请求失败时清除，允许重试
        throw err;
      });
  }
  return publicKeyPromise;
}

/**
 * 预取公钥（应用启动时调用，不阻塞）
 */
function prefetchPublicKey() {
  getPublicKey().catch(() => {});
}

module.exports = {
  BASE_URL,
  request,
  encryptRequest,
  getPublicKey,
  prefetchPublicKey,
};
