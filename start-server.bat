@echo off
title Student Attendance Manager Server
cd /d "%~dp0"
echo Starting Student Attendance Manager Server...
echo.

where node >nul 2>nul
if %errorlevel% equ 0 (
  node server.js
) else (
  "C:\Users\VICTUS\AppData\Local\ms-playwright-go\1.57.0\node.exe" server.js
)
pause
