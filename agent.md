# Ticket Plus Bot Agent Guide

這份文件是接手本專案時的工作指南，內容以目前程式碼與資料夾結構為準。它取代舊的 `AGENT_NOTES.md`，不再只記錄單次對話，而是整理可持續使用的架構、流程、測試與維護規則。

## 專案範圍

本專案包含三個互相串接的部分：

1. Chrome / Edge Manifest V3 Ticket Plus 擴充功能。
2. 本機一次性 HTTP trigger server：`trigger_server.py`。
3. `sold_out_monitor/` 裡的 Ticket Plus 活動頁售完監控器，提供 Python CLI、Tk GUI 與 Windows 啟動腳本。

主要支援網域：

- `https://ticketplus.com.tw/*`
- `https://*.ticketplus.com.tw/*`

擴充功能的頁面流程是活動入口、搶票頁、選擇票區／票數，進入 `/confirmSeat/...` 後停止自動操作。它不應被理解為付款或訂單完成流程的自動化工具。

## Git 與工作規則

- 主要開發分支：`dev`。
- 目前遠端：`origin`，對應 GitHub 的 `dev` 分支。
- 推送目前分支：`git push -u origin dev`。
- 修改後至少執行 JavaScript 語法檢查與 `git diff --check`。
- 保留未追蹤的 `badblocks-sda.log`，不要把它加入 commit。
- 不要提交 runtime 檔案：`monitor_config.json`、`logs/`、`build/`、`.ticketplus-monitor-state.json`、PyInstaller 產生的 `*.spec`，除非使用者明確要求。

## 擴充功能架構

### `manifest.json`

Manifest V3 設定包含：

- Side Panel：`popup/popup.html`。
- Service worker：`background.js`。
- Ticket Plus content script：`content.js`，在 `document_idle` 載入。
- `storage`、`activeTab`、`scripting`、`sidePanel` 權限。
- Ticket Plus 與 `127.0.0.1`／`localhost` 的 host permissions。

### `popup/`

- `popup.html`：Side Panel 的按鈕、票區清單、流程設定、排程、外部 trigger 與 Log 篩選器。
- `popup.js`：讀寫設定、掃描與排序票區、向目前分頁送訊息、測試外部 trigger、渲染 Log。
- `popup.css`：Side Panel 樣式。

重要的 `chrome.storage.local` key：

- `area_preferences_v1`：票區名稱、勾選狀態與優先順序。
- `flow_settings_v1`：張數、專屬碼、延遲與票區選擇順序。
- `schedule_settings_v1`：每日自動啟動／暫停時間。
- `external_trigger_settings_v1`：trigger URL、方法與輪詢間隔。

### `content.js`

Content script 以目前 URL 判斷頁面模式：

- `/activity/...`：尋找精確文字為「立即購買」或「尚未開賣」的按鈕。
- `/order/...`：點擊「我知道了」、更新票數、掃描票區、點擊票區與 `+`。
- `/confirmSeat/...`：視為結帳頁，立即停止流程。

主要流程常數：

- 每輪基本間隔：10 秒。
- `+` 多張票之間：50ms。
- 點完 `+` 到下一步：100ms。
- 排隊頁輪詢：1 秒。
- 票區展開與整頁掃描使用短延遲，避免 DOM 尚未完成就讀取。

票區處理會：

1. 讀取 `button.v-expansion-panel-header`。
2. 清除 `剩餘 N`、價格、`熱賣中`、`已售完` 等動態文字建立穩定 key。
3. 優先使用 GUI 勾選的票區；沒有勾選時才使用所有候選票區。
4. 跳過明確 `剩餘 0`，保留 `熱賣中` 這類沒有明確數字但可嘗試的狀態。
5. 依 `top_to_bottom`、`bottom_to_top`、`middle` 或 `random` 選擇。

專屬碼欄位是 Ticket Plus 動態產生的，不依賴會改變的 id；目前依序嘗試 `.exclusive-code`、Vuetify input、textarea，以及 placeholder／外層文字關鍵字。填入後會派送 `input` 與 `change` 事件。

### `background.js`

Service worker 負責外部 HTTP trigger：

- 輪詢預設 `http://127.0.0.1:16888/trigger`。
- 支援 GET／POST。
- 將字串、布林值與 JSON payload 正規化成 trigger。
- 以 trigger id 或 5 秒時間窗去重。
- 找出所有 Ticket Plus 分頁，跳過已在執行的分頁。
- 將 `START_BOT` 與票區、順序、張數、專屬碼、延遲覆寫值送給 content script。

不要把外部 HTTP 輪詢與 Ticket Plus DOM 操作混在同一個檔案；前者放在 background，後者放在 content。

## Trigger server 資料流

`trigger_server.py` 是簡單的本機一次性佇列，不是長期工作排程器：

1. 執行 `python trigger_server.py`。
2. GET `/trigger?fire=1` 或 POST `{"trigger": true}` 將一筆 trigger 放入記憶體。
3. 擴充功能依設定輪詢 `/trigger`。
4. server 回傳 pending payload 後立即清除它。
5. background script 解析 payload 並啟動符合條件的 Ticket Plus 分頁。

POST 可帶 `id` 與 `options`，例如 `selectedTargets`、`orderMode`、`plusCount`、`exclusiveCode`、`refreshToAreaDelayMs`、`areaToPlusDelayMs`。沒有提供 `options.exclusiveCode` 時，沿用 Side Panel 儲存值。

## Sold Out Monitor

`sold_out_monitor/monitor.py` 使用 Playwright 等待 Ticket Plus 前端渲染，再讀取 `document.body.innerText`；不要改成只用 requests 讀 raw HTML，因為場次資訊需要前端渲染。

監控流程：

1. 開啟活動頁並等待「立即購買」文字。
2. 解析場次、日期、時間與售票狀態。
3. 與 state file 比較，只對「從售完變成可通知」的場次發出訊號。
4. 依 `alert_repeat_count` 與 `alert_repeat_interval_ms` 發送 Webhook。
5. 若啟用 `extension_trigger_enabled`，再通知 `trigger_server.py`。

預設使用 Microsoft Edge，設定檔為 `sold_out_monitor/monitor_config.json`；若檔案不存在，入口腳本會以 `monitor_config.example.json` 為基礎建立。

常用入口：

```powershell
cd C:\Users\Lu_white\Documents\chrome_extension\ticket_plus_bot\sold_out_monitor
start-monitor-gui.bat
start-monitor.bat
dist\sold_out_monitor.exe --config monitor_config.json --once
dist\sold_out_monitor.exe --config monitor_config.json --test-notify
```

GUI 主要在 `monitor_gui.py`；CLI 與解析、通知、state 管理由 `monitor.py` 負責。`legacy_node/` 是舊版 Node.js 監控器備份，除非使用者明確指定，不要優先修改它。

## 開發檢查

擴充功能：

```powershell
node --check content.js
node --check background.js
node --check popup/popup.js
git diff --check
```

監控器：

```powershell
python -m unittest discover -s sold_out_monitor/tests
python -m py_compile sold_out_monitor/monitor.py sold_out_monitor/monitor_gui.py
```

若要驗證真實頁面解析，使用活動頁做一次檢查：

```powershell
cd sold_out_monitor
dist\sold_out_monitor.exe --config monitor_config.json --once
```

## 排錯重點

- 擴充功能無反應：重新載入擴充功能，再重新整理 Ticket Plus 分頁，確認 content script 重新載入。
- 外部 trigger 無反應：確認 `trigger_server.py` 正在執行、URL／方法相同，並檢查是否回傳 `armed: true` 或 `NO_TICKETPLUS_TAB`。
- 票區掃描不完整：開啟 Side Panel 的「掃描細節」，確認整頁捲動後的票區與合併結果。
- 專屬碼沒有填入：檢查當頁是否真的存在動態專屬碼欄位；空白專屬碼是合法的停用狀態。
- 監控抓不到場次：先用 `--once`，確認活動頁有前端渲染完成的「立即購買」區塊。
- 通知重複：檢查 `.ticketplus-monitor-state.json` 是否可寫，以及是否意外刪除或改變 state key。

## 目前已知限制

- Ticket Plus 改變 DOM class、按鈕文字或活動頁結構時，selector／解析器可能需要更新。
- trigger server 的 pending payload 存在記憶體，server 重啟後會遺失。
- monitor 的「非銷售一空」判斷是廣義可通知訊號，不等於一定有可購票數量。
- `confirmSeat` 只代表停止擴充功能自動流程，不代表已完成付款。

