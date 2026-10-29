import type { NodeDef, PanelDef, StructuralModel } from './model';
import { createHinges, detectHingeCandidates } from './hinges';

export function buildMiuraSample(): StructuralModel {
  const nx = 5;
  const ny = 5;
  const a = 200;
  const b = 160;
  const c = 80;
  const nodes: NodeDef[] = [];
  const id = (i: number, j: number): number => j * nx + i + 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) nodes.push({ id: id(i, j), xyz: [i * a + (j % 2) * c, j * b, 0] });
  const panels: PanelDef[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      panels.push({
        id: `Q${i}_${j}`,
        mat: 'aluminum',
        sec: 't2',
        tris: [
          [id(i, j), id(i + 1, j), id(i + 1, j + 1)],
          [id(i, j), id(i + 1, j + 1), id(i, j + 1)]
        ]
      });
    }
  }
  const model: StructuralModel = {
    units: { length: 'mm', force: 'N', mass: 'tonne', time: 's' },
    materials: [{ id: 'aluminum', E: 70000, nu: 0.33, rho: 2.7e-9 }],
    sections: [{ id: 't2', type: 'shell', thickness: 2 }],
    nodes,
    bars: [],
    panels,
    hinges: [],
    masses: [],
    supports: [],
    damping: { mode: 'modal', xi: 0.02, rayleigh: null }
  };
  createHinges(model, detectHingeCandidates(model), 'free');
  const zig = (i: number): number => (i % 2 === 0 ? 1 : -1);
  const find = (p: string, q: string) => model.hinges.find((h) => h.panels.includes(p) && h.panels.includes(q))!;
  for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) find(`Q${i}_${j - 1}`, `Q${i}_${j}`).mv = -zig(i) * (j % 2 === 0 ? 1 : -1);
  for (let i = 1; i < nx - 1; i++) for (let j = 0; j < ny - 1; j++) find(`Q${i - 1}_${j}`, `Q${i}_${j}`).mv = zig(i);
  const driver = find('Q1_1', 'Q1_2');
  model.kinematics = { ground: 'Q1_1', drivers: [{ hinge: driver.id, angle: 120 * (driver.mv ?? 1) }], steps: 60 };
  return model;
}
