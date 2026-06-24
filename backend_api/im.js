/**
 * IM 即时通讯 API
 * - 会话管理（列表/创建/详情/成员）
 * - 消息收发（HTTP 备用通道）
 * - 未读 / 在线状态
 * - 文件上传
 * - WebSocket URL 与文件 URL 辅助
 */

const crypto = require('crypto');
const { BASE_URL, request } = require('./httpClient');

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
  // 手动构造 multipart/form-data，避免 FormData/Blob 在 Electron 主进程的兼容问题
  const boundary = '----FormBoundary' + crypto.randomBytes(16).toString('hex');
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimetype}\r\n\r\n`,
    'utf8'
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([header, fileBuffer, footer]);

  const url = `${BASE_URL}/api/chat/upload`;
  console.log(`[API] >>> POST ${url} (multipart upload: ${filename}, ${mimetype}, size=${fileBuffer.length})`);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      body,
    });
  } catch (err) {
    throw new Error(`文件上传失败：${err.message}`);
  }

  if (!res.ok && res.status !== 400) {
    const respText = await res.text().catch(() => '');
    console.error(`[API] <<< POST ${url} HTTP ${res.status}`, respText);
    throw new Error(`服务器返回 HTTP ${res.status}${respText ? ': ' + respText.substring(0, 200) : ''}`);
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
  getConversations,
  createConversation,
  getConversationDetail,
  getMessages,
  sendMessageHttp,
  markConversationRead,
  getConversationMembers,
  addConversationMember,
  removeConversationMember,
  getUnreadCount,
  getOnlineUsers,
  uploadFile,
  getWsUrl,
  getFileUrl,
};
