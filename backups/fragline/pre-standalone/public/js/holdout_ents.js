// Zombie Holdout world objects on the client: ground loot, RNG chests, balloon supply drops, placed traps
// and turrets, thrown grenades / molotov fires / freeze blasts, rockets, survivors and the Colossus.
// All of it is driven by server messages; this file only draws and animates.
import * as THREE from 'three';
import { RARITY, AMMO, ITEMS, SURVIVOR } from '/shared/holdout.js';
import { ELEMENTS } from '/shared/elements.js';
import { TIER_COLORS } from '/shared/items.js';
import { OUTPOST } from '/shared/outpost.js';
import { SKY, SKY_POINTS, SKY_LEAN, skyTransform, skyPoint } from '/shared/skyboss.js';
import { hitboxes } from '/shared/physics.js';
import { PlayerModel } from './models.js';

const G_THROW = 15, G_GLOB = 12;
const ITEM_COLOR = { grenade: 0x3f6b35, molotov: 0xe07a2e, freeze: 0x7fe9ff, bandage: 0xf2efe6, medkit: 0xe23c4a, shield_s: 0x5fb8ff, shield: 0x3d7dff, adrenaline: 0xff5a3c, spikes: 0x8c9096, darts: 0x8c9096, flame: 0xd65a2a, turret: 0x6a7480, rturret: 0x6a7480, campfire: 0xc9772e };
const MAT_COLOR = { wood: 0xc9955a, stone: 0xa9a49b, metal: 0x8d9aa6 };
const lerp = (a, b, t) => a + (b - a) * t;
const _v = new THREE.Vector3();
const PICKUP_BLINK = 20; // seconds before despawn that a ground item starts blinking

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

// the Banker's floating "$" sign
function dollarTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffd65a';
  c.font = '900 100px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowColor = '#ffb43c';
  c.shadowBlur = 16;
  c.fillText('$', 64, 70);
  return new THREE.CanvasTexture(cv);
}

export class Entities {
  constructor(world, sound) {
    this.world = world;
    this.scene = world.scene;
    this.sound = sound;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.glow = glowTexture();
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.sphere = new THREE.SphereGeometry(1, 16, 12);
    this.cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
    this.ring = new THREE.RingGeometry(0.45, 0.62, 24).rotateX(-Math.PI / 2);
    this.mats = new Map();
    this.dollarTex = dollarTexture();
    this.pickups = new Map();
    this.chests = new Map();
    this.drops = new Map();
    this.defs = new Map();
    this.thrown = new Map();
    this.rockets = new Map();
    this.fires = [];
    this.flashes = [];
    this.survivors = new Map();
    this.sky = null;
    this.t = 0;
    this.buildCoreCannon();
  }

  // ---------- the Core cannon: a fixed turret on the Core's roof, upgraded but never destroyed ----------
  buildCoreCannon() {
    const g = new THREE.Group();
    g.position.set(0, 2.2, 0);
    this.mesh(this.cyl, 0x3d4750, g, [0, 0.32, 0], [0.6, 0.64, 0.6]);
    const head = new THREE.Group();
    head.position.y = 0.85;
    this.mesh(this.box, 0x5b6672, head, [0, 0, 0], [0.7, 0.5, 0.75]);
    for (const dx of [-0.16, 0.16]) this.mesh(this.cyl, 0x1b1d21, head, [dx, 0.02, -0.62], [0.09, 0.9, 0.09]).rotation.x = Math.PI / 2;
    this.mesh(this.box, 0x5ee6ff, head, [0, 0.1, 0.1], [0.2, 0.08, 0.08], { basic: true });
    g.add(head);
    this.root.add(g);
    this.coreCannon = { g, head, pos: [0, 2.2, 0], target: null, fx: 0 };
  }

  // [[target zombie id, …up to 1 + barrels]] per shot since the last flush
  coreFx(list, zombies) {
    const cc = this.coreCannon;
    if (!cc || !list.length) return;
    const muzzle = [cc.pos[0], cc.pos[1] + 1.05, cc.pos[2]];
    for (const ids of list) {
      let first = null;
      for (const zid of ids) {
        const z = zombies.list.get(zid);
        if (!z) continue;
        const t = [z.pos[0], z.pos[1] + 1.1 * z.s, z.pos[2]];
        first ??= t;
        this.world.tracer(muzzle, t, 0x8fe8ff);
      }
      if (first) cc.target = first;
    }
    cc.fx = 1;
    this.world.flash(muzzle);
    this.sound.play('turret', { pos: muzzle, vol: 0.8, ref: 6 });
  }

  mat(color, opts = {}) {
    const key = color + JSON.stringify(opts), { basic, ...rest } = opts;
    if (!this.mats.has(key)) this.mats.set(key, basic ? new THREE.MeshBasicMaterial({ color, ...rest }) : new THREE.MeshLambertMaterial({ color, ...rest }));
    return this.mats.get(key);
  }

  mesh(geo, color, parent, pos = [0, 0, 0], scale = [1, 1, 1], opts) {
    const m = new THREE.Mesh(geo, this.mat(color, opts));
    m.position.set(...pos);
    m.scale.set(...scale);
    parent.add(m);
    return m;
  }

  sprite(color, size, parent, pos) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(size);
    s.position.set(...pos);
    parent.add(s);
    return s;
  }

  // ---------- ground loot ----------
  // [id, kind ('it' = inventory item, 'ammo', 'mats', 'svsupply'), key, rarity-or-count, x, y, z, { k: item kind, t: tier, el }]
  addPickup([id, kind, key, rn, x, y, z, extra]) {
    const ik = extra?.k ?? null;
    this.removePickup(id);
    const g = new THREE.Group(), spin = new THREE.Group();
    g.position.set(x, y, z);
    g.add(spin);
    let color = 0xffffff;
    if (ik === 'gun') {
      color = new THREE.Color(RARITY[rn]?.color ?? '#ffffff').getHex();
      this.mesh(this.box, 0x2b2f35, spin, [0, 0, 0], [0.12, 0.16, 0.9]);
      this.mesh(this.box, color, spin, [0, 0.09, -0.1], [0.13, 0.04, 0.5], { basic: true });
      if (extra.el) this.mesh(this.box, ELEMENTS[extra.el].hex, spin, [0, -0.02, -0.38], [0.14, 0.1, 0.1], { basic: true });
    } else if (ik === 'armor') {
      color = new THREE.Color(TIER_COLORS[extra.t || 1]).getHex();
      this.mesh(this.box, 0x55606b, spin, [0, 0, 0], [0.42, 0.34, 0.16]);
      this.mesh(this.box, color, spin, [0, 0.12, 0.09], [0.3, 0.05, 0.02], { basic: true });
    } else if (ik === 'attach') {
      color = 0xb8c2cc;
      this.mesh(this.box, 0x2b2f35, spin, [0, 0, 0], [0.12, 0.1, 0.26]);
    } else if (kind === 'ammo') {
      color = new THREE.Color(AMMO[key]?.color ?? '#ffffff').getHex();
      this.mesh(this.box, color, spin, [0, 0, 0], [0.34, 0.22, 0.24]);
    } else if (kind === 'mats') {
      color = MAT_COLOR[key] ?? 0xffffff;
      for (let i = 0; i < 3; i++) this.mesh(this.box, color, spin, [0, i * 0.13 - 0.12, 0], [0.4, 0.12, 0.25]);
    } else if (kind === 'it') {
      color = ITEM_COLOR[key] ?? 0xffffff;
      this.mesh(this.box, color, spin, [0, 0, 0], [0.28, 0.28, 0.28]);
    } else {
      color = 0xff8a2a;
      this.mesh(this.box, color, spin, [0, 0, 0], [0.6, 0.45, 0.45]);
      this.mesh(this.box, 0xffffff, spin, [0, 0, 0], [0.62, 0.1, 0.47], { basic: true });
    }
    spin.position.y = 0.45;
    const ring = new THREE.Mesh(this.ring, this.mat(color, { basic: true, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.y = 0.03;
    g.add(ring);
    this.root.add(g);
    const left = extra?.left ?? Infinity;
    this.pickups.set(id, { id, kind, key, ik, n: rn, r: rn, t: extra?.t ?? 0, el: extra?.el ?? null, pos: [x, y, z], g, spin, seed: Math.random() * 6, expireAt: this.t + left / 1000 });
  }

  removePickup(id) {
    const pk = this.pickups.get(id);
    if (!pk) return;
    this.root.remove(pk.g);
    this.pickups.delete(id);
  }

  clearPickups() { for (const id of [...this.pickups.keys()]) this.removePickup(id); }

  nearestPickup(pos, r, filter = () => true) {
    let best = null, bd = r;
    for (const pk of this.pickups.values()) {
      if (!filter(pk)) continue;
      const d = Math.hypot(pk.pos[0] - pos[0], pk.pos[1] - pos[1], pk.pos[2] - pos[2]);
      if (d < bd) { bd = d; best = pk; }
    }
    return best;
  }

  // ---------- chests ----------
  setChests(list) {
    const want = new Set(list.map(c => c[0]));
    for (const [id, c] of this.chests) if (!want.has(id)) { this.root.remove(c.g); this.chests.delete(id); }
    for (const [id, x, z] of list) {
      if (this.chests.has(id)) continue;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = id * 1.3;
      this.mesh(this.box, 0xc98f2a, g, [0, 0.28, 0], [0.9, 0.55, 0.6]);
      this.mesh(this.box, 0x8a5a14, g, [0, 0.62, 0], [0.94, 0.14, 0.64]);
      this.mesh(this.box, 0xffe28a, g, [0, 0.4, 0.31], [0.14, 0.18, 0.04], { basic: true });
      const glow = this.sprite(0xffd65a, 1.8, g, [0, 0.6, 0]);
      this.root.add(g);
      this.chests.set(id, { id, x, z, g, glow, chime: 0 });
    }
  }

  // ---------- supply drops ----------
  drop(m) {
    let d = this.drops.get(m.id);
    if (!d) {
      const g = new THREE.Group();
      this.mesh(this.box, 0x3d7dff, g, [0, 0.6, 0], [1.2, 1.2, 1.2]);
      this.mesh(this.box, 0xffffff, g, [0, 0.6, 0], [1.24, 0.25, 1.24], { basic: true });
      const balloons = new THREE.Group();
      [[0xe23c4a, -0.5], [0xffd166, 0.5], [0x5ee6c8, 0]].forEach(([c, dx], i) => {
        const b = this.mesh(this.sphere, c, balloons, [dx, 4.2 + (i === 2 ? 0.8 : 0), i === 2 ? 0.4 : -0.2], [0.75, 0.9, 0.75]);
        b.userData.base = b.position.clone();
        const s = new THREE.Mesh(this.box, this.mat(0xdddddd, { basic: true }));
        s.scale.set(0.02, 3.3 + (i === 2 ? 0.8 : 0), 0.02);
        s.position.set(dx / 2, 2.8 + (i === 2 ? 0.4 : 0), i === 2 ? 0.2 : -0.1);
        balloons.add(s);
      });
      g.add(balloons);
      this.root.add(g);
      d = { id: m.id, g, balloons, x: m.x, z: m.z, y: m.y, v: m.v, landed: false, beam: null };
      this.drops.set(m.id, d);
    }
    Object.assign(d, { x: m.x, z: m.z, y: m.y, v: m.v });
    if (m.popped) { this.sound.play('pop', { pos: [d.x, d.y + 4, d.z], vol: 1 }); d.balloons.visible = false; }
    d.g.position.set(d.x, d.y, d.z);
    return d;
  }

  landDrop(id, y) {
    const d = this.drops.get(id);
    if (!d) return;
    d.landed = true;
    d.y = y;
    d.g.position.y = y;
    d.balloons.visible = false;
    d.beam = new THREE.Mesh(this.cyl, this.mat(0x6fb8ff, { basic: true, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
    d.beam.scale.set(0.45, 40, 0.45);
    d.beam.position.y = 20;
    d.g.add(d.beam);
    this.sound.play('land', { pos: [d.x, y, d.z], vol: 1 });
  }

  removeDrop(id) {
    const d = this.drops.get(id);
    if (!d) return;
    this.root.remove(d.g);
    this.drops.delete(id);
  }

  // ---------- defenses ----------
  // [id, type, x, y, z, axis, side, pid, owner]
  addDef([id, type, x, y, z, axis, side, pid, owner]) {
    this.removeDef(id);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const d = { id, type, pid, side, owner, g, pos: [x, y, z], yaw: 0, fx: 0, head: null };
    if (type === 'spikes') {
      this.mesh(this.box, 0x3a3d42, g, [0, 0.03, 0], [3.8, 0.06, 3.8]);
      const spikes = new THREE.Group();
      for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) this.mesh(new THREE.ConeGeometry(0.09, 0.35, 5), 0xb9c0c7, spikes, [-1.6 + i * 0.8, 0.12, -1.6 + k * 0.8]);
      g.add(spikes);
      d.head = spikes;
    } else if (type === 'flame') {
      this.mesh(this.box, 0x2a2624, g, [0, 0.04, 0], [3.8, 0.08, 3.8]);
      for (let i = 0; i < 4; i++) this.mesh(this.box, 0x6a3a22, g, [-1.35 + i * 0.9, 0.09, 0], [0.12, 0.04, 3.5]);
    } else if (type === 'darts') {
      const panel = this.mesh(this.box, 0x55595f, g, [0, 0, 0], axis === 2 ? [3.6, 2.6, 0.12] : [0.12, 2.6, 3.6]);
      for (let i = 0; i < 12; i++) {
        const u = -1.4 + (i % 4) * 0.93, v = -0.9 + Math.floor(i / 4) * 0.9;
        this.mesh(this.box, 0x151719, g, axis === 2 ? [u, v, side * 0.07] : [side * 0.07, v, u], [0.14, 0.14, 0.14]);
      }
      d.panel = panel;
    } else if (type === 'turret' || type === 'rturret') {
      this.mesh(this.cyl, 0x4a5058, g, [0, 0.35, 0], [0.45, 0.7, 0.45]);
      const head = new THREE.Group();
      head.position.y = 1.0;
      this.mesh(this.box, type === 'turret' ? 0x6a7480 : 0x58663f, head, [0, 0, 0], [0.55, 0.4, 0.6]);
      if (type === 'turret') this.mesh(this.box, 0x1b1d21, head, [0, 0.02, -0.55], [0.08, 0.08, 0.6]);
      else for (const [dx, dy] of [[-0.14, 0.08], [0.14, 0.08], [-0.14, -0.1], [0.14, -0.1]]) this.mesh(this.cyl, 0x2b2f35, head, [dx, dy, -0.4], [0.07, 0.5, 0.07]).rotation.x = Math.PI / 2;
      g.add(head);
      d.head = head;
    } else if (type === 'campfire') {
      for (let i = 0; i < 3; i++) { const l = this.mesh(this.cyl, 0x5a3a22, g, [0, 0.1, 0], [0.09, 1.0, 0.09]); l.rotation.set(Math.PI / 2, i * 1.05, 0); }
      d.flame = this.mesh(new THREE.ConeGeometry(0.35, 0.9, 7), 0xffa13d, g, [0, 0.55, 0], [1, 1, 1], { basic: true, transparent: true, opacity: 0.85 });
      d.light = this.sprite(0xff9a3c, 3.2, g, [0, 0.7, 0]);
    }
    this.root.add(g);
    this.defs.set(id, d);
  }

  removeDef(id) {
    const d = this.defs.get(id);
    if (!d) return;
    this.root.remove(d.g);
    this.defs.delete(id);
  }

  setDefs(list) { for (const id of [...this.defs.keys()]) this.removeDef(id); for (const t of list) this.addDef(t); }

  // [[defense id, target zombie id (0 = trap burst)]]
  defFx(list, zombies) {
    for (const [id, zid] of list) {
      const d = this.defs.get(id);
      if (!d) continue;
      d.fx = 1;
      if (d.type === 'turret' || d.type === 'rturret') {
        const z = zombies.list.get(zid);
        if (z) {
          d.target = [z.pos[0], z.pos[1] + 1.1 * z.s, z.pos[2]];
          const muzzle = [d.pos[0], d.pos[1] + 1.02, d.pos[2]];
          if (d.type === 'turret') { this.world.tracer(muzzle, d.target, 0xfff0b8); this.world.flash(muzzle); this.sound.play('turret', { pos: muzzle, vol: 0.7, ref: 3 }); }
        }
      } else if (d.type === 'flame') {
        for (let i = 0; i < 4; i++) this.world.burst([d.pos[0] + (Math.random() - 0.5) * 3, d.pos[1] + 0.2, d.pos[2] + (Math.random() - 0.5) * 3], [0, 1, 0], 0xff8a2a, 5, 3);
        this.sound.play('fire', { pos: d.pos, vol: 0.5, ref: 3 });
      } else if (d.type === 'darts') {
        this.sound.play('impact_w', { pos: d.pos, vol: 0.5, ref: 3 });
      } else if (d.type === 'spikes') this.sound.play('knife_hit', { pos: d.pos, vol: 0.4, ref: 3 });
    }
  }

  // ---------- thrown things, rockets, explosions ----------
  addThrown(m) {
    const color = m.item === 'glnade' ? 0x4b5a3e : ITEM_COLOR[m.item] ?? 0xffffff;
    const g = this.mesh(m.item === 'molotov' ? this.cyl : this.sphere, color, this.root, m.o, m.item === 'molotov' ? [0.07, 0.3, 0.07] : [0.11, 0.11, 0.11]);
    this.thrown.set(m.id, { g, pos: [...m.o], vel: [...m.v], item: m.item });
    this.sound.play('throw', { pos: m.o, vol: 0.7 });
  }

  addRocket(m) {
    const g = new THREE.Group();
    this.mesh(this.cyl, 0x4b5a3e, g, [0, 0, 0], [0.07, 0.6, 0.07]).rotation.x = Math.PI / 2;
    this.sprite(0xffa13d, 0.8, g, [0, 0, 0.35]);
    g.position.set(...m.o);
    g.lookAt(m.o[0] + m.d[0], m.o[1] + m.d[1], m.o[2] + m.d[2]);
    this.root.add(g);
    this.rockets.set(m.id, { g, pos: [...m.o], d: m.d, puff: 0 });
    this.sound.play('shot_rocket', { pos: m.o, vol: 1, ref: 4 });
  }

  boom(m, camPos) {
    const t = this.thrown.get(m.id);
    if (t) { this.root.remove(t.g); this.thrown.delete(m.id); }
    const r = this.rockets.get(m.id);
    if (r) { this.root.remove(r.g); this.rockets.delete(m.id); }
    const p = m.p;
    if (m.item === 'grenade' || m.item === 'rocket' || m.item === 'glnade') {
      for (let i = 0; i < 5; i++) this.world.burst(p, [0, 1, 0], [0xffb347, 0xff6a2a, 0x3a3634][i % 3], 12, 6);
      this.flashes.push({ s: this.sprite(0xffb347, 6, this.root, p), t: 0.25 });
      this.sound.play('explode', { pos: p, vol: 1.6, ref: 6 });
      const d = Math.hypot(p[0] - camPos[0], p[1] - camPos[1], p[2] - camPos[2]);
      return d < 12 ? (12 - d) / 12 : 0; // camera shake
    }
    if (m.item === 'molotov') {
      const disc = this.mesh(new THREE.CircleGeometry(ITEMS.molotov.radius, 24).rotateX(-Math.PI / 2), 0xff7a2a, this.root, [p[0], p[1] + 0.04, p[2]], [1, 1, 1], { basic: true, transparent: true, opacity: 0.35, depthWrite: false });
      this.fires.push({ disc, p, until: this.t + (m.left ?? ITEMS.molotov.burn * 1000) / 1000, next: 0 });
      this.sound.play('fire', { pos: p, vol: 1, ref: 4 });
    } else if (m.item === 'freeze') {
      this.world.burst(p, [0, 1, 0], 0xbff6ff, 24, 5);
      this.flashes.push({ s: this.sprite(0x9ff2ff, 8, this.root, p), t: 0.4 });
      this.sound.play('freeze_blast', { pos: p, vol: 1.2, ref: 5 });
    }
    return 0;
  }

  // ---------- the Blacksmith ----------
  smithShow(pos) {
    if (this.smith) return;
    const g = new THREE.Group();
    g.position.set(pos.x, 0, pos.z);
    const npc = new PlayerModel(this.scene, 0x5a3a20);
    npc.pose(0, 0, 'knife');
    npc.group.position.set(pos.x - 0.7, 0, pos.z);
    npc.group.rotation.y = Math.atan2(pos.x, pos.z); // faces the Core
    npc.blob.position.set(pos.x - 0.7, 0.02, pos.z);
    this.mesh(this.box, 0x2b2f35, g, [0.4, 0.45, 0], [0.5, 0.9, 0.4]);      // anvil stand
    this.mesh(this.box, 0x4a4f57, g, [0.4, 0.95, 0], [0.9, 0.22, 0.34]);    // anvil
    this.mesh(this.box, 0x3a2a20, g, [0.6, 0.5, 0.9], [0.9, 1, 0.9]);       // forge
    const fire = this.sprite(0xff7a2a, 1.6, g, [0.6, 1.15, 0.9]);
    this.root.add(g);
    this.smith = { g, npc, fire };
    this.world.burst([pos.x, 1, pos.z], [0, 1, 0], 0xffb43c, 30, 4);
  }

  // ---------- the Banker: always present, inside the Core ring ----------
  bankerShow() {
    if (this.banker) return;
    const pos = OUTPOST.banker, g = new THREE.Group();
    g.position.set(pos.x, 0, pos.z);
    const yaw = Math.atan2(pos.x, pos.z); // faces the Core
    this.mesh(this.box, 0x2b2f35, g, [0, 0.45, 0], [1.4, 0.9, 0.8]);   // counter
    this.mesh(this.box, 0x3a3f46, g, [0, 0.92, 0], [1.5, 0.08, 0.86]); // countertop
    const npc = new PlayerModel(this.scene, 0x23262b); // dark suit
    const visorMat = new THREE.MeshLambertMaterial({ color: 0x2ee67a }); // green visor
    npc.visor.material = visorMat;
    npc.pose(0, 0, 'knife');
    const d = Math.hypot(pos.x, pos.z) || 1, bx = pos.x + (pos.x / d) * 0.75, bz = pos.z + (pos.z / d) * 0.75;
    npc.group.position.set(bx, 0, bz);
    npc.group.rotation.y = yaw;
    npc.blob.position.set(bx, 0.02, bz);
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dollarTex, transparent: true, depthWrite: false }));
    sign.scale.set(0.9, 0.9, 1);
    sign.position.set(0, 2.1, 0);
    g.add(sign);
    this.root.add(g);
    this.banker = { g, npc, sign, visorMat };
  }

  bankerGone() {
    if (!this.banker) return;
    this.root.remove(this.banker.g);
    this.scene.remove(this.banker.npc.group, this.banker.npc.blob);
    this.banker.visorMat.dispose();
    this.banker = null;
  }

  // ---------- the Maw (wave 15) ----------
  // A worm of stacked segments that rises out of the ground; a ring of teeth around a glowing throat.
  mawBuild() {
    const g = new THREE.Group(), body = new THREE.Group();
    g.add(body);
    const flesh = 0x3a2a30, segs = [];
    for (let i = 0; i < 7; i++) {
      const r = 2.4 - i * 0.08;
      const seg = this.mesh(this.cyl, i % 2 ? flesh : 0x4a3038, body, [0, i * 1.35 + 0.7, 0], [r, 1.4, r]);
      segs.push(seg);
    }
    const lip = this.mesh(new THREE.TorusGeometry(1.9, 0.35, 8, 20), 0x5a2a36, body, [0, 9.8, 0]);
    lip.rotation.x = Math.PI / 2;
    const teeth = new THREE.Group();
    teeth.position.y = 9.8;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, t = this.mesh(new THREE.ConeGeometry(0.22, 0.9, 6), 0xe8e0c8, teeth, [Math.cos(a) * 1.7, 0.2, Math.sin(a) * 1.7]);
      t.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    }
    body.add(teeth);
    const throat = this.mesh(this.sphere, 0xff5a8a, body, [0, 9.3, 0], [1.2, 1.2, 1.2], { basic: true });
    const glow = this.sprite(0xff5a8a, 5, body, [0, 9.3, 0]);
    const mound = this.mesh(this.sphere, 0x6b5237, g, [0, 0, 0], [2.6, 0.8, 2.6]);
    this.root.add(g);
    return { g, body, segs, teeth, throat, glow, mound };
  }

  mawEvent(m, now) {
    let w = this.maw;
    if (m.ev === 'enter' || m.ev === 'sync') {
      if (w) this.root.remove(w.g);
      w = this.maw = { ...this.mawBuild(), x: m.x, z: m.z, tx: m.x, tz: m.z, hp: m.hp, max: m.max, need: m.need, mode: m.ev === 'enter' ? 'enter' : m.mode, t0: this.t, up: 0, want: 0, stage: m.stage ?? 1, warn: null };
      if (m.ev === 'enter') { w.want = 11; w.until = this.t + 4; this.sound.play('sky_roar', { pos: [m.x, 5, m.z], vol: 1.6, ref: 30, rate: 0.5 }); }
    }
    if (!w) return 0;
    let shake = 0;
    switch (m.ev) {
      case 'move': w.tx = m.x; w.tz = m.z; if (w.mode !== 'hunt') { w.mode = 'hunt'; w.want = 0; } break;
      case 'warn': w.tx = w.x = m.x; w.tz = w.z = m.z; w.mode = 'warn'; w.warn = this.mesh(this.ring, 0xff2a2a, this.root, [m.x, 0.06, m.z], [m.r / 0.62, 1, m.r / 0.62], { basic: true, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }); w.warnUntil = this.t + m.ms / 1000; this.sound.play('brute_roar', { pos: [m.x, 0, m.z], vol: 1.2, ref: 10, rate: 0.4 }); break;
      case 'erupt':
        w.mode = 'erupt'; w.want = 6; w.until = this.t + 1.3;
        for (let i = 0; i < 6; i++) this.world.burst([m.x + (Math.random() - 0.5) * 4, 0.3, m.z + (Math.random() - 0.5) * 4], [0, 1, 0], 0x6b5237, 14, 9);
        this.sound.play('explode', { pos: [m.x, 1, m.z], vol: 1.8, ref: 10, rate: 0.6 });
        shake = 0.9;
        break;
      case 'lured': w.x = w.tx = m.x; w.z = w.tz = m.z; w.mode = 'lured'; w.want = 10; w.until = this.t + m.ms / 1000; this.sound.play('sky_roar', { pos: [m.x, 8, m.z], vol: 1.5, ref: 25, rate: 0.6 }); shake = 0.6; break;
      case 'dive': w.mode = 'dive'; w.want = 0; break;
      case 'devour': w.x = w.tx = m.x; w.z = w.tz = m.z; w.mode = 'devour'; w.want = 10; w.devourEnd = this.t + m.ms / 1000; this.sound.play('core_alarm', { vol: 1 }); break;
      case 'interrupt': w.mode = 'lured'; w.want = 10; this.sound.play('sky_roar', { pos: [w.x, 8, w.z], vol: 1.4, ref: 25, rate: 0.8 }); break;
      case 'bite': this.sound.play('explode', { pos: [w.x, 3, w.z], vol: 2, ref: 20, rate: 0.5 }); shake = 1.2; break;
      case 'hp': w.hp = m.hp; break;
      case 'stage': w.stage = m.stage; this.sound.play('sky_roar', { pos: [w.x, 3, w.z], vol: 1.2, ref: 25, rate: 0.7 }); break;
      case 'die':
        for (let i = 0; i < 10; i++) this.world.burst([w.x, 2 + i, w.z], [0, 1, 0], 0x5a2a36, 20, 8);
        this.sound.play('explode', { pos: [w.x, 4, w.z], vol: 2, ref: 20, rate: 0.4 });
        this.root.remove(w.g);
        if (w.warn) this.root.remove(w.warn);
        this.maw = null;
        shake = 1;
        break;
    }
    return shake;
  }

  // the throat (and body) as shootable spheres while its head is up
  mawTargets() {
    const w = this.maw;
    if (!w || w.up < 3) return null;
    const top = w.up - 0.7;
    return { g: [w.x, top, w.z], gr: 1.6, b: [w.x, top * 0.6, w.z], br: 3.6 };
  }

  updateMaw(dt) {
    const w = this.maw;
    if (!w) return;
    const k = Math.min(1, dt * 4);
    w.x += (w.tx - w.x) * k; w.z += (w.tz - w.z) * k;
    const speed = w.mode === 'devour' ? 0.9 : w.mode === 'lured' || w.mode === 'erupt' || w.mode === 'enter' ? 14 : 8;
    w.up += Math.max(-dt * 10, Math.min(dt * speed, w.want - w.up));
    if (w.mode === 'enter' && this.t > w.until) { w.want = 0; w.mode = 'hunt'; }
    if (w.mode === 'erupt' && this.t > w.until) w.want = 0;
    w.g.position.set(w.x, 0, w.z);
    w.body.position.y = w.up - 10.2;
    w.body.visible = w.up > 0.2;
    const open = w.mode === 'lured' || w.mode === 'devour' ? 1 : 0.3;
    w.teeth.scale.setScalar(1 + open * 0.35 + Math.sin(this.t * 6) * 0.04);
    w.throat.visible = w.glow.visible = open > 0.5;
    w.body.rotation.y += dt * 0.3;
    w.mound.visible = w.up < 1.5;
    w.mound.scale.y = 0.6 + Math.sin(this.t * 9) * 0.15;
    if (w.up < 1.5 && Math.random() < dt * 14) this.world.burst([w.x + (Math.random() - 0.5) * 3, 0.2, w.z + (Math.random() - 0.5) * 3], [0, 1, 0], 0x6b5237, 3, 3);
    if (w.warn) { w.warn.material.opacity = 0.5 + 0.4 * Math.sin(this.t * 20); if (this.t > w.warnUntil) { this.root.remove(w.warn); w.warn = null; } }
  }

  // ---------- seismic thumpers ----------
  setThumpers(list) {
    this.thumpers ??= new Map();
    const want = new Set(list.map(t => t[0]));
    for (const [id, t] of this.thumpers) if (!want.has(id)) { this.root.remove(t.g); this.thumpers.delete(id); }
    for (const [id, x, z, state, left] of list) {
      let t = this.thumpers.get(id);
      if (!t) {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        this.mesh(this.box, 0x3a3f46, g, [0, 0.15, 0], [1.3, 0.3, 1.3]);
        this.mesh(this.cyl, 0x6b7280, g, [0, 1.2, 0], [0.18, 2, 0.18]);
        const head = this.mesh(this.box, 0xffb43c, g, [0, 2.2, 0], [0.7, 0.4, 0.7]);
        const beam = this.mesh(this.cyl, 0xffb43c, g, [0, 14, 0], [0.12, 24, 0.12], { basic: true, transparent: true, opacity: 0.35, depthWrite: false });
        this.root.add(g);
        t = { id, x, z, g, head, beam, state, until: 0, pulseAt: 0 };
        this.thumpers.set(id, t);
      }
      t.state = state;
      t.until = this.t + left / 1000;
      t.head.material = this.mat(state === 'pulse' ? 0x5dff7a : state === 'spent' ? 0x6b7280 : 0xffb43c);
      t.beam.visible = state !== 'spent';
    }
  }

  updateThumpers(dt) {
    if (!this.thumpers) return;
    for (const t of this.thumpers.values()) {
      if (t.state !== 'pulse') continue;
      const k = (this.t * 1.6) % 1;
      t.head.position.y = 2.2 - Math.abs(Math.sin(this.t * 5)) * 0.8;
      if (this.t > t.pulseAt) {
        t.pulseAt = this.t + 0.62;
        this.world.burst([t.x, 0.2, t.z], [0, 1, 0], 0x5dff7a, 8, 4);
        this.sound.play('land', { pos: [t.x, 0, t.z], vol: 0.9, ref: 6, rate: 0.6 });
      }
    }
  }

  stomp(m) {
    const ring = new THREE.Mesh(this.ring, new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.set(m.p[0], 0.08, m.p[2]);
    ring.scale.set(m.r / 0.62, 1, m.r / 0.62);
    this.root.add(ring);
    this.flashes.push({ s: ring, t: 0.4, ring: m.r / 0.62 });
    for (let i = 0; i < 8; i++) this.world.burst([m.p[0] + Math.cos(i) * m.r * 0.6, 0.2, m.p[2] + Math.sin(i) * m.r * 0.6], [0, 1, 0], 0x7a6a55, 6, 5);
    this.sound.play('explode', { pos: m.p, vol: 1.3, ref: 8, rate: 0.5 });
  }

  // Shockwave Blaster: a zombie slams into a wall (or the Core, a prop…) and drops, stunned
  slamFx(m) {
    this.world.burst(m.p, [0, 1, 0], 0x8a7a5a, 14, 6);
    this.sound.play('land', { pos: m.p, vol: 1.1, ref: 6, rate: 0.55 });
  }

  // Iron Golem: a heavy crash + debris burst every time it smashes a piece (camera shake is holdout.js's job)
  golemSmash(p) {
    for (let i = 0; i < 3; i++) this.world.burst([p[0] + (Math.random() - 0.5) * 1.5, p[1] + (Math.random() - 0.5), p[2] + (Math.random() - 0.5) * 1.5], [0, 1, 0], 0x8a7a5a, 10, 6);
    this.sound.play('break_M', { pos: p, vol: 1.3, ref: 8, rate: 0.6 });
  }

  // the Brood Titan drops fresh minions off its back: a small landing puff where they fall
  mdropFx(p) {
    this.world.burst(p, [0, -1, 0], 0x4a5a2a, 8, 3);
    this.sound.play('land', { pos: p, vol: 0.7, ref: 5, rate: 0.8 });
  }

  // Maw Fang's "bite" perk: a small red shockwave ring where nearby zombies got pulled in
  biteFx(m) {
    const ring = new THREE.Mesh(this.ring, new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.set(m.p[0], 0.08, m.p[2]);
    ring.scale.set(6 / 0.62, 1, 6 / 0.62);
    this.root.add(ring);
    this.flashes.push({ s: ring, t: 0.3, ring: 6 / 0.62 });
    this.sound.play('zap', { pos: m.p, vol: 0.8, ref: 4 });
  }

  // ---------- specialists: sniper lasers, hazards on the ground, burrower tunnels ----------
  // night: thicker/brighter telegraph so a sniper's laser reads clearly in the dark (client-only touch-up)
  laser(z, target, ms, night = false) {
    const color = night ? 0xff5a5a : 0xff2020;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: night ? 0.95 : 0.85, linewidth: night ? 3 : 1 }));
    this.root.add(line);
    (this.lasers ??= []).push({ line, z, target, until: this.t + ms / 1000, dot: this.sprite(color, night ? 0.55 : 0.35, this.root, target), night });
  }

  // acid (bloater), ink (hexer), fire (pyro), acidz (Brood Launcher bomblets, zombies only) patches
  addHazard(m) {
    const color = { acid: 0x8fe03a, acidz: 0x8fe03a, ink: 0x2a0f3a, fire: 0xff6a1a }[m.k] ?? 0xffffff;
    const disc = this.mesh(new THREE.CircleGeometry(m.r, 28).rotateX(-Math.PI / 2), color, this.root, [m.p[0], Math.max(0, m.p[1]) + 0.05, m.p[2]], [1, 1, 1],
      { basic: true, transparent: true, opacity: m.k === 'ink' ? 0.7 : 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    if (m.k === 'ink') { // a cloud you can't see through
      this.mesh(this.sphere, 0x14061e, disc, [0, 0.9, 0], [m.r, 1.6, m.r], { basic: true, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
    }
    (this.hazards ??= []).push({ disc, k: m.k, p: m.p, r: m.r, until: this.t + m.life, next: 0 });
    if (m.k === 'fire') this.sound.play('fire', { pos: m.p, vol: 0.5, ref: 3 });
  }

  dig(m) {
    (this.digs ??= []).push({ from: m.from, to: m.to, t0: this.t, T: m.ms / 1000, next: 0 });
    this.sound.play('brute_roar', { pos: m.from, vol: 0.6, ref: 4, rate: 0.45 });
  }

  updateSpecials(dt, zombies) {
    this.updateMaw(dt);
    this.updateThumpers(dt);
    if (this.lasers) for (let i = this.lasers.length - 1; i >= 0; i--) {
      const L = this.lasers[i], z = zombies.list.get(L.z);
      if (this.t > L.until || !z || z.dead) { this.root.remove(L.line, L.dot); L.line.geometry.dispose(); L.line.material.dispose(); this.lasers.splice(i, 1); continue; }
      const a = [z.pos[0], z.pos[1] + 1.55 * z.s, z.pos[2]], pos = L.line.geometry.attributes.position;
      pos.setXYZ(0, ...a); pos.setXYZ(1, ...L.target); pos.needsUpdate = true;
      L.line.material.opacity = (L.night ? 0.55 : 0.4) + 0.5 * Math.abs(Math.sin(this.t * 18));
    }
    if (this.hazards) for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (this.t > h.until) { this.root.remove(h.disc); h.disc.geometry.dispose(); this.hazards.splice(i, 1); continue; }
      if (this.t < h.next) continue;
      h.next = this.t + (h.k === 'ink' ? 0.12 : 0.25);
      const a = Math.random() * 6.28, r = Math.random() * h.r, p = [h.p[0] + Math.cos(a) * r, Math.max(0, h.p[1]) + 0.1, h.p[2] + Math.sin(a) * r];
      this.world.burst(p, [0, 1, 0], h.k === 'acid' || h.k === 'acidz' ? 0xb8ff5a : h.k === 'ink' ? 0x1a0826 : 0xffa23a, h.k === 'ink' ? 4 : 2, h.k === 'ink' ? 1.2 : 1.8);
    }
    if (this.digs) for (let i = this.digs.length - 1; i >= 0; i--) {
      const d = this.digs[i], k = (this.t - d.t0) / d.T;
      if (k > 1) { this.digs.splice(i, 1); continue; }
      if (this.t < d.next) continue;
      d.next = this.t + 0.08;
      const p = [d.from[0] + (d.to[0] - d.from[0]) * k, 0.05, d.from[2] + (d.to[2] - d.from[2]) * k];
      this.world.burst(p, [0, 1, 0], 0x6b5237, 5, 2.4);
    }
  }

  // Shockwave Blaster cone and shock arcs
  blastFx(m) {
    const o = m.o, d = m.d;
    for (let i = 0; i < 14; i++) {
      const a = (Math.random() - 0.5) * 1.0, c = Math.cos(a), s = Math.sin(a);
      const dir = [d[0] * c - d[2] * s, 0.15 + Math.random() * 0.2, d[0] * s + d[2] * c];
      this.world.burst([o[0] + dir[0] * 1.5, o[1] - 0.3, o[2] + dir[2] * 1.5], dir, 0x7fd0ff, 3, 9);
    }
    this.flashes.push({ s: this.sprite(0x7fd0ff, 4, this.root, [o[0] + d[0] * 2, o[1] - 0.2, o[2] + d[2] * 2]), t: 0.2 });
  }

  arcFx(a, b) {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const k = i / 6, j = i === 0 || i === 6 ? 0 : 0.35;
      pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * k + (Math.random() - 0.5) * j, a[1] + (b[1] - a[1]) * k + (Math.random() - 0.5) * j, a[2] + (b[2] - a[2]) * k + (Math.random() - 0.5) * j));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 1 }));
    this.root.add(line);
    this.arcs ??= [];
    this.arcs.push({ line, t: 0.18 });
    this.sound.play('zap', { pos: b, vol: 0.7, ref: 3 });
  }

  // ---------- survivors ----------
  svAdd(id, name, tier = 0) {
    if (this.survivors.has(id)) return;
    const s = { id, name, model: null, pos: [0, -50, 0], from: [0, -50, 0], to: [0, -50, 0], yaw: 0, t: 1, state: 0, hp: 1, tier, carrier: '', ammo: 0, owner: '' };
    this.svModel(s);
    this.survivors.set(id, s);
  }

  // shirt color and gun show the survivor's tier
  svModel(s) {
    if (s.model) this.scene.remove(s.model.group, s.model.blob);
    const T = SURVIVOR.tiers[s.tier] ?? SURVIVOR.tiers[0];
    s.model = new PlayerModel(this.scene, T.color);
    s.model.pose(0, 0, T.w);
    s.model.setDead(s.state === 0);
  }

  // [id, state (0 wounded, 1 carried, 2 active), x, y, z, yaw, hp01, tier, carrier, ammo, owner]
  svState(list, shots, remotes, me) {
    const seen = new Set();
    for (const [id, state, x, y, z, yaw, hp, tier, carrier, ammo, owner] of list) {
      const s = this.survivors.get(id);
      if (!s) continue;
      seen.add(id);
      s.from = [...s.pos]; s.to = [x, y, z]; s.t = 0;
      if (s.pos[1] < -40) s.from = [x, y, z];
      if (tier !== s.tier) { s.tier = tier; s.state = state; this.svModel(s); } // promoted: new gun
      Object.assign(s, { yaw, hp, carrier, ammo, owner });
      if (state !== s.state) { s.state = state; s.model.setDead(state === 0); } // wounded ones lie on the ground
    }
    for (const [sid, ex, ey, ez] of shots || []) {
      const s = this.survivors.get(sid);
      if (!s || s.state !== 2) continue;
      const o = [s.pos[0], s.pos[1] + 1.4, s.pos[2]];
      this.world.tracer(o, [ex, ey, ez], 0xffd28a);
      if (Math.random() < 0.6) this.sound.play('shot_' + (SURVIVOR.tiers[s.tier]?.snd ?? 'mac10'), { pos: o, vol: 0.55, ref: 3, roll: 1.2 });
    }
    return seen;
  }

  svDie(id) {
    const s = this.survivors.get(id);
    if (!s) return;
    this.scene.remove(s.model.group, s.model.blob);
    this.survivors.delete(id);
  }

  clearSurvivors() { for (const id of [...this.survivors.keys()]) this.svDie(id); }

  // ---------- the Colossus ----------
  skyStart(m, now) {
    if (this.sky) this.skyEnd();
    const g = new THREE.Group(), body = new THREE.Group();
    g.add(body);
    body.scale.setScalar(SKY.scale);
    body.rotation.x = -SKY_LEAN; // same lean as skyPoint(), so the glowing spots are where the hit tests are
    const skin = 0x5d3f6e, cloth = 0x2a1f33;
    hitboxes(0).forEach(hb => this.mesh(this.box, hb.part === 'head' || hb.part === 'arm' ? skin : cloth, body, hb.c, hb.h.map(v => v * 2)));
    const wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(s * 0.22, 1.35, 0.12);
      this.mesh(this.box, 0x3b2a48, w, [s * 0.55, 0, 0], [1.1, 0.04, 0.55], { transparent: true, opacity: 0.9 });
      body.add(w);
      wings.push(w);
    }
    const points = SKY_POINTS.map(([x, y, z], i) => {
      const p = this.mesh(this.sphere, 0xff4fd8, body, [x, y, z], Array(3).fill(SKY.pointR / SKY.scale), { basic: true });
      const glow = this.sprite(0xff4fd8, (SKY.pointR * 3) / SKY.scale, p, [0, 0, 0]);
      glow.scale.setScalar(3);
      p.userData.glow = glow; // its own (uncached) material — safe to brighten just this one when highlighted
      return p;
    });
    this.root.add(g);
    this.sky = { g, body, wings, points, t0: now - m.el / 1000, hp: [...m.hp], max: m.max, dead: false, fall: 0, backIdx: -1 };
    this.sound.play('sky_roar', { vol: 0.9 });
  }

  // server told us every remaining weak point is on its back: pulse that one harder so it stands out
  skyBack(i) { if (this.sky) this.sky.backIdx = i; }

  skyHit(i, hp) {
    const s = this.sky;
    if (!s) return;
    s.hp[i] = hp;
    if (hp <= 0 && s.points[i].visible) {
      s.points[i].visible = false;
      const p = s.points[i].getWorldPosition(_v);
      this.world.burst([p.x, p.y, p.z], [0, 1, 0], 0xff4fd8, 30, 8);
      this.sound.play('explode', { pos: [p.x, p.y, p.z], vol: 1.2, ref: 20, roll: 0.5 });
    }
  }

  skyDie() { if (this.sky) { this.sky.dead = true; this.sound.play('sky_roar', { vol: 1, rate: 0.7 }); } }

  skyEnd() {
    if (!this.sky) return;
    this.root.remove(this.sky.g);
    this.sky = null;
  }

  // alive weak points as ray targets for sniper shots: [{ i, c, r }]
  skyTargets(now) {
    const s = this.sky;
    if (!s || s.dead) return null;
    const t = now - s.t0, tr = skyTransform(t);
    return s.hp.map((h, i) => (h > 0 ? { i, c: skyPoint(t, i, tr), r: SKY.pointR } : null)).filter(Boolean);
  }

  balloonTargets() {
    const out = [];
    for (const d of this.drops.values()) if (!d.landed && d.balloons.visible) out.push({ id: d.id, c: [d.x, d.y + 4.6, d.z], r: 1.4 });
    return out;
  }

  // ---------- per frame ----------
  update(dt, now, ctx) {
    this.t += dt;
    const bob = Math.sin(this.t * 2.2);
    for (const pk of this.pickups.values()) {
      pk.spin.rotation.y += dt * 1.6;
      pk.spin.position.y = 0.45 + Math.sin(this.t * 2 + pk.seed) * 0.07;
      const left = pk.expireAt - this.t;
      pk.g.visible = !(left > 0 && left < PICKUP_BLINK && Math.floor(this.t * 5) % 2 === 0);
    }
    for (const c of this.chests.values()) {
      c.glow.material.opacity = 0.55 + 0.35 * Math.sin(this.t * 3 + c.id);
      const d = Math.hypot(c.x - ctx.me[0], c.z - ctx.me[2]);
      if (d < 11 && this.t > c.chime) { c.chime = this.t + 2.4; this.sound.play('chest_chime', { pos: [c.x, 0.6, c.z], vol: 0.6, ref: 2 }); }
    }
    for (const d of this.drops.values()) {
      if (!d.landed) { d.y = Math.max(0, d.y - d.v * dt); d.g.position.y = d.y; d.g.rotation.y += dt * 0.4; for (const b of d.balloons.children) if (b.userData.base) b.position.y = b.userData.base.y + Math.sin(this.t * 2 + b.position.x) * 0.1; }
      else if (d.beam) d.beam.material.opacity = 0.16 + 0.08 * bob;
    }
    for (const d of this.defs.values()) {
      d.fx = Math.max(0, d.fx - dt * 3);
      if (d.type === 'spikes' && d.head) d.head.position.y = d.fx * 0.12 - 0.05;
      if ((d.type === 'turret' || d.type === 'rturret') && d.head && d.target) {
        const want = Math.atan2(-(d.target[0] - d.pos[0]), -(d.target[2] - d.pos[2]));
        d.head.rotation.y += Math.atan2(Math.sin(want - d.head.rotation.y), Math.cos(want - d.head.rotation.y)) * Math.min(1, dt * 10);
      }
      if (d.type === 'campfire') { d.flame.scale.set(1 + Math.sin(this.t * 13) * 0.08, 1 + Math.sin(this.t * 17) * 0.15, 1); d.light.material.opacity = 0.6 + Math.sin(this.t * 11) * 0.15; }
    }
    if (this.coreCannon) {
      const cc = this.coreCannon;
      cc.fx = Math.max(0, cc.fx - dt * 3);
      if (cc.target) {
        const want = Math.atan2(-(cc.target[0] - cc.pos[0]), -(cc.target[2] - cc.pos[2]));
        cc.head.rotation.y += Math.atan2(Math.sin(want - cc.head.rotation.y), Math.cos(want - cc.head.rotation.y)) * Math.min(1, dt * 10);
      }
    }
    for (const [id, t] of this.thrown) {
      t.vel[1] -= G_THROW * dt;
      for (let i = 0; i < 3; i++) t.pos[i] += t.vel[i] * dt;
      if (t.pos[1] < 0.1) { t.pos[1] = 0.1; t.vel = t.vel.map(v => v * 0.4); t.vel[1] = Math.abs(t.vel[1]); }
      t.g.position.set(...t.pos);
      if (this.t > 8 + (t.born ??= this.t)) { this.root.remove(t.g); this.thrown.delete(id); }
    }
    for (const [id, r] of this.rockets) {
      for (let i = 0; i < 3; i++) r.pos[i] += r.d[i] * 42 * dt;
      r.g.position.set(...r.pos);
      if ((r.puff -= dt) <= 0) { r.puff = 0.03; this.world.burst(r.pos, [0, 0.3, 0], 0x9a9a9a, 1, 0.5); }
      if (this.t > (r.born ??= this.t) + 5) { this.root.remove(r.g); this.rockets.delete(id); }
    }
    if (this.arcs) for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.t -= dt;
      a.line.material.opacity = Math.max(0, a.t / 0.18);
      if (a.t <= 0) { this.root.remove(a.line); a.line.geometry.dispose(); a.line.material.dispose(); this.arcs.splice(i, 1); }
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (this.t > f.until) { this.root.remove(f.disc); this.fires.splice(i, 1); continue; }
      f.disc.material.opacity = 0.25 + 0.12 * Math.sin(this.t * 9);
      if (this.t > f.next) { f.next = this.t + 0.12; const a = Math.random() * 6.28, rr = Math.random() * ITEMS.molotov.radius; this.world.burst([f.p[0] + Math.cos(a) * rr, f.p[1] + 0.1, f.p[2] + Math.sin(a) * rr], [0, 1, 0], Math.random() < 0.5 ? 0xff8a2a : 0xffc34d, 2, 2.5); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      f.s.material.opacity = Math.max(0, f.t * 4);
      if (f.ring) f.s.scale.set(f.ring * (1.4 - f.t), 1, f.ring * (1.4 - f.t));
      if (f.t <= 0) { this.root.remove(f.s); f.s.material.dispose(); this.flashes.splice(i, 1); }
    }
    this.updatePings();
    this.updateOrders();
    // survivors: 10 Hz states smoothed; carried ones ride on their carrier's shoulder
    for (const s of this.survivors.values()) {
      s.t = Math.min(1, s.t + dt * 10);
      const carrier = s.state === 1 && s.carrier ? (s.carrier === ctx.meId ? ctx.me : ctx.remotes.get(s.carrier)?.pos) : null;
      for (let i = 0; i < 3; i++) s.pos[i] = lerp(s.from[i], s.to[i], s.t);
      const g = s.model.group;
      s.model.update(dt);
      if (carrier) { g.position.set(carrier[0], carrier[1] + 1.25, carrier[2]); g.rotation.set(0, s.yaw, Math.PI / 2); }
      else { g.position.set(...s.pos); g.rotation.y = s.yaw; g.rotation.z = 0; }
      s.model.blob.position.set(s.pos[0], s.pos[1] + 0.02, s.pos[2]);
      s.model.blob.visible = !carrier;
      g.visible = !(carrier && s.carrier === ctx.meId); // don't block your own view
    }
    // the Colossus
    const k = this.sky;
    if (k) {
      const t = now - k.t0, tr = skyTransform(t);
      if (k.dead) {
        k.fall += dt;
        k.g.position.y -= dt * (4 + k.fall * 14);
        k.g.rotation.z += dt * 0.6;
        if (k.g.position.y < -10) { this.world.burst([k.g.position.x, 0.5, k.g.position.z], [0, 1, 0], 0x5d3f6e, 40, 9); this.skyEnd(); }
      } else {
        k.g.position.set(tr.x, tr.y, tr.z);
        k.g.rotation.set(0, tr.yaw, 0); // must match skyPoint() exactly: weak points are hit-tested there
        const flap = Math.sin(this.t * 2.4) * 0.5;
        k.wings[0].rotation.z = flap; k.wings[1].rotation.z = -flap;
        k.points.forEach((p, i) => {
          if (!p.visible) return;
          const hi = i === k.backIdx; // the last-standing back weak point: pulse brighter and bigger
          p.scale.setScalar((SKY.pointR / SKY.scale) * (1 + Math.sin(this.t * (hi ? 10 : 6)) * (hi ? 0.4 : 0.15)));
          if (p.userData.glow) p.userData.glow.scale.setScalar(((SKY.pointR * 3) / SKY.scale) * (hi ? 1.4 + Math.sin(this.t * 10) * 0.35 : 1));
        });
      }
    }
  }

  // ---------- map pings: a pulsing beam where a teammate clicked on the full map ----------
  pingMark(by, x, z, secs) {
    this.pings ??= new Map();
    this.clearPing(by);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const beam = this.mesh(this.cyl, 0xffe14d, g, [0, 9, 0], [0.09, 18, 0.09], { basic: true, transparent: true, opacity: 0.55, depthWrite: false });
    const ring = new THREE.Mesh(this.ring, new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.y = 0.06;
    g.add(ring);
    const top = this.sprite(0xffe14d, 1.6, g, [0, 18, 0]);
    this.root.add(g);
    this.pings.set(by, { g, beam, ring, top, until: this.t + secs, born: this.t });
  }

  clearPing(by) {
    const p = this.pings?.get(by);
    if (!p) return;
    this.root.remove(p.g);
    p.ring.material.dispose();
    p.top.material.dispose();
    this.pings.delete(by);
  }

  clearPings() { for (const by of [...(this.pings?.keys() ?? [])]) this.clearPing(by); }

  // ---------- survivor orders: a ground marker where you sent them, like a ping but green and local-only ----------
  orderMark(by, x, z, secs) {
    this.orders ??= new Map();
    this.clearOrder(by);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const beam = this.mesh(this.cyl, 0x5dff7a, g, [0, 6, 0], [0.07, 12, 0.07], { basic: true, transparent: true, opacity: 0.5, depthWrite: false });
    const ring = new THREE.Mesh(this.ring, new THREE.MeshBasicMaterial({ color: 0x5dff7a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.y = 0.06;
    g.add(ring);
    this.root.add(g);
    this.orders.set(by, { g, beam, ring, until: this.t + secs, born: this.t });
  }

  clearOrder(by) {
    const o = this.orders?.get(by);
    if (!o) return;
    this.root.remove(o.g);
    o.ring.material.dispose();
    this.orders.delete(by);
  }

  clearOrders() { for (const by of [...(this.orders?.keys() ?? [])]) this.clearOrder(by); }

  updateOrders() {
    if (!this.orders) return;
    for (const [by, o] of this.orders) {
      const left = o.until - this.t;
      if (left <= 0) { this.clearOrder(by); continue; }
      const k = ((this.t - o.born) * 1.2) % 1;
      o.ring.scale.setScalar(1 + k * 3);
      o.ring.material.opacity = (1 - k) * 0.9;
    }
  }

  updatePings() {
    if (!this.pings) return;
    for (const [by, p] of this.pings) {
      const left = p.until - this.t, a = Math.min(1, left / 1.5);
      if (left <= 0) { this.clearPing(by); continue; }
      const k = ((this.t - p.born) * 1.2) % 1;
      p.ring.scale.setScalar(1 + k * 4);
      p.ring.material.opacity = (1 - k) * 0.9 * a;
      p.top.material.opacity = a;
    }
  }

  // full world sync (join / new match): drop everything, the server re-sends what still exists
  clearAll() {
    this.clearPings();
    this.clearOrders();
    if (this.coreCannon) this.coreCannon.target = null;
    this.clearPickups();
    this.setDefs([]);
    this.setChests([]);
    for (const id of [...this.drops.keys()]) this.removeDrop(id);
    for (const m of [this.thrown, this.rockets]) { for (const o of m.values()) this.root.remove(o.g); m.clear(); }
    for (const f of this.fires) this.root.remove(f.disc);
    this.fires.length = 0;
    this.clearSurvivors();
    this.skyEnd();
    if (this.maw) { this.root.remove(this.maw.g); if (this.maw.warn) this.root.remove(this.maw.warn); this.maw = null; }
    this.setThumpers([]);
    if (this.smith) { this.root.remove(this.smith.g); this.scene.remove(this.smith.npc.group, this.smith.npc.blob); this.smith = null; }
    this.bankerGone();
    for (const L of this.lasers ?? []) this.root.remove(L.line, L.dot);
    this.lasers = [];
    for (const h of this.hazards ?? []) this.root.remove(h.disc);
    this.hazards = [];
    this.digs = [];
  }

  dispose() {
    if (this.smith) this.scene.remove(this.smith.npc.group, this.smith.npc.blob);
    this.bankerGone();
    this.clearSurvivors();
    this.scene.remove(this.root);
    this.glow.dispose();
    this.dollarTex.dispose();
    for (const m of this.mats.values()) m.dispose();
  }
}
