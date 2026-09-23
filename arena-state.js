export const inchesToMetres = (inches) => Number((inches * 0.0254).toFixed(6));

// ขนาดสนามวัดจริง: กำแพงบนล่างยาว 290 ซม. (กว้าง X = 2.90 ม.)
// กำแพงซ้ายขวายาว 325 ซม. (ลึก Z = 3.25 ม.)
// พื้นสนามจริงมีกระเบื้อง 20 ช่องในแนวกว้าง (ซ้าย-ขวา) -> 14.5 ซม./ช่อง
const FIELD_WIDTH = 2.90;
const FIELD_DEPTH = 3.25;
const TILE_SIZE = FIELD_WIDTH / 20; // 0.145 ม. (14.5 ซม.)

// กล่องซ้ายกว้าง 2 ช่อง (0.29 ม.), ลึก 2.5 ช่อง (0.3625 ม.)
const LEFT_BOX_WIDTH = 2 * TILE_SIZE;
const LEFT_BOX_DEPTH = 2.5 * TILE_SIZE;

// กล่องขวากว้าง 2.5 ช่อง (0.3625 ม.), ลึก 2 ช่อง (0.29 ม.)
const RIGHT_BOX_WIDTH = 2.5 * TILE_SIZE;
const RIGHT_BOX_DEPTH = 2 * TILE_SIZE;

// The lower joint of a three-panel side wall is at Z = depth / 6. Keep the
// whole right box below it, with a small visible gap as marked in the photo.
const RIGHT_BOX_Z = FIELD_DEPTH / 6 + RIGHT_BOX_DEPTH / 2 + 0.075;
const START_WIDTH = 0.30;
const START_DEPTH = 0.30;
const START_RIGHT_OFFSET = 0.30;
const START_TOP_OFFSET = 0.35;
const START_X = FIELD_WIDTH / 2 - START_RIGHT_OFFSET - START_WIDTH / 2;
const START_Z = -FIELD_DEPTH / 2 + START_TOP_OFFSET + START_DEPTH / 2;

export const ARENA = Object.freeze({
  width: FIELD_WIDTH,
  depth: FIELD_DEPTH,
  tileSize: TILE_SIZE,
  exitWidth: inchesToMetres(39),
  bonusWidth: inchesToMetres(19),
  robot: Object.freeze({ x: START_X, z: START_Z }),
  startZone: Object.freeze({
    width: START_WIDTH,
    depth: START_DEPTH,
    x: START_X,
    z: START_Z,
    topOffset: START_TOP_OFFSET,
    rightOffset: START_RIGHT_OFFSET,
  }),
  leftBox: Object.freeze({
    originX: -FIELD_WIDTH / 2 + LEFT_BOX_WIDTH / 2,
    z: -0.25,
    width: LEFT_BOX_WIDTH,
    depth: LEFT_BOX_DEPTH,
  }),
  rightBox: Object.freeze({
    originX: FIELD_WIDTH / 2 - RIGHT_BOX_WIDTH / 2,
    z: RIGHT_BOX_Z,
    width: RIGHT_BOX_WIDTH,
    depth: RIGHT_BOX_DEPTH,
  }),
});

const DIRECTIONS = Object.freeze(['บน', 'ขวา', 'ล่าง', 'ซ้าย']);

export function validateDie(value) {
  if (!Number.isInteger(value) || value < 2 || value > 12) {
    throw new RangeError('แต้มลูกเต๋าต้องเป็นจำนวนเต็มตั้งแต่ 2 ถึง 12');
  }
  return value;
}

export const rollDirectionDie = (random = Math.random) => Math.floor(random() * 6) + 1;
export const rollBoxDice = (random = Math.random) => rollDirectionDie(random) + rollDirectionDie(random);

export function directionForDie(value) {
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new RangeError('แต้มทิศรถต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 6');
  }
  const die = value;
  return {
    label: DIRECTIONS[(die - 1) % 4],
    rotationY: -Math.PI - (die - 1) * Math.PI / 2,
  };
}

export function safeRadiusFor({ width, length, clearance }) {
  for (const value of [width, length]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError('ขนาดหุ่นยนต์ต้องมากกว่าศูนย์');
    }
  }
  if (!Number.isFinite(clearance) || clearance < 0) {
    throw new RangeError('ระยะเผื่อต้องไม่ติดลบ');
  }
  return Math.hypot(width, length) / 2 + clearance;
}

export function cameraDistanceForFit({ aspect, verticalFovDegrees, span, margin = 1 }) {
  if (!(aspect > 0) || !(verticalFovDegrees > 0 && verticalFovDegrees < 180) || !(span > 0) || !(margin > 0)) {
    throw new RangeError('ค่าคำนวณระยะกล้องต้องมากกว่าศูนย์และมุมมองต้องน้อยกว่า 180 องศา');
  }

  const halfVerticalFov = verticalFovDegrees * Math.PI / 360;
  const halfSpan = span / 2;
  const verticalDistance = halfSpan / Math.tan(halfVerticalFov);
  const horizontalDistance = halfSpan / (Math.tan(halfVerticalFov) * aspect);
  return Math.max(verticalDistance, horizontalDistance) * margin;
}

export function buildArenaState({ directionDie, leftDie, rightDie }) {
  const direction = directionForDie(directionDie);
  const leftShiftMetres = ARENA.tileSize * validateDie(leftDie);
  const rightShiftMetres = ARENA.tileSize * validateDie(rightDie);

  return {
    robotRotationY: direction.rotationY,
    robotDirection: direction.label,
    leftBoxX: ARENA.leftBox.originX + leftShiftMetres,
    rightBoxX: ARENA.rightBox.originX - rightShiftMetres,
    leftShiftMetres,
    rightShiftMetres,
  };
}
