// Breakable map props on the Outpost (walls, cover, crates, shacks, houses, ruins): one mesh per prop so
// each can darken as it takes damage and disappear when it breaks. The server owns their health; this only
// draws them and hands their collision boxes to movement, bullets and the build preview.
// Also the purely cosmetic clutter that makes the map read as overgrown and abandoned (see Decor below).
import * as THREE from 'three';
import { OUTPOST, OUTPOST_PROPS, OUTPOST_NODES, PROP_TYPES } from '/shared/outpost.js';
import { makeTexture, matLook, matTile, worldUV } from './world.js';

const box = b => {
  const g = new THREE.BoxGeometry(...[0, 1, 2].map(i => b.max[i] - b.min[i])).translate(...[0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2));
  const tile = matTile(b.mat);
  if (tile) worldUV(g, tile); // crates keep per-face UVs
  return g;
};

export class Props {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.mats = {};
    this.list = new Map();   // piece id -> { id, def, box, mesh, hp, max }
    this.boxes = [];
    this.edges = null;
  }

  material(code) {
    if (!this.mats[code]) {
      const [color, tex] = matLook(code, 'outpost');
      this.mats[code] = new THREE.MeshLambertMaterial({ color, map: makeTexture(tex), vertexColors: true });
    }
    return this.mats[code];
  }

  // list: [[map prop index, piece id, hp]] — props missing from it are already broken
  load(list) {
    for (const p of this.list.values()) this.drop(p);
    this.list.clear();
    for (const [idx, id, hp] of list) {
      const def = OUTPOST_PROPS[idx];
      if (!def) continue;
      const b = { ...def.box, min: [...def.box.min], max: [...def.box.max], sid: id, prop: true };
      const geo = box(b);
      geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count * 3).fill(1), 3));
      const mesh = new THREE.Mesh(geo, this.material(b.mat));
      mesh.castShadow = mesh.receiveShadow = true;
      this.root.add(mesh);
      const p = { id, def, box: b, mesh, hp, max: def.hp };
      this.list.set(id, p);
      this.tint(p);
    }
    this.rebuild();
  }

  has(id) { return this.list.has(id); }

  setHp(id, hp) {
    const p = this.list.get(id);
    if (!p) return null;
    const prev = p.hp;
    p.hp = hp;
    this.tint(p);
    return { p, prev };
  }

  // darker and redder as it breaks
  tint(p) {
    const k = Math.max(0, Math.min(1, p.hp / p.max)), c = p.mesh.geometry.attributes.color;
    const r = 0.45 + 0.55 * k, g = 0.38 + 0.62 * k, b = 0.36 + 0.64 * k;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, r, g, b);
    c.needsUpdate = true;
  }

  remove(id) {
    const p = this.list.get(id);
    if (!p) return null;
    this.drop(p);
    this.list.delete(id);
    this.rebuild();
    return p;
  }

  drop(p) {
    this.root.remove(p.mesh);
    p.mesh.geometry.dispose();
  }

  // collision boxes + one merged outline for everything still standing
  rebuild() {
    this.boxes = [...this.list.values()].map(p => p.box);
    if (this.edges) { this.root.remove(this.edges); this.edges.geometry.dispose(); }
    const parts = [...this.list.values()].map(p => new THREE.EdgesGeometry(p.mesh.geometry).attributes.position.array);
    const all = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of parts) { all.set(a, o); o += a.length; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(all, 3));
    this.edges = new THREE.LineSegments(g, this.edgeMat ??= new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }));
    this.root.add(this.edges);
  }

  // what harvesting this prop gives
  matOf(id) { const p = this.list.get(id); return p ? PROP_TYPES[p.box.mat].mat : null; }

  dispose() {
    for (const p of this.list.values()) this.drop(p);
    this.list.clear();
    if (this.edges) this.edges.geometry.dispose();
    this.edgeMat?.dispose();
    for (const m of Object.values(this.mats)) { m.map?.dispose(); m.dispose(); }
    this.scene.remove(this.root);
  }
}

// ---------- cosmetic clutter (no collision) ----------
// Vines, moss, dead trees, rubble, debris, burnt cars, leaning signage, torn awnings — one InstancedMesh
// per kind, scattered once from the map layout at load and never touched again. Purely decorative: they
// carry no collision box, so they never affect movement, bullets or the build grid.
const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dv = new THREE.Vector3(), _ds = new THREE.Vector3(), _dc = new THREE.Color();
const UPY = new THREE.Vector3(0, 1, 0);
const tiltX = a => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);

const inAnyLane = (x, z) => OUTPOST.lanes.some(l => x > l.zone[0] - 4 && x < l.zone[2] + 4 && z > l.zone[1] - 4 && z < l.zone[3] + 4);
// clear of the buy ring, the four spawn lanes, the border, and any prop/node footprint (+ pad)
function openGround(x, z, pad) {
  if (Math.hypot(x, z) < OUTPOST.buyRadius + 3 || inAnyLane(x, z) || Math.abs(x) > 46 || Math.abs(z) > 46) return false;
  for (const p of OUTPOST_PROPS) if (x > p.box.min[0] - pad && x < p.box.max[0] + pad && z > p.box.min[2] - pad && z < p.box.max[2] + pad) return false;
  for (const n of OUTPOST_NODES) if (x > n.box.min[0] - pad && x < n.box.max[0] + pad && z > n.box.min[2] - pad && z < n.box.max[2] + pad) return false;
  return true;
}
function scatter(n, pad) {
  const pts = [];
  for (let tries = 0; pts.length < n && tries < n * 40; tries++) {
    const x = (Math.random() * 2 - 1) * 46, z = (Math.random() * 2 - 1) * 46;
    if (openGround(x, z, pad)) pts.push([x, z]);
  }
  return pts;
}

export class Decor {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.meshes = [];
    this.buildVines();
    this.buildMoss();
    this.buildDeadTrees();
    this.buildRubble();
    this.buildDebris();
    this.buildCars();
    this.buildSigns();
    this.buildAwnings();
  }

  // place(i, matrix, color) fills instance i; one draw call per kind no matter how many instances.
  inst(geo, color, count, place) {
    if (!count) { geo.dispose(); return; }
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, vertexColors: true }), count);
    for (let i = 0; i < count; i++) { place(i, _dm, _dc); m.setMatrixAt(i, _dm); m.setColorAt(i, _dc); }
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    this.group.add(m);
    this.meshes.push(m);
  }

  // Creepers climbing the corners of tall concrete and wood walls.
  buildVines() {
    const spots = [];
    for (const p of OUTPOST_PROPS) {
      const b = p.box;
      if ((b.mat !== 'c' && b.mat !== 'd') || b.max[1] - b.min[1] < 2) continue;
      for (const [x, z] of [[b.min[0], b.min[2]], [b.min[0], b.max[2]], [b.max[0], b.min[2]], [b.max[0], b.max[2]]]) {
        if (Math.random() < 0.3) spots.push([x, z, b.max[1], 1 + Math.random() * Math.min(3.2, b.max[1] - b.min[1] - 0.5)]);
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0); // pivots at the top, hangs down
    this.inst(geo, 0x3c5a2e, spots.length, (i, m, c) => {
      const [x, z, top, len] = spots[i];
      m.compose(_dv.set(x + (Math.random() - 0.5) * 0.3, top, z + (Math.random() - 0.5) * 0.3), _dq.identity(), _ds.set(0.08 + Math.random() * 0.05, len, 0.08 + Math.random() * 0.05));
      c.setHex(0x3c5a2e).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15);
    });
  }

  // Moss patches at the foot of every wall and ruin.
  buildMoss() {
    const spots = [];
    for (const p of OUTPOST_PROPS) {
      const b = p.box, n = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const edge = (Math.random() * 4) | 0;
        const x = edge < 2 ? (edge ? b.max[0] : b.min[0]) + (Math.random() - 0.5) * 1.4 : b.min[0] + Math.random() * (b.max[0] - b.min[0]);
        const z = edge >= 2 ? (edge === 2 ? b.max[2] : b.min[2]) + (Math.random() - 0.5) * 1.4 : b.min[2] + Math.random() * (b.max[2] - b.min[2]);
        spots.push([x, z]);
      }
    }
    const geo = new THREE.CircleGeometry(1, 8).rotateX(-Math.PI / 2);
    this.inst(geo, 0x5a6b34, spots.length, (i, m, c) => {
      const [x, z] = spots[i], s = 0.4 + Math.random() * 0.7;
      m.compose(_dv.set(x, 0.015, z), _dq.identity(), _ds.set(s, 1, s));
      c.setHex(0x5a6b34).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
    });
  }

  // Bare, leafless trees scattered across the open field (harvestable trees keep their leaves).
  buildDeadTrees() {
    const spots = scatter(22, 1.5);
    const trunk = new THREE.CylinderGeometry(0.12, 0.22, 1, 6).translate(0, 0.5, 0);
    this.inst(trunk, 0x4a3c2c, spots.length, (i, m, c) => {
      const [x, z] = spots[i], h = 2.2 + Math.random() * 2.4;
      m.compose(_dv.set(x, 0, z), _dq.setFromAxisAngle(UPY, Math.random() * 6.28), _ds.set(1, h, 1));
      c.setHex(0x4a3c2c).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
    });
    const bspots = [];
    for (const [x, z] of spots) { const h = 1.6 + Math.random() * 1.6; for (let i = 0; i < 2 + ((Math.random() * 2) | 0); i++) bspots.push([x, z, h]); }
    const branch = new THREE.CylinderGeometry(0.05, 0.09, 1, 5).translate(0, 0.5, 0);
    this.inst(branch, 0x4a3c2c, bspots.length, (i, m, c) => {
      const [x, z, h] = bspots[i], a = Math.random() * 6.28, tilt = 0.5 + Math.random() * 0.5, len = 0.7 + Math.random() * 0.9;
      m.compose(_dv.set(x, h, z), _dq.setFromAxisAngle(UPY, a).multiply(tiltX(tilt)), _ds.set(1, len, 1));
      c.setHex(0x4a3c2c);
    });
  }

  // Rubble kicked out around every ruin.
  buildRubble() {
    const spots = [];
    for (const p of OUTPOST_PROPS) {
      if (Math.random() > 0.4) continue;
      const b = p.box, cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      for (let i = 0; i < 2 + ((Math.random() * 3) | 0); i++) {
        const a = Math.random() * 6.28, r = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2 + 0.6 + Math.random() * 1.4;
        spots.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
    }
    const geo = new THREE.DodecahedronGeometry(1, 0);
    this.inst(geo, 0x8f8a80, spots.length, (i, m, c) => {
      const [x, z] = spots[i], s = 0.15 + Math.random() * 0.3;
      m.compose(_dv.set(x, s * 0.4, z), _dq.setFromAxisAngle(UPY, Math.random() * 6.28), _ds.set(s, s * 0.7, s));
      c.setHex(0x8f8a80).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15);
    });
  }

  // Scattered debris across the open field.
  buildDebris() {
    const spots = scatter(70, 0.4);
    const geo = new THREE.BoxGeometry(1, 0.06, 1);
    this.inst(geo, 0x777066, spots.length, (i, m, c) => {
      const [x, z] = spots[i], sx = 0.25 + Math.random() * 0.5, sz = sx * (0.5 + Math.random());
      m.compose(_dv.set(x, 0.03, z), _dq.setFromAxisAngle(UPY, Math.random() * 6.28), _ds.set(sx, 1, sz));
      c.setHex(0x777066).offsetHSL(0, 0, (Math.random() - 0.5) * 0.25);
    });
  }

  // Burnt-out car hulks left along the roads.
  buildCars() {
    const spots = scatter(9, 2.4).map(([x, z]) => [x, z, Math.random() * 6.28]);
    const body = new THREE.BoxGeometry(2, 0.8, 4.2), cab = new THREE.BoxGeometry(1.7, 0.55, 2.1);
    const place = dy => (i, m, c) => {
      const [x, z, yaw] = spots[i];
      m.compose(_dv.set(x, dy, z), _dq.setFromAxisAngle(UPY, yaw), _ds.set(1, 1, 1));
      c.setHex(0x2a2724).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
    };
    this.inst(body, 0x2a2724, spots.length, place(0.45));
    this.inst(cab, 0x1c1a18, spots.length, place(1.05));
  }

  // Leaning, rusted signage.
  buildSigns() {
    const spots = scatter(10, 1.2).map(([x, z]) => [x, z, Math.random() * 6.28, (Math.random() - 0.5) * 0.7]);
    const post = new THREE.CylinderGeometry(0.04, 0.05, 2, 5).translate(0, 1, 0);
    const board = new THREE.BoxGeometry(1.1, 0.7, 0.04);
    this.inst(post, 0x555049, spots.length, (i, m, c) => {
      const [x, z, yaw, tilt] = spots[i];
      m.compose(_dv.set(x, 0, z), _dq.setFromAxisAngle(UPY, yaw).multiply(tiltX(tilt)), _ds.set(1, 1, 1));
      c.setHex(0x555049);
    });
    this.inst(board, 0x8a7a52, spots.length, (i, m, c) => {
      const [x, z, yaw, tilt] = spots[i];
      m.compose(_dv.set(x, 1.9, z), _dq.setFromAxisAngle(UPY, yaw).multiply(tiltX(tilt)), _ds.set(1, 1, 1));
      c.setHex(0x8a7a52).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
    });
  }

  // Tattered awnings hanging off every roofed prop (houses, shacks, the gas station canopy).
  buildAwnings() {
    const roofs = OUTPOST_PROPS.filter(p => p.box.mat === 'h');
    const geo = new THREE.BoxGeometry(1, 1, 0.03);
    this.inst(geo, 0x6b5a42, roofs.length, (i, m, c) => {
      const b = roofs[i].box, longX = (b.max[0] - b.min[0]) >= (b.max[2] - b.min[2]);
      const w = Math.min(3, longX ? b.max[0] - b.min[0] : b.max[2] - b.min[2]) * 0.6;
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      const x = longX ? cx : (Math.random() < 0.5 ? b.min[0] : b.max[0]);
      const z = longX ? (Math.random() < 0.5 ? b.min[2] : b.max[2]) : cz;
      m.compose(_dv.set(x, b.min[1] - 0.5, z), _dq.setFromAxisAngle(UPY, longX ? 0 : Math.PI / 2).multiply(tiltX(0.25)), _ds.set(w, 1, 1));
      c.setHex(0x6b5a42).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15);
    });
  }

  dispose() {
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.meshes = [];
    this.scene.remove(this.group);
  }
}
