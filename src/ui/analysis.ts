import type { StructuralModel } from '../core/model';
import type { ModalOptions, ModalResult } from '../solvers/eigen';
import type { Viewer } from '../viewer/Viewer';

interface Deps {
  viewer: Viewer;
  getModel: () => StructuralModel | null;
  setStatus: (text: string) => void;
}

type WorkerReply = { ok: true; result: ModalResult } | { ok: false; error: string };

export function setupAnalysis({ viewer, getModel, setStatus }: Deps) {
  const typeSel = document.getElementById('modal-type') as HTMLSelectElement;
  const countInput = document.getElementById('modal-count') as HTMLInputElement;
  const runBtn = document.getElementById('btn-modal') as HTMLButtonElement;
  const table = document.getElementById('modal-table') as HTMLTableElement;
  const note = document.getElementById('modal-note') as HTMLDivElement;
  const amp = document.getElementById('amp') as HTMLInputElement;
  const play = document.getElementById('play') as HTMLInputElement;

  let result: ModalResult | null = null;
  let selected = -1;

  function renderTable(): void {
    table.innerHTML = '';
    if (!result) return;
    const head = table.createTHead().insertRow();
    for (const h of ['#', 'f (Hz)', 'T (s)', 'X %', 'Y %', 'Z %']) {
      const th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    }
    const body = table.createTBody();
    result.freqs.forEach((f, i) => {
      const tr = body.insertRow();
      tr.dataset.index = String(i);
      if (result!.zero[i]) tr.classList.add('zero');
      if (i === selected) tr.classList.add('selected');
      const cells = [
        String(i + 1),
        result!.zero[i] ? '≈0' : f.toFixed(3),
        result!.zero[i] ? '-' : (1 / f).toFixed(4),
        ...result!.effMass[i].map((v) => (v * 100).toFixed(1))
      ];
      for (const c of cells) tr.insertCell().textContent = c;
    });
  }

  function select(i: number): void {
    if (!result) return;
    selected = i;
    viewer.setModeShape(result.shapes[i]);
    renderTable();
  }

  const worker = new Worker(new URL('../workers/solver.worker.ts', import.meta.url), { type: 'module' });

  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    runBtn.disabled = false;
    if (!e.data.ok) {
      setStatus(`해석 오류: ${e.data.error}`);
      note.textContent = e.data.error;
      return;
    }
    result = e.data.result;
    const zeros = result.zero.filter(Boolean).length;
    const lines = [`자유도 ${result.nDof}개, ${result.freqs.length}개 모드`];
    if (zeros > 0) lines.push(`강체/기구 모드(≈0 Hz): ${zeros}개`);
    lines.push(...result.notes);
    note.textContent = lines.join('\n');
    setStatus('고유치 해석 완료');
    const first = result.zero.findIndex((z) => !z);
    select(first >= 0 ? first : 0);
  };

  runBtn.addEventListener('click', () => {
    const model = getModel();
    if (!model) {
      setStatus('모델이 없습니다.');
      return;
    }
    const options: ModalOptions = {
      type: typeSel.value as ModalOptions['type'],
      nModes: Math.max(1, Math.min(60, Number(countInput.value) || 12))
    };
    runBtn.disabled = true;
    note.textContent = '';
    setStatus('고유치 해석 중...');
    worker.postMessage({ kind: 'modal', model, options });
  });

  table.addEventListener('click', (e) => {
    const tr = (e.target as HTMLElement).closest('tr');
    if (tr?.dataset.index !== undefined) select(Number(tr.dataset.index));
  });

  amp.addEventListener('input', () => viewer.setAmplitude(Number(amp.value) / 100));
  play.addEventListener('change', () => viewer.setPlaying(play.checked));
  viewer.setAmplitude(Number(amp.value) / 100);

  return {
    reset(): void {
      result = null;
      selected = -1;
      table.innerHTML = '';
      note.textContent = '';
    }
  };
}
