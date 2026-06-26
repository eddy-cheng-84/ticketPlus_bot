@echo off
setlocal

cd /d "%~dp0"

if not exist "logs" mkdir "logs"

set "WEBHOOK_URL=https://ntfy.sh/wasimilunolisaconser"
set "WEBHOOK_FORMAT=ntfy"
set "NTFY_PRIORITY=urgent"
set "NTFY_TAGS=warning"
set "EXTENSION_TRIGGER_ENABLED=true"
set "EXTENSION_TRIGGER_URL=http://127.0.0.1:16888/trigger"
set "EXTENSION_TRIGGER_METHOD=POST"
set "HEADLESS=false"
set "POLL_MIN_MS=15000"
set "POLL_MAX_MS=60000"
set "ALERT_REPEAT_COUNT=3"
set "ALERT_REPEAT_INTERVAL_MS=60000"

echo [%date% %time%] start-monitor.bat started >> "logs\monitor.log"
node run-with-log.js monitor.log node monitor.js

endlocal

pause
