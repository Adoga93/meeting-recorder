@echo off
cd /d "%~dp0"
if exist temp_login_profile rmdir /s /q temp_login_profile
echo ========================================================
echo Starting Google Sign-in window for Meeting Bot...
echo Please log into your preferred Google account.
echo Once signed in, CLOSE the browser window to save state.
echo ========================================================
node login.js
pause
