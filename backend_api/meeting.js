/**
 * 腾讯会议相关 API
 * - 创建会议
 * - 查询用户会议列表
 */

const { BASE_URL, request } = require('./httpClient');

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
 * 修改会议
 * 仅会议创建者可修改。
 * @param {string} accessToken
 * @param {string} meetingId - 会议 ID（meeting_id，非 meeting_code）
 * @param {object} updates - 要修改的字段（至少一项）
 * @param {string} [updates.subject] - 会议主题
 * @param {string} [updates.start_time] - 开始时间（秒级时间戳字符串）
 * @param {string} [updates.end_time] - 结束时间（秒级时间戳字符串）
 * @param {number} [updates.instanceid] - 终端设备类型
 * @param {string} [updates.password] - 会议密码
 * @param {object} [updates.settings] - 会议设置
 * @param {string} [updates.time_zone] - 时区
 * @param {string} [updates.location] - 会议地点
 * @returns {{ meeting_number: number, meeting_info_list: MeetingInfo[] }}
 */
async function updateMeeting(accessToken, meetingId, updates) {
  return await request(`${BASE_URL}/api/wemeet/meetings/${meetingId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
}

/**
 * 取消会议
 * 仅会议创建者可取消。
 * @param {string} accessToken
 * @param {string} meetingId - 会议 ID（meeting_id，非 meeting_code）
 * @param {object} [options] - 可选参数
 * @param {number} [options.reason_code=1] - 取消原因代码
 * @param {string} [options.reason_detail] - 详细取消原因描述
 * @returns {object}
 */
async function cancelMeeting(accessToken, meetingId, options = {}) {
  const body = { ...options };
  return await request(`${BASE_URL}/api/wemeet/meetings/${meetingId}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

module.exports = {
  createMeeting,
  getMeetingList,
  updateMeeting,
  cancelMeeting,
};
