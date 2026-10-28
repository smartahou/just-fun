@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (echo 需要 Node.js 22.13 或更高版本。& pause & exit /b 1)
node "scripts\local-deploy-v723.js" update
if errorlevel 1 pause
