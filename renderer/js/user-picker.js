// ========== 会中自定义通讯录选人组件（独立窗口模式） ==========

let pickerInMeetingUserIds = []; // 已在会中/群中的用户ID列表（禁选）
let pickerSelectedUsers = new Map(); // 已选中的用户 id -> { id, username, departmentName }
let pickerDeptTreeRoot = null;
let pickerExpandedDepts = new Set();
let pickerSelectedDeptId = null;
let pickerSearchTimer = null;
let pickerCallbackType = null; // 'invite_users' | 'invite_meeting' | 'add_group_members'
let pickerConversationId = null; // 添加群成员模式下的会话ID

// 分页状态
let pickerCurrentPage = 1;
let pickerPageSize = 50;
let pickerTotalUsers = 0;
let pickerHasMoreUsers = false;
let pickerCurrentDeptId = null;
let pickerCurrentRecursive = true;
let pickerLoadingMore = false;

// ========== 初始化：等待主进程发送数据 ==========

window.electronAPI.onPickerInitData(({ type, cbMsg }) => {
  try {
    pickerCallbackType = type;

    const titleEl = document.getElementById('userPickerTitle');
    const inviteBtn = document.getElementById('userPickerInviteBtn');

    if (type === 'add_group_members') {
      // 添加群成员模式：cbMsg 为 { conversationId, existingMemberIds }
      const data = typeof cbMsg === 'string' ? JSON.parse(cbMsg) : cbMsg;
      pickerConversationId = data.conversationId;
      pickerInMeetingUserIds = data.existingMemberIds || [];
      titleEl.textContent = '添加群成员';
      document.title = '添加群成员';
      inviteBtn.textContent = '确认添加';
    } else if (type === 'new_conversation') {
      // 发起会话模式：cbMsg 为 { currentUserId }
      const data = typeof cbMsg === 'string' ? JSON.parse(cbMsg) : cbMsg;
      pickerInMeetingUserIds = data.currentUserId ? [data.currentUserId] : [];
      titleEl.textContent = '发起会话';
      document.title = '发起会话';
      inviteBtn.textContent = '确认';
    } else {
      // 会中邀请模式：cbMsg 为 SDK 回调 JSON
      const cb = JSON.parse(cbMsg);
      if (type === 'invite_users' && cb.param) {
        let data = typeof cb.param === 'string' ? JSON.parse(cb.param) : cb.param;
        pickerInMeetingUserIds = data.users || [];
      } else {
        pickerInMeetingUserIds = [];
      }
      if (type === 'invite_meeting') {
        titleEl.textContent = '邀请参会';
        document.title = '邀请参会';
      } else {
        titleEl.textContent = '邀请成员';
        document.title = '邀请成员';
      }
      inviteBtn.textContent = '确认邀请';
    }

    // 加载数据
    loadPickerDeptTree();
    renderPickerSelectedUsers();
  } catch (err) {
    console.error('[选人组件] 初始化数据解析失败:', err);
  }
});

// ========== 本地缓存（复用首页通讯录的 localStorage 缓存） ==========

const CACHE_KEY_DEPT_TREE = 'contacts_dept_tree';
const CACHE_KEY_DEPT_USERS_PREFIX = 'contacts_dept_users_';

function loadPickerCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('[选人组件] 缓存读取失败:', e);
    return null;
  }
}

function pickerDeptUsersCacheKey(deptId, recursive) {
  return `${CACHE_KEY_DEPT_USERS_PREFIX}${deptId}_${recursive ? '1' : '0'}`;
}

// ========== 部门树 ==========

async function loadPickerDeptTree() {
  const container = document.getElementById('userPickerDeptTree');

  // 1. 先读本地缓存，有则立即渲染
  const cached = loadPickerCache(CACHE_KEY_DEPT_TREE);
  if (cached) {
    pickerDeptTreeRoot = cached;
    pickerExpandedDepts.add(pickerDeptTreeRoot.id);
    pickerSelectedDeptId = null;
    renderPickerDeptTree();
    if (pickerDeptTreeRoot) {
      pickerSelectDepartment(pickerDeptTreeRoot);
    }
  } else {
    container.innerHTML = `<div class="meeting-loading"><div class="spinner-small"></div><span>加载中...</span></div>`;
  }

  // 2. 后台请求最新数据
  try {
    const result = await window.electronAPI.getDepartmentTree();
    if (result.success && result.data) {
      const newTree = result.data;
      if (!cached || JSON.stringify(cached) !== JSON.stringify(newTree)) {
        pickerDeptTreeRoot = newTree;
        pickerExpandedDepts.add(pickerDeptTreeRoot.id);
        pickerSelectedDeptId = null;
        renderPickerDeptTree();
        if (pickerDeptTreeRoot) {
          pickerSelectDepartment(pickerDeptTreeRoot);
        }
      }
    } else if (!cached) {
      container.innerHTML = `<div class="meeting-empty">获取部门数据失败</div>`;
    }
  } catch (err) {
    console.error('[选人组件] 获取部门树失败:', err);
    if (!cached) {
      container.innerHTML = `<div class="meeting-empty">获取部门数据失败</div>`;
    }
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
  // 重置分页状态，加载第一页
  pickerCurrentDeptId = dept.id;
  pickerCurrentPage = 1;
  pickerCurrentRecursive = true;
  loadPickerDepartmentUsers(dept.id, true, 1);
  document.getElementById('userPickerUserListHeader').innerHTML = `<h3>${dept.name}</h3>`;
}

async function loadPickerDepartmentUsers(departmentId, recursive = true, page = 1) {
  const container = document.getElementById('userPickerUserList');
  const cacheKey = pickerDeptUsersCacheKey(departmentId, recursive);

  if (page === 1) {
    // 1. 先读本地缓存，有则立即渲染（仅第一页）
    const cached = loadPickerCache(cacheKey);
    if (cached) {
      renderPickerUserList(cached);
    } else {
      container.innerHTML = `<div class="meeting-loading"><div class="spinner-small"></div><span>加载中...</span></div>`;
    }
  }

  // 2. 后台请求最新数据
  try {
    const result = await window.electronAPI.getDepartmentUsers(departmentId, recursive, page, pickerPageSize);
    if (result.success && result.data) {
      const { list, total } = result.data;
      pickerTotalUsers = total || 0;
      pickerCurrentPage = page;
      pickerHasMoreUsers = list && list.length < pickerTotalUsers && (page * pickerPageSize) < pickerTotalUsers;

      if (page === 1) {
        // 缓存第一页
        const cached = loadPickerCache(cacheKey);
        if (!cached || JSON.stringify(cached) !== JSON.stringify(list)) {
          localStorage.setItem(cacheKey, JSON.stringify(list));
        }
        if (pickerSelectedDeptId === departmentId) {
          renderPickerUserList(list || []);
        }
      } else {
        if (pickerSelectedDeptId === departmentId) {
          appendPickerUserList(list || []);
        }
      }
    } else {
      if (page === 1 && !loadPickerCache(cacheKey)) {
        container.innerHTML = `<div class="meeting-empty">${result.message || '获取用户列表失败'}</div>`;
      }
    }
  } catch (err) {
    console.error('[选人组件] 获取部门用户失败:', err);
    if (page === 1 && !loadPickerCache(cacheKey)) {
      container.innerHTML = `<div class="meeting-empty">获取用户列表失败</div>`;
    }
  }
}

function renderPickerUserList(users) {
  const container = document.getElementById('userPickerUserList');

  if (!users || users.length === 0) {
    container.innerHTML = `<div class="meeting-empty" style="padding:30px 0;">暂无联系人</div>`;
    return;
  }

  container.innerHTML = renderPickerUserItems(users) + renderLoadMoreBtn();
}

function appendPickerUserList(users) {
  const container = document.getElementById('userPickerUserList');
  // 移除旧的"加载更多"按钮
  const oldBtn = container.querySelector('.picker-load-more-btn');
  if (oldBtn) oldBtn.remove();

  if (users && users.length > 0) {
    container.insertAdjacentHTML('beforeend', renderPickerUserItems(users));
  }

  // 添加新的"加载更多"按钮
  if (pickerHasMoreUsers) {
    container.insertAdjacentHTML('beforeend', renderLoadMoreBtn());
  }
}

function renderPickerUserItems(users) {
  return users.map((user) => {
    const initial = (user.username || '?').charAt(0).toUpperCase();
    const isSelected = pickerSelectedUsers.has(user.id);
    const isInMeeting = pickerInMeetingUserIds.includes(user.id);
    const disabledClass = isInMeeting ? ' disabled' : '';
    const selectedClass = isSelected ? ' selected' : '';
    const disabledTag = pickerCallbackType === 'add_group_members' ? '已在群聊中' : '已在会议中';

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
        ${isInMeeting ? `<span class="in-meeting-tag">${disabledTag}</span>` : ''}
      </div>
    `;
  }).join('');
}

function renderLoadMoreBtn() {
  if (!pickerHasMoreUsers) return '';
  return `<div class="picker-load-more-btn" id="pickerLoadMoreBtn">加载更多 (${pickerCurrentPage * pickerPageSize}/${pickerTotalUsers})</div>`;
}

function renderPickerSearchResults(users) {
  const container = document.getElementById('userPickerSearchResults');
  if (!users || users.length === 0) {
    container.innerHTML = `<div class="meeting-empty" style="padding:30px 0;">未找到匹配的用户</div>`;
    return;
  }

  const disabledTag = pickerCallbackType === 'add_group_members' ? '已在群聊中' : '已在会议中';

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
        ${isInMeeting ? `<span class="in-meeting-tag">${disabledTag}</span>` : ''}
      </div>
    `;
  }).join('');
}

// ========== 已选用户 ==========

function togglePickerUser(userId, username, departmentName) {
  if (pickerInMeetingUserIds.includes(userId)) return;

  if (pickerSelectedUsers.has(userId)) {
    pickerSelectedUsers.delete(userId);
  } else {
    pickerSelectedUsers.set(userId, { id: userId, username, departmentName });
  }

  renderPickerSelectedUsers();
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

  // 发起会话模式：选中2人以上时显示群名输入框
  const groupNameRow = document.getElementById('pickerGroupNameRow');
  if (groupNameRow) {
    groupNameRow.style.display = (pickerCallbackType === 'new_conversation' && count >= 2) ? '' : 'none';
  }

  if (count === 0) {
    const hintText = pickerCallbackType === 'add_group_members'
      ? '从右侧通讯录中选择要添加的成员'
      : pickerCallbackType === 'new_conversation'
        ? '从右侧通讯录中选择聊天对象'
        : '从右侧通讯录中选择要邀请的人员';
    container.innerHTML = `<div class="picker-empty-hint">${hintText}</div>`;
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

// ========== 确认邀请 ==========

async function confirmInviteUsers() {
  if (pickerSelectedUsers.size === 0) return;

  const inviteBtn = document.getElementById('userPickerInviteBtn');
  inviteBtn.disabled = true;

  const userIds = Array.from(pickerSelectedUsers.keys());

  // ---- 添加群成员模式：逐个调用 imAddMember ----
  if (pickerCallbackType === 'add_group_members') {
    inviteBtn.textContent = '添加中...';
    let failCount = 0;
    for (const userId of userIds) {
      try {
        const result = await window.electronAPI.imAddMember(pickerConversationId, userId);
        if (!result.success) {
          console.warn('[选人组件] 添加成员失败:', userId, result.message);
          failCount++;
        }
      } catch (err) {
        console.error('[选人组件] 添加成员异常:', userId, err);
        failCount++;
      }
    }
    if (failCount > 0) {
      alert(`部分成员添加失败（${failCount}/${userIds.length}），请重试`);
      inviteBtn.disabled = false;
      inviteBtn.textContent = '确认添加';
      return;
    }
    // 通知主窗口刷新成员列表
    window.electronAPI.notifyAddMemberDone();
    window.electronAPI.closeUserPickerWindow();
    return;
  }

  // ---- 发起会话模式：根据选中人数创建单聊或群聊 ----
  if (pickerCallbackType === 'new_conversation') {
    inviteBtn.textContent = '创建中...';
    let type, name;
    if (userIds.length === 1) {
      type = 'single';
      name = '';
    } else {
      type = 'group';
      const nameInput = document.getElementById('pickerGroupNameInput');
      name = (nameInput ? nameInput.value : '').trim();
      if (!name) {
        alert('请输入群聊名称');
        inviteBtn.disabled = false;
        inviteBtn.textContent = '确认';
        return;
      }
      if (name.length > 64) {
        alert('群名不能超过64个字符');
        inviteBtn.disabled = false;
        inviteBtn.textContent = '确认';
        return;
      }
    }

    try {
      const result = await window.electronAPI.imCreateConversation(type, name, userIds);
      if (result.success && result.data) {
        window.electronAPI.notifyNewChatCreated(result.data.id);
        window.electronAPI.closeUserPickerWindow();
      } else {
        alert(result.message || '创建失败');
        inviteBtn.disabled = false;
        inviteBtn.textContent = '确认';
      }
    } catch (err) {
      alert('创建失败: ' + err.message);
      inviteBtn.disabled = false;
      inviteBtn.textContent = '确认';
    }
    return;
  }

  // ---- 会中邀请模式：调用 SDK AddUsersWithParam ----
  inviteBtn.textContent = '邀请中...';
  const jsonParam = JSON.stringify({
    users: userIds,
    user_type: 3, // 会中邀请入会
  });

  try {
    const result = await window.electronAPI.addUsersWithParam(jsonParam);
    if (!result.success) {
      alert('邀请失败: ' + (result.message || '未知错误'));
      inviteBtn.disabled = false;
      inviteBtn.textContent = '确认邀请';
      return;
    }
    // 等待 OnAddUsersResult 回调来确认结果，先关闭窗口
    window.electronAPI.closeUserPickerWindow();
  } catch (err) {
    alert('邀请失败: ' + err.message);
    inviteBtn.disabled = false;
    inviteBtn.textContent = '确认邀请';
  }
}

// ========== 查找部门 ==========

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

// ========== 事件绑定 ==========

// 关闭按钮
document.getElementById('userPickerCloseBtn').addEventListener('click', () => {
  window.electronAPI.closeUserPickerWindow();
});

// 取消按钮
document.getElementById('userPickerCancelBtn').addEventListener('click', () => {
  window.electronAPI.closeUserPickerWindow();
});

// 确认邀请
document.getElementById('userPickerInviteBtn').addEventListener('click', confirmInviteUsers);

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
  // 加载更多按钮
  const loadMoreBtn = e.target.closest('#pickerLoadMoreBtn');
  if (loadMoreBtn && !pickerLoadingMore) {
    pickerLoadingMore = true;
    loadMoreBtn.textContent = '加载中...';
    loadMoreBtn.disabled = true;
    loadPickerDepartmentUsers(pickerCurrentDeptId, pickerCurrentRecursive, pickerCurrentPage + 1).finally(() => {
      pickerLoadingMore = false;
    });
    return;
  }

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

// 监听邀请结果回调
window.electronAPI.onAddUsersResultCallback((msg) => {
  try {
    const cb = JSON.parse(msg);
    const code = Number(cb.code);
    if (code === 0) {
      console.log('[选人组件] 邀请用户成功');
    } else {
      console.error('[选人组件] 邀请用户失败:', cb.msg);
    }
  } catch (err) {
    console.error('[选人组件] 解析 OnAddUsersResult 回调失败:', err);
  }
});
