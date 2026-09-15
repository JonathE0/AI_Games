// Breakable map props on the Outpost (walls, cover, crates, shacks, houses, ruins): one mesh per prop so
// each can darken as it takes damage and disappear when it breaks. The server owns their health; this only
// draws them and hands their collision boxes to movement, bullets and the build preview.
import * as THREE from 'three';
import { OUTPOST_PROPS, PROP_TYPES } from '/shared/outpost.js';
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
