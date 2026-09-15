// Renderer, map geometry, lighting and short-lived effects (tracers, bullet holes, particles, flashes).
// Performance: the static map is merged into one mesh per material, the shadow map is rendered once,
// and there are no dynamic lights.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MAP_BOXES } from '/shared/map.js';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0); // hidden instance
const WHITE = new THREE.Color(1, 1, 1);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// color, texture, world-UV tile size (0 = per-face UVs like a crate)
const MATS = {
  f: [0x9aa1a8, 'grid2', 2], b: [0xcfc8bb, 'grid4', 1], c: [0xdcd5c8, 'grid4', 1], m: [0x5d7e98, 'metal', 1.2],
  w: [0xc98f4e, 'crate', 0], p: [0xdcb47c, 'planks', 1.2], d: [0xece7de, 'drywall', 1.2], h: [0x97a9b8, 'metal', 0.8],
};
const DECAL = { w: 0x3b2410, p: 0x4a2f14, m: 0x2a2f36, h: 0x2a2f36, d: 0x6b655c };
const DUST = { w: 0x9c6a3a, p: 0xb88a52, m: 0xffd27a, h: 0xffd27a, d: 0xf2eee6 };

function canvasTex(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const TEX = {
  grass: () => canvasTex(128, (g, size) => {
    g.fillStyle = '#f1f2e5'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = i % 2 ? 'rgba(55,70,20,0.13)' : 'rgba(255,255,220,0.18)';
      g.fillRect((i * 73) % size, (i * i * 31 + i * 7) % size, 1, 3);
    }
  }),
  grid2: () => gridTex(2), grid4: () => gridTex(4),
  crate: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#b98b5f'; g.lineWidth = 12; g.strokeRect(6, 6, s - 12, s - 12);
    g.lineWidth = 8; g.beginPath(); g.moveTo(12, 12); g.lineTo(s - 12, s - 12); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 2;
    for (let y = 24; y < s; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
  }),
  metal: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 6, s); }
  }),
  planks: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(90,50,10,0.18)';
    for (let y = 0; y < s; y += 32) g.fillRect(0, y, s, 2);
    for (let y = 0; y < s; y += 32) for (let x = 12 + (y % 64 ? 40 : 0); x < s; x += 80) { g.fillRect(x, y + 6, 3, 3); g.fillRect(x, y + 22, 3, 3); }
  }),
  drywall: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 0, 2, s); g.fillRect(0, 0, s, 2);
  }),
};
function gridTex(div) {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#e2e2e2'; g.lineWidth = 2;
    for (let i = 1; i < div; i++) {
      const p = (i * s) / div;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, s); g.moveTo(0, p); g.lineTo(s, p); g.stroke();
    }
    g.strokeStyle = '#c4c4c4'; g.lineWidth = 4; g.strokeRect(0, 0, s, s);
  });
}

function flashTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.35, 'rgba(255,200,90,0.8)');
  grd.addColorStop(1, 'rgba(255,120,0,0)');
  c.fillStyle = grd;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

// World-aligned UVs so textures keep a constant real-world size on every surface.
function worldUV(geo, scale) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i, x / scale, z / scale);
    else if (nx >= nz) uv.setXY(i, z / scale, y / scale);
    else uv.setXY(i, x / scale, y / scale);
  }
  uv.needsUpdate = true;
}

// Triangular prism for a ramp, with outward-facing winding and flat normals.
function rampGeometry(b) {
  const { axis, dir } = b.ramp;
  const pt = (u, v, y) => (axis === 0 ? [u, y, v] : [v, y, u]);
  const uLo = dir > 0 ? b.min[axis] : b.max[axis], uHi = dir > 0 ? b.max[axis] : b.min[axis];
  const [v0, v1] = axis === 0 ? [b.min[2], b.max[2]] : [b.min[0], b.max[0]];
  const y0 = b.min[1], y1 = b.max[1];
  const A = pt(uLo, v0, y0), B = pt(uLo, v1, y0), C = pt(uHi, v1, y1), D = pt(uHi, v0, y1);
  const E = pt(uHi, v0, y0), F = pt(uHi, v1, y0);
  const inside = pt(uLo + (uHi - uLo) * 0.66, (v0 + v1) / 2, y0 + (y1 - y0) * 0.25);
  const pos = [], nor = [];
  for (let [p, q, r] of [[A, B, C], [A, C, D], [E, D, C], [E, C, F], [A, D, E], [B, F, C]]) {
    const e1 = q.map((v, i) => v - p[i]), e2 = r.map((v, i) => v - p[i]);
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const c = p.map((v, i) => (v + q[i] + r[i]) / 3 - inside[i]);
    if (n[0] * c[0] + n[1] * c[1] + n[2] * c[2] < 0) { [q, r] = [r, q]; n = n.map(v => -v); }
    const len = Math.hypot(...n);
    pos.push(...p, ...q, ...r);
    for (let k = 0; k < 3; k++) nor.push(n[0] / len, n[1] / len, n[2] / len);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  return g;
}

function mergeGeometries(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  m.computeBoundingSphere();
  return m;
}

export class World {
  // opts: { antialias, renderScale, shadows }
  constructor(canvas, opts = {}) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.antialias !== false, powerPreference: 'high-performance' });
    this.renderScale = opts.renderScale || 1;
    this.shadows = opts.shadows !== false;
    r.setPixelRatio(this.renderScale);
    r.shadowMap.enabled = this.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false; // the map never moves: render shadows once
    r.shadowMap.needsUpdate = true;
    r.autoClear = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb3cde0);
    this.scene.fog = new THREE.Fog(0xb3cde0, 70, 160);
    this.camera = new THREE.PerspectiveCamera(74, 1, 0.03, 400);
    this.camera.rotation.order = 'YXZ';
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.hfov = 106.26;
    this.zoom = 1;
    this.buildLights();
    this.buildMap();
    this.buildEffects();
    // reflections for the metal knife in the viewmodel
    const pmrem = new THREE.PMREMGenerator(r);
    this.vmScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const gl = r.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xeef6ff, 0x8a7f70, 1.6));
    const sun = this.sun = new THREE.DirectionalLight(0xfff2de, 2.2);
    sun.position.set(18, 32, 12);
    sun.castShadow = this.shadows;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 28, bottom: -28, near: 1, far: 90 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2));
    const vs = new THREE.DirectionalLight(0xffffff, 1.6);
    vs.position.set(1, 2, 1);
    this.vmScene.add(vs);
  }

  setMap(id, boxes) {
    if (this.mapId === id) return;
    this.mapId = id;
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      const textures = new Set();
      this.mapGroup.traverse(o => {
        o.geometry?.dispose();
        if (o.material) { if (o.material.map) textures.add(o.material.map); o.material.dispose(); }
      });
      for (const t of textures) t.dispose();
    }
    this.buildMap(boxes, id);
    this.clearDecals();
    this.renderer.shadowMap.needsUpdate = true;
  }

  buildMap(boxes = MAP_BOXES, id = 'duel') {
    this.mapId = id;
    const root = this.mapGroup = new THREE.Group();
    this.scene.add(root);
    const groups = {}, edges = [];
    for (const b of boxes) {
      if (id === 'lake' && b.mat === 'b') continue; // invisible tall collision boundary; trees frame the horizon
      let geo;
      if (b.ramp) geo = rampGeometry(b);
      else geo = new THREE.BoxGeometry(...[0, 1, 2].map(i => b.max[i] - b.min[i])).translate(...[0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2));
      const tile = MATS[b.mat]?.[2] ?? 1;
      if (tile) worldUV(geo, tile);
      (groups[b.mat] ??= []).push(geo);
      if (b.mat !== 'f') edges.push(new THREE.EdgesGeometry(geo).attributes.position.array);
    }
    for (const [mat, list] of Object.entries(groups)) {
      let [color, tex] = MATS[mat] || MATS.c;
      if (id === 'lake') {
        if (mat === 'f') { color = 0x718557; tex = 'grass'; }
        if (mat === 'b') { color = 0x58714c; tex = 'grid4'; }
        if (mat === 'd') { color = 0xe6dcc2; tex = 'planks'; }
        if (mat === 'h') color = 0x485963;
      }
      const mesh = new THREE.Mesh(mergeGeometries(list), new THREE.MeshLambertMaterial({ color, map: TEX[tex]() }));
      mesh.castShadow = mat !== 'f';
      mesh.receiveShadow = true;
      root.add(mesh);
      for (const g of list) g.dispose();
    }
    const all = new Float32Array(edges.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of edges) { all.set(a, o); o += a.length; }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(all, 3));
    root.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })));
    if (id === 'lake') this.buildLakeScenery(root);
  }

  buildLakeScenery(root) {
    const mesh = (geo, color, x, y, z, opts = {}) => {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, ...opts }));
      m.position.set(x, y, z); m.receiveShadow = true; root.add(m); return m;
    };
    // Surrounding terrain continues beneath the tree line beyond the playable boundary.
    mesh(new THREE.BoxGeometry(170, 0.1, 170), 0x718557, 0, -0.12, 0);
    // Shallow water has a solid bed: walking off the pier never traps a player.
    mesh(new THREE.BoxGeometry(69, 0.03, 15.7), 0x408c9e, 0, 0.025, 18.9,
      { transparent: true, opacity: 0.76 });
    for (let i = 0; i < 18; i++) {
      mesh(new THREE.BoxGeometry(3 + i % 4, 0.012, 0.025), 0xa9d5d7,
        -32 + (i * 13 % 64), 0.048, 12 + (i * 7 % 14));
    }
    // Tree line outside the playable walls, with foliage masking the arena edge.
    for (let i = 0; i < 44; i++) {
      const side = i % 4, n = Math.floor(i / 4), along = -34 + n * 6.8;
      const x = side < 2 ? along : (side === 2 ? -37.5 : 37.5);
      const z = side < 2 ? (side === 0 ? -29 : 29) : along * 0.76;
      const height = 10 + i % 5;
      mesh(new THREE.CylinderGeometry(0.24, 0.4, height), 0x66523c, x, height / 2, z);
      const tree = mesh(new THREE.ConeGeometry(3.8, height, 7),
        [0x324f3d,0x46644b,0x547153][i % 3], x, height * 0.85, z);
      tree.castShadow = true;
    }
    // White trim around the upstairs windows and horizontal clapboard siding.
    for (const z of [-8.02, 6.02]) {
      for (const y of [3.25, 4.18, 5.52, 6.08])
        mesh(new THREE.BoxGeometry(14.2, 0.1, 0.1), 0xf6f0dd, -2, y, z);
    }
    // Dock mooring bollards and a small boat beside the pier.
    const boat = mesh(new THREE.BoxGeometry(1.5, 0.32, 3.8), 0xe9e0c8, 2.5, 0.23, 17);
    boat.rotation.y = -0.12;
    mesh(new THREE.BoxGeometry(1.08, 0.04, 2.8), 0x597a87, 2.5, 0.41, 17);
  }

  // Bullet holes, particles and tracers are instanced: one draw call each no matter how many exist.
  buildEffects() {
    const inst = (geo, material, n) => {
      const m = new THREE.InstancedMesh(geo, material, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      for (let i = 0; i < n; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, WHITE); }
      this.scene.add(m);
      return m;
    };
    this.tracerMesh = inst(new THREE.BoxGeometry(0.014, 0.014, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }), 40);
    this.tracers = Array.from({ length: 40 }, () => ({ active: false, from: new THREE.Vector3(), dir: new THREE.Vector3(), q: new THREE.Quaternion(), len: 0, s: 0 }));
    this.decalMesh = inst(new THREE.PlaneGeometry(0.075, 0.075), new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    }), 150);
    this.decalIdx = 0;
    this.partMesh = inst(new THREE.BoxGeometry(0.04, 0.04, 0.04), new THREE.MeshBasicMaterial(), 220);
    this.parts = Array.from({ length: 220 }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, s: 1 }));
    this.partIdx = 0;
    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
    const ftex = flashTexture();
    this.flashes = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      s.scale.setScalar(0.4);
      this.scene.add(s);
      this.flashes.push({ s, t: 0 });
    }
  }

  // Render scale (pixel ratio) and shadows can change at runtime; antialiasing needs a reload.
  setQuality({ renderScale, shadows }) {
    if (renderScale && renderScale !== this.renderScale) {
      this.renderScale = renderScale;
      this.renderer.setPixelRatio(renderScale);
      this.resize();
    }
    if (shadows !== undefined && shadows !== this.shadows) {
      this.shadows = shadows;
      this.renderer.shadowMap.enabled = shadows;
      this.sun.castShadow = shadows;
      this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.vmCamera.aspect = w / h;
    this.setFov(this.hfov, this.zoom);
    this.vmCamera.updateProjectionMatrix();
  }

  // hfov = horizontal FOV in degrees (CS2 default 106.26 at 16:9), zoom = scope magnification.
  setFov(hfov, zoom = 1) {
    this.hfov = hfov;
    this.zoom = zoom;
    const t = Math.tan((hfov * Math.PI) / 360) / Math.max(this.camera.aspect, 0.1) / zoom;
    this.camera.fov = (2 * Math.atan(t) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  tracer(from, to, color = 0xffe7a0) {
    const i = this.tracers.findIndex(x => !x.active);
    if (i < 0) return;
    const t = this.tracers[i];
    t.from.set(...from);
    t.dir.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    t.len = t.dir.length();
    if (t.len < 0.5) return;
    t.dir.divideScalar(t.len);
    t.q.setFromUnitVectors(Z_AXIS, t.dir);
    t.active = true;
    t.s = 0;
    this.tracerMesh.setColorAt(i, this.tmpColor.setHex(color));
    this.tracerMesh.instanceColor.needsUpdate = true;
  }

  decal(p, n, mat) {
    const i = this.decalIdx++ % 150, d = this.dummy;
    d.position.set(p[0] + n[0] * 0.004, p[1] + n[1] * 0.004, p[2] + n[2] * 0.004);
    d.lookAt(p[0] + n[0], p[1] + n[1], p[2] + n[2]);
    d.rotateZ(Math.random() * 6.28);
    d.scale.setScalar(1);
    d.updateMatrix();
    this.decalMesh.setMatrixAt(i, d.matrix);
    this.decalMesh.setColorAt(i, this.tmpColor.setHex(DECAL[mat] ?? 0x2a2a2a));
    this.decalMesh.instanceMatrix.needsUpdate = true;
    this.decalMesh.instanceColor.needsUpdate = true;
  }

  burst(p, n, color, count = 6, speed = 2.5) {
    for (let k = 0; k < count; k++) {
      const i = this.partIdx++ % this.parts.length, q = this.parts[i];
      q.p.set(...p);
      q.v.set(n[0] + (Math.random() - 0.5) * 1.4, n[1] + Math.random() * 0.9, n[2] + (Math.random() - 0.5) * 1.4).multiplyScalar(speed * (0.4 + Math.random()));
      q.life = 0.35 + Math.random() * 0.3;
      q.s = 0.6 + Math.random() * 0.8;
      this.partMesh.setColorAt(i, this.tmpColor.setHex(color));
    }
    this.partMesh.instanceColor.needsUpdate = true;
  }

  impact(p, n, mat) {
    this.decal(p, n, mat);
    this.burst(p, n, DUST[mat] ?? 0xb8b2a8, mat === 'm' || mat === 'h' ? 4 : 6);
  }

  blood(p, dir, head) {
    this.burst(p, [-dir[0] * 0.3, 0.2, -dir[2] * 0.3], 0xb3121b, head ? 16 : 8, head ? 3.2 : 2);
  }

  // Muzzle flash sprite at a world position (the opponent's gun).
  flash(p) {
    const f = this.flashes.find(x => x.t <= 0) || this.flashes[0];
    f.s.position.set(...p);
    f.s.material.rotation = Math.random() * 6.28;
    f.s.visible = true;
    f.t = 0.05;
  }

  clearDecals() {
    for (let i = 0; i < 150; i++) this.decalMesh.setMatrixAt(i, ZERO);
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    const d = this.dummy;
    let tracersMoved = false, partsMoved = false;
    this.tracers.forEach((t, i) => {
      if (!t.active) return;
      tracersMoved = true;
      t.s += dt * 420;
      const a = Math.max(0, t.s - 4), b = Math.min(t.s, t.len);
      if (a >= t.len) { t.active = false; this.tracerMesh.setMatrixAt(i, ZERO); return; }
      d.position.copy(t.from).addScaledVector(t.dir, (a + b) / 2);
      d.quaternion.copy(t.q);
      d.scale.set(1, 1, Math.max(0.01, b - a));
      d.updateMatrix();
      this.tracerMesh.setMatrixAt(i, d.matrix);
    });
    d.quaternion.identity();
    this.parts.forEach((q, i) => {
      if (q.life <= 0) return;
      partsMoved = true;
      q.life -= dt;
      if (q.life <= 0) { this.partMesh.setMatrixAt(i, ZERO); return; }
      q.v.y -= 9.8 * dt;
      q.p.addScaledVector(q.v, dt);
      d.position.copy(q.p);
      d.scale.setScalar(q.s);
      d.updateMatrix();
      this.partMesh.setMatrixAt(i, d.matrix);
    });
    if (tracersMoved) this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (partsMoved) this.partMesh.instanceMatrix.needsUpdate = true;
    for (const f of this.flashes) if (f.t > 0 && (f.t -= dt) <= 0) f.s.visible = false;
  }

  render(viewmodel) {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (viewmodel) {
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
    }
  }
}
