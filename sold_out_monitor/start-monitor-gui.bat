@echo off
setlocal
cd /d "%~dp0"

if exist "dist\sold_out_monitor_gui.exe" (
  start "" "dist\sold_out_monitor_gui.exe"
) else (
  python monitor_gui.py
)
