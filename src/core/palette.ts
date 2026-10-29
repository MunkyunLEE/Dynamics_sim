import type { StructuralModel } from './model';

const COLORS = [0x4da3ff, 0xff7a59, 0x51cf66, 0xffd43b, 0xcc5de8, 0x22b8cf, 0xff6b9d, 0x94d82d, 0xf59f00, 0x748ffc, 0x20c997, 0xe64980];

export function paletteColor(i: number): number {
  return COLORS[i % COLORS.length];
}

export function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export function sectionColors(model: StructuralModel): Map<string, number> {
  const out = new Map<string, number>();
  let i = 0;
  for (const s of model.sections) {
    if (s.type === 'bar') out.set(s.id, paletteColor(i++));
  }
  return out;
}
