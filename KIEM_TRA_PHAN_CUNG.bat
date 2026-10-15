@echo off
chcp 65001 >nul
title KIỂM TRA PHẦN CỨNG ARDUINO (CỬA, RÈM, QUẠT, ĐÈN)
cd /d "%~dp0"
echo ====================================================================
echo        CÔNG CỤ KIỂM TRA PHẦN CỨNG ARDUINO UNO (COM9)
echo ====================================================================
echo Đang mở trình chẩn đoán trực tiếp...
echo (Lưu ý: Hãy tắt cửa sổ Camera AI trước khi chạy để không bị trùng cổng COM)
echo.
.\ai_module\venv\Scripts\python.exe .\ai_module\kiem_tra_phan_cung.py
pause
