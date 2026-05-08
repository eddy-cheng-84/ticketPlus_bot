const statusEl = document.getElementById('status');
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
const areaListEl = document.getElementById('areaList');
const logBox = document.getElementById('logBox');

const STORAGE_KEY = 'area_preferences_v1';
const SCHEDULE_KEY = 'schedule_settings_v1';
let areaPreferences = [];
let scheduleSettings = {
  enabled: false,
  startTime: '11:00:01',
  stopTime: '11:01:00'
};
let lastScheduleTrigger = {
  start: '',
  stop: ''
};
const ALLOWED_HOST_SUFFIX = 'ticketplus.com.tw';

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

function getSelectedTargets() {
  return areaPreferences.filter((item) => item.selected).map((item) => item.name);
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

  logBox.textContent = logs.slice(-80).join('\n');
  logBox.scrollTop = logBox.scrollHeight;
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

async function loadAreaPreferences() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const saved = result?.[STORAGE_KEY];
  if (!Array.isArray(saved)) {
    areaPreferences = [];
    return;
  }

  areaPreferences = saved
    .map((item) => ({
      name: normalizeText(item?.name || ''),
      selected: Boolean(item?.selected)
    }))
    .filter((item) => Boolean(item.name));
}

async function saveAreaPreferences() {
  await chrome.storage.local.set({ [STORAGE_KEY]: areaPreferences });
}

async function loadScheduleSettings() {
  const result = await chrome.storage.local.get(SCHEDULE_KEY);
  const saved = result?.[SCHEDULE_KEY];
  if (!saved || typeof saved !== 'object') {
    scheduleSettings = { enabled: false, startTime: '11:00:01', stopTime: '11:01:00' };
    return;
  }
  scheduleSettings = {
    enabled: Boolean(saved.enabled),
    startTime:
      normalizeHmsTime(typeof saved.startTime === 'string' ? saved.startTime : '') || '11:00:01',
    stopTime:
      normalizeHmsTime(typeof saved.stopTime === 'string' ? saved.stopTime : '') || '11:01:00'
  };
}

async function saveScheduleSettings() {
  const normalizedStart = normalizeHmsTime(scheduleStartTimeEl?.value || '');
  const normalizedStop = normalizeHmsTime(scheduleStopTimeEl?.value || '');
  if (!normalizedStart || !normalizedStop) {
    render(false, 10000, '定時格式錯誤，請用 11:00:01');
    return;
  }

  scheduleSettings = {
    enabled: true,
    startTime: normalizedStart,
    stopTime: normalizedStop
  };
  scheduleStartTimeEl.value = scheduleSettings.startTime;
  scheduleStopTimeEl.value = scheduleSettings.stopTime;
  await chrome.storage.local.set({ [SCHEDULE_KEY]: scheduleSettings });
}

function hydrateScheduleSettingsUi() {
  scheduleStartTimeEl.value = scheduleSettings.startTime || '11:00:01';
  scheduleStopTimeEl.value = scheduleSettings.stopTime || '11:01:00';
}

async function disableScheduleSettings() {
  scheduleSettings = {
    ...scheduleSettings,
    enabled: false
  };
  await chrome.storage.local.set({ [SCHEDULE_KEY]: scheduleSettings });
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

function getCurrentSecondsOfDay() {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

async function runScheduledStart() {
  const result = await sendToActiveTab({
    type: 'START_BOT',
    selectedTargets: getSelectedTargets(),
    orderMode: areaOrderModeEl?.value || 'top_to_bottom',
    plusCount: getTicketCount(),
    refreshToAreaDelayMs: getRefreshToAreaDelayMs(),
    areaToPlusDelayMs: getAreaToPlusDelayMs()
  });
  if (!result || !result.ok) {
    return;
  }
  await refreshData();
}

async function runScheduledStop() {
  const result = await sendToActiveTab({ type: 'STOP_BOT' });
  if (!result || !result.ok) {
    return;
  }
  await refreshData();
}

async function checkScheduleTick() {
  if (!scheduleSettings.enabled) {
    return;
  }

  const dateNow = getCurrentDateYmd();
  const nowSec = getCurrentSecondsOfDay();
  const startSec = timeHmsToSeconds(scheduleSettings.startTime);
  const stopSec = timeHmsToSeconds(scheduleSettings.stopTime);

  if (startSec >= 0 && nowSec >= startSec && lastScheduleTrigger.start !== dateNow) {
    lastScheduleTrigger.start = dateNow;
    await runScheduledStart();
  }

  if (stopSec >= 0 && nowSec >= stopSec && lastScheduleTrigger.stop !== dateNow) {
    lastScheduleTrigger.stop = dateNow;
    await runScheduledStop();
  }
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
  name.textContent = item.name;

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
  const normalized = areas.map((name) => normalizeText(name)).filter(Boolean);
  const unique = [...new Set(normalized)];
  const oldMap = new Map(areaPreferences.map((item) => [item.name, item]));

  const next = [];
  for (const name of areaPreferences.map((item) => item.name)) {
    if (unique.includes(name)) {
      const old = oldMap.get(name);
      next.push({ name, selected: Boolean(old?.selected) });
    }
  }

  for (const name of unique) {
    if (!next.find((item) => item.name === name)) {
      next.push({ name, selected: false });
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
  await saveScheduleSettings();
  statusEl.textContent = `狀態: 排程已啟用（啟動 ${scheduleSettings.startTime} / 暫停 ${scheduleSettings.stopTime}）`;
  await refreshData();
});

stopScheduleBtn.addEventListener('click', async () => {
  await disableScheduleSettings();
  statusEl.textContent = '狀態: 排程已停止';
  await refreshData();
});

async function init() {
  await loadAreaPreferences();
  await loadScheduleSettings();
  renderAreaList();
  hydrateScheduleSettingsUi();
  await syncAutoTargets();
  await refreshData();
  await refreshAreas();
  window.setInterval(refreshData, 1000);
  window.setInterval(() => {
    checkScheduleTick();
  }, 1000);
}

init();
