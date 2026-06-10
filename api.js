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

/**
 * 创建会议
 * @param {string} accessToken
 * @param {object} meetingData - 会议数据
 * @param {string} meetingData.subject - 会议主题（必填，不超过 512 字节）
 * @param {number} meetingData.type - 会议类型（必填）：0-预约会议，1-快速会议
 * @param {string} meetingData.start_time - 开始时间（必填，秒级时间戳字符串）
 * @param {string} meetingData.end_time - 结束时间（必填，秒级时间戳字符串）
 * @param {number} meetingData.instanceid - 用户终端设备类型（必填，默认 1-PC）
 * @param {number} [meetingData.meeting_type] - 会议模式：0-普通会议（默认），1-周期性会议，5-个人会议号会议
 * @param {object[]} [meetingData.hosts] - 主持人列表，如 [{"userid": "user1"}]
 * @param {object[]} [meetingData.invitees] - 参会人列表
 * @param {object[]} [meetingData.guests] - 会议嘉宾列表
 * @param {string} [meetingData.password] - 会议密码（4-6 位数字）
 * @param {object} [meetingData.settings] - 会议媒体参数配置
 * @param {number} [meetingData.settings.mute_enable_type_join] - 入会静音：0-关闭，1-开启，2-超6人自动开启（默认2）
 * @param {boolean} [meetingData.settings.allow_unmute_self] - 允许参会者取消静音，默认 true
 * @param {boolean} [meetingData.settings.allow_in_before_host] - 允许主持人前入会，默认 true
 * @param {boolean} [meetingData.settings.auto_in_waiting_room] - 开启等候室，默认 false
 * @param {string} [meetingData.settings.auto_record_type] - 自动录制：none/local/cloud
 * @param {object} [meetingData.recurring_rule] - 周期性会议配置（meeting_type=1 时）
 * @param {boolean} [meetingData.enable_live] - 是否开启直播
 * @param {object} [meetingData.live_config] - 直播配置
 * @param {boolean} [meetingData.enable_host_key] - 是否开启主持人密钥
 * @param {string} [meetingData.host_key] - 主持人密钥（6 位数字）
 * @param {string} [meetingData.time_zone] - 时区
 * @param {string} [meetingData.location] - 会议地点
 * @returns {{ meeting_info: object }}
 */
async function createMeeting(accessToken, meetingData) {
  return await request(`${BASE_URL}/api/wemeet/meetings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(meetingData),
  });
}

module.exports = { getPublicKey, prefetchPublicKey, login, refreshToken, getProfile, getSdkToken, getIdToken, changePassword, createMeeting };
