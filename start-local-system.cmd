@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================
echo   Local App Startup
echo ==========================================
echo.
echo Starting the static web app on http://127.0.0.1:5500
echo Make sure SUPABASE_URL and SUPABASE_ANON_KEY are configured in .env
echo.

start "Local Dev Server - Family System" cmd /k powershell -ExecutionPolicy Bypass -Command "Set-Location '%~dp0'; python -m http.server 5500 --bind 127.0.0.1"

echo Open:
echo http://127.0.0.1:5500/charity-management-system.html
echo.
pause
