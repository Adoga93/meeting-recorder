@echo off
title PAS Tutors 24/7 Automated Class Scheduler
cd /d "%~dp0"

echo ========================================================
echo   🤖 PAS TUTORS 24/7 CLASS RECORDER SCHEDULER
echo ========================================================
echo.

:CHECK_DOCKER
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] Docker Desktop does not appear to be running!
    echo Please make sure Docker Desktop is launched and running.
    echo.
) else (
    echo [OK] Docker daemon is running and responsive.
    echo.
)

:START_LOOP
echo [%DATE% %TIME%] Starting Scheduler (node scheduler.js)...
node scheduler.js

echo.
echo [ALERT] Scheduler stopped or crashed. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto START_LOOP
