import type { ShapeSpec, ShapeType } from './model';

export interface SectionProps {
  A: number;
  Iy: number;
  Iz: number;
  J: number;
}

export interface Stiffness {
  EA: number;
  EIy: number;
  EIz: number;
  GJ: number;
}

export type BoundaryCase = 'fixed' | 'cantilever';

export const BOUNDARY_COEF: Record<BoundaryCase, number> = { fixed: 12, cantilever: 3 };

export const SHAPE_INFO: Record<ShapeType, { label: string; dims: string[]; defaults: number[] }> = {
  rect: { label: '사각 중실', dims: ['폭 b (국부 y)', '춤 h (국부 z)'], defaults: [300, 300] },
  rhs: { label: '사각 중공', dims: ['폭 b (국부 y)', '춤 h (국부 z)', '두께 t'], defaults: [300, 300, 12] },
  circle: { label: '원형 중실', dims: ['지름 d'], defaults: [200] },
  pipe: { label: '원형 파이프', dims: ['바깥지름 d', '두께 t'], defaults: [300, 10] },
  h: { label: 'H형강', dims: ['춤 H', '플랜지 폭 B', '웨브 두께 tw', '플랜지 두께 tf'], defaults: [400, 200, 8, 13] }
};

function positive(dims: number[], count: number): void {
  if (dims.length < count) throw new Error('치수가 부족합니다.');
  for (let i = 0; i < count; i++) {
    if (!(dims[i] > 0) || !Number.isFinite(dims[i])) throw new Error('치수는 0보다 큰 숫자여야 합니다.');
  }
}

export function shapeProps(spec: ShapeSpec): SectionProps {
  const d = spec.dims;
  switch (spec.type) {
    case 'rect': {
      positive(d, 2);
      const [b, h] = d;
      const a = Math.max(b, h);
      const c = Math.min(b, h);
      const J = a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4)));
      return { A: b * h, Iy: (b * h ** 3) / 12, Iz: (h * b ** 3) / 12, J };
    }
    case 'rhs': {
      positive(d, 3);
      const [b, h, t] = d;
      if (2 * t >= Math.min(b, h)) throw new Error('두께 t가 너무 큽니다.');
      const bi = b - 2 * t;
      const hi = h - 2 * t;
      const am = (b - t) * (h - t);
      const p = 2 * ((b - t) + (h - t));
      return {
        A: b * h - bi * hi,
        Iy: (b * h ** 3 - bi * hi ** 3) / 12,
        Iz: (h * b ** 3 - hi * bi ** 3) / 12,
        J: (4 * am * am * t) / p
      };
    }
    case 'circle': {
      positive(d, 1);
      const dd = d[0];
      const I = (Math.PI * dd ** 4) / 64;
      return { A: (Math.PI * dd * dd) / 4, Iy: I, Iz: I, J: 2 * I };
    }
    case 'pipe': {
      positive(d, 2);
      const [dd, t] = d;
      if (2 * t >= dd) throw new Error('두께 t가 너무 큽니다.');
      const di = dd - 2 * t;
      const I = (Math.PI * (dd ** 4 - di ** 4)) / 64;
      return { A: (Math.PI * (dd * dd - di * di)) / 4, Iy: I, Iz: I, J: 2 * I };
    }
    case 'h': {
      positive(d, 4);
      const [H, B, tw, tf] = d;
      if (2 * tf >= H || tw >= B) throw new Error('웨브/플랜지 두께가 치수에 비해 너무 큽니다.');
      const hw = H - 2 * tf;
      return {
        A: 2 * B * tf + hw * tw,
        Iy: (B * H ** 3 - (B - tw) * hw ** 3) / 12,
        Iz: (2 * tf * B ** 3 + hw * tw ** 3) / 12,
        J: (2 * B * tf ** 3 + hw * tw ** 3) / 3
      };
    }
  }
}

export function shearModulus(E: number, nu: number): number {
  return E / (2 * (1 + nu));
}

export function equivalentProps(k: Stiffness, E: number, G: number): SectionProps {
  return { A: k.EA / E, Iy: k.EIy / E, Iz: k.EIz / E, J: k.GJ / G };
}

export function stiffnessOf(p: SectionProps, E: number, G: number): Stiffness {
  return { EA: E * p.A, EIy: E * p.Iy, EIz: E * p.Iz, GJ: G * p.J };
}

export interface StoryArgs {
  count: number;
  height: number;
  E: number;
  boundary: BoundaryCase;
}

export function storyStiffness(p: SectionProps, a: StoryArgs): { K1: number; K2: number; Kax: number } {
  const c = BOUNDARY_COEF[a.boundary];
  return {
    K1: (a.count * c * a.E * p.Iy) / a.height ** 3,
    K2: (a.count * c * a.E * p.Iz) / a.height ** 3,
    Kax: (a.count * a.E * p.A) / a.height
  };
}

export function inverseFromStory(
  target: { K1?: number; K2?: number; Kax?: number },
  a: StoryArgs,
  current: SectionProps
): SectionProps {
  const c = BOUNDARY_COEF[a.boundary];
  const out = { ...current };
  if (target.K1 !== undefined) out.Iy = (target.K1 * a.height ** 3) / (a.count * c * a.E);
  if (target.K2 !== undefined) out.Iz = (target.K2 * a.height ** 3) / (a.count * c * a.E);
  if (target.Kax !== undefined) out.A = (target.Kax * a.height) / (a.count * a.E);
  const oldSum = current.Iy + current.Iz;
  if (oldSum > 0) out.J = (current.J * (out.Iy + out.Iz)) / oldSum;
  return out;
}

export function validateProps(p: SectionProps): void {
  for (const v of [p.A, p.Iy, p.Iz, p.J]) {
    if (!(v > 0) || !Number.isFinite(v)) throw new Error('A, Iy, Iz, J는 모두 0보다 큰 값이어야 합니다.');
  }
}
