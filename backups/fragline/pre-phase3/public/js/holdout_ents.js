// Zombie Holdout world objects on the client: ground loot, RNG chests, balloon supply drops, placed traps
// and turrets, thrown grenades / molotov fires / freeze blasts, rockets, survivors and the Colossus.
// All of it is driven by server messages; this file only draws and animates.
import * as THREE from 'three';
import { RARITY, AMMO, ITEMS, SURVIVOR } from '/shared/holdout.js';
import { SKY, SKY_POINTS, SKY_LEAN, skyTransform, skyPoint } from '/shared/skyboss.js';
import { hitboxes } from '/shared/physics.js';
import { PlayerModel } from './models.js';

const G_THROW = 15, G_GLOB = 12;
const ITEM_COLOR = { grenade: 0x3f6b35, molotov: 0xe07a2e, freeze: 0x7fe9ff, bandage: 0xf2efe6, medkit: 0xe23c4a, shield_s: 0x5fb8ff, shield: 0x3d7dff, spikes: 0x8c9096, darts: 0x8c9096, flame: 0xd65a2a, turret: 0x6a7480, rturret: 0x6a7480, campfire: 0xc9772e };
const MAT_COLOR = { wood: 0xc9955a, stone: 0xa9a49b, metal: 0x8d9aa6 };
const lerp = (a, b, t) => a + (b - a) * t;
const _v = new THREE.Vector3();

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
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
  // [id, kind, key, rarity-or-count, x, y, z]
  addPickup([id, kind, key, rn, x, y, z]) {
    this.removePickup(id);
    const g = new THREE.Group(), spin = new THREE.Group();
    g.position.set(x, y, z);
    g.add(spin);
    let color = 0xffffff;
    if (kind === 'gun') {
      color = new THREE.Color(RARITY[rn]?.color ?? '#ffffff').getHex();
      this.mesh(this.box, 0x2b2f35, spin, [0, 0, 0], [0.12, 0.16, 0.9]);
      this.mesh(this.box, color, spin, [0, 0.09, -0.1], [0.13, 0.04, 0.5], { basic: true });
    } else if (kind === 'ammo') {
      color = new THREE.Color(AMMO[key]?.color ?? '#ffffff').getHex();
      this.mesh(this.box, color, spin, [0, 0, 0], [0.34, 0.22, 0.24]);
    } else if (kind === 'mats') {
      color = MAT_COLOR[key] ?? 0xffffff;
      for (let i = 0; i < 3; i++) this.mesh(this.box, color, spin, [0, i * 0.13 - 0.12, 0], [0.4, 0.12, 0.25]);
    } else if (kind === 'item') {
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
    this.pickups.set(id, { id, kind, key, n: rn, r: rn, pos: [x, y, z], g, spin, seed: Math.random() * 6 });
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
    const color = ITEM_COLOR[m.item] ?? 0xffffff;
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
    if (m.item === 'grenade' || m.item === 'rocket') {
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

  // ---------- survivors ----------
  svAdd(id, name) {
    if (this.survivors.has(id)) return;
    const model = new PlayerModel(this.scene, 0xe8892f);
    model.pose(0, 0, 'smg');
    this.survivors.set(id, { id, name, model, pos: [0, -50, 0], from: [0, -50, 0], to: [0, -50, 0], yaw: 0, t: 1, state: 0, hp: 1, tier: 0, carrier: '', ammo: 0 });
  }

  // [id, state (0 wounded, 1 carried, 2 active), x, y, z, yaw, hp01, tier, carrier, ammo]
  svState(list, shots, remotes, me) {
    const seen = new Set();
    for (const [id, state, x, y, z, yaw, hp, tier, carrier, ammo] of list) {
      const s = this.survivors.get(id);
      if (!s) continue;
      seen.add(id);
      s.from = [...s.pos]; s.to = [x, y, z]; s.t = 0;
      if (s.pos[1] < -40) s.from = [x, y, z];
      Object.assign(s, { yaw, hp, tier, carrier, ammo });
      if (state !== s.state) { s.state = state; s.model.setDead(state === 0); } // wounded ones lie on the ground
    }
    for (const [sid, ex, ey, ez] of shots || []) {
      const s = this.survivors.get(sid);
      if (!s || s.state !== 2) continue;
      const o = [s.pos[0], s.pos[1] + 1.4, s.pos[2]];
      this.world.tracer(o, [ex, ey, ez], 0xffd28a);
      if (Math.random() < 0.5) this.sound.play('shot_mac10', { pos: o, vol: 0.55, ref: 3, roll: 1.2 });
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
      this.sprite(0xff4fd8, (SKY.pointR * 3) / SKY.scale, p, [0, 0, 0]).scale.setScalar(3);
      return p;
    });
    this.root.add(g);
    this.sky = { g, body, wings, points, t0: now - m.el / 1000, hp: [...m.hp], max: m.max, dead: false, fall: 0 };
    this.sound.play('sky_roar', { vol: 0.9 });
  }

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
    for (const pk of this.pickups.values()) { pk.spin.rotation.y += dt * 1.6; pk.spin.position.y = 0.45 + Math.sin(this.t * 2 + pk.seed) * 0.07; }
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
      if (f.t <= 0) { this.root.remove(f.s); f.s.material.dispose(); this.flashes.splice(i, 1); }
    }
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
        for (const p of k.points) if (p.visible) p.scale.setScalar((SKY.pointR / SKY.scale) * (1 + Math.sin(this.t * 6) * 0.15));
      }
    }
  }

  // full world sync (join / new match): drop everything, the server re-sends what still exists
  clearAll() {
    this.clearPickups();
    this.setDefs([]);
    this.setChests([]);
    for (const id of [...this.drops.keys()]) this.removeDrop(id);
    for (const m of [this.thrown, this.rockets]) { for (const o of m.values()) this.root.remove(o.g); m.clear(); }
    for (const f of this.fires) this.root.remove(f.disc);
    this.fires.length = 0;
    this.clearSurvivors();
    this.skyEnd();
  }

  dispose() {
    this.clearSurvivors();
    this.scene.remove(this.root);
    this.glow.dispose();
    for (const m of this.mats.values()) m.dispose();
  }
}
