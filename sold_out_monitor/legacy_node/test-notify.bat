@echo off
setlocal

cd /d "%~dp0"

if not exist "logs" mkdir "logs"

set "WEBHOOK_URL=https://ntfy.sh/wasimilunolisaconser"
set "WEBHOOK_FORMAT=ntfy"
set "NTFY_PRIORITY=urgent"
set "NTFY_TAGS=warning"
set "HEADLESS=false"
set "POLL_MIN_MS=45000"
set "POLL_MAX_MS=90000"

echo [%date% %time%] test-notify.bat started >> "logs\test-notify.log"
node run-with-log.js test-notify.log node monitor.js --test-notify

endlocal
