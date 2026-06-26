@echo off
setlocal

cd /d "%~dp0"

set "PY_CMD=python"
where py >nul 2>nul
if %errorlevel%==0 set "PY_CMD=py -3"

%PY_CMD% -m pip install -r requirements.txt
if errorlevel 1 goto fail

%PY_CMD% -m PyInstaller --onefile --name sold_out_monitor --collect-all playwright monitor.py
if errorlevel 1 goto fail

echo.
echo Build complete: dist\sold_out_monitor.exe
echo.
goto end

:fail
echo.
echo Build failed.
echo.

:end
endlocal
pause
