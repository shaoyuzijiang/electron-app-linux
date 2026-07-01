// Webview 嵌入网页页签交互逻辑
// 负责计算 WebContentsView 的 bounds、与主进程 IPC 通信、resize 同步

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

  // 打开网页
  async function openWebview(url) {
    url = normalizeUrl(url);
    if (!url) {
      alert('请输入网址');
      return;
    }
    const bounds = calculateBounds();
    const result = await window.electronAPI.webviewCreate(url, bounds);
    if (!result.success) {
      alert('无法打开网页: ' + (result.message || '未知错误'));
      return;
    }
    showPlaceholder(false);
    // 更新输入框为规范化后的 URL
    urlInput.value = url;
  }

  // 按钮事件
  goBtn.addEventListener('click', () => openWebview(urlInput.value));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openWebview(urlInput.value);
  });

  closeBtn.addEventListener('click', async () => {
    await window.electronAPI.webviewClose();
    urlInput.value = '';
    showPlaceholder(true);
  });

  // 后退 / 前进 / 刷新
  backBtn.addEventListener('click', async () => {
    const info = await window.electronAPI.webviewGetInfo();
    if (info.success) {
      await window.electronAPI.webviewGoBack();
    }
  });

  forwardBtn.addEventListener('click', async () => {
    const info = await window.electronAPI.webviewGetInfo();
    if (info.success) {
      await window.electronAPI.webviewGoForward();
    }
  });

  reloadBtn.addEventListener('click', async () => {
    const info = await window.electronAPI.webviewGetInfo();
    if (info.success) {
      await window.electronAPI.webviewReload();
    }
  });

  // 窗口 resize 时同步调整 webview 大小
  window.addEventListener('resize', () => {
    if (webviewPage.style.display === 'none') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      await window.electronAPI.webviewResize(calculateBounds());
    }, 100);
  });

  // 监听 tab 切换事件（由 meeting.js 的 switchTab 派发）
  document.addEventListener('tab-switched', (e) => {
    if (e.detail.tab === 'webview') {
      // 切到 webview tab：若有活跃视图则重新计算 bounds 并显示
      setTimeout(async () => {
        const info = await window.electronAPI.webviewGetInfo();
        if (info.success) {
          await window.electronAPI.webviewResize(calculateBounds());
          await window.electronAPI.webviewShow();
          showPlaceholder(false);
        } else {
          showPlaceholder(true);
        }
      }, 50);
    } else {
      // 切到其他 tab：隐藏 webview，避免遮挡其他页面
      window.electronAPI.webviewHide();
    }
  });

  // 初始状态：显示占位符
  showPlaceholder(true);
})();
