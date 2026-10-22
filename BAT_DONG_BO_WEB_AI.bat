@echo off
title Smart Home AI - Dong Bo Python AI va Web App
color 0b
echo ========================================================
echo   KHOI DONG DONG BO TOAN DIEN: PYTHON AI + WEB APP
echo ========================================================
echo.
cd /d "%~dp0"

echo [1/3] Khoi dong Web Server cuc bo tai cong 8000...
start /b "" "%~dp0ai_module\venv\Scripts\python.exe" -m http.server 8000 --directory "%~dp0web_app" >nul 2>&1

echo [2/3] Mo giao dien Web tren trinh duyet...
start "" "http://localhost:8000"

echo [3/3] Khoi dong Camera AI (YuNet + SFace Deep Learning 128-D)...
echo.
cd /d "%~dp0ai_module"
if exist "venv\Scripts\python.exe" (
    "venv\Scripts\python.exe" main.py
) else (
    python main.py
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [LOI] Chuong trinh bi dung dot ngot!
    pause
)
