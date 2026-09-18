// The horde on the client: binary snapshots interpolated 100 ms in the past on the server's clock
// (like remote players), every zombie body box in one InstancedMesh, glowing eyes in another, blob
// shadows in a third, and a procedural shamble / wind-up / strike / death animation.
// Hit targets use the same hitboxes as players, scaled per type — what you see is what you hit.
import * as THREE from 'three';
import { hitboxes } from '/shared/physics.js';
import { ZTYPES, ZTYPE_IDS, ZCLASSES, ZCLASS_IDS } from '/shared/zombies.js';

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
  stalker: { skin: [0x6b5a7a, 0x5f5070], shirt: [0x1e1a26], pants: 0x121016, eye: 0xc86bff },
  sniper: { skin: [0x7f9a6a], shirt: [0x4a5a3a, 0x55603f], pants: 0x3a4030, eye: 0xff3030, acc: 'rifle', accColor: 0x2b2f35 },
  bloater: { skin: [0x9fb35a], shirt: [0x6a7a2a], pants: 0x3a4020, eye: 0xffe36b, acc: 'belly', accColor: 0xc5d46a },
  hexer: { skin: [0x8a7fa0], shirt: [0x3a1f5a], pants: 0x2a1540, eye: 0xff4fd8, acc: 'hood', accColor: 0x2a1540 },
  burrower: { skin: [0x8a7a5a], shirt: [0x5a4a30], pants: 0x3a3020, eye: 0xffc36b },
  shield: { skin: [0x6f7f65], shirt: [0x2f3540], pants: 0x1f232b, eye: 0xff6b3d, acc: 'shield', accColor: 0x9aa4ad },
  pyro: { skin: [0x2a1a14], shirt: [0x3a1a10], pants: 0x1a0f0a, eye: 0xffa02a, hot: true },
  frost: { skin: [0xa8d8ff], shirt: [0x5a8ab0], pants: 0x2a4a6a, eye: 0x9ff2ff, aura: 0x7fd8ff },
  // wall breaker: dark iron plating with rivets, glowing orange fists (see paint()'s fist color) and eyes
  golem: { skin: [0x2b2f35], shirt: [0x3a3f46, 0x343841], pants: 0x22262c, eye: 0xff8a2a, fist: 0xff8a2a, helmet: 0x4a4f57 },
  // red veins/aura, a pulsing marker above its head (holdout.js updateTags) instead of a helmet/accessory
  seeker: { skin: [0x5a1414], shirt: [0x3a0f0f], pants: 0x220a0a, eye: 0xff3030, aura: 0xff3030 },
  titan: { skin: [0x4a3a3a], shirt: [0x3a2020], pants: 0x1f1515, eye: 0xff5a2a, sac: 0xff7a2a },
  rider: { skin: [0x7a9a5a, 0x6f8f52], shirt: [0x4a5a2a], pants: 0x2a3322, eye: 0x9dff3d, sac: 0x9dff3d },
  broodsniper: { skin: [0x7a9a5a, 0x6f8f52], shirt: [0x3a4a2a], pants: 0x2a3322, eye: 0xff3030, acc: 'rifle', accColor: 0x2b2f35 },
  // rendered separately (its own transparent materials, see spawnShade/poseShade) — these colors are unused
  shade: { skin: [0xcdf5ef], shirt: [0xcdf5ef], pants: 0xcdf5ef, eye: 0xffffff, ghost: true },
};
// zombie classes repaint the base look: plated tanks, blood-red frenzied ones, pale plague medics (+ a green aura)
const VARIANT = {
  tank: L => ({ ...L, shirt: [0x6d747c], helmet: L.helmet ?? 0x5a6068 }),
  assault: L => ({ ...L, shirt: [0x8a1f1f], eye: 0xff2a2a }),
  medic: L => ({ ...L, shirt: [0xdedede], eye: 0x5dff7a }),
};
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _root = new THREE.Matrix4(), _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4(), _s = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _one = new THREE.Vector3();
const _c = new THREE.Color(), _w = new THREE.Color(0xffffff);
const _burn = new THREE.Color(0xff6a1a), _soak = new THREE.Color(0x2f7fff), _chill = new THREE.Color(0xaef4ff), _ice = new THREE.Color(0xd8fbff), _mark = new THREE.Color(0xff2222);
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
    this.auras = inst(new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      color: 0x5dff7a, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }), MAX);
    this.boxGeo = box; // shared, reused (not disposed) for Shades — see spawnShade
    this.shades = new Map(); // Shades render outside the instanced meshes so each can fade independently
    this.offset = undefined;
    this.nextGroan = 0;
  }

  clock(now) { return this.offset === undefined ? now : now - this.offset; }

  // [id, typeIndex, maxHp, x, z, yaw, classIndex]
  spawn([id, ti, maxHp, x, z, yaw, ci = 0], now) {
    if (this.list.has(id)) this.remove(id);
    const type = ZTYPE_IDS[ti] || 'shambler', cls = ZCLASS_IDS[ci] || '', slot = this.free.pop();
    const look = VARIANT[cls] ? VARIANT[cls](LOOK[type] ?? LOOK.shambler) : LOOK[type] ?? LOOK.shambler;
    if (slot === undefined) return;
    const t = ZTYPES[type];
    const zb = {
      id, type, t, cls, s: t.scale * (ZCLASSES[cls]?.scale ?? 1), slot, maxHp, hp: 1, look,
      skin: look.skin[id % look.skin.length], shirt: look.shirt[(id >> 1) % look.shirt.length],
      snaps: [{ t: this.clock(now) - DELAY - 0.05, x, y: 0, z, yaw, st: 0, hp: 1 }],
      pos: [x, 0, z], yaw, st: 0, prevSt: 0, phase: Math.random() * 6.28, dead: false, deadT: 0, flash: 0,
      wobble: 0.6 + Math.random() * 0.5,
    };
    this.list.set(id, zb);
    if (type === 'shade') this.spawnShade(zb); else this.paint(zb);
  }

  // The Shade renders as its own tiny group with two dedicated (unshared) materials, so fading it by
  // distance or under Night Vision never touches the big instanced meshes every other zombie uses.
  spawnShade(zb) {
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0xcdf5ef, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const root = new THREE.Group();
    const put = (mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(this.boxGeo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); root.add(m); };
    put(bodyMat, 0.24, 0.86, 0.22, 0, 0.43, 0);   // legs
    put(bodyMat, 0.5, 0.7, 0.28, 0, 1.21, 0);     // torso
    put(bodyMat, 0.24, 0.26, 0.24, 0, 1.69, 0);   // head
    put(eyeMat, 0.045, 0.03, 0.02, -0.05, 1.7, -0.13);
    put(eyeMat, 0.045, 0.03, 0.02, 0.05, 1.7, -0.13);
    root.visible = false;
    this.scene.add(root);
    this.shades.set(zb.id, { root, bodyMat, eyeMat, seed: Math.random() * 10 });
  }

  removeShade(id) {
    const s = this.shades.get(id);
    if (!s) return;
    this.scene.remove(s.root);
    s.bodyMat.dispose();
    s.eyeMat.dispose();
    this.shades.delete(id);
  }

  paint(zb) {
    const L = zb.look, base = zb.slot * SLOTS;
    const cols = [L.pants, L.pants, zb.shirt, zb.shirt, zb.shirt, zb.shirt, L.fist ?? zb.skin, L.fist ?? zb.skin, zb.skin, L.helmet ?? L.sac ?? L.accColor ?? zb.skin, zb.skin];
    const k = zb.flash, fx = zb.fx || 0;
    // status tints: burning orange, soaked blue, chilled / frozen icy, marked red (Skybreaker)
    const tint = zb.st === 4 ? _ice : fx & 4 ? _chill : fx & 1 || L.hot ? _burn : fx & 2 ? _soak : fx & 32 ? _mark : null;
    // Snipers get a faint glow at night: brighter body and eyes so they're easier to spot from afar
    const glow = zb.type === 'sniper' || zb.type === 'broodsniper' ? Math.max(0, Math.min(1, ((zb.nightK ?? 0) - 0.3) / 0.7)) : 0;
    cols.forEach((c, i) => { _c.setHex(c); if (tint) _c.lerp(tint, zb.st === 4 ? 0.65 : 0.4); if (glow) _c.lerp(_w, glow * 0.3); this.body.setColorAt(base + i, _c.lerp(_w, k * 0.7)); });
    this.body.instanceColor.needsUpdate = true;
    for (let i = 0; i < 2; i++) { _c.setHex(L.eye); if (glow) _c.lerp(_w, glow * 0.6); this.eyes.setColorAt(zb.slot * 2 + i, _c); }
    this.eyes.instanceColor.needsUpdate = true;
    this.auras.setColorAt(zb.slot, _c.setHex(zb.cls === 'medic' ? 0x5dff7a : L.aura ?? 0x5dff7a));
    this.auras.instanceColor.needsUpdate = true;
  }

  snapshot(buf, now) {
    const v = new DataView(buf);
    if (v.getUint8(0) !== 1) return;
    const n = v.getUint16(2, true), ts = v.getFloat64(4, true) / 1000, lat = now - ts;
    this.offset = this.offset === undefined || lat < this.offset ? lat : this.offset + (lat - this.offset) * 0.02;
    for (let i = 0, o = 12; i < n; i++, o += 14) {
      const zb = this.list.get(v.getUint16(o, true));
      if (!zb || zb.dead) continue;
      const hp = v.getUint8(o + 11) / 255, fx = v.getUint8(o + 12);
      if (hp < zb.hp - 0.001) zb.flash = 1;
      zb.hp = hp;
      if (fx !== zb.fx) { zb.fx = fx; this.paint(zb); }
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
    this.removeShade(id);
    const base = zb.slot * SLOTS;
    for (let i = 0; i < SLOTS; i++) this.body.setMatrixAt(base + i, ZERO);
    for (let i = 0; i < 2; i++) this.eyes.setMatrixAt(zb.slot * 2 + i, ZERO);
    this.blobs.setMatrixAt(zb.slot, ZERO);
    this.auras.setMatrixAt(zb.slot, ZERO);
    this.body.instanceMatrix.needsUpdate = this.eyes.instanceMatrix.needsUpdate = this.blobs.instanceMatrix.needsUpdate = this.auras.instanceMatrix.needsUpdate = true;
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

  // ctx: { pos, nightK, nvK } of the local player — only the Shade's pose needs it (see poseShade).
  update(dt, now, ctx) {
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
          if (st === 4 || zb.st === 4) { zb.st = st; if (zb.type !== 'shade') this.paint(zb); } // frozen solid / thawed
          zb.prevSt = zb.st; zb.st = st; zb.stT = 0;
          if (st === 1) this.onEvent('wind', zb);
          else if (st === 3) this.onEvent('lob', zb);
          else if (st === 2 && zb.prevSt === 1) this.onEvent('strike', zb);
        }
        zb.stT = (zb.stT || 0) + dt;
        while (s.length > 2 && s[1].t < rt - 0.5) s.shift();
      }
      if (zb.flash > 0) { zb.flash = Math.max(0, zb.flash - dt * 9); if (zb.type !== 'shade') this.paint(zb); }
      if ((zb.type === 'sniper' || zb.type === 'broodsniper') && Math.abs((ctx?.nightK ?? 0) - (zb.nightK ?? 0)) > 0.03) { zb.nightK = ctx?.nightK ?? 0; this.paint(zb); }
      if (zb.type === 'shade') this.poseShade(zb, dt, ctx); else this.pose(zb, dt);
    }
    this.body.instanceMatrix.needsUpdate = this.eyes.instanceMatrix.needsUpdate = this.blobs.instanceMatrix.needsUpdate = this.auras.instanceMatrix.needsUpdate = true;
  }

  // Visible up close at night (fades out 5–7 m), hidden under Night Vision, always shown in daylight (it
  // should never spawn there, but this keeps it honest if it somehow does). Ease in/out to stop it popping.
  poseShade(zb, dt, ctx) {
    const s = this.shades.get(zb.id);
    if (!s) return;
    zb.phase += dt * 1.6;
    const d = ctx?.pos ? Math.hypot(zb.pos[0] - ctx.pos[0], zb.pos[2] - ctx.pos[2]) : 99;
    const daylight = !ctx || (ctx.nightK ?? 0) < 0.3;
    const near = daylight ? 1 : d <= 5 ? 1 : d >= 7 ? 0 : 1 - (d - 5) / 2;
    const target = near * (1 - (ctx?.nvK ?? 0));
    zb.vis = zb.vis === undefined ? target : zb.vis + (target - zb.vis) * Math.min(1, dt * 6);
    const flicker = 0.82 + 0.18 * Math.sin(zb.phase * 9 + s.seed);
    const fade = zb.dead ? Math.min(1, zb.deadT / 2.2) : 0;
    const op = Math.max(0, zb.vis * 0.75 * flicker * (1 - fade));
    s.root.visible = op > 0.004;
    s.bodyMat.opacity = op;
    s.bodyMat.color.setHex(0xcdf5ef).lerp(_w, zb.flash * 0.7);
    s.eyeMat.opacity = zb.vis > 0.04 ? Math.min(1, zb.vis * 1.3) * flicker * (1 - fade) : 0;
    s.root.position.set(zb.pos[0], zb.pos[1], zb.pos[2]);
    s.root.rotation.y = zb.yaw;
    s.root.scale.setScalar(zb.s);
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
    else if (L.acc === 'rifle') M.setMatrixAt(base + 9, part(_m, _root, 0.12, shoulderY, 0, zb.st === 3 ? 1.45 : 0.4, 0.12, shoulderY - 0.05, -0.35, 0.06, 0.08, 0.95));
    else if (L.acc === 'belly') M.setMatrixAt(base + 9, part(_m, _root, 0, 0, 0, 0, 0, hb[2].c[1] + 0.12, -0.12, 0.6, 0.56, 0.5));
    else if (L.acc === 'hood') M.setMatrixAt(base + 9, part(_m, _root, 0, neckY, 0, nod, 0, hd.c[1] + hd.h[1] * 0.3, hd.c[2] + 0.02, hd.h[0] * 2.6, hd.h[1] * 2.4, hd.h[2] * 2.6));
    else if (L.acc === 'shield') { // riot shield: up in front, or swung aside while knocked off balance
      const up = (zb.fx || 0) & 16;
      M.setMatrixAt(base + 9, part(_m, _root, -0.2, shoulderY, 0, up ? 0 : 1.2, up ? 0 : -0.35, up ? hb[3].c[1] : hb[3].c[1] - 0.2, up ? -0.42 : -0.1, 0.85, 1.25, 0.07));
    } else M.setMatrixAt(base + 9, ZERO);
    // hanging jaw (drops open on the wind-up)
    const jaw = zb.st === 1 || zb.st === 3 ? 0.07 : 0.02 + Math.sin(ph * 1.3) * 0.012;
    M.setMatrixAt(base + 10, part(_m, _root, 0, neckY, 0, nod, 0, neckY + 0.03 - jaw, hd.c[2] - hd.h[2] - 0.004, hd.h[0] * 1.5, 0.05, 0.05));
    for (let i = 0; i < 2; i++) {
      this.eyes.setMatrixAt(zb.slot * 2 + i, part(_m, _root, 0, neckY, 0, nod, (i ? 0.05 : -0.05), hd.c[1] + 0.04, hd.c[2] - hd.h[2] - 0.006, 0.05, 0.03, 0.02));
    }
    const bs = zb.dead ? Math.max(0, 1 - zb.deadT / 2) : 1;
    this.blobs.setMatrixAt(zb.slot, _m.compose(_v.set(x, 0.02, z), _q.identity(), _one.set(sc * bs, 1, sc * bs)));
    if ((zb.cls === 'medic' || L.aura) && !zb.dead) { // healing (medic) or freezing (frost) aura pulses out to its reach
      const r = (zb.cls === 'medic' ? ZCLASSES.medic.radius : zb.t.chillAura ?? 5) * (0.35 + 0.65 * ((ph * 0.35) % 1));
      this.auras.setMatrixAt(zb.slot, _m.compose(_v.set(x, Math.max(0, y) + 0.05, z), _q.identity(), _one.set(r, 1, r)));
    } else this.auras.setMatrixAt(zb.slot, ZERO);
  }

  dispose() {
    this.clear();
    for (const m of [this.body, this.eyes, this.blobs, this.auras]) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  }
}
