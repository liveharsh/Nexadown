@echo off
title NEXADOWN 3D (DDR5) - GitHub Auto Uploader
color 0b

echo =======================================================
echo       🚀 NEXADOWN 3D (DDR5) - GITHUB UPLOADER
echo =======================================================
echo.
cd /d "%~dp0"

REM Initialize git if .git doesn't exist yet
if not exist ".git" (
    echo [0/3] Initializing Git repository...
    git init
    git branch -M main
    git remote add origin https://github.com/liveharsh/Nexadown.git >nul 2>&1
)

echo [1/3] Adding files to Git commit...
git add .
git commit -m "Update NexaDown 3D - Production Backend, SSRF Protection, SSE & Render ready (DDR5)" >nul 2>&1

echo.
echo Current GitHub Remote:
git remote -v
echo.
echo Agar aapne New GitHub Repository banayi hai, toh URL paste karein:
echo (Example: https://github.com/liveharsh/Nexadown.git)
echo Agar purana hi URL use karna hai, toh bas ENTER press karein:
echo.
set /p NEW_URL="GitHub Repo URL [ENTER to keep]: "

if not "%NEW_URL%"=="" (
    echo Setting new repository URL to: %NEW_URL%
    git remote remove origin >nul 2>&1
    git remote add origin %NEW_URL%
)

echo.
echo [2/3] Uploading code to GitHub (main branch)...
git branch -M main
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo =======================================================
    echo  [3/3] SUCCESS! Saari DDR5 files GitHub par upload ho gayi hain!
    echo.
    echo  Ab Render.com dashboard par jakar:
    echo  "Manual Deploy" -> "Clear build cache & deploy" karein!
    echo =======================================================
) else (
    echo.
    echo =======================================================
    echo  [NOTE] Agar Git Push mein login maange ya error aaye:
    echo.
    echo  EASY ALTERNATIVE (Web Upload):
    echo  1. Browser mein GitHub Repo open karein:
    echo     https://github.com/liveharsh/Nexadown
    echo  2. "Add file" -> "Upload files" par click karein.
    echo  3. Folder "D:\ddr5" ke andar ki sabhi files ko select
    echo     karke drag-and-drop karein, ya ddr5.zip upload karein!
    echo  4. Niche "Commit changes" par click karein!
    echo =======================================================
)

echo.
pause
