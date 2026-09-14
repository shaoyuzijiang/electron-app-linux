'use strict';

const api = window.meetingDemo;
let snapshot;

const stateDescription = {
  UNLOADED: 'SDK 尚未准备运行环境。',
  RUNTIME_READY: '运行环境已准备，等待加载 SDK。',
  LOADED: 'Mock SDK 已加载，可以初始化。',
  INITIALIZING: '正在等待初始化回调。',
  INITIALIZED: 'SDK 初始化完成，可以登录。',
  LOGGING_IN: '正在等待登录回调。',
  LOGGED_IN: 'SDK 已登录，可以使用会议能力。',
  LOGGING_OUT: '正在等待登出回调。',
  UNINITIALIZING: '正在等待反初始化回调。',
  RELEASED: 'SDK 已释放。',
  ERROR: '当前模式不可用或最近一次操作失败，请查看回调日志。'
};

function $(id) { return document.getElementById(id); }

function selectView(viewId) {
  const selectedView = $(viewId);
  if (!selectedView) return;
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view === selectedView));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === viewId));
  $('viewTitle').textContent = selectedView.dataset.title;
  $('viewKicker').textContent = selectedView.dataset.kicker;
  document.querySelector('.workspace').scrollTo({ top: 0, behavior: 'smooth' });
}

function render(nextSnapshot) {
  snapshot = nextSnapshot;
  $('stateBadge').textContent = snapshot.state;
  $('stateBadge').dataset.state = snapshot.state;
  $('sdkState').textContent = snapshot.state;
  $('heroState').textContent = snapshot.state;
  $('meetingState').textContent = snapshot.inMeeting ? '会议中' : '未入会';
  $('modeState').textContent = snapshot.mockEnabled ? 'Mock' : '真实 SDK';
  $('meetingCardTitle').textContent = snapshot.inMeeting ? '正在会议中' : '尚未入会';
  $('meetingCardDescription').textContent = snapshot.inMeeting ? 'Mock 会议已建立，可以执行离会操作。' : '加入会议后，可在此执行离会操作。';
  $('stateDescription').textContent = stateDescription[snapshot.state] || '未知状态。';
  $('mockNotice').hidden = !snapshot.mockEnabled;
  renderCapabilities(snapshot.capabilities);
  renderCallbacks(snapshot.callbacks);
  renderDiagnostics(snapshot.diagnostics);
  updateActions();
}

function updateActions() {
  const enabled = snapshot.mockEnabled;
  $('initializeButton').disabled = !enabled || snapshot.state !== 'LOADED';
  $('loginButton').disabled = !enabled || snapshot.state !== 'INITIALIZED';
  $('joinButton').disabled = !enabled || snapshot.state !== 'LOGGED_IN' || snapshot.inMeeting || !snapshot.capabilities.joinMeeting;
  $('leaveButton').disabled = !enabled || snapshot.state !== 'LOGGED_IN' || !snapshot.inMeeting || !snapshot.capabilities.leaveMeeting;
  $('logoutButton').disabled = !enabled || snapshot.state !== 'LOGGED_IN';
  $('uninitializeButton').disabled = !enabled || !['INITIALIZED', 'LOGGED_IN'].includes(snapshot.state);
}

function renderCapabilities(capabilities) {
  const labels = { meetingSettings: '会议设置', captions: '字幕能力', joinMeeting: '加入会议', leaveMeeting: '离开会议' };
  const supported = Object.entries(labels).filter(([name]) => capabilities[name]);
  if (supported.length === 0) {
    $('controlCapabilities').replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: '当前运行时未导出可展示的会中控制能力。' }));
    return;
  }
  $('controlCapabilities').replaceChildren(...supported.map(([, label]) => {
    const item = document.createElement('div');
    item.className = 'capability';
    const title = document.createElement('strong');
    title.textContent = label;
    const value = document.createElement('span');
    value.textContent = 'Linux 3.26 支持';
    item.append(title, value);
    return item;
  }));
}

function renderCallbacks(callbacks) {
  $('callbackCount').textContent = String(callbacks.length);
  if (callbacks.length === 0) {
    $('callbackLog').replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: '暂无回调。' }));
    return;
  }
  $('callbackLog').replaceChildren(...callbacks.map((callback) => {
    const item = document.createElement('article');
    item.className = 'callback-entry';
    const time = document.createElement('time');
    time.textContent = callback.time;
    const content = document.createElement('pre');
    content.textContent = JSON.stringify(callback, null, 2);
    item.append(time, content);
    return item;
  }));
}

function renderDiagnostics(diagnostics) {
  const labels = { platform: '操作系统', architecture: 'CPU 架构', electron: 'Electron', node: 'Node', napi: 'N-API', sessionType: 'XDG_SESSION_TYPE', mockEnabled: 'Mock 模式', sdkState: 'SDK 状态', target: '目标基线', actualSdkLoaded: '真实 SDK 已加载' };
  $('diagnosticsList').replaceChildren(...Object.entries(labels).map(([key, label]) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const value = document.createElement('dd');
    term.textContent = label;
    value.textContent = String(diagnostics[key]);
    row.append(term, value);
    return row;
  }));
}

async function execute(action, successMessage) {
  try {
    $('actionMessage').className = 'action-message';
    $('actionMessage').textContent = '正在处理…';
    const result = await action();
    render(result);
    $('actionMessage').textContent = successMessage;
  } catch (error) {
    $('actionMessage').className = 'action-message error';
    $('actionMessage').textContent = error.message || '操作失败';
  }
}

function setModalVisible(visible) {
  $('aboutModal').hidden = !visible;
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));
$('goLifecycleButton').addEventListener('click', () => selectView('lifecycle'));
$('goLoginButton').addEventListener('click', () => selectView('login'));
$('aboutButton').addEventListener('click', () => setModalVisible(true));
$('closeAboutButton').addEventListener('click', () => setModalVisible(false));
$('closeAboutPrimaryButton').addEventListener('click', () => setModalVisible(false));
$('aboutModal').addEventListener('click', (event) => { if (event.target === $('aboutModal')) setModalVisible(false); });
$('initializeButton').addEventListener('click', () => execute(() => api.initialize({ appName: $('appName').value }), '初始化请求完成。'));
$('loginButton').addEventListener('click', () => execute(() => api.login({ displayName: $('displayName').value }), '登录请求完成。'));
$('joinButton').addEventListener('click', () => execute(() => api.joinMeeting({ meetingCode: $('meetingCode').value }), '已加入 Mock 会议。'));
$('leaveButton').addEventListener('click', () => execute(() => api.leaveMeeting(), '已离开 Mock 会议。'));
$('logoutButton').addEventListener('click', () => execute(() => api.logout(), '已登出。'));
$('uninitializeButton').addEventListener('click', () => execute(() => api.uninitialize(), '已反初始化。'));

api.onUpdate(render);
api.getSnapshot().then(render).catch((error) => {
  $('actionMessage').className = 'action-message error';
  $('actionMessage').textContent = error.message || '无法读取应用状态';
});
