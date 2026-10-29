import { equivalentProps, inverseFromStory, shapeProps, shearModulus, stiffnessOf, storyStiffness } from '../src/core/sections';
import { checkClosedShell } from '../src/geometry/closedShell';
import { buildSampleModel } from '../src/core/sample';
import { setNodeMass, setNodeSupport, setPanelThickness, upsertBarSection } from '../src/core/edit';
import { sameHeightNodes, sameLevelBars } from '../src/core/selection';
import type { StructuralModel } from '../src/core/model';

let failed = false;
function near(name: string, got: number, expect: number, tol = 1e-6): void {
  const err = Math.abs(got - expect) / Math.max(Math.abs(expect), 1e-30);
  const ok = err < tol;
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: got ${got.toPrecision(6)}, expect ${expect.toPrecision(6)}`);
}
function truthy(name: string, cond: boolean): void {
  if (!cond) failed = true;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}`);
}

const rect = shapeProps({ type: 'rect', dims: [10, 10] });
near('rect A', rect.A, 100);
near('rect Iy', rect.Iy, 10 ** 4 / 12);
near('rect J (approx 1406)', rect.J, 1406, 0.01);

const circ = shapeProps({ type: 'circle', dims: [100] });
near('circle I', circ.Iy, (Math.PI * 100 ** 4) / 64);
near('circle J = 2I', circ.J, 2 * circ.Iy);

const pipe = shapeProps({ type: 'pipe', dims: [100, 5] });
near('pipe A', pipe.A, (Math.PI * (100 ** 2 - 90 ** 2)) / 4);

const rhs = shapeProps({ type: 'rhs', dims: [200, 200, 10] });
near('rhs A', rhs.A, 200 * 200 - 180 * 180);
near('rhs Iy', rhs.Iy, (200 ** 4 - 180 ** 4) / 12);

const h = shapeProps({ type: 'h', dims: [400, 200, 8, 13] });
near('H A', h.A, 2 * 200 * 13 + 374 * 8);
near('H Iy', h.Iy, (200 * 400 ** 3 - 192 * 374 ** 3) / 12);

const E = 205000;
const G = shearModulus(E, 0.3);
const eq = equivalentProps({ EA: E * 5000, EIy: E * 2e7, EIz: E * 1e7, GJ: G * 3e6 }, E, G);
near('equivalent A', eq.A, 5000);
near('equivalent J', eq.J, 3e6);
const back = stiffnessOf(eq, E, G);
near('stiffness roundtrip EIz', back.EIz, E * 1e7);

const args = { count: 4, height: 3500, E, boundary: 'fixed' as const };
const cur = { A: 15000, Iy: 3.5e8, Iz: 3.5e8, J: 5e8 };
const k = storyStiffness(cur, args);
near('story K1', k.K1, (4 * 12 * E * 3.5e8) / 3500 ** 3);
const inv = inverseFromStory({ K1: k.K1, K2: k.K2 * 2 }, args, cur);
near('inverse Iy roundtrip', inv.Iy, cur.Iy);
near('inverse Iz doubled', inv.Iz, cur.Iz * 2);
near('inverse A unchanged', inv.A, cur.A);

const model: StructuralModel = buildSampleModel();
const lvl = sameLevelBars(model, [0]);
truthy('same-level columns of story 1 = 4 bars', lvl.size === 4);
const beams = sameLevelBars(model, [8]);
truthy('same-level beams at z=3500 = 4 bars', beams.size === 4);
truthy('same-height nodes at base = 4', sameHeightNodes(model, [0]).size === 4);

upsertBarSection(model, '1F_COL', { A: 1, Iy: 2, Iz: 3, J: 4 });
truthy('section added', model.sections.some((s) => s.id === '1F_COL'));
setNodeSupport(model, [0, 1], [1, 1, 1, 0, 0, 0]);
truthy('support replaced on nodes 1,2', model.supports.filter((s) => s.node <= 2).every((s) => s.dof[3] === 0));
setNodeMass(model, [8], 5, [0, 0, 0]);
truthy('mass replaced on node 9', model.masses.find((m) => m.node === 9)?.m === 5);
setPanelThickness(model, [0], 200);
truthy('shell thickness section created', model.sections.some((s) => s.type === 'shell' && s.thickness === 200));

const cube: StructuralModel = {
  ...buildSampleModel(),
  nodes: [
    [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
    [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]
  ].map((xyz, i) => ({ id: i + 1, xyz: xyz as [number, number, number] })),
  panels: [
    {
      id: 'cube',
      mat: 'steel',
      sec: 'slab',
      tris: [
        [1, 3, 2], [1, 4, 3],
        [5, 6, 7], [5, 7, 8],
        [1, 2, 6], [1, 6, 5],
        [2, 3, 7], [2, 7, 6],
        [3, 4, 8], [3, 8, 7],
        [4, 1, 5], [4, 5, 8]
      ]
    }
  ]
};
const cc = checkClosedShell(cube, 0);
truthy('cube closed', cc.closed);
truthy('cube orientation consistent', cc.consistent);
near('cube volume', Math.abs(cc.volume), 1000);
near('cube area', cc.area, 600);
cube.panels[0].tris.pop();
truthy('cube minus one tri is open', !checkClosedShell(cube, 0).closed);

process.exit(failed ? 1 : 0);
