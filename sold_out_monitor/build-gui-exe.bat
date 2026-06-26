@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  set "PY_CMD=py -3"
) else (
  set "PY_CMD=python"
)

%PY_CMD% -m pip install -r requirements.txt
%PY_CMD% -m PyInstaller --onefile --windowed --name sold_out_monitor_gui --collect-all playwright monitor_gui.py

echo.
echo Build complete: dist\sold_out_monitor_gui.exe
pause
