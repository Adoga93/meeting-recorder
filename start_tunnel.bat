@echo off
echo ========================================================
echo   Quick-Raman Cloudflare Public Tunnel
echo ========================================================
echo.
echo Starting secure public tunnel for http://localhost:3000...
echo.
cd /d "%~dp0"
cloudflared.exe tunnel --url http://localhost:3000
pause
