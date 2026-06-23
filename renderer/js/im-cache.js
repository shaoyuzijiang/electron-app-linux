// ========== IM 本地缓存模块 (IndexedDB) ==========

const IM_CACHE_DB_NAME = 'im_cache_db';
const IM_CACHE_DB_VERSION = 1;
const MSG_STORE = 'messages';       // 消息存储
const CONV_STORE = 'conversations'; // 会话存储
const SYNC_STORE = 'sync_state';    // 同步状态

let imCacheDb = null;

/**
 * 打开/初始化 IndexedDB
 */
function openImCacheDB() {
  return new Promise((resolve, reject) => {
    if (imCacheDb) {
      resolve(imCacheDb);
      return;
    }

    const req = indexedDB.open(IM_CACHE_DB_NAME, IM_CACHE_DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // 消息存储：以 id 为主键，conversationId + createdAt 建索引
      if (!db.objectStoreNames.contains(MSG_STORE)) {
        const msgStore = db.createObjectStore(MSG_STORE, { keyPath: 'id' });
        msgStore.createIndex('conversationId', 'conversationId', { unique: false });
        msgStore.createIndex('conv_created', ['conversationId', 'createdAt'], { unique: false });
      }

      // 会话存储：以 id 为主键
      if (!db.objectStoreNames.contains(CONV_STORE)) {
        db.createObjectStore(CONV_STORE, { keyPath: 'id' });
      }

      // 同步状态：以 conversationId 为主键
      if (!db.objectStoreNames.contains(SYNC_STORE)) {
        db.createObjectStore(SYNC_STORE, { keyPath: 'conversationId' });
      }
    };

    req.onsuccess = (e) => {
      imCacheDb = e.target.result;
      resolve(imCacheDb);
    };

    req.onerror = (e) => {
      console.error('[IM Cache] 打开 IndexedDB 失败:', e.target.error);
      reject(e.target.error);
    };
  });
}

/**
 * 批量写入消息到 IndexedDB（自动去重）
 * @param {Array} messages - 消息数组
 */
async function cacheMessages(messages) {
  if (!messages || messages.length === 0) return;
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([MSG_STORE], 'readwrite');
    const store = tx.objectStore(MSG_STORE);

    messages.forEach((msg) => {
      // put 操作：存在则更新，不存在则插入
      store.put(msg);
    });

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => {
      console.error('[IM Cache] 写入消息失败:', e.target.error);
      reject(e.target.error);
    };
  });
}

/**
 * 从 IndexedDB 读取指定会话的最新 N 条消息
 * @param {string} conversationId
 * @param {number} limit
 * @returns {Array} 按 createdAt 升序排列的消息
 */
async function getCachedMessages(conversationId, limit = 50) {
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([MSG_STORE], 'readonly');
    const store = tx.objectStore(MSG_STORE);
    const index = store.index('conv_created');
    const range = IDBKeyRange.bound(
      [conversationId, ''],
      [conversationId, '\uffff\uffff\uffff\uffff']
    );

    // 反向游标：从最新开始取 limit 条
    const results = [];
    const req = index.openCursor(range, 'prev');
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && results.length < limit) {
        results.push(cursor.value);
        cursor.continue();
      }
    };
    tx.oncomplete = () => {
      // 翻转为升序
      resolve(results.reverse());
    };
    tx.onerror = (e) => {
      console.error('[IM Cache] 读取消息失败:', e.target.error);
      reject(e.target.error);
    };
  });
}

/**
 * 从 IndexedDB 读取指定会话中 createdAt < beforeCreatedAt 的 N 条消息
 * @param {string} conversationId
 * @param {string} beforeCreatedAt
 * @param {number} limit
 * @returns {Array} 按 createdAt 升序排列的消息
 */
async function getOlderCachedMessages(conversationId, beforeCreatedAt, limit = 50) {
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([MSG_STORE], 'readonly');
    const store = tx.objectStore(MSG_STORE);
    const index = store.index('conv_created');
    const range = IDBKeyRange.bound(
      [conversationId, ''],
      [conversationId, beforeCreatedAt]
    );

    const results = [];
    const req = index.openCursor(range, 'prev'); // 从最新开始（但小于 beforeCreatedAt）
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && results.length < limit) {
        results.push(cursor.value);
        cursor.continue();
      }
    };
    tx.oncomplete = () => {
      resolve(results.reverse());
    };
    tx.onerror = (e) => {
      console.error('[IM Cache] 读取旧消息失败:', e.target.error);
      reject(e.target.error);
    };
  });
}

/**
 * 获取指定会话最新的消息 createdAt（用于增量同步的 after 参数）
 * @param {string} conversationId
 * @returns {string|null}
 */
async function getLatestCachedCreatedAt(conversationId) {
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([MSG_STORE], 'readonly');
    const store = tx.objectStore(MSG_STORE);
    const index = store.index('conv_created');
    const range = IDBKeyRange.bound(
      [conversationId, ''],
      [conversationId, '\uffff\uffff\uffff\uffff']
    );

    const req = index.openCursor(range, 'prev');
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        resolve(cursor.value.createdAt);
      } else {
        resolve(null);
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 获取指定会话最旧的消息 createdAt（用于判断本地是否还有更早数据）
 * @param {string} conversationId
 * @returns {string|null}
 */
async function getOldestCachedCreatedAt(conversationId) {
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([MSG_STORE], 'readonly');
    const store = tx.objectStore(MSG_STORE);
    const index = store.index('conv_created');
    const range = IDBKeyRange.bound(
      [conversationId, ''],
      [conversationId, '\uffff\uffff\uffff\uffff']
    );

    const req = index.openCursor(range, 'next');
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        resolve(cursor.value.createdAt);
      } else {
        resolve(null);
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 获取指定会话的本地缓存消息总数
 * @param {string} conversationId
 * @returns {number}
 */
async function getCachedMessageCount(conversationId) {
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([MSG_STORE], 'readonly');
    const store = tx.objectStore(MSG_STORE);
    const index = store.index('conversationId');
    const req = index.count(IDBKeyRange.only(conversationId));
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ---------- 会话缓存 ----------

/**
 * 缓存会话列表到 IndexedDB
 * @param {Array} conversations
 */
async function cacheConversations(conversations) {
  if (!conversations || conversations.length === 0) return;
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([CONV_STORE], 'readwrite');
    const store = tx.objectStore(CONV_STORE);

    // 先清空旧数据
    store.clear();
    conversations.forEach((conv) => {
      store.put(conv);
    });

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => {
      console.error('[IM Cache] 写入会话失败:', e.target.error);
      reject(e.target.error);
    };
  });
}

/**
 * 从 IndexedDB 读取缓存的会话列表
 * @returns {Array}
 */
async function getCachedConversations() {
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([CONV_STORE], 'readonly');
    const store = tx.objectStore(CONV_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const data = req.result || [];
      // 按 updatedAt 降序排序
      data.sort((a, b) => {
        const ta = a.updatedAt || a.lastMessage?.createdAt || '';
        const tb = b.updatedAt || b.lastMessage?.createdAt || '';
        return tb.localeCompare(ta);
      });
      resolve(data);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 更新单个会话的缓存（用于实时消息更新会话列表）
 * @param {object} conversation
 */
async function updateCachedConversation(conversation) {
  if (!conversation || !conversation.id) return;
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([CONV_STORE], 'readwrite');
    const store = tx.objectStore(CONV_STORE);
    store.put(conversation);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ---------- 同步状态管理 ----------

/**
 * 获取会话的同步状态
 * @param {string} conversationId
 * @returns {object|null} { conversationId, noMoreRemote, oldestLocalCreatedAt }
 */
async function getSyncState(conversationId) {
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([SYNC_STORE], 'readonly');
    const store = tx.objectStore(SYNC_STORE);
    const req = store.get(conversationId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 设置会话的同步状态
 * @param {string} conversationId
 * @param {object} state - { noMoreRemote, oldestLocalCreatedAt }
 */
async function setSyncState(conversationId, state) {
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([SYNC_STORE], 'readwrite');
    const store = tx.objectStore(SYNC_STORE);
    store.put({
      conversationId,
      noMoreRemote: state.noMoreRemote || false,
      oldestLocalCreatedAt: state.oldestLocalCreatedAt || null,
      updatedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ---------- 清理 ----------

/**
 * 清除指定会话的所有缓存（消息 + 同步状态）
 * @param {string} conversationId
 */
async function clearConversationCache(conversationId) {
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([MSG_STORE, SYNC_STORE], 'readwrite');
    const msgStore = tx.objectStore(MSG_STORE);
    const syncStore = tx.objectStore(SYNC_STORE);

    // 删除该会话的所有消息
    const msgIndex = msgStore.index('conversationId');
    const cursorReq = msgIndex.openCursor(IDBKeyRange.only(conversationId));
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    // 删除同步状态
    syncStore.delete(conversationId);

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 清空所有 IM 缓存
 */
async function clearAllImCache() {
  const db = await openImCacheDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([MSG_STORE, CONV_STORE, SYNC_STORE], 'readwrite');
    tx.objectStore(MSG_STORE).clear();
    tx.objectStore(CONV_STORE).clear();
    tx.objectStore(SYNC_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// 暴露到全局
window.IMCache = {
  // 消息
  cacheMessages,
  getCachedMessages,
  getOlderCachedMessages,
  getLatestCachedCreatedAt,
  getOldestCachedCreatedAt,
  getCachedMessageCount,
  // 会话
  cacheConversations,
  getCachedConversations,
  updateCachedConversation,
  // 同步状态
  getSyncState,
  setSyncState,
  // 清理
  clearConversationCache,
  clearAllImCache,
};
