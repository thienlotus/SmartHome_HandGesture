#include <Wire.h>

void setup() {
  Wire.begin();
  Serial.begin(9600);
  while (!Serial);
  Serial.println("\nI2C Scanner dang quet...");
  
  byte count = 0;
  for (byte i = 1; i < 127; i++) {
    Wire.beginTransmission(i);
    if (Wire.endTransmission() == 0) {
      Serial.print("Tim thay thiet bi I2C tai dia chi: 0x");
      if (i < 16) Serial.print("0");
      Serial.print(i, HEX);
      Serial.println(" !");
      count++;
      delay(1);
    }
  }
  if (count == 0) {
    Serial.println("KHONG TIM THAY THIET BI I2C NAO! Kiem tra lai day SDA(A4), SCL(A5), VCC, GND.");
  } else {
    Serial.println("Quet I2C hoan tat.");
  }
}

void loop() {
  delay(5000);
}
