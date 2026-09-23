import { buildCommands } from './path-planner.js?v=20';

// โหมดวางเส้นทางเอง (Manual Waypoints):
// ปรับได้อย่างอิสระ ไม่จำกัดหรือบล็อกด้วยระยะห่างกล่องหรือกำแพง เพื่อให้ผู้ใช้กำหนดแนวเดินรถได้ตามสถานการณ์จริง
export function buildManualRoute({ arena, diceState, settings, waypoints }) {
  const points = [{ ...arena.robot }, ...waypoints.map(point => ({ ...point }))];
  const halfWidth = arena.width / 2;
  const halfDepth = arena.depth / 2;
  const safeRadius = Number(settings?.safeRadius ?? 0.15);
  const exitClearance = Number(settings?.exitClearance ?? 0.04);

  const base = {
    goalType: 'manual',
    usedFallback: false,
    safeRadius,
    exitClearance,
    points,
    commands: [],
    segments: [],
    totalDistance: 0,
    turnCount: 0,
    estimatedSeconds: 0,
  };
  const invalid = reason => ({ ...base, status: 'no_path', reason });

  if (!waypoints.length) {
    return { ...base, status: 'empty', reason: 'คลิกหรือลากบนสนามเพื่อวางจุดแรก เส้นทางจะเริ่มจากรถ' };
  }

  // ขอบเขตที่ยอมรับ: ครอบคลุมทั่วทั้งสนาม และพื้นที่รอบนอกทางออก เผื่อระยะวางได้กว้างขวาง
  const minX = -halfWidth - 0.50;
  const maxX = halfWidth + 0.50;
  const minZ = -halfDepth - 0.50;
  const maxZ = halfDepth + 1.50;

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (!Number.isFinite(to.x) || !Number.isFinite(to.z)
        || to.x < minX || to.x > maxX
        || to.z < minZ || to.z > maxZ) {
      return invalid(`จุดที่ ${i} อยู่นอกพื้นที่สนาม`);
    }
    // กันเฉพาะกรณีคลิกซ้ำพิกัดเดียวกันเป๊ะ (< 1 มม.)
    if (Math.hypot(to.x - from.x, to.z - from.z) < 0.001) {
      return invalid(`จุดที่ ${i} ซ้ำกับจุดก่อนหน้า`);
    }
  }

  const built = buildCommands(points, diceState.robotDirection, settings);

  return {
    ...base,
    ...built,
    status: 'found',
    reason: `เส้นทางวางเอง ${waypoints.length} จุด (โหมดอิสระ ไม่จำกัดระยะกล่อง/กำแพง)`,
  };
}
