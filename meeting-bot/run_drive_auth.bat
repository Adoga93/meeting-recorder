@echo off
echo ========================================================
echo   Quick-Raman Google Drive One-Time Authorization
echo ========================================================
echo.
echo Opening Google Authorization in your browser...
echo Sign in with odeadoga93@gmail.com and approve Drive access.
echo.
cd /d "%~dp0"
node upload_drive.js --auth-only
echo.
echo ========================================================
pause
