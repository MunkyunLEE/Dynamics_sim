import type { Flag6, Release3, Vec3 } from '../core/model';
import {
  assignMaterial,
  setBarRelease,
  setNodeMass,
  setNodeSupport,
  setPanelKind,
  setPanelThickness,
  upsertMaterial
} from '../core/edit';
import { checkClosedShell } from '../geometry/closedShell';
import { openDialog } from './dialog';
import { fmt, h, numInput, readNum, row, selectOf } from './dom';
import type { EditorEnv } from './env';

const MATERIAL_PRESETS: Record<string, { label: string; E: number; nu: number; rho: number }> = {
  steel: { label: '강재', E: 205000, nu: 0.3, rho: 7850 },
  concrete: { label: '콘크리트', E: 25800, nu: 0.2, rho: 2400 },
  aluminum: { label: '알루미늄', E: 70000, nu: 0.33, rho: 2700 },
  custom: { label: '직접 입력', E: 205000, nu: 0.3, rho: 7850 }
};

const KG_M3_TO_TONNE_MM3 = 1e-12;

function checkbox(label: string, checked: boolean): HTMLInputElement {
  const box = h('input', { type: 'checkbox' });
  box.checked = checked;
  box.title = label;
  return box;
}

function checkRow(title: string, labels: string[], values: boolean[]): { el: HTMLElement; boxes: HTMLInputElement[] } {
  const boxes = labels.map((l, i) => checkbox(l, values[i]));
  const cells = boxes.map((b, i) => h('label', { class: 'check' }, b, labels[i]));
  return { el: h('div', { class: 'row' }, h('span', { class: 'row-label' }, title), h('div', { class: 'checks' }, ...cells)), boxes };
}

export function openMaterialDialog(env: EditorEnv, bars: number[], panels: number[]): void {
  const model = env.model();
  const first = bars.length ? model.bars[bars[0]].mat : model.panels[panels[0]].mat;
  const cur = model.materials.find((m) => m.id === first);
  const presetSel = selectOf(Object.entries(MATERIAL_PRESETS).map(([k, v]) => [k, v.label]), 'custom');
  const idInput = h('input', { type: 'text', value: first, list: 'material-names' });
  const names = h('datalist', { id: 'material-names' });
  for (const m of model.materials) names.append(h('option', { value: m.id }));
  const E = numInput(cur?.E ?? 205000);
  const nu = numInput(cur?.nu ?? 0.3);
  const rho = numInput(cur ? cur.rho / KG_M3_TO_TONNE_MM3 : 7850);
  const hint = h('div', { class: 'hint' });

  const refresh = (): void => {
    const id = idInput.value.trim();
    const found = model.materials.find((m) => m.id === id);
    hint.textContent = found
      ? `기존 재료 '${id}' 를 수정합니다. 이 재료를 쓰는 모든 부재에 반영됩니다.`
      : `새 재료 '${id}' 를 만들어 선택 요소에 배정합니다.`;
  };
  idInput.addEventListener('input', refresh);
  idInput.addEventListener('change', () => {
    const found = model.materials.find((m) => m.id === idInput.value.trim());
    if (!found) return;
    E.value = fmt(found.E);
    nu.value = fmt(found.nu);
    rho.value = fmt(found.rho / KG_M3_TO_TONNE_MM3);
  });
  presetSel.addEventListener('change', () => {
    const p = MATERIAL_PRESETS[presetSel.value];
    E.value = fmt(p.E);
    nu.value = fmt(p.nu);
    rho.value = fmt(p.rho);
    if (presetSel.value !== 'custom' && !model.materials.some((m) => m.id === idInput.value.trim())) idInput.value = p.label;
    refresh();
  });
  refresh();

  const body = h(
    'div',
    { class: 'form-body' },
    names,
    h('div', { class: 'hint' }, `선택: 바 ${bars.length}개, 패널 ${panels.length}개`),
    row('프리셋', presetSel),
    row('재료 이름', idInput),
    hint,
    row('탄성계수 E (MPa)', E),
    row('푸아송비 ν', nu),
    row('밀도 (kg/m³)', rho, '내부 단위 tonne/mm³ 로 자동 환산')
  );

  openDialog('재료 설정', body, [
    { label: '취소' },
    {
      label: '적용',
      primary: true,
      onClick: () => {
        const id = idInput.value.trim();
        const e = readNum(E);
        const v = readNum(nu);
        const d = readNum(rho);
        if (!id) throw new Error('재료 이름을 입력해 주세요.');
        if (!(e > 0)) throw new Error('탄성계수는 0보다 커야 합니다.');
        if (!(v > -1 && v < 0.5)) throw new Error('푸아송비는 -1 ~ 0.5 사이여야 합니다.');
        if (!(d >= 0)) throw new Error('밀도는 0 이상이어야 합니다.');
        env.apply('재료 설정', (m) => {
          upsertMaterial(m, { id, E: e, nu: v, rho: d * KG_M3_TO_TONNE_MM3 });
          assignMaterial(m, bars, panels, id);
        });
      }
    }
  ]);
}

export function openReleaseDialog(env: EditorEnv, bars: number[]): void {
  const model = env.model();
  const cur = model.bars[bars[0]].release;
  const labels = ['Rx (비틀림)', 'Ry (국부 y 회전)', 'Rz (국부 z 회전)'];
  const start = checkRow('시작 절점 해제', labels, (cur?.[0] ?? [0, 0, 0]).map(Boolean));
  const end = checkRow('끝 절점 해제', labels, (cur?.[1] ?? [0, 0, 0]).map(Boolean));
  const setAll = (s: boolean[], e: boolean[]): void => {
    start.boxes.forEach((b, i) => (b.checked = s[i]));
    end.boxes.forEach((b, i) => (b.checked = e[i]));
  };
  const presets = h(
    'div',
    { class: 'preset-row' },
    h('button', { type: 'button', class: 'btn', onclick: () => setAll([false, false, false], [false, false, false]) }, '강접 - 강접'),
    h('button', { type: 'button', class: 'btn', onclick: () => setAll([false, false, false], [false, true, true]) }, '강접 - 핀'),
    h('button', { type: 'button', class: 'btn', onclick: () => setAll([false, true, true], [false, false, false]) }, '핀 - 강접'),
    h('button', { type: 'button', class: 'btn', onclick: () => setAll([false, true, true], [false, true, true]) }, '핀 - 핀')
  );
  const body = h(
    'div',
    { class: 'form-body' },
    h('div', { class: 'hint' }, `선택 부재 ${bars.length}개. 체크한 회전 자유도는 해당 단부에서 해제(핀)됩니다. 모두 해제하면 강접입니다.`),
    presets,
    start.el,
    end.el
  );
  openDialog('단부 접합 설정', body, [
    { label: '취소' },
    {
      label: '적용',
      primary: true,
      onClick: () => {
        const s = start.boxes.map((b) => (b.checked ? 1 : 0)) as Release3;
        const e = end.boxes.map((b) => (b.checked ? 1 : 0)) as Release3;
        env.apply('단부 접합 설정', (m) => setBarRelease(m, bars, [s, e]));
      }
    }
  ]);
}

export function openSupportDialog(env: EditorEnv, nodes: number[]): void {
  const model = env.model();
  const id = model.nodes[nodes[0]].id;
  const cur = model.supports.find((s) => s.node === id)?.dof ?? [0, 0, 0, 0, 0, 0];
  const labels = ['Ux', 'Uy', 'Uz', 'Rx', 'Ry', 'Rz'];
  const group = checkRow('구속 (체크 = 고정)', labels, cur.map(Boolean));
  const setAll = (v: number[]): void => group.boxes.forEach((b, i) => (b.checked = v[i] === 1));
  const presets = h(
    'div',
    { class: 'preset-row' },
    h('button', { type: 'button', class: 'btn', onclick: () => setAll([1, 1, 1, 1, 1, 1]) }, '고정'),
    h('button', { type: 'button', class: 'btn', onclick: () => setAll([1, 1, 1, 0, 0, 0]) }, '핀'),
    h('button', { type: 'button', class: 'btn', onclick: () => setAll([0, 0, 1, 0, 0, 0]) }, '롤러(Z)'),
    h('button', { type: 'button', class: 'btn', onclick: () => setAll([0, 0, 0, 0, 0, 0]) }, '해제')
  );
  const body = h(
    'div',
    { class: 'form-body' },
    h('div', { class: 'hint' }, `선택 절점 ${nodes.length}개. 전역 좌표계 기준입니다. 모두 해제하면 지점이 삭제됩니다.`),
    presets,
    group.el
  );
  openDialog('지점 설정', body, [
    { label: '취소' },
    {
      label: '적용',
      primary: true,
      onClick: () => {
        const dof = group.boxes.map((b) => (b.checked ? 1 : 0)) as Flag6;
        env.apply('지점 설정', (m) => setNodeSupport(m, nodes, dof));
      }
    }
  ]);
}

export function openMassDialog(env: EditorEnv, nodes: number[]): void {
  const model = env.model();
  const cur = model.masses.find((x) => x.node === model.nodes[nodes[0]].id);
  const unitSel = selectOf(
    [
      ['tonne', 'tonne'],
      ['kg', 'kg']
    ],
    'tonne'
  );
  const mass = numInput(cur?.m ?? 0);
  const ix = numInput(cur?.I?.[0] ?? 0);
  const iy = numInput(cur?.I?.[1] ?? 0);
  const iz = numInput(cur?.I?.[2] ?? 0);
  const distribute = checkbox('분배', false);
  const rowDist = h('label', { class: 'check' }, distribute, `입력값을 전체 총질량으로 보고 ${nodes.length}개 절점에 균등 분배`);
  const body = h(
    'div',
    { class: 'form-body' },
    h('div', { class: 'hint' }, `선택 절점 ${nodes.length}개. 질량 0 이고 관성 0 이면 집중질량이 삭제됩니다.`),
    row('질량 단위', unitSel),
    row('질량', mass),
    row('회전관성 Ix (tonne·mm²)', ix),
    row('회전관성 Iy (tonne·mm²)', iy),
    row('회전관성 Iz (tonne·mm²)', iz),
    nodes.length > 1 ? rowDist : null
  );
  openDialog('집중질량 설정', body, [
    { label: '취소' },
    {
      label: '적용',
      primary: true,
      onClick: () => {
        let m = readNum(mass);
        const inertia: Vec3 = [readNum(ix), readNum(iy), readNum(iz)];
        if (!(m >= 0) || inertia.some((v) => !(v >= 0))) throw new Error('질량과 회전관성은 0 이상의 수여야 합니다.');
        if (unitSel.value === 'kg') m /= 1000;
        if (distribute.checked) m /= nodes.length;
        env.apply('집중질량 설정', (mm) => setNodeMass(mm, nodes, m, inertia));
      }
    }
  ]);
}

export function openPanelDialog(env: EditorEnv, panels: number[]): void {
  const model = env.model();
  const sec = model.sections.find((s) => s.id === model.panels[panels[0]].sec);
  const thick = numInput(sec && sec.type === 'shell' ? sec.thickness : 10);
  const matSel = selectOf([['', '변경 안 함'], ...model.materials.map((m): [string, string] => [m.id, m.id])], '');
  const body = h(
    'div',
    { class: 'form-body' },
    h('div', { class: 'hint' }, `선택 패널 ${panels.length}개`),
    row('두께 (mm)', thick),
    row('재료', matSel)
  );
  openDialog('패널 두께·재료', body, [
    { label: '취소' },
    {
      label: '적용',
      primary: true,
      onClick: () => {
        const t = readNum(thick);
        if (!(t > 0)) throw new Error('두께는 0보다 커야 합니다.');
        env.apply('패널 두께·재료', (m) => {
          setPanelThickness(m, panels, t);
          if (matSel.value) assignMaterial(m, [], panels, matSel.value);
        });
      }
    }
  ]);
}

export function openClosedShellDialog(env: EditorEnv, panelIdx: number): void {
  const model = env.model();
  const check = checkClosedShell(model, panelIdx);
  const mat = model.materials.find((m) => m.id === model.panels[panelIdx].mat);
  const kind = model.panels[panelIdx].kind ?? 'shell';
  const lines: [string, string][] = [
    ['삼각형 수', String(check.triangles)],
    ['정점 수', String(check.vertices)],
    ['열린 모서리', String(check.openEdges)],
    ['비다양체 모서리', String(check.nonManifoldEdges)],
    ['방향 불일치 모서리', String(check.inconsistentEdges)],
    ['표면적 (mm²)', fmt(check.area)],
    ['부피 (mm³)', fmt(Math.abs(check.volume))]
  ];
  if (mat) lines.push(['추정 질량 (tonne)', fmt(Math.abs(check.volume) * mat.rho)]);
  const table = h('table', { class: 'results' });
  for (const [k, v] of lines) {
    const tr = table.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = v;
  }
  const verdict = check.closed && check.consistent
    ? '닫힌 매니폴드 쉘입니다. 솔리드로 지정할 수 있습니다.'
    : check.closed
      ? '닫혀 있지만 면 방향이 일관되지 않습니다. 솔리드 지정 전에 법선을 정리해 주세요.'
      : '열린 쉘입니다. 솔리드로 판정할 수 없습니다.';
  const body = h(
    'div',
    { class: 'form-body' },
    h('div', { class: `verdict ${check.closed && check.consistent ? 'ok' : 'bad'}` }, verdict),
    table,
    h('div', { class: 'hint' }, `현재 지정: ${kind === 'solid' ? '솔리드' : '쉘'} · 현재 해석은 바 요소만 포함하며, 솔리드/쉘 해석은 이후 단계에서 지원합니다.`)
  );
  const canSolid = check.closed && check.consistent;
  openDialog('닫힌 쉘 판정', body, [
    { label: '닫기' },
    {
      label: '쉘 유지',
      onClick: () => {
        env.apply('쉘 지정', (m) => setPanelKind(m, [panelIdx], 'shell'));
      }
    },
    {
      label: '솔리드 지정',
      primary: true,
      onClick: () => {
        if (!canSolid) throw new Error('닫힌 일관 쉘만 솔리드로 지정할 수 있습니다.');
        env.apply('솔리드 지정', (m) => setPanelKind(m, [panelIdx], 'solid'));
      }
    }
  ]);
}
