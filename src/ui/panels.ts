import { UNIT_ROWS } from '../core/units';
import type { StructuralModel } from '../core/model';

function fillTable(table: HTMLTableElement, rows: ReadonlyArray<readonly [string, string]>): void {
  table.innerHTML = '';
  for (const [k, v] of rows) {
    const tr = table.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = v;
  }
}

export function renderUnits(table: HTMLTableElement): void {
  fillTable(table, UNIT_ROWS);
}

export function renderInfo(table: HTMLTableElement, model: StructuralModel | null): void {
  if (!model) {
    fillTable(table, [['모델', '없음']]);
    return;
  }

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const n of model.nodes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], n.xyz[i]);
      max[i] = Math.max(max[i], n.xyz[i]);
    }
  }
  const size = max.map((v, i) => Math.round(v - min[i]));
  const tris = model.panels.reduce((s, p) => s + p.tris.length, 0);

  fillTable(table, [
    ['절점', String(model.nodes.length)],
    ['바 요소', String(model.bars.length)],
    ['쉘 패널', String(model.panels.length)],
    ['삼각형 요소', String(tris)],
    ['힌지', String(model.hinges.length)],
    ['집중질량', String(model.masses.length)],
    ['지점', String(model.supports.length)],
    ['재료 / 단면', `${model.materials.length} / ${model.sections.length}`],
    ['범위 X×Y×Z (mm)', size.join(' × ')],
    ['감쇠', model.damping.mode === 'modal' ? `모드별 ξ=${model.damping.xi}` : 'Rayleigh']
  ]);
}
