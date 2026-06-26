Sold Out Monitor - Ticket Plus 活動頁售完監控器
=================================================

專案位置
--------

C:\Users\Lu_white\Documents\chrome_extension\ticket_plus_bot\sold_out_monitor

這個資料夾是 chrome_extension\ticket_plus_bot 底下的輔助工具。
用途是監控 Ticket Plus 活動頁「立即購買」區塊底下的所有場次。

如果某個場次不再顯示「銷售一空」，monitor 會：

1. 發送 webhook，例如 ntfy。
2. 依設定通知本機 Chrome extension trigger server。
3. trigger server 收到後，extension 可以開始跑原本的自動流程。


重要觀念
--------

Ticket Plus 的場次不是 raw HTML 裡就能可靠看到。
一定要讓前端網頁渲染完成後，從 DOM 讀取 document.body.innerText。

所以這份工具使用 Playwright 開瀏覽器，不是用 requests 抓 HTML。

目前預設瀏覽器是 Microsoft Edge：

  "browser_channel": "msedge"

原因：

1. Windows 11 通常自帶 Edge。
2. 不需要另外要求使用者安裝 Chrome。
3. Playwright 可以直接用系統 Edge。

注意：

改用 Edge 不代表 exe 會大幅變小。
目前 exe 大約 45MB，主要大小來自 Python runtime + Playwright driver。
exe 沒有把 Chrome 或 Edge 瀏覽器本體包進去。

如果真的要最小化檔案大小，最小方案是不要帶 exe，改用 Python source + requirements.txt。


建議使用方式：GUI
-----------------

現在最建議的入口是 GUI：

  start-monitor-gui.bat

GUI 可以直接填：

  活動網址
  Webhook URL
  是否啟用 Extension Trigger
  Trigger URL
  Edge / Chrome
  Headless
  輪詢秒數
  通知重複次數

GUI 下方有 Log / Debug 欄位，可以直接看到：

  掃描到哪幾個場次
  每個場次目前是「銷售一空」或「可通知」
  webhook 是否送出
  extension trigger 是否送出
  錯誤 stack trace

GUI 按鈕：

  儲存設定
    把畫面上的欄位寫入 monitor_config.json。

  掃描一次
    開 Edge 掃目前活動頁一次，不進入長時間輪詢。

  測試通知
    發一筆測試 webhook。

  開始監控
    依照輪詢秒數持續掃描。

  停止
    停止目前監控 loop。

  清除 Log
    清空 GUI 內的 Log 欄位。


檔案說明
--------

monitor_gui.py
  GUI 主程式。讓使用者不用手改 JSON。

monitor.py
  主要 Python 程式。

dist\sold_out_monitor_gui.exe
  已打包的 Windows GUI exe。

dist\sold_out_monitor.exe
  已打包的 Windows CLI exe。

monitor_config.example.json
  設定範例。第一次跑 start-monitor.bat 時，若沒有 monitor_config.json，會自動複製一份。

monitor_config.json
  本機實際設定。這是 runtime config，通常不用 commit。

requirements.txt
  Python 依賴。

start-monitor.bat
  CLI 啟動入口。優先跑 dist\sold_out_monitor.exe，沒有 exe 才跑 Python。

start-monitor-gui.bat
  GUI 啟動入口。優先跑 dist\sold_out_monitor_gui.exe，沒有 exe 才跑 Python。

test-notify.bat
  測試 webhook / extension trigger。

build-exe.bat
  用 PyInstaller 重新打包 CLI exe。

build-gui-exe.bat
  用 PyInstaller 重新打包 GUI exe。

legacy_node\
  舊 Node.js 版監控器備份。

logs\
  執行時 log。不要 commit。

.ticketplus-monitor-state.json
  執行時狀態檔。不要 commit。

build\
  PyInstaller build artifact。不要 commit。

sold_out_monitor.spec
  PyInstaller spec artifact。一般不要 commit。


使用流程：GUI
--------

1. 進入資料夾：

   cd C:\Users\Lu_white\Documents\chrome_extension\ticket_plus_bot\sold_out_monitor

2. 開 GUI：

   start-monitor-gui.bat

3. 在 GUI 填活動網址：

   https://ticketplus.com.tw/activity/活動ID

4. 先按「掃描一次」。

5. 確認 Log 有列出場次。

6. 要正式監控再按「開始監控」。

7. 停止時按「停止」，或直接關閉 GUI。


使用流程：CLI
-------------

1. 進入資料夾：

   cd C:\Users\Lu_white\Documents\chrome_extension\ticket_plus_bot\sold_out_monitor

2. 第一次先建立設定：

   start-monitor.bat

   如果 monitor_config.json 不存在，bat 會從 monitor_config.example.json 複製一份。

3. 編輯 monitor_config.json：

   "ticketplus_url": "https://ticketplus.com.tw/activity/活動ID"

4. 單次測試：

   dist\sold_out_monitor.exe --config monitor_config.json --once

5. 正式開始輪詢：

   start-monitor.bat

6. 停止：

   在 terminal 按 Ctrl + C。


如何判斷真正的「立即購買」
--------------------------

Ticket Plus 頁面上方導覽列也會有「立即購買」。
所以程式不會看到第一個「立即購買」就直接相信。

目前規則：

1. 開 Edge，等待前端渲染。
2. 讀 document.body.innerText。
3. 逐行掃描文字。
4. 找到文字完全等於「立即購買」的行。
5. 檢查這行後面 12 行內是否有：

   場次名稱
   售票狀態

   或是否有舊格式：

   日期
   時間

6. 如果後面只是：

   活動介紹
   注意事項
   購買提醒

   就代表這是導覽列，不是場次區塊，會跳過。


如何判斷有票訊號
----------------

目前規則很單純：

1. 場次文字包含「銷售一空」：視為售完。
2. 場次文字不包含「銷售一空」：視為可通知。

所以以下狀態都會通知：

  尚未開賣
  立即購買
  熱賣中
  剩餘 N

這是廣義監控。
如果以後只想通知「立即購買」或「熱賣中」，要改 monitor.py 的狀態白名單。


設定重點
--------

monitor_config.json 常用欄位：

ticketplus_url
  要監控的 Ticket Plus 活動頁。

webhook_url
  通知目的地，例如 https://ntfy.sh/your-topic。

webhook_format
  ntfy 或 json。

extension_trigger_enabled
  是否通知本機 extension trigger server。

extension_trigger_url
  預設 http://127.0.0.1:16888/trigger。

extension_trigger_method
  POST 或 GET。

headless
  false：會看到 Edge 視窗。
  true：背景跑。

browser_channel
  預設 msedge。
  如果想改 Chrome，可以改成 chrome。

poll_min_ms / poll_max_ms
  每次輪詢間隔會在這兩個值之間隨機。

alert_repeat_count
  有票訊號出現後，webhook 重複發送次數。

alert_repeat_interval_ms
  重複通知間隔。

sold_out_text
  預設 銷售一空。


常用命令
--------

開 GUI：

  start-monitor-gui.bat

單次檢查：

  dist\sold_out_monitor.exe --config monitor_config.json --once

測試通知：

  dist\sold_out_monitor.exe --config monitor_config.json --test-notify

開始監控：

  start-monitor.bat

重新打包 exe：

  build-exe.bat

重新打包 GUI exe：

  build-gui-exe.bat


和 extension trigger 的關係
---------------------------

monitor 只負責監控活動頁和送訊號。
真正自動選票 / 點票區 / 下一步的流程仍在 Chrome extension。

串接順序：

1. 先跑 extension 專案根目錄的 trigger_server.py。
2. monitor 偵測到不是「銷售一空」。
3. monitor POST 或 GET 到 http://127.0.0.1:16888/trigger。
4. extension 讀到外部觸發。
5. extension 在 Ticket Plus 頁面開始原本的自動流程。


排錯筆記
--------

如果抓不到場次：
  先用 --once 看輸出。
  確認活動頁真的有「立即購買」場次表。
  不要用 raw HTML 判斷，這網站需要前端渲染。

如果 Edge 沒開：
  確認 browser_channel 是 msedge。
  Windows 11 正常應該有 Edge。
  如果要改 Chrome，設成 chrome。

如果 extension 沒反應：
  確認 trigger_server.py 有跑。
  確認 extension_trigger_enabled 是 true。
  確認 extension_trigger_url 是 http://127.0.0.1:16888/trigger。

如果 webhook 沒收到：
  先跑 test-notify.bat。
  確認 webhook_url 正確。

如果 exe 太大：
  這是 PyInstaller + Python + Playwright driver 的大小。
  Edge/Chrome channel 不會讓 exe 大幅變小。
  真要小，改用 Python 原始碼部署。


給下一個 Codex 的提醒
---------------------

1. 不要再把 README 做得很花。
2. 這份 README.txt 是主要接手文件。
3. GUI 入口是 monitor_gui.py / start-monitor-gui.bat。
4. 修改 monitor.py 後，要用真實 Ticket Plus 活動頁跑 --once。
5. 修改 monitor_gui.py 後，至少跑：

   python -m unittest discover -s tests
   python -m py_compile monitor.py monitor_gui.py

6. GUI 的實際視窗需要在 Windows 桌面環境手動開一次確認。
7. 驗證要看前端渲染後的 DOM，不要只看 raw HTML。
8. runtime 檔案不要 commit：

   monitor_config.json
   logs\
   build\
   .ticketplus-monitor-state.json
   *.spec

9. 目前預設使用 Edge：

   "browser_channel": "msedge"

10. 如果重打包 exe，記得確認 dist\sold_out_monitor.exe 或 dist\sold_out_monitor_gui.exe 能啟動。
