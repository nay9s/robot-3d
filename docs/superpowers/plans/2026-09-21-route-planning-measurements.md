# แผนดำเนินงานระบบเส้นทางและการวัดสนามหุ่นยนต์

> **สำหรับผู้ทำงานแบบเอเจนต์:** ต้องใช้สกิลย่อย `superpowers:subagent-driven-development` (แนะนำ) หรือ `superpowers:executing-plans` เพื่อทำแผนนี้ทีละงาน โดยติดตามสถานะผ่านช่องทำเครื่องหมาย `- [ ]`

**เป้าหมาย:** เพิ่มการคำนวณเส้นทางปลอดภัยแบบ A* การประมาณคำสั่งวิ่ง หน้า Settings และชั้นแสดงระยะวัดลงในแบบจำลองสนาม Three.js เดิม

**สถาปัตยกรรม:** แยกการคำนวณทิศ Settings เส้นทาง และข้อมูลการวัดออกจาก Three.js เป็นโมดูล JavaScript บริสุทธิ์ที่ทดสอบใน Browser Test Harness ได้ ส่วน `arena.js` รับผลลัพธ์ไปสร้าง Mesh/Line/Sprite และเชื่อมกับ UI โดยไม่ทำซ้ำตรรกะการคำนวณ

**เทคโนโลยี:** HTML5, CSS3, JavaScript Modules, Three.js 0.186.0, OrbitControls, Browser Test Harness, localStorage

**สเปก:** `docs/superpowers/specs/2026-09-21-route-planning-measurements-design.md`

## ข้อกำหนดร่วม

- แกน `-Z` คือด้านบนและแกน `+Z` คือด้านล่างของแผนที่
- ทิศพื้นฐานของหุ่นยนต์ก่อนหมุนตามลูกเต๋าคือ `+Z`
- A* ใช้เพื่อนบ้านสี่ทิศทางและสร้างคำสั่งเดินตรงกับเลี้ยวทีละ 90 องศา
- ใช้วงกลมครอบหุ่นยนต์และระยะเผื่อในการตรวจการชน
- ความปลอดภัยมาก่อนคะแนนและระยะทางเสมอ
- โหมดเน้นคะแนนต้องถอยไปใช้ช่องออกปกติเมื่อช่วง 19 นิ้วผ่านไม่ได้
- Settings ต้องตรวจค่าก่อนบันทึกและกู้คืนจากข้อมูล localStorage ที่เสียหายได้
- หน้าเว็บต้องทำงานตั้งแต่ความกว้าง 320 พิกเซลขึ้นไปและไม่มี Error หรือ Warning ใน Console
- เครื่องนี้ไม่มี Node.js และโปรเจกต์ไม่ใช่ Git repository จึงใช้ Browser Test Harness และบันทึกความคืบหน้าแทนคำสั่ง npm/git

## ประเด็นที่ต้องตรวจเป็นพิเศษ

- ขนาดหุ่นยนต์หรือระยะเผื่อที่ทำให้จุดเริ่มชนกำแพงต้องคืนสถานะ `start_blocked` และไม่วาดเส้นทาง
- localStorage ที่เป็น JSON เสียหายหรือมีค่าพ้นช่วงต้องกลับไปใช้ค่าเริ่มต้นโดยไม่ทำให้หน้าเว็บหยุด
- โหมดเน้นคะแนนที่ผ่านช่วง 19 นิ้วไม่ได้แต่ยังผ่านช่อง 39 นิ้วได้ต้องคืน `goalType: "regular"` และ `usedFallback: true`
- การเปลี่ยน Settings แล้วกดยกเลิกต้องไม่เปลี่ยนเส้นทางหรือค่าที่บันทึกไว้
- การคำนวณหลายครั้งติดกันต้องลบเส้นทาง ป้าย และคำสั่งเดิมก่อนแสดงผลชุดใหม่

---

### งานที่ 1: ทิศเริ่มต้นและระบบ Settings

**ไฟล์:**

- แก้ไข: `arena-state.js`
- สร้าง: `settings-store.js`
- แก้ไข: `tests/arena-state.test.html`

**ส่วนเชื่อมต่อ:**

- `arena-state.js` ส่งออก `safeRadiusFor({ width, length, clearance })`
- `directionForDie(value)` คืน `{ label, rotationY }` โดยทิศฐานเป็น `+Z`
- `settings-store.js` ส่งออก `SETTINGS_KEY`, `DEFAULT_SETTINGS`, `validateSettings(value)`, `loadSettings(storage)`, `saveSettings(storage, value)`, `resetSettings(storage)`
- `validateSettings` คืน `{ ok: true, value }` หรือ `{ ok: false, errors }`

- [ ] **ขั้นที่ 1: เพิ่มการทดสอบที่ล้มเหลวสำหรับทิศฐานลงด้านล่าง**

แก้ชุดทดสอบให้ตรวจค่าที่คำนวณด้วยค่าคาดหวังแบบตรงตัว:

```js
test('ใช้ทิศลงเป็นฐานก่อนหมุนตามลูกเต๋า', () => {
  const expected = [
    [1, 'ซ้าย', -Math.PI / 2],
    [2, 'บน', -Math.PI],
    [3, 'ขวา', -3 * Math.PI / 2],
    [4, 'ล่าง', -2 * Math.PI],
    [5, 'ซ้าย', -5 * Math.PI / 2],
    [6, 'บน', -3 * Math.PI],
  ];
  for (const [die, label, rotationY] of expected) {
    equal(directionForDie(die).label, label);
    equal(directionForDie(die).rotationY, rotationY);
  }
});
```

- [ ] **ขั้นที่ 2: เพิ่มการทดสอบรัศมีปลอดภัยและ Settings**

```js
test('คำนวณรัศมีครอบหุ่นยนต์รวมระยะเผื่อ', () => {
  const radius = safeRadiusFor({ width: 0.32, length: 0.38, clearance: 0.10 });
  equal(Number(radius.toFixed(6)), 0.348394);
});

test('ปฏิเสธ Settings ที่อยู่นอกช่วง', () => {
  const result = validateSettings({ ...DEFAULT_SETTINGS, width: 0.05, gridSize: 0.03 });
  ok(!result.ok, 'Settings ที่ผิดช่วงต้องไม่ผ่าน');
  ok(result.errors.width, 'ต้องแจ้งข้อผิดพลาดความกว้าง');
  ok(result.errors.gridSize, 'ต้องแจ้งข้อผิดพลาดความละเอียด');
});

test('กู้คืนค่าเริ่มต้นเมื่อ localStorage เสียหาย', () => {
  localStorage.setItem(SETTINGS_KEY, '{broken');
  const loaded = loadSettings(localStorage);
  equal(loaded.width, 0.32);
  equal(loaded.length, 0.38);
  equal(localStorage.getItem(SETTINGS_KEY), null);

  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, clearance: 2 }));
  const outOfRange = loadSettings(localStorage);
  equal(outOfRange.clearance, 0.10);
  equal(localStorage.getItem(SETTINGS_KEY), null);
});
```

ใช้ `localStorage.removeItem(SETTINGS_KEY)` ก่อนและหลังกลุ่มทดสอบเพื่อไม่ทิ้งสถานะค้าง

- [ ] **ขั้นที่ 3: รัน Browser Test Harness เพื่อยืนยัน RED**

เปิด `http://127.0.0.1:8000/tests/arena-state.test.html`

ผลที่คาดหวัง: การทดสอบใหม่ล้มเหลวเพราะทิศเดิมใช้ด้านบนเป็นฐาน และยังไม่มี `safeRadiusFor` กับ `settings-store.js`

- [ ] **ขั้นที่ 4: แก้ทิศและเพิ่มการคำนวณรัศมี**

ใน `arena-state.js` ใช้โครงสร้าง:

```js
const DIRECTIONS = Object.freeze(['ล่าง', 'ซ้าย', 'บน', 'ขวา']);

export function directionForDie(value) {
  const die = validateDie(value);
  return {
    label: DIRECTIONS[die % 4],
    rotationY: -die * Math.PI / 2,
  };
}

export function safeRadiusFor({ width, length, clearance }) {
  for (const value of [width, length]) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('ขนาดหุ่นยนต์ต้องมากกว่าศูนย์');
  }
  if (!Number.isFinite(clearance) || clearance < 0) throw new RangeError('ระยะเผื่อต้องไม่ติดลบ');
  return Math.hypot(width, length) / 2 + clearance;
}
```

- [ ] **ขั้นที่ 5: สร้าง settings-store.js**

กำหนดค่าและช่วงที่แน่นอน:

```js
export const SETTINGS_KEY = 'robot-arena-settings-v1';
export const DEFAULT_SETTINGS = Object.freeze({
  width: 0.32,
  length: 0.38,
  clearance: 0.10,
  speed: 0.35,
  turnSeconds90: 0.45,
  gridSize: 0.05,
  planningMode: 'score',
  showMeasurements: true,
});
```

`validateSettings` ต้องรับเฉพาะ width/length 0.10–0.80, clearance 0–0.50, speed 0.05–2.00, turnSeconds90 0.10–5.00, gridSize หนึ่งใน `[0.025, 0.05, 0.10]`, planningMode หนึ่งใน `score/pass` และ showMeasurements แบบ boolean เท่านั้น `loadSettings` ต้อง parse ภายใน try/catch และลบเฉพาะ `SETTINGS_KEY` เมื่อข้อมูลเสียหาย `saveSettings` ต้อง throw `RangeError` พร้อม `errors` เมื่อ validation ไม่ผ่าน

- [ ] **ขั้นที่ 6: รัน Test Harness เพื่อยืนยัน GREEN**

ผลที่คาดหวัง: การทดสอบเดิมและการทดสอบใหม่ทั้งหมดผ่าน ไม่มี Error หรือ Warning ใน Console

### งานที่ 2: ตัววางเส้นทาง A* และรายการคำสั่ง

**ไฟล์:**

- สร้าง: `path-planner.js`
- แก้ไข: `tests/arena-state.test.html`

**ส่วนเชื่อมต่อ:**

- รับ `planRoute({ arena, diceState, settings })`
- คืน `{ status, reason, goalType, usedFallback, safeRadius, points, segments, commands, totalDistance, turnCount, estimatedSeconds }`
- ส่งออกเพิ่ม `buildCollisionContext({ arena, diceState, settings })`, `pointIsBlocked(point, context)`, `simplifyOrthogonalPath(points)`, `buildCommands(points, initialDirection, settings)` เพื่อทดสอบหน่วยย่อย
- `buildCollisionContext` คืน `{ bounds, obstacles, safeRadius, exit }`
- `status` เป็น `found`, `start_blocked` หรือ `no_path`

- [ ] **ขั้นที่ 1: เพิ่มการทดสอบ RED สำหรับพื้นที่ชนและเส้นทางเริ่มต้น**

```js
test('ขยายพื้นที่ชนตามรัศมีปลอดภัย', () => {
  const { context, box } = makePlannerContext({ safeRadius: 0.20 });
  ok(pointIsBlocked({ x: box.minX - 0.19, z: box.z }, context), 'จุดในระยะเผื่อต้องชน');
  ok(!pointIsBlocked({ x: box.minX - 0.21, z: box.z }, context), 'จุดนอกระยะเผื่อต้องผ่านได้');
});

test('หาเส้นทางจากจุดเริ่มไปช่วงโบนัสโดยไม่ผ่านช่องชน', () => {
  const diceState = buildArenaState({ directionDie: 4, leftDie: 1, rightDie: 1 });
  const context = buildCollisionContext({ arena: ARENA, diceState, settings: DEFAULT_SETTINGS });
  const result = planRoute({ arena: ARENA, diceState, settings: DEFAULT_SETTINGS });
  equal(result.status, 'found');
  equal(result.goalType, 'bonus');
  equal(result.usedFallback, false);
  for (const point of result.points) ok(!pointIsBlocked(point, context), 'เส้นทางห้ามผ่านพื้นที่ชน');
});
```

ตัวช่วย `makePlannerContext` ใน Test Harness คืน `{ context, box }` โดยใช้กล่อง AABB `{ minX: -0.2, maxX: 0.2, minZ: -0.2, maxZ: 0.2, x: 0, z: 0 }` เก็บกล่องเดียวกันไว้ใน `context.obstacles` และใช้ขอบเขตสนาม 3 × 3 เมตรเพื่อให้ค่าคาดหวังคำนวณด้วยมือได้

- [ ] **ขั้นที่ 2: เพิ่มการทดสอบเปลี่ยนทางออกและกรณีหาเส้นทางไม่ได้**

```js
test('ถอยไปทางออกปกติเมื่อช่วงโบนัสแคบเกินไป', () => {
  const arena = { ...ARENA, bonusWidth: 0.15, exitWidth: 1.20 };
  const settings = { ...DEFAULT_SETTINGS, width: 0.20, length: 0.20, clearance: 0.05 };
  const result = planRoute({ arena, diceState: buildArenaState({ directionDie: 4, leftDie: 1, rightDie: 1 }), settings });
  equal(result.status, 'found');
  equal(result.goalType, 'regular');
  equal(result.usedFallback, true);
});

test('ไม่คืนเส้นทางเมื่อจุดเริ่มถูกบัง', () => {
  const settings = { ...DEFAULT_SETTINGS, width: 0.80, length: 0.80, clearance: 0.50 };
  const result = planRoute({ arena: ARENA, diceState: buildArenaState({ directionDie: 4, leftDie: 1, rightDie: 1 }), settings });
  equal(result.status, 'start_blocked');
  equal(result.points.length, 0);
});
```

- [ ] **ขั้นที่ 3: เพิ่มการทดสอบลดจุด คำสั่ง และเวลา**

```js
test('ลดจุดแนวตรงและสร้างคำสั่งตามทิศเริ่มต้น', () => {
  const points = simplifyOrthogonalPath([
    { x: 1, z: -1 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 },
  ]);
  equal(points.length, 3);
  const result = buildCommands(points, 'ล่าง', { ...DEFAULT_SETTINGS, speed: 0.5, turnSeconds90: 0.4 });
  equal(result.commands[0].type, 'forward');
  equal(result.commands[0].distance, 2);
  equal(result.commands[1].type, 'turn-right');
  equal(result.commands[1].degrees, 90);
  equal(result.totalDistance, 3);
  equal(result.turnCount, 1);
  equal(result.estimatedSeconds, 6.4);
});
```

- [ ] **ขั้นที่ 4: รัน Test Harness เพื่อยืนยัน RED**

ผลที่คาดหวัง: ล้มเหลวด้วยการโหลด `path-planner.js` ไม่สำเร็จ

- [ ] **ขั้นที่ 5: สร้างตัวแทนพื้นที่ชนและจุดหมาย**

ใน `path-planner.js`:

- แปลงกล่องสองใบเป็น AABB จากพิกัดกลางและขนาดใน `ARENA`
- แปลงกำแพงเป็น AABB สี่ด้าน โดยแบ่งกำแพงล่างตรงช่องออก
- `pointIsBlocked` คำนวณระยะสั้นที่สุดจากจุดถึง AABB แล้วเปรียบเทียบกับ safeRadius
- สร้างกริดจาก `x = -1.5` ถึง `1.5` และ `z = -1.5` ถึง `1.5 + safeRadius + gridSize`
- จำกัดส่วนที่อยู่นอกสนามให้เดินได้เฉพาะแนวต่อจากช่องออก
- สร้าง goal candidates ทุกหนึ่ง gridSize โดยให้ศูนย์กลางหุ่นยนต์ห่างจากปลายกำแพงไม่น้อยกว่า safeRadius

- [ ] **ขั้นที่ 6: สร้าง A* แบบสี่ทิศทาง**

ใช้ key รูปแบบ `ix,iz`, Manhattan heuristic, min-priority queue แบบ binary heap และ cost ต่อก้าวเป็น `gridSize + proximityPenalty` โดย proximityPenalty ลดลงเมื่อห่างพื้นที่ชนมากขึ้น หยุดเมื่อถึง candidate แรกในชุดเป้าหมายที่กำลังค้นหา และจำกัดจำนวนโหนดไม่เกินจำนวนช่องทั้งหมดเพื่อป้องกันลูป

- [ ] **ขั้นที่ 7: สร้างลำดับเลือกเป้าหมายและผลลัพธ์**

- โหมด score: ค้นหา bonus candidates ก่อน จากนั้น regular candidates และตั้ง `usedFallback: true` เมื่อใช้ชุดที่สอง
- โหมด pass: ค้นหา regular candidates ทั้งหมด แล้วเลือกผลที่มีค่า minimum-clearance สูงกว่า ก่อนระยะรวมและจำนวนเลี้ยว
- คืน `start_blocked` ก่อนเริ่ม A* หากจุดเริ่มชน
- คืน `no_path` พร้อม reason ภาษาไทยเมื่อทั้งสองชุดไม่มีเส้นทาง

- [ ] **ขั้นที่ 8: ลดจุดและสร้างคำสั่ง**

`simplifyOrthogonalPath` ลบจุดกลางเมื่อเวกเตอร์ก่อนและหลังอยู่ทิศเดียวกัน `buildCommands` คำนวณ heading ของแต่ละ segment จาก dx/dz เปรียบเทียบกับ initialDirection แล้วรวมคำสั่งเลี้ยวกับเดินหน้า ระยะและเวลาปัดเฉพาะตอนแสดงผล ไม่ปัดค่าภายใน

- [ ] **ขั้นที่ 9: รัน Test Harness เพื่อยืนยัน GREEN**

ผลที่คาดหวัง: การทดสอบทั้งหมดผ่าน และกรณีเส้นทางจริงใช้เวลาคำนวณต่ำกว่า 250 มิลลิวินาทีที่ gridSize 0.05 เมตรบน Browser Test Harness

### งานที่ 3: โมเดลและชั้นแสดงการวัด

**ไฟล์:**

- สร้าง: `measurement-layer.js`
- แก้ไข: `tests/arena-state.test.html`

**ส่วนเชื่อมต่อ:**

- ส่งออก `buildMeasurementDescriptors({ arena, diceState, settings, route })`
- ส่งออก `MeasurementLayer` ที่มี `update(descriptors)`, `setVisible(visible)`, `dispose()`
- descriptor ใช้ `{ id, kind, start, end, valueMetres, label }`

- [ ] **ขั้นที่ 1: เพิ่มการทดสอบ RED สำหรับข้อมูลการวัด**

```js
test('สร้างข้อมูลวัดสนาม ทางออก กล่อง และเส้นทาง', () => {
  const descriptors = buildMeasurementDescriptors({
    arena: ARENA,
    diceState: buildArenaState({ directionDie: 4, leftDie: 2, rightDie: 3 }),
    settings: DEFAULT_SETTINGS,
    route: { segments: [{ from: { x: 1, z: -1 }, to: { x: 1, z: 0 }, distance: 1 }] },
  });
  const byId = Object.fromEntries(descriptors.map((item) => [item.id, item]));
  equal(byId['arena-width'].valueMetres, 3);
  equal(byId['exit-width'].valueMetres, 0.9906);
  equal(byId['bonus-width'].valueMetres, 0.4826);
  equal(byId['route-0'].label, '1.00 m');
  equal(byId['left-shift'].valueMetres, 0.2286);
});
```

- [ ] **ขั้นที่ 2: รัน Test Harness เพื่อยืนยัน RED**

ผลที่คาดหวัง: ล้มเหลวเพราะยังไม่มี `measurement-layer.js`

- [ ] **ขั้นที่ 3: สร้าง descriptor builder**

สร้าง descriptor สำหรับ arena-width, arena-length, exit-width, bonus-width, left-box-width/depth, right-box-width/depth, left-shift, right-shift, robot-width/length, safe-radius และ route-N ทุก segment ป้ายใช้ `${value.toFixed(2)} m`

- [ ] **ขั้นที่ 4: สร้าง MeasurementLayer**

`MeasurementLayer` รับ `{ THREE, scene, createLabel }` ใน constructor สร้าง Group เดียวใน scene และเมื่อ update ต้อง dispose geometry/material/texture เดิมก่อนสร้าง:

- เส้นหลักใช้ BufferGeometry ระหว่าง start/end
- เส้นขีดปลายตั้งฉากกับเส้นหลัก
- Sprite label วางกึ่งกลางและยกเหนือพื้น 0.04 เมตร
- `setVisible` เปลี่ยน `group.visible` เท่านั้น
- `dispose` ลบ Group และคืนทรัพยากรทั้งหมด

- [ ] **ขั้นที่ 5: รัน Test Harness เพื่อยืนยัน GREEN**

ผลที่คาดหวัง: การทดสอบ descriptor ทั้งหมดผ่าน

### งานที่ 4: หน้า Settings และการเชื่อมระบบกับ Three.js

**ไฟล์:**

- แก้ไข: `index.html`
- แก้ไข: `styles.css`
- แก้ไข: `arena.js`

**ส่วนเชื่อมต่อ:**

- ใช้ `loadSettings`, `saveSettings`, `resetSettings` จาก `settings-store.js`
- ใช้ `planRoute` จาก `path-planner.js`
- ใช้ `buildMeasurementDescriptors` และ `MeasurementLayer` จาก `measurement-layer.js`
- Element IDs ใหม่: `settings-open`, `settings-dialog`, `settings-form`, `settings-cancel`, `settings-reset`, `measurement-toggle`, `route-status`, `route-distance`, `route-turns`, `route-time`, `route-goal`, `route-commands`

- [ ] **ขั้นที่ 1: เพิ่มส่วนควบคุมและสรุปเส้นทางใน index.html**

เพิ่มปุ่ม Settings และ checkbox “แสดงการวัด” ใกล้ปุ่มสุ่ม เพิ่มแผงผลเส้นทางที่มีสถานะ เป้าหมาย ระยะรวม จำนวนเลี้ยว เวลาประมาณ และ `<ol id="route-commands">` เมื่อไม่มีเส้นทางให้แผงเดียวกันแสดงเหตุผลและข้อเสนอปรับค่า

- [ ] **ขั้นที่ 2: เพิ่ม Dialog Settings**

ใช้ `<dialog id="settings-dialog">` และ `<form id="settings-form" method="dialog">` พร้อม input number ที่มี min/max/step ตามสเปก select gridSize และ planningMode checkbox showMeasurements พื้นที่ข้อผิดพลาดต่อช่อง ปุ่มบันทึกเป็น submit ปุ่มยกเลิก type button และปุ่มคืนค่าเริ่มต้น type button

- [ ] **ขั้นที่ 3: เพิ่มรูปแบบ responsive และสถานะเส้นทาง**

ใน `styles.css`:

- Dialog กว้างไม่เกิน 680px และสูงไม่เกินพื้นที่หน้าจอ โดยภายในเลื่อนได้
- ฟอร์มสองคอลัมน์บนจอกว้างและหนึ่งคอลัมน์ต่ำกว่า 620px
- สรุปเส้นทางใช้ grid 2 × 2 และเปลี่ยนเป็นหนึ่งคอลัมน์ที่ 420px
- route commands ใช้เลขลำดับที่อ่านง่ายและไม่เกินความกว้างหน้าจอ
- สถานะ found/fallback/no-path ใช้ทั้งสี ไอคอนข้อความ และคำกำกับ ไม่พึ่งสีอย่างเดียว
- ลบ `min-width: 320px` จาก body เพื่อแก้ horizontal overflow ที่หน้าจอ 320px

- [ ] **ขั้นที่ 4: เชื่อม Settings กับ Dialog**

เมื่อโหลดหน้าให้ `loadSettings(localStorage)` แล้วเติมค่าในฟอร์ม ปุ่ม Settings เปิด Dialog โดยคัดลอกค่าปัจจุบันเป็น draft ปุ่มยกเลิกปิดโดยไม่แก้ current settings ปุ่ม reset เติม DEFAULT_SETTINGS ลง draft แต่ยังไม่บันทึกจนกดบันทึก submit เรียก validateSettings ถ้าผิดให้แสดง errors และไม่ปิด ถ้าผ่านให้ saveSettings, ปิด Dialog และเรียก recompute()

- [ ] **ขั้นที่ 5: แก้โมเดลหุ่นยนต์และทิศลูกศร**

ปรับขนาด Mesh ตัวหุ่นยนต์ตาม width/length ของ Settings และวางลูกศรฐานให้ชี้ `+Z` โดยใช้ `arrow.rotation.x = Math.PI / 2` และ `arrow.position.z = 0.08` การหมุน Group ใช้ `diceState.robotRotationY`

- [ ] **ขั้นที่ 6: สร้าง RouteLayer ภายใน arena.js**

สร้าง Group แยกสำหรับเส้นทาง ลูกศร จุดเลี้ยว และป้ายมุม ฟังก์ชัน `clearRouteLayer()` ต้อง dispose ทรัพยากรเดิมทุกครั้ง `renderRoute(route)` สร้าง Line ระหว่าง points ยก y=0.035 ลูกศรกลาง segment และวงกลมจุดเลี้ยว ป้ายระยะของ segment ถูกควบคุมโดย measurement toggle ผ่าน MeasurementLayer ไม่สร้างซ้ำใน RouteLayer

- [ ] **ขั้นที่ 7: สร้าง recompute จุดเดียว**

```js
function recompute() {
  clearRouteLayer();
  const diceState = buildArenaState(readDice());
  updateArenaMeshes(diceState, currentSettings);
  const route = planRoute({ arena: ARENA, diceState, settings: currentSettings });
  renderRoute(route);
  renderRouteSummary(route);
  measurementLayer.update(buildMeasurementDescriptors({
    arena: ARENA,
    diceState,
    settings: currentSettings,
    route,
  }));
  measurementLayer.setVisible(currentSettings.showMeasurements && measurementToggle.checked);
}
```

select ลูกเต๋า ปุ่มสุ่ม toggle การวัด และการบันทึก Settings ต้องผ่าน `recompute` หรืออัปเดต visibility ตามหน้าที่ ห้ามมีเส้นทางคำนวณซ้ำหลายจุด

- [ ] **ขั้นที่ 8: ตรวจ UI โดยตรงในเบราว์เซอร์**

ตรวจตามลำดับ:

1. ค่าเริ่มต้นแสดงทิศหุ่นยนต์ลงก่อนหมุน และแต้ม 1–6 แสดง ซ้าย→บน→ขวา→ล่าง→ซ้าย→บน
2. เปลี่ยนแต้มกล่องแล้วเส้นทาง สรุป และคำสั่งเปลี่ยนทันที
3. ปิดการวัดแล้วเส้นวัดและป้ายหาย แต่เส้นทางกับสรุปยังอยู่
4. เปิด Settings เปลี่ยน clearance แล้วกดยกเลิก ค่าและเส้นทางไม่เปลี่ยน
5. บันทึกค่าแล้ว reload ค่ายังอยู่และเส้นทางคำนวณตามค่านั้น
6. reset settings แล้วบันทึก ทุกค่ากลับค่าเริ่มต้น
7. ตั้งค่าให้จุดเริ่ม blocked แล้วไม่มีเส้นทางผ่านกล่อง พร้อมข้อความแนะนำ
8. Console ไม่มี Error หรือ Warning

### งานที่ 5: เอกสารและการตรวจสอบทั้งระบบ

**ไฟล์:**

- แก้ไข: `README.md`
- ตรวจ: `arena-state.js`, `settings-store.js`, `path-planner.js`, `measurement-layer.js`, `arena.js`, `index.html`, `styles.css`, `tests/arena-state.test.html`

**ส่วนเชื่อมต่อ:**

- README อธิบายโหมดทั้งสอง Settings เส้นวัด และข้อจำกัดของการประมาณเส้นทาง
- ไม่เพิ่ม dependency หรือบริการภายนอกใหม่

- [ ] **ขั้นที่ 1: อัปเดต README ภาษาไทย**

เพิ่มวิธีอ่านเส้นทาง รายการคำสั่ง ความหมายของโหมดเน้นคะแนน/เน้นผ่าน วิธีปรับขนาดหุ่นยนต์และระยะเผื่อ วิธีเปิด–ปิดเส้นวัด การเก็บค่าใน localStorage และคำเตือนว่าเส้นทางเป็นแบบจำลองที่ต้องปรับเทียบกับระยะจริงของมอเตอร์

- [ ] **ขั้นที่ 2: รัน Browser Test Harness ทั้งหมด**

เปิด `http://127.0.0.1:8000/tests/arena-state.test.html`

ผลที่คาดหวัง: ทุกการทดสอบผ่าน ไม่มีรายการไม่ผ่าน และ Console ไม่มี Error หรือ Warning

- [ ] **ขั้นที่ 3: ตรวจทุกค่าลูกเต๋าและสองโหมด**

ทดสอบ directionDie, leftDie และ rightDie ตั้งแต่ 1–6 ทดสอบ planningMode ทั้ง score/pass และตรวจว่า route points ทุกจุดไม่ชนตาม `pointIsBlocked` พร้อมยืนยันกรณี score fallback อย่างน้อยหนึ่งชุด

- [ ] **ขั้นที่ 4: ตรวจหน้าจอ 320, 390 และ 1280 พิกเซล**

แต่ละขนาดต้องไม่มี horizontal overflow, Dialog เปิดและเลื่อนได้, Canvas เห็นสนามครบ, สรุปเส้นทางและคำสั่งไม่ซ้อน, ปุ่มและ input ใช้งานด้วยแป้นพิมพ์ได้

- [ ] **ขั้นที่ 5: ตรวจการคำนวณซ้ำและทรัพยากร**

สุ่มแต้มต่อเนื่อง 30 ครั้ง เปิด–ปิดการวัด 10 ครั้ง และบันทึก Settings 5 ชุด ตรวจว่า scene ไม่มีจำนวน object เพิ่มต่อเนื่องหลังแต่ละรอบ Console ไม่มี Error/Warning และการคำนวณแต่ละครั้งต่ำกว่า 250 มิลลิวินาทีที่ gridSize 0.05

- [ ] **ขั้นที่ 6: ตรวจความต้องการทีละข้อ**

เปรียบเทียบผลกับทุกหัวข้อใน `docs/superpowers/specs/2026-09-21-route-planning-measurements-design.md` บันทึกข้อจำกัดที่เหลือ และอย่าระบุว่างานเสร็จจนกว่าชุดทดสอบและการตรวจเบราว์เซอร์ทั้งหมดผ่าน
