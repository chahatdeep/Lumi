import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

export class Viewer {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-120, -260, 140);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0, 40);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.4);
    this.hemi.position.set(0, 0, 1);
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.key.position.set(-1, -2, 2.5);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.6);
    this.fill.position.set(2, 1, 1);
    this.scene.add(this.hemi, this.key, this.fill);

    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);
    this.buildGrid(false);

    this.mesh = null;
    this.mats = {
      back: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      none: new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.55, metalness: 0, side: THREE.DoubleSide }),
      normal: new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }),
    };
    this.mats.clay = new THREE.MeshStandardMaterial({ color: 0xe9dccb, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
    this.popMesh = null;
    this.scene3 = 'litho';
    this.bboxes = {};
    this.mode = 'back';
    this.lightOpts = null;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.el.offsetParent) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  buildGrid(dark) {
    this.gridGroup.clear();
    const c1 = dark ? 0x3a4250 : 0xb8c0cc, c2 = dark ? 0x232832 : 0xdde2ea;
    const fine = new THREE.GridHelper(600, 120, c2, c2);
    const coarse = new THREE.GridHelper(600, 12, c1, c1);
    for (const g of [fine, coarse]) {
      g.rotation.x = Math.PI / 2;
      g.material.transparent = true;
      g.material.opacity = 0.9;
      g.material.depthWrite = false;
      this.gridGroup.add(g);
    }
    fine.position.z = -0.05; coarse.position.z = -0.04;
  }

  setTheme(dark) { this.dark = dark; this.buildGrid(dark); }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMesh({ pos, idx, thick }, fit) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    this.thick = thick;
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.geometry = geo; }
    else {
      this.mesh = new THREE.Mesh(geo, this.mats[this.mode]);
      this.scene.add(this.mesh);
    }
    geo.computeBoundingBox();
    this.bboxes.litho = geo.boundingBox;
    this.mesh.visible = this.scene3 === 'litho';
    if (this.scene3 === 'litho') this.bbox = geo.boundingBox;
    if (this.lightOpts) this.applyColors();
    if (fit && this.scene3 === 'litho') this.fit();
  }

  setPopMesh({ pos, idx }, fit) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    if (this.popMesh) { this.popMesh.geometry.dispose(); this.popMesh.geometry = geo; }
    else { this.popMesh = new THREE.Mesh(geo, this.mats.clay); this.scene.add(this.popMesh); }
    this.bboxes.pop = geo.boundingBox;
    this.popMesh.visible = this.scene3 === 'pop';
    if (this.scene3 === 'pop') { this.bbox = geo.boundingBox; if (fit) this.fit(); }
  }

  setScene(name) {
    if (this.scene3 === name) return;
    this.scene3 = name;
    if (this.mesh) this.mesh.visible = name === 'litho';
    if (this.popMesh) this.popMesh.visible = name === 'pop';
    this.bbox = this.bboxes[name] || null;
    if (this.bbox) this.fit();
  }

  setLighting(o) {
    this.lightOpts = o;
    this.mode = o.mode;
    this.mats.none.color.set(o.materialColor);
    if (this.mesh) this.mesh.material = this.mats[o.mode];
    this.applyColors();
  }

  setWireframe(on) { for (const m of Object.values(this.mats)) m.wireframe = on; }
  setClayColor(c) { this.mats.clay.color.set(c); }
  setGrid(on) { this.gridGroup.visible = on; }
  setAutoRotate(on) { this.controls.autoRotate = on; this.controls.autoRotateSpeed = 1.6; }

  applyColors() {
    if (!this.mesh || !this.thick || this.mode !== 'back') return;
    const o = this.lightOpts;
    const col = new THREE.Color(o.lightColor);
    col.convertSRGBToLinear();
    const k = o.attenuation, Ta = Math.exp(-k * o.tmin), Tb = Math.exp(-k * o.tmax);
    const lo = o.intensityMin / 100, hi = o.intensityMax / 100;
    const attr = this.mesh.geometry.getAttribute('color');
    const c = attr.array, t = this.thick;
    for (let i = 0; i < t.length; i++) {
      const nrm = (Math.exp(-k * t[i]) - Tb) / (Ta - Tb);
      let b = lo + (hi - lo) * nrm;
      b = b < 0 ? Math.max(0, lo * Math.exp(-k * (t[i] - o.tmax))) * 0.6 : Math.min(1, b);
      const lin = b * b; // perceptual -> linear
      c[i * 3] = col.r * lin; c[i * 3 + 1] = col.g * lin; c[i * 3 + 2] = col.b * lin;
    }
    attr.needsUpdate = true;
  }

  fit() {
    if (!this.bbox) return;
    const b = this.bbox, size = new THREE.Vector3(), ctr = new THREE.Vector3();
    b.getSize(size); b.getCenter(ctr);
    const r = size.length() / 2;
    const dist = r / Math.sin((this.camera.fov * Math.PI) / 360) * 1.15;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(ctr);
    this.camera.position.copy(ctr).addScaledVector(dir, dist);
  }

  view(name) {
    if (!this.bbox) return;
    const dirs = { front: [0, -1, 0.0001], back: [0, 1, 0.0001], top: [0, -0.0001, 1], left: [-1, 0, 0.0001], right: [1, 0, 0.0001], iso: [-0.45, -1, 0.55] };
    const d = new THREE.Vector3(...dirs[name]).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(d, 1);
    this.fit();
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  // Square product-style thumbnail of the current model on a transparent background (embedded in 3MF exports).
  thumbnail(size = 512) {
    const mesh = this.scene3 === 'pop' ? this.popMesh : this.mesh;
    if (!mesh) return null;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const r = this.renderer;
    const oldSize = new THREE.Vector2();
    r.getSize(oldSize);
    const oldRatio = r.getPixelRatio();
    const gridWas = this.gridGroup.visible;
    const matWas = mesh.material;
    // shaded clay shows shape best; lithophanes keep the back-lit photo look
    if (this.scene3 === 'pop' || this.mode === 'normal') mesh.material = this.mats.clay;
    this.gridGroup.visible = false;

    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20000);
    cam.up.set(0, 0, 1);
    const ctr = new THREE.Vector3(), dims = new THREE.Vector3();
    bb.getCenter(ctr); bb.getSize(dims);
    const dir = this.scene3 === 'pop' ? new THREE.Vector3(-0.5, -1, 0.45) : new THREE.Vector3(-0.3, -1, 0.2);
    dir.normalize();
    const radius = dims.length() / 2;
    cam.position.copy(ctr).addScaledVector(dir, (radius / Math.sin((cam.fov * Math.PI) / 360)) * 1.02);
    cam.lookAt(ctr);
    cam.updateProjectionMatrix();

    // render large, then crop to the pixels the model actually covers so it fills the thumbnail
    const big = size * 2;
    r.setPixelRatio(1);
    r.setSize(big, big, false);
    r.setClearColor(0x000000, 0);
    r.render(this.scene, cam);
    const src = document.createElement('canvas');
    src.width = src.height = big;
    const sg = src.getContext('2d', { willReadFrequently: true });
    sg.drawImage(r.domElement, 0, 0);
    const px = sg.getImageData(0, 0, big, big).data;
    let x0 = big, y0 = big, x1 = -1, y1 = -1;
    for (let y = 0; y < big; y++) for (let x = 0; x < big; x++) {
      if (px[(y * big + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const og = out.getContext('2d');
    // opaque soft background: Windows shows transparent thumbnail pixels as black
    const bg = og.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, '#f6f7fa'); bg.addColorStop(1, '#dde2ea');
    og.fillStyle = bg; og.fillRect(0, 0, size, size);
    if (x1 >= x0) {
      const side = Math.max(x1 - x0, y1 - y0) / 0.88; // ~6% margin each side
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      og.drawImage(src, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
    }
    const url = out.toDataURL('image/png');

    mesh.material = matWas;
    this.gridGroup.visible = gridWas;
    r.setPixelRatio(oldRatio);
    r.setSize(oldSize.x, oldSize.y, false);
    r.render(this.scene, this.camera);
    return url;
  }
}
