import { solveModal } from '../src/solvers/eigen';
import { buildSampleModel } from '../src/core/sample';

const model = buildSampleModel();
for (const type of ['constrained', 'free'] as const) {
  const t0 = performance.now();
  const r = solveModal(model, { type, nModes: 8 });
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`${type}: nDof=${r.nDof}, ${ms} ms`);
  r.freqs.forEach((f, i) => {
    const e = r.effMass[i].map((v) => (v * 100).toFixed(1)).join('/');
    console.log(`  ${i + 1}: ${r.zero[i] ? '~0 (rigid)' : f.toFixed(3) + ' Hz'}  effmass X/Y/Z ${e} %`);
  });
  console.log('  notes:', r.notes.join(' | '));
}
