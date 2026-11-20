export type GraphPoint = { x: number; y: number };

export const GRAPH_WIDTH = 1100;
export const GRAPH_HEIGHT = 720;
export const GRAPH_CENTER = { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
const MARGIN = 40;

const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

/** Deterministic, bounded Fruchterman–Reingold layout with gravity. */
export function graphForceLayout(nodes: string[], edges: Array<[string, string]>, focus: string | null, depth: Map<string, number>): Map<string, GraphPoint> {
  const positions = new Map<string, GraphPoint>();
  nodes.forEach((id, index) => {
    const random = hash(id);
    if (id === focus) { positions.set(id, { ...GRAPH_CENTER }); return; }
    const ring = focus ? depth.get(id) ?? 2 : 0;
    const angle = focus ? (index / Math.max(1, nodes.length)) * Math.PI * 2 + (random % 100) / 400 : ((random % 3600) / 3600) * Math.PI * 2;
    const radius = focus ? 110 * ring + (random % 30) : 40 + ((random >>> 12) % 240);
    positions.set(id, { x: GRAPH_CENTER.x + Math.cos(angle) * radius, y: GRAPH_CENTER.y + Math.sin(angle) * radius });
  });
  if (nodes.length < 2) return positions;
  const k = Math.min(110, Math.sqrt(((GRAPH_WIDTH - 2 * MARGIN) * (GRAPH_HEIGHT - 2 * MARGIN)) / nodes.length) * 0.75);
  const steps = 220;
  for (let step = 0; step < steps; step += 1) {
    const temperature = 45 * (1 - step / steps) + 1;
    const shift = new Map(nodes.map((id) => [id, { x: 0, y: 0 }]));
    for (let left = 0; left < nodes.length; left += 1) {
      const a = positions.get(nodes[left])!;
      for (let right = left + 1; right < nodes.length; right += 1) {
        const b = positions.get(nodes[right])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) { dx = 0.01 * ((left % 3) - 1 || 1); dy = 0.01; distance = 0.015; }
        const force = (k * k) / distance;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        const sa = shift.get(nodes[left])!;
        const sb = shift.get(nodes[right])!;
        sa.x += fx; sa.y += fy; sb.x -= fx; sb.y -= fy;
      }
    }
    for (const [source, target] of edges) {
      const a = positions.get(source)!;
      const b = positions.get(target)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const force = (distance * distance) / k;
      const sa = shift.get(source)!;
      const sb = shift.get(target)!;
      sa.x -= (dx / distance) * force; sa.y -= (dy / distance) * force;
      sb.x += (dx / distance) * force; sb.y += (dy / distance) * force;
    }
    for (const id of nodes) {
      if (id === focus) continue;
      const point = positions.get(id)!;
      const move = shift.get(id)!;
      move.x += (GRAPH_CENTER.x - point.x) * 0.04 * k / 60;
      move.y += (GRAPH_CENTER.y - point.y) * 0.04 * k / 60;
      const length = Math.max(0.01, Math.hypot(move.x, move.y));
      const limited = Math.min(length, temperature);
      point.x = Math.min(GRAPH_WIDTH - MARGIN, Math.max(MARGIN, point.x + (move.x / length) * limited));
      point.y = Math.min(GRAPH_HEIGHT - MARGIN, Math.max(MARGIN, point.y + (move.y / length) * limited));
    }
  }
  return positions;
}
