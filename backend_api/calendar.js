/**
 * 日程 API
 * - 日程管理（创建/列表/详情/修改/取消）
 * - 参与者管理（添加/删除/列表）
 * - 空闲时间查询（freebusy）
 *
 * 接口契约见 backend_api/calendar-interface.md
 * 架构约束见 backend_api/calendar.md
 */

const { BASE_URL, request } = require('./httpClient');

/**
 * 创建日程
 * @param {string} accessToken
 * @param {object} params - { title, description?, startTime, endTime, location?, participantIds?, meeting? }
 * @returns {Event}
 */
async function createEvent(accessToken, params) {
  return await request(`${BASE_URL}/api/calendar/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/**
 * 日程列表
 * @param {string} accessToken
 * @param {object} [options] - { startDate?, endDate?, status? }
 * @returns {Array<Event>}
 */
async function getEvents(accessToken, options = {}) {
  const params = new URLSearchParams();
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);
  if (options.status) params.append('status', options.status);
  const qs = params.toString() ? '?' + params : '';
  return await request(`${BASE_URL}/api/calendar/events${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 日程详情
 * @param {string} accessToken
 * @param {string} eventId
 * @returns {Event}
 */
async function getEventDetail(accessToken, eventId) {
  return await request(`${BASE_URL}/api/calendar/events/${eventId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 修改日程（仅组织者可操作）
 * @param {string} accessToken
 * @param {string} eventId
 * @param {object} params - { title?, description?, startTime?, endTime?, location?, meeting? }
 *   - meeting 传 null 表示清除会议信息
 * @returns {Event}
 */
async function updateEvent(accessToken, eventId, params) {
  return await request(`${BASE_URL}/api/calendar/events/${eventId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/**
 * 取消日程（仅组织者可操作，软删除）
 * @param {string} accessToken
 * @param {string} eventId
 * @returns {{ message: string }}
 */
async function cancelEvent(accessToken, eventId) {
  return await request(`${BASE_URL}/api/calendar/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 添加参与者（仅组织者可操作）
 * @param {string} accessToken
 * @param {string} eventId
 * @param {string} userId
 * @returns {{ message: string, participant: Participant }}
 */
async function addEventParticipant(accessToken, eventId, userId) {
  return await request(`${BASE_URL}/api/calendar/events/${eventId}/participants`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}

/**
 * 删除参与者（仅组织者可操作，组织者自身不可被删除）
 * @param {string} accessToken
 * @param {string} eventId
 * @param {string} userId
 * @returns {{ message: string }}
 */
async function removeEventParticipant(accessToken, eventId, userId) {
  return await request(`${BASE_URL}/api/calendar/events/${eventId}/participants/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 参与者列表
 * @param {string} accessToken
 * @param {string} eventId
 * @returns {Array<Participant>}
 */
async function getEventParticipants(accessToken, eventId) {
  return await request(`${BASE_URL}/api/calendar/events/${eventId}/participants`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 查询用户空闲时间
 * @param {string} accessToken
 * @param {object} params - { userIds: string[], startTime: string, endTime: string }
 * @returns {Array<FreeBusySlot>}
 */
async function getFreeBusy(accessToken, params) {
  const qs = new URLSearchParams({
    userIds: Array.isArray(params.userIds) ? params.userIds.join(',') : params.userIds,
    startTime: params.startTime,
    endTime: params.endTime,
  }).toString();
  return await request(`${BASE_URL}/api/calendar/freebusy?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

module.exports = {
  createEvent,
  getEvents,
  getEventDetail,
  updateEvent,
  cancelEvent,
  addEventParticipant,
  removeEventParticipant,
  getEventParticipants,
  getFreeBusy,
};