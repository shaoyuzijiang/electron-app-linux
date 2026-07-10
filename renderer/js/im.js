// ========== IM 即时通讯模块 ==========

let imInitialized = false;
let imWs = null;
let imWsReconnectDelay = 3000;
let imWsReconnectTimer = null;
let imWsConnected = false;
let imCurrentUserId = null;
let imCurrentUsername = null;

// 会话列表数据
let imConversations = [];
let imActiveConversationId = null;
let imMessages = {}; // { conversationId: [messages] }
let imMessagePage = {}; // { conversationId: { hasMore, oldestCreatedAt } }
let imLastLoadTime = {}; // { conversationId: timestamp } — 记录每次会话加载时间，用于防重复请求

// 输入中状态
let imTypingTimer = null;
let imTypingSent = false;
let imRemoteTyping = {}; // { conversationId: timer }

// ---------- 初始化 ----------

async function initIM() {
  if (imInitialized) return;
  imInitialized = true;

  // 获取用户信息
  try {
    const profileResult = await window.electronAPI.getProfile();
    if (profileResult.success) {
      imCurrentUserId = profileResult.profile.id;
      imCurrentUsername = profileResult.profile.username;
    }
  } catch (err) {
    console.error('[IM] 获取用户信息失败:', err);
  }

  bindIMEvents();
  await loadConversations(true); // 首次进入强制刷新，确保拿到最新数据
  connectIMWebSocket();
}

// ---------- WebSocket 连接管理 ----------

async function connectIMWebSocket() {
  if (imWs && (imWs.readyState === WebSocket.OPEN || imWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  updateWSStatus('connecting');

  try {
    const tokenResult = await window.electronAPI.getAccessToken();
    if (!tokenResult.success) {
      console.error('[IM] 获取 token 失败:', tokenResult.message);
      updateWSStatus('disconnected');
      if (tokenResult.message?.includes('过期') || tokenResult.message?.includes('重新登录')) {
        console.warn('[IM] Token 已失效（refresh token 过期），停止重连，将跳转登录页');
        return; // 主进程已负责跳转 login.html，此处不重连
      }
      scheduleReconnect();
      return;
    }

    const wsUrlResult = await window.electronAPI.getWsUrl();
    const wsBaseUrl = wsUrlResult.url;
    const wsUrl = `${wsBaseUrl}?token=${encodeURIComponent(tokenResult.accessToken)}`;

    console.log('[IM] 连接 WebSocket:', wsBaseUrl);
    imWs = new WebSocket(wsUrl);

    imWs.onopen = () => {
      console.log('[IM] WebSocket 已连接');
      imWsConnected = true;
      imWsReconnectDelay = 3000;
      updateWSStatus('connected');
    };

    imWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWSMessage(msg);
      } catch (err) {
        console.error('[IM] 解析 WebSocket 消息失败:', err);
      }
    };

    imWs.onerror = (err) => {
      console.error('[IM] WebSocket 错误:', err);
    };

    imWs.onclose = (event) => {
      console.log('[IM] WebSocket 关闭, code:', event.code);
      imWsConnected = false;
      imWs = null;
      updateWSStatus('disconnected');

      if (event.code === 4001) {
        // Token 过期，需要刷新后重连
        console.log('[IM] Token 过期，尝试刷新后重连');
        scheduleReconnect(1000);
      } else if (event.code === 4002) {
        console.warn('[IM] 连接数超限');
      } else {
        scheduleReconnect();
      }
    };
  } catch (err) {
    console.error('[IM] WebSocket 连接异常:', err);
    updateWSStatus('disconnected');
    scheduleReconnect();
  }
}

function scheduleReconnect(delay) {
  if (imWsReconnectTimer) clearTimeout(imWsReconnectTimer);
  const d = delay || imWsReconnectDelay;
  console.log(`[IM] ${d}ms 后重连`);
  imWsReconnectTimer = setTimeout(() => {
    imWsReconnectDelay = Math.min(imWsReconnectDelay * 2, 30000); // 指数退避，最大30s
    connectIMWebSocket();
  }, d);
}

function updateWSStatus(status) {
  const el = document.getElementById('imWsStatus');
  if (el) {
    el.className = `im-ws-status ${status}`;
  }
}

// ---------- WebSocket 消息处理 ----------

function handleWSMessage(msg) {
  switch (msg.action) {
    case 'connected':
      imCurrentUserId = msg.data.userId;
      imCurrentUsername = msg.data.username;
      break;

    case 'message': {
      const data = msg.data;
      addMessageToCache(data.conversationId, data);
      if (data.conversationId === imActiveConversationId) {
        appendMessage(data);
        scrollMessagesToBottom();
        // 如果是当前会话，标记已读
        markConversationRead(data.conversationId);
      } else {
        // 更新会话列表未读数
        updateConversationUnread(data.conversationId, 1);
      }
      // 更新会话列表的最后消息
      updateConversationLastMessage(data.conversationId, data);
      break;
    }

    case 'read':
      // 对方已读回执，可以更新 UI
      break;

    case 'typing': {
      if (msg.conversationId === imActiveConversationId && msg.userId !== imCurrentUserId) {
        showTypingIndicator(msg.username || '对方');
      }
      break;
    }

    case 'ping':
      wsSend({ action: 'pong' });
      break;

    case 'added_to_conversation':
      // 被加入新会话，强制刷新会话列表（本地肯定没有这个新会话）
      refreshConversationsFromServer();
      break;

    case 'removed_from_conversation':
      // 被移出会话
      if (msg.data && msg.data.conversationId === imActiveConversationId) {
        imActiveConversationId = null;
        renderChatEmpty();
      }
      refreshConversationsFromServer();
      break;

    case 'conversation_updated': {
      // 群信息更新（群名/群头像）
      handleConversationUpdated(msg.data);
      break;
    }

    case 'conversation_dissolved': {
      // 群已解散
      handleConversationDissolved(msg.data);
      break;
    }

    case 'ownership_transferred': {
      // 群主转让
      handleOwnershipTransferred(msg.data);
      break;
    }

    case 'role_changed': {
      // 角色变更（设置/取消管理员）
      handleRoleChanged(msg.data);
      break;
    }

    case 'message_update': {
      handleMessageUpdate(msg.data);
      break;
    }

    case 'error':
      console.error('[IM] WebSocket 错误消息:', msg.message);
      break;
  }
}

/**
 * 处理消息更新事件（如会议结束后卡片自动置灰）
 * 文档 7.4.9 / 8.5
 */
function handleMessageUpdate(data) {
  if (!data || !data.id || !data.conversationId) return;

  // 1. 更新当前会话的消息列表
  if (data.conversationId === imActiveConversationId) {
    const msgs = imMessages[data.conversationId];
    if (msgs) {
      const msg = msgs.find((m) => m.id === data.id);
      if (msg) {
        msg.content = data.content;
        renderMessages(msgs);
      }
    }
  }

  // 2. 更新 IndexedDB 缓存（cacheMessages 使用 put，存在则更新）
  if (window.IMCache) {
    window.IMCache.cacheMessages([data]).catch((err) => {
      console.warn('[IM] 更新缓存消息失败:', err);
    });
  }

  // 3. 更新会话列表的最后消息预览
  const conv = imConversations.find((c) => c.id === data.conversationId);
  if (conv && conv.lastMessage && conv.lastMessage.id === data.id) {
    conv.lastMessage.content = data.content;
    renderConversationList();
  }
}

/**
 * 处理群信息更新事件（群名/群头像变更）
 * 文档 7.4.10 / 8.9
 */
function handleConversationUpdated(data) {
  if (!data || !data.conversationId) return;
  const conv = imConversations.find((c) => c.id === data.conversationId);
  if (conv) {
    if (data.name !== null && data.name !== undefined) conv.name = data.name;
    if (data.avatar !== null && data.avatar !== undefined) conv.avatar = data.avatar;
    renderConversationList();
    // 如果当前正在查看该会话，更新头部
    if (data.conversationId === imActiveConversationId) {
      renderChatHeader(conv);
    }
    // 同步更新本地缓存
    if (window.IMCache) {
      window.IMCache.updateCachedConversation(conv).catch(() => {});
    }
  }
}

/**
 * 处理群已解散事件
 * 文档 7.4.11 / 8.9
 */
function handleConversationDissolved(data) {
  if (!data || !data.conversationId) return;
  // 从会话列表中移除
  imConversations = imConversations.filter((c) => c.id !== data.conversationId);
  // 关闭对应聊天窗口
  if (data.conversationId === imActiveConversationId) {
    imActiveConversationId = null;
    renderChatEmpty();
  }
  renderConversationList();
  updateTotalUnreadBadge();
  // 清理本地消息缓存
  if (window.IMCache) {
    window.IMCache.clearConversationCache(data.conversationId).catch(() => {});
  }
}

/**
 * 处理群主转让事件
 * 文档 7.4.12 / 8.9
 */
function handleOwnershipTransferred(data) {
  if (!data || !data.conversationId || !data.newOwnerId) return;
  const conv = imConversations.find((c) => c.id === data.conversationId);
  if (!conv) return;

  // 更新成员列表角色：原群主降为 member，新群主升为 owner
  if (conv.members) {
    const oldOwner = conv.members.find((m) => m.role === 'owner');
    if (oldOwner) oldOwner.role = 'member';
    const newOwner = conv.members.find((m) => m.userId === data.newOwnerId);
    if (newOwner) newOwner.role = 'owner';
  }
  // 更新会话的 createdBy
  conv.createdBy = data.newOwnerId;

  // 若当前用户是当事人，更新自身角色
  if (imCurrentUserId === data.newOwnerId) {
    conv.role = 'owner';
  } else if (conv.role === 'owner') {
    conv.role = 'member';
  }

  renderConversationList();
  // 如果当前正在查看该会话，刷新头部和群信息弹窗
  if (data.conversationId === imActiveConversationId) {
    renderChatHeader(conv);
    // 如果群信息弹窗打开，刷新成员列表
    const groupInfoModal = document.getElementById('imGroupInfoModal');
    if (groupInfoModal && groupInfoModal.classList.contains('show')) {
      loadGroupInfoMembers(data.conversationId);
    }
  }
  if (window.IMCache) {
    window.IMCache.updateCachedConversation(conv).catch(() => {});
  }
}

/**
 * 处理角色变更事件（设置/取消管理员）
 * 文档 7.4.13 / 8.9
 */
function handleRoleChanged(data) {
  if (!data || !data.conversationId || !data.role) return;
  const conv = imConversations.find((c) => c.id === data.conversationId);
  if (!conv) return;

  // 更新当前用户在该会话中的 role
  conv.role = data.role;

  renderConversationList();
  // 如果当前正在查看该会话，刷新头部和群信息弹窗
  if (data.conversationId === imActiveConversationId) {
    renderChatHeader(conv);
    const groupInfoModal = document.getElementById('imGroupInfoModal');
    if (groupInfoModal && groupInfoModal.classList.contains('show')) {
      loadGroupInfoMembers(data.conversationId);
    }
  }
  if (window.IMCache) {
    window.IMCache.updateCachedConversation(conv).catch(() => {});
  }
}

function wsSend(data) {
  if (imWs && imWs.readyState === WebSocket.OPEN) {
    imWs.send(JSON.stringify(data));
    return true;
  }
  return false;
}

// ---------- 会话列表 ----------

// 会话列表刷新节流：30 秒内不重复请求服务器
const CONV_REFRESH_INTERVAL = 30 * 1000;
let lastConvLoadAt = 0;

/**
 * 加载会话列表（本地优先 + 节流）
 * @param {boolean} force - 强制刷新，跳过节流
 */
async function loadConversations(force = false) {
  // 1) 总是先读本地缓存，快速渲染
  try {
    const cachedConvs = await window.IMCache.getCachedConversations();
    if (cachedConvs && cachedConvs.length > 0) {
      imConversations = cachedConvs;
      renderConversationList();
      updateTotalUnreadBadge();
    }
  } catch (cacheErr) {
    console.warn('[IM] 读取本地会话缓存失败:', cacheErr);
  }

  // 2) 30 秒内非强制刷新 → 直接返回，不再请求服务器
  if (!force && Date.now() - lastConvLoadAt < CONV_REFRESH_INTERVAL) {
    return;
  }

  // 3) 否则问服务器
  await refreshConversationsFromServer();
}

/**
 * 主动刷新会话列表（强制问服务器 + 写本地 + 重渲染）
 * 用于：被加入/移出会话、发送消息后等需要服务器权威数据的场景
 */
async function refreshConversationsFromServer() {
  lastConvLoadAt = Date.now();
  try {
    const result = await window.electronAPI.imGetConversations();
    if (result.success && result.data) {
      imConversations = result.data;
      renderConversationList();
      updateTotalUnreadBadge();
      await window.IMCache.cacheConversations(result.data);
    }
  } catch (err) {
    console.error('[IM] 刷新会话列表失败:', err);
    // 服务器拉取失败时，尝试用本地缓存兜底
    if (imConversations.length === 0) {
      try {
        const cachedConvs = await window.IMCache.getCachedConversations();
        if (cachedConvs && cachedConvs.length > 0) {
          imConversations = cachedConvs;
          renderConversationList();
          updateTotalUnreadBadge();
        }
      } catch (cacheErr) {
        console.warn('[IM] 读取本地会话缓存失败:', cacheErr);
      }
    }
  }
}

function renderConversationList() {
  const container = document.getElementById('imConversationList');
  if (!container) return;

  if (!imConversations || imConversations.length === 0) {
    container.innerHTML = `<div class="meeting-empty" style="padding:40px 0;">
      <svg viewBox="0 0 24 24" width="40" height="40"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="#ddd"/></svg>
      <div>暂无会话</div>
    </div>`;
    return;
  }

  container.innerHTML = imConversations.map((conv) => {
    const isActive = conv.id === imActiveConversationId;
    const initial = getConversationInitial(conv);
    const isGroup = conv.type === 'group';
    const lastMsg = formatLastMessagePreview(conv.lastMessage);
    const lastTime = conv.lastMessage ? formatMessageTime(conv.lastMessage.createdAt) : '';
    const unread = conv.unreadCount > 0 ? `<span class="im-conv-unread">${conv.unreadCount > 99 ? '99+' : conv.unreadCount}</span>` : '';

    return `
      <div class="im-conv-item ${isActive ? 'active' : ''}" data-conv-id="${escapeHtml(conv.id)}">
        <div class="im-conv-avatar ${isGroup ? 'group' : ''}">${escapeHtml(initial)}</div>
        <div class="im-conv-info">
          <div class="im-conv-top-row">
            <span class="im-conv-name">${escapeHtml(conv.name || '未命名会话')}</span>
            <span class="im-conv-time">${escapeHtml(lastTime)}</span>
          </div>
          <div class="im-conv-bottom-row">
            <span class="im-conv-last-msg">${escapeHtml(lastMsg)}</span>
            ${unread}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function getConversationInitial(conv) {
  if (conv.type === 'group') {
    return (conv.name || '群').charAt(0).toUpperCase();
  }
  return (conv.name || '?').charAt(0).toUpperCase();
}

function formatLastMessagePreview(lastMessage) {
  if (!lastMessage) return '';
  switch (lastMessage.type) {
    case 'text':
      return lastMessage.content;
    case 'image':
      return '[图片]';
    case 'file':
      return '[文件]';
    case 'card':
      try {
        const cardData = typeof lastMessage.content === 'string' ? JSON.parse(lastMessage.content) : lastMessage.content;
        if (cardData.meetingCode) return '[会议邀请]';
        return '[卡片]';
      } catch {
        return '[卡片]';
      }
    case 'system':
      return '[系统消息]';
    default:
      return lastMessage.content || '';
  }
}

function formatMessageTime(timeStr) {
  if (!timeStr) return '';
  // timeStr 格式: "2025-06-23 14:30:00"
  const parts = timeStr.split(' ');
  if (parts.length < 2) return timeStr;
  const timePart = parts[1].substring(0, 5);

  const today = new Date();
  const msgDate = new Date(parts[0]);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  if (parts[0] === todayStr) return timePart;

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (parts[0] === yesterdayStr) return '昨天';

  return parts[0].substring(5); // MM-DD
}

function updateConversationUnread(convId, increment) {
  const conv = imConversations.find((c) => c.id === convId);
  if (conv) {
    conv.unreadCount = (conv.unreadCount || 0) + increment;
    renderConversationList();
    updateTotalUnreadBadge();
  }
}

function updateConversationLastMessage(convId, message) {
  const conv = imConversations.find((c) => c.id === convId);
  if (conv) {
    conv.lastMessage = message;
    conv.updatedAt = message.createdAt;
    // 将会话移到列表顶部
    const idx = imConversations.indexOf(conv);
    if (idx > 0) {
      imConversations.splice(idx, 1);
      imConversations.unshift(conv);
    }
    renderConversationList();
    // 同步更新本地缓存
    if (window.IMCache) {
      window.IMCache.updateCachedConversation(conv).catch(() => {});
    }
  }
}

async function updateTotalUnreadBadge() {
  const total = imConversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const badge = document.getElementById('imNavBadge');
  if (badge) {
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.style.display = total > 0 ? '' : 'none';
  }
}

// ---------- 会话选择与消息加载 ----------

async function selectConversation(convId) {
  imActiveConversationId = convId;
  renderConversationList();

  const conv = imConversations.find((c) => c.id === convId);
  if (!conv) return;

  // 渲染聊天头部
  renderChatHeader(conv);

  // 加载消息（内部会判断是否需要增量同步）
  await loadMessages(convId);
  imLastLoadTime[convId] = Date.now();

  // 标记已读
  await markConversationRead(convId);

  // 清除未读
  if (conv.unreadCount > 0) {
    conv.unreadCount = 0;
    renderConversationList();
    updateTotalUnreadBadge();
  }
}

async function loadMessages(convId, loadMore = false) {
  const container = document.getElementById('imMessagesContainer');

  if (!loadMore) {
    imMessages[convId] = [];
    imMessagePage[convId] = { hasMore: false, oldestCreatedAt: null };
    container.innerHTML = `<div class="meeting-loading"><div class="spinner-small"></div><span>加载中...</span></div>`;
  }

  try {
    if (!loadMore) {
      // ---- 初始加载：本地缓存优先 ----
      const cachedMsgs = await window.IMCache.getCachedMessages(convId, 50);

      if (cachedMsgs && cachedMsgs.length > 0) {
        // 1. 立即渲染本地缓存，无需等待网络
        imMessages[convId] = cachedMsgs;
        imMessagePage[convId] = {
          hasMore: true,
          oldestCreatedAt: cachedMsgs[0].createdAt,
        };
        renderMessages(cachedMsgs);
        scrollMessagesToBottom();

        // 2. 增量同步：从服务器拉取本地最新消息之后的新消息
        //    如果距离上次加载不超过 10 秒，跳过增量同步（新消息已由 WebSocket 实时推送）
        const lastLoad = imLastLoadTime[convId] || 0;
        if (Date.now() - lastLoad >= 10000) {
          const latestCached = cachedMsgs[cachedMsgs.length - 1].createdAt;
          try {
            const incResult = await window.electronAPI.imGetMessages(convId, {
              after: latestCached,
              limit: 50,
            });
            if (incResult.success && incResult.data && incResult.data.length > 0) {
              const newMsgs = incResult.data;
              await window.IMCache.cacheMessages(newMsgs);
              imMessages[convId] = [...cachedMsgs, ...newMsgs];
              renderMessages(imMessages[convId]);
              scrollMessagesToBottom();
            }
          } catch (incErr) {
            console.warn('[IM] 增量同步失败，使用本地缓存:', incErr);
          }
        }

        // 更新分页状态
        const syncState = await window.IMCache.getSyncState(convId);
        const cachedCount = await window.IMCache.getCachedMessageCount(convId);
        const localOldest = await window.IMCache.getOldestCachedCreatedAt(convId);
        imMessagePage[convId].oldestCreatedAt = localOldest || cachedMsgs[0].createdAt;
        // 本地有更多消息 或 远程可能还有更多
        imMessagePage[convId].hasMore =
          cachedCount > imMessages[convId].length || !(syncState && syncState.noMoreRemote);
        renderMessages(imMessages[convId]);
        scrollMessagesToBottom();
        return;
      }

      // 3. 本地无缓存，从服务器全量拉取
      const result = await window.electronAPI.imGetMessages(convId, { limit: 50 });
      if (result.success && result.data) {
        const msgs = result.data;
        await window.IMCache.cacheMessages(msgs);
        imMessages[convId] = msgs;
        renderMessages(msgs);
        scrollMessagesToBottom();

        if (msgs.length > 0) {
          const hasMore = msgs.length >= 50;
          imMessagePage[convId] = {
            hasMore,
            oldestCreatedAt: msgs[0].createdAt,
          };
          await window.IMCache.setSyncState(convId, {
            noMoreRemote: !hasMore,
            oldestLocalCreatedAt: msgs[0].createdAt,
          });
        }
      }
    } else {
      // ---- 加载更多：本地缓存优先 ----
      const oldestCurrent = imMessagePage[convId] && imMessagePage[convId].oldestCreatedAt;
      if (!oldestCurrent) return;

      // 尝试从本地缓存读取更早的消息
      const olderMsgs = await window.IMCache.getOlderCachedMessages(convId, oldestCurrent, 50);

      if (olderMsgs && olderMsgs.length > 0) {
        const prevScrollHeight = container.scrollHeight;
        imMessages[convId] = [...olderMsgs, ...(imMessages[convId] || [])];
        renderMessages(imMessages[convId]);
        container.scrollTop = container.scrollHeight - prevScrollHeight;

        // 更新分页状态
        const localOldest = await window.IMCache.getOldestCachedCreatedAt(convId);
        imMessagePage[convId].oldestCreatedAt = localOldest || olderMsgs[0].createdAt;
        const syncState = await window.IMCache.getSyncState(convId);
        const cachedCount = await window.IMCache.getCachedMessageCount(convId);
        imMessagePage[convId].hasMore =
          cachedCount > imMessages[convId].length || (syncState && !syncState.noMoreRemote);
        renderMessages(imMessages[convId]);
        container.scrollTop = container.scrollHeight - prevScrollHeight;
        return;
      }

      // 本地没有更早的消息，检查服务器是否还有更多
      const syncState = await window.IMCache.getSyncState(convId);
      if (syncState && syncState.noMoreRemote) {
        imMessagePage[convId].hasMore = false;
        renderMessages(imMessages[convId]);
        return;
      }

      // 从服务器拉取更早的消息
      const result = await window.electronAPI.imGetMessages(convId, {
        before: oldestCurrent,
        limit: 50,
      });
      if (result.success && result.data) {
        const msgs = result.data;
        if (msgs.length > 0) {
          await window.IMCache.cacheMessages(msgs);
          const prevScrollHeight = container.scrollHeight;
          imMessages[convId] = [...msgs, ...(imMessages[convId] || [])];
          renderMessages(imMessages[convId]);
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        }

        const hasMore = msgs.length >= 50;
        imMessagePage[convId] = {
          hasMore,
          oldestCreatedAt: msgs.length > 0 ? msgs[0].createdAt : oldestCurrent,
        };
        if (!hasMore) {
          await window.IMCache.setSyncState(convId, {
            noMoreRemote: true,
            oldestLocalCreatedAt: imMessagePage[convId].oldestCreatedAt,
          });
        }
      }
    }
  } catch (err) {
    console.error('[IM] 加载消息失败:', err);
    if (!loadMore) {
      container.innerHTML = `<div class="meeting-empty">加载消息失败</div>`;
    }
  }
}

function renderMessages(messages) {
  const container = document.getElementById('imMessagesContainer');
  if (!messages || messages.length === 0) {
    container.innerHTML = `<div class="meeting-empty" style="padding:60px 0;">暂无消息</div>`;
    return;
  }

  // 加载更多按钮
  const convId = imActiveConversationId;
  const page = imMessagePage[convId];
  const loadMoreHtml = (page && page.hasMore) ?
    `<div class="im-loading-more" id="imLoadMoreBtn">加载更多消息</div>` : '';

  container.innerHTML = loadMoreHtml + messages.map((msg) => renderMessageHTML(msg)).join('');
}

function renderMessageHTML(msg) {
  const isSelf = msg.senderId === imCurrentUserId;
  const isSystem = msg.type === 'system' || msg.senderId === 'system';

  if (isSystem) {
    let systemText = '';
    try {
      const sysData = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
      if (sysData.action === 'conversation_created') {
        systemText = `会话「${sysData.conversationName || ''}」已创建`;
      } else {
        systemText = msg.content;
      }
    } catch {
      systemText = msg.content;
    }
    return `
      <div class="im-message-row system">
        <div class="im-msg-content-wrap">
          <div class="im-msg-bubble system">${escapeHtml(systemText)}</div>
        </div>
      </div>
    `;
  }

  const initial = (msg.senderName || '?').charAt(0).toUpperCase();
  let contentHTML = '';

  switch (msg.type) {
    case 'text':
      contentHTML = `<div class="im-msg-bubble">${escapeHtml(msg.content)}</div>`;
      break;

    case 'image': {
      try {
        const imgData = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
        contentHTML = `<div class="im-msg-bubble" style="padding:4px;"><img class="im-msg-image" data-url="${escapeHtml(imgData.url || '')}" src="" alt="${escapeHtml(imgData.filename || '')}" /></div>`;
      } catch {
        contentHTML = `<div class="im-msg-bubble">[图片解析失败]</div>`;
      }
      break;
    }

    case 'file': {
      try {
        const fileData = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
        const fileSize = formatFileSize(fileData.size || 0);
        contentHTML = `<div class="im-msg-file" data-url="${escapeHtml(fileData.url || '')}">
          <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
          <div class="im-msg-file-info">
            <span class="im-msg-file-name">${escapeHtml(fileData.filename || '文件')}</span>
            <span class="im-msg-file-size">${escapeHtml(fileSize)}</span>
          </div>
        </div>`;
      } catch {
        contentHTML = `<div class="im-msg-bubble">[文件解析失败]</div>`;
      }
      break;
    }

    case 'card': {
      try {
        const cardData = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
        if (cardData.meetingCode) {
          contentHTML = renderMeetingCardBubble(cardData);
        } else if (cardData.title) {
          const isCardDisabled = cardData.disabled === true;
          const cardDisabledClass = isCardDisabled ? ' disabled' : '';
          contentHTML = `<div class="im-msg-card im-msg-generic-card${cardDisabledClass}">
            ${cardData.imageUrl ? `<img class="im-card-cover" src="${escapeHtml(cardData.imageUrl)}" />` : ''}
            <div class="im-card-header"><span class="im-card-title">${escapeHtml(cardData.title)}</span></div>
            ${cardData.description ? `<div class="im-card-body"><div class="im-card-desc">${escapeHtml(cardData.description)}</div></div>` : ''}
            ${isCardDisabled
              ? `<div class="im-card-link disabled">已失效</div>`
              : (cardData.url ? `<a class="im-card-link" href="${escapeHtml(cardData.url)}" target="_blank">查看详情</a>` : '')}
          </div>`;
        } else {
          contentHTML = `<div class="im-msg-bubble">[卡片]</div>`;
        }
      } catch {
        contentHTML = `<div class="im-msg-bubble">[卡片解析失败]</div>`;
      }
      break;
    }

    default:
      contentHTML = `<div class="im-msg-bubble">${escapeHtml(msg.content || '')}</div>`;
  }

  const senderName = isSelf ? '' : `<div class="im-msg-sender">${escapeHtml(msg.senderName || '')}</div>`;
  const time = formatMessageTime(msg.createdAt);

  return `
    <div class="im-message-row ${isSelf ? 'self' : ''}">
      <div class="im-msg-avatar">${escapeHtml(initial)}</div>
      <div class="im-msg-content-wrap">
        ${senderName}
        ${contentHTML}
        <div class="im-msg-time">${escapeHtml(time)}</div>
      </div>
    </div>
  `;
}

function renderMeetingCardBubble(cardData) {
  const isDisabled = cardData.disabled === true;
  const subject = escapeHtml(cardData.title || '快速会议');
  const meetingCode = escapeHtml(cardData.meetingCode || '');
  const startTime = escapeHtml(cardData.startTime || '');
  const status = escapeHtml(cardData.status || '');
  const disabledClass = isDisabled ? ' disabled' : '';

  return `
    <div class="im-msg-card im-msg-meeting-card${disabledClass}" data-meeting-code="${meetingCode}">
      <div class="im-card-header">
        <svg viewBox="0 0 24 24" class="im-card-icon"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
        <span class="im-card-title">${subject}</span>
      </div>
      <div class="im-card-body">
        <div class="im-card-row">
          <span class="im-card-label">会议号</span>
          <span class="im-card-value im-card-code">${meetingCode}</span>
        </div>
        ${startTime ? `<div class="im-card-row">
          <span class="im-card-label">时间</span>
          <span class="im-card-value">${startTime}</span>
        </div>` : ''}
        ${status ? `<div class="im-card-status ${status === '进行中' ? 'active' : ''}">${status}</div>` : ''}
      </div>
      ${isDisabled
        ? `<div class="im-card-action disabled">已失效</div>`
        : `<div class="im-card-action" data-meeting-code="${meetingCode}">加入会议</div>`}
    </div>
  `;
}

function appendMessage(msg) {
  const container = document.getElementById('imMessagesContainer');
  if (!container) return;

  // 移除空状态
  const emptyEl = container.querySelector('.meeting-empty');
  if (emptyEl) emptyEl.remove();

  container.insertAdjacentHTML('beforeend', renderMessageHTML(msg));
}

function scrollMessagesToBottom() {
  const container = document.getElementById('imMessagesContainer');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

function addMessageToCache(convId, msg) {
  if (!imMessages[convId]) imMessages[convId] = [];
  // 避免重复
  if (!imMessages[convId].find((m) => m.id === msg.id)) {
    imMessages[convId].push(msg);
  }
  // 持久化到 IndexedDB
  if (window.IMCache) {
    window.IMCache.cacheMessages([msg]).catch((err) => {
      console.warn('[IM] 缓存消息到 IndexedDB 失败:', err);
    });
  }
}

// ---------- 聊天头部渲染 ----------

function renderChatHeader(conv) {
  const headerEl = document.getElementById('imChatHeader');
  const isGroup = conv.type === 'group';
  const memberCount = conv.members ? conv.members.length : 0;
  const subtitle = isGroup ? `${memberCount} 人` : '';

  headerEl.innerHTML = `
    <div>
      <div class="im-chat-title">${escapeHtml(conv.name || '未命名会话')}</div>
      ${subtitle ? `<div class="im-chat-subtitle">${escapeHtml(subtitle)}</div>` : ''}
    </div>
    <div class="im-chat-actions">
      ${isGroup ? `<button class="im-icon-btn" id="imGroupInfoBtn" title="群信息">
        <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
      </button>` : ''}
    </div>
  `;

  // 显示聊天内容区
  document.getElementById('imChatEmpty').style.display = 'none';
  document.getElementById('imChatContent').style.display = 'flex';

  // 绑定群信息按钮（所有群成员可见，弹窗内根据角色显示/隐藏管理功能）
  const groupInfoBtn = document.getElementById('imGroupInfoBtn');
  if (groupInfoBtn) {
    groupInfoBtn.addEventListener('click', () => showGroupInfoModal(conv));
  }
}

function renderChatEmpty() {
  document.getElementById('imChatEmpty').style.display = '';
  document.getElementById('imChatContent').style.display = 'none';
  const headerEl = document.getElementById('imChatHeader');
  headerEl.innerHTML = '';
}

// ---------- 发送消息 ----------

async function sendMessage() {
  const input = document.getElementById('imMessageInput');
  const content = input.value.trim();
  if (!content || !imActiveConversationId) return;

  const convId = imActiveConversationId;

  // 优先通过 WebSocket 发送
  const sent = wsSend({
    action: 'send',
    conversationId: convId,
    type: 'text',
    content: content,
  });

  if (!sent) {
    // WebSocket 不可用，使用 HTTP 备用通道
    try {
      const result = await window.electronAPI.imSendMessage(convId, 'text', content);
      if (!result.success) {
        alert(result.message || '发送失败');
        return;
      }
    } catch (err) {
      alert('发送失败: ' + err.message);
      return;
    }
  }

  input.value = '';
  updateSendButton();

  // 停止输入中状态
  if (imTypingSent) {
    imTypingSent = false;
  }

  // 发送消息后主动刷一次会话列表（拿服务器权威的未读数/最后一条消息时间等元信息）
  // 节流保护：30s 内多次发消息只发一次请求
  refreshConversationsFromServer();
}

// ---------- 输入中状态 ----------

function handleTyping() {
  if (!imActiveConversationId) return;

  // 发送输入状态（节流：每3秒最多发一次）
  if (!imTypingSent) {
    wsSend({ action: 'typing', conversationId: imActiveConversationId });
    imTypingSent = true;
    setTimeout(() => { imTypingSent = false; }, 3000);
  }

  clearTimeout(imTypingTimer);
}

function showTypingIndicator(username) {
  const indicator = document.getElementById('imTypingIndicator');
  if (indicator) {
    indicator.textContent = `${username} 正在输入...`;
    clearTimeout(imRemoteTyping[imActiveConversationId]);
    imRemoteTyping[imActiveConversationId] = setTimeout(() => {
      indicator.textContent = '';
    }, 3000);
  }
}

// ---------- 标记已读 ----------

async function markConversationRead(convId) {
  // 优先通过 WebSocket 标记
  if (!wsSend({ action: 'markRead', conversationId: convId })) {
    // WebSocket 不可用，使用 HTTP
    try {
      await window.electronAPI.imMarkRead(convId);
    } catch (err) {
      console.error('[IM] 标记已读失败:', err);
    }
  }
}

// ---------- 文件上传 ----------

async function handleFileUpload(file, isImage) {
  if (!imActiveConversationId) return;
  if (!file) return;

  // 限制 20MB
  if (file.size > 20 * 1024 * 1024) {
    alert('文件大小不能超过 20MB');
    return;
  }

  // file.type 在 contextIsolation 下可能为空，根据扩展名推断 MIME 类型
  const extMimeMap = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.txt': 'text/plain', '.csv': 'text/csv',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
    '.json': 'application/json',
  };
  let mimetype = file.type;
  if (!mimetype) {
    const ext = file.name.toLowerCase().match(/\.[^.]+$/);
    mimetype = ext ? (extMimeMap[ext] || 'application/octet-stream') : 'application/octet-stream';
  }

  // 服务端允许的 MIME 白名单
  const ALLOWED_MIMES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
    'text/plain', 'text/csv', 'application/json',
    'video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/mp4',
  ]);
  if (!ALLOWED_MIMES.has(mimetype)) {
    alert(`不支持的文件类型: ${mimetype}\n支持的类型: 图片、PDF、Word/Excel/PPT、压缩包(zip/rar/7z)、文本/CSV/JSON、MP4/MP3`);
    return;
  }

  const convId = imActiveConversationId;
  const btn = isImage ? document.getElementById('imImageBtn') : document.getElementById('imFileBtn');
  btn.disabled = true;

  try {
    // 用 FileReader 在渲染进程读取文件内容，避免依赖 file.path（contextIsolation 下可能不可用）
    let fileArrayBuffer;
    if (file.path) {
      // 如果 path 可用，优先让主进程读取（性能更好）
    } else {
      const reader = new FileReader();
      fileArrayBuffer = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsArrayBuffer(file);
      });
    }

    const result = await window.electronAPI.imUploadFile(file.path || null, file.name, mimetype, fileArrayBuffer || null);

    if (result.success && result.data) {
      const uploadData = result.data;
      const msgType = isImage ? 'image' : 'file';
      const msgContent = JSON.stringify({
        url: uploadData.url,
        filename: uploadData.filename,
        size: uploadData.size,
      });

      const sent = wsSend({
        action: 'send',
        conversationId: convId,
        type: msgType,
        content: msgContent,
      });

      if (!sent) {
        const httpResult = await window.electronAPI.imSendMessage(convId, msgType, msgContent);
        if (!httpResult.success) {
          alert(httpResult.message || '发送失败');
        }
      }
    } else {
      alert(result.message || '上传失败');
    }
  } catch (err) {
    alert('上传失败: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- 发起会议并发送邀请卡片 ----------

async function sendMeetingInvite() {
  if (!imActiveConversationId) {
    alert('请先选择一个会话');
    return;
  }

  const btn = document.getElementById('imMeetingBtn');
  btn.disabled = true;

  try {
    // 1. 调用腾讯会议 SDK 快速会议接口
    const quickResult = await window.electronAPI.quickMeeting();
    if (!quickResult.success) {
      alert(quickResult.message || '发起快速会议失败');
      return;
    }

    // 2. 等待 OnJoinMeeting 回调获取 meeting_code
    const meetingCode = await new Promise((resolve) => {
      let done = false;

      const timer = setTimeout(() => {
        done = true;
        resolve(null);
      }, 30000);

      function handler(rawMsg) {
        if (done) return;
        try {
          const cb = typeof rawMsg === 'string' ? JSON.parse(rawMsg) : rawMsg;
          // SDK 回调中 code 是字符串 "0" 表示成功
          if (cb.func === 'OnJoinMeeting' && String(cb.code) === '0') {
            done = true;
            clearTimeout(timer);
            const code = (cb.param && cb.param.meeting_code) || cb.meeting_code || cb.meetingCode || '';
            resolve(code);
          }
        } catch {}
      }

      window.electronAPI.onSdkCallback(handler);
    });

    if (!meetingCode) {
      alert('已发起快速会议，但未收到入会成功回调，无法获取会议号');
      return;
    }

    // 3. 获取会话成员，调用 SDK AddUsersWithParam 呼叫对方入会
    try {
      const membersResult = await window.electronAPI.imGetMembers(imActiveConversationId);
      if (membersResult.success && membersResult.data) {
        const otherUserIds = membersResult.data
          .filter((m) => m.userId !== imCurrentUserId)
          .map((m) => m.userId);
        if (otherUserIds.length > 0) {
          const jsonParam = JSON.stringify({
            users: otherUserIds,
            user_type: 3, // 会中邀请入会
          });
          await window.electronAPI.addUsersWithParam(jsonParam);
        }
      }
    } catch (e) {
      console.warn('[IM] AddUsersWithParam 调用失败:', e.message);
    }

    // 4. 构造并发送会议邀请卡片消息
    const cardContent = JSON.stringify({
      title: '快速会议',
      description: meetingCode,
      url: '',
      meetingCode: meetingCode,
      status: '进行中',
    });

    const convId = imActiveConversationId;
    const sent = wsSend({
      action: 'send',
      conversationId: convId,
      type: 'card',
      content: cardContent,
    });

    if (!sent) {
      const httpResult = await window.electronAPI.imSendMessage(convId, 'card', cardContent);
      if (!httpResult.success) {
        alert(httpResult.message || '发送会议邀请失败');
      }
    }
  } catch (err) {
    alert('发起会议失败: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- 新建会话弹窗 ----------

let newChatState = {
  type: 'single', // 'single' | 'group'
  groupName: '',
  selectedUsers: [], // [{ id, username, departmentName }]
  searchTimer: null,
};

/**
 * 打开选人组件发起会话（单聊/群聊）
 */
async function openNewChatPicker() {
  const result = await window.electronAPI.imOpenNewChatPicker(imCurrentUserId);
  if (!result.success) {
    alert(result.message || '打开选人组件失败');
  }
}

function updateNewChatTypeTabs() {
  const tabs = document.querySelectorAll('.im-chat-type-tab');
  tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-type') === newChatState.type);
  });

  const groupNameRow = document.getElementById('imNewChatGroupNameRow');
  groupNameRow.style.display = newChatState.type === 'group' ? '' : 'none';
}

function renderNewChatSelectedUsers() {
  const container = document.getElementById('imNewChatSelectedUsers');
  if (newChatState.selectedUsers.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = newChatState.selectedUsers.map((user) => {
    const initial = (user.username || '?').charAt(0).toUpperCase();
    return `
      <div class="im-user-search-item selected" data-user-id="${escapeHtml(user.id)}">
        <div class="im-user-search-avatar">${escapeHtml(initial)}</div>
        <div class="im-user-search-info">
          <div class="im-user-search-name">${escapeHtml(user.username)}</div>
          <div class="im-user-search-dept">${escapeHtml(user.departmentName || user.id)}</div>
        </div>
        <div class="im-user-search-check">
          <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        </div>
      </div>
    `;
  }).join('');
}

async function searchUsersForNewChat(keyword) {
  const container = document.getElementById('imNewChatSearchResults');
  if (!keyword.trim()) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:13px;">输入关键词搜索用户</div>';
    return;
  }

  container.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:13px;">搜索中...</div>';

  try {
    const result = await window.electronAPI.imSearchUsers(keyword);
    if (result.success && result.data) {
      const users = result.data;
      if (users.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:13px;">未找到匹配的用户</div>';
        return;
      }

      container.innerHTML = users.map((user) => {
        const initial = (user.username || '?').charAt(0).toUpperCase();
        const isSelected = newChatState.selectedUsers.find((u) => u.id === user.id);
        const isSelf = user.id === imCurrentUserId;
        return `
          <div class="im-user-search-item ${isSelected ? 'selected' : ''}" data-user-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}" data-dept="${escapeHtml(user.departmentName || '')}" ${isSelf ? 'data-self="true"' : ''}>
            <div class="im-user-search-avatar">${escapeHtml(initial)}</div>
            <div class="im-user-search-info">
              <div class="im-user-search-name">${escapeHtml(user.username)}${isSelf ? ' (自己)' : ''}</div>
              <div class="im-user-search-dept">${escapeHtml(user.departmentName || user.id)}</div>
            </div>
            ${isSelected ? '<div class="im-user-search-check"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>' : ''}
          </div>
        `;
      }).join('');
    } else {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:13px;">搜索失败</div>';
    }
  } catch (err) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:13px;">搜索失败</div>';
  }
}

async function createNewChat() {
  const errorEl = document.getElementById('imNewChatError');
  errorEl.textContent = '';

  if (newChatState.type === 'single') {
    if (newChatState.selectedUsers.length !== 1) {
      errorEl.textContent = '单聊请选择一位用户';
      return;
    }
  } else {
    if (!newChatState.groupName.trim()) {
      errorEl.textContent = '请输入群聊名称';
      return;
    }
    if (newChatState.selectedUsers.length === 0) {
      errorEl.textContent = '请至少选择一位成员';
      return;
    }
  }

  const memberIds = newChatState.selectedUsers.map((u) => u.id);
  const name = newChatState.type === 'group' ? newChatState.groupName.trim() : '';

  try {
    const result = await window.electronAPI.imCreateConversation(newChatState.type, name, memberIds);
    if (result.success && result.data) {
      document.getElementById('imNewChatModal').classList.remove('show');
      // 创建新会话后强制刷新（本地肯定没有这个新会话）
      await loadConversations(true);
      await selectConversation(result.data.id);
    } else {
      errorEl.textContent = result.message || '创建失败';
    }
  } catch (err) {
    errorEl.textContent = err.message || '创建失败';
  }
}

// ---------- 群信息弹窗（合并成员列表+群管理） ----------

// 群成员状态（用于选人组件过滤已有成员）
let groupExistingMemberIds = [];
// 当前选中的群成员（用于底部"设为管理员"/"转让群主"操作）
let groupSelectedMember = null;

/**
 * 打开群信息弹窗，所有群成员可查看；群主/管理员可见编辑区和添加成员区
 */
async function showGroupInfoModal(conv) {
  const modal = document.getElementById('imGroupInfoModal');
  const titleEl = document.getElementById('imGroupInfoTitle');
  const editSection = document.getElementById('imGroupInfoEditSection');
  const addSection = document.getElementById('imGroupInfoAddSection');
  const dissolveBtn = document.getElementById('imGroupInfoDissolve');
  const setRoleBtn = document.getElementById('imGroupInfoSetRoleBtn');
  const transferBtn = document.getElementById('imGroupInfoTransferBtn');
  const nameInput = document.getElementById('imGroupInfoName');
  const memberTitleEl = document.getElementById('imGroupInfoMemberTitle');

  const isOwner = conv.role === 'owner';
  const canManage = conv.role === 'owner' || conv.role === 'admin';

  // 标题
  titleEl.textContent = conv.name || '群信息';

  // 编辑区：仅管理员可见
  editSection.style.display = canManage ? '' : 'none';
  if (canManage) {
    nameInput.value = conv.name || '';
    nameInput.setAttribute('data-original', conv.name || '');
  }

  // 添加成员区：仅管理员可见
  addSection.style.display = canManage ? '' : 'none';

  // 底部按钮可见性：解散群聊仅群主可见，设为管理员/转让群主仅群主可见
  dissolveBtn.style.display = isOwner ? '' : 'none';
  setRoleBtn.style.display = isOwner ? '' : 'none';
  transferBtn.style.display = isOwner ? '' : 'none';
  // 初始状态禁用（需先选中成员）
  setRoleBtn.disabled = true;
  transferBtn.disabled = true;

  // 存储当前会话ID
  modal.setAttribute('data-conv-id', conv.id);

  // 加载成员列表
  memberTitleEl.textContent = '群成员';
  await loadGroupInfoMembers(conv.id);

  modal.classList.add('show');
}

/**
 * 加载群成员列表并渲染到弹窗中
 */
async function loadGroupInfoMembers(convId) {
  const listEl = document.getElementById('imGroupInfoMembers');
  const memberTitleEl = document.getElementById('imGroupInfoMemberTitle');

  listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;">加载中...</div>';

  try {
    const result = await window.electronAPI.imGetMembers(convId);
    if (result.success && result.data) {
      const members = result.data;
      const conv = imConversations.find((c) => c.id === convId);
      memberTitleEl.textContent = `群成员 (${members.length})`;

      // 更新已有成员集合（供选人组件过滤使用）
      groupExistingMemberIds = members.map((m) => m.userId);

      const myRole = conv ? conv.role : 'member';
      const isOwner = myRole === 'owner';

      // 重置选中状态
      groupSelectedMember = null;
      updateGroupFooterButtons(conv);

      listEl.innerHTML = members.map((member) => {
        const initial = (member.username || '?').charAt(0).toUpperCase();
        const roleTag = member.role === 'owner' ? '<span class="im-member-role-tag">群主</span>' :
                       member.role === 'admin' ? '<span class="im-member-role-tag">管理员</span>' : '';
        const canRemove = conv && (conv.role === 'owner' || conv.role === 'admin') && member.userId !== imCurrentUserId && member.role !== 'owner';
        const isSelf = member.userId === imCurrentUserId;
        // 是否可被选中（群主可选非自己、非群主的成员）
        const isSelectable = isOwner && !isSelf && member.role !== 'owner';

        let actionBtns = '';
        if (canRemove) {
          actionBtns += `<button class="im-member-remove-btn" data-conv-id="${escapeHtml(convId)}" data-user-id="${escapeHtml(member.userId)}" data-username="${escapeHtml(member.username)}">移除</button>`;
        }
        if (isSelf && conv && conv.role !== 'owner') {
          actionBtns += `<button class="im-member-remove-btn" data-conv-id="${escapeHtml(convId)}" data-user-id="${escapeHtml(member.userId)}" data-self-exit="true">退出群聊</button>`;
        }

        return `
          <div class="im-member-item${isSelectable ? ' selectable' : ''}" data-user-id="${escapeHtml(member.userId)}" data-username="${escapeHtml(member.username)}" data-role="${escapeHtml(member.role)}" data-selectable="${isSelectable ? 'true' : 'false'}">
            <div class="im-member-avatar">${escapeHtml(initial)}</div>
            <div class="im-member-info">
              <div class="im-member-name">${escapeHtml(member.username)}${isSelf ? ' (我)' : ''} ${roleTag}</div>
              <div class="im-member-role">${escapeHtml(member.role)}</div>
            </div>
            <div class="im-member-actions">${actionBtns}</div>
          </div>
        `;
      }).join('');
    } else {
      listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;">获取成员失败</div>';
    }
  } catch (err) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;">获取成员失败</div>';
  }
}

/**
 * 选中/取消选中群成员（点击成员项触发）
 */
function selectGroupMember(item) {
  const isSelectable = item.getAttribute('data-selectable') === 'true';
  if (!isSelectable) return;

  const userId = item.getAttribute('data-user-id');
  const username = item.getAttribute('data-username');
  const role = item.getAttribute('data-role');

  // 已选中同一成员 → 取消
  if (groupSelectedMember && groupSelectedMember.userId === userId) {
    groupSelectedMember = null;
    item.classList.remove('selected');
  } else {
    // 取消之前的选中
    document.querySelectorAll('#imGroupInfoMembers .im-member-item.selected').forEach((el) => el.classList.remove('selected'));
    // 选中当前
    groupSelectedMember = { userId, username, role };
    item.classList.add('selected');
  }

  updateGroupFooterButtons(null);
}

/**
 * 根据选中成员更新底部"设为管理员"/"转让群主"按钮状态
 */
function updateGroupFooterButtons(conv) {
  const setRoleBtn = document.getElementById('imGroupInfoSetRoleBtn');
  const transferBtn = document.getElementById('imGroupInfoTransferBtn');
  if (!setRoleBtn || !transferBtn) return;

  const isOwner = conv ? conv.role === 'owner' : true;

  if (!isOwner) {
    setRoleBtn.style.display = 'none';
    transferBtn.style.display = 'none';
    return;
  }

  setRoleBtn.style.display = '';
  transferBtn.style.display = '';

  if (groupSelectedMember) {
    transferBtn.disabled = false;
    // 设为管理员：不能对群主操作
    if (groupSelectedMember.role === 'owner') {
      setRoleBtn.disabled = true;
    } else {
      setRoleBtn.disabled = false;
      setRoleBtn.textContent = groupSelectedMember.role === 'admin' ? '取消管理员' : '设为管理员';
    }
  } else {
    setRoleBtn.disabled = true;
    transferBtn.disabled = true;
    setRoleBtn.textContent = '设为管理员';
  }
}

/**
 * 打开选人组件添加群成员
 */
async function openAddMemberPicker() {
  const modal = document.getElementById('imGroupInfoModal');
  const convId = modal.getAttribute('data-conv-id');
  if (!convId) return;

  const result = await window.electronAPI.imOpenAddMemberPicker(convId, groupExistingMemberIds);
  if (!result.success) {
    alert(result.message || '打开选人组件失败');
  }
}

/**
 * 自动保存群名（输入框失焦或回车时触发，名称未变化时跳过）
 */
async function autoSaveGroupName() {
  const nameInput = document.getElementById('imGroupInfoName');
  const name = nameInput.value.trim();
  const original = nameInput.getAttribute('data-original') || '';

  // 名称未变化，跳过
  if (name === original.trim()) return;

  if (!name) {
    nameInput.value = original;
    alert('群名不能为空');
    return;
  }
  if (name.length > 64) {
    alert('群名不能超过64个字符');
    nameInput.value = original;
    return;
  }

  const modal = document.getElementById('imGroupInfoModal');
  const convId = modal.getAttribute('data-conv-id');

  nameInput.disabled = true;

  try {
    const result = await window.electronAPI.imUpdateConversation(convId, name, undefined);
    if (result.success) {
      nameInput.setAttribute('data-original', name);
      const conv = imConversations.find((c) => c.id === convId);
      if (conv) {
        conv.name = name;
        renderConversationList();
        if (convId === imActiveConversationId) renderChatHeader(conv);
        document.getElementById('imGroupInfoTitle').textContent = name;
        if (window.IMCache) window.IMCache.updateCachedConversation(conv).catch(() => {});
      }
    } else {
      alert(result.message || '修改失败');
      nameInput.value = original;
    }
  } catch (err) {
    alert(err.message || '修改失败');
    nameInput.value = original;
  } finally {
    nameInput.disabled = false;
  }
}

/**
 * 解散群聊
 */
async function dissolveGroup() {
  const modal = document.getElementById('imGroupInfoModal');
  const convId = modal.getAttribute('data-conv-id');
  const errorEl = document.getElementById('imGroupInfoError');

  if (!confirm('确定解散该群聊？解散后会话、成员关系、消息全部删除，不可恢复。')) return;

  try {
    const result = await window.electronAPI.imDissolveConversation(convId);
    if (result.success) {
      modal.classList.remove('show');
      imConversations = imConversations.filter((c) => c.id !== convId);
      if (convId === imActiveConversationId) {
        imActiveConversationId = null;
        renderChatEmpty();
      }
      renderConversationList();
      updateTotalUnreadBadge();
      if (window.IMCache) window.IMCache.clearConversationCache(convId).catch(() => {});
    } else {
      errorEl.textContent = result.message || '解散失败';
    }
  } catch (err) {
    errorEl.textContent = err.message || '解散失败';
  }
}

/**
 * 转让群主
 */
async function transferOwnership(convId, userId, username) {
  if (!confirm(`确定将群主转让给 ${username}？转让后您将降为普通成员。`)) return;

  try {
    const result = await window.electronAPI.imTransferOwnership(convId, userId);
    if (result.success) {
      // WebSocket 事件会处理 UI 更新，关闭弹窗即可
      document.getElementById('imGroupInfoModal').classList.remove('show');
    } else {
      alert(result.message || '转让失败');
    }
  } catch (err) {
    alert('转让失败: ' + err.message);
  }
}

/**
 * 设置/取消管理员
 */
async function setMemberRole(convId, userId, role, username) {
  const actionText = role === 'admin' ? `设 ${username} 为管理员` : `取消 ${username} 的管理员`;
  if (!confirm(`确定${actionText}？`)) return;

  try {
    const result = await window.electronAPI.imSetMemberRole(convId, userId, role);
    if (result.success) {
      // 刷新成员列表
      await loadGroupInfoMembers(convId);
    } else {
      alert(result.message || '操作失败');
    }
  } catch (err) {
    alert('操作失败: ' + err.message);
  }
}

// ---------- 工具函数 ----------

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function updateSendButton() {
  const input = document.getElementById('imMessageInput');
  const btn = document.getElementById('imSendBtn');
  if (input && btn) {
    btn.disabled = !input.value.trim() || !imActiveConversationId;
  }
}

// 异步加载图片（通过 IPC 带认证获取 base64 data URL）
async function loadImagesInMessages() {
  const container = document.getElementById('imMessagesContainer');
  if (!container) return;
  const imgs = container.querySelectorAll('.im-msg-image[data-url]:not([data-loaded])');
  for (const img of imgs) {
    const url = img.getAttribute('data-url');
    if (!url) continue;
    img.setAttribute('data-loaded', 'true'); // 标记已处理，避免重复请求
    try {
      const result = await window.electronAPI.fetchImageData(url);
      if (result.success && result.data) {
        img.src = result.data;
      } else {
        console.warn('[IM] 图片加载失败:', result.message || '未知错误');
        img.alt = '[图片加载失败]';
      }
    } catch (err) {
      console.error('[IM] 加载图片失败:', err);
      img.alt = '[图片加载失败]';
    }
  }

  // 文件链接 - 不再需要预加载 URL，点击时通过 IPC 下载缓存后打开
  const files = container.querySelectorAll('.im-msg-file[data-url]:not([data-loaded])');
  for (const fileEl of files) {
    fileEl.setAttribute('data-loaded', 'true');
  }
}

// ---------- 事件绑定 ----------

function bindIMEvents() {
  // 会话列表点击
  document.getElementById('imConversationList').addEventListener('click', (e) => {
    const item = e.target.closest('.im-conv-item');
    if (item) {
      const convId = item.getAttribute('data-conv-id');
      selectConversation(convId);
    }
  });

  // 新建会话按钮 — 打开选人组件
  document.getElementById('imNewChatBtn').addEventListener('click', openNewChatPicker);

  // 选人组件创建会话完成通知 → 刷新会话列表并选中新会话
  window.electronAPI.onNewChatCreated(async (conversationId) => {
    await loadConversations(true);
    if (conversationId) {
      await selectConversation(conversationId);
    }
  });

  // 搜索会话
  document.getElementById('imConvSearchInput').addEventListener('input', (e) => {
    const keyword = e.target.value.trim().toLowerCase();
    const items = document.querySelectorAll('.im-conv-item');
    items.forEach((item) => {
      const name = item.querySelector('.im-conv-name').textContent.toLowerCase();
      item.style.display = name.includes(keyword) ? '' : 'none';
    });
  });

  // 消息输入
  const messageInput = document.getElementById('imMessageInput');
  messageInput.addEventListener('input', () => {
    updateSendButton();
    handleTyping();
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 发送按钮
  document.getElementById('imSendBtn').addEventListener('click', sendMessage);

  // 输入区域拖拽调整高度
  const inputArea = document.querySelector('.im-input-area');
  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  if (inputArea) {
    inputArea.addEventListener('mousedown', (e) => {
      // 只响应顶部拖拽区域 (y 偏移小于 12px)
      const rect = inputArea.getBoundingClientRect();
      if (e.clientY - rect.top > 12) return;
      
      isResizing = true;
      startY = e.clientY;
      startHeight = inputArea.offsetHeight;
      inputArea.classList.add('resizing');
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const delta = startY - e.clientY; // 向上拖为正（增大）
      const minHeight = 120;  // 最小高度：完整显示工具栏+一行文本+发送按钮
      const maxHeight = 300;  // 最大高度
      const newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + delta));
      inputArea.style.height = newHeight + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;
      inputArea.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // 滚动消息到底部
      scrollMessagesToBottom();
    });
  }

  // 图片上传
  document.getElementById('imImageBtn').addEventListener('click', () => {
    document.getElementById('imImageInput').click();
  });

  document.getElementById('imImageInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileUpload(file, true);
    e.target.value = ''; // 重置以便重复选择
  });

  // 文件上传
  document.getElementById('imFileBtn').addEventListener('click', () => {
    document.getElementById('imFileInput').click();
  });

  document.getElementById('imFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileUpload(file, false);
    e.target.value = '';
  });

  // 发起会议
  document.getElementById('imMeetingBtn').addEventListener('click', sendMeetingInvite);

  // 加载更多消息
  document.getElementById('imMessagesContainer').addEventListener('click', (e) => {
    if (e.target.id === 'imLoadMoreBtn') {
      loadMessages(imActiveConversationId, true);
    }
  });

  // 消息容器滚动处理 - 渲染后加载图片 URL
  const messagesContainer = document.getElementById('imMessagesContainer');
  const observer = new MutationObserver(() => {
    loadImagesInMessages();
  });
  observer.observe(messagesContainer, { childList: true, subtree: true });

  // 图片点击预览 + 文件点击下载 + 会议卡片加入会议
  messagesContainer.addEventListener('click', async (e) => {
    const img = e.target.closest('.im-msg-image');
    if (img && img.src) {
      const overlay = document.getElementById('imImagePreviewOverlay');
      const previewImg = document.getElementById('imImagePreviewImg');
      previewImg.src = img.src;
      overlay.classList.add('show');
      return;
    }

    const fileEl = e.target.closest('.im-msg-file');
    if (fileEl) {
      const url = fileEl.getAttribute('data-url');
      const filename = fileEl.querySelector('.im-msg-file-name')?.textContent || '文件';
      if (url) {
        const result = await window.electronAPI.openCachedFile(url, filename);
        if (!result.success) {
          alert(result.message || '文件打开失败');
        }
      }
    }

    // 会议邀请卡片 - 加入会议按钮
    const joinBtn = e.target.closest('.im-card-action');
    if (joinBtn) {
      const code = joinBtn.getAttribute('data-meeting-code');
      if (!code) return;
      joinBtn.textContent = '加入中...';
      joinBtn.disabled = true;
      try {
        const result = await window.electronAPI.joinMeeting(code, '', '');
        if (!result.success) alert(result.message || '入会失败');
      } catch (err) {
        alert('入会失败: ' + err.message);
      } finally {
        joinBtn.textContent = '加入会议';
        joinBtn.disabled = false;
      }
    }

    // 会议邀请卡片 - 会议号点击复制
    const codeEl = e.target.closest('.im-card-code');
    if (codeEl) {
      const code = codeEl.textContent;
      navigator.clipboard.writeText(code).then(() => {
        const original = codeEl.textContent;
        codeEl.textContent = '已复制';
        setTimeout(() => { codeEl.textContent = original; }, 1200);
      });
    }
  });

  // 图片预览关闭
  document.getElementById('imImagePreviewOverlay').addEventListener('click', () => {
    document.getElementById('imImagePreviewOverlay').classList.remove('show');
  });

  // ---- 新建会话弹窗事件 ----
  document.getElementById('imNewChatCancel').addEventListener('click', () => {
    document.getElementById('imNewChatModal').classList.remove('show');
  });

  document.getElementById('imNewChatModal').addEventListener('click', (e) => {
    if (e.target.id === 'imNewChatModal') {
      document.getElementById('imNewChatModal').classList.remove('show');
    }
  });

  // 类型切换
  document.querySelectorAll('.im-chat-type-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      newChatState.type = tab.getAttribute('data-type');
      updateNewChatTypeTabs();
    });
  });

  // 群名输入
  document.getElementById('imNewChatGroupName').addEventListener('input', (e) => {
    newChatState.groupName = e.target.value;
  });

  // 搜索
  document.getElementById('imNewChatSearchInput').addEventListener('input', (e) => {
    clearTimeout(newChatState.searchTimer);
    const keyword = e.target.value.trim();
    newChatState.searchTimer = setTimeout(() => {
      searchUsersForNewChat(keyword);
    }, 300);
  });

  // 搜索结果点击
  document.getElementById('imNewChatSearchResults').addEventListener('click', (e) => {
    const item = e.target.closest('.im-user-search-item');
    if (!item) return;

    const userId = item.getAttribute('data-user-id');
    const isSelf = item.getAttribute('data-self') === 'true';

    if (isSelf) return; // 不能和自己聊天

    const username = item.getAttribute('data-username');
    const dept = item.getAttribute('data-dept');

    const existingIdx = newChatState.selectedUsers.findIndex((u) => u.id === userId);
    if (existingIdx >= 0) {
      // 取消选择
      newChatState.selectedUsers.splice(existingIdx, 1);
    } else {
      // 单聊模式只能选一个
      if (newChatState.type === 'single') {
        newChatState.selectedUsers = [{ id: userId, username, departmentName: dept }];
      } else {
        newChatState.selectedUsers.push({ id: userId, username, departmentName: dept });
      }
    }

    renderNewChatSelectedUsers();
    // 重新渲染搜索结果以更新选中状态
    searchUsersForNewChat(document.getElementById('imNewChatSearchInput').value.trim());
  });

  // 创建会话
  document.getElementById('imNewChatSubmit').addEventListener('click', createNewChat);

  // ---- 群信息弹窗（合并成员列表+群管理） ----
  document.getElementById('imGroupInfoClose').addEventListener('click', () => {
    document.getElementById('imGroupInfoModal').classList.remove('show');
  });

  document.getElementById('imGroupInfoModal').addEventListener('click', (e) => {
    if (e.target.id === 'imGroupInfoModal') {
      document.getElementById('imGroupInfoModal').classList.remove('show');
    }
  });

  // 群名自动保存（失焦或回车时触发）
  const groupNameInput = document.getElementById('imGroupInfoName');
  groupNameInput.addEventListener('blur', autoSaveGroupName);
  groupNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      groupNameInput.blur();
    }
  });

  // 解散群聊
  document.getElementById('imGroupInfoDissolve').addEventListener('click', dissolveGroup);

  // 添加成员按钮 — 打开选人组件
  document.getElementById('imGroupInfoAddMemberBtn').addEventListener('click', openAddMemberPicker);

  // 选人组件添加群成员完成通知 → 刷新成员列表和会话列表
  window.electronAPI.onAddMemberDone(async () => {
    const modal = document.getElementById('imGroupInfoModal');
    const convId = modal.getAttribute('data-conv-id');
    if (convId) {
      await loadGroupInfoMembers(convId);
      await loadConversations(true);
    }
  });

  // 成员列表操作（移除/退出 + 点击选中成员）
  document.getElementById('imGroupInfoMembers').addEventListener('click', async (e) => {
    // 移除成员 / 退出群聊
    const removeBtn = e.target.closest('.im-member-remove-btn');
    if (removeBtn) {
      const convId = removeBtn.getAttribute('data-conv-id');
      const userId = removeBtn.getAttribute('data-user-id');
      const isExit = removeBtn.getAttribute('data-self-exit') === 'true';
      const username = removeBtn.getAttribute('data-username');

      const confirmMsg = isExit ? '确定退出该群聊？' : `确定移除 ${username}？`;
      if (!confirm(confirmMsg)) return;

      try {
        const result = await window.electronAPI.imRemoveMember(convId, userId);
        if (result.success) {
          if (isExit) {
            document.getElementById('imGroupInfoModal').classList.remove('show');
          } else {
            await loadGroupInfoMembers(convId);
          }
          await loadConversations(true);
        } else {
          alert(result.message || '操作失败');
        }
      } catch (err) {
        alert('操作失败: ' + err.message);
      }
      return;
    }

    // 点击成员项 → 选中/取消选中
    const item = e.target.closest('.im-member-item');
    if (item) {
      selectGroupMember(item);
    }
  });

  // 底部"设为管理员"/"取消管理员"按钮
  document.getElementById('imGroupInfoSetRoleBtn').addEventListener('click', async () => {
    if (!groupSelectedMember) return;
    const modal = document.getElementById('imGroupInfoModal');
    const convId = modal.getAttribute('data-conv-id');
    const role = groupSelectedMember.role === 'admin' ? 'member' : 'admin';
    await setMemberRole(convId, groupSelectedMember.userId, role, groupSelectedMember.username);
  });

  // 底部"转让群主"按钮
  document.getElementById('imGroupInfoTransferBtn').addEventListener('click', async () => {
    if (!groupSelectedMember) return;
    const modal = document.getElementById('imGroupInfoModal');
    const convId = modal.getAttribute('data-conv-id');
    await transferOwnership(convId, groupSelectedMember.userId, groupSelectedMember.username);
  });

  // 定时刷新会话列表（每 60 秒）
  setInterval(() => {
    if (imInitialized) loadConversations();
  }, 60000);
}

// ========== 暴露给全局供 tab 切换调用 ==========

window.IMModule = {
  init: initIM,
  disconnect: () => {
    if (imWs) {
      imWs.close();
      imWs = null;
    }
    if (imWsReconnectTimer) {
      clearTimeout(imWsReconnectTimer);
      imWsReconnectTimer = null;
    }
  },
};

// 兜底自动初始化：nav.js 中的 `if (window.IMModule) window.IMModule.init()`
// 在 im.js 之前就已经执行过，此时 IMModule 还不存在，所以默认页签是 IM 时
// 需要在 im.js 加载完成后主动触发一次初始化。
// 这里用 imPage 是否可见来判断当前是否激活了 IM 标签。
(function autoInitIfActive() {
  const imPageEl = document.getElementById('imPage');
  if (imPageEl && imPageEl.style.display !== 'none') {
    initIM();
  }
})();
