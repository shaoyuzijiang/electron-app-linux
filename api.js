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
 * 统一请求封装，包含错误处理
 */
async function request(url, options = {}) {
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
  if (json.code !== 0) {
    throw new Error(json.message || '请求失败');
  }
  return json.data;
}

let cachedPublicKey = null;

/**
 * 获取 RSA 公钥（带缓存）
 */
async function getPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  const data = await request(`${BASE_URL}/api/auth/public-key`);
  cachedPublicKey = data.publicKey;
  return cachedPublicKey;
}

/**
 * 预取公钥（应用启动时调用，不阻塞）
 */
function prefetchPublicKey() {
  getPublicKey().catch(() => {});
}

/**
 * 用户登录
 * @param {string} username
 * @param {string} password
 * @returns {{ accessToken, refreshToken, expiresIn, tokenType }}
 */
async function login(username, password) {
  const publicKey = await getPublicKey();
  const payload = { username, password };
  const encrypted = encryptRequest(publicKey, payload);

  return await request(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(encrypted),
  });
}

/**
 * 刷新令牌
 * @param {string} refreshToken
 * @returns {{ accessToken, refreshToken, expiresIn, tokenType }}
 */
async function refreshToken(refreshTokenValue) {
  const publicKey = await getPublicKey();
  const payload = { refreshToken: refreshTokenValue };
  const encrypted = encryptRequest(publicKey, payload);

  return await request(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(encrypted),
  });
}

/**
 * 获取用户信息
 * @param {string} accessToken
 * @returns {{ id, username, role }}
 */
async function getProfile(accessToken) {
  return await request(`${BASE_URL}/api/auth/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 获取腾讯会议 SDK Token
 * @returns {{ sdkId, sdkToken, expiresIn }}
 */
async function getSdkToken() {
  return await request(`${BASE_URL}/api/auth/sdk-token`);
}

/**
 * 获取腾讯会议 ID Token
 * @param {string} accessToken
 * @returns {{ idToken, expiresIn, ssoUrl? }}
 */
async function getIdToken(accessToken) {
  return await request(`${BASE_URL}/api/auth/id-token`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 修改密码
 * @param {string} accessToken
 * @param {string} oldPassword
 * @param {string} newPassword
 * @returns {{ message: string }}
 */
async function changePassword(accessToken, oldPassword, newPassword) {
  return await request(`${BASE_URL}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

module.exports = { getPublicKey, prefetchPublicKey, login, refreshToken, getProfile, getSdkToken, getIdToken, changePassword };
