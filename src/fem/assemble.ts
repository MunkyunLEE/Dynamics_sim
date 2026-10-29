import type { BarSection, Material, StructuralModel } from '../core/model';
import { barMatrices } from './bar';

export const MAX_DENSE_DOF = 1500;

export interface Assembly {
  n: number;
  K: Float64Array;
  M: Float64Array;
  active: Int32Array;
  reduced: Int32Array;
  nodeIndex: Map<number, number>;
  nodeCount: number;
  notes: string[];
}

export function assemble(model: StructuralModel, applySupports: boolean): Assembly {
  const nodeIndex = new Map<number, number>();
  model.nodes.forEach((n, i) => nodeIndex.set(n.id, i));
  const nodeCount = model.nodes.length;
  const total = nodeCount * 6;
  const notes: string[] = [];

  const mats = new Map<string, Material>(model.materials.map((m) => [m.id, m]));
  const secs = new Map(model.sections.map((s) => [s.id, s]));

  const elements: { dofs: number[]; k: Float64Array; m: Float64Array }[] = [];
  const kdiag = new Float64Array(total);
  const mdiag = new Float64Array(total);

  for (const bar of model.bars) {
    const i0 = nodeIndex.get(bar.n[0])!;
    const i1 = nodeIndex.get(bar.n[1])!;
    const mat = mats.get(bar.mat)!;
    const sec = secs.get(bar.sec);
    if (!sec || sec.type !== 'bar') throw new Error(`바 ${bar.id}: 바 단면이 아닙니다.`);
    const em = barMatrices(bar, model.nodes[i0].xyz, model.nodes[i1].xyz, mat, sec as BarSection);
    const dofs: number[] = [];
    for (let d = 0; d < 6; d++) dofs.push(i0 * 6 + d);
    for (let d = 0; d < 6; d++) dofs.push(i1 * 6 + d);
    for (let a = 0; a < 12; a++) {
      kdiag[dofs[a]] += Math.abs(em.k[a * 12 + a]);
      mdiag[dofs[a]] += Math.abs(em.m[a * 12 + a]);
    }
    elements.push({ dofs, k: em.k, m: em.m });
  }

  for (const lump of model.masses) {
    const i = nodeIndex.get(lump.node)!;
    for (let d = 0; d < 3; d++) mdiag[i * 6 + d] += lump.m;
    if (lump.I) for (let d = 0; d < 3; d++) mdiag[i * 6 + 3 + d] += lump.I[d];
  }

  const fixed = new Uint8Array(total);
  if (applySupports) {
    for (const s of model.supports) {
      const i = nodeIndex.get(s.node)!;
      for (let d = 0; d < 6; d++) if (s.dof[d]) fixed[i * 6 + d] = 1;
    }
  }

  let kmax = 0;
  let mmax = 0;
  for (let i = 0; i < total; i++) {
    kmax = Math.max(kmax, kdiag[i]);
    mmax = Math.max(mmax, mdiag[i]);
  }

  const reduced = new Int32Array(total).fill(-1);
  const activeList: number[] = [];
  let inactive = 0;
  for (let i = 0; i < total; i++) {
    if (fixed[i]) continue;
    const alive = kdiag[i] > kmax * 1e-14 || mdiag[i] > mmax * 1e-14;
    if (!alive) {
      inactive++;
      continue;
    }
    reduced[i] = activeList.length;
    activeList.push(i);
  }
  if (inactive > 0) notes.push(`강성/질량이 전혀 없는 자유도 ${inactive}개를 제외했습니다 (핀 접합만 연결된 절점의 회전 등).`);

  const n = activeList.length;
  if (n > MAX_DENSE_DOF) {
    throw new Error(`자유도 ${n}개: 현재 밀집행렬 솔버의 한계(${MAX_DENSE_DOF})를 넘습니다. 희소 솔버 단계에서 확장 예정입니다.`);
  }

  const K = new Float64Array(n * n);
  const M = new Float64Array(n * n);
  for (const el of elements) {
    for (let a = 0; a < 12; a++) {
      const ra = reduced[el.dofs[a]];
      if (ra < 0) continue;
      for (let b = 0; b < 12; b++) {
        const rb = reduced[el.dofs[b]];
        if (rb < 0) continue;
        K[ra * n + rb] += el.k[a * 12 + b];
        M[ra * n + rb] += el.m[a * 12 + b];
      }
    }
  }
  for (const lump of model.masses) {
    const i = nodeIndex.get(lump.node)!;
    for (let d = 0; d < 3; d++) {
      const r = reduced[i * 6 + d];
      if (r >= 0) M[r * n + r] += lump.m;
    }
    if (lump.I) {
      for (let d = 0; d < 3; d++) {
        const r = reduced[i * 6 + 3 + d];
        if (r >= 0) M[r * n + r] += lump.I[d];
      }
    }
  }

  return { n, K, M, active: Int32Array.from(activeList), reduced, nodeIndex, nodeCount, notes };
}
