import sys
import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import serial
import serial.tools.list_ports
import time
import os
import math
import threading
import numpy as np
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Còi báo động và các hiệu ứng phát trực tiếp trên phần cứng mô hình nhúng Arduino (Buzzer D7)
# Tuyệt đối không phát âm thanh trên loa laptop

# ====================================================================
# 1. KẾT NỐI SERIAL VỚI ARDUINO UNO (TỰ ĐỘNG QUÉT CỔNG COM)
# ====================================================================
def get_arduino_port():
    ports = list(serial.tools.list_ports.comports())
    for p in ports:
        if p.device in ['COM9', 'COM5']:
            return p.device
    for p in ports:
        desc = p.description.lower()
        if 'arduino' in desc or 'ch340' in desc or 'usb serial' in desc:
            return p.device
    if ports:
        return ports[0].device
    return 'COM9'

target_port = get_arduino_port()
try:
    ser = serial.Serial(target_port, 9600, timeout=1)
    # Đợi Arduino Uno hoàn tất bootloader và khởi tạo setup()
    start_wait = time.time()
    while time.time() - start_wait < 3.2:
        if ser.in_waiting > 0:
            line = ser.readline().decode(errors='ignore')
            if "ARDUINO_READY" in line:
                break
        time.sleep(0.05)
    # Xả sạch bộ đệm ban đầu
    if ser.in_waiting > 0:
        ser.read(ser.in_waiting)
    print(f"Da ket noi Serial voi Arduino ({target_port}) thanh cong!")
    arduino_connected = True
except Exception as e:
    print(f"Warning: Khong the ket noi {target_port}: {e}. Chay che do Mo phong (Simulation Mode).")
    ser = None
    arduino_connected = False

last_arduino_check_time = 0

# ====================================================================
# 2. KHỞI TẠO AI GESTURE RECOGNIZER & FACE RECOGNIZER
# ====================================================================
model_path = os.path.join(os.path.dirname(__file__), 'gesture_recognizer.task')
base_options = python.BaseOptions(model_asset_path=model_path)
options = vision.GestureRecognizerOptions(
    base_options=base_options,
    min_hand_detection_confidence=0.65,
    min_hand_presence_confidence=0.65,
    min_tracking_confidence=0.65
)
recognizer = vision.GestureRecognizer.create_from_options(options)

# Khởi tạo Deep Learning Face Detector (YuNet ONNX) & Face Embeddings (SFace ONNX 128-D)
yunet_path = os.path.join(os.path.dirname(__file__), 'face_detection_yunet_2023mar.onnx')
sface_path = os.path.join(os.path.dirname(__file__), 'face_recognition_sface_2021dec.onnx')
embeddings_path = os.path.join(os.path.dirname(__file__), 'owner_embeddings.npz')

face_detector = None
face_recognizer = None
owner_embeddings = {}
owner_model_loaded = False

try:
    if os.path.exists(yunet_path) and os.path.exists(sface_path):
        face_detector = cv2.FaceDetectorYN.create(yunet_path, "", (640, 360), 0.55, 0.3)
        face_recognizer = cv2.FaceRecognizerSF.create(sface_path, "")
        
        if os.path.exists(embeddings_path):
            data = np.load(embeddings_path)
            for k in data.files:
                bank = data[k]
                owner_embeddings[k] = bank / np.linalg.norm(bank, axis=1, keepdims=True)
            owner_model_loaded = True
            print(f"Da tai mo hinh Deep Learning SFace thanh cong! Danh sach chu nha: {[k.upper() for k in owner_embeddings.keys()]}")
        else:
            print("CHUA CO DU LIEU CHU NHA: Vui long chay file DANG_KY_CHU_NHA.bat tren Desktop.")
    else:
        print("CHUA CO FILE ONNX: Dang thieu face_detection_yunet hoac face_recognition_sface.")
except Exception as e:
    print(f"Loi khi khoi tao Deep Learning Face ID: {e}")

detected_owner_name = "THIÊN"

# ====================================================================
# 3. THIẾT LẬP CAMERA (CHUẨN TỈ LỆ 16:9 - 30 FPS KHÔNG BỊ KÉO GIÃN)
# ====================================================================
cap = cv2.VideoCapture(0, cv2.CAP_DSHOW) # DSHOW giup camera Windows dat FPS cao nhat
cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 360) # Chuan 16:9 goc (640x360) khong bi bẹp/kéo giãn
cap.set(cv2.CAP_PROP_FPS, 30)

# Khớp xương bàn tay theo chuẩn MediaPipe (21 landmarks)
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),        # Ngón cái
    (0, 5), (5, 6), (6, 7), (7, 8),        # Ngón trỏ
    (5, 9), (9, 10), (10, 11), (11, 12),   # Ngón giữa
    (9, 13), (13, 14), (14, 15), (15, 16), # Ngón áp út
    (13, 17), (17, 18), (18, 19), (19, 20),# Ngón út
    (0, 17)                                # Cổ tay
]

# Ánh xạ tên cử chỉ sang tiếng Việt có dấu
GESTURE_VN_MAP = {
    "Pointing_Up": "1 Ngón trỏ (Đèn)",
    "Victory": "2 Ngón chữ V (Mở / Đóng cửa)",
    "Three_Fingers": "3 Ngón tay (Rèm)",
    "Open_Palm": "Xòe 5 ngón (Quạt)",
    "OK_SIGN": "Dấu OK (Tivi)",
    "Closed_Fist": "Nắm đấm (Tắt hết)",
    "None": "Không rõ"
}

# Danh mục cử chỉ & tính năng Face ID (Quy ước: Ký hiệu = Lòng tay, Nắm đấm = Tắt hết)
GESTURE_LIST = [
    {"key": "Pointing_Up",  "icon": "[1]",   "title": "1 ngón trỏ (Lòng tay)",   "desc": "Bật đèn chiếu sáng",        "cmd": "A"},
    {"key": "Victory",      "icon": "[V]",   "title": "2 ngón chữ V (Mở/Đóng)",  "desc": "Mở / Đóng cửa chính (90°/0°)", "cmd": "O"},
    {"key": "Three_Fingers","icon": "[3]",   "title": "3 ngón tay (Lòng tay)",   "desc": "Kéo / Hạ rèm cửa (90°/0°)", "cmd": "U/D"},
    {"key": "Open_Palm",    "icon": "[5]",   "title": "Xòe 5 ngón (Lòng tay)",   "desc": "Bật / Tắt quạt làm mát",     "cmd": "F"},
    {"key": "OK_SIGN",      "icon": "[OK]",  "title": "Dấu OK (Lòng bàn tay)",   "desc": "Bật / Tắt Tivi LCD",         "cmd": "T"},
    {"key": "Closed_Fist",  "icon": "[FIST]","title": "Nắm đấm (Tắt hết)",       "desc": "Tắt toàn bộ thiết bị",       "cmd": "B"},
    {"key": "FACE_AI",      "icon": "[FACE]","title": "Nhận diện khuôn mặt",    "desc": "Thiên: Mở cửa | Lạ: Hú còi", "cmd": "AUTO"}
]

# Trạng thái thiết bị hiển thị trên giao diện HUD
device_status = {
    "Den": "OFF",
    "Cua": "CLOSE",
    "Rem": "DOWN",
    "Quat": "OFF",
    "TV": "OFF",
    "Security": "STANDBY" # STANDBY, OWNER_VERIFIED, STRANGER_ALERT
}

# Quản lý cử chỉ tay (Chống nhảy loạn khi chuyển tay & Thực hiện 1 lần duy nhất)
candidate_gesture = None
candidate_start_time = 0
last_executed_gesture = None
last_action_time = 0
last_hand_seen_time = time.time()
latched_gesture = None
unlatch_time = 0
tv_is_on = False
door_is_open = False

# Quản lý nhận diện khuôn mặt
last_face_time = 0
last_face_action_time = 0
face_debounce = 3.5 # Sau 3.5s moi mo lai cua de tranh spam
current_face_status = "NONE" # NONE, OWNER, STRANGER
recent_confs = [] # Hàng đợi làm mượt điểm số khuôn mặt
alarm_active = False # Trạng thái còi hú trên Arduino

# Nút Bật/Tắt Quét Mặt (Mặc định khi mở app là TẮT theo yêu cầu của bạn)
face_scan_enabled = False
btn_scan_rect = (0, 0, 0, 0)

# Toast Notification
toast_message = ""
toast_time = 0

# Tối ưu đo lường FPS
fps_time = time.time()
frame_count = 0
display_fps = 30

# ====================================================================
# ĐỊNH NGHĨA 3 GIAO DIỆN & CƠ CHẾ CHUYỂN CẢNH MƯỢT MÀ (STATE MACHINE)
# ====================================================================
STATE_FACE_GATE       = "FACE_GATE"       # Giao diện 1: Cổng quét mặt an ninh ban đầu
STATE_HOME_DASHBOARD  = "HOME_DASHBOARD"  # Giao diện 2: Điều khiển thiết bị bằng cử chỉ tay
STATE_SECURITY_ALARM  = "SECURITY_ALARM"  # Giao diện 3: Cảnh báo đỏ báo động chống trộm

# Mặc định khi chạy file BAT: Mở Cổng An Ninh ở chế độ sẵn sàng (có nút bấm BẬT QUÉT MẶT)
current_app_state = STATE_FACE_GATE
is_transitioning = False
transition_start_time = 0.0
transition_from_state = None
transition_prev_frame = None
transition_duration = 0.60 # Thời gian chuyển cảnh hòa trộn 0.6 giây mượt mà

# Các biến điều khiển Giao diện 1 (Cổng quét mặt)
gate_scanning = False # Chỉ khi bấm nút Bật hoặc phím Space thì mới bắt đầu quét mặt
GATE_DURATION = 3.0   # Quét tập trung trong 3.0 giây là đủ chính xác và mượt mà
gate_start_time = 0.0
gate_green_frames = 0
gate_red_frames = 0
gate_laser_y = 150
gate_laser_dir = 1

# Tọa độ các nút bấm tương tác
btn_exit_rect      = (0, 0, 0, 0)
btn_gate_scan_rect = (0, 0, 0, 0) # Nút Bật Quét Mặt ở Giao diện 1
btn_lock_rect      = (0, 0, 0, 0) # Nút Khóa Nhà ở Giao diện 2
btn_rescan_rect    = (0, 0, 0, 0) # Nút Tắt Còi & Quét Lại ở Giao diện 3
exit_requested     = False
last_rendered_frame = None

def start_face_scan():
    """Kích hoạt quét mặt an ninh khi người dùng bấm nút"""
    global gate_scanning, gate_start_time, gate_green_frames, gate_red_frames, recent_confs, toast_message, toast_time
    gate_scanning = True
    gate_start_time = time.time()
    gate_green_frames = 0
    gate_red_frames = 0
    recent_confs.clear()
    toast_message = "ĐANG QUÉT MẶT XÁC THỰC DANH TÍNH..."
    toast_time = time.time()
    print("[AN NINH] Nguoi dung da bam NUT BAT QUET MAT!")

def reset_face_gate():
    """Khởi động lại Cổng Quét Mặt về trạng thái chờ sẵn sàng"""
    global gate_scanning, gate_start_time, gate_green_frames, gate_red_frames, recent_confs
    gate_scanning = False
    gate_start_time = 0.0
    gate_green_frames = 0
    gate_red_frames = 0
    recent_confs.clear()

def switch_state(target_state, current_frame):
    """Kích hoạt hiệu ứng chuyển cảnh mượt mà giữa các giao diện"""
    global current_app_state, is_transitioning, transition_start_time, transition_from_state, transition_prev_frame
    if current_app_state != target_state:
        transition_from_state = current_app_state
        current_app_state = target_state
        is_transitioning = True
        transition_start_time = time.time()
        if current_frame is not None:
            transition_prev_frame = current_frame.copy()

def mouse_click(event, x, y, flags, param):
    global exit_requested, current_app_state, alarm_active, door_is_open, toast_message, toast_time
    if event == cv2.EVENT_LBUTTONDOWN:
        # Nút Thoát chung cho cả 3 giao diện
        bx1, by1, bx2, by2 = btn_exit_rect
        if bx1 <= x <= bx2 and by1 <= y <= by2:
            exit_requested = True
            return

        # Ở Giao diện 1 (FACE_GATE): Nút [ BẬT QUÉT MẶT ]
        if current_app_state == STATE_FACE_GATE and not gate_scanning:
            gx1, gy1, gx2, gy2 = btn_gate_scan_rect
            if gx1 <= x <= gx2 and gy1 <= y <= gy2:
                start_face_scan()
                return

        # Ở Giao diện 2 (HOME_DASHBOARD): Nút [ KHÓA NHÀ & QUÉT MẶT ]
        elif current_app_state == STATE_HOME_DASHBOARD:
            lx1, ly1, lx2, ly2 = btn_lock_rect
            if lx1 <= x <= lx2 and ly1 <= y <= ly2:
                if ser:
                    try:
                        ser.write(b'C')
                        ser.flush()
                        time.sleep(0.01)
                        if ser.in_waiting > 0:
                            ser.read(ser.in_waiting)
                    except Exception: pass
                door_is_open = False
                device_status["Cua"] = "CLOSE"
                device_status["Security"] = "STANDBY"
                latched_gesture = None
                unlatch_time = 0
                toast_message = "ĐÃ KHÓA NHÀ! SẴN SÀNG QUÉT MẶT"
                toast_time = time.time()
                reset_face_gate()
                switch_state(STATE_FACE_GATE, last_rendered_frame)
                return

        # Ở Giao diện 3 (SECURITY_ALARM): Nút [ QUÉT LẠI MẶT ĐỂ TẮT CÒI ]
        elif current_app_state == STATE_SECURITY_ALARM:
            rx1, ry1, rx2, ry2 = btn_rescan_rect
            if rx1 <= x <= rx2 and ry1 <= y <= ry2:
                if ser:
                    try: ser.write(b'C')
                    except Exception: pass
                alarm_active = False
                device_status["Security"] = "STANDBY"
                toast_message = "ĐÃ TẮT CÒI TẠM THỜI! CHỜ BẤM QUÉT LẠI"
                toast_time = time.time()
                reset_face_gate()
                switch_state(STATE_FACE_GATE, last_rendered_frame)
                return

cv2.namedWindow("Smart Home AI Dashboard")
ret, initial_frame = cap.read()
if ret:
    cv2.setMouseCallback("Smart Home AI Dashboard", mouse_click)

# ====================================================================
# 4. HỆ THỐNG VẼ GIAO DIỆN & TIẾNG VIỆT CÓ DẤU (HUD & SEGOE UI)
# ====================================================================
_FONT_CACHE = {}

def get_font(size, bold=False):
    key = (size, bold)
    if key not in _FONT_CACHE:
        font_path = "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"
        if not os.path.exists(font_path):
            font_path = "arialbd.ttf" if bold else "arial.ttf"
        try:
            _FONT_CACHE[key] = ImageFont.truetype(font_path, size)
        except Exception:
            _FONT_CACHE[key] = ImageFont.load_default()
    return _FONT_CACHE[key]

# Hàng đợi vẽ chữ tiếng Việt có dấu trong 1 frame
text_render_queue = []

def draw_vn_text(text, x, y, size=14, color=(255, 255, 255), bold=False, anchor_rect=None):
    """
    Hỗ trợ hiển thị tiếng Việt có dấu cực đẹp và sắc nét với font Segoe UI.
    color: tuple (B, G, R) theo chuẩn OpenCV
    anchor_rect: (x1, y1, x2, y2) nếu muốn tự động căn giữa vào khối badge/button
    """
    global text_render_queue
    text_render_queue.append({
        "text": str(text),
        "x": int(x),
        "y": int(y),
        "size": int(size),
        "color": color,
        "bold": bold,
        "anchor_rect": anchor_rect
    })

def flush_vn_text(frame):
    """
    Chuyển đổi 1 lần duy nhất sang PIL để vẽ toàn bộ tiếng Việt có dấu lên frame,
    đảm bảo không rớt FPS (đạt 30 FPS mượt mà).
    """
    global text_render_queue
    if not text_render_queue:
        return frame
        
    pil_img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil_img)
    
    for item in text_render_queue:
        font = get_font(item["size"], item["bold"])
        bgr = item["color"]
        rgb = (bgr[2], bgr[1], bgr[0]) # Đổi BGR sang RGB
        
        rect = item["anchor_rect"]
        if rect:
            rx1, ry1, rx2, ry2 = rect
            bbox = font.getbbox(item["text"])
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            cx = rx1 + (rx2 - rx1 - tw) // 2 - bbox[0]
            cy = ry1 + (ry2 - ry1 - th) // 2 - bbox[1]
            draw.text((cx, cy), item["text"], font=font, fill=rgb)
        else:
            draw.text((item["x"], item["y"]), item["text"], font=font, fill=rgb)
            
    text_render_queue.clear()
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

def draw_rounded_rect(img, top_left, bottom_right, color, thickness=-1, radius=10):
    x1, y1 = top_left
    x2, y2 = bottom_right
    if thickness == -1:
        cv2.rectangle(img, (x1 + radius, y1), (x2 - radius, y2), color, -1)
        cv2.rectangle(img, (x1, y1 + radius), (x2, y2 - radius), color, -1)
        cv2.circle(img, (x1 + radius, y1 + radius), radius, color, -1)
        cv2.circle(img, (x2 - radius, y1 + radius), radius, color, -1)
        cv2.circle(img, (x1 + radius, y2 - radius), radius, color, -1)
        cv2.circle(img, (x2 - radius, y2 - radius), radius, color, -1)
    else:
        cv2.line(img, (x1 + radius, y1), (x2 - radius, y1), color, thickness, cv2.LINE_AA)
        cv2.line(img, (x1 + radius, y2), (x2 - radius, y2), color, thickness, cv2.LINE_AA)
        cv2.line(img, (x1, y1 + radius), (x1, y2 - radius), color, thickness, cv2.LINE_AA)
        cv2.line(img, (x2, y1 + radius), (x2, y2 - radius), color, thickness, cv2.LINE_AA)
        cv2.ellipse(img, (x1 + radius, y1 + radius), (radius, radius), 180, 0, 90, color, thickness, cv2.LINE_AA)
        cv2.ellipse(img, (x2 - radius, y1 + radius), (radius, radius), 270, 0, 90, color, thickness, cv2.LINE_AA)
        cv2.ellipse(img, (x1 + radius, y2 - radius), (radius, radius), 90, 0, 90, color, thickness, cv2.LINE_AA)
        cv2.ellipse(img, (x2 - radius, y2 - radius), (radius, radius), 0, 0, 90, color, thickness, cv2.LINE_AA)

def draw_hud_brackets(img, x1, y1, x2, y2, color=(0, 240, 255), length=18, thickness=2):
    cv2.line(img, (x1, y1), (x1 + length, y1), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x1, y1), (x1, y1 + length), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x2, y1), (x2 - length, y1), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x2, y1), (x2, y1 + length), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x1, y2), (x1 + length, y2), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x1, y2), (x1, y2 - length), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x2, y2), (x2 - length, y2), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x2, y2), (x2, y2 - length), color, thickness, cv2.LINE_AA)

def get_distance(lm1, lm2, frame_w, frame_h):
    x1, y1 = int(lm1.x * frame_w), int(lm1.y * frame_h)
    x2, y2 = int(lm2.x * frame_w), int(lm2.y * frame_h)
    return math.hypot(x2 - x1, y2 - y1)

def check_hand_facing(landmarks, hand_label):
    """
    Xác định mặt bàn tay đang quay về phía camera:
    - 'PALM': Mặt lòng bàn tay quay về camera (ngửa bàn tay như ảnh mẫu 2 của người dùng)
    - 'BACK': Mặt mu bàn tay quay về camera (sấp bàn tay)
    - 'EDGE': Bàn tay dựng nghiêng mép cạnh
    """
    # Điểm 0: Cổ tay (Wrist)
    # Điểm 5: Khớp gốc ngón trỏ (Index MCP)
    # Điểm 17: Khớp gốc ngón út (Pinky MCP)
    v1_x = landmarks[5].x - landmarks[0].x
    v1_y = landmarks[5].y - landmarks[0].y
    
    v2_x = landmarks[17].x - landmarks[0].x
    v2_y = landmarks[17].y - landmarks[0].y
    
    # Tích có hướng 2D trên không gian ảnh mirror (cv2.flip)
    cross_z = (v1_x * v2_y) - (v1_y * v2_x)
    
    if abs(cross_z) < 0.002:
        return "EDGE"
        
    # Trên ảnh mirror (cv2.flip):
    # Khi giơ lòng bàn tay về camera như ảnh 2:
    # - MediaPipe gắn nhãn 'Left' (tay trái trên màn hình): cross_z > 0
    # - MediaPipe gắn nhãn 'Right' (tay phải trên màn hình): cross_z < 0
    if hand_label == "Left":
        return "PALM" if cross_z > 0 else "BACK"
    else:
        return "PALM" if cross_z < 0 else "BACK"

def get_anatomical_gesture(landmarks, w, h):
    """
    Phân loại cử chỉ theo hình học giải phẫu 21 khớp xương:
    - 1 ngón trỏ: Bật đèn chiếu sáng (Pointing_Up)
    - 2 ngón chữ V: Mở cửa chính (Victory)
    - 3 ngón tay (trỏ, giữa, áp út): Kéo rèm cửa lên (Three_Fingers)
    - Xòe 5 ngón: Bật / Tắt quạt làm mát (Open_Palm)
    - Dấu OK: Bật / Tắt Tivi LCD (OK_SIGN)
    - Nắm đấm: Tắt toàn bộ thiết bị (Closed_Fist - ảnh mẫu 3)
    """
    p0 = landmarks[0]
    p9 = landmarks[9]
    palm_len = math.hypot(p9.x - p0.x, p9.y - p0.y)
    palm_len_px = palm_len * h
    # Bàn tay người thật khi đưa lên điều khiển luôn có chiều dài lòng bàn tay >= 35px
    if palm_len < 0.01 or palm_len_px < 35:
        return "None"
        
    ext_idx = math.hypot(landmarks[8].x - p0.x, landmarks[8].y - p0.y) > 1.25 * palm_len
    ext_mid = math.hypot(landmarks[12].x - p0.x, landmarks[12].y - p0.y) > 1.25 * palm_len
    ext_ring = math.hypot(landmarks[16].x - p0.x, landmarks[16].y - p0.y) > 1.35 * palm_len
    ext_pinky = math.hypot(landmarks[20].x - p0.x, landmarks[20].y - p0.y) > 1.35 * palm_len
    
    dist_ok = get_distance(landmarks[4], landmarks[8], w, h)
    
    # 1. Dấu OK: Ngón cái chạm ngón trỏ, các ngón còn lại (ngón giữa & ngón áp út) duỗi thẳng -> BẬT/TẮT TIVI
    if dist_ok < 45 and ext_mid and ext_ring:
        return "OK_SIGN"
        
    # 2. 1 ngón trỏ duỗi, các ngón còn lại gập -> BẬT ĐÈN
    if ext_idx and not ext_mid and not ext_ring and not ext_pinky:
        return "Pointing_Up"

    # 3. 2 ngón (trỏ & giữa duỗi, áp út & út gập) -> MỞ / ĐÓNG CỬA (90° / 0°)
    if ext_idx and ext_mid and not ext_ring and not ext_pinky:
        return "Victory"
        
    # 4. 3 ngón (trỏ, giữa, áp út duỗi, út gập) -> KÉO RÈM CỬA LÊN
    if ext_idx and ext_mid and ext_ring and not ext_pinky:
        return "Three_Fingers"
        
    # 5. Xòe bàn tay (cả 4 ngón đều duỗi) -> BẬT / TẮT QUẠT
    if ext_idx and ext_mid and ext_ring and ext_pinky:
        return "Open_Palm"
        
    # 6. Nắm đấm (cả 4 ngón đều gập - ảnh 3) -> TẮT TOÀN BỘ THIẾT BỊ
    if not ext_idx and not ext_mid and not ext_ring and not ext_pinky:
        return "Closed_Fist"
        
    return "None"



# ====================================================================
# 5. HÀM RENDER 3 GIAO DIỆN (FACE GATE, DASHBOARD, SECURITY ALARM)
# ====================================================================

# --------------------------------------------------------------------
# GIAO DIỆN 1: CỔNG QUÉT MẶT AN NINH SINH TRẮC HỌC (FACE GATE UI)
# --------------------------------------------------------------------
def render_face_gate_ui(img, current_fps, is_scanning, time_rem, total_time, green_cnt, red_cnt, detected_faces, is_owner, conf_score, owner_name="THIÊN"):
    global btn_exit_rect, btn_gate_scan_rect, gate_laser_y, gate_laser_dir
    h, w, _ = img.shape
    overlay = img.copy()

    C_NAVY_BG     = (32, 22, 14)
    C_CYAN        = (255, 230, 0)
    C_GREEN       = (70, 220, 30)
    C_YELLOW      = (30, 215, 255)
    C_RED         = (50, 50, 240)
    C_WHITE       = (255, 255, 255)
    C_TEXT_DIM    = (180, 180, 180)

    # 1. TOP HEADER BAR
    draw_rounded_rect(overlay, (20, 12), (w - 20, 68), C_NAVY_BG, -1, 14)
    draw_rounded_rect(overlay, (20, 12), (w - 20, 68), C_CYAN, 1, 14)

    img = cv2.addWeighted(overlay, 0.78, img, 0.22, 0)

    # Header Texts
    draw_vn_text("CỔNG AN NINH SINH TRẮC HỌC AI", 38, 24, size=18, color=C_CYAN, bold=True)
    mode_desc = "| ĐANG QUÉT MẶT XÁC THỰC DANH TÍNH" if is_scanning else "| CHẾ ĐỘ CHỜ: BẤM NÚT ĐỂ BẬT QUÉT MẶT"
    draw_vn_text(mode_desc, 345, 30, size=13, color=C_TEXT_DIM, bold=False)

    dot_color = C_GREEN if arduino_connected else (50, 160, 240)
    cv2.circle(img, (740, 40), 5, dot_color, -1, cv2.LINE_AA)
    conn_text = f"ARDUINO: {target_port}" if arduino_connected else "ARDUINO: MÔ PHỎNG"
    draw_vn_text(conn_text, 752, 29, size=13, color=dot_color, bold=True)

    now_str = datetime.now().strftime("%H:%M:%S")
    draw_vn_text(f"GIỜ: {now_str}  |  FPS: {current_fps}", 920, 29, size=13, color=C_TEXT_DIM, bold=False)

    # Nút Thoát
    ex1, ey1 = w - 165, 18
    ex2, ey2 = w - 35, 62
    btn_exit_rect = (ex1, ey1, ex2, ey2)
    draw_rounded_rect(img, (ex1, ey1), (ex2, ey2), (40, 30, 180), -1, 8)
    draw_rounded_rect(img, (ex1, ey1), (ex2, ey2), C_RED, 1, 8)
    draw_vn_text("[X] THOÁT", 0, 0, size=14, color=C_WHITE, bold=True, anchor_rect=(ex1, ey1, ex2, ey2))

    # -------------------------------------------------------------
    # TRƯỜNG HỢP 1: CHẾ ĐỘ CHỜ (STANDBY - CHƯA BẬT QUÉT MẶT)
    # -------------------------------------------------------------
    if not is_scanning:
        # Khung viền ngắm trung tâm (Target Reticle)
        cx, cy = w // 2, (h // 2) - 40
        box_w, box_h = 320, 340
        rx1, ry1 = cx - box_w // 2, cy - box_h // 2
        rx2, ry2 = cx + box_w // 2, cy + box_h // 2
        draw_hud_brackets(img, rx1, ry1, rx2, ry2, C_CYAN, 35, 2)
        cv2.circle(img, (cx, cy), 6, C_CYAN, -1, cv2.LINE_AA)
        
        # Nếu có mặt thì vẽ khung ngắm màu vàng hỗ trợ căn chỉnh
        if len(detected_faces) > 0:
            (fx, fy, fw, fh) = detected_faces[0]
            draw_hud_brackets(img, fx - 4, fy - 4, fx + fw + 4, fy + fh + 4, C_YELLOW, 22, 2)
            cv2.rectangle(img, (fx, fy), (fx + fw, fy + fh), (60, 45, 25), 1, cv2.LINE_AA)

        # NÚT BẬT QUÉT MẶT AN NINH (LỚN, NỔI BẬT Ở ĐÁY MÀN HÌNH)
        pulse = (int(time.time() * 2.5) % 2 == 0)
        btn_w, btn_h = 620, 58
        bx1 = (w - btn_w) // 2
        by1 = h - 145
        bx2 = bx1 + btn_w
        by2 = by1 + btn_h
        btn_gate_scan_rect = (bx1, by1, bx2, by2)

        btn_bg = (35, 80, 25) if pulse else (20, 60, 20)
        btn_border = C_GREEN if pulse else (50, 180, 25)
        draw_rounded_rect(img, (bx1, by1), (bx2, by2), btn_bg, -1, 12)
        draw_rounded_rect(img, (bx1, by1), (bx2, by2), btn_border, 2, 12)
        draw_vn_text("[ ⚡ BẬT QUÉT MẶT AN NINH (HOẶC NHẤN SPACE) ⚡ ]", 0, 0, size=16, color=C_WHITE, bold=True, anchor_rect=(bx1, by1, bx2, by2))

        # Thanh hướng dẫn quy trình bên dưới
        pw, ph = 820, 40
        px1 = (w - pw) // 2
        py1 = by2 + 10
        px2 = px1 + pw
        py2 = py1 + ph
        draw_rounded_rect(img, (px1, py1), (px2, py2), (25, 20, 15), -1, 8)
        draw_rounded_rect(img, (px1, py1), (px2, py2), (60, 50, 40), 1, 8)
        draw_vn_text("QUY TRÌNH: ĐỨNG TRƯỚC CAMERA -> BẤM NÚT BẬT QUÉT -> CHỦ NHÀ MỞ CỬA, KHÁCH HÚ CÒI", 0, 0, size=13, color=C_CYAN, bold=False, anchor_rect=(px1, py1, px2, py2))

        return img

    # -------------------------------------------------------------
    # TRƯỜNG HỢP 2: ĐANG TRONG TIẾN TRÌNH QUÉT MẶT (ACTIVE SCANNING)
    # -------------------------------------------------------------
    btn_gate_scan_rect = (0, 0, 0, 0) # Vô hiệu hóa nút khi đang quét

    # Tia Laser quét sinh trắc học di chuyển mềm mại
    gate_laser_y += 7 * gate_laser_dir
    if gate_laser_y > h - 165:
        gate_laser_dir = -1
    elif gate_laser_y < 85:
        gate_laser_dir = 1
    
    cv2.line(img, (120, gate_laser_y), (w - 120, gate_laser_y), (0, 240, 255), 2, cv2.LINE_AA)
    cv2.line(img, (120, gate_laser_y - 1), (w - 120, gate_laser_y - 1), (255, 255, 255), 1, cv2.LINE_AA)

    # Hiển thị Khung nhận diện khuôn mặt
    if len(detected_faces) > 0:
        (fx, fy, fw, fh) = detected_faces[0]
        color_face = C_GREEN if is_owner else C_RED
        banner_bg = (20, 140, 20) if is_owner else (0, 0, 220)
        banner_title = f"CHỦ NHÀ: {owner_name} (Khớp: {conf_score})" if is_owner else f"CẢNH BÁO: NGƯỜI LẠ ! (Khớp: {conf_score})"
        sub_tag = "[ ĐANG TÍCH LŨY MẪU HỢP LỆ ]" if is_owner else "[ CẢNH BÁO: ĐỐI TƯỢNG BẤT THƯỜNG ]"

        cv2.rectangle(img, (fx, fy), (fx + fw, fy + fh), color_face, 3, cv2.LINE_AA)
        draw_hud_brackets(img, fx - 4, fy - 4, fx + fw + 4, fy + fh + 4, color_face, 26, 3)

        bw_box = fw
        bh_box = 30
        by1_box = max(10, fy - bh_box)
        by2_box = by1_box + bh_box
        cv2.rectangle(img, (fx, by1_box), (fx + bw_box, by2_box), banner_bg, -1)
        cv2.rectangle(img, (fx, by1_box), (fx + bw_box, by2_box), color_face, 1)
        draw_vn_text(banner_title, 0, 0, size=13, color=C_WHITE, bold=True, anchor_rect=(fx, by1_box, fx + bw_box, by2_box))

        cv2.rectangle(img, (fx, fy + fh), (fx + bw_box, fy + fh + 24), (25, 20, 15), -1)
        cv2.rectangle(img, (fx, fy + fh), (fx + bw_box, fy + fh + 24), color_face, 1)
        draw_vn_text(sub_tag, 0, 0, size=12, color=color_face, bold=True, anchor_rect=(fx, fy + fh, fx + bw_box, fy + fh + 24))
    else:
        # Nếu chưa thấy mặt: hiển thị hướng dẫn
        tw = 520
        tx1 = (w - tw) // 2
        ty1 = (h // 2) - 30
        draw_rounded_rect(img, (tx1, ty1), (tx1 + tw, ty1 + 50), (25, 20, 15), -1, 10)
        draw_rounded_rect(img, (tx1, ty1), (tx1 + tw, ty1 + 50), C_YELLOW, 1, 10)
        draw_vn_text("VUI LÒNG ĐỨNG THẲNG TRƯỚC CAMERA ĐỂ QUÉT MẶT...", 0, 0, size=14, color=C_YELLOW, bold=True, anchor_rect=(tx1, ty1, tx1 + tw, ty1 + 50))

    # BẢNG PHÂN TÍCH ĐÁY (ĐẾM NGƯỢC & MẪU XANH / ĐỎ)
    bw = 780
    bx1 = (w - bw) // 2
    by1 = h - 145
    bx2 = bx1 + bw
    by2 = h - 18
    overlay_bot = img.copy()
    draw_rounded_rect(overlay_bot, (bx1, by1), (bx2, by2), C_NAVY_BG, -1, 16)
    draw_rounded_rect(overlay_bot, (bx1, by1), (bx2, by2), (80, 60, 40), 1, 16)
    img = cv2.addWeighted(overlay_bot, 0.78, img, 0.22, 0)

    progress = max(0.0, min(1.0, (total_time - time_rem) / total_time)) if total_time > 0 else 0.0
    
    # Progress Bar đếm ngược
    pb_x1 = bx1 + 30
    pb_y1 = by1 + 16
    pb_x2 = bx2 - 30
    pb_y2 = pb_y1 + 26
    draw_rounded_rect(img, (pb_x1, pb_y1), (pb_x2, pb_y2), (40, 30, 20), -1, 6)
    fill_w = int((pb_x2 - pb_x1) * progress)
    if fill_w > 0:
        bar_color = C_GREEN if green_cnt > red_cnt else (50, 180, 255)
        draw_rounded_rect(img, (pb_x1, pb_y1), (pb_x1 + fill_w, pb_y2), bar_color, -1, 6)
    draw_rounded_rect(img, (pb_x1, pb_y1), (pb_x2, pb_y2), C_CYAN, 1, 6)
    
    pb_text = f"ĐANG XÁC THỰC DANH TÍNH: CÒN {time_rem:.1f}s / {total_time:.0f}s ({int(progress * 100)}%)"
    draw_vn_text(pb_text, 0, 0, size=13, color=C_WHITE, bold=True, anchor_rect=(pb_x1, pb_y1, pb_x2, pb_y2))

    # Các thẻ thống kê khung hình Xanh / Đỏ
    c_y1 = by1 + 54
    c_y2 = by2 - 14
    
    # Thẻ 1: Khung xanh (Chủ nhà)
    card1_x1 = pb_x1
    card1_x2 = pb_x1 + 225
    draw_rounded_rect(img, (card1_x1, c_y1), (card1_x2, c_y2), (20, 60, 25), -1, 8)
    draw_rounded_rect(img, (card1_x1, c_y1), (card1_x2, c_y2), C_GREEN, 1, 8)
    draw_vn_text(f"CHỦ NHÀ (KHUNG XANH): {green_cnt}", 0, 0, size=13, color=C_GREEN, bold=True, anchor_rect=(card1_x1, c_y1, card1_x2, c_y2))

    # Thẻ 2: Khung đỏ (Người lạ)
    card2_x1 = card1_x2 + 15
    card2_x2 = card2_x1 + 225
    draw_rounded_rect(img, (card2_x1, c_y1), (card2_x2, c_y2), (30, 20, 60), -1, 8)
    draw_rounded_rect(img, (card2_x1, c_y1), (card2_x2, c_y2), C_RED, 1, 8)
    draw_vn_text(f"NGƯỜI LẠ (KHUNG ĐỎ): {red_cnt}", 0, 0, size=13, color=(80, 100, 255), bold=True, anchor_rect=(card2_x1, c_y1, card2_x2, c_y2))

    # Thẻ 3: Đánh giá thời gian thực
    card3_x1 = card2_x2 + 15
    card3_x2 = pb_x2
    if green_cnt >= 4 and green_cnt > red_cnt:
        status_text = f"DỰ KIẾN: CHỦ NHÀ {owner_name} (MỞ CỬA)"
        st_color = C_GREEN
        st_bg = (20, 80, 25)
    elif red_cnt >= 4 and red_cnt > green_cnt:
        status_text = "DỰ KIẾN: NGƯỜI LẠ (BÁO ĐỘNG)"
        st_color = C_RED
        st_bg = (20, 20, 80)
    else:
        status_text = "ĐANG PHÂN TÍCH KHUÔN MẶT..."
        st_color = C_YELLOW
        st_bg = (30, 30, 40)
        
    draw_rounded_rect(img, (card3_x1, c_y1), (card3_x2, c_y2), st_bg, -1, 8)
    draw_rounded_rect(img, (card3_x1, c_y1), (card3_x2, c_y2), st_color, 1, 8)
    draw_vn_text(status_text, 0, 0, size=13, color=st_color, bold=True, anchor_rect=(card3_x1, c_y1, card3_x2, c_y2))

    return img


# --------------------------------------------------------------------
# GIAO DIỆN 2: ĐIỀU KHIỂN THIẾT BỊ BẰNG CỬ CHỈ (HOME DASHBOARD UI)
# --------------------------------------------------------------------
def render_cyberpunk_dashboard(img, status_dict, active_gesture, current_fps, face_tag):
    global btn_exit_rect, btn_lock_rect
    h, w, _ = img.shape
    overlay = img.copy()

    # Bảng màu BGR chuẩn Sci-Fi
    C_NAVY_BG     = (32, 22, 14)
    C_CARD_BG     = (45, 30, 20)
    C_ACTIVE_BG   = (60, 45, 25)
    C_CYAN        = (255, 230, 0)
    C_GREEN       = (70, 220, 30)
    C_YELLOW      = (30, 215, 255)
    C_RED         = (50, 50, 240)
    C_PURPLE      = (220, 80, 180)
    C_WHITE       = (255, 255, 255)
    C_TEXT_DIM    = (180, 180, 180)
    
    # 1. TOP HEADER BAR
    draw_rounded_rect(overlay, (20, 12), (w - 20, 68), C_NAVY_BG, -1, 14)
    draw_rounded_rect(overlay, (20, 12), (w - 20, 68), C_CYAN, 1, 14)
    
    # 2. PANEL TRÁI: MENU CỬ CHỈ BÀN TAY
    p_left_w = 325
    draw_rounded_rect(overlay, (20, 80), (p_left_w, h - 20), C_NAVY_BG, -1, 16)
    draw_rounded_rect(overlay, (20, 80), (p_left_w, h - 20), (80, 60, 40), 1, 16)

    # 3. PANEL PHẢI: TRẠNG THÁI THIẾT BỊ
    p_right_w = 310
    draw_rounded_rect(overlay, (w - p_right_w, 80), (w - 20, h - 20), C_NAVY_BG, -1, 16)
    draw_rounded_rect(overlay, (w - p_right_w, 80), (w - 20, h - 20), (80, 60, 40), 1, 16)

    img = cv2.addWeighted(overlay, 0.78, img, 0.22, 0)

    # Header Texts
    draw_vn_text("SMART HOME AI", 38, 24, size=20, color=C_CYAN, bold=True)
    draw_vn_text("| ĐIỀU KHIỂN THIẾT BỊ BẰNG CỬ CHỈ TAY", 216, 30, size=13, color=C_TEXT_DIM, bold=False)
    
    dot_color = C_GREEN if arduino_connected else (50, 160, 240)
    cv2.circle(img, (485, 40), 5, dot_color, -1, cv2.LINE_AA)
    conn_text = f"ARDUINO: {target_port}" if arduino_connected else "ARDUINO: MÔ PHỎNG"
    draw_vn_text(conn_text, 498, 29, size=13, color=dot_color, bold=True)
    
    now_str = datetime.now().strftime("%H:%M:%S")
    draw_vn_text(f"GIỜ: {now_str}  |  FPS: {current_fps}", 668, 29, size=13, color=C_TEXT_DIM, bold=False)

    # Nút [ KHÓA NHÀ & QUÉT MẶT ] (Chuyển mượt về Giao diện 1)
    sx1, sy1 = w - 410, 18
    sx2, sy2 = w - 180, 62
    btn_lock_rect = (sx1, sy1, sx2, sy2)
    draw_rounded_rect(img, (sx1, sy1), (sx2, sy2), (30, 40, 65), -1, 8)
    draw_rounded_rect(img, (sx1, sy1), (sx2, sy2), C_CYAN, 1, 8)
    draw_vn_text("[ KHÓA NHÀ & QUÉT MẶT ]", 0, 0, size=13, color=C_CYAN, bold=True, anchor_rect=(sx1, sy1, sx2, sy2))

    # Nút Thoát / Dừng Camera
    bx1, by1 = w - 165, 18
    bx2, by2 = w - 35, 62
    btn_exit_rect = (bx1, by1, bx2, by2)
    draw_rounded_rect(img, (bx1, by1), (bx2, by2), (40, 30, 180), -1, 8)
    draw_rounded_rect(img, (bx1, by1), (bx2, by2), C_RED, 1, 8)
    draw_vn_text("[X] THOÁT", 0, 0, size=14, color=C_WHITE, bold=True, anchor_rect=(bx1, by1, bx2, by2))

    # Panel Trái: Danh Mục Cử Chỉ Điều Khiển
    draw_vn_text("DANH MỤC ĐIỀU KHIỂN", 38, 92, size=15, color=C_WHITE, bold=True)
    cv2.line(img, (38, 118), (p_left_w - 20, 118), C_CYAN, 1, cv2.LINE_AA)

    card_y = 130
    for item in GESTURE_LIST:
        is_active = (active_gesture == item["key"]) or (item["key"] == "FACE_AI" and face_tag in ["OWNER", "STRANGER"])
        
        c_x1, c_y1 = 28, card_y
        c_x2, c_y2 = p_left_w - 12, card_y + 54
        
        bg_col = C_ACTIVE_BG if is_active else C_CARD_BG
        border_col = C_YELLOW if is_active else (70, 50, 35)
        b_thick = 2 if is_active else 1
        
        draw_rounded_rect(img, (c_x1, c_y1), (c_x2, c_y2), bg_col, -1, 8)
        draw_rounded_rect(img, (c_x1, c_y1), (c_x2, c_y2), border_col, b_thick, 8)
        
        badge_col = C_YELLOW if is_active else C_CYAN
        draw_vn_text(item["icon"], c_x1 + 10, c_y1 + 16, size=14, color=badge_col, bold=True)
        draw_vn_text(item["title"], c_x1 + 64, c_y1 + 8, size=13, color=C_WHITE, bold=True)
        draw_vn_text(item["desc"], c_x1 + 64, c_y1 + 30, size=12, color=C_TEXT_DIM, bold=False)

        if is_active:
            glow_c = C_GREEN if (item["key"] == "FACE_AI" and face_tag == "OWNER") else C_YELLOW
            cv2.circle(img, (c_x2 - 16, c_y1 + 27), 5, glow_c, -1, cv2.LINE_AA)

        card_y += 62

    # Panel Phải: Giám Sát Trạng Thái Thiết Bị
    draw_vn_text("TRẠNG THÁI THIẾT BỊ", w - p_right_w + 18, 92, size=15, color=C_WHITE, bold=True)
    cv2.line(img, (w - p_right_w + 18, 118), (w - 38, 118), C_CYAN, 1, cv2.LINE_AA)

    devices_ui = [
        {"name": "ĐÈN CHIẾU SÁNG",      "on": status_dict["Den"] == "ON",    "label": "ĐANG BẬT" if status_dict["Den"] == "ON" else "ĐÃ TẮT",                   "color": C_YELLOW},
        {"name": "CỬA CHÍNH (SERVO)",   "on": status_dict["Cua"] == "OPEN",  "label": "ĐANG MỞ (90°)" if status_dict["Cua"] == "OPEN" else "ĐÃ ĐÓNG (0°)",       "color": C_GREEN},
        {"name": "RÈM CỬA THÔNG MINH",  "on": status_dict["Rem"] == "UP",    "label": "ĐÃ KÉO LÊN" if status_dict["Rem"] == "UP" else "ĐÃ HẠ XUỐNG",            "color": C_PURPLE},
        {"name": "QUẠT LÀM MÁT",        "on": status_dict["Quat"] == "ON",   "label": "ĐANG CHẠY" if status_dict["Quat"] == "ON" else "ĐÃ TẮT",                  "color": C_CYAN},
        {"name": "TIVI LCD PHÒNG KHÁCH", "on": status_dict["TV"] == "ON",     "label": "NETFLIX BẬT" if status_dict["TV"] == "ON" else "CHẾ ĐỘ NGHỈ",            "color": (240, 160, 40)},
        {"name": "AN NINH GƯƠNG MẶT",   "on": True,                          "label": "THIÊN: CHỦ NHÀ",                                                           "color": C_GREEN}
    ]

    card_y = 135
    for dev in devices_ui:
        is_on = dev["on"]
        d_x1, d_y1 = w - p_right_w + 12, card_y
        d_x2, d_y2 = w - 28, card_y + 70
        
        bg_card = (55, 40, 25) if is_on else C_CARD_BG
        border_c = dev["color"] if is_on else (65, 50, 35)
        
        draw_rounded_rect(img, (d_x1, d_y1), (d_x2, d_y2), bg_card, -1, 10)
        draw_rounded_rect(img, (d_x1, d_y1), (d_x2, d_y2), border_c, 1, 10)
        
        led_c = dev["color"] if is_on else (80, 70, 60)
        cv2.circle(img, (d_x1 + 18, d_y1 + 22), 6, led_c, -1, cv2.LINE_AA)
        if is_on:
            cv2.circle(img, (d_x1 + 18, d_y1 + 22), 9, led_c, 1, cv2.LINE_AA)
            
        draw_vn_text(dev["name"], d_x1 + 34, d_y1 + 11, size=13, color=C_WHITE, bold=True)
        
        badge_text = dev["label"]
        b_bg = dev["color"] if is_on else (60, 50, 40)
        b_fg = (0, 0, 0) if is_on and dev["color"] in [C_YELLOW, C_CYAN, C_GREEN] else C_WHITE
        
        b_x1, b_y1 = d_x1 + 16, d_y1 + 38
        b_x2, b_y2 = d_x2 - 16, d_y1 + 62
        draw_rounded_rect(img, (b_x1, b_y1), (b_x2, b_y2), b_bg, -1, 6)
        draw_vn_text(badge_text, 0, 0, size=13, color=b_fg, bold=True, anchor_rect=(b_x1, b_y1, b_x2, b_y2))

        card_y += 79

    return img


# --------------------------------------------------------------------
# GIAO DIỆN 3: CẢNH BÁO ĐỎ BÁO ĐỘNG HÚ CÒI (SECURITY ALARM UI)
# --------------------------------------------------------------------
def render_security_alarm_ui(img, current_fps, detected_faces, conf_score):
    global btn_exit_rect, btn_rescan_rect
    h, w, _ = img.shape
    
    # Hiệu ứng viền đỏ nhấp nháy 2.5Hz
    flash = (int(time.time() * 2.5) % 2 == 0)
    border_c = (0, 0, 255) if flash else (0, 0, 160)
    cv2.rectangle(img, (6, 6), (w - 6, h - 6), border_c, 8)

    # 1. TOP HEADER BÁO ĐỘNG ĐỎ
    overlay = img.copy()
    draw_rounded_rect(overlay, (20, 12), (w - 20, 72), (20, 10, 80), -1, 14)
    draw_rounded_rect(overlay, (20, 12), (w - 20, 72), (0, 0, 255), 2, 14)
    img = cv2.addWeighted(overlay, 0.85, img, 0.15, 0)

    alarm_title = "⚠️ CẢNH BÁO AN NINH CẤP 1: PHÁT HIỆN NGƯỜI LẠ XÂM NHẬP! ⚠️"
    draw_vn_text(alarm_title, 0, 0, size=18, color=(255, 255, 255), bold=True, anchor_rect=(20, 12, w - 180, 72))

    # Nút Thoát
    ex1, ey1 = w - 165, 18
    ex2, ey2 = w - 35, 62
    btn_exit_rect = (ex1, ey1, ex2, ey2)
    draw_rounded_rect(img, (ex1, ey1), (ex2, ey2), (40, 20, 140), -1, 8)
    draw_rounded_rect(img, (ex1, ey1), (ex2, ey2), (0, 0, 255), 1, 8)
    draw_vn_text("[X] THOÁT", 0, 0, size=14, color=(255, 255, 255), bold=True, anchor_rect=(ex1, ey1, ex2, ey2))

    # Vẽ khuôn mặt người lạ (nếu có trong khung hình)
    if len(detected_faces) > 0:
        (fx, fy, fw, fh) = detected_faces[0]
        color_face = (0, 0, 255)
        cv2.rectangle(img, (fx, fy), (fx + fw, fy + fh), color_face, 4, cv2.LINE_AA)
        draw_hud_brackets(img, fx - 4, fy - 4, fx + fw + 4, fy + fh + 4, color_face, 30, 4)

        bw_box = fw
        bh_box = 32
        by1_box = max(10, fy - bh_box)
        cv2.rectangle(img, (fx, by1_box), (fx + bw_box, by1_box + bh_box), (0, 0, 200), -1)
        cv2.rectangle(img, (fx, by1_box), (fx + bw_box, by1_box + bh_box), (0, 0, 255), 1)
        draw_vn_text(f"ĐỐI TƯỢNG XÂM NHẬP (Khớp: {conf_score})", 0, 0, size=13, color=(255, 255, 255), bold=True, anchor_rect=(fx, by1_box, fx + bw_box, by1_box + bh_box))

        cv2.rectangle(img, (fx, fy + fh), (fx + bw_box, fy + fh + 26), (20, 15, 60), -1)
        cv2.rectangle(img, (fx, fy + fh), (fx + bw_box, fy + fh + 26), (0, 0, 255), 1)
        draw_vn_text("[ HỆ THỐNG ĐANG GHI HÌNH & HÚ CÒI ]", 0, 0, size=12, color=(0, 0, 255), bold=True, anchor_rect=(fx, fy + fh, fx + bw_box, fy + fh + 26))

    # Hộp Thông Báo Cảnh Báo An Ninh Khẩn Cấp
    mw = 860
    mx1 = (w - mw) // 2
    my1 = h - 175
    mx2 = mx1 + mw
    my2 = h - 85

    overlay2 = img.copy()
    draw_rounded_rect(overlay2, (mx1, my1), (mx2, my2), (25, 10, 50), -1, 14)
    draw_rounded_rect(overlay2, (mx1, my1), (mx2, my2), (0, 0, 255), 2, 14)
    img = cv2.addWeighted(overlay2, 0.85, img, 0.15, 0)

    draw_vn_text("🚨 CÒI HÚ CHỐNG TRỘM ĐANG PHÁT TÍN HIỆU BÁO ĐỘNG TRÊN ARDUINO (D7)!", 0, 0, size=15, color=(0, 0, 255), bold=True, anchor_rect=(mx1, my1 + 6, mx2, my1 + 45))
    draw_vn_text("🔒 TOÀN BỘ CỬA CHÍNH ĐÃ KHÓA CHẶT (SERVO 0°). VÔ HIỆU HÓA QUYỀN ĐIỀU KHIỂN!", 0, 0, size=14, color=(255, 200, 200), bold=False, anchor_rect=(mx1, my1 + 45, mx2, my2 - 6))

    # Nút bấm: [ QUÉT LẠI MẶT ĐỂ TẮT CÒI / XÁC THỰC LẠI ]
    rw = 520
    rx1 = (w - rw) // 2
    ry1 = h - 70
    rx2 = rx1 + rw
    ry2 = h - 20
    btn_rescan_rect = (rx1, ry1, rx2, ry2)
    
    btn_bg = (30, 80, 25) if flash else (20, 60, 20)
    draw_rounded_rect(img, (rx1, ry1), (rx2, ry2), btn_bg, -1, 10)
    draw_rounded_rect(img, (rx1, ry1), (rx2, ry2), (70, 220, 30), 2, 10)
    draw_vn_text("[ QUÉT LẠI MẶT ĐỂ TẮT CÒI (HOẶC NHẤN SPACE) ]", 0, 0, size=14, color=(255, 255, 255), bold=True, anchor_rect=(rx1, ry1, rx2, ry2))

    return img

print("San sang! Ban hay mo cua so Camera len nhe...")

# Biến lưu trữ khuôn mặt giữa các frame để đạt 60 FPS
detected_faces = []
detected_faces_data = []
frame_idx = 0

# ====================================================================
# 6. VÒNG LẶP CHÍNH (CAMERA STREAM & AI RECOGNITION 60 FPS)
# ====================================================================
while cap.isOpened() and not exit_requested:
    ret, frame_raw = cap.read()
    if not ret: break
        
    frame_raw = cv2.flip(frame_raw, 1)
    
    # -------------------------------------------------------------
    # BẢO VỆ CHUẨN TỈ LỆ 16:9 (CHỐNG KÉO GIÃN BẸP MẶT & BÀN TAY)
    # -------------------------------------------------------------
    rh, rw = frame_raw.shape[:2]
    if abs((rw / rh) - (16.0 / 9.0)) > 0.04:
        target_h = int(rw * 9.0 / 16.0)
        if target_h <= rh:
            sy = (rh - target_h) // 2
            frame_raw = frame_raw[sy:sy + target_h, :]
        else:
            target_w = int(rh * 16.0 / 9.0)
            sx = (rw - target_w) // 2
            frame_raw = frame_raw[:, sx:sx + target_w]

    frame = cv2.resize(frame_raw, (1280, 720))
    h, w, _ = frame.shape
    frame_idx += 1
    
    cur_t = time.time()
    gesture_name = "None"
    current_face_status = "NONE"
    
    # -------------------------------------------------------------
    # TỰ ĐỘNG KẾT NỐI LẠI ARDUINO NẾU CẮM DÂY SAU KHI MỞ CAM
    # -------------------------------------------------------------
    if (not arduino_connected or ser is None) and (cur_t - last_arduino_check_time > 2.0):
        last_arduino_check_time = cur_t
        p = get_arduino_port()
        try:
            ser = serial.Serial(p, 9600, timeout=1)
            arduino_connected = True
            target_port = p
            print(f"Da tu dong ket noi thanh cong voi Arduino ({p})!")
        except Exception:
            ser = None
            arduino_connected = False

    # -------------------------------------------------------------
    # A. XỬ LÝ THEO 3 TRẠNG THÁI GIAO DIỆN (STATE MACHINE)
    # -------------------------------------------------------------
    has_owner = False
    has_stranger = False
    active_conf_score = "0%"

    # =============================================================
    # GIAO DIỆN 1: CỔNG QUÉT MẶT AN NINH (DEEP LEARNING YUNET & SFACE)
    # =============================================================
    if current_app_state == STATE_FACE_GATE:
        # 1. Phát hiện khuôn mặt bằng Deep Neural Network YuNet mỗi 2 frame
        if frame_idx % 2 == 0 and face_detector is not None:
            small_frame = cv2.resize(frame, (640, 360))
            face_detector.setInputSize((640, 360))
            _, raw_faces = face_detector.detect(small_frame)
            valid_faces = []
            if raw_faces is not None:
                for rf in raw_faces:
                    fx, fy, fw, fh = int(rf[0] * 2), int(rf[1] * 2), int(rf[2] * 2), int(rf[3] * 2)
                    score = rf[14]
                    if fw >= 40 and fh >= 40 and score >= 0.50:
                        rf_1280 = rf.copy()
                        rf_1280[:14] *= 2.0
                        valid_faces.append(((fx, fy, fw, fh), rf_1280))
            valid_faces.sort(key=lambda item: item[0][2] * item[0][3], reverse=True)
            detected_faces_data = valid_faces[:1]
            detected_faces = [item[0] for item in detected_faces_data]

        if len(detected_faces) > 0:
            last_face_time = cur_t

        time_rem = GATE_DURATION

        # 2. XÁC THỰC SINH TRẮC HỌC ĐỘC BẢN 128 CHIỀU KHI BẬT QUÉT MẶT
        if gate_scanning:
            for ((fx, fy, fw, fh), rf_1280) in detected_faces_data:
                is_owner = False
                matched_name = ""
                highest_sim = 0.0
                
                if owner_model_loaded and face_recognizer is not None:
                    try:
                        aligned = face_recognizer.alignCrop(frame, rf_1280)
                        query_feat = face_recognizer.feature(aligned)
                        norm_q = query_feat / np.linalg.norm(query_feat, axis=1, keepdims=True)
                        
                        for name, bank in owner_embeddings.items():
                            sims = np.dot(bank, norm_q.T).flatten()
                            max_s = float(np.max(sims))
                            if max_s > highest_sim:
                                highest_sim = max_s
                                matched_name = name
                                
                        recent_confs.append(highest_sim)
                        if len(recent_confs) > 5: recent_confs.pop(0)
                        avg_sim = sum(recent_confs) / len(recent_confs)
                        
                        # Ánh xạ Cosine similarity của SFace sang % trực quan:
                        # Người lạ (sim <= 0.35) -> 10% - 35%
                        # Chủ nhà (sim >= 0.52)  -> 75% - 98%
                        if avg_sim <= 0.35:
                            match_pct = int(max(5, (avg_sim / 0.35) * 35))
                        else:
                            match_pct = int(min(99, 35 + ((avg_sim - 0.35) / 0.28) * 64))
                        active_conf_score = f"{match_pct}%"
                        
                        # NGƯỠNG SINH TRẮC HỌC DEEP LEARNING SFACE:
                        # >= 0.52: Chủ nhà thực sự (loại bỏ 100% người lạ < 0.40, nhận diện trơn tru không giật lag)
                        if avg_sim >= 0.52 and matched_name:
                            is_owner = True
                            detected_owner_name = matched_name.upper()
                        else:
                            is_owner = False
                    except Exception as e:
                        is_owner = False
                
                if is_owner:
                    has_owner = True
                    gate_green_frames += 1
                else:
                    has_stranger = True
                    gate_red_frames += 1

            # Đếm ngược thời gian nhận diện mặt
            time_rem = max(0.0, GATE_DURATION - (cur_t - gate_start_time))
            
            # 1. Cơ chế xác thực nhanh (Fast-Pass): Nhận diện đúng chủ nhà 4 frame liên tiếp với độ khớp cao
            if gate_green_frames >= 4 and avg_sim >= 0.54:
                door_is_open = True
                device_status["Cua"] = "OPEN"
                device_status["Security"] = "OWNER_VERIFIED"
                if ser:
                    try:
                        ser.write(b'O')
                        ser.flush()
                        time.sleep(0.01)
                        if ser.in_waiting > 0:
                            ser.read(ser.in_waiting)
                    except Exception: pass
                print(f"[FACE GATE] XAC THUC DEEP AI CHU NHA {detected_owner_name} ({active_conf_score}) THANH CONG! MO CUA.")
                toast_message = f"FACE ID: CHÀO MỪNG CHỦ NHÀ {detected_owner_name} ({active_conf_score})! ĐÃ MỞ CỬA"
                toast_time = cur_t
                gate_scanning = False
                switch_state(STATE_HOME_DASHBOARD, frame)

            # 2. Hết thời gian 3.0s -> ĐƯA RA QUYẾT ĐỊNH
            elif time_rem <= 0.0:
                if gate_green_frames >= 6 and avg_sim >= 0.50:
                    door_is_open = True
                    device_status["Cua"] = "OPEN"
                    device_status["Security"] = "OWNER_VERIFIED"
                    if ser:
                        try:
                            ser.write(b'O')
                            ser.flush()
                            time.sleep(0.01)
                            if ser.in_waiting > 0:
                                ser.read(ser.in_waiting)
                        except Exception: pass
                    print(f"[FACE GATE] XAC THUC DEEP AI CHU NHA {detected_owner_name} ({active_conf_score}) THANH CONG! MO CUA.")
                    toast_message = f"FACE ID: CHÀO MỪNG CHỦ NHÀ {detected_owner_name} ({active_conf_score})! ĐÃ MỞ CỬA"
                    toast_time = cur_t
                    gate_scanning = False
                    switch_state(STATE_HOME_DASHBOARD, frame)
                elif gate_red_frames >= 15 and avg_sim < 0.45 and gate_red_frames > 2 * gate_green_frames:
                    door_is_open = False
                    device_status["Cua"] = "CLOSED"
                    device_status["Security"] = "STRANGER_ALERT"
                    if ser:
                        try:
                            ser.write(b'S')
                            ser.flush()
                            time.sleep(0.01)
                            if ser.in_waiting > 0:
                                ser.read(ser.in_waiting)
                        except Exception: pass
                    alarm_active = True
                    print(f"[FACE GATE] PHAT HIEN NGUOI LA! (KHOP: {active_conf_score}) KICH HOAT COI BAO DONG.")
                    toast_message = f"CẢNH BÁO AN NINH: PHÁT HIỆN NGƯỜI LẠ ({active_conf_score})! ĐANG HÚ CÒI!"
                    toast_time = cur_t
                    gate_scanning = False
                    switch_state(STATE_SECURITY_ALARM, frame)
                else:
                    # Chưa rõ khuôn mặt hoặc chưa đủ mẫu -> Nhắc người dùng quét lại, tuyệt đối KHÔNG hú còi oan
                    gate_scanning = False
                    toast_message = "KHÔNG THẤY RÕ MẶT! VUI LÒNG HƯỚNG VỀ CAMERA VÀ QUÉT LẠI"
                    toast_time = cur_t

        # Render Giao diện 1
        frame = render_face_gate_ui(frame, display_fps, gate_scanning, time_rem, GATE_DURATION, gate_green_frames, gate_red_frames, detected_faces, has_owner, active_conf_score, detected_owner_name)

    # =============================================================
    # GIAO DIỆN 2: ĐIỀU KHIỂN THIẾT BỊ BẰNG CỬ CHỈ (STATE_HOME_DASHBOARD)
    # =============================================================
    elif current_app_state == STATE_HOME_DASHBOARD:
        # B. NHẬN DIỆN CỬ CHỈ BÀN TAY (MEDIAPIPE VISION - TỐI ƯU 60 FPS)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        small_rgb = cv2.resize(rgb_frame, (640, 360))
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=small_rgb)
        detection_result = recognizer.recognize(mp_image)
        
        hand_cmd = None
        hand_action_text = ""
        
        # BỘ LỌC CHỐNG NHẬN DIỆN NHẦM KHUÔN MẶT/BÓNG MŨI THÀNH BÀN TAY:
        has_valid_hand = False
        if detection_result.gestures and len(detection_result.hand_landmarks) > 0:
            hlm = detection_result.hand_landmarks[0]
            plen = math.hypot((hlm[9].x - hlm[0].x) * w, (hlm[9].y - hlm[0].y) * h)
            xs_c = [lm.x * w for lm in hlm]
            ys_c = [lm.y * h for lm in hlm]
            hw = max(xs_c) - min(xs_c)
            hh = max(ys_c) - min(ys_c)
            if plen >= 28 and (hw >= 45 or hh >= 45):
                has_valid_hand = True
        
        if has_valid_hand:
            gesture_name = detection_result.gestures[0][0].category_name
            score = detection_result.gestures[0][0].score
            hand_landmarks = detection_result.hand_landmarks[0]
            
            # 0. Xác định tay Trái / Phải & Hướng bàn tay (Lòng tay vs Mặt sấp)
            raw_hand_label = "Right"
            if detection_result.handedness and len(detection_result.handedness) > 0:
                raw_hand_label = detection_result.handedness[0][0].category_name
                
            hand_facing = check_hand_facing(hand_landmarks, raw_hand_label)
            
            # Chuẩn hóa tay Trái / Tay Phải chuẩn 100% theo góc nhìn người dùng thực tế:
            # Do webcam trước (camera laptop) đang lật gương (cv2.flip(1)), MediaPipe phân loại theo
            # người đứng đối diện nên bị đảo ngược: "Right" của MediaPipe là TAY TRÁI ngoài đời của bạn
            real_hand_label = "Left" if raw_hand_label == "Right" else "Right"
            
            # 1. Vẽ xương bàn tay (Skeleton line)
            for p1_idx, p2_idx in HAND_CONNECTIONS:
                pt1 = (int(hand_landmarks[p1_idx].x * w), int(hand_landmarks[p1_idx].y * h))
                pt2 = (int(hand_landmarks[p2_idx].x * w), int(hand_landmarks[p2_idx].y * h))
                cv2.line(frame, pt1, pt2, (255, 230, 0), 2, cv2.LINE_AA)
                
            # 2. Khớp ngón tay phát sáng 2 lớp
            xs, ys = [], []
            for lm in hand_landmarks:
                x, y = int(lm.x * w), int(lm.y * h)
                xs.append(x)
                ys.append(y)
                cv2.circle(frame, (x, y), 5, (255, 200, 0), -1, cv2.LINE_AA)
                cv2.circle(frame, (x, y), 2, (255, 255, 255), -1, cv2.LINE_AA)

            # 3. Khung bao bàn tay (Corner Brackets)
            pad = 20
            min_x = max(0, min(xs) - pad)
            min_y = max(0, min(ys) - pad)
            max_x = min(w, max(xs) + pad)
            max_y = min(h, max(ys) + pad)
            draw_hud_brackets(frame, min_x, min_y, max_x, max_y, (0, 240, 255), 20, 2)

            # 3. Phân loại cử chỉ bằng hình học giải phẫu 21 khớp xương
            anat_gesture = get_anatomical_gesture(hand_landmarks, w, h)
            if anat_gesture != "None":
                gesture_name = anat_gesture
                score = 0.96

            # 4. KIỂM TRA QUY ƯỚC MẶT BÀN TAY (PALM vs BACK):
            is_facing_valid = False
            facing_tag = ""
            tag_color = (0, 240, 255)
            target_cmd = None
            action_desc = ""
            current_time = time.time()
            last_hand_seen_time = current_time

            # Cơ chế nhả khóa cử chỉ (Unlatch) siêu nhạy:
            # Khi người dùng đổi sang cử chỉ khác hoặc thả lỏng ngón tay:
            if latched_gesture is not None:
                if gesture_name != latched_gesture:
                    if unlatch_time == 0:
                        unlatch_time = current_time
                    elif current_time - unlatch_time >= 0.10: # Chỉ cần 0.10s (1-2 frame) thả lỏng/đổi cử chỉ là nhả khóa ngay
                        latched_gesture = None
                        unlatch_time = 0
                else:
                    unlatch_time = 0
            
            if gesture_name == "Victory":
                # Cử chỉ chữ V: Chấp nhận mọi hướng giơ tay tự nhiên (Mở khi đang đóng, Đóng khi đang mở)
                is_facing_valid = True
                if latched_gesture == "Victory":
                    facing_tag = "[ ĐÃ THỰC THI - THẢ LỎNG/HẠ TAY ĐỂ ĐỔI LỆNH ]"
                    tag_color = (0, 220, 255)
                else:
                    door_intent = "ĐÓNG CỬA" if door_is_open else "MỞ CỬA"
                    facing_tag = f"[ HỢP LỆ: 2 NGÓN {door_intent} ]"
                    tag_color = (70, 220, 30) # Xanh lá
            elif gesture_name in ["Pointing_Up", "Three_Fingers", "Open_Palm", "OK_SIGN"]:
                if hand_facing in ["PALM", "EDGE"]:
                    is_facing_valid = True
                    if latched_gesture == gesture_name:
                        facing_tag = "[ ĐÃ THỰC THI - THẢ LỎNG/HẠ TAY ĐỂ ĐỔI LỆNH ]"
                        tag_color = (0, 220, 255)
                    else:
                        if gesture_name == "Three_Fingers":
                            rem_is_up = (device_status.get("Rem") == "UP")
                            rem_intent = "HẠ RÈM (0°)" if rem_is_up else "KÉO RÈM (90°)"
                            facing_tag = f"[ HỢP LỆ: 3 NGÓN {rem_intent} ]"
                        elif gesture_name == "Open_Palm":
                            fan_is_on = (device_status.get("Quat") == "ON")
                            fan_intent = "TẮT QUẠT" if fan_is_on else "BẬT QUẠT"
                            facing_tag = f"[ HỢP LỆ: XÒE TAY {fan_intent} ]"
                        elif gesture_name == "OK_SIGN":
                            tv_intent = "TẮT TV" if tv_is_on else "BẬT TV"
                            facing_tag = f"[ HỢP LỆ: OK {tv_intent} ]"
                        elif gesture_name == "Pointing_Up":
                            facing_tag = "[ HỢP LỆ: 1 NGÓN BẬT ĐÈN ]"
                        else:
                            facing_tag = "[ HỢP LỆ: LÒNG BÀN TAY ]"
                        tag_color = (70, 220, 30) # Xanh lá
                else:
                    is_facing_valid = False
                    facing_tag = "[ TỪ CHỐI: CẦN QUAY LÒNG TAY ]"
                    tag_color = (0, 100, 255) # Cam đỏ cảnh báo
            elif gesture_name == "Closed_Fist":
                is_facing_valid = True
                if latched_gesture == "Closed_Fist":
                    facing_tag = "[ ĐÃ THỰC THI - ĐÃ TẮT TOÀN BỘ ]"
                    tag_color = (0, 220, 255)
                else:
                    facing_tag = "[ HỢP LỆ: NẮM ĐẤM TẮT HẾT ]"
                    tag_color = (70, 220, 30) # Xanh lá
            else:
                is_facing_valid = False
                facing_tag = ""

            # Hiển thị thông tin tay và trạng thái hướng mặt trên HUD (Đúng 100% ngoài đời thực)
            hand_vn = "TAY PHẢI" if real_hand_label == "Right" else "TAY TRÁI"
            gesture_vn = GESTURE_VN_MAP.get(gesture_name, gesture_name)
            score_pct = int(score * 100)
            hand_title = f"{hand_vn}: {gesture_vn} ({score_pct}%)"
            
            badge_y = max(35, min_y - 12)
            if facing_tag:
                draw_vn_text(facing_tag, min_x, badge_y - 22, size=13, color=tag_color, bold=True)
            draw_vn_text(hand_title, min_x, badge_y, size=15, color=(0, 240, 255), bold=True)

            # Ánh xạ cử chỉ thành lệnh khi thỏa mãn quy ước hướng mặt
            if is_facing_valid:
                # Nếu cử chỉ này đang giữ nguyên sau khi vừa kích hoạt xong: khóa chống lặp lại liên tục
                if latched_gesture == gesture_name:
                    target_cmd = None
                else:
                    if gesture_name == "Victory":
                        target_cmd = 'DOOR_CLOSE' if door_is_open else 'DOOR_OPEN'
                        action_desc = "CỬA CHÍNH: ĐÃ ĐÓNG (0°)" if door_is_open else "CỬA CHÍNH: ĐÃ MỞ (90°)"
                    elif gesture_name == "Three_Fingers":
                        rem_is_up = (device_status.get("Rem") == "UP")
                        target_cmd = 'REM_DOWN' if rem_is_up else 'REM_UP'
                        action_desc = "RÈM CỬA: ĐÃ HẠ XUỐNG (0°)" if rem_is_up else "RÈM CỬA: ĐÃ KÉO LÊN (90°)"
                    elif gesture_name == "Pointing_Up":
                        target_cmd = 'A'
                        action_desc = "BẬT ĐÈN CHIẾU SÁNG"
                    elif gesture_name == "Open_Palm":
                        fan_is_on = (device_status.get("Quat") == "ON")
                        target_cmd = 'FAN_OFF' if fan_is_on else 'FAN_ON'
                        action_desc = "QUẠT: ĐÃ TẮT" if fan_is_on else "QUẠT: ĐANG CHẠY"
                    elif gesture_name == "OK_SIGN":
                        target_cmd = 'TV_OFF' if tv_is_on else 'TV_ON'
                        action_desc = "TIVI: ĐÃ TẮT" if tv_is_on else "TIVI: BẬT (NETFLIX)"
                    elif gesture_name == "Closed_Fist":
                        target_cmd = 'B'
                        action_desc = "TẮT TOÀN BỘ THIẾT BỊ"

            # -------------------------------------------------------------
            # ỔN ĐỊNH CỬ CHỈ (HOLD 0.15s - CỰC NHẠY NHƯ RÈM) & THỰC THI
            # -------------------------------------------------------------
            if target_cmd is not None:
                if target_cmd != candidate_gesture:
                    candidate_gesture = target_cmd
                    candidate_start_time = current_time
                else:
                    held_duration = current_time - candidate_start_time
                    # 0.15s (~2-3 frame): Phản hồi tức thì, không một chút delay
                    if held_duration >= 0.15:
                        # Cooldown 0.35s giữa các lần bấm/thực thi
                        if (current_time - last_action_time >= 0.35):
                            send_char = None
                            if candidate_gesture in ['DOOR_OPEN', 'DOOR_CLOSE']:
                                door_is_open = (candidate_gesture == 'DOOR_OPEN')
                                if door_is_open:
                                    device_status["Cua"] = "OPEN"
                                    action_desc = "CỬA CHÍNH: ĐÃ MỞ (90°)"
                                    send_char = 'O'
                                else:
                                    device_status["Cua"] = "CLOSE"
                                    action_desc = "CỬA CHÍNH: ĐÃ ĐÓNG (0°)"
                                    send_char = 'C'
                            elif candidate_gesture in ['TV_ON', 'TV_OFF']:
                                tv_is_on = (candidate_gesture == 'TV_ON')
                                device_status["TV"] = "ON" if tv_is_on else "OFF"
                                action_desc = f"TIVI: {'BẬT (NETFLIX)' if tv_is_on else 'ĐÃ TẮT'}"
                                send_char = 'T'
                            elif candidate_gesture in ['FAN_ON', 'FAN_OFF']:
                                fan_on = (candidate_gesture == 'FAN_ON')
                                device_status["Quat"] = "ON" if fan_on else "OFF"
                                action_desc = f"QUẠT: {'ĐANG CHẠY' if fan_on else 'ĐÃ TẮT'}"
                                send_char = 'F'
                            elif candidate_gesture == 'A':
                                device_status["Den"] = "ON"
                                action_desc = "ĐÃ BẬT ĐÈN CHIẾU SÁNG"
                                send_char = 'A'
                            elif candidate_gesture in ['REM_UP', 'REM_DOWN', 'U', 'D']:
                                rem_is_up = (candidate_gesture in ['REM_UP', 'U'])
                                if rem_is_up:
                                    device_status["Rem"] = "UP"
                                    action_desc = "RÈM CỬA: ĐÃ KÉO LÊN (90°)"
                                    send_char = 'U'
                                else:
                                    device_status["Rem"] = "DOWN"
                                    action_desc = "RÈM CỬA: ĐÃ HẠ XUỐNG (0°)"
                                    send_char = 'D'
                            elif candidate_gesture == 'B':
                                device_status["Den"] = "OFF"
                                device_status["Cua"] = "CLOSE"
                                device_status["Rem"] = "DOWN"
                                device_status["Quat"] = "OFF"
                                device_status["TV"] = "OFF"
                                device_status["Security"] = "STANDBY"
                                tv_is_on = False
                                door_is_open = False
                                action_desc = "ĐÃ TẮT TOÀN BỘ THIẾT BỊ"
                                if alarm_active:
                                    alarm_active = False
                                send_char = 'B'

                            if ser and send_char:
                                try:
                                    ser.write(send_char.encode())
                                    ser.flush()
                                    time.sleep(0.02)
                                    if ser.in_waiting > 0:
                                        ser.read(ser.in_waiting)
                                    if send_char == 'B':
                                        ser.write(b'C') # Đảm bảo đóng cửa Servo triệt để khi tắt hết
                                        ser.flush()
                                except Exception as e:
                                    print(f"[SERIAL ERROR] Khong the gui lenh '{send_char}': {e}")
                                    
                            print(f"[ACTION] Cu chi: {gesture_name} -> Lenh: {action_desc} (Char: '{send_char}')")
                            
                            toast_message = f"LỆNH: {action_desc}"
                            toast_time = current_time
                            last_executed_gesture = candidate_gesture
                            last_action_time = current_time
                            latched_gesture = gesture_name # Khóa giữ cử chỉ này cho đến khi hạ hoặc đổi tay
                            candidate_gesture = None
            else:
                candidate_gesture = None
        else:
            current_time = time.time()
            # Khi hạ tay hoặc bàn tay ra khỏi khung hình: Nhả khóa ngay sau 0.10s
            if current_time - last_hand_seen_time > 0.10:
                latched_gesture = None
                unlatch_time = 0
                last_executed_gesture = None
                candidate_gesture = None

        # Render Giao diện 2
        frame = render_cyberpunk_dashboard(frame, device_status, gesture_name, display_fps, "OWNER_VERIFIED")

    # =============================================================
    # GIAO DIỆN 3: CẢNH BÁO ĐỎ BÁO ĐỘNG HÚ CÒI (STATE_SECURITY_ALARM)
    # =============================================================
    elif current_app_state == STATE_SECURITY_ALARM:
        # Quét mặt người lạ mỗi 3 frame
        if frame_idx % 3 == 0:
            gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            small_gray = cv2.resize(gray_frame, (640, 360))
            raw_faces = face_cascade.detectMultiScale(small_gray, scaleFactor=1.18, minNeighbors=5, minSize=(50, 50))
            valid_faces = []
            for (x, y, fw, fh) in raw_faces:
                bx, by, bw, bh = int(x * 2), int(y * 2), int(fw * 2), int(fh * 2)
                cx = bx + bw // 2
                if bw >= 80 and bh >= 80 and 100 <= cx <= (w - 100):
                    valid_faces.append((bx, by, bw, bh))
            valid_faces.sort(key=lambda f: f[2] * f[3], reverse=True)
            detected_faces = valid_faces[:1]

            if len(detected_faces) > 0 and owner_model_loaded and face_recognizer is not None:
                (fx, fy, fw, fh) = detected_faces[0]
                face_crop = gray_frame[fy:fy+fh, fx:fx+fw]
                if face_crop.size > 0:
                    try:
                        face_resized = cv2.resize(face_crop, (200, 200))
                        _, c_full = face_recognizer.predict(face_resized)
                        active_conf_score = int(c_full)
                    except Exception:
                        pass

        # Duy trì còi hú chống trộm trên Arduino
        if not alarm_active or (cur_t - last_face_action_time > 1.2):
            if ser:
                try: ser.write(b'S')
                except Exception: pass
            alarm_active = True
            last_face_action_time = cur_t

        # Render Giao diện 3
        frame = render_security_alarm_ui(frame, display_fps, detected_faces, active_conf_score)

    # =============================================================
    # HIỆU ỨNG CHUYỂN CẢNH MƯỢT MÀ (SMOOTH CROSS-DISSOLVE TRANSITION)
    # =============================================================
    if is_transitioning and transition_prev_frame is not None:
        trans_elapsed = time.time() - transition_start_time
        alpha = min(1.0, trans_elapsed / transition_duration)
        frame = cv2.addWeighted(transition_prev_frame, 1.0 - alpha, frame, alpha, 0)
        if alpha >= 1.0:
            is_transitioning = False
            transition_prev_frame = None

    last_rendered_frame = frame.copy()

    # -------------------------------------------------------------
    # C. ĐO TỐC ĐỘ FPS
    # -------------------------------------------------------------
    frame_count += 1
    if time.time() - fps_time >= 1.0:
        display_fps = frame_count
        frame_count = 0
        fps_time = time.time()

    # -------------------------------------------------------------
    # D. HIỂN THỊ TOAST NOTIFICATION TRÊN CÙNG
    # -------------------------------------------------------------
    if toast_message and (time.time() - toast_time < 2.0):
        t_w = 540
        tx1 = (w - t_w) // 2
        ty1 = 80
        tx2 = tx1 + t_w
        ty2 = ty1 + 46
        draw_rounded_rect(frame, (tx1, ty1), (tx2, ty2), (30, 20, 15), -1, 10)
        draw_rounded_rect(frame, (tx1, ty1), (tx2, ty2), (0, 240, 255), 2, 10)
        draw_vn_text(toast_message, 0, 0, size=15, color=(0, 240, 255), bold=True, anchor_rect=(tx1, ty1, tx2, ty2))

    # -------------------------------------------------------------
    # E. RENDER TOÀN BỘ TIẾNG VIỆT CÓ DẤU (SINGLE-PASS PIL OVERLAY)
    # -------------------------------------------------------------
    frame = flush_vn_text(frame)

    cv2.imshow("Smart Home AI Dashboard", frame)
    
    key = cv2.waitKey(1) & 0xFF
    if key == ord('q') or key == 27:
        break
    elif key == ord(' ') or key == 32:
        if current_app_state == STATE_HOME_DASHBOARD:
            if ser:
                try:
                    ser.write(b'C')
                    ser.flush()
                    time.sleep(0.01)
                    if ser.in_waiting > 0:
                        ser.read(ser.in_waiting)
                except Exception: pass
            door_is_open = False
            device_status["Cua"] = "CLOSED"
            device_status["Security"] = "STANDBY"
            toast_message = "ĐÃ KHÓA NHÀ! BẬT CỔNG QUÉT MẶT AN NINH"
            toast_time = time.time()
            reset_face_gate()
            switch_state(STATE_FACE_GATE, frame)
        elif current_app_state == STATE_SECURITY_ALARM:
            if ser:
                try:
                    ser.write(b'C')
                    ser.flush()
                    time.sleep(0.01)
                    if ser.in_waiting > 0:
                        ser.read(ser.in_waiting)
                except Exception: pass
            alarm_active = False
            device_status["Security"] = "STANDBY"
            toast_message = "ĐÃ TẮT CÒI TẠM THỜI! ĐANG QUÉT LẠI MẶT"
            toast_time = time.time()
            reset_face_gate()
            switch_state(STATE_FACE_GATE, frame)
        elif current_app_state == STATE_FACE_GATE:
            start_face_scan()

cap.release()
cv2.destroyAllWindows()
if ser:
    if alarm_active:
        try:
            ser.write(b'O' if door_is_open else b'C')
        except Exception:
            pass
    ser.close()
print("Da tat camera thanh cong.")
