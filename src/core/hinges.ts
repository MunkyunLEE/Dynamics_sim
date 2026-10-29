import type { HingeDef, HingeType, PanelDef, StructuralModel } from './model';

export interface HingeCandidate {
  panels: [string, string];
  edge: [number, number];
}

export const HINGE_LABEL: Record<HingeType, string> = {
  free: '회전 (접힘)',
  spring: '회전 스프링',
  rigid: '잠금 (강접)',
  none: '분리'
};

const key = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);

export function boundaryEdges(panel: PanelDef): Map<string, [number, number]> {
  const count = new Map<string, number>();
  const dir = new Map<string, [number, number]>();
  for (const t of panel.tris) {
    for (let k = 0; k < 3; k++) {
      const a = t[k];
      const b = t[(k + 1) % 3];
      const kk = key(a, b);
      count.set(kk, (count.get(kk) ?? 0) + 1);
      dir.set(kk, [a, b]);
    }
  }
  const out = new Map<string, [number, number]>();
  for (const [kk, c] of count) if (c === 1) out.set(kk, dir.get(kk)!);
  return out;
}

export function detectHingeCandidates(model: StructuralModel, onlyPanels?: Set<string>): HingeCandidate[] {
  const owners = new Map<string, { panel: string; edge: [number, number] }[]>();
  for (const p of model.panels) {
    if (onlyPanels && !onlyPanels.has(p.id)) continue;
    for (const [kk, e] of boundaryEdges(p)) {
      const list = owners.get(kk) ?? [];
      list.push({ panel: p.id, edge: e });
      owners.set(kk, list);
    }
  }
  const out: HingeCandidate[] = [];
  for (const list of owners.values()) {
    if (list.length !== 2 || list[0].panel === list[1].panel) continue;
    out.push({ panels: [list[0].panel, list[1].panel], edge: list[0].edge });
  }
  return out;
}

export function hingeKey(h: { edge?: [number, number]; panels: [string, string] }): string {
  const pk = [...h.panels].sort().join('|');
  return h.edge ? `${pk}#${key(h.edge[0], h.edge[1])}` : pk;
}

export function createHinges(model: StructuralModel, cands: HingeCandidate[], type: HingeType): number {
  const existing = new Set(model.hinges.map(hingeKey));
  let n = 1;
  const ids = new Set(model.hinges.map((h) => h.id));
  let added = 0;
  for (const c of cands) {
    const hk = hingeKey(c);
    if (existing.has(hk)) continue;
    while (ids.has(`H${n}`)) n++;
    const h: HingeDef = { id: `H${n}`, panels: [...c.panels] as [string, string], type, edge: [...c.edge] as [number, number] };
    ids.add(h.id);
    existing.add(hk);
    model.hinges.push(h);
    added++;
  }
  return added;
}

export function setHingeType(model: StructuralModel, idx: Iterable<number>, type: HingeType, ktheta?: number): void {
  for (const i of idx) {
    const h = model.hinges[i];
    h.type = type;
    if (type === 'spring') h.ktheta = ktheta ?? h.ktheta ?? 0;
    else delete h.ktheta;
  }
}

export function removeHinges(model: StructuralModel, idx: Iterable<number>): void {
  const drop = new Set(idx);
  const removed = new Set(model.hinges.filter((_, i) => drop.has(i)).map((h) => h.id));
  model.hinges = model.hinges.filter((_, i) => !drop.has(i));
  if (model.kinematics) model.kinematics.drivers = model.kinematics.drivers.filter((d) => !removed.has(d.hinge));
}

export function resolveHingeEdge(model: StructuralModel, h: HingeDef): [number, number] | null {
  if (h.edge) return h.edge;
  const c = detectHingeCandidates(model, new Set(h.panels)).find(
    (q) => (q.panels[0] === h.panels[0] && q.panels[1] === h.panels[1]) || (q.panels[0] === h.panels[1] && q.panels[1] === h.panels[0])
  );
  return c ? c.edge : null;
}
