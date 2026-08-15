@echo off
title Share Student Attendance App - Direct Link
cd /d "%~dp0"
echo ====================================================
echo   Student Attendance Manager - Direct Link Sharing
echo ====================================================
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

echo Generating direct link...
echo ----------------------------------------------------
echo Copy the HTTPS link shown below and send it to your friend.
echo When they open it, if a warning page appears, they just 
echo need to click "Proceed" or "I trust this site". 
echo (NO IP ADDRESS REQUIRED!)
echo ----------------------------------------------------
echo.

:loop
echo Connecting to secure tunnel server (serveo.net)...
ssh -tt -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 80:127.0.0.1:3000 serveo.net

echo.
echo Tunnel connection lost. Reconnecting in 5 seconds...
timeout /t 5
goto loop
