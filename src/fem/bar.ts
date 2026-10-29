import type { BarDef, BarSection, Material, Vec3 } from '../core/model';
import { solveDense } from './linalg';

export interface BarMatrices {
  k: Float64Array;
  m: Float64Array;
  length: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

function scaled(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function localAxes(p0: Vec3, p1: Vec3, orient?: Vec3): { L: number; R: Vec3[] } {
  const d = sub(p1, p0);
  const L = norm(d);
  if (L < 1e-12) throw new Error('길이가 0인 바 요소가 있습니다.');
  const ex = scaled(d, 1 / L);
  const candidates: Vec3[] = [];
  if (orient && norm(orient) > 0) candidates.push(orient);
  candidates.push(Math.abs(ex[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1]);
  candidates.push([0, 1, 0]);
  for (const ref of candidates) {
    const proj = sub(ref, scaled(ex, dot(ref, ex)));
    const len = norm(proj);
    if (len > 1e-6 * norm(ref)) {
      const ez = scaled(proj, 1 / len);
      const ey = cross(ez, ex);
      return { L, R: [ex, ey, ez] };
    }
  }
  throw new Error('바 요소의 국부 좌표축을 정할 수 없습니다.');
}

function localStiffness(E: number, G: number, A: number, Iy: number, Iz: number, J: number, L: number): Float64Array {
  const k = new Float64Array(144);
  const set = (i: number, j: number, v: number): void => {
    k[i * 12 + j] = v;
    k[j * 12 + i] = v;
  };
  const L2 = L * L;
  const L3 = L2 * L;
  const ea = (E * A) / L;
  set(0, 0, ea);
  set(6, 6, ea);
  set(0, 6, -ea);
  const gj = (G * J) / L;
  set(3, 3, gj);
  set(9, 9, gj);
  set(3, 9, -gj);
  const a1 = (12 * E * Iz) / L3;
  const a2 = (6 * E * Iz) / L2;
  const a3 = (4 * E * Iz) / L;
  const a4 = (2 * E * Iz) / L;
  set(1, 1, a1);
  set(7, 7, a1);
  set(1, 7, -a1);
  set(1, 5, a2);
  set(1, 11, a2);
  set(5, 7, -a2);
  set(7, 11, -a2);
  set(5, 5, a3);
  set(11, 11, a3);
  set(5, 11, a4);
  const b1 = (12 * E * Iy) / L3;
  const b2 = (6 * E * Iy) / L2;
  const b3 = (4 * E * Iy) / L;
  const b4 = (2 * E * Iy) / L;
  set(2, 2, b1);
  set(8, 8, b1);
  set(2, 8, -b1);
  set(2, 4, -b2);
  set(2, 10, -b2);
  set(4, 8, b2);
  set(8, 10, b2);
  set(4, 4, b3);
  set(10, 10, b3);
  set(4, 10, b4);
  return k;
}

function localMass(rho: number, A: number, J: number, L: number): Float64Array {
  const m = new Float64Array(144);
  const set = (i: number, j: number, v: number): void => {
    m[i * 12 + j] = v;
    m[j * 12 + i] = v;
  };
  const mass = rho * A * L;
  set(0, 0, mass / 3);
  set(6, 6, mass / 3);
  set(0, 6, mass / 6);
  const ip = rho * J * L;
  set(3, 3, ip / 3);
  set(9, 9, ip / 3);
  set(3, 9, ip / 6);
  const c = mass / 420;
  const L2 = L * L;
  set(1, 1, 156 * c);
  set(1, 5, 22 * L * c);
  set(1, 7, 54 * c);
  set(1, 11, -13 * L * c);
  set(5, 5, 4 * L2 * c);
  set(5, 7, 13 * L * c);
  set(5, 11, -3 * L2 * c);
  set(7, 7, 156 * c);
  set(7, 11, -22 * L * c);
  set(11, 11, 4 * L2 * c);
  set(2, 2, 156 * c);
  set(2, 4, -22 * L * c);
  set(2, 8, 54 * c);
  set(2, 10, 13 * L * c);
  set(4, 4, 4 * L2 * c);
  set(4, 8, -13 * L * c);
  set(4, 10, -3 * L2 * c);
  set(8, 8, 156 * c);
  set(8, 10, 22 * L * c);
  set(10, 10, 4 * L2 * c);
  return m;
}

function condense(k: Float64Array, m: Float64Array, released: number[]): { k: Float64Array; m: Float64Array } {
  if (released.length === 0) return { k, m };
  const rel = new Set(released);
  const retained: number[] = [];
  for (let i = 0; i < 12; i++) if (!rel.has(i)) retained.push(i);
  const nr = released.length;
  const na = retained.length;
  const Krr = new Float64Array(nr * nr);
  const Kra = new Float64Array(nr * na);
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nr; j++) Krr[i * nr + j] = k[released[i] * 12 + released[j]];
    for (let j = 0; j < na; j++) Kra[i * na + j] = k[released[i] * 12 + retained[j]];
  }
  const X = solveDense(Krr, Kra, nr, na);
  const T = new Float64Array(12 * na);
  for (let a = 0; a < na; a++) T[retained[a] * na + a] = 1;
  for (let r = 0; r < nr; r++) for (let a = 0; a < na; a++) T[released[r] * na + a] = -X[r * na + a];

  const project = (full: Float64Array): Float64Array => {
    const tmp = new Float64Array(12 * na);
    for (let i = 0; i < 12; i++) {
      for (let a = 0; a < na; a++) {
        let s = 0;
        for (let j = 0; j < 12; j++) s += full[i * 12 + j] * T[j * na + a];
        tmp[i * na + a] = s;
      }
    }
    const out = new Float64Array(144);
    for (let a = 0; a < na; a++) {
      for (let b = 0; b < na; b++) {
        let s = 0;
        for (let i = 0; i < 12; i++) s += T[i * na + a] * tmp[i * na + b];
        out[retained[a] * 12 + retained[b]] = s;
      }
    }
    return out;
  };

  return { k: project(k), m: project(m) };
}

function transform(kl: Float64Array, R: Vec3[]): Float64Array {
  const kg = new Float64Array(144);
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          let s = 0;
          for (let p = 0; p < 3; p++) {
            for (let q = 0; q < 3; q++) {
              s += R[p][i] * kl[(3 * a + p) * 12 + (3 * b + q)] * R[q][j];
            }
          }
          kg[(3 * a + i) * 12 + (3 * b + j)] = s;
        }
      }
    }
  }
  return kg;
}

export function barMatrices(bar: BarDef, p0: Vec3, p1: Vec3, mat: Material, sec: BarSection): BarMatrices {
  const { L, R } = localAxes(p0, p1, bar.orient);
  const G = mat.E / (2 * (1 + mat.nu));
  const kl = localStiffness(mat.E, G, sec.A, sec.Iy, sec.Iz, sec.J, L);
  const ml = localMass(mat.rho, sec.A, sec.J, L);
  const released: number[] = [];
  if (bar.release) {
    for (let i = 0; i < 3; i++) {
      if (bar.release[0][i]) released.push(3 + i);
      if (bar.release[1][i]) released.push(9 + i);
    }
  }
  const c = condense(kl, ml, released);
  return { k: transform(c.k, R), m: transform(c.m, R), length: L };
}
