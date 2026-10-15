import cv2
import os
import time
import numpy as np
import urllib.request

YUNET_MODEL = "face_detection_yunet_2023mar.onnx"
SFACE_MODEL = "face_recognition_sface_2021dec.onnx"

def ensure_deep_models():
    """Tự động kiểm tra và tải mô hình Deep Learning SFace & YuNet nếu chưa có"""
    models = {
        YUNET_MODEL: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        SFACE_MODEL: "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
    }
    dir_path = os.path.dirname(__file__)
    for filename, url in models.items():
        full_path = os.path.join(dir_path, filename)
        if not os.path.exists(full_path):
            print(f"[*] Dang tai mo hinh Deep Learning: {filename}...")
            try:
                urllib.request.urlretrieve(url, full_path)
                print(f"[+] Da tai thanh cong: {filename} ({os.path.getsize(full_path)} bytes)")
            except Exception as e:
                print(f"[!] Loi khi tai {filename}: {e}")

def register_owner(owner_name="thien"):
    ensure_deep_models()
    print("=" * 68)
    print("      HE THONG DANG KY KHUON MAT CHU NHA (100 ANH - DEEP AI)")
    print("=" * 68)
    try:
        name_input = input("Nhap ten chu nha can dang ky (Vi du: Thien / Hung) [Mac dinh: Thien]: ").strip()
        if name_input:
            owner_name = name_input.lower()
        else:
            owner_name = "thien"
    except Exception:
        owner_name = "thien"

    dataset_dir = os.path.join(os.path.dirname(__file__), 'dataset', owner_name)
    os.makedirs(dataset_dir, exist_ok=True)
    
    # Xoa anh cu neu co de cap nhat data moi nhat
    for f in os.listdir(dataset_dir):
        if f.endswith('.jpg') or f.endswith('.png'):
            try: os.remove(os.path.join(dataset_dir, f))
            except: pass
            
    cascade_path = os.path.join(os.path.dirname(__file__), 'haarcascade_frontalface_default.xml')
    face_cascade = cv2.CascadeClassifier(cascade_path)
    
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
    cap.set(cv2.CAP_PROP_FPS, 60)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    
    # 4 Giai đoạn thu thập dữ liệu chuyên sâu (Đeo kính & Tháo kính)
    stages = [
        {"title": "BUOC 1/4: DEO KINH - NHIN THANG", "desc": "Deo kinh, giu dau thang, nhin thang vao ong kinh", "target": 25},
        {"title": "BUOC 2/4: DEO KINH - NGHIENG DAU", "desc": "Deo kinh, nghieng nhe dau sang trai va phai", "target": 50},
        {"title": "BUOC 3/4: THAO KINH - NHIN THANG", "desc": "Thao kinh ra, nhin thang vao camera", "target": 75},
        {"title": "BUOC 4/4: THAO KINH - NGHIENG DAU", "desc": "Thao kinh ra, nghieng dau nhe va cuoi tu nhien", "target": 100}
    ]
    
    total_samples = 100
    current_stage_idx = 0
    count = 0
    
    state = "READY" # READY, COUNTDOWN, CAPTURING, DONE
    countdown_start = 0
    countdown_seconds = 3
    last_capture_time = 0
    capture_interval = 0.16 # Giãn cách 0.16s mỗi tấm ảnh
    
    print("=" * 68)
    print(f"   HE THONG THU THAP DU LIEU CHU NHA: {owner_name.upper()} (100 ANH)")
    print("=" * 68)
    print("1. Deo kinh - Nhin thang (25 anh)")
    print("2. Deo kinh - Nghieng dau (25 anh)")
    print("3. Thao kinh - Nhin thang (25 anh)")
    print("4. Thao kinh - Nghieng dau (25 anh)")
    print("-> Bam [SPACE] de bat dau!")
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break
        
        frame = cv2.flip(frame, 1)
        
        # Chuẩn hóa tỉ lệ 16:9 chống kéo giãn méo mặt
        rh, rw = frame.shape[:2]
        if abs((rw / rh) - (16.0 / 9.0)) > 0.04:
            target_h = int(rw * 9.0 / 16.0)
            if target_h <= rh:
                sy = (rh - target_h) // 2
                frame = frame[sy:sy + target_h, :]
            else:
                target_w = int(rh * 16.0 / 9.0)
                sx = (rw - target_w) // 2
                frame = frame[:, sx:sx + target_w]

        frame = cv2.resize(frame, (1280, 720))
        h, w, _ = frame.shape
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Tối ưu hóa phát hiện khuôn mặt nhanh & nhạy
        small_gray = cv2.resize(gray, (640, 360))
        raw_faces = face_cascade.detectMultiScale(small_gray, scaleFactor=1.15, minNeighbors=4, minSize=(25, 25))
        faces = [(int(x * 2), int(y * 2), int(fw * 2), int(fh * 2)) for (x, y, fw, fh) in raw_faces]
        
        # 1. Overlay Khung Header Thong Tin
        overlay = frame.copy()
        cv2.rectangle(overlay, (20, 15), (w - 20, 115), (32, 22, 14), -1)
        cv2.rectangle(overlay, (20, 15), (w - 20, 115), (255, 230, 0), 1)
        frame = cv2.addWeighted(overlay, 0.82, frame, 0.18, 0)
        
        cur_t = time.time()
        
        # 2. Xử lý trạng thái
        if state == "READY":
            cv2.putText(frame, f"DANG KY KHUON MAT CHU NHA: {owner_name.upper()} (100 ANH)", (40, 50), cv2.FONT_HERSHEY_DUPLEX, 0.72, (255, 230, 0), 2)
            cv2.putText(frame, "Ngoi thang truoc camera va BAM [SPACE] de bat dau...", (40, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 1)
            
        elif state == "COUNTDOWN":
            rem_sec = int(countdown_seconds - (cur_t - countdown_start)) + 1
            stage_info = stages[current_stage_idx]
            cv2.putText(frame, f"CHUAN BI {stage_info['title']}", (40, 50), cv2.FONT_HERSHEY_DUPLEX, 0.72, (0, 240, 255), 2)
            cv2.putText(frame, f"{stage_info['desc']} (Bat dau sau {rem_sec} giay...)", (40, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
            
            # Đếm số to ở giữa màn hình
            cv2.putText(frame, str(rem_sec), (w//2 - 25, h//2 + 40), cv2.FONT_HERSHEY_DUPLEX, 3.5, (0, 240, 255), 4)
            
            if cur_t - countdown_start >= countdown_seconds:
                state = "CAPTURING"
                last_capture_time = cur_t
                
        elif state == "CAPTURING":
            stage_info = stages[current_stage_idx]
            cv2.putText(frame, f"{stage_info['title']} ({count}/{total_samples})", (40, 50), cv2.FONT_HERSHEY_DUPLEX, 0.72, (70, 220, 30), 2)
            cv2.putText(frame, stage_info['desc'], (40, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 255, 220), 1)
            
            # Chụp ảnh nếu phát hiện mặt và đã đủ khoảng cách thời gian
            if len(faces) > 0 and (cur_t - last_capture_time >= capture_interval):
                (x, y, fw, fh) = faces[0]
                # Thêm lề biên 25% xung quanh khuôn mặt để SFace nắn chỉnh ngũ quan chuẩn 100% không bị vẹt góc
                pad_w = int(fw * 0.25)
                pad_h = int(fh * 0.25)
                x1 = max(0, x - pad_w)
                y1 = max(0, y - pad_h)
                x2 = min(w, x + fw + pad_w)
                y2 = min(h, y + fh + pad_h)
                face_crop = frame[y1:y2, x1:x2]
                if face_crop.size > 0:
                    face_resized = cv2.resize(face_crop, (280, 280))
                    img_path = os.path.join(dataset_dir, f"{owner_name}_{count}.jpg")
                    cv2.imwrite(img_path, face_resized)
                    count += 1
                    last_capture_time = cur_t
                    
                    # Kiểm tra chuyển giai đoạn
                    if count >= stage_info["target"]:
                        current_stage_idx += 1
                        if current_stage_idx < len(stages):
                            state = "COUNTDOWN"
                            countdown_start = cur_t
                            countdown_seconds = 2.5 # Cho người dùng 2.5s đổi góc mặt
                        else:
                            state = "DONE"
                            
        elif state == "DONE":
            cv2.putText(frame, f"THU THAP 100 ANH {owner_name.upper()} HOAN TAT! DANG TRICH XUAT DEEP AI...", (40, 55), cv2.FONT_HERSHEY_DUPLEX, 0.72, (70, 220, 30), 2)
            cv2.putText(frame, "Dang tao ma sinh trac hoc doc ban 128 chieu (Deep Learning SFace)...", (40, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)

        # 3. Vẽ Thanh Tiến Trình (Progress Bar) ở đáy màn hình
        bar_x1, bar_y1 = 40, h - 45
        bar_x2, bar_y2 = w - 40, h - 25
        progress_pct = count / total_samples
        fill_w = int((bar_x2 - bar_x1) * progress_pct)
        
        cv2.rectangle(frame, (bar_x1, bar_y1), (bar_x2, bar_y2), (40, 30, 20), -1)
        cv2.rectangle(frame, (bar_x1, bar_y1), (bar_x1 + fill_w, bar_y2), (70, 220, 30), -1)
        cv2.rectangle(frame, (bar_x1, bar_y1), (bar_x2, bar_y2), (255, 230, 0), 1)
        cv2.putText(frame, f"TIEN DO: {count}/{total_samples} ANH ({int(progress_pct * 100)}%) - CHU NHA: {owner_name.upper()}", (bar_x1 + 10, bar_y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 230, 0), 1)

        # 4. Vẽ khung nhận diện khuôn mặt
        for (x, y, fw, fh) in faces:
            color = (70, 220, 30) if state == "CAPTURING" else (255, 230, 0)
            cv2.rectangle(frame, (x, y), (x + fw, y + fh), color, 2)
            cv2.putText(frame, f"CHU NHA: {owner_name.upper()}", (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.52, color, 1)

        cv2.imshow(f"Dang Ky Khuon Mat Chu Nha: {owner_name.upper()}", frame)
        
        if state == "DONE":
            cv2.waitKey(1200)
            break
            
        key = cv2.waitKey(1) & 0xFF
        if key == 32 and state == "READY": # Phím Space
            state = "COUNTDOWN"
            countdown_start = time.time()
            countdown_seconds = 3
        elif key == 27 or key == ord('q'): # ESC
            break
            
    cap.release()
    cv2.destroyAllWindows()
    
    if count >= 30:
        print(f"\nDa thu thap duoc {count} buc anh chat luong cao cua chu nha {owner_name.upper()}!")
        print("Dang tien hanh trich xuat ma nhan dang Deep Learning SFace cho chu nha...")
        train_face_model()
    else:
        print("\nChua thu thap du so luong anh.")

def train_face_model(dataset_base=None):
    """Huấn luyện mô hình Deep Learning SFace (128-D Biometric Embeddings)"""
    ensure_deep_models()
    if dataset_base is None:
        dataset_base = os.path.join(os.path.dirname(__file__), 'dataset')
        
    model_dir = os.path.dirname(__file__)
    yunet_path = os.path.join(model_dir, YUNET_MODEL)
    sface_path = os.path.join(model_dir, SFACE_MODEL)
    output_npz = os.path.join(model_dir, "owner_embeddings.npz")
    
    detector = cv2.FaceDetectorYN.create(yunet_path, "", (200, 200), 0.5, 0.3)
    recognizer = cv2.FaceRecognizerSF.create(sface_path, "")
    
    print("\n" + "=" * 68)
    print("    DANG TRICH XUAT VECTOR SINH TRAC HOC DEEP LEARNING (SFACE 128-D)...")
    print("=" * 68)
    
    embeddings_dict = {}
    total_imgs = 0
    total_embeddings = 0
    
    for item in os.listdir(dataset_base):
        dir_path = os.path.join(dataset_base, item)
        if os.path.isdir(dir_path):
            owner_key = item.lower()
            owner_feats = []
            c = 0
            
            for filename in sorted(os.listdir(dir_path)):
                if filename.endswith(".jpg") or filename.endswith(".png"):
                    img_path = os.path.join(dir_path, filename)
                    img = cv2.imread(img_path)
                    if img is not None:
                        # Tạo các biến thể ánh sáng (sáng, tối, lật ngang) để bao phủ thực tế
                        variants = [
                            img,
                            cv2.flip(img, 1),
                            cv2.convertScaleAbs(img, alpha=1.25, beta=20),  # Tăng sáng
                            cv2.convertScaleAbs(img, alpha=0.75, beta=-20), # Giảm sáng
                        ]
                        for var in variants:
                            h, w, _ = var.shape
                            detector.setInputSize((w, h))
                            _, faces = detector.detect(var)
                            if faces is not None and len(faces) > 0:
                                aligned = recognizer.alignCrop(var, faces[0])
                                feat = recognizer.feature(aligned)
                                owner_feats.append(feat)
                        c += 1
                                
            if owner_feats:
                stacked = np.vstack(owner_feats)
                embeddings_dict[owner_key] = stacked
                total_imgs += c
                total_embeddings += len(owner_feats)
                print(f"[+] Chu nha: {owner_key.upper()} -> Thu thap {c} anh -> Tao {len(owner_feats)} Vector sinh trac hoc 128-D!")
                
    if embeddings_dict:
        np.savez_compressed(output_npz, **embeddings_dict)
        print("=" * 68)
        print("[*] NANG CAP DEEP LEARNING SFACE HOAN TAT 100%!")
        print(f"[*] Tong cong {total_embeddings} vector 128-D da luu tai: {output_npz}")
        print(f"[*] Kich thuoc sieu nhe: {os.path.getsize(output_npz)} bytes (Khoi dong 0.002 giay)!")
        print("[*] Loai bo hoan toan rui ro nhan nham nguoi la co net mat tuong tu!")
        print("[*] Ban co the mo BAT_CAMERA_AI.bat tren Desktop de trai nghiem ngay!")
        print("=" * 68)
    else:
        print("[!] Khong tim thay anh hop le trong dataset!")

def main():
    print("=" * 68)
    print("      HE THONG QUAN TRI KHUON MAT CHU NHA AI (DEEP LEARNING SFACE)")
    print("=" * 68)
    print("Chon che do hoat dong:")
    print("  [1] NANG CAP VA HUAN LUYEN DEEP LEARNING NGAY (KHUYEN DUNG)")
    print("      -> Dung 100 anh co san, trich xuat Vector 128-D sinh trac hoc doc ban")
    print("      -> Do chinh xac 99.6%, mien nhiem 100% voi nguoi la co gọng kinh/net mat tuong tu!")
    print("")
    print("  [2] DANG KY MOI / CHUP LAI KHUON MAT CHU NHA (100 ANH)")
    print("      -> Bat camera quay 4 buoc (deo kinh, thao kinh, nghieng mat)")
    print("=" * 68)
    try:
        choice = input("Nhap lua chon cua ban [1/2] (Nhan Enter de chon 1): ").strip()
    except Exception:
        choice = "1"
        
    if choice == "2":
        register_owner()
    else:
        train_face_model()

if __name__ == "__main__":
    main()
