import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ARENA, buildArenaState } from '../arena-state.js';
import { DEFAULT_SETTINGS } from '../settings-store.js';
import { buildManualRoute } from '../manual-route.js';
import { generateArduinoCode } from '../arduino-exporter.js';

const diceState = buildArenaState({ directionDie: 3, leftDie: 2, rightDie: 2 });
const make = (waypoints, overrides = {}) => buildManualRoute({ arena: ARENA, diceState,
  settings: DEFAULT_SETTINGS, waypoints, ...overrides });

assert.equal(make([]).status, 'empty');

const points = [{ x: ARENA.robot.x, z: ARENA.robot.z + .5 },
  { x: ARENA.robot.x - .5, z: ARENA.robot.z + .5 }];
const original = JSON.stringify(points);
const route = make(points);
assert.equal(route.status, 'found');
assert.deepEqual(route.points, [ARENA.robot, ...points]);
assert.equal(JSON.stringify(points), original);
assert.deepEqual(route.commands.map(command => command.type), ['forward', 'turn-right', 'forward']);
assert(Math.abs(route.totalDistance - 1.0) < 1e-9);

// โหมดอิสระ: อนุญาตให้วางจุดใกล้สิ่งกีดขวางหรือระยะสั้นได้โดยไม่ติดบล็อก
assert.equal(make([{ x: ARENA.robot.x, z: ARENA.robot.z + .05 }]).status, 'found');
assert.equal(make([{ x: 1.10, z: .35 }]).status, 'found');
assert.equal(make([points[0], { x: points[0].x + .01, z: points[0].z + .3 }]).status, 'found');

// เปลี่ยนแต้มลูกเต๋าต้องไม่ทำให้เส้นทางวางเองล้มเหลว (ผู้ใช้คุมแนวเดินรถเอง)
const across = [{ x: .5, z: -.25 }];
assert.equal(make(across).status, 'found');
assert.equal(make(across, { diceState: buildArenaState({ directionDie: 3, leftDie: 12, rightDie: 12 }) }).status, 'found');

// ปฏิเสธเฉพาะพิกัดที่ไม่ถูกต้อง (NaN, นอกขอบเขตสนามมากเกินไป, หรือพิกัดซ้ำเดิม)
for (const invalid of [
  [{ x: 99, z: 0 }],
  [{ x: NaN, z: 0 }],
  [points[0], points[0]],
]) {
  assert.equal(make(invalid).status, 'no_path');
}

const exit = make([{ x: 0, z: -.9 }, { x: 0, z: .8 }, { x: -.85, z: 1.15 }, { x: -.85, z: 1.8 }]);
assert.equal(exit.status, 'found');
const code = generateArduinoCode({ route: exit, diceState, settings: DEFAULT_SETTINGS, arena: ARENA });
assert(code.includes('Manual Route'));
assert(!code.includes('Regular Exit'));
if (process.env.MANUAL_SKETCH) fs.writeFileSync(process.env.MANUAL_SKETCH, code);
console.log('Manual route tests passed: free positioning, obstacle independence, exact points, commands, exit and export');
