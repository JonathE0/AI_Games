// Renderer, map geometry, lighting and short-lived effects (tracers, bullet holes, particles, flashes).
// Performance: the static map is merged into one mesh per material, the shadow map is rendered once,
// and there are no dynamic lights.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MAP_BOXES } from '/shared/map.js';
import { OUTPOST, CORE_LADDERS } from '/shared/outpost.js';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0); // hidden instance
const WHITE = new THREE.Color(1, 1, 1);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// color, texture, world-UV tile size (0 = per-face UVs like a crate)
const MATS = {
  f: [0x9aa1a8, 'grid2', 2], b: [0xcfc8bb, 'grid4', 1], c: [0xdcd5c8, 'grid4', 1], m: [0x5d7e98, 'metal', 1.2],
  w: [0xc98f4e, 'crate', 0], p: [0xdcb47c, 'planks', 1.2], d: [0xece7de, 'drywall', 1.2], h: [0x97a9b8, 'metal', 0.8],
  // Zombie Holdout builds
  W: [0xc9955a, 'planks', 1.2], S: [0xa9a49b, 'stone', 1.2], M: [0x8d9aa6, 'plate', 1],
};
const DECAL = { w: 0x3b2410, p: 0x4a2f14, m: 0x2a2f36, h: 0x2a2f36, d: 0x6b655c, W: 0x4a2f14, S: 0x55524c, M: 0x2a2f36 };
const DUST = { w: 0x9c6a3a, p: 0xb88a52, m: 0xffd27a, h: 0xffd27a, d: 0xf2eee6, W: 0xb88a52, S: 0xcfc9bd, M: 0xffd27a };
export const matColor = code => MATS[code]?.[0] ?? 0xffffff;
export const matTile = code => MATS[code]?.[2] ?? 1;

// [color, texture name] a map box is drawn with (outdoor maps recolor a few materials).
export function matLook(mat, id) {
  let [color, tex] = MATS[mat] || MATS.c;
  if (id === 'lake' || id === 'outpost') {
    if (mat === 'f') { color = id === 'outpost' ? 0x6f7f52 : 0x718557; tex = 'grass'; }
    if (mat === 'b') { color = 0x58714c; tex = 'grid4'; }
    if (mat === 'd') { color = 0xe6dcc2; tex = 'planks'; }
    if (mat === 'h') color = 0x485963;
    if (id === 'outpost' && mat === 'c') { color = 0xb9b2a4; tex = 'stone'; }
  }
  return [color, tex];
}

export function canvasTex(size, draw) {
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
  stone: () => canvasTex(128, (g, s) => { // staggered blocks
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    for (let r = 0; r < 4; r++) for (let c = -1; c < 3; c++) {
      const x = c * 48 + (r % 2) * 24, y = r * 32;
      g.fillStyle = `rgba(0,0,0,${0.03 + ((r * 7 + c * 3) % 5) * 0.015})`;
      g.fillRect(x + 2, y + 2, 44, 28);
    }
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < s; y += 32) g.fillRect(0, y, s, 2);
  }),
  plate: () => canvasTex(128, (g, s) => { // riveted steel plates
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, 62, s, 4); g.fillRect(62, 0, 4, s);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (const x of [8, 56, 72, 120]) for (const y of [8, 56, 72, 120]) { g.beginPath(); g.arc(x, y, 3, 0, 6.3); g.fill(); }
  }),
};
export const makeTexture = name => TEX[name]();
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
export function worldUV(geo, scale) {
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

// Triangular prism for a map-style ramp (wedge), or — when ramp.thick is set — a thin walkable slab
// (Fortnite-style build ramp) you can also walk and shoot underneath. Outward-facing winding, flat normals.
export function rampGeometry(b) {
  const { axis, dir, thick } = b.ramp;
  const pt = (u, v, y) => (axis === 0 ? [u, y, v] : [v, y, u]);
  const uLo = dir > 0 ? b.min[axis] : b.max[axis], uHi = dir > 0 ? b.max[axis] : b.min[axis];
  const [v0, v1] = axis === 0 ? [b.min[2], b.max[2]] : [b.min[0], b.max[0]];
  const y0 = b.min[1], y1 = b.max[1];
  let tris, inside;
  if (thick) {
    const { slope } = b.ramp;
    const uBotLo = uLo + (dir * thick) / slope, yBotHi = y1 - thick; // low end tapers to the floor
    const TL0 = pt(uLo, v0, y0), TL1 = pt(uLo, v1, y0);
    const TH0 = pt(uHi, v0, y1), TH1 = pt(uHi, v1, y1);
    const BH0 = pt(uHi, v0, yBotHi), BH1 = pt(uHi, v1, yBotHi);
    const BL0 = pt(uBotLo, v0, y0), BL1 = pt(uBotLo, v1, y0);
    inside = pt(uLo + (uHi - uLo) * 0.66, (v0 + v1) / 2, y0 + (y1 - y0) * 0.66 - thick / 2);
    tris = [
      [TL0, TL1, TH1], [TL0, TH1, TH0], // top
      [BL0, BL1, BH1], [BL0, BH1, BH0], // underside
      [TH0, TH1, BH1], [TH0, BH1, BH0], // high-end vertical face
      [TL0, TL1, BL1], [TL0, BL1, BL0], // low-end floor bottom
      [TL0, TH0, BH0], [TL0, BH0, BL0], // side cap v0
      [TL1, TH1, BH1], [TL1, BH1, BL1], // side cap v1
    ];
  } else {
    const A = pt(uLo, v0, y0), B = pt(uLo, v1, y0), C = pt(uHi, v1, y1), D = pt(uHi, v0, y1);
    const E = pt(uHi, v0, y0), F = pt(uHi, v1, y0);
    inside = pt(uLo + (uHi - uLo) * 0.66, (v0 + v1) / 2, y0 + (y1 - y0) * 0.25);
    tris = [[A, B, C], [A, C, D], [E, D, C], [E, C, F], [A, D, E], [B, F, C], [A, E, F], [A, F, B]]; // slope, back, sides, underside
  }
  const pos = [], nor = [];
  for (let [p, q, r] of tris) {
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
    this.hemi = new THREE.HemisphereLight(0xeef6ff, 0x8a7f70, 1.6);
    this.scene.add(this.hemi);
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
    const big = id === 'outpost', sc = this.sun.shadow.camera; // the Outpost is twice the size
    Object.assign(sc, big ? { left: -52, right: 52, top: 52, bottom: -52, far: 120 } : { left: -36, right: 36, top: 28, bottom: -28, far: 90 });
    sc.updateProjectionMatrix();
    this.sun.position.set(18, 32, 12).multiplyScalar(big ? 1.6 : 1);
    this.buildMap(boxes, id);
    this.clearDecals();
    this.setDusk(0);
    this.renderer.shadowMap.needsUpdate = true;
  }

  // Re-render the static shadow map (after pieces are built or destroyed). Throttled by the caller.
  refreshShadows() { this.renderer.shadowMap.needsUpdate = true; }

  // 0 = day, 1 = storm dusk (Zombie Holdout waves). Only colors and light intensities change.
  setDusk(k) {
    if (this.duskK === k) return;
    this.duskK = k;
    this.applyAmbient();
  }

  // 0 = off, 1 = Holdout night wave: near-black sky and fog, almost no ambient light, short view distance.
  setNight(n) {
    if (this.nightK === n) return;
    this.nightK = n;
    this.applyAmbient();
  }

  // 0 = off, 1 = Night Vision Goggles active: brighten the dark back up and push the view distance back out.
  setNV(v) {
    if (this.nvK === v) return;
    this.nvK = v;
    this.applyAmbient();
  }

  applyAmbient() {
    const k = this.duskK || 0, n = this.nightK || 0, v = this.nvK || 0;
    const day = new THREE.Color(0xb3cde0), dusk = new THREE.Color(0x3b3552), night = new THREE.Color(0x04060b);
    this.scene.background.copy(day).lerp(dusk, k).lerp(night, n);
    this.scene.fog.color.copy(this.scene.background);
    this.scene.fog.near = ((70 - 30 * k) * (1 - n) + 8 * n) * (1 - v) + 10 * v;
    this.scene.fog.far = ((160 - 60 * k) * (1 - n) + 58 * n) * (1 - v) + 75 * v;
    this.hemi.intensity = (1.6 - 0.75 * k) * (1 - 0.86 * n) * (1 - v) + 2.2 * v;
    this.hemi.color.setHex(0xeef6ff).lerp(new THREE.Color(0x9c8cff), k).lerp(new THREE.Color(0x3a4a7a), n);
    this.sun.intensity = (2.2 - 1.3 * k) * (1 - 0.9 * n) * (1 - v) + 1.6 * v;
    this.sun.color.setHex(0xfff2de).lerp(new THREE.Color(0xff9a6b), k).lerp(new THREE.Color(0x8aa0ff), n);
    const far = v > 0.3 ? 120 : n > 0.3 ? 95 : 400;
    if (this.camera.far !== far) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
    if (this.coreFx?.beam) this.coreFx.beam.material.opacity = 0.18 + 0.25 * n; // the Core's beam is a landmark in the dark
  }

  buildMap(boxes = MAP_BOXES, id = 'duel') {
    this.mapId = id;
    const root = this.mapGroup = new THREE.Group();
    this.scene.add(root);
    const groups = {}, edges = [];
    const outdoor = id === 'lake' || id === 'outpost';
    for (const b of boxes) {
      if (outdoor && b.mat === 'b') continue; // invisible tall collision boundary; trees frame the horizon
      let geo;
      if (b.ramp) geo = rampGeometry(b);
      else geo = new THREE.BoxGeometry(...[0, 1, 2].map(i => b.max[i] - b.min[i])).translate(...[0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2));
      const tile = MATS[b.mat]?.[2] ?? 1;
      if (tile) worldUV(geo, tile);
      (groups[b.mat] ??= []).push(geo);
      if (b.mat !== 'f') edges.push(new THREE.EdgesGeometry(geo).attributes.position.array);
    }
    for (const [mat, list] of Object.entries(groups)) {
      const [color, tex] = matLook(mat, id);
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
    this.coreFx = null;
    this.laneFx = null;
    if (id === 'lake') this.buildLakeScenery(root);
    if (id === 'outpost') this.buildOutpostScenery(root);
  }

  // Outpost: wide grass, crossing dirt roads that mark the four lanes, a tree line past the edge,
  // the Core's floating crystal + sky beam, and the purple storm gates the horde pours out of.
  buildOutpostScenery(root) {
    const mesh = (geo, color, x, y, z, opts = {}) => {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, ...opts }));
      m.position.set(x, y, z); m.receiveShadow = true; root.add(m); return m;
    };
    mesh(new THREE.BoxGeometry(220, 0.1, 220), 0x66764b, 0, -0.12, 0);
    for (const along of [0, 1]) { // roads
      const road = mesh(new THREE.BoxGeometry(along ? 96 : 6, 0.02, along ? 6 : 96), 0x8a7a5e, 0, 0.012, 0);
      road.material.transparent = true; road.material.opacity = 0.8;
    }
    for (let i = 0; i < 60; i++) { // tree line outside the walls
      const side = i % 4, n = Math.floor(i / 4), along = -52 + n * 7 + (i % 3);
      const off = 51.5 + (i % 2) * 3.5;
      const x = side < 2 ? along : (side === 2 ? -off : off);
      const z = side < 2 ? (side === 0 ? -off : off) : along;
      const h = 9 + (i % 5) * 1.3;
      mesh(new THREE.CylinderGeometry(0.25, 0.4, h), 0x5d4a36, x, h / 2, z);
      mesh(new THREE.ConeGeometry(3.4, h, 7), [0x2f4a36, 0x3d5a40, 0x4a6648][i % 3], x, h * 0.85, z).castShadow = true;
    }
    // the Core: crystal floating over its armored base, a spinning ring and a sky beam
    const group = new THREE.Group();
    group.position.set(0, 2.2, 0);
    root.add(group);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), new THREE.MeshBasicMaterial({ color: 0x5ee6ff }));
    crystal.scale.set(0.8, 1.35, 0.8);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.07, 8, 40), new THREE.MeshBasicMaterial({ color: 0xa6f4ff }));
    ring.rotation.x = Math.PI / 2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 80, 16, 1, true), new THREE.MeshBasicMaterial({
      color: 0x5ee6ff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    beam.position.y = 40;
    group.add(crystal, ring, beam);
    this.coreFx = { group, crystal, ring, beam, hit: 0, t: 0 };
    // ladders up the Core (its roof is a lookout you can jump out of a sealed fort from)
    for (const l of CORE_LADDERS) {
      const ax = l.n[0] ? 2 : 0, fx = l.n[0] ? 'x' : 'z', face = l.face + (l.n[0] || l.n[2]) * 0.05;
      const w = l.max[ax] - l.min[ax], c = (l.min[ax] + l.max[ax]) / 2;
      const put = (size, u, y) => { const m = mesh(new THREE.BoxGeometry(...(ax === 2 ? [0.06, size[1], size[0]] : [size[0], size[1], 0.06])), 0x6b5237, 0, y, 0); m.position[fx] = face; m.position[ax === 2 ? 'z' : 'x'] = u; m.castShadow = true; };
      for (const s of [-1, 1]) put([0.07, l.max[1]], c + s * (w / 2 - 0.05), l.max[1] / 2);
      for (let y = 0.3; y < l.max[1]; y += 0.34) put([w - 0.1, 0.05], c, y);
    }
    // the shop ring around the Core (survivors hold inside it)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x5ee6ff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    const buyRing = new THREE.Mesh(new THREE.RingGeometry(OUTPOST.buyRadius - 0.12, OUTPOST.buyRadius + 0.12, 72).rotateX(-Math.PI / 2), ringMat);
    buyRing.position.y = 0.035;
    root.add(buyRing);
    this.coreFx.buyRing = buyRing;
    // team chest lid + gold trim
    const st = OUTPOST.stash.box;
    mesh(new THREE.BoxGeometry(st.max[0] - st.min[0] + 0.06, 0.12, st.max[2] - st.min[2] + 0.06), 0x2f5a8c, (st.min[0] + st.max[0]) / 2, st.max[1] + 0.06, (st.min[2] + st.max[2]) / 2);
    mesh(new THREE.BoxGeometry(0.2, 0.2, 0.06), 0xffd166, (st.min[0] + st.max[0]) / 2, st.max[1] - 0.2, st.min[2] - 0.03);
    // storm gates at each lane
    const gateMat = () => new THREE.MeshBasicMaterial({ color: 0xa04dff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.laneFx = {};
    for (const [id, x, z, rot] of [['N', 0, -46.5, 0], ['S', 0, 46.5, 0], ['E', 46.5, 0, 1], ['W', -46.5, 0, 1]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(22, 12), gateMat());
      m.position.set(x, 6, z);
      if (rot) m.rotation.y = Math.PI / 2;
      m.visible = false;
      root.add(m);
      this.laneFx[id] = { m, state: 0 };
    }
  }

  // lanes: { N: 0 | 1 (incoming next) | 2 (attacking now) }
  setLanes(states) {
    if (!this.laneFx) return;
    for (const [id, fx] of Object.entries(this.laneFx)) {
      fx.state = states[id] || 0;
      fx.m.visible = fx.state > 0;
      fx.m.material.color.setHex(fx.state === 2 ? 0xa04dff : 0xffc34d);
    }
  }

  coreHit() { if (this.coreFx) this.coreFx.hit = 1; }

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
    (this.decalAt ??= [])[i] = [p[0], p[1], p[2]];
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
    this.decalAt = [];
  }

  // bullet holes that sat on something that just broke
  clearDecalsIn(b, pad = 0.06) {
    let any = false;
    (this.decalAt || []).forEach((p, i) => {
      if (!p || p[0] < b.min[0] - pad || p[0] > b.max[0] + pad || p[1] < b.min[1] - pad || p[1] > b.max[1] + pad || p[2] < b.min[2] - pad || p[2] > b.max[2] + pad) return;
      this.decalMesh.setMatrixAt(i, ZERO);
      this.decalAt[i] = null;
      any = true;
    });
    if (any) this.decalMesh.instanceMatrix.needsUpdate = true;
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
    const c = this.coreFx;
    if (c) {
      c.t += dt;
      c.hit = Math.max(0, c.hit - dt * 2);
      c.crystal.position.y = 3.2 + Math.sin(c.t * 1.6) * 0.15; // high enough to stand on the Core's roof below it
      if (c.buyRing) c.buyRing.material.opacity = 0.35 + 0.12 * Math.sin(c.t * 2);
      c.crystal.rotation.y += dt * 0.8;
      c.ring.position.y = c.crystal.position.y;
      c.ring.rotation.z += dt * 1.5;
      c.crystal.material.color.setHex(0x5ee6ff).lerp(this.tmpColor.setHex(0xff3b3b), c.hit);
      c.beam.material.opacity = 0.14 + 0.06 * Math.sin(c.t * 3) + c.hit * 0.3;
    }
    if (this.laneFx) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      for (const fx of Object.values(this.laneFx)) if (fx.state) fx.m.material.opacity = fx.state === 2 ? 0.22 + 0.18 * pulse : 0.08 + 0.06 * pulse;
    }
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
