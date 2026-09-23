import { safeRadiusFor } from './arena-state.js';

function descriptor(id, kind, start, end, valueMetres, label = `${valueMetres.toFixed(2)} m`, options = {}) {
  return { id, kind, start, end, valueMetres, label, ...options };
}

export function buildMeasurementDescriptors({ arena, diceState, settings, route }) {
  const halfWidth = arena.width / 2;
  const halfDepth = arena.depth / 2;
  const left = diceState.leftBoxX;
  const right = diceState.rightBoxX;
  const leftBox = arena.leftBox;
  const rightBox = arena.rightBox;
  const robot = arena.robot;
  const rotation = Number(diceState.robotRotationY ?? 0);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const robotPoint = (localX, localZ) => ({
    x: robot.x + localX * cos + localZ * sin,
    z: robot.z - localX * sin + localZ * cos,
  });
  const safeRadius = safeRadiusFor(settings);
  const startZone = arena.startZone;
  const startLeft = startZone.x - startZone.width / 2;
  const startRight = startZone.x + startZone.width / 2;
  const startTop = startZone.z - startZone.depth / 2;
  const startBottom = startZone.z + startZone.depth / 2;
  const measurements = [
    descriptor('arena-width', 'field', { x: -halfWidth, z: -halfDepth - 0.18 }, { x: halfWidth, z: -halfDepth - 0.18 }, arena.width),
    descriptor('arena-length', 'field', { x: halfWidth + 0.18, z: -halfDepth }, { x: halfWidth + 0.18, z: halfDepth }, arena.depth),
    descriptor('exit-width', 'exit', { x: -halfWidth, z: halfDepth + 0.12 }, { x: -halfWidth + arena.exitWidth, z: halfDepth + 0.12 }, arena.exitWidth),
    descriptor('bonus-width', 'bonus', { x: -halfWidth, z: halfDepth + 0.23 }, { x: -halfWidth + arena.bonusWidth, z: halfDepth + 0.23 }, arena.bonusWidth),
    descriptor('start-zone-width', 'start', { x: startLeft, z: startBottom + 0.05 }, { x: startRight, z: startBottom + 0.05 }, startZone.width, 'ช่องวาง 0.30 m'),
    descriptor('start-zone-depth', 'start', { x: startLeft - 0.05, z: startTop }, { x: startLeft - 0.05, z: startBottom }, startZone.depth, 'ช่องวาง 0.30 m'),
    descriptor('start-top-offset', 'start-offset', { x: startLeft - 0.12, z: -halfDepth }, { x: startLeft - 0.12, z: startTop }, startZone.topOffset, 'ขอบบน 0.35 m'),
    descriptor('start-right-offset', 'start-offset', { x: startRight, z: startTop - 0.08 }, { x: halfWidth, z: startTop - 0.08 }, startZone.rightOffset, 'ขอบขวา 0.30 m'),
    descriptor('left-box-width', 'obstacle', { x: left - leftBox.width / 2, z: leftBox.z - leftBox.depth / 2 - 0.08 }, { x: left + leftBox.width / 2, z: leftBox.z - leftBox.depth / 2 - 0.08 }, leftBox.width),
    descriptor('left-box-depth', 'obstacle', { x: left + leftBox.width / 2 + 0.08, z: leftBox.z - leftBox.depth / 2 }, { x: left + leftBox.width / 2 + 0.08, z: leftBox.z + leftBox.depth / 2 }, leftBox.depth),
    descriptor('right-box-width', 'obstacle', { x: right - rightBox.width / 2, z: rightBox.z - rightBox.depth / 2 - 0.08 }, { x: right + rightBox.width / 2, z: rightBox.z - rightBox.depth / 2 - 0.08 }, rightBox.width),
    descriptor('right-box-depth', 'obstacle', { x: right - rightBox.width / 2 - 0.08, z: rightBox.z - rightBox.depth / 2 }, { x: right - rightBox.width / 2 - 0.08, z: rightBox.z + rightBox.depth / 2 }, rightBox.depth),
    descriptor('left-shift', 'shift', { x: leftBox.originX, z: leftBox.z + leftBox.depth / 2 + 0.10 }, { x: left, z: leftBox.z + leftBox.depth / 2 + 0.10 }, diceState.leftShiftMetres),
    descriptor('right-shift', 'shift', { x: rightBox.originX, z: rightBox.z + rightBox.depth / 2 + 0.10 }, { x: right, z: rightBox.z + rightBox.depth / 2 + 0.10 }, diceState.rightShiftMetres),
    descriptor('robot-width', 'robot', robotPoint(-settings.width / 2, settings.length / 2 + 0.08), robotPoint(settings.width / 2, settings.length / 2 + 0.08), settings.width),
    descriptor('robot-length', 'robot', robotPoint(settings.width / 2 + 0.08, -settings.length / 2), robotPoint(settings.width / 2 + 0.08, settings.length / 2), settings.length),
    descriptor('safe-radius', 'safety', robotPoint(0, 0), robotPoint(0, safeRadius), safeRadius, `R ${safeRadius.toFixed(2)} m`, { labelRatio: 0.82, labelOffset: 0.07 }),
  ];

  for (const [index, segment] of (route?.segments ?? []).entries()) {
    measurements.push(descriptor(`route-${index}`, 'route', segment.from, segment.to, segment.distance));
  }
  return measurements;
}

const LAYER_COLORS = Object.freeze({
  field: 0x9fb0c3,
  exit: 0x65d6aa,
  bonus: 0x7af3b9,
  obstacle: 0xffb27e,
  shift: 0xffdf77,
  start: 0x38bdf8,
  'start-offset': 0x7af3b9,
  robot: 0x79dcff,
  safety: 0xb89cff,
  route: 0xffffff,
});

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

export class MeasurementLayer {
  constructor({ THREE, scene, createLabel }) {
    this.THREE = THREE;
    this.scene = scene;
    this.createLabel = createLabel;
    this.group = new THREE.Group();
    this.group.name = 'measurement-layer';
    scene.add(this.group);
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeObject(child);
    }
  }

  update(descriptors) {
    this.clear();
    const { THREE } = this;
    for (const item of descriptors) {
      const color = LAYER_COLORS[item.kind] ?? 0xffffff;
      const dx = item.end.x - item.start.x;
      const dz = item.end.z - item.start.z;
      const length = Math.hypot(dx, dz);
      if (length <= 1e-9) continue;
      const px = -dz / length;
      const pz = dx / length;
      const tick = 0.035;
      const points = [
        new THREE.Vector3(item.start.x, 0.055, item.start.z),
        new THREE.Vector3(item.end.x, 0.055, item.end.z),
        new THREE.Vector3(item.start.x - px * tick, 0.055, item.start.z - pz * tick),
        new THREE.Vector3(item.start.x + px * tick, 0.055, item.start.z + pz * tick),
        new THREE.Vector3(item.end.x - px * tick, 0.055, item.end.z - pz * tick),
        new THREE.Vector3(item.end.x + px * tick, 0.055, item.end.z + pz * tick),
      ];
      const line = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.92, depthTest: false }),
      );
      line.renderOrder = 7;
      this.group.add(line);

      const label = this.createLabel(
        item.label,
        new THREE.Vector3(
          item.start.x + dx * (item.labelRatio ?? 0.5) + px * (item.labelOffset ?? 0),
          0.16,
          item.start.z + dz * (item.labelRatio ?? 0.5) + pz * (item.labelOffset ?? 0),
        ),
        `#${color.toString(16).padStart(6, '0')}`,
        this.group,
      );
      label.scale.set(0.44, 0.11, 1);
      if (label.parent !== this.group) this.group.add(label);
    }
  }

  setVisible(visible) {
    this.group.visible = Boolean(visible);
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}
