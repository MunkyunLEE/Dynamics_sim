export const UNITS = {
  length: 'mm',
  force: 'N',
  mass: 'tonne',
  time: 's'
} as const;

export const GRAVITY = 9810;

export const UNIT_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['길이', 'mm'],
  ['힘', 'N'],
  ['질량', 'tonne (10³ kg)'],
  ['시간', 's'],
  ['응력 / 탄성계수', 'MPa (N/mm²)'],
  ['밀도', 'tonne/mm³'],
  ['가속도', 'mm/s²'],
  ['중력가속도', `${GRAVITY} mm/s²`],
  ['모멘트', 'N·mm'],
  ['진동수', 'Hz']
];
