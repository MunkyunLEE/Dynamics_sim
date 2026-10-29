import type { StructuralModel } from '../core/model';
import { parseMotion, type AccUnit, type Motion } from '../io/loadMotion';
import type { TimeHistoryOptions, TimeHistoryResult } from '../solvers/timeHistory';
import { fmt } from './dom';
import { ResultsDock } from './results';

interface Deps {
  host: HTMLElement;
  getModel: () => StructuralModel | null;
  setStatus: (text: string) => void;
  setDamping: (mode: 'modal' | 'rayleigh', xi: number, alpha: number, beta: number) => void;
}

type Reply = { ok: true; result: TimeHistoryResult } | { ok: false; error: string };

export function setupSeismic({ host, getModel, setStatus, setDamping }: Deps) {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const fileInput = $<HTMLInputElement>('motion-file');
  const unitSel = $<HTMLSelectElement>('motion-unit');
  const scaleInput = $<HTMLInputElement>('motion-scale');
  const tailInput = $<HTMLInputElement>('motion-tail');
  const motionInfo = $('motion-info');
  const modesInput = $<HTMLInputElement>('th-modes');
  const massInput = $<HTMLInputElement>('th-mass');
  const dampSel = $<HTMLSelectElement>('th-damp');
  const xiInput = $<HTMLInputElement>('th-xi');
  const alphaInput = $<HTMLInputElement>('th-alpha');
  const betaInput = $<HTMLInputElement>('th-beta');
  const runBtn = $<HTMLButtonElement>('btn-th');
  const note = $('th-note');
  const ioInfo = $('io-info');

  const dock = new ResultsDock();
  host.append(dock.el);

  let text: string | null = null;
  let fileName = '';
  let motion: Motion | null = null;

  const worker = new Worker(new URL('../workers/solver.worker.ts', import.meta.url), { type: 'module' });

  function reloadMotion(): void {
    if (text === null) return;
    try {
      motion = parseMotion(text, unitSel.value as AccUnit, Number(scaleInput.value) || 1, Math.max(0, Number(tailInput.value) || 0));
      const peaks = motion.acc.map((a) => a.reduce((p, v) => Math.max(p, Math.abs(v)), 0) / 9806.65);
      motionInfo.textContent =
        `${fileName}: ${motion.n}점, Δt=${fmt(motion.dt)} s, 길이 ${fmt(motion.duration)} s\n` +
        `최대 가속도(g) X ${fmt(peaks[0])} · Y ${fmt(peaks[1])} · Z ${fmt(peaks[2])}` +
        (motion.resampled ? '\n시간 간격이 일정하지 않아 균일 간격으로 재샘플했습니다.' : '') +
        (motion.columns < 4 ? `\n열 ${motion.columns}개: 없는 방향은 0으로 둡니다.` : '');
    } catch (e) {
      motion = null;
      motionInfo.textContent = `오류: ${(e as Error).message}`;
    }
  }

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    text = await f.text();
    fileName = f.name;
    reloadMotion();
    fileInput.value = '';
  });
  for (const el of [unitSel, scaleInput, tailInput]) el.addEventListener('change', reloadMotion);

  worker.onmessage = (e: MessageEvent<Reply>) => {
    runBtn.disabled = false;
    if (!e.data.ok) {
      note.textContent = e.data.error;
      setStatus(`지진동 해석 오류: ${e.data.error}`);
      return;
    }
    const r = e.data.result;
    const last = r.cumMass[r.usedModes - 1];
    const lines = [
      `사용 모드 ${r.usedModes}/${r.totalModes}개 (최고 ${fmt(r.freqs[r.usedModes - 1])} Hz)`,
      `누적 유효질량 X ${(last[0] * 100).toFixed(1)}% · Y ${(last[1] * 100).toFixed(1)}% · Z ${(last[2] * 100).toFixed(1)}%`,
      ...r.notes
    ];
    note.textContent = lines.join('\n');
    setStatus('지진동 해석 완료');
    dock.show(r, 5);
  };

  runBtn.addEventListener('click', () => {
    const model = getModel();
    if (!model) return;
    if (!motion) {
      setStatus('입력 지진동 CSV를 먼저 불러와 주세요.');
      note.textContent = '입력 지진동 CSV(t, ax, ay, az)를 불러와 주세요.';
      return;
    }
    const mode = dampSel.value as 'modal' | 'rayleigh';
    const xi = Math.max(0, Number(xiInput.value) || 0) / 100;
    const alpha = Number(alphaInput.value) || 0;
    const beta = Number(betaInput.value) || 0;
    const d = model.damping;
    const changed = d.mode !== mode || d.xi !== xi || (mode === 'rayleigh' && (d.rayleigh?.alpha !== alpha || d.rayleigh?.beta !== beta));
    if (changed) setDamping(mode, xi, alpha, beta);
    const options: TimeHistoryOptions = {
      nModes: Math.max(1, Math.min(500, Number(modesInput.value) || 60)),
      massTarget: Math.min(1, Math.max(0.1, (Number(massInput.value) || 90) / 100))
    };
    runBtn.disabled = true;
    note.textContent = '';
    setStatus('지진동 해석 중...');
    worker.postMessage({ kind: 'th', model: getModel(), motion: { dt: motion.dt, acc: motion.acc }, options });
  });

  function syncDamping(model: StructuralModel | null): void {
    if (!model) return;
    dampSel.value = model.damping.mode;
    xiInput.value = fmt(model.damping.xi * 100);
    alphaInput.value = fmt(model.damping.rayleigh?.alpha ?? 0);
    betaInput.value = fmt(model.damping.rayleigh?.beta ?? 0);
  }

  function updateIoInfo(model: StructuralModel | null): void {
    const ins = model?.inputNodes ?? [];
    const outs = model?.outputNodes ?? [];
    ioInfo.textContent = `입력 절점 ${ins.length}개${ins.length ? ` (${ins.slice(0, 8).map((i) => `N${i}`).join(', ')}${ins.length > 8 ? '…' : ''})` : ''}\n출력 절점 ${outs.length}개${outs.length ? ` (${outs.slice(0, 8).map((i) => `N${i}`).join(', ')}${outs.length > 8 ? '…' : ''})` : ''}`;
  }

  return {
    reset(): void {
      dock.clear();
      note.textContent = '';
    },
    refresh(model: StructuralModel | null): void {
      syncDamping(model);
      updateIoInfo(model);
    }
  };
}
