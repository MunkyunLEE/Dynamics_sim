import type { HingeType, StructuralModel, Vec3 } from '../core/model';
import { resolveHingeEdge } from '../core/hinges';
import { solveDense, symmetricEigen } from '../fem/linalg';
import { IDENT, compose, crossV, foldAngle, inverse, logPose, mulRv, screwExp, sub, wrap, type Pose } from './rigidMotion';

export { foldAngle };

export interface KinematicsOptions {
  ground: string | null;
  drivers: { hinge: string; angle: number }[];
  steps: number;
  mv?: Record<string, number>;
}

export interface MobilityReport {
  bodies: number;
  ground: string;
  revolute: number;
  locked: number;
  loops: number;
  interiorVertices: number;
  holes: number;
  rank: number;
  nullity: number;
  predicted: number;
  selfStress: number;
  floating: number;
  flat: boolean;
  modes: Float64Array[];
  modeAngles: Float64Array[];
  sigma: number[];
}

export interface KinematicsResult {
  hingeIds: string[];
  driverIds: string[];
  frames: Float64Array[];
  angles: Float64Array[];
  completed: number;
  requested: number;
  maxResidual: number;
  notes: string[];
  mobility: MobilityReport;
  finalMobility: MobilityReport | null;
}

interface Hinge {
  id: string;
  type: HingeType;
  a: number;
  b: number;
  p: number;
  q: number;
  ta: number;
  tb: number;
  P: Vec3;
  e: Vec3;
  ref: number;
  orient: number;
}

const DEG = Math.PI / 180;

class FoldMechanism {
  xref: Float64Array;
  panelBody: number[] = [];
  bodyPanels: string[][] = [];
  nodePanels: number[][];
  hinges: Hinge[] = [];
  locked = 0;
  parent: number[] = [];
  parentHinge: number[] = [];
  childSign: number[] = [];
  roots: number[] = [];
  cotree: number[] = [];
  groundBody = 0;
  Ls = 1;
  interiorVertices = 0;
  notes: string[] = [];

  constructor(model: StructuralModel, ground: string | null) {
    const nodeIndex = new Map(model.nodes.map((n, i) => [n.id, i]));
    this.xref = new Float64Array(model.nodes.length * 3);
    model.nodes.forEach((n, i) => this.xref.set(n.xyz, i * 3));
    if (model.panels.length === 0) throw new Error('패널이 없습니다. 기구학 해석은 패널(강체 면)과 힌지가 필요합니다.');
    const panelIdx = new Map(model.panels.map((p, i) => [p.id, i]));
    this.nodePanels = model.nodes.map(() => []);
    model.panels.forEach((p, pi) => {
      const s = new Set<number>();
      for (const t of p.tris) for (const id of t) s.add(nodeIndex.get(id)!);
      for (const n of s) this.nodePanels[n].push(pi);
    });

    const uf = model.panels.map((_, i) => i);
    const find = (x: number): number => (uf[x] === x ? x : (uf[x] = find(uf[x])));
    const third = (pi: number, a: number, b: number): number | null => {
      for (const t of model.panels[pi].tris) if (t.includes(a) && t.includes(b)) return t.find((v) => v !== a && v !== b)!;
      return null;
    };

    const raw: { h: (typeof model.hinges)[number]; edge: [number, number]; ta: number; tb: number }[] = [];
    for (const h of model.hinges) {
      if (h.type === 'none') continue;
      const edge = resolveHingeEdge(model, h);
      const pa = panelIdx.get(h.panels[0]);
      const pb = panelIdx.get(h.panels[1]);
      if (!edge || pa === undefined || pb === undefined) {
        this.notes.push(`힌지 ${h.id}: 공유 모서리를 찾지 못해 제외했습니다.`);
        continue;
      }
      const ta = third(pa, edge[0], edge[1]);
      const tb = third(pb, edge[0], edge[1]);
      if (ta === null || tb === null) {
        this.notes.push(`힌지 ${h.id}: 모서리가 패널 삼각형에 속하지 않아 제외했습니다.`);
        continue;
      }
      raw.push({ h, edge, ta, tb });
      if (h.type === 'rigid') {
        uf[find(pa)] = find(pb);
        this.locked++;
      }
    }

    const bodyOfRoot = new Map<number, number>();
    model.panels.forEach((p, pi) => {
      const r = find(pi);
      if (!bodyOfRoot.has(r)) {
        bodyOfRoot.set(r, this.bodyPanels.length);
        this.bodyPanels.push([]);
      }
      const b = bodyOfRoot.get(r)!;
      this.panelBody[pi] = b;
      this.bodyPanels[b].push(p.id);
    });

    let len = 0;
    for (const r of raw) {
      if (r.h.type === 'rigid') continue;
      const p = nodeIndex.get(r.edge[0])!;
      const q = nodeIndex.get(r.edge[1])!;
      const P: Vec3 = [this.xref[p * 3], this.xref[p * 3 + 1], this.xref[p * 3 + 2]];
      const d = sub(this.xref.subarray(q * 3, q * 3 + 3), P);
      const l = Math.hypot(d[0], d[1], d[2]);
      len += l;
      const hg: Hinge = {
        id: r.h.id,
        type: r.h.type,
        a: this.panelBody[panelIdx.get(r.h.panels[0])!],
        b: this.panelBody[panelIdx.get(r.h.panels[1])!],
        p,
        q,
        ta: nodeIndex.get(r.ta)!,
        tb: nodeIndex.get(r.tb)!,
        P,
        e: [d[0] / l, d[1] / l, d[2] / l],
        ref: 0,
        orient: 1
      };
      hg.ref = foldAngle(P, this.node(q), this.node(hg.ta), this.node(hg.tb));
      hg.orient = this.orientation(model.panels[panelIdx.get(r.h.panels[0])!].tris, nodeIndex, r.edge, hg);
      this.hinges.push(hg);
    }
    this.Ls = this.hinges.length ? len / this.hinges.length : 1;

    const nb = this.bodyPanels.length;
    const gp = ground ? panelIdx.get(ground) : undefined;
    this.groundBody = gp !== undefined ? this.panelBody[gp] : 0;
    this.parent = new Array(nb).fill(-1);
    this.parentHinge = new Array(nb).fill(-1);
    this.childSign = new Array(nb).fill(0);
    const adj: number[][] = Array.from({ length: nb }, () => []);
    this.hinges.forEach((h, i) => {
      adj[h.a].push(i);
      adj[h.b].push(i);
    });
    const seen = new Array(nb).fill(false);
    const inTree = new Array(this.hinges.length).fill(false);
    const order = [this.groundBody, ...Array.from({ length: nb }, (_, i) => i).filter((i) => i !== this.groundBody)];
    for (const start of order) {
      if (seen[start]) continue;
      this.roots.push(start);
      seen[start] = true;
      const queue = [start];
      while (queue.length) {
        const b = queue.shift()!;
        for (const hi of adj[b]) {
          const h = this.hinges[hi];
          const other = h.a === b ? h.b : h.a;
          if (seen[other]) continue;
          seen[other] = true;
          inTree[hi] = true;
          this.parent[other] = b;
          this.parentHinge[other] = hi;
          this.childSign[other] = other === h.b ? 1 : -1;
          queue.push(other);
        }
      }
    }
    this.cotree = this.hinges.map((_, i) => i).filter((i) => !inTree[i]);
    this.bfs = [];
    const visit = (root: number): void => {
      const q = [root];
      while (q.length) {
        const b = q.shift()!;
        this.bfs.push(b);
        for (let c = 0; c < nb; c++) if (this.parent[c] === b) q.push(c);
      }
    };
    for (const r of this.roots) visit(r);

    for (let n = 0; n < this.nodePanels.length; n++) {
      const panels = this.nodePanels[n];
      if (panels.length < 3) continue;
      const hs = raw.filter((r) => nodeIndex.get(r.edge[0]) === n || nodeIndex.get(r.edge[1]) === n);
      if (hs.length !== panels.length) continue;
      const deg = new Map<string, number>();
      for (const r of hs) for (const pid of r.h.panels) deg.set(pid, (deg.get(pid) ?? 0) + 1);
      if (panels.every((pi) => deg.get(model.panels[pi].id) === 2)) this.interiorVertices++;
    }
  }

  bfs: number[] = [];

  orientation(tris: [number, number, number][], nodeIndex: Map<number, number>, edge: [number, number], h: Hinge): number {
    const t = tris.find((x) => x.includes(edge[0]) && x.includes(edge[1]))!;
    const v = t.map((id) => this.node(nodeIndex.get(id)!));
    const nA = crossV(sub(v[1], v[0]), sub(v[2], v[0]));
    const w = sub(this.node(h.ta), h.P);
    const ne = crossV(nA, h.e);
    return ne[0] * w[0] + ne[1] * w[1] + ne[2] * w[2] >= 0 ? -1 : 1;
  }

  node(n: number): Vec3 {
    return [this.xref[n * 3], this.xref[n * 3 + 1], this.xref[n * 3 + 2]];
  }

  poses(d: Float64Array): Pose[] {
    const out: Pose[] = new Array(this.bodyPanels.length);
    for (const b of this.bfs) {
      const par = this.parent[b];
      if (par < 0) {
        out[b] = IDENT;
        continue;
      }
      const hi = this.parentHinge[b];
      const h = this.hinges[hi];
      out[b] = compose(out[par], screwExp(h.e, h.P, this.childSign[b] * d[hi]));
    }
    return out;
  }

  twist(T: Pose[], hi: number, body: number, sign: number): number[] {
    const h = this.hinges[hi];
    const w = mulRv(T[body].R, h.e);
    const pp = mulRv(T[body].R, h.P);
    const q = [pp[0] + T[body].p[0], pp[1] + T[body].p[1], pp[2] + T[body].p[2]];
    const v = crossV(q, w);
    return [sign * w[0], sign * w[1], sign * w[2], (sign * v[0]) / this.Ls, (sign * v[1]) / this.Ls, (sign * v[2]) / this.Ls];
  }

  bodyTwistTerms(T: Pose[], b: number): [number, number[]][] {
    const out: [number, number[]][] = [];
    let c = b;
    while (this.parent[c] >= 0) {
      out.push([this.parentHinge[c], this.twist(T, this.parentHinge[c], this.parent[c], this.childSign[c])]);
      c = this.parent[c];
    }
    return out;
  }

  residual(d: Float64Array, T: Pose[]): Float64Array {
    const r = new Float64Array(this.cotree.length * 6);
    this.cotree.forEach((hi, k) => {
      const h = this.hinges[hi];
      const E = compose(compose(T[h.a], screwExp(h.e, h.P, d[hi])), inverse(T[h.b]));
      const l = logPose(E);
      for (let i = 0; i < 3; i++) {
        r[k * 6 + i] = l[i];
        r[k * 6 + 3 + i] = l[3 + i] / this.Ls;
      }
    });
    return r;
  }

  jacobian(T: Pose[]): Float64Array {
    const n = this.hinges.length;
    const J = new Float64Array(this.cotree.length * 6 * n);
    this.cotree.forEach((hi, k) => {
      const h = this.hinges[hi];
      const addTerm = (col: number, t: number[], s: number): void => {
        for (let i = 0; i < 6; i++) J[(k * 6 + i) * n + col] += s * t[i];
      };
      addTerm(hi, this.twist(T, hi, h.a, 1), 1);
      for (const [col, t] of this.bodyTwistTerms(T, h.a)) addTerm(col, t, 1);
      for (const [col, t] of this.bodyTwistTerms(T, h.b)) addTerm(col, t, -1);
    });
    return J;
  }

  positions(T: Pose[]): Float64Array {
    const out = this.xref.slice();
    this.nodePanels.forEach((panels, n) => {
      if (panels.length === 0) return;
      const acc = [0, 0, 0];
      const x = this.node(n);
      for (const pi of panels) {
        const P = T[this.panelBody[pi]];
        const y = mulRv(P.R, x);
        for (let d = 0; d < 3; d++) acc[d] += (y[d] + P.p[d]) / panels.length;
      }
      out.set(acc, n * 3);
    });
    return out;
  }

  correct(d0: Float64Array, held: Set<number>, maxIter = 40): { d: Float64Array; res: number; ok: boolean } {
    const n = this.hinges.length;
    const free = Array.from({ length: n }, (_, i) => i).filter((i) => !held.has(i));
    const m = free.length;
    let d = d0.slice();
    let T = this.poses(d);
    let r = this.residual(d, T);
    let norm = r.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
    let mu = 1e-10;
    for (let it = 0; it < maxIter && norm > 1e-11; it++) {
      const J = this.jacobian(T);
      const rows = r.length;
      const A = new Float64Array(m * m);
      const g = new Float64Array(m);
      for (let row = 0; row < rows; row++) {
        for (let i = 0; i < m; i++) {
          const ji = J[row * n + free[i]];
          if (ji === 0) continue;
          g[i] -= ji * r[row];
          for (let k = 0; k < m; k++) A[i * m + k] += ji * J[row * n + free[k]];
        }
      }
      let tr = 0;
      for (let i = 0; i < m; i++) tr += A[i * m + i];
      const base = tr / Math.max(m, 1) || 1;
      let accepted = false;
      for (let tries = 0; tries < 10; tries++) {
        const Ad = A.slice();
        for (let i = 0; i < m; i++) Ad[i * m + i] += mu * base;
        const dx = solveDense(Ad, g, m, 1);
        const dt = d.slice();
        free.forEach((c, i) => {
          dt[c] += dx[i];
        });
        const Tt = this.poses(dt);
        const rt = this.residual(dt, Tt);
        const nt = rt.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
        if (nt < norm) {
          d = dt;
          T = Tt;
          r = rt;
          norm = nt;
          mu = Math.max(mu / 10, 1e-14);
          accepted = true;
          break;
        }
        mu = Math.max(mu * 10, 1e-8);
      }
      if (!accepted) break;
    }
    return { d, res: norm, ok: norm < 1e-8 };
  }

  project(T: Pose[], dir: Float64Array): Float64Array {
    const n = this.hinges.length;
    if (this.cotree.length === 0) return dir.slice();
    const J = this.jacobian(T);
    const rows = this.cotree.length * 6;
    const A = new Float64Array(n * n);
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < n; i++) {
        const ji = J[row * n + i];
        if (ji === 0) continue;
        for (let k = 0; k < n; k++) A[i * n + k] += ji * J[row * n + k];
      }
    }
    let tr = 0;
    for (let i = 0; i < n; i++) tr += A[i * n + i];
    const lam = 1e-10 * (tr / n || 1);
    const Ad = A.slice();
    for (let i = 0; i < n; i++) Ad[i * n + i] += lam;
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) b[i] += A[i * n + k] * dir[k];
    const z = solveDense(Ad, b, n, 1);
    return dir.map((v, i) => v - z[i]);
  }

  mobility(d: Float64Array): MobilityReport {
    const n = this.hinges.length;
    const T = this.poses(d);
    const J = this.jacobian(T);
    const rows = this.cotree.length * 6;
    const A = new Float64Array(n * n);
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < n; i++) {
        const ji = J[row * n + i];
        if (ji === 0) continue;
        for (let k = 0; k < n; k++) A[i * n + k] += ji * J[row * n + k];
      }
    }
    const eig = n > 0 ? symmetricEigen(A, n) : { values: new Float64Array(0), vectors: new Float64Array(0) };
    const lmax = Math.max(n > 0 ? eig.values[n - 1] : 0, 1e-300);
    let nullity = 0;
    for (let i = 0; i < n; i++) if (eig.values[i] <= 1e-10 * lmax || this.cotree.length === 0) nullity++;
    const rank = n - nullity;
    const holes = Math.max(0, this.cotree.length - this.interiorVertices);
    const independent = 3 * this.interiorVertices + 6 * holes;
    const modes: Float64Array[] = [];
    const modeAngles: Float64Array[] = [];
    for (let k = 0; k < Math.min(nullity, 8); k++) {
      const v = new Float64Array(n);
      for (let i = 0; i < n; i++) v[i] = eig.vectors[i * n + k];
      const peakA = v.reduce((s, x) => Math.max(s, Math.abs(x)), 0) || 1;
      modeAngles.push(v.map((x) => x / peakA));
      const disp = new Float64Array(this.xref.length);
      const vel = this.bodyPanels.map((_, b) => {
        const tw = [0, 0, 0, 0, 0, 0];
        for (const [col, t] of this.bodyTwistTerms(T, b)) for (let i = 0; i < 6; i++) tw[i] += t[i] * v[col];
        return tw;
      });
      const pos = this.positions(T);
      this.nodePanels.forEach((panels, node) => {
        if (panels.length === 0) return;
        const x = [pos[node * 3], pos[node * 3 + 1], pos[node * 3 + 2]];
        for (const pi of panels) {
          const tw = vel[this.panelBody[pi]];
          const wx = crossV(tw, x);
          for (let dd = 0; dd < 3; dd++) disp[node * 3 + dd] += (tw[3 + dd] * this.Ls + wx[dd]) / panels.length;
        }
      });
      let peak = 0;
      for (let i = 0; i < disp.length; i += 3) peak = Math.max(peak, Math.hypot(disp[i], disp[i + 1], disp[i + 2]));
      if (peak > 0) for (let i = 0; i < disp.length; i++) disp[i] /= peak;
      modes.push(disp);
    }
    const angles = this.hinges.map((h, i) => wrap(h.ref + d[i]));
    const flat = angles.length > 0 && angles.every((a) => Math.abs(a) < 1e-6 || Math.abs(Math.abs(a) - Math.PI) < 1e-6);
    return {
      bodies: this.bodyPanels.length,
      ground: this.bodyPanels[this.groundBody].join('+'),
      revolute: n,
      locked: this.locked,
      loops: this.cotree.length,
      interiorVertices: this.interiorVertices,
      holes,
      rank,
      nullity,
      predicted: n - independent,
      selfStress: Math.max(0, independent - rank),
      floating: this.roots.length - 1,
      flat,
      modes,
      modeAngles,
      sigma: Array.from(eig.values.slice(0, Math.min(n, 10)), (x) => Math.sqrt(Math.max(x, 0) / lmax))
    };
  }
}

export function analyzeMobility(model: StructuralModel, ground: string | null): MobilityReport & { notes: string[]; hingeIds: string[] } {
  const mech = new FoldMechanism(model, ground);
  return { ...mech.mobility(new Float64Array(mech.hinges.length)), notes: mech.notes, hingeIds: mech.hinges.map((h) => h.id) };
}

export function measureFoldAngles(model: StructuralModel, positions?: Float64Array): Map<string, number> {
  const mech = new FoldMechanism(model, null);
  const x = positions ?? mech.xref;
  const P = (n: number): Vec3 => [x[n * 3], x[n * 3 + 1], x[n * 3 + 2]];
  const out = new Map<string, number>();
  for (const h of mech.hinges) out.set(h.id, (h.orient * foldAngle(P(h.p), P(h.q), P(h.ta), P(h.tb))) / DEG);
  return out;
}

export function solveKinematics(model: StructuralModel, options: KinematicsOptions): KinematicsResult {
  const mech = new FoldMechanism(model, options.ground);
  const notes = [...mech.notes];
  const n = mech.hinges.length;
  const hingeIds = mech.hinges.map((h) => h.id);
  const drivers = options.drivers
    .map((dv) => {
      const idx = hingeIds.indexOf(dv.hinge);
      return { idx, target: idx >= 0 ? mech.hinges[idx].orient * dv.angle * DEG : 0 };
    })
    .filter((dv) => {
      if (dv.idx < 0) notes.push('회전 힌지가 아닌 구동 지정은 무시했습니다.');
      return dv.idx >= 0;
    });
  const driverIds = drivers.map((dv) => hingeIds[dv.idx]);
  let d: Float64Array = new Float64Array(n);
  const mobility = mech.mobility(d);
  const frames: Float64Array[] = [mech.positions(mech.poses(d))];
  const angles: Float64Array[] = [Float64Array.from(mech.hinges, (h) => (h.orient * h.ref) / DEG)];
  const record = (dd: Float64Array): void => {
    frames.push(mech.positions(mech.poses(dd)));
    angles.push(Float64Array.from(mech.hinges, (h, i) => (h.orient * (h.ref + dd[i])) / DEG));
  };
  const mvRaw = new Float64Array(n);
  mech.hinges.forEach((h, i) => {
    const v = options.mv?.[h.id];
    if (v) mvRaw[i] = h.orient * Math.sign(v);
  });

  const steps = Math.max(1, Math.min(2000, Math.round(options.steps)));
  let completed = 0;
  let maxRes = 0;
  if (drivers.length === 0) notes.push('구동 힌지가 없어 경로를 계산하지 않았습니다. 힌지 표에서 목표 각도를 지정해 주세요.');
  else {
    const primary = drivers[0];
    const total = drivers.map((dv) => dv.target - mech.hinges[dv.idx].ref);
    const held = new Set([primary.idx]);
    const advance = (cur: Float64Array, f0: number, f1: number, depth: number): Float64Array | null => {
      const mag = Math.abs(total[0] * (f1 - f0));
      const dir = Float64Array.from(mvRaw, (v) => v * mag);
      drivers.forEach((dv, i) => {
        dir[dv.idx] = total[i] * (f1 - f0);
      });
      const T = mech.poses(cur);
      const proj = mech.project(T, dir);
      const want = total[0] * (f1 - f0);
      const scale = Math.abs(proj[primary.idx]) > 1e-9 * Math.abs(want) ? want / proj[primary.idx] : 0;
      const guess = cur.slice();
      for (let i = 0; i < n; i++) guess[i] += scale * proj[i];
      guess[primary.idx] = total[0] * f1;
      const c = mech.correct(guess, held);
      if (c.ok) {
        maxRes = Math.max(maxRes, c.res);
        return c.d;
      }
      if (depth >= 6) return null;
      const mid = (f0 + f1) / 2;
      const half = advance(cur, f0, mid, depth + 1);
      return half ? advance(half, mid, f1, depth + 1) : null;
    };
    for (let k = 1; k <= steps; k++) {
      const next = advance(d, (k - 1) / steps, k / steps, 0);
      if (!next) {
        notes.push(`${k}/${steps} 단계에서 수렴하지 못해 멈췄습니다. 구동 힌지가 잠긴 기구이거나 분기점일 수 있습니다.`);
        break;
      }
      d = next;
      record(d);
      completed = k;
    }
    if (drivers.length > 1) notes.push(`첫 번째 구동 힌지(${driverIds[0]})는 정확히 제어하고, 나머지 목표는 Tachi(2009) 방식대로 접힘 방향을 고르는 데만 사용했습니다.`);
  }
  if (mobility.flat) notes.push('기준 형상이 평면(또는 완전 접힘)입니다. 이 상태의 무한소 자유도는 실제보다 크게 나옵니다 (Tachi 2012, trivial shakiness).');
  if (model.bars.length > 0) notes.push('바 요소는 기구학에 참여하지 않고 양 끝 절점을 따라 표시만 됩니다.');
  const finalMobility = completed > 0 ? mech.mobility(d) : null;
  return { hingeIds, driverIds, frames, angles, completed, requested: steps, maxResidual: maxRes, notes, mobility, finalMobility };
}
