import type { StructuralModel } from '../core/model';
import { assemble } from '../fem/assemble';
import { backSolveVec, cholesky, standardForm, symmetricEigen } from '../fem/linalg';

export interface ModalOptions {
  type: 'free' | 'constrained';
  nModes: number;
}

export interface ModalResult {
  type: 'free' | 'constrained';
  nDof: number;
  freqs: number[];
  zero: boolean[];
  shapes: Float64Array[];
  effMass: [number, number, number][];
  notes: string[];
}

function factorMass(M: Float64Array, n: number, notes: string[]): Float64Array {
  const L = new Float64Array(M);
  if (cholesky(L, n)) return L;
  let maxDiag = 0;
  for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, M[i * n + i]);
  const L2 = new Float64Array(M);
  for (let i = 0; i < n; i++) L2[i * n + i] += 1e-9 * maxDiag;
  if (!cholesky(L2, n)) throw new Error('질량행렬이 양정치가 아닙니다. 재료 밀도와 집중질량을 확인해 주세요.');
  notes.push('질량이 없는 자유도에 미소 질량을 더해 계산했습니다.');
  return L2;
}

export function solveModal(model: StructuralModel, options: ModalOptions): ModalResult {
  if (model.bars.length === 0) throw new Error('바 요소가 없습니다. 현재 단계에서는 바 요소만 해석합니다.');
  const constrained = options.type === 'constrained';
  if (constrained && model.supports.length === 0) throw new Error('지점이 없습니다. Free-free 해석을 선택하거나 지점을 추가해 주세요.');

  const asm = assemble(model, constrained);
  const n = asm.n;
  if (n === 0) throw new Error('해석할 자유도가 없습니다.');
  const notes = [...asm.notes];
  if (model.panels.length > 0) notes.push('쉘 패널은 아직 해석에 포함되지 않습니다 (바 요소만 해석).');

  const L = factorMass(asm.M, n, notes);
  const A = standardForm(asm.K, L, n);
  const { values, vectors } = symmetricEigen(A, n);

  const lamMax = Math.max(values[n - 1], 0);
  const count = Math.min(options.nModes, n);
  const freqs: number[] = [];
  const zero: boolean[] = [];
  const shapes: Float64Array[] = [];
  const effMass: [number, number, number][] = [];

  const Mr: Float64Array[] = [0, 1, 2].map((dir) => {
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) if (asm.active[i] % 6 === dir) r[i] = 1;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += asm.M[i * n + j] * r[j];
      out[i] = s;
    }
    return out;
  });
  const totals = [0, 1, 2].map((dir) => {
    let s = 0;
    for (let i = 0; i < n; i++) if (asm.active[i] % 6 === dir) s += Mr[dir][i];
    return s;
  });

  for (let mIdx = 0; mIdx < count; mIdx++) {
    const lam = values[mIdx];
    zero.push(lam < 1e-12 * lamMax);
    freqs.push(Math.sqrt(Math.max(lam, 0)) / (2 * Math.PI));

    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = vectors[i * n + mIdx];
    const phi = backSolveVec(L, y, n);

    const shape = new Float64Array(asm.nodeCount * 3);
    let peak = 0;
    for (let node = 0; node < asm.nodeCount; node++) {
      for (let d = 0; d < 3; d++) {
        const r = asm.reduced[node * 6 + d];
        shape[node * 3 + d] = r >= 0 ? phi[r] : 0;
      }
      peak = Math.max(peak, Math.hypot(shape[node * 3], shape[node * 3 + 1], shape[node * 3 + 2]));
    }
    if (peak > 0) for (let i = 0; i < shape.length; i++) shape[i] /= peak;
    shapes.push(shape);

    const eff: [number, number, number] = [0, 0, 0];
    for (let dir = 0; dir < 3; dir++) {
      let gamma = 0;
      for (let i = 0; i < n; i++) gamma += phi[i] * Mr[dir][i];
      eff[dir] = totals[dir] > 0 ? (gamma * gamma) / totals[dir] : 0;
    }
    effMass.push(eff);
  }

  return { type: options.type, nDof: n, freqs, zero, shapes, effMass, notes };
}
