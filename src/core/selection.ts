import type { StructuralModel, Vec3 } from './model';

export interface Selection {
  nodes: Set<number>;
  bars: Set<number>;
  panels: Set<number>;
}

export function emptySelection(): Selection {
  return { nodes: new Set(), bars: new Set(), panels: new Set() };
}

export function isEmptySelection(sel: Selection): boolean {
  return sel.nodes.size === 0 && sel.bars.size === 0 && sel.panels.size === 0;
}

export function nodeIndexMap(model: StructuralModel): Map<number, number> {
  return new Map(model.nodes.map((n, i) => [n.id, i]));
}

export function barEnds(model: StructuralModel, map: Map<number, number>, bi: number): [Vec3, Vec3] {
  const b = model.bars[bi];
  return [model.nodes[map.get(b.n[0])!].xyz, model.nodes[map.get(b.n[1])!].xyz];
}

function tolerance(model: StructuralModel): number {
  let min = Infinity;
  let max = -Infinity;
  for (const n of model.nodes) {
    min = Math.min(min, n.xyz[2]);
    max = Math.max(max, n.xyz[2]);
  }
  return Math.max(1, (max - min) * 1e-6);
}

export function sameLevelBars(model: StructuralModel, from: Iterable<number>): Set<number> {
  const map = nodeIndexMap(model);
  const tol = tolerance(model);
  const ranges: [number, number][] = [];
  for (const bi of from) {
    const [a, b] = barEnds(model, map, bi);
    ranges.push([Math.min(a[2], b[2]), Math.max(a[2], b[2])]);
  }
  const out = new Set<number>();
  model.bars.forEach((_, bi) => {
    const [a, b] = barEnds(model, map, bi);
    const lo = Math.min(a[2], b[2]);
    const hi = Math.max(a[2], b[2]);
    if (ranges.some((r) => Math.abs(r[0] - lo) < tol && Math.abs(r[1] - hi) < tol)) out.add(bi);
  });
  return out;
}

export function sameSectionBars(model: StructuralModel, from: Iterable<number>): Set<number> {
  const ids = new Set<string>();
  for (const bi of from) ids.add(model.bars[bi].sec);
  const out = new Set<number>();
  model.bars.forEach((b, bi) => {
    if (ids.has(b.sec)) out.add(bi);
  });
  return out;
}

export function barsWithSection(model: StructuralModel, secId: string): Set<number> {
  const out = new Set<number>();
  model.bars.forEach((b, bi) => {
    if (b.sec === secId) out.add(bi);
  });
  return out;
}

export function sameHeightNodes(model: StructuralModel, from: Iterable<number>): Set<number> {
  const tol = tolerance(model);
  const zs: number[] = [];
  for (const ni of from) zs.push(model.nodes[ni].xyz[2]);
  const out = new Set<number>();
  model.nodes.forEach((n, ni) => {
    if (zs.some((z) => Math.abs(z - n.xyz[2]) < tol)) out.add(ni);
  });
  return out;
}
