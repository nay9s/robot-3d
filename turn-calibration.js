export const BASE_TURN_ANGLES = Object.freeze([45, 90, 180]);

export function turnPoints(settings, direction) {
  if (!['left', 'right'].includes(direction)) throw new RangeError('ทิศหมุนไม่ถูกต้อง');
  const prefix = direction === 'right' ? 'turnRight' : 'turnLeft';
  const points = BASE_TURN_ANGLES.map((degrees) => ({
    degrees,
    leftTicks: Number(settings[`${prefix}${degrees}LeftTicks`]),
    rightTicks: Number(settings[`${prefix}${degrees}RightTicks`]),
  }));
  for (const point of settings.turnCalibrationPoints ?? []) {
    if (point.direction === direction && !BASE_TURN_ANGLES.includes(point.degrees)) {
      points.push({ degrees: point.degrees, leftTicks: point.leftTicks, rightTicks: point.rightTicks });
    }
  }
  return points.sort((a, b) => a.degrees - b.degrees);
}

export function turnTargets(settings, direction, degrees) {
  if (!Number.isFinite(degrees) || degrees <= 0 || degrees > 180) throw new RangeError('มุมต้องอยู่ระหว่าง 1–180 องศา');
  const points = turnPoints(settings, direction);
  const interpolate = (wheel) => {
    let previous = { degrees: 0, [wheel]: 0 };
    for (const point of points) {
      if (degrees <= point.degrees) {
        return previous[wheel] + (point[wheel] - previous[wheel]) *
          ((degrees - previous.degrees) / (point.degrees - previous.degrees));
      }
      previous = point;
    }
    return previous[wheel] * degrees / previous.degrees;
  };
  return { leftTicks: Math.max(1, Math.round(interpolate('leftTicks'))), rightTicks: Math.max(1, Math.round(interpolate('rightTicks'))) };
}

export function suggestTurnTicks({ targetDegrees, actualDegrees, leftTicks, rightTicks }) {
  if (![targetDegrees, actualDegrees, leftTicks, rightTicks].every(Number.isFinite)
      || targetDegrees < 1 || targetDegrees > 180 || actualDegrees <= 0
      || leftTicks < 1 || rightTicks < 1) {
    throw new RangeError('กรอกมุมจริงที่มากกว่า 0 และตรวจค่ามุม/tick ที่สั่ง');
  }
  const ratio = targetDegrees / actualDegrees;
  return {
    leftTicks: Math.max(1, Math.round(leftTicks * ratio)),
    rightTicks: Math.max(1, Math.round(rightTicks * ratio)),
    errorDegrees: targetDegrees - actualDegrees,
    ratio,
  };
}

export function applyTurnSuggestion(settings, direction, degrees, suggestion) {
  const next = { ...settings, turnCalibrationPoints: [...(settings.turnCalibrationPoints ?? [])] };
  if (BASE_TURN_ANGLES.includes(degrees)) {
    const prefix = direction === 'right' ? 'turnRight' : 'turnLeft';
    next[`${prefix}${degrees}LeftTicks`] = suggestion.leftTicks;
    next[`${prefix}${degrees}RightTicks`] = suggestion.rightTicks;
  } else {
    next.turnCalibrationPoints = next.turnCalibrationPoints.filter(
      (point) => point.direction !== direction || point.degrees !== degrees,
    );
    next.turnCalibrationPoints.push({ direction, degrees,
      leftTicks: suggestion.leftTicks, rightTicks: suggestion.rightTicks });
  }
  return next;
}

export const ACTIVE_RUN_STORAGE_KEY = 'robot-arena-active-run';

export function saveActiveRunState(storage, state) {
  try {
    if (!storage || !state) return;
    storage.setItem(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota/security exceptions
  }
}

export function loadActiveRunState(storage) {
  try {
    if (!storage) return null;
    const raw = storage.getItem(ACTIVE_RUN_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function extractRouteTurns(route) {
  if (!route || !Array.isArray(route.commands)) return [];
  const turns = [];
  route.commands.forEach((cmd, idx) => {
    if (cmd && (cmd.type === 'turn-right' || cmd.type === 'turn-left' || cmd.type === 'turn-around')) {
      const direction = cmd.type === 'turn-left' ? 'left' : 'right';
      const degrees = Number(cmd.degrees);
      if (Number.isFinite(degrees) && degrees > 0) {
        turns.push({
          stepIndex: idx + 1,
          type: cmd.type,
          direction,
          degrees,
          label: cmd.label || (direction === 'right' ? `หมุนขวา ${degrees}°` : `หมุนซ้าย ${degrees}°`),
        });
      }
    }
  });
  return turns;
}

export function groupRouteTurns(route) {
  const allTurns = extractRouteTurns(route);
  const map = new Map();
  for (const turn of allTurns) {
    const key = `${turn.direction}:${turn.degrees}`;
    if (!map.has(key)) {
      map.set(key, {
        direction: turn.direction,
        degrees: turn.degrees,
        label: turn.label,
        steps: [turn.stepIndex],
        count: 1,
      });
    } else {
      const existing = map.get(key);
      existing.steps.push(turn.stepIndex);
      existing.count += 1;
    }
  }
  return Array.from(map.values());
}

export function buildTrialsFromRoute(route, fallbackTrials = [{ direction: 'right', degrees: 90 }]) {
  const groups = groupRouteTurns(route);
  if (!groups.length) {
    return fallbackTrials.map((t, idx) => ({ ...t, trialIndex: idx + 1, steps: [] }));
  }
  return groups.slice(0, 6).map((group, index) => ({
    trialIndex: index + 1,
    direction: group.direction,
    degrees: group.degrees,
    label: group.label,
    steps: group.steps,
    count: group.count,
  }));
}

