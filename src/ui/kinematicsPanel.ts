import type { HingeType, StructuralModel } from '../core/model';
import { HINGE_LABEL, createHinges, detectHingeCandidates, removeHinges, setHingeType } from '../core/hinges';
import { cssColor, paletteColor } from '../core/palette';
import type { KinematicsOptions, KinematicsResult, MobilityReport } from '../solvers/kinematics';
import { measureFoldAngles } from '../solvers/kinematics';
import type { Viewer } from '../viewer/Viewer';
import { Chart, type Series } from './chart';
import { fmt, h, selectOf } from './dom';
import type { EditorEnv } from './env';

interface Deps {
  viewer: Viewer;
  env: EditorEnv;
  setStatus: (text: string) => void;
}

type Reply<T> = { ok: true; result: T } | { ok: false; error: string };

const MV_OPTIONS: [string, string][] = [
  ['0', '-'],
  ['1', '골 (+)'],
  ['-1', '산 (−)']
];

export function setupKinematics({ viewer, env, setStatus }: Deps) {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const info = $('hinge-info');
  const table = $('hinge-table');
  const groundSel = $<HTMLSelectElement>('kin-ground');
  const driverSel = $<HTMLSelectElement>('kin-driver');
  const targetInput = $<HTMLInputElement>('kin-target');
  const stepsInput = $<HTMLInputElement>('kin-steps');
  const foldBtn = $<HTMLButtonElement>('btn-fold');
  const mobBtn = $<HTMLButtonElement>('btn-mobility');
  const report = $('mob-report');
  const modesBox = $('mob-modes');
  const note = $('kin-note');
  const frameInput = $<HTMLInputElement>('kin-frame');
  const frameLabel = $('kin-frame-label');
  const play = $<HTMLInputElement>('kin-play');
  const applyBtn = $<HTMLButtonElement>('btn-kin-apply');
  const chart = new Chart();
  $('kin-chart').append(chart.el);

  let active = false;
  let result: KinematicsResult | null = null;
  let frame = 0;
  let timer = 0;
  let dir = 1;
  let selectedHinge = -1;
  let refAngles = new Map<string, number>();
  const worker = new Worker(new URL('../workers/solver.worker.ts', import.meta.url), { type: 'module' });
  let pending: ((r: Reply<unknown>) => void) | null = null;
  worker.onmessage = (e: MessageEvent<Reply<unknown>>) => {
    const cb = pending;
    pending = null;
    cb?.(e.data);
  };
  const call = <T,>(msg: unknown, done: (r: T) => void, label: string): void => {
    if (pending) return;
    setStatus(`${label} 중...`);
    pending = (r) => {
      foldBtn.disabled = false;
      mobBtn.disabled = false;
      if (!r.ok) {
        note.textContent = r.error;
        setStatus(`${label} 오류: ${r.error}`);
        return;
      }
      setStatus(`${label} 완료`);
      done(r.result as T);
    };
    foldBtn.disabled = true;
    mobBtn.disabled = true;
    worker.postMessage(msg);
  };

  const model = (): StructuralModel => env.model();

  function currentAngles(): Map<string, number> {
    if (result && result.frames.length > 1) {
      const row = result.angles[frame];
      return new Map(result.hingeIds.map((id, i) => [id, row[i]]));
    }
    return refAngles;
  }

  function renderTable(): void {
    const m = model();
    const angles = currentAngles();
    const counts: Record<HingeType, number> = { free: 0, spring: 0, rigid: 0, none: 0 };
    for (const hg of m.hinges) counts[hg.type]++;
    info.textContent = m.hinges.length
      ? `힌지 ${m.hinges.length}개 · 회전 ${counts.free} · 스프링 ${counts.spring} · 잠금 ${counts.rigid} · 분리 ${counts.none}\n표의 행을 누르면 3D 화면에서 강조됩니다. 산·골(MV)은 Tachi(2009) 방식의 접힘 방향 지정입니다.`
      : '힌지가 없습니다. "공유 모서리 → 힌지 생성"을 누르거나, 패널 둘 이상을 선택해 우클릭해 주세요.';
    const tbl = h('table', { class: 'results hinge-rows' });
    const head = tbl.insertRow();
    for (const t of ['힌지', '패널', 'ρ (°)', '종류', '산·골']) head.append(h('th', {}, t));
    m.hinges.forEach((hg, i) => {
      const tr = tbl.insertRow();
      if (i === selectedHinge) tr.classList.add('selected');
      tr.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('select')) return;
        selectedHinge = i === selectedHinge ? -1 : i;
        viewer.setHingeHighlight(selectedHinge >= 0 ? [selectedHinge] : []);
        renderTable();
      });
      tr.insertCell().textContent = hg.id;
      tr.insertCell().textContent = `${hg.panels[0]}–${hg.panels[1]}`;
      const a = angles.get(hg.id);
      tr.insertCell().textContent = a === undefined ? '-' : a.toFixed(2);
      const typeSel = selectOf(Object.entries(HINGE_LABEL) as [string, string][], hg.type);
      typeSel.addEventListener('change', () => env.apply('힌지 종류 변경', (mm) => setHingeType(mm, [i], typeSel.value as HingeType)));
      tr.insertCell().append(typeSel);
      const mvSel = selectOf(MV_OPTIONS, String(hg.mv ?? 0));
      mvSel.addEventListener('change', () =>
        env.apply('산·골 지정', (mm) => {
          const v = Number(mvSel.value);
          if (v) mm.hinges[i].mv = v;
          else delete mm.hinges[i].mv;
        })
      );
      tr.insertCell().append(mvSel);
    });
    table.replaceChildren(tbl);
  }

  function renderSelects(): void {
    const m = model();
    const k = m.kinematics;
    groundSel.replaceChildren(...m.panels.map((p) => h('option', { value: p.id }, p.id)));
    groundSel.value = k?.ground && m.panels.some((p) => p.id === k.ground) ? k.ground : (m.panels[0]?.id ?? '');
    const revolute = m.hinges.filter((hg) => hg.type === 'free' || hg.type === 'spring');
    driverSel.replaceChildren(...revolute.map((hg) => h('option', { value: hg.id }, `${hg.id} (${hg.panels[0]}–${hg.panels[1]})`)));
    const drv = k?.drivers[0];
    if (drv && revolute.some((hg) => hg.id === drv.hinge)) {
      driverSel.value = drv.hinge;
      targetInput.value = fmt(drv.angle);
    }
    if (k?.steps) stepsInput.value = String(k.steps);
  }

  function showFrame(k: number): void {
    if (!result) return;
    frame = Math.max(0, Math.min(result.frames.length - 1, k));
    frameInput.value = String(frame);
    const di = result.driverIds.length ? result.hingeIds.indexOf(result.driverIds[0]) : -1;
    frameLabel.textContent = `${frame}/${result.frames.length - 1}${di >= 0 ? ` · 구동각 ${result.angles[frame][di].toFixed(2)}°` : ''}`;
    if (active) {
      const base = viewer.getBaseReference();
      viewer.setStaticDisplacement(result.frames[frame].map((v, i) => v - base[i]));
    }
    renderTable();
  }

  function renderChart(): void {
    if (!result || result.frames.length < 2) {
      chart.setData([], { xLabel: '구동각 (°)', yLabel: '접힘각 ρ (°)' });
      return;
    }
    const di = result.hingeIds.indexOf(result.driverIds[0]);
    const x = result.angles.map((row) => row[di]);
    const order = [di, ...result.hingeIds.map((_, i) => i).filter((i) => i !== di)].slice(0, 12);
    const series: Series[] = order.map((hi, k) => ({
      name: result!.hingeIds[hi],
      x,
      y: result!.angles.map((row) => row[hi]),
      color: cssColor(paletteColor(k))
    }));
    chart.setData(series, { xLabel: '구동각 (°)', yLabel: '접힘각 ρ (°)', title: '접힘각 경로' });
  }

  function mobilityText(r: MobilityReport, title: string): string {
    const lines = [
      `[${title}] 강체 ${r.bodies}개 (기준: ${r.ground}) · 회전 힌지 ${r.revolute}개 · 잠금 ${r.locked}개`,
      `폐합 루프 ${r.loops}개 = 내부 꼭짓점 ${r.interiorVertices} + 구멍·고리 ${r.holes}`,
      `Maxwell 예측 N − 3V − 6H = ${r.predicted}`,
      `무한소 자유도 N − rank C = ${r.nullity} (rank ${r.rank})`,
      `자기응력(과구속) 상태 ${r.selfStress}개`
    ];
    if (r.floating > 0) lines.push(`기준 패널과 연결되지 않은 덩어리 ${r.floating}개 (각각 고정으로 처리)`);
    if (r.flat) lines.push('평면(또는 완전 접힘) 상태라 무한소 자유도가 실제보다 크게 나옵니다 (Tachi 2012). 조금 접은 형상에서 다시 확인해 주세요.');
    else if (r.nullity === 0) lines.push('강체 기구학으로는 움직이지 않습니다. 다안정 전이는 패널 변형을 허용한 해석이 필요합니다.');
    else if (r.nullity > Math.max(r.predicted, 0)) lines.push('예측보다 자유도가 많습니다: 대칭·특이 형상에 의한 과구속 기구입니다 (예: 미우라 오리).');
    else lines.push('일반적인(generic) 기구입니다.');
    return lines.join('\n');
  }

  function renderModes(r: MobilityReport): void {
    modesBox.replaceChildren(
      ...r.modes.map((mode, k) =>
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: (e: Event) => {
              modesBox.querySelectorAll('.btn').forEach((b) => b.classList.remove('active'));
              (e.currentTarget as HTMLElement).classList.add('active');
              viewer.setModeShape(mode);
            }
          },
          `기구 모드 ${k + 1}`
        )
      ),
      r.modes.length ? h('button', { type: 'button', class: 'btn', onclick: () => viewer.setModeShape(null) }, '모드 끄기') : ''
    );
  }

  function saveSettings(): void {
    const m = model();
    const next = {
      ground: groundSel.value || undefined,
      drivers: driverSel.value ? [{ hinge: driverSel.value, angle: Number(targetInput.value) || 0 }] : [],
      steps: Math.max(1, Math.min(2000, Number(stepsInput.value) || 60))
    };
    if (JSON.stringify(m.kinematics ?? null) !== JSON.stringify(next)) env.apply('기구학 설정', (mm) => (mm.kinematics = next));
  }

  mobBtn.addEventListener('click', () => {
    saveSettings();
    call<MobilityReport & { notes: string[] }>({ kind: 'mob', model: model(), ground: groundSel.value || null }, (r) => {
      report.textContent = [mobilityText(r, '기준 형상'), ...r.notes].join('\n');
      renderModes(r);
    }, '자유도 해석');
  });

  foldBtn.addEventListener('click', () => {
    saveSettings();
    const m = model();
    if (!m.kinematics?.drivers.length) {
      note.textContent = '구동 힌지를 선택해 주세요.';
      return;
    }
    const mv: Record<string, number> = {};
    for (const hg of m.hinges) if (hg.mv) mv[hg.id] = hg.mv;
    const options: KinematicsOptions = { ground: m.kinematics.ground ?? null, drivers: m.kinematics.drivers, steps: m.kinematics.steps ?? 60, mv };
    call<KinematicsResult>({ kind: 'kin', model: m, options }, (r) => {
      result = r;
      frameInput.max = String(r.frames.length - 1);
      const lines = [`${r.completed}/${r.requested} 단계 완료 · 최대 잔차 ${r.maxResidual.toExponential(1)}`, ...r.notes];
      note.textContent = lines.join('\n');
      if (r.finalMobility) {
        report.textContent = mobilityText(r.finalMobility, '최종 단계 형상');
        renderModes(r.finalMobility);
      }
      renderChart();
      showFrame(r.frames.length - 1);
    }, '접힘 경로 계산');
  });

  frameInput.addEventListener('input', () => showFrame(Number(frameInput.value)));
  play.addEventListener('change', () => {
    window.clearInterval(timer);
    if (!play.checked) return;
    timer = window.setInterval(() => {
      if (!result || result.frames.length < 2) return;
      let next = frame + dir;
      if (next >= result.frames.length || next < 0) {
        dir = -dir;
        next = frame + dir;
      }
      showFrame(next);
    }, 40);
  });

  applyBtn.addEventListener('click', () => {
    if (!result || frame === 0) {
      setStatus('적용할 접힘 단계가 없습니다.');
      return;
    }
    const pos = result.frames[frame];
    env.apply('기구학 형상 적용', (mm) => {
      mm.nodes.forEach((n, i) => {
        n.xyz = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      });
    });
    setStatus('현재 접힘 형상을 모델 기준 형상으로 적용했습니다. Dynamics 해석은 이 형상으로 수행됩니다.');
  });

  $('btn-hinge-auto').addEventListener('click', () => {
    const cands = detectHingeCandidates(model());
    if (cands.length === 0) {
      setStatus('공유 모서리를 가진 패널 쌍이 없습니다. 패널끼리 절점을 공유해야 합니다.');
      return;
    }
    let added = 0;
    env.apply('힌지 자동 생성', (mm) => {
      added = createHinges(mm, cands, 'free');
    });
    setStatus(`힌지 ${added}개를 만들었습니다.`);
  });

  $('btn-hinge-clear').addEventListener('click', () => {
    if (model().hinges.length === 0) return;
    env.apply('힌지 모두 삭제', (mm) => removeHinges(mm, mm.hinges.map((_, i) => i)));
  });

  return {
    refresh(): void {
      try {
        refAngles = measureFoldAngles(model());
      } catch {
        refAngles = new Map();
      }
      if (selectedHinge >= model().hinges.length) selectedHinge = -1;
      renderSelects();
      renderTable();
    },
    reset(): void {
      result = null;
      frame = 0;
      play.checked = false;
      window.clearInterval(timer);
      frameInput.max = '0';
      frameInput.value = '0';
      frameLabel.textContent = '';
      report.textContent = '';
      note.textContent = '';
      modesBox.replaceChildren();
      renderChart();
    },
    activate(on: boolean): void {
      active = on;
      if (!on) {
        play.checked = false;
        window.clearInterval(timer);
        viewer.setStaticDisplacement(null);
        viewer.setHingeHighlight([]);
        return;
      }
      viewer.setHingeHighlight(selectedHinge >= 0 ? [selectedHinge] : []);
      if (result) showFrame(frame);
    },
    setGround(panelId: string): void {
      groundSel.value = panelId;
      saveSettings();
    }
  };
}
