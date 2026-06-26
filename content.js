(() => {
  const INTERVAL_MS = 10000;
  const MAX_LOGS = 2000;
  const LOOP_RETRY_DELAY_MS = 500;
  const PLUS_CLICK_DELAY_MS = 50;
  const AFTER_PLUS_BEFORE_NEXT_MS = 100;
  const QUEUE_WAIT_POLL_MS = 1000;
  const PANEL_OBSERVE_INTERVAL_MS = 150;
  const PANEL_SCAN_SCROLL_DELAY_MS = 120;
  const ACTIVITY_BUTTON_LABELS = ['立即購買', '尚未開賣'];
  const SCHEDULE_STATE_KEY = 'content_schedule_state_v1';
  const BOT_RUNTIME_KEY = 'bot_runtime_state_v1';

  let running = false;
  let runGeneration = 0;
  let timerId = null;
  let autoTargets = [];
  let startOptions = {};
  let scheduleTimerId = null;
  let scheduleState = {
    enabled: false,
    startTime: '11:00:01',
    stopTime: '11:01:00',
    options: {},
    lastTickSec: null,
    lastStartDate: '',
    lastStopDate: ''
  };
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

  function clickIKnowButtons() {
    const spans = document.querySelectorAll('span.v-btn__content');
    const clicked = new Set();
    let count = 0;

    for (const span of spans) {
      const text = normalizeText(span.textContent || '');
      if (text !== '我知道了') {
        continue;
      }
      const button = span.closest('button, [role="button"], .v-btn');
      if (!button || clicked.has(button)) {
        continue;
      }
      clicked.add(button);
      button.click();
      count += 1;
    }

    if (count > 0) {
      pushLog(`自動點擊成功：已點擊「我知道了」${count} 次`);
    }
  }

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function getPageMode() {
    const pathname = window.location.pathname || '';
    if (pathname.startsWith('/confirmSeat/')) {
      return 'confirm_seat';
    }
    if (pathname.startsWith('/activity/')) {
      return 'activity';
    }
    if (pathname.startsWith('/order/')) {
      return 'order';
    }
    return 'other';
  }

  function findButtonByExactText(labels) {
    const normalizedLabels = Array.isArray(labels)
      ? labels.map((label) => normalizeText(label)).filter(Boolean)
      : [normalizeText(labels)].filter(Boolean);

    if (normalizedLabels.length === 0) {
      return null;
    }

    const spans = document.querySelectorAll('span.v-btn__content');
    for (const span of spans) {
      const text = normalizeText(span.textContent || '');
      if (!normalizedLabels.includes(text)) {
        continue;
      }

      const button = span.closest('button, [role="button"], .v-btn');
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
        continue;
      }
      return {
        button,
        text
      };
    }

    return null;
  }

  function clickActivityEntryButton() {
    const matched = findButtonByExactText(ACTIVITY_BUTTON_LABELS);
    if (!matched) {
      pushLog('活動頁流程等待：未找到「立即購買」或「尚未開賣」按鈕');
      return { ok: false, error: 'ACTIVITY_BUTTON_NOT_FOUND' };
    }

    matched.button.click();
    pushLog(`活動頁流程點擊成功：「${matched.text}」`);
    return { ok: true, clickedText: matched.text };
  }

  function stopBecauseConfirmSeatPage() {
    if (!running) {
      return;
    }

    pushLog('已進入結帳頁（confirmSeat），停止自動流程');
    stop();
  }

  function sanitizeScheduleOptions(options) {
    return {
      selectedTargets: Array.isArray(options?.selectedTargets)
        ? options.selectedTargets.map((item) => buildAreaKey(item)).filter(Boolean)
        : [],
      orderMode: options?.orderMode || 'top_to_bottom',
      plusCount: options?.plusCount,
      refreshToAreaDelayMs: options?.refreshToAreaDelayMs,
      areaToPlusDelayMs: options?.areaToPlusDelayMs
    };
  }

  function sanitizeRunOptions(options) {
    return {
      selectedTargets: Array.isArray(options?.selectedTargets)
        ? options.selectedTargets.map((item) => buildAreaKey(item)).filter(Boolean)
        : [],
      orderMode: options?.orderMode || 'top_to_bottom',
      plusCount: options?.plusCount,
      refreshToAreaDelayMs: options?.refreshToAreaDelayMs,
      areaToPlusDelayMs: options?.areaToPlusDelayMs
    };
  }

  async function persistBotRuntimeState() {
    await chrome.storage.local.set({
      [BOT_RUNTIME_KEY]: {
        running,
        options: sanitizeRunOptions(startOptions)
      }
    });
  }

  async function clearBotRuntimeState() {
    await chrome.storage.local.set({
      [BOT_RUNTIME_KEY]: {
        running: false,
        options: {}
      }
    });
  }

  async function loadBotRuntimeState() {
    const result = await chrome.storage.local.get(BOT_RUNTIME_KEY);
    const saved = result?.[BOT_RUNTIME_KEY];
    if (!saved || typeof saved !== 'object' || !saved.running) {
      return;
    }

    const restoredOptions = sanitizeRunOptions(saved.options);
    start(restoredOptions);
    pushLog('已從儲存狀態恢復流程執行');
  }

  async function persistScheduleState() {
    await chrome.storage.local.set({
      [SCHEDULE_STATE_KEY]: {
        enabled: scheduleState.enabled,
        startTime: scheduleState.startTime,
        stopTime: scheduleState.stopTime,
        options: sanitizeScheduleOptions(scheduleState.options)
      }
    });
  }

  async function loadScheduleStateFromStorage() {
    const result = await chrome.storage.local.get(SCHEDULE_STATE_KEY);
    const saved = result?.[SCHEDULE_STATE_KEY];
    if (!saved || typeof saved !== 'object') {
      return;
    }
    const startTime = normalizeHmsTime(saved.startTime || '');
    const stopTime = normalizeHmsTime(saved.stopTime || '');
    if (!startTime || !stopTime) {
      return;
    }
    scheduleState.enabled = Boolean(saved.enabled);
    scheduleState.startTime = startTime;
    scheduleState.stopTime = stopTime;
    scheduleState.options = sanitizeScheduleOptions(saved.options);
    scheduleState.lastTickSec = timeHmsToSeconds(getCurrentTimeHms());
  }

  function buildAreaKey(rawText) {
    let key = normalizeText(rawText);
    key = key.replace(/剩餘\s*\d+/g, '');
    key = key.replace(/熱賣中|已售完|完售|開賣時間|即將開賣|登記抽選/g, '');
    return normalizeText(key);
  }

  function normalizeHmsTime(value) {
    const raw = normalizeText(value);
    const match = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return '';
    }
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    const second = Number.parseInt(match[3], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
      return '';
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  }

  function getCurrentTimeHms() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function getCurrentDateYmd() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function timeHmsToSeconds(hms) {
    const normalized = normalizeHmsTime(hms);
    if (!normalized) {
      return -1;
    }
    const [h, m, s] = normalized.split(':').map((x) => Number.parseInt(x, 10));
    return h * 3600 + m * 60 + s;
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
      const label = normalizeText(header.textContent || '');
      if (!label) {
        continue;
      }
      const key = buildAreaKey(label);
      if (!key) {
        continue;
      }
      entries.push({
        key,
        label,
        button: header,
        remaining: extractRemainingCount(label)
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

  function isHotSellingEntry(entry) {
    return normalizeText(entry?.label || '').includes('熱賣中');
  }

  function hasPositiveRemaining(entry) {
    return Number.isFinite(entry?.remaining) && entry.remaining > 0;
  }

  function isSelectableEntry(entry) {
    return hasPositiveRemaining(entry) || isHotSellingEntry(entry);
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
      if (!entry.key || seen.has(entry.key)) {
        continue;
      }
      seen.add(entry.key);
      areas.push({
        key: entry.key,
        label: entry.label,
        remaining: entry.remaining
      });
    }
    return areas;
  }

  function summarizeAreaLabels(areas) {
    if (!Array.isArray(areas) || areas.length === 0) {
      return '無';
    }
    return areas.map((area) => area.label || area.key).join(' | ');
  }

  async function collectAllPanelAreas() {
    const initialEntries = getPanelEntries();
    const merged = new Map();

    const appendAreas = (areas) => {
      for (const area of areas) {
        if (!area?.key) {
          continue;
        }

        if (!merged.has(area.key)) {
          merged.set(area.key, area);
          continue;
        }

        const existing = merged.get(area.key);
        if (!Number.isFinite(existing?.remaining) && Number.isFinite(area.remaining)) {
          merged.set(area.key, area);
        }
      }
    };

    appendAreas(
      initialEntries.map((entry) => ({
        key: entry.key,
        label: entry.label,
        remaining: entry.remaining
      }))
    );
    pushLog(`票區掃描：初始可見 header ${initialEntries.length} 個，初始區域 ${merged.size} 個`);
    pushLog(`票區掃描：初始區域列表 -> ${summarizeAreaLabels(Array.from(merged.values()))}`);

    const originalScrollTop = window.scrollY || window.pageYOffset || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const documentHeight = Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0
    );
    const maxScrollTop = Math.max(0, documentHeight - viewportHeight);
    const step = Math.max(240, Math.floor(viewportHeight * 0.8));
    pushLog(
      `票區掃描：改用整頁 scroll，viewportHeight=${viewportHeight} documentHeight=${documentHeight} step=${step}`
    );

    window.scrollTo(0, 0);
    await sleep(PANEL_SCAN_SCROLL_DELAY_MS);
    {
      const visibleAreas = collectPanelAreas();
      const beforeCount = merged.size;
      appendAreas(visibleAreas);
      pushLog(
        `票區掃描：頂部視窗新增 ${merged.size - beforeCount} 個，累計 ${merged.size} 個 -> ${summarizeAreaLabels(visibleAreas)}`
      );
    }

    let currentScrollTop = 0;
    let scrollStepIndex = 0;
    while (currentScrollTop < maxScrollTop) {
      currentScrollTop = Math.min(maxScrollTop, currentScrollTop + step);
      window.scrollTo(0, currentScrollTop);
      await sleep(PANEL_SCAN_SCROLL_DELAY_MS);
      scrollStepIndex += 1;
      const visibleAreas = collectPanelAreas();
      const beforeCount = merged.size;
      appendAreas(visibleAreas);
      pushLog(
        `票區掃描：第 ${scrollStepIndex} 次整頁捲動 scrollTop=${currentScrollTop}，新增 ${merged.size - beforeCount} 個，累計 ${merged.size} 個 -> ${summarizeAreaLabels(visibleAreas)}`
      );
    }

    window.scrollTo(0, originalScrollTop);
    await sleep(PANEL_SCAN_SCROLL_DELAY_MS);
    pushLog(
      `票區掃描完成：總共收集 ${merged.size} 個區域 -> ${summarizeAreaLabels(Array.from(merged.values()))}`
    );

    return Array.from(merged.values());
  }

  function buildEntriesSnapshot(entries) {
    return entries
      .map((entry) => `${entry.key}|${entry.remaining ?? 'null'}`)
      .join('||');
  }

  async function observePanelEntriesDuringDelay(delayMs, isCancelled) {
    const totalDelayMs = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
    if (totalDelayMs <= 0) {
      return {
        entries: getPanelEntries(),
        observedCount: 1,
        stableCount: 0
      };
    }

    const startedAt = Date.now();
    let latestEntries = getPanelEntries();
    let latestSignature = buildEntriesSnapshot(latestEntries);
    let lastNonEmptyEntries = latestEntries.length > 0 ? latestEntries : [];
    let stableCount = 0;
    let observedCount = 1;

    while (Date.now() - startedAt < totalDelayMs) {
      if (typeof isCancelled === 'function' && isCancelled()) {
        return {
          entries: lastNonEmptyEntries,
          observedCount,
          stableCount,
          cancelled: true
        };
      }

      await sleep(Math.min(PANEL_OBSERVE_INTERVAL_MS, totalDelayMs));
      const nextEntries = getPanelEntries();
      const nextSignature = buildEntriesSnapshot(nextEntries);
      observedCount += 1;

      if (nextEntries.length > 0) {
        lastNonEmptyEntries = nextEntries;
      }

      if (nextSignature === latestSignature) {
        stableCount += 1;
      } else {
        stableCount = 0;
        latestEntries = nextEntries;
        latestSignature = nextSignature;
      }
    }

    return {
      entries: lastNonEmptyEntries.length > 0 ? lastNonEmptyEntries : latestEntries,
      observedCount,
      stableCount
    };
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
    const generation = runGeneration;
    while (running) {
      if (generation !== runGeneration) {
        return;
      }
      const pageMode = getPageMode();
      if (pageMode === 'confirm_seat') {
        stopBecauseConfirmSeatPage();
        return;
      }
      if (pageMode === 'activity') {
        clickActivityEntryButton();
        await sleep(LOOP_RETRY_DELAY_MS);
        continue;
      }
      if (pageMode !== 'order') {
        pushLog(`流程等待：目前頁面 ${window.location.pathname} 尚未進入 activity/order/confirmSeat 目標流程`);
        await sleep(LOOP_RETRY_DELAY_MS);
        continue;
      }
      const flowResult = await runPurchaseFlow(startOptions, { includeNextStep: true });
      if (!running) {
        return;
      }
      if (generation !== runGeneration) {
        return;
      }
      if (!flowResult.ok) {
        pushLog(`流程失敗：${flowResult.step || 'unknown'} / ${flowResult.error || 'UNKNOWN'}`);
        await sleep(LOOP_RETRY_DELAY_MS);
        continue;
      }

      pushLog('流程完成，進入下一輪');
    }
  }

  function start(options = {}) {
    if (running) {
      pushLog('啟動請求略過：目前已在執行');
      return;
    }

    autoTargets = Array.isArray(options.selectedTargets)
      ? options.selectedTargets.map((item) => buildAreaKey(item)).filter(Boolean)
      : [];
    startOptions = sanitizeRunOptions({
      selectedTargets: autoTargets,
      orderMode: options.orderMode || 'top_to_bottom',
      plusCount: options.plusCount,
      refreshToAreaDelayMs: options.refreshToAreaDelayMs,
      areaToPlusDelayMs: options.areaToPlusDelayMs
    });
    running = true;
    runGeneration += 1;
    persistBotRuntimeState();
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

  function findPlusButtonInContainer(container) {
    if (!container) {
      return null;
    }

    const plusButtons = container.querySelectorAll('button:has(i.mdi.mdi-plus), button i.mdi.mdi-plus');
    for (const candidate of plusButtons) {
      const button = candidate.tagName === 'BUTTON' ? candidate : candidate.closest('button');
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
        continue;
      }
      return button;
    }

    const plusIcon = container.querySelector('i.mdi.mdi-plus');
    if (!plusIcon) {
      return null;
    }

    const plusButton = plusIcon.closest('button');
    if (!plusButton || plusButton.disabled || plusButton.getAttribute('aria-disabled') === 'true') {
      return null;
    }

    return plusButton;
  }

  function clickPlusOnActivePanel(panelContext = null) {
    const searchContainers = [];
    if (panelContext) {
      searchContainers.push(panelContext);
    }

    const activePanel = document.querySelector('div.v-expansion-panel.v-expansion-panel--active');
    if (activePanel && activePanel !== panelContext) {
      searchContainers.push(activePanel);
    }

    searchContainers.push(document);

    for (const container of searchContainers) {
      const plusButton = findPlusButtonInContainer(container);
      if (!plusButton) {
        continue;
      }

      plusButton.click();
      pushLog('手動點擊成功：已點擊 + 按鈕');
      return { ok: true };
    }

    if (!activePanel && !panelContext) {
      pushLog('手動點擊失敗：找不到展開中的票區');
      return { ok: false, error: 'ACTIVE_PANEL_NOT_FOUND' };
    }

    pushLog('手動點擊失敗：找不到 + 圖示');
    return { ok: false, error: 'PLUS_ICON_NOT_FOUND' };
  }

  async function clickPlusTimes(count, panelContext = null) {
    const normalizedCount = Number.isFinite(count) ? count : 1;
    const times = Math.min(4, Math.max(0, normalizedCount));
    if (times === 0) {
      pushLog('手動點擊：設定 0 張票，略過點 +');
      return { ok: true, clicked: 0 };
    }
    for (let i = 0; i < times; i += 1) {
      const result = clickPlusOnActivePanel(panelContext);
      if (!result.ok) {
        return { ok: false, error: result.error, clicked: i };
      }
      if (i < times - 1) {
        await sleep(PLUS_CLICK_DELAY_MS);
      }
    }
    pushLog(`手動點擊成功：已點擊 + ${times} 次`);
    return { ok: true, clicked: times };
  }

  function selectPanelForFlow(selectedTargetKeys, orderMode, providedEntries = null) {
    const entries = Array.isArray(providedEntries) ? providedEntries : getPanelEntries();
    if (entries.length === 0) {
      return { ok: false, error: 'NO_PANEL_ENTRIES' };
    }

    let candidates = [];
    const normalizedTargetKeys = Array.isArray(selectedTargetKeys)
      ? selectedTargetKeys.map((item) => buildAreaKey(item)).filter(Boolean)
      : [];

    if (normalizedTargetKeys.length > 0) {
      for (const targetKey of normalizedTargetKeys) {
        const targetMatches = entries.filter((entry) => entry.key === targetKey);
        const availableMatches = targetMatches.filter((entry) => isSelectableEntry(entry));
        if (availableMatches.length > 0) {
          candidates = availableMatches;
          break;
        }
        if (targetMatches.length > 0) {
          const hasKnownZero = targetMatches.some((entry) => isSoldOutEntry(entry));
          pushLog(
            hasKnownZero
              ? `略過票區（剩餘 0）：「${targetKey}」`
              : `略過票區（剩餘未知）：「${targetKey}」`
          );
        }
      }
      if (candidates.length === 0) {
        return { ok: false, error: 'DESIRED_TARGETS_UNAVAILABLE' };
      }
    } else {
      candidates = entries.filter((entry) => isSelectableEntry(entry));
      if (candidates.length === 0) {
        return { ok: false, error: 'ALL_VISIBLE_TARGETS_UNAVAILABLE' };
      }
    }

    const picked = chooseEntryByOrder(candidates, orderMode);
    if (!picked) {
      return { ok: false, error: 'NO_CANDIDATE_PICKED' };
    }

    const liveTarget = findPanelButtonByText(picked.key) || findPanelButtonByText(picked.label);
    if (!liveTarget) {
      return { ok: false, error: 'PANEL_BUTTON_STALE' };
    }

    liveTarget.click();
    pushLog(`流程點擊票區成功：「${picked.label}」`);
    return {
      ok: true,
      matched: picked.key,
      matchedLabel: picked.label,
      panelElement: liveTarget.closest('div.v-expansion-panel')
    };
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

  function isWaitingRoomPage() {
    const text = normalizeText(document.body?.innerText || '');
    if (!text) {
      return false;
    }

    return text.includes('請別離開頁面') && text.includes('同時使用多個裝置及視窗購票');
  }

  async function waitForWaitingRoomToFinish(isCancelled) {
    if (!isWaitingRoomPage()) {
      return { ok: true, waited: false };
    }

    const startHref = window.location.href;
    pushLog('偵測到排隊等待頁，暫停操作並等待自動跳轉');

    while (true) {
      if (typeof isCancelled === 'function' && isCancelled()) {
        return { ok: false, error: 'LOOP_CANCELLED' };
      }

      await sleep(QUEUE_WAIT_POLL_MS);

      if (!isWaitingRoomPage()) {
        pushLog('排隊等待頁已結束，恢復後續流程');
        return { ok: true, waited: true, redirected: window.location.href !== startHref };
      }
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function runPurchaseFlow(options = {}, runtimeOptions = {}) {
    const generation = runGeneration;
    const isCancelled = () => runtimeOptions.includeNextStep && generation !== runGeneration;
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
    let lastRefreshStartedAt = 0;
    while (true) {
      if (!running && runtimeOptions.includeNextStep) {
        return { ok: false, step: 'stopped', error: 'LOOP_STOPPED' };
      }
      if (isCancelled()) {
        return { ok: false, step: 'stopped', error: 'LOOP_CANCELLED' };
      }

      clickIKnowButtons();
      attempt += 1;
      const now = Date.now();
      const shouldRefresh = lastRefreshStartedAt === 0 || now - lastRefreshStartedAt >= refreshToAreaDelayMs;
      if (shouldRefresh) {
        const refreshResult = clickRefreshOnce();
        if (!refreshResult.ok) {
          return { ok: false, step: 'refresh', error: refreshResult.error };
        }
        lastRefreshStartedAt = Date.now();
        if (refreshToAreaDelayMs > 0) {
          pushLog(`流程計時：點擊更新票數 delay ${refreshToAreaDelayMs}ms（背景計時中）`);
        }
      }
      panelResult = selectPanelForFlow(
        options.selectedTargets || [],
        options.orderMode || 'top_to_bottom'
      );
      if (!panelResult.ok) {
        if (
          panelResult.error === 'DESIRED_TARGETS_UNAVAILABLE' ||
          panelResult.error === 'ALL_VISIBLE_TARGETS_UNAVAILABLE' ||
          panelResult.error === 'NO_PANEL_ENTRIES'
        ) {
          if (panelResult.error === 'NO_PANEL_ENTRIES') {
            pushLog('目前尚未讀到票區資料，持續等待本輪更新結果');
          } else {
            pushLog('目前可見票區沒有明確剩餘票數可選，持續等待本輪更新結果');
          }
          await sleep(LOOP_RETRY_DELAY_MS);
          continue;
        }
        return { ok: false, step: 'panel', error: panelResult.error };
      }

      if (areaToPlusDelayMs > 0) {
        pushLog(`流程等待：選區後延遲 ${areaToPlusDelayMs}ms`);
        await sleep(areaToPlusDelayMs);
        if (isCancelled()) {
          return { ok: false, step: 'stopped', error: 'LOOP_CANCELLED' };
        }
      }

      const plusResult = await clickPlusTimes(plusCount, panelResult.panelElement || null);
      if (plusResult.ok) {
        if (runtimeOptions.includeNextStep) {
          await sleep(AFTER_PLUS_BEFORE_NEXT_MS);
          if (isCancelled()) {
            return { ok: false, step: 'stopped', error: 'LOOP_CANCELLED' };
          }
          const nextResult = clickNextStepButton();
          if (!nextResult.ok) {
            return { ok: false, step: 'next_step', error: nextResult.error };
          }
          const queueWaitResult = await waitForWaitingRoomToFinish(isCancelled);
          if (!queueWaitResult.ok) {
            return { ok: false, step: 'queue_wait', error: queueWaitResult.error };
          }
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
        await sleep(LOOP_RETRY_DELAY_MS);
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
    runGeneration += 1;
    clearBotRuntimeState();
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }

    pushLog('已暫停');
    console.log('[ticket_plus_bot] auto click stopped');
  }

  function checkScheduleTick() {
    if (!scheduleState.enabled) {
      return;
    }

    const nowSec = timeHmsToSeconds(getCurrentTimeHms());
    const startSec = timeHmsToSeconds(scheduleState.startTime);
    const stopSec = timeHmsToSeconds(scheduleState.stopTime);
    const dateNow = getCurrentDateYmd();
    const prevSec = Number.isFinite(scheduleState.lastTickSec) ? scheduleState.lastTickSec : nowSec;

    if (startSec >= 0 && prevSec < startSec && nowSec >= startSec && scheduleState.lastStartDate !== dateNow) {
      scheduleState.lastStartDate = dateNow;
      start(scheduleState.options || {});
      pushLog(`排程觸發：自動啟動 ${scheduleState.startTime}`);
    }

    if (stopSec >= 0 && prevSec < stopSec && nowSec >= stopSec && scheduleState.lastStopDate !== dateNow) {
      scheduleState.lastStopDate = dateNow;
      stop();
      pushLog(`排程觸發：自動暫停 ${scheduleState.stopTime}`);
    }

    scheduleState.lastTickSec = nowSec;
  }

  function pollExternalTrigger() {
    chrome.runtime.sendMessage({ type: 'POLL_EXTERNAL_TRIGGER' }, (_response) => {
      void chrome.runtime.lastError;
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'START_BOT') {
      if (message.source === 'external_http_trigger') {
        pushLog('外部觸發：收到 HTTP 啟動信號');
      }
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
      sendResponse({
        ok: true,
        running,
        intervalMs: INTERVAL_MS,
        targets: autoTargets,
        scheduleEnabled: scheduleState.enabled,
        scheduleStartTime: scheduleState.startTime,
        scheduleStopTime: scheduleState.stopTime
      });
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
      collectAllPanelAreas().then((areas) => {
        sendResponse({ ok: true, areas });
      });
      return true;
    }

    if (message.type === 'SET_AUTO_TARGETS') {
      autoTargets = Array.isArray(message.targets)
        ? message.targets.map((item) => buildAreaKey(item)).filter(Boolean)
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

    if (message.type === 'SET_SCHEDULE') {
      const startTime = normalizeHmsTime(message.startTime || '');
      const stopTime = normalizeHmsTime(message.stopTime || '');
      if (!startTime || !stopTime) {
        sendResponse({ ok: false, error: 'INVALID_SCHEDULE_TIME' });
        return;
      }
      scheduleState.enabled = true;
      scheduleState.startTime = startTime;
      scheduleState.stopTime = stopTime;
      scheduleState.options = {
        ...sanitizeScheduleOptions(message)
      };
      scheduleState.lastStartDate = '';
      scheduleState.lastStopDate = '';
      scheduleState.lastTickSec = timeHmsToSeconds(getCurrentTimeHms());
      persistScheduleState();
      pushLog(`排程已啟用：${startTime} 啟動 / ${stopTime} 暫停`);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'STOP_SCHEDULE') {
      scheduleState.enabled = false;
      scheduleState.lastTickSec = null;
      stop();
      persistScheduleState();
      pushLog('排程已停止');
      sendResponse({ ok: true });
    }
  });

  loadScheduleStateFromStorage();
  loadBotRuntimeState();
  scheduleTimerId = window.setInterval(checkScheduleTick, 1000);
  window.setInterval(pollExternalTrigger, 1000);
  pollExternalTrigger();
  pushLog('內容腳本已載入，等待指令');
  console.log('[ticket_plus_bot] content script ready:', window.location.href);
})();
