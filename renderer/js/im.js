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
      ${isGroup ? `<button class="im-icon-btn" id="imShowMembersBtn" title="成员列表">
        <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
      </button>` : ''}
    </div>
  `;

  // 显示聊天内容区
  document.getElementById('imChatEmpty').style.display = 'none';
  document.getElementById('imChatContent').style.display = 'flex';

  // 绑定成员列表按钮
  const membersBtn = document.getElementById('imShowMembersBtn');
  if (membersBtn) {
    membersBtn.addEventListener('click', () => showMembersModal(conv.id));
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

function openNewChatModal() {
  newChatState = { type: 'single', groupName: '', selectedUsers: [], searchTimer: null };

  const modal = document.getElementById('imNewChatModal');
  const searchInput = document.getElementById('imNewChatSearchInput');
  const groupNameInput = document.getElementById('imNewChatGroupName');
  const groupNameRow = document.getElementById('imNewChatGroupNameRow');
  const resultsContainer = document.getElementById('imNewChatSearchResults');
  const selectedContainer = document.getElementById('imNewChatSelectedUsers');

  // 重置
  searchInput.value = '';
  groupNameInput.value = '';
  groupNameRow.style.display = 'none';
  resultsContainer.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:13px;">输入关键词搜索用户</div>';
  selectedContainer.innerHTML = '';

  updateNewChatTypeTabs();
  modal.classList.add('show');

  setTimeout(() => searchInput.focus(), 100);
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

// ---------- 成员列表弹窗 ----------

async function showMembersModal(convId) {
  const modal = document.getElementById('imMembersModal');
  const listEl = document.getElementById('imMembersList');
  const titleEl = document.getElementById('imMembersTitle');

  modal.classList.add('show');
  listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;">加载中...</div>';

  try {
    const result = await window.electronAPI.imGetMembers(convId);
    if (result.success && result.data) {
      const members = result.data;
      const conv = imConversations.find((c) => c.id === convId);
      titleEl.textContent = `${conv ? conv.name : '群聊'} (${members.length} 人)`;

      listEl.innerHTML = members.map((member) => {
        const initial = (member.username || '?').charAt(0).toUpperCase();
        const roleTag = member.role === 'owner' ? '<span class="im-member-role-tag">群主</span>' :
                       member.role === 'admin' ? '<span class="im-member-role-tag">管理员</span>' : '';
        const canRemove = conv && (conv.role === 'owner' || conv.role === 'admin') && member.userId !== imCurrentUserId;
        const isSelf = member.userId === imCurrentUserId;

        return `
          <div class="im-member-item">
            <div class="im-member-avatar">${escapeHtml(initial)}</div>
            <div class="im-member-info">
              <div class="im-member-name">${escapeHtml(member.username)}${isSelf ? ' (我)' : ''} ${roleTag}</div>
              <div class="im-member-role">${escapeHtml(member.role)}</div>
            </div>
            ${canRemove ? `<button class="im-member-remove-btn" data-conv-id="${escapeHtml(convId)}" data-user-id="${escapeHtml(member.userId)}" data-username="${escapeHtml(member.username)}">移除</button>` : ''}
            ${isSelf && conv && conv.role !== 'owner' ? `<button class="im-member-remove-btn" data-conv-id="${escapeHtml(convId)}" data-user-id="${escapeHtml(member.userId)}" data-self-exit="true">退出群聊</button>` : ''}
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

  // 新建会话按钮
  document.getElementById('imNewChatBtn').addEventListener('click', openNewChatModal);

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

  // ---- 成员列表弹窗 ----
  document.getElementById('imMembersClose').addEventListener('click', () => {
    document.getElementById('imMembersModal').classList.remove('show');
  });

  document.getElementById('imMembersModal').addEventListener('click', (e) => {
    if (e.target.id === 'imMembersModal') {
      document.getElementById('imMembersModal').classList.remove('show');
    }
  });

  // 成员移除（事件委托）
  document.getElementById('imMembersList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.im-member-remove-btn');
    if (!btn) return;

    const convId = btn.getAttribute('data-conv-id');
    const userId = btn.getAttribute('data-user-id');
    const isExit = btn.getAttribute('data-self-exit') === 'true';
    const username = btn.getAttribute('data-username');

    const confirmMsg = isExit ? '确定退出该群聊？' : `确定移除 ${username}？`;
    if (!confirm(confirmMsg)) return;

    try {
      const result = await window.electronAPI.imRemoveMember(convId, userId);
      if (result.success) {
        showMembersModal(convId); // 刷新成员列表
        // 成员变动后强制刷新（成员元数据变化，本地缓存已失效）
        await loadConversations(true);
      } else {
        alert(result.message || '操作失败');
      }
    } catch (err) {
      alert('操作失败: ' + err.message);
    }
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
