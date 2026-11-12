@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto missing_node
echo Just Fun - iPad / LAN mode
node "scripts\local-deploy-v723.js" start --lan %*
if errorlevel 1 pause
goto :eof
:missing_node
echo Node.js 22.13 or newer is required.
pause
exit /b 1
