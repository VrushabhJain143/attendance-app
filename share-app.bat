@echo off
title Share Student Attendance App Over Internet
cd /d "%~dp0"
echo ====================================================
echo   Student Attendance Manager - Internet Sharing
echo ====================================================
echo.

:: Get local IP address using -UseBasicParsing
echo Finding your public IP address (you may need this on the link)...
for /f "delims=" %%i in ('powershell -Command "(Invoke-WebRequest -Uri 'https://api.ipify.org' -UseBasicParsing -TimeoutSec 5).Content"') do set PUBLIC_IP=%%i
echo Your Public IP is: %PUBLIC_IP%
echo.

echo Terminating any existing servers on port 3000...
powershell -Command "$conn = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo.

echo Starting backend server in the background...
where node >nul 2>nul
if %errorlevel% equ 0 (
  start /b "AttendanceServer" node server.js
) else (
  start /b "AttendanceServer" "C:\Users\VICTUS\AppData\Local\ms-playwright-go\1.57.0\node.exe" server.js
)
timeout /t 3 /nobreak >nul

echo Generating public link...
echo ----------------------------------------------------
echo When the link opens, it might ask for your "Endpoint IP".
echo Please enter this IP: %PUBLIC_IP%
echo ----------------------------------------------------
echo.

set PATH=C:\Users\VICTUS\.gemini\antigravity\scratch\node-v20.11.1-win-x64;%PATH%
call npx -y localtunnel --port 3000

pause
