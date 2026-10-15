# 🏠 AI Smart Home System: Hand Gesture & Face Recognition Control

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg?logo=python&logoColor=white)](https://www.python.org/)
[![OpenCV](https://img.shields.io/badge/OpenCV-Computer%20Vision-green.svg?logo=opencv&logoColor=white)](https://opencv.org/)
[![MediaPipe](https://img.shields.io/badge/Google-MediaPipe-orange.svg)](https://developers.google.com/mediapipe)
[![Arduino](https://img.shields.io/badge/Arduino-Uno%20R3-00979D.svg?logo=arduino&logoColor=white)](https://www.arduino.cc/)
[![Wokwi](https://img.shields.io/badge/Simulator-Wokwi-blueviolet.svg)](https://wokwi.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Hệ thống nhà thông minh thế hệ mới tích hợp **Trí Tuệ Nhân Tạo (AI Computer Vision)**:
- Nhận diện cử chỉ bàn tay thời gian thực với **Google MediaPipe Gesture Recognizer**.
- Xác thực danh tính chủ nhà bằng thuật toán nhận diện khuôn mặt **OpenCV LBPH**.
- Giao tiếp hai chiều với phần cứng **Arduino Uno** để điều khiển các thiết bị điện trong nhà.

---

## 📸 Giao Diện & Sơ Đồ Đấu Dây

### 1. Bảng Điều Khiển Camera AI
Giao diện hiển thị camera thời gian thực, khung nhận diện khuôn mặt chủ nhà, vị trí bàn tay và trạng thái các thiết bị:

![Giao dien AI](ai_module/ui_preview_vietnamese.png)

### 2. Sơ Đồ Đấu Dây Phần Cứng (Hardware Pinout)
Hệ thống kết nối giữa máy tính (xử lý AI) và Arduino Uno qua cổng USB Serial:

![So Do Dau Day](docs/SoDo_DauDay_SmartHome.svg)

---

## ✋ Bảng Mã Cử Chỉ & Thiết Bị Điều Khiển

| Cử Chỉ Tay | Biểu Tượng | Thao Tác | Thiết Bị Tác Động | Lệnh Serial |
|---|:---:|---|---|:---:|
| **Victory** | ✌️ | Mở Cửa chính | Servo Cửa quay 90° | `O` |
| **Thumb Down** | 👎 | Đóng Cửa chính | Servo Cửa quay 0° | `C` |
| **Thumb Up** | 👍 | Kéo Rèm cửa lên | Servo Rèm quay 90° | `U` |
| **Pointing Up** | 👆 | Thả Rèm cửa xuống | Servo Rèm quay 0° | `D` |
| **Open Palm** | ✋ | Bật Đèn phòng khách | Đèn LED (D8) sáng | `L` |
| **OK / Pinch** | 👌 | Bật / Tắt Tivi | LCD 1602 I2C chuyển chế độ | `T` |
| **ILoveYou** | 🤟 | Báo động SOS | Còi Buzzer (D7) kêu dồn dập | `S` |
| **Closed Fist** | ✊ | Tắt Toàn Bộ | Đóng cửa, hạ rèm, tắt đèn & tivi | `X` |

> ⏱️ **Cơ chế chống nhấp nháy (Debounce Protection):** Hệ thống tích hợp bộ lọc thời gian 1.5 giây, giúp tránh hiện tượng đảo trạng thái liên tục khi người dùng giữ nguyên một cử chỉ trước camera.

---

## 🛡️ Xác Thực Khuôn Mặt Chủ Nhà (Face Recognition)

Hệ thống sử dụng mô hình **Haar Cascade** để phát hiện khuôn mặt và **LBPHFaceRecognizer** để huấn luyện/nhận dạng gia chủ:
1. Khi chủ nhà xuất hiện trước camera, hệ thống hiển thị tên chủ nhà với khung màu xanh lá và cho phép thực thi toàn bộ lệnh cử chỉ.
2. Cung cấp công cụ đăng ký gia chủ tự động chụp 100 ảnh mẫu đa góc độ và tự động huấn luyện file mô hình `face_model.yml`.

---

## 🔌 Sơ Đồ Chân Kết Nối Arduino Uno

| Thiết Bị | Chân Arduino | Ghi Chú |
|---|---|---|
| **Còi Báo Buzzer** | `D7` | Còi chủ động 5V phát âm báo & SOS |
| **Đèn LED Chiếu Sáng** | `D8` | Đèn LED qua điện trở hạn dòng 220Ω |
| **Servo Cửa Chính** | `D9` | Động cơ servo SG90 góc quay 0° - 90° |
| **Servo Rèm Cửa** | `D10` | Động cơ servo SG90 điều khiển dây kéo |
| **Relay Quạt / Tải Lớn** | `D11` | Relay kích mức LOW điều khiển tải 220V |
| **Màn Hình LCD 1602 I2C** | `SDA (A4)`, `SCL (A5)` | Hiển thị trạng thái kênh Tivi & SmartHome |
| **Nguồn Cấp** | `5V` & `GND` | Nguồn cấp cho toàn bộ module cảm biến |

---

## 📂 Cấu Trúc Dự Án

```plaintext
SmartHome_HandGesture/
├── ai_module/                              # Module xử lý AI trên máy tính
│   ├── dataset/                            # Thư mục chứa ảnh khuôn mặt đăng ký
│   │   └── .gitkeep
│   ├── dang_ky_chu_nha.py                  # Script chụp ảnh & huấn luyện khuôn mặt gia chủ
│   ├── face_model.yml                      # Mô hình khuôn mặt đã được huấn luyện
│   ├── gesture_recognizer.task             # Model AI Google MediaPipe nhận diện cử chỉ
│   ├── hand_landmarker.task                # Model AI Google nhận diện khớp xương bàn tay
│   ├── haarcascade_frontalface_default.xml # Cascade phân loại khuôn mặt
│   ├── main.py                             # Ứng dụng chính (Camera + AI + Serial)
│   ├── requirements.txt                    # Thư viện Python cần thiết
│   └── run_wrapper.py                      # Wrapper xử lý lỗi khi khởi chạy
├── arduino_module/                         # Code nhúng phần cứng Arduino
│   ├── smart_home/
│   │   └── smart_home.ino                  # Firmware Arduino nhận lệnh Serial và điều khiển chân
│   ├── i2c_scanner/
│   │   └── i2c_scanner.ino                 # Công cụ quét tìm địa chỉ I2C của LCD
│   ├── diagram.json                        # Cấu hình mô phỏng mạch điện Wokwi
│   └── wokwi.toml                          # Cấu hình nạp firmware cho Wokwi
├── docs/                                   # Tài liệu và sơ đồ dự án
│   └── SoDo_DauDay_SmartHome.svg           # Sơ đồ đấu nối dây phần cứng chi tiết
├── BAT_CAMERA_AI.bat                       # File khởi động nhanh Camera AI 1-click
├── DANG_KY_CHU_NHA.bat                     # File mở trình đăng ký chủ nhà 1-click
├── generate_diagram_desktop.py             # Script sinh đồ họa SVG sơ đồ đấu dây
├── requirements.txt                        # Danh sách thư viện toàn dự án
└── README.md                               # Hướng dẫn chi tiết
```

---

## 🚀 Hướng Dẫn Cài Đặt & Sử Dụng

### 1. Chuẩn Bị Môi Trường Python
Khuyến nghị sử dụng **Python 3.10** hoặc **3.11**:

```bash
# Di chuyển vào thư mục ai_module
cd ai_module

# Tạo môi trường ảo venv
python -m venv venv

# Kích hoạt môi trường ảo
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Cài đặt các thư viện cần thiết
pip install -r requirements.txt
```

### 2. Nạp Code Cho Arduino
1. Mở phần mềm **Arduino IDE**.
2. Mở file [arduino_module/smart_home/smart_home.ino](arduino_module/smart_home/smart_home.ino).
3. Cài đặt các thư viện trên Arduino Library Manager nếu chưa có:
   - `LiquidCrystal_I2C` (by Frank de Brabander)
   - `Servo` (built-in)
4. Chọn đúng Board (**Arduino Uno**) và Port COM kết nối.
5. Nhấn **Upload** để nạp code.

> ⚠️ **Lưu ý cấu hình cổng COM:** Trong file [ai_module/main.py](ai_module/main.py), kiểm tra dòng `ser = serial.Serial('COM5', 9600)` và đổi `'COM5'` thành đúng cổng COM máy bạn đang kết nối với Arduino.

### 3. Đăng Ký Khuôn Mặt Gia Chủ (Tùy Chọn)
Để thêm khuôn mặt mới vào hệ thống:
- Chạy trực tiếp file `DANG_KY_CHU_NHA.bat` hoặc lệnh:
  ```bash
  python ai_module/dang_ky_chu_nha.py
  ```
- Nhập tên của bạn, ngồi trước webcam để hệ thống tự động ghi lại 100 frame và xuất file mô hình `face_model.yml`.

### 4. Khởi Động Hệ Thống
Chỉ cần nhấp đúp vào file `BAT_CAMERA_AI.bat` hoặc chạy:
```bash
python ai_module/main.py
```
- Đưa tay trước camera trong phạm vi 0.5m - 2m.
- Thực hiện các cử chỉ tay để quan sát thiết bị và giao diện phản hồi tức thì.
- Nhấn phím `Q` hoặc nút **Thoát** trên giao diện để dừng ứng dụng.

---

## 💻 Mô Phỏng Trên Wokwi Simulator
Nếu chưa có phần cứng thật, bạn có thể mô phỏng toàn bộ mạch Arduino trên [Wokwi](https://wokwi.com/):
- Cài extension **Wokwi Simulator** trên VS Code.
- Mở thư mục `arduino_module`.
- Nhấn `F1` -> Chọn **Wokwi: Start Simulator**.

---

## 👨‍💻 Tác Giả & Bản Quyền
- Dự án phát triển bởi **[Thienlotus](https://github.com/thienlotus)**.
- Giấy phép phân phối: [MIT License](LICENSE).
