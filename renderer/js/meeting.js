// SDK 加载状态管理
const sdkLoadingEl = document.getElementById('sdkLoading');
const leftPanelEl = document.getElementById('leftPanel');
const rightContentEl = document.getElementById('rightContent');

function showMeetingContent() {
  sdkLoadingEl.style.display = 'none';
  // 仅在当前是会议页签时才显示会议面板，避免影响通讯录页面
  if (currentTab === 'meeting') {
    leftPanelEl.style.display = '';
    rightContentEl.style.display = '';
  }
}

function showSdkError(msg) {
  // 仅在会议页签下显示 SDK 错误覆盖层，避免遮盖通讯录页面
  if (currentTab === 'meeting') {
    leftPanelEl.style.display = 'none';
    rightContentEl.style.display = 'none';
    sdkLoadingEl.style.display = '';
    sdkLoadingEl.innerHTML = `
      <div class="loading-error">${msg}</div>
      <button class="retry-btn" id="retrySdkBtn">重试</button>
    `;
    document.getElementById('retrySdkBtn').addEventListener('click', retrySdkLogin);
  }
}

async function retrySdkLogin() {
  sdkLoadingEl.innerHTML = `
    <div class="spinner"></div>
    <div class="loading-text">会议功能加载中...</div>
  `;
  try {
    const idTokenResult = await window.electronAPI.fetchIdToken();
    if (idTokenResult.error) {
      showSdkError('会议功能加载失败，请重试');
      return;
    }
    const result = await window.electronAPI.waitSdkLogin();
    if (result.success) {
      showMeetingContent();
    } else {
      showSdkError(result.message || '会议功能加载失败，请重试');
    }
  } catch (err) {
    showSdkError('会议功能加载失败，请重试');
  }
}

async function checkSdkStatus() {
  try {
    const status = await window.electronAPI.getSdkStatus();
    if (status.loggedIn) {
      showMeetingContent();
      return;
    }
    const result = await window.electronAPI.waitSdkLogin();
    if (result.success) {
      showMeetingContent();
    } else {
      showSdkError(result.message || '会议功能加载失败，请重试');
    }
  } catch (err) {
    showSdkError('会议功能加载失败，请重试');
  }
}

// 用户信息
async function loadProfile() {
  try {
    const result = await window.electronAPI.getProfile();
    if (result.success) {
      const { username } = result.profile;
      document.getElementById('userAvatarNav').textContent = username.charAt(0).toUpperCase();
    }
  } catch (err) {
    console.error('获取用户信息失败:', err);
  }
}

// 会议列表数据
let meetingListData = [];
let meetingListNextPos = 0;
let meetingListNextCursory = 0;
let meetingListRemaining = 0;
let meetingListLoading = false;

async function loadMeetingList(loadMore = false) {
  if (meetingListLoading) return;
  meetingListLoading = true;
  const container = document.getElementById('meetingList');

  if (!loadMore) {
    meetingListData = [];
    meetingListNextPos = 0;
    meetingListNextCursory = 0;
    container.innerHTML = `<div class="meeting-loading"><div class="spinner-small"></div><span>加载中...</span></div>`;
  } else {
    const loader = document.getElementById('meetingLoader');
    if (loader) loader.innerHTML = `<div class="spinner-small"></div><span>加载更多...</span>`;
  }

  try {
    const options = { is_show_all_sub_meetings: '1' };
    if (loadMore && meetingListNextPos) {
      options.pos = meetingListNextPos;
      options.cursory = meetingListNextCursory;
    }
    const result = await window.electronAPI.getMeetingList(options);
    if (result.success && result.data) {
      const list = result.data.meeting_info_list || [];
      meetingListRemaining = result.data.remaining || 0;
      meetingListNextPos = result.data.next_pos || 0;
      meetingListNextCursory = result.data.next_cursory || 0;
      meetingListData = loadMore ? [...meetingListData, ...list] : list;
      renderMeetings(meetingListData);
    } else {
      if (!loadMore) {
        container.innerHTML = `<div class="meeting-empty">${result.message || '获取会议列表失败'}</div>`;
      }
    }
  } catch (err) {
    console.error('获取会议列表失败:', err);
    if (!loadMore) {
      container.innerHTML = `<div class="meeting-empty">获取会议列表失败，请稍后重试</div>`;
    }
  } finally {
    meetingListLoading = false;
  }
}

function formatMeetingTime(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getDateLabel(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const meetingDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((meetingDate - today) / (1000 * 60 * 60 * 24));

  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '明天';
  if (diffDays === 2) return '后天';
  if (diffDays < 7 && diffDays > 0) return `${weekDays[date.getDay()]} ${month}月${day}日`;
  return `${month}月${day}日`;
}

function groupMeetingsByDate(meetings) {
  const groups = {};
  meetings.forEach((m) => {
    const startTime = m.start_time || m.meeting_start_time;
    if (!startTime) return;
    const dateKey = getDateLabel(startTime);
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(m);
  });

  // 按日期排序
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const getSortDate = (label) => {
      // 简单排序：今天 < 明天 < 其他
      if (label === '今天') return 0;
      if (label === '明天') return 1;
      if (label === '后天') return 2;
      return 3;
    };
    return getSortDate(a) - getSortDate(b);
  });

  return sortedKeys.map((key) => ({ date: key, items: groups[key] }));
}

function renderMeetings(meetings) {
  const container = document.getElementById('meetingList');

  if (!meetings || meetings.length === 0) {
    container.innerHTML = `<div class="meeting-empty">
      <svg viewBox="0 0 24 24" width="48" height="48"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="#ddd"/></svg>
      <div>暂无待参加的会议</div>
    </div>`;
    return;
  }

  const grouped = groupMeetingsByDate(meetings);
  container.innerHTML = grouped.map((group) => `
    <div class="date-group">
      <div class="date-label">${group.date}</div>
      ${group.items.map((m) => {
        const subject = m.subject || '未命名会议';
        const startTime = formatMeetingTime(m.start_time || m.meeting_start_time);
        const endTime = formatMeetingTime(m.end_time || m.meeting_end_time);
        const meetingCode = m.meeting_code || m.meeting_id || '-';
        const meetingId = m.meeting_id || '';
        const joinRole = m.join_meeting_role || '';
        const isCreator = joinRole === 'creator';
        const status = m.status || '';
        const isRecurring = m.meeting_type === 1;
        const statusLabel = status === 'MEETING_STATE_STARTED' ? '进行中' : '';
        return `
          <div class="meeting-item" data-meeting-id="${meetingId}" data-meeting-code="${meetingCode}" data-join-role="${joinRole}">
            <div class="meeting-title">${subject}</div>
            <div class="meeting-meta">
              <span>${startTime}-${endTime}</span>
              <span class="dot"></span>
              <span class="meeting-code-copy" data-code="${meetingCode}" title="点击复制会议号">${meetingCode}</span>
              ${isRecurring ? '<span class="meeting-tag">· 周期</span>' : ''}
              ${statusLabel ? `<span class="meeting-tag meeting-status-active">· ${statusLabel}</span>` : ''}
              ${isCreator ? `<button class="meeting-edit-btn" data-id="${meetingId}" data-subject="${subject}" data-start="${m.start_time || m.meeting_start_time || ''}" data-end="${m.end_time || m.meeting_end_time || ''}" data-password="${m.password || ''}">修改</button><button class="meeting-cancel-btn" data-id="${meetingId}" data-subject="${subject}">取消</button>` : ''}
              <button class="meeting-join-btn" data-code="${meetingCode}">入会</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `).join('');
}

// 会议号点击复制（事件委托）
document.getElementById('meetingList').addEventListener('click', (e) => {
  const codeEl = e.target.closest('.meeting-code-copy');
  if (!codeEl) return;
  const code = codeEl.getAttribute('data-code');
  if (!code || code === '-') return;
  navigator.clipboard.writeText(code).then(() => {
    const original = codeEl.textContent;
    codeEl.textContent = '已复制';
    codeEl.classList.add('copied');
    setTimeout(() => {
      codeEl.textContent = original;
      codeEl.classList.remove('copied');
    }, 1200);
  });
});

// 入会按钮点击（事件委托）
document.getElementById('meetingList').addEventListener('click', async (e) => {
  const joinBtn = e.target.closest('.meeting-join-btn');
  if (!joinBtn) return;
  const meetingCode = joinBtn.getAttribute('data-code');
  if (!meetingCode || meetingCode === '-') return;

  joinBtn.disabled = true;
  joinBtn.textContent = '加入中...';
  try {
    const result = await window.electronAPI.joinMeeting(meetingCode, '', '');
    if (!result.success) {
      alert(result.message || '入会失败');
    }
  } catch (err) {
    alert('入会失败: ' + err.message);
  } finally {
    joinBtn.disabled = false;
    joinBtn.textContent = '入会';
  }
});

// 修改按钮点击（事件委托）
let currentEditMeetingId = null;
document.getElementById('meetingList').addEventListener('click', (e) => {
  const editBtn = e.target.closest('.meeting-edit-btn');
  if (!editBtn) return;
  e.stopPropagation();

  currentEditMeetingId = editBtn.getAttribute('data-id');
  const subject = editBtn.getAttribute('data-subject') || '';
  const startTs = editBtn.getAttribute('data-start') || '';
  const endTs = editBtn.getAttribute('data-end') || '';
  const password = editBtn.getAttribute('data-password') || '';

  // 将秒级时间戳转换为 datetime-local 格式
  const tsToLocal = (ts) => {
    if (!ts) return '';
    const d = new Date(Number(ts) * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  document.getElementById('editMeetingSubject').value = subject;
  document.getElementById('editMeetingStartTime').value = tsToLocal(startTs);
  document.getElementById('editMeetingEndTime').value = tsToLocal(endTs);
  document.getElementById('editMeetingPassword').value = password;
  document.getElementById('editMeetingError').textContent = '';

  document.getElementById('editMeetingModal').classList.add('show');
});

// 取消按钮点击（事件委托）
document.getElementById('meetingList').addEventListener('click', async (e) => {
  const cancelBtn = e.target.closest('.meeting-cancel-btn');
  if (!cancelBtn) return;
  e.stopPropagation();

  const meetingId = cancelBtn.getAttribute('data-id');
  const subject = cancelBtn.getAttribute('data-subject') || '该会议';

  if (!confirm(`确定要取消「${subject}」吗？取消后不可恢复。`)) return;

  cancelBtn.disabled = true;
  cancelBtn.textContent = '取消中...';
  try {
    const result = await window.electronAPI.cancelMeeting(meetingId);
    if (result.success) {
      loadMeetingList();
    } else {
      alert(result.message || '取消会议失败');
    }
  } catch (err) {
    alert('取消会议失败: ' + err.message);
  } finally {
    cancelBtn.disabled = false;
    cancelBtn.textContent = '取消';
  }
});

// ========== 按钮事件 ==========

document.getElementById('refreshMeetings').addEventListener('click', () => {
  loadMeetingList();
});

document.getElementById('btnJoin').addEventListener('click', async () => {
  try {
    const result = await window.electronAPI.showJoinMeetingView();
    if (!result.success) alert(result.message || '无法打开加入会议界面');
  } catch (err) {
    alert('操作失败: ' + err.message);
  }
});

document.getElementById('btnQuick').addEventListener('click', async () => {
  try {
    const result = await window.electronAPI.quickMeeting();
    if (!result.success) alert(result.message || '无法发起快速会议');
  } catch (err) {
    alert('操作失败: ' + err.message);
  }
});

document.getElementById('btnSchedule').addEventListener('click', async () => {
  const scheduleModal = document.getElementById('scheduleMeetingModal');
  const formContainer = document.getElementById('scheduleFormContainer');
  const resultContainer = document.getElementById('scheduleResultContainer');
  formContainer.style.display = '';
  resultContainer.style.display = 'none';
  document.getElementById('scheduleMeetingError').textContent = '';

  const now = new Date();
  const startDefault = new Date(now.getTime() + 60 * 60 * 1000);
  const endDefault = new Date(startDefault.getTime() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const toLocalISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  document.getElementById('meetingSubject').value = '';
  document.getElementById('meetingStartTime').value = toLocalISO(startDefault);
  document.getElementById('meetingEndTime').value = toLocalISO(endDefault);
  document.getElementById('meetingPassword').value = '';
  document.getElementById('meetingMuteBeforeJoin').value = '2';

  scheduleModal.classList.add('show');
});

document.getElementById('btnScreen').addEventListener('click', async () => {
  try {
    const result = await window.electronAPI.showScreenCastView();
    if (!result.success) alert(result.message || '无法打开共享屏幕界面');
  } catch (err) {
    alert('操作失败: ' + err.message);
  }
});

// ========== 头像菜单 ==========

const userAvatar = document.getElementById('userAvatarNav');
const avatarMenu = document.getElementById('avatarMenu');

function toggleMenu(e) {
  e.stopPropagation();
  const rect = userAvatar.getBoundingClientRect();
  avatarMenu.style.left = rect.left + 'px';
  avatarMenu.style.top = (rect.bottom + 4) + 'px';
  avatarMenu.classList.toggle('show');
}

userAvatar.addEventListener('click', toggleMenu);

document.addEventListener('click', () => {
  avatarMenu.classList.remove('show');
});

avatarMenu.addEventListener('click', (e) => {
  e.stopPropagation();
});

document.getElementById('logoutMenu').addEventListener('click', async () => {
  avatarMenu.classList.remove('show');
  await window.electronAPI.logout();
});

document.getElementById('uploadLogsMenu').addEventListener('click', async () => {
  avatarMenu.classList.remove('show');
  try {
    const result = await window.electronAPI.showUploadLogsView();
    if (!result.success) alert(result.message || '无法打开上传日志界面');
  } catch (err) {
    alert('操作失败: ' + err.message);
  }
});

// ========== 修改密码弹窗 ==========

const modal = document.getElementById('changePasswordModal');
const oldPwdInput = document.getElementById('oldPassword');
const newPwdInput = document.getElementById('newPassword');
const confirmPwdInput = document.getElementById('confirmPassword');
const modalError = document.getElementById('changePasswordError');
const modalSuccess = document.getElementById('changePasswordSuccess');
const submitBtn = document.getElementById('submitChangePassword');

document.getElementById('changePasswordMenu').addEventListener('click', () => {
  avatarMenu.classList.remove('show');
  oldPwdInput.value = '';
  newPwdInput.value = '';
  confirmPwdInput.value = '';
  modalError.textContent = '';
  modalSuccess.textContent = '';
  modal.classList.add('show');
});

document.getElementById('cancelChangePassword').addEventListener('click', () => {
  modal.classList.remove('show');
});

modal.addEventListener('click', (e) => {
  if (e.target === modal) {
    modal.classList.remove('show');
  }
});

submitBtn.addEventListener('click', async () => {
  const oldPassword = oldPwdInput.value;
  const newPassword = newPwdInput.value;
  const confirmPassword = confirmPwdInput.value;

  modalError.textContent = '';
  modalSuccess.textContent = '';

  if (!oldPassword || !newPassword || !confirmPassword) {
    modalError.textContent = '请填写所有字段';
    return;
  }
  if (newPassword !== confirmPassword) {
    modalError.textContent = '两次输入的新密码不一致';
    return;
  }
  if (newPassword.length < 8) {
    modalError.textContent = '新密码需至少 8 位';
    return;
  }
  if (!/[A-Z]/.test(newPassword)) {
    modalError.textContent = '新密码需包含至少一个大写字母';
    return;
  }
  if (!/[a-z]/.test(newPassword)) {
    modalError.textContent = '新密码需包含至少一个小写字母';
    return;
  }
  if (!/[0-9]/.test(newPassword)) {
    modalError.textContent = '新密码需包含至少一个数字';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '修改中...';

  try {
    const result = await window.electronAPI.changePassword(oldPassword, newPassword);
    if (result.success) {
      modalSuccess.textContent = '密码修改成功';
      setTimeout(() => {
        modal.classList.remove('show');
        modalSuccess.textContent = '';
      }, 1500);
    } else {
      modalError.textContent = result.message || '修改失败';
    }
  } catch (err) {
    modalError.textContent = '网络错误，请稍后重试';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '确认修改';
  }
});

// ========== 预定会议弹窗 ==========

const scheduleModal = document.getElementById('scheduleMeetingModal');
const scheduleFormContainer = document.getElementById('scheduleFormContainer');
const scheduleResultContainer = document.getElementById('scheduleResultContainer');
const scheduleError = document.getElementById('scheduleMeetingError');

document.getElementById('cancelScheduleMeeting').addEventListener('click', () => {
  scheduleModal.classList.remove('show');
});

scheduleModal.addEventListener('click', (e) => {
  if (e.target === scheduleModal) {
    scheduleModal.classList.remove('show');
  }
});

/**
 * 将 datetime-local 输入值转换为秒级时间戳字符串
 */
function toUnixTimestamp(datetimeLocalValue) {
  return String(Math.floor(new Date(datetimeLocalValue).getTime() / 1000));
}

document.getElementById('submitScheduleMeeting').addEventListener('click', async () => {
  const subject = document.getElementById('meetingSubject').value.trim();
  const startTimeRaw = document.getElementById('meetingStartTime').value;
  const endTimeRaw = document.getElementById('meetingEndTime').value;
  const password = document.getElementById('meetingPassword').value.trim();
  const muteEnableType = parseInt(document.getElementById('meetingMuteBeforeJoin').value, 10);

  scheduleError.textContent = '';

  if (!subject) {
    scheduleError.textContent = '请输入会议主题';
    return;
  }
  if (!startTimeRaw) {
    scheduleError.textContent = '请选择开始时间';
    return;
  }
  if (!endTimeRaw) {
    scheduleError.textContent = '请选择结束时间';
    return;
  }
  if (new Date(startTimeRaw) >= new Date(endTimeRaw)) {
    scheduleError.textContent = '结束时间必须晚于开始时间';
    return;
  }
  if (password && !/^\d{4,6}$/.test(password)) {
    scheduleError.textContent = '会议密码需为 4-6 位数字';
    return;
  }

  const meetingData = {
    subject,
    type: 0,
    start_time: toUnixTimestamp(startTimeRaw),
    end_time: toUnixTimestamp(endTimeRaw),
    instanceid: 1,
    settings: {
      mute_enable_type_join: muteEnableType,
    },
  };
  if (password) {
    meetingData.password = password;
  }

  const scheduleSubmitBtn = document.getElementById('submitScheduleMeeting');
  scheduleSubmitBtn.disabled = true;
  scheduleSubmitBtn.textContent = '创建中...';

  try {
    const result = await window.electronAPI.createMeeting(meetingData);
    if (result.success) {
      showScheduleResult(result.data);
      loadMeetingList();
    } else {
      scheduleError.textContent = result.message || '创建会议失败';
    }
  } catch (err) {
    scheduleError.textContent = '网络错误，请稍后重试';
  } finally {
    scheduleSubmitBtn.disabled = false;
    scheduleSubmitBtn.textContent = '预定会议';
  }
});

function showScheduleResult(data) {
  // 创建会议接口返回格式：{ meeting_info_list: [{...}] }
  let info;
  if (data && Array.isArray(data.meeting_info_list) && data.meeting_info_list.length > 0) {
    info = data.meeting_info_list[0];
  } else if (data && data.meeting_info) {
    info = data.meeting_info;
  } else if (data && (data.subject || data.meeting_id || data.meeting_code)) {
    info = data;
  } else {
    info = {};
  }

  const startDisplay = info.start_time ? new Date(Number(info.start_time) * 1000).toLocaleString('zh-CN') : '-';
  const endDisplay = info.end_time ? new Date(Number(info.end_time) * 1000).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '-';
  const meetingCode = info.meeting_code || info.meeting_id || '-';
  const meetingPassword = info.password || '无';

  scheduleFormContainer.style.display = 'none';
  scheduleResultContainer.style.display = '';
  scheduleResultContainer.innerHTML = `
    <div class="meeting-result">
      <div class="result-icon">
        <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      </div>
      <div class="result-title">会议预定成功</div>
      <!-- 会议号高亮卡片 -->
      <div class="meeting-code-card">
        <div>
          <div class="code-label" style="text-align:left;">会议号</div>
          <div class="code-value" id="resultMeetingCode" title="点击复制">${meetingCode}</div>
        </div>
        <span class="code-copy-hint" id="copyCodeHint">复制</span>
      </div>
      <!-- 详细信息 -->
      <div class="result-info">
        <div class="info-row">
          <span class="info-label">会议主题</span>
          <span class="info-value">${info.subject || '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">会议密码</span>
          <span class="info-value">${meetingPassword}</span>
        </div>
        <div class="info-row">
          <span class="info-label">会议时间</span>
          <span class="info-value time-range-row">${startDisplay} <span class="time-separator">—</span> ${endDisplay}</span>
        </div>
        <div class="info-row">
          <span class="info-label">入会链接</span>
          <span class="info-value copyable" data-copy="${info.join_url || ''}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">${info.join_url || '-'}</span>
        </div>
      </div>
    </div>
    <div class="modal-actions" style="justify-content:center;gap:10px;">
      <button class="btn-copy-all" id="copyAllInfoBtn">
        <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        复制会议信息
      </button>
      <button class="btn-submit" id="closeScheduleResult">确定</button>
    </div>
  `;

  // 复制会议号
  const codeEl = document.getElementById('resultMeetingCode');
  const codeHintEl = document.getElementById('copyCodeHint');
  if (codeEl && meetingCode !== '-') {
    codeEl.addEventListener('click', () => {
      navigator.clipboard.writeText(meetingCode);
      codeHintEl.textContent = '已复制';
      setTimeout(() => { codeHintEl.textContent = '复制'; }, 1500);
    });
    codeHintEl.addEventListener('click', () => {
      navigator.clipboard.writeText(meetingCode);
      codeHintEl.textContent = '已复制';
      setTimeout(() => { codeHintEl.textContent = '复制'; }, 1500);
    });
  }

  // 复制单个可点击字段
  scheduleResultContainer.querySelectorAll('.copyable').forEach((el) => {
    el.addEventListener('click', () => {
      const text = el.getAttribute('data-copy');
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const original = el.textContent;
          el.textContent = '已复制';
          setTimeout(() => { el.textContent = original; }, 1200);
        });
      }
    });
  });

  // 复制全部会议信息
  const copyAllBtn = document.getElementById('copyAllInfoBtn');
  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', () => {
      const text =
`会议主题：${info.subject || '-'}
会议号：${meetingCode}
会议密码：${meetingPassword === '无' ? '无' : meetingPassword}
开始时间：${startDisplay}
结束时间：${endDisplay}
入会链接：${info.join_url || '-'}`;
      navigator.clipboard.writeText(text).then(() => {
        copyAllBtn.classList.add('copied');
        const originalHtml = copyAllBtn.innerHTML;
        copyAllBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> 已复制';
        setTimeout(() => {
          copyAllBtn.classList.remove('copied');
          copyAllBtn.innerHTML = originalHtml;
        }, 1800);
      });
    });
  }

  document.getElementById('closeScheduleResult').addEventListener('click', () => {
    scheduleModal.classList.remove('show');
  });
}

// ========== 修改会议弹窗 ==========

const editModal = document.getElementById('editMeetingModal');

document.getElementById('cancelEditMeeting').addEventListener('click', () => {
  editModal.classList.remove('show');
});

editModal.addEventListener('click', (e) => {
  if (e.target === editModal) {
    editModal.classList.remove('show');
  }
});

document.getElementById('submitEditMeeting').addEventListener('click', async () => {
  const subject = document.getElementById('editMeetingSubject').value.trim();
  const startTimeRaw = document.getElementById('editMeetingStartTime').value;
  const endTimeRaw = document.getElementById('editMeetingEndTime').value;
  const password = document.getElementById('editMeetingPassword').value.trim();
  const muteEnableType = parseInt(document.getElementById('editMeetingMuteBeforeJoin').value, 10);
  const errorEl = document.getElementById('editMeetingError');

  errorEl.textContent = '';

  if (!subject) {
    errorEl.textContent = '请输入会议主题';
    return;
  }
  if (!startTimeRaw) {
    errorEl.textContent = '请选择开始时间';
    return;
  }
  if (!endTimeRaw) {
    errorEl.textContent = '请选择结束时间';
    return;
  }
  if (new Date(startTimeRaw) >= new Date(endTimeRaw)) {
    errorEl.textContent = '结束时间必须晚于开始时间';
    return;
  }
  if (password && !/^\d{4,6}$/.test(password)) {
    errorEl.textContent = '会议密码需为 4-6 位数字';
    return;
  }

  const updates = {
    subject,
    start_time: toUnixTimestamp(startTimeRaw),
    end_time: toUnixTimestamp(endTimeRaw),
    settings: {
      mute_enable_type_join: muteEnableType,
    },
  };
  if (password) {
    updates.password = password;
  }

  const submitBtn = document.getElementById('submitEditMeeting');
  submitBtn.disabled = true;
  submitBtn.textContent = '保存中...';

  try {
    const result = await window.electronAPI.updateMeeting(currentEditMeetingId, updates);
    if (result.success) {
      editModal.classList.remove('show');
      loadMeetingList();
    } else {
      errorEl.textContent = result.message || '修改会议失败';
    }
  } catch (err) {
    errorEl.textContent = '网络错误，请稍后重试';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '保存修改';
  }
});

// ========== 监听主进程推送的会议列表更新 ==========
window.electronAPI.onMeetingListUpdate((result) => {
  if (result.success && result.data) {
    const list = result.data.meeting_info_list || [];
    meetingListRemaining = result.data.remaining || 0;
    meetingListNextPos = result.data.next_pos || 0;
    meetingListNextCursory = result.data.next_cursory || 0;
    meetingListData = list;
    renderMeetings(meetingListData);
  }
});

// ========== 页签切换 ==========

let currentTab = 'im';
const navItems = document.querySelectorAll('.nav-item[data-tab]');
const meetingContentEls = () => [leftPanelEl, rightContentEl];
const contactsPageEl = document.getElementById('contactsPage');
const imPageEl = document.getElementById('imPage');
const calendarPageEl = document.getElementById('calendarPage');

function switchTab(tab) {
  if (tab === currentTab) return;
  currentTab = tab;

  navItems.forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-tab') === tab);
  });

  // 隐藏所有页面
  meetingContentEls().forEach((el) => { el.style.display = 'none'; });
  sdkLoadingEl.style.display = 'none';
  contactsPageEl.style.display = 'none';
  if (imPageEl) imPageEl.style.display = 'none';
  if (calendarPageEl) calendarPageEl.style.display = 'none';

  if (tab === 'meeting') {
    meetingContentEls().forEach((el) => { el.style.display = ''; });
  } else if (tab === 'contacts') {
    contactsPageEl.style.display = '';
    initContacts();
  } else if (tab === 'im') {
    if (imPageEl) imPageEl.style.display = '';
    if (window.IMModule) window.IMModule.init();
  } else if (tab === 'calendar') {
    if (calendarPageEl) calendarPageEl.style.display = '';
    if (window.CalendarModule) window.CalendarModule.init();
  }
}

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    const tab = item.getAttribute('data-tab');
    switchTab(tab);
  });
});

// ========== 初始化 ==========
loadProfile();
loadMeetingList();

// 默认显示 IM 页签
meetingContentEls().forEach((el) => { el.style.display = 'none'; });
sdkLoadingEl.style.display = 'none';
contactsPageEl.style.display = 'none';
if (imPageEl) imPageEl.style.display = '';
if (calendarPageEl) calendarPageEl.style.display = 'none';
if (window.IMModule) window.IMModule.init();

checkSdkStatus();
