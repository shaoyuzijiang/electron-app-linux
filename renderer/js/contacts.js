// ========== 通讯录模块 ==========

let deptTreeRoot = null; // 根节点对象 { id: "root", name: "全部", children: [...], userCount, totalUserCount }
let expandedDepts = new Set();
let selectedDeptId = null;
let searchTimer = null;
let contactsInitialized = false;

// 分页状态
let contactsCurrentPage = 1;
let contactsPageSize = 50;
let contactsTotalUsers = 0;
let contactsHasMore = false;
let contactsCurrentDeptId = null;
let contactsCurrentRecursive = true;
let contactsLoadingMore = false;

// ---------- 本地缓存 ----------
const CACHE_KEY_DEPT_TREE = 'contacts_dept_tree';
const CACHE_KEY_DEPT_USERS_PREFIX = 'contacts_dept_users_';
const CACHE_KEY_VERSION = 'contacts_cache_version';
const CACHE_VERSION = 1; // 缓存结构版本，变更时自动失效

function saveContactsCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn('缓存写入失败:', e);
  }
}

function loadContactsCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('缓存读取失败:', e);
    return null;
  }
}

function clearContactsCache() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k === CACHE_KEY_DEPT_TREE || k.startsWith(CACHE_KEY_DEPT_USERS_PREFIX) || k === CACHE_KEY_VERSION)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn('缓存清理失败:', e);
  }
}

// 检查缓存版本，不匹配则清空
function checkCacheVersion() {
  const v = localStorage.getItem(CACHE_KEY_VERSION);
  if (v !== String(CACHE_VERSION)) {
    clearContactsCache();
    localStorage.setItem(CACHE_KEY_VERSION, String(CACHE_VERSION));
  }
}

function deptUsersCacheKey(deptId, recursive) {
  return `${CACHE_KEY_DEPT_USERS_PREFIX}${deptId}_${recursive ? '1' : '0'}`;
}

/**
 * 初始化通讯录（懒加载，首次切换到通讯录页签时调用）
 */
function initContacts() {
  if (contactsInitialized) return;
  contactsInitialized = true;

  // 用户列表点击事件（事件委托，含加载更多按钮）
  document.getElementById('contactsUserList').addEventListener('click', (e) => {
    const loadMoreBtn = e.target.closest('#contactsLoadMoreBtn');
    if (loadMoreBtn && !contactsLoadingMore) {
      contactsLoadingMore = true;
      loadMoreBtn.textContent = '加载中...';
      loadMoreBtn.disabled = true;
      loadDepartmentUsers(contactsCurrentDeptId, contactsCurrentRecursive, contactsCurrentPage + 1).finally(() => {
        contactsLoadingMore = false;
      });
      return;
    }
  });

  // 部门树点击事件（事件委托）
  document.getElementById('contactsDeptTree').addEventListener('click', (e) => {
    const toggleEl = e.target.closest('.dept-toggle');
    const nameEl = e.target.closest('.dept-name');
    const headerEl = e.target.closest('.dept-node-header');

    if (toggleEl) {
      const deptId = toggleEl.getAttribute('data-dept-id');
      if (expandedDepts.has(deptId)) {
        expandedDepts.delete(deptId);
      } else {
        expandedDepts.add(deptId);
      }
      renderDepartmentTree();
      return;
    }

    if (nameEl || headerEl) {
      const deptId = (nameEl || headerEl).getAttribute('data-dept-id');
      const dept = findDeptById(deptTreeRoot, deptId);
      if (dept) {
        selectDepartment(dept);
      }
    }
  });

  // 搜索用户
  document.getElementById('contactsSearchInput').addEventListener('input', (e) => {
    const query = e.target.value.trim();
    const searchResultsEl = document.getElementById('contactsSearchResults');
    const deptTreeEl = document.getElementById('contactsDeptTree');

    clearTimeout(searchTimer);

    if (!query) {
      searchResultsEl.style.display = 'none';
      deptTreeEl.style.display = '';
      return;
    }

    searchTimer = setTimeout(async () => {
      try {
        const result = await window.electronAPI.searchUsers(query);
        if (result.success && result.data) {
          searchResultsEl.style.display = '';
          deptTreeEl.style.display = 'none';
          renderSearchResults(result.data);
        }
      } catch (err) {
        console.error('搜索用户失败:', err);
      }
    }, 300);
  });

  loadContactsData();
}

async function loadContactsData() {
  checkCacheVersion();
  await loadDepartmentTree();
  if (deptTreeRoot) {
    // 默认选中根节点"全部"并展开
    expandedDepts.add(deptTreeRoot.id);
    selectDepartment(deptTreeRoot);
  } else {
    renderContactsUserList([]);
  }
}

async function loadDepartmentTree() {
  const container = document.getElementById('contactsDeptTree');

  // 1. 先读本地缓存，有则立即渲染
  const cached = loadContactsCache(CACHE_KEY_DEPT_TREE);
  if (cached) {
    deptTreeRoot = cached;
    renderDepartmentTree();
  } else {
    container.innerHTML = `<div class="meeting-loading"><div class="spinner-small"></div><span>加载中...</span></div>`;
  }

  // 2. 后台请求最新数据
  try {
    const result = await window.electronAPI.getDepartmentTree();
    if (result.success && result.data) {
      const newTree = result.data;
      // 对比是否有变化
      if (!cached || JSON.stringify(cached) !== JSON.stringify(newTree)) {
        deptTreeRoot = newTree;
        saveContactsCache(CACHE_KEY_DEPT_TREE, newTree);
        renderDepartmentTree();
        // 如果当前选中的部门还存在，刷新用户列表
        if (selectedDeptId && findDeptById(deptTreeRoot, selectedDeptId)) {
          loadDepartmentUsers(selectedDeptId, true);
        }
      }
    } else if (!cached) {
      container.innerHTML = `<div class="meeting-empty">获取部门数据失败</div>`;
    }
  } catch (err) {
    console.error('获取部门树失败:', err);
    if (!cached) {
      container.innerHTML = `<div class="meeting-empty">获取部门数据失败</div>`;
    }
  }
}

function renderDepartmentTree() {
  const container = document.getElementById('contactsDeptTree');
  if (!deptTreeRoot) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = renderRootNode(deptTreeRoot);
}

function renderRootNode(root) {
  const isExpanded = expandedDepts.has(root.id);
  const isSelected = selectedDeptId === root.id;

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
      ${isExpanded && root.children && root.children.length > 0 ? `<div class="dept-children">${renderDeptNodes(root.children, 1)}</div>` : ''}
    </div>
  `;
}

function renderDeptNodes(nodes, level) {
  if (!nodes || nodes.length === 0) return '';
  return nodes.map((dept) => {
    const hasChildren = dept.children && dept.children.length > 0;
    const isExpanded = expandedDepts.has(dept.id);
    const isSelected = selectedDeptId === dept.id;
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
        ${hasChildren && isExpanded ? `<div class="dept-children">${renderDeptNodes(dept.children, level + 1)}</div>` : ''}
      </div>
    `;
  }).join('');
}

function selectDepartment(dept) {
  selectedDeptId = dept.id;
  expandedDepts.add(dept.id);
  renderDepartmentTree();
  // 重置分页状态，加载第一页
  contactsCurrentDeptId = dept.id;
  contactsCurrentPage = 1;
  contactsCurrentRecursive = true;
  loadDepartmentUsers(dept.id, true, 1);
  document.getElementById('contactsUserListHeader').innerHTML = `<h2>${dept.name}</h2>`;
}

async function loadDepartmentUsers(departmentId, recursive = true, page = 1) {
  const container = document.getElementById('contactsUserList');
  const cacheKey = deptUsersCacheKey(departmentId, recursive);

  if (page === 1) {
    // 1. 先读本地缓存，有则立即渲染（仅第一页）
    const cached = loadContactsCache(cacheKey);
    if (cached) {
      renderContactsUserList(cached);
    } else {
      container.innerHTML = `<div class="meeting-loading"><div class="spinner-small"></div><span>加载中...</span></div>`;
    }
  }

  // 2. 后台请求最新数据
  try {
    const result = await window.electronAPI.getDepartmentUsers(departmentId, recursive, page, contactsPageSize);
    if (result.success && result.data) {
      const { list, total } = result.data;
      contactsTotalUsers = total || 0;
      contactsCurrentPage = page;
      contactsHasMore = list && list.length > 0 && (page * contactsPageSize) < contactsTotalUsers;

      if (page === 1) {
        // 缓存第一页
        const cached = loadContactsCache(cacheKey);
        if (!cached || JSON.stringify(cached) !== JSON.stringify(list)) {
          saveContactsCache(cacheKey, list);
        }
        if (selectedDeptId === departmentId) {
          renderContactsUserList(list || []);
        }
      } else {
        if (selectedDeptId === departmentId) {
          appendContactsUserList(list || []);
        }
      }
    } else if (page === 1 && !loadContactsCache(cacheKey)) {
      container.innerHTML = `<div class="meeting-empty">${result.message || '获取用户列表失败'}</div>`;
    }
  } catch (err) {
    console.error('获取部门用户失败:', err);
    if (page === 1 && !loadContactsCache(cacheKey)) {
      container.innerHTML = `<div class="meeting-empty">获取用户列表失败</div>`;
    }
  }
}

function renderContactsUserList(users) {
  const container = document.getElementById('contactsUserList');

  if (!users || users.length === 0) {
    container.innerHTML = `<div class="meeting-empty">
      <svg viewBox="0 0 24 24" width="48" height="48"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="#ddd"/></svg>
      <div>暂无联系人</div>
    </div>`;
    return;
  }

  container.innerHTML = renderContactsUserItems(users) + renderContactsLoadMoreBtn();
}

function appendContactsUserList(users) {
  const container = document.getElementById('contactsUserList');
  const oldBtn = container.querySelector('.contacts-load-more-btn');
  if (oldBtn) oldBtn.remove();

  if (users && users.length > 0) {
    container.insertAdjacentHTML('beforeend', renderContactsUserItems(users));
  }

  if (contactsHasMore) {
    container.insertAdjacentHTML('beforeend', renderContactsLoadMoreBtn());
  }
}

function renderContactsUserItems(users) {
  return users.map((user) => {
    const initial = (user.username || '?').charAt(0).toUpperCase();
    return `
      <div class="contact-item">
        <div class="contact-avatar">${initial}</div>
        <div class="contact-info">
          <div class="contact-name">${user.username || '-'}</div>
          <div class="contact-dept">${user.departmentName || '-'}</div>
        </div>
        <div class="contact-id">${user.id || ''}</div>
      </div>
    `;
  }).join('');
}

function renderContactsLoadMoreBtn() {
  if (!contactsHasMore) return '';
  return `<div class="contacts-load-more-btn" id="contactsLoadMoreBtn">加载更多 (${contactsCurrentPage * contactsPageSize}/${contactsTotalUsers})</div>`;
}

function findDeptById(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findDeptById(child, id);
      if (found) return found;
    }
  }
  return null;
}

function renderSearchResults(users) {
  const container = document.getElementById('contactsSearchResults');
  if (!users || users.length === 0) {
    container.innerHTML = `<div class="meeting-empty" style="padding:40px 0;">未找到匹配的用户</div>`;
    return;
  }

  container.innerHTML = users.map((user) => {
    const initial = (user.username || '?').charAt(0).toUpperCase();
    return `
      <div class="contact-item search-result-item">
        <div class="contact-avatar">${initial}</div>
        <div class="contact-info">
          <div class="contact-name">${user.username || '-'}</div>
          <div class="contact-dept">${user.departmentName || '-'}</div>
        </div>
        <div class="contact-id">${user.id || ''}</div>
      </div>
    `;
  }).join('');
}
