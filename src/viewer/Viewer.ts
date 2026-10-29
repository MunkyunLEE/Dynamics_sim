import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { StructuralModel } from '../core/model';
import type { Selection } from '../core/selection';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

interface Target {
  attr: THREE.BufferAttribute;
  nodes: Int32Array;
}

export interface ModelOptions {
  fit?: boolean;
  barColors?: number[] | null;
  showHinges?: boolean;
}

const HINGE_COLOR: Record<string, number> = { free: 0xff7a59, spring: 0xc792ea, rigid: 0x8a93a3, none: 0x4a4f57 };

export class Viewer {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly canvas: HTMLCanvasElement;
  panelMeshes: THREE.Mesh[] = [];
  barNodes = new Int32Array(0);
  panelNodes: Int32Array[] = [];
  private panelTris: number[][] = [];
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private modelGroup = new THREE.Group();
  private overlay = new THREE.Group();
  private helpers = new THREE.Group();
  private targets: Target[] = [];
  private overlayTargets: Target[] = [];
  private panelGeoms: THREE.BufferGeometry[] = [];
  private base = new Float64Array(0);
  private model: StructuralModel | null = null;
  private modelSize = 1;
  private shape: Float64Array | null = null;
  private staticDisp: Float64Array | null = null;
  private hingeEdges = new Int32Array(0);
  private hlHinges: number[] = [];
  private lastSel: Selection | null = null;
  private lastK = 0;
  private amplitude = 1;
  private playing = true;
  private phase = 0;
  private lastTime = 0;

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.canvas = this.renderer.domElement;
    host.appendChild(this.canvas);

    this.scene.background = new THREE.Color(0x1b1e23);
    this.scene.add(this.modelGroup, this.overlay, this.helpers);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(1, -2, 3);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 1e8);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(8000, -8000, 6000);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop((time: number) => this.frame(time));
  }

  getBaseReference(): Float64Array {
    return this.base;
  }

  getBase(): Float64Array {
    if (!this.staticDisp) return this.base;
    const st = this.staticDisp;
    return this.base.map((v, i) => v + st[i]);
  }

  private frame(time: number): void {
    const dt = this.lastTime === 0 ? 0 : (time - this.lastTime) / 1000;
    this.lastTime = time;
    if (this.shape && this.playing) {
      this.phase += dt * 2 * Math.PI * 0.6;
      this.applyShape(Math.sin(this.phase));
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
    }
  }

  private applyTargets(list: Target[], k: number): void {
    const shape = this.shape;
    for (const t of list) {
      const arr = t.attr.array as Float32Array;
      for (let i = 0; i < t.nodes.length; i++) {
        const n = t.nodes[i] * 3;
        const st = this.staticDisp;
        for (let d = 0; d < 3; d++) arr[i * 3 + d] = this.base[n + d] + (st ? st[n + d] : 0) + (shape ? shape[n + d] * k : 0);
      }
      t.attr.needsUpdate = true;
    }
  }

  private applyShape(s: number): void {
    const k = this.amplitude * this.modelSize * 0.1 * s;
    this.lastK = k;
    this.applyTargets(this.targets, k);
    this.applyTargets(this.overlayTargets, k);
    for (const g of this.panelGeoms) g.computeVertexNormals();
  }

  setStaticDisplacement(disp: Float64Array | null): void {
    this.staticDisp = disp;
    this.applyShape(this.shape ? Math.sin(this.phase) : 0);
  }

  setHingeHighlight(idx: number[]): void {
    this.hlHinges = idx;
    if (this.lastSel) this.setSelection(this.lastSel);
  }

  setModeShape(shape: Float64Array | null): void {
    this.shape = shape;
    this.phase = 0;
    if (!shape) this.applyShape(0);
  }

  setAmplitude(factor: number): void {
    this.amplitude = factor;
    if (this.shape && !this.playing) this.applyShape(Math.sin(this.phase));
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    if (this.shape && !playing) this.applyShape(Math.sin(this.phase));
  }

  private register(list: Target[], geom: THREE.BufferGeometry, nodes: ArrayLike<number>): THREE.BufferAttribute {
    const pos: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      pos.push(this.base[n * 3], this.base[n * 3 + 1], this.base[n * 3 + 2]);
    }
    const attr = new THREE.Float32BufferAttribute(pos, 3);
    geom.setAttribute('position', attr);
    list.push({ attr, nodes: Int32Array.from(nodes) });
    return attr;
  }

  setModel(model: StructuralModel, opts: ModelOptions = {}): void {
    this.clearGroup(this.modelGroup);
    this.clearGroup(this.overlay);
    this.targets = [];
    this.overlayTargets = [];
    this.panelGeoms = [];
    this.panelMeshes = [];
    this.panelTris = [];
    this.panelNodes = [];
    this.shape = null;
    this.staticDisp = null;
    this.model = model;

    const index = new Map<number, number>();
    this.base = new Float64Array(model.nodes.length * 3);
    model.nodes.forEach((n, i) => {
      index.set(n.id, i);
      this.base.set(n.xyz, i * 3);
    });

    const add = (obj: THREE.Object3D): void => {
      obj.frustumCulled = false;
      this.modelGroup.add(obj);
    };

    this.barNodes = new Int32Array(model.bars.length * 2);
    model.bars.forEach((b, i) => {
      this.barNodes[i * 2] = index.get(b.n[0])!;
      this.barNodes[i * 2 + 1] = index.get(b.n[1])!;
    });

    if (model.bars.length > 0) {
      const g = new THREE.BufferGeometry();
      this.register(this.targets, g, this.barNodes);
      const colors = opts.barColors;
      if (colors) {
        const rgb: number[] = [];
        const c = new THREE.Color();
        for (let i = 0; i < model.bars.length; i++) {
          c.setHex(colors[i] ?? 0x4da3ff);
          rgb.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
        g.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
      }
      add(new THREE.LineSegments(g, new THREE.LineBasicMaterial(colors ? { vertexColors: true } : { color: 0x4da3ff })));
    }

    const allNodes = model.nodes.map((_, i) => i);
    model.panels.forEach((panel, pi) => {
      const g = new THREE.BufferGeometry();
      const attr = this.register(this.targets, g, allNodes);
      const idx: number[] = [];
      const edges = new Set<string>();
      const edgeIdx: number[] = [];
      const used = new Set<number>();
      for (const t of panel.tris) {
        const a = index.get(t[0])!;
        const b = index.get(t[1])!;
        const c = index.get(t[2])!;
        idx.push(a, b, c);
        used.add(a).add(b).add(c);
        for (const [p, q] of [[a, b], [b, c], [c, a]]) {
          const key = p < q ? `${p}_${q}` : `${q}_${p}`;
          if (!edges.has(key)) {
            edges.add(key);
            edgeIdx.push(p, q);
          }
        }
      }
      g.setIndex(idx);
      g.computeVertexNormals();
      this.panelGeoms.push(g);
      this.panelTris[pi] = idx;
      this.panelNodes[pi] = Int32Array.from(used);
      const solid = panel.kind === 'solid';
      const mesh = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({
          color: solid ? 0xb59a6b : 0x9aa7b8,
          transparent: true,
          opacity: solid ? 0.6 : 0.45,
          side: THREE.DoubleSide
        })
      );
      mesh.userData.panel = pi;
      this.panelMeshes.push(mesh);
      add(mesh);
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', attr);
      eg.setIndex(edgeIdx);
      add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: solid ? 0xe0c48a : 0xc9d3e0 })));
    });

    this.hingeEdges = new Int32Array(model.hinges.length * 2).fill(-1);
    model.hinges.forEach((hg, i) => {
      if (!hg.edge) return;
      this.hingeEdges[i * 2] = index.get(hg.edge[0]) ?? -1;
      this.hingeEdges[i * 2 + 1] = index.get(hg.edge[1]) ?? -1;
    });
    if (opts.showHinges && model.hinges.length > 0) {
      const nodes: number[] = [];
      const rgb: number[] = [];
      const c = new THREE.Color();
      model.hinges.forEach((hg, i) => {
        if (this.hingeEdges[i * 2] < 0 || this.hingeEdges[i * 2 + 1] < 0) return;
        nodes.push(this.hingeEdges[i * 2], this.hingeEdges[i * 2 + 1]);
        c.setHex(HINGE_COLOR[hg.type] ?? 0xff7a59);
        rgb.push(c.r, c.g, c.b, c.r, c.g, c.b);
      });
      if (nodes.length) {
        const g = new THREE.BufferGeometry();
        this.register(this.targets, g, nodes);
        g.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
        const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
        lines.renderOrder = 5;
        add(lines);
      }
    }

    const nodePts = this.base.length / 3;
    this.addPoints(this.range(nodePts), 0xe6edf7, 5, add);
    this.addPoints((model.inputNodes ?? []).map((id) => index.get(id)!).filter((i) => i !== undefined), 0x5be37d, 15, add);
    this.addPoints((model.outputNodes ?? []).map((id) => index.get(id)!).filter((i) => i !== undefined), 0x4dd0ff, 13, add);
    this.addPoints(model.supports.map((s) => index.get(s.node)!), 0xffa94d, 11, add);
    this.addPoints(model.masses.map((m) => index.get(m.node)!), 0xff5fa2, 9, add);

    if (opts.fit === false) this.updateBounds();
    else this.fit();
  }

  private range(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
  }

  private addPoints(nodes: number[], color: number, size: number, add: (o: THREE.Object3D) => void): void {
    if (nodes.length === 0) return;
    const g = new THREE.BufferGeometry();
    this.register(this.targets, g, nodes);
    add(new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false })));
  }

  setSelection(sel: Selection): void {
    this.lastSel = sel;
    this.clearGroup(this.overlay);
    this.overlayTargets = [];
    if (!this.model) return;
    const add = (obj: THREE.Object3D): void => {
      obj.frustumCulled = false;
      obj.renderOrder = 10;
      this.overlay.add(obj);
    };

    const hl: number[] = [];
    for (const i of this.hlHinges) {
      if (this.hingeEdges[i * 2] >= 0 && this.hingeEdges[i * 2 + 1] >= 0) hl.push(this.hingeEdges[i * 2], this.hingeEdges[i * 2 + 1]);
    }
    if (hl.length) {
      const g = new THREE.BufferGeometry();
      this.register(this.overlayTargets, g, hl);
      add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffe066, depthTest: false })));
      const ends = new THREE.BufferGeometry();
      this.register(this.overlayTargets, ends, hl);
      add(new THREE.Points(ends, new THREE.PointsMaterial({ color: 0xffe066, size: 9, sizeAttenuation: false, depthTest: false })));
    }

    if (sel.bars.size > 0) {
      const nodes: number[] = [];
      for (const bi of sel.bars) nodes.push(this.barNodes[bi * 2], this.barNodes[bi * 2 + 1]);
      const g = new THREE.BufferGeometry();
      this.register(this.overlayTargets, g, nodes);
      add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffe066, depthTest: false })));
      const ends = new THREE.BufferGeometry();
      this.register(this.overlayTargets, ends, nodes);
      add(new THREE.Points(ends, new THREE.PointsMaterial({ color: 0xffe066, size: 7, sizeAttenuation: false, depthTest: false })));
    }

    if (sel.nodes.size > 0) {
      const g = new THREE.BufferGeometry();
      this.register(this.overlayTargets, g, [...sel.nodes]);
      add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffe066, size: 15, sizeAttenuation: false, depthTest: false })));
    }

    for (const pi of sel.panels) {
      const g = new THREE.BufferGeometry();
      this.register(this.overlayTargets, g, this.range(this.base.length / 3));
      g.setIndex(this.panelTris[pi]);
      add(
        new THREE.Mesh(
          g,
          new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthTest: false })
        )
      );
    }
    this.applyTargets(this.overlayTargets, this.lastK);
  }

  private updateBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (let i = 0; i < this.base.length; i += 3) {
      box.expandByPoint(new THREE.Vector3(this.base[i], this.base[i + 1], this.base[i + 2]));
    }
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      this.modelSize = Math.max(size.x, size.y, size.z, 1);
    }
    return box;
  }

  fit(): void {
    const box = this.updateBounds();
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = this.modelSize * 0.5;
    const dist = (radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 2.4;

    this.camera.position.copy(center).add(new THREE.Vector3(1, -1.2, 0.8).normalize().multiplyScalar(dist));
    this.camera.near = Math.max(dist / 1000, 0.01);
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();

    this.clearGroup(this.helpers);
    const gridSize = Math.pow(10, Math.ceil(Math.log10(radius * 4)));
    const grid = new THREE.GridHelper(gridSize, 20, 0x4a5260, 0x2c323b);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(center.x, center.y, box.min.z);
    this.helpers.add(grid);
    const axes = new THREE.AxesHelper(radius * 0.4);
    axes.position.set(box.min.x, box.min.y, box.min.z);
    this.helpers.add(axes);
  }
}
