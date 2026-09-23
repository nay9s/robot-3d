import { ENCODER_MOTION_SOURCE } from './encoder-motion-source.js?v=2';
import { turnPoints } from './turn-calibration.js?v=1';

/**
 * Arduino Code Exporter for Robot Arena
 * Generates Arduino (.ino) code using PINs and parameters from ArduinoProj:
 *  - ENA: 5 (PWM A)
 *  - IN1: 9, IN2: 8 (Motor A Direction)
 *  - ENB: 10 (PWM B)
 *  - IN3: 7, IN4: 6 (Motor B Direction)
 *  - ENC_L: 2 (Left Encoder Interrupt)
 *  - ENC_R: 3 (Right Encoder Interrupt)
 */

// ตารางเริ่มต้นปรับได้ใน Settings; 45°/180° เริ่มจากสัดส่วนของผล 90°
export const ACTUAL_FIELD_TURN_CALIBRATION = Object.freeze({
  turnRight45LeftTicks: 14.5,
  turnRight45RightTicks: 13,
  turnRight90LeftTicks: 30,
  turnRight90RightTicks: 27,
  turnRight180LeftTicks: 58,
  turnRight180RightTicks: 52,
  turnLeft45LeftTicks: 14.5,
  turnLeft45RightTicks: 14,
  turnLeft90LeftTicks: 29,
  turnLeft90RightTicks: 28,
  turnLeft180LeftTicks: 58,
  turnLeft180RightTicks: 56,
  pwm12Bit: 2000,
});

export function calculateRecommendedPwm({ speedMPerSec = 0.35, boardType = 'uno_r4' } = {}) {
  const speed = Number(speedMPerSec) || 0.35;
  const speedCmPerSec = Math.max(5, speed * 100);
  const is12Bit = boardType === 'uno_r4';

  if (is12Bit) {
    // อิงจาก combined_state_sequence.ino:
    // const float PWM_PER_CM_S = 47.5f;
    // หุ่นจริงต้องใช้ประมาณ 2000 PWM ขึ้นไปจึงออกตัวหมุนได้สม่ำเสมอ
    const drivePwm = Math.min(4095, Math.max(1850, Math.round(speedCmPerSec * 47.5)));
    const turnPwm = ACTUAL_FIELD_TURN_CALIBRATION.pwm12Bit;
    const crawlPwm = 2000;
    return {
      drivePwm,
      turnPwm,
      crawlPwm,
      is12Bit: true,
      pwmMax: 4095,
      speedCmPerSec: Number(speedCmPerSec.toFixed(1)),
      formulaDesc: '47.5 PWM ต่อ 1 cm/s และขั้นต่ำ 1850 สำหรับหุ่นคันนี้',
    };
  } else {
    // 8-bit Uno R3 / Nano / Mega (สเกล 255 / 4095 ~= 1 / 16.06)
    // 47.5 / 16.06 = ~2.96 PWM ต่อ 1 cm/s
    const drivePwm = Math.min(255, Math.max(115, Math.round(speedCmPerSec * 2.96)));
    const turnPwm = 125; // 2000 / 16.06
    const crawlPwm = 125;
    return {
      drivePwm,
      turnPwm,
      crawlPwm,
      is12Bit: false,
      pwmMax: 255,
      speedCmPerSec: Number(speedCmPerSec.toFixed(1)),
      formulaDesc: '~2.96 PWM ต่อ 1 cm/s และขั้นต่ำ 115 สำหรับหุ่นคันนี้',
    };
  }
}

export function generateArduinoCode({
  route,
  diceState = {},
  settings = {},
  arena = null,
  profile = 'encoder', // 'encoder' | 'timed'
  boardType = 'uno_r4', // 'uno_r4' (12-bit PWM 0-4095) | 'uno_r3' (8-bit PWM 0-255)
  baseSpeed = null,
  pauseMs = 0,
} = {}) {
  const is12Bit = boardType === 'uno_r4';
  const rec = calculateRecommendedPwm({ speedMPerSec: settings?.speed ?? 0.35, boardType });
  const drivePwm = baseSpeed ?? rec.drivePwm;
  const turnPwm = is12Bit
    ? Math.min(2400, Math.max(2000, rec.turnPwm))
    : Math.min(255, Math.max(125, rec.turnPwm));

  const commands = route?.commands ?? [];
  if (route?.status && route.status !== 'found') {
    throw new RangeError('ไม่สามารถส่งออก Arduino เมื่อไม่พบเส้นทาง');
  }
  if (commands.length === 0) {
    throw new RangeError('เส้นทางไม่มีคำสั่งให้รถวิ่ง');
  }
  const totalDistanceM = route?.totalDistance ?? 0;
  const estimatedSec = route?.estimatedSeconds ?? 0;
  const goalType = route?.goalType === 'manual' ? 'จุดปลายทางที่ผู้ใช้เลือก (Manual Route)'
    : route?.goalType === 'bonus' ? 'ช่วงโบนัส 19 นิ้ว (Bonus Gate)' : 'ช่องออก 39 นิ้ว (Regular Exit)';

  const diceDesc = `ทิศทาง: ${diceState.robotDirection ?? 'ไม่ระบุ'} | กล่องซ้าย: ${diceState.leftShiftMetres ? (diceState.leftShiftMetres / 0.1143).toFixed(0) : '?'} | กล่องขวา: ${diceState.rightShiftMetres ? (diceState.rightShiftMetres / 0.1143).toFixed(0) : '?'}`;

  if (profile === 'timed') {
    return generateTimedCode({
      commands,
      totalDistanceM,
      estimatedSec,
      goalType,
      diceDesc,
      drivePwm,
      turnPwm,
      pauseMs,
      settings,
      is12Bit,
    });
  }

  return generateEncoderCode({
    commands,
    totalDistanceM,
    estimatedSec,
    goalType,
    diceDesc,
    diceState,
    is12Bit,
    drivePwm,
    turnPwm,
    pauseMs,
    settings,
    rec,
    arena,
  });
}

export function generateTurnTestCode({ trials, settings = {}, boardType = 'uno_r4' } = {}) {
  if (!Array.isArray(trials) || trials.length < 1 || trials.length > 6
      || trials.some((trial) => !['left', 'right'].includes(trial.direction)
        || !Number.isFinite(trial.degrees) || trial.degrees < 1 || trial.degrees > 180)) {
    throw new RangeError('เลือกมุมทดสอบ 1–180 องศา จำนวน 1–6 รายการ');
  }
  const is12Bit = boardType === 'uno_r4';
  const rec = calculateRecommendedPwm({ speedMPerSec: settings.speed ?? 0.35, boardType });
  const commands = trials.map(({ direction, degrees }) => ({
    type: direction === 'right' ? 'turn-right' : 'turn-left',
    degrees,
    label: `${direction === 'right' ? 'RIGHT' : 'LEFT'} ${degrees} deg`,
  }));
  return generateEncoderCode({
    commands, totalDistanceM: 0, estimatedSec: 0,
    goalType: 'ทดสอบมุมก่อนลงสนาม', diceDesc: 'ไม่มี',
    is12Bit, drivePwm: rec.drivePwm, turnPwm: rec.turnPwm,
    pauseMs: 0, settings: { ...settings, useUltrasonic: false, useUltrasonicScan: false },
    calibrationTrials: trials,
  });
}

function mapCommandToEnum(type) {
  switch (type) {
    case 'forward': return 'STEP_FORWARD';
    case 'reverse': return 'STEP_REVERSE';
    case 'turn-left': return 'STEP_TURN_LEFT';
    case 'turn-right': return 'STEP_TURN_RIGHT';
    case 'turn-around': return 'STEP_TURN_AROUND';
    default: return 'STEP_FORWARD';
  }
}

function generateEncoderCode({
  commands,
  totalDistanceM,
  estimatedSec,
  goalType,
  diceDesc,
  diceState = {},
  is12Bit,
  drivePwm,
  turnPwm,
  pauseMs,
  settings = {},
  arena = null,
  calibrationTrials = null,
}) {
  const robotStartX = (arena?.robot?.x ?? 1.00).toFixed(2);
  const robotStartZ = (arena?.robot?.z ?? -1.12).toFixed(2);
  const useUltrasonic = settings?.useUltrasonic !== false;
  const useUltrasonicScan = useUltrasonic && settings?.useUltrasonicScan !== false;
  const trigPin = Number(settings?.ultrasonicTrigPin ?? 13);
  const echoPin = Number(settings?.ultrasonicEchoPin ?? 12);
  const stopDist = Number(settings?.ultrasonicStopDist ?? 12);
  const openDist = Number(settings?.ultrasonicOpenDist ?? 45);
  const servoCenterAngle = Number(settings?.servoCenterAngle ?? 90);
  const servoScanOffset = Number(settings?.servoScanOffset ?? 45);
  const straightDistanceScale = Number(settings?.straightDistanceScale ?? 1.00);
  const leftCmPerTick = Number(settings?.leftCmPerTick ?? 0.55);
  const rightCmPerTick = Number(settings?.rightCmPerTick ?? 0.55);
  const invertTurnDirection = settings?.invertTurnDirection !== false;
  const headingMap = { 'ล่าง': 0, 'ซ้าย': -90, 'บน': 180, 'ขวา': 90 };
  const initialHeading = headingMap[diceState?.robotDirection] ?? 0;

  const calibrated = (key) => {
    const value = Number(settings?.[key]);
    return (Number.isFinite(value) ? value : ACTUAL_FIELD_TURN_CALIBRATION[key]).toFixed(2);
  };
  const turnTicks = Object.fromEntries(
    Object.keys(ACTUAL_FIELD_TURN_CALIBRATION)
      .filter((key) => key.endsWith('Ticks'))
      .map((key) => [key, calibrated(key)]),
  );
  const turnSettings = { ...ACTUAL_FIELD_TURN_CALIBRATION, ...settings };
  const turnTable = (direction) => {
    const prefix = direction === 'right' ? 'TURN_RIGHT' : 'TURN_LEFT';
    const points = turnPoints(turnSettings, direction);
    const value = (point, wheel) => [45, 90, 180].includes(point.degrees)
      ? `${prefix}_${wheel}_TICKS_${point.degrees}` : `${Number(point[wheel === 'LEFT' ? 'leftTicks' : 'rightTicks']).toFixed(2)}f`;
    return `const float ${prefix}_DEGREES[] = { ${points.map((point) => `${point.degrees.toFixed(2)}f`).join(', ')} };\n`
      + `const float ${prefix}_LEFT_TABLE[] = { ${points.map((point) => value(point, 'LEFT')).join(', ')} };\n`
      + `const float ${prefix}_RIGHT_TABLE[] = { ${points.map((point) => value(point, 'RIGHT')).join(', ')} };\n`
      + `const int ${prefix}_POINTS = ${points.length};`;
  };
  const calibrationChoices = calibrationTrials?.map((trial, index) =>
    `  if (choice == '${index + 1}') { degrees = ${trial.degrees.toFixed(2)}f; direction = ${trial.direction === 'right' ? '1' : '-1'}; }`).join('\n') ?? '';

  const stepsLines = commands.map((cmd, idx) => {
    const enumType = mapCommandToEnum(cmd.type);
    const value = cmd.type === 'forward' || cmd.type === 'reverse'
      ? (cmd.distance * 100).toFixed(1) // convert m to cm
      : cmd.degrees.toFixed(1);
    const safeLabel = (cmd.label || `${cmd.type} ${value}`).replace(/"/g, '\\"');
    return `  { ${enumType.padEnd(16, ' ')}, ${value.padStart(7, ' ')}f, "${safeLabel}" }, // [${idx + 1}]`;
  }).join('\n');

  return `/*
 * =====================================================================
 * Robot Arena Autonomous Route - Closed-Loop Encoder Controller
 * สร้างอัตโนมัติจาก Robot Arena 3D Simulator
 * ขาพินและพารามิเตอร์อิงจาก: ArduinoProj/combined_state_sequence.ino
 * คำเตือน: โปรไฟล์ Encoder-only ยังอยู่ระหว่างยืนยัน ผลล่าสุดคลาดเคลื่อนสูงสุดประมาณ 32°
 *
 * ข้อมูลการคำนวณ:
 *   - เป้าหมาย: ${goalType}
 *   - แต้มลูกเต๋า: ${diceDesc}
 *   - ระยะทางรวม: ${totalDistanceM.toFixed(2)} เมตร (${(totalDistanceM * 100).toFixed(1)} ซม.)
 *   - เวลาประมาณการ: ${estimatedSec.toFixed(2)} วินาที
 *   - จำนวนสเต็ป: ${commands.length} คำสั่ง
 *   - Calibrate @ PWM ${ACTUAL_FIELD_TURN_CALIBRATION.pwm12Bit}: 45°/90°/180° แยกทิศและล้อจาก Settings
 *   - ตัวคูณระยะทางตรง: ${straightDistanceScale.toFixed(3)}
 *   - ระบบพิกัด Odometry: เปิดใช้งาน (ติดตาม X, Z เมตร)
 *   - ระบบ Ultrasonic HC-SR04: ${useUltrasonic ? `เปิดใช้งาน (TRIG: Pin ${trigPin}, ECHO: Pin ${echoPin}, หยุดฉุกเฉิน ${stopDist} cm)` : 'ปิดใช้งาน'}
 *   - สแกนช่องว่างด้วย Servo: ${useUltrasonicScan ? `เปิด (กลาง ${servoCenterAngle}°, กวาด ±${servoScanOffset}°, ช่องเปิด ${openDist} cm)` : 'ปิด'}
 * =====================================================================
 */

#include <Arduino.h>
${ENCODER_MOTION_SOURCE}
${useUltrasonicScan ? '#include <Servo.h>' : ''}

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
const float LEFT_CM_PER_TICK = ${leftCmPerTick.toFixed(4)}f;
const float RIGHT_CM_PER_TICK = ${rightCmPerTick.toFixed(4)}f;
const float STRAIGHT_DISTANCE_SCALE = ${straightDistanceScale.toFixed(3)}f; // เพิ่มเมื่อรถวิ่งจริงสั้นกว่าคำสั่ง

// ตารางจุดสั่ง active brake ปรับได้ก่อนปล่อยรถจากหน้า Settings
const float TURN_RIGHT_LEFT_TICKS_45   = ${turnTicks.turnRight45LeftTicks}f;
const float TURN_RIGHT_RIGHT_TICKS_45  = ${turnTicks.turnRight45RightTicks}f;
const float TURN_RIGHT_LEFT_TICKS_90   = ${turnTicks.turnRight90LeftTicks}f;
const float TURN_RIGHT_RIGHT_TICKS_90  = ${turnTicks.turnRight90RightTicks}f;
const float TURN_RIGHT_LEFT_TICKS_180  = ${turnTicks.turnRight180LeftTicks}f;
const float TURN_RIGHT_RIGHT_TICKS_180 = ${turnTicks.turnRight180RightTicks}f;
const float TURN_LEFT_LEFT_TICKS_45    = ${turnTicks.turnLeft45LeftTicks}f;
const float TURN_LEFT_RIGHT_TICKS_45   = ${turnTicks.turnLeft45RightTicks}f;
const float TURN_LEFT_LEFT_TICKS_90    = ${turnTicks.turnLeft90LeftTicks}f;
const float TURN_LEFT_RIGHT_TICKS_90   = ${turnTicks.turnLeft90RightTicks}f;
const float TURN_LEFT_LEFT_TICKS_180   = ${turnTicks.turnLeft180LeftTicks}f;
const float TURN_LEFT_RIGHT_TICKS_180  = ${turnTicks.turnLeft180RightTicks}f;
${turnTable('right')}
${turnTable('left')}

// =====================================================================
// 3. ULTRASONIC HC-SR04 SENSOR & POSE TRACKER
// =====================================================================
#define USE_ULTRASONIC ${useUltrasonic ? '1' : '0'}
#define USE_FRONT_GAP_SCAN ${useUltrasonicScan ? '1' : '0'}
#if USE_ULTRASONIC
const int TRIG_PIN = ${trigPin};
const int ECHO_PIN = ${echoPin};
const float ULTRASONIC_EMERGENCY_STOP_CM = ${stopDist}.0f; // ระยะหยุดฉุกเฉิน (Virtual Bumper)
#endif
#if USE_FRONT_GAP_SCAN
const int SERVO_CENTER_DEG = ${servoCenterAngle};
const int SERVO_SCAN_OFFSET_DEG = ${servoScanOffset};
const float ULTRASONIC_OPEN_DISTANCE_CM = ${openDist}.0f;
const unsigned long SERVO_SETTLE_MS = 180;
Servo ultrasonicServo;
#endif

// ตัวแปรจำพิกัด Odometry Pose Tracker (X, Z เมตร และมุมสะสมในผังสนาม)
float robotX = ${robotStartX}f;           // พิกัด X เริ่มต้น (เมตร)
float robotZ = ${robotStartZ}f;          // พิกัด Z เริ่มต้น (เมตร)
float robotHeadingDeg = ${initialHeading}.0f; // ทิศทางเริ่มต้น (${diceState?.robotDirection ?? 'ล่าง'})

// ความเร็วและการควบคุม (คำนวณอัตโนมัติตามสูตร Calibrate จริงจาก combined_state_sequence.ino)
// - 12-bit Uno R4/ESP32: speed (cm/s) * 47.5f | เลี้ยว = 2000 จากผลสนามจริง
// - 8-bit Uno R3/Nano: speed (cm/s) * ~2.96f | เลี้ยว = 125
const int PWM_MAX = ${is12Bit ? '4095' : '255'};
const int CRUISE_PWM = ${drivePwm};
const float DRIVE_SPEED_CM_S = ${Math.max(5, Math.min(70, Number(settings?.speed ?? 0.35) * 100)).toFixed(1)}f;
const int TURN_PWM   = ${turnPwm};
const bool INVERT_TURN_DIRECTION = ${invertTurnDirection ? 'true' : 'false'};
const unsigned long PAUSE_BETWEEN_STEPS_MS = ${pauseMs};

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
${stepsLines || '  // ไม่มีคำสั่ง'}
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

void activeBrake(unsigned long durationMs = 80) {
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
    Serial.println(F("ℹ️ ไม่พบเซนเซอร์ Ultrasonic/Servo (หรืออยู่นอกระยะ 250 cm) -> วิ่งต่อตามแผน"));
    return true;
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
  while (millis() - start < 200) {
    unsigned long left, right;
    readEncoders(left, right);
    unsigned long now = millis();
    if (left != oldL || right != oldR) { lastChange = now; oldL = left; oldR = right; }
    if (now - lastChange >= 40) return true;
    delay(5);
  }
  return true;
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
      if (now - oneDoneSince >= 350) break; // ใกล้เคียงเป้าหมายมากแล้ว สั่งเบรกและทำขั้นตอนต่อไปทันที
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

    int pwmL = 0;
    int pwmR = 0;
    if (turning) {
      // In-place rotation: Maintain steady calibrated TURN_PWM to prevent motor stiction and stall.
      // Dropping PWM below motor stall threshold causes wheels to halt midway, triggering PID integral windup and violent acceleration/overshoot.
      pwmL = TURN_PWM;
      pwmR = TURN_PWM;
      long progressL = (long)left * (long)targetR;
      long progressR = (long)right * (long)targetL;
      long diff = progressR - progressL;
      int maxBoost = PWM_MAX > 1000 ? 250 : 18;
      if (diff > 0) {
        // Left is lagging behind Right, boost Left slightly to stay synchronized
        pwmL = min(PWM_MAX, TURN_PWM + (int)min((long)maxBoost, diff * 12L / (long)(targetL + targetR)));
      } else if (diff < 0) {
        // Right is lagging behind Left, boost Right slightly to stay synchronized
        pwmR = min(PWM_MAX, TURN_PWM + (int)min((long)maxBoost, (-diff) * 12L / (long)(targetL + targetR)));
      }
    } else {
      // Straight driving: Use calibrated CRUISE_PWM base so motors never drop below stall threshold (1850).
      pwmL = CRUISE_PWM;
      pwmR = CRUISE_PWM;
      long progressL = (long)left * (long)targetR;
      long progressR = (long)right * (long)targetL;
      long diff = progressR - progressL;
      int maxTrim = PWM_MAX > 1000 ? 300 : 20;
      if (diff > 0) {
        // Left is lagging behind Right, boost Left slightly to maintain straight line
        pwmL = min(PWM_MAX, CRUISE_PWM + (int)min((long)maxTrim, diff * 15L / (long)(targetL + targetR)));
      } else if (diff < 0) {
        // Right is lagging behind Left, boost Right slightly to maintain straight line
        pwmR = min(PWM_MAX, CRUISE_PWM + (int)min((long)maxTrim, (-diff) * 15L / (long)(targetL + targetR)));
      }
    }
    setMotorSpeed(doneL ? 0 : pwmL, doneR ? 0 : pwmR);
    delay(5);
  }
  Serial.print(F("STOP_COUNTS L/R: ")); Serial.print(left); Serial.print('/'); Serial.println(right);
  activeBrake(80);
  waitForEncoderStop();
  unsigned long finalL, finalR;
  readEncoders(finalL, finalR);
  Serial.print(F("FINAL_COUNTS L/R: ")); Serial.print(finalL); Serial.print('/'); Serial.println(finalR);
  Serial.print(F("COAST_COUNTS L/R: ")); Serial.print(finalL - left); Serial.print('/'); Serial.println(finalR - right);
  Serial.print(F("MOTION_RESULT: ")); Serial.println((int)result);
  if (result == MOTION_OK && PAUSE_BETWEEN_STEPS_MS > 0) delay(PAUSE_BETWEEN_STEPS_MS);
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

float interpolateTurnTicks(float degrees, const float *angles, const float *ticks, int pointCount) {
  float previousAngle = 0.0f;
  float previousTicks = 0.0f;
  for (int i = 0; i < pointCount; ++i) {
    if (degrees <= angles[i]) {
      return previousTicks + (ticks[i] - previousTicks)
        * ((degrees - previousAngle) / (angles[i] - previousAngle));
    }
    previousAngle = angles[i];
    previousTicks = ticks[i];
  }
  return previousTicks * degrees / previousAngle;
}

MotionResult runInPlaceTurn(float targetDeg, int direction) {
  if (!isfinite(targetDeg) || targetDeg < 0) return MOTION_INVALID;
  if (targetDeg <= 0.5f) return MOTION_INVALID;
  float targetLeft = direction > 0
    ? interpolateTurnTicks(targetDeg, TURN_RIGHT_DEGREES, TURN_RIGHT_LEFT_TABLE, TURN_RIGHT_POINTS)
    : interpolateTurnTicks(targetDeg, TURN_LEFT_DEGREES, TURN_LEFT_LEFT_TABLE, TURN_LEFT_POINTS);
  float targetRight = direction > 0
    ? interpolateTurnTicks(targetDeg, TURN_RIGHT_DEGREES, TURN_RIGHT_RIGHT_TABLE, TURN_RIGHT_POINTS)
    : interpolateTurnTicks(targetDeg, TURN_LEFT_DEGREES, TURN_LEFT_RIGHT_TABLE, TURN_LEFT_POINTS);
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
  Serial.print(F("เป้าหมาย: ")); Serial.println(F("${goalType}"));
  Serial.print(F("จำนวนคำสั่ง: ")); Serial.println(TOTAL_STEPS);
  Serial.print(F("ระยะทางรวม: ")); Serial.print(${totalDistanceM.toFixed(2)}); Serial.println(F(" m"));

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

${is12Bit ? '  analogWriteResolution(12); // เปิดใช้งาน 12-bit PWM สำหรับ Uno R4 / ESP32\n' : '  // 8-bit PWM มาตรฐานสำหรับ Arduino Uno R3 / Nano\n'}
  attachInterrupt(digitalPinToInterrupt(ENC_L), ISR_encoderL, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_R), ISR_encoderR, CHANGE);

  stopMotors();
${calibrationTrials ? `  Serial.println(F("TURN TEST READY: send a digit 1-${calibrationTrials.length} in Serial Monitor at 115200 baud."));
  Serial.println(F("Place robot at the starting line before EACH command. No automatic motion."));` : `  Serial.println(F("พร้อมเริ่มวิ่งทันที..."));

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
      if (motionResult == MOTION_OBSTACLE) {
        stopMotors();
        Serial.println(F("⛔ ตรวจพบสิ่งกีดขวาง ยกเลิกคำสั่งเพื่อความปลอดภัย (ABORTED)"));
        return;
      }
      Serial.print(F("⚠️ Warning ระหว่างเคลื่อนที่ (code: "));
      Serial.print((int)motionResult);
      Serial.println(F(") ดำเนินการต่อคำสั่งถัดไปเพื่อรักษาเส้นทาง"));
    }
  }

  stopMotors();
  Serial.println(F("=================================================="));
  Serial.println(F("   ✓ วิ่งครบทุกขั้นตอนเรียบร้อยแล้ว (COMPLETED)   "));
  Serial.println(F("=================================================="));`}
}

void loop() {
${calibrationTrials ? `  if (!Serial.available()) return;
  char choice = Serial.read();
  if (choice == '\\n' || choice == '\\r') return;
  while (Serial.available()) Serial.read();
  float degrees = 0.0f;
  int direction = 0;
${calibrationChoices}
  if (direction == 0) {
    Serial.println(F("Unknown test number."));
    return;
  }
  Serial.print(F("TEST ")); Serial.print(choice);
  Serial.print(F(": ")); Serial.print(direction > 0 ? F("RIGHT ") : F("LEFT "));
  Serial.print(degrees, 1); Serial.println(F(" deg"));
  MotionResult result = runInPlaceTurn(degrees, direction);
  stopMotors();
  Serial.print(F("TEST RESULT: ")); Serial.println((int)result);
  Serial.println(F("Measure FINAL settled angle externally, then return robot to start."));` : `  // สิ้นสุดการทำงานแล้ว อยู่เฉยๆ
  delay(1000);`}
}
`;
}

function generateTimedCode({
  commands,
  totalDistanceM,
  estimatedSec,
  goalType,
  diceDesc,
  drivePwm,
  turnPwm,
  pauseMs,
  settings,
  is12Bit,
}) {
  const speedMps = Number(settings?.speed ?? 0.35);
  const turnSec90 = Number(settings?.turnSeconds90 ?? 0.45);
  const invertTurnDirection = settings?.invertTurnDirection !== false;
  // โหมด Delay ใช้ analogWrite 8-bit เสมอ; แปลงค่าที่ผู้ใช้เลือกในช่วง UNO R4 12-bit
  const toPwm8 = (value) => Math.max(0, Math.min(255,
    Math.round(is12Bit ? value * 255 / 4095 : value)));

  const stepsLines = commands.map((cmd, idx) => {
    let durationMs = 0;
    if (cmd.type === 'forward' || cmd.type === 'reverse') {
      durationMs = Math.round((cmd.distance / speedMps) * 1000);
    } else {
      const deg = cmd.type === 'turn-around' ? 180 : (cmd.degrees ?? 90);
      durationMs = Math.round((deg / 90) * turnSec90 * 1000);
    }
    const enumType = mapCommandToEnum(cmd.type);
    const safeLabel = (cmd.label || `${cmd.type}`).replace(/"/g, '\\"');
    return `  { ${enumType.padEnd(16, ' ')}, ${String(durationMs).padStart(6, ' ')}, "${safeLabel}" }, // [${idx + 1}]`;
  }).join('\n');

  return `/*
 * =====================================================================
 * Robot Arena Autonomous Route - Simple Timed (Delay) Controller
 * อิงขาพินมอเตอร์ตาม ArduinoProj/SPEED.ino (ไม่ต้องต่อ Encoder)
 *
 * ข้อมูลการคำนวณ:
 *   - เป้าหมาย: ${goalType}
 *   - แต้มลูกเต๋า: ${diceDesc}
 *   - ความเร็วเดินตรง: ${speedMps.toFixed(2)} ม./วินาที
 *   - เวลาหมุน 90 องศา: ${turnSec90.toFixed(2)} วินาที
 *   - ระยะทางรวม: ${totalDistanceM.toFixed(2)} เมตร
 *   - เวลาประมาณการ: ${estimatedSec.toFixed(2)} วินาที
 *   - จำนวนสเต็ป: ${commands.length} คำสั่ง
 * =====================================================================
 */

#include <Arduino.h>

// =====================================================================
// PIN ASSIGNMENTS (ตาม ArduinoProj/SPEED.ino)
// =====================================================================
#define m1 9   // มอเตอร์ขวา เดินหน้า (MA1)
#define m2 8   // มอเตอร์ขวา ถอยหลัง (MA2)
#define m3 7   // มอเตอร์ซ้าย เดินหน้า (MB1)
#define m4 6   // มอเตอร์ซ้าย ถอยหลัง (MB2)
#define e1 5   // PWM มอเตอร์ขวา (EA)
#define e2 10  // PWM มอเตอร์ซ้าย (EB)

// ค่าความเร็ว PWM (0 - 255)
const int PWM_DRIVE = ${toPwm8(drivePwm)};
const int PWM_TURN  = ${toPwm8(turnPwm)};
const bool INVERT_TURN_DIRECTION = ${invertTurnDirection ? 'true' : 'false'};
const unsigned long PAUSE_BETWEEN_STEPS_MS = ${pauseMs};

enum StepType {
  STEP_FORWARD,
  STEP_REVERSE,
  STEP_TURN_LEFT,
  STEP_TURN_RIGHT,
  STEP_TURN_AROUND
};

struct TimedStep {
  StepType type;
  unsigned long durationMs; // เวลาในการวิ่ง (มิลลิวินาที)
  const char* label;        // คำอธิบาย
};

const TimedStep ROUTE_STEPS[] = {
${stepsLines || '  // ไม่มีคำสั่ง'}
};
const int TOTAL_STEPS = sizeof(ROUTE_STEPS) / sizeof(ROUTE_STEPS[0]);

void stopMotors() {
  analogWrite(e1, 0);
  analogWrite(e2, 0);
  digitalWrite(m1, LOW);
  digitalWrite(m2, LOW);
  digitalWrite(m3, LOW);
  digitalWrite(m4, LOW);
}

void moveForward(unsigned long durationMs) {
  analogWrite(e1, PWM_DRIVE);
  analogWrite(e2, PWM_DRIVE);
  digitalWrite(m1, HIGH); digitalWrite(m2, LOW);
  digitalWrite(m3, HIGH); digitalWrite(m4, LOW);
  delay(durationMs);
  stopMotors();
  delay(PAUSE_BETWEEN_STEPS_MS);
}

void moveReverse(unsigned long durationMs) {
  analogWrite(e1, PWM_DRIVE);
  analogWrite(e2, PWM_DRIVE);
  digitalWrite(m1, LOW); digitalWrite(m2, HIGH);
  digitalWrite(m3, LOW); digitalWrite(m4, HIGH);
  delay(durationMs);
  stopMotors();
  delay(PAUSE_BETWEEN_STEPS_MS);
}

void setTurnDirection(bool turnRightCommand) {
  int logicalDirection = turnRightCommand ? 1 : -1;
  int motorDirection = INVERT_TURN_DIRECTION ? -logicalDirection : logicalDirection;
  if (motorDirection > 0) {
    digitalWrite(m1, HIGH); digitalWrite(m2, LOW);
    digitalWrite(m3, LOW);  digitalWrite(m4, HIGH);
  } else {
    digitalWrite(m1, LOW);  digitalWrite(m2, HIGH);
    digitalWrite(m3, HIGH); digitalWrite(m4, LOW);
  }
}

void turnLeft(unsigned long durationMs) {
  analogWrite(e1, PWM_TURN);
  analogWrite(e2, PWM_TURN);
  setTurnDirection(false);
  delay(durationMs);
  stopMotors();
  delay(PAUSE_BETWEEN_STEPS_MS);
}

void turnRight(unsigned long durationMs) {
  analogWrite(e1, PWM_TURN);
  analogWrite(e2, PWM_TURN);
  setTurnDirection(true);
  delay(durationMs);
  stopMotors();
  delay(PAUSE_BETWEEN_STEPS_MS);
}

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println(F("=================================================="));
  Serial.println(F("     ROBOT ARENA - TIMED CONTROLLER RUNNER        "));
  Serial.println(F("=================================================="));
  Serial.print(F("จำนวนคำสั่ง: ")); Serial.println(TOTAL_STEPS);

  pinMode(m1, OUTPUT);
  pinMode(m2, OUTPUT);
  pinMode(m3, OUTPUT);
  pinMode(m4, OUTPUT);
  pinMode(e1, OUTPUT);
  pinMode(e2, OUTPUT);

  stopMotors();
  Serial.println(F("พร้อมเริ่มวิ่งทันที..."));

  for (int i = 0; i < TOTAL_STEPS; i++) {
    Serial.print(F("["));
    Serial.print(i + 1);
    Serial.print(F("/"));
    Serial.print(TOTAL_STEPS);
    Serial.print(F("] "));
    Serial.println(ROUTE_STEPS[i].label);

    switch (ROUTE_STEPS[i].type) {
      case STEP_FORWARD:
        moveForward(ROUTE_STEPS[i].durationMs);
        break;
      case STEP_REVERSE:
        moveReverse(ROUTE_STEPS[i].durationMs);
        break;
      case STEP_TURN_LEFT:
        turnLeft(ROUTE_STEPS[i].durationMs);
        break;
      case STEP_TURN_RIGHT:
      case STEP_TURN_AROUND:
        turnRight(ROUTE_STEPS[i].durationMs);
        break;
    }
  }

  stopMotors();
  Serial.println(F("=================================================="));
  Serial.println(F("   ✓ วิ่งครบทุกขั้นตอนเรียบร้อยแล้ว (COMPLETED)   "));
  Serial.println(F("=================================================="));
}

void loop() {
  delay(1000);
}
`;
}
