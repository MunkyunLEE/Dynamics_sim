import { solveModal } from '../src/solvers/eigen';
import type { BarDef, NodeDef, StructuralModel, SupportDef } from '../src/core/model';

const E = 205000;
const rho = 7.85e-9;
const A = 100;
const I = 10 * 10 ** 3 / 12;
const L = 1000;

function beam(nElem: number, supports: SupportDef[], releaseFirst = false): StructuralModel {
  const nodes: NodeDef[] = [];
  const bars: BarDef[] = [];
  for (let i = 0; i <= nElem; i++) nodes.push({ id: i + 1, xyz: [(L * i) / nElem, 0, 0] });
  for (let i = 0; i < nElem; i++) {
    const bar: BarDef = { id: i + 1, n: [i + 1, i + 2], mat: 'steel', sec: 'sq' };
    if (releaseFirst && i === 0) bar.release = [[0, 1, 1], [0, 0, 0]];
    bars.push(bar);
  }
  return {
    units: { length: 'mm', force: 'N', mass: 'tonne', time: 's' },
    materials: [{ id: 'steel', E, nu: 0.3, rho }],
    sections: [{ id: 'sq', type: 'bar', A, Iy: I, Iz: I, J: 1.4 * I }],
    nodes,
    bars,
    panels: [],
    hinges: [],
    masses: [],
    supports,
    damping: { mode: 'modal', xi: 0.05, rayleigh: null }
  };
}

const base = Math.sqrt((E * I) / (rho * A * L ** 4)) / (2 * Math.PI);
let failed = false;

function check(name: string, got: number, expect: number, tol: number): void {
  const err = Math.abs(got - expect) / expect;
  const ok = err < tol;
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: got ${got.toFixed(4)} Hz, expect ${expect.toFixed(4)} Hz, err ${(err * 100).toFixed(3)}%`);
}

const full: [number, number, number, number, number, number] = [1, 1, 1, 1, 1, 1];

const cant = solveModal(beam(8, [{ node: 1, dof: full }]), { type: 'constrained', nModes: 4 });
check('cantilever mode 1', cant.freqs[0], base * 1.8751 ** 2, 0.005);
check('cantilever mode 3', cant.freqs[2], base * 4.6941 ** 2, 0.01);

const ss = solveModal(
  beam(8, [
    { node: 1, dof: [1, 1, 1, 1, 0, 0] },
    { node: 9, dof: [0, 1, 1, 0, 0, 0] }
  ]),
  { type: 'constrained', nModes: 2 }
);
check('simply supported mode 1', ss.freqs[0], base * Math.PI ** 2, 0.005);

const rel = solveModal(
  beam(8, [
    { node: 1, dof: full },
    { node: 9, dof: [0, 1, 1, 0, 0, 0] }
  ], true),
  { type: 'constrained', nModes: 2 }
);
check('pinned by release mode 1', rel.freqs[0], base * Math.PI ** 2, 0.02);

const ff = solveModal(beam(8, []), { type: 'free', nModes: 10 });
const zeros = ff.zero.filter(Boolean).length;
console.log(`${zeros === 6 ? 'OK  ' : 'FAIL'} free-free zero modes: ${zeros} (expect 6)`);
if (zeros !== 6) failed = true;
check('free-free mode 7', ff.freqs[6], base * 4.73 ** 2, 0.01);
for (const idx of [6, 7]) {
  const [ex, ey, ez] = ff.effMass[idx].map((v) => (v * 100).toFixed(1));
  console.log(`mode ${idx + 1} eff mass X/Y/Z: ${ex} / ${ey} / ${ez} %`);
}
const sumY = ff.effMass.reduce((s, v) => s + v[1], 0) * 100;
console.log(`sum of eff mass Y over 10 modes (rigid + flexural): ${sumY.toFixed(1)} %`);

process.exit(failed ? 1 : 0);
