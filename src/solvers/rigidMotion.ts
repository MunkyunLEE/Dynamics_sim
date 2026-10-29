import type { Vec3 } from '../core/model';

export interface Pose {
  R: Float64Array;
  p: Float64Array;
}

export function sub(a: ArrayLike<number>, b: ArrayLike<number>): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function crossV(a: ArrayLike<number>, b: ArrayLike<number>): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function wrap(x: number): number {
  let y = x % (2 * Math.PI);
  if (y > Math.PI) y -= 2 * Math.PI;
  if (y <= -Math.PI) y += 2 * Math.PI;
  return y;
}

export function foldAngle(P: Vec3, Q: Vec3, TA: Vec3, TB: Vec3): number {
  const e0 = sub(Q, P);
  const l = Math.hypot(e0[0], e0[1], e0[2]) || 1;
  const e = [e0[0] / l, e0[1] / l, e0[2] / l];
  const perp = (T: Vec3): number[] => {
    const w = sub(T, P);
    const d = w[0] * e[0] + w[1] * e[1] + w[2] * e[2];
    return [w[0] - d * e[0], w[1] - d * e[1], w[2] - d * e[2]];
  };
  const u = perp(TA);
  const b = perp(TB);
  const v = [-b[0], -b[1], -b[2]];
  const cx = crossV(u, v);
  return Math.atan2(e[0] * cx[0] + e[1] * cx[1] + e[2] * cx[2], u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
}

export function rot(axis: Vec3, th: number): Float64Array {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const C = 1 - c;
  const [x, y, z] = axis;
  return Float64Array.from([c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C]);
}

export function mulR(A: ArrayLike<number>, B: ArrayLike<number>): Float64Array {
  const o = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return o;
}

export function mulRv(A: ArrayLike<number>, v: ArrayLike<number>): Vec3 {
  return [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
}

export function compose(a: Pose, b: Pose): Pose {
  const p = mulRv(a.R, b.p);
  return { R: mulR(a.R, b.R), p: Float64Array.from([p[0] + a.p[0], p[1] + a.p[1], p[2] + a.p[2]]) };
}

export function inverse(a: Pose): Pose {
  const Rt = Float64Array.from([a.R[0], a.R[3], a.R[6], a.R[1], a.R[4], a.R[7], a.R[2], a.R[5], a.R[8]]);
  const p = mulRv(Rt, a.p);
  return { R: Rt, p: Float64Array.from([-p[0], -p[1], -p[2]]) };
}

export function screwExp(e: Vec3, P: Vec3, th: number): Pose {
  const R = rot(e, th);
  const rp = mulRv(R, P);
  return { R, p: Float64Array.from([P[0] - rp[0], P[1] - rp[1], P[2] - rp[2]]) };
}

export function logPose(T: Pose): number[] {
  const R = T.R;
  const tr = (R[0] + R[4] + R[8] - 1) / 2;
  const th = Math.acos(Math.max(-1, Math.min(1, tr)));
  const w = [R[7] - R[5], R[2] - R[6], R[3] - R[1]];
  const k = th < 1e-8 ? 0.5 : th / (2 * Math.sin(th));
  return [w[0] * k, w[1] * k, w[2] * k, T.p[0], T.p[1], T.p[2]];
}

export const IDENT: Pose = { R: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]), p: new Float64Array(3) };
