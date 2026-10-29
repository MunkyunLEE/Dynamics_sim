export type Vec3 = [number, number, number];
export type Flag6 = [number, number, number, number, number, number];
export type Release3 = [number, number, number];

export interface Material {
  id: string;
  E: number;
  nu: number;
  rho: number;
}

export interface BarSection {
  id: string;
  type: 'bar';
  A: number;
  Iy: number;
  Iz: number;
  J: number;
}

export interface ShellSection {
  id: string;
  type: 'shell';
  thickness: number;
}

export type Section = BarSection | ShellSection;

export interface NodeDef {
  id: number;
  xyz: Vec3;
}

export interface BarDef {
  id: number;
  n: [number, number];
  mat: string;
  sec: string;
  release?: [Release3, Release3];
  orient?: Vec3;
}

export interface PanelDef {
  id: string;
  mat: string;
  sec: string;
  tris: [number, number, number][];
}

export type HingeType = 'rigid' | 'free' | 'spring' | 'none';

export interface HingeDef {
  id: string;
  panels: [string, string];
  type: HingeType;
  ktheta?: number;
  refAngle?: number;
}

export interface MassDef {
  node: number;
  m: number;
  I?: Vec3;
}

export interface SupportDef {
  node: number;
  dof: Flag6;
}

export interface DampingDef {
  mode: 'modal' | 'rayleigh';
  xi: number;
  rayleigh: { alpha: number; beta: number } | null;
}

export interface UnitsDef {
  length: 'mm';
  force: 'N';
  mass: 'tonne';
  time: 's';
}

export interface StructuralModel {
  units: UnitsDef;
  materials: Material[];
  sections: Section[];
  nodes: NodeDef[];
  bars: BarDef[];
  panels: PanelDef[];
  hinges: HingeDef[];
  masses: MassDef[];
  supports: SupportDef[];
  damping: DampingDef;
}
