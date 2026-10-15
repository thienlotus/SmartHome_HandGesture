import sys
import serial
import serial.tools.list_ports
import time

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

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

port = get_arduino_port()
print("=" * 65)
print("     CÔNG CỤ KIỂM TRA PHẦN CỨNG TRỰC TIẾP (HARDWARE DIAGNOSTIC)")
print("=" * 65)
print(f"[*] Đang kết nối tới Arduino trên cổng: {port}...")

try:
    ser = serial.Serial(port, 9600, timeout=1.5)
    time.sleep(2.0) # Đợi Arduino bootloader
    while ser.in_waiting > 0:
        line = ser.readline().decode(errors='ignore').strip()
        if line:
            print(f"[ARDUINO BOOT] {line}")
    print("[+] Kết nối Serial thành công!\n")
except Exception as e:
    print(f"[-] LỖI: Không thể mở cổng {port}: {e}")
    print("Vui lòng tắt phần mềm Camera AI hoặc Serial Monitor đang chiếm cổng rồi thử lại.")
    input("\nBấm Enter để thoát...")
    sys.exit(1)

def send_and_listen(cmd_char, desc):
    print(f"\n---> GỬI LỆNH: '{cmd_char}' ({desc})")
    ser.write(cmd_char.encode())
    ser.flush()
    time.sleep(0.3)
    found_ack = False
    start_t = time.time()
    while time.time() - start_t < 1.2:
        if ser.in_waiting > 0:
            line = ser.readline().decode(errors='ignore').strip()
            if line:
                print(f"     [ARDUINO PHẢN HỒI] -> {line}")
                found_ack = True
        time.sleep(0.05)
    if not found_ack:
        print("     [CẢNH BÁO] Không nhận được phản hồi ACK từ Arduino!")

def auto_test_all():
    print("\n" + "=" * 50)
    print("BẮT ĐẦU CHU TRÌNH TEST TỰ ĐỘNG TOÀN BỘ PHẦN CỨNG")
    print("=" * 50)
    
    print("\n[BƯỚC 1] TEST CỬA CHÍNH (SERVO CHÂN D9):")
    send_and_listen('O', 'Mở cửa 90 độ')
    time.sleep(1.5)
    send_and_listen('C', 'Đóng cửa 0 độ')
    time.sleep(1.0)
    
    print("\n[BƯỚC 2] TEST RÈM CỬA (SERVO CHÂN D10):")
    send_and_listen('U', 'Kéo rèm lên 90 độ')
    time.sleep(1.5)
    send_and_listen('D', 'Hạ rèm xuống 0 độ')
    time.sleep(1.0)
    
    print("\n[BƯỚC 3] TEST ĐÈN CHIẾU SÁNG (CHÂN D8):")
    send_and_listen('A', 'Bật đèn LED')
    time.sleep(1.0)
    
    print("\n[BƯỚC 4] TEST QUẠT (CHÂN D11 QUA RELAY):")
    send_and_listen('F', 'Bật quạt (Relay ON)')
    time.sleep(1.5)
    send_and_listen('F', 'Tắt quạt (Relay OFF)')
    time.sleep(1.0)

    print("\n[BƯỚC 5] TẮT TOÀN BỘ THIẾT BỊ:")
    send_and_listen('B', 'Tắt hết')
    
    print("\n" + "=" * 50)
    print("HOÀN TẤT CHU TRÌNH TEST TỰ ĐỘNG!")
    print("=" * 50)

while True:
    print("\n" + "-" * 50)
    print("MENU ĐIỀU KHIỂN & CHẨN ĐOÁN PHẦN CỨNG:")
    print("  [1] Mở cửa (Chân D9 -> 90 độ)")
    print("  [2] Đóng cửa (Chân D9 -> 0 độ)")
    print("  [3] Kéo rèm lên (Chân D10 -> 90 độ)")
    print("  [4] Hạ rèm xuống (Chân D10 -> 0 độ)")
    print("  [5] Bật / Tắt Quạt (Chân D11 qua Relay)")
    print("  [6] Bật Đèn (Chân D8)")
    print("  [7] CHẠY TEST TỰ ĐỘNG TOÀN BỘ THIẾT BỊ")
    print("  [8] Tắt hết thiết bị (Lệnh 'B')")
    print("  [0] Thoát")
    print("-" * 50)
    
    choice = input("Chọn chức năng (0-8): ").strip()
    if choice == '1':
        send_and_listen('O', 'Mở cửa 90 độ (Chân D9)')
    elif choice == '2':
        send_and_listen('C', 'Đóng cửa 0 độ (Chân D9)')
    elif choice == '3':
        send_and_listen('U', 'Kéo rèm lên 90 độ (Chân D10)')
    elif choice == '4':
        send_and_listen('D', 'Hạ rèm xuống 0 độ (Chân D10)')
    elif choice == '5':
        send_and_listen('F', 'Bật/Tắt Quạt (Chân D11 Relay)')
    elif choice == '6':
        send_and_listen('A', 'Bật đèn LED (Chân D8)')
    elif choice == '7':
        auto_test_all()
    elif choice == '8':
        send_and_listen('B', 'Tắt hết toàn bộ')
    elif choice == '0':
        print("\nĐã ngắt kết nối. Tạm biệt!")
        ser.close()
        break
    else:
        print("[!] Lựa chọn không hợp lệ, vui lòng chọn từ 0 đến 8.")
