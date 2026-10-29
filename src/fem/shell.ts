import type { Material, Vec3 } from '../core/model';

export interface ShellMatrices {
  k: Float64Array;
  m: Float64Array;
  area: number;
}

const DRILL_RATIO = 1e-3;

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
}

function midBeta(xs: number[], ys: number[], a: number, b: number): [number[], number[]] {
  const dx = xs[b] - xs[a];
  const dy = ys[b] - ys[a];
  const L = Math.hypot(dx, dy);
  const t = [dx / L, dy / L];
  const nn = [-t[1], t[0]];
  const rowX = new Array<number>(9).fill(0);
  const rowY = new Array<number>(9).fill(0);
  const bt = new Array<number>(9).fill(0);
  const bn = new Array<number>(9).fill(0);
  bt[3 * b] += 3 / (2 * L);
  bt[3 * a] -= 3 / (2 * L);
  for (const [node, sgn] of [[a, 1], [b, 1]] as const) {
    bt[3 * node + 1] -= 0.25 * t[0] * sgn;
    bt[3 * node + 2] -= 0.25 * t[1] * sgn;
    bn[3 * node + 1] += 0.5 * nn[0] * sgn;
    bn[3 * node + 2] += 0.5 * nn[1] * sgn;
  }
  for (let j = 0; j < 9; j++) {
    rowX[j] = bt[j] * t[0] + bn[j] * nn[0];
    rowY[j] = bt[j] * t[1] + bn[j] * nn[1];
  }
  return [rowX, rowY];
}

function dktB(xs: number[], ys: number[], area: number, L: [number, number, number]): number[][] {
  const bc: number[] = [];
  const cc: number[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    bc.push(ys[j] - ys[k]);
    cc.push(xs[k] - xs[j]);
  }
  const dLdx = bc.map((v) => v / (2 * area));
  const dLdy = cc.map((v) => v / (2 * area));
  const dNdL: number[][] = [
    [4 * L[0] - 1, 0, 0],
    [0, 4 * L[1] - 1, 0],
    [0, 0, 4 * L[2] - 1],
    [0, 4 * L[2], 4 * L[1]],
    [4 * L[2], 0, 4 * L[0]],
    [4 * L[1], 4 * L[0], 0]
  ];
  const dNdx = dNdL.map((r) => r[0] * dLdx[0] + r[1] * dLdx[1] + r[2] * dLdx[2]);
  const dNdy = dNdL.map((r) => r[0] * dLdy[0] + r[1] * dLdy[1] + r[2] * dLdy[2]);

  const mid: [number[], number[]][] = [midBeta(xs, ys, 1, 2), midBeta(xs, ys, 2, 0), midBeta(xs, ys, 0, 1)];
  const bx: number[][] = [];
  const by: number[][] = [];
  for (let a = 0; a < 3; a++) {
    const rx = new Array<number>(9).fill(0);
    const ry = new Array<number>(9).fill(0);
    rx[3 * a + 1] = 1;
    ry[3 * a + 2] = 1;
    bx.push(rx);
    by.push(ry);
  }
  for (let k = 0; k < 3; k++) {
    bx.push(mid[k][0]);
    by.push(mid[k][1]);
  }
  const B = [new Array<number>(9).fill(0), new Array<number>(9).fill(0), new Array<number>(9).fill(0)];
  for (let n = 0; n < 6; n++) {
    for (let j = 0; j < 9; j++) {
      B[0][j] += dNdx[n] * bx[n][j];
      B[1][j] += dNdy[n] * by[n][j];
      B[2][j] += dNdy[n] * bx[n][j] + dNdx[n] * by[n][j];
    }
  }
  return B;
}

export function shellMatrices(p: [Vec3, Vec3, Vec3], mat: Material, t: number): ShellMatrices | null {
  const v12 = sub(p[1], p[0]);
  const nrm = cross(v12, sub(p[2], p[0]));
  const twoA = Math.hypot(nrm[0], nrm[1], nrm[2]);
  if (!(twoA > 1e-12) || !(t > 0)) return null;
  const area = twoA / 2;
  const e1 = unit(v12);
  const e3: Vec3 = [nrm[0] / twoA, nrm[1] / twoA, nrm[2] / twoA];
  const e2 = cross(e3, e1);
  const xs = p.map((q) => dot(sub(q, p[0]), e1));
  const ys = p.map((q) => dot(sub(q, p[0]), e2));
  const { E, nu, rho } = mat;

  const K = new Float64Array(324);
  const add = (i: number, j: number, v: number): void => {
    K[i * 18 + j] += v;
  };

  const bc: number[] = [];
  const cc: number[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    bc.push(ys[j] - ys[k]);
    cc.push(xs[k] - xs[j]);
  }
  const Bm: number[][] = [new Array(6).fill(0), new Array(6).fill(0), new Array(6).fill(0)];
  for (let a = 0; a < 3; a++) {
    Bm[0][2 * a] = bc[a] / twoA;
    Bm[1][2 * a + 1] = cc[a] / twoA;
    Bm[2][2 * a] = cc[a] / twoA;
    Bm[2][2 * a + 1] = bc[a] / twoA;
  }
  const c0 = E / (1 - nu * nu);
  const Dm = [
    [c0, c0 * nu, 0],
    [c0 * nu, c0, 0],
    [0, 0, (c0 * (1 - nu)) / 2]
  ];
  const mdof = (a: number, d: number): number => a * 6 + d;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) s += Bm[r][i] * Dm[r][q] * Bm[q][j];
      add(mdof(Math.floor(i / 2), i % 2), mdof(Math.floor(j / 2), j % 2), s * t * area);
    }
  }

  const cb = (E * t ** 3) / (12 * (1 - nu * nu));
  const Db = [
    [cb, cb * nu, 0],
    [cb * nu, cb, 0],
    [0, 0, (cb * (1 - nu)) / 2]
  ];
  const gp: [number, number, number][] = [
    [1 / 6, 1 / 6, 2 / 3],
    [2 / 3, 1 / 6, 1 / 6],
    [1 / 6, 2 / 3, 1 / 6]
  ];
  const bdofs: number[] = [];
  for (let a = 0; a < 3; a++) bdofs.push(a * 6 + 2, a * 6 + 3, a * 6 + 4);
  for (const L of gp) {
    const B9 = dktB(xs, ys, area, L);
    const Bw = B9.map((row) => {
      const out = new Array<number>(9).fill(0);
      for (let a = 0; a < 3; a++) {
        out[3 * a] = row[3 * a];
        out[3 * a + 1] = row[3 * a + 2];
        out[3 * a + 2] = -row[3 * a + 1];
      }
      return out;
    });
    const w = area / 3;
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        let s = 0;
        for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) s += Bw[r][i] * Db[r][q] * Bw[q][j];
        add(bdofs[i], bdofs[j], s * w);
      }
    }
  }

  const G = E / (2 * (1 + nu));
  const kd = DRILL_RATIO * G * t * area;
  for (let a = 0; a < 3; a++) {
    const g = new Float64Array(18);
    g[a * 6 + 5] = 1;
    for (let b = 0; b < 3; b++) {
      g[b * 6] += (0.5 * cc[b]) / twoA;
      g[b * 6 + 1] -= (0.5 * bc[b]) / twoA;
    }
    for (let i = 0; i < 18; i++) {
      if (g[i] === 0) continue;
      for (let j = 0; j < 18; j++) if (g[j] !== 0) add(i, j, (kd / 3) * g[i] * g[j]);
    }
  }

  const M = new Float64Array(324);
  const mass = rho * t * area;
  for (let a = 0; a < 3; a++) {
    for (let b = 0; b < 3; b++) {
      const v = (mass / 12) * (a === b ? 2 : 1);
      for (let d = 0; d < 3; d++) M[(a * 6 + d) * 18 + (b * 6 + d)] += v;
    }
    const rot = (rho * t ** 3 * area) / 36;
    M[(a * 6 + 3) * 18 + a * 6 + 3] += rot;
    M[(a * 6 + 4) * 18 + a * 6 + 4] += rot;
    M[(a * 6 + 5) * 18 + a * 6 + 5] += (mass * area) / 36;
  }

  const R = [e1, e2, e3];
  const T = new Float64Array(324);
  for (let blk = 0; blk < 6; blk++) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[(blk * 3 + r) * 18 + blk * 3 + c] = R[r][c];
  }
  const congruent = (A: Float64Array): Float64Array => {
    const tmp = new Float64Array(324);
    for (let i = 0; i < 18; i++) {
      for (let j = 0; j < 18; j++) {
        let s = 0;
        for (let k = 0; k < 18; k++) s += A[i * 18 + k] * T[k * 18 + j];
        tmp[i * 18 + j] = s;
      }
    }
    const out = new Float64Array(324);
    for (let i = 0; i < 18; i++) {
      for (let j = 0; j < 18; j++) {
        let s = 0;
        for (let k = 0; k < 18; k++) s += T[k * 18 + i] * tmp[k * 18 + j];
        out[i * 18 + j] = s;
      }
    }
    return out;
  };
  return { k: congruent(K), m: congruent(M), area };
}
