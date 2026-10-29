import './style.css';
import { Viewer } from './viewer/Viewer';
import { Interaction, type Hit, type SelectFilter } from './viewer/interaction';
import { renderInfo, renderUnits } from './ui/panels';
import { renderLibrary, renderSelectionInfo } from './ui/inspector';
import { showMenu, closeMenu, type MenuItem } from './ui/contextMenu';
import { openSectionDialog } from './ui/sectionDialog';
import {
  openClosedShellDialog,
  openMassDialog,
  openMaterialDialog,
  openPanelDialog,
  openReleaseDialog,
  openSupportDialog
} from './ui/editors';
import type { EditorEnv } from './ui/env';
import { parseModel } from './io/loadModel';
import { buildSampleModel } from './core/sample';
import { setupAnalysis } from './ui/analysis';
import { sectionColors } from './core/palette';
import {
  barsWithSection,
  emptySelection,
  isEmptySelection,
  sameHeightNodes,
  sameLevelBars,
  sameSectionBars,
  type Selection
} from './core/selection';
import type { StructuralModel } from './core/model';

const MAX_UNDO = 60;

const viewer = new Viewer(document.getElementById('viewport')!);
const unitsTable = document.getElementById('units-table') as HTMLTableElement;
const infoTable = document.getElementById('info-table') as HTMLTableElement;
const selInfo = document.getElementById('selection-info')!;
const sectionBox = document.getElementById('section-table')!;
const materialBox = document.getElementById('material-table')!;
const status = document.getElementById('status')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const boxBtn = document.getElementById('btn-box') as HTMLButtonElement;
const colorBtn = document.getElementById('btn-color') as HTMLButtonElement;
const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
const filterSel = document.getElementById('select-filter') as HTMLSelectElement;

let model: StructuralModel | null = null;
let sel: Selection = emptySelection();
let colorBySection = false;
const undoStack: string[] = [];

const setStatus = (text: string): void => {
  status.textContent = text;
};

const analysis = setupAnalysis({ viewer, getModel: () => model, setStatus });

function render(fit: boolean): void {
  if (!model) return;
  const colors = sectionColors(model);
  let barColors: number[] | null = null;
  if (colorBySection) barColors = model.bars.map((b) => colors.get(b.sec) ?? 0x9aa4b2);
  viewer.setModel(model, { fit, barColors });
  viewer.setSelection(sel);
  renderInfo(infoTable, model);
  renderLibrary(sectionBox, materialBox, model, colorBySection ? colors : null, {
    selectSection: (id) => setSelection({ ...emptySelection(), bars: barsWithSection(model!, id) }),
    selectMaterial: (id) => {
      const next = emptySelection();
      model!.bars.forEach((b, i) => b.mat === id && next.bars.add(i));
      model!.panels.forEach((p, i) => p.mat === id && next.panels.add(i));
      setSelection(next);
    }
  });
  renderSelectionInfo(selInfo, model, sel);
  undoBtn.disabled = undoStack.length === 0;
}

function setSelection(next: Selection): void {
  sel = next;
  viewer.setSelection(sel);
  renderSelectionInfo(selInfo, model, sel);
}

function load(next: StructuralModel, label: string): void {
  model = next;
  sel = emptySelection();
  undoStack.length = 0;
  analysis.reset();
  render(true);
  setStatus(`${label} 불러옴`);
}

const env: EditorEnv = {
  model: () => model!,
  select: setSelection,
  apply(label, fn) {
    if (!model) return;
    const snapshot = JSON.stringify(model);
    try {
      fn(model);
    } catch (err) {
      model = JSON.parse(snapshot) as StructuralModel;
      throw err;
    }
    undoStack.push(snapshot);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    analysis.reset();
    render(false);
    setStatus(`${label} 완료`);
  }
};

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  model = JSON.parse(prev) as StructuralModel;
  const clampSet = (s: Set<number>, n: number): Set<number> => new Set([...s].filter((i) => i < n));
  sel = {
    nodes: clampSet(sel.nodes, model.nodes.length),
    bars: clampSet(sel.bars, model.bars.length),
    panels: clampSet(sel.panels, model.panels.length)
  };
  analysis.reset();
  render(false);
  setStatus('실행 취소');
}

function toggle(set: Set<number>, i: number): void {
  if (set.has(i)) set.delete(i);
  else set.add(i);
}

function onClick(hit: Hit | null, additive: boolean): void {
  if (!additive) {
    const next = emptySelection();
    if (hit) (hit.type === 'node' ? next.nodes : hit.type === 'bar' ? next.bars : next.panels).add(hit.index);
    setSelection(next);
    return;
  }
  if (!hit) return;
  const next: Selection = { nodes: new Set(sel.nodes), bars: new Set(sel.bars), panels: new Set(sel.panels) };
  toggle(hit.type === 'node' ? next.nodes : hit.type === 'bar' ? next.bars : next.panels, hit.index);
  setSelection(next);
}

function onBox(box: Selection, additive: boolean): void {
  if (!additive) {
    setSelection(box);
    return;
  }
  setSelection({
    nodes: new Set([...sel.nodes, ...box.nodes]),
    bars: new Set([...sel.bars, ...box.bars]),
    panels: new Set([...sel.panels, ...box.panels])
  });
}

function onContext(hit: Hit | null, x: number, y: number): void {
  if (!model) return;
  if (hit) {
    const inSel = (hit.type === 'node' ? sel.nodes : hit.type === 'bar' ? sel.bars : sel.panels).has(hit.index);
    if (!inSel) {
      const next = emptySelection();
      (hit.type === 'node' ? next.nodes : hit.type === 'bar' ? next.bars : next.panels).add(hit.index);
      setSelection(next);
    }
  }
  const bars = [...sel.bars];
  const nodes = [...sel.nodes];
  const panels = [...sel.panels];
  const items: MenuItem[] = [];
  const m = model;

  if (bars.length) {
    items.push({ header: true, label: `바 ${bars.length}개` });
    items.push({ label: '단면 설정…', action: () => openSectionDialog(env, bars) });
    items.push({ label: '재료 설정…', action: () => openMaterialDialog(env, bars, panels) });
    items.push({ label: '단부 접합 설정…', action: () => openReleaseDialog(env, bars) });
    items.push({ label: '같은 층(레벨) 부재 선택', action: () => setSelection({ ...emptySelection(), bars: sameLevelBars(m, bars) }) });
    items.push({ label: '같은 단면 부재 선택', action: () => setSelection({ ...emptySelection(), bars: sameSectionBars(m, bars) }) });
  }
  if (nodes.length) {
    if (items.length) items.push({ separator: true });
    items.push({ header: true, label: `절점 ${nodes.length}개` });
    items.push({ label: '지점 설정…', action: () => openSupportDialog(env, nodes) });
    items.push({ label: '집중질량 설정…', action: () => openMassDialog(env, nodes) });
    items.push({ label: '같은 높이 절점 선택', action: () => setSelection({ ...emptySelection(), nodes: sameHeightNodes(m, nodes) }) });
  }
  if (panels.length) {
    if (items.length) items.push({ separator: true });
    items.push({ header: true, label: `패널 ${panels.length}개` });
    items.push({ label: '두께·재료 설정…', action: () => openPanelDialog(env, panels) });
    if (panels.length === 1 && !bars.length) {
      items.push({ label: '닫힌 쉘 판정 (쉘/솔리드)…', action: () => openClosedShellDialog(env, panels[0]) });
    }
  }
  if (!isEmptySelection(sel)) {
    if (items.length) items.push({ separator: true });
    items.push({ label: '선택 해제', action: () => setSelection(emptySelection()) });
  } else {
    items.push({ header: true, label: '선택된 요소가 없습니다' });
  }
  showMenu(x, y, items);
}

const interaction = new Interaction(viewer, { click: onClick, box: onBox, context: onContext });

filterSel.addEventListener('change', () => {
  interaction.filter = filterSel.value as SelectFilter;
});

boxBtn.addEventListener('click', () => {
  const on = !boxBtn.classList.contains('active');
  boxBtn.classList.toggle('active', on);
  interaction.setBoxMode(on);
});

colorBtn.addEventListener('click', () => {
  colorBySection = !colorBySection;
  colorBtn.classList.toggle('active', colorBySection);
  render(false);
});

undoBtn.addEventListener('click', undo);

document.getElementById('btn-save')!.addEventListener('click', () => {
  if (!model) return;
  const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'model.json';
  a.click();
  URL.revokeObjectURL(url);
});

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('input, select, textarea') || document.querySelector('.dialog-overlay')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (e.key === 'Escape') {
    closeMenu();
    setSelection(emptySelection());
  }
});

renderUnits(unitsTable);
renderInfo(infoTable, null);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    load(parseModel(await file.text()), file.name);
  } catch (e) {
    setStatus(`오류: ${(e as Error).message}`);
  }
  fileInput.value = '';
});

document.getElementById('btn-sample')!.addEventListener('click', () => {
  load(buildSampleModel(), '샘플 모델');
});

document.getElementById('btn-fit')!.addEventListener('click', () => {
  viewer.fit();
});

load(buildSampleModel(), '샘플 모델');
