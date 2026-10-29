export type AccUnit = 'g' | 'mm/s2' | 'm/s2' | 'gal';

export const ACC_FACTOR: Record<AccUnit, number> = {
  g: 9806.65,
  'mm/s2': 1,
  'm/s2': 1000,
  gal: 10
};

export interface Motion {
  dt: number;
  n: number;
  duration: number;
  acc: [Float64Array, Float64Array, Float64Array];
  columns: number;
  resampled: boolean;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function parseMotion(text: string, unit: AccUnit, scale: number, tail: number): Motion {
  const rows: number[][] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[\s,;]+/).filter((p) => p !== '');
    const nums = parts.map(Number);
    if (nums.some((v) => !Number.isFinite(v))) {
      if (rows.length === 0) continue;
      throw new Error(`숫자가 아닌 값이 있는 행: "${t.slice(0, 40)}"`);
    }
    rows.push(nums);
  }
  if (rows.length < 3) throw new Error('데이터 행이 부족합니다 (t, ax, ay, az 형식의 CSV가 필요합니다).');
  const columns = rows[0].length;
  if (columns < 2) throw new Error('열이 2개 이상 필요합니다 (시간, 가속도).');
  if (rows.some((r) => r.length !== columns)) throw new Error('행마다 열 개수가 다릅니다.');

  const t = rows.map((r) => r[0]);
  const dts: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const d = t[i] - t[i - 1];
    if (!(d > 0)) throw new Error(`시간이 증가하지 않습니다 (행 ${i + 1}).`);
    dts.push(d);
  }
  const dt = median(dts);
  const uniform = dts.every((d) => Math.abs(d - dt) < 1e-3 * dt);
  const factor = ACC_FACTOR[unit] * scale;

  const count = uniform ? rows.length : Math.floor((t[t.length - 1] - t[0]) / dt) + 1;
  const tailN = Math.max(0, Math.round(tail / dt));
  const total = count + tailN;
  const acc: [Float64Array, Float64Array, Float64Array] = [new Float64Array(total), new Float64Array(total), new Float64Array(total)];
  for (let c = 0; c < Math.min(3, columns - 1); c++) {
    if (uniform) {
      for (let i = 0; i < count; i++) acc[c][i] = rows[i][c + 1] * factor;
    } else {
      let j = 0;
      for (let i = 0; i < count; i++) {
        const ti = t[0] + i * dt;
        while (j < t.length - 2 && t[j + 1] < ti) j++;
        const r = (ti - t[j]) / (t[j + 1] - t[j]);
        acc[c][i] = (rows[j][c + 1] * (1 - r) + rows[j + 1][c + 1] * r) * factor;
      }
    }
  }
  return { dt, n: total, duration: (total - 1) * dt, acc, columns, resampled: !uniform };
}
