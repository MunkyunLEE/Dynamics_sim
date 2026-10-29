import type { BarSection, ShapeSpec, ShapeType, Vec3 } from '../core/model';
import { assignBarSection, sectionUsage, upsertBarSection } from '../core/edit';
import { barEnds, nodeIndexMap } from '../core/selection';
import {
  SHAPE_INFO,
  equivalentProps,
  inverseFromStory,
  shapeProps,
  shearModulus,
  stiffnessOf,
  storyStiffness,
  validateProps,
  type BoundaryCase,
  type SectionProps
} from '../core/sections';
import { localAxes } from '../fem/bar';
import { openDialog } from './dialog';
import { fmt, h, numInput, readNum, row, selectOf } from './dom';
import type { EditorEnv } from './env';

function axisName(v: Vec3): string {
  const a = v.map(Math.abs);
  return ['X', 'Y', 'Z'][a.indexOf(Math.max(...a))];
}

export function openSectionDialog(env: EditorEnv, barIdx: number[]): void {
  const model = env.model();
  const map = nodeIndexMap(model);
  const firstBar = model.bars[barIdx[0]];
  const mat = model.materials.find((m) => m.id === firstBar.mat)!;
  const E = mat.E;
  const G = shearModulus(E, mat.nu);
  const mixed = barIdx.some((bi) => model.materials.find((m) => m.id === model.bars[bi].mat)?.E !== E);
  const curSec = model.sections.find((s): s is BarSection => s.type === 'bar' && s.id === firstBar.sec);
  const cur: SectionProps = curSec
    ? { A: curSec.A, Iy: curSec.Iy, Iz: curSec.Iz, J: curSec.J }
    : { A: 10000, Iy: 1e8, Iz: 1e8, J: 2e8 };

  let totalLen = 0;
  for (const bi of barIdx) {
    const [a, b] = barEnds(model, map, bi);
    totalLen += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  const avgLen = totalLen / barIdx.length;
  const [p0, p1] = barEnds(model, map, barIdx[0]);
  const axes = localAxes(p0, p1, firstBar.orient).R;
  const dirIy = axisName(axes[2]);
  const dirIz = axisName(axes[1]);

  let n = 1;
  while (model.sections.some((s) => s.id === `S${n}`)) n++;
  const nameInput = h('input', { type: 'text', value: `S${n}`, list: 'section-names' });
  const names = h('datalist', { id: 'section-names' });
  for (const s of model.sections) if (s.type === 'bar') names.append(h('option', { value: s.id }));
  const nameHint = h('div', { class: 'hint' });

  const dA = numInput(cur.A);
  const dIy = numInput(cur.Iy);
  const dIz = numInput(cur.Iz);
  const dJ = numInput(cur.J);
  const directPane = h(
    'div',
    { class: 'pane' },
    row('단면적 A (mm²)', dA),
    row('Iy (mm⁴)', dIy, `국부 x-z 평면 휨 · ${dirIy}방향 변위에 저항`),
    row('Iz (mm⁴)', dIz, `국부 x-y 평면 휨 · ${dirIz}방향 변위에 저항`),
    row('비틀림상수 J (mm⁴)', dJ)
  );

  const shapeSel = selectOf(
    (Object.keys(SHAPE_INFO) as ShapeType[]).map((k) => [k, SHAPE_INFO[k].label]),
    curSec?.shape?.type ?? 'rect'
  );
  const dimsBox = h('div');
  let dimInputs: HTMLInputElement[] = [];
  const renderDims = (): void => {
    const type = shapeSel.value as ShapeType;
    const info = SHAPE_INFO[type];
    const prev = curSec?.shape?.type === type ? curSec.shape.dims : info.defaults;
    dimInputs = info.dims.map((_, i) => numInput(prev[i] ?? info.defaults[i]));
    dimsBox.replaceChildren(...info.dims.map((label, i) => row(`${label} (mm)`, dimInputs[i])));
  };
  renderDims();
  shapeSel.addEventListener('change', () => {
    renderDims();
    update();
  });
  const shapePane = h('div', { class: 'pane' }, row('형상', shapeSel), dimsBox);
  const shapeSpec = (): ShapeSpec => ({ type: shapeSel.value as ShapeType, dims: dimInputs.map(readNum) });

  const k0 = stiffnessOf(cur, E, G);
  const eEA = numInput(k0.EA);
  const eEIy = numInput(k0.EIy);
  const eEIz = numInput(k0.EIz);
  const eGJ = numInput(k0.GJ);
  const eqPane = h(
    'div',
    { class: 'pane' },
    h('div', { class: 'hint' }, `선택 부재 재료 기준 E=${fmt(E)} MPa, G=${fmt(G)} MPa 로 A, I, J 를 환산해 저장합니다.`),
    row('축강성 EA (N)', eEA),
    row('휨강성 EIy (N·mm²)', eEIy),
    row('휨강성 EIz (N·mm²)', eEIz),
    row('비틀림강성 GJ (N·mm²)', eGJ)
  );

  const boundSel = selectOf(
    [
      ['fixed', '양단 고정 (12EI/h³, 상하 보 강접)'],
      ['cantilever', '캔틸레버 (3EI/h³)']
    ],
    'fixed'
  );
  const storyArgs = (): { count: number; height: number; E: number; boundary: BoundaryCase } => ({
    count: barIdx.length,
    height: avgLen,
    E,
    boundary: boundSel.value as BoundaryCase
  });
  const k1 = storyStiffness(cur, storyArgs());
  const iK1 = numInput(k1.K1);
  const iK2 = numInput(k1.K2);
  const iKax = numInput(k1.Kax);
  boundSel.addEventListener('change', () => {
    const k = storyStiffness(cur, storyArgs());
    iK1.value = fmt(k.K1);
    iK2.value = fmt(k.K2);
    iKax.value = fmt(k.Kax);
    update();
  });
  const invPane = h(
    'div',
    { class: 'pane' },
    h(
      'div',
      { class: 'hint' },
      `선택 부재 ${barIdx.length}개가 같은 단면이라고 보고 합산 강성을 역산합니다. 평균 길이 h=${fmt(avgLen)} mm, E=${fmt(E)} MPa. 값을 비우면 해당 항목은 현재 단면 값을 유지합니다.`
    ),
    row('경계조건', boundSel),
    row(`횡강성 K1 (N/mm) → Iy`, iK1, `${dirIy}방향 층 횡강성`),
    row(`횡강성 K2 (N/mm) → Iz`, iK2, `${dirIz}방향 층 횡강성`),
    row('축강성 Kax (N/mm) → A', iKax, 'EA/h 합계')
  );

  const getters: (() => SectionProps)[] = [
    () => ({ A: readNum(dA), Iy: readNum(dIy), Iz: readNum(dIz), J: readNum(dJ) }),
    () => shapeProps(shapeSpec()),
    () => equivalentProps({ EA: readNum(eEA), EIy: readNum(eEIy), EIz: readNum(eEIz), GJ: readNum(eGJ) }, E, G),
    () => {
      const pick = (el: HTMLInputElement): number | undefined => (el.value.trim() === '' ? undefined : readNum(el));
      return inverseFromStory({ K1: pick(iK1), K2: pick(iK2), Kax: pick(iKax) }, storyArgs(), cur);
    }
  ];

  const panes = [directPane, shapePane, eqPane, invPane];
  const labels = ['직접 입력', '형상', '등가 강성', '층강성 역산'];
  let tab = 0;
  const preview = h('div', { class: 'preview' });
  const tabButtons = labels.map((label, i) => h('button', { type: 'button', class: 'tab', onclick: () => choose(i) }, label));
  const choose = (i: number): void => {
    tab = i;
    tabButtons.forEach((b, j) => b.classList.toggle('active', j === i));
    panes.forEach((p, j) => {
      p.style.display = j === i ? 'block' : 'none';
    });
    update();
  };

  const usage = sectionUsage(model);
  const update = (): void => {
    try {
      const p = getters[tab]();
      validateProps(p);
      preview.classList.remove('bad');
      preview.textContent = `A=${fmt(p.A)} mm²   Iy=${fmt(p.Iy)}   Iz=${fmt(p.Iz)}   J=${fmt(p.J)} mm⁴`;
    } catch (err) {
      preview.classList.add('bad');
      preview.textContent = err instanceof Error ? err.message : String(err);
    }
    const id = nameInput.value.trim();
    const found = model.sections.find((s) => s.id === id);
    if (!id) nameHint.textContent = '단면 이름을 입력해 주세요.';
    else if (found && found.type !== 'bar') nameHint.textContent = `'${id}' 는 쉘 단면 이름입니다.`;
    else if (found) {
      const others = (usage.get(id) ?? 0) - barIdx.filter((bi) => model.bars[bi].sec === id).length;
      nameHint.textContent =
        others > 0
          ? `기존 단면 '${id}' 를 수정합니다. 이 단면을 쓰는 다른 부재 ${others}개에도 반영됩니다.`
          : `기존 단면 '${id}' 를 수정하고 선택 부재에 배정합니다.`;
    } else nameHint.textContent = `새 단면 '${id}' 를 만들어 선택 부재 ${barIdx.length}개에만 배정합니다.`;
  };

  nameInput.addEventListener('input', update);
  nameInput.addEventListener('change', () => {
    const found = model.sections.find((s): s is BarSection => s.type === 'bar' && s.id === nameInput.value.trim());
    if (!found) return;
    dA.value = fmt(found.A);
    dIy.value = fmt(found.Iy);
    dIz.value = fmt(found.Iz);
    dJ.value = fmt(found.J);
    choose(0);
  });

  const body = h(
    'div',
    { class: 'form-body' },
    names,
    h('div', { class: 'hint' }, `선택 부재 ${barIdx.length}개${mixed ? ' · 재료가 섞여 있어 첫 부재의 E 기준으로 환산합니다' : ''}`),
    row('단면 이름', nameInput),
    nameHint,
    h('div', { class: 'tabs' }, ...tabButtons),
    ...panes,
    preview
  );
  body.addEventListener('input', update);
  choose(0);

  openDialog('단면 설정', body, [
    { label: '취소' },
    {
      label: '적용',
      primary: true,
      onClick: () => {
        const props = getters[tab]();
        validateProps(props);
        const id = nameInput.value.trim();
        if (!id) throw new Error('단면 이름을 입력해 주세요.');
        const shape = tab === 1 ? shapeSpec() : undefined;
        env.apply('단면 설정', (m) => {
          upsertBarSection(m, id, props, shape);
          assignBarSection(m, barIdx, id);
        });
      }
    }
  ]);
}
