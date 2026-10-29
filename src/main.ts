import './style.css';
import { Viewer } from './viewer/Viewer';
import { renderInfo, renderUnits } from './ui/panels';
import { parseModel } from './io/loadModel';
import { buildSampleModel } from './core/sample';
import { setupAnalysis } from './ui/analysis';
import type { StructuralModel } from './core/model';

const viewer = new Viewer(document.getElementById('viewport')!);
const unitsTable = document.getElementById('units-table') as HTMLTableElement;
const infoTable = document.getElementById('info-table') as HTMLTableElement;
const status = document.getElementById('status')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;

let current: StructuralModel | null = null;

const analysis = setupAnalysis({
  viewer,
  getModel: () => current,
  setStatus: (text) => {
    status.textContent = text;
  }
});

function apply(model: StructuralModel, label: string): void {
  current = model;
  analysis.reset();
  viewer.setModel(model);
  renderInfo(infoTable, current);
  status.textContent = `${label} 불러옴`;
}

renderUnits(unitsTable);
renderInfo(infoTable, null);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    apply(parseModel(await file.text()), file.name);
  } catch (e) {
    status.textContent = `오류: ${(e as Error).message}`;
  }
  fileInput.value = '';
});

document.getElementById('btn-sample')!.addEventListener('click', () => {
  apply(buildSampleModel(), '샘플 모델');
});

document.getElementById('btn-fit')!.addEventListener('click', () => {
  viewer.fit();
});

apply(buildSampleModel(), '샘플 모델');
