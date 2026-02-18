@echo off
echo ========================================
echo 强制清理所有缓存
echo ========================================

REM 停止所有 Node.js 进程
echo.
echo [1/5] 停止所有 Node.js 进程...
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM bun.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM 清理 sidecar 缓存
echo [2/5] 清理 sidecar 缓存...
cd /d "%~dp0\sidecar"
if exist node_modules\.cache rmdir /s /q node_modules\.cache
if exist .cache rmdir /s /q .cache
if exist dist rmdir /s /q dist
if exist .turbo rmdir /s /q .turbo

REM 清理 desktop 缓存
echo [3/5] 清理 desktop 缓存...
cd /d "%~dp0\desktop"
if exist node_modules\.cache rmdir /s /q node_modules\.cache
if exist .cache rmdir /s /q .cache
if exist dist rmdir /s /q dist
if exist .turbo rmdir /s /q .turbo

REM 清理 Rust 构建缓存
echo [4/5] 清理 Rust 构建缓存...
cd /d "%~dp0\desktop\src-tauri"
if exist target\debug\.fingerprint rmdir /s /q target\debug\.fingerprint

REM 清理 Node.js 模块缓存
echo [5/5] 清理 Node.js 全局缓存...
npm cache clean --force >nul 2>&1

echo.
echo ========================================
echo 缓存清理完成！
echo ========================================
echo.
echo 现在可以重启了：
echo   cd desktop
echo   npm run tauri dev
echo.
pause
