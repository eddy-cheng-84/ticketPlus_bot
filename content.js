(() => {
  const INTERVAL_MS = 10000;
  const MAX_LOGS = 200;

  let running = false;
  let timerId = null;
  const logs = [];

  function pushLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    logs.push(`[${timestamp}] ${message}`);
    if (logs.length > MAX_LOGS) {
      logs.shift();
    }
  }

  function findRefreshButton() {
    const candidates = document.querySelectorAll('span.v-btn__content');
    for (const span of candidates) {
      if ((span.textContent || '').includes('更新票數')) {
        return span.closest('button, [role="button"], .v-btn');
      }
    }
    return null;
  }

  function tick() {
    if (!running) {
      return;
    }

    const target = findRefreshButton();
    if (target) {
      target.click();
      pushLog('偵測到「更新票數」，已點擊');
      console.log('[ticket_plus_bot] clicked 更新票數 button');
      return;
    }

    pushLog('未找到「更新票數」按鈕');
  }

  function start() {
    if (running) {
      pushLog('啟動請求略過：目前已在執行');
      return;
    }

    running = true;
    timerId = window.setInterval(tick, INTERVAL_MS);
    pushLog(`已啟動，每 ${INTERVAL_MS / 1000} 秒執行一次`);
    tick();
    console.log('[ticket_plus_bot] auto click started');
  }

  function stop() {
    if (!running) {
      pushLog('暫停請求略過：目前已停止');
      return;
    }

    running = false;
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }

    pushLog('已暫停');
    console.log('[ticket_plus_bot] auto click stopped');
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'START_BOT') {
      start();
      sendResponse({ ok: true, running: true });
      return;
    }

    if (message.type === 'STOP_BOT') {
      stop();
      sendResponse({ ok: true, running: false });
      return;
    }

    if (message.type === 'GET_BOT_STATUS') {
      sendResponse({ ok: true, running, intervalMs: INTERVAL_MS });
      return;
    }

    if (message.type === 'GET_BOT_LOGS') {
      sendResponse({ ok: true, logs });
    }
  });

  pushLog('內容腳本已載入，等待指令');
  console.log('[ticket_plus_bot] content script ready:', window.location.href);
})();
