import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { StructuralModel } from '../core/model';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

interface Target {
  attr: THREE.BufferAttribute;
  nodes: Int32Array;
}

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private modelGroup = new THREE.Group();
  private helpers = new THREE.Group();
  private targets: Target[] = [];
  private panelGeoms: THREE.BufferGeometry[] = [];
  private base = new Float64Array(0);
  private modelSize = 1;
  private shape: Float64Array | null = null;
  private amplitude = 1;
  private playing = true;
  private phase = 0;
  private lastTime = 0;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x1b1e23);
    this.scene.add(this.modelGroup, this.helpers);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(1, -2, 3);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 1e8);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(8000, -8000, 6000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop((time: number) => this.frame(time));
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

  private applyShape(s: number): void {
    const shape = this.shape;
    const k = this.amplitude * this.modelSize * 0.1 * s;
    for (const t of this.targets) {
      const arr = t.attr.array as Float32Array;
      for (let i = 0; i < t.nodes.length; i++) {
        const n = t.nodes[i] * 3;
        for (let d = 0; d < 3; d++) {
          arr[i * 3 + d] = this.base[n + d] + (shape ? shape[n + d] * k : 0);
        }
      }
      t.attr.needsUpdate = true;
    }
    for (const g of this.panelGeoms) g.computeVertexNormals();
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

  private register(geom: THREE.BufferGeometry, nodes: number[]): THREE.BufferAttribute {
    const pos: number[] = [];
    for (const n of nodes) pos.push(this.base[n * 3], this.base[n * 3 + 1], this.base[n * 3 + 2]);
    const attr = new THREE.Float32BufferAttribute(pos, 3);
    geom.setAttribute('position', attr);
    this.targets.push({ attr, nodes: Int32Array.from(nodes) });
    return attr;
  }

  setModel(model: StructuralModel): void {
    this.clearGroup(this.modelGroup);
    this.targets = [];
    this.panelGeoms = [];
    this.shape = null;

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

    if (model.bars.length > 0) {
      const nodes: number[] = [];
      for (const b of model.bars) nodes.push(index.get(b.n[0])!, index.get(b.n[1])!);
      const g = new THREE.BufferGeometry();
      this.register(g, nodes);
      add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x4da3ff })));
    }

    const allNodes = model.nodes.map((_, i) => i);
    for (const panel of model.panels) {
      const g = new THREE.BufferGeometry();
      const attr = this.register(g, allNodes);
      const idx: number[] = [];
      const edges = new Set<string>();
      const edgeIdx: number[] = [];
      for (const t of panel.tris) {
        const a = index.get(t[0])!;
        const b = index.get(t[1])!;
        const c = index.get(t[2])!;
        idx.push(a, b, c);
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
      add(
        new THREE.Mesh(
          g,
          new THREE.MeshStandardMaterial({ color: 0x9aa7b8, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
        )
      );
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', attr);
      eg.setIndex(edgeIdx);
      add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xc9d3e0 })));
    }

    this.addPoints(allNodes, 0xe6edf7, 5, add);
    this.addPoints(model.supports.map((s) => index.get(s.node)!), 0xffa94d, 11, add);
    this.addPoints(model.masses.map((m) => index.get(m.node)!), 0xff5fa2, 9, add);

    this.fit();
  }

  private addPoints(nodes: number[], color: number, size: number, add: (o: THREE.Object3D) => void): void {
    if (nodes.length === 0) return;
    const g = new THREE.BufferGeometry();
    this.register(g, nodes);
    add(new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false })));
  }

  fit(): void {
    const box = new THREE.Box3();
    for (let i = 0; i < this.base.length; i += 3) {
      box.expandByPoint(new THREE.Vector3(this.base[i], this.base[i + 1], this.base[i + 2]));
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.modelSize = Math.max(size.x, size.y, size.z, 1);
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
