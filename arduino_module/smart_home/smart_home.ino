#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>

// ====================================================================
// ĐỊNH NGHĨA CHÂN KẾT NỐI (PINOUT MAPPING)
// ====================================================================
const int BUZZER_PIN       = 7;   // Còi báo Buzzer 5V
const int LED_PIN          = 8;   // Đèn LED chiếu sáng (Digital D8 qua trở 220Ω)
const int SERVO_DOOR_PIN   = 9;   // Servo Cửa tự động (SG90)
const int SERVO_CURTAIN_PIN= 10;  // Servo Rèm cửa (SG90)
const int FAN_RELAY_PIN    = 11;  // Relay điều khiển Quạt (Mức LOW kích đóng relay)

// ====================================================================
// KHỞI TẠO ĐỐI TƯỢNG VÀ BIẾN TOÀN CỤC
// ====================================================================
// Màn hình LCD 1602 I2C (Địa chỉ mặc định 0x27 hoặc 0x3F)
LiquidCrystal_I2C lcd(0x27, 16, 2);

Servo servoDoor;
Servo servoCurtain;

// Trạng thái các thiết bị
bool ledState     = false;
bool fanState     = false;
bool tvState      = false;
bool doorState    = false; // false = Đóng (0 độ), true = Mở (90 độ)
bool curtainState = false; // false = Thả (0 độ), true = Cuộn (90 độ)
bool sosActive    = false;
bool hasLcd       = false; // Cờ kiểm tra phần cứng LCD có kết nối không

// Hàm phát tiếng bíp qua Buzzer
void beep(int times, int durationMs, int pauseMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(durationMs);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < times - 1) delay(pauseMs);
  }
}

// Cập nhật hiển thị màn hình LCD (Tivi mô phỏng)
void updateTvDisplay() {
  if (!hasLcd) return; // Nếu không cắm LCD thì bỏ qua, không làm chậm CPU
  lcd.backlight();
  lcd.clear();
  if (tvState) {
    lcd.setCursor(0, 0);
    lcd.print("TV: NETFLIX [ON]");
    lcd.setCursor(0, 1);
    lcd.print("CH: 03  VOL: 25 ");
  } else {
    lcd.setCursor(0, 0);
    lcd.print("TV: [STANDBY]   ");
    lcd.setCursor(0, 1);
    lcd.print("SMART HOME READY");
  }
}

void setup() {
  // Khởi động cổng Serial tốc độ 9600 để giao tiếp với AI Python
  Serial.begin(9600);
  
  // Cấu hình các chân I/O
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(FAN_RELAY_PIN, OUTPUT);
  
  // Trạng thái ban đầu: Tắt hết thiết bị
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(FAN_RELAY_PIN, LOW);  // Tắt quạt ban đầu (Mức LOW)
  
  // Gắn chân và giữ vị trí ban đầu cho Servo (Cửa đóng 0 độ, Rèm hạ 0 độ)
  servoDoor.attach(SERVO_DOOR_PIN);
  servoCurtain.attach(SERVO_CURTAIN_PIN);
  servoDoor.write(0);      // Ban đầu: Cửa đóng 0 độ
  servoCurtain.write(0);  // Ban đầu: Rèm hạ 0 độ
  
  // Chống treo vi điều khiển nếu màn hình LCD I2C chưa cắm hoặc sai địa chỉ
  Wire.begin();
  Wire.setWireTimeout(25000, true); // 25ms timeout với tự động reset bus I2C

  // Quét kiểm tra sự tồn tại của LCD ở địa chỉ 0x27 hoặc 0x3F
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() == 0) {
    hasLcd = true;
    lcd = LiquidCrystal_I2C(0x27, 16, 2);
  } else {
    Wire.beginTransmission(0x3F);
    if (Wire.endTransmission() == 0) {
      hasLcd = true;
      lcd = LiquidCrystal_I2C(0x3F, 16, 2);
    }
  }

  if (hasLcd) {
    lcd.init();
    lcd.backlight();
    updateTvDisplay();
    Serial.println("LCD_INIT_OK");
  } else {
    Serial.println("LCD_NOT_FOUND_SKIPPING");
  }
  
  // Bíp 2 tiếng chào khởi động hệ thống
  beep(2, 80, 80);
  
  // Báo sẵn sàng ở cuối setup để đảm bảo Arduino đã khởi tạo hoàn tất
  Serial.println("ARDUINO_READY");
}

void loop() {
  // Xử lý báo động SOS nếu đang kích hoạt
  if (sosActive) {
    digitalWrite(BUZZER_PIN, HIGH);
    digitalWrite(LED_PIN, HIGH);
    delay(150);
    digitalWrite(BUZZER_PIN, LOW);
    digitalWrite(LED_PIN, LOW);
    delay(150);
  }

  // Đọc lệnh gửi từ Python AI qua cổng Serial
  if (Serial.available() > 0) {
    char cmd = Serial.read();
    
    // Tắt còi SOS nếu nhận bất kỳ lệnh điều khiển nào khác
    if (cmd != 'S') {
      sosActive = false;
      digitalWrite(BUZZER_PIN, LOW);
    }
    
    switch (cmd) {
      // 1. MỞ CỬA (Lệnh 'O' - Victory / Chữ V)
      case 'O':
        doorState = true;
        servoDoor.write(90); // Mở cửa 90 độ
        beep(1, 100, 0);
        Serial.println("ACK: CUA_MO_90");
        break;
        
      // ĐÓNG CỬA (Lệnh 'C')
      case 'C':
        doorState = false;
        servoDoor.write(0);  // Đóng cửa 0 độ
        beep(1, 50, 0);
        Serial.println("ACK: CUA_DONG_0");
        break;

      // 2. CUỘN RÈM (Lệnh 'U' - Kéo rèm lên)
      case 'U':
        curtainState = true;
        servoCurtain.write(90); // Cuộn kéo rèm lên 90 độ
        beep(1, 80, 0);
        Serial.println("ACK: REM_CUON_LEN");
        break;

      // 3. THẢ RÈM (Lệnh 'D' - Thả rèm xuống)
      case 'D':
        curtainState = false;
        servoCurtain.write(0);  // Thả rèm xuống 0 độ
        beep(1, 80, 0);
        Serial.println("ACK: REM_THA_XUONG");
        break;

      // 4. BẬT ĐÈN (Lệnh 'A' - Pointing Up)
      case 'A':
        ledState = true;
        digitalWrite(LED_PIN, HIGH); // LED Digital D8 sáng
        Serial.println("ACK: DEN_ON");
        break;

      // 5. BẬT / TẮT QUẠT (Lệnh 'F' - Open Palm)
      case 'F':
        fanState = !fanState; // Đảo trạng thái quạt
        digitalWrite(FAN_RELAY_PIN, fanState ? HIGH : LOW); // HIGH = Bật Quạt, LOW = Tắt Quạt
        beep(1, 60, 0);
        Serial.print("ACK: QUAT_");
        Serial.println(fanState ? "ON" : "OFF");
        break;

      // 6. TIVI MÔ PHỎNG (Lệnh 'T' - OK Sign)
      case 'T':
        tvState = !tvState; // Đảo trạng thái TV
        updateTvDisplay();
        beep(1, 70, 0);
        Serial.print("ACK: TV_");
        Serial.println(tvState ? "ON" : "OFF");
        break;

      // 7. TẮT TẤT CẢ (Lệnh 'B' - Closed Fist Nắm đấm)
      case 'B':
        ledState = false;
        fanState = false;
        tvState  = false;
        doorState = false;
        curtainState = false;
        sosActive = false;
        
        digitalWrite(LED_PIN, LOW);
        digitalWrite(FAN_RELAY_PIN, LOW);  // Tắt quạt
        digitalWrite(BUZZER_PIN, LOW);
        servoDoor.write(0);      // Đóng cửa 0 độ
        servoCurtain.write(0);  // Thả rèm 0 độ
        updateTvDisplay();
        beep(2, 60, 60);
        Serial.println("ACK: TAT_TAT_CA");
        break;

      // 8. BÁO ĐỘNG SOS (Lệnh 'S' - ILoveYou)
      case 'S':
        sosActive = true;
        Serial.println("ACK: CANH_BAO_SOS");
        break;

      // 9. NHẬN DIỆN CHỦ NHÀ (Lệnh 'H' - Host)
      case 'H':
        // Còi bíp 2 tiếng chào đón
        beep(2, 100, 80);
        digitalWrite(LED_PIN, HIGH);
        ledState = true;
        doorState = true;
        servoDoor.write(90); // Mở cửa đón chủ nhà 90 độ
        Serial.println("ACK: CHU_NHA_VE");
        break;

      // 10. NHẬN DIỆN KHÁCH / NGƯỜI LẠ (Lệnh 'G' - Guest)
      case 'G':
        // Còi cảnh báo 3 tiếng
        beep(3, 150, 100);
        Serial.println("ACK: PHAT_HIEN_KHACH_LA");
        break;
        
      default:
        break;
    }
  }
}
