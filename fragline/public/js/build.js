// Zombie Holdout building on the client: draws built pieces (instanced, or a custom mesh once edited),
// doors that swing open for players and survivors, harvest nodes, and runs building (ghost preview,
// grid snapping, turbo building, trap placement) and edit mode (Fortnite-style tile editing).
// The server re-checks everything with the same shared rules (shared/build.js).
import * as THREE from 'three';
import { GRID, BMATS, MAT_IDS, KINDS, PIECE_COST, REACH, EDIT_GRID, RAMP_THICK, FLOOR_LIFT, CONE_H, pieceBox, pieceBoxes, slotKey, aimBuildSlot, validMask, doorOf, distToBox, wallLoops, rampEdit, WALL_EDITS } from '/shared/build.js';
import { OUTPOST_NODES, NODE_TYPES } from '/shared/outpost.js';
import { ITEMS, TRAPS, DEPLOYS } from '/shared/holdout.js';
import { rayWorld, dirFromAngles } from '/shared/physics.js';
import { makeTexture, rampGeometry, worldUV, matColor } from './world.js';

const C = GRID.cell, H = GRID.level, T = GRID.thick;
const CAP = 600;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const BLUEPRINT = new THREE.Color(0x8fd3ff), CHARRED = new THREE.Color(0x2a2520);
const TEXNAME = { zink: 'plate' };
const RAMP_YAW = [0, Math.PI, -Math.PI / 2, Math.PI / 2]; // rises toward +x, -x, +z, -z
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function pieceGeometry(kind) {
  let g;
  if (kind === 'wall') g = new THREE.BoxGeometry(C, H, T);
  else if (kind === 'floor') g = new THREE.BoxGeometry(C, T, C);
  else if (kind === 'cone') g = coneGeometry();
  else g = rampGeometry({ min: [-C / 2, 0, -C / 2], max: [C / 2, H, C / 2], ramp: { axis: 0, dir: 1, slope: H / C, thick: RAMP_THICK } });
  worldUV(g, 1.2);
  return g;
}

// Square pyramid over a tile (centered, base at y = 0) with a flat underside, only over the quarters a cone edit
// left (bit = row * 2 + col, like floors); the cut through the middle is closed where a neighbour quarter is gone.
function coneGeometry(mask = 0) {
  const h = C / 2, A = [0, CONE_H, 0], O = [0, 0, 0], pos = [];
  const tri = (a, b, c, out) => { // wound so the face looks toward `out`
    const u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    pos.push(...a, ...(n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? [...c, ...b] : [...b, ...c]));
  };
  for (let q = 0; q < 4; q++) {
    if (mask & (1 << q)) continue;
    const sx = q & 1 ? 1 : -1, sz = q & 2 ? 1 : -1, K = [sx * h, 0, sz * h], X = [0, 0, sz * h], Z = [sx * h, 0, 0];
    tri(K, X, A, [0, 1, sz]); tri(K, Z, A, [sx, 1, 0]);
    tri(K, X, O, [0, -1, 0]); tri(K, O, Z, [0, -1, 0]);
    if (mask & (1 << (q ^ 1))) tri(X, O, A, [-sx, 0, 0]);
    if (mask & (1 << (q ^ 2))) tri(Z, O, A, [0, 0, -sz]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

// An edited cone in world space with world UVs (like editedGeometry): the facets over its remaining quarters.
function editedCone(p) {
  const b = p.box, g = coneGeometry(p.mask).translate((b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2);
  worldUV(g, 1.2);
  return g;
}

// One merged geometry (world space, world UVs) for the boxes an edited piece still has.
function editedGeometry(boxes) {
  const parts = boxes.filter(b => !b.door).map(b => {
    const g = b.ramp ? rampGeometry(b) : new THREE.BoxGeometry(...[0, 1, 2].map(i => b.max[i] - b.min[i])).translate(...[0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2)).toNonIndexed();
    worldUV(g, 1.2);
    return g;
  });
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return m;
}

// An edited wall: one slab extruded from its outline (shared/build.js wallLoops), so arches and triangles are smooth.
function wallGeometry(p) {
  const shapes = [], holes = [];
  for (const loop of wallLoops(p.mask)) {
    const pts = loop.map(([u, v]) => new THREE.Vector2((u * C) / 3, (v * H) / 3));
    if (THREE.ShapeUtils.isClockWise(pts)) holes.push(new THREE.Path(pts));
    else shapes.push(new THREE.Shape(pts));
  }
  if (shapes.length) shapes[0].holes = holes; // only the middle window is a hole, and that wall has one outline
  const b = p.box, g = new THREE.ExtrudeGeometry(shapes, { depth: T, bevelEnabled: false }).translate(0, 0, -T / 2);
  if (p.o === 1) g.rotateY(-Math.PI / 2); // along the wall -> +z
  g.translate(p.o === 0 ? b.min[0] : (b.min[0] + b.max[0]) / 2, b.min[1], p.o === 0 ? (b.min[2] + b.max[2]) / 2 : b.min[2]);
  worldUV(g, 1.2);
  return g;
}

// Instance transform for a piece (geometry above is centered on its tile edge / tile).
export function pieceTransform(p, out) {
  const x0 = GRID.x0 + p.i * C, z0 = GRID.z0 + p.k * C, y0 = p.l * H;
  let yaw = 0;
  if (p.kind === 'wall') {
    if (p.o === 0) _v.set(x0 + C / 2, y0 + H / 2, z0);
    else { _v.set(x0, y0 + H / 2, z0 + C / 2); yaw = Math.PI / 2; }
  } else if (p.kind === 'floor') _v.set(x0 + C / 2, y0 - T / 2 + FLOOR_LIFT, z0 + C / 2);
  else if (p.kind === 'cone') _v.set(x0 + C / 2, y0 + FLOOR_LIFT, z0 + C / 2);
  else { _v.set(x0 + C / 2, y0, z0 + C / 2); yaw = RAMP_YAW[p.o]; }
  return out.compose(_v, _q.setFromAxisAngle(Y_AXIS, yaw), _s.set(1, 1, 1));
}

// ---------- built pieces ----------
export class Structures {
  constructor(scene, onChange) {
    this.scene = scene;
    this.onChange = onChange;
    this.list = new Map();
    this.slots = new Map();
    this.boxes = [];
    this.meshes = {};
    this.textures = {};
    for (const mat of MAT_IDS) this.textures[mat] = makeTexture(TEXNAME[mat]);
    for (const kind of KINDS) for (const mat of MAT_IDS) {
      const m = new THREE.InstancedMesh(pieceGeometry(kind), new THREE.MeshLambertMaterial({ map: this.textures[mat] }), CAP);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, _c.setHex(0xffffff));
      m.count = 0;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      scene.add(m);
      this.meshes[kind + ':' + mat] = m;
    }
    this.doorGeo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0);
    this.dirty = false;
  }

  // [id, kind, i, k, l, o, mat, hp, maxHp, grow, rate, owner, mask]
  add([id, ki, i, k, l, o, mi, hp, maxHp, grow, rate, owner, mask = 0], quiet = false) {
    const p = { id, kind: KINDS[ki], i, k, l, o, mat: MAT_IDS[mi], hp, maxHp, grow, rate, owner, mask };
    p.box = pieceBox(p);
    p.boxes = pieceBoxes(p);
    this.list.set(id, p);
    this.slots.set(slotKey(p), id);
    if (mask) this.rebuildEdited(p);
    this.dirty = true;
    if (!quiet) this.changed();
    return p;
  }

  // [id, mat, hp, maxHp, grow, rate] -> { p, prevHp }
  update([id, mi, hp, maxHp, grow, rate]) {
    const p = this.list.get(id);
    if (!p) return null;
    const prevHp = p.hp + p.grow, matChanged = p.mat !== MAT_IDS[mi];
    Object.assign(p, { mat: MAT_IDS[mi], hp, maxHp, grow, rate });
    for (const b of [p.box, ...p.boxes]) b.mat = BMATS[p.mat].code;
    if (matChanged && p.mask) this.rebuildEdited(p);
    this.dirty = true;
    return { p, prevHp };
  }

  edit(id, mask, o) {
    const p = this.list.get(id);
    if (!p) return null;
    p.mask = mask;
    if (o !== undefined && p.o !== o) { p.o = o; p.box = pieceBox(p); } // a stair turned by a drag edit
    p.boxes = pieceBoxes(p);
    this.rebuildEdited(p);
    this.dirty = true;
    this.changed();
    return p;
  }

  // Edited pieces get their own mesh (plus swinging door panels).
  rebuildEdited(p) {
    this.disposeEdited(p);
    if (!p.mask) return;
    const mat = new THREE.MeshLambertMaterial({ map: this.textures[p.mat], color: matColor(BMATS[p.mat].code) });
    p.mesh = new THREE.Mesh(p.kind === 'cone' ? editedCone(p) : p.kind === 'wall' ? wallGeometry(p) : editedGeometry(p.boxes), mat);
    p.mesh.castShadow = p.mesh.receiveShadow = true;
    this.scene.add(p.mesh);
    const d = p.kind === 'wall' && doorOf(p.mask);
    if (d) {
      const b = p.boxes.find(x => x.door), ax = p.o === 0 ? 0 : 2, width = b.max[ax] - b.min[ax];
      const hinge = new THREE.Group();
      hinge.position.set(p.o === 0 ? b.min[0] : (b.min[0] + b.max[0]) / 2, b.min[1], p.o === 0 ? (b.min[2] + b.max[2]) / 2 : b.min[2]);
      if (p.o === 1) hinge.rotation.y = -Math.PI / 2;
      const panel = new THREE.Mesh(this.doorGeo, new THREE.MeshLambertMaterial({ map: this.textures[p.mat], color: _c.setHex(matColor(BMATS[p.mat].code)).multiplyScalar(0.7).getHex() }));
      panel.scale.set(width - 0.04, 1.96, 0.1);
      hinge.add(panel);
      this.scene.add(hinge);
      p.door = { hinge, open: 0, center: [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2] };
    }
  }

  disposeEdited(p) {
    if (p.mesh) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); p.mesh = null; }
    if (p.door) { this.scene.remove(p.door.hinge); p.door.hinge.children[0].material.dispose(); p.door = null; }
  }

  remove(id) {
    const p = this.list.get(id);
    if (!p) return null;
    this.disposeEdited(p);
    this.list.delete(id);
    this.slots.delete(slotKey(p));
    this.dirty = true;
    this.changed();
    return p;
  }

  load(all) {
    for (const p of this.list.values()) this.disposeEdited(p);
    this.list.clear();
    this.slots.clear();
    for (const t of all) this.add(t, true);
    this.dirty = true; // an empty list must still wipe last match's instances
    this.changed();
  }

  // Player collision/bullets: everything but door panels (doors open for players).
  changed() {
    this.boxes = [...this.list.values()].flatMap(p => p.boxes.filter(b => !b.door));
    this.onChange?.();
  }

  // people = positions of players and survivors (doors swing open when one is close)
  tick(dt, people = []) {
    for (const p of this.list.values()) if (p.grow > 0) {
      const a = Math.min(p.grow, p.rate * dt);
      p.hp += a;
      p.grow -= a;
      this.dirty = true;
    }
    for (const p of this.list.values()) {
      if (!p.door) continue;
      const c = p.door.center, near = people.some(q => Math.hypot(q[0] - c[0], q[2] - c[2]) < 1.9 && Math.abs(q[1] - c[1]) < 2);
      p.door.open += ((near ? 1 : 0) - p.door.open) * Math.min(1, dt * 7);
      p.door.hinge.children[0].rotation.y = -p.door.open * 1.7;
    }
    if (this.dirty) this.redraw();
  }

  redraw() {
    for (const m of Object.values(this.meshes)) m.count = 0;
    for (const p of this.list.values()) {
      const building = p.grow > 0 ? p.grow / p.maxHp : 0, damage = 1 - Math.min(1, (p.hp + p.grow) / p.maxHp);
      _c.setHex(matColor(BMATS[p.mat].code)).lerp(CHARRED, damage * 0.6).lerp(BLUEPRINT, Math.min(0.85, building * 1.2));
      if (p.mesh) { p.mesh.material.color.copy(_c); continue; }
      const m = this.meshes[p.kind + ':' + p.mat];
      if (m.count >= CAP) continue;
      const n = m.count++;
      m.setMatrixAt(n, pieceTransform(p, _m));
      m.setColorAt(n, _c);
    }
    for (const m of Object.values(this.meshes)) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    this.dirty = false;
  }

  dispose() {
    for (const p of this.list.values()) this.disposeEdited(p);
    for (const m of Object.values(this.meshes)) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    for (const t of Object.values(this.textures)) t.dispose();
    this.doorGeo.dispose();
  }
}

// ---------- harvestable nodes (trees, rocks, wrecks, crates, barrels, rubble, pallets) ----------
const TREE_TINT = [0x2f4a36, 0x3d5a40, 0x4a6648], CAR_TINT = [0x8a3b2e, 0x3f5f7a, 0xb59b6a, 0x5d6b4a], BARREL_TINT = [0x8c2f24, 0x2f5a8c, 0x6d6a2f];

export class Nodes {
  constructor(scene) {
    this.scene = scene;
    this.nodes = OUTPOST_NODES.map(n => ({ ...n, max: NODE_TYPES[n.type].hits, hp: NODE_TYPES[n.type].hits, shake: 0 }));
    const count = type => Math.max(1, this.nodes.filter(n => n.type === type).length);
    const inst = (geo, color, type, shadow = true) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), count(type));
      m.castShadow = shadow; m.receiveShadow = true;
      m.setColorAt(0, _c.setHex(0xffffff));
      scene.add(m);
      return m;
    };
    this.trunks = inst(new THREE.CylinderGeometry(0.3, 0.42, 5, 8).translate(0, 2.5, 0), 0x5d4a36, 'tree');
    this.leaves = inst(new THREE.ConeGeometry(2.5, 4.4, 8).translate(0, 5.6, 0), 0xffffff, 'tree');
    this.tops = inst(new THREE.ConeGeometry(1.8, 3.2, 8).translate(0, 7.6, 0), 0xffffff, 'tree');
    this.rocks = inst(new THREE.DodecahedronGeometry(1, 0).translate(0, 0.55, 0), 0x9d988e, 'rock');
    this.bodies = inst(new THREE.BoxGeometry(2, 0.8, 4.2).translate(0, 0.55, 0), 0xffffff, 'car');
    this.cabs = inst(new THREE.BoxGeometry(1.7, 0.62, 2.1).translate(0, 1.25, 0.25), 0x2b3138, 'car');
    this.crates = inst(new THREE.BoxGeometry(1.2, 1.2, 1.2).translate(0, 0.6, 0), 0xb07a45, 'crate');
    this.barrels = inst(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 12).translate(0, 0.55, 0), 0xffffff, 'barrel');
    this.rubble = inst(new THREE.DodecahedronGeometry(0.8, 0).translate(0, 0.25, 0), 0x8f8a80, 'rubble');
    this.pallets = inst(new THREE.BoxGeometry(1.2, 0.6, 1.0).translate(0, 0.3, 0), 0xc9a26a, 'pallet');
    this.all = [this.trunks, this.leaves, this.tops, this.rocks, this.bodies, this.cabs, this.crates, this.barrels, this.rubble, this.pallets];
    const idx = {};
    for (const n of this.nodes) n.idx = idx[n.type] = (idx[n.type] ?? -1) + 1;
    for (const n of this.nodes) {
      if (n.type === 'tree') { this.leaves.setColorAt(n.idx, _c.setHex(TREE_TINT[n.id % 3])); this.tops.setColorAt(n.idx, _c.setHex(TREE_TINT[(n.id + 1) % 3])); }
      if (n.type === 'car') this.bodies.setColorAt(n.idx, _c.setHex(CAR_TINT[n.id % 4]));
      if (n.type === 'barrel') this.barrels.setColorAt(n.idx, _c.setHex(BARREL_TINT[n.id % 3]));
    }
    this.weak = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0x7dfbff }));
    this.weak.visible = false;
    scene.add(this.weak);
    this.weakNode = -1;
    this.boxes = this.nodes.map(n => n.box);
    this.drawAll();
  }

  draw(n) {
    const k = n.hp > 0 ? 0.72 + 0.28 * (n.hp / n.max) : 0, wob = n.shake > 0 ? Math.sin(n.shake * 60) * n.shake * 0.25 : 0;
    const set = (mesh, sx, sy, sz, yaw = 0) => mesh.setMatrixAt(n.idx, k ? _m.compose(_v.set(n.x + wob, 0, n.z), _q.setFromAxisAngle(Y_AXIS, yaw), _s.set(sx * k, sy * k, sz * k)) : ZERO);
    const b = n.box;
    switch (n.type) {
      case 'tree': { const h = 0.9 + (n.id % 4) * 0.08; set(this.trunks, 1, h, 1); set(this.leaves, 1, h, 1, n.id); set(this.tops, 1, h, 1, n.id * 2); break; }
      case 'rock': set(this.rocks, (b.max[0] - b.min[0]) / 1.8, 0.75, (b.max[2] - b.min[2]) / 1.8, n.id); break;
      case 'car': set(this.bodies, 1, 1, 1, n.along ? Math.PI / 2 : 0); set(this.cabs, 1, 1, 1, n.along ? Math.PI / 2 : 0); break;
      case 'crate': set(this.crates, 1, 1, 1, n.id * 0.4); break;
      case 'barrel': set(this.barrels, 1, 1, 1); break;
      case 'rubble': set(this.rubble, (b.max[0] - b.min[0]) / 1.6, 0.6, (b.max[2] - b.min[2]) / 1.6, n.id); break;
      case 'pallet': set(this.pallets, 1, 1, 1, b.max[0] - b.min[0] > 1.1 ? 0 : Math.PI / 2); break;
    }
  }

  drawAll() {
    for (const n of this.nodes) this.draw(n);
    this.flush();
  }

  flush() {
    for (const m of this.all) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  // Returns true when the node was used up (its collision box disappears).
  setHp(id, hp) {
    const n = this.nodes[id];
    if (!n) return false;
    const gone = n.hp > 0 && hp <= 0;
    n.hp = hp;
    n.shake = 0.25;
    if (gone) {
      this.boxes = this.nodes.filter(q => q.hp > 0).map(q => q.box);
      if (this.weakNode === id) { this.weak.visible = false; this.weakNode = -1; }
    }
    this.draw(n);
    this.flush();
    return gone;
  }

  // [[id, hp], ...] for nodes that are not full; everything else resets.
  reset(list = []) {
    for (const n of this.nodes) n.hp = n.max;
    for (const [id, hp] of list) if (this.nodes[id]) this.nodes[id].hp = hp;
    this.boxes = this.nodes.filter(q => q.hp > 0).map(q => q.box);
    this.weak.visible = false;
    this.weakNode = -1;
    this.drawAll();
  }

  update(dt) {
    let moved = false;
    for (const n of this.nodes) if (n.shake > 0) { n.shake = Math.max(0, n.shake - dt); this.draw(n); moved = true; }
    if (moved) this.flush();
    if (this.weak.visible) this.weak.rotation.y += dt * 4;
  }

  // Put the glowing weak point somewhere on the face of node n that looks toward `from`.
  placeWeak(n, from) {
    const b = n.box, cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    let dx = from[0] - cx, dz = from[2] - cz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const side = (Math.random() - 0.5) * 0.8, y = n.type === 'tree' ? 0.7 + Math.random() * 1.2 : 0.3 + Math.random() * Math.max(0.2, b.max[1] - 0.5);
    const px = clamp(cx + dx * 5 - dz * side, b.min[0], b.max[0]) + dx * 0.05, pz = clamp(cz + dz * 5 + dx * side, b.min[2], b.max[2]) + dz * 0.05;
    this.weak.position.set(px, Math.min(y, b.max[1] - 0.1), pz);
    this.weak.visible = true;
    this.weakNode = n.id;
  }

  dispose() {
    for (const m of [...this.all, this.weak]) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  }
}

// ---------- building (no build mode: a piece key starts it, a hotbar key ends it) ----------
export class BuildMode {
  constructor(game, holdout) {
    this.g = game;
    this.h = holdout;
    this.active = false;
    this.kind = 'wall';     // wall | floor | ramp | cone | trap | deploy
    this.mat = MAT_IDS[0];  // one material — Zinkonium
    this.pick = { trap: null, deploy: null }; // selected trap / deployable item id
    this.turn = 0;          // extra quarter turns for the next stair (R); resets after placing
    this.slot = null;
    this.valid = false;
    this.reason = '';
    this.sent = new Map(); // slot key -> time sent (a pending build is not re-sent while turbo building)
    this.nextPlace = 0;
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x4dc3ff, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghosts = {};
    for (const kind of KINDS) {
      const m = new THREE.Mesh(pieceGeometry(kind), this.ghostMat);
      m.matrixAutoUpdate = false;
      m.visible = false;
      m.renderOrder = 5;
      game.world.scene.add(m);
      this.ghosts[kind] = m;
    }
    this.trapGhost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat);
    this.trapGhost.visible = false;
    game.world.scene.add(this.trapGhost);
  }

  toggle(on = !this.active) {
    this.active = on;
    if (on) { this.g.weapons.cancelReload(); this.g.weapons.scope = 0; this.g.sound.play('deploy', { vol: 0.35 }); this.h.edit?.stop(); }
    if (!on) { for (const m of Object.values(this.ghosts)) m.visible = false; this.trapGhost.visible = false; }
  }

  get item() { return this.pick[this.kind] ?? null; }
  get placing() { return this.kind === 'trap' || this.kind === 'deploy'; }
  owned(kind) { return (kind === 'trap' ? TRAPS : DEPLOYS).filter(id => this.h.items[id] > 0); }

  select(kind) {
    if (kind === 'trap' || kind === 'deploy') {
      const owned = this.owned(kind);
      if (!owned.length) { this.h.say(kind === 'trap' ? 'No traps — buy spikes, wall darts or flame grills at the Core' : 'No turrets or Rally Fires — buy them at the Core'); return; }
      if (!owned.includes(this.pick[kind])) this.pick[kind] = owned[0];
    }
    if (kind !== this.kind) this.turn = 0;
    this.kind = kind;
    this.toggle(true);
  }

  // wheel: which trap / deployable to place (one material, so there's nothing to cycle for walls/floors/ramps)
  cycle(dir) {
    if (!this.placing) return;
    const owned = this.owned(this.kind);
    if (owned.length) this.pick[this.kind] = owned[(owned.indexOf(this.item) + dir + owned.length) % owned.length];
    this.g.sound.play('tick', { vol: 0.4 });
  }

  rotate() { if (this.kind !== 'ramp') return; this.turn = (this.turn + 1) % 4; this.g.sound.play('tick', { vol: 0.4 }); }

  aim() {
    const pl = this.g.player, eye = pl.eye, dir = dirFromAngles(pl.yaw, pl.pitch);
    return { eye, dir, hit: rayWorld(eye, dir, 6.5, this.g.boxes) };
  }

  // Grid slot for the ghost -> { slot, reason }: the one under the crosshair, or the nearest placeable one
  // along your aim when that would float or is out of reach (shared/build.js aimBuildSlot).
  aimSlot() {
    const pl = this.g.player, { eye, dir, hit } = this.aim();
    return aimBuildSlot({ kind: this.kind, mat: this.mat, turn: this.turn, eye, dir, hitT: hit?.t, feet: pl.pos }, this.h.placementWorld(), s => this.sent.has(slotKey(s)));
  }

  // Where the selected trap / deployable would go: { pid, side, i, k, box (for the ghost), reason }
  aimTrap() {
    const it = ITEMS[this.item], { eye, dir, hit } = this.aim();
    if (!it || !hit) return { reason: 'Aim at a spot to place it' };
    const piece = hit.box.sid !== undefined ? this.h.structs.list.get(hit.box.sid) : null;
    const p = eye.map((v, j) => v + dir[j] * hit.t);
    const taken = (pid, side) => [...this.h.ents.defs.values()].some(d => d.pid === pid && d.side === side);
    if (it.mount === 'floor') {
      if (piece?.kind === 'cone') return { reason: 'A cone is in the way' };
      if (!piece || piece.kind !== 'floor' || hit.n[1] < 0.5) return { reason: 'Floor traps go on a built floor' };
      if (taken(piece.id, 0)) return { reason: 'Already trapped' };
      const b = piece.box;
      return { pid: piece.id, box: { min: [b.min[0], b.max[1], b.min[2]], max: [b.max[0], b.max[1] + 0.12, b.max[2]] } };
    }
    if (it.mount === 'wall') {
      if (!piece || piece.kind !== 'wall') return { reason: 'Wall darts go on a built wall' };
      const ax = piece.o === 0 ? 2 : 0, b = piece.box, side = eye[ax] > (b.min[ax] + b.max[ax]) / 2 ? 1 : -1;
      if (taken(piece.id, side)) return { reason: 'Already trapped' };
      const box = { min: [...b.min], max: [...b.max] };
      if (side > 0) { box.min[ax] = b.max[ax]; box.max[ax] = b.max[ax] + 0.1; } else { box.max[ax] = b.min[ax]; box.min[ax] = b.min[ax] - 0.1; }
      return { pid: piece.id, side, box };
    }
    const i = Math.floor((p[0] - GRID.x0) / C), k = Math.floor((p[2] - GRID.z0) / C);
    const floor = piece && piece.kind === 'floor' && piece.i === i && piece.k === k && hit.n[1] > 0.5 ? piece : null;
    if (!floor && (hit.box.mat !== 'f' || hit.n[1] < 0.5)) return { reason: 'Place it on the ground or a floor' };
    const x = GRID.x0 + (i + 0.5) * C, z = GRID.z0 + (k + 0.5) * C, y = floor ? floor.box.max[1] : 0;
    return { i, k, pid: floor?.id ?? 0, box: { min: [x - 0.6, y, z - 0.6], max: [x + 0.6, y + 1.2, z + 0.6] } };
  }

  // The built piece under the crosshair within reach (for upgrade / repair / edit).
  aimedPiece() {
    const pl = this.g.player, eye = pl.eye, dir = dirFromAngles(pl.yaw, pl.pitch);
    const hit = rayWorld(eye, dir, REACH, this.g.boxes);
    return hit && hit.box.sid !== undefined ? this.h.structs.list.get(hit.box.sid) ?? null : null;
  }

  update(dt, firing) {
    const g = this.g, now = g.now;
    const show = this.active && g.player.alive && !this.h.downed && !this.h.edit?.active;
    for (const [k, m] of Object.entries(this.ghosts)) m.visible = show && k === this.kind;
    this.trapGhost.visible = false;
    if (!show) return;
    if (this.placing) {
      if (!(this.h.items[this.item] > 0)) this.pick[this.kind] = this.owned(this.kind)[0] ?? null;
      const t = this.slot = this.item ? this.aimTrap() : { reason: this.kind === 'trap' ? 'No traps left' : 'No turrets or Rally Fires left' };
      this.reason = t.reason || '';
      this.valid = !t.reason;
      if (t.box) {
        this.trapGhost.visible = true;
        this.trapGhost.position.set(...[0, 1, 2].map(i => (t.box.min[i] + t.box.max[i]) / 2));
        this.trapGhost.scale.set(...[0, 1, 2].map(i => Math.max(0.05, t.box.max[i] - t.box.min[i])));
      }
    } else {
      for (const [k, t] of this.sent) if (now - t > 0.8) this.sent.delete(k);
      const a = this.aimSlot(), s = this.slot = a.slot;
      this.reason = a.reason || '';
      this.valid = !this.reason;
      const ghost = this.ghosts[this.kind];
      pieceTransform(s, ghost.matrix);
      ghost.matrixWorldNeedsUpdate = true;
      if (firing && this.valid && now >= this.nextPlace && !g.ui) this.place(s, slotKey(s));
    }
    this.ghostMat.color.setHex(this.valid ? 0x4dc3ff : 0xff5a4e);
    this.ghostMat.opacity = this.valid ? 0.38 : 0.22;
  }

  // A click places right away (a fast click can start and end between two frames).
  tryPlace() {
    this.update(0, false);
    if (this.placing) {
      if (this.valid) { const t = this.slot; this.g.net.send({ t: 'place', item: this.item, pid: t.pid, side: t.side, i: t.i, k: t.k }); this.g.sound.play('build', { vol: 0.5 }); }
      else if (this.reason) this.g.sound.play('dry', { vol: 0.4 });
      return;
    }
    if (this.valid && this.slot) this.place(this.slot, slotKey(this.slot));
    else if (this.reason) this.g.sound.play('dry', { vol: 0.4 });
  }

  place(s, key) {
    this.g.net.send({ t: 'build', kind: s.kind, i: s.i, k: s.k, l: s.l, o: s.o, mat: s.mat });
    this.sent.set(key, this.g.now);
    this.nextPlace = this.g.now + 0.11;
    if (s.kind === 'ramp') this.turn = 0; // the next stair faces away from you again
  }

  costText() { return this.placing ? `${ITEMS[this.item]?.name ?? 'None'} ×${this.h.items[this.item] || 0}` : `${BMATS[this.mat].name.toUpperCase()} ${PIECE_COST}`; }

  dispose() {
    for (const m of Object.values(this.ghosts)) { this.g.world.scene.remove(m); m.geometry.dispose(); }
    this.g.world.scene.remove(this.trapGhost);
    this.trapGhost.geometry.dispose();
    this.ghostMat.dispose();
  }
}

// ---------- edit mode ----------
// Aim at a piece and press the edit key: a tile grid appears on it. Hold fire and drag over tiles; letting go
// applies the edit when it's one of Fortnite's shapes (walls: windows, doors, arches, half arches, triangles,
// half walls — shared/build.js WALL_EDITS; floors: any 1-3 quarters) and flashes red otherwise. Stairs: drag
// across all four tiles to turn them, over two side by side for a half stair. Right-click resets the piece.
export class EditMode {
  constructor(game, holdout) {
    this.g = game;
    this.h = holdout;
    this.active = false;
    this.piece = null;
    this.mask = 0;
    this.path = [];         // stairs: tiles in drag order
    this.flash = 0;         // tiles of a rejected edit, shown red until flashUntil
    this.flashUntil = 0;
    this.paint = null;
    this.wasFiring = false;
    this.group = new THREE.Group();
    game.world.scene.add(this.group);
    this.keep = new THREE.MeshBasicMaterial({ color: 0x4dc3ff, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    this.cut = new THREE.MeshBasicMaterial({ color: 0xff5a4e, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    this.hot = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    this.bad = new THREE.MeshBasicMaterial({ color: 0xff2a1e, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
    this.ray = new THREE.Raycaster();
    this.hover = -1;
  }

  toggle() {
    if (this.active) return this.confirm();
    const p = this.h.build.aimedPiece();
    if (!p) { this.h.say('Aim at one of your builds to edit it'); return; }
    this.begin(p);
  }

  begin(p) {
    this.piece = p;
    this.mask = p.mask | 0;
    this.path = [];
    this.active = true;
    this.paint = null;
    this.wasFiring = false;
    this.buildTiles();
    this.g.sound.play('tick', { vol: 0.5 });
  }

  buildTiles() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry.dispose(); }
    const p = this.piece, [cols, rows] = EDIT_GRID[p.kind], b = p.box, eye = this.g.player.eye;
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    if (p.kind === 'wall') {
      const ax = p.o === 0 ? 0 : 2, nAx = p.o === 0 ? 2 : 0, side = eye[nAx] > (nAx === 0 ? cx : cz) ? 1 : -1, w = C / 3, h = H / 3;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.06, h - 0.06), this.keep);
        const pos = [cx, b.min[1] + (r + 0.5) * h, cz];
        pos[ax] = b.min[ax] + (c + 0.5) * w;
        pos[nAx] += side * (T / 2 + 0.02);
        m.position.set(...pos);
        m.rotation.y = nAx === 2 ? (side > 0 ? 0 : Math.PI) : side * Math.PI / 2;
        m.userData.bit = r * 3 + c;
        this.group.add(m);
      }
    } else if (p.kind === 'floor') {
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(C / 2 - 0.08, C / 2 - 0.08), this.keep);
        m.position.set(b.min[0] + (c + 0.5) * C / 2, b.max[1] + 0.03, b.min[2] + (r + 0.5) * C / 2);
        m.rotation.x = -Math.PI / 2;
        m.userData.bit = r * 2 + c;
        this.group.add(m);
      }
    } else if (p.kind === 'cone') { // each quarter's slice of the pyramid, a little outside it
      for (let bit = 0; bit < 4; bit++) {
        const m = new THREE.Mesh(coneGeometry(15 & ~(1 << bit)), this.keep);
        m.position.set(cx, b.min[1] - 0.03, cz);
        m.scale.set(1.03, 1.06, 1.03);
        m.userData.bit = bit;
        this.group.add(m);
      }
    } else { // stairs: 2 × 2 tiles on the slope (bit = row * 2 + col, col along x), whatever half is left
      const { axis, dir, slope } = b.ramp, len = Math.hypot(C, H) / 2;
      // lay the plane flat, tilt it up the slope (+x rises), then turn it to the ramp's direction
      const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(H, C));
      const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, RAMP_YAW[p.o]).multiply(tilt).multiply(flat);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.1, C / 2 - 0.08), this.keep);
        const pos = [b.min[0] + (c + 0.5) * C / 2, 0, b.min[2] + (r + 0.5) * C / 2];
        pos[1] = b.min[1] + (dir > 0 ? pos[axis] - b.min[axis] : b.max[axis] - pos[axis]) * slope + 0.06;
        m.position.set(...pos);
        m.quaternion.copy(q);
        m.userData.bit = r * 2 + c;
        this.group.add(m);
      }
      this.tilesO = p.o;
    }
    this.group.visible = true;
  }

  // firing = fire button held: on walls and floors the first tile clicked decides whether the drag cuts or
  // restores; on stairs the tiles are kept in drag order. Letting go applies it right away — no second key press.
  update(dt, firing) {
    if (!this.active) return;
    const p = this.piece, pl = this.g.player;
    if (!this.h.structs.list.has(p.id) || !pl.alive || this.h.downed || distToBox(pl.eye, p.box) > REACH + 1.5) return this.stop();
    if (p.kind === 'ramp' && this.tilesO !== p.o) this.buildTiles(); // the last edit turned it
    const dir = dirFromAngles(pl.yaw, pl.pitch);
    this.ray.set(new THREE.Vector3(...pl.eye), new THREE.Vector3(...dir));
    const hit = this.ray.intersectObjects(this.group.children, false)[0];
    this.hover = hit ? hit.object.userData.bit : -1;
    if (firing && this.hover >= 0) {
      const bit = 1 << this.hover, was = this.mask, steps = this.path.length;
      if (p.kind === 'ramp') { if (!this.path.includes(this.hover)) this.path.push(this.hover); }
      else {
        if (this.paint === null) this.paint = !(this.mask & bit);
        this.mask = this.paint ? this.mask | bit : this.mask & ~bit;
      }
      if (this.mask !== was || this.path.length !== steps) this.g.sound.play('tick', { vol: 0.25, rate: 1.4 });
    } else if (!firing) {
      if (this.wasFiring) this.commit();
      this.paint = null;
    }
    this.wasFiring = firing;
    const sel = p.kind === 'ramp' ? this.path.reduce((m, t) => m | (1 << t), 0) : this.mask, bad = this.g.now < this.flashUntil ? this.flash : 0;
    for (const m of this.group.children) {
      const bit = 1 << m.userData.bit;
      m.material = bad & bit ? this.bad : m.userData.bit === this.hover ? this.hot : sel & bit ? this.cut : this.keep;
    }
  }

  // Sends the selection when it's a valid edit that changes the piece — safe to call often, so releasing the
  // mouse and pressing the edit key to leave both use it. Anything else flashes red and resets; nothing is sent.
  commit() {
    const p = this.piece;
    if (!p) return;
    if (p.kind === 'ramp') {
      const path = this.path, e = rampEdit(path);
      this.path = [];
      if (!path.length) return;
      if (!e) return this.invalid(path.reduce((m, t) => m | (1 << t), 0));
      if (e.o !== p.o || e.mask !== (p.mask | 0)) this.g.net.send({ t: 'edit', id: p.id, path });
    } else if (this.mask !== (p.mask | 0)) {
      if (validMask(p.kind, this.mask)) this.g.net.send({ t: 'edit', id: p.id, mask: this.mask });
      else this.invalid(this.mask);
    }
  }

  invalid(tiles) {
    this.flash = tiles;
    this.flashUntil = this.g.now + 0.45;
    this.mask = this.piece.mask | 0;
    this.h.say('Not a valid edit', 1.5);
    this.g.sound.play('dry', { vol: 0.4 });
  }

  confirm() {
    this.commit();
    this.stop();
  }

  reset() {
    if (this.piece && this.piece.mask) this.g.net.send({ t: 'edit', id: this.piece.id, mask: 0 });
    this.stop();
  }

  stop() {
    this.active = false;
    this.piece = null;
    this.group.visible = false;
  }

  describe() {
    const p = this.piece;
    if (!p) return '';
    if (p.kind === 'ramp') {
      if (!this.path.length) return p.mask ? 'half stair' : 'stair';
      const e = rampEdit(this.path);
      return e ? (e.mask ? 'half stair' : 'turn') : 'drag across';
    }
    if (!this.mask) return 'solid';
    return p.kind === 'wall' ? WALL_EDITS.get(this.mask)?.name ?? 'not a valid edit' : 'custom';
  }

  dispose() {
    for (const c of [...this.group.children]) c.geometry.dispose();
    this.g.world.scene.remove(this.group);
    for (const m of [this.keep, this.cut, this.hot, this.bad]) m.dispose();
  }
}
