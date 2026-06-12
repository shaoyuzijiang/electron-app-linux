// ========== 会中自定义通讯录选人组件 ==========

let pickerVisible = false;
let pickerInMeetingUserIds = []; // 已在会中的用户ID列表
let pickerSelectedUsers = new Map(); // 已选中的用户 id -> { id, username, departmentName }
let pickerDeptTreeRoot = null;
let pickerExpandedDepts = new Set();
let pickerSelectedDeptId = null;
let pickerSearchTimer = null;
let pickerCallbackType = null; // 'invite_users' 或 'invite_meeting'

/**
 * 显示选人组件
 * @param {string} type - 回调类型: 'invite_users' 或 'invite_meeting'
 * @param {object} data - 回调数据，invite_users 时包含 { users, user_type }
 */
function showUserPicker(type, data) {
  if (pickerVisible) return;
  pickerVisible = true;
  pickerCallbackType = type;
  pickerSelectedUsers.clear();

  // 解析已在会中的用户列表
  if (type === 'invite_users' && data && data.users) {
    pickerInMeetingUserIds = data.users;
  } else {
    pickerInMeetingUserIds = [];
  }

  const overlay = document.getElementById('userPickerOverlay');
  overlay.classList.add('show');

  // 更新标题
  const titleEl = document.getElementById('userPickerTitle');
  if (type === 'invite_meeting') {
    titleEl.textContent = '邀请参会';
  } else {
    titleEl.textContent = '邀请成员';
  }

  // 清空搜索
  const searchInput = document.getElementById('userPickerSearchInput');
  searchInput.value = '';
  document.getElementById('userPickerSearchResults').style.display = 'none';
  document.getElementById('userPickerDeptTree').style.display = '';

  // 加载数据
  loadPickerDeptTree();
  renderPickerSelectedUsers();
}

/**
 * 隐藏选人组件
 */
function hideUserPicker() {
  pickerVisible = false;
  pickerSelectedUsers.clear();
  pickerInMeetingUserIds = [];
  pickerCallbackType = null;
  const overlay = document.getElementById('userPickerOverlay');
  overlay.classList.remove('show');
}

// ---------- 部门树 ----------

async function loadPickerDeptTree() {
  const container = document.getElementById('userPickerDeptTree');
  container.innerHTML = `<div class="meeting-loading"><div class="spinner-small"></div><span>加载中...</span></div>`;

  try {
    const result = await window.electronAPI.getDepartmentTree();
    if (result.success && result.data) {
      pickerDeptTreeRoot = result.data;
      pickerExpandedDepts.add(pickerDeptTreeRoot.id);
      pickerSelectedDeptId = null;
      renderPickerDeptTree();
      // 默认选中根节点
      if (pickerDeptTreeRoot) {
        pickerSelectDepartment(pickerDeptTreeRoot);
      }
    } else {
      container.innerHTML = `<div class="meeting-empty">获取部门数据失败</div>`;
    }
  } catch (err) {
    console.error('[选人组件] 获取部门树失败:', err);
    container.innerHTML = `<div class="meeting-empty">获取部门数据失败</div>`;
  }
}

function renderPickerDeptTree() {
  const container = document.getElementById('userPickerDeptTree');
  if (!pickerDeptTreeRoot) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = renderPickerRootNode(pickerDeptTreeRoot);
}

function renderPickerRootNode(root) {
  const isExpanded = pickerExpandedDepts.has(root.id);
  const isSelected = pickerSelectedDeptId === root.id;

  return `
    <div class="dept-node" data-dept-id="${root.id}">
      <div class="dept-node-header ${isSelected ? 'selected' : ''}"
           style="padding-left: 12px"
           data-dept-id="${root.id}">
        ${root.children && root.children.length > 0 ? `<span class="dept-toggle ${isExpanded ? 'expanded' : ''}" data-dept-id="${root.id}">
          <svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </span>` : '<span class="dept-toggle-placeholder"></span>'}
        <span class="dept-name" data-dept-id="${root.id}">${root.name}</span>
        <span class="dept-count">${root.totalUserCount || 0}</span>
      </div>
      ${isExpanded && root.children && root.children.length > 0 ? `<div class="dept-children">${renderPickerDeptNodes(root.children, 1)}</div>` : ''}
    </div>
  `;
}

function renderPickerDeptNodes(nodes, level) {
  if (!nodes || nodes.length === 0) return '';
  return nodes.map((dept) => {
    const hasChildren = dept.children && dept.children.length > 0;
    const isExpanded = pickerExpandedDepts.has(dept.id);
    const isSelected = pickerSelectedDeptId === dept.id;
    const indent = level * 16;

    return `
      <div class="dept-node" data-dept-id="${dept.id}">
        <div class="dept-node-header ${isSelected ? 'selected' : ''}"
             style="padding-left: ${12 + indent}px"
             data-dept-id="${dept.id}">
          ${hasChildren ? `<span class="dept-toggle ${isExpanded ? 'expanded' : ''}" data-dept-id="${dept.id}">
            <svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
          </span>` : '<span class="dept-toggle-placeholder"></span>'}
          <span class="dept-name" data-dept-id="${dept.id}">${dept.name}</span>
          <span class="dept-count">${dept.totalUserCount || 0}</span>
        </div>
        ${hasChildren && isExpanded ? `<div class="dept-children">${renderPickerDeptNodes(dept.children, level + 1)}</div>` : ''}
      </div>
    `;
  }).join('');
}

function pickerSelectDepartment(dept) {
  pickerSelectedDeptId = dept.id;
  pickerExpandedDepts.add(dept.id);
  renderPickerDeptTree();
  loadPickerDepartmentUsers(dept.id, true);
  document.getElementById('userPickerUserListHeader').innerHTML = `<h3>${dept.name}</h3>`;
}

async function loadPickerDepartmentUsers(departmentId, recursive = true) {
  const container = document.getElementById('userPickerUserList');
  container.innerHTML = `<div class="meeting-loading"><div class="spinner-small"></div><span>加载中...</span></div>`;

  try {
    const result = await window.electronAPI.getDepartmentUsers(departmentId, recursive);
    if (result.success && result.data) {
      renderPickerUserList(result.data);
    } else {
      container.innerHTML = `<div class="meeting-empty">${result.message || '获取用户列表失败'}</div>`;
    }
  } catch (err) {
    console.error('[选人组件] 获取部门用户失败:', err);
    container.innerHTML = `<div class="meeting-empty">获取用户列表失败</div>`;
  }
}

function renderPickerUserList(users) {
  const container = document.getElementById('userPickerUserList');

  if (!users || users.length === 0) {
    container.innerHTML = `<div class="meeting-empty" style="padding:30px 0;">暂无联系人</div>`;
    return;
  }

  container.innerHTML = users.map((user) => {
    const initial = (user.username || '?').charAt(0).toUpperCase();
    const isSelected = pickerSelectedUsers.has(user.id);
    const isInMeeting = pickerInMeetingUserIds.includes(user.id);
    const disabledClass = isInMeeting ? ' disabled' : '';
    const selectedClass = isSelected ? ' selected' : '';

    return `
      <div class="picker-user-item${disabledClass}${selectedClass}" data-user-id="${user.id}" data-username="${user.username || ''}" data-dept="${user.departmentName || ''}">
        <div class="picker-checkbox${isSelected ? ' checked' : ''}${isInMeeting ? ' disabled' : ''}">
          ${isSelected ? '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' : ''}
        </div>
        <div class="contact-avatar">${initial}</div>
        <div class="contact-info">
          <div class="contact-name">${user.username || '-'}</div>
          <div class="contact-dept">${user.departmentName || '-'}</div>
        </div>
        ${isInMeeting ? '<span class="in-meeting-tag">已在会议中</span>' : ''}
      </div>
    `;
  }).join('');
}

function renderPickerSearchResults(users) {
  const container = document.getElementById('userPickerSearchResults');
  if (!users || users.length === 0) {
    container.innerHTML = `<div class="meeting-empty" style="padding:30px 0;">未找到匹配的用户</div>`;
    return;
  }

  container.innerHTML = users.map((user) => {
    const initial = (user.username || '?').charAt(0).toUpperCase();
    const isSelected = pickerSelectedUsers.has(user.id);
    const isInMeeting = pickerInMeetingUserIds.includes(user.id);
    const disabledClass = isInMeeting ? ' disabled' : '';
    const selectedClass = isSelected ? ' selected' : '';

    return `
      <div class="picker-user-item search-result-item${disabledClass}${selectedClass}" data-user-id="${user.id}" data-username="${user.username || ''}" data-dept="${user.departmentName || ''}">
        <div class="picker-checkbox${isSelected ? ' checked' : ''}${isInMeeting ? ' disabled' : ''}">
          ${isSelected ? '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' : ''}
        </div>
        <div class="contact-avatar">${initial}</div>
        <div class="contact-info">
          <div class="contact-name">${user.username || '-'}</div>
          <div class="contact-dept">${user.departmentName || '-'}</div>
        </div>
        ${isInMeeting ? '<span class="in-meeting-tag">已在会议中</span>' : ''}
      </div>
    `;
  }).join('');
}

// ---------- 已选用户 ----------

function togglePickerUser(userId, username, departmentName) {
  if (pickerInMeetingUserIds.includes(userId)) return;

  if (pickerSelectedUsers.has(userId)) {
    pickerSelectedUsers.delete(userId);
  } else {
    pickerSelectedUsers.set(userId, { id: userId, username, departmentName });
  }

  renderPickerSelectedUsers();
  // 更新用户列表中的选中状态
  updatePickerUserListCheckboxes();
}

function removePickerUser(userId) {
  pickerSelectedUsers.delete(userId);
  renderPickerSelectedUsers();
  updatePickerUserListCheckboxes();
}

function renderPickerSelectedUsers() {
  const container = document.getElementById('userPickerSelectedList');
  const countEl = document.getElementById('userPickerSelectedCount');
  const inviteBtn = document.getElementById('userPickerInviteBtn');

  const count = pickerSelectedUsers.size;
  countEl.textContent = count > 0 ? `已选 ${count} 人` : '';
  inviteBtn.disabled = count === 0;

  if (count === 0) {
    container.innerHTML = `<div class="picker-empty-hint">从右侧通讯录中选择要邀请的人员</div>`;
    return;
  }

  container.innerHTML = Array.from(pickerSelectedUsers.values()).map((user) => {
    const initial = (user.username || '?').charAt(0).toUpperCase();
    return `
      <div class="picker-selected-item" data-user-id="${user.id}">
        <div class="picker-selected-avatar">${initial}</div>
        <span class="picker-selected-name">${user.username || user.id}</span>
        <span class="picker-selected-remove" data-user-id="${user.id}" title="移除">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </span>
      </div>
    `;
  }).join('');
}

function updatePickerUserListCheckboxes() {
  // 更新用户列表中所有 checkbox 的显示状态
  document.querySelectorAll('#userPickerUserList .picker-user-item, #userPickerSearchResults .picker-user-item').forEach((item) => {
    const userId = item.getAttribute('data-user-id');
    const checkbox = item.querySelector('.picker-checkbox');
    const isInMeeting = pickerInMeetingUserIds.includes(userId);

    if (pickerSelectedUsers.has(userId)) {
      item.classList.add('selected');
      checkbox.classList.add('checked');
      checkbox.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    } else {
      item.classList.remove('selected');
      checkbox.classList.remove('checked');
      checkbox.innerHTML = '';
    }
  });
}

// ---------- 确认邀请 ----------

async function confirmInviteUsers() {
  if (pickerSelectedUsers.size === 0) return;

  const inviteBtn = document.getElementById('userPickerInviteBtn');
  inviteBtn.disabled = true;
  inviteBtn.textContent = '邀请中...';

  const userIds = Array.from(pickerSelectedUsers.keys());
  const jsonParam = JSON.stringify({
    users: userIds.map((id) => ({ user_id: id })),
  });

  try {
    const result = await window.electronAPI.addUsersWithParam(jsonParam);
    if (!result.success) {
      alert('邀请失败: ' + (result.message || '未知错误'));
      inviteBtn.disabled = false;
      inviteBtn.textContent = '确认邀请';
      return;
    }
    // 等待 OnAddUsersResult 回调来确认结果，先关闭弹窗
    hideUserPicker();
  } catch (err) {
    alert('邀请失败: ' + err.message);
    inviteBtn.disabled = false;
    inviteBtn.textContent = '确认邀请';
  }
}

// ---------- 查找部门 ----------

function findPickerDeptById(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findPickerDeptById(child, id);
      if (found) return found;
    }
  }
  return null;
}

// ========== 初始化事件绑定 ==========

function initUserPickerEvents() {
  // 关闭按钮
  document.getElementById('userPickerCloseBtn').addEventListener('click', hideUserPicker);

  // 取消按钮
  document.getElementById('userPickerCancelBtn').addEventListener('click', hideUserPicker);

  // 确认邀请
  document.getElementById('userPickerInviteBtn').addEventListener('click', confirmInviteUsers);

  // 遮罩层点击关闭（不关闭，避免误操作）

  // 部门树点击事件（事件委托）
  document.getElementById('userPickerDeptTree').addEventListener('click', (e) => {
    const toggleEl = e.target.closest('.dept-toggle');
    const nameEl = e.target.closest('.dept-name');
    const headerEl = e.target.closest('.dept-node-header');

    if (toggleEl) {
      const deptId = toggleEl.getAttribute('data-dept-id');
      if (pickerExpandedDepts.has(deptId)) {
        pickerExpandedDepts.delete(deptId);
      } else {
        pickerExpandedDepts.add(deptId);
      }
      renderPickerDeptTree();
      return;
    }

    if (nameEl || headerEl) {
      const deptId = (nameEl || headerEl).getAttribute('data-dept-id');
      const dept = findPickerDeptById(pickerDeptTreeRoot, deptId);
      if (dept) {
        pickerSelectDepartment(dept);
      }
    }
  });

  // 用户列表点击事件（事件委托）
  document.getElementById('userPickerUserList').addEventListener('click', (e) => {
    const item = e.target.closest('.picker-user-item');
    if (!item) return;
    const userId = item.getAttribute('data-user-id');
    const username = item.getAttribute('data-username');
    const dept = item.getAttribute('data-dept');
    if (userId) {
      togglePickerUser(userId, username, dept);
    }
  });

  // 搜索结果点击事件（事件委托）
  document.getElementById('userPickerSearchResults').addEventListener('click', (e) => {
    const item = e.target.closest('.picker-user-item');
    if (!item) return;
    const userId = item.getAttribute('data-user-id');
    const username = item.getAttribute('data-username');
    const dept = item.getAttribute('data-dept');
    if (userId) {
      togglePickerUser(userId, username, dept);
    }
  });

  // 已选用户移除事件（事件委托）
  document.getElementById('userPickerSelectedList').addEventListener('click', (e) => {
    const removeEl = e.target.closest('.picker-selected-remove');
    if (!removeEl) return;
    const userId = removeEl.getAttribute('data-user-id');
    if (userId) {
      removePickerUser(userId);
    }
  });

  // 搜索
  document.getElementById('userPickerSearchInput').addEventListener('input', (e) => {
    const query = e.target.value.trim();
    const searchResultsEl = document.getElementById('userPickerSearchResults');
    const deptTreeEl = document.getElementById('userPickerDeptTree');

    clearTimeout(pickerSearchTimer);

    if (!query) {
      searchResultsEl.style.display = 'none';
      deptTreeEl.style.display = '';
      return;
    }

    pickerSearchTimer = setTimeout(async () => {
      try {
        const result = await window.electronAPI.searchUsers(query);
        if (result.success && result.data) {
          searchResultsEl.style.display = '';
          deptTreeEl.style.display = 'none';
          renderPickerSearchResults(result.data);
        }
      } catch (err) {
        console.error('[选人组件] 搜索用户失败:', err);
      }
    }, 300);
  });

  // 监听 SDK 邀请回调
  window.electronAPI.onInviteUsersCallback((msg) => {
    try {
      const cb = JSON.parse(msg);
      // OnInviteUsers 回调的 param 字段包含 { users, user_type }
      let data = {};
      if (cb.param) {
        if (typeof cb.param === 'string') {
          data = JSON.parse(cb.param);
        } else {
          data = cb.param;
        }
      }
      console.log('[选人组件] OnInviteUsers 回调数据:', data);
      showUserPicker('invite_users', data);
    } catch (err) {
      console.error('[选人组件] 解析 OnInviteUsers 回调失败:', err);
    }
  });

  window.electronAPI.onInviteMeetingCallback((msg) => {
    try {
      const cb = JSON.parse(msg);
      // OnInviteMeeting 回调的 param 字段包含会议信息
      let data = {};
      if (cb.param) {
        if (typeof cb.param === 'string') {
          data = JSON.parse(cb.param);
        } else {
          data = cb.param;
        }
      }
      console.log('[选人组件] OnInviteMeeting 回调数据:', data);
      showUserPicker('invite_meeting', data);
    } catch (err) {
      console.error('[选人组件] 解析 OnInviteMeeting 回调失败:', err);
    }
  });

  // 监听邀请结果回调
  window.electronAPI.onAddUsersResultCallback((msg) => {
    try {
      const cb = JSON.parse(msg);
      const code = Number(cb.code);
      if (code === 0) {
        console.log('[选人组件] 邀请用户成功');
      } else {
        console.error('[选人组件] 邀请用户失败:', cb.msg);
        alert('邀请用户失败: ' + (cb.msg || '未知错误'));
      }
    } catch (err) {
      console.error('[选人组件] 解析 OnAddUsersResult 回调失败:', err);
    }
  });
}
