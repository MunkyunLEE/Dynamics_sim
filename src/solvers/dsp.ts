export interface SdofResult {
  u: Float64Array;
  v: Float64Array;
  a: Float64Array;
}

export function sdofPiecewise(force: Float64Array, dt: number, omega: number, xi: number): SdofResult {
  const n = force.length;
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  const a = new Float64Array(n);
  const z = Math.min(Math.max(xi, 0), 0.999);
  const sq = Math.sqrt(1 - z * z);
  const wd = omega * sq;
  const e = Math.exp(-z * omega * dt);
  const s = Math.sin(wd * dt);
  const c = Math.cos(wd * dt);
  const w2 = omega * omega;
  const A = e * ((z / sq) * s + c);
  const B = (e / wd) * s;
  const C = (1 / w2) * ((2 * z) / (omega * dt) + e * (((1 - 2 * z * z) / (wd * dt) - z / sq) * s - (1 + (2 * z) / (omega * dt)) * c));
  const D = (1 / w2) * (1 - (2 * z) / (omega * dt) + e * (((2 * z * z - 1) / (wd * dt)) * s + ((2 * z) / (omega * dt)) * c));
  const A1 = -e * (omega / sq) * s;
  const B1 = e * (c - (z / sq) * s);
  const C1 = (1 / w2) * (-1 / dt + e * ((omega / sq + z / (dt * sq)) * s + c / dt));
  const D1 = (1 / (w2 * dt)) * (1 - e * ((z / sq) * s + c));
  a[0] = force[0];
  for (let i = 0; i < n - 1; i++) {
    u[i + 1] = A * u[i] + B * v[i] + C * force[i] + D * force[i + 1];
    v[i + 1] = A1 * u[i] + B1 * v[i] + C1 * force[i] + D1 * force[i + 1];
    a[i + 1] = force[i + 1] - 2 * z * omega * v[i + 1] - w2 * u[i + 1];
  }
  return { u, v, a };
}

export interface SpectrumResult {
  periods: Float64Array;
  freqs: Float64Array;
  sa: Float64Array;
  sv: Float64Array;
  sd: Float64Array;
}

export function logSpace(a: number, b: number, count: number): Float64Array {
  const out = new Float64Array(count);
  const la = Math.log(a);
  const lb = Math.log(b);
  for (let i = 0; i < count; i++) out[i] = Math.exp(la + ((lb - la) * i) / (count - 1));
  return out;
}

export function responseSpectrum(acc: Float64Array, dt: number, xi: number, freqs: Float64Array): SpectrumResult {
  const n = acc.length;
  const neg = new Float64Array(n);
  for (let i = 0; i < n; i++) neg[i] = -acc[i];
  const sa = new Float64Array(freqs.length);
  const sv = new Float64Array(freqs.length);
  const sd = new Float64Array(freqs.length);
  const periods = new Float64Array(freqs.length);
  const z = Math.min(Math.max(xi, 0), 0.999);
  freqs.forEach((f, k) => {
    const w = 2 * Math.PI * f;
    periods[k] = 1 / f;
    const r = sdofPiecewise(neg, dt, w, z);
    let pa = 0;
    let pv = 0;
    let pd = 0;
    for (let i = 0; i < n; i++) {
      const abs = Math.abs(-2 * z * w * r.v[i] - w * w * r.u[i]);
      if (abs > pa) pa = abs;
      if (Math.abs(r.v[i]) > pv) pv = Math.abs(r.v[i]);
      if (Math.abs(r.u[i]) > pd) pd = Math.abs(r.u[i]);
    }
    sa[k] = pa;
    sv[k] = pv;
    sd[k] = pd;
  });
  return { periods, freqs, sa, sv, sd };
}

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface FftResult {
  freqs: Float64Array;
  amp: Float64Array;
}

export function fftAmplitude(signal: Float64Array, dt: number): FftResult {
  const n = signal.length;
  let size = 1;
  while (size < n) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n || 1;
  for (let i = 0; i < n; i++) re[i] = signal[i] - mean;
  fftInPlace(re, im);
  const half = size / 2;
  const freqs = new Float64Array(half + 1);
  const amp = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    freqs[k] = k / (size * dt);
    amp[k] = (Math.hypot(re[k], im[k]) * dt);
  }
  return { freqs, amp };
}

export function peakAbs(x: Float64Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > p) p = Math.abs(x[i]);
  return p;
}
