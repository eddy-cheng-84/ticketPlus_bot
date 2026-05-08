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

  function findVip2PanelButton() {
    const panelCandidates = document.querySelectorAll('div.v-expansion-panel.filter-processed[value="3"]');
    for (const panel of panelCandidates) {
      const text = (panel.textContent || '').replace(/\s+/g, ' ');
      if (text.includes('2F VIP2（座席）')) {
        return panel.querySelector('button.v-expansion-panel-header');
      }
    }

    const fallbackHeaders = document.querySelectorAll('button.v-expansion-panel-header');
    for (const header of fallbackHeaders) {
      const text = (header.textContent || '').replace(/\s+/g, ' ');
      if (text.includes('2F VIP2（座席）')) {
        return header;
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

  function clickRefreshOnce() {
    const target = findRefreshButton();
    if (!target) {
      pushLog('手動點擊失敗：未找到「更新票數」按鈕');
      return { ok: false, error: 'REFRESH_BUTTON_NOT_FOUND' };
    }

    target.click();
    pushLog('手動點擊成功：「更新票數」');
    return { ok: true };
  }

  function clickVip2Panel() {
    const target = findVip2PanelButton();
    if (!target) {
      pushLog('手動點擊失敗：未找到「2F VIP2（座席）」區塊');
      return { ok: false, error: 'VIP2_PANEL_NOT_FOUND' };
    }

    target.click();
    pushLog('手動點擊成功：「2F VIP2（座席）」區塊');
    return { ok: true };
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
      return;
    }

    if (message.type === 'CLICK_REFRESH_ONCE') {
      sendResponse(clickRefreshOnce());
      return;
    }

    if (message.type === 'CLICK_VIP2_PANEL') {
      sendResponse(clickVip2Panel());
      return;
    }

    if (message.type === 'CLICK_REFRESH_AND_VIP2') {
      const refreshResult = clickRefreshOnce();
      if (!refreshResult.ok) {
        sendResponse({ ok: false, step: 'refresh', error: refreshResult.error });
        return;
      }

      const vip2Result = clickVip2Panel();
      if (!vip2Result.ok) {
        sendResponse({ ok: false, step: 'vip2', error: vip2Result.error });
        return;
      }

      sendResponse({ ok: true });
    }
  });

  pushLog('內容腳本已載入，等待指令');
  console.log('[ticket_plus_bot] content script ready:', window.location.href);
})();
