import type { StructuralModel } from '../core/model';
import { assemble } from '../fem/assemble';
import { backSolveVec, solveDense, standardForm, symmetricEigen } from '../fem/linalg';
import { factorMass } from './eigen';
import { sdofPiecewise } from './dsp';

type Triple = [Float64Array, Float64Array, Float64Array];

export interface MotionInput {
  dt: number;
  acc: Triple;
}

export interface TimeHistoryOptions {
  nModes: number;
  massTarget: number;
}

export interface Channel {
  nodeId: number;
  dir: 0 | 1 | 2;
  acc: Float64Array;
  vel: Float64Array;
  disp: Float64Array;
  velAbs: Float64Array;
  dispAbs: Float64Array;
}

export interface TimeHistoryResult {
  dt: number;
  n: number;
  inputNodes: number[];
  inputAcc: Triple;
  inputVel: Triple;
  inputDisp: Triple;
  channels: Channel[];
  freqs: number[];
  xi: number[];
  cumMass: [number, number, number][];
  usedModes: number;
  totalModes: number;
  notes: string[];
}

function cumTrapz(x: Float64Array, dt: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 1; i < x.length; i++) out[i] = out[i - 1] + 0.5 * (x[i] + x[i - 1]) * dt;
  return out;
}

function removeMean(x: Float64Array): Float64Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= x.length || 1;
  return x.map((v) => v - m);
}

function groundKinematics(acc: Float64Array, dt: number): { v: Float64Array; d: Float64Array } {
  const v = removeMean(cumTrapz(removeMean(acc), dt));
  return { v, d: cumTrapz(v, dt) };
}

export function solveTimeHistory(model: StructuralModel, input: MotionInput, options: TimeHistoryOptions): TimeHistoryResult {
  if (model.bars.length === 0) throw new Error('바 요소가 없습니다. 현재 단계에서는 바 요소만 해석합니다.');
  const inputIds = model.inputNodes ?? [];
  const outputIds = model.outputNodes ?? [];
  if (inputIds.length === 0) throw new Error('입력 절점이 없습니다. 절점을 선택해 우클릭 → 입력 절점으로 지정해 주세요.');
  if (outputIds.length === 0) throw new Error('출력 절점이 없습니다. 절점을 선택해 우클릭 → 출력 절점으로 지정해 주세요.');
  const n = input.acc[0].length;
  if (n < 2) throw new Error('입력 가속도 데이터가 너무 짧습니다.');

  const asm = assemble(model, false);
  const total = asm.nodeCount * 6;
  const notes = [...asm.notes];
  if (model.panels.length > 0) notes.push('쉘 패널은 아직 해석에 포함되지 않습니다 (바 요소만 해석).');

  const inputSet = new Set(inputIds);
  const status = new Uint8Array(total);
  for (const s of model.supports) {
    const ni = asm.nodeIndex.get(s.node)!;
    for (let d = 0; d < 6; d++) if (s.dof[d]) status[ni * 6 + d] = 1;
  }
  for (const id of inputSet) {
    const ni = asm.nodeIndex.get(id)!;
    for (let d = 0; d < 3; d++) status[ni * 6 + d] = 2;
  }

  const freeIdx: number[] = [];
  const drivenIdx: number[] = [];
  const drivenDir: number[] = [];
  const freePos = new Int32Array(total).fill(-1);
  for (let r = 0; r < asm.n; r++) {
    const g = asm.active[r];
    if (status[g] === 0) {
      freePos[g] = freeIdx.length;
      freeIdx.push(r);
    } else if (status[g] === 2) {
      drivenIdx.push(r);
      drivenDir.push(g % 6);
    }
  }
  const nf = freeIdx.length;
  if (nf === 0) throw new Error('해석할 자유도가 없습니다.');
  if (drivenIdx.length === 0) throw new Error('입력 절점에 활성 자유도가 없습니다.');

  const N = asm.n;
  const Kff = new Float64Array(nf * nf);
  const Mff = new Float64Array(nf * nf);
  for (let i = 0; i < nf; i++) {
    for (let j = 0; j < nf; j++) {
      Kff[i * nf + j] = asm.K[freeIdx[i] * N + freeIdx[j]];
      Mff[i * nf + j] = asm.M[freeIdx[i] * N + freeIdx[j]];
    }
  }
  const rhsK = new Float64Array(nf * 3);
  const rhsM = new Float64Array(nf * 3);
  for (let i = 0; i < nf; i++) {
    for (let j = 0; j < drivenIdx.length; j++) {
      const dir = drivenDir[j];
      rhsK[i * 3 + dir] += asm.K[freeIdx[i] * N + drivenIdx[j]];
      rhsM[i * 3 + dir] += asm.M[freeIdx[i] * N + drivenIdx[j]];
    }
  }

  const negK = rhsK.map((v) => -v);
  const rInf = solveDense(Kff, negK, nf, 3);
  let resid = 0;
  let scale = 0;
  for (let i = 0; i < nf; i++) {
    for (let d = 0; d < 3; d++) {
      let s = -negK[i * 3 + d];
      for (let j = 0; j < nf; j++) s += Kff[i * nf + j] * rInf[j * 3 + d];
      resid = Math.max(resid, Math.abs(s));
      scale = Math.max(scale, Math.abs(negK[i * 3 + d]));
    }
  }
  if (!Number.isFinite(resid) || resid > 1e-6 * (scale || 1)) {
    throw new Error('구조가 입력 절점 이외의 지점으로 충분히 구속되지 않았습니다 (기구 또는 분리된 부분이 있습니다).');
  }

  const P = new Float64Array(nf * 3);
  for (let i = 0; i < nf; i++) {
    for (let d = 0; d < 3; d++) {
      let s = rhsM[i * 3 + d];
      for (let j = 0; j < nf; j++) s += Mff[i * nf + j] * rInf[j * 3 + d];
      P[i * 3 + d] = -s;
    }
  }

  const L = factorMass(Mff, nf, notes);
  const A = standardForm(Kff, L, nf);
  const { values, vectors } = symmetricEigen(A, nf);
  const lamMax = Math.max(values[nf - 1], 0);

  const excited = [0, 1, 2].map((d) => input.acc[d].some((v) => v !== 0));
  const modes: { omega: number; phi: Float64Array; gamma: [number, number, number] }[] = [];
  const totalMass = [0, 0, 0];
  for (let m = 0; m < nf; m++) {
    if (values[m] < 1e-12 * lamMax) continue;
    const y = new Float64Array(nf);
    for (let i = 0; i < nf; i++) y[i] = vectors[i * nf + m];
    const phi = backSolveVec(L, y, nf);
    const gamma: [number, number, number] = [0, 0, 0];
    for (let d = 0; d < 3; d++) {
      let g = 0;
      for (let i = 0; i < nf; i++) g += phi[i] * P[i * 3 + d];
      gamma[d] = g;
      totalMass[d] += g * g;
    }
    modes.push({ omega: Math.sqrt(values[m]), phi, gamma });
  }
  if (modes.length === 0) throw new Error('유효한 모드가 없습니다.');

  const cum: [number, number, number][] = [];
  let used = 0;
  const run = [0, 0, 0];
  for (let m = 0; m < modes.length; m++) {
    for (let d = 0; d < 3; d++) run[d] += totalMass[d] > 0 ? (modes[m].gamma[d] ** 2) / totalMass[d] : 0;
    cum.push([run[0], run[1], run[2]]);
    used = m + 1;
    const ok = [0, 1, 2].every((d) => !excited[d] || run[d] >= options.massTarget);
    if (ok && used >= 1) break;
    if (used >= options.nModes) break;
  }
  const reached = [0, 1, 2].filter((d) => excited[d]).map((d) => cum[used - 1][d]);
  if (reached.some((v) => v < options.massTarget)) {
    notes.push(`모드 ${used}개로 유효질량 ${(Math.min(...reached) * 100).toFixed(1)}% 까지만 포함되었습니다. 모드 수 상한을 늘려 주세요.`);
  }

  const damping = model.damping;
  const xis: number[] = [];
  const modal = modes.slice(0, used).map((md) => {
    let xi = damping.xi;
    if (damping.mode === 'rayleigh' && damping.rayleigh) xi = 0.5 * (damping.rayleigh.alpha / md.omega + damping.rayleigh.beta * md.omega);
    xis.push(xi);
    const force = new Float64Array(n);
    for (let d = 0; d < 3; d++) {
      if (!excited[d] || md.gamma[d] === 0) continue;
      const a = input.acc[d];
      for (let i = 0; i < n; i++) force[i] += md.gamma[d] * a[i];
    }
    return sdofPiecewise(force, input.dt, md.omega, xi);
  });

  const gk = [0, 1, 2].map((d) => groundKinematics(input.acc[d], input.dt));
  const zeros = (): Float64Array => new Float64Array(n);

  const channels: Channel[] = [];
  for (const id of outputIds) {
    const ni = asm.nodeIndex.get(id);
    if (ni === undefined) continue;
    for (const dir of [0, 1, 2] as const) {
      const g = ni * 6 + dir;
      const ch: Channel = { nodeId: id, dir, acc: zeros(), vel: zeros(), disp: zeros(), velAbs: zeros(), dispAbs: zeros() };
      const st = status[g];
      if (st === 2) {
        ch.acc.set(input.acc[dir]);
        ch.velAbs.set(gk[dir].v);
        ch.dispAbs.set(gk[dir].d);
      } else if (st === 0 && freePos[g] >= 0) {
        const fp = freePos[g];
        for (let m = 0; m < used; m++) {
          const c = modes[m].phi[fp];
          if (c === 0) continue;
          const res = modal[m];
          for (let i = 0; i < n; i++) {
            ch.acc[i] += c * res.a[i];
            ch.vel[i] += c * res.v[i];
            ch.disp[i] += c * res.u[i];
          }
        }
        const rr = [0, 1, 2].map((d) => rInf[fp * 3 + d]);
        for (let i = 0; i < n; i++) {
          let ga = 0;
          let gv = 0;
          let gd = 0;
          for (let d = 0; d < 3; d++) {
            ga += rr[d] * input.acc[d][i];
            gv += rr[d] * gk[d].v[i];
            gd += rr[d] * gk[d].d[i];
          }
          ch.acc[i] += ga;
          ch.velAbs[i] = ch.vel[i] + gv;
          ch.dispAbs[i] = ch.disp[i] + gd;
        }
      }
      channels.push(ch);
    }
  }

  return {
    dt: input.dt,
    n,
    inputNodes: [...inputIds],
    inputAcc: input.acc,
    inputVel: [gk[0].v, gk[1].v, gk[2].v],
    inputDisp: [gk[0].d, gk[1].d, gk[2].d],
    channels,
    freqs: modes.slice(0, used).map((m) => m.omega / (2 * Math.PI)),
    xi: xis,
    cumMass: cum,
    usedModes: used,
    totalModes: modes.length,
    notes
  };
}
