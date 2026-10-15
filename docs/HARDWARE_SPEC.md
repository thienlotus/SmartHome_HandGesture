# Hardware Specification & Electrical Wiring Guide

## 1. Pin Assignment Reference (Arduino Uno R3)

| Pin | Electrical Type | Component / Module | Function / Signal Description |
|---|---|---|---|
| **D7** | Digital Output | Active Piezo Buzzer (5V) | Auditory acknowledgment & SOS alert tone |
| **D8** | Digital Output | 5mm LED Indicator (White/Warm) | Room illumination (current-limited via 220Ω resistor) |
| **D9** | Digital PWM Output | TowerPro SG90 Micro Servo | Main door automated latch & swing (0° - 90°) |
| **D10** | Digital PWM Output | TowerPro SG90 Micro Servo | Window curtain roller mechanism (0° - 90°) |
| **D11** | Digital Output | 1-Channel Optocoupler Relay Module | AC/DC Fan load switching (Active LOW trigger) |
| **A4 (SDA)** | I2C Bus Data | I2C Backpack + LCD 1602 | Bidirectional synchronous serial data |
| **A5 (SCL)** | I2C Bus Clock | I2C Backpack + LCD 1602 | Synchronous bus clock line |
| **5V / GND** | Power Supply | Logic & Sensor Bus | Core 5V regulated logic supply |

---

## 2. Bill of Materials (BOM)

| Item | Component | Specification | Quantity | Primary Purpose |
|:---:|---|---|:---:|---|
| 1 | Microcontroller Board | Arduino Uno R3 (ATmega328P, 16MHz) | 1 | Real-time firmware execution & hardware I/O |
| 2 | Micro Servos | TowerPro SG90 (4.8V - 6V, 1.8 kg·cm) | 2 | Door swing & curtain roller mechanics |
| 3 | Alphanumeric Display | LCD 1602 with PCF8574 I2C Adapter | 1 | Television channel & system status telemetry |
| 4 | Power Switching Relay | 1-Channel 5V Relay with Optocoupler isolation | 1 | Fan load actuation |
| 5 | Audio Transducer | 5V Active Piezo Buzzer | 1 | Audible feedback & siren |
| 6 | Optical Emitter | 5mm High-Efficiency LED | 1 | Living room smart lighting |
| 7 | Passive Resistor | 220Ω Carbon Film 1/4W | 1 | Current limiter for LED diode protection |
| 8 | Auxiliary Power Supply | 5V DC 2.0A Regulated Power Adapter | 1 | Dedicated servo power rail |
| 9 | Vision Sensor | HD 720p/1080p USB WebCam (60 FPS support) | 1 | Real-time optical ingestion for Edge AI |

---

## 3. Power Distribution & Common Ground Integrity

> [!IMPORTANT]
> **Common Ground Rule**: When powering the two TowerPro SG90 servos from an external 5V 2A power adapter, the **GND (negative pole) of the external power supply MUST be bonded to the GND pin of the Arduino Uno**. Without a common ground reference, floating voltage levels will induce jitter and erratic PWM angles in the servos.

```plaintext
[ 5V 2A External Adapter ]
       +5V (Red Wire)    ───────────────────────> Servo VCC (Door & Curtain)
       GND (Black Wire)  ──────┬────────────────> Servo GND (Door & Curtain)
                               │
                               ▼ (Common Ground Bridge)
                     [ Arduino Uno GND Pin ]
```
