/*
 * UNO R4 WiFi - Straight distance calibration
 * Pins match Robot Arena generated code.
 *
 * Serial Monitor 115200, Newline:
 *   F100  = เดินหน้าเป้า 100 cm
 *   R100  = ถอยหลังเป้า 100 cm
 *   M87.5 = หลังวัดด้วยตลับเมตรได้ 87.5 cm ให้คำนวณ scale
 *   P4095 = เปลี่ยน PWM
 */

#include <Arduino.h>

const int ENA = 5;
const int IN1 = 9;
const int IN2 = 8;
const int ENB = 10;
const int IN3 = 7;
const int IN4 = 6;
const int ENC_L = 2;
const int ENC_R = 3;

const float CM_PER_TICK = 22.0f / 40.0f;
const int PWM_MAX = 4095;
const int PWM_MIN = 1500;
const int MAX_CORRECTION = 500;
const float KP_SYNC = 15.0f;

volatile unsigned long encoderL = 0;
volatile unsigned long encoderR = 0;
int drivePWM = 4095;
float lastCommandCM = 0.0f;

void isrEncoderL() { encoderL++; }
void isrEncoderR() { encoderR++; }

void readEncoders(unsigned long &left, unsigned long &right) {
  noInterrupts();
  left = encoderL;
  right = encoderR;
  interrupts();
}

void resetEncoders() {
  noInterrupts();
  encoderL = 0;
  encoderR = 0;
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

void setDirection(bool reverse) {
  digitalWrite(IN1, reverse ? LOW : HIGH);
  digitalWrite(IN2, reverse ? HIGH : LOW);
  digitalWrite(IN3, reverse ? LOW : HIGH);
  digitalWrite(IN4, reverse ? HIGH : LOW);
}

void activeBrake() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  analogWrite(ENA, PWM_MAX);
  analogWrite(ENB, PWM_MAX);
  delay(150);
  stopMotors();
}

void runDistance(float commandCM, bool reverse) {
  if (commandCM <= 0.0f) return;
  lastCommandCM = commandCM;
  const unsigned long targetTicks = (unsigned long)lroundf(commandCM / CM_PER_TICK);
  const unsigned long timeoutMs = 5000UL + (unsigned long)(commandCM * 100.0f);
  const unsigned long startMs = millis();
  resetEncoders();
  setDirection(reverse);

  Serial.print(F("RUN,"));
  Serial.print(reverse ? F("REVERSE,") : F("FORWARD,"));
  Serial.print(commandCM, 1);
  Serial.print(F(",TARGET_TICKS,"));
  Serial.println(targetTicks);

  unsigned long left = 0;
  unsigned long right = 0;
  bool timeout = false;
  while (true) {
    readEncoders(left, right);
    const bool leftDone = left >= targetTicks;
    const bool rightDone = right >= targetTicks;
    if (leftDone && rightDone) break;
    if (millis() - startMs >= timeoutMs) {
      timeout = true;
      break;
    }

    const long error = (long)right - (long)left;
    const int correction = constrain((int)(error * KP_SYNC), -MAX_CORRECTION, MAX_CORRECTION);
    int pwmL = leftDone ? 0 : drivePWM;
    int pwmR = rightDone ? 0 : drivePWM;
    if (!leftDone && !rightDone && correction > 0) {
      const int boostLeft = min(correction, PWM_MAX - pwmL);
      pwmL += boostLeft;
      pwmR -= correction - boostLeft;
    } else if (!leftDone && !rightDone && correction < 0) {
      const int magnitude = -correction;
      const int boostRight = min(magnitude, PWM_MAX - pwmR);
      pwmR += boostRight;
      pwmL -= magnitude - boostRight;
    }
    analogWrite(ENA, constrain(pwmL, 0, PWM_MAX));
    analogWrite(ENB, constrain(pwmR, 0, PWM_MAX));
    delay(5);
  }

  activeBrake();
  readEncoders(left, right);
  Serial.print(timeout ? F("TIMEOUT,") : F("DONE,"));
  Serial.print(F("L,"));
  Serial.print(left);
  Serial.print(F(",R,"));
  Serial.print(right);
  Serial.print(F(",ENCODER_CM,"));
  Serial.println(((left + right) * 0.5f) * CM_PER_TICK, 1);
  Serial.println(F("วัดระยะจริงจากขอบหุ่นถึงขอบหุ่น แล้วส่ง M<ระยะซม.> เช่น M87.5"));
}

void printScale(float measuredCM) {
  if (lastCommandCM <= 0.0f) {
    Serial.println(F("ERR: ต้องส่ง F100 หรือ R100 ก่อน"));
    return;
  }
  if (measuredCM <= 1.0f) {
    Serial.println(F("ERR: ระยะที่วัดต้องมากกว่า 1 cm"));
    return;
  }
  const float scale = lastCommandCM / measuredCM;
  Serial.print(F("DISTANCE_SCALE="));
  Serial.println(scale, 3);
  Serial.println(F("นำค่านี้ไปใส่ Settings > ตัวคูณระยะทางตรง"));
}

void setup() {
  Serial.begin(115200);
  analogWriteResolution(12);
  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(ENC_L, INPUT);
  pinMode(ENC_R, INPUT);
  attachInterrupt(digitalPinToInterrupt(ENC_L), isrEncoderL, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_R), isrEncoderR, CHANGE);
  stopMotors();
  Serial.println(F("STRAIGHT DISTANCE CALIBRATION READY"));
  Serial.println(F("คำสั่ง: F100, R100, M<ระยะจริง>, P<PWM>"));
}

void loop() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() < 2) return;
  const char command = line.charAt(0);
  const float value = line.substring(1).toFloat();
  if (command == 'F' || command == 'f') runDistance(value, false);
  else if (command == 'R' || command == 'r') runDistance(value, true);
  else if (command == 'M' || command == 'm') printScale(value);
  else if (command == 'P' || command == 'p') {
    drivePWM = constrain((int)lroundf(value), PWM_MIN, PWM_MAX);
    Serial.print(F("PWM="));
    Serial.println(drivePWM);
  } else {
    Serial.println(F("ERR: ใช้ F100, R100, M<ระยะจริง> หรือ P<PWM>"));
  }
}
