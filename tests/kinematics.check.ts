import type { NodeDef, PanelDef, StructuralModel } from '../src/core/model';
import { createHinges, detectHingeCandidates } from '../src/core/hinges';
import { analyzeMobility, measureFoldAngles, solveKinematics } from '../src/solvers/kinematics';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${detail}`);
  if (!ok) failed++;
}

function base(nodes: NodeDef[], panels: PanelDef[]): StructuralModel {
  const m: StructuralModel = {
    units: { length: 'mm', force: 'N', mass: 'tonne', time: 's' },
    materials: [{ id: 'm', E: 70000, nu: 0.3, rho: 2.7e-9 }],
    sections: [{ id: 't', type: 'shell', thickness: 2 }],
    nodes,
    bars: [],
    panels,
    hinges: [],
    masses: [],
    supports: [],
    damping: { mode: 'modal', xi: 0.02, rayleigh: null }
  };
  createHinges(m, detectHingeCandidates(m), 'free');
  return m;
}

{
  const nodes: NodeDef[] = [
    { id: 1, xyz: [0, 0, 0] },
    { id: 2, xyz: [100, 0, 0] },
    { id: 3, xyz: [100, 100, 0] },
    { id: 4, xyz: [0, 100, 0] },
    { id: 5, xyz: [0, -100, 0] },
    { id: 6, xyz: [100, -100, 0] }
  ];
  const m = base(nodes, [
    { id: 'A', mat: 'm', sec: 't', tris: [[1, 2, 3], [1, 3, 4]] },
    { id: 'B', mat: 'm', sec: 't', tris: [[1, 5, 6], [1, 6, 2]] }
  ]);
  check('two panels: one hinge detected', m.hinges.length === 1);
  const mob = analyzeMobility(m, 'A');
  check('two panels: 1 DOF', mob.nullity === 1 && mob.predicted === 1, `nullity=${mob.nullity}`);
  const r = solveKinematics(m, { ground: 'A', drivers: [{ hinge: m.hinges[0].id, angle: 90 }], steps: 10 });
  const last = r.frames[r.frames.length - 1];
  const p5 = [last[12], last[13], last[14]];
  check('two panels fold 90°: completed', r.completed === 10);
  check('two panels fold 90°: node 5 swings to |z|=100', Math.abs(Math.abs(p5[2]) - 100) < 1e-6 && Math.abs(p5[1]) < 1e-6, `p5=${p5.map((v) => v.toFixed(4))}`);
  check('two panels fold 90°: angle reported', Math.abs(Math.abs(r.angles[r.angles.length - 1][0]) - 90) < 1e-6);
  const meas = measureFoldAngles(m, last).get(m.hinges[0].id)!;
  check('two panels fold 90°: measured angle equals variable', Math.abs(meas - r.angles[r.angles.length - 1][0]) < 1e-6, `${meas.toFixed(6)}`);
}

{
  const R = 100;
  const deg = [0, 60, 170, 290];
  const dirs = deg.map((d) => (d * Math.PI) / 180);
  const nodes: NodeDef[] = [{ id: 1, xyz: [0, 0, 0] }];
  dirs.forEach((a, i) => nodes.push({ id: 2 + i, xyz: [R * Math.cos(a), R * Math.sin(a), 0] }));
  const panels: PanelDef[] = dirs.map((_, i) => ({ id: `P${i}`, mat: 'm', sec: 't', tris: [[1, 2 + i, 2 + ((i + 1) % 4)]] }));
  const m = base(nodes, panels);
  check('degree-4 vertex: 4 hinges', m.hinges.length === 4);
  const flat = analyzeMobility(m, 'P0');
  console.log(`  flat: N=${flat.revolute} Vin=${flat.interiorVertices} predicted=${flat.predicted} nullity=${flat.nullity} flat=${flat.flat}`);
  check('degree-4 vertex: Tachi count N-3V = 1', flat.predicted === 1);
  check('degree-4 vertex: flat state is shaky (nullity 2 > 1)', flat.nullity === 2 && flat.flat);
  const hid = (node: number): string => m.hinges.find((h) => h.edge!.includes(node))!.id;
  for (const sgn of [1, -1]) {
    const r = solveKinematics(m, { ground: 'P0', drivers: [{ hinge: hid(2), angle: 80 }, { hinge: hid(4), angle: 80 * sgn }], steps: 40 });
    check(`degree-4 vertex (sgn=${sgn}): path completed`, r.completed === 40, `res=${r.maxResidual.toExponential(1)}`);
    const fin = measureFoldAngles(m, r.frames[r.frames.length - 1]);
    const rho = [2, 3, 4, 5].map((nd) => (fin.get(hid(nd))! * Math.PI) / 180);
    const th0 = (60 * Math.PI) / 180;
    const th1 = (110 * Math.PI) / 180;
    const sigma = Math.sign(rho[0]) * Math.sign(rho[2]);
    const A = Math.cos(th0) * Math.cos(th1) + sigma;
    const B = Math.sin(th0) * Math.sin(th1);
    const rho1 = Math.acos((A * Math.cos(rho[0]) + B) / (B * Math.cos(rho[0]) + A));
    console.log(`  σ=${sigma}: ρ = ${rho.map((v) => ((v * 180) / Math.PI).toFixed(4)).join(', ')} | Imada–Tachi |ρ1| = ${((rho1 * 180) / Math.PI).toFixed(4)}`);
    check(`degree-4 vertex (σ=${sigma}): ρ2 = σρ0`, Math.abs(rho[2] - sigma * rho[0]) < 1e-6);
    check(`degree-4 vertex (σ=${sigma}): |ρ1| matches Imada–Tachi Eq.1`, Math.abs(Math.abs(rho[1]) - rho1) < 1e-6);
    check(`degree-4 vertex (σ=${sigma}): ρ3 = -σρ1`, Math.abs(rho[3] + sigma * rho[1]) < 1e-6);
    check(`degree-4 vertex (σ=${sigma}): 1 DOF when folded`, r.finalMobility?.nullity === 1, `nullity=${r.finalMobility?.nullity}`);
  }
}

{
  const nx = 4;
  const ny = 4;
  const a = 100;
  const b = 80;
  const c = 40;
  const nodes: NodeDef[] = [];
  const id = (i: number, j: number): number => j * nx + i + 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) nodes.push({ id: id(i, j), xyz: [i * a + (j % 2) * c, j * b, 0] });
  const panels: PanelDef[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      panels.push({ id: `Q${i}_${j}`, mat: 'm', sec: 't', tris: [[id(i, j), id(i + 1, j), id(i + 1, j + 1)], [id(i, j), id(i + 1, j + 1), id(i, j + 1)]] });
    }
  }
  const m = base(nodes, panels);
  check('miura 3x3: 12 hinges', m.hinges.length === 12, `${m.hinges.length}`);
  const between = (p: string, q: string): string => m.hinges.find((h) => h.panels.includes(p) && h.panels.includes(q))!.id;
  let r = solveKinematics(m, { ground: 'Q1_1', drivers: [{ hinge: between('Q1_1', 'Q1_0'), angle: 100 }], steps: 40 });
  check('miura 3x3: single driver follows collinear-crease mode', r.finalMobility?.nullity === 2, `nullity=${r.finalMobility?.nullity}`);
  const t0 = performance.now();
  const mv: Record<string, number> = {};
  const zig = (i: number): number => (i % 2 === 0 ? 1 : -1);
  for (let j = 1; j <= 2; j++) for (let i = 0; i <= 2; i++) mv[between(`Q${i}_${j - 1}`, `Q${i}_${j}`)] = -zig(i) * (j % 2 === 0 ? 1 : -1);
  for (let i = 1; i <= 2; i++) for (let j = 0; j <= 2; j++) mv[between(`Q${i - 1}_${j}`, `Q${i}_${j}`)] = zig(i);
  const prim = between('Q1_0', 'Q1_1');
  r = solveKinematics(m, { ground: 'Q1_1', drivers: [{ hinge: prim, angle: 100 * mv[prim] }], steps: 40, mv });
  const fin = r.angles[r.angles.length - 1];
  const signsOk = m.hinges.every((h, i) => Math.sign(fin[i]) === mv[h.id]);
  console.log(`  ${r.completed}/40, nullity=${r.finalMobility?.nullity}, predicted=${r.finalMobility?.predicted}, ss=${r.finalMobility?.selfStress}, min|ρ|=${Math.min(...Array.from(fin, Math.abs)).toFixed(2)}`);
  const ok = r.completed === 40 && signsOk;
  console.log(`  miura path: ${(performance.now() - t0).toFixed(0)} ms, maxRes ${r.maxResidual.toExponential(1)}`);
  check('miura 3x3: Miura mode reached with MV assignment', ok);
  check(
    'miura 3x3: 1 DOF when folded (predicted 0, 1 self-stress)',
    r.finalMobility?.nullity === 1 && r.finalMobility?.predicted === 0 && r.finalMobility?.selfStress === 1,
    `nullity=${r.finalMobility?.nullity} predicted=${r.finalMobility?.predicted} ss=${r.finalMobility?.selfStress}`
  );
}

if (failed > 0) process.exit(1);
