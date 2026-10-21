@echo off
title NEXADOWN 3D - Ultra Media Downloader
color 0b

echo =======================================================
echo         NEXADOWN 3D - ULTRA MEDIA DOWNLOADER
echo =======================================================
echo.
cd /d "%~dp0"

if not exist "node_modules\" (
    echo [Setup] Installing required dependencies...
    call npm install
)

if not exist "bin\yt-dlp.exe" (
    echo [Setup] Downloading engine binaries...
    call npm run setup
)

echo.
echo Launching NEXADOWN 3D Web Server...
start "" http://localhost:3000
node server.js

pause
