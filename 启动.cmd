@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (echo 需要 Node.js 22.13 或更高版本。& pause & exit /b 1)
if /I "%~1"=="--lan" goto direct
echo.
echo Just Fun 启动方式：
echo [1] 仅电脑本机访问（默认）
echo [2] iPad mini / 局域网访问（启动后显示 IP 和端口）
set "JF_LAN_CHOICE="
set /p "JF_LAN_CHOICE=请选择 1 或 2（直接回车选 1）："
if "%JF_LAN_CHOICE%"=="2" (
  echo 已选择局域网模式：仅在可信的专用网络使用。
  node "scripts\local-deploy-v723.js" start --lan %*
) else (
  node "scripts\local-deploy-v723.js" start %*
)
goto done
:direct
node "scripts\local-deploy-v723.js" start %*
:done
if errorlevel 1 pause
