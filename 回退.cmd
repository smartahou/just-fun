@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "scripts\local-deploy-v723.js" rollback
if errorlevel 1 pause
