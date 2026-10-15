@echo off
title Smart Home AI Camera
color 0b
echo ========================================================
echo        DANG KHOI DONG CAMERA AI SMART HOME...
echo ========================================================
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
