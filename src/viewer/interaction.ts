import * as THREE from 'three';
import type { Viewer } from './Viewer';
import { emptySelection, type Selection } from '../core/selection';

export interface Hit {
  type: 'node' | 'bar' | 'panel';
  index: number;
}

export interface Handlers {
  click(hit: Hit | null, additive: boolean): void;
  box(sel: Selection, additive: boolean): void;
  context(hit: Hit | null, x: number, y: number): void;
}

export type SelectFilter = 'all' | 'node' | 'bar' | 'panel';

interface Projected {
  sx: Float64Array;
  sy: Float64Array;
  ok: Uint8Array;
}

interface Drag {
  x0: number;
  y0: number;
  additive: boolean;
  boxing: boolean;
  moved: boolean;
}

function segDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segHitsRect(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

export class Interaction {
  filter: SelectFilter = 'all';
  private boxMode = false;
  private boxEl: HTMLDivElement;
  private drag: Drag | null = null;
  private ctxDown: { x: number; y: number } | null = null;
  private longPress = 0;
  private raycaster = new THREE.Raycaster();

  constructor(private viewer: Viewer, private handlers: Handlers) {
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'select-box';
    viewer.host.appendChild(this.boxEl);
    const el = viewer.canvas;
    el.addEventListener('pointerdown', (e) => this.down(e), { capture: true });
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => this.cancel());
    el.addEventListener('contextmenu', (e) => this.contextMenu(e as PointerEvent));
  }

  setBoxMode(on: boolean): void {
    this.boxMode = on;
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.viewer.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private cancel(): void {
    window.clearTimeout(this.longPress);
    this.drag = null;
    this.viewer.controls.enabled = true;
    this.boxEl.style.display = 'none';
  }

  private down(e: PointerEvent): void {
    if (e.button === 2) {
      this.ctxDown = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    const p = this.local(e);
    const boxing = this.boxMode || e.shiftKey;
    this.drag = { x0: p.x, y0: p.y, additive: e.shiftKey || e.ctrlKey || e.metaKey, boxing, moved: false };
    if (boxing) this.viewer.controls.enabled = false;
    if (e.pointerType === 'touch') {
      window.clearTimeout(this.longPress);
      this.longPress = window.setTimeout(() => {
        if (this.drag && !this.drag.moved && !this.drag.boxing) {
          this.drag = null;
          this.handlers.context(this.pick(p.x, p.y), e.clientX, e.clientY);
        }
      }, 550);
    }
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const p = this.local(e);
    if (Math.hypot(p.x - d.x0, p.y - d.y0) > 4) d.moved = true;
    if (d.boxing && d.moved) {
      const s = this.boxEl.style;
      s.display = 'block';
      s.left = `${Math.min(p.x, d.x0)}px`;
      s.top = `${Math.min(p.y, d.y0)}px`;
      s.width = `${Math.abs(p.x - d.x0)}px`;
      s.height = `${Math.abs(p.y - d.y0)}px`;
      this.boxEl.classList.toggle('crossing', p.x < d.x0);
    }
  }

  private up(e: PointerEvent): void {
    window.clearTimeout(this.longPress);
    const d = this.drag;
    this.drag = null;
    this.viewer.controls.enabled = true;
    this.boxEl.style.display = 'none';
    if (!d || e.button !== 0) return;
    const p = this.local(e);
    if (d.boxing && d.moved) this.handlers.box(this.boxSelect(d.x0, d.y0, p.x, p.y), d.additive);
    else if (!d.moved) this.handlers.click(this.pick(p.x, p.y), d.additive);
  }

  private contextMenu(e: PointerEvent): void {
    e.preventDefault();
    if (e.pointerType === 'touch') return;
    if (this.ctxDown) {
      const moved = Math.hypot(e.clientX - this.ctxDown.x, e.clientY - this.ctxDown.y) > 5;
      this.ctxDown = null;
      if (moved) return;
    }
    const p = this.local(e);
    this.handlers.context(this.pick(p.x, p.y), e.clientX, e.clientY);
  }

  private project(): Projected {
    const base = this.viewer.getBase();
    const n = base.length / 3;
    const cam = this.viewer.camera;
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const w = this.viewer.canvas.clientWidth;
    const h = this.viewer.canvas.clientHeight;
    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    const ok = new Uint8Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]).project(cam);
      sx[i] = ((v.x + 1) / 2) * w;
      sy[i] = ((1 - v.y) / 2) * h;
      ok[i] = v.z > -1 && v.z < 1 ? 1 : 0;
    }
    return { sx, sy, ok };
  }

  pick(px: number, py: number): Hit | null {
    const f = this.filter;
    const pr = this.project();
    const n = pr.sx.length;

    if (f === 'all' || f === 'node') {
      let best = -1;
      let bd = 10;
      for (let i = 0; i < n; i++) {
        if (!pr.ok[i]) continue;
        const d = Math.hypot(pr.sx[i] - px, pr.sy[i] - py);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best >= 0) return { type: 'node', index: best };
    }

    if (f === 'all' || f === 'bar') {
      const bn = this.viewer.barNodes;
      let best = -1;
      let bd = 7;
      for (let i = 0; i < bn.length / 2; i++) {
        const a = bn[i * 2];
        const b = bn[i * 2 + 1];
        if (!pr.ok[a] || !pr.ok[b]) continue;
        const d = segDistance(px, py, pr.sx[a], pr.sy[a], pr.sx[b], pr.sy[b]);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best >= 0) return { type: 'bar', index: best };
    }

    if ((f === 'all' || f === 'panel') && this.viewer.panelMeshes.length > 0) {
      const w = this.viewer.canvas.clientWidth;
      const h = this.viewer.canvas.clientHeight;
      this.raycaster.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), this.viewer.camera);
      const hits = this.raycaster.intersectObjects(this.viewer.panelMeshes, false);
      if (hits.length > 0) return { type: 'panel', index: hits[0].object.userData.panel as number };
    }
    return null;
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number): Selection {
    const sel = emptySelection();
    const lx = Math.min(x0, x1);
    const hx = Math.max(x0, x1);
    const ly = Math.min(y0, y1);
    const hy = Math.max(y0, y1);
    const crossing = x1 < x0;
    const pr = this.project();
    const inside = (i: number): boolean => pr.ok[i] === 1 && pr.sx[i] >= lx && pr.sx[i] <= hx && pr.sy[i] >= ly && pr.sy[i] <= hy;
    const f = this.filter;

    if (f === 'all' || f === 'node') {
      for (let i = 0; i < pr.sx.length; i++) if (inside(i)) sel.nodes.add(i);
    }
    if (f === 'all' || f === 'bar') {
      const bn = this.viewer.barNodes;
      for (let i = 0; i < bn.length / 2; i++) {
        const a = bn[i * 2];
        const b = bn[i * 2 + 1];
        const ia = inside(a);
        const ib = inside(b);
        const hit = crossing
          ? ia || ib || (pr.ok[a] === 1 && pr.ok[b] === 1 && segHitsRect(pr.sx[a], pr.sy[a], pr.sx[b], pr.sy[b], lx, ly, hx, hy))
          : ia && ib;
        if (hit) sel.bars.add(i);
      }
    }
    if (f === 'all' || f === 'panel') {
      this.viewer.panelNodes.forEach((nodes, pi) => {
        const list = Array.from(nodes);
        const hit = crossing ? list.some(inside) : list.length > 0 && list.every(inside);
        if (hit) sel.panels.add(pi);
      });
    }
    return sel;
  }
}
