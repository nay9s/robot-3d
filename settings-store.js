export const SETTINGS_KEY = 'robot-arena-settings-v2';

export const DEFAULT_SETTINGS = Object.freeze({
  width: 0.16,
  length: 0.25,
  clearance: 0.15,
  exitClearance: 0.04,
  speed: 0.87,
  straightDistanceScale: 1.00,
  leftCmPerTick: 0.55,
  rightCmPerTick: 0.55,
  turnSeconds90: 0.90,
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
  turnCalibrationPoints: [],
  gridSize: 0.05,
  planningMode: 'pass',
  allowReverse: true,
  preferRightTurns: true,
  invertTurnDirection: true,
  directLine: false,
  directSafetyMargin: 0.20,
  showMeasurements: true,
  useUltrasonic: true,
  useUltrasonicScan: true,
  ultrasonicTrigPin: 13,
  ultrasonicEchoPin: 12,
  ultrasonicStopDist: 25,
  ultrasonicOpenDist: 45,
  servoCenterAngle: 90,
  servoScanOffset: 45,
});

const NUMERIC_RULES = Object.freeze({
  width: [0.10, 0.80, 'ความกว้างต้องอยู่ระหว่าง 0.10–0.80 เมตร'],
  length: [0.10, 0.80, 'ความยาวต้องอยู่ระหว่าง 0.10–0.80 เมตร'],
  clearance: [0, 0.50, 'ระยะเผื่อต้องอยู่ระหว่าง 0–0.50 เมตร'],
  exitClearance: [0, 0.08, 'ระยะเผื่อช่องออกต้องอยู่ระหว่าง 0–0.08 เมตร'],
  speed: [0.05, 2, 'ความเร็วต้องอยู่ระหว่าง 0.05–2.00 เมตร/วินาที'],
  straightDistanceScale: [0.50, 2.00, 'ตัวคูณระยะทางตรงต้องอยู่ระหว่าง 0.50–2.00'],
  leftCmPerTick: [0.30, 0.80, 'ระยะต่อติ๊กของล้อซ้ายต้องอยู่ระหว่าง 0.30–0.80 ซม.'],
  rightCmPerTick: [0.30, 0.80, 'ระยะต่อติ๊กของล้อขวาต้องอยู่ระหว่าง 0.30–0.80 ซม.'],
  turnSeconds90: [0.10, 5, 'เวลาเลี้ยวต้องอยู่ระหว่าง 0.10–5.00 วินาที'],
  turnRight45LeftTicks: [1, 200, 'Ticks ต้องอยู่ระหว่าง 1–200'],
  turnRight45RightTicks: [1, 200, 'Ticks ต้องอยู่ระหว่าง 1–200'],
  turnRight90LeftTicks: [1, 200, 'Ticks ต้องอยู่ระหว่าง 1–200'],
  turnRight90RightTicks: [1, 200, 'Ticks ต้องอยู่ระหว่าง 1–200'],
  turnRight180LeftTicks: [1, 400, 'Ticks ต้องอยู่ระหว่าง 1–400'],
  turnRight180RightTicks: [1, 400, 'Ticks ต้องอยู่ระหว่าง 1–400'],
  turnLeft45LeftTicks: [1, 200, 'Ticks ต้องอยู่ระหว่าง 1–200'],
  turnLeft45RightTicks: [1, 200, 'Ticks ต้องอยู่ระหว่าง 1–200'],
  turnLeft90LeftTicks: [1, 200, 'Ticks ต้องอยู่ระหว่าง 1–200'],
  turnLeft90RightTicks: [1, 200, 'Ticks ต้องอยู่ระหว่าง 1–200'],
  turnLeft180LeftTicks: [1, 400, 'Ticks ต้องอยู่ระหว่าง 1–400'],
  turnLeft180RightTicks: [1, 400, 'Ticks ต้องอยู่ระหว่าง 1–400'],
  directSafetyMargin: [0, 0.50, 'ระยะเผื่อทางตรงต้องอยู่ระหว่าง 0–0.50 เมตร'],
  ultrasonicOpenDist: [20, 150, 'ระยะที่ถือว่าเป็นช่องเปิดต้องอยู่ระหว่าง 20–150 ซม.'],
  servoCenterAngle: [20, 160, 'มุมกึ่งกลาง Servo ต้องอยู่ระหว่าง 20–160 องศา'],
  servoScanOffset: [10, 70, 'ช่วงกวาด Servo ต้องอยู่ระหว่าง 10–70 องศา'],
});

const PIN_RULES = Object.freeze({
  ultrasonicTrigPin: [0, 19, 'ขา TRIG ต้องอยู่ระหว่างพิน 0–19'],
  ultrasonicEchoPin: [0, 19, 'ขา ECHO ต้องอยู่ระหว่างพิน 0–19'],
  ultrasonicStopDist: [5, 60, 'ระยะหยุดฉุกเฉินต้องอยู่ระหว่าง 5–60 ซม.'],
});

function copyDefaults() {
  return { ...DEFAULT_SETTINGS };
}

export function validateSettings(value) {
  const errors = {};
  const input = value && typeof value === 'object' ? value : {};
  const source = { ...DEFAULT_SETTINGS, ...input };

  for (const [key, [minimum, maximum, message]] of Object.entries(NUMERIC_RULES)) {
    if (!Number.isFinite(source[key]) || source[key] < minimum || source[key] > maximum) {
      errors[key] = message;
    }
  }

  const customPoints = source.turnCalibrationPoints;
  if (!Array.isArray(customPoints) || customPoints.length > 24) {
    errors.turnCalibrationPoints = 'จุดคาลิเบรตมุมต้องเป็นรายการไม่เกิน 24 จุด';
  } else {
    const seen = new Set();
    for (const point of customPoints) {
      const key = `${point?.direction}:${point?.degrees}`;
      if (!point || !['left', 'right'].includes(point.direction)
          || !Number.isFinite(point.degrees) || point.degrees < 1 || point.degrees > 180
          || [45, 90, 180].includes(point.degrees)
          || !Number.isFinite(point.leftTicks) || point.leftTicks < 1 || point.leftTicks > 400
          || !Number.isFinite(point.rightTicks) || point.rightTicks < 1 || point.rightTicks > 400
          || seen.has(key)) {
        errors.turnCalibrationPoints = 'จุดคาลิเบรตมุมเพิ่มเติมไม่ถูกต้องหรือซ้ำกัน';
        break;
      }
      seen.add(key);
    }
  }

  for (const [key, [minimum, maximum, message]] of Object.entries(PIN_RULES)) {
    if (source[key] !== undefined) {
      if (!Number.isInteger(source[key]) || source[key] < minimum || source[key] > maximum) {
        errors[key] = message;
      }
    }
  }

  if (![0.025, 0.05, 0.10].includes(source.gridSize)) {
    errors.gridSize = 'ความละเอียดตารางต้องเป็น 0.025, 0.05 หรือ 0.10 เมตร';
  }
  if (!['fastest', 'score', 'pass'].includes(source.planningMode)) {
    errors.planningMode = 'โหมดวางแผนไม่ถูกต้อง';
  }
  if (typeof source.showMeasurements !== 'boolean') {
    errors.showMeasurements = 'ค่าการแสดงการวัดต้องเป็นเปิดหรือปิด';
  }
  if (source.allowReverse !== undefined && typeof source.allowReverse !== 'boolean') {
    errors.allowReverse = 'ค่าการอนุญาตถอยหลังต้องเป็นเปิดหรือปิด';
  }
  if (source.preferRightTurns !== undefined && typeof source.preferRightTurns !== 'boolean') {
    errors.preferRightTurns = 'ค่าการเลือกหมุนขวาต้องเป็นเปิดหรือปิด';
  }
  if (source.invertTurnDirection !== undefined && typeof source.invertTurnDirection !== 'boolean') {
    errors.invertTurnDirection = 'ค่าการกลับทิศมอเตอร์ตอนเลี้ยวต้องเป็นเปิดหรือปิด';
  }
  if (source.directLine !== undefined && typeof source.directLine !== 'boolean') {
    errors.directLine = 'ค่าเส้นทางตรงอิสระต้องเป็นเปิดหรือปิด';
  }
  if (source.useUltrasonic !== undefined && typeof source.useUltrasonic !== 'boolean') {
    errors.useUltrasonic = 'ค่าการเปิดใช้งานเซนเซอร์ Ultrasonic ต้องเป็นเปิดหรือปิด';
  }
  if (source.useUltrasonicScan !== undefined && typeof source.useUltrasonicScan !== 'boolean') {
    errors.useUltrasonicScan = 'ค่าการสแกนช่องว่างต้องเป็นเปิดหรือปิด';
  }
  if (source.useUltrasonic !== false) {
    // พิน 11 ใช้ Servo ตามการต่อจริง จึงห้าม Ultrasonic ใช้ซ้ำ
    const reservedPins = new Set([2, 3, 5, 6, 7, 8, 9, 10, 11]);
    if (reservedPins.has(source.ultrasonicTrigPin)) {
      errors.ultrasonicTrigPin = 'ขา TRIG ซ้ำกับมอเตอร์, Encoder หรือ Servo (พิน 2, 3, 5–11)';
    }
    if (reservedPins.has(source.ultrasonicEchoPin)) {
      errors.ultrasonicEchoPin = 'ขา ECHO ซ้ำกับมอเตอร์, Encoder หรือ Servo (พิน 2, 3, 5–11)';
    }
    if (Number.isInteger(source.ultrasonicTrigPin)
        && source.ultrasonicTrigPin === source.ultrasonicEchoPin) {
      errors.ultrasonicEchoPin = 'ขา ECHO ต้องไม่ซ้ำกับขา TRIG';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      width: source.width,
      length: source.length,
      clearance: source.clearance,
      exitClearance: source.exitClearance,
      speed: source.speed,
      straightDistanceScale: source.straightDistanceScale,
      leftCmPerTick: source.leftCmPerTick,
      rightCmPerTick: source.rightCmPerTick,
      turnSeconds90: source.turnSeconds90,
      turnRight45LeftTicks: source.turnRight45LeftTicks,
      turnRight45RightTicks: source.turnRight45RightTicks,
      turnRight90LeftTicks: source.turnRight90LeftTicks,
      turnRight90RightTicks: source.turnRight90RightTicks,
      turnRight180LeftTicks: source.turnRight180LeftTicks,
      turnRight180RightTicks: source.turnRight180RightTicks,
      turnLeft45LeftTicks: source.turnLeft45LeftTicks,
      turnLeft45RightTicks: source.turnLeft45RightTicks,
      turnLeft90LeftTicks: source.turnLeft90LeftTicks,
      turnLeft90RightTicks: source.turnLeft90RightTicks,
      turnLeft180LeftTicks: source.turnLeft180LeftTicks,
      turnLeft180RightTicks: source.turnLeft180RightTicks,
      turnCalibrationPoints: customPoints.map(({ direction, degrees, leftTicks, rightTicks }) =>
        ({ direction, degrees, leftTicks, rightTicks })),
      gridSize: source.gridSize,
      planningMode: source.planningMode,
      allowReverse: source.allowReverse ?? true,
      preferRightTurns: source.preferRightTurns ?? true,
      invertTurnDirection: source.invertTurnDirection ?? true,
      directLine: source.directLine ?? true,
      directSafetyMargin: source.directSafetyMargin ?? 0.20,
      showMeasurements: source.showMeasurements,
      useUltrasonic: source.useUltrasonic ?? true,
      useUltrasonicScan: source.useUltrasonicScan ?? true,
      ultrasonicTrigPin: source.ultrasonicTrigPin ?? 13,
      ultrasonicEchoPin: source.ultrasonicEchoPin ?? 12,
      ultrasonicStopDist: source.ultrasonicStopDist ?? 12,
      ultrasonicOpenDist: source.ultrasonicOpenDist ?? 45,
      servoCenterAngle: source.servoCenterAngle ?? 90,
      servoScanOffset: source.servoScanOffset ?? 45,
    },
  };
}

export function loadSettings(storage = globalThis.localStorage) {
  const stored = storage?.getItem(SETTINGS_KEY);
  if (stored === null || stored === undefined) return copyDefaults();

  try {
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object') {
      if (parsed.width === 0.32) parsed.width = DEFAULT_SETTINGS.width;
      if (parsed.length === 0.38) parsed.length = DEFAULT_SETTINGS.length;
    }
    const result = validateSettings(parsed);
    if (!result.ok) throw new RangeError('Settings ที่บันทึกไว้ไม่ถูกต้อง');
    return result.value;
  } catch {
    storage?.removeItem(SETTINGS_KEY);
    return copyDefaults();
  }
}

export function saveSettings(storage = globalThis.localStorage, value) {
  const result = validateSettings(value);
  if (!result.ok) {
    const error = new RangeError('Settings ไม่ถูกต้อง');
    error.errors = result.errors;
    throw error;
  }
  storage?.setItem(SETTINGS_KEY, JSON.stringify(result.value));
  return { ...result.value };
}

export function resetSettings(storage = globalThis.localStorage) {
  storage?.removeItem(SETTINGS_KEY);
  return copyDefaults();
}
