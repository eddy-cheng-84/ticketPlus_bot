(() => {
  const INTERVAL_MS = 10000;
  const MAX_LOGS = 200;

  let running = false;
  let timerId = null;
  let autoTargets = [];
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

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function findPanelButtonByText(keyword) {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) {
      return null;
    }

    const panelCandidates = document.querySelectorAll('div.v-expansion-panel.filter-processed');
    for (const panel of panelCandidates) {
      const text = normalizeText(panel.textContent || '');
      if (text.includes(normalizedKeyword)) {
        return panel.querySelector('button.v-expansion-panel-header');
      }
    }

    const fallbackHeaders = document.querySelectorAll('button.v-expansion-panel-header');
    for (const header of fallbackHeaders) {
      const text = normalizeText(header.textContent || '');
      if (text.includes(normalizedKeyword)) {
        return header;
      }
    }

    return null;
  }

  function collectPanelAreas() {
    const headers = document.querySelectorAll('button.v-expansion-panel-header');
    const seen = new Set();
    const areas = [];
    for (const header of headers) {
      const text = normalizeText(header.textContent || '');
      if (!text || seen.has(text)) {
        continue;
      }
      seen.add(text);
      areas.push(text);
    }
    return areas;
  }

  function clickFirstAvailableAutoTarget() {
    if (!Array.isArray(autoTargets) || autoTargets.length === 0) {
      return { ok: false, error: 'NO_AUTO_TARGETS' };
    }

    for (const keyword of autoTargets) {
      const target = findPanelButtonByText(keyword);
      if (!target) {
        continue;
      }
      target.click();
      pushLog(`自動點擊成功（優先順序）：「${keyword}」`);
      return { ok: true, matched: keyword };
    }

    pushLog('自動點擊失敗：未找到任何已勾選票區');
    return { ok: false, error: 'NO_MATCHED_PANEL' };
  }

  function tick() {
    if (!running) {
      return;
    }

    const refreshResult = clickRefreshOnce();
    if (!refreshResult.ok) {
      return;
    }

    if (autoTargets.length > 0) {
      clickFirstAvailableAutoTarget();
    }
  }

  function start(targets = []) {
    if (running) {
      pushLog('啟動請求略過：目前已在執行');
      return;
    }

    autoTargets = Array.isArray(targets)
      ? targets.map((item) => normalizeText(item)).filter(Boolean)
      : [];
    running = true;
    timerId = window.setInterval(tick, INTERVAL_MS);
    pushLog(`已啟動，每 ${INTERVAL_MS / 1000} 秒執行一次，目標數：${autoTargets.length}`);
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

  function clickPanelByText(keyword) {
    const target = findPanelButtonByText(keyword);
    if (!target) {
      pushLog(`手動點擊失敗：未找到「${keyword}」區塊`);
      return { ok: false, error: 'PANEL_NOT_FOUND' };
    }

    target.click();
    pushLog(`手動點擊成功：「${keyword}」區塊`);
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
      start(message.targets);
      sendResponse({ ok: true, running: true, targets: autoTargets });
      return;
    }

    if (message.type === 'STOP_BOT') {
      stop();
      sendResponse({ ok: true, running: false });
      return;
    }

    if (message.type === 'GET_BOT_STATUS') {
      sendResponse({ ok: true, running, intervalMs: INTERVAL_MS, targets: autoTargets });
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

    if (message.type === 'CLICK_PANEL_BY_TEXT') {
      const keyword = normalizeText(message.text || '');
      if (!keyword) {
        sendResponse({ ok: false, error: 'EMPTY_KEYWORD' });
        return;
      }
      sendResponse(clickPanelByText(keyword));
      return;
    }

    if (message.type === 'CLICK_REFRESH_AND_PANEL_BY_TEXT') {
      const keyword = normalizeText(message.text || '');
      if (!keyword) {
        sendResponse({ ok: false, error: 'EMPTY_KEYWORD' });
        return;
      }
      const refreshResult = clickRefreshOnce();
      if (!refreshResult.ok) {
        sendResponse({ ok: false, step: 'refresh', error: refreshResult.error });
        return;
      }

      const panelResult = clickPanelByText(keyword);
      if (!panelResult.ok) {
        sendResponse({ ok: false, step: 'panel', error: panelResult.error });
        return;
      }

      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'GET_PANEL_AREAS') {
      sendResponse({ ok: true, areas: collectPanelAreas() });
      return;
    }

    if (message.type === 'SET_AUTO_TARGETS') {
      autoTargets = Array.isArray(message.targets)
        ? message.targets.map((item) => normalizeText(item)).filter(Boolean)
        : [];
      pushLog(`已更新自動目標，共 ${autoTargets.length} 個`);
      sendResponse({ ok: true, targets: autoTargets });
    }
  });

  pushLog('內容腳本已載入，等待指令');
  console.log('[ticket_plus_bot] content script ready:', window.location.href);
})();
