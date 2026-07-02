// ========== 企业管理 SSO 模块 ==========
// 负责：
//   1. 头像菜单交互（点击展开 / 外部点击关闭 / 菜单定位）
//   2. 加载当前用户信息（getProfile），仅当 role 为 admin/superadmin 时显示「企业管理」菜单项
//   3. 点击「企业管理」时，调用主进程颁发一次性 SSO Ticket
//   4. 把 /sso/redirect?ticket=xxx 加载到一个新建的动态 webview tab
//   5. 监听 webview 标题更新，实时更新 tab 标题
//   6. 动态页签关闭时清理对应 webview
//
// 受众白名单（与后端一致）：
//   - web-user-center:chat           => /user-center/chat           (requireAdmin=false)
//   - web-user-center:organization   => /user-center/organization-management  (requireAdmin=false)
//   - web-user-center:role           => /user-center/role-management          (requireAdmin=true)
//
// 「企业管理」菜单仅对 admin/superadmin 可见；首次点击默认打开「组织架构」。
//
// 性能优化：
//   - 登录成功后立即在后台预申请 ORG ticket（prewarm），省掉用户点击后的 RPC 往返
//   - 用户 hover 头像菜单时再次触发预申请（保持缓存热度）
//   - ticket 缓存：同一 audience 在 TTL 内复用（< 30s 直接返回；> 30s 重新申请）
//   - 并发去重：同一 audience 同时多次申请共享同一个 in-flight Promise
//   - 占位 tab：点击后立即创建 tab 并切过去（loading 状态），不等 ticket 申请完成

(function () {
  // 受众白名单（前端冗余一份，仅用于本地判断；服务端仍会二次校验）
  const AUDIENCES = {
    CHAT: { id: 'web-user-center:chat', target: '/user-center/chat', requireAdmin: false, title: '即时通讯' },
    ORG:  { id: 'web-user-center:organization', target: '/user-center/organization-management', requireAdmin: false, title: '组织架构管理' },
    ROLE: { id: 'web-user-center:role', target: '/user-center/role-management', requireAdmin: true,  title: '角色管理' },
  };

  // SSO 失败 reason 文案（与服务端 sso-interface.md §2 对齐）
  const REASON_TEXT = {
    invalid_ticket:  '票据非法（签名错误 / 已使用 / 不在白名单 / 已被禁用）',
    expired_ticket:  '票据已过期（TTL 60 秒，请重新打开）',
    cookie_required: '浏览器/WebView 禁用了 Cookie，无法建立登录态',
  };

  /**
   * 从最终 URL 提取 reason 参数（仅做白名单常量匹配，不接收外部任意传参）
   */
  function _extractReason(url) {
    try {
      const u = new URL(url);
      const r = u.searchParams.get('reason');
      if (r && Object.prototype.hasOwnProperty.call(REASON_TEXT, r)) return r;
      return r || null;
    } catch {
      return null;
    }
  }

  // 图标（24x24 SVG path d）
  const ICONS = {
    ORG: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  };

  // 域名（与服务端 sso-interface.md 对齐；从 sso.js 同步过来）
  const REDIRECT_BASE = 'https://wemeetapp.liuqi92.cn';

  // 当前用户信息
  let currentUser = null;

  // 头像元素 & 菜单元素
  let userAvatar;
  let avatarMenu;

  // ticket 缓存：audienceId -> { ticket, jti, expiresAt, pending? }
  // - ticket 已就绪且 expiresAt - Date.now() > 30s 时直接复用
  // - pending 字段用于并发去重（多次申请合并为同一次 RPC）
  const _ticketCache = new Map();

  // 标记是否正在预申请（避免在 hover/登录后多次触发）
  let _prewarmInFlight = false;

  // 头像菜单是否已被 hover 过（避免重复触发预申请）
  let _avatarHovered = false;

  // 是否为 admin/superadmin
  function _isAdmin() {
    const role = (currentUser && currentUser.role) || '';
    return role === 'admin' || role === 'superadmin';
  }

  /**
   * 获取或申请 SSO ticket（含缓存复用 + 并发去重）
   * - 命中未过期缓存 → 立即返回（< 30s 内复用）
   * - 已有 in-flight 请求 → 复用同一个 Promise
   * - 否则发起新申请
   *
   * @param {{id: string, target: string}} audience
   * @returns {Promise<{ticket: string, jti: string, expiresAt: number}>}
   */
  async function _getOrFetchTicket(audience) {
    if (!audience || !audience.id) throw new Error('audience 非法');
    const now = Date.now();

    // 1. 命中缓存
    const cached = _ticketCache.get(audience.id);
    if (cached && cached.ticket && cached.expiresAt && cached.expiresAt - now > 30000) {
      return cached;
    }

    // 2. 复用 in-flight
    if (cached && cached.pending) {
      return cached.pending;
    }

    // 3. 发起新申请；写入 pending 让其他调用复用
    const pending = (async () => {
      const result = await window.electronAPI.ssoRequestTicket(audience.id, audience.target);
      if (!result || !result.success) {
        // 失败时清除占位
        _ticketCache.delete(audience.id);
        throw new Error((result && result.message) || '申请 SSO 票据失败');
      }
      const data = result.data || {};
      // 后端返回 { ticket, jti, expiresIn, expiresAt }，容错处理 expiresIn
      const expiresAt = data.expiresAt || (Date.now() + (data.expiresIn || 60) * 1000);
      const entry = { ticket: data.ticket, jti: data.jti, expiresAt };
      _ticketCache.set(audience.id, entry);
      return entry;
    })()
      .finally(() => {
        // 申请完成（无论成功失败）清除 pending；保留成功 entry
        const cur = _ticketCache.get(audience.id);
        if (cur && cur.pending) {
          const { pending: _omit, ...rest } = cur;
          if (rest && rest.ticket) {
            _ticketCache.set(audience.id, rest);
          } else {
            _ticketCache.delete(audience.id);
          }
        }
      });

    _ticketCache.set(audience.id, { ...(cached || {}), pending });
    return pending;
  }

  /**
   * 预申请默认 audience 的 ticket（ORG）。
   * - 登录后调用一次
   * - hover 头像菜单时也调用（保持热度，缓存过期前刷新）
   * - 只对 admin/superadmin 触发
   * - 内部并发去重
   */
  async function _prewarmDefaultTicket() {
    if (!_isAdmin()) return; // 普通用户不需要 SSO
    if (_prewarmInFlight) return;
    _prewarmInFlight = true;
    try {
      await _getOrFetchTicket(AUDIENCES.ORG);
    } catch (err) {
      // 静默失败：预申请不阻塞主流程
      console.warn('[EnterpriseSSO] 预申请 SSO 票据失败（不影响打开操作）:', err && err.message);
    } finally {
      _prewarmInFlight = false;
    }
  }

  /**
   * 初始化：加载用户信息 + 绑定头像菜单事件
   */
  async function init() {
    userAvatar = document.getElementById('userAvatarNav');
    avatarMenu = document.getElementById('avatarMenu');

    if (!userAvatar || !avatarMenu) {
      console.warn('[EnterpriseSSO] 头像元素未找到');
      return;
    }

    // 头像点击展开菜单
    userAvatar.addEventListener('click', toggleMenu);

    // 头像 hover 触发预申请：用户进入菜单时大概率要点「企业管理」，
    // 此时提前申请 ticket 缓存，让点击时几乎无延迟
    userAvatar.addEventListener('mouseenter', () => {
      if (!_avatarHovered) {
        _avatarHovered = true;
      }
      _prewarmDefaultTicket();
    });

    // 外部点击关闭
    document.addEventListener('click', () => {
      if (avatarMenu) avatarMenu.classList.remove('show');
    });

    // 菜单内部点击不冒泡
    avatarMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // 加载用户信息
    try {
      const result = await window.electronAPI.getProfile();
      if (result && result.success && result.profile) {
        currentUser = result.profile;
        const username = currentUser.username || '?';
        userAvatar.textContent = username.charAt(0).toUpperCase();
        updateAdminMenuVisibility();
        // 登录后立即预申请（用户角色已确认）
        _prewarmDefaultTicket();
      } else {
        userAvatar.textContent = '?';
      }
    } catch (err) {
      console.error('[EnterpriseSSO] 获取用户信息失败:', err);
      userAvatar.textContent = '?';
    }

    // 绑定「企业管理」菜单点击
    const menuItem = document.getElementById('enterpriseAdminMenu');
    if (menuItem) {
      menuItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (avatarMenu) avatarMenu.classList.remove('show');
        await openEnterpriseDefault();
      });
      // 菜单项 hover 也预热一次（防止缓存过期）
      menuItem.addEventListener('mouseenter', () => {
        _prewarmDefaultTicket();
      });
    }

    // 监听 webview 标题更新
    if (window.electronAPI.onWebviewTitleUpdated) {
      window.electronAPI.onWebviewTitleUpdated(({ tabId, title }) => {
        if (tabId && tabId.startsWith('enterprise-')) {
          updateTabTitle(tabId, title);
          // 拿到标题后关闭 loading 状态
          if (title) setTabLoading(tabId, false);
        }
      });
    }

    // 监听 webview 跳转链：识别 SSO 跳登录页 / 加载失败，弹窗告知 reason
    if (window.electronAPI.onWebviewNavigation) {
      // 一个 tabId 一次会话只弹一次错误，避免 302 链 / did-fail-load 重复触发
      const alerted = new Set();
      window.electronAPI.onWebviewNavigation((evt) => {
        if (!evt || !evt.tabId || !evt.tabId.startsWith('enterprise-')) return;
        const finalUrl = evt.url || '';
        // did-navigate 落地即可关闭 loading
        if (evt.type === 'navigate' || evt.type === 'navigate-in-page') {
          setTabLoading(evt.tabId, false);
        }
        if (evt.type === 'navigate' || evt.type === 'redirect' || evt.type === 'fail') {
          // 1) 跳转到了 web 的登录页（302 -> /user-center/login?reason=xxx）
          if (/\/user-center\/login(?:[?#].*)?$/i.test(finalUrl)) {
            const reason = _extractReason(finalUrl);
            const reasonText = REASON_TEXT[reason] || `未知原因（reason=${reason || '空'}）`;
            if (!alerted.has(evt.tabId + ':login')) {
              alerted.add(evt.tabId + ':login');
              // 清除该 audience 的缓存（票据可能已用 / 失效）
              const tab = window.NavModule && window.NavModule.getDynamicTab(evt.tabId);
              if (tab && tab.audience) _ticketCache.delete(tab.audience);
              alert(`企业页面跳转登录失败：${reasonText}\n\n请检查：\n1. 票据是否已被消费（重复点击同一入口会复用旧页签 + 刷新票据）\n2. 角色是否仍为 admin / superadmin\n3. 服务端 audiences 白名单是否包含此 audience`);
            }
            return;
          }
          // 2) 加载失败（DNS / 网络 / 证书等）
          if (evt.type === 'fail') {
            if (!alerted.has(evt.tabId + ':fail')) {
              alerted.add(evt.tabId + ':fail');
              alert(`企业页面加载失败：${evt.errorDescription || '未知错误'} (${evt.errorCode || 'N/A'})\nURL: ${finalUrl}`);
            }
          }
        }
      });
    }
  }

  /**
   * 头像菜单切换
   */
  function toggleMenu(e) {
    e.stopPropagation();
    if (!userAvatar || !avatarMenu) return;
    const rect = userAvatar.getBoundingClientRect();
    avatarMenu.style.left = rect.left + 'px';
    avatarMenu.style.top = (rect.bottom + 4) + 'px';
    avatarMenu.classList.toggle('show');
  }

  /**
   * 根据 role 决定是否显示「企业管理」菜单项
   */
  function updateAdminMenuVisibility() {
    const menuItem = document.getElementById('enterpriseAdminMenu');
    if (!menuItem) return;
    if (_isAdmin()) {
      menuItem.style.display = '';
    } else {
      menuItem.style.display = 'none';
    }
  }

  /**
   * 设置动态页签的 loading 状态（在标题前/旁加 spinner）
   * @param {string} tabId
   * @param {boolean} loading
   */
  function setTabLoading(tabId, loading) {
    const tab = window.NavModule && window.NavModule.getDynamicTab(tabId);
    if (!tab || !tab.el) return;
    tab.el.classList.toggle('loading', !!loading);
  }

  /**
   * 更新动态页签标题
   */
  function updateTabTitle(tabId, title) {
    const tab = window.NavModule.getDynamicTab(tabId);
    if (!tab || !tab.titleEl) return;
    if (title && title !== tab.title) {
      tab.titleEl.textContent = title;
      tab.title = title;
      if (tab.el) tab.el.setAttribute('title', title);
    }
  }

  /**
   * 打开默认的「企业管理」入口（组织架构）
   * 1. 申请 SSO Ticket
   * 2. 创建/复用动态 webview tab
   */
  async function openEnterpriseDefault() {
    const audience = AUDIENCES.ORG;
    await openEnterpriseWeb(audience);
  }

  /**
   * 打开指定 audience 的企业 web 页
   * @param {{id: string, target: string, title: string}} audience
   *
   * 流程（性能优化版）：
   *   1. 校验角色
   *   2. 计算稳定 tabId
   *   3. 若 tab 已存在：立即激活 + 异步刷新 ticket（不等）
   *   4. 否则：立即创建占位 tab（loading）→ 切过去 → 后台 fetch ticket → 创建 webview
   *   5. webview 加载完成（标题更新 / did-navigate）后清除 loading
   */
  async function openEnterpriseWeb(audience) {
    if (!audience || !audience.id || !audience.target) {
      console.error('[EnterpriseSSO] audience 非法:', audience);
      return;
    }

    // 角色校验（前端预校验：服务端仍会二次校验）
    if (audience.requireAdmin && !_isAdmin()) {
      alert('该页面仅管理员可访问');
      return;
    }

    // 稳定 tabId：基于 audience，确保同一个入口只有一个页签
    const tabId = `enterprise-${audience.id.replace(/[^a-z0-9-]/gi, '-')}`;

    // 已存在：立即激活 + 异步刷新
    const existingTab = window.NavModule.getDynamicTab(tabId);
    if (existingTab) {
      window.NavModule.switchTab(tabId);
      // 后台静默刷新（不阻塞 UI）
      _refreshTicketInBackground(audience, tabId);
      return;
    }

    // 立即创建占位 tab 并切过去（不等 ticket 申请）
    setTabLoading(tabId, false); // 先重置
    const createdEl = window.NavModule.registerDynamicTab({
      tabId,
      title: audience.title, // 标题加载后会被 page-title-updated 覆盖
      iconSvg: ICONS.ORG,
      closable: true,
      audience: audience.id,
      target: audience.target,
      onActivate: () => {
        // 激活时确保 view 可见
        if (window.electronAPI && window.electronAPI.webviewShow) {
          window.electronAPI.webviewShow(tabId);
        }
      },
      onClose: () => {
        // 关闭 webview 的清理由 nav.js 的 unregisterDynamicTab 统一处理
      },
    });

    if (createdEl) {
      createdEl.classList.add('loading'); // 立即显示 spinner
    }
    window.NavModule.switchTab(tabId);

    // 2. 后台申请 ticket（命中缓存则 < 1ms；否则 200-800ms）
    let ticketData;
    try {
      ticketData = await _getOrFetchTicket(audience);
    } catch (err) {
      alert('申请 SSO 票据失败：' + (err.message || err));
      // 失败时关闭占位 tab
      window.NavModule.unregisterDynamicTab(tabId);
      return;
    }
    if (!ticketData || !ticketData.ticket) {
      alert('SSO 票据为空');
      window.NavModule.unregisterDynamicTab(tabId);
      return;
    }

    // 3. 计算 webview bounds
    const bounds = calculateWebviewBounds();
    if (!bounds) {
      alert('无法计算页面区域');
      window.NavModule.unregisterDynamicTab(tabId);
      return;
    }

    // 4. 拼装跳转 URL
    const redirectUrl = `${REDIRECT_BASE}/sso/redirect?ticket=${encodeURIComponent(ticketData.ticket)}`;

    // 5. 创建 webview 并立即激活
    //    必须传 activate: true —— _attachView 内部默认 setVisible(false),
    //    后续的 switchTab 派发的 tab-switched 在 50ms 后查 webviewGetInfo,
    //    此时 webview 才刚创建,信息可能尚未就绪(info.success=false 不会触发 webviewShow),
    //    所以需要主进程在创建后立刻 setActive 把 view 显示出来。
    try {
      const createRes = await window.electronAPI.webviewCreate(redirectUrl, bounds, {
        tabId,
        activate: true,
      });
      if (!createRes || !createRes.success) {
        alert('打开企业页面失败：' + (createRes && createRes.message ? createRes.message : '未知错误'));
        window.NavModule.unregisterDynamicTab(tabId);
        return;
      }
    } catch (err) {
      alert('加载企业页面失败：' + (err.message || err));
      window.NavModule.unregisterDynamicTab(tabId);
      return;
    }
    // 注：loading 状态会在 title 首次更新 / did-navigate 时被清除（监听器已设置）
  }

  /**
   * 后台静默刷新 ticket + loadURL（用于"已存在 tab 二次点击"场景）
   * - 不弹错误框（避免重复弹窗），失败仅记日志
   */
  async function _refreshTicketInBackground(audience, tabId) {
    try {
      const ticketData = await _getOrFetchTicket(audience);
      if (!ticketData || !ticketData.ticket) return;
      const bounds = calculateWebviewBounds();
      if (!bounds) return;
      const redirectUrl = `${REDIRECT_BASE}/sso/redirect?ticket=${encodeURIComponent(ticketData.ticket)}`;
      // 重新打开前显示 loading
      setTabLoading(tabId, true);
      await window.electronAPI.webviewCreate(redirectUrl, bounds, {
        tabId,
        activate: true,
      });
    } catch (err) {
      console.warn('[EnterpriseSSO] 后台刷新 SSO 票据失败:', err && err.message);
    }
  }

  /**
   * 计算 webview 在主窗口中的 bounds（与 webview.js 同样的算法）
   */
  function calculateWebviewBounds() {
    const container = document.getElementById('webviewContainer');
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  }

  // 暴露给其他模块
  window.EnterpriseSSOModule = {
    init,
    openEnterpriseDefault,
    openEnterpriseWeb,
    getCurrentUser: () => currentUser,
    AUDIENCES,
  };

  // 自动初始化：脚本加载后立即执行（页面 DOM 已就绪）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }
})();
