#include <Arduino.h>
#include <Wire.h>
#include <string.h>

/*
 * UNO R4 WiFi + MPU6050: เก็บจำนวน Encoder ทุก 1 องศาที่ PWM สูงสุด
 *
 * โปรแกรมนี้ใช้สำหรับคาลิเบรตเท่านั้น ไม่ใช่โค้ดแข่งจริง
 * เปิด Serial Monitor ที่ 230400 baud แล้วส่งคำสั่ง:
 *   R360  หมุนขวา 360 องศา
 *   L360  หมุนซ้าย 360 องศา
 *   R90   หมุนขวา 90 องศา
 *   L90   หมุนซ้าย 90 องศา
 *   R90,3500  หมุนขวา 90 องศาที่ PWM 3500
 *   ER29,26,2000  ทดสอบ Encoder-only หมุนขวาด้วยเป้า L/R 29/26
 *   EL29,28,2000  ทดสอบ Encoder-only หมุนซ้ายด้วยเป้า L/R 29/28
 *   X     หยุดฉุกเฉิน
 *
 * โปรแกรมไม่เริ่มหมุนเองหลังเปิดเครื่อง และพิมพ์ข้อมูล CSV หลังรถหยุดแล้ว
 * แนวติดตั้ง MPU6050: +X ชี้หน้ารถ, +Y ชี้ซ้ายรถ, +Z ชี้ขึ้น
 */

// -----------------------------------------------------------------------------
// Pin map ที่ยืนยันแล้ว
// -----------------------------------------------------------------------------
const uint8_t ENC_L = 2;
const uint8_t ENC_R = 3;

const uint8_t ENA = 5;
const uint8_t IN1 = 9;
const uint8_t IN2 = 8;
const uint8_t ENB = 10;
const uint8_t IN3 = 7;
const uint8_t IN4 = 6;

// โปรแกรมคาลิเบรตไม่สั่งอุปกรณ์สามตัวนี้ แต่ประกาศไว้ให้ตรวจผังสายได้
const uint8_t ULTRASONIC_TRIG_PIN = 13;
const uint8_t ULTRASONIC_ECHO_PIN = 12;
const uint8_t SERVO_PIN = 11;

// UNO R4 WiFi ใช้ขา SDA/SCL แยกสำหรับ I2C
const uint8_t MPU6050_ADDRESS = 0x68;

// -----------------------------------------------------------------------------
// Calibration settings
// -----------------------------------------------------------------------------
const uint16_t DEFAULT_TEST_PWM = 4095;
const uint16_t MIN_TEST_PWM = 2000;
const uint16_t ACTIVE_BRAKE_PWM = 4095;
const uint16_t ACTIVE_BRAKE_MS = 150;
const uint16_t SETTLE_AFTER_BRAKE_MS = 850;
const uint16_t GYRO_BIAS_SAMPLES = 1000;
const uint16_t GYRO_BIAS_SAMPLE_DELAY_US = 2000;
const uint16_t MAX_TARGET_DEGREES = 360;
const uint32_t MAX_RUN_TIME_MS = 12000;

// MPU6050 ตั้งช่วงวัด +/-1000 deg/s (32.8 LSB ต่อ deg/s)
// ช่วงนี้เหมาะกับการหมุน PWM สูงสุดมากกว่า +/-250 deg/s ที่อาจอิ่มตัว
const float GYRO_LSB_PER_DPS = 32.8f;
const float GYRO_SATURATION_DPS = 950.0f;

// จากการวัดเดิม: หมุนขวาแล้ว Gyro Z เป็นลบ
const int RIGHT_TURN_GYRO_SIGN = -1;

// การต่อมอเตอร์จริงกลับทิศจากชื่อคำสั่งเดิมในโปรแกรมจำลอง
const bool INVERT_TURN_DIRECTION = true;

struct DegreeSample {
  uint32_t elapsedUs;
  uint32_t encoderLeft;
  uint32_t encoderRight;
  float measuredAngleDeg;
  float gyroRateDps;
};

DegreeSample degreeSamples[MAX_TARGET_DEGREES + 1];
uint16_t degreeSampleCount = 0;

volatile uint32_t encoderLeft = 0;
volatile uint32_t encoderRight = 0;

float gyroBiasRaw = 0.0f;
float yawDeg = 0.0f;
float lastGyroRateDps = 0.0f;
uint32_t previousGyroUs = 0;
uint32_t runNumber = 0;
uint16_t gyroReadErrors = 0;
uint16_t currentTestPWM = DEFAULT_TEST_PWM;

char commandBuffer[24];
uint8_t commandLength = 0;

void encoderLeftISR() { encoderLeft++; }
void encoderRightISR() { encoderRight++; }

void readEncoders(uint32_t &left, uint32_t &right) {
  noInterrupts();
  left = encoderLeft;
  right = encoderRight;
  interrupts();
}

void resetEncoders() {
  noInterrupts();
  encoderLeft = 0;
  encoderRight = 0;
  interrupts();
}

void stopMotors() {
  analogWrite(ENA, 0);
  analogWrite(ENB, 0);
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
}

void setActiveBrake() {
  // L298: ขาทิศทางทั้งสองฝั่ง LOW และ Enable HIGH ทำให้มอเตอร์หยุดแบบ short brake
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  analogWrite(ENA, ACTIVE_BRAKE_PWM);
  analogWrite(ENB, ACTIVE_BRAKE_PWM);
}

void setLogicalTurnDirection(int logicalDirection) {
  const int physicalDirection = INVERT_TURN_DIRECTION
                              ? -logicalDirection
                              : logicalDirection;
  if (physicalDirection > 0) {
    digitalWrite(IN1, HIGH);
    digitalWrite(IN2, LOW);
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, HIGH);
  } else {
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, HIGH);
    digitalWrite(IN3, HIGH);
    digitalWrite(IN4, LOW);
  }
}

bool writeMPU(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU6050_ADDRESS);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readMPURegister(uint8_t reg, uint8_t &value) {
  Wire.beginTransmission(MPU6050_ADDRESS);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU6050_ADDRESS, (uint8_t)1) != 1) return false;
  value = Wire.read();
  return true;
}

bool readGyroZRaw(int16_t &raw) {
  for (uint8_t attempt = 0; attempt < 3; attempt++) {
    Wire.beginTransmission(MPU6050_ADDRESS);
    Wire.write(0x47); // GYRO_ZOUT_H
    if (Wire.endTransmission(false) == 0
        && Wire.requestFrom(MPU6050_ADDRESS, (uint8_t)2) == 2
        && Wire.available() >= 2) {
      const uint8_t highByte = Wire.read();
      const uint8_t lowByte = Wire.read();
      raw = (int16_t)(((uint16_t)highByte << 8) | lowByte);
      return true;
    }
    while (Wire.available()) Wire.read();
    delayMicroseconds(200);
  }
  return false;
}

bool configureMPU6050() {
  uint8_t whoAmI = 0;
  if (!readMPURegister(0x75, whoAmI)) return false;
  if (whoAmI != 0x68 && whoAmI != 0x69) return false;

  if (!writeMPU(0x6B, 0x00)) return false; // Wake up
  delay(100);
  if (!writeMPU(0x1B, 0x10)) return false; // +/-1000 deg/s
  if (!writeMPU(0x1A, 0x03)) return false; // DLPF ~44 Hz
  if (!writeMPU(0x19, 0x00)) return false; // 1 kHz sample rate
  delay(100);
  return true;
}

bool initializeMPU6050() {
  Wire.begin();
  Wire.setClock(100000);
  delay(100);
  return configureMPU6050();
}

bool recoverMPU6050() {
  // เรียกเฉพาะตอนมอเตอร์หยุดแล้ว เพราะเวลาระหว่างกู้บัสไม่มีข้อมูลมุม
  stopMotors();
  Wire.end();
  delay(20);
  Wire.begin();
  Wire.setClock(100000);
  delay(100);
  return configureMPU6050();
}

bool calibrateGyroBias() {
  int64_t total = 0;
  uint16_t valid = 0;
  for (uint16_t i = 0; i < GYRO_BIAS_SAMPLES; i++) {
    int16_t raw;
    if (readGyroZRaw(raw)) {
      total += raw;
      valid++;
    }
    delayMicroseconds(GYRO_BIAS_SAMPLE_DELAY_US);
  }
  if (valid < (GYRO_BIAS_SAMPLES * 9UL) / 10UL) return false;
  gyroBiasRaw = (float)total / valid;
  return true;
}

bool updateGyro() {
  int16_t raw;
  if (!readGyroZRaw(raw)) {
    gyroReadErrors++;
    return false;
  }

  const uint32_t nowUs = micros();
  float dt = (nowUs - previousGyroUs) / 1000000.0f;
  previousGyroUs = nowUs;
  if (dt <= 0.0f || dt > 0.05f) return false;

  lastGyroRateDps = (raw - gyroBiasRaw) / GYRO_LSB_PER_DPS;
  yawDeg += lastGyroRateDps * dt;
  return true;
}

bool emergencyStopRequested() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == 'X' || c == 'x') return true;
  }
  return false;
}

void captureDegree(uint16_t degree, uint32_t startedUs, float progressDeg) {
  if (degree > MAX_TARGET_DEGREES) return;
  uint32_t left, right;
  readEncoders(left, right);
  degreeSamples[degree].elapsedUs = micros() - startedUs;
  degreeSamples[degree].encoderLeft = left;
  degreeSamples[degree].encoderRight = right;
  degreeSamples[degree].measuredAngleDeg = progressDeg;
  degreeSamples[degree].gyroRateDps = lastGyroRateDps;
  degreeSampleCount = degree + 1;
}

void printCSV(int direction,
              uint16_t targetDeg,
              const char *status,
              float cutAngleDeg,
              float finalAngleDeg,
              uint32_t cutLeft,
              uint32_t cutRight,
              uint32_t finalLeft,
              uint32_t finalRight,
              uint32_t motionTimeMs,
              float maxRateDps) {
  const char directionChar = direction > 0 ? 'R' : 'L';

  Serial.println(F("CSV_BEGIN"));
  Serial.println(F("run_id,direction,pwm,target_degree,time_us,gyro_angle_deg,encoder_left,encoder_right,delta_left,delta_right,gyro_rate_dps"));
  uint32_t previousLeft = 0;
  uint32_t previousRight = 0;
  for (uint16_t degree = 0; degree < degreeSampleCount; degree++) {
    const DegreeSample &sample = degreeSamples[degree];
    Serial.print(runNumber);
    Serial.print(',');
    Serial.print(directionChar);
    Serial.print(',');
    Serial.print(currentTestPWM);
    Serial.print(',');
    Serial.print(degree);
    Serial.print(',');
    Serial.print(sample.elapsedUs);
    Serial.print(',');
    Serial.print(sample.measuredAngleDeg, 4);
    Serial.print(',');
    Serial.print(sample.encoderLeft);
    Serial.print(',');
    Serial.print(sample.encoderRight);
    Serial.print(',');
    Serial.print(sample.encoderLeft - previousLeft);
    Serial.print(',');
    Serial.print(sample.encoderRight - previousRight);
    Serial.print(',');
    Serial.println(sample.gyroRateDps, 4);
    previousLeft = sample.encoderLeft;
    previousRight = sample.encoderRight;
  }
  Serial.println(F("CSV_END"));

  Serial.println(F("SUMMARY_BEGIN"));
  Serial.println(F("run_id,direction,pwm,target_deg,status,cut_angle_deg,final_angle_deg,overshoot_deg,cut_left,cut_right,final_left,final_right,motion_time_ms,max_abs_rate_dps,gyro_read_errors,gyro_bias_raw"));
  Serial.print(runNumber);
  Serial.print(',');
  Serial.print(directionChar);
  Serial.print(',');
  Serial.print(currentTestPWM);
  Serial.print(',');
  Serial.print(targetDeg);
  Serial.print(',');
  Serial.print(status);
  Serial.print(',');
  Serial.print(cutAngleDeg, 4);
  Serial.print(',');
  Serial.print(finalAngleDeg, 4);
  Serial.print(',');
  Serial.print(finalAngleDeg - targetDeg, 4);
  Serial.print(',');
  Serial.print(cutLeft);
  Serial.print(',');
  Serial.print(cutRight);
  Serial.print(',');
  Serial.print(finalLeft);
  Serial.print(',');
  Serial.print(finalRight);
  Serial.print(',');
  Serial.print(motionTimeMs);
  Serial.print(',');
  Serial.print(maxRateDps, 4);
  Serial.print(',');
  Serial.print(gyroReadErrors);
  Serial.print(',');
  Serial.println(gyroBiasRaw, 4);
  Serial.println(F("SUMMARY_END"));
}

void runCalibration(int direction,
                    uint16_t targetDeg,
                    uint16_t testPWM,
                    bool encoderStop = false,
                    uint16_t encoderTargetLeft = 0,
                    uint16_t encoderTargetRight = 0) {
  runNumber++;
  currentTestPWM = testPWM;
  stopMotors();
  Serial.println();
  Serial.print(F("RUN "));
  Serial.print(runNumber);
  Serial.println(F(": keep robot completely still; calibrating gyro bias..."));

  // ตรวจและตั้งค่า MPU ใหม่ทุกรอบ เผื่อแรงดันตกหรือสัญญาณรบกวนทำให้เซนเซอร์ reset
  if (!configureMPU6050() && !recoverMPU6050()) {
    Serial.println(F("ERROR: MPU6050_NOT_RESPONDING - power cycle before continuing"));
    return;
  }

  if (!calibrateGyroBias()) {
    Serial.println(F("Gyro bias failed; restarting I2C and retrying once..."));
    if (!recoverMPU6050() || !calibrateGyroBias()) {
      Serial.println(F("ERROR: GYRO_BIAS_CALIBRATION_FAILED - power cycle before continuing"));
      return;
    }
  }

  Serial.print(F("Gyro bias raw = "));
  Serial.println(gyroBiasRaw, 4);
  for (int count = 3; count >= 1; count--) {
    Serial.print(F("Starting in "));
    Serial.println(count);
    delay(1000);
  }

  resetEncoders();
  degreeSampleCount = 0;
  gyroReadErrors = 0;
  yawDeg = 0.0f;
  lastGyroRateDps = 0.0f;
  float maxAbsRateDps = 0.0f;
  const int progressSign = RIGHT_TURN_GYRO_SIGN * direction;
  const uint32_t startedUs = micros();
  const uint32_t startedMs = millis();
  previousGyroUs = startedUs;
  captureDegree(0, startedUs, 0.0f);
  uint16_t nextDegree = 1;
  const char *status = "OK";

  setLogicalTurnDirection(direction);
  analogWrite(ENA, currentTestPWM);
  analogWrite(ENB, currentTestPWM);

  float progressDeg = 0.0f;
  while (true) {
    if (emergencyStopRequested()) {
      status = "EMERGENCY_STOP";
      break;
    }

    if (!updateGyro()) {
      if (gyroReadErrors > 10) {
        status = "GYRO_READ_ERROR";
        break;
      }
      continue;
    }

    const float absRate = fabs(lastGyroRateDps);
    if (absRate > maxAbsRateDps) maxAbsRateDps = absRate;
    if (absRate >= GYRO_SATURATION_DPS) {
      status = "GYRO_RANGE_SATURATED";
      break;
    }

    progressDeg = progressSign * yawDeg;
    while (nextDegree <= targetDeg && progressDeg >= nextDegree) {
      captureDegree(nextDegree, startedUs, progressDeg);
      nextDegree++;
    }

    if (encoderStop) {
      uint32_t left, right;
      readEncoders(left, right);
      if (left >= encoderTargetLeft && right >= encoderTargetRight) {
        status = "ENCODER_OK";
        break;
      }

      // ใช้วิธีเดียวกับโค้ดสนามจริง: คง PWM 2000 และเพิ่มแรงเฉพาะล้อที่ตามหลัง
      float expectedRight = (float)left
                          * ((float)encoderTargetRight / (float)encoderTargetLeft);
      long syncError = (long)right - (long)expectedRight;
      int correction = constrain((int)(syncError * 8), -250, 250);
      int pwmLeft = currentTestPWM;
      int pwmRight = currentTestPWM;
      if (correction > 0) pwmLeft += correction;
      else if (correction < 0) pwmRight -= correction;
      analogWrite(ENA, constrain(pwmLeft, 0, 4095));
      analogWrite(ENB, constrain(pwmRight, 0, 4095));
    } else if (progressDeg >= targetDeg) {
      break;
    }
    if (millis() - startedMs > 400 && progressDeg < -8.0f) {
      status = "WRONG_DIRECTION";
      break;
    }
    if (millis() - startedMs >= MAX_RUN_TIME_MS) {
      status = "TIMEOUT";
      break;
    }
  }

  uint32_t cutLeft, cutRight;
  readEncoders(cutLeft, cutRight);
  const float cutAngleDeg = progressSign * yawDeg;
  const uint32_t motionTimeMs = millis() - startedMs;

  // อ่าน Gyro ต่อระหว่าง active brake เพื่อวัดมุมไหลเกินจริง
  setActiveBrake();
  const uint32_t brakeStartedMs = millis();
  while (millis() - brakeStartedMs < ACTIVE_BRAKE_MS) updateGyro();
  stopMotors();
  const uint32_t settleStartedMs = millis();
  while (millis() - settleStartedMs < SETTLE_AFTER_BRAKE_MS) updateGyro();

  uint32_t finalLeft, finalRight;
  readEncoders(finalLeft, finalRight);
  const float finalAngleDeg = progressSign * yawDeg;

  printCSV(direction,
           targetDeg,
           status,
           cutAngleDeg,
           finalAngleDeg,
           cutLeft,
           cutRight,
           finalLeft,
           finalRight,
           motionTimeMs,
           maxAbsRateDps);
  if (gyroReadErrors > 0) {
    Serial.print(F("MPU_RECOVERY_AFTER_RUN="));
    Serial.println(recoverMPU6050() ? F("OK") : F("FAILED_POWER_CYCLE_REQUIRED"));
  }
  Serial.println(F("READY: reposition robot, then send the next command."));
}

void processCommand(char *line) {
  if (line[0] == '\0') return;
  const char command = (char)toupper(line[0]);
  if (command == 'X') {
    stopMotors();
    Serial.println(F("EMERGENCY STOP"));
    return;
  }
  if (command == 'E') {
    const char directionCommand = (char)toupper(line[1]);
    if (directionCommand != 'R' && directionCommand != 'L') {
      Serial.println(F("ERROR: encoder replay uses ER29,26,2000 or EL29,28,2000"));
      return;
    }

    char *leftText = line + 2;
    char *rightSeparator = strchr(leftText, ',');
    if (rightSeparator == nullptr) {
      Serial.println(F("ERROR: encoder replay requires left,right,pwm"));
      return;
    }
    *rightSeparator = '\0';
    char *rightText = rightSeparator + 1;
    char *pwmSeparator = strchr(rightText, ',');
    if (pwmSeparator == nullptr) {
      Serial.println(F("ERROR: encoder replay requires left,right,pwm"));
      return;
    }
    *pwmSeparator = '\0';

    const long targetLeft = atol(leftText);
    const long targetRight = atol(rightText);
    const long requestedPWM = atol(pwmSeparator + 1);
    if (targetLeft < 1 || targetLeft > 200 || targetRight < 1 || targetRight > 200) {
      Serial.println(F("ERROR: encoder targets must be 1..200 ticks"));
      return;
    }
    if (requestedPWM < MIN_TEST_PWM || requestedPWM > 4095) {
      Serial.println(F("ERROR: PWM must be 2000..4095"));
      return;
    }
    runCalibration(directionCommand == 'R' ? 1 : -1,
                   90,
                   (uint16_t)requestedPWM,
                   true,
                   (uint16_t)targetLeft,
                   (uint16_t)targetRight);
    return;
  }
  if (command != 'R' && command != 'L') {
    Serial.println(F("ERROR: use R90, L90, ER29,26,2000, EL29,28,2000, or X"));
    return;
  }

  long requestedAngle = line[1] == '\0' ? 360 : atol(line + 1);
  if (requestedAngle < 1 || requestedAngle > MAX_TARGET_DEGREES) {
    Serial.println(F("ERROR: angle must be 1..360 degrees"));
    return;
  }

  long requestedPWM = DEFAULT_TEST_PWM;
  char *separator = strchr(line, ',');
  if (separator != nullptr) requestedPWM = atol(separator + 1);
  if (requestedPWM < MIN_TEST_PWM || requestedPWM > 4095) {
    Serial.println(F("ERROR: PWM must be 2000..4095"));
    return;
  }
  runCalibration(command == 'R' ? 1 : -1,
                 (uint16_t)requestedAngle,
                 (uint16_t)requestedPWM);
}

void readSerialCommands() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\r' || c == '\n') {
      if (commandLength > 0) {
        commandBuffer[commandLength] = '\0';
        processCommand(commandBuffer);
        commandLength = 0;
      }
    } else if (commandLength < sizeof(commandBuffer) - 1) {
      commandBuffer[commandLength++] = c;
    }
  }
}

void setup() {
  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(ENC_L, INPUT);
  pinMode(ENC_R, INPUT);

  analogWriteResolution(12);
  attachInterrupt(digitalPinToInterrupt(ENC_L), encoderLeftISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_R), encoderRightISR, CHANGE);
  stopMotors();

  Serial.begin(230400);
  const uint32_t serialWaitStarted = millis();
  while (!Serial && millis() - serialWaitStarted < 3000) {}

  Serial.println(F("UNO R4 WiFi Gyro + Encoder angle calibration"));
  Serial.println(F("MPU orientation: +X forward, +Y left, +Z up"));
  Serial.println(F("Pins: ENC L=2 R=3 | motors=5..10 | TRIG=13 ECHO=12 SERVO=11 | MPU6050=SDA/SCL 0x68"));
  Serial.println(F("Default motor test PWM: 4095 (use R90,3500 to select another PWM)"));

  if (!initializeMPU6050()) {
    Serial.println(F("FATAL: MPU6050 not found at I2C address 0x68"));
    while (true) {
      stopMotors();
      delay(1000);
    }
  }

  Serial.println(F("READY. Commands: R360, L360, R90, L90, R90,3500, ER29,26,2000, EL29,28,2000, X"));
}

void loop() {
  readSerialCommands();
}
