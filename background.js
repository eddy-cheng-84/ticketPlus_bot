const AREA_PREFERENCES_KEY = 'area_preferences_v1';
const FLOW_SETTINGS_KEY = 'flow_settings_v1';
const EXTERNAL_TRIGGER_SETTINGS_KEY = 'external_trigger_settings_v1';

const DEFAULT_EXTERNAL_TRIGGER_SETTINGS = {
  enabled: false,
  url: 'http://127.0.0.1:16888/trigger',
  method: 'GET',
  intervalSec: 1
};
const EXTERNAL_TRIGGER_FETCH_TIMEOUT_MS = 3000;

let pollInFlight = null;
let lastPollAt = 0;
let lastHandledTriggerId = '';
let lastHandledTriggerAt = 0;

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function buildAreaKey(rawText) {
  let key = normalizeText(rawText);
  key = key.replace(/剩餘\s*\d+/g, '');
  key = key.replace(/NT\.?\s*[\d,]+/g, '');
  key = key.replace(/熱賣中|已售完|完售|開賣時間|即將開賣|登記抽選/g, '');
  return normalizeText(key);
}

function sanitizeExternalTriggerSettings(saved) {
  const method = typeof saved?.method === 'string' ? saved.method.toUpperCase() : 'GET';
  const intervalSec = Number.parseFloat(String(saved?.intervalSec ?? DEFAULT_EXTERNAL_TRIGGER_SETTINGS.intervalSec));
  return {
    enabled: Boolean(saved?.enabled),
    url: typeof saved?.url === 'string' && saved.url.trim() ? saved.url.trim() : DEFAULT_EXTERNAL_TRIGGER_SETTINGS.url,
    method: method === 'POST' ? 'POST' : 'GET',
    intervalSec: Number.isFinite(intervalSec) && intervalSec >= 0.5 ? intervalSec : DEFAULT_EXTERNAL_TRIGGER_SETTINGS.intervalSec
  };
}

async function getExternalTriggerSettings() {
  const result = await chrome.storage.local.get(EXTERNAL_TRIGGER_SETTINGS_KEY);
  return sanitizeExternalTriggerSettings(result?.[EXTERNAL_TRIGGER_SETTINGS_KEY]);
}

async function getSelectedTargets() {
  const result = await chrome.storage.local.get(AREA_PREFERENCES_KEY);
  const saved = result?.[AREA_PREFERENCES_KEY];
  if (!Array.isArray(saved)) {
    return [];
  }

  return saved
    .filter((item) => item && item.selected)
    .map((item) => buildAreaKey(item.key || item.label || item.name || ''))
    .filter(Boolean);
}

async function getFlowSettings() {
  const result = await chrome.storage.local.get(FLOW_SETTINGS_KEY);
  const saved = result?.[FLOW_SETTINGS_KEY];
  const ticketCount = Number.parseInt(String(saved?.ticketCount ?? '1'), 10);
  const refreshDelaySec = Number.parseFloat(String(saved?.refreshDelaySec ?? '1.5'));
  const areaDelaySec = Number.parseFloat(String(saved?.areaDelaySec ?? '0.3'));
  return {
    plusCount: Number.isFinite(ticketCount) ? Math.min(4, Math.max(0, ticketCount)) : 1,
    // 外部 trigger 沒有提供 options.exclusiveCode 時，就沿用 popup 儲存的專屬碼。
    exclusiveCode: typeof saved?.exclusiveCode === 'string' ? saved.exclusiveCode.trim() : '',
    refreshToAreaDelayMs:
      Number.isFinite(refreshDelaySec) && refreshDelaySec >= 0 ? Math.round(refreshDelaySec * 1000) : 1500,
    areaToPlusDelayMs:
      Number.isFinite(areaDelaySec) && areaDelaySec >= 0 ? Math.round(areaDelaySec * 1000) : 300,
    orderMode: typeof saved?.orderMode === 'string' && saved.orderMode ? saved.orderMode : 'top_to_bottom'
  };
}

function parseTriggerResponse(payload) {
  if (payload === true) {
    return { shouldStart: true, triggerId: '' };
  }

  if (typeof payload === 'string') {
    const normalized = normalizeText(payload).toLowerCase();
    return {
      shouldStart: normalized === 'true' || normalized === 'start' || normalized === 'trigger',
      triggerId: ''
    };
  }

  if (!payload || typeof payload !== 'object') {
    return { shouldStart: false, triggerId: '' };
  }

  return {
    shouldStart: payload.trigger === true || payload.start === true || normalizeText(payload.command).toLowerCase() === 'start',
    triggerId: typeof payload.id === 'string' ? normalizeText(payload.id) : '',
    overrides: payload.options && typeof payload.options === 'object' ? payload.options : {}
  };
}

async function fetchTriggerPayload(settings) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, EXTERNAL_TRIGGER_FETCH_TIMEOUT_MS);

  const init = {
    method: settings.method,
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8'
    },
    cache: 'no-store',
    signal: controller.signal
  };

  if (settings.method === 'POST') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify({
      source: 'ticket_plus_bot',
      event: 'poll_trigger',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const response = await fetch(settings.url, init);
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    return response.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('FETCH_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function findTicketplusTabs() {
  const tabs = await chrome.tabs.query({
    url: ['https://ticketplus.com.tw/*', 'https://*.ticketplus.com.tw/*']
  });
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return [];
  }

  return tabs;
}

async function getTabStatus(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'GET_BOT_STATUS' });
  } catch (_error) {
    return null;
  }
}

async function startBotFromExternalTrigger(overrides = {}) {
  const tabs = await findTicketplusTabs();
  if (tabs.length === 0) {
    return { ok: false, error: 'NO_TICKETPLUS_TAB' };
  }

  const selectedTargets = Array.isArray(overrides.selectedTargets)
    ? overrides.selectedTargets.map((item) => buildAreaKey(item)).filter(Boolean)
    : await getSelectedTargets();
  const flowSettings = await getFlowSettings();

  const startMessage = {
    type: 'START_BOT',
    source: 'external_http_trigger',
    selectedTargets,
    orderMode: typeof overrides.orderMode === 'string' && overrides.orderMode ? overrides.orderMode : flowSettings.orderMode,
    plusCount: Number.isFinite(Number(overrides.plusCount)) ? Number(overrides.plusCount) : flowSettings.plusCount,
    // 監控程式 POST /trigger 時可用 options.exclusiveCode 覆蓋 GUI 值，方便不同活動使用不同碼。
    exclusiveCode: typeof overrides.exclusiveCode === 'string' ? overrides.exclusiveCode.trim() : flowSettings.exclusiveCode,
    refreshToAreaDelayMs: Number.isFinite(Number(overrides.refreshToAreaDelayMs))
      ? Number(overrides.refreshToAreaDelayMs)
      : flowSettings.refreshToAreaDelayMs,
    areaToPlusDelayMs: Number.isFinite(Number(overrides.areaToPlusDelayMs))
      ? Number(overrides.areaToPlusDelayMs)
      : flowSettings.areaToPlusDelayMs
  };

  let startedCount = 0;
  let alreadyRunningCount = 0;
  let unavailableCount = 0;
  const startedTabIds = [];

  for (const tab of tabs) {
    if (!tab?.id) {
      continue;
    }

    const currentStatus = await getTabStatus(tab.id);
    if (!currentStatus?.ok) {
      unavailableCount += 1;
      continue;
    }

    if (currentStatus.running) {
      alreadyRunningCount += 1;
      continue;
    }

    const result = await chrome.tabs.sendMessage(tab.id, startMessage);
    if (result?.ok) {
      startedCount += 1;
      startedTabIds.push(tab.id);
      continue;
    }

    unavailableCount += 1;
  }

  if (startedCount === 0 && alreadyRunningCount === 0) {
    return { ok: false, error: 'CONTENT_SCRIPT_UNAVAILABLE' };
  }

  return {
    ok: true,
    started: startedCount > 0,
    startedCount,
    alreadyRunningCount,
    unavailableCount,
    tabIds: startedTabIds,
    reason: startedCount > 0 ? '' : 'ALREADY_RUNNING'
  };
}

async function runExternalTriggerCheck(options = {}) {
  const settings = await getExternalTriggerSettings();
  if (!settings.enabled && !options.force) {
    return { ok: true, enabled: false, triggered: false };
  }

  const now = Date.now();
  const intervalMs = Math.max(500, Math.round(settings.intervalSec * 1000));
  if (!options.force && now - lastPollAt < intervalMs) {
    return { ok: true, enabled: settings.enabled, triggered: false, skipped: true };
  }

  lastPollAt = now;

  const payload = await fetchTriggerPayload(settings);
  const parsed = parseTriggerResponse(payload);
  if (!parsed.shouldStart) {
    return { ok: true, enabled: settings.enabled, triggered: false };
  }

  if (parsed.triggerId && parsed.triggerId === lastHandledTriggerId) {
    return { ok: true, enabled: settings.enabled, triggered: false, duplicate: true };
  }

  if (!parsed.triggerId && now - lastHandledTriggerAt < 5000) {
    return { ok: true, enabled: settings.enabled, triggered: false, duplicate: true };
  }

  const startResult = await startBotFromExternalTrigger(parsed.overrides);
  if (!startResult.ok) {
    return { ok: false, enabled: settings.enabled, triggered: true, error: startResult.error };
  }

  if (parsed.triggerId) {
    lastHandledTriggerId = parsed.triggerId;
  }
  lastHandledTriggerAt = now;

  return {
    ok: true,
    enabled: settings.enabled,
    triggered: true,
    started: Boolean(startResult.started),
    reason: startResult.reason || ''
  };
}

async function performSerializedExternalTriggerCheck(options = {}) {
  if (options.force) {
    return runExternalTriggerCheck(options);
  }

  if (!pollInFlight) {
    pollInFlight = runExternalTriggerCheck(options).finally(() => {
      pollInFlight = null;
    });
  }
  return pollInFlight;
}

async function enablePanelOnActionClick() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error('Failed to enable side panel action click behavior.', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enablePanelOnActionClick();
});

chrome.runtime.onStartup.addListener(() => {
  enablePanelOnActionClick();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'POLL_EXTERNAL_TRIGGER') {
    performSerializedExternalTriggerCheck().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error?.message || 'POLL_FAILED' });
    });
    return true;
  }

  if (message.type === 'CHECK_EXTERNAL_TRIGGER_NOW') {
    performSerializedExternalTriggerCheck({ force: true }).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error?.message || 'POLL_FAILED' });
    });
    return true;
  }
});
