# Ticket Plus Bot

Ticket Plus Bot 是一個 Chrome / Edge Chromium Manifest V3 擴充功能，透過右側 Side Panel 控制 Ticket Plus 頁面上的活動入口、票區選擇、數量加票與下一步。

目前支援的網站範圍：

- `https://ticketplus.com.tw/activity/...`
- `https://ticketplus.com.tw/order/...`
- `https://ticketplus.com.tw/confirmSeat/...`

擴充功能只會在 Ticket Plus 網域執行，不會控制其他網站。

## 安裝

1. 開啟 Chrome 或 Edge。
2. Chrome 開啟 `chrome://extensions/`；Edge 開啟 `edge://extensions/`。
3. 開啟「開發人員模式」。
4. 選擇「載入未封裝項目」/「Load unpacked」。
5. 選取本專案資料夾：
   `C:\Users\Lu_white\Documents\chrome_extension\ticket_plus_bot`
6. 開啟 Ticket Plus 活動頁或搶票頁，點擊工具列的 Ticket Plus Bot 圖示開啟右側面板。

修改程式後，請回到擴充功能管理頁按「重新載入」，再重新整理 Ticket Plus 分頁。

## GUI 設定

### 票區

- `讀取票區清單`：點擊 Ticket Plus 的更新票數後，掃描整頁所有票區。
- `全選` / `取消全選`：控制要納入自動選擇的票區。
- 每個票區可單獨勾選，並可用上移/下移調整優先順序。
- 如果有勾選票區，流程只會從勾選清單中選擇；沒有勾選時才會使用頁面上所有可用票區。

### 搶票流程

- `幾張票`：每輪點擊 `+` 的次數，限制為 `0` 到 `4`。
- `專屬碼／優先購票碼`：填入要在點擊 `+` 後自動輸入的專屬碼。空白代表不啟用。
- `點擊更新票數 delay 秒數`：記錄每次更新票數的開始時間；到達設定時間前，流程可以同步讀取票區並嘗試選擇，不會單純卡在 sleep。
- `選區後延遲幾秒按 +`：點進票區後，等待頁面完成展開，再開始點擊 `+`。
- `選擇順序`：支援 `top to bottom`、`bottom to top`、`middle`、`random`。

### 排程

每日啟動與暫停時間使用 24 小時制 `HH:MM:SS`，例如 `12:00:00` 代表中午 12 點。

時間欄位可以直接輸入，也可以用上下按鈕調整。設定完成後按 `儲存並排程`。

### Log

Log 可用以下勾選項目篩選：

- `成功`
- `票況`
- `失敗`
- `掃描細節`
- `系統`

如果要確認掃描到哪些票區，勾選 `掃描細節`。掃描 Log 會印出初始票區、每次整頁捲動後看到的票區，以及最後合併出的完整清單。

## 實際流程

按下 `啟動` 後，流程會依目前網址進行：

1. 在 `/activity/...`：尋找文字完全符合的 `立即購買` 或 `尚未開賣` 按鈕並點擊。找不到時寫 Log 後等待下一輪。
2. 在 `/order/...`：先自動點擊存在的 `我知道了`，再點擊 `更新票數`。
3. 以更新票數的時間點 A 作為 delay 起點，同時讀取目前票區。
4. 先套用 GUI 勾選的票區清單，再套用 `top_to_bottom`、`bottom_to_top`、`middle` 或 `random` 順序。
5. 有 `剩餘 N` 且 `N > 0` 的票區可以選擇；`熱賣中` 即使沒有明確剩餘數，也視為可嘗試的票區；明確 `剩餘 0` 會跳過。
6. 點擊選中的票區，等待「選區後延遲」。
7. 依設定張數點擊 `+`，多張票之間間隔 50ms。
8. 點完 `+` 後等待 50ms，才尋找專屬碼欄位並填入；再等待 100ms 後點擊 `下一步`。
9. 點擊 `下一步` 後，最多觀察 5 秒，避免頁面尚未跳轉就立刻重複操作。
10. 如果偵測到排隊等待頁，只等待頁面自行跳轉，不點擊其他按鈕。
11. 如果網址進入 `/confirmSeat/...`，代表進入結帳頁，立即停止自動流程。
12. 尚未成功時，寫入 Log 並進入下一輪；若 A 到目前時間已超過設定 delay，下一輪才會再次點擊更新票數。

## 票區與專屬碼的判斷方式

票區主要使用以下 DOM 結構：

- 票區標題：`button.v-expansion-panel-header`
- 票區內加號：`i.mdi.mdi-plus` 所在的按鈕

票區名稱會先移除動態文字，例如 `剩餘 N`、價格、`熱賣中`、`已售完`，再與 GUI 勾選的名稱比對，因此票數更新後仍能對應同一個票區。

專屬碼不依賴會變動的動態 id，例如 `input-597`。目前依序嘗試：

- `.exclusive-code .v-text-field__slot input`
- `.exclusive-code input[type="text"]`
- `.exclusive-code textarea`
- 依 placeholder 或外層文字尋找包含 `PRESALE`、`MEMBERSHIP`、`序號`、`專屬碼`、`優先購票碼` 的輸入欄位

填入時會使用原生 value setter，並派送 `input` / `change` 事件，讓 Vue / Vuetify 能收到值變更。找不到專屬碼欄位不會讓整個搶票流程失敗，因為不是每個活動都需要專屬碼。

## 外部 HTTP 觸發

### 啟動 Python server

在專案資料夾執行：

```powershell
python trigger_server.py
```

預設服務位址：`http://127.0.0.1:16888/trigger`

### 擴充功能設定

1. 在 Side Panel 勾選 `啟用外部 HTTP 觸發`。
2. URL 填入 `http://127.0.0.1:16888/trigger`。
3. 選擇 `GET` 或 `POST`。
4. 設定輪詢秒數，最小為 0.5 秒。
5. 按 `儲存外部觸發設定`。

### GET 測試

另一個瀏覽器分頁開啟：

`http://127.0.0.1:16888/trigger?fire=1`

這會先把一次性 trigger 放進 Python server，擴充功能下一次輪詢取到後，會對所有符合網域且尚未執行中的 Ticket Plus 分頁送出啟動指令。

Side Panel 的 `立即測試外部觸發` 在 GET 模式也會直接呼叫 `?fire=1`。

### POST 測試

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:16888/trigger `
  -ContentType "application/json" `
  -Body '{"trigger":true,"id":"job-001"}'
```

POST 可以同時覆蓋本次執行的流程設定：

```json
{
  "trigger": true,
  "id": "job-002",
  "options": {
    "selectedTargets": ["A區"],
    "orderMode": "top_to_bottom",
    "plusCount": 2,
    "exclusiveCode": "ABC123",
    "refreshToAreaDelayMs": 1500,
    "areaToPlusDelayMs": 300
  }
}
```

`options.exclusiveCode` 有值時只覆蓋這次外部觸發；沒有提供時，會沿用 Side Panel 儲存的專屬碼。

## 外部觸發沒有反應時

依序確認：

1. `trigger_server.py` 的視窗仍在執行。
2. 用瀏覽器開啟 `http://127.0.0.1:16888/trigger?fire=1` 時有回傳 `armed: true`。
3. Side Panel 的外部觸發 URL、方法與 Python server 一致。
4. 已按 `儲存外部觸發設定`，且狀態顯示已啟用。
5. Ticket Plus 分頁已重新整理，讓 content script 重新載入。
6. Log 是否出現 `內容腳本已載入，等待指令`、外部觸發錯誤或 `NO_TICKETPLUS_TAB`。

Python server 只負責暫存一次 trigger 並在被輪詢時回傳 JSON；真正啟動 Ticket Plus 流程與瀏覽器 Log 都在擴充功能的 background/content script。

## 主要檔案

- `manifest.json`：MV3、Side Panel、權限與 content script 設定。
- `popup/popup.html`：Side Panel GUI。
- `popup/popup.js`：GUI 設定、票區清單、外部觸發測試與 Log 篩選。
- `content.js`：Ticket Plus DOM 掃描、票區選擇、`+`、專屬碼、下一步與頁面狀態控制。
- `background.js`：外部 HTTP 輪詢、觸發去重與將啟動指令送到 Ticket Plus 分頁。
- `trigger_server.py`：本機 GET/POST trigger 暫存 server。
- `icons/`：擴充功能圖示。

## 開發與 Git

主要開發分支為 `dev`。目前專屬碼功能的 release 分支為 `release/exclusive-code-autofill`。

修改後建議至少執行：

```powershell
node --check content.js
node --check background.js
node --check popup/popup.js
git diff --check
```

不要把測試產生的 `badblocks-sda.log`、`ticket_plus_bot.zip` 等未追蹤檔案一起加入 commit。
