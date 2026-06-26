@echo off
setlocal

cd /d "%~dp0"
if not exist "logs" mkdir "logs"
if not exist "monitor_config.json" copy "monitor_config.example.json" "monitor_config.json" >nul

if exist "dist\sold_out_monitor.exe" (
  "dist\sold_out_monitor.exe" --config "monitor_config.json" --test-notify >> "logs\test-notify.log" 2>&1
) else if exist "sold_out_monitor.exe" (
  "sold_out_monitor.exe" --config "monitor_config.json" --test-notify >> "logs\test-notify.log" 2>&1
) else (
  python monitor.py --config "monitor_config.json" --test-notify >> "logs\test-notify.log" 2>&1
)

endlocal
pause
