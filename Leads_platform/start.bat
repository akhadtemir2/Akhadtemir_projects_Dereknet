@echo off
title BaiTech Lead Hub

echo Starting BaiTech Lead Hub...
echo.

REM Start backend in new window
start "BaiTech Backend" cmd /k "cd /d %~dp0backend && uvicorn main:app --reload --port 8000"

REM Wait 2 seconds for backend to initialize
timeout /t 2 /nobreak >nul

REM Start frontend in new window
start "BaiTech Frontend" cmd /k "cd /d %~dp0 && npm run dev"

echo.
echo Both servers starting...
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Opening browser in 4 seconds...
timeout /t 4 /nobreak >nul

start http://localhost:5173
