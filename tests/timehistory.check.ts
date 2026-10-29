import { buildSampleModel } from '../src/core/sample';
import { assemble } from '../src/fem/assemble';
import { solveDense } from '../src/fem/linalg';
import { solveTimeHistory } from '../src/solvers/timeHistory';
import { fftAmplitude, responseSpectrum, sdofPiecewise } from '../src/solvers/dsp';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${detail}`);
  if (!ok) failed++;
}

{
  const w = 2 * Math.PI * 2;
  const dt = 0.002;
  const n = 4000;
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = Math.sin(2 * Math.PI * 3.1 * i * dt) + 0.4 * Math.sin(2 * Math.PI * 7.3 * i * dt);
  const r = sdofPiecewise(f, dt, w, 0.05);
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  const a = new Float64Array(n);
  a[0] = f[0];
  const beta = 0.25;
  const gamma = 0.5;
  const h = dt / 20;
  const sub = 20;
  let uu = 0;
  let vv = 0;
  let aa = f[0];
  const c = 2 * 0.05 * w;
  for (let i = 1; i < n; i++) {
    for (let s = 1; s <= sub; s++) {
      const fi = f[i - 1] + ((f[i] - f[i - 1]) * s) / sub;
      const kh = w * w + (gamma / (beta * h)) * c + 1 / (beta * h * h);
      const p =
        fi +
        (1 / (beta * h * h) * uu + 1 / (beta * h) * vv + (1 / (2 * beta) - 1) * aa) +
        c * (gamma / (beta * h) * uu + (gamma / beta - 1) * vv + h * (gamma / (2 * beta) - 1) * aa);
      const un = p / kh;
      const an = (un - uu) / (beta * h * h) - vv / (beta * h) - (1 / (2 * beta) - 1) * aa;
      const vn = vv + h * ((1 - gamma) * aa + gamma * an);
      uu = un;
      vv = vn;
      aa = an;
    }
    u[i] = uu;
    v[i] = vv;
    a[i] = aa;
  }
  let err = 0;
  let ref = 0;
  for (let i = 0; i < n; i++) {
    err = Math.max(err, Math.abs(u[i] - r.u[i]));
    ref = Math.max(ref, Math.abs(u[i]));
  }
  check('sdof piecewise vs fine Newmark', err < 2e-3 * ref, `err=${err.toExponential(2)} ref=${ref.toExponential(2)}`);
}

{
  const dt = 0.01;
  const n = 4096;
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sin(2 * Math.PI * 5 * i * dt);
  const fr = fftAmplitude(s, dt);
  let k = 0;
  for (let i = 1; i < fr.amp.length; i++) if (fr.amp[i] > fr.amp[k]) k = i;
  check('fft peak frequency', Math.abs(fr.freqs[k] - 5) < 0.05, `f=${fr.freqs[k].toFixed(3)}`);
  const sp = responseSpectrum(s, dt, 0.02, Float64Array.from([5, 1, 20]));
  check('spectrum largest at resonance', sp.sa[0] > sp.sa[1] && sp.sa[0] > sp.sa[2], `${sp.sa[0].toFixed(1)}`);
}

{
  const model = buildSampleModel();
  model.damping = { mode: 'rayleigh', xi: 0, rayleigh: { alpha: 0, beta: 0.002 } };
  const supportIds = model.supports.map((s) => s.node);
  model.inputNodes = supportIds;
  const top = model.nodes.reduce((b, nd) => (nd.xyz[2] > b.xyz[2] ? nd : b));
  model.outputNodes = [top.id];
  const dt = 0.005;
  const n = 1200;
  const ax = new Float64Array(n);
  for (let i = 0; i < n; i++) ax[i] = 2000 * Math.sin(2 * Math.PI * 5.06 * i * dt) * Math.min(1, i / 100);
  const res = solveTimeHistory(model, { dt, acc: [ax, new Float64Array(n), new Float64Array(n)] }, { nModes: 500, massTarget: 1.1 });
  const ch = res.channels.find((c) => c.dir === 0)!;

  const asm = assemble(model, false);
  const fixed = new Set<number>();
  for (const s of model.supports) {
    const ni = asm.nodeIndex.get(s.node)!;
    for (let d = 0; d < 6; d++) fixed.add(ni * 6 + d);
  }
  const free: number[] = [];
  asm.active.forEach((g, r) => {
    if (!fixed.has(g)) free.push(r);
  });
  const nf = free.length;
  const N = asm.n;
  const K = new Float64Array(nf * nf);
  const M = new Float64Array(nf * nf);
  const P = new Float64Array(nf);
  for (let i = 0; i < nf; i++) {
    for (let j = 0; j < nf; j++) {
      K[i * nf + j] = asm.K[free[i] * N + free[j]];
      M[i * nf + j] = asm.M[free[i] * N + free[j]];
    }
    let s = 0;
    for (let j = 0; j < N; j++) if (asm.active[j] % 6 === 0) s += asm.M[free[i] * N + j];
    P[i] = -s;
  }
  const beta = 0.002;
  const kEff = new Float64Array(nf * nf);
  const h = dt / 5;
  const bn = 0.25;
  const gm = 0.5;
  for (let i = 0; i < nf * nf; i++) kEff[i] = K[i] + (gm / (bn * h)) * beta * K[i] + M[i] / (bn * h * h);
  const u = new Float64Array(nf);
  const v = new Float64Array(nf);
  const a = solveDense(M, Float64Array.from(P, (p) => p * ax[0]), nf, 1);
  const topFree = free.findIndex((r) => asm.active[r] === asm.nodeIndex.get(top.id)! * 6);
  let maxDirect = 0;
  let maxModal = 0;
  let diff = 0;
  for (let i = 1; i < n; i++) {
    for (let s = 1; s <= 5; s++) {
      const fa = ax[i - 1] + ((ax[i] - ax[i - 1]) * s) / 5;
      const rhs = new Float64Array(nf);
      for (let p = 0; p < nf; p++) {
        let acc1 = 0;
        let acc2 = 0;
        for (let q = 0; q < nf; q++) {
          const cu = (gm / (bn * h)) * u[q] + (gm / bn - 1) * v[q] + h * (gm / (2 * bn) - 1) * a[q];
          acc1 += beta * K[p * nf + q] * cu;
          const mu = u[q] / (bn * h * h) + v[q] / (bn * h) + (1 / (2 * bn) - 1) * a[q];
          acc2 += M[p * nf + q] * mu;
        }
        rhs[p] = P[p] * fa + acc1 + acc2;
      }
      const un = solveDense(kEff, rhs, nf, 1);
      for (let p = 0; p < nf; p++) {
        const an = (un[p] - u[p]) / (bn * h * h) - v[p] / (bn * h) - (1 / (2 * bn) - 1) * a[p];
        v[p] = v[p] + h * ((1 - gm) * a[p] + gm * an);
        a[p] = an;
        u[p] = un[p];
      }
    }
    const absDirect = a[topFree] + ax[i];
    maxDirect = Math.max(maxDirect, Math.abs(absDirect));
    maxModal = Math.max(maxModal, Math.abs(ch.acc[i]));
    diff = Math.max(diff, Math.abs(absDirect - ch.acc[i]));
  }
  console.log(`  modes used ${res.usedModes}/${res.totalModes}, peak abs acc direct ${maxDirect.toFixed(1)} modal ${maxModal.toFixed(1)}`);
  check('top abs acc: modal superposition vs direct Newmark', diff < 0.02 * maxDirect, `maxdiff=${diff.toFixed(2)}`);
  check('input node output equals ground acc', res.channels.length === 3);
}

if (failed > 0) process.exit(1);
