// ========== 日程（Calendar）模块 ==========

let calendarInitialized = false;
let calendarCurrentUserId = null;
let calendarCurrentUsername = null;

// 日程列表数据
let calendarEvents = [];
let calendarActiveEventId = null;
let calendarActiveEventDetail = null;

// 日期范围（YYYY-MM-DD）
function calendarTodayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function calendarAddDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

let calendarStartDate = calendarTodayStr();
let calendarEndDate = calendarAddDaysStr(calendarStartDate, 30);
let calendarStatusFilter = 'active';

// 参与者选择缓存
let calendarParticipantSearchResults = [];
let calendarParticipantSearchTimer = null;

// ---------- 初始化 ----------

async function initCalendar() {
  if (calendarInitialized) return;
  calendarInitialized = true;

  // 获取当前用户信息
  try {
    const profileResult = await window.electronAPI.getProfile();
    if (profileResult.success) {
      calendarCurrentUserId = profileResult.profile.id;
      calendarCurrentUsername = profileResult.profile.username;
    }
  } catch (err) {
    console.error('[Calendar] 获取用户信息失败:', err);
  }

  bindCalendarEvents();

  // 默认填充日期
  const startInput = document.getElementById('calendarStartDate');
  const endInput = document.getElementById('calendarEndDate');
  if (startInput) startInput.value = calendarStartDate;
  if (endInput) endInput.value = calendarEndDate;

  await loadCalendarEvents();
}

// ---------- 日程列表 ----------

async function loadCalendarEvents() {
  const container = document.getElementById('calendarEventList');
  if (container) container.innerHTML = '<div class="calendar-loading">加载中...</div>';

  try {
    const result = await window.electronAPI.calendarGetEvents({
      startDate: calendarStartDate,
      endDate: calendarEndDate,
      status: calendarStatusFilter,
    });
    if (result.success && result.data) {
      calendarEvents = result.data;
      renderCalendarEventList();
    } else {
      calendarEvents = [];
      renderCalendarEventList();
    }
  } catch (err) {
    console.error('[Calendar] 加载日程失败:', err);
    if (container) {
      container.innerHTML = `<div class="calendar-list-empty">${escapeHtml(err.message || '加载失败')}</div>`;
    }
  }
}

function groupCalendarEventsByDate(events) {
  const groups = {};
  events.forEach((ev) => {
    const dateKey = (ev.startTime || '').split(' ')[0] || '未知';
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(ev);
  });

  // 按日期排序
  const sortedKeys = Object.keys(groups).sort();
  return sortedKeys.map((key) => ({ date: key, items: groups[key] }));
}

function getCalendarDateLabel(dateStr) {
  if (!dateStr) return '';
  const today = calendarTodayStr();
  const tomorrow = calendarAddDaysStr(today, 1);
  if (dateStr === today) return '今天';
  if (dateStr === tomorrow) return '明天';
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}

function formatCalendarTime(timeStr) {
  if (!timeStr) return '';
  // timeStr: "YYYY-MM-DD HH:MM:SS"
  const parts = timeStr.split(' ');
  if (parts.length < 2) return timeStr;
  return parts[1].substring(0, 5); // HH:MM
}

function renderCalendarEventList() {
  const container = document.getElementById('calendarEventList');
  if (!container) return;

  if (!calendarEvents || calendarEvents.length === 0) {
    container.innerHTML = `
      <div class="calendar-list-empty">
        <svg viewBox="0 0 24 24"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.11 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/></svg>
        <div>暂无日程</div>
        <div style="margin-top:6px;font-size:11px;">点击上方"新建日程"开始</div>
      </div>`;
    return;
  }

  const grouped = groupCalendarEventsByDate(calendarEvents);

  container.innerHTML = grouped.map((group) => {
    const label = getCalendarDateLabel(group.date);
    return `
      <div class="calendar-day-group">
        <div class="calendar-day-label">${escapeHtml(label)} · ${escapeHtml(group.date)}</div>
        ${group.items.map((ev) => {
          const isActive = ev.id === calendarActiveEventId;
          const isCancelled = ev.status === 'cancelled';
          const isOrganizer = ev.organizerId === calendarCurrentUserId;
          const hasMeeting = !!ev.meeting;
          const start = formatCalendarTime(ev.startTime);
          const end = formatCalendarTime(ev.endTime);
          return `
            <div class="calendar-event-item ${isActive ? 'active' : ''}" data-event-id="${escapeHtml(ev.id)}">
              <div class="calendar-event-time-block">
                <div class="calendar-event-time-start">${escapeHtml(start)}</div>
                <div class="calendar-event-time-end">${escapeHtml(end)}</div>
              </div>
              <div class="calendar-event-body">
                <div class="calendar-event-title">${escapeHtml(ev.title || '未命名日程')}</div>
                <div class="calendar-event-meta">
                  ${hasMeeting ? '<span class="calendar-event-tag meeting">会议</span>' : ''}
                  ${isOrganizer ? '<span class="calendar-event-tag organizer">组织者</span>' : ''}
                  ${isCancelled ? '<span class="calendar-event-tag cancelled">已取消</span>' : ''}
                  ${ev.location ? `<span>${escapeHtml(ev.location)}</span>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');
}

// ---------- 日程详情 ----------

async function selectCalendarEvent(eventId) {
  calendarActiveEventId = eventId;
  renderCalendarEventList();

  const detailContainer = document.getElementById('calendarDetailContent');
  if (detailContainer) {
    detailContainer.innerHTML = '<div class="calendar-loading">加载中...</div>';
    detailContainer.style.display = '';
  }
  const emptyEl = document.getElementById('calendarDetailEmpty');
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const result = await window.electronAPI.calendarGetEventDetail(eventId);
    if (result.success && result.data) {
      calendarActiveEventDetail = result.data;
      renderCalendarEventDetail(calendarActiveEventDetail);
    } else {
      if (detailContainer) {
        detailContainer.innerHTML = `<div class="calendar-list-empty">${escapeHtml(result.message || '加载详情失败')}</div>`;
      }
    }
  } catch (err) {
    console.error('[Calendar] 加载日程详情失败:', err);
    if (detailContainer) {
      detailContainer.innerHTML = `<div class="calendar-list-empty">${escapeHtml(err.message || '加载失败')}</div>`;
    }
  }
}

function renderCalendarEventDetail(ev) {
  const container = document.getElementById('calendarDetailContent');
  if (!container) return;

  const isOrganizer = ev.organizerId === calendarCurrentUserId;
  const isCancelled = ev.status === 'cancelled';

  const meetingBlock = ev.meeting ? renderMeetingBlock(ev.meeting) : '';
  const descriptionBlock = ev.description ? `
    <div class="calendar-detail-row">
      <div class="calendar-detail-label">描述</div>
      <div class="calendar-detail-value">
        <div class="calendar-description">${escapeHtml(ev.description)}</div>
      </div>
    </div>
  ` : '';

  const participantsSection = renderParticipantsSection(ev, isOrganizer);

  container.innerHTML = `
    <div class="calendar-detail-header">
      <h2 class="calendar-detail-title">
        ${escapeHtml(ev.title || '未命名日程')}
        ${isCancelled ? '<span class="calendar-event-tag cancelled">已取消</span>' : ''}
      </h2>
      <div class="calendar-detail-actions">
        ${isOrganizer && !isCancelled ? `
          <button class="calendar-action-btn" id="calendarEditBtn">编辑</button>
          <button class="calendar-action-btn danger" id="calendarCancelBtn">取消日程</button>
        ` : ''}
        ${ev.meeting && ev.meeting.joinUrl && !isCancelled ? `
          <button class="calendar-action-btn" id="calendarCopyMeetingBtn">复制会议信息</button>
        ` : ''}
      </div>
    </div>
    <div class="calendar-detail-body">
      <div class="calendar-detail-row">
        <div class="calendar-detail-label">组织者</div>
        <div class="calendar-detail-value">${escapeHtml(ev.organizerName || ev.organizerId || '-')}</div>
      </div>
      <div class="calendar-detail-row">
        <div class="calendar-detail-label">开始时间</div>
        <div class="calendar-detail-value">${escapeHtml(ev.startTime || '-')}</div>
      </div>
      <div class="calendar-detail-row">
        <div class="calendar-detail-label">结束时间</div>
        <div class="calendar-detail-value">${escapeHtml(ev.endTime || '-')}</div>
      </div>
      ${ev.location ? `
      <div class="calendar-detail-row">
        <div class="calendar-detail-label">地点</div>
        <div class="calendar-detail-value">${escapeHtml(ev.location)}</div>
      </div>
      ` : ''}
      ${descriptionBlock}
      ${meetingBlock}
      ${participantsSection}
    </div>
  `;

  // 绑定按钮
  const editBtn = document.getElementById('calendarEditBtn');
  const cancelBtn = document.getElementById('calendarCancelBtn');
  const copyBtn = document.getElementById('calendarCopyMeetingBtn');

  if (editBtn) editBtn.addEventListener('click', () => openCalendarEditModal(ev));
  if (cancelBtn) cancelBtn.addEventListener('click', () => cancelCalendarEvent(ev));
  if (copyBtn) copyBtn.addEventListener('click', () => copyMeetingInfo(ev.meeting));

  // 绑定参与者操作
  bindParticipantsEvents(ev);

  // 如果有参与者，查询空闲时间（默认组织者 + 1 个参与者）
  if (ev.participants && ev.participants.length > 1 && ev.startTime && ev.endTime) {
    const otherIds = ev.participants
      .filter((p) => p.userId !== calendarCurrentUserId)
      .map((p) => p.userId)
      .slice(0, 5); // 最多查 5 人
    if (otherIds.length > 0) {
      loadFreeBusyForEvent(ev, [calendarCurrentUserId, ...otherIds]);
    }
  }
}

function renderMeetingBlock(meeting) {
  if (!meeting) return '';
  const isWemeet = meeting.meetingType === 'wemeet';
  const code = meeting.meetingCode || meeting.meetingId || '';
  return `
    <div class="calendar-detail-row">
      <div class="calendar-detail-label">会议</div>
      <div class="calendar-detail-value">
        <div class="calendar-meeting-card">
          <div class="calendar-meeting-card-header">
            <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
            ${isWemeet ? '腾讯会议' : '自定义会议'}
            ${meeting.meetingSubject ? ` · ${escapeHtml(meeting.meetingSubject)}` : ''}
          </div>
          ${code ? `
            <div class="calendar-meeting-card-row">
              <div class="calendar-meeting-card-label">会议号</div>
              <div class="calendar-meeting-card-value meeting-code" data-code="${escapeHtml(code)}">${escapeHtml(code)}</div>
            </div>
          ` : ''}
          ${meeting.joinUrl ? `
            <div class="calendar-meeting-card-row">
              <div class="calendar-meeting-card-label">入会链接</div>
              <div class="calendar-meeting-card-value">
                <a href="${escapeHtml(meeting.joinUrl)}" target="_blank" class="calendar-meeting-card-link">打开会议链接</a>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderParticipantsSection(ev, isOrganizer) {
  const participants = ev.participants || [];
  const isCancelled = ev.status === 'cancelled';

  return `
    <div class="calendar-participants-section">
      <div class="calendar-participants-title">
        <span>参与者（${participants.length}）</span>
        ${isOrganizer && !isCancelled ? `
          <button class="calendar-add-participant-btn" id="calendarAddParticipantBtn">+ 添加</button>
        ` : ''}
      </div>
      <div class="calendar-participants-list" id="calendarParticipantsList">
        ${participants.map((p) => {
          const initial = (p.username || '?').charAt(0).toUpperCase();
          const isSelf = p.userId === calendarCurrentUserId;
          const isOrganizerUser = p.userId === ev.organizerId;
          const statusLabel = {
            accepted: '已接受',
            pending: '待回复',
            declined: '已拒绝',
            tentative: '待定',
          }[p.status] || p.status;
          const canRemove = isOrganizer && !isOrganizerUser && !isCancelled;
          return `
            <div class="calendar-participant-item" data-user-id="${escapeHtml(p.userId)}">
              <div class="calendar-participant-avatar">${escapeHtml(initial)}</div>
              <div class="calendar-participant-info">
                <div class="calendar-participant-name">${escapeHtml(p.username || p.userId)}${isSelf ? ' (我)' : ''}${isOrganizerUser ? ' · 组织者' : ''}</div>
                <div class="calendar-participant-status ${escapeHtml(p.status)}">${escapeHtml(statusLabel)}</div>
              </div>
              ${canRemove ? `<button class="calendar-participant-remove" data-user-id="${escapeHtml(p.userId)}" data-username="${escapeHtml(p.username || '')}" title="移除">×</button>` : ''}
            </div>
          `;
        }).join('')}
      </div>
      <div id="calendarFreeBusyContainer"></div>
    </div>
  `;
}

function bindParticipantsEvents(ev) {
  const isOrganizer = ev.organizerId === calendarCurrentUserId;

  // 添加参与者
  const addBtn = document.getElementById('calendarAddParticipantBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => openAddParticipantModal(ev));
  }

  // 移除参与者
  const list = document.getElementById('calendarParticipantsList');
  if (list) {
    list.addEventListener('click', async (e) => {
      const removeBtn = e.target.closest('.calendar-participant-remove');
      if (!removeBtn) return;
      const userId = removeBtn.getAttribute('data-user-id');
      const username = removeBtn.getAttribute('data-username');
      if (!confirm(`确定移除 ${username || '该用户'}？`)) return;

      try {
        const result = await window.electronAPI.calendarRemoveParticipant(ev.id, userId);
        if (result.success) {
          await selectCalendarEvent(ev.id);
          await loadCalendarEvents();
        } else {
          alert(result.message || '移除失败');
        }
      } catch (err) {
        alert('移除失败: ' + err.message);
      }
    });
  }

  // 会议号点击复制
  const detailContainer = document.getElementById('calendarDetailContent');
  if (detailContainer) {
    detailContainer.addEventListener('click', (e) => {
      const codeEl = e.target.closest('.meeting-code');
      if (codeEl) {
        const code = codeEl.getAttribute('data-code');
        if (code) {
          navigator.clipboard.writeText(code).then(() => {
            const original = codeEl.textContent;
            codeEl.textContent = '已复制';
            setTimeout(() => { codeEl.textContent = original; }, 1000);
          }).catch(() => {});
        }
      }
    });
  }
}

function copyMeetingInfo(meeting) {
  if (!meeting) return;
  const lines = [];
  if (meeting.meetingSubject) lines.push(`会议主题：${meeting.meetingSubject}`);
  if (meeting.meetingCode) lines.push(`会议号：${meeting.meetingCode}`);
  if (meeting.meetingId) lines.push(`会议 ID：${meeting.meetingId}`);
  if (meeting.joinUrl) lines.push(`入会链接：${meeting.joinUrl}`);
  const text = lines.join('\n');
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    alert('会议信息已复制');
  }).catch(() => {
    alert('复制失败，请手动复制');
  });
}

// ---------- 空闲时间查询 ----------

async function loadFreeBusyForEvent(ev, userIds) {
  if (!ev.startTime || !ev.endTime || !userIds || userIds.length === 0) return;
  const container = document.getElementById('calendarFreeBusyContainer');
  if (!container) return;

  container.innerHTML = `<div class="calendar-freebusy-bar"><div class="calendar-freebusy-title">空闲时间</div><div style="color:#999;">加载中...</div></div>`;

  try {
    const result = await window.electronAPI.calendarGetFreeBusy({
      userIds,
      startTime: ev.startTime,
      endTime: ev.endTime,
    });
    if (!result.success || !result.data) {
      container.innerHTML = '';
      return;
    }

    const slots = result.data;
    if (slots.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="calendar-freebusy-bar">
        <div class="calendar-freebusy-title">参与者在此期间的忙碌时段</div>
        <div class="calendar-freebusy-list">
          ${slots.map((s) => {
            const slotHtml = s.busySlots && s.busySlots.length > 0
              ? s.busySlots.map((bs) => `<span class="calendar-freebusy-slot">${escapeHtml(bs.startTime.split(' ')[1] || bs.startTime)}-${escapeHtml(bs.endTime.split(' ')[1] || bs.endTime)} ${escapeHtml(bs.title || '')}</span>`).join(' ')
              : '<span class="calendar-free-empty">空闲</span>';
            return `<div class="calendar-freebusy-item">${escapeHtml(s.username || s.userId)}：${slotHtml}</div>`;
          }).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    console.warn('[Calendar] 空闲时间查询失败:', err.message);
    container.innerHTML = '';
  }
}

// ---------- 创建/编辑日程弹窗 ----------

// 弹窗内状态
let calendarFormState = {
  participants: [], // [{ id, username, departmentName }]
  meetingEnabled: false,
  meetingType: 'custom', // 'wemeet' | 'custom'
  participantSearchTimer: null,
};

function resetCalendarFormState() {
  calendarFormState = {
    participants: [],
    meetingEnabled: false,
    meetingType: 'custom',
    participantSearchTimer: null,
  };
}

function openCalendarCreateModal() {
  resetCalendarFormState();
  const modal = document.getElementById('calendarEventModal');
  const titleEl = document.getElementById('calendarEventModalTitle');
  const errorEl = document.getElementById('calendarEventError');
  if (!modal) return;

  titleEl.textContent = '新建日程';
  errorEl.textContent = '';

  // 重置表单
  document.getElementById('calendarEventTitle').value = '';
  document.getElementById('calendarEventDescription').value = '';

  // 默认时间：当前时间 +1 小时到 +2 小时
  const now = new Date();
  const startDefault = new Date(now.getTime() + 60 * 60 * 1000);
  const endDefault = new Date(startDefault.getTime() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  document.getElementById('calendarEventStart').value = toLocal(startDefault);
  document.getElementById('calendarEventEnd').value = toLocal(endDefault);
  document.getElementById('calendarEventLocation').value = '';

  // 会议区域
  document.getElementById('calendarEventMeetingEnabled').checked = false;
  document.getElementById('calendarMeetingSection').style.display = 'none';
  document.getElementById('calendarEventMeetingJoinUrl').value = '';
  document.getElementById('calendarEventMeetingSubject').value = '';
  document.getElementById('calendarEventMeetingCode').value = '';
  document.getElementById('calendarEventMeetingId').value = '';
  document.getElementById('calendarMeetingType').value = 'custom';

  // 参与者
  document.getElementById('calendarEventParticipantSearch').value = '';
  document.getElementById('calendarEventParticipantSearchResults').innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">输入关键词搜索用户</div>';
  renderFormSelectedParticipants();

  // 标识当前为新建模式
  modal.setAttribute('data-mode', 'create');
  modal.removeAttribute('data-event-id');
  modal.classList.add('show');
}

function openCalendarEditModal(ev) {
  resetCalendarFormState();
  const modal = document.getElementById('calendarEventModal');
  const titleEl = document.getElementById('calendarEventModalTitle');
  const errorEl = document.getElementById('calendarEventError');
  if (!modal) return;

  titleEl.textContent = '编辑日程';
  errorEl.textContent = '';

  document.getElementById('calendarEventTitle').value = ev.title || '';
  document.getElementById('calendarEventDescription').value = ev.description || '';
  document.getElementById('calendarEventLocation').value = ev.location || '';
  document.getElementById('calendarEventStart').value = toDateTimeLocalInput(ev.startTime);
  document.getElementById('calendarEventEnd').value = toDateTimeLocalInput(ev.endTime);

  // 会议信息
  const hasMeeting = !!ev.meeting;
  document.getElementById('calendarEventMeetingEnabled').checked = hasMeeting;
  document.getElementById('calendarMeetingSection').style.display = hasMeeting ? '' : 'none';
  if (hasMeeting) {
    document.getElementById('calendarMeetingType').value = ev.meeting.meetingType || 'custom';
    document.getElementById('calendarEventMeetingJoinUrl').value = ev.meeting.joinUrl || '';
    document.getElementById('calendarEventMeetingSubject').value = ev.meeting.meetingSubject || '';
    document.getElementById('calendarEventMeetingCode').value = ev.meeting.meetingCode || '';
    document.getElementById('calendarEventMeetingId').value = ev.meeting.meetingId || '';
    calendarFormState.meetingEnabled = true;
    calendarFormState.meetingType = ev.meeting.meetingType || 'custom';
  } else {
    calendarFormState.meetingEnabled = false;
    calendarFormState.meetingType = 'custom';
  }

  // 参与者（排除组织者）
  calendarFormState.participants = (ev.participants || [])
    .filter((p) => p.userId !== ev.organizerId)
    .map((p) => ({ id: p.userId, username: p.username, departmentName: p.userId }));
  renderFormSelectedParticipants();

  document.getElementById('calendarEventParticipantSearch').value = '';
  document.getElementById('calendarEventParticipantSearchResults').innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">输入关键词搜索用户</div>';

  modal.setAttribute('data-mode', 'edit');
  modal.setAttribute('data-event-id', ev.id);
  modal.classList.add('show');
}

function toDateTimeLocalInput(timeStr) {
  if (!timeStr) return '';
  // "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM"
  return timeStr.replace(' ', 'T').substring(0, 16);
}

function renderFormSelectedParticipants() {
  const container = document.getElementById('calendarFormSelectedParticipants');
  if (!container) return;
  if (calendarFormState.participants.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  container.innerHTML = calendarFormState.participants.map((u) => {
    const initial = (u.username || '?').charAt(0).toUpperCase();
    return `
      <span class="calendar-participant-item" style="display:inline-flex;width:auto;padding:4px 8px;">
        <div class="calendar-participant-avatar" style="width:20px;height:20px;font-size:10px;">${escapeHtml(initial)}</div>
        <span class="calendar-participant-name">${escapeHtml(u.username || u.id)}</span>
        <button class="calendar-participant-remove" data-user-id="${escapeHtml(u.id)}" title="移除">×</button>
      </span>
    `;
  }).join('');
}

async function searchUsersForCalendarForm(keyword) {
  const container = document.getElementById('calendarEventParticipantSearchResults');
  if (!container) return;

  if (!keyword.trim()) {
    container.innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">输入关键词搜索用户</div>';
    return;
  }
  container.innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">搜索中...</div>';

  try {
    const result = await window.electronAPI.searchUsers(keyword);
    if (result.success && result.data) {
      const users = result.data;
      if (users.length === 0) {
        container.innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">未找到用户</div>';
        return;
      }
      container.innerHTML = users.map((user) => {
        const initial = (user.username || '?').charAt(0).toUpperCase();
        const isSelected = calendarFormState.participants.find((u) => u.id === user.id);
        return `
          <div class="calendar-participant-pick-item ${isSelected ? 'selected' : ''}" data-user-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}" data-dept="${escapeHtml(user.departmentName || '')}">
            <div class="calendar-participant-pick-avatar">${escapeHtml(initial)}</div>
            <div class="calendar-participant-pick-info">
              <div class="calendar-participant-pick-name">${escapeHtml(user.username)}</div>
              <div class="calendar-participant-pick-dept">${escapeHtml(user.departmentName || user.id)}</div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      container.innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">搜索失败</div>';
    }
  } catch (err) {
    container.innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">搜索失败</div>';
  }
}

function collectMeetingFromForm() {
  const enabled = document.getElementById('calendarEventMeetingEnabled').checked;
  if (!enabled) return null; // 显式清空会议
  const meetingType = document.getElementById('calendarMeetingType').value;
  const joinUrl = document.getElementById('calendarEventMeetingJoinUrl').value.trim();
  if (!joinUrl) {
    throw new Error('启用会议时必须填写会议链接');
  }
  const meeting = {
    meetingType,
    joinUrl,
    meetingSubject: document.getElementById('calendarEventMeetingSubject').value.trim(),
  };
  const code = document.getElementById('calendarEventMeetingCode').value.trim();
  const meetingId = document.getElementById('calendarEventMeetingId').value.trim();
  if (meetingType === 'wemeet') {
    if (code) meeting.meetingCode = code;
    if (meetingId) meeting.meetingId = meetingId;
  } else {
    if (code) meeting.meetingCode = code;
  }
  return meeting;
}

async function submitCalendarEvent() {
  const modal = document.getElementById('calendarEventModal');
  const errorEl = document.getElementById('calendarEventError');
  errorEl.textContent = '';

  const title = document.getElementById('calendarEventTitle').value.trim();
  const description = document.getElementById('calendarEventDescription').value.trim();
  const startRaw = document.getElementById('calendarEventStart').value;
  const endRaw = document.getElementById('calendarEventEnd').value;
  const location = document.getElementById('calendarEventLocation').value.trim();

  if (!title) {
    errorEl.textContent = '请输入日程标题';
    return;
  }
  if (title.length > 200) {
    errorEl.textContent = '标题不能超过 200 字符';
    return;
  }
  if (description.length > 2000) {
    errorEl.textContent = '描述不能超过 2000 字符';
    return;
  }
  if (!startRaw) {
    errorEl.textContent = '请选择开始时间';
    return;
  }
  if (!endRaw) {
    errorEl.textContent = '请选择结束时间';
    return;
  }
  if (new Date(startRaw) >= new Date(endRaw)) {
    errorEl.textContent = '结束时间必须晚于开始时间';
    return;
  }
  if (location.length > 200) {
    errorEl.textContent = '地点不能超过 200 字符';
    return;
  }

  let meeting;
  try {
    meeting = collectMeetingFromForm();
  } catch (err) {
    errorEl.textContent = err.message;
    return;
  }

  const startTime = startRaw.replace('T', ' ') + ':00';
  const endTime = endRaw.replace('T', ' ') + ':00';

  const params = {
    title,
    description: description || undefined,
    startTime,
    endTime,
    location: location || undefined,
    participantIds: calendarFormState.participants.map((u) => u.id),
  };
  if (meeting !== undefined) params.meeting = meeting;

  const mode = modal.getAttribute('data-mode');
  const submitBtn = document.getElementById('calendarEventSubmit');
  submitBtn.disabled = true;
  submitBtn.textContent = '保存中...';

  try {
    let result;
    if (mode === 'edit') {
      const eventId = modal.getAttribute('data-event-id');
      // 编辑时只传变化的字段；meeting 为 null 时表示清除
      const updateParams = {};
      updateParams.title = title;
      if (description) updateParams.description = description; else updateParams.description = '';
      updateParams.startTime = startTime;
      updateParams.endTime = endTime;
      if (location) updateParams.location = location; else updateParams.location = '';
      if (meeting !== undefined) updateParams.meeting = meeting;

      result = await window.electronAPI.calendarUpdateEvent(eventId, updateParams);
    } else {
      result = await window.electronAPI.calendarCreateEvent(params);
    }

    if (result.success) {
      modal.classList.remove('show');
      const newId = result.data && result.data.id;
      if (mode === 'edit') {
        await selectCalendarEvent(modal.getAttribute('data-event-id'));
      } else if (newId) {
        await selectCalendarEvent(newId);
      }
      await loadCalendarEvents();
    } else {
      errorEl.textContent = result.message || '保存失败';
    }
  } catch (err) {
    errorEl.textContent = err.message || '保存失败';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '保存';
  }
}

// ---------- 取消日程 ----------

async function cancelCalendarEvent(ev) {
  if (!confirm(`确定取消日程「${ev.title}」？取消后数据保留。`)) return;

  try {
    const result = await window.electronAPI.calendarCancelEvent(ev.id);
    if (result.success) {
      await selectCalendarEvent(ev.id);
      await loadCalendarEvents();
    } else {
      alert(result.message || '取消失败');
    }
  } catch (err) {
    alert('取消失败: ' + err.message);
  }
}

// ---------- 添加参与者弹窗 ----------

async function openAddParticipantModal(ev) {
  const modal = document.getElementById('calendarAddParticipantModal');
  const errorEl = document.getElementById('calendarAddParticipantError');
  const searchInput = document.getElementById('calendarAddParticipantSearchInput');
  const resultsEl = document.getElementById('calendarAddParticipantSearchResults');

  if (!modal) return;

  errorEl.textContent = '';
  searchInput.value = '';
  resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">输入关键词搜索用户</div>';
  modal.setAttribute('data-event-id', ev.id);
  modal.classList.add('show');
  setTimeout(() => searchInput.focus(), 100);
}

async function searchUsersForAddParticipant(keyword) {
  const modal = document.getElementById('calendarAddParticipantModal');
  const eventId = modal.getAttribute('data-event-id');
  const resultsEl = document.getElementById('calendarAddParticipantSearchResults');

  if (!keyword.trim()) {
    resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">输入关键词搜索用户</div>';
    return;
  }
  resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">搜索中...</div>';

  try {
    // 先取最新参与者列表用于排除
    const detailRes = await window.electronAPI.calendarGetEventDetail(eventId);
    const existingIds = new Set();
    if (detailRes.success && detailRes.data && detailRes.data.participants) {
      detailRes.data.participants.forEach((p) => existingIds.add(p.userId));
    }

    const result = await window.electronAPI.searchUsers(keyword);
    if (result.success && result.data) {
      const users = result.data.filter((u) => !existingIds.has(u.id));
      if (users.length === 0) {
        resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">没有可添加的用户</div>';
        return;
      }
      resultsEl.innerHTML = users.map((user) => {
        const initial = (user.username || '?').charAt(0).toUpperCase();
        return `
          <div class="calendar-participant-pick-item" data-user-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}">
            <div class="calendar-participant-pick-avatar">${escapeHtml(initial)}</div>
            <div class="calendar-participant-pick-info">
              <div class="calendar-participant-pick-name">${escapeHtml(user.username)}</div>
              <div class="calendar-participant-pick-dept">${escapeHtml(user.departmentName || user.id)}</div>
            </div>
            <button class="calendar-action-btn" data-add-btn="true">添加</button>
          </div>
        `;
      }).join('');
    } else {
      resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">搜索失败</div>';
    }
  } catch (err) {
    resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">搜索失败</div>';
  }
}

async function handleAddParticipantClick(userId, username) {
  const modal = document.getElementById('calendarAddParticipantModal');
  const eventId = modal.getAttribute('data-event-id');
  const errorEl = document.getElementById('calendarAddParticipantError');
  errorEl.textContent = '';

  try {
    const result = await window.electronAPI.calendarAddParticipant(eventId, userId);
    if (result.success) {
      modal.classList.remove('show');
      await selectCalendarEvent(eventId);
      await loadCalendarEvents();
    } else {
      errorEl.textContent = result.message || '添加失败';
    }
  } catch (err) {
    errorEl.textContent = err.message || '添加失败';
  }
}

// ---------- 工具函数 ----------

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// ---------- 事件绑定 ----------

function bindCalendarEvents() {
  // 创建日程按钮
  const createBtn = document.getElementById('calendarCreateBtn');
  if (createBtn) {
    createBtn.addEventListener('click', openCalendarCreateModal);
  }

  // 日期范围筛选
  const startDateInput = document.getElementById('calendarStartDate');
  const endDateInput = document.getElementById('calendarEndDate');
  if (startDateInput) {
    startDateInput.addEventListener('change', (e) => {
      calendarStartDate = e.target.value || calendarTodayStr();
      loadCalendarEvents();
    });
  }
  if (endDateInput) {
    endDateInput.addEventListener('change', (e) => {
      calendarEndDate = e.target.value || calendarAddDaysStr(calendarStartDate, 30);
      loadCalendarEvents();
    });
  }

  // 状态筛选
  const statusSelect = document.getElementById('calendarStatusFilter');
  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      calendarStatusFilter = e.target.value;
      loadCalendarEvents();
    });
  }

  // 列表点击
  const eventList = document.getElementById('calendarEventList');
  if (eventList) {
    eventList.addEventListener('click', (e) => {
      const item = e.target.closest('.calendar-event-item');
      if (!item) return;
      const eventId = item.getAttribute('data-event-id');
      if (eventId) selectCalendarEvent(eventId);
    });
  }

  // ---- 创建/编辑弹窗 ----
  const eventModal = document.getElementById('calendarEventModal');
  const cancelEventModalBtn = document.getElementById('calendarEventCancel');
  const submitEventBtn = document.getElementById('calendarEventSubmit');

  if (cancelEventModalBtn) {
    cancelEventModalBtn.addEventListener('click', () => {
      eventModal.classList.remove('show');
    });
  }
  if (eventModal) {
    eventModal.addEventListener('click', (e) => {
      if (e.target.id === 'calendarEventModal') {
        eventModal.classList.remove('show');
      }
    });
  }
  if (submitEventBtn) {
    submitEventBtn.addEventListener('click', submitCalendarEvent);
  }

  // 会议开关
  const meetingToggle = document.getElementById('calendarEventMeetingEnabled');
  const meetingSection = document.getElementById('calendarMeetingSection');
  if (meetingToggle && meetingSection) {
    meetingToggle.addEventListener('change', (e) => {
      calendarFormState.meetingEnabled = e.target.checked;
      meetingSection.style.display = e.target.checked ? '' : 'none';
    });
  }
  const meetingTypeSelect = document.getElementById('calendarMeetingType');
  if (meetingTypeSelect) {
    meetingTypeSelect.addEventListener('change', (e) => {
      calendarFormState.meetingType = e.target.value;
    });
  }

  // 参与者搜索
  const participantSearch = document.getElementById('calendarEventParticipantSearch');
  if (participantSearch) {
    participantSearch.addEventListener('input', (e) => {
      clearTimeout(calendarFormState.participantSearchTimer);
      const keyword = e.target.value.trim();
      calendarFormState.participantSearchTimer = setTimeout(() => {
        searchUsersForCalendarForm(keyword);
      }, 300);
    });
  }

  // 参与者搜索结果点击
  const participantResults = document.getElementById('calendarEventParticipantSearchResults');
  if (participantResults) {
    participantResults.addEventListener('click', (e) => {
      const item = e.target.closest('.calendar-participant-pick-item');
      if (!item) return;
      const userId = item.getAttribute('data-user-id');
      const username = item.getAttribute('data-username');
      const dept = item.getAttribute('data-dept');
      const existingIdx = calendarFormState.participants.findIndex((u) => u.id === userId);
      if (existingIdx >= 0) {
        calendarFormState.participants.splice(existingIdx, 1);
      } else {
        calendarFormState.participants.push({ id: userId, username, departmentName: dept });
      }
      renderFormSelectedParticipants();
      // 重新渲染搜索结果
      searchUsersForCalendarForm(document.getElementById('calendarEventParticipantSearch').value.trim());
    });
  }

  // 已选参与者移除
  const formSelected = document.getElementById('calendarFormSelectedParticipants');
  if (formSelected) {
    formSelected.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.calendar-participant-remove');
      if (!removeBtn) return;
      const userId = removeBtn.getAttribute('data-user-id');
      const idx = calendarFormState.participants.findIndex((u) => u.id === userId);
      if (idx >= 0) calendarFormState.participants.splice(idx, 1);
      renderFormSelectedParticipants();
      const keyword = document.getElementById('calendarEventParticipantSearch').value.trim();
      if (keyword) searchUsersForCalendarForm(keyword);
    });
  }

  // ---- 添加参与者弹窗 ----
  const addParticipantModal = document.getElementById('calendarAddParticipantModal');
  const addParticipantClose = document.getElementById('calendarAddParticipantClose');
  const addParticipantSearch = document.getElementById('calendarAddParticipantSearchInput');
  const addParticipantResults = document.getElementById('calendarAddParticipantSearchResults');

  if (addParticipantClose) {
    addParticipantClose.addEventListener('click', () => {
      addParticipantModal.classList.remove('show');
    });
  }
  if (addParticipantModal) {
    addParticipantModal.addEventListener('click', (e) => {
      if (e.target.id === 'calendarAddParticipantModal') {
        addParticipantModal.classList.remove('show');
      }
    });
  }
  if (addParticipantSearch) {
    addParticipantSearch.addEventListener('input', (e) => {
      clearTimeout(calendarParticipantSearchTimer);
      const keyword = e.target.value.trim();
      calendarParticipantSearchTimer = setTimeout(() => {
        searchUsersForAddParticipant(keyword);
      }, 300);
    });
  }
  if (addParticipantResults) {
    addParticipantResults.addEventListener('click', async (e) => {
      const addBtn = e.target.closest('[data-add-btn="true"]');
      if (!addBtn) return;
      const item = addBtn.closest('.calendar-participant-pick-item');
      if (!item) return;
      const userId = item.getAttribute('data-user-id');
      const username = item.getAttribute('data-username');
      addBtn.disabled = true;
      addBtn.textContent = '添加中...';
      try {
        await handleAddParticipantClick(userId, username);
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = '添加';
      }
    });
  }
}

// ========== 暴露给全局供 tab 切换调用 ==========

window.CalendarModule = {
  init: initCalendar,
  refresh: loadCalendarEvents,
};