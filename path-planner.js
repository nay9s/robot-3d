import { safeRadiusFor } from './arena-state.js';

const EPSILON = 1e-9;
const HEADING_ORDER = Object.freeze(['ล่าง', 'ซ้าย', 'บน', 'ขวา']);
export const HEADING_ANGLES = Object.freeze({
  'ล่าง': 0,
  'ซ้าย': -90,
  'บน': 180,
  'ขวา': 90,
});

function rawBoxClearance(point, context) {
  let closest = Infinity;
  for (const obstacle of context.obstacles) {
    if (obstacle.kind !== 'left-box' && obstacle.kind !== 'right-box') continue;
    closest = Math.min(closest, distanceToAabb(point, obstacle));
  }
  return closest - context.safeRadius;
}

export function lineIsClear(from, to, context, stepSize = 0.015, extraBoxClearance = 0) {
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  if (dist < EPSILON) return true;
  const steps = Math.max(1, Math.ceil(dist / stepSize));
  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    const pt = {
      x: from.x + (to.x - from.x) * ratio,
      z: from.z + (to.z - from.z) * ratio,
    };
    if (pointIsBlocked(pt, context)) return false;
    if (extraBoxClearance > 0 && rawBoxClearance(pt, context) < extraBoxClearance - EPSILON) return false;
  }
  return true;
}

// Remove only redundant points on the same directed line. The resulting
// segment covers the original edges exactly; corners and reversals stay intact.
export function compactCollinearPoints(points) {
  const result = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.z - previous.z) < EPSILON) continue;
    while (result.length >= 2) {
      const a = result[result.length - 2];
      const b = result[result.length - 1];
      const ux = b.x - a.x, uz = b.z - a.z;
      const vx = point.x - b.x, vz = point.z - b.z;
      const product = Math.hypot(ux, uz) * Math.hypot(vx, vz);
      if (ux * vx + uz * vz <= 0
          || Math.abs(ux * vz - uz * vx) > 1e-10 * product) break;
      result.pop();
    }
    result.push({ ...point });
  }
  return result;
}

export function stringPull(points, context, stepSize = 0.015, extraBoxClearance = 0) {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const result = [{ ...points[0] }];
  let current = 0;
  while (current < points.length - 1) {
    let next = points.length - 1;
    while (next > current + 1) {
      if (lineIsClear(points[current], points[next], context, stepSize, extraBoxClearance)) break;
      next--;
    }
    result.push({ ...points[next] });
    current = next;
  }
  return compactCollinearPoints(result);
}

function makeAabb(minX, maxX, minZ, maxZ, kind) {
  return { minX, maxX, minZ, maxZ, kind, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}

function obstacleFromBox(x, z, dimensions, kind) {
  return makeAabb(
    x - dimensions.width / 2,
    x + dimensions.width / 2,
    z - dimensions.depth / 2,
    z + dimensions.depth / 2,
    kind,
  );
}

export function buildCollisionContext({ arena, diceState, settings }) {
  const halfWidth = arena.width / 2;
  const halfDepth = arena.depth / 2;
  const safeRadius = safeRadiusFor(settings);
  const robotWidth = Number(settings?.width ?? 0.16);
  const exitClearance = Number(settings?.exitClearance ?? 0.04);
  const passageRadius = robotWidth / 2 + exitClearance;
  const gapEnd = -halfWidth + arena.exitWidth;
  const obstacles = [
    obstacleFromBox(diceState.leftBoxX, arena.leftBox.z, arena.leftBox, 'left-box'),
    obstacleFromBox(diceState.rightBoxX, arena.rightBox.z, arena.rightBox, 'right-box'),
    makeAabb(-halfWidth, halfWidth, -halfDepth, -halfDepth, 'top-wall'),
    makeAabb(-halfWidth, -halfWidth, -halfDepth, halfDepth, 'left-wall'),
    makeAabb(halfWidth, halfWidth, -halfDepth, halfDepth, 'right-wall'),
    makeAabb(gapEnd, halfWidth, halfDepth, halfDepth, 'bottom-wall'),
  ];

  return {
    safeRadius,
    passageRadius,
    exitClearance,
    robotWidth,
    obstacles,
    bounds: {
      minX: -halfWidth,
      maxX: halfWidth,
      minZ: -halfDepth,
      maxZ: halfDepth + safeRadius + settings.gridSize,
    },
    exit: {
      minX: -halfWidth,
      maxX: gapEnd,
      edgeZ: halfDepth,
      bonusMaxX: -halfWidth + arena.bonusWidth,
    },
  };
}

function distanceToAabb(point, obstacle) {
  const dx = Math.max(obstacle.minX - point.x, 0, point.x - obstacle.maxX);
  const dz = Math.max(obstacle.minZ - point.z, 0, point.z - obstacle.maxZ);
  return Math.hypot(dx, dz);
}

function rawClearance(point, context) {
  let closest = Infinity;
  for (const obstacle of context.obstacles) {
    closest = Math.min(closest, distanceToAabb(point, obstacle));
  }
  return closest - context.safeRadius;
}

export function pointIsBlocked(point, context) {
  const { bounds, exit, safeRadius, passageRadius = safeRadius } = context;
  if (point.x < bounds.minX - EPSILON || point.x > bounds.maxX + EPSILON
      || point.z < bounds.minZ - EPSILON || point.z > bounds.maxZ + EPSILON) {
    return true;
  }

  // ประตูทางออก (z > exit.edgeZ): บังคับช่องซ้าย/ขวา อย่างเด็ดขาดเมื่อผ่านแนวประตู
  if (point.z > exit.edgeZ + EPSILON && !context.directExit) {
    if (context.targetGoalType === 'bonus') {
      const bonusMin = exit.minX + passageRadius;
      const bonusMax = exit.bonusMaxX - passageRadius;
      if (point.x < bonusMin - EPSILON || point.x > bonusMax + EPSILON) return true;
    } else if (context.targetGoalType === 'regular') {
      const regMin = exit.bonusMaxX + passageRadius;
      const regMax = exit.maxX - passageRadius;
      const minX = (regMax < regMin - EPSILON) ? exit.minX + passageRadius : regMin;
      if (point.x < minX - EPSILON || point.x > regMax + EPSILON) return true;
    } else {
      const minX = exit.minX + passageRadius;
      const maxX = exit.maxX - passageRadius;
      if (point.x < minX - EPSILON || point.x > maxX + EPSILON) return true;
    }
  }

  // บริเวณเข้าใกล้ประตูทางออก
  const isApproachingExit = point.z >= exit.edgeZ - 0.35 && point.x <= exit.maxX;

  for (const obstacle of context.obstacles) {
    // บริเวณประตูทางออก ขอบกำแพงซ้ายและกำแพงล่างใช้ passageRadius เพื่อให้วิ่งเข้า/ออกจากช่องทางออกได้จริง
    if (obstacle.kind === 'left-wall' && isApproachingExit) {
      if (point.x - obstacle.maxX < passageRadius - EPSILON) return true;
      continue;
    }
    if (obstacle.kind === 'bottom-wall' && isApproachingExit) {
      if (distanceToAabb(point, obstacle) < passageRadius - EPSILON) return true;
      continue;
    }
    if (distanceToAabb(point, obstacle) < safeRadius - EPSILON) return true;
  }
  return false;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(value) {
    const items = this.items;
    items.push(value);
    let index = items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (items[parent].priority <= value.priority) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = value;
  }

  pop() {
    const items = this.items;
    const root = items[0];
    const last = items.pop();
    if (items.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= items.length) break;
        const child = right < items.length && items[right].priority < items[left].priority ? right : left;
        if (items[child].priority >= last.priority) break;
        items[index] = items[child];
        index = child;
      }
      items[index] = last;
    }
    return root;
  }
}

function keyFor(ix, iz) {
  return `${ix},${iz}`;
}

function pointFor(ix, iz, context, gridSize) {
  return {
    x: context.bounds.minX + ix * gridSize,
    z: context.bounds.minZ + iz * gridSize,
  };
}

function nearestIndex(value, minimum, gridSize) {
  return Math.round((value - minimum) / gridSize);
}

function goalCandidates(context, gridSize, type) {
  const { passageRadius = context.safeRadius, exit, bounds } = context;
  let minX, maxX;
  if (type === 'bonus') {
    // ช่องซ้าย 19 นิ้ว (+1 คะแนน): อ้างอิงจากขอบซ้ายของสนามปัจจุบัน
    minX = exit.minX + passageRadius;
    maxX = exit.bonusMaxX - passageRadius;
  } else {
    // ช่องขวา 20 นิ้ว (ออกปกติ): อยู่ระหว่างเส้นแบ่ง (-1.0174) ถึงกำแพงล่าง (-0.5094)
    minX = exit.bonusMaxX + passageRadius;
    maxX = exit.maxX - passageRadius;
    if (maxX < minX - EPSILON) {
      minX = exit.minX + passageRadius;
      maxX = exit.maxX - passageRadius;
    }
  }
  if (maxX < minX - EPSILON) return [];

  const iz = Math.floor((bounds.maxZ - bounds.minZ) / gridSize + EPSILON);
  const firstIx = Math.ceil((minX - bounds.minX) / gridSize - EPSILON);
  const lastIx = Math.floor((maxX - bounds.minX) / gridSize + EPSILON);
  const candidates = [];
  for (let ix = firstIx; ix <= lastIx; ix++) {
    const point = pointFor(ix, iz, context, gridSize);
    if (!pointIsBlocked(point, context)) candidates.push({ ix, iz, point });
  }

  // เปิดทุกจุดที่ผ่านได้ให้ตัวค้นหาเลือกตามระยะและจำนวนครั้งที่เลี้ยว
  return candidates;
}

function reconstructPath(cameFrom, currentKey, nodes) {
  const path = [nodes.get(currentKey)];
  let key = currentKey;
  while (cameFrom.has(key)) {
    key = cameFrom.get(key);
    path.push(nodes.get(key));
  }
  return path.reverse().map(({ x, z }) => ({ x, z }));
}

function runAStar(start, goals, context, gridSize, planningMode, initialDirection = 'ล่าง', allowReverse = true, preferRightTurns = false) {
  if (goals.length === 0) return null;
  const maxIx = Math.floor((context.bounds.maxX - context.bounds.minX) / gridSize + EPSILON);
  const maxIz = Math.floor((context.bounds.maxZ - context.bounds.minZ) / gridSize + EPSILON);
  const goalKeys = new Set(goals.map(({ ix, iz }) => keyFor(ix, iz)));
  const heuristic = (ix, iz) => {
    let best = Infinity;
    for (const goal of goals) best = Math.min(best, Math.abs(goal.ix - ix) + Math.abs(goal.iz - iz));
    return best * gridSize;
  };

  const open = new MinHeap();
  const gScore = new Map();
  const cameFrom = new Map();
  const nodes = new Map();
  const closed = new Set();
  const rootConnectors = new Map();

  // จุดเริ่มจริงอาจอยู่ระหว่างช่อง Grid โดยเฉพาะเมื่อเปลี่ยนขนาดสนาม
  // เพิ่มช่วงเชื่อมที่เป็นมุมฉากและตรวจการชน ก่อนเริ่มค้นหาบนตาราง
  const xFraction = (start.x - context.bounds.minX) / gridSize;
  const zFraction = (start.z - context.bounds.minZ) / gridSize;
  const startHeading = HEADING_ANGLES[initialDirection] ?? 0;
  for (const ix of new Set([Math.floor(xFraction), Math.ceil(xFraction)])) {
    for (const iz of new Set([Math.floor(zFraction), Math.ceil(zFraction)])) {
      if (ix < 0 || iz < 0 || ix > maxIx || iz > maxIz) continue;
      const point = pointFor(ix, iz, context, gridSize);
      if (pointIsBlocked(point, context)) continue;
      for (const corner of [{ x: point.x, z: start.z }, { x: start.x, z: point.z }]) {
        const connector = compactCollinearPoints([start, corner, point]);
        if (connector.some((p, i) => i > 0 && !lineIsClear(connector[i - 1], p, context))) continue;
        const connection = buildCommands(connector, initialDirection, {
          speed: 1, turnSeconds90: 1, allowReverse, preferRightTurns,
        });
        const last = connection.segments.at(-1);
        const heading = last
          ? ((Math.atan2(last.to.x - last.from.x, last.to.z - last.from.z) * 180 / Math.PI
              + (last.motionType === 'reverse' ? 180 : 0) + 540) % 360) - 180
          : startHeading;
        const key = `${keyFor(ix, iz)}:${heading}`;
        const cost = connection.totalDistance + connection.turnCount * gridSize;
        if (cost >= (gScore.get(key) ?? Infinity)) continue;
        gScore.set(key, cost);
        nodes.set(key, { ...point, ix, iz, heading });
        rootConnectors.set(key, connector);
        open.push({ ix, iz, heading, key, cost, priority: cost + heuristic(ix, iz) });
      }
    }
  }
  if (open.size === 0) return null;

  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const isPassMode = planningMode === 'pass';
  const proximityWeight = isPassMode ? 2.8 : (planningMode === 'fastest' ? 0.05 : 0.25);
  const turnPenaltyWeight = isPassMode ? 0.8 : (planningMode === 'fastest' ? 3.0 : 1.8);

  while (open.size > 0) {
    const current = open.pop();
    if (closed.has(current.key)) continue;
    if (goalKeys.has(keyFor(current.ix, current.iz))) {
      const path = reconstructPath(cameFrom, current.key, nodes);
      let root = current.key;
      while (cameFrom.has(root)) root = cameFrom.get(root);
      return [...rootConnectors.get(root).slice(0, -1), ...path];
    }
    closed.add(current.key);

    for (const [dx, dz] of directions) {
      const ix = current.ix + dx;
      const iz = current.iz + dz;
      if (ix < 0 || ix > maxIx || iz < 0 || iz > maxIz) continue;
      const point = pointFor(ix, iz, context, gridSize);
      if (pointIsBlocked(point, context)) continue;
      const targetAngle = dz > 0 ? 0 : dz < 0 ? 180 : dx > 0 ? 90 : -90;
      const forwardTurn = ((targetAngle - current.heading + 540) % 360) - 180;
      const reverseTurn = ((targetAngle + 180 - current.heading + 540) % 360) - 180;
      const reverseAvoidsTurn = Math.abs(forwardTurn) >= 150 && Math.abs(reverseTurn) <= 30;
      const reverseUsesRightTurn = preferRightTurns && forwardTurn > EPSILON
        && reverseTurn < -EPSILON && Math.abs(reverseTurn) <= Math.abs(forwardTurn) + EPSILON;
      const reverse = allowReverse && (reverseAvoidsTurn || reverseUsesRightTurn);
      const angle = Math.abs(reverse ? reverseTurn : forwardTurn);
      const heading = ((targetAngle + (reverse ? 180 : 0) + 540) % 360) - 180;
      const key = `${keyFor(ix, iz)}:${heading}`;
      if (closed.has(key)) continue;

      const clearance = Math.max(0, rawClearance(point, context));
      const safetyThreshold = isPassMode ? 0.90 : 0.35;
      let proximityPenalty = 0;
      if (clearance < safetyThreshold) {
        if (isPassMode) {
          const deficit = safetyThreshold - clearance;
          proximityPenalty = Math.pow(deficit, 1.3) * 6.5 * gridSize;
        } else {
          proximityPenalty = (safetyThreshold - clearance) * proximityWeight;
        }
      }
      const turnPenalty = gridSize * turnPenaltyWeight * angle / 90;
      const tentative = gScore.get(current.key) + gridSize + proximityPenalty + turnPenalty;
      if (tentative + EPSILON >= (gScore.get(key) ?? Infinity)) continue;

      cameFrom.set(key, current.key);
      gScore.set(key, tentative);
      nodes.set(key, { ...point, ix, iz, heading });
      open.push({ ix, iz, heading, key, cost: tentative, priority: tentative + heuristic(ix, iz) });
    }
  }
  return null;
}

export function simplifyOrthogonalPath(points) {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const simplified = [{ ...points[0] }];
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const firstDx = Math.sign(current.x - previous.x);
    const firstDz = Math.sign(current.z - previous.z);
    const secondDx = Math.sign(next.x - current.x);
    const secondDz = Math.sign(next.z - current.z);
    if (firstDx !== secondDx || firstDz !== secondDz) simplified.push({ ...current });
  }
  simplified.push({ ...points.at(-1) });
  return simplified;
}

function segmentIsClear(from, to, context, gridSize) {
  if (Math.abs(from.x - to.x) > EPSILON && Math.abs(from.z - to.z) > EPSILON) return false;
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / (gridSize / 2)));
  for (let index = 0; index <= steps; index++) {
    const ratio = index / steps;
    if (pointIsBlocked({
      x: from.x + (to.x - from.x) * ratio,
      z: from.z + (to.z - from.z) * ratio,
    }, context)) return false;
  }
  return true;
}

function stretchShortOrthogonalMoves(points, context, gridSize) {
  const minimum = 0.10; // 5 ซม. คือเพียง ~9 tick และไวต่อระยะไหลหลังเบรก
  const result = points.map(point => ({ ...point }));
  const valid = candidate => candidate.every((point, index) => index === 0
    || segmentIsClear(candidate[index - 1], point, context, gridSize));
  for (let index = 0; index < result.length - 1; index++) {
    const from = result[index], to = result[index + 1];
    const dx = to.x - from.x, dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= minimum - EPSILON || distance < EPSILON) continue;
    const horizontal = Math.abs(dx) > Math.abs(dz);
    const axis = horizontal ? 'x' : 'z';
    const delta = horizontal ? dx : dz;
    // ย้ายแนวตรงหลังช่วงสั้นก่อน; พิกัดเริ่มจริงจะไม่ถูกย้าย
    if (index + 2 < result.length
        && Math.abs(result[index + 2][axis] - to[axis]) < EPSILON) {
      const candidate = result.map(point => ({ ...point }));
      const coordinate = from[axis] + Math.sign(delta) * minimum;
      candidate[index + 1][axis] = coordinate;
      candidate[index + 2][axis] = coordinate;
      if (valid(candidate)) { result.splice(0, result.length, ...candidate); continue; }
    }
    if (index >= 2 && Math.abs(result[index - 1][axis] - from[axis]) < EPSILON) {
      const candidate = result.map(point => ({ ...point }));
      const coordinate = to[axis] - Math.sign(delta) * minimum;
      candidate[index - 1][axis] = coordinate;
      candidate[index][axis] = coordinate;
      if (valid(candidate)) result.splice(0, result.length, ...candidate);
    }
  }
  return result;
}

function simplifySafePath(points, context, gridSize, isPassMode = false) {
  if (points.length <= 2) return simplifyOrthogonalPath(points);
  const result = [{ ...points[0] }];
  let sourceIndex = 0;

  while (sourceIndex < points.length - 1) {
    let advanced = false;
    for (let targetIndex = points.length - 1; targetIndex > sourceIndex; targetIndex--) {
      const from = points[sourceIndex];
      const to = points[targetIndex];

      if ((Math.abs(from.x - to.x) < EPSILON || Math.abs(from.z - to.z) < EPSILON)
          && segmentIsClear(from, to, context, gridSize)) {
        result.push({ ...to });
        sourceIndex = targetIndex;
        advanced = true;
        break;
      }

      const corners = [
        { x: from.x, z: to.z },
        { x: to.x, z: from.z },
      ];
      for (const corner of corners) {
        if (!segmentIsClear(from, corner, context, gridSize) || !segmentIsClear(corner, to, context, gridSize)) continue;

        if (isPassMode) {
          let minOriginalClearance = Infinity;
          for (let i = sourceIndex; i <= targetIndex; i++) {
            minOriginalClearance = Math.min(minOriginalClearance, rawClearance(points[i], context));
          }
          const cornerClearance = rawClearance(corner, context);
          if (cornerClearance < minOriginalClearance - 0.12) {
            continue;
          }
        }

        if (Math.hypot(corner.x - from.x, corner.z - from.z) > EPSILON
            && Math.hypot(to.x - corner.x, to.z - corner.z) > EPSILON) {
          result.push(corner);
        }
        result.push({ ...to });
        sourceIndex = targetIndex;
        advanced = true;
        break;
      }
      if (advanced) break;
    }
    if (!advanced) {
      sourceIndex += 1;
      result.push({ ...points[sourceIndex] });
    }
  }
  return stretchShortOrthogonalMoves(simplifyOrthogonalPath(result), context, gridSize);
}

function directionForSegment(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'ขวา' : 'ซ้าย';
  return dz > 0 ? 'ล่าง' : 'บน';
}

function turnCommand(fromDirection, toDirection) {
  const from = HEADING_ORDER.indexOf(fromDirection);
  const to = HEADING_ORDER.indexOf(toDirection);
  if (from < 0 || to < 0) throw new RangeError('ทิศทางไม่ถูกต้อง');
  const steps = (to - from + 4) % 4;
  if (steps === 0) return null;
  if (steps === 1) return { type: 'turn-right', degrees: 90, label: 'หมุนขวา 90°' };
  if (steps === 3) return { type: 'turn-left', degrees: 90, label: 'หมุนซ้าย 90°' };
  return { type: 'turn-around', degrees: 180, label: 'หมุนกลับ 180°' };
}

export function buildCommands(points, initialDirection, settings) {
  points = compactCollinearPoints(points);
  const commands = [];
  const segments = [];
  let curAngle = typeof initialDirection === 'number' ? initialDirection : (HEADING_ANGLES[initialDirection] ?? 0);
  let totalDistance = 0;
  let turnCount = 0;
  let turnUnits = 0;
  const allowReverse = settings?.allowReverse !== false;
  const preferRightTurns = settings?.preferRightTurns === true;

  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index];
    const to = points[index + 1];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) continue;

    let targetAngleDeg;
    if (Math.abs(dx) < 1e-5) {
      targetAngleDeg = dz > 0 ? 0 : 180;
    } else if (Math.abs(dz) < 1e-5) {
      targetAngleDeg = dx > 0 ? 90 : -90;
    } else {
      targetAngleDeg = Math.atan2(dx, dz) * 180 / Math.PI;
    }

    let fwdDiff = ((targetAngleDeg - curAngle + 540) % 360) - 180;
    const revAngleDeg = ((targetAngleDeg + 180 + 180) % 360) - 180;
    let revDiff = ((revAngleDeg - curAngle + 540) % 360) - 180;

    let useReverse = false;
    let chosenDiff = fwdDiff;

    if (allowReverse) {
      const reverseAvoidsTurn = Math.abs(fwdDiff) >= 150 && Math.abs(revDiff) <= 30;
      // สำหรับเส้นทางมุมฉาก การหันขวา 90° แล้วถอยจะเคลื่อนไปในทิศเดียวกับ
      // การหันซ้าย 90° แล้วเดินหน้า ช่วยเลี่ยงทิศหมุนซ้ายที่ผลจริงแปรผันสูงกว่า
      const reverseUsesEquivalentRightTurn = preferRightTurns
        && fwdDiff > EPSILON
        && revDiff < -EPSILON
        && Math.abs(revDiff) <= Math.abs(fwdDiff) + EPSILON;
      if (reverseAvoidsTurn || reverseUsesEquivalentRightTurn) {
        useReverse = true;
        chosenDiff = revDiff;
      }
    }

    const roundedDeg = Math.round(Math.abs(chosenDiff) * 10) / 10;
    if (roundedDeg > 0) {
      const turnType = roundedDeg === 180 ? 'turn-around' : (chosenDiff < 0 ? 'turn-right' : 'turn-left');
      const turnLabel = roundedDeg === 180
        ? 'หมุนกลับ 180°'
        : (turnType === 'turn-right' ? `หมุนขวา ${roundedDeg}°` : `หมุนซ้าย ${roundedDeg}°`);
      commands.push({ type: turnType, degrees: roundedDeg, label: turnLabel });
      turnCount += 1;
      turnUnits += roundedDeg / 90;
      curAngle = ((curAngle + chosenDiff + 540) % 360) - 180;
    }

    const motionType = useReverse ? 'reverse' : 'forward';
    const motionLabel = (useReverse ? 'ถอยหลัง ' : 'เดินหน้า ') + dist.toFixed(2) + ' เมตร';
    commands.push({ type: motionType, distance: dist, label: motionLabel });
    segments.push({ from: { ...from }, to: { ...to }, distance: dist, turnDegrees: roundedDeg, motionType });
    totalDistance += dist;
  }

  return {
    commands,
    segments,
    totalDistance,
    turnCount,
    estimatedSeconds: totalDistance / settings.speed + turnUnits * settings.turnSeconds90,
  };
}

function emptyResult(status, reason, safeRadius) {
  return {
    status,
    reason,
    goalType: null,
    usedFallback: false,
    safeRadius,
    points: [],
    segments: [],
    commands: [],
    totalDistance: 0,
    turnCount: 0,
    estimatedSeconds: 0,
  };
}

// Visibility graph for free-angle routes. All edges use the same box margin;
// exit candidates span the usable opening instead of fixing its center.
// Swept oriented rectangle vs an axis-aligned wall (SAT). This checks the
// complete translation, including the rear of the robot as it exits diagonally.
function sweptFootprintHitsWall(from, to, wall, width, length, clearance) {
  const dx=to.x-from.x, dz=to.z-from.z, distance=Math.hypot(dx,dz);
  if(distance<EPSILON) return false;
  const ux=dx/distance, uz=dz/distance, vx=-uz, vz=ux;
  const cx=(from.x+to.x)/2, cz=(from.z+to.z)/2;
  const halfLong=(distance+length)/2, halfWide=width/2;
  const wx=(wall.minX+wall.maxX)/2, wz=(wall.minZ+wall.maxZ)/2;
  const hx=(wall.maxX-wall.minX)/2+clearance, hz=(wall.maxZ-wall.minZ)/2+clearance;
  for(const [ax,az] of [[1,0],[0,1],[ux,uz],[vx,vz]]) {
    const separation=Math.abs((cx-wx)*ax+(cz-wz)*az);
    const radius=halfLong*Math.abs(ux*ax+uz*az)+halfWide*Math.abs(vx*ax+vz*az)
      +hx*Math.abs(ax)+hz*Math.abs(az);
    if(separation>radius+EPSILON) return false;
  }
  return true;
}

export function directEdgeIsClear(from, to, context, settings) {
  const margin=Math.max(0,Number(settings.directSafetyMargin??.20));
  const dx=to.x-from.x,dz=to.z-from.z,length=Math.hypot(dx,dz);
  if(length<EPSILON) return false;
  const count=Math.max(1,Math.ceil(length/.01));
  for(let i=0;i<=count;i++) {
    const p={x:from.x+dx*i/count,z:from.z+dz*i/count};
    if(rawBoxClearance(p,context)<margin-EPSILON) return false;
    // Keep the original full turning clearance in the arena. Near the exit,
    // validate the oriented swept footprint against real walls instead.
    if(p.z<context.exit.edgeZ-.35 && pointIsBlocked(p,context)) return false;
  }
  for(const wall of context.obstacles.filter(o=>o.kind.endsWith('-wall'))) {
    if(sweptFootprintHitsWall(from,to,wall,settings.width,settings.length,context.exitClearance)) return false;
  }
  if(from.z<=context.exit.edgeZ && to.z>context.exit.edgeZ) {
    if(dz<=0) return false;
    const crossingX=from.x+dx*(context.exit.edgeZ-from.z)/dz;
    const halfSpan=Math.max(settings.width*length/(2*dz),
      (settings.width*Math.abs(dz)+settings.length*Math.abs(dx))/(2*length))+context.exitClearance;
    const lo=context.targetGoalType==='bonus' || context.targetGoalType==='manual'?context.exit.minX:context.exit.bonusMaxX;
    const hi=context.targetGoalType==='bonus'?context.exit.bonusMaxX:context.exit.maxX;
    if(crossingX-halfSpan<lo-EPSILON || crossingX+halfSpan>hi+EPSILON) return false;
  }
  return true;
}

export function turnHasAtLeastOneTick(command, settings) {
  if (!command.type.startsWith('turn-') || command.type === 'turn-around') return true;
  const side = command.type === 'turn-right' ? 'Right' : 'Left';
  const left = Number(settings[`turn${side}45LeftTicks`] ?? 14.5);
  const right = Number(settings[`turn${side}45RightTicks`] ?? 13);
  return command.degrees * left / 45 >= 1 && command.degrees * right / 45 >= 1;
}

function visibilityRoute(start, context, settings, initialDirection) {
  const nodes = [{ ...start }];
  const margin = Math.max(0, Number(settings.directSafetyMargin ?? 0.20));
  const radius = context.safeRadius + margin + 0.008;
  function add(point, outside = false) {
    if ((outside || (!pointIsBlocked(point, context) && rawClearance(point, context) >= -EPSILON)) && rawBoxClearance(point, context) >= margin - EPSILON
        && !nodes.some(p => Math.hypot(p.x-point.x,p.z-point.z)<1e-6)) nodes.push(point);
  }
  for (const box of context.obstacles.filter(o => o.kind.endsWith('-box'))) {
    // Outer rectangular corners plus rounded-corner samples. Connecting chords
    // are collision-tested, so none may cut the inflated obstacle boundary.
    for (const [x,z,sx,sz] of [[box.minX,box.minZ,-1,-1],[box.maxX,box.minZ,1,-1],
                              [box.minX,box.maxZ,-1,1],[box.maxX,box.maxZ,1,1]]) {
      add({x:x+sx*radius,z:z+sz*radius});
      for (let k=0;k<=4;k++) {
        const angle=k*Math.PI/8;
        add({x:x+sx*radius*Math.cos(angle),z:z+sz*radius*Math.sin(angle)});
      }
    }
  }
  const lo = context.targetGoalType === 'bonus' ? context.exit.minX : context.exit.bonusMaxX;
  const hi = context.targetGoalType === 'bonus' ? context.exit.bonusMaxX : context.exit.maxX;
  // Approach points permit straight alignment when an angled footprint cannot fit.
  for (let i=0;i<=12;i++) {
    const x=lo+context.passageRadius+(hi-lo-2*context.passageRadius)*i/12;
    add({x,z:context.exit.edgeZ-context.safeRadius-0.02});
  }
  const firstGoal=nodes.length;
  if (hi-lo <= 2*context.passageRadius) return null;
  for(let i=0;i<=48;i++) add({
    // Goal is fully beyond the gate: its center need not remain in the score strip.
    // The edge validator checks the chosen strip at the actual crossing.
    x:context.exit.minX-0.6+(context.exit.maxX-context.exit.minX+1.2)*i/48,
    z:context.bounds.maxZ,
  }, true);
  if(nodes.length===firstGoal) return null;
  const edges=nodes.map(()=>[]);
  for(let i=0;i<firstGoal;i++) for(let j=1;j<nodes.length;j++) {
    if(i!==j && directEdgeIsClear(nodes[i],nodes[j],context,settings)) edges[i].push(j);
  }
  const heap=new MinHeap(), costs=new Map();
  heap.push({node:0,heading:HEADING_ANGLES[initialDirection]??0,priority:0,path:[0],key:'start'});
  costs.set('start',0);
  while(heap.size) {
    const current=heap.pop();
    if(current.priority>costs.get(current.key)+EPSILON) continue;
    if(current.node>=firstGoal) return current.path.map(i=>nodes[i]);
    for(const next of edges[current.node]) {
      const a=nodes[current.node], b=nodes[next];
      const step=buildCommands([a,b],current.heading,settings);
      // ห้ามวางแผนเลี้ยวเล็กกว่า 1 tick ของล้อใดล้อหนึ่ง
      if (step.commands.some(command => !turnHasAtLeastOneTick(command, settings))) continue;
      const motion=step.commands[step.commands.length-1];
      const heading=Math.atan2(b.x-a.x,b.z-a.z)*180/Math.PI+(motion.type==='reverse'?180:0);
      const key=`${current.node}:${next}:${motion.type}`;
      // Include per-turn settling cost as well as distance and rotation time.
      const cost=current.priority+step.estimatedSeconds+step.turnCount*0.5;
      if(cost<(costs.get(key)??Infinity)-EPSILON) {
        costs.set(key,cost);
        heap.push({node:next,heading:((heading+540)%360)-180,priority:cost,path:[...current.path,next],key});
      }
    }
  }
  return null;
}

function planDirectRoute(start, context, settings, diceState) {
  let best=null;
  for(const goalType of ['bonus','regular']) {
    const goalContext={...context,targetGoalType:goalType,directExit:true};
    const points=visibilityRoute(start,goalContext,settings,diceState.robotDirection);
    if(!points) continue;
    const commands=buildCommands(points,diceState.robotDirection,settings);
    const cost=commands.estimatedSeconds+commands.turnCount*0.5;
    if(!best || cost<best.cost) best={points,commands,cost,goalType};
    if(settings.planningMode==='score') break;
  }
  if(!best) return emptyResult('no_path','ไม่พบทางตรงที่ผ่านได้ตามระยะเผื่อและขนาดรถปัจจุบัน',context.safeRadius);
  let minimumClearance=Infinity;
  for(const segment of best.commands.segments) {
    const count=Math.max(1,Math.ceil(segment.distance/.01));
    for(let i=0;i<=count;i++) minimumClearance=Math.min(minimumClearance,rawClearance({
      x:segment.from.x+(segment.to.x-segment.from.x)*i/count,
      z:segment.from.z+(segment.to.z-segment.from.z)*i/count,
    },context));
  }
  return {status:'found',reason:'เส้นทางตรงเลือกจุดออกตามพื้นที่ผ่านได้ และคิดเวลาเลี้ยวร่วมกับระยะทาง',
    goalType:best.goalType,usedFallback:settings.planningMode==='score' && best.goalType!=='bonus',
    safeRadius:context.safeRadius,exitClearance:context.exitClearance,
    directSafetyMargin:Math.max(0,Number(settings.directSafetyMargin??.2)),minimumClearance,
    points:best.points,...best.commands};
}

export function planRoute({ arena, diceState, settings }) {
  const context = buildCollisionContext({ arena, diceState, settings });
  const start = { x: arena.robot.x, z: arena.robot.z };
  if (pointIsBlocked(start, context)) {
    return emptyResult(
      'start_blocked',
      'จุดเริ่มต้นแคบเกินไปสำหรับขนาดหุ่นยนต์และระยะเผื่อปัจจุบัน',
      context.safeRadius,
    );
  }

  const allowReverse = settings?.allowReverse !== false;
  const mode = settings?.planningMode ?? 'score';
  // เส้นเฉียงสร้างมุมที่อาจไม่ตรงกับจุดคาลิเบรต จึงใช้เมื่อผู้ใช้เปิดเองเท่านั้น
  const useDirect = mode !== 'pass' && settings?.directLine === true;
  const directSafetyMargin = Math.max(0, Number(settings?.directSafetyMargin ?? 0.20));
  if (useDirect) return planDirectRoute(start, context, settings, diceState);

  if (mode === 'fastest') {
    let best = null;
    for (const goalType of ['bonus', 'regular']) {
      const goalContext = { ...context, targetGoalType: goalType };
      const goals = goalCandidates(goalContext, settings.gridSize, goalType);
      const candidatePath = runAStar(start, goals, goalContext, settings.gridSize,
        'fastest', diceState.robotDirection, allowReverse, settings.preferRightTurns);
      if (!candidatePath) continue;
      const candidatePoints = simplifySafePath(candidatePath, goalContext, settings.gridSize);
      const candidateCommands = buildCommands(candidatePoints, diceState.robotDirection, settings);
      const candidate = {
        rawPath: candidatePath,
        points: candidatePoints,
        commands: candidateCommands,
        goalType,
        estimatedSeconds: candidateCommands.estimatedSeconds,
      };
      if (!best
          || candidate.estimatedSeconds < best.estimatedSeconds - EPSILON
          || (Math.abs(candidate.estimatedSeconds - best.estimatedSeconds) <= EPSILON && candidate.commands.turnCount < best.commands.turnCount)
          || (Math.abs(candidate.estimatedSeconds - best.estimatedSeconds) <= EPSILON && candidate.goalType === 'bonus' && best.goalType !== 'bonus')) {
        best = candidate;
      }
    }
    if (!best) {
      return {
        ...emptyResult(
          'no_path',
          'ไม่พบเส้นทางปลอดภัย ลองลดระยะเผื่อ ตรวจขนาดหุ่นยนต์ หรือเปลี่ยนตำแหน่งกล่อง',
          context.safeRadius,
        ),
        usedFallback: false,
      };
    }
    const clearanceSamples = best.rawPath.length > 1 ? best.rawPath.slice(1) : best.rawPath;
    const minimumClearance = Math.min(...clearanceSamples.map((point) => rawClearance(point, context)));
    return {
      status: 'found',
      reason: useDirect
        ? (best.goalType === 'bonus' ? 'เส้นทางตรงเร็วที่สุด โดยเผื่อการเบนจากมุมรอบกล่อง' : 'เส้นทางตรงสู่ช่องออก โดยเผื่อการเบนจากมุมรอบกล่อง')
        : 'เส้นทางเร็วที่สุดแบบมุมฉาก ใช้เฉพาะมุมที่คาลิเบรตแล้วเพื่อลดโอกาสชน',
      goalType: best.goalType,
      usedFallback: best.goalType !== 'bonus',
      safeRadius: context.safeRadius,
      directSafetyMargin: useDirect ? directSafetyMargin : 0,
      minimumClearance,
      points: best.points,
      ...best.commands,
    };
  }

  let rawPath = null;
  let preparedPoints = null;
  let preparedCommands = null;
  let preparedMinimumClearance = null;
  let goalType = 'regular';
  let usedFallback = false;

  if (mode === 'score') {
    const bonusContext = { ...context, targetGoalType: 'bonus' };
    rawPath = runAStar(start, goalCandidates(bonusContext, settings.gridSize, 'bonus'), bonusContext, settings.gridSize, 'score', diceState.robotDirection, allowReverse, settings.preferRightTurns);
    if (rawPath) {
      goalType = 'bonus';
      context.targetGoalType = 'bonus';
    } else {
      usedFallback = true;
      rawPath = runAStar(start, goalCandidates(context, settings.gridSize, 'regular'), context, settings.gridSize, 'score', diceState.robotDirection, allowReverse, settings.preferRightTurns);
      context.targetGoalType = 'regular';
    }
  } else {
    // โหมด pass (เน้นผ่านปลอดภัย): ใช้ A* มุมฉาก 90° และช่องออกปกติ โดยไม่บังคับเสี่ยงเข้าช่วงโบนัส
    context.targetGoalType = 'regular';
    const regularGoals = goalCandidates(context, settings.gridSize, 'regular');
    rawPath = runAStar(start, regularGoals, context, settings.gridSize, 'pass', diceState.robotDirection, allowReverse, settings.preferRightTurns);
    goalType = 'regular';
  }

  if (!rawPath) {
    return {
      ...emptyResult(
        'no_path',
        'ไม่พบเส้นทางปลอดภัย ลองลดระยะเผื่อ ตรวจขนาดหุ่นยนต์ หรือเปลี่ยนตำแหน่งกล่อง',
        context.safeRadius,
      ),
      usedFallback,
    };
  }

  const points = preparedPoints ?? (useDirect
    ? stringPull(rawPath, context, 0.015, directSafetyMargin)
    : simplifySafePath(rawPath, context, settings.gridSize, mode === 'pass'));
  const commandResult = preparedCommands ?? buildCommands(points, diceState.robotDirection, settings);
  const minimumClearance = preparedMinimumClearance ?? Math.min(...rawPath.map((point) => rawClearance(point, context)));
  return {
    status: 'found',
    reason: mode === 'pass'
      ? 'เส้นทางปลอดภัย A* (A-Star) มุมฉาก 90° ออกช่องปกติ โดยไม่บังคับช่วงโบนัส'
      : (usedFallback ? 'ช่วงคะแนนพิเศษผ่านไม่ได้ จึงเลือกช่องออกปกติที่ปลอดภัย' : 'เส้นทางเน้นคะแนน มุ่งสู่ช่องซ้าย 19 นิ้ว (+1 คะแนน)'),
    goalType,
    usedFallback,
    safeRadius: context.safeRadius,
    exitClearance: context.exitClearance,
    directSafetyMargin: useDirect ? directSafetyMargin : 0,
    minimumClearance,
    points,
    ...commandResult,
  };
}
