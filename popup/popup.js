const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const reloadAreasBtn = document.getElementById('reloadAreasBtn');
const refreshOnceBtn = document.getElementById('refreshOnceBtn');
const vip2Btn = document.getElementById('vip2Btn');
const comboBtn = document.getElementById('comboBtn');
const plusBtn = document.getElementById('plusBtn');
const nextStepBtn = document.getElementById('nextStepBtn');
const runFlowBtn = document.getElementById('runFlowBtn');
const areaKeywordInput = document.getElementById('areaKeyword');
const ticketCountInput = document.getElementById('ticketCount');
const refreshToAreaDelaySecInput = document.getElementById('refreshToAreaDelaySec');
const areaToPlusDelaySecInput = document.getElementById('areaToPlusDelaySec');
const areaOrderModeEl = document.getElementById('areaOrderMode');
const areaListEl = document.getElementById('areaList');
const logBox = document.getElementById('logBox');

const STORAGE_KEY = 'area_preferences_v1';
let areaPreferences = [];

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function sendToActiveTab(message) {
  const tabId = await getActiveTabId();
  if (!tabId) {
    return { ok: false, error: 'NO_ACTIVE_TAB' };
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

  const sec = intervalMs ? Math.round(intervalMs / 1000) : 10;
  const selectedCount = getSelectedTargets().length;
  statusEl.textContent = running
    ? `狀態: 已啟動（${sec}秒/次，目標${selectedCount}）`
    : `狀態: 已暫停（${sec}秒/次，目標${selectedCount}）`;
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

function getAreaKeyword() {
  const raw = (areaKeywordInput?.value || '').trim();
  return raw;
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
    targets: getSelectedTargets()
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

refreshOnceBtn.addEventListener('click', async () => {
  const result = await sendToActiveTab({ type: 'CLICK_REFRESH_ONCE' });
  if (!result || !result.ok) {
    render(false, 10000, '點更新票數失敗');
    return;
  }

  await refreshData();
});

vip2Btn.addEventListener('click', async () => {
  const result = await sendToActiveTab({
    type: 'CLICK_PANEL_BY_TEXT',
    text: getAreaKeyword()
  });
  if (!result || !result.ok) {
    render(false, 10000, '點票區失敗');
    return;
  }

  await refreshData();
});

comboBtn.addEventListener('click', async () => {
  const result = await sendToActiveTab({
    type: 'CLICK_REFRESH_AND_PANEL_BY_TEXT',
    text: getAreaKeyword()
  });
  if (!result || !result.ok) {
    render(false, 10000, '一鍵操作失敗');
    return;
  }

  await refreshData();
});

plusBtn.addEventListener('click', async () => {
  const result = await sendToActiveTab({ type: 'CLICK_PLUS_ON_ACTIVE_PANEL' });
  if (!result || !result.ok) {
    render(false, 10000, '點 + 號失敗');
    return;
  }

  await refreshData();
});

nextStepBtn.addEventListener('click', async () => {
  const result = await sendToActiveTab({ type: 'CLICK_NEXT_STEP' });
  if (!result || !result.ok) {
    render(false, 10000, '點下一步失敗');
    return;
  }

  await refreshData();
});

runFlowBtn.addEventListener('click', async () => {
  const result = await sendToActiveTab({
    type: 'RUN_PURCHASE_FLOW',
    keyword: getAreaKeyword(),
    selectedTargets: getSelectedTargets(),
    orderMode: areaOrderModeEl?.value || 'top_to_bottom',
    plusCount: getTicketCount(),
    refreshToAreaDelayMs: getRefreshToAreaDelayMs(),
    areaToPlusDelayMs: getAreaToPlusDelayMs()
  });
  if (!result || !result.ok) {
    render(false, 10000, '一鍵流程失敗');
    await refreshData();
    return;
  }

  await refreshData();
});

async function init() {
  await loadAreaPreferences();
  renderAreaList();
  await syncAutoTargets();
  await refreshData();
  await refreshAreas();
  window.setInterval(refreshData, 1000);
}

init();
