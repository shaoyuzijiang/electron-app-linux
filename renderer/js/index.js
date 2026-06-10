// SDK 加载状态管理
const sdkLoadingEl = document.getElementById('sdkLoading');
const leftPanelEl = document.getElementById('leftPanel');
const rightContentEl = document.getElementById('rightContent');

function showMeetingContent() {
  sdkLoadingEl.style.display = 'none';
  leftPanelEl.style.display = '';
  rightContentEl.style.display = '';
}

function showSdkError(msg) {
  sdkLoadingEl.innerHTML = `
    <div class="loading-error">${msg}</div>
    <button class="retry-btn" id="retrySdkBtn">重试</button>
  `;
  document.getElementById('retrySdkBtn').addEventListener('click', retrySdkLogin);
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

// 模拟会议数据
const mockMeetings = [
  {
    date: '今天',
    items: [
      { title: '交付作业平台 - 腾讯会议方案沟通', time: '17:30-18:30', code: '394 928 762', tag: '' }
    ]
  },
  {
    date: '明天 6月10日',
    items: [
      { title: '新功能培训会', time: '19:00-21:00', code: '733 9552 1893', tag: '周期' }
    ]
  },
  {
    date: '周四 6月11日',
    items: [
      { title: '【客】浦发银行腾会项目群周会', time: '14:00-15:00', code: '406 3626 2174', tag: '周期' }
    ]
  },
  {
    date: '周五 6月12日',
    items: [
      { title: '腾讯会议渠道经理培训会', time: '09:00-11:00', code: '892 1034 5671', tag: '' }
    ]
  }
];

function renderMeetings() {
  const container = document.getElementById('meetingList');
  container.innerHTML = mockMeetings.map(group => `
    <div class="date-group">
      <div class="date-label">${group.date}</div>
      ${group.items.map(m => `
        <div class="meeting-item">
          <div class="meeting-title">${m.title}</div>
          <div class="meeting-meta">
            <span>${m.time}</span>
            <span class="dot"></span>
            <span>${m.code}</span>
            ${m.tag ? `<span class="meeting-tag">· ${m.tag}</span>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}
renderMeetings();

// ========== 按钮事件 ==========

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
  const info = data.meeting_info || {};
  const startDisplay = info.start_time ? new Date(Number(info.start_time) * 1000).toLocaleString('zh-CN') : '-';
  const endDisplay = info.end_time ? new Date(Number(info.end_time) * 1000).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '-';

  scheduleFormContainer.style.display = 'none';
  scheduleResultContainer.style.display = '';
  scheduleResultContainer.innerHTML = `
    <div class="meeting-result">
      <div class="result-icon">
        <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      </div>
      <div class="result-title">会议预定成功</div>
      <div class="result-info">
        <div class="info-row">
          <span class="info-label">会议主题</span>
          <span class="info-value">${info.subject || '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">会议号</span>
          <span class="info-value copyable" data-copy="${info.meeting_code || ''}">${info.meeting_code || info.meeting_id || '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">会议密码</span>
          <span class="info-value">${info.password || '无'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">开始时间</span>
          <span class="info-value">${startDisplay}</span>
        </div>
        <div class="info-row">
          <span class="info-label">结束时间</span>
          <span class="info-value">${endDisplay}</span>
        </div>
        <div class="info-row">
          <span class="info-label">入会链接</span>
          <span class="info-value copyable" data-copy="${info.join_url || ''}" style="word-break:break-all;max-width:260px;">${info.join_url || '-'}</span>
        </div>
      </div>
    </div>
    <div class="modal-actions" style="justify-content:center;">
      <button class="btn-submit" id="closeScheduleResult">确定</button>
    </div>
  `;

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

  document.getElementById('closeScheduleResult').addEventListener('click', () => {
    scheduleModal.classList.remove('show');
  });
}

// ========== 初始化 ==========
loadProfile();
checkSdkStatus();
