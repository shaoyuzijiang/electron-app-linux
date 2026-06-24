/**
 * 后端 API 聚合层
 * - 鉴权（auth）：登录、令牌、用户信息、SDK Token、ID Token、修改密码
 * - 用户选择器（user-picker）：部门树、部门成员、用户搜索
 *
 * IM 与 会议相关接口已分别拆到 ./im 与 ./meeting。
 * 为保持向后兼容，本文件末尾 re-export 这两个模块的全部方法，
 * 现有代码 `const api = require('./backend_api/api'); api.xxx()` 无需改动。
 */

const {
  BASE_URL,
  request,
  getPublicKey,
  prefetchPublicKey,
  encryptRequest,
} = require('./httpClient');

const im = require('./im');
const meeting = require('./meeting');

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

module.exports = {
  // auth
  getPublicKey,
  prefetchPublicKey,
  login,
  refreshToken,
  getProfile,
  getSdkToken,
  getIdToken,
  changePassword,
  // user-picker
  getDepartmentTree,
  getDepartmentUsers,
  searchUsers,
  // IM（re-export，保持兼容）
  ...im,
  // 会议（re-export，保持兼容）
  ...meeting,
};
