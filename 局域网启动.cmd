@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (echo 需要 Node.js 22.13 或更高版本。& pause & exit /b 1)
echo Just Fun 局域网模式：请仅在可信 Wi-Fi / 专用网络下使用。
echo 启动成功后，请将屏幕显示的「iPad 局域网访问」完整网址输入 Safari。
node "scripts\local-deploy-v723.js" start --lan %*
if errorlevel 1 pause
