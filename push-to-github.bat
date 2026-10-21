@echo off
title NEXADOWN 3D - GitHub Auto Upload
color 0b

echo =======================================================
echo          NEXADOWN 3D - GITHUB UPLOADER
echo =======================================================
echo.
cd /d "%~dp0"

echo [1/3] Checking Git files...
git add .
git commit -m "Update NEXADOWN 3D with Spotify Playlist & Error Fixes" >nul 2>&1

echo.
echo Current GitHub Remote:
git remote -v
echo.
echo Agar aapne New GitHub Account banaya hai, toh niche apna
echo New Repository URL paste karein (e.g. https://github.com/YourName/nexadown.git)
echo Agar purana hi use karna hai, toh bas ENTER dabayein:
echo.
set /p NEW_URL="GitHub Repo URL: "

if not "%NEW_URL%"=="" (
    echo Setting new repository URL...
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
    echo [3/3] SUCCESS! Saari files GitHub par upload ho gayi hain!
    echo Ab Render dashboard par jakar:
    echo "Manual Deploy" -> "Clear build cache & deploy" karein!
    echo =======================================================
) else (
    echo.
    echo =======================================================
    echo [NOTE] Agar Git Push mein login maange ya error aaye:
    echo 1. Browser mein GitHub Repo open karein.
    echo 2. "Add file" -> "Upload files" par click karein.
    echo 3. "D:\nexadown-3d-github" folder ke andar ki sabhi 
    echo    files ko drag-and-drop karke "Commit changes" karein!
    echo =======================================================
)

pause
