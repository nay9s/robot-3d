import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARENA, buildArenaState, cameraDistanceForFit, rollDirectionDie, rollBoxDice } from './arena-state.js?v=9';
import { DEFAULT_SETTINGS, loadSettings, resetSettings, saveSettings, validateSettings } from './settings-store.js?v=17';
import { planRoute } from './path-planner.js?v=20';
import { buildManualRoute } from './manual-route.js?v=2';
import { buildMeasurementDescriptors, MeasurementLayer } from './measurement-layer.js?v=8';
import { generateArduinoCode, calculateRecommendedPwm, generateTurnTestCode } from './arduino-exporter.js?v=21';
import {
  turnTargets,
  suggestTurnTicks,
  applyTurnSuggestion,
  buildTrialsFromRoute,
  saveActiveRunState,
} from './turn-calibration.js?v=2';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#arena-canvas');
const status = $('#arena-status');
const directionSelect = $('#direction-die');
const leftSelect = $('#left-die');
const rightSelect = $('#right-die');
const measurementToggle = $('#measurement-toggle');
const settingsDialog = $('#settings-dialog');
const settingsForm = $('#settings-form');
const routeStatus = $('#route-status');
const routeGoal = $('#route-goal');
const routeDistance = $('#route-distance');
const routeTurns = $('#route-turns');
const routeTime = $('#route-time');
const routeExitClearance = $('#route-exit-clearance');
const routeCommands = $('#route-commands');
const quickPlanningMode = $('#quick-planning-mode');
const routeSourceSelect = $('#route-source');
const manualFeedback = $('#manual-route-feedback');
const manualWaypoints = [];
let routeSource = 'auto';
const simPlayPauseBtn = $('#sim-play-pause');
const simPlayIcon = $('#sim-play-icon');
const simPlayLabel = $('#sim-play-label');
const simResetBtn = $('#sim-reset');
const simSpeedSelect = $('#sim-speed');
const simBadge = $('#sim-badge');
const simStepDesc = $('#sim-step-desc');
const loading = window.arenaLoading;

const COLORS = Object.freeze({
  floor: 0x26313d,
  floorEdge: 0x465466,
  grid: 0x5c6b7b,
  wall: 0x665b85,
  wallCap: 0xd0d7df,
  robot: 0x54c9f3,
  robotDark: 0x142f3c,
  leftObstacle: 0xff9252,
  rightObstacle: 0xff6f5e,
  exit: 0x2b896d,
  bonus: 0x6ee8af,
  route: 0x7af3b9,
  reverse: 0xffa052,
  turn: 0xffdf77,
});

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (error) {
  canvas.hidden = true;
  loading?.fail(`ไม่สามารถเริ่มระบบ WebGL ได้: ${error.message}`);
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101821);
scene.fog = new THREE.Fog(0x101821, 6.5, 11);

const camera = new THREE.PerspectiveCamera(43, 1, 0.05, 30);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 3.4;
controls.maxDistance = 9;
controls.maxPolarAngle = Math.PI / 2.04;
controls.target.set(0, 0.08, 0);

const overviewPosition = new THREE.Vector3(3.9, 4.25, 4.35);
const overviewUp = new THREE.Vector3(0, 1, 0);
const topUp = new THREE.Vector3(0, 0, -1);
const routeLayer = new THREE.Group();
routeLayer.name = 'route-layer';
scene.add(routeLayer);
const manualPointLayer = new THREE.Group();
scene.add(manualPointLayer);
let currentView = 'overview';
let currentSettings = loadSettings(localStorage);
let turnCalibrationPointsDraft = currentSettings.turnCalibrationPoints;

function disposeObject(object) {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material?.map?.dispose?.();
      material?.dispose?.();
    }
  });
}

function createLighting() {
  scene.add(new THREE.HemisphereLight(0xbfe8ff, 0x1b2430, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 3.1);
  key.position.set(-3.5, 6, -2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -3.2;
  key.shadow.camera.right = 3.2;
  key.shadow.camera.top = 3.2;
  key.shadow.camera.bottom = -3.2;
  scene.add(key);
}

function createFloor() {
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA.width, 0.06, ARENA.depth),
    new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.87, metalness: 0.04 }),
  );
  floor.position.y = -0.04;
  floor.receiveShadow = true;
  scene.add(floor);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA.width + 0.22, 0.08, ARENA.depth + 0.22),
    new THREE.MeshStandardMaterial({ color: COLORS.floorEdge, roughness: 0.8 }),
  );
  base.position.y = -0.105;
  base.receiveShadow = true;
  scene.add(base);
}

function createGrid() {
  const halfWidth = ARENA.width / 2;
  const halfDepth = ARENA.depth / 2;
  const points = [];
  for (let x = -halfWidth; x <= halfWidth + 0.0001; x += ARENA.tileSize) {
    const c = Math.min(x, halfWidth);
    points.push(new THREE.Vector3(c, 0.004, -halfDepth), new THREE.Vector3(c, 0.004, halfDepth));
  }
  for (let z = -halfDepth; z <= halfDepth + 0.0001; z += ARENA.tileSize) {
    const c = Math.min(z, halfDepth);
    points.push(new THREE.Vector3(-halfWidth, 0.004, c), new THREE.Vector3(halfWidth, 0.004, c));
  }
  scene.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.28 }),
  ));
}

function addWall(width, depth, x, z, height = 0.2) {
  const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    [material(COLORS.wall), material(COLORS.wall), material(COLORS.wallCap), material(COLORS.wall), material(COLORS.wall), material(COLORS.wall)],
  );
  wall.position.set(x, height / 2, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);
}

function createWalls() {
  const halfWidth = ARENA.width / 2;
  const halfDepth = ARENA.depth / 2;
  const thickness = 0.055;
  const panelHeight = 0.45;
  const jointMaterial = new THREE.MeshStandardMaterial({ color: COLORS.wallCap, roughness: 0.78 });
  const addJoint = (x, z, horizontal) => {
    const joint = new THREE.Mesh(
      new THREE.BoxGeometry(horizontal ? 0.014 : thickness + 0.008,
        panelHeight + 0.02, horizontal ? thickness + 0.008 : 0.014),
      jointMaterial,
    );
    joint.position.set(x, (panelHeight + 0.02) / 2, z);
    scene.add(joint);
  };
  const panelWidth = ARENA.width / 3;
  const panelDepth = ARENA.depth / 3;
  // Three panels on the top, left and right. On the bottom, the exit occupies
  // the first section, followed by two physical panels.
  for (let panel = 0; panel < 3; panel++) {
    addWall(panelWidth, thickness, -halfWidth + (panel + 0.5) * panelWidth,
      -halfDepth, panelHeight);
    addWall(thickness, panelDepth, -halfWidth,
      -halfDepth + (panel + 0.5) * panelDepth, panelHeight);
    addWall(thickness, panelDepth, halfWidth,
      -halfDepth + (panel + 0.5) * panelDepth, panelHeight);
  }
  for (let seam = 1; seam < 3; seam++) {
    addJoint(-halfWidth + seam * panelWidth, -halfDepth, true);
    addJoint(-halfWidth, -halfDepth + seam * panelDepth, false);
    addJoint(halfWidth, -halfDepth + seam * panelDepth, false);
  }
  const remainingWidth = ARENA.width - ARENA.exitWidth;
  const gapEnd = -halfWidth + ARENA.exitWidth;
  for (let panel = 0; panel < 2; panel++) {
    addWall(remainingWidth / 2, thickness,
      gapEnd + (panel + 0.5) * remainingWidth / 2, halfDepth, panelHeight);
  }
  addJoint(gapEnd + remainingWidth / 2, halfDepth, true);
}

function createExitMarkers() {
  const halfWidth = ARENA.width / 2;
  const halfDepth = ARENA.depth / 2;
  const regularWidth = ARENA.exitWidth - ARENA.bonusWidth; // 20 inches (~0.508m)

  // ช่องขวา (ออกปกติ 20 นิ้ว)
  const rightExitMarker = new THREE.Mesh(
    new THREE.BoxGeometry(regularWidth, 0.014, 0.18),
    new THREE.MeshBasicMaterial({ color: COLORS.exit }),
  );
  rightExitMarker.position.set(-halfWidth + ARENA.bonusWidth + regularWidth / 2, 0.014, halfDepth - 0.09);
  scene.add(rightExitMarker);

  // ช่องซ้าย (ช่วงคะแนนพิเศษ 19 นิ้ว)
  const leftBonusMarker = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA.bonusWidth, 0.018, 0.18),
    new THREE.MeshBasicMaterial({ color: COLORS.bonus }),
  );
  leftBonusMarker.position.set(-halfWidth + ARENA.bonusWidth / 2, 0.018, halfDepth - 0.09);
  scene.add(leftBonusMarker);

  // เส้นแบ่งกลางระหว่างช่องซ้ายและช่องขวา
  const dividerMarker = new THREE.Mesh(
    new THREE.BoxGeometry(0.016, 0.024, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  dividerMarker.position.set(-halfWidth + ARENA.bonusWidth, 0.02, halfDepth - 0.09);
  scene.add(dividerMarker);
}

function createStartZoneMarker() {
  const zone = ARENA.startZone;
  if (!zone) return;
  const startZoneGroup = new THREE.Group();
  startZoneGroup.name = 'start-zone';

  // แผ่นพื้นช่องวางขนาด 30x30 ซม. ตำแหน่งคำนวณจากระยะถึงขอบช่อง
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(zone.width, zone.depth),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(zone.x, 0.005, zone.z);
  startZoneGroup.add(pad);

  // กรอบเส้นขอบช่องวางขนาด 30x30 ซม.
  const halfW = zone.width / 2;
  const halfD = zone.depth / 2;
  const borderPoints = [
    new THREE.Vector3(zone.x - halfW, 0.007, zone.z - halfD),
    new THREE.Vector3(zone.x + halfW, 0.007, zone.z - halfD),
    new THREE.Vector3(zone.x + halfW, 0.007, zone.z - halfD),
    new THREE.Vector3(zone.x + halfW, 0.007, zone.z + halfD),
    new THREE.Vector3(zone.x + halfW, 0.007, zone.z + halfD),
    new THREE.Vector3(zone.x - halfW, 0.007, zone.z + halfD),
    new THREE.Vector3(zone.x - halfW, 0.007, zone.z + halfD),
    new THREE.Vector3(zone.x - halfW, 0.007, zone.z - halfD),
  ];
  startZoneGroup.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(borderPoints),
    new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 })
  ));

  // จุดกึ่งกลางช่องวาง (จุดวางหุ่นยนต์)
  const centerDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.012, 16),
    new THREE.MeshBasicMaterial({ color: 0x7af3b9, side: THREE.DoubleSide, depthTest: false })
  );
  centerDot.rotation.x = -Math.PI / 2;
  centerDot.position.set(zone.x, 0.008, zone.z);
  startZoneGroup.add(centerDot);

  scene.add(startZoneGroup);
}

function createRobot(settings) {
  const robot = new THREE.Group();
  robot.name = 'robot';
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(settings.width, 0.12, settings.length),
    new THREE.MeshStandardMaterial({ color: COLORS.robot, roughness: 0.38, metalness: 0.42 }),
  );
  base.position.y = 0.09;
  base.castShadow = true;
  robot.add(base);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(settings.width * 0.66, 0.1, settings.length * 0.58),
    new THREE.MeshStandardMaterial({ color: COLORS.robotDark, roughness: 0.38, metalness: 0.48 }),
  );
  top.position.y = 0.2;
  top.castShadow = true;
  robot.add(top);

  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.72 });
  const wheelRadius = Math.min(0.055, settings.length * 0.15);
  robot.userData.wheels = [];
  robot.userData.wheelRadius = wheelRadius;
  for (const x of [-settings.width / 2 - 0.025, settings.width / 2 + 0.025]) {
    for (const z of [-settings.length * 0.3, settings.length * 0.3]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.055, 18), wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.065, z);
      wheel.castShadow = true;
      robot.add(wheel);
      robot.userData.wheels.push(wheel);
    }
  }

  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(Math.min(0.07, settings.width * 0.22), Math.min(0.18, settings.length * 0.48), 18),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(0, 0.285, settings.length * 0.2);
  arrow.name = 'forward-arrow';
  robot.add(arrow);
  robot.position.set(ARENA.robot.x, 0, ARENA.robot.z);
  scene.add(robot);
  return robot;
}

function createObstacle(dimensions, color) {
  const obstacle = new THREE.Mesh(
    new THREE.BoxGeometry(dimensions.width, 0.3, dimensions.depth),
    new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.06 }),
  );
  obstacle.position.y = 0.15;
  obstacle.castShadow = true;
  obstacle.receiveShadow = true;
  scene.add(obstacle);
  return obstacle;
}

function createLabel(text, position, color = '#f4f7fb', parent = scene) {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 128;
  const context = labelCanvas.getContext('2d');
  context.font = '600 42px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = 'rgba(9, 13, 19, 0.78)';
  context.beginPath();
  context.roundRect(8, 16, 496, 96, 32);
  context.fill();
  context.fillStyle = color;
  context.fillText(text, 256, 64);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.76, 0.19, 1);
  sprite.position.copy(position);
  sprite.renderOrder = 9;
  parent.add(sprite);
  return sprite;
}

createLighting();
createFloor();
createGrid();
createWalls();
createExitMarkers();
createStartZoneMarker();

const coordGridGroup = new THREE.Group();
coordGridGroup.name = 'coord-grid';
scene.add(coordGridGroup);

function createCoordinateGrid() {
  const halfWidth = ARENA.width / 2;
  const halfDepth = ARENA.depth / 2;
  const majorPoints = [];
  const axisPoints = [];

  // แกนศูนย์กลาง X = 0 และ Z = 0
  axisPoints.push(new THREE.Vector3(0, 0.007, -halfDepth), new THREE.Vector3(0, 0.007, halfDepth));
  axisPoints.push(new THREE.Vector3(-halfWidth, 0.007, 0), new THREE.Vector3(halfWidth, 0.007, 0));

  coordGridGroup.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(axisPoints),
    new THREE.LineBasicMaterial({ color: 0x54c9f3, transparent: true, opacity: 0.75 }),
  ));

  // เส้นกริดหลักทุก 0.5 เมตร
  for (let c = -1.5; c <= 1.51; c += 0.5) {
    if (Math.abs(c) < 0.01) continue;
    if (Math.abs(c) < halfWidth) majorPoints.push(new THREE.Vector3(c, 0.005, -halfDepth), new THREE.Vector3(c, 0.005, halfDepth));
    if (Math.abs(c) < halfDepth) majorPoints.push(new THREE.Vector3(-halfWidth, 0.005, c), new THREE.Vector3(halfWidth, 0.005, c));
  }

  coordGridGroup.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(majorPoints),
    new THREE.LineBasicMaterial({ color: 0x6e8299, transparent: true, opacity: 0.45 }),
  ));

  // ตัวเลขกำกับพิกัดบนขอบสนาม (X และ Y)
  const formatM = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}m`;
  for (let x = -1.5; x <= 1.51; x += 0.5) {
    if (Math.abs(x) >= halfWidth) continue;
    const lbl = createLabel(`X:${formatM(x)}`, new THREE.Vector3(x, 0.06, -halfDepth + 0.12), '#8edbff', coordGridGroup);
    lbl.scale.set(0.46, 0.115, 1);
  }
  for (let z = -1.5; z <= 1.51; z += 0.5) {
    if (Math.abs(z) >= halfDepth) continue;
    const yVal = -z;
    const lbl = createLabel(`Y:${formatM(yVal)}`, new THREE.Vector3(halfWidth - 0.14, 0.06, z), '#a6f4cb', coordGridGroup);
    lbl.scale.set(0.46, 0.115, 1);
  }
}
createCoordinateGrid();
coordGridGroup.visible = false;

// Hover Marker ติดตามตำแหน่งเมาส์บนพื้นสนาม 3D
const hoverMarkerGroup = new THREE.Group();
hoverMarkerGroup.name = 'hover-marker';

const hoverRing = new THREE.Mesh(
  new THREE.RingGeometry(0.025, 0.05, 32),
  new THREE.MeshBasicMaterial({ color: 0x54c9f3, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false })
);
hoverRing.rotation.x = -Math.PI / 2;
hoverMarkerGroup.add(hoverRing);

const hoverCenterDot = new THREE.Mesh(
  new THREE.CircleGeometry(0.008, 16),
  new THREE.MeshBasicMaterial({ color: 0x7af3b9, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false })
);
hoverCenterDot.rotation.x = -Math.PI / 2;
hoverMarkerGroup.add(hoverCenterDot);

hoverMarkerGroup.position.y = 0.015;
hoverMarkerGroup.visible = false;
scene.add(hoverMarkerGroup);

let robot = createRobot(currentSettings);
const leftObstacle = createObstacle(ARENA.leftBox, COLORS.leftObstacle);
const rightObstacle = createObstacle(ARENA.rightBox, COLORS.rightObstacle);
leftObstacle.position.z = ARENA.leftBox.z;
rightObstacle.position.z = ARENA.rightBox.z;
createLabel('START (30×30 cm)', new THREE.Vector3(ARENA.robot.x - 0.42, 0.72, ARENA.robot.z - 0.14), '#7ad9ff');
const leftLabel = createLabel('LEFT BOX', new THREE.Vector3(ARENA.leftBox.originX, 0.68, ARENA.leftBox.z), '#ffb17d');
const rightLabel = createLabel('RIGHT BOX', new THREE.Vector3(ARENA.rightBox.originX, 0.68, ARENA.rightBox.z), '#ff9c8f');
createLabel('EXIT', new THREE.Vector3(-ARENA.width / 2 + ARENA.exitWidth / 2, 0.28, ARENA.depth / 2 - 0.12), '#6ee8af');
const measurementLayer = new MeasurementLayer({ THREE, scene, createLabel });

function readDice() {
  return {
    directionDie: Number(directionSelect.value),
    leftDie: Number(leftSelect.value),
    rightDie: Number(rightSelect.value),
  };
}

function updateArenaMeshes(diceState) {
  robot.rotation.y = diceState.robotRotationY;
  leftObstacle.position.x = diceState.leftBoxX;
  rightObstacle.position.x = diceState.rightBoxX;
  leftLabel.position.x = diceState.leftBoxX;
  rightLabel.position.x = diceState.rightBoxX;
  const dice = readDice();
  const directionText = { บน: 'หันขึ้นด้านบน', ขวา: 'หันไปทางขวา', ล่าง: 'หันลงด้านล่าง', ซ้าย: 'หันไปทางซ้าย' }[diceState.robotDirection];
  status.textContent = `${directionText} · กล่องซ้าย ${dice.leftDie} ช่อง (${diceState.leftShiftMetres.toFixed(2)} ม.) · กล่องขวา ${dice.rightDie} ช่อง (${diceState.rightShiftMetres.toFixed(2)} ม.)`;
}

function replaceRobot() {
  scene.remove(robot);
  disposeObject(robot);
  robot = createRobot(currentSettings);
}

function clearRouteLayer() {
  for (const child of [...routeLayer.children]) {
    routeLayer.remove(child);
    disposeObject(child);
  }
}

function renderRoute(route) {
  clearRouteLayer();
  if (route.status !== 'found') {
    canvas.dataset.routeObjectCount = '0';
    return;
  }

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(route.points.map((point) => new THREE.Vector3(point.x, 0.075, point.z))),
    new THREE.LineBasicMaterial({ color: COLORS.route, depthTest: false }),
  );
  line.renderOrder = 6;
  routeLayer.add(line);

  for (const [index, segment] of route.segments.entries()) {
    const isReverse = segment.motionType === 'reverse';
    const direction = new THREE.Vector3(segment.to.x - segment.from.x, 0, segment.to.z - segment.from.z).normalize();
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.045, 0.13, 16),
      new THREE.MeshBasicMaterial({ color: isReverse ? COLORS.reverse : COLORS.route, depthTest: false }),
    );
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    arrow.position.set((segment.from.x + segment.to.x) / 2, 0.11, (segment.from.z + segment.to.z) / 2);
    arrow.renderOrder = 7;
    routeLayer.add(arrow);

    if (isReverse) {
      createLabel('ถอยหลัง', new THREE.Vector3((segment.from.x + segment.to.x) / 2, 0.28, (segment.from.z + segment.to.z) / 2), '#ffa052', routeLayer);
    }

    if (index > 0) {
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.045, 0.075, 20),
        new THREE.MeshBasicMaterial({ color: COLORS.turn, side: THREE.DoubleSide, depthTest: false }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(segment.from.x, 0.082, segment.from.z);
      marker.renderOrder = 7;
      routeLayer.add(marker);
    }
  }
  canvas.dataset.routeObjectCount = String(routeLayer.children.length);
}

function renderRouteSummary(route) {
  routeCommands.replaceChildren();
  if (route.status !== 'found') {
    routeStatus.dataset.state = route.status === 'start_blocked' ? 'start-blocked' : 'no-path';
    routeStatus.textContent = route.status === 'empty' ? 'คลิกเพิ่มจุดบนแมพ'
      : route.status === 'start_blocked' ? '⚠ จุดเริ่มติดขอบ' : '⚠ ไม่พบเส้นทาง';
    routeGoal.textContent = '—';
    routeDistance.textContent = '—';
    routeTurns.textContent = '—';
    routeTime.textContent = '—';
    routeExitClearance.textContent = '—';
    const item = document.createElement('li');
    item.textContent = route.reason;
    routeCommands.append(item);
    if (simPlayPauseBtn) simPlayPauseBtn.disabled = true;
    if (simResetBtn) simResetBtn.disabled = true;
    $('#route-arduino-btn').disabled = true;
    return;
  }

  if (simPlayPauseBtn) simPlayPauseBtn.disabled = false;
  if (simResetBtn) simResetBtn.disabled = false;
  $('#route-arduino-btn').disabled = false;

  routeStatus.dataset.state = route.usedFallback ? 'fallback' : 'found';
  routeStatus.textContent = route.usedFallback
    ? '↪ ทางออกสำรอง'
    : (currentSettings.planningMode === 'fastest'
        ? (currentSettings.directLine ? '⚡ ทางตรงพร้อมระยะเผื่อ' : '⚡ เร็วที่สุดแบบมุมฉาก')
        : (currentSettings.planningMode === 'pass'
            ? '🛡 ปลอดภัย (A*)'
            : '🎯 เน้นคะแนน'));
  routeGoal.textContent = route.goalType === 'bonus' ? 'ช่องซ้าย 19" (+1 คะแนน)' : 'ช่องขวา 20" (ปกติ)';
  if (route.goalType === 'manual') {
    routeStatus.textContent = 'วางเอง · โหมดอิสระ';
    routeGoal.textContent = `${manualWaypoints.length} จุด (ลากปรับได้)`;
  }
  routeDistance.textContent = `${route.totalDistance.toFixed(2)} เมตร`;
  routeTurns.textContent = `${route.turnCount} ครั้ง`;
  routeTime.textContent = `${route.estimatedSeconds.toFixed(1)} วินาที`;
  routeExitClearance.textContent = `${(route.exitClearance ?? currentSettings.exitClearance ?? 0.04).toFixed(2)} เมตร/ด้าน`;
  for (const [index, command] of route.commands.entries()) {
    const item = document.createElement('li');
    item.textContent = command.label;
    item.dataset.commandIndex = String(index);
    if (command.type === 'reverse') item.dataset.motion = 'reverse';
    routeCommands.append(item);
  }
  if (route.usedFallback && route.reason) {
    const item = document.createElement('li');
    item.textContent = `หมายเหตุ: ${route.reason}`;
    routeCommands.prepend(item);
  }
}

let currentRoute = null;
let currentDiceState = null;
let simSteps = [];
let simState = 'idle';
let simSpeed = 2.0;
let currentStepIndex = 0;
let currentStepTime = 0;
const timer = new THREE.Timer();
timer.connect(document);

function buildSimSteps(route, diceState) {
  if (!route || route.status !== 'found' || !route.commands || route.commands.length === 0) return [];
  const steps = [];
  let curX = ARENA.robot.x;
  let curZ = ARENA.robot.z;
  let curRotY = diceState.robotRotationY;
  let segmentIdx = 0;

  for (let cmdIdx = 0; cmdIdx < route.commands.length; cmdIdx++) {
    const cmd = route.commands[cmdIdx];
    if (cmd.type.startsWith('turn-')) {
      const degrees = cmd.degrees;
      let deltaRotY = 0;
      if (cmd.type === 'turn-right') deltaRotY = -degrees * Math.PI / 180;
      else if (cmd.type === 'turn-left') deltaRotY = degrees * Math.PI / 180;
      else if (cmd.type === 'turn-around') deltaRotY = -Math.PI;

      const duration = Math.max(0.05, (degrees / 90) * currentSettings.turnSeconds90);
      steps.push({
        type: 'turn',
        cmdIdx,
        label: cmd.label,
        fromX: curX, toX: curX,
        fromZ: curZ, toZ: curZ,
        fromRotY: curRotY,
        toRotY: curRotY + deltaRotY,
        duration,
      });
      curRotY += deltaRotY;
    } else if (cmd.type === 'forward' || cmd.type === 'reverse') {
      const seg = route.segments[segmentIdx++];
      if (!seg) continue;
      const duration = Math.max(0.05, seg.distance / currentSettings.speed);
      steps.push({
        type: cmd.type,
        cmdIdx,
        label: cmd.label,
        fromX: seg.from.x, toX: seg.to.x,
        fromZ: seg.from.z, toZ: seg.to.z,
        fromRotY: curRotY,
        toRotY: curRotY,
        distance: seg.distance,
        duration,
      });
      curX = seg.to.x;
      curZ = seg.to.z;
    }
  }
  return steps;
}

function updateSimUI() {
  if (!simPlayPauseBtn || !simBadge) return;
  if (simState === 'playing') {
    simBadge.dataset.state = 'playing';
    simBadge.textContent = 'กำลังจำลอง…';
    simPlayIcon.textContent = '⏸';
    simPlayLabel.textContent = 'หยุดชั่วคราว';
  } else if (simState === 'paused') {
    simBadge.dataset.state = 'paused';
    simBadge.textContent = 'หยุดชั่วคราว';
    simPlayIcon.textContent = '▶';
    simPlayLabel.textContent = 'เล่นต่อ (Resume)';
  } else if (simState === 'finished') {
    simBadge.dataset.state = 'finished';
    simBadge.textContent = '✓ สำเร็จ';
    simPlayIcon.textContent = '↺';
    simPlayLabel.textContent = 'เล่นอีกครั้ง (Replay)';
  } else {
    simBadge.dataset.state = 'idle';
    simBadge.textContent = 'พร้อมจำลอง';
    simPlayIcon.textContent = '▶';
    simPlayLabel.textContent = 'เล่นจำลอง (Play)';
  }

  const items = routeCommands.querySelectorAll('li[data-command-index]');
  for (const item of items) {
    const idx = Number(item.dataset.commandIndex);
    const isCurrent = simState !== 'idle' && simSteps[currentStepIndex] && simSteps[currentStepIndex].cmdIdx === idx;
    if (isCurrent) {
      item.classList.add('active-step');
      const itemTop = item.offsetTop - routeCommands.offsetTop;
      const itemBottom = itemTop + item.offsetHeight;
      if (itemTop < routeCommands.scrollTop || itemBottom > routeCommands.scrollTop + routeCommands.clientHeight) {
        routeCommands.scrollTo({ top: Math.max(0, itemTop - routeCommands.clientHeight / 2), behavior: 'smooth' });
      }
    } else {
      item.classList.remove('active-step');
    }
  }
}

function simReset() {
  simState = 'idle';
  currentStepIndex = 0;
  currentStepTime = 0;
  if (currentDiceState) {
    robot.position.set(ARENA.robot.x, 0, ARENA.robot.z);
    robot.rotation.y = currentDiceState.robotRotationY;
  }
  if (simStepDesc) simStepDesc.textContent = '';
  updateSimUI();
}

function simPlay() {
  if (simSteps.length === 0) return;
  if (simState === 'finished') {
    simReset();
  }
  simState = 'playing';
  timer.reset();
  updateSimUI();
}

function simPause() {
  simState = 'paused';
  updateSimUI();
}

function showManualFeedback(message, error = false) {
  manualFeedback.textContent = message;
  manualFeedback.dataset.error = String(error);
}

function renderManualPoints(route) {
  for (const child of [...manualPointLayer.children]) {
    manualPointLayer.remove(child);
    disposeObject(child);
  }
  const list = $('#manual-route-points');
  list.replaceChildren();
  $('#manual-route-undo').disabled = manualWaypoints.length === 0;
  $('#manual-route-clear').disabled = manualWaypoints.length === 0;
  if (routeSource !== 'manual') return;
  const invalid = route.status !== 'found' && route.status !== 'empty';
  for (const [index, point] of manualWaypoints.entries()) {
    const isDragged = draggedWaypointIndex === index;
    const marker = new THREE.Mesh(new THREE.SphereGeometry(isDragged ? 0.045 : 0.035, 12, 8),
      new THREE.MeshBasicMaterial({ color: invalid ? 0xff6f5e : (isDragged ? 0x38ef7d : COLORS.turn), depthTest: false }));
    marker.position.set(point.x, 0.10, point.z);
    marker.renderOrder = 9;
    manualPointLayer.add(marker);
    createLabel(String(index + 1), new THREE.Vector3(point.x, 0.22, point.z), isDragged ? '#38ef7d' : '#ffdf77', manualPointLayer);
    
    const item = document.createElement('li');
    const labelSpan = document.createElement('span');
    labelSpan.textContent = `[${index + 1}] X ${point.x.toFixed(2)}, Y ${(-point.z).toFixed(2)} ม.${index === manualWaypoints.length - 1 ? ' · ปลายทาง' : ''}`;
    
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'manual-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = `ลบจุดที่ ${index + 1}`;
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      manualWaypoints.splice(index, 1);
      recompute();
    });
    
    item.append(labelSpan, delBtn);
    list.append(item);
  }
  if (invalid && manualWaypoints.length) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      [ARENA.robot, ...manualWaypoints].map(point => new THREE.Vector3(point.x, 0.09, point.z))),
    new THREE.LineDashedMaterial({ color: 0xff6f5e, dashSize: 0.05, gapSize: 0.04, depthTest: false }));
    line.computeLineDistances();
    manualPointLayer.add(line);
  }
  showManualFeedback(route.status === 'found'
    ? `${manualWaypoints.length} จุด · โหมดอิสระ (ลากย้ายจุดบนสนามได้)` : route.reason, invalid);
}

function recompute() {
  const startedAt = performance.now();
  const diceState = buildArenaState(readDice());
  currentDiceState = diceState;
  updateArenaMeshes(diceState);
  const route = routeSource === 'manual'
    ? buildManualRoute({ arena: ARENA, diceState, settings: currentSettings, waypoints: manualWaypoints })
    : planRoute({ arena: ARENA, diceState, settings: currentSettings });
  currentRoute = route;
  saveActiveRunState(localStorage, {
    dice: readDice(),
    planningMode: currentSettings.planningMode,
    routeSource,
    timestamp: Date.now(),
  });
  renderRoute(route);
  renderRouteSummary(route);
  renderManualPoints(route);
  simSteps = buildSimSteps(route, diceState);
  simReset();
  if (quickPlanningMode) quickPlanningMode.value = currentSettings.planningMode;
  measurementLayer.update(buildMeasurementDescriptors({ arena: ARENA, diceState, settings: currentSettings, route }));
  measurementLayer.setVisible(currentSettings.showMeasurements && measurementToggle.checked);
  canvas.dataset.routeStatus = route.status;
  canvas.dataset.routeSource = routeSource;
  canvas.dataset.routeGoal = route.goalType ?? '';
  canvas.dataset.measurementObjectCount = String(measurementLayer.group.children.length);
  if (arduinoDialog?.open) updateArduinoCodeView();
}

function setCamera(position, up) {
  camera.up.copy(up);
  camera.position.copy(position);
  controls.target.set(0, 0.08, 0);
  camera.lookAt(controls.target);
  controls.update();
}

function setTopView() {
  currentView = 'top';
  const distance = cameraDistanceForFit({ aspect: camera.aspect, verticalFovDegrees: camera.fov, span: Math.max(ARENA.width, ARENA.depth) + 0.65, margin: 1.08 });
  setCamera(new THREE.Vector3(0, distance, 0.001), topUp);
}

function resetView() {
  currentView = 'overview';
  setCamera(overviewPosition, overviewUp);
}

function resize() {
  const width = Math.max(canvas.clientWidth, 1);
  const height = Math.max(canvas.clientHeight, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (currentView === 'top') setTopView();
}

const TURN_CALIBRATION_KEYS = [
  'turnRight45LeftTicks', 'turnRight45RightTicks',
  'turnRight90LeftTicks', 'turnRight90RightTicks',
  'turnRight180LeftTicks', 'turnRight180RightTicks',
  'turnLeft45LeftTicks', 'turnLeft45RightTicks',
  'turnLeft90LeftTicks', 'turnLeft90RightTicks',
  'turnLeft180LeftTicks', 'turnLeft180RightTicks',
];

function fillSettingsForm(settings) {
  turnCalibrationPointsDraft = settings.turnCalibrationPoints ?? [];
  for (const key of ['width', 'length', 'clearance', 'exitClearance', 'speed', 'straightDistanceScale', 'leftCmPerTick', 'rightCmPerTick', 'turnSeconds90', 'directSafetyMargin', ...TURN_CALIBRATION_KEYS, 'gridSize', 'planningMode']) {
    if (settingsForm.elements.namedItem(key)) {
      settingsForm.elements.namedItem(key).value = String(settings[key] ?? '');
    }
  }
  settingsForm.elements.namedItem('allowReverse').checked = settings.allowReverse !== false;
  settingsForm.elements.namedItem('preferRightTurns').checked = settings.preferRightTurns !== false;
  settingsForm.elements.namedItem('invertTurnDirection').checked = settings.invertTurnDirection !== false;
  settingsForm.elements.namedItem('directLine').checked = settings.directLine !== false;
  settingsForm.elements.namedItem('showMeasurements').checked = settings.showMeasurements;
  settingsForm.elements.namedItem('useUltrasonic').checked = settings.useUltrasonic !== false;
  settingsForm.elements.namedItem('useUltrasonicScan').checked = settings.useUltrasonicScan !== false;
  settingsForm.elements.namedItem('ultrasonicTrigPin').value = String(settings.ultrasonicTrigPin ?? 13);
  settingsForm.elements.namedItem('ultrasonicEchoPin').value = String(settings.ultrasonicEchoPin ?? 12);
  settingsForm.elements.namedItem('ultrasonicStopDist').value = String(settings.ultrasonicStopDist ?? 12);
  settingsForm.elements.namedItem('ultrasonicOpenDist').value = String(settings.ultrasonicOpenDist ?? 45);
  settingsForm.elements.namedItem('servoCenterAngle').value = String(settings.servoCenterAngle ?? 90);
  settingsForm.elements.namedItem('servoScanOffset').value = String(settings.servoScanOffset ?? 45);
  for (const error of settingsForm.querySelectorAll('[data-error-for]')) error.textContent = '';
  for (const input of settingsForm.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
  const feedback = $('#turn-adjust-feedback');
  if (feedback) feedback.textContent = 'ยังไม่ได้ปรับค่า';
}

function settingsFromForm() {
  return {
    turnCalibrationPoints: turnCalibrationPointsDraft,
    width: Number(settingsForm.elements.namedItem('width').value),
    length: Number(settingsForm.elements.namedItem('length').value),
    clearance: Number(settingsForm.elements.namedItem('clearance').value),
    exitClearance: Number(settingsForm.elements.namedItem('exitClearance').value),
    speed: Number(settingsForm.elements.namedItem('speed').value),
    straightDistanceScale: Number(settingsForm.elements.namedItem('straightDistanceScale').value),
    leftCmPerTick: Number(settingsForm.elements.namedItem('leftCmPerTick').value),
    rightCmPerTick: Number(settingsForm.elements.namedItem('rightCmPerTick').value),
    turnSeconds90: Number(settingsForm.elements.namedItem('turnSeconds90').value),
    directSafetyMargin: Number(settingsForm.elements.namedItem('directSafetyMargin').value),
    ...Object.fromEntries(TURN_CALIBRATION_KEYS.map((key) => [
      key,
      Number(settingsForm.elements.namedItem(key)?.value),
    ])),
    gridSize: Number(settingsForm.elements.namedItem('gridSize').value),
    planningMode: settingsForm.elements.namedItem('planningMode').value,
    allowReverse: settingsForm.elements.namedItem('allowReverse').checked,
    preferRightTurns: settingsForm.elements.namedItem('preferRightTurns').checked,
    invertTurnDirection: settingsForm.elements.namedItem('invertTurnDirection').checked,
    directLine: settingsForm.elements.namedItem('directLine').checked,
    showMeasurements: settingsForm.elements.namedItem('showMeasurements').checked,
    useUltrasonic: settingsForm.elements.namedItem('useUltrasonic').checked,
    useUltrasonicScan: settingsForm.elements.namedItem('useUltrasonicScan').checked,
    ultrasonicTrigPin: Number(settingsForm.elements.namedItem('ultrasonicTrigPin').value),
    ultrasonicEchoPin: Number(settingsForm.elements.namedItem('ultrasonicEchoPin').value),
    ultrasonicStopDist: Number(settingsForm.elements.namedItem('ultrasonicStopDist').value),
    ultrasonicOpenDist: Number(settingsForm.elements.namedItem('ultrasonicOpenDist').value),
    servoCenterAngle: Number(settingsForm.elements.namedItem('servoCenterAngle').value),
    servoScanOffset: Number(settingsForm.elements.namedItem('servoScanOffset').value),
  };
}

function showSettingsErrors(errors) {
  for (const error of settingsForm.querySelectorAll('[data-error-for]')) error.textContent = '';
  for (const input of settingsForm.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
  for (const [key, message] of Object.entries(errors)) {
    const input = settingsForm.elements.namedItem(key);
    input?.setAttribute('aria-invalid', 'true');
    const error = settingsForm.querySelector(`[data-error-for="${key}"]`);
    if (error) error.textContent = message;
  }
}

function adjustTurnTickInput(input, delta) {
  if (!input) return null;
  const minimum = Number(input.min || 1);
  const maximum = Number(input.max || 400);
  const current = Number(input.value);
  const next = Math.min(maximum, Math.max(minimum, (Number.isFinite(current) ? current : minimum) + delta));
  input.value = String(Number(next.toFixed(1)));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return next;
}

for (const button of settingsForm.querySelectorAll('[data-turn-adjust]')) {
  button.addEventListener('click', () => {
    const delta = Number(button.dataset.turnAdjust);
    const leftInput = settingsForm.elements.namedItem(button.dataset.leftKey);
    const rightInput = settingsForm.elements.namedItem(button.dataset.rightKey);
    const left = adjustTurnTickInput(leftInput, delta);
    const right = adjustTurnTickInput(rightInput, delta);
    const label = button.closest('[data-turn-label]')?.dataset.turnLabel ?? 'มุมที่เลือก';
    const feedback = $('#turn-adjust-feedback');
    if (feedback) {
      const action = delta < 0 ? 'ลดแล้ว' : 'เพิ่มแล้ว';
      feedback.textContent = `${label}: ${action} → L ${left} / R ${right} ticks · กด “บันทึกและคำนวณใหม่” เพื่อใช้ค่า`;
    }
  });
}

for (const select of [directionSelect, leftSelect, rightSelect]) select.addEventListener('change', recompute);

$('#randomize').addEventListener('click', () => {
  directionSelect.value = String(rollDirectionDie());
  leftSelect.value = String(rollBoxDice());
  rightSelect.value = String(rollBoxDice());
  recompute();
});

if (quickPlanningMode) {
  quickPlanningMode.value = currentSettings.planningMode;
  quickPlanningMode.addEventListener('change', () => {
    currentSettings = saveSettings(localStorage, { ...currentSettings, planningMode: quickPlanningMode.value });
    recompute();
  });
}

routeSourceSelect.addEventListener('change', () => {
  routeSource = routeSourceSelect.value;
  $('#manual-route-tools').hidden = routeSource !== 'manual';
  $('#automatic-route-tools').hidden = routeSource === 'manual';
  controls.enableRotate = routeSource !== 'manual';
  if (routeSource === 'manual') setTopView();
  recompute();
});
$('#manual-route-undo').addEventListener('click', () => {
  manualWaypoints.pop();
  recompute();
});
$('#manual-route-clear').addEventListener('click', () => {
  manualWaypoints.length = 0;
  recompute();
});

if (simPlayPauseBtn) {
  simPlayPauseBtn.addEventListener('click', () => {
    if (simState === 'playing') simPause();
    else simPlay();
  });
}

if (simResetBtn) {
  simResetBtn.addEventListener('click', simReset);
}

if (simSpeedSelect) {
  simSpeedSelect.addEventListener('change', () => {
    simSpeed = Number(simSpeedSelect.value) || 2;
  });
}

measurementToggle.checked = currentSettings.showMeasurements;
measurementToggle.addEventListener('change', () => {
  currentSettings = saveSettings(localStorage, { ...currentSettings, showMeasurements: measurementToggle.checked });
  measurementLayer.setVisible(measurementToggle.checked);
});

$('#settings-open').addEventListener('click', () => {
  fillSettingsForm(currentSettings);
  settingsDialog.showModal();
});

for (const selector of ['#settings-cancel', '#settings-cancel-bottom']) $(selector).addEventListener('click', () => settingsDialog.close());

$('#settings-reset').addEventListener('click', () => {
  const defaults = resetSettings({ removeItem() {} });
  fillSettingsForm(defaults);
});

settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const validation = validateSettings(settingsFromForm());
  if (!validation.ok) {
    showSettingsErrors(validation.errors);
    settingsForm.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  currentSettings = saveSettings(localStorage, validation.value);
  measurementToggle.checked = currentSettings.showMeasurements;
  replaceRobot();
  settingsDialog.close();
  recompute();
});

// Arduino Code Exporter
const arduinoOpenBtn = $('#arduino-open');
const routeArduinoBtn = $('#route-arduino-btn');
const arduinoDialog = $('#arduino-dialog');
const arduinoCancelBtn = $('#arduino-cancel');
const arduinoCloseBtn = $('#arduino-close-btn');
const arduinoCopyBtn = $('#arduino-copy-btn');
const arduinoDownloadBtn = $('#arduino-download-btn');
const arduinoProfileSelect = $('#arduino-profile-select');
const arduinoBoardSelect = $('#arduino-board-select');
const arduinoBoardGroup = $('#arduino-board-group');
const arduinoSpeedInput = $('#arduino-speed-input');
const arduinoTurnSummary = $('#arduino-turn-summary');
const arduinoRecommendationBar = $('#arduino-recommendation-bar');
const arduinoRecommendationText = $('#arduino-recommendation-text');
const arduinoApplyRecBtn = $('#arduino-apply-rec-btn');
const arduinoUltrasonicGroup = $('#arduino-ultrasonic-group');
const arduinoUltrasonicToggle = $('#arduino-ultrasonic-toggle');
const arduinoTrigInput = $('#arduino-trig-input');
const arduinoEchoInput = $('#arduino-echo-input');
const arduinoCodeDisplay = $('#arduino-code-display');

let currentGeneratedArduinoCode = '';

function updatePwmRecommendation() {
  const isEncoder = (arduinoProfileSelect?.value ?? 'encoder') === 'encoder';
  if (!isEncoder) {
    if (arduinoRecommendationBar) arduinoRecommendationBar.style.display = 'none';
    return null;
  }
  if (arduinoRecommendationBar) arduinoRecommendationBar.style.display = 'flex';
  const boardType = arduinoBoardSelect?.value ?? 'uno_r4';
  const speed = currentSettings?.speed ?? 0.35;
  const rec = calculateRecommendedPwm({ speedMPerSec: speed, boardType });
  if (arduinoRecommendationText) {
    arduinoRecommendationText.innerHTML = `คำนวณจากความเร็ว <strong>${rec.speedCmPerSec} cm/s</strong>: แนะนำเดินหน้า <strong>${rec.drivePwm}</strong> | เลี้ยว <strong>${rec.turnPwm}</strong> (${rec.formulaDesc})`;
  }
  return rec;
}

function updateArduinoCodeView() {
  if (!currentRoute) return;
  if (currentRoute.status !== 'found' || !currentRoute.commands?.length) {
    currentGeneratedArduinoCode = '';
    if (arduinoCodeDisplay) arduinoCodeDisplay.textContent = 'ยังไม่มีเส้นทางที่วิ่งได้สำหรับค่านี้';
    if (arduinoCopyBtn) arduinoCopyBtn.disabled = true;
    if (arduinoDownloadBtn) arduinoDownloadBtn.disabled = true;
    return;
  }
  const profile = arduinoProfileSelect?.value ?? 'encoder';
  const boardType = arduinoBoardSelect?.value ?? 'uno_r4';
  const rec = calculateRecommendedPwm({ speedMPerSec: currentSettings?.speed ?? 0.35, boardType });
  const baseSpeed = Number(arduinoSpeedInput?.value ?? (boardType === 'uno_r4' ? rec.drivePwm : 200));
  const effectiveSettings = {
    ...currentSettings,
    useUltrasonic: arduinoUltrasonicToggle ? arduinoUltrasonicToggle.checked : (currentSettings.useUltrasonic !== false),
    ultrasonicTrigPin: arduinoTrigInput ? Number(arduinoTrigInput.value) : (currentSettings.ultrasonicTrigPin ?? 13),
    ultrasonicEchoPin: arduinoEchoInput ? Number(arduinoEchoInput.value) : (currentSettings.ultrasonicEchoPin ?? 12),
  };

  if (profile === 'encoder') {
    const validation = validateSettings(effectiveSettings);
    if (!validation.ok) {
      currentGeneratedArduinoCode = '';
      if (arduinoCodeDisplay) {
        arduinoCodeDisplay.textContent = `ไม่สามารถสร้างโค้ดได้:\n- ${Object.values(validation.errors).join('\n- ')}`;
      }
      if (arduinoCopyBtn) arduinoCopyBtn.disabled = true;
      if (arduinoDownloadBtn) arduinoDownloadBtn.disabled = true;
      return;
    }
  }

  currentGeneratedArduinoCode = generateArduinoCode({
    route: currentRoute,
    diceState: currentDiceState,
    settings: effectiveSettings,
    arena: ARENA,
    profile,
    boardType,
    baseSpeed,
  });

  if (arduinoCodeDisplay) {
    arduinoCodeDisplay.textContent = currentGeneratedArduinoCode;
  }
  if (arduinoCopyBtn) arduinoCopyBtn.disabled = false;
  if (arduinoDownloadBtn) arduinoDownloadBtn.disabled = false;
}

function openArduinoDialog() {
  if (arduinoUltrasonicToggle) arduinoUltrasonicToggle.checked = currentSettings.useUltrasonic !== false;
  if (arduinoTrigInput) arduinoTrigInput.value = String(currentSettings.ultrasonicTrigPin ?? 13);
  if (arduinoEchoInput) arduinoEchoInput.value = String(currentSettings.ultrasonicEchoPin ?? 12);
  if (arduinoTurnSummary) {
    arduinoTurnSummary.textContent = `PWM 2000 · R ${currentSettings.turnRight90LeftTicks}/${currentSettings.turnRight90RightTicks} · L ${currentSettings.turnLeft90LeftTicks}/${currentSettings.turnLeft90RightTicks} ticks/90°`;
  }
  const rec = updatePwmRecommendation();
  if (rec && arduinoSpeedInput && (!arduinoSpeedInput.value || arduinoSpeedInput.value === '2000' || arduinoSpeedInput.value === '200')) {
    arduinoSpeedInput.value = String(rec.drivePwm);
  }
  updateArduinoCodeView();
  arduinoDialog?.showModal();
}

function closeArduinoDialog() {
  arduinoDialog?.close();
}

if (arduinoOpenBtn) arduinoOpenBtn.addEventListener('click', openArduinoDialog);
if (routeArduinoBtn) routeArduinoBtn.addEventListener('click', openArduinoDialog);
if (arduinoCancelBtn) arduinoCancelBtn.addEventListener('click', closeArduinoDialog);
if (arduinoCloseBtn) arduinoCloseBtn.addEventListener('click', closeArduinoDialog);

if (arduinoApplyRecBtn) {
  arduinoApplyRecBtn.addEventListener('click', () => {
    const rec = updatePwmRecommendation();
    if (rec && arduinoSpeedInput) {
      arduinoSpeedInput.value = String(rec.drivePwm);
      updateArduinoCodeView();
    }
  });
}

if (arduinoProfileSelect) {
  arduinoProfileSelect.addEventListener('change', () => {
    const isEncoder = arduinoProfileSelect.value === 'encoder';
    if (arduinoBoardGroup) arduinoBoardGroup.style.display = isEncoder ? 'flex' : 'none';
    if (arduinoUltrasonicGroup) arduinoUltrasonicGroup.style.display = isEncoder ? 'flex' : 'none';
    if (!isEncoder) {
      if (arduinoSpeedInput) arduinoSpeedInput.value = '200';
      if (arduinoRecommendationBar) arduinoRecommendationBar.style.display = 'none';
    } else {
      const rec = updatePwmRecommendation();
      if (arduinoSpeedInput && rec) arduinoSpeedInput.value = String(rec.drivePwm);
    }
    updateArduinoCodeView();
  });
}

if (arduinoBoardSelect) {
  arduinoBoardSelect.addEventListener('change', () => {
    const rec = updatePwmRecommendation();
    if (arduinoSpeedInput && rec) arduinoSpeedInput.value = String(rec.drivePwm);
    updateArduinoCodeView();
  });
}

if (arduinoSpeedInput) {
  arduinoSpeedInput.addEventListener('input', updateArduinoCodeView);
}
if (arduinoUltrasonicToggle) {
  arduinoUltrasonicToggle.addEventListener('change', updateArduinoCodeView);
}
if (arduinoTrigInput) {
  arduinoTrigInput.addEventListener('input', updateArduinoCodeView);
}
if (arduinoEchoInput) {
  arduinoEchoInput.addEventListener('input', updateArduinoCodeView);
}

if (arduinoCopyBtn) {
  arduinoCopyBtn.addEventListener('click', async () => {
    if (!currentGeneratedArduinoCode) return;
    try {
      await navigator.clipboard.writeText(currentGeneratedArduinoCode);
      const originalText = arduinoCopyBtn.textContent;
      arduinoCopyBtn.textContent = '✓ คัดลอกสำเร็จ!';
      setTimeout(() => {
        arduinoCopyBtn.textContent = originalText;
      }, 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = currentGeneratedArduinoCode;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      arduinoCopyBtn.textContent = '✓ คัดลอกสำเร็จ!';
      setTimeout(() => {
        arduinoCopyBtn.textContent = '📋 คัดลอกโค้ด';
      }, 2000);
    }
  });
}

if (arduinoDownloadBtn) {
  arduinoDownloadBtn.addEventListener('click', () => {
    if (!currentGeneratedArduinoCode) return;
    const blob = new Blob([currentGeneratedArduinoCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dice = readDice();
    const mode = routeSource === 'manual' ? 'manual' : currentSettings.planningMode || 'route';
    a.href = url;
    a.download = `RobotRoute_${mode}_d${dice.directionDie}_l${dice.leftDie}_r${dice.rightDie}.ino`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// Turn Calibration Dialog Controller in Arena
const routeCalibrateBtn = $('#route-calibrate-btn');
const turnTestDialog = $('#turn-test-dialog');
const turnTestCancelBtn = $('#turn-test-cancel');
const turnTestCloseBtn = $('#turn-test-close-btn');
const modalRouteInfo = $('#modal-route-info');
const modalTrialsContainer = $('#modal-trials-container');
const modalGenerateTestBtn = $('#modal-generate-test-btn');
const modalDownloadTestBtn = $('#modal-download-test-btn');
const modalCopyTestBtn = $('#modal-copy-test-btn');
const modalTestStatus = $('#modal-test-status');
const modalSaveTicksBtn = $('#modal-save-ticks-btn');
const modalToArduinoBtn = $('#modal-to-arduino-btn');
const modalSaveStatus = $('#modal-save-status');

let modalTrials = [];
let modalGeneratedTest = null;

function openTurnTestDialog() {
  if (!currentRoute) return;
  modalTrials = buildTrialsFromRoute(currentRoute, [{ direction: 'right', degrees: 90, label: 'หมุนขวา 90°' }]);
  modalGeneratedTest = null;
  if (modalDownloadTestBtn) modalDownloadTestBtn.disabled = true;
  if (modalCopyTestBtn) modalCopyTestBtn.disabled = true;
  if (modalSaveTicksBtn) modalSaveTicksBtn.disabled = true;
  if (modalTestStatus) modalTestStatus.textContent = '';
  if (modalSaveStatus) modalSaveStatus.textContent = '';

  const dice = readDice();
  if (modalRouteInfo) {
    modalRouteInfo.textContent = `ทิศ ${currentDiceState?.robotDirection ?? 'ล่าง'} · กล่องซ้าย ${dice.leftDie} ช่อง · กล่องขวา ${dice.rightDie} ช่อง (${modalTrials.length} แบบมุมที่ต้องใช้จริง)`;
  }

  renderModalTrials();
  turnTestDialog?.showModal();
}

function renderModalTrials() {
  if (!modalTrialsContainer) return;
  modalTrialsContainer.innerHTML = '';

  modalTrials.forEach((trial, index) => {
    const trialNum = index + 1;
    const targets = turnTargets(currentSettings, trial.direction, trial.degrees);
    const row = document.createElement('div');
    row.style.cssText = 'display: grid; grid-template-columns: minmax(7rem, 1fr) minmax(7rem, 1fr) minmax(11rem, 1.5fr); gap: 0.65rem; align-items: end; background: #18222f; padding: 0.75rem 0.85rem; border-radius: 0.65rem; border: 1px solid var(--border);';
    row.innerHTML = `
      <div>
        <strong style="color: var(--accent); font-size: 0.88rem; display: block;">คำสั่ง ${trialNum} (กด ${trialNum})</strong>
        <span style="font-size: 0.78rem; color: var(--muted);">${trial.label || (trial.direction === 'right' ? 'หมุนขวา' : 'หมุนซ้าย') + ' ' + trial.degrees + '°'}</span>
      </div>
      <label style="display: grid; gap: 0.25rem; font-size: 0.8rem; color: var(--muted);">
        หมุนจริง (°)
        <input class="modal-actual-input" data-modal-trial="${trialNum}" type="number" min="0.1" max="360" step="0.1" inputmode="decimal" placeholder="เช่น 83" style="width: 100%; min-height: 2.3rem; padding: 0.4rem 0.6rem; border-radius: 0.5rem; background: #232e3d; color: var(--ink); border: 1px solid rgba(255,255,255,0.15);">
      </label>
      <output class="modal-trial-output" data-modal-output="${trialNum}" style="font-size: 0.8rem; color: #8ee0ff; align-self: center; line-height: 1.4;">
        สั่ง L ${targets.leftTicks} / R ${targets.rightTicks} ticks
      </output>
    `;

    const input = row.querySelector('.modal-actual-input');
    input.addEventListener('input', () => {
      onModalActualInput(trialNum, trial, targets);
    });

    modalTrialsContainer.appendChild(row);
  });
}

function onModalActualInput(trialNum, trial, targets) {
  const input = modalTrialsContainer.querySelector(`.modal-actual-input[data-modal-trial="${trialNum}"]`);
  const output = modalTrialsContainer.querySelector(`.modal-trial-output[data-modal-output="${trialNum}"]`);
  if (!input || !output) return;

  const val = Number(input.value);
  if (!input.value.trim() || !Number.isFinite(val) || val <= 0) {
    output.textContent = `สั่ง L ${targets.leftTicks} / R ${targets.rightTicks} ticks`;
    checkModalCanSave();
    return;
  }

  try {
    const sug = suggestTurnTicks({
      targetDegrees: trial.degrees,
      actualDegrees: val,
      leftTicks: targets.leftTicks,
      rightTicks: targets.rightTicks,
    });
    output.innerHTML = `จริง ${val}° (คลาด ${sug.errorDegrees > 0 ? '+' : ''}${sug.errorDegrees.toFixed(1)}°) → <strong style="color: #7af3b9;">L ${sug.leftTicks} / R ${sug.rightTicks}</strong>`;
  } catch (err) {
    output.textContent = err.message;
  }
  checkModalCanSave();
}

function checkModalCanSave() {
  const inputs = [...modalTrialsContainer.querySelectorAll('.modal-actual-input')];
  const hasAny = inputs.some((i) => i.value.trim() && Number(i.value) > 0);
  if (modalSaveTicksBtn) modalSaveTicksBtn.disabled = !hasAny;
}

if (routeCalibrateBtn) routeCalibrateBtn.addEventListener('click', openTurnTestDialog);
if (turnTestCancelBtn) turnTestCancelBtn.addEventListener('click', () => turnTestDialog?.close());
if (turnTestCloseBtn) turnTestCloseBtn.addEventListener('click', () => turnTestDialog?.close());

if (modalGenerateTestBtn) {
  modalGenerateTestBtn.addEventListener('click', () => {
    try {
      if (!modalTrials.length) throw new RangeError('ไม่พบมุมเลี้ยวในเส้นทางนี้');
      const trialsWithTargets = modalTrials.map((t) => ({ ...t, ...turnTargets(currentSettings, t.direction, t.degrees) }));
      const code = generateTurnTestCode({ trials: trialsWithTargets, settings: currentSettings });
      modalGeneratedTest = { code, trials: trialsWithTargets };
      if (modalDownloadTestBtn) modalDownloadTestBtn.disabled = false;
      if (modalCopyTestBtn) modalCopyTestBtn.disabled = false;
      if (modalTestStatus) modalTestStatus.textContent = `สร้างโค้ดทดสอบเรียบร้อย: ${modalTrials.length} คำสั่ง (พร้อมส่ง 1-${modalTrials.length} ใน Serial Monitor 115200 baud)`;
    } catch (err) {
      if (modalTestStatus) modalTestStatus.textContent = err.message;
    }
  });
}

if (modalDownloadTestBtn) {
  modalDownloadTestBtn.addEventListener('click', () => {
    if (!modalGeneratedTest) return;
    const url = URL.createObjectURL(new Blob([modalGeneratedTest.code], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'TurnCalibration.ino';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

if (modalCopyTestBtn) {
  modalCopyTestBtn.addEventListener('click', async () => {
    if (!modalGeneratedTest) return;
    try {
      await navigator.clipboard.writeText(modalGeneratedTest.code);
      if (modalTestStatus) modalTestStatus.textContent = '📋 คัดลอกโค้ดทดสอบ TurnCalibration.ino ลง Clipboard แล้ว!';
    } catch {
      if (modalTestStatus) modalTestStatus.textContent = 'คัดลอกไม่สำเร็จ กรุณาใช้ปุ่มดาวน์โหลด';
    }
  });
}

if (modalSaveTicksBtn) {
  modalSaveTicksBtn.addEventListener('click', () => {
    try {
      let next = { ...currentSettings };
      let appliedCount = 0;
      modalTrials.forEach((trial, idx) => {
        const input = modalTrialsContainer.querySelector(`.modal-actual-input[data-modal-trial="${idx + 1}"]`);
        if (!input || !input.value.trim()) return;
        const val = Number(input.value);
        if (!Number.isFinite(val) || val <= 0) return;
        const targets = turnTargets(currentSettings, trial.direction, trial.degrees);
        const sug = suggestTurnTicks({
          targetDegrees: trial.degrees,
          actualDegrees: val,
          leftTicks: targets.leftTicks,
          rightTicks: targets.rightTicks,
        });
        next = applyTurnSuggestion(next, trial.direction, trial.degrees, sug);
        appliedCount++;
      });

      if (!appliedCount) return;
      const validation = validateSettings(next);
      if (!validation.ok) {
        if (modalSaveStatus) modalSaveStatus.textContent = Object.values(validation.errors).join(' · ');
        return;
      }
      currentSettings = saveSettings(localStorage, validation.value);
      recompute();
      renderModalTrials();
      if (modalSaveStatus) modalSaveStatus.textContent = '✅ บันทึก Tick ใหม่สำเร็จ! เส้นทางและโค้ดสนามจริงถูกอัปเดตเรียบร้อย';
      if (modalTestStatus) modalTestStatus.textContent = '⚡ ปรับค่าลง Settings แล้ว กดสร้างโค้ดทดสอบใหม่เพื่อวัดซ้ำได้ทันที';
    } catch (err) {
      if (modalSaveStatus) modalSaveStatus.textContent = err.message;
    }
  });
}

if (modalToArduinoBtn) {
  modalToArduinoBtn.addEventListener('click', () => {
    turnTestDialog?.close();
    openArduinoDialog();
  });
}

const coordHudXY = $('#coord-hud-xy');
const coordHudExtra = $('#coord-hud-extra');
const coordTooltip = $('#coord-hover-tooltip');
const gridToggleBtn = $('#grid-toggle');
let gridVisible = false;

if (gridToggleBtn) {
  gridToggleBtn.addEventListener('click', () => {
    gridVisible = !gridVisible;
    coordGridGroup.visible = gridVisible;
    gridToggleBtn.classList.toggle('active', gridVisible);
    gridToggleBtn.title = gridVisible ? 'ปิดเส้นตารางและป้ายพิกัด' : 'เปิดเส้นตารางและป้ายพิกัด';
  });
}

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const mouseNDC = new THREE.Vector2();

let manualPointer = null;
let draggedWaypointIndex = null;
const activeMapPointers = new Set();

function findNearWaypoint(hitPoint, threshold = 0.22) {
  let closestIndex = -1;
  let closestDist = threshold;
  for (let i = 0; i < manualWaypoints.length; i++) {
    const dist = Math.hypot(hitPoint.x - manualWaypoints[i].x, hitPoint.z - manualWaypoints[i].z);
    if (dist < closestDist) {
      closestDist = dist;
      closestIndex = i;
    }
  }
  return closestIndex;
}

canvas.addEventListener('pointerdown', event => {
  activeMapPointers.add(event.pointerId);
  if (activeMapPointers.size > 1) {
    manualPointer = null;
    draggedWaypointIndex = null;
    return;
  }
  if (routeSource === 'manual' && event.button === 0 && event.isPrimary) {
    const rect = canvas.getBoundingClientRect();
    mouseNDC.set((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(mouseNDC, camera);
    const hitPoint = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
    if (hitPoint) {
      const nearIdx = findNearWaypoint(hitPoint, 0.22);
      if (nearIdx !== -1) {
        draggedWaypointIndex = nearIdx;
        canvas.style.cursor = 'grabbing';
        controls.enabled = false;
        recompute();
        return;
      }
    }
    manualPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
});

canvas.addEventListener('pointercancel', event => {
  activeMapPointers.delete(event.pointerId);
  manualPointer = null;
  if (draggedWaypointIndex !== null) {
    draggedWaypointIndex = null;
    controls.enabled = routeSource !== 'manual';
    recompute();
  }
});

canvas.addEventListener('pointerup', event => {
  activeMapPointers.delete(event.pointerId);
  if (draggedWaypointIndex !== null) {
    draggedWaypointIndex = null;
    canvas.style.cursor = 'crosshair';
    controls.enabled = routeSource !== 'manual';
    recompute();
    return;
  }
  const start = manualPointer;
  manualPointer = null;
  if (routeSource !== 'manual' || !start || start.id !== event.pointerId
      || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
  const rect = canvas.getBoundingClientRect();
  mouseNDC.set((event.clientX - rect.left) / rect.width * 2 - 1,
    -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(mouseNDC, camera);
  const point = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (!point) return;
  const snap = $('#manual-route-snap').checked ? currentSettings.gridSize : 0.01;
  const waypoint = {
    x: Number((Math.round(point.x / snap) * snap).toFixed(4)),
    z: Number((Math.round(point.z / snap) * snap).toFixed(4)),
  };
  manualWaypoints.push(waypoint);
  recompute();
});

canvas.addEventListener('pointermove', (event) => {
  if (manualPointer && Math.hypot(event.clientX - manualPointer.x, event.clientY - manualPointer.y) > 6) {
    manualPointer = null;
  }

  const rect = canvas.getBoundingClientRect();
  mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseNDC, camera);
  const hitPoint = new THREE.Vector3();
  const hasHit = Boolean(raycaster.ray.intersectPlane(groundPlane, hitPoint));

  if (routeSource === 'manual') {
    if (draggedWaypointIndex !== null) {
      if (hasHit) {
        const snap = $('#manual-route-snap').checked ? currentSettings.gridSize : 0.01;
        const halfWidth = ARENA.width / 2;
        const halfDepth = ARENA.depth / 2;
        const clampedX = Math.max(-halfWidth - 0.40, Math.min(halfWidth + 0.40, hitPoint.x));
        const clampedZ = Math.max(-halfDepth - 0.40, Math.min(halfDepth + 1.40, hitPoint.z));
        manualWaypoints[draggedWaypointIndex] = {
          x: Number((Math.round(clampedX / snap) * snap).toFixed(4)),
          z: Number((Math.round(clampedZ / snap) * snap).toFixed(4)),
        };
        recompute();
      }
      return;
    }
    if (hasHit) {
      const nearIdx = findNearWaypoint(hitPoint, 0.22);
      canvas.style.cursor = nearIdx !== -1 ? 'grab' : 'crosshair';
    }
  }

  if (hasHit) {
    const halfWidth = ARENA.width / 2;
    const halfDepth = ARENA.depth / 2;
    // ตรวจสอบว่าอยู่ในบริเวณสนาม รวมพื้นที่เลยช่องออก
    if (hitPoint.x >= -halfWidth - 0.05 && hitPoint.x <= halfWidth + 0.05 && hitPoint.z >= -halfDepth - 0.05 && hitPoint.z <= halfDepth + 0.35) {
      hoverMarkerGroup.position.set(hitPoint.x, 0.015, hitPoint.z);
      hoverMarkerGroup.visible = true;

      // พิกัดสนาม: X จากซ้ายไปขวา
      // พิกัด Y: ระนาบ 2D ของแผนที่ (ด้านบนคือ +, ด้านล่างคือ -, กึ่งกลางสนามคือ 0.00 ม.)
      const coordX = hitPoint.x;
      const coordY = -hitPoint.z;
      const tileCol = Math.min(Math.ceil(ARENA.width / ARENA.tileSize), Math.max(1, Math.floor((coordX + halfWidth) / ARENA.tileSize) + 1));
      const tileRow = Math.min(Math.ceil(ARENA.depth / ARENA.tileSize), Math.max(1, Math.floor((hitPoint.z + halfDepth) / ARENA.tileSize) + 1));

      const isInsideStartZone = Math.abs(coordX - ARENA.robot.x) <= ((ARENA.startZone?.width ?? 0.30) / 2)
        && Math.abs(hitPoint.z - ARENA.robot.z) <= ((ARENA.startZone?.depth ?? 0.30) / 2);
      const zoneBadge = isInsideStartZone ? ' <span style="color:#7af3b9;font-weight:bold;">[ช่องวาง 30×30]</span>' : '';

      const signX = coordX >= 0 ? '+' : '';
      const signY = coordY >= 0 ? '+' : '';
      const textXY = `X: <strong>${signX}${coordX.toFixed(2)}</strong> m | Y: <strong>${signY}${coordY.toFixed(2)}</strong> m${zoneBadge}`;

      if (coordHudXY) coordHudXY.innerHTML = textXY;
      if (coordHudExtra) coordHudExtra.textContent = `(กระเบื้อง: คอลัมน์ ${tileCol}, แถว ${tileRow})`;

      if (coordTooltip) {
        const tooltipBadge = isInsideStartZone ? ' · ช่องวาง 30×30 cm' : '';
        coordTooltip.innerHTML = `📍 X: <strong>${signX}${coordX.toFixed(2)}</strong> m, Y: <strong>${signY}${coordY.toFixed(2)}</strong> m${tooltipBadge}`;
        coordTooltip.style.left = `${event.clientX - rect.left}px`;
        coordTooltip.style.top = `${event.clientY - rect.top}px`;
        coordTooltip.hidden = false;
      }
      return;
    }
  }
  hoverMarkerGroup.visible = false;
  if (coordTooltip) coordTooltip.hidden = true;
  if (coordHudExtra) coordHudExtra.textContent = '(ชี้เมาส์บนสนาม)';
});

canvas.addEventListener('pointerleave', () => {
  manualPointer = null;
  if (draggedWaypointIndex !== null) {
    draggedWaypointIndex = null;
    controls.enabled = routeSource !== 'manual';
    recompute();
  }
  activeMapPointers.clear();
  hoverMarkerGroup.visible = false;
  if (coordTooltip) coordTooltip.hidden = true;
  if (coordHudExtra) coordHudExtra.textContent = '(ชี้เมาส์บนสนาม)';
});

$('#top-view').addEventListener('click', setTopView);
$('#reset-view').addEventListener('click', resetView);
controls.addEventListener('start', () => { currentView = 'custom'; });
new ResizeObserver(resize).observe(canvas);

resetView();
resize();
recompute();
loading?.ready();

function render(timestamp) {
  controls.update();

  timer.update(timestamp);
  const delta = timer.getDelta();
  if (simState === 'playing' && simSteps.length > 0) {
    const dt = Math.min(delta, 0.1) * simSpeed;
    currentStepTime += dt;
    const step = simSteps[currentStepIndex];
    if (step) {
      const progress = Math.min(1, currentStepTime / Math.max(0.01, step.duration));
      if (step.type === 'turn') {
        robot.position.set(step.fromX, 0, step.fromZ);
        robot.rotation.y = THREE.MathUtils.lerp(step.fromRotY, step.toRotY, progress);
      } else {
        const curX = THREE.MathUtils.lerp(step.fromX, step.toX, progress);
        const curZ = THREE.MathUtils.lerp(step.fromZ, step.toZ, progress);
        robot.position.set(curX, 0, curZ);
        robot.rotation.y = step.fromRotY;

        const distThisFrame = (step.distance / step.duration) * dt;
        const wheelSign = step.type === 'reverse' ? -1 : 1;
        const wheelRadius = robot.userData.wheelRadius || 0.05;
        for (const wheel of (robot.userData.wheels || [])) {
          wheel.rotation.x += wheelSign * (distThisFrame / wheelRadius);
        }
      }

      if (simStepDesc) {
        simStepDesc.textContent = `ขั้นตอน ${step.cmdIdx + 1}/${currentRoute?.commands?.length ?? simSteps.length}: ${step.label} (${Math.round(progress * 100)}%)`;
      }

      if (progress >= 1) {
        currentStepIndex++;
        currentStepTime = 0;
        if (currentStepIndex >= simSteps.length) {
          simState = 'finished';
          if (simStepDesc) simStepDesc.textContent = '🎉 หุ่นยนต์เคลื่อนที่ถึงเป้าหมายเรียบร้อยแล้ว!';
          updateSimUI();
        } else {
          updateSimUI();
        }
      }
    }
  }

  renderer.render(scene, camera);
  window.requestAnimationFrame(render);
}

window.requestAnimationFrame(render);
