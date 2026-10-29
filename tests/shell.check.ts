import type { BarDef, NodeDef, PanelDef, StructuralModel, Vec3 } from '../src/core/model';
import { solveModal } from '../src/solvers/eigen';

const E = 205000;
const rho = 7.85e-9;

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${detail}`);
  if (!ok) failed++;
}

function strip(L: number, W: number, t: number, nx: number, ny: number, map: (p: Vec3) => Vec3, nu = 0): StructuralModel {
  const nodes: NodeDef[] = [];
  const id = (i: number, j: number): number => j * (nx + 1) + i + 1;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) nodes.push({ id: id(i, j), xyz: map([(L * i) / nx, (W * j) / ny, 0]) });
  const tris: [number, number, number][] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      tris.push([id(i, j), id(i + 1, j), id(i + 1, j + 1)]);
      tris.push([id(i, j), id(i + 1, j + 1), id(i, j + 1)]);
    }
  }
  const panel: PanelDef = { id: 'p', mat: 'steel', sec: 't', tris };
  const bars: BarDef[] = [];
  return {
    units: { length: 'mm', force: 'N', mass: 'tonne', time: 's' },
    materials: [{ id: 'steel', E, nu, rho }],
    sections: [{ id: 't', type: 'shell', thickness: t }],
    nodes,
    bars,
    panels: [panel],
    hinges: [],
    masses: [],
    supports: nodes.filter((n) => Math.abs(map([0, 0, 0])[0] - n.xyz[0]) < 1e30 && false).map((n) => ({ node: n.id, dof: [1, 1, 1, 1, 1, 1] as [number, number, number, number, number, number] })),
    damping: { mode: 'modal', xi: 0.05, rayleigh: null }
  };
}

function clampRoot(m: StructuralModel, ny: number, nx: number): void {
  m.supports = [];
  for (let j = 0; j <= ny; j++) m.supports.push({ node: j * (nx + 1) + 1, dof: [1, 1, 1, 1, 1, 1] });
}

const L = 1000;
const W = 100;
const t = 10;
const beamF = (I: number, A: number): number => ((1.875104 ** 2) / (2 * Math.PI)) * Math.sqrt((E * I) / (rho * A * L ** 4));

{
  const m = strip(L, W, t, 20, 2, (p) => p);
  clampRoot(m, 2, 20);
  const r = solveModal(m, { type: 'constrained', nModes: 3 });
  const ref = beamF((W * t ** 3) / 12, W * t);
  check('cantilever strip out-of-plane (DKT)', Math.abs(r.freqs[0] / ref - 1) < 0.03, `f=${r.freqs[0].toFixed(3)} ref=${ref.toFixed(3)}`);
}

{
  const m = strip(L, W, t, 40, 4, (p) => p);
  clampRoot(m, 4, 40);
  const r = solveModal(m, { type: 'constrained', nModes: 6 });
  const ref = beamF((t * W ** 3) / 12, W * t);
  const found = r.freqs.reduce((b, f) => (Math.abs(f / ref - 1) < Math.abs(b / ref - 1) ? f : b), r.freqs[0]);
  check('cantilever strip in-plane (CST)', Math.abs(found / ref - 1) < 0.1, `f=${found.toFixed(3)} ref=${ref.toFixed(3)}`);
}

{
  const tilt = (p: Vec3): Vec3 => {
    const c = Math.cos(0.7);
    const s = Math.sin(0.7);
    const q: Vec3 = [p[0] * 0.8 - p[1] * 0.6, p[0] * 0.6 + p[1] * 0.8, p[2]];
    return [q[0] + 300, q[1] - 200, q[2] * c - q[1] * s + 50 * s + 100];
  };
  const base = strip(L, W, t, 20, 2, (p) => p);
  clampRoot(base, 2, 20);
  const a = solveModal(base, { type: 'constrained', nModes: 4 });
  const m = strip(L, W, t, 20, 2, (p) => {
    const q: Vec3 = [p[0] * 0.8 - p[1] * 0.6, p[0] * 0.6 + p[1] * 0.8, p[2]];
    const c = Math.cos(0.7);
    const s = Math.sin(0.7);
    return [q[0] + 300, q[1] * c - q[2] * s - 200, q[1] * s + q[2] * c + 100];
  });
  void tilt;
  clampRoot(m, 2, 20);
  const b = solveModal(m, { type: 'constrained', nModes: 4 });
  const ok = a.freqs.every((f, i) => Math.abs(f / b.freqs[i] - 1) < 1e-6);
  check('frequencies invariant under rigid rotation of mesh', ok, `${a.freqs[0].toFixed(4)} vs ${b.freqs[0].toFixed(4)}`);
}

{
  const m = strip(300, 200, 5, 6, 4, (p) => [p[0] * 0.6, p[1], p[0] * 0.8 + 20]);
  const r = solveModal(m, { type: 'free', nModes: 10 });
  const zeros = r.zero.filter(Boolean).length;
  check('free plate has exactly 6 rigid modes', zeros === 6, `zeros=${zeros} f=${r.freqs.slice(0, 8).map((f) => f.toFixed(2)).join(',')}`);
}

{
  const m = strip(300, 300, 5, 8, 8, (p) => p, 0.3);
  m.supports = [];
  const idx = (i: number, j: number): number => j * 9 + i + 1;
  for (let i = 0; i <= 8; i++) for (const j of [0, 8]) m.supports.push({ node: idx(i, j), dof: [1, 1, 1, 0, 0, 0] });
  for (let j = 0; j <= 8; j++) for (const i of [0, 8]) if (!m.supports.some((s) => s.node === idx(i, j))) m.supports.push({ node: idx(i, j), dof: [1, 1, 1, 0, 0, 0] });
  const r = solveModal(m, { type: 'constrained', nModes: 3 });
  const D = (E * 5 ** 3) / (12 * (1 - 0.09));
  const ref = (Math.PI / 2) * Math.sqrt(D / (rho * 5)) * (2 / 300 ** 2);
  check('simply supported square plate fundamental', Math.abs(r.freqs[0] / ref - 1) < 0.03, `f=${r.freqs[0].toFixed(3)} ref=${ref.toFixed(3)}`);
}

if (failed > 0) process.exit(1);
