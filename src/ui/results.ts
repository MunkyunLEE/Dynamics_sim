import { cssColor, paletteColor } from '../core/palette';
import { fftAmplitude, logSpace, peakAbs, responseSpectrum, type SpectrumResult } from '../solvers/dsp';
import type { TimeHistoryResult } from '../solvers/timeHistory';
import { Chart, type Series } from './chart';
import { fmt, h, numInput, readNum, selectOf } from './dom';

type Tab = 'input' | 'acc' | 'vel' | 'disp' | 'fft' | 'spec';

const TABS: [Tab, string][] = [
  ['input', '입력 가속도'],
  ['acc', '가속도'],
  ['vel', '속도'],
  ['disp', '변위'],
  ['fft', '푸리에 변환'],
  ['spec', '응답스펙트럼']
];

const G = 9806.65;
const DIRS = ['X', 'Y', 'Z'];

export class ResultsDock {
  readonly el: HTMLDivElement;
  private chart = new Chart();
  private result: TimeHistoryResult | null = null;
  private tab: Tab = 'acc';
  private selected = new Set<number>();
  private nodeBox = h('div', { class: 'dock-nodes' });
  private dirSel = selectOf([['0', 'X'], ['1', 'Y'], ['2', 'Z']], '0');
  private unitSel = selectOf([['g', 'g'], ['mm/s2', 'mm/s²']], 'g');
  private frameSel = selectOf([['rel', '상대 (지반 대비)'], ['abs', '절대 (기선보정)']], 'rel');
  private overlay = h('input', { type: 'checkbox' });
  private logX = h('input', { type: 'checkbox' });
  private logY = h('input', { type: 'checkbox' });
  private xiInput = numInput(5, { min: 0, max: 50 });
  private specKind = selectOf([['sa', '가속도 Sa'], ['sv', '속도 Sv'], ['sd', '변위 Sd']], 'sa');
  private specAxis = selectOf([['f', '주파수 (Hz)'], ['t', '주기 (s)']], 'f');
  private tabs = h('div', { class: 'tabs dock-tabs' });
  private peaks = h('div', { class: 'dock-peaks' });
  private cache = new Map<string, SpectrumResult>();
  private lastSeries: Series[] = [];
  private tabButtons = new Map<Tab, HTMLButtonElement>();

  constructor() {
    for (const [id, label] of TABS) {
      const b = h('button', { type: 'button', class: 'tab', onclick: () => this.setTab(id) }, label);
      this.tabButtons.set(id, b);
      this.tabs.append(b);
    }
    const close = h('button', { type: 'button', class: 'btn', onclick: () => this.hide() }, '닫기');
    const save = h('button', { type: 'button', class: 'btn', onclick: () => this.exportCsv() }, 'CSV 저장');
    this.overlay.checked = true;
    this.logX.checked = false;
    const refresh = (): void => this.render();
    for (const c of [this.dirSel, this.unitSel, this.frameSel, this.overlay, this.logX, this.logY, this.specKind, this.specAxis, this.xiInput]) {
      c.addEventListener('change', refresh);
    }
    const lab = (text: string, c: HTMLElement): HTMLElement => h('label', { class: 'dock-field' }, text, c);
    const controls = h(
      'div',
      { class: 'dock-controls' },
      lab('방향', this.dirSel),
      lab('가속도 단위', this.unitSel),
      lab('속도·변위', this.frameSel),
      lab('감쇠비 ξ (%)', this.xiInput),
      lab('스펙트럼', this.specKind),
      lab('x축', this.specAxis),
      h('label', { class: 'check' }, this.overlay, '입력 겹쳐 보기'),
      h('label', { class: 'check' }, this.logX, 'x 로그'),
      h('label', { class: 'check' }, this.logY, 'y 로그'),
      save
    );
    this.el = h(
      'div',
      { class: 'dock' },
      h('div', { class: 'dock-head' }, this.tabs, close),
      controls,
      this.nodeBox,
      h('div', { class: 'dock-body' }, this.chart.el, this.peaks)
    );
    this.el.style.display = 'none';
  }

  show(result: TimeHistoryResult, xiPercent: number): void {
    this.result = result;
    this.cache.clear();
    this.xiInput.value = fmt(xiPercent);
    const ids = [...new Set(result.channels.map((c) => c.nodeId))];
    this.selected = new Set(ids.slice(0, 4));
    this.buildNodeBox(ids);
    this.el.style.display = 'flex';
    this.setTab(this.tab);
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  clear(): void {
    this.result = null;
    this.cache.clear();
    this.hide();
  }

  private buildNodeBox(ids: number[]): void {
    this.nodeBox.replaceChildren(h('span', { class: 'row-label' }, '출력 절점'));
    ids.forEach((id, i) => {
      const box = h('input', { type: 'checkbox' });
      box.checked = this.selected.has(id);
      box.addEventListener('change', () => {
        if (box.checked) this.selected.add(id);
        else this.selected.delete(id);
        this.render();
      });
      const dot = h('span', { class: 'dot' });
      dot.style.background = cssColor(paletteColor(i));
      this.nodeBox.append(h('label', { class: 'check' }, box, dot, `N${id}`));
    });
  }

  private setTab(t: Tab): void {
    this.tab = t;
    this.tabButtons.forEach((b, id) => b.classList.toggle('active', id === t));
    const spec = t === 'spec';
    const fft = t === 'fft';
    this.specKind.parentElement!.style.display = spec ? '' : 'none';
    this.specAxis.parentElement!.style.display = spec ? '' : 'none';
    this.xiInput.parentElement!.style.display = spec ? '' : 'none';
    this.frameSel.parentElement!.style.display = t === 'vel' || t === 'disp' ? '' : 'none';
    this.unitSel.parentElement!.style.display = t === 'input' || t === 'acc' || fft || spec ? '' : 'none';
    this.logX.checked = spec || fft;
    this.logY.checked = false;
    this.render();
  }

  private spectrumOf(key: string, acc: Float64Array, dt: number, xi: number): SpectrumResult {
    const k = `${key}:${xi}`;
    let s = this.cache.get(k);
    if (!s) {
      const fmax = Math.min(50, 0.4 / dt);
      s = responseSpectrum(acc, dt, xi, logSpace(0.2, fmax, 100));
      this.cache.set(k, s);
    }
    return s;
  }

  private render(): void {
    const r = this.result;
    if (!r) return;
    const dir = Number(this.dirSel.value);
    const accU = this.unitSel.value === 'g' ? 1 / G : 1;
    const accLabel = this.unitSel.value === 'g' ? 'g' : 'mm/s²';
    const time = new Float64Array(r.n);
    for (let i = 0; i < r.n; i++) time[i] = i * r.dt;
    const scaled = (a: Float64Array, k: number): Float64Array => (k === 1 ? a : a.map((v) => v * k));
    const series: Series[] = [];
    const nodes = [...new Set(r.channels.map((c) => c.nodeId))];
    const picked = r.channels.filter((c) => this.selected.has(c.nodeId) && c.dir === dir);
    const colorOf = (id: number): string => cssColor(paletteColor(nodes.indexOf(id)));
    const inputColor = '#9aa4b2';
    let opts = { xLabel: '시간 (s)', yLabel: '', logX: false, logY: false, title: '' };
    const xi = Math.max(0, readNum(this.xiInput) / 100) || 0;

    if (this.tab === 'input') {
      DIRS.forEach((d, i) => {
        if (peakAbs(r.inputAcc[i]) > 0) series.push({ name: `입력 a${d}`, x: time, y: scaled(r.inputAcc[i], accU), color: cssColor(paletteColor(i + 6)) });
      });
      opts = { ...opts, yLabel: `가속도 (${accLabel})`, title: '입력 절점 시간-가속도 이력' };
    } else if (this.tab === 'acc' || this.tab === 'vel' || this.tab === 'disp') {
      const abs = this.frameSel.value === 'abs';
      for (const c of picked) {
        const y = this.tab === 'acc' ? scaled(c.acc, accU) : this.tab === 'vel' ? (abs ? c.velAbs : c.vel) : abs ? c.dispAbs : c.disp;
        series.push({ name: `N${c.nodeId}`, x: time, y, color: colorOf(c.nodeId) });
      }
      if (this.overlay.checked) {
        const g = this.tab === 'acc' ? scaled(r.inputAcc[dir], accU) : this.tab === 'vel' ? r.inputVel[dir] : r.inputDisp[dir];
        if (abs || this.tab === 'acc') series.push({ name: `입력(${DIRS[dir]})`, x: time, y: g, color: inputColor, dashed: true });
      }
      const names = { acc: ['가속도', accLabel], vel: ['속도', 'mm/s'], disp: ['변위', 'mm'] }[this.tab];
      const rel = this.tab === 'acc' ? '절대' : abs ? '절대' : '상대';
      opts = { ...opts, yLabel: `${names[0]} (${names[1]})`, title: `${DIRS[dir]}방향 시간-${names[0]} 이력 (${rel})` };
    } else if (this.tab === 'fft') {
      for (const c of picked) {
        const f = fftAmplitude(c.acc, r.dt);
        series.push({ name: `N${c.nodeId}`, x: f.freqs, y: scaled(f.amp, accU), color: colorOf(c.nodeId) });
      }
      if (this.overlay.checked) {
        const f = fftAmplitude(r.inputAcc[dir], r.dt);
        series.push({ name: `입력(${DIRS[dir]})`, x: f.freqs, y: scaled(f.amp, accU), color: inputColor, dashed: true });
      }
      opts = { xLabel: '주파수 (Hz)', yLabel: `푸리에 진폭 (${accLabel}·s)`, logX: this.logX.checked, logY: this.logY.checked, title: `${DIRS[dir]}방향 가속도 푸리에 스펙트럼` };
    } else {
      const kind = this.specKind.value as 'sa' | 'sv' | 'sd';
      const useT = this.specAxis.value === 't';
      const pick = (s: SpectrumResult): { x: Float64Array; y: Float64Array } => ({
        x: useT ? s.periods : s.freqs,
        y: kind === 'sa' ? scaled(s.sa, accU) : kind === 'sv' ? s.sv : s.sd
      });
      for (const c of picked) {
        const s = pick(this.spectrumOf(`${c.nodeId}:${dir}`, c.acc, r.dt, xi));
        series.push({ name: `N${c.nodeId}`, x: s.x, y: s.y, color: colorOf(c.nodeId) });
      }
      if (this.overlay.checked) {
        const s = pick(this.spectrumOf(`in:${dir}`, r.inputAcc[dir], r.dt, xi));
        series.push({ name: `입력(${DIRS[dir]})`, x: s.x, y: s.y, color: inputColor, dashed: true });
      }
      const label = { sa: `Sa (${accLabel})`, sv: 'Sv (mm/s)', sd: 'Sd (mm)' }[kind];
      opts = {
        xLabel: useT ? '주기 (s)' : '주파수 (Hz)',
        yLabel: label,
        logX: this.logX.checked,
        logY: this.logY.checked,
        title: `${DIRS[dir]}방향 응답스펙트럼 (ξ=${(xi * 100).toFixed(1)}%)`
      };
    }
    this.lastSeries = series;
    this.chart.setData(series, opts);
    this.renderPeaks(series);
  }

  private renderPeaks(series: Series[]): void {
    const table = h('table', { class: 'results' });
    const head = table.insertRow();
    for (const t of ['계열', '최대 |값|', 'x 위치']) head.append(h('th', {}, t));
    for (const s of series) {
      let best = 0;
      for (let i = 1; i < s.y.length; i++) if (Math.abs(s.y[i]) > Math.abs(s.y[best])) best = i;
      const tr = table.insertRow();
      tr.insertCell().textContent = s.name;
      tr.insertCell().textContent = fmt(Math.abs(s.y[best] ?? 0));
      tr.insertCell().textContent = fmt(s.x[best] ?? 0);
    }
    this.peaks.replaceChildren(table);
  }

  private exportCsv(): void {
    const s = this.lastSeries;
    if (s.length === 0) return;
    const n = Math.max(...s.map((q) => q.x.length));
    const lines = [['x', ...s.map((q) => q.name)].join(',')];
    for (let i = 0; i < n; i++) {
      lines.push([s[0].x[i] ?? '', ...s.map((q) => q.y[i] ?? '')].join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.tab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
