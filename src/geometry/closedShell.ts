import type { StructuralModel } from '../core/model';
import { nodeIndexMap } from '../core/selection';

export interface ShellCheck {
  triangles: number;
  vertices: number;
  openEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  closed: boolean;
  consistent: boolean;
  volume: number;
  area: number;
}

export function checkClosedShell(model: StructuralModel, panelIdx: number): ShellCheck {
  const panel = model.panels[panelIdx];
  const map = nodeIndexMap(model);
  const edges = new Map<string, number[]>();
  const verts = new Set<number>();

  for (const t of panel.tris) {
    for (let k = 0; k < 3; k++) {
      const a = t[k];
      const b = t[(k + 1) % 3];
      verts.add(a);
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const list = edges.get(key) ?? [];
      list.push(a < b ? 1 : -1);
      edges.set(key, list);
    }
  }

  let open = 0;
  let nonManifold = 0;
  let inconsistent = 0;
  for (const dirs of edges.values()) {
    if (dirs.length === 1) open++;
    else if (dirs.length > 2) nonManifold++;
    else if (dirs[0] === dirs[1]) inconsistent++;
  }

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const id of verts) {
    const p = model.nodes[map.get(id)!].xyz;
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const nv = Math.max(verts.size, 1);
  cx /= nv;
  cy /= nv;
  cz /= nv;

  let volume = 0;
  let area = 0;
  for (const t of panel.tris) {
    const [a, b, c] = t.map((id) => {
      const p = model.nodes[map.get(id)!].xyz;
      return [p[0] - cx, p[1] - cy, p[2] - cz];
    });
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }

  return {
    triangles: panel.tris.length,
    vertices: verts.size,
    openEdges: open,
    nonManifoldEdges: nonManifold,
    inconsistentEdges: inconsistent,
    closed: open === 0 && nonManifold === 0 && panel.tris.length > 0,
    consistent: inconsistent === 0,
    volume,
    area
  };
}
