const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const refreshOnceBtn = document.getElementById('refreshOnceBtn');
const vip2Btn = document.getElementById('vip2Btn');
const comboBtn = document.getElementById('comboBtn');
const areaKeywordInput = document.getElementById('areaKeyword');
const logBox = document.getElementById('logBox');

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

function render(running, intervalMs, errorText = '') {
  if (errorText) {
    statusEl.textContent = `狀態: ${errorText}`;
    startBtn.disabled = true;
    stopBtn.disabled = true;
    return;
  }

  const sec = intervalMs ? Math.round(intervalMs / 1000) : 10;
  statusEl.textContent = running ? `狀態: 已啟動（${sec}秒/次）` : `狀態: 已暫停（${sec}秒/次）`;
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
  return raw || '2F VIP2（座席）';
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
  const result = await sendToActiveTab({ type: 'START_BOT' });
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

refreshData();
window.setInterval(refreshData, 1000);
