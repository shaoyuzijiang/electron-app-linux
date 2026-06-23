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
  const method = options.method || 'GET';
  console.log(`[API] >>> ${method} ${url}`);
  if (options.body) {
    try {
      const bodyObj = JSON.parse(options.body);
      // 加密请求体不打印 ciphertext 和 encryptedKey（太长），仅打印摘要信息
      if (bodyObj.ciphertext) {
        console.log(`[API] >>> Body (encrypted): nonce=${bodyObj.nonce}, timestamp=${bodyObj.timestamp}`);
      } else {
        console.log(`[API] >>> Body:`, options.body);
      }
    } catch {
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
  console.log(`[API] <<< ${method} ${url} HTTP ${res.status}`, JSON.stringify(json, null, 2));
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
 * 用户登录（邮箱）
 * @param {string} email
 * @param {string} password
 * @returns {{ accessToken, refreshToken, expiresIn, tokenType }}
 */
async function login(email, password) {
  const publicKey = await getPublicKey();
  const payload = { email, password };
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

/**
 * 查询用户会议列表
 * 获取某指定用户的进行中或待开始的会议列表，单次最多返回 20 条。
 * 企业 secret 鉴权用户可查询该企业该用户创建的有效会议，OAuth2.0 鉴权用户只能查询通过 OAuth2.0 鉴权创建的有效会议。
 * @param {string} accessToken
 * @param {object} [options] - 可选参数
 * @param {number} [options.instanceid=1] - 用户终端设备类型（必填，默认1-PC）：
 *   0-PSTN, 1-PC, 2-Mac, 3-Android, 4-iOS, 5-Web, 6-iPad, 7-Android Pad, 8-小程序,
 *   9-voip/sip设备, 10-Linux, 20-Rooms for Touch Windows, 21-Rooms for Touch MacOS,
 *   22-Rooms for Touch Android, 30-Controller for Touch Windows, 32-Controller for Touch Android,
 *   33-Controller for Touch iOS
 * @param {number} [options.pos] - 分页查询起始时间值，UNIX 秒级时间戳，只能查询开始时间在本时间之后（包含）的会议。默认 0（从当日零点开始）。remaining 不为 0 时继续查询，next_pos 即为下次查询的 pos 值
 * @param {number} [options.cursory] - 分页游标，UNIX 毫秒级时间戳，默认 0（首次查询）。与 pos 配合使用可避免仅使用 pos 时出现的重复数据等问题。remaining 不为 0 时继续查询，next_cursory 即为下次查询的 cursory 值
 * @param {string} [options.is_show_all_sub_meetings] - 是否显示周期性会议所有子会议：'0'-仅第一个子会议(默认), '1'-显示所有子会议
 * @returns {{ meeting_number: number, meeting_info_list: MeetingInfo[], remaining: number, next_pos: number, next_cursory: number }}
 *
 * MeetingInfo 对象:
 *   subject {string} - 会议主题
 *   meeting_id {string} - 会议唯一标识
 *   meeting_code {string} - 会议呼入号码
 *   hosts {User[]} - 会议主持人用户 ID 列表
 *   current_hosts {User[]} - 会议当前主持人列表
 *   start_time {string} - 会议开始时间戳（秒）
 *   end_time {string} - 会议结束时间戳（秒）
 *   join_meeting_role {string} - 查询者在会议中的角色：creator/hoster/invitee
 *   meeting_type {number} - 会议类型：0-普通会议, 1-周期性会议, 2-微信专属会议, 4-Rooms投屏会议, 5-个人会议号会议, 6-网络研讨会
 *   recurring_rule {RecurringRule} - 周期性会议设置
 *   media_set_type {number} - 混合云会议类型：0-公网会议, 1-专网会议
 *   has_more_sub_meeting {number} - 0-无更多, 1-有更多子会议特例
 *   remain_sub_meetings {number} - 剩余子会议场数
 *   current_sub_meeting_id {string} - 当前子会议 ID
 *   status {string} - 会议状态：MEETING_STATE_INVALID/INIT/CANCELLED/STARTED/ENDED/NULL/RECYCLED
 *   type {number} - 0-预约会议, 1-快速会议
 *   sub_meetings {SubMeeting[]} - 周期性子会议列表
 *
 * RecurringRule 对象:
 *   recurring_type {number} - 周期频率：0-每天, 1-每周一至周五, 2-每周, 3-每两周, 4-每月
 *   until_type {number} - 结束重复类型：0-按日期, 1-按次数
 *   until_date {number} - 结束日期时间戳
 *   until_count {number} - 限定会议次数（1-50）
 *
 * SubMeeting 对象:
 *   sub_meeting_id {string} - 子会议 ID
 *   status {number} - 0-默认(存在), 1-已删除
 *   start_time {string} - 子会议开始时间（UTC 秒）
 *   end_time {string} - 子会议结束时间（UTC 秒）
 */
async function getMeetingList(accessToken, options = {}) {
  const { instanceid = 1, pos, cursory, is_show_all_sub_meetings } = options;
  const params = new URLSearchParams();
  params.append('instanceid', instanceid);
  if (pos !== undefined) params.append('pos', pos);
  if (cursory !== undefined) params.append('cursory', cursory);
  if (is_show_all_sub_meetings !== undefined) params.append('is_show_all_sub_meetings', is_show_all_sub_meetings);
  return await request(`${BASE_URL}/api/wemeet/meetings?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 获取部门树（含人数统计）
 * @param {string} accessToken
 * @returns {Array} 部门树形结构
 */
async function getDepartmentTree(accessToken) {
  return await request(`${BASE_URL}/api/user-picker/departments`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 获取部门下的用户（分页）
 * @param {string} accessToken
 * @param {string} departmentId - 部门 ID，传 'root' 获取全部用户
 * @param {object} [options] - 可选参数
 * @param {boolean} [options.recursive=false] - 是否递归获取子部门用户；根部门默认递归
 * @param {number} [options.page=1] - 页码，从 1 开始
 * @param {number} [options.pageSize=50] - 每页数量，默认 50，最大 50
 * @returns {{ list: Array, total: number, page: number, pageSize: number }}
 */
async function getDepartmentUsers(accessToken, departmentId, options = {}) {
  const { recursive = false, page, pageSize } = options;
  const params = new URLSearchParams();
  if (recursive) params.append('recursive', 'true');
  if (page !== undefined) params.append('page', page);
  if (pageSize !== undefined) params.append('pageSize', pageSize);
  return await request(`${BASE_URL}/api/user-picker/departments/${departmentId}/users${params.toString() ? '?' + params : ''}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 搜索用户
 * @param {string} accessToken
 * @param {string} query - 搜索关键词
 * @returns {Array} 匹配的用户列表
 */
async function searchUsers(accessToken, query) {
  const params = new URLSearchParams();
  params.append('q', query);
  return await request(`${BASE_URL}/api/user-picker/search?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ========== IM 即时通讯 API ==========

/**
 * 获取会话列表
 * @param {string} accessToken
 * @returns {Array<ConversationListItem>}
 */
async function getConversations(accessToken) {
  return await request(`${BASE_URL}/api/chat/conversations`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 创建会话
 * @param {string} accessToken
 * @param {object} params - { type: 'single'|'group', name: string, memberIds: string[] }
 * @returns {{ id: string }}
 */
async function createConversation(accessToken, params) {
  return await request(`${BASE_URL}/api/chat/conversations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/**
 * 获取会话详情
 * @param {string} accessToken
 * @param {string} conversationId
 * @returns {ConversationDetail}
 */
async function getConversationDetail(accessToken, conversationId) {
  return await request(`${BASE_URL}/api/chat/conversations/${conversationId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 获取历史消息
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {object} [options] - { before?: string, after?: string, limit?: number }
 * @returns {Array<Message>}
 */
async function getMessages(accessToken, conversationId, options = {}) {
  const params = new URLSearchParams();
  if (options.before) params.append('before', options.before);
  if (options.after) params.append('after', options.after);
  if (options.limit) params.append('limit', options.limit);
  const qs = params.toString() ? '?' + params : '';
  return await request(`${BASE_URL}/api/chat/conversations/${conversationId}/messages${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 发送消息（HTTP 备用通道）
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {object} params - { type?: string, content: string }
 * @returns {Message}
 */
async function sendMessageHttp(accessToken, conversationId, params) {
  return await request(`${BASE_URL}/api/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/**
 * 标记已读
 * @param {string} accessToken
 * @param {string} conversationId
 */
async function markConversationRead(accessToken, conversationId) {
  return await request(`${BASE_URL}/api/chat/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 获取会话成员列表
 * @param {string} accessToken
 * @param {string} conversationId
 */
async function getConversationMembers(accessToken, conversationId) {
  return await request(`${BASE_URL}/api/chat/conversations/${conversationId}/members`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 添加成员（群聊）
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {string} userId
 */
async function addConversationMember(accessToken, conversationId, userId) {
  return await request(`${BASE_URL}/api/chat/conversations/${conversationId}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}

/**
 * 移除成员（群聊）
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {string} userId
 */
async function removeConversationMember(accessToken, conversationId, userId) {
  return await request(`${BASE_URL}/api/chat/conversations/${conversationId}/members/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 获取总未读消息数
 * @param {string} accessToken
 * @returns {{ count: number }}
 */
async function getUnreadCount(accessToken) {
  return await request(`${BASE_URL}/api/chat/unread/count`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 获取在线用户列表
 * @param {string} accessToken
 */
async function getOnlineUsers(accessToken) {
  return await request(`${BASE_URL}/api/chat/online`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 上传文件/图片
 * @param {string} accessToken
 * @param {Buffer} fileBuffer
 * @param {string} filename
 * @param {string} mimetype
 * @returns {UploadFile}
 */
async function uploadFile(accessToken, fileBuffer, filename, mimetype) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', fileBuffer, { filename, contentType: mimetype });

  const headers = form.getHeaders();
  headers['Authorization'] = `Bearer ${accessToken}`;

  const url = `${BASE_URL}/api/chat/upload`;
  console.log(`[API] >>> POST ${url} (multipart upload: ${filename}, ${mimetype})`);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
    });
  } catch (err) {
    throw new Error(`文件上传失败：${err.message}`);
  }

  if (!res.ok && res.status !== 400) {
    throw new Error(`服务器返回 HTTP ${res.status}`);
  }

  const json = await res.json();
  console.log(`[API] <<< POST ${url} HTTP ${res.status}`, JSON.stringify(json, null, 2));
  if (json.code !== 0) {
    throw new Error(json.message || '上传失败');
  }
  return json.data;
}

/**
 * 获取 WebSocket URL
 * @returns {string}
 */
function getWsUrl() {
  return BASE_URL.replace(/^http/, 'ws') + '/ws/chat';
}

/**
 * 获取文件访问的完整 URL
 * @param {string} path - 如 "/uploads/xxx.jpg"
 * @returns {string}
 */
function getFileUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return BASE_URL + path;
}

module.exports = {
  getPublicKey, prefetchPublicKey, login, refreshToken, getProfile, getSdkToken, getIdToken,
  changePassword, createMeeting, getMeetingList, getDepartmentTree, getDepartmentUsers, searchUsers,
  // IM
  getConversations, createConversation, getConversationDetail, getMessages, sendMessageHttp,
  markConversationRead, getConversationMembers, addConversationMember, removeConversationMember,
  getUnreadCount, getOnlineUsers, uploadFile, getWsUrl, getFileUrl,
};
