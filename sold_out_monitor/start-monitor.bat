@echo off
setlocal

cd /d "%~dp0"
if not exist "logs" mkdir "logs"

if not exist "monitor_config.json" (
  copy "monitor_config.example.json" "monitor_config.json" >nul
)

echo [%date% %time%] sold_out_monitor started >> "logs\monitor.log"

if exist "dist\sold_out_monitor.exe" (
  "dist\sold_out_monitor.exe" --config "monitor_config.json" >> "logs\monitor.log" 2>&1
) else if exist "sold_out_monitor.exe" (
  "sold_out_monitor.exe" --config "monitor_config.json" >> "logs\monitor.log" 2>&1
) else (
  python monitor.py --config "monitor_config.json" >> "logs\monitor.log" 2>&1
)

endlocal
pause
