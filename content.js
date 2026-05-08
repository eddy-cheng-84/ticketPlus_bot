(() => {
  const INTERVAL_MS = 10000;
  const MAX_LOGS = 200;
  const LOOP_RETRY_DELAY_MS = 500;

  let running = false;
  let timerId = null;
  let autoTargets = [];
  let startOptions = {};
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

  function getPanelEntries() {
    const headers = document.querySelectorAll('button.v-expansion-panel-header');
    const entries = [];
    for (const header of headers) {
      const name = normalizeText(header.textContent || '');
      if (!name) {
        continue;
      }
      entries.push({
        name,
        button: header,
        remaining: extractRemainingCount(name)
      });
    }
    return entries;
  }

  function extractRemainingCount(text) {
    const normalized = normalizeText(text);
    const match = normalized.match(/剩餘\s*(\d+)/);
    if (!match) {
      return null;
    }
    return Number.parseInt(match[1], 10);
  }

  function isSoldOutEntry(entry) {
    return Number.isFinite(entry?.remaining) && entry.remaining <= 0;
  }

  function chooseEntryByOrder(entries, orderMode) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return null;
    }

    if (orderMode === 'bottom_to_top') {
      return entries[entries.length - 1];
    }
    if (orderMode === 'middle') {
      return entries[Math.floor(entries.length / 2)];
    }
    if (orderMode === 'random') {
      const index = Math.floor(Math.random() * entries.length);
      return entries[index];
    }
    return entries[0];
  }

  function collectPanelAreas() {
    const seen = new Set();
    const areas = [];
    for (const entry of getPanelEntries()) {
      const text = entry.name;
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

  async function runLoopMode() {
    while (running) {
      const flowResult = await runPurchaseFlow(startOptions, { includeNextStep: true });
      if (!running) {
        return;
      }
      if (!flowResult.ok) {
        pushLog(`流程失敗：${flowResult.step || 'unknown'} / ${flowResult.error || 'UNKNOWN'}`);
        await sleep(LOOP_RETRY_DELAY_MS);
        continue;
      }
      pushLog('流程完成，0.5 秒後重跑流程');
      await sleep(LOOP_RETRY_DELAY_MS);
    }
  }

  function start(options = {}) {
    if (running) {
      pushLog('啟動請求略過：目前已在執行');
      return;
    }

    autoTargets = Array.isArray(options.selectedTargets)
      ? options.selectedTargets.map((item) => normalizeText(item)).filter(Boolean)
      : [];
    startOptions = {
      selectedTargets: autoTargets,
      orderMode: options.orderMode || 'top_to_bottom',
      plusCount: options.plusCount,
      refreshToAreaDelayMs: options.refreshToAreaDelayMs,
      areaToPlusDelayMs: options.areaToPlusDelayMs
    };
    running = true;
    pushLog(`已啟動流程 loop，目標數：${autoTargets.length}`);
    runLoopMode();
    console.log('[ticket_plus_bot] flow loop started');
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

  function clickPlusOnActivePanel() {
    const activePanel = document.querySelector('div.v-expansion-panel.v-expansion-panel--active');
    if (!activePanel) {
      pushLog('手動點擊失敗：找不到展開中的票區');
      return { ok: false, error: 'ACTIVE_PANEL_NOT_FOUND' };
    }

    const plusIcon = activePanel.querySelector('i.mdi.mdi-plus');
    if (!plusIcon) {
      pushLog('手動點擊失敗：找不到 + 圖示');
      return { ok: false, error: 'PLUS_ICON_NOT_FOUND' };
    }

    const plusButton = plusIcon.closest('button');
    if (!plusButton) {
      pushLog('手動點擊失敗：找不到 + 按鈕');
      return { ok: false, error: 'PLUS_BUTTON_NOT_FOUND' };
    }

    plusButton.click();
    pushLog('手動點擊成功：已點擊 + 按鈕');
    return { ok: true };
  }

  function clickPlusTimes(count) {
    const normalizedCount = Number.isFinite(count) ? count : 1;
    const times = Math.min(4, Math.max(0, normalizedCount));
    if (times === 0) {
      pushLog('手動點擊：設定 0 張票，略過點 +');
      return { ok: true, clicked: 0 };
    }
    for (let i = 0; i < times; i += 1) {
      const result = clickPlusOnActivePanel();
      if (!result.ok) {
        return { ok: false, error: result.error, clicked: i };
      }
    }
    pushLog(`手動點擊成功：已點擊 + ${times} 次`);
    return { ok: true, clicked: times };
  }

  function selectPanelForFlow(selectedTargets, orderMode) {
    const entries = getPanelEntries();
    if (entries.length === 0) {
      return { ok: false, error: 'NO_PANEL_ENTRIES' };
    }

    let candidates = [];
    const normalizedTargets = Array.isArray(selectedTargets)
      ? selectedTargets.map((item) => normalizeText(item)).filter(Boolean)
      : [];

    if (normalizedTargets.length > 0) {
      for (const target of normalizedTargets) {
        const targetMatches = entries.filter((entry) => entry.name.includes(target));
        const availableMatches = targetMatches.filter((entry) => !isSoldOutEntry(entry));
        if (availableMatches.length > 0) {
          candidates = availableMatches;
          break;
        }
        if (targetMatches.length > 0) {
          pushLog(`略過票區（剩餘 0）：「${target}」`);
        }
      }
      if (candidates.length === 0) {
        return { ok: false, error: 'DESIRED_TARGETS_SOLD_OUT' };
      }
    } else {
      candidates = entries.filter((entry) => !isSoldOutEntry(entry));
      if (candidates.length === 0) {
        return { ok: false, error: 'ALL_VISIBLE_TARGETS_SOLD_OUT' };
      }
    }

    const picked = chooseEntryByOrder(candidates, orderMode);
    if (!picked || !picked.button) {
      return { ok: false, error: 'NO_CANDIDATE_PICKED' };
    }

    picked.button.click();
    pushLog(`流程點擊票區成功：「${picked.name}」`);
    return { ok: true, matched: picked.name };
  }

  function clickNextStepButton() {
    const candidates = document.querySelectorAll('span.v-btn__content');
    for (const span of candidates) {
      if (normalizeText(span.textContent || '') !== '下一步') {
        continue;
      }

      const target = span.closest('button, [role="button"], .v-btn');
      if (!target) {
        continue;
      }

      target.click();
      pushLog('手動點擊成功：已點擊「下一步」');
      return { ok: true };
    }

    pushLog('手動點擊失敗：未找到「下一步」按鈕');
    return { ok: false, error: 'NEXT_STEP_NOT_FOUND' };
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function runPurchaseFlow(options = {}, runtimeOptions = {}) {
    const plusCountParsed = Number.parseInt(String(options.plusCount || '1'), 10);
    const plusCount = Number.isFinite(plusCountParsed)
      ? Math.min(4, Math.max(0, plusCountParsed))
      : 1;
    const delayParsed = Number.parseInt(String(options.areaToPlusDelayMs || '0'), 10);
    const areaToPlusDelayMs = Number.isFinite(delayParsed) && delayParsed > 0 ? delayParsed : 0;
    const refreshDelayParsed = Number.parseInt(String(options.refreshToAreaDelayMs || '0'), 10);
    const refreshToAreaDelayMs = Number.isFinite(refreshDelayParsed) && refreshDelayParsed > 0
      ? refreshDelayParsed
      : 1000;

    let attempt = 0;
    let panelResult = null;
    while (true) {
      if (!running && runtimeOptions.includeNextStep) {
        return { ok: false, step: 'stopped', error: 'LOOP_STOPPED' };
      }
      attempt += 1;
      const refreshResult = clickRefreshOnce();
      if (!refreshResult.ok) {
        return { ok: false, step: 'refresh', error: refreshResult.error };
      }

      if (refreshToAreaDelayMs > 0) {
        pushLog(`流程等待：重新整理時秒數 ${refreshToAreaDelayMs}ms`);
        await sleep(refreshToAreaDelayMs);
      }

      panelResult = selectPanelForFlow(
        options.selectedTargets || [],
        options.orderMode || 'top_to_bottom'
      );
      if (!panelResult.ok) {
        if (panelResult.error === 'DESIRED_TARGETS_SOLD_OUT' || panelResult.error === 'ALL_VISIBLE_TARGETS_SOLD_OUT') {
          pushLog('目前可見票區剩餘皆為 0，將重新整理後重試');
          continue;
        }
        return { ok: false, step: 'panel', error: panelResult.error };
      }

      if (areaToPlusDelayMs > 0) {
        pushLog(`流程等待：選區後延遲 ${areaToPlusDelayMs}ms`);
        await sleep(areaToPlusDelayMs);
      }

      const plusResult = clickPlusTimes(plusCount);
      if (plusResult.ok) {
        if (runtimeOptions.includeNextStep) {
          const nextResult = clickNextStepButton();
          if (!nextResult.ok) {
            return { ok: false, step: 'next_step', error: nextResult.error };
          }
          await sleep(500);
        }
        pushLog('一鍵流程完成：更新票數 -> 選票區 -> 點 +' + (runtimeOptions.includeNextStep ? ' -> 下一步' : ''));
        return {
          ok: true,
          matched: panelResult.matched,
          plusCount,
          refreshToAreaDelayMs,
          areaToPlusDelayMs,
          attempt
        };
      }

      if (plusResult.error === 'PLUS_ICON_NOT_FOUND' || plusResult.error === 'PLUS_BUTTON_NOT_FOUND') {
        pushLog(`流程重試：未找到 +，將重新整理後再試（第 ${attempt} 次）`);
        continue;
      }

      return { ok: false, step: 'plus', error: plusResult.error };
    }

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
      start(message);
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
      return;
    }

    if (message.type === 'CLICK_PLUS_ON_ACTIVE_PANEL') {
      sendResponse(clickPlusOnActivePanel());
      return;
    }

    if (message.type === 'CLICK_NEXT_STEP') {
      sendResponse(clickNextStepButton());
      return;
    }

    if (message.type === 'RUN_PURCHASE_FLOW') {
      runPurchaseFlow(message).then((result) => {
        sendResponse(result);
      });
      return true;
    }
  });

  pushLog('內容腳本已載入，等待指令');
  console.log('[ticket_plus_bot] content script ready:', window.location.href);
})();
