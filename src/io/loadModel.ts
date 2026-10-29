import { UNITS } from '../core/units';
import type { StructuralModel } from '../core/model';

function fail(message: string): never {
  throw new Error(message);
}

export function parseModel(text: string): StructuralModel {
  let raw: Partial<StructuralModel>;
  try {
    raw = JSON.parse(text) as Partial<StructuralModel>;
  } catch {
    return fail('JSON 형식이 올바르지 않습니다.');
  }

  const units = raw.units;
  if (
    !units ||
    units.length !== UNITS.length ||
    units.force !== UNITS.force ||
    units.mass !== UNITS.mass ||
    units.time !== UNITS.time
  ) {
    fail('단위계가 mm, N, tonne, s 가 아닙니다. 내보내기 스크립트를 확인해 주세요.');
  }

  const model: StructuralModel = {
    units: units,
    materials: raw.materials ?? [],
    sections: raw.sections ?? [],
    nodes: raw.nodes ?? [],
    bars: raw.bars ?? [],
    panels: raw.panels ?? [],
    hinges: raw.hinges ?? [],
    masses: raw.masses ?? [],
    supports: raw.supports ?? [],
    damping: raw.damping ?? { mode: 'modal', xi: 0.05, rayleigh: null }
  };

  if (raw.inputNodes?.length) model.inputNodes = [...raw.inputNodes];
  if (raw.outputNodes?.length) model.outputNodes = [...raw.outputNodes];

  if (model.nodes.length === 0) fail('절점이 없습니다.');

  const nodeIds = new Set<number>();
  for (const n of model.nodes) {
    if (nodeIds.has(n.id)) fail(`절점 ID 중복: ${n.id}`);
    nodeIds.add(n.id);
  }

  const matIds = new Set(model.materials.map((m) => m.id));
  const secIds = new Set(model.sections.map((s) => s.id));

  for (const b of model.bars) {
    if (!nodeIds.has(b.n[0]) || !nodeIds.has(b.n[1])) fail(`바 ${b.id}: 존재하지 않는 절점을 참조합니다.`);
    if (!matIds.has(b.mat)) fail(`바 ${b.id}: 재료 '${b.mat}' 가 없습니다.`);
    if (!secIds.has(b.sec)) fail(`바 ${b.id}: 단면 '${b.sec}' 가 없습니다.`);
  }

  for (const p of model.panels) {
    if (!matIds.has(p.mat)) fail(`패널 ${p.id}: 재료 '${p.mat}' 가 없습니다.`);
    if (!secIds.has(p.sec)) fail(`패널 ${p.id}: 단면 '${p.sec}' 가 없습니다.`);
    for (const t of p.tris) {
      for (const id of t) {
        if (!nodeIds.has(id)) fail(`패널 ${p.id}: 존재하지 않는 절점 ${id} 를 참조합니다.`);
      }
    }
  }

  for (const m of model.masses) {
    if (!nodeIds.has(m.node)) fail(`집중질량: 존재하지 않는 절점 ${m.node}`);
  }
  for (const s of model.supports) {
    if (!nodeIds.has(s.node)) fail(`지점: 존재하지 않는 절점 ${s.node}`);
  }
  for (const id of [...(model.inputNodes ?? []), ...(model.outputNodes ?? [])]) {
    if (!nodeIds.has(id)) fail(`입출력 절점: 존재하지 않는 절점 ${id}`);
  }

  return model;
}
