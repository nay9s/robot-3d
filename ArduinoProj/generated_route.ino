/*
 * =====================================================================
 * Robot Arena Autonomous Route - Closed-Loop Encoder Controller
 * สร้างอัตโนมัติจาก Robot Arena 3D Simulator
 * ขาพินและพารามิเตอร์อิงจาก: ArduinoProj/combined_state_sequence.ino
 * คำเตือน: โปรไฟล์ Encoder-only ยังอยู่ระหว่างยืนยัน ผลล่าสุดคลาดเคลื่อนสูงสุดประมาณ 32°
 *
 * ข้อมูลการคำนวณ:
 *   - เป้าหมาย: ช่องออก 39 นิ้ว (Regular Exit)
 *   - แต้มลูกเต๋า: ทิศทาง: ขวา | กล่องซ้าย: 7 | กล่องขวา: 12
 *   - ระยะทางรวม: 4.50 เมตร (450.0 ซม.)
 *   - เวลาประมาณการ: 7.87 วินาที
 *   - จำนวนสเต็ป: 6 คำสั่ง
 *   - Calibrate @ PWM 2000: 45°/90°/180° แยกทิศและล้อจาก Settings
 *   - ตัวคูณระยะทางตรง: 1.000
 *   - ระบบพิกัด Odometry: เปิดใช้งาน (ติดตาม X, Z เมตร)
 *   - ระบบ Ultrasonic HC-SR04: เปิดใช้งาน (TRIG: Pin 13, ECHO: Pin 12, หยุดฉุกเฉิน 25 cm)
 *   - สแกนช่องว่างด้วย Servo: เปิด (กลาง 90°, กวาด ±45°, ช่องเปิด 45 cm)
 * =====================================================================
 */

#include <Arduino.h>
#ifndef ENCODER_MOTION_H
#define ENCODER_MOTION_H
#include <math.h>

// Encoder-only control math. Units: cm, seconds, PWM normalized to 0..1.
// Calibration targets remain STOP-COMMAND counts, not measured body angles.
namespace EncoderMotion {
inline float clamp(float x, float lo, float hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}
inline float lesser(float a, float b) { return a < b ? a : b; }

// Conditional integration: allow unwinding, but do not integrate further
// into actuator saturation. Call using the complete feedforward + P output.
inline float integrate(float integral, float error, float dt, float ki,
                       float base, float lo, float hi, float limit) {
  float candidate = clamp(integral + error * dt, -limit, limit);
  float output = base + ki * candidate;
  if ((output > hi && error > 0) || (output < lo && error < 0)) return integral;
  return candidate;
}

struct References { float left; float right; };
class Profile {
  float speed;
public:
  Profile() : speed(0) {}
  References step(float left, float right, float targetL, float targetR,
                  float cmPerTick, float cruise, float crawl,
                  float acceleration, float deceleration, float dt) {
    return step(left, right, targetL, targetR, cmPerTick, cmPerTick,
                cruise, crawl, acceleration, deceleration, dt);
  }
  References step(float left, float right, float targetL, float targetR,
                  float leftCmPerTick, float rightCmPerTick,
                  float cruise, float crawl,
                  float acceleration, float deceleration, float dt) {
    References out = {0, 0};
    if (targetL <= 0 || targetR <= 0) return out;
    float lengthL = targetL * leftCmPerTick, lengthR = targetR * rightCmPerTick;
    float longest = lengthL > lengthR ? lengthL : lengthR;
    float ratioL = lengthL / longest, ratioR = lengthR / longest;
    float remainingL = fmaxf(0, targetL - left) * leftCmPerTick / ratioL;
    float remainingR = fmaxf(0, targetR - right) * rightCmPerTick / ratioR;
    // Use the lagging wheel's remaining path; never resume a completed wheel.
    float remaining = fmaxf(remainingL, remainingR);
    float allowed = fminf(cruise, fmaxf(crawl, sqrtf(2 * deceleration * remaining)));
    speed = clamp(allowed, fmaxf(0, speed - deceleration * dt), speed + acceleration * dt);
    // Progress difference expressed as equivalent cm on the longer wheel path.
    float mismatch = (left / targetL - right / targetR) * longest;
    float correction = clamp(0.8f * mismatch, -3.0f, 3.0f);
    out.left = left >= targetL ? 0 : clamp(speed * ratioL - correction, 0, cruise);
    out.right = right >= targetR ? 0 : clamp(speed * ratioR + correction, 0, cruise);
    return out;
  }
};

class Wheel {
  unsigned long sampleMs, sampleTicks;
  float velocity, integral;
  bool ready;
public:
  Wheel(unsigned long now) : sampleMs(now), sampleTicks(0), velocity(0), integral(0), ready(false) {}
  float measuredSpeed() const { return velocity; }
  int update(unsigned long now, unsigned long ticks, float reference,
             float cmPerTick, int pwmMax, float ceiling, float feedforwardOffset = 0) {
    unsigned long elapsed = now - sampleMs;
    unsigned long delta = ticks - sampleTicks;
    if (elapsed >= 100 && (delta >= 2 || elapsed >= 200)) {
      float dt = elapsed * 0.001f;
      float measured = delta * cmPerTick / dt;
      velocity = ready ? 0.6f * measured + 0.4f * velocity : measured;
      ready = true;
      float base = feedforwardOffset + (47.5f / 4095.0f) * reference
                 + (30.0f / 4095.0f) * (reference - velocity);
      if (reference > 0)
        integral = integrate(integral, reference - velocity, dt,
                             25.0f / 4095.0f, base, 0, ceiling, 50);
      sampleMs = now;
      sampleTicks = ticks;
    }
    if (reference <= 0) { integral = 0; return 0; }
    float output = feedforwardOffset + (47.5f / 4095.0f) * reference
                 + (30.0f / 4095.0f) * (reference - velocity)
                 + (25.0f / 4095.0f) * integral;
    return (int)lroundf(clamp(output, 0, ceiling) * pwmMax);
  }
};
}
#endif

#include <Servo.h>

#ifndef max
#define max(a,b) (((a)>(b))?(a):(b))
#endif
#ifndef min
#define min(a,b) (((a)<(b))?(a):(b))
#endif

// =====================================================================
// 1. PIN ASSIGNMENTS (จาก ArduinoProj/combined_state_sequence.ino)
// =====================================================================
const int ENA = 5;   // PWM ควบคุมความเร็วมอเตอร์ A
const int IN1 = 9;   // ทิศทางมอเตอร์ A1
const int IN2 = 8;   // ทิศทางมอเตอร์ A2

const int ENB = 10;  // PWM ควบคุมความเร็วมอเตอร์ B
const int IN3 = 7;   // ทิศทางมอเตอร์ B1
const int IN4 = 6;   // ทิศทางมอเตอร์ B2

#define ENC_L 2      // สัญญาณ Encoder ล้อซ้าย (Interrupt Pin 2)
#define ENC_R 3      // สัญญาณ Encoder ล้อขวา (Interrupt Pin 3)
const int SERVO_PIN = 11; // Servo หมุน HC-SR04 เพื่อสแกนซ้าย–กลาง–ขวา

// =====================================================================
// 2. HARDWARE CONSTANTS & CALIBRATION
// =====================================================================
const float ENCODER_SLOTS_PER_REV  = 20.0f;
const float ENCODER_COUNTS_PER_REV = 40.0f;  // นับทั้ง RISING และ FALLING (CHANGE)
const float WHEEL_CIRCUMFERENCE_CM = 22.0f;  // เส้นรอบวงล้อ (cm)
const float CM_PER_TICK = WHEEL_CIRCUMFERENCE_CM / ENCODER_COUNTS_PER_REV; // ~0.55 cm ต่อ 1 count
const float LEFT_CM_PER_TICK = 0.5500f;
const float RIGHT_CM_PER_TICK = 0.5500f;
const float STRAIGHT_DISTANCE_SCALE = 1.000f; // เพิ่มเมื่อรถวิ่งจริงสั้นกว่าคำสั่ง

// ตารางจุดสั่ง active brake ปรับได้ก่อนปล่อยรถจากหน้า Settings
const float TURN_RIGHT_LEFT_TICKS_45   = 14.50f;
const float TURN_RIGHT_RIGHT_TICKS_45  = 13.00f;
const float TURN_RIGHT_LEFT_TICKS_90   = 30.00f;
const float TURN_RIGHT_RIGHT_TICKS_90  = 27.00f;
const float TURN_RIGHT_LEFT_TICKS_180  = 58.00f;
const float TURN_RIGHT_RIGHT_TICKS_180 = 52.00f;
const float TURN_LEFT_LEFT_TICKS_45    = 14.50f;
const float TURN_LEFT_RIGHT_TICKS_45   = 14.00f;
const float TURN_LEFT_LEFT_TICKS_90    = 29.00f;
const float TURN_LEFT_RIGHT_TICKS_90   = 28.00f;
const float TURN_LEFT_LEFT_TICKS_180   = 58.00f;
const float TURN_LEFT_RIGHT_TICKS_180  = 56.00f;

// =====================================================================
// 3. ULTRASONIC HC-SR04 SENSOR & POSE TRACKER
// =====================================================================
#define USE_ULTRASONIC 1
#define USE_FRONT_GAP_SCAN 1
#if USE_ULTRASONIC
const int TRIG_PIN = 13;
const int ECHO_PIN = 12;
const float ULTRASONIC_EMERGENCY_STOP_CM = 25.0f; // ระยะหยุดฉุกเฉิน (Virtual Bumper)
#endif
#if USE_FRONT_GAP_SCAN
const int SERVO_CENTER_DEG = 90;
const int SERVO_SCAN_OFFSET_DEG = 45;
const float ULTRASONIC_OPEN_DISTANCE_CM = 45.0f;
const unsigned long SERVO_SETTLE_MS = 180;
Servo ultrasonicServo;
#endif

// ตัวแปรจำพิกัด Odometry Pose Tracker (X, Z เมตร และมุมสะสมในสนาม 3x3 ม.)
float robotX = 1.05f;           // พิกัด X เริ่มต้น (เมตร)
float robotZ = -1.00f;          // พิกัด Z เริ่มต้น (เมตร)
float robotHeadingDeg = 90.0f; // ทิศทางเริ่มต้น (ขวา)

// ความเร็วและการควบคุม (คำนวณอัตโนมัติตามสูตร Calibrate จริงจาก combined_state_sequence.ino)
// - 12-bit Uno R4/ESP32: speed (cm/s) * 47.5f | เลี้ยว = 2000 จากผลสนามจริง
// - 8-bit Uno R3/Nano: speed (cm/s) * ~2.96f | เลี้ยว = 125
const int PWM_MAX = 4095;
const int CRUISE_PWM = 4095;
const float DRIVE_SPEED_CM_S = 70.0f;
const int TURN_PWM   = 2000;
const bool INVERT_TURN_DIRECTION = true;
const unsigned long PAUSE_BETWEEN_STEPS_MS = 500;

// =====================================================================
// 4. ROUTE STEPS DATA
// =====================================================================
enum StepType {
  STEP_FORWARD,
  STEP_REVERSE,
  STEP_TURN_LEFT,
  STEP_TURN_RIGHT,
  STEP_TURN_AROUND
};

enum MotionResult {
  MOTION_OK,
  MOTION_TIMEOUT,
  MOTION_OBSTACLE,
  MOTION_STALL,
  MOTION_SETTLE_TIMEOUT,
  MOTION_INVALID
};

struct RobotStep {
  StepType type;
  float value;        // ระยะทาง (cm) หรือ องศาหมุน (deg)
  const char* label;  // คำอธิบายคำสั่ง
};

const RobotStep ROUTE_STEPS[] = {
  { STEP_TURN_RIGHT ,    90.0f, "หมุนขวา 90°" }, // [1]
  { STEP_FORWARD    ,   220.0f, "เดินหน้า 2.20 เมตร" }, // [2]
  { STEP_TURN_RIGHT ,    90.0f, "หมุนขวา 90°" }, // [3]
  { STEP_FORWARD    ,   170.0f, "เดินหน้า 1.70 เมตร" }, // [4]
  { STEP_TURN_RIGHT ,    90.0f, "หมุนขวา 90°" }, // [5]
  { STEP_REVERSE    ,    60.0f, "ถอยหลัง 0.60 เมตร" }, // [6]
};
const int TOTAL_STEPS = sizeof(ROUTE_STEPS) / sizeof(ROUTE_STEPS[0]);

// =====================================================================
// 5. GLOBAL ENCODER VARIABLES & ISR
// =====================================================================
volatile unsigned long encoderL = 0;
volatile unsigned long encoderR = 0;

void ISR_encoderL() { encoderL++; }
void ISR_encoderR() { encoderR++; }

void resetEncoders() {
  noInterrupts();
  encoderL = 0;
  encoderR = 0;
  interrupts();
}

void readEncoders(unsigned long &left, unsigned long &right) {
  noInterrupts();
  left = encoderL;
  right = encoderR;
  interrupts();
}

// =====================================================================
// 6. LOW-LEVEL MOTOR CONTROLS
// =====================================================================
void stopMotors() {
  analogWrite(ENA, 0);
  analogWrite(ENB, 0);
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
}

void setMotorSpeed(int pwmL, int pwmR) {
  analogWrite(ENA, constrain(pwmL, 0, PWM_MAX));
  analogWrite(ENB, constrain(pwmR, 0, PWM_MAX));
}

void motorForwardDirection() {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
}

void motorReverseDirection() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
}

int physicalTurnDirection(int logicalDirection) {
  return INVERT_TURN_DIRECTION ? -logicalDirection : logicalDirection;
}

void motorRotateDirection(int logicalDirection) {
  int direction = physicalTurnDirection(logicalDirection);
  if (direction > 0) {
    // หมุนขวา: ซ้ายเดินหน้า, ขวาถอยหลัง
    digitalWrite(IN1, HIGH);
    digitalWrite(IN2, LOW);
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, HIGH);
  } else {
    // หมุนซ้าย: ซ้ายถอยหลัง, ขวาเดินหน้า
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, HIGH);
    digitalWrite(IN3, HIGH);
    digitalWrite(IN4, LOW);
  }
}

void activeBrake(unsigned long durationMs = 150) {
  // ช็อตขั้วมอเตอร์ลงกราวด์เพื่อหยุดรถทันที (ลดการไหลเกินระยะ)
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  analogWrite(ENA, PWM_MAX);
  analogWrite(ENB, PWM_MAX);
  delay(durationMs);
  stopMotors();
}

#if USE_ULTRASONIC
// =====================================================================
// 7. ULTRASONIC SENSOR FUNCTIONS
// =====================================================================
// อ่านระยะทางจากเซนเซอร์ Ultrasonic HC-SR04 (หน่วยเป็นเซนติเมตร)
float readUltrasonicDistanceCM() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 25000); // 25ms timeout (~4.2 เมตร)
  if (duration <= 0) return -1.0f;
  return (duration * 0.0343f) / 2.0f;
}

// อ่าน 3 ครั้งแล้วใช้ค่ากลาง ลดค่ากระโดดจากพื้นเอียง/ขอบกล่อง
float readUltrasonicMedianCM() {
  float samples[3];
  int count = 0;
  for (int i = 0; i < 3; i++) {
    float value = readUltrasonicDistanceCM();
    if (value >= 2.0f && value <= 250.0f) samples[count++] = value;
    delay(12);
  }
  if (count == 0) return -1.0f;
  for (int i = 0; i < count - 1; i++) {
    for (int j = i + 1; j < count; j++) {
      if (samples[j] < samples[i]) {
        float temp = samples[i];
        samples[i] = samples[j];
        samples[j] = temp;
      }
    }
  }
  return samples[count / 2];
}

#if USE_FRONT_GAP_SCAN
float scanAtServoAngle(int angleDeg) {
  ultrasonicServo.write(constrain(angleDeg, 0, 180));
  delay(SERVO_SETTLE_MS);
  return readUltrasonicMedianCM();
}

void printScanDistance(const __FlashStringHelper* label, float distanceCM) {
  Serial.print(label);
  if (distanceCM < 0.0f) Serial.print(F(">250/ไม่พบ"));
  else {
    Serial.print(distanceCM, 1);
    Serial.print(F(" cm"));
  }
}

// รถหยุดนิ่งระหว่างกวาด เพื่อไม่ให้ Servo ชี้เฉียงขณะกำลังวิ่ง
bool scanFrontGap(float &leftCM, float &centerCM, float &rightCM) {
  stopMotors();
  ultrasonicServo.attach(SERVO_PIN);
  leftCM = scanAtServoAngle(SERVO_CENTER_DEG + SERVO_SCAN_OFFSET_DEG);
  centerCM = scanAtServoAngle(SERVO_CENTER_DEG);
  rightCM = scanAtServoAngle(SERVO_CENTER_DEG - SERVO_SCAN_OFFSET_DEG);
  ultrasonicServo.write(SERVO_CENTER_DEG);
  delay(SERVO_SETTLE_MS);
  ultrasonicServo.detach();

  Serial.print(F("🔎 ช่องว่างด้านหน้า | "));
  printScanDistance(F("ซ้าย "), leftCM);
  Serial.print(F(" | "));
  printScanDistance(F("กลาง "), centerCM);
  Serial.print(F(" | "));
  printScanDistance(F("ขวา "), rightCM);
  Serial.println();
  return leftCM >= 0.0f || centerCM >= 0.0f || rightCM >= 0.0f;
}

bool verifyFrontGapBeforeMove(float plannedDistanceCM) {
  float leftCM = -1.0f;
  float centerCM = -1.0f;
  float rightCM = -1.0f;
  if (!scanFrontGap(leftCM, centerCM, rightCM)) {
    Serial.println(F("⚠️ Ultrasonic ไม่ตอบสนองทั้ง 3 ทิศ -> ไม่เริ่มเดินหน้า"));
    return false;
  }

  // ถ้ากลางไม่สะท้อนภายใน 250 cm ให้ถือว่าโล่งไกล แต่ถ้าวัดได้ต้องพอสำหรับ
  // ระยะคำสั่งสั้น ๆ + ระยะเบรก และไม่บังคับเกินค่าช่องเปิดที่ผู้ใช้กำหนด
  float requiredCM = min(ULTRASONIC_OPEN_DISTANCE_CM,
                         plannedDistanceCM + ULTRASONIC_EMERGENCY_STOP_CM);
  bool centerOpen = centerCM < 0.0f || centerCM >= requiredCM;
  if (centerOpen) {
    Serial.print(F("✓ ทางกลางพร้อม ระยะขั้นต่ำที่ต้องการ "));
    Serial.print(requiredCM, 1);
    Serial.println(F(" cm"));
    return true;
  }

  float leftComparable = leftCM < 0.0f ? 251.0f : leftCM;
  float rightComparable = rightCM < 0.0f ? 251.0f : rightCM;
  Serial.print(F("⛔ ทางกลางแคบเกินไป (ต้องการ "));
  Serial.print(requiredCM, 1);
  Serial.print(F(" cm) | ช่องที่กว้างกว่าอยู่ทาง"));
  Serial.println(leftComparable >= rightComparable ? F("ซ้าย") : F("ขวา"));
  Serial.println(F("หยุดเพื่อรักษาเส้นทางเดิม ไม่หมุนหลบเองโดยไม่มีแผนสนาม"));
  return false;
}
#endif

// สแกนเทียบระยะกำแพงเพื่อ Calibrate ลบล้างความคลาดเคลื่อนสะสม (Landmark Localization)
void checkAndCalibrateWall(float expectedWallDistanceCM) {
  float measured = readUltrasonicDistanceCM();
  if (measured > 4.0f && measured < 150.0f) {
    Serial.print(F("📍 Ultrasonic วัดระยะกำแพงได้: "));
    Serial.print(measured, 1);
    Serial.print(F(" cm (ค่าอ้างอิง: "));
    Serial.print(expectedWallDistanceCM, 1);
    Serial.println(F(" cm)"));
  }
}
#endif

// =====================================================================
// 8. CLOSED-LOOP MOTION FUNCTIONS
// =====================================================================
// Single-channel encoders: no pulses is only an indication of rest.
// Require both a minimum observation interval and a quiet window, with a deadline.
bool waitForEncoderStop() {
  unsigned long start = millis(), lastChange = start;
  unsigned long oldL, oldR;
  readEncoders(oldL, oldR);
  while (millis() - start < 2000) {
    unsigned long left, right;
    readEncoders(left, right);
    unsigned long now = millis();
    if (left != oldL || right != oldR) { lastChange = now; oldL = left; oldR = right; }
    if (now - start >= 500 && now - lastChange >= 200) return true;
    delay(5);
  }
  return false;
}

// Shared Encoder-only runner: target counts refer to the brake command.
// Gains/profile changed: existing turn tables must be revalidated on the floor.
MotionResult runEncoderTargets(unsigned long targetL, unsigned long targetR,
                               bool turning, bool reverse,
                               unsigned long timeoutMs) {
  unsigned long start = millis(), previous = start;
  unsigned long lastL = start, lastR = start, oldL = 0, oldR = 0;
  unsigned long lastSensor = start, oneDoneSince = 0;
  EncoderMotion::Profile profile;
  EncoderMotion::Wheel wheelL(start), wheelR(start);
  MotionResult result = MOTION_OK;
  unsigned long left = 0, right = 0;
  const float cruise = turning ? 25.0f : DRIVE_SPEED_CM_S;
  // Preserve user PWM ceiling. Do not force a larger output than Settings allow.
  const float ceiling = turning ? 2400.0f / 4095.0f
                                : (float)CRUISE_PWM / PWM_MAX;
  while (true) {
    readEncoders(left, right);
    unsigned long now = millis();
    if (left != oldL) { lastL = now; oldL = left; }
    if (right != oldR) { lastR = now; oldR = right; }
    bool doneL = left >= targetL, doneR = right >= targetR;
    if (doneL && doneR) break;
    if (doneL != doneR) {
      if (!oneDoneSince) oneDoneSince = now;
      if (now - oneDoneSince >= 500) { result = MOTION_TIMEOUT; break; }
    } else oneDoneSince = 0;
    if ((!doneL && now - lastL >= 2000) || (!doneR && now - lastR >= 2000)) {
      result = MOTION_STALL;
      break;
    }
    if (now - start >= timeoutMs) { result = MOTION_TIMEOUT; break; }
#if USE_ULTRASONIC
    if (!turning && !reverse && now - lastSensor >= 35) {
      lastSensor = now;
      float distance = readUltrasonicDistanceCM();
      if (distance > 0 && distance < ULTRASONIC_EMERGENCY_STOP_CM) {
        // หยุดทันทีเมื่อพบระยะอันตราย แล้วอ่านซ้ำขณะรถหยุด
        // ค่าที่อ่านไม่ได้ในรอบสองถือเป็นสิ่งกีดขวางเพื่อความปลอดภัย
        stopMotors();
        float confirmed = readUltrasonicDistanceCM();
        Serial.print(F("FRONT_DISTANCE_CM first/confirm: "));
        Serial.print(distance, 1); Serial.print('/'); Serial.println(confirmed, 1);
        if (confirmed <= 0 || confirmed < ULTRASONIC_EMERGENCY_STOP_CM) {
          result = MOTION_OBSTACLE;
          break;
        }
        motorForwardDirection();
      }
    }
#endif
    // pulseIn อาจรอได้ 25 ms; ใช้ค่าติ๊กและเวลาหลังการอ่านเซนเซอร์
    readEncoders(left, right);
    now = millis();
    if (left != oldL) { lastL = now; oldL = left; }
    if (right != oldR) { lastR = now; oldR = right; }
    if (left >= targetL && right >= targetR) break;
    float dt = (now - previous) * 0.001f;
    previous = now;
    EncoderMotion::References refs = profile.step(left, right, targetL, targetR,
      LEFT_CM_PER_TICK, RIGHT_CM_PER_TICK, cruise, 10.0f, 30.0f, 40.0f, dt);
    float offset = turning ? 600.0f / 4095.0f : 0;
    int pwmL = wheelL.update(now, left, refs.left, LEFT_CM_PER_TICK, PWM_MAX, ceiling, offset);
    int pwmR = wheelR.update(now, right, refs.right, RIGHT_CM_PER_TICK, PWM_MAX, ceiling, offset);
    if (now - start < 200) {
      int startup = min((int)(2000.0f / 4095.0f * PWM_MAX), (int)(ceiling * PWM_MAX));
      if (!left && refs.left > 0) pwmL = startup;
      if (!right && refs.right > 0) pwmR = startup;
    }
    setMotorSpeed(doneL ? 0 : pwmL, doneR ? 0 : pwmR);
    delay(5);
  }
  Serial.print(F("STOP_COUNTS L/R: ")); Serial.print(left); Serial.print('/'); Serial.println(right);
  activeBrake(180);
  if (!waitForEncoderStop() && result == MOTION_OK) result = MOTION_SETTLE_TIMEOUT;
  unsigned long finalL, finalR;
  readEncoders(finalL, finalR);
  Serial.print(F("FINAL_COUNTS L/R: ")); Serial.print(finalL); Serial.print('/'); Serial.println(finalR);
  Serial.print(F("COAST_COUNTS L/R: ")); Serial.print(finalL - left); Serial.print('/'); Serial.println(finalR - right);
  Serial.print(F("MOTION_RESULT: ")); Serial.println((int)result);
  if (result == MOTION_OK) delay(PAUSE_BETWEEN_STEPS_MS);
  return result;
}

MotionResult runStraightDistance(float distanceCM, bool isReverse) {
  if (!isfinite(distanceCM) || distanceCM < 0) return MOTION_INVALID;
  if (distanceCM <= 0.1f) return MOTION_OK;
  resetEncoders();
  if (isReverse) motorReverseDirection(); else motorForwardDirection();
  unsigned long targetL = max(1UL, (unsigned long)lroundf(distanceCM / LEFT_CM_PER_TICK * STRAIGHT_DISTANCE_SCALE));
  unsigned long targetR = max(1UL, (unsigned long)lroundf(distanceCM / RIGHT_CM_PER_TICK * STRAIGHT_DISTANCE_SCALE));
  unsigned long timeout = 5000UL + (unsigned long)(distanceCM * STRAIGHT_DISTANCE_SCALE / DRIVE_SPEED_CM_S * 3000);
  MotionResult result = runEncoderTargets(targetL, targetR, false, isReverse, timeout);
  unsigned long left, right;
  readEncoders(left, right);
  // Nominal estimate only: heading/slip is not independently measured.
  float moveM = (isReverse ? -1 : 1) * (left * LEFT_CM_PER_TICK + right * RIGHT_CM_PER_TICK) * 0.005f;
  robotX += moveM * sin(robotHeadingDeg * 0.0174532925f);
  robotZ += moveM * cos(robotHeadingDeg * 0.0174532925f);
  return result;
}

float interpolateTurnTicks(float degrees, float ticks45, float ticks90, float ticks180) {
  if (degrees <= 45.0f) return ticks45 * (degrees / 45.0f);
  if (degrees <= 90.0f) {
    return ticks45 + (ticks90 - ticks45) * ((degrees - 45.0f) / 45.0f);
  }
  if (degrees <= 180.0f) {
    return ticks90 + (ticks180 - ticks90) * ((degrees - 90.0f) / 90.0f);
  }
  return ticks180 * (degrees / 180.0f);
}

MotionResult runInPlaceTurn(float targetDeg, int direction) {
  if (!isfinite(targetDeg) || targetDeg < 0) return MOTION_INVALID;
  if (targetDeg <= 0.5f) return MOTION_INVALID;
  float targetLeft = direction > 0
    ? interpolateTurnTicks(targetDeg, TURN_RIGHT_LEFT_TICKS_45, TURN_RIGHT_LEFT_TICKS_90, TURN_RIGHT_LEFT_TICKS_180)
    : interpolateTurnTicks(targetDeg, TURN_LEFT_LEFT_TICKS_45, TURN_LEFT_LEFT_TICKS_90, TURN_LEFT_LEFT_TICKS_180);
  float targetRight = direction > 0
    ? interpolateTurnTicks(targetDeg, TURN_RIGHT_RIGHT_TICKS_45, TURN_RIGHT_RIGHT_TICKS_90, TURN_RIGHT_RIGHT_TICKS_180)
    : interpolateTurnTicks(targetDeg, TURN_LEFT_RIGHT_TICKS_45, TURN_LEFT_RIGHT_TICKS_90, TURN_LEFT_RIGHT_TICKS_180);
  if (!isfinite(targetLeft) || !isfinite(targetRight) || targetLeft < 1.0f || targetRight < 1.0f)
    return MOTION_INVALID;
  resetEncoders();
  motorRotateDirection(direction);
  MotionResult result = runEncoderTargets(max(1UL, (unsigned long)lroundf(targetLeft)),
    max(1UL, (unsigned long)lroundf(targetRight)), true, false,
    5000UL + (unsigned long)(targetDeg * 80));
  // Stop-count tables include braking behavior; counts/target is NOT an angle sensor.
  // Retain the nominal planned heading only on success. Never print it as measured.
  if (result == MOTION_OK) {
    robotHeadingDeg -= direction > 0 ? targetDeg : -targetDeg;
    while (robotHeadingDeg > 180) robotHeadingDeg -= 360;
    while (robotHeadingDeg <= -180) robotHeadingDeg += 360;
    Serial.print(F("NOMINAL_HEADING (not measured): ")); Serial.println(robotHeadingDeg);
  }
  return result;
}

// =====================================================================
// 9. ARDUINO SETUP & EXECUTION
// =====================================================================
void setup() {
  Serial.begin(115200);
  Serial.println(F("ENCODER_PROFILE_V3: RECALIBRATE TURN TABLES; RESULT 0=OK 1=TIMEOUT 2=OBSTACLE 3=STALL 4=SETTLE 5=INVALID"));
  delay(500);

  Serial.println(F("=================================================="));
  Serial.println(F("   ROBOT ARENA - CLOSED LOOP RUNNER INITIALIZING  "));
  Serial.println(F("=================================================="));
  Serial.print(F("เป้าหมาย: ")); Serial.println(F("ช่องออก 39 นิ้ว (Regular Exit)"));
  Serial.print(F("จำนวนคำสั่ง: ")); Serial.println(TOTAL_STEPS);
  Serial.print(F("ระยะทางรวม: ")); Serial.print(4.50); Serial.println(F(" m"));

  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);

  pinMode(ENC_L, INPUT);
  pinMode(ENC_R, INPUT);

#if USE_ULTRASONIC
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);
  Serial.println(F("ระบบเซนเซอร์ Ultrasonic HC-SR04: เปิดใช้งาน"));
  Serial.print(F("  - TRIG Pin: ")); Serial.println(TRIG_PIN);
  Serial.print(F("  - ECHO Pin: ")); Serial.println(ECHO_PIN);
  Serial.print(F("  - ระยะหยุดฉุกเฉิน (Bumper): ")); Serial.print(ULTRASONIC_EMERGENCY_STOP_CM); Serial.println(F(" cm"));
#if USE_FRONT_GAP_SCAN
  Serial.println(F("  - สแกนช่องว่างด้วย Servo: เปิด"));
  Serial.print(F("  - Servo กลาง/ช่วงกวาด: ")); Serial.print(SERVO_CENTER_DEG);
  Serial.print(F("° / ±")); Serial.print(SERVO_SCAN_OFFSET_DEG); Serial.println(F("°"));
  Serial.print(F("  - ระยะถือว่าเป็นช่องเปิด: ")); Serial.print(ULTRASONIC_OPEN_DISTANCE_CM); Serial.println(F(" cm"));
#endif
#else
  Serial.println(F("ระบบเซนเซอร์ Ultrasonic HC-SR04: ปิดใช้งาน"));
#endif
  Serial.print(F("พิกัดเริ่มต้น (Odometry): X=")); Serial.print(robotX, 2);
  Serial.print(F(" m, Z=")); Serial.print(robotZ, 2);
  Serial.print(F(" m, Heading=")); Serial.print(robotHeadingDeg, 1); Serial.println(F("°"));

  analogWriteResolution(12); // เปิดใช้งาน 12-bit PWM สำหรับ Uno R4 / ESP32

  attachInterrupt(digitalPinToInterrupt(ENC_L), ISR_encoderL, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_R), ISR_encoderR, CHANGE);

  stopMotors();
  Serial.println(F("พร้อมเริ่มวิ่งใน 2 วินาที..."));
  delay(2000);

  for (int i = 0; i < TOTAL_STEPS; i++) {
    MotionResult motionResult = MOTION_OK;
    Serial.print(F("["));
    Serial.print(i + 1);
    Serial.print(F("/"));
    Serial.print(TOTAL_STEPS);
    Serial.print(F("] กำลังทำ: "));
    Serial.println(ROUTE_STEPS[i].label);

    switch (ROUTE_STEPS[i].type) {
      case STEP_FORWARD:
#if USE_FRONT_GAP_SCAN
        if (!verifyFrontGapBeforeMove(ROUTE_STEPS[i].value)) {
          motionResult = MOTION_OBSTACLE;
          break;
        }
#endif
        motionResult = runStraightDistance(ROUTE_STEPS[i].value, false);
        break;
      case STEP_REVERSE:
        motionResult = runStraightDistance(ROUTE_STEPS[i].value, true);
        break;
      case STEP_TURN_LEFT:
        motionResult = runInPlaceTurn(ROUTE_STEPS[i].value, -1);
        break;
      case STEP_TURN_RIGHT:
        motionResult = runInPlaceTurn(ROUTE_STEPS[i].value, 1);
        break;
      case STEP_TURN_AROUND:
        motionResult = runInPlaceTurn(180.0f, 1);
        break;
    }
    if (motionResult != MOTION_OK) {
      stopMotors();
      Serial.println(F("✗ ยกเลิกคำสั่งที่เหลือเพื่อความปลอดภัย (ABORTED)"));
      return;
    }
  }

  stopMotors();
  Serial.println(F("=================================================="));
  Serial.println(F("   ✓ วิ่งครบทุกขั้นตอนเรียบร้อยแล้ว (COMPLETED)   "));
  Serial.println(F("=================================================="));
}

void loop() {
  // สิ้นสุดการทำงานแล้ว อยู่เฉยๆ
  delay(1000);
}
