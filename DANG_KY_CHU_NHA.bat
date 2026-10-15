@echo off
title Dang Ky Khuon Mat Chu Nha
color 0a
echo ========================================================
echo        DANG KHOI DONG TRINH DANG KY CHU NHA...
echo ========================================================
echo.
cd /d "%~dp0ai_module"
if exist "venv\Scripts\python.exe" (
    "venv\Scripts\python.exe" dang_ky_chu_nha.py
) else (
    python dang_ky_chu_nha.py
)
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [THONG BAO] Chuong trinh ket thuc.
)
pause
