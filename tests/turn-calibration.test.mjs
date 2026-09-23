import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, saveSettings, loadSettings } from '../settings-store.js';
import { turnTargets, suggestTurnTicks, applyTurnSuggestion } from '../turn-calibration.js';
import { generateTurnTestCode, generateArduinoCode } from '../arduino-exporter.js';

const before = turnTargets(DEFAULT_SETTINGS, 'right', 100);
assert.deepEqual(before, { leftTicks: 33, rightTicks: 30 });
const correction = suggestTurnTicks({ targetDegrees: 100, actualDegrees: 90, ...before });
assert.deepEqual([correction.leftTicks, correction.rightTicks], [37, 33]);
const calibrated = applyTurnSuggestion(DEFAULT_SETTINGS, 'right', 100, correction);
assert.deepEqual(turnTargets(calibrated, 'right', 100), { leftTicks: 37, rightTicks: 33 });
assert.deepEqual(turnTargets(calibrated, 'left', 100), turnTargets(DEFAULT_SETTINGS, 'left', 100));

const memory = new Map();
const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
saveSettings(storage, calibrated);
assert.deepEqual(turnTargets(loadSettings(storage), 'right', 100), { leftTicks: 37, rightTicks: 33 });

const sketch = generateTurnTestCode({ settings: calibrated, trials: [
  { direction: 'right', degrees: 90 }, { direction: 'right', degrees: 100 },
] });
assert.match(sketch, /TURN TEST READY: send a digit 1-2/);
assert.match(sketch, /if \(choice == '1'\) \{ degrees = 90\.00f; direction = 1; \}/);
assert.match(sketch, /if \(choice == '2'\) \{ degrees = 100\.00f; direction = 1; \}/);
assert.match(sketch, /const float TURN_RIGHT_DEGREES\[\] = \{ 45\.00f, 90\.00f, 100\.00f, 180\.00f \}/);
assert.match(sketch, /const float TURN_RIGHT_LEFT_TABLE\[\] = \{[^\n]*37\.00f/);
assert.doesNotMatch(sketch, /พร้อมเริ่มวิ่ง/);
const route = generateArduinoCode({ route: { commands: [{ type: 'turn-right', degrees: 100 }] }, settings: calibrated });
assert.match(route, /const float TURN_RIGHT_LEFT_TABLE\[\] = \{[^\n]*37\.00f/);
assert.match(route, /พร้อมเริ่มวิ่งทันที/);
assert.throws(() => suggestTurnTicks({ targetDegrees: 90, actualDegrees: 0, leftTicks: 30, rightTicks: 27 }), RangeError);

import {
  extractRouteTurns,
  groupRouteTurns,
  buildTrialsFromRoute,
  saveActiveRunState,
  loadActiveRunState,
} from '../turn-calibration.js';

const mockRoute = {
  commands: [
    { type: 'reverse', distance: 2.5, label: 'ถอยหลัง 2.50 ม.' },
    { type: 'turn-right', degrees: 90, label: 'หมุนขวา 90°' },
    { type: 'forward', distance: 1.2, label: 'เดินหน้า 1.20 ม.' },
    { type: 'turn-right', degrees: 90, label: 'หมุนขวา 90°' },
    { type: 'turn-left', degrees: 45, label: 'หมุนซ้าย 45°' },
  ],
};

const extracted = extractRouteTurns(mockRoute);
assert.equal(extracted.length, 3);
assert.deepEqual(extracted[0], { stepIndex: 2, type: 'turn-right', direction: 'right', degrees: 90, label: 'หมุนขวา 90°' });
assert.deepEqual(extracted[1], { stepIndex: 4, type: 'turn-right', direction: 'right', degrees: 90, label: 'หมุนขวา 90°' });
assert.deepEqual(extracted[2], { stepIndex: 5, type: 'turn-left', direction: 'left', degrees: 45, label: 'หมุนซ้าย 45°' });

const grouped = groupRouteTurns(mockRoute);
assert.equal(grouped.length, 2);
assert.deepEqual(grouped[0], { direction: 'right', degrees: 90, label: 'หมุนขวา 90°', steps: [2, 4], count: 2 });
assert.deepEqual(grouped[1], { direction: 'left', degrees: 45, label: 'หมุนซ้าย 45°', steps: [5], count: 1 });

const trials = buildTrialsFromRoute(mockRoute);
assert.equal(trials.length, 2);
assert.equal(trials[0].direction, 'right');
assert.equal(trials[0].degrees, 90);
assert.equal(trials[1].direction, 'left');
assert.equal(trials[1].degrees, 45);

const stateStorage = new Map();
const fakeStorage = { getItem: (k) => stateStorage.get(k) ?? null, setItem: (k, v) => stateStorage.set(k, v) };
saveActiveRunState(fakeStorage, { dice: { directionDie: 3, leftDie: 2, rightDie: 2 } });
assert.deepEqual(loadActiveRunState(fakeStorage), { dice: { directionDie: 3, leftDie: 2, rightDie: 2 } });

// End-to-end workflow: dice -> planRoute -> extract trials -> test code -> measure -> calibrate -> field code
import { ARENA, buildArenaState } from '../arena-state.js';
import { planRoute } from '../path-planner.js';

const realDice = { directionDie: 3, leftDie: 2, rightDie: 2 };
const realDiceState = buildArenaState(realDice);
const realRoute = planRoute({ arena: ARENA, diceState: realDiceState, settings: DEFAULT_SETTINGS });
assert.equal(realRoute.status, 'found');

const routeTrials = buildTrialsFromRoute(realRoute);
assert.ok(routeTrials.length >= 1, 'Should find at least 1 turn trial in route');
assert.equal(routeTrials[0].direction, 'right');
assert.equal(routeTrials[0].degrees, 90);

const testSketch = generateTurnTestCode({ trials: routeTrials, settings: DEFAULT_SETTINGS });
assert.match(testSketch, /degrees = 90\.00f; direction = 1/);

// Simulate user measuring robot turned 82 degrees instead of 90 degrees
const currentTargets = turnTargets(DEFAULT_SETTINGS, routeTrials[0].direction, routeTrials[0].degrees);
const userMeasuredDegrees = 82;
const turnSuggestion = suggestTurnTicks({
  targetDegrees: routeTrials[0].degrees,
  actualDegrees: userMeasuredDegrees,
  leftTicks: currentTargets.leftTicks,
  rightTicks: currentTargets.rightTicks,
});

assert.ok(turnSuggestion.leftTicks > currentTargets.leftTicks, 'Ticks should increase because robot under-turned');
assert.ok(turnSuggestion.rightTicks > currentTargets.rightTicks, 'Ticks should increase because robot under-turned');

const newlyCalibratedSettings = applyTurnSuggestion(
  DEFAULT_SETTINGS,
  routeTrials[0].direction,
  routeTrials[0].degrees,
  turnSuggestion,
);

const updatedFieldCode = generateArduinoCode({
  route: realRoute,
  diceState: realDiceState,
  settings: newlyCalibratedSettings,
  arena: ARENA,
  profile: 'encoder',
});

// Verify the updated field sketch now contains the calibrated ticks
assert.match(updatedFieldCode, new RegExp(`TURN_RIGHT_LEFT_TICKS_90\\s*=\\s*${turnSuggestion.leftTicks}\\.00f`));
assert.match(updatedFieldCode, new RegExp(`TURN_RIGHT_RIGHT_TICKS_90\\s*=\\s*${turnSuggestion.rightTicks}\\.00f`));

if (process.env.ROBOT_TEST_OUTPUT) {
  const fs = await import('node:fs');
  fs.writeFileSync(`${process.env.ROBOT_TEST_OUTPUT}/TurnCalibration/TurnCalibration.ino`, sketch);
  fs.writeFileSync(`${process.env.ROBOT_TEST_OUTPUT}/RobotRoute/RobotRoute.ino`, route);
}
console.log('turn calibration tests passed');


