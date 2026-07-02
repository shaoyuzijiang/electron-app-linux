// Webview 嵌入网页页签交互逻辑
// 负责计算 WebContentsView 的 bounds、与主进程 IPC 通信、resize 同步
//
// 支持多 webview：每个企业动态页签对应一个独立的 WebContentsView（按 tabId 区分）。
// 当 webviewPage 显示时，根据 data-active-tab 决定激活哪个 webview。

(function () {
  const webviewPage = document.getElementById('webviewPage');
  const webviewContainer = document.getElementById('webviewContainer');
  const urlInput = document.getElementById('webviewUrlInput');
  const goBtn = document.getElementById('webviewGoBtn');
  const backBtn = document.getElementById('webviewBackBtn');
  const forwardBtn = document.getElementById('webviewForwardBtn');
  const reloadBtn = document.getElementById('webviewReloadBtn');
  const closeBtn = document.getElementById('webviewCloseBtn');
  const placeholder = document.getElementById('webviewPlaceholder');

  if (!webviewPage || !window.electronAPI || !window.electronAPI.webviewCreate) {
    return;
  }

  let resizeTimer = null;

  // 计算 webview 在窗口中的 bounds（相对于窗口左上角）
  function calculateBounds() {
    const rect = webviewContainer.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  }

  function showPlaceholder(show) {
    if (placeholder) placeholder.style.display = show ? '' : 'none';
  }

  // 规范化 URL
  function normalizeUrl(input) {
    if (!input) return '';
    let url = input.trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    return url;
  }

  // 打开网页（开发模式下的「应用」页签）
  async function openWebview(url) {
    url = normalizeUrl(url);
    if (!url) {
      alert('请输入网址');
      return;
    }
    const bounds = calculateBounds();
    // 兼容旧 tabId='webview'
    const result = await window.electronAPI.webviewCreate(url, bounds, { tabId: 'webview', activate: true });
    if (!result.success) {
      alert('无法打开网页: ' + (result.message || '未知错误'));
      return;
    }
    showPlaceholder(false);
    urlInput.value = url;
    webviewPage.dataset.activeTab = 'webview';
  }

  // 按钮事件
  goBtn.addEventListener('click', () => openWebview(urlInput.value));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openWebview(urlInput.value);
  });

  closeBtn.addEventListener('click', async () => {
    // 如果当前激活的是开发 tab（webview），则销毁它
    const active = webviewPage.dataset.activeTab || 'webview';
    await window.electronAPI.webviewClose(active);
    if (active === 'webview') {
      urlInput.value = '';
      showPlaceholder(true);
    }
  });

  // 后退 / 前进 / 刷新
  backBtn.addEventListener('click', async () => {
    const active = webviewPage.dataset.activeTab || 'webview';
    const info = await window.electronAPI.webviewGetInfo(active);
    if (info.success) {
      await window.electronAPI.webviewGoBack(active);
    }
  });

  forwardBtn.addEventListener('click', async () => {
    const active = webviewPage.dataset.activeTab || 'webview';
    const info = await window.electronAPI.webviewGetInfo(active);
    if (info.success) {
      await window.electronAPI.webviewGoForward(active);
    }
  });

  reloadBtn.addEventListener('click', async () => {
    const active = webviewPage.dataset.activeTab || 'webview';
    const info = await window.electronAPI.webviewGetInfo(active);
    if (info.success) {
      await window.electronAPI.webviewReload(active);
    }
  });

  // 窗口 resize 时同步调整 webview 大小
  window.addEventListener('resize', () => {
    if (webviewPage.style.display === 'none') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      const active = webviewPage.dataset.activeTab || 'webview';
      await window.electronAPI.webviewResize(calculateBounds());
      await window.electronAPI.webviewShow(active);
    }, 100);
  });

  // 监听 tab 切换事件（由 nav.js 派发）
  document.addEventListener('tab-switched', (e) => {
    const tab = e.detail.tab;
    if (tab === 'webview' || tab.startsWith && tab.startsWith('enterprise-')) {
      // 切到 webview/enterprise tab：激活对应的 webview
      webviewPage.dataset.activeTab = tab;
      setTimeout(async () => {
        const info = await window.electronAPI.webviewGetInfo(tab);
        if (info.success) {
          await window.electronAPI.webviewResize(calculateBounds());
          await window.electronAPI.webviewShow(tab);
          // 动态企业页签没有 placeholder（始终由 webview 接管）
          showPlaceholder(tab === 'webview' ? false : false);
        } else {
          if (tab === 'webview') {
            showPlaceholder(true);
          }
        }
      }, 50);
    } else {
      // 切到其他 tab：隐藏所有 webview，避免遮挡
      window.electronAPI.webviewHide();
    }
  });

  // 初始状态：显示占位符
  showPlaceholder(true);
})();
