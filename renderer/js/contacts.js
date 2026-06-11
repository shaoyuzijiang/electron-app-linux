// ========== 通讯录模块 ==========

let deptTreeRoot = null; // 根节点对象 { id: "root", name: "全部", children: [...], userCount, totalUserCount }
let expandedDepts = new Set();
let selectedDeptId = null;
let searchTimer = null;
let contactsInitialized = false;

/**
 * 初始化通讯录（懒加载，首次切换到通讯录页签时调用）
 */
function initContacts() {
  if (contactsInitialized) return;
  contactsInitialized = true;

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
  container.innerHTML = `<div class="meeting-loading"><div class="spinner-small"></div><span>加载中...</span></div>`;

  try {
    const result = await window.electronAPI.getDepartmentTree();
    if (result.success && result.data) {
      deptTreeRoot = result.data;
      renderDepartmentTree();
    } else {
      container.innerHTML = `<div class="meeting-empty">获取部门数据失败</div>`;
    }
  } catch (err) {
    console.error('获取部门树失败:', err);
    container.innerHTML = `<div class="meeting-empty">获取部门数据失败</div>`;
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
  // 根节点始终递归获取全部用户，子部门也默认递归
  loadDepartmentUsers(dept.id, true);
  document.getElementById('contactsUserListHeader').innerHTML = `<h2>${dept.name}</h2>`;
}

async function loadDepartmentUsers(departmentId, recursive = true) {
  const container = document.getElementById('contactsUserList');
  container.innerHTML = `<div class="meeting-loading"><div class="spinner-small"></div><span>加载中...</span></div>`;

  try {
    const result = await window.electronAPI.getDepartmentUsers(departmentId, recursive);
    if (result.success && result.data) {
      renderContactsUserList(result.data);
    } else {
      container.innerHTML = `<div class="meeting-empty">${result.message || '获取用户列表失败'}</div>`;
    }
  } catch (err) {
    console.error('获取部门用户失败:', err);
    container.innerHTML = `<div class="meeting-empty">获取用户列表失败</div>`;
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

  container.innerHTML = users.map((user) => {
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
