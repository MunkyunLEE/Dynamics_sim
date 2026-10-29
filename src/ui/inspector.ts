import type { BarSection, StructuralModel } from '../core/model';
import { materialUsage, sectionUsage } from '../core/edit';
import { cssColor } from '../core/palette';
import { isEmptySelection, type Selection } from '../core/selection';
import { fmt, h } from './dom';

export interface InspectorHandlers {
  selectSection(id: string): void;
  selectMaterial(id: string): void;
}

function fill(el: HTMLElement, rows: HTMLElement[]): void {
  el.replaceChildren(...rows);
}

export function renderSelectionInfo(el: HTMLElement, model: StructuralModel | null, sel: Selection): void {
  if (!model || isEmptySelection(sel)) {
    el.textContent = '선택 없음. 클릭, Shift+드래그(박스), 우클릭 메뉴를 사용해 주세요.';
    return;
  }
  const lines = [`절점 ${sel.nodes.size} · 바 ${sel.bars.size} · 패널 ${sel.panels.size}`];
  if (sel.bars.size === 1) {
    const b = model.bars[[...sel.bars][0]];
    const s = model.sections.find((x): x is BarSection => x.type === 'bar' && x.id === b.sec);
    lines.push(`바 #${b.id}  재료 ${b.mat}  단면 ${b.sec}`);
    if (s) lines.push(`A=${fmt(s.A)}  Iy=${fmt(s.Iy)}  Iz=${fmt(s.Iz)}  J=${fmt(s.J)}`);
    if (b.release) lines.push(`해제 시작 [${b.release[0].join(',')}]  끝 [${b.release[1].join(',')}]`);
  }
  if (sel.nodes.size === 1) {
    const n = model.nodes[[...sel.nodes][0]];
    lines.push(`절점 #${n.id}  (${n.xyz.map((v) => fmt(v)).join(', ')})`);
    const sup = model.supports.find((x) => x.node === n.id);
    if (sup) lines.push(`지점 [${sup.dof.join('')}]`);
    const mass = model.masses.find((x) => x.node === n.id);
    if (mass) lines.push(`집중질량 ${fmt(mass.m)} tonne`);
  }
  if (sel.panels.size === 1) {
    const p = model.panels[[...sel.panels][0]];
    lines.push(`패널 ${p.id}  재료 ${p.mat}  단면 ${p.sec}  ${p.kind === 'solid' ? '솔리드' : '쉘'}`);
  }
  el.textContent = lines.join('\n');
}

export function renderLibrary(
  sectionBox: HTMLElement,
  materialBox: HTMLElement,
  model: StructuralModel | null,
  colors: Map<string, number> | null,
  handlers: InspectorHandlers
): void {
  if (!model) {
    fill(sectionBox, []);
    fill(materialBox, []);
    return;
  }
  const secUse = sectionUsage(model);
  const matUse = materialUsage(model);

  const secRows = model.sections.map((s) => {
    const color = colors?.get(s.id);
    const dot = h('span', { class: 'dot' });
    if (color !== undefined) dot.style.background = cssColor(color);
    const detail =
      s.type === 'bar' ? `A ${fmt(s.A)} · Iy ${fmt(s.Iy)} · Iz ${fmt(s.Iz)}` : `쉘 t=${fmt(s.thickness)} mm`;
    return h(
      'button',
      { type: 'button', class: 'lib-row', onclick: () => handlers.selectSection(s.id) },
      dot,
      h('span', { class: 'lib-name' }, s.id),
      h('span', { class: 'lib-count' }, `${secUse.get(s.id) ?? 0}개`),
      h('span', { class: 'lib-detail' }, detail)
    );
  });
  fill(sectionBox, secRows);

  const matRows = model.materials.map((m) =>
    h(
      'button',
      { type: 'button', class: 'lib-row', onclick: () => handlers.selectMaterial(m.id) },
      h('span', { class: 'lib-name' }, m.id),
      h('span', { class: 'lib-count' }, `${matUse.get(m.id) ?? 0}개`),
      h('span', { class: 'lib-detail' }, `E ${fmt(m.E)} · ν ${fmt(m.nu)} · ρ ${fmt(m.rho * 1e12)} kg/m³`)
    )
  );
  fill(materialBox, matRows);
}
