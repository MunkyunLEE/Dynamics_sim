import type {
  BarSection,
  Flag6,
  Material,
  PanelKind,
  Release3,
  ShapeSpec,
  ShellSection,
  StructuralModel,
  Vec3
} from './model';
import type { SectionProps } from './sections';

export function upsertBarSection(model: StructuralModel, id: string, p: SectionProps, shape?: ShapeSpec): void {
  const found = model.sections.find((s) => s.id === id);
  if (found && found.type !== 'bar') throw new Error(`'${id}' 는 쉘 단면 이름입니다. 다른 이름을 사용해 주세요.`);
  if (found) {
    found.A = p.A;
    found.Iy = p.Iy;
    found.Iz = p.Iz;
    found.J = p.J;
    if (shape) found.shape = shape;
    else delete found.shape;
    return;
  }
  const sec: BarSection = { id, type: 'bar', A: p.A, Iy: p.Iy, Iz: p.Iz, J: p.J };
  if (shape) sec.shape = shape;
  model.sections.push(sec);
}

export function assignBarSection(model: StructuralModel, bars: Iterable<number>, secId: string): void {
  for (const bi of bars) model.bars[bi].sec = secId;
}

export function upsertMaterial(model: StructuralModel, mat: Material): void {
  const found = model.materials.find((m) => m.id === mat.id);
  if (found) {
    found.E = mat.E;
    found.nu = mat.nu;
    found.rho = mat.rho;
  } else {
    model.materials.push({ ...mat });
  }
}

export function assignMaterial(model: StructuralModel, bars: Iterable<number>, panels: Iterable<number>, matId: string): void {
  for (const bi of bars) model.bars[bi].mat = matId;
  for (const pi of panels) model.panels[pi].mat = matId;
}

export function setBarRelease(model: StructuralModel, bars: Iterable<number>, release: [Release3, Release3]): void {
  const none = release.every((end) => end.every((v) => !v));
  for (const bi of bars) {
    const bar = model.bars[bi];
    if (none) delete bar.release;
    else bar.release = [[...release[0]], [...release[1]]] as [Release3, Release3];
  }
}

export function setNodeSupport(model: StructuralModel, nodes: Iterable<number>, dof: Flag6): void {
  const ids = new Set<number>();
  for (const ni of nodes) ids.add(model.nodes[ni].id);
  model.supports = model.supports.filter((s) => !ids.has(s.node));
  if (dof.some((v) => v)) for (const id of ids) model.supports.push({ node: id, dof: [...dof] as Flag6 });
}

export function setNodeMass(model: StructuralModel, nodes: Iterable<number>, m: number, inertia: Vec3): void {
  const ids = new Set<number>();
  for (const ni of nodes) ids.add(model.nodes[ni].id);
  model.masses = model.masses.filter((x) => !ids.has(x.node));
  if (m > 0 || inertia.some((v) => v > 0)) {
    for (const id of ids) model.masses.push({ node: id, m, I: [...inertia] as Vec3 });
  }
}

export function setPanelThickness(model: StructuralModel, panels: Iterable<number>, thickness: number): void {
  let sec = model.sections.find((s): s is ShellSection => s.type === 'shell' && Math.abs(s.thickness - thickness) < 1e-9);
  if (!sec) {
    let id = `t${thickness}`;
    while (model.sections.some((s) => s.id === id)) id += '_';
    sec = { id, type: 'shell', thickness };
    model.sections.push(sec);
  }
  for (const pi of panels) model.panels[pi].sec = sec.id;
}

export function setPanelKind(model: StructuralModel, panels: Iterable<number>, kind: PanelKind): void {
  for (const pi of panels) {
    if (kind === 'shell') delete model.panels[pi].kind;
    else model.panels[pi].kind = kind;
  }
}

export function sectionUsage(model: StructuralModel): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of model.bars) out.set(b.sec, (out.get(b.sec) ?? 0) + 1);
  for (const p of model.panels) out.set(p.sec, (out.get(p.sec) ?? 0) + 1);
  return out;
}

export function materialUsage(model: StructuralModel): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of model.bars) out.set(b.mat, (out.get(b.mat) ?? 0) + 1);
  for (const p of model.panels) out.set(p.mat, (out.get(p.mat) ?? 0) + 1);
  return out;
}

export function setNodeRole(model: StructuralModel, nodes: Iterable<number>, role: 'input' | 'output', on: boolean): void {
  const key = role === 'input' ? 'inputNodes' : 'outputNodes';
  const set = new Set(model[key] ?? []);
  for (const ni of nodes) {
    const id = model.nodes[ni].id;
    if (on) set.add(id);
    else set.delete(id);
  }
  if (set.size === 0) delete model[key];
  else model[key] = [...set];
}
