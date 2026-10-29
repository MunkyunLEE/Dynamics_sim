import { h } from './dom';

export interface Series {
  name: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color: string;
  dashed?: boolean;
}

export interface ChartOptions {
  title?: string;
  xLabel: string;
  yLabel: string;
  logX?: boolean;
  logY?: boolean;
}

const PAD = { l: 64, r: 14, t: 26, b: 34 };

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

function fmtTick(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(1);
  return String(Number(v.toPrecision(4)));
}

export class Chart {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private tip: HTMLDivElement;
  private series: Series[] = [];
  private opts: ChartOptions = { xLabel: '', yLabel: '' };
  private view: { x0: number; x1: number } | null = null;
  private hover: number | null = null;

  constructor() {
    this.canvas = h('canvas');
    this.tip = h('div', { class: 'chart-tip' });
    this.el = h('div', { class: 'chart' }, this.canvas, this.tip);
    new ResizeObserver(() => this.draw()).observe(this.el);
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hover = e.clientX - r.left;
      this.draw();
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.tip.style.display = 'none';
      this.draw();
    });
    this.canvas.addEventListener('dblclick', () => {
      this.view = null;
      this.draw();
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const b = this.bounds();
        if (!b) return;
        const w = this.canvas.clientWidth - PAD.l - PAD.r;
        const r = this.canvas.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (e.clientX - r.left - PAD.l) / w));
        const cur = this.view ?? { x0: b.x0, x1: b.x1 };
        const k = e.deltaY > 0 ? 1.25 : 0.8;
        const span = (cur.x1 - cur.x0) * k;
        const c = cur.x0 + (cur.x1 - cur.x0) * frac;
        this.view = { x0: c - span * frac, x1: c + span * (1 - frac) };
        this.draw();
      },
      { passive: false }
    );
  }

  setData(series: Series[], opts: ChartOptions): void {
    if (opts.logX !== this.opts.logX || opts.xLabel !== this.opts.xLabel) this.view = null;
    this.series = series;
    this.opts = opts;
    this.draw();
  }

  private tx(v: number): number {
    return this.opts.logX ? Math.log10(Math.max(v, 1e-300)) : v;
  }

  private ty(v: number): number {
    return this.opts.logY ? Math.log10(Math.max(v, 1e-300)) : v;
  }

  private bounds(): { x0: number; x1: number; y0: number; y1: number } | null {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const s of this.series) {
      for (let i = 0; i < s.x.length; i++) {
        const v = s.x[i];
        if (this.opts.logX && v <= 0) continue;
        if (v < x0) x0 = v;
        if (v > x1) x1 = v;
      }
    }
    if (!Number.isFinite(x0)) return null;
    return { x0, x1, y0: 0, y1: 0 };
  }

  private draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    if (W < 10 || H < 10) return;
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--text').trim() || '#ddd';
    const muted = css.getPropertyValue('--muted').trim() || '#999';
    const line = css.getPropertyValue('--line').trim() || '#444';
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px sans-serif';

    const b = this.bounds();
    const pw = W - PAD.l - PAD.r;
    const ph = H - PAD.t - PAD.b;
    if (!b || this.series.length === 0) {
      ctx.fillStyle = muted;
      ctx.fillText('표시할 데이터가 없습니다.', PAD.l, PAD.t + 20);
      return;
    }
    const vx0 = this.tx(this.view?.x0 ?? b.x0);
    const vx1 = this.tx(this.view?.x1 ?? b.x1);
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const s of this.series) {
      for (let i = 0; i < s.x.length; i++) {
        const xv = this.tx(s.x[i]);
        if (xv < vx0 || xv > vx1) continue;
        if (this.opts.logY && s.y[i] <= 0) continue;
        const yv = this.ty(s.y[i]);
        if (yv < y0) y0 = yv;
        if (yv > y1) y1 = yv;
      }
    }
    if (!Number.isFinite(y0)) {
      y0 = 0;
      y1 = 1;
    }
    if (y1 - y0 < 1e-300) {
      y0 -= 0.5;
      y1 += 0.5;
    }
    const padY = (y1 - y0) * 0.06;
    y0 -= padY;
    y1 += padY;

    const X = (v: number): number => PAD.l + ((this.tx(v) - vx0) / (vx1 - vx0 || 1)) * pw;
    const Y = (v: number): number => PAD.t + ph - ((this.ty(v) - y0) / (y1 - y0)) * ph;

    ctx.strokeStyle = line;
    ctx.fillStyle = muted;
    ctx.lineWidth = 1;
    const ticks = (a: number, b2: number, log: boolean, target: number): number[] => {
      if (log) {
        const out: number[] = [];
        for (let e = Math.floor(a); e <= Math.ceil(b2); e++) out.push(e);
        return out;
      }
      const step = niceStep(b2 - a, target);
      const out: number[] = [];
      for (let v = Math.ceil(a / step) * step; v <= b2 + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
      return out;
    };
    for (const t of ticks(vx0, vx1, !!this.opts.logX, pw / 90)) {
      const px = PAD.l + ((t - vx0) / (vx1 - vx0 || 1)) * pw;
      if (px < PAD.l - 0.5 || px > PAD.l + pw + 0.5) continue;
      ctx.beginPath();
      ctx.moveTo(px, PAD.t);
      ctx.lineTo(px, PAD.t + ph);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(fmtTick(this.opts.logX ? Math.pow(10, t) : t), px, H - PAD.b + 14);
    }
    for (const t of ticks(y0, y1, !!this.opts.logY, ph / 40)) {
      const py = PAD.t + ph - ((t - y0) / (y1 - y0)) * ph;
      if (py < PAD.t - 0.5 || py > PAD.t + ph + 0.5) continue;
      ctx.beginPath();
      ctx.moveTo(PAD.l, py);
      ctx.lineTo(PAD.l + pw, py);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(fmtTick(this.opts.logY ? Math.pow(10, t) : t), PAD.l - 6, py + 3);
    }
    ctx.strokeStyle = muted;
    ctx.strokeRect(PAD.l, PAD.t, pw, ph);

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t, pw, ph);
    ctx.clip();
    ctx.lineWidth = 1.3;
    for (const s of this.series) {
      ctx.strokeStyle = s.color;
      ctx.setLineDash(s.dashed ? [5, 3] : []);
      ctx.beginPath();
      let started = false;
      let lastPx = -1;
      let lo = Infinity;
      let hi = -Infinity;
      const flush = (px: number): void => {
        if (lo === Infinity) return;
        if (!started) {
          ctx.moveTo(px, Y(lo));
          started = true;
        }
        ctx.lineTo(px, Y(lo));
        if (hi !== lo) ctx.lineTo(px, Y(hi));
        lo = Infinity;
        hi = -Infinity;
      };
      for (let i = 0; i < s.x.length; i++) {
        if (this.opts.logY && s.y[i] <= 0) continue;
        if (this.opts.logX && s.x[i] <= 0) continue;
        const px = Math.round(X(s.x[i]));
        if (px !== lastPx) {
          flush(lastPx);
          lastPx = px;
        }
        lo = Math.min(lo, s.y[i]);
        hi = Math.max(hi, s.y[i]);
      }
      flush(lastPx);
      ctx.stroke();
    }
    ctx.restore();
    ctx.setLineDash([]);

    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    ctx.fillText(this.opts.xLabel, PAD.l + pw / 2, H - 4);
    ctx.save();
    ctx.translate(12, PAD.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(this.opts.yLabel, 0, 0);
    ctx.restore();
    if (this.opts.title) {
      ctx.textAlign = 'left';
      ctx.fillText(this.opts.title, PAD.l, 14);
    }
    let lx = W - PAD.r;
    ctx.textAlign = 'right';
    for (const s of [...this.series].reverse()) {
      const wTxt = ctx.measureText(s.name).width;
      ctx.fillStyle = text;
      ctx.fillText(s.name, lx, 14);
      ctx.fillStyle = s.color;
      ctx.fillRect(lx - wTxt - 18, 8, 12, 3);
      lx -= wTxt + 28;
    }

    if (this.hover !== null && this.hover >= PAD.l && this.hover <= PAD.l + pw) {
      const xv = vx0 + ((this.hover - PAD.l) / pw) * (vx1 - vx0);
      const xReal = this.opts.logX ? Math.pow(10, xv) : xv;
      ctx.strokeStyle = muted;
      ctx.beginPath();
      ctx.moveTo(this.hover, PAD.t);
      ctx.lineTo(this.hover, PAD.t + ph);
      ctx.stroke();
      const lines = [`${this.opts.xLabel.split(' ')[0]} = ${fmtTick(xReal)}`];
      for (const s of this.series) {
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < s.x.length; i++) {
          const d = Math.abs(this.tx(s.x[i]) - xv);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        lines.push(`${s.name}: ${fmtTick(s.y[best])}`);
      }
      this.tip.textContent = lines.join('\n');
      this.tip.style.display = 'block';
      this.tip.style.left = `${Math.min(this.hover + 12, W - 150)}px`;
      this.tip.style.top = `${PAD.t + 4}px`;
    } else {
      this.tip.style.display = 'none';
    }
  }
}
