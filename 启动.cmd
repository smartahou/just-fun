@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto missing_node
if /I "%~1"=="--lan" goto lan
echo.
echo Just Fun - Start mode
echo 1 - This computer only
echo 2 - iPad / LAN
set "JF_START_MODE="
set /p "JF_START_MODE=Choose 1 or 2 [default 1]: "
if "%JF_START_MODE%"=="2" goto lan
:local
node "scripts\local-deploy-v723.js" start %*
goto finish
:lan
node "scripts\local-deploy-v723.js" start --lan %*
goto finish
:missing_node
echo Node.js 22.13 or newer is required.
pause
exit /b 1
:finish
if errorlevel 1 pause
