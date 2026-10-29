export function cholesky(a: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    let s = a[j * n + j];
    for (let k = 0; k < j; k++) s -= a[j * n + k] * a[j * n + k];
    if (!(s > 0)) return false;
    const d = Math.sqrt(s);
    a[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let t = a[i * n + j];
      for (let k = 0; k < j; k++) t -= a[i * n + k] * a[j * n + k];
      a[i * n + j] = t / d;
    }
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) a[i * n + j] = 0;
  return true;
}

export function forwardSolve(L: Float64Array, B: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const bi = i * n;
    for (let k = 0; k < i; k++) {
      const lik = L[i * n + k];
      if (lik === 0) continue;
      const bk = k * n;
      for (let c = 0; c < n; c++) B[bi + c] -= lik * B[bk + c];
    }
    const inv = 1 / L[i * n + i];
    for (let c = 0; c < n; c++) B[bi + c] *= inv;
  }
}

export function transposeInPlace(a: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const t = a[i * n + j];
      a[i * n + j] = a[j * n + i];
      a[j * n + i] = t;
    }
  }
}

export function standardForm(K: Float64Array, L: Float64Array, n: number): Float64Array {
  const A = new Float64Array(K);
  forwardSolve(L, A, n);
  transposeInPlace(A, n);
  forwardSolve(L, A, n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = 0.5 * (A[i * n + j] + A[j * n + i]);
      A[i * n + j] = v;
      A[j * n + i] = v;
    }
  }
  return A;
}

export function backSolveVec(L: Float64Array, y: Float64Array, n: number): Float64Array {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

export function solveDense(a: Float64Array, b: Float64Array, n: number, m: number): Float64Array {
  const A = new Float64Array(a);
  const X = new Float64Array(b);
  let trace = 0;
  for (let i = 0; i < n; i++) trace += Math.abs(A[i * n + i]);
  const eps = 1e-12 * (trace || 1);
  for (let c = 0; c < n; c++) {
    let p = c;
    let best = Math.abs(A[c * n + c]);
    for (let r = c + 1; r < n; r++) {
      const v = Math.abs(A[r * n + c]);
      if (v > best) {
        best = v;
        p = r;
      }
    }
    if (best < eps) {
      A[c * n + c] += eps;
      p = c;
    }
    if (p !== c) {
      for (let j = 0; j < n; j++) {
        const t = A[c * n + j];
        A[c * n + j] = A[p * n + j];
        A[p * n + j] = t;
      }
      for (let j = 0; j < m; j++) {
        const t = X[c * m + j];
        X[c * m + j] = X[p * m + j];
        X[p * m + j] = t;
      }
    }
    const piv = A[c * n + c];
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / piv;
      if (f === 0) continue;
      for (let j = c; j < n; j++) A[r * n + j] -= f * A[c * n + j];
      for (let j = 0; j < m; j++) X[r * m + j] -= f * X[c * m + j];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    for (let j = 0; j < m; j++) {
      let s = X[r * m + j];
      for (let k = r + 1; k < n; k++) s -= A[r * n + k] * X[k * m + j];
      X[r * m + j] = s / A[r * n + r];
    }
  }
  return X;
}

function tred2(V: Float64Array, d: Float64Array, e: Float64Array, n: number): void {
  for (let j = 0; j < n; j++) d[j] = V[(n - 1) * n + j];
  for (let i = n - 1; i > 0; i--) {
    let scale = 0;
    let h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) {
        d[j] = V[(i - 1) * n + j];
        V[i * n + j] = 0;
        V[j * n + i] = 0;
      }
    } else {
      for (let k = 0; k < i; k++) {
        d[k] /= scale;
        h += d[k] * d[k];
      }
      let f = d[i - 1];
      let g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g;
      h -= f * g;
      d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j];
        V[j * n + i] = f;
        g = e[j] + V[j * n + j] * f;
        for (let k = j + 1; k <= i - 1; k++) {
          g += V[k * n + j] * d[k];
          e[k] += V[k * n + j] * f;
        }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) {
        e[j] /= h;
        f += e[j] * d[j];
      }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j];
        g = e[j];
        for (let k = j; k <= i - 1; k++) V[k * n + j] -= f * e[k] + g * d[k];
        d[j] = V[(i - 1) * n + j];
        V[i * n + j] = 0;
      }
    }
    d[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    V[(n - 1) * n + i] = V[i * n + i];
    V[i * n + i] = 1;
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = V[k * n + i + 1] / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += V[k * n + i + 1] * V[k * n + j];
        for (let k = 0; k <= i; k++) V[k * n + j] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k++) V[k * n + i + 1] = 0;
  }
  for (let j = 0; j < n; j++) {
    d[j] = V[(n - 1) * n + j];
    V[(n - 1) * n + j] = 0;
  }
  V[(n - 1) * n + n - 1] = 1;
  e[0] = 0;
}

function tql2(V: Float64Array, d: Float64Array, e: Float64Array, n: number): void {
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0;
  let tst1 = 0;
  const eps = Math.pow(2, -52);
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n) {
      if (Math.abs(e[m]) <= eps * tst1) break;
      m++;
    }
    if (m > l) {
      let iter = 0;
      do {
        iter++;
        let g = d[l];
        let p = (d[l + 1] - g) / (2 * e[l]);
        let r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r);
        d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1];
        let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m];
        let c = 1;
        let c2 = c;
        let c3 = c;
        const el1 = e[l + 1];
        let s = 0;
        let s2 = 0;
        for (let i = m - 1; i >= l; i--) {
          c3 = c2;
          c2 = c;
          s2 = s;
          g = c * e[i];
          h = c * p;
          r = Math.hypot(p, e[i]);
          e[i + 1] = s * r;
          s = e[i] / r;
          c = p / r;
          p = c * d[i] - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < n; k++) {
            h = V[k * n + i + 1];
            V[k * n + i + 1] = s * V[k * n + i] + c * h;
            V[k * n + i] = c * V[k * n + i] - s * h;
          }
        }
        p = (-s * s2 * c3 * el1 * e[l]) / dl1;
        e[l] = s * p;
        d[l] = c * p;
        if (iter > 200) throw new Error('고유치 계산이 수렴하지 않았습니다.');
      } while (Math.abs(e[l]) > eps * tst1);
    }
    d[l] += f;
    e[l] = 0;
  }
  for (let i = 0; i < n - 1; i++) {
    let k = i;
    let p = d[i];
    for (let j = i + 1; j < n; j++) {
      if (d[j] < p) {
        k = j;
        p = d[j];
      }
    }
    if (k !== i) {
      d[k] = d[i];
      d[i] = p;
      for (let j = 0; j < n; j++) {
        const t = V[j * n + i];
        V[j * n + i] = V[j * n + k];
        V[j * n + k] = t;
      }
    }
  }
}

export function symmetricEigen(a: Float64Array, n: number): { values: Float64Array; vectors: Float64Array } {
  const V = new Float64Array(a);
  const d = new Float64Array(n);
  const e = new Float64Array(n);
  if (n === 1) {
    d[0] = V[0];
    V[0] = 1;
    return { values: d, vectors: V };
  }
  tred2(V, d, e, n);
  tql2(V, d, e, n);
  return { values: d, vectors: V };
}
