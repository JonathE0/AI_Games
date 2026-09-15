// The horde on the client: binary snapshots interpolated 100 ms in the past on the server's clock
// (like remote players), every zombie body box in one InstancedMesh, glowing eyes in another, blob
// shadows in a third, and a procedural shamble / wind-up / strike / death animation.
// Hit targets use the same hitboxes as players, scaled per type — what you see is what you hit.
import * as THREE from 'three';
import { hitboxes } from '/shared/physics.js';
import { ZTYPES, ZTYPE_IDS } from '/shared/zombies.js';

const MAX = 160;               // zombies drawn at once (the server caps the living horde at 90)
const SLOTS = 11;              // body boxes per zombie: 9 hitbox parts + helmet/sac + jaw
const DELAY = 0.1;
const HB = hitboxes(0);        // legL, legR, stomach, chest, armL, armR, foreL, foreR, head
const LOOK = {
  shambler: { skin: [0x7f9a6a, 0x8aa074, 0x74906a], shirt: [0x5b4a3a, 0x3f5566, 0x6a3b3b, 0x4d5a3a], pants: 0x2f3440, eye: 0xffe36b },
  runner: { skin: [0x9aa88a, 0xa3ad92], shirt: [0x7a7a7a, 0x8a5a3a, 0x445f7a], pants: 0x3a3a44, eye: 0xff7b3d },
  spitter: { skin: [0x6fa05a], shirt: [0x3a4a2a], pants: 0x2a3322, eye: 0x9dff3d, sac: 0x9dff3d },
  brute: { skin: [0x5f6f55], shirt: [0x3a3030], pants: 0x222228, eye: 0xff3b2e, helmet: 0x6d747c },
  alpha: { skin: [0x4a3f3f], shirt: [0x5a1a1a], pants: 0x1a1a1f, eye: 0xff2222, helmet: 0x3a3f46 },
};
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _root = new THREE.Matrix4(), _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4(), _s = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _one = new THREE.Vector3();
const _c = new THREE.Color(), _w = new THREE.Color(0xffffff);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// out = root · T(pivot) · Rx(angle) · T(center − pivot) · S(size)
function part(out, root, px, py, pz, angle, cx, cy, cz, sx, sy, sz) {
  out.copy(root).multiply(_t.makeTranslation(px, py, pz));
  if (angle) out.multiply(_r.makeRotationX(angle));
  return out.multiply(_t.makeTranslation(cx - px, cy - py, cz - pz)).multiply(_s.makeScale(sx, sy, sz));
}

export class ZombieView {
  // onEvent(kind, zombie): 'wind' | 'strike' | 'lob' (for sounds)
  constructor(scene, onEvent = () => {}) {
    this.scene = scene;
    this.onEvent = onEvent;
    this.list = new Map();
    this.free = Array.from({ length: MAX }, (_, i) => MAX - 1 - i);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const inst = (geo, mat, n) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      for (let i = 0; i < n; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, _w); }
      scene.add(m);
      return m;
    };
    this.body = inst(box, new THREE.MeshLambertMaterial(), MAX * SLOTS);
    this.eyes = inst(box, new THREE.MeshBasicMaterial(), MAX * 2);
    this.blobs = inst(new THREE.CircleGeometry(0.45, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }), MAX);
    this.offset = undefined;
    this.nextGroan = 0;
  }

  clock(now) { return this.offset === undefined ? now : now - this.offset; }

  // [id, typeIndex, maxHp, x, z, yaw]
  spawn([id, ti, maxHp, x, z, yaw], now) {
    if (this.list.has(id)) this.remove(id);
    const type = ZTYPE_IDS[ti] || 'shambler', look = LOOK[type], slot = this.free.pop();
    if (slot === undefined) return;
    const t = ZTYPES[type];
    const zb = {
      id, type, t, s: t.scale, slot, maxHp, hp: 1, look,
      skin: look.skin[id % look.skin.length], shirt: look.shirt[(id >> 1) % look.shirt.length],
      snaps: [{ t: this.clock(now) - DELAY - 0.05, x, y: 0, z, yaw, st: 0, hp: 1 }],
      pos: [x, 0, z], yaw, st: 0, prevSt: 0, phase: Math.random() * 6.28, dead: false, deadT: 0, flash: 0,
      wobble: 0.6 + Math.random() * 0.5,
    };
    this.list.set(id, zb);
    this.paint(zb);
  }

  paint(zb) {
    const L = zb.look, base = zb.slot * SLOTS;
    const cols = [L.pants, L.pants, zb.shirt, zb.shirt, zb.shirt, zb.shirt, zb.skin, zb.skin, zb.skin, L.helmet ?? L.sac ?? zb.skin, zb.skin];
    const k = zb.flash;
    cols.forEach((c, i) => this.body.setColorAt(base + i, _c.setHex(c).lerp(_w, k * 0.7)));
    this.body.instanceColor.needsUpdate = true;
    for (let i = 0; i < 2; i++) this.eyes.setColorAt(zb.slot * 2 + i, _c.setHex(L.eye));
    this.eyes.instanceColor.needsUpdate = true;
  }

  snapshot(buf, now) {
    const v = new DataView(buf);
    if (v.getUint8(0) !== 1) return;
    const n = v.getUint16(2, true), ts = v.getFloat64(4, true) / 1000, lat = now - ts;
    this.offset = this.offset === undefined || lat < this.offset ? lat : this.offset + (lat - this.offset) * 0.02;
    for (let i = 0, o = 12; i < n; i++, o += 12) {
      const zb = this.list.get(v.getUint16(o, true));
      if (!zb || zb.dead) continue;
      const hp = v.getUint8(o + 11) / 255;
      if (hp < zb.hp - 0.001) zb.flash = 1;
      zb.hp = hp;
      zb.snaps.push({ t: ts, x: v.getInt16(o + 2, true) / 100, y: v.getInt16(o + 4, true) / 100, z: v.getInt16(o + 6, true) / 100, yaw: v.getInt16(o + 8, true) / 10000, st: v.getUint8(o + 10), hp });
      if (zb.snaps.length > 30) zb.snaps.shift();
    }
  }

  die(id, dir) {
    const zb = this.list.get(id);
    if (!zb || zb.dead) return null;
    zb.dead = true;
    zb.deadT = 0;
    zb.fallDir = dir && Math.cos(wrap(Math.atan2(-dir[0], -dir[2]) - zb.yaw)) > 0 ? -1 : 1; // fall away from the shot
    return zb;
  }

  remove(id) {
    const zb = this.list.get(id);
    if (!zb) return;
    const base = zb.slot * SLOTS;
    for (let i = 0; i < SLOTS; i++) this.body.setMatrixAt(base + i, ZERO);
    for (let i = 0; i < 2; i++) this.eyes.setMatrixAt(zb.slot * 2 + i, ZERO);
    this.blobs.setMatrixAt(zb.slot, ZERO);
    this.body.instanceMatrix.needsUpdate = this.eyes.instanceMatrix.needsUpdate = this.blobs.instanceMatrix.needsUpdate = true;
    this.free.push(zb.slot);
    this.list.delete(id);
  }

  clear() { for (const id of [...this.list.keys()]) this.remove(id); }

  // Alive zombies as bullet targets (the positions you are looking at).
  targets() {
    const out = [];
    for (const zb of this.list.values()) if (!zb.dead) out.push({ id: zb.id, x: zb.pos[0], y: zb.pos[1], z: zb.pos[2], yaw: zb.yaw, c: 0, s: zb.s });
    return out;
  }

  // Bodies near (x, z) as collision boxes, so the horde physically blocks you.
  boxesNear(x, z, r, out) {
    for (const zb of this.list.values()) {
      if (zb.dead || Math.abs(zb.pos[0] - x) > r || Math.abs(zb.pos[2] - z) > r) continue;
      const h = 0.28 * zb.s;
      out.push({ min: [zb.pos[0] - h, zb.pos[1], zb.pos[2] - h], max: [zb.pos[0] + h, zb.pos[1] + 1.7 * zb.s, zb.pos[2] + h], mat: 'p' });
    }
    return out;
  }

  update(dt, now) {
    const rt = this.clock(now) - DELAY;
    for (const zb of [...this.list.values()]) {
      if (zb.dead) {
        zb.deadT += dt;
        if (zb.deadT > 2.4) { this.remove(zb.id); continue; }
      } else {
        const s = zb.snaps;
        let a = s[0], b = s[0];
        for (let i = s.length - 1; i >= 0; i--) if (s[i].t <= rt) { a = s[i]; b = s[i + 1] || s[i]; break; }
        const k = b === a ? 0 : Math.min(1, (rt - a.t) / Math.max(1e-3, b.t - a.t));
        const px = zb.pos[0], pz = zb.pos[2];
        zb.pos[0] = a.x + (b.x - a.x) * k; zb.pos[1] = a.y + (b.y - a.y) * k; zb.pos[2] = a.z + (b.z - a.z) * k;
        zb.yaw = a.yaw + wrap(b.yaw - a.yaw) * k;
        zb.speed = dt > 0 ? Math.hypot(zb.pos[0] - px, zb.pos[2] - pz) / dt : 0;
        const st = b.st;
        if (st !== zb.st) {
          zb.prevSt = zb.st; zb.st = st; zb.stT = 0;
          if (st === 1) this.onEvent('wind', zb);
          else if (st === 3) this.onEvent('lob', zb);
          else if (st === 2 && zb.prevSt === 1) this.onEvent('strike', zb);
        }
        zb.stT = (zb.stT || 0) + dt;
        while (s.length > 2 && s[1].t < rt - 0.5) s.shift();
      }
      if (zb.flash > 0) { zb.flash = Math.max(0, zb.flash - dt * 9); this.paint(zb); }
      this.pose(zb, dt);
    }
    this.body.instanceMatrix.needsUpdate = this.eyes.instanceMatrix.needsUpdate = this.blobs.instanceMatrix.needsUpdate = true;
  }

  pose(zb, dt) {
    const sc = zb.s, [x, y, z] = zb.pos;
    const moving = !zb.dead && zb.st === 0 && zb.speed > 0.3;
    zb.phase += dt * (moving ? 2.2 + zb.speed * 1.6 : 0.8);
    const ph = zb.phase, sw = moving ? Math.sin(ph) : 0;
    let fall = 0, sink = 0;
    if (zb.dead) {
      const f = Math.min(1, zb.deadT / 0.55);
      fall = (1 - (1 - f) ** 3) * (Math.PI / 2 - 0.08) * zb.fallDir;
      sink = Math.max(0, zb.deadT - 1.2) * 0.8;
    }
    const lean = zb.dead ? 0 : 0.18 + (zb.type === 'runner' ? 0.2 : 0) + Math.sin(ph * 0.5) * 0.04;
    // +X rotation tips the top backward (models face −Z), so leaning forward is negative
    _e.set(fall - lean, zb.yaw + Math.sin(ph * 0.5) * 0.06 * zb.wobble, Math.sin(ph * 0.5) * 0.05 * zb.wobble, 'YXZ');
    _root.compose(_v.set(x, y - sink, z), _q.setFromEuler(_e), _one.set(sc, sc, sc));
    // arms: bob while walking, rise during the wind-up, slam down on the strike
    let arm = Math.sin(ph * 0.5 + 1) * 0.12;
    if (!zb.dead && zb.st === 1) arm = Math.min(1, zb.stT / Math.max(0.2, zb.t.windup)) * 1.2;
    else if (!zb.dead && zb.st === 2) arm = -0.55;
    else if (!zb.dead && zb.st === 3) arm = 0.9;
    const base = zb.slot * SLOTS, M = this.body;
    const hb = HB, legH = hb[0].c[1] * 2;
    for (let i = 0; i < 2; i++) { // legs swing from the hip
      const h = hb[i];
      M.setMatrixAt(base + i, part(_m, _root, h.c[0], legH, 0, (i ? -sw : sw) * 0.55, h.c[0], h.c[1], h.c[2], h.h[0] * 2, h.h[1] * 2, h.h[2] * 2));
    }
    for (const i of [2, 3]) { const h = hb[i]; M.setMatrixAt(base + i, part(_m, _root, 0, 0, 0, 0, h.c[0], h.c[1], h.c[2], h.h[0] * 2, h.h[1] * 2, h.h[2] * 2)); }
    const shoulderY = hb[4].c[1] + hb[4].h[1];
    for (const i of [4, 5, 6, 7]) { // whole arm pivots at the shoulder
      const h = hb[i], a = arm + (i % 2 ? 0.08 : -0.08) * Math.sin(ph);
      M.setMatrixAt(base + i, part(_m, _root, h.c[0], shoulderY, 0, a, h.c[0], h.c[1], h.c[2], h.h[0] * 2, h.h[1] * 2, h.h[2] * 2));
    }
    const hd = hb[8], nod = Math.sin(ph * 0.7) * 0.12 - (zb.st === 1 ? 0.2 : 0);
    const neckY = hd.c[1] - hd.h[1];
    M.setMatrixAt(base + 8, part(_m, _root, 0, neckY, 0, nod, hd.c[0], hd.c[1], hd.c[2], hd.h[0] * 2, hd.h[1] * 2, hd.h[2] * 2));
    const L = zb.look;
    if (L.helmet) M.setMatrixAt(base + 9, part(_m, _root, 0, neckY, 0, nod, 0, hd.c[1] + hd.h[1] * 0.45, hd.c[2], hd.h[0] * 2.5, hd.h[1] * 1.1, hd.h[2] * 2.4));
    else if (L.sac) M.setMatrixAt(base + 9, part(_m, _root, 0, 0, 0, 0, 0, hb[2].c[1] + 0.1, 0.2, 0.34, 0.36, 0.22));
    else M.setMatrixAt(base + 9, ZERO);
    // hanging jaw (drops open on the wind-up)
    const jaw = zb.st === 1 || zb.st === 3 ? 0.07 : 0.02 + Math.sin(ph * 1.3) * 0.012;
    M.setMatrixAt(base + 10, part(_m, _root, 0, neckY, 0, nod, 0, neckY + 0.03 - jaw, hd.c[2] - hd.h[2] - 0.004, hd.h[0] * 1.5, 0.05, 0.05));
    for (let i = 0; i < 2; i++) {
      this.eyes.setMatrixAt(zb.slot * 2 + i, part(_m, _root, 0, neckY, 0, nod, (i ? 0.05 : -0.05), hd.c[1] + 0.04, hd.c[2] - hd.h[2] - 0.006, 0.05, 0.03, 0.02));
    }
    const bs = zb.dead ? Math.max(0, 1 - zb.deadT / 2) : 1;
    this.blobs.setMatrixAt(zb.slot, _m.compose(_v.set(x, 0.02, z), _q.identity(), _one.set(sc * bs, 1, sc * bs)));
  }

  dispose() {
    this.clear();
    for (const m of [this.body, this.eyes, this.blobs]) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  }
}
