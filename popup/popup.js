const statusEl = document.getElementById('status');
const scheduleStatusEl = document.getElementById('scheduleStatus');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const reloadAreasBtn = document.getElementById('reloadAreasBtn');
const saveScheduleBtn = document.getElementById('saveScheduleBtn');
const stopScheduleBtn = document.getElementById('stopScheduleBtn');
const ticketCountInput = document.getElementById('ticketCount');
const refreshToAreaDelaySecInput = document.getElementById('refreshToAreaDelaySec');
const areaToPlusDelaySecInput = document.getElementById('areaToPlusDelaySec');
const areaOrderModeEl = document.getElementById('areaOrderMode');
const scheduleStartTimeEl = document.getElementById('scheduleStartTime');
const scheduleStopTimeEl = document.getElementById('scheduleStopTime');
const externalTriggerEnabledEl = document.getElementById('externalTriggerEnabled');
const externalTriggerUrlEl = document.getElementById('externalTriggerUrl');
const externalTriggerMethodEl = document.getElementById('externalTriggerMethod');
const externalTriggerIntervalSecEl = document.getElementById('externalTriggerIntervalSec');
const saveExternalTriggerBtn = document.getElementById('saveExternalTriggerBtn');
const testExternalTriggerBtn = document.getElementById('testExternalTriggerBtn');
const externalTriggerStatusEl = document.getElementById('externalTriggerStatus');
const autoScrollLogEl = document.getElementById('autoScrollLog');
const areaListEl = document.getElementById('areaList');
const logBox = document.getElementById('logBox');

const STORAGE_KEY = 'area_preferences_v1';
const SCHEDULE_KEY = 'schedule_settings_v1';
const FLOW_SETTINGS_KEY = 'flow_settings_v1';
const EXTERNAL_TRIGGER_SETTINGS_KEY = 'external_trigger_settings_v1';
const ALLOWED_HOST_SUFFIX = 'ticketplus.com.tw';

let areaPreferences = [];
let scheduleSettings = { startTime: '11:00:01', stopTime: '11:01:00' };
let flowSettings = {
  ticketCount: 1,
  refreshDelaySec: 1.5,
  areaDelaySec: 0.3,
  orderMode: 'top_to_bottom'
};
let externalTriggerSettings = {
  enabled: false,
  url: 'http://127.0.0.1:16888/trigger',
  method: 'GET',
  intervalSec: 1
};

function isAllowedTicketplusUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname === ALLOWED_HOST_SUFFIX || parsed.hostname.endsWith(`.${ALLOWED_HOST_SUFFIX}`);
  } catch (_error) {
    return false;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  const tabId = tab?.id;
  if (!tabId) {
    return { ok: false, error: 'NO_ACTIVE_TAB' };
  }
  if (!isAllowedTicketplusUrl(tab.url || '')) {
    return { ok: false, error: 'DOMAIN_NOT_ALLOWED' };
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_error) {
    return { ok: false, error: 'CONTENT_SCRIPT_UNAVAILABLE' };
  }
}

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
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

function hmsToSeconds(hms) {
  const normalized = normalizeHmsTime(hms);
  if (!normalized) {
    return -1;
  }
  const [h, m, s] = normalized.split(':').map((x) => Number.parseInt(x, 10));
  return h * 3600 + m * 60 + s;
}

function getCurrentSecondsOfDay() {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

function buildAreaKey(rawText) {
  let key = normalizeText(rawText);
  key = key.replace(/剩餘\s*\d+/g, '');
  key = key.replace(/NT\.?\s*[\d,]+/g, '');
  key = key.replace(/熱賣中|已售完|完售|開賣時間|即將開賣|登記抽選/g, '');
  return normalizeText(key);
}

function getSelectedTargets() {
  return areaPreferences.filter((item) => item.selected).map((item) => item.key);
}

function getTicketCount() {
  const parsed = Number.parseInt(ticketCountInput?.value || '1', 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(4, Math.max(0, parsed));
}

function getAreaToPlusDelayMs() {
  const parsed = Number.parseFloat(areaToPlusDelaySecInput?.value || '0');
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.round(parsed * 1000);
}

function getRefreshToAreaDelayMs() {
  const parsed = Number.parseFloat(refreshToAreaDelaySecInput?.value || '0');
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.round(parsed * 1000);
}

async function loadFlowSettings() {
  const result = await chrome.storage.local.get(FLOW_SETTINGS_KEY);
  const saved = result?.[FLOW_SETTINGS_KEY];
  if (!saved || typeof saved !== 'object') {
    flowSettings = {
      ticketCount: 1,
      refreshDelaySec: 1.5,
      areaDelaySec: 0.3,
      orderMode: 'top_to_bottom'
    };
    return;
  }

  const ticketCount = Number.parseInt(String(saved.ticketCount ?? '1'), 10);
  const refreshDelaySec = Number.parseFloat(String(saved.refreshDelaySec ?? '1.5'));
  const areaDelaySec = Number.parseFloat(String(saved.areaDelaySec ?? '0.3'));
  const orderMode = typeof saved.orderMode === 'string' ? saved.orderMode : 'top_to_bottom';

  flowSettings = {
    ticketCount: Number.isFinite(ticketCount) ? Math.min(4, Math.max(0, ticketCount)) : 1,
    refreshDelaySec: Number.isFinite(refreshDelaySec) && refreshDelaySec >= 0 ? refreshDelaySec : 1.5,
    areaDelaySec: Number.isFinite(areaDelaySec) && areaDelaySec >= 0 ? areaDelaySec : 0.3,
    orderMode
  };
}

async function loadExternalTriggerSettings() {
  const result = await chrome.storage.local.get(EXTERNAL_TRIGGER_SETTINGS_KEY);
  const saved = result?.[EXTERNAL_TRIGGER_SETTINGS_KEY];
  if (!saved || typeof saved !== 'object') {
    externalTriggerSettings = {
      enabled: false,
      url: 'http://127.0.0.1:16888/trigger',
      method: 'GET',
      intervalSec: 1
    };
    return;
  }

  const method = typeof saved.method === 'string' ? saved.method.toUpperCase() : 'GET';
  const intervalSec = Number.parseFloat(String(saved.intervalSec ?? '1'));
  externalTriggerSettings = {
    enabled: Boolean(saved.enabled),
    url: typeof saved.url === 'string' && saved.url.trim() ? saved.url.trim() : 'http://127.0.0.1:16888/trigger',
    method: method === 'POST' ? 'POST' : 'GET',
    intervalSec: Number.isFinite(intervalSec) && intervalSec >= 0.5 ? intervalSec : 1
  };
}

async function saveFlowSettings() {
  const ticketCount = Number.parseInt(ticketCountInput?.value || '1', 10);
  const refreshDelaySec = Number.parseFloat(refreshToAreaDelaySecInput?.value || '1.5');
  const areaDelaySec = Number.parseFloat(areaToPlusDelaySecInput?.value || '0.3');

  flowSettings = {
    ticketCount: Number.isFinite(ticketCount) ? Math.min(4, Math.max(0, ticketCount)) : 1,
    refreshDelaySec: Number.isFinite(refreshDelaySec) && refreshDelaySec >= 0 ? refreshDelaySec : 1.5,
    areaDelaySec: Number.isFinite(areaDelaySec) && areaDelaySec >= 0 ? areaDelaySec : 0.3,
    orderMode: areaOrderModeEl?.value || 'top_to_bottom'
  };

  ticketCountInput.value = String(flowSettings.ticketCount);
  refreshToAreaDelaySecInput.value = String(flowSettings.refreshDelaySec);
  areaToPlusDelaySecInput.value = String(flowSettings.areaDelaySec);
  areaOrderModeEl.value = flowSettings.orderMode;

  await chrome.storage.local.set({ [FLOW_SETTINGS_KEY]: flowSettings });
}

function hydrateFlowSettingsUi() {
  ticketCountInput.value = String(flowSettings.ticketCount);
  refreshToAreaDelaySecInput.value = String(flowSettings.refreshDelaySec);
  areaToPlusDelaySecInput.value = String(flowSettings.areaDelaySec);
  areaOrderModeEl.value = flowSettings.orderMode;
}

function renderExternalTriggerStatus(message) {
  if (externalTriggerStatusEl) {
    externalTriggerStatusEl.textContent = message;
  }
}

function hydrateExternalTriggerSettingsUi() {
  externalTriggerEnabledEl.checked = externalTriggerSettings.enabled;
  externalTriggerUrlEl.value = externalTriggerSettings.url;
  externalTriggerMethodEl.value = externalTriggerSettings.method;
  externalTriggerIntervalSecEl.value = String(externalTriggerSettings.intervalSec);
  renderExternalTriggerStatus(
    externalTriggerSettings.enabled
      ? `外部觸發已啟用：${externalTriggerSettings.method} ${externalTriggerSettings.url}`
      : '外部觸發未啟用'
  );
}

async function saveExternalTriggerSettings() {
  const intervalSec = Number.parseFloat(externalTriggerIntervalSecEl?.value || '1');
  externalTriggerSettings = {
    enabled: Boolean(externalTriggerEnabledEl?.checked),
    url: (externalTriggerUrlEl?.value || '').trim() || 'http://127.0.0.1:16888/trigger',
    method: (externalTriggerMethodEl?.value || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
    intervalSec: Number.isFinite(intervalSec) && intervalSec >= 0.5 ? intervalSec : 1
  };

  externalTriggerUrlEl.value = externalTriggerSettings.url;
  externalTriggerMethodEl.value = externalTriggerSettings.method;
  externalTriggerIntervalSecEl.value = String(externalTriggerSettings.intervalSec);
  await chrome.storage.local.set({ [EXTERNAL_TRIGGER_SETTINGS_KEY]: externalTriggerSettings });
  renderExternalTriggerStatus(
    externalTriggerSettings.enabled
      ? `外部觸發已儲存：${externalTriggerSettings.method} ${externalTriggerSettings.url}`
      : '外部觸發已停用'
  );
}

async function armExternalTriggerTest() {
  const baseUrl = (externalTriggerUrlEl?.value || '').trim() || 'http://127.0.0.1:16888/trigger';
  const method = (externalTriggerMethodEl?.value || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';

  if (method === 'GET') {
    const url = new URL(baseUrl);
    url.searchParams.set('fire', '1');
    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new Error(`ARM_HTTP_${response.status}`);
    }
    return;
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      trigger: true,
      id: `panel-test-${Date.now()}`
    })
  });
  if (!response.ok) {
    throw new Error(`ARM_HTTP_${response.status}`);
  }
}

function render(running, intervalMs, errorText = '') {
  if (errorText) {
    statusEl.textContent = `狀態: ${errorText}`;
    startBtn.disabled = true;
    stopBtn.disabled = true;
    return;
  }

  const selectedCount = getSelectedTargets().length;
  statusEl.textContent = running
    ? `狀態: 已啟動（流程循環中，目標${selectedCount}）`
    : `狀態: 已暫停（流程未啟動，目標${selectedCount}）`;
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

function renderLogs(logs) {
  if (!Array.isArray(logs) || logs.length === 0) {
    logBox.textContent = '尚無資料';
    return;
  }

  logBox.textContent = logs.slice(-400).join('\n');
  if (!autoScrollLogEl || autoScrollLogEl.checked) {
    logBox.scrollTop = logBox.scrollHeight;
  }
}

async function loadAreaPreferences() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const saved = result?.[STORAGE_KEY];
  if (!Array.isArray(saved)) {
    areaPreferences = [];
    return;
  }

  areaPreferences = saved
    .map((item) => {
      if (item && typeof item === 'object' && typeof item.key === 'string') {
        const key = buildAreaKey(item.key);
        const label = normalizeText(item.label || item.key);
        return { key, label: label || key, selected: Boolean(item.selected) };
      }
      const oldName = normalizeText(item?.name || '');
      const key = buildAreaKey(oldName);
      if (!key) {
        return null;
      }
      return { key, label: oldName || key, selected: Boolean(item?.selected) };
    })
    .filter((item) => Boolean(item && item.key));
}

async function saveAreaPreferences() {
  await chrome.storage.local.set({ [STORAGE_KEY]: areaPreferences });
}

async function loadScheduleSettings() {
  const result = await chrome.storage.local.get(SCHEDULE_KEY);
  const saved = result?.[SCHEDULE_KEY];
  if (!saved || typeof saved !== 'object') {
    scheduleSettings = { startTime: '11:00:01', stopTime: '11:01:00' };
    return;
  }
  scheduleSettings = {
    startTime: normalizeHmsTime(typeof saved.startTime === 'string' ? saved.startTime : '') || '11:00:01',
    stopTime: normalizeHmsTime(typeof saved.stopTime === 'string' ? saved.stopTime : '') || '11:01:00'
  };
}

async function saveScheduleSettings() {
  const normalizedStart = normalizeHmsTime(scheduleStartTimeEl?.value || '');
  const normalizedStop = normalizeHmsTime(scheduleStopTimeEl?.value || '');
  if (!normalizedStart || !normalizedStop) {
    render(false, 10000, '定時格式錯誤，請用 11:00:01');
    return false;
  }

  scheduleSettings = { startTime: normalizedStart, stopTime: normalizedStop };
  scheduleStartTimeEl.value = scheduleSettings.startTime;
  scheduleStopTimeEl.value = scheduleSettings.stopTime;
  await chrome.storage.local.set({ [SCHEDULE_KEY]: scheduleSettings });
  return true;
}

function hydrateScheduleSettingsUi() {
  scheduleStartTimeEl.value = scheduleSettings.startTime || '11:00:01';
  scheduleStopTimeEl.value = scheduleSettings.stopTime || '11:01:00';
}

async function syncAutoTargets() {
  const targets = getSelectedTargets();
  await sendToActiveTab({ type: 'SET_AUTO_TARGETS', targets });
}

function moveArea(index, offset) {
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= areaPreferences.length) {
    return;
  }
  const swapped = [...areaPreferences];
  const current = swapped[index];
  swapped[index] = swapped[nextIndex];
  swapped[nextIndex] = current;
  areaPreferences = swapped;
}

function createAreaItemElement(item, index) {
  const row = document.createElement('div');
  row.className = 'area-item';

  const left = document.createElement('label');
  left.className = 'area-left';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = item.selected;
  checkbox.addEventListener('change', async () => {
    areaPreferences[index].selected = checkbox.checked;
    await saveAreaPreferences();
    await syncAutoTargets();
    await refreshData();
  });

  const name = document.createElement('span');
  name.className = 'area-name';
  name.textContent = item.label;

  left.appendChild(checkbox);
  left.appendChild(name);

  const orderWrap = document.createElement('div');
  orderWrap.className = 'area-order';

  const upBtn = document.createElement('button');
  upBtn.className = 'order-btn';
  upBtn.textContent = '上移';
  upBtn.disabled = index === 0;
  upBtn.addEventListener('click', async () => {
    moveArea(index, -1);
    await saveAreaPreferences();
    await syncAutoTargets();
    renderAreaList();
    await refreshData();
  });

  const downBtn = document.createElement('button');
  downBtn.className = 'order-btn';
  downBtn.textContent = '下移';
  downBtn.disabled = index === areaPreferences.length - 1;
  downBtn.addEventListener('click', async () => {
    moveArea(index, 1);
    await saveAreaPreferences();
    await syncAutoTargets();
    renderAreaList();
    await refreshData();
  });

  orderWrap.appendChild(upBtn);
  orderWrap.appendChild(downBtn);

  row.appendChild(left);
  row.appendChild(orderWrap);
  return row;
}

function renderAreaList() {
  areaListEl.innerHTML = '';
  if (!Array.isArray(areaPreferences) || areaPreferences.length === 0) {
    areaListEl.textContent = '尚未讀取票區';
    return;
  }
  for (let i = 0; i < areaPreferences.length; i += 1) {
    areaListEl.appendChild(createAreaItemElement(areaPreferences[i], i));
  }
}

function mergeAreaPreferences(areas) {
  const normalized = areas
    .map((area) => {
      if (area && typeof area === 'object') {
        const key = buildAreaKey(area.key || area.label || '');
        const label = normalizeText(area.label || area.key || '');
        if (!key) {
          return null;
        }
        return { key, label: label || key };
      }
      const label = normalizeText(String(area || ''));
      const key = buildAreaKey(label);
      if (!key) {
        return null;
      }
      return { key, label: label || key };
    })
    .filter(Boolean);
  const unique = [];
  const seen = new Set();
  for (const item of normalized) {
    if (seen.has(item.key)) {
      continue;
    }
    seen.add(item.key);
    unique.push(item);
  }
  const oldMap = new Map(areaPreferences.map((item) => [item.key, item]));

  const next = [];
  for (const key of areaPreferences.map((item) => item.key)) {
    const incoming = unique.find((item) => item.key === key);
    if (incoming) {
      const old = oldMap.get(key);
      next.push({
        key,
        label: incoming.label || key,
        selected: Boolean(old?.selected)
      });
    }
  }

  for (const item of unique) {
    if (!next.find((entry) => entry.key === item.key)) {
      next.push({ key: item.key, label: item.label || item.key, selected: false });
    }
  }

  areaPreferences = next;
}

async function refreshAreas() {
  await sendToActiveTab({ type: 'CLICK_REFRESH_ONCE' });
  const result = await sendToActiveTab({ type: 'GET_PANEL_AREAS' });
  if (!result || !result.ok || !Array.isArray(result.areas)) {
    areaListEl.textContent = '讀取票區失敗（請先在目標頁重新整理）';
    return;
  }

  mergeAreaPreferences(result.areas);
  await saveAreaPreferences();
  await syncAutoTargets();
  renderAreaList();
  await refreshData();
}

async function refreshData() {
  const statusResult = await sendToActiveTab({ type: 'GET_BOT_STATUS' });
  if (!statusResult || !statusResult.ok) {
    if (statusResult?.error === 'DOMAIN_NOT_ALLOWED') {
      render(false, 10000, '僅支援 ticketplus.com.tw');
      return;
    }
    render(false, 10000, '此頁無法控制（請先重新整理目標頁）');
    return;
  }

  render(Boolean(statusResult.running), statusResult.intervalMs);
  if (scheduleStatusEl) {
    scheduleStatusEl.textContent = statusResult.scheduleEnabled
      ? `排程: 啟用中（啟動 ${statusResult.scheduleStartTime} / 暫停 ${statusResult.scheduleStopTime}）`
      : '排程: 未啟用';
  }

  const logResult = await sendToActiveTab({ type: 'GET_BOT_LOGS' });
  if (logResult && logResult.ok) {
    renderLogs(logResult.logs);
  }
}

startBtn.addEventListener('click', async () => {
  const result = await sendToActiveTab({
    type: 'START_BOT',
    selectedTargets: getSelectedTargets(),
    orderMode: areaOrderModeEl?.value || 'top_to_bottom',
    plusCount: getTicketCount(),
    refreshToAreaDelayMs: getRefreshToAreaDelayMs(),
    areaToPlusDelayMs: getAreaToPlusDelayMs()
  });
  if (!result || !result.ok) {
    render(false, 10000, '啟動失敗');
    return;
  }
  await refreshData();
});

stopBtn.addEventListener('click', async () => {
  const result = await sendToActiveTab({ type: 'STOP_BOT' });
  if (!result || !result.ok) {
    render(false, 10000, '暫停失敗');
    return;
  }
  await refreshData();
});

reloadAreasBtn.addEventListener('click', async () => {
  await refreshAreas();
});

saveScheduleBtn.addEventListener('click', async () => {
  const ok = await saveScheduleSettings();
  if (!ok) {
    return;
  }
  const result = await sendToActiveTab({
    type: 'SET_SCHEDULE',
    startTime: scheduleSettings.startTime,
    stopTime: scheduleSettings.stopTime,
    selectedTargets: getSelectedTargets(),
    orderMode: areaOrderModeEl?.value || 'top_to_bottom',
    plusCount: getTicketCount(),
    refreshToAreaDelayMs: getRefreshToAreaDelayMs(),
    areaToPlusDelayMs: getAreaToPlusDelayMs()
  });
  if (!result || !result.ok) {
    if (scheduleStatusEl) {
      scheduleStatusEl.textContent = '排程: 啟用失敗';
    }
    return;
  }
  if (scheduleStatusEl) {
    const startSec = hmsToSeconds(scheduleSettings.startTime);
    const nowSec = getCurrentSecondsOfDay();
    if (startSec >= 0 && nowSec > startSec) {
      scheduleStatusEl.textContent = `排程: 已啟用（今日啟動時間已過，明天 ${scheduleSettings.startTime} 觸發）`;
    } else {
      scheduleStatusEl.textContent = `排程: 啟用中（啟動 ${scheduleSettings.startTime} / 暫停 ${scheduleSettings.stopTime}）`;
    }
  }
  await refreshData();
});

stopScheduleBtn.addEventListener('click', async () => {
  const result = await sendToActiveTab({ type: 'STOP_SCHEDULE' });
  if (!result || !result.ok) {
    if (scheduleStatusEl) {
      scheduleStatusEl.textContent = '排程: 停止失敗';
    }
    return;
  }
  if (scheduleStatusEl) {
    scheduleStatusEl.textContent = '排程: 已停止';
  }
  await refreshData();
});

ticketCountInput.addEventListener('change', async () => {
  await saveFlowSettings();
});

refreshToAreaDelaySecInput.addEventListener('change', async () => {
  await saveFlowSettings();
});

areaToPlusDelaySecInput.addEventListener('change', async () => {
  await saveFlowSettings();
});

areaOrderModeEl.addEventListener('change', async () => {
  await saveFlowSettings();
});

saveExternalTriggerBtn.addEventListener('click', async () => {
  await saveExternalTriggerSettings();
});

testExternalTriggerBtn.addEventListener('click', async () => {
  renderExternalTriggerStatus('外部觸發測試中...');
  try {
    await armExternalTriggerTest();
  } catch (error) {
    renderExternalTriggerStatus(`測試失敗: ${error?.message || 'ARM_FAILED'}`);
    return;
  }
  const result = await chrome.runtime.sendMessage({ type: 'CHECK_EXTERNAL_TRIGGER_NOW' });
  if (!result || !result.ok) {
    renderExternalTriggerStatus(`測試失敗: ${result?.error || 'UNKNOWN_ERROR'}`);
    return;
  }
  if (!result.enabled) {
    renderExternalTriggerStatus('測試完成：目前未啟用外部觸發');
    return;
  }
  if (result.triggered && result.started) {
    renderExternalTriggerStatus('測試完成：已收到觸發並啟動流程');
    return;
  }
  if (result.triggered) {
    renderExternalTriggerStatus(`測試完成：有觸發，但未重新啟動（${result.reason || '已在執行中'}）`);
    return;
  }
  renderExternalTriggerStatus('測試完成：目前沒有收到外部觸發');
});

async function init() {
  await loadAreaPreferences();
  await loadScheduleSettings();
  await loadFlowSettings();
  await loadExternalTriggerSettings();
  renderAreaList();
  hydrateScheduleSettingsUi();
  hydrateFlowSettingsUi();
  hydrateExternalTriggerSettingsUi();
  await syncAutoTargets();
  await refreshData();
  await refreshAreas();
  window.setInterval(refreshData, 1000);
}

init();
