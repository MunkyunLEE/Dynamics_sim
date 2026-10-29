import type { BarDef, NodeDef, StructuralModel } from './model';

export function buildSampleModel(): StructuralModel {
  const lx = 6000;
  const ly = 4000;
  const h = 3500;
  const corners: [number, number][] = [
    [0, 0],
    [lx, 0],
    [lx, ly],
    [0, ly]
  ];

  const nodes: NodeDef[] = [];
  for (let level = 0; level <= 2; level++) {
    corners.forEach(([x, y], c) => {
      nodes.push({ id: level * 4 + c + 1, xyz: [x, y, level * h] });
    });
  }

  const bars: BarDef[] = [];
  let barId = 1;
  for (let level = 0; level < 2; level++) {
    for (let c = 0; c < 4; c++) {
      bars.push({
        id: barId++,
        n: [level * 4 + c + 1, (level + 1) * 4 + c + 1],
        mat: 'steel',
        sec: 'column',
        orient: [1, 0, 0]
      });
    }
  }
  for (let level = 1; level <= 2; level++) {
    for (let c = 0; c < 4; c++) {
      bars.push({
        id: barId++,
        n: [level * 4 + c + 1, level * 4 + ((c + 1) % 4) + 1],
        mat: 'steel',
        sec: 'beam'
      });
    }
  }

  return {
    units: { length: 'mm', force: 'N', mass: 'tonne', time: 's' },
    materials: [
      { id: 'steel', E: 205000, nu: 0.3, rho: 7.85e-9 },
      { id: 'concrete', E: 30000, nu: 0.2, rho: 2.5e-9 }
    ],
    sections: [
      { id: 'column', type: 'bar', A: 15000, Iy: 3.5e8, Iz: 3.5e8, J: 5e8 },
      { id: 'beam', type: 'bar', A: 9000, Iy: 2.0e8, Iz: 4.0e7, J: 1.0e7 },
      { id: 'slab', type: 'shell', thickness: 150 }
    ],
    nodes,
    bars,
    panels: [
      {
        id: 'P1',
        mat: 'concrete',
        sec: 'slab',
        tris: [
          [9, 10, 11],
          [9, 11, 12]
        ]
      }
    ],
    hinges: [],
    masses: [9, 10, 11, 12].map((node) => ({ node, m: 2, I: [0, 0, 0] as [number, number, number] })),
    supports: [1, 2, 3, 4].map((node) => ({ node, dof: [1, 1, 1, 1, 1, 1] as [number, number, number, number, number, number] })),
    damping: { mode: 'modal', xi: 0.05, rayleigh: null }
  };
}
