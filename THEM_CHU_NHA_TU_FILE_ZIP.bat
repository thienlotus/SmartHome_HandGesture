@echo off
chcp 65001 >nul
title NHẬP KHUÔN MẶT CHỦ NHÀ MỚI TỪ FILE ZIP (100 ẢNH TỪ XA)
color 0B

echo ====================================================================
echo      HỆ THỐNG ĐĂNG KÝ THÊM CHỦ NHÀ TỪ XA (SMART HOME AI)
echo ====================================================================
echo.
echo  Bạn vừa nhận được file dataset_[tên].zip (100 ảnh) từ khách gửi qua Zalo?
echo  Công cụ này sẽ tự động giải nén và nạp khuôn mặt vào mô hình Deep Learning!
echo.
echo ====================================================================

cd /d "%~dp0ai_module"

if not exist "venv\Scripts\python.exe" (
    echo [!] Khong tim thay moi truong venv. Dang dung python he thong...
    python nhap_khach_hang_zip.py %1
) else (
    venv\Scripts\python.exe nhap_khach_hang_zip.py %1
)

pause
