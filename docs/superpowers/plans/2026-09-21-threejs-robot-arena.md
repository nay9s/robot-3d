# แผนดำเนินงานสนามหุ่นยนต์ Three.js

> **สำหรับผู้ทำงานแบบเอเจนต์:** ต้องใช้สกิลย่อย `superpowers:subagent-driven-development` (แนะนำ) หรือ `superpowers:executing-plans` เพื่อทำแผนนี้ทีละงาน โดยติดตามสถานะผ่านช่องทำเครื่องหมาย `- [ ]`

**เป้าหมาย:** สร้างหน้าเว็บแผนภาพสนามหุ่นยนต์ 3 มิติ ซึ่งปรับแต้มลูกเต๋าสำหรับทิศหุ่นยนต์และตำแหน่งกล่องสองใบได้ทันที

**สถาปัตยกรรม:** ใช้หน้าเว็บแบบ Static และโหลด Three.js/OrbitControls ผ่าน Import Map จาก CDN ส่วนการแปลงหน่วยและคำนวณสถานะแยกไว้ในโมดูล JavaScript บริสุทธิ์ เพื่อทดสอบด้วย Node.js ได้โดยไม่ต้องเปิด WebGL ส่วน `arena.js` รับสถานะที่คำนวณแล้วไปเปลี่ยนตำแหน่งและการหมุนของ Mesh

**เทคโนโลยี:** HTML5, CSS3, JavaScript Modules, Three.js 0.186.0, OrbitControls, Node.js built-in test runner

**สเปก:** `docs/superpowers/specs/2026-09-21-threejs-robot-arena-design.md`

## ข้อกำหนดร่วม

- สนามเป็นสี่เหลี่ยมจัตุรัสขนาด 3 × 3 เมตร
- ใช้ `1 นิ้ว = 0.0254 เมตร` และหนึ่งช่องกระเบื้องเท่ากับ 4.5 นิ้ว
- กล่องทั้งสองมีขนาด 13.5 × 19 นิ้ว โดยกล่องซ้ายเป็นแนวตั้งและกล่องขวาเป็นแนวนอน
- แต้มลูกเต๋าทุกช่องรับเฉพาะจำนวนเต็ม 1–6
- กล่องซ้ายเลื่อนไปทางขวา และกล่องขวาเลื่อนไปทางซ้าย ครั้งละ 4.5 นิ้วต่อหนึ่งแต้ม
- หุ่นยนต์หมุนตามเข็มนาฬิกาครั้งละ 90° จากทิศตั้งต้น `-Z`
- หน้าเว็บต้องใช้งานได้ด้วยแป้นพิมพ์และจัดวางได้ที่ความกว้างหน้าจอตั้งแต่ 320 พิกเซลขึ้นไป
- โหลด Three.js และ OrbitControls รุ่น 0.186.0 จาก `cdn.jsdelivr.net`
- โฟลเดอร์ปัจจุบันยังไม่ใช่ Git repository จึงไม่มีขั้นตอน commit จนกว่าจะมีการตั้งค่า repository

## ประเด็นที่ต้องตรวจเป็นพิเศษ

- ค่าแต้มที่ไม่ใช่จำนวนเต็มหรืออยู่นอกช่วง 1–6 ต้องทำให้ฟังก์ชันคำนวณแจ้ง `RangeError`
- แต้ม 4 ต้องทำให้หุ่นยนต์กลับสู่ทิศ `+Z` และแต้ม 5–6 ต้องวนทิศอย่างถูกต้อง
- ตำแหน่งกล่องที่แต้ม 6 ต้องยังอยู่ภายในสนาม
- การย่อหน้าจอหรือปรับขนาด Canvas ต้องไม่บิดอัตราส่วนภาพและไม่ทำให้ส่วนควบคุมล้นจอ
- กรณีสร้าง WebGL renderer ไม่สำเร็จต้องแสดงข้อความข้อผิดพลาดที่อ่านได้ แทนหน้าจอว่าง

---

### งานที่ 1: โมดูลคำนวณสนามและการทดสอบ

**ไฟล์:**

- สร้าง: `package.json`
- สร้าง: `arena-state.js`
- สร้าง: `tests/arena-state.test.js`

**ส่วนเชื่อมต่อ:**

- รับค่า: วัตถุ `{ directionDie, leftDie, rightDie }` ซึ่งแต่ละค่าเป็นจำนวนเต็ม 1–6
- ส่งออก: `ARENA`, `inchesToMetres(inches)`, `validateDie(value)`, `directionForDie(value)`, `buildArenaState(dice)`
- `buildArenaState` คืนค่า `{ robotRotationY, robotDirection, leftBoxX, rightBoxX, leftShiftMetres, rightShiftMetres }`

- [x] **ขั้นที่ 1: สร้างตัวรันทดสอบแบบไม่ต้องติดตั้งแพ็กเกจ**

สร้าง `package.json`:

```json
{
  "name": "arduino-robot-arena",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [x] **ขั้นที่ 2: เขียนการทดสอบที่ยังไม่ผ่าน**

สร้าง `tests/arena-state.test.js` ให้ตรวจกรณีหลักและกรณีขอบ:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENA,
  inchesToMetres,
  validateDie,
  directionForDie,
  buildArenaState,
} from '../arena-state.js';

test('converts the measured tile width to metres', () => {
  assert.equal(inchesToMetres(4.5), 0.1143);
});

test('rejects invalid dice values', () => {
  for (const value of [0, 7, 1.5, '3', NaN]) {
    assert.throws(() => validateDie(value), RangeError);
  }
});

test('wraps robot direction after four quarter turns', () => {
  assert.equal(directionForDie(1).label, 'ขวา');
  assert.equal(directionForDie(4).label, 'บน');
  assert.equal(directionForDie(6).label, 'ล่าง');
});

test('moves each obstacle in the required direction', () => {
  const one = buildArenaState({ directionDie: 1, leftDie: 1, rightDie: 1 });
  const six = buildArenaState({ directionDie: 6, leftDie: 6, rightDie: 6 });
  assert.ok(six.leftBoxX > one.leftBoxX);
  assert.ok(six.rightBoxX < one.rightBoxX);
  assert.equal(six.leftShiftMetres, ARENA.tileSize * 6);
  assert.equal(six.rightShiftMetres, ARENA.tileSize * 6);
  assert.ok(six.leftBoxX + ARENA.leftBox.width / 2 <= ARENA.size / 2);
  assert.ok(six.rightBoxX - ARENA.rightBox.width / 2 >= -ARENA.size / 2);
});
```

- [x] **ขั้นที่ 3: รันทดสอบเพื่อยืนยันว่าล้มเหลวตามคาด**

รัน `npm test`

ผลที่คาดหวัง: ล้มเหลวด้วย `ERR_MODULE_NOT_FOUND` เพราะยังไม่มี `arena-state.js`

- [x] **ขั้นที่ 4: สร้างโมดูลคำนวณขั้นต่ำให้ผ่านการทดสอบ**

สร้าง `arena-state.js` ด้วยโครงสร้างต่อไปนี้:

```js
export const inchesToMetres = (inches) => Number((inches * 0.0254).toFixed(6));

export const ARENA = Object.freeze({
  size: 3,
  tileSize: inchesToMetres(4.5),
  exitWidth: inchesToMetres(39),
  bonusWidth: inchesToMetres(19),
  robot: Object.freeze({ x: 1.15, z: -1.15 }),
  leftBox: Object.freeze({
    originX: -1.32855,
    z: -0.25,
    width: inchesToMetres(13.5),
    depth: inchesToMetres(19),
  }),
  rightBox: Object.freeze({
    originX: 1.2587,
    z: 0.35,
    width: inchesToMetres(19),
    depth: inchesToMetres(13.5),
  }),
});

export function validateDie(value) {
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new RangeError('แต้มลูกเต๋าต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 6');
  }
  return value;
}

const DIRECTIONS = ['บน', 'ขวา', 'ล่าง', 'ซ้าย'];

export function directionForDie(value) {
  const die = validateDie(value);
  return {
    label: DIRECTIONS[die % 4],
    rotationY: -die * Math.PI / 2,
  };
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
```

- [x] **ขั้นที่ 5: รันทดสอบอีกครั้ง**

รัน `npm test`

ผลที่คาดหวัง: การทดสอบทั้งหมดผ่านและไม่มีข้อความเตือน

### งานที่ 2: หน้าเว็บและฉากสนาม 3 มิติ

**ไฟล์:**

- สร้าง: `index.html`
- สร้าง: `styles.css`
- สร้าง: `arena.js`

**ส่วนเชื่อมต่อ:**

- ใช้ `ARENA` และ `buildArenaState(dice)` จาก `arena-state.js`
- ใช้ Element ID: `arena-canvas`, `direction-die`, `left-die`, `right-die`, `randomize`, `top-view`, `reset-view`, `arena-status`, `webgl-error`
- ไม่ส่งออก API เพิ่มเติม; จุดเริ่มต้นคือการโหลด `arena.js` จาก `index.html`

- [x] **ขั้นที่ 1: สร้างโครงหน้าและ Import Map**

ใน `index.html` ให้มีแผงควบคุมด้านบน พื้นที่ Canvas และข้อความสถานะ โดยใช้ Import Map ที่ระบุรุ่นแน่นอน:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/"
  }
}
</script>
<script type="module" src="./arena.js"></script>
```

สร้าง `<select>` ทั้งสามด้วยตัวเลือก 1–6 ใช้ `<button type="button">` สำหรับสุ่มแต้ม มุมมองด้านบน และรีเซ็ตมุมมอง เพิ่ม `aria-live="polite"` ที่ `arena-status` และ `role="alert" hidden` ที่ `webgl-error`

- [x] **ขั้นที่ 2: สร้างเลย์เอาต์ที่ตอบสนองต่อขนาดหน้าจอ**

ใน `styles.css`:

- ใช้ CSS Grid แบ่งแผงควบคุมกับพื้นที่แสดงผลในหน้าจอกว้าง
- ให้ `#arena-canvas` มี `min-height: 560px` และกว้างเต็มพื้นที่
- ที่ `@media (max-width: 760px)` เปลี่ยนเป็นหนึ่งคอลัมน์และลดความสูง Canvas เป็น 440px
- ที่ `@media (max-width: 420px)` ให้กลุ่มช่องเลือกและปุ่มเรียงแนวตั้ง
- กำหนดสีที่แยก Start, Exit, Bonus และกล่องสองใบได้ชัดเจน พร้อมเส้นโฟกัสของ input/button ที่มองเห็นได้

- [x] **ขั้นที่ 3: สร้าง Renderer, กล้อง และการจัดการข้อผิดพลาด**

ใน `arena.js` นำเข้า:

```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARENA, buildArenaState } from './arena-state.js';
```

สร้าง `THREE.WebGLRenderer({ antialias: true, canvas, alpha: true })` ภายใน `try/catch` หากล้มเหลวให้ซ่อน Canvas และแสดง `webgl-error` ตั้งค่า `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`, เปิดเงา และใช้ `ResizeObserver` ปรับขนาด renderer กับ `PerspectiveCamera`

- [x] **ขั้นที่ 4: สร้างสนามจากค่าตั้งต้นเพียงแหล่งเดียว**

สร้างฟังก์ชันต่อไปนี้ใน `arena.js`:

```js
function createFloor(scene) {}
function createGrid(scene) {}
function createWalls(scene) {}
function createExitMarkers(scene) {}
function createRobot(scene) { return robotGroup; }
function createObstacle(scene, dimensions, color) { return mesh; }
function createLabel(text, position) { return sprite; }
```

การทำงานที่ต้องใส่ในแต่ละฟังก์ชัน:

- `createFloor`: ใช้ `BoxGeometry(ARENA.size, 0.04, ARENA.size)`
- `createGrid`: สร้าง `LineSegments` ทุกระยะ `ARENA.tileSize` บนแกน X และ Z โดยเส้นสุดท้ายต้องไม่เกิน ±1.5 เมตร
- `createWalls`: ใช้กำแพงสูง 0.18 เมตร หนา 0.05 เมตร และแบ่งกำแพงล่างเป็นช่วงหลังช่องทางออก
- `createExitMarkers`: สร้างแถบ Exit จาก `x = -1.5` ถึง `-1.5 + ARENA.exitWidth` และซ้อนแถบ Bonus จาก `x = -1.5` ถึง `-1.5 + ARENA.bonusWidth`
- `createRobot`: สร้าง Group ที่มีฐานหุ่นยนต์ ล้อสี่ล้อ และ ConeGeometry เป็นลูกศรด้านหน้า โดยวาง Group ที่ `(ARENA.robot.x, 0.09, ARENA.robot.z)`
- `createObstacle`: ใช้ความสูง 0.28 เมตรและเปิด `castShadow/receiveShadow`
- `createLabel`: วาดข้อความลง Canvas 2D แล้วใช้เป็น `CanvasTexture` ของ Sprite

- [x] **ขั้นที่ 5: ผูกแต้มกับวัตถุในฉาก**

สร้าง `readDice()` และ `applyDice()`:

```js
function readDice() {
  return {
    directionDie: Number(directionSelect.value),
    leftDie: Number(leftSelect.value),
    rightDie: Number(rightSelect.value),
  };
}

function applyDice() {
  const state = buildArenaState(readDice());
  robot.rotation.y = state.robotRotationY;
  leftObstacle.position.x = state.leftBoxX;
  rightObstacle.position.x = state.rightBoxX;
  status.textContent = `หุ่นยนต์หันไปทาง${state.robotDirection} · กล่องซ้าย ${formatShift(state.leftShiftMetres)} · กล่องขวา ${formatShift(state.rightShiftMetres)}`;
}
```

ผูก `change` ของ select ทั้งสามกับ `applyDice()` และให้ปุ่มสุ่มกำหนดค่า 1–6 ทั้งสามช่องก่อนเรียก `applyDice()`

- [x] **ขั้นที่ 6: เพิ่มมุมกล้องและลูปแสดงผล**

กำหนดมุมเริ่มต้นที่ `camera.position.set(3.8, 4.2, -4.2)` และมอง `controls.target.set(0, 0, 0)` ฟังก์ชัน `setTopView()` ใช้ตำแหน่ง `(0, 5.2, 0.001)` ส่วน `resetView()` คืนค่ามุมเริ่มต้น เรียก `controls.update()` หลังเปลี่ยนทุกครั้ง ลูป `requestAnimationFrame(render)` ต้องเรียก `renderer.render(scene, camera)` เท่านั้นและหยุดเมื่อหน้าเว็บถูกซ่อนเพื่อลดการใช้ทรัพยากร

- [x] **ขั้นที่ 7: ตรวจหน้าเว็บแบบ Static**

รัน `python3 -m http.server 8000`

เปิด `http://localhost:8000/` และตรวจว่าไม่มีข้อผิดพลาดใน Console, สนามแสดงครบ, กล้องหมุน/ซูม/เลื่อนได้, ปุ่มมุมกล้องทำงาน และการเปลี่ยนแต้มทั้งสามปรับฉากทันที

### งานที่ 3: เอกสารใช้งานและการตรวจสอบขั้นสุดท้าย

**ไฟล์:**

- สร้าง: `README.md`
- ตรวจ: `index.html`, `styles.css`, `arena.js`, `arena-state.js`

**ส่วนเชื่อมต่อ:**

- README ระบุคำสั่งเปิดเซิร์ฟเวอร์และ URL ที่แน่นอน
- ไม่เพิ่ม API หรือ dependency ใหม่

- [x] **ขั้นที่ 1: เขียน README ภาษาไทย**

README ต้องมีหัวข้อดังนี้:

```markdown
# แบบจำลองสนามหุ่นยนต์ 3 มิติ

## เปิดใช้งาน
1. เปิด Terminal ที่โฟลเดอร์โปรเจกต์
2. รัน `python3 -m http.server 8000`
3. เปิด `http://localhost:8000/`

## การใช้งาน
- เลือกแต้ม 1–6 สำหรับทิศเริ่มต้น กล่องซ้าย และกล่องขวา
- ใช้เมาส์หมุน ซูม และเลื่อนมุมกล้อง
- ใช้ปุ่มมุมมองด้านบนหรือรีเซ็ตมุมมอง

## สมมติฐานด้านระยะ
- สนาม 3 × 3 เมตร
- หนึ่งช่องกระเบื้อง 4.5 นิ้ว
- พิกัดเริ่มต้นของกล่องเป็นค่าประมาณจากภาพและแก้ได้ใน `arena-state.js`
```

- [x] **ขั้นที่ 2: รันชุดทดสอบทั้งหมด**

รัน `npm test`

ผลที่คาดหวัง: ผ่านทั้งหมด

- [x] **ขั้นที่ 3: ตรวจ Syntax ของ JavaScript**

รัน `node --check arena-state.js` และ `node --check arena.js`

ผลที่คาดหวัง: ทั้งสองคำสั่งจบด้วยรหัส 0 และไม่มีข้อความผิดพลาด

- [x] **ขั้นที่ 4: ตรวจการแสดงผลสองขนาดหน้าจอ**

เปิดผ่านเซิร์ฟเวอร์ที่ความกว้าง 1280 × 800 และ 390 × 844 แล้วตรวจว่า Canvas ไม่ล้นจอ ส่วนควบคุมไม่ซ้อนกัน สนามอยู่ครบในเฟรม และทั้งสาม select ยังใช้งานได้ด้วยแป้นพิมพ์

- [x] **ขั้นที่ 5: ตรวจทุกค่าแต้มแบบเป็นระบบ**

เปลี่ยนแต่ละ select ตั้งแต่ 1 ถึง 6 และยืนยันจากข้อความสถานะและฉากว่า:

- ทิศหุ่นยนต์วนเป็น ขวา → ล่าง → ซ้าย → บน → ขวา → ล่าง
- กล่องซ้ายเลื่อนไปทางขวาครั้งละ 0.1143 เมตร
- กล่องขวาเลื่อนไปทางซ้ายครั้งละ 0.1143 เมตร
- แต้ม 6 ไม่ทำให้กล่องออกนอกสนาม
