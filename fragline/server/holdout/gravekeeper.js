// The Gravekeeper: the 'grave' slot of the boss rotation (wave 20, then every time around, +50 % HP per cycle).
// A ~4.5 m undertaker (a boss zombie, ZTYPES.gravekeeper) with a bronze bell on his back: he walks for the Core
// smashing builds and sweeping his scythe, and opens grave pits around the fort — every bell toll each open pit
// raises two zombies. While any pit is open a spectral ward makes him immune; a player-built cone on a pit's
// ground tile seals it (its lid) while it stands, so his lantern and the pit zombies go for the lids. While he
// lives every ground spawn arrives by lightning: a telegraphed bolt, a slow rise out of the ground (stunned, but
// shootable) and an electrified floor patch that only hurts players. 60 % HP: two more pits; 30 %: the Death
// Knell, bolts striking around every player for 10 s. His drop is the Knell (knellPool below is its perk).
import { ZTYPES, bossCycle, composeWave, aliveCap } from '../../shared/zombies.js';
import { GRID, slotKey, checkPlacement, distToBox, boxCenter } from '../../shared/build.js';
import { MONEY_CAP } from '../../shared/holdout.js';
import { addHazard } from './behaviors.js';

const r2 = v => Math.round(v * 100) / 100;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const GRAVE = {
  pits: 4, maxPits: 7, extraPits: 2, pitMin: 12, pitMax: 24, pitGap: 7, // 4 + 1 per extra player (max 7); +2 at 60 %
  toll: 10000, perPit: 2,                 // every toll each open pit raises 2 zombies
  warn: 1000, rise: 2500,                 // bolt telegraph (ms), then the zombie rises out of the ground (ms)
  voltR: 2.5, voltLife: 4, voltDps: 12,   // the electrified floor a strike leaves: players and survivors only
  lantern: 15000, lanternMs: 1200, lanternSdmg: 560, lanternR: 2.5, lanternDmg: 20, // hurled at the nearest lid
  bell: 2,                                // hits from behind ring the bell (only lands once the ward is down)
  stage2: 0.6, stage3: 0.3, knell: 10000, knellEvery: 900, knellR: 3, // Death Knell: a bolt near every player
  lidChase: 30000,                        // how long a pit zombie keeps after lids before it gives up
  knock: 9, reward: 3000,                 // scythe knockback (m/s); cash for every player when he dies
};

export class Gravekeeper {
  constructor(room) { this.room = room; this.reset(); }

  reset() {
    this.state = null;           // { w, stage, dead, nextToll, nextLantern, knellUntil, nextKnell }
    this.z = null;               // the boss zombie
    this.pits = [];              // [{ id, i, k, x, z, key, lid }] lid: id of the cone sealing it, null while open
    this.ward = false;
    this.strikes = [];           // telegraphed bolts: [{ x, z, at }]
    this.lanterns = [];          // lanterns in flight: [{ sid, p, at }]
    this.risers = new Set();     // zombies still coming up out of the ground (z.rise)
    this.pitZombies = new Set(); // zombies raised by a pit: they go for the lids (z.lid)
    this.spot = null;            // where the next spawn rises (a pit) instead of its lane
  }

  busy() { return !!this.state && !this.state.dead; }
  // room.damageZombie / hitZombie (via bosses.immune): 'ward' also picks the hint text on the client
  immune(z) { return z === this.z && this.ward ? 'ward' : false; }

  start(w, now = Date.now()) {
    const room = this.room, n = room.activeCount();
    this.reset();
    this.state = { w, stage: 1, dead: false, nextToll: now + GRAVE.toll, nextLantern: now + GRAVE.lantern, knellUntil: 0, nextKnell: 0 };
    this.pits = this.pickPits(Math.min(GRAVE.maxPits, GRAVE.pits + n - 1));
    this.ward = this.pits.length > 0;
    const z = this.z = room.spawnZombie('gravekeeper', room.director.lanes[0] ?? 'N', '');
    z.maxHp = z.hp = Math.round(ZTYPES.gravekeeper.hp * (1 + 0.6 * (n - 1)) * (1 + 0.5 * bossCycle(w)));
    room.broadcast({ t: 'grave', ev: 'start', id: z.id, ward: this.ward, pits: this.pitList(), stage: 1 });
    room.broadcast({ t: 'task', text: 'THE GRAVEKEEPER is warded while any grave pit is open — seal every pit with a CONE, then shoot the bell on his back' });
  }

  // n more pits on open, buildable ground tiles 12–24 m from the Core (a level-0 cone must fit, so every pit can
  // be sealed), spread out: each goes in the middle of the widest gap between the pits so far, the first on an
  // attacking lane.
  pickPits(n) {
    const room = this.room, c = room.map.core, w = { ...room.placementWorld({ st: { p: [0, 0, 0] } }), eye: null, mats: null };
    const cands = [];
    for (let i = 0; i < GRID.cols; i++) for (let k = 0; k < GRID.rows; k++) {
      const x = GRID.x0 + (i + 0.5) * GRID.cell, z = GRID.z0 + (k + 0.5) * GRID.cell, d = Math.hypot(x - c.x, z - c.z);
      if (d < GRAVE.pitMin || d > GRAVE.pitMax || room.slots.has(`f:${i}:${k}:0`) || room.slots.has(`r:${i}:${k}:0`)) continue;
      if (!checkPlacement({ kind: 'cone', i, k, l: 0, mat: 'zink' }, w)) cands.push({ i, k, x, z, a: Math.atan2(z - c.z, x - c.x) });
    }
    const lane = room.map.lanes.find(l => l.id === room.director.lanes[0]) ?? room.map.lanes[0], out = [];
    for (let j = 0; j < n; j++) {
      const taken = [...this.pits, ...out], ok = cands.filter(q => taken.every(p => Math.hypot(p.x - q.x, p.z - q.z) >= GRAVE.pitGap));
      if (!ok.length) break;
      let target = Math.atan2((lane.zone[1] + lane.zone[3]) / 2 - c.z, (lane.zone[0] + lane.zone[2]) / 2 - c.x), gap = -1;
      const as = taken.map(p => Math.atan2(p.z - c.z, p.x - c.x)).sort((a, b) => a - b);
      as.forEach((a, m) => { const g = (m + 1 < as.length ? as[m + 1] : as[0] + 2 * Math.PI) - a; if (g > gap) { gap = g; target = a + g / 2; } });
      const off = q => Math.abs(wrap(q.a - target)), near = ok.filter(q => off(q) < 0.3);
      const q = near.length ? near[Math.floor(room.rng() * near.length)] : ok.reduce((b, o) => (off(o) < off(b) ? o : b));
      out.push({ id: this.pits.length + out.length, i: q.i, k: q.k, x: q.x, z: q.z, key: slotKey({ kind: 'cone', i: q.i, k: q.k, l: 0 }), lid: null });
    }
    return out;
  }

  pitList() { return this.pits.map(p => [p.id, r2(p.x), r2(p.z), p.lid ? 1 : 0]); }
  syncPits() { this.room.broadcast({ t: 'grave', ev: 'pits', l: this.pitList() }); }

  // a telegraphed lightning bolt: strikes (x, z) GRAVE.warn later and leaves an electrified floor patch
  bolt(x, z, now) {
    this.strikes.push({ x, z, at: now + GRAVE.warn });
    this.room.broadcast({ t: 'grave', ev: 'bolt', p: [r2(x), r2(z)], ms: GRAVE.warn });
  }

  // room.spawnZombie hook (before the spawn goes out): while he lives, every ground spawn waits underground under a
  // telegraphed bolt, then rises where it struck — stunned (no moving or attacking) but shootable the whole way up.
  arrive(zb) {
    if (!this.busy() || zb.t.flyer || zb.t.boss) return;
    const now = Date.now(), at = this.spot;
    this.spot = null;
    if (at) { zb.pos[0] = at.x; zb.pos[2] = at.z; zb.yaw = Math.atan2(at.x, at.z); }
    const depth = Math.min(3.5, 1.9 * zb.s + 0.2), t0 = now + GRAVE.warn;
    zb.pos[1] = -depth;
    zb.rise = { x: zb.pos[0], z: zb.pos[2], depth, t0 };
    zb.stunUntil = t0 + GRAVE.rise + 100; // one AI step past the rise, so it's set on the ground before it moves
    this.risers.add(zb);
    this.bolt(zb.pos[0], zb.pos[2], now);
  }

  rise(z, now) {
    const r = z.rise;
    if (z.dead || !r) { this.risers.delete(z); return; }
    const k = clamp((now - r.t0) / GRAVE.rise, 0, 1);
    z.pos[0] = r.x; z.pos[2] = r.z; z.pos[1] = -r.depth * (1 - k);
    z.vel[0] = z.vel[1] = z.vel[2] = 0;
    z.knock = null; // anchored: blasts and pulls don't drag it out of its grave
    if (k < 1) return;
    z.rise = null;
    this.risers.delete(z);
  }

  update(dt, now) {
    const room = this.room;
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      if (now < s.at) continue;
      this.strikes.splice(i, 1);
      addHazard(room, 'volt', [s.x, 0, s.z], GRAVE.voltR, GRAVE.voltLife, GRAVE.voltDps);
    }
    for (const z of this.risers) this.rise(z, now);
    const S = this.state, gk = this.z;
    if (!S || S.dead) return;
    if (gk.dead) return this.die();
    this.checkLids();
    const f = gk.hp / gk.maxHp;
    if (S.stage === 1 && f <= GRAVE.stage2) {
      S.stage = 2;
      this.pits.push(...this.pickPits(GRAVE.extraPits));
      room.broadcast({ t: 'grave', ev: 'stage', stage: 2 });
      this.checkLids(true); // fresh open pits: the ward is back
    }
    if (S.stage === 2 && f <= GRAVE.stage3) {
      S.stage = 3; S.knellUntil = now + GRAVE.knell; S.nextKnell = now;
      room.broadcast({ t: 'grave', ev: 'stage', stage: 3, ms: GRAVE.knell });
    }
    if (now < S.knellUntil && now >= S.nextKnell) {
      S.nextKnell = now + GRAVE.knellEvery;
      for (const p of room.players) {
        if (!p.alive || p.downed) continue;
        const a = room.rng() * Math.PI * 2, d = room.rng() * GRAVE.knellR;
        this.bolt(p.st.p[0] + Math.cos(a) * d, p.st.p[2] + Math.sin(a) * d, now);
      }
    }
    if (now >= S.nextToll) { S.nextToll = now + GRAVE.toll; this.toll(); }
    if (now >= S.nextLantern) this.throwLantern(now);
    const landed = this.lanterns.filter(L => now >= L.at);
    if (landed.length) this.lanterns = this.lanterns.filter(L => now < L.at);
    for (const L of landed) { // (a copy: its splash can wipe the squad, and endMatch resets all of this)
      const s = room.pieces.get(L.sid);
      if (s) room.damagePiece(s, GRAVE.lanternSdmg);
      for (const p of room.targets()) {
        if (p.alive && !p.downed && p.state !== 'carried' && Math.hypot(p.st.p[0] - L.p[0], p.st.p[2] - L.p[2]) <= GRAVE.lanternR) room.hurtPlayer(p, GRAVE.lanternDmg * room.director.dmgMul, { id: gk.id, pos: L.p, t: gk.t });
      }
      room.broadcast({ t: 'grave', ev: 'lboom', p: L.p.map(r2) });
    }
    for (const q of this.pitZombies) { // pit zombies keep after the nearest lid (ai.js seekLid) until they give up
      if (q.dead) { this.pitZombies.delete(q); continue; }
      if (q.rise || now > (q.lidUntil ?? Infinity)) continue;
      if (!q.lid && now >= (q.lidCheck || 0)) {
        q.lidCheck = now + 1000;
        const s = this.nearestLid(q.pos);
        if (s) { q.lid = s.id; q.lidUntil ??= now + GRAVE.lidChase; q.aggro = null; }
      }
      if (q.lid) q.aggroBlock = now + 400; // lids first, players later
    }
  }

  // lids are polled (one slot lookup per pit): a cone on the pit's ground tile seals it while it stands
  checkLids(force = false) {
    const room = this.room;
    let changed = force, reopened = false;
    for (const p of this.pits) {
      const sid = room.slots.get(p.key), lid = sid !== undefined && room.pieces.has(sid) ? sid : null;
      if (lid === p.lid) continue;
      if (p.lid && !lid) reopened = true;
      p.lid = lid;
      changed = true;
    }
    if (!changed) return;
    this.syncPits();
    const ward = this.pits.some(p => !p.lid);
    if (ward === this.ward) return;
    this.ward = ward;
    room.broadcast({ t: 'grave', ev: 'ward', on: ward, broke: reopened });
  }

  nearestLid(pos) {
    let best = null, bd = Infinity;
    for (const p of this.pits) {
      const s = p.lid && this.room.pieces.get(p.lid), d = Math.hypot(p.x - pos[0], p.z - pos[2]);
      if (s && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ai.js: a pit zombie's goal is its lid — smash it once in reach, else walk at it (ai.js breaks through builds
  // it gets stuck on). Both null: the lid is gone or it gave up, back to the normal path.
  seekLid(z, body) {
    const s = this.room.pieces.get(z.lid);
    if (!s || Date.now() > z.lidUntil) { z.lid = null; return { attack: null, goal: null }; }
    if (distToBox(body, s.box) <= z.t.reach + 0.3) return { attack: { kind: 's', ref: s }, goal: null };
    const c = boxCenter(s.box);
    return { attack: null, goal: [c[0], c[2]] };
  }

  // a zombie from this wave's pool that can climb out of a grave (no flyers, snipers or Brutes)
  pitType() {
    const room = this.room, id = composeWave(room.wave, room.director.n, 1, room.rng, 0.1)[0], t = ZTYPES[id];
    return t.flyer || t.sniper || id === 'brute' ? 'shambler' : id;
  }

  toll() {
    const room = this.room, cap = aliveCap(room.director.n), lane = room.director.lanes[0] ?? 'N';
    room.broadcast({ t: 'grave', ev: 'toll' });
    for (const p of this.pits) {
      if (p.lid) continue;
      for (let i = 0; i < GRAVE.perPit && room.zombies.size < cap; i++) {
        const a = room.rng() * Math.PI * 2, d = i ? 1.1 : 0.2;
        this.spot = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d };
        const q = room.spawnZombie(this.pitType(), lane);
        this.spot = null;
        this.pitZombies.add(q);
        if (room.director.berserk) room.director.makeBerserk(q, true); // time's up: worth nothing, like reinforcements
      }
    }
  }

  throwLantern(now) {
    const room = this.room, z = this.z, s = this.nearestLid(z.pos);
    if (!s) { this.state.nextLantern = now + 3000; return; }
    this.state.nextLantern = now + GRAVE.lantern;
    const c = boxCenter(s.box), a = [z.pos[0], z.pos[1] + 1.2 * z.s, z.pos[2]], b = [c[0], s.box.max[1], c[2]];
    this.lanterns.push({ sid: s.id, p: b, at: now + GRAVE.lanternMs });
    room.broadcast({ t: 'grave', ev: 'lantern', a: a.map(r2), b: b.map(r2), ms: GRAVE.lanternMs });
  }

  // ai.js strike hook: the scythe sweeps a wide arc in front. Players in it are hit and knocked back (Tanks never
  // are); builds in it take 40 %, the piece he swung at (or the Core) the full blow.
  sweep(z, a) {
    const room = this.room, t = z.t, mul = room.director.dmgMul * (z.dmgMul ?? 1), R = t.reach + 1;
    const f = [-Math.sin(z.yaw), -Math.cos(z.yaw)], cos = Math.cos(((t.sweep / 2) * Math.PI) / 180);
    const inArc = (x, zz) => { const dx = x - z.pos[0], dz = zz - z.pos[2], d = Math.hypot(dx, dz); return d <= R && (d < 0.6 || (dx * f[0] + dz * f[1]) / d >= cos); };
    for (const p of room.targets()) {
      const pp = p.st.p;
      if (!p.alive || p.downed || p.state === 'carried' || pp[1] - z.pos[1] > 3 || !inArc(pp[0], pp[2])) continue;
      if (room.barriers?.stop([z.pos[0], z.pos[1] + 1, z.pos[2]], [pp[0], pp[1] + 1, pp[2]], t.dmg * mul)) continue; // a Tank's barrier takes it
      room.hurtPlayer(p, t.dmg * mul, z);
      if (p.isSurvivor || p.cls === 'tank') continue;
      const dx = pp[0] - z.pos[0], dz = pp[2] - z.pos[2], d = Math.hypot(dx, dz) || 1;
      room.send(p, { t: 'grave', ev: 'knock', v: [r2((dx / d) * GRAVE.knock), 4.5, r2((dz / d) * GRAVE.knock)] });
    }
    for (const s of room.builds()) {
      const b = s.box;
      if (s === a.ref || b.min[1] > z.pos[1] + 3.5 || !inArc(clamp(z.pos[0], b.min[0], b.max[0]), clamp(z.pos[2], b.min[2], b.max[2]))) continue;
      room.damagePiece(s, t.sdmg * mul * 0.4, z);
    }
    if (a.kind === 'c') room.damageCore(t.sdmg * mul, z);
    else if (a.kind === 's' && room.pieces.get(a.ref.id) === a.ref) room.damagePiece(a.ref, t.sdmg * mul, z);
    room.broadcast({ t: 'grave', ev: 'sweep', id: z.id });
  }

  // room.hitZombie: shots from behind ring his bell
  bellMult(z, a) {
    const dx = a[0] - z.pos[0], dz = a[2] - z.pos[2], l = Math.hypot(dx, dz);
    return l > 0.1 && (dx * -Math.sin(z.yaw) + dz * -Math.cos(z.yaw)) / l < -0.3 ? GRAVE.bell : 1;
  }

  // the Knell (his drop, room.onShot): every pool.every-th hitting shot leaves a short shock pool, zombies only
  knellPool(p, at, w) {
    addHazard(this.room, 'shockz', [at[0], 0, at[2]], w.pool.r, w.pool.time, 0, 0, w.pool.dps, p).w = 'knell';
  }

  die() {
    const room = this.room, z = this.z;
    this.state.dead = true;
    for (const q of room.players) { q.money = Math.min(MONEY_CAP, q.money + GRAVE.reward); room.sendInv(q); }
    room.inventory.scatter([{ kind: 'gun', w: 'knell', r: 4, tier: 3, el: null }], [z.pos[0], 0, z.pos[2]], 2.4, true);
    room.broadcast({ t: 'msg', text: 'The Gravekeeper dropped the Knell!' });
    this.close();
    room.broadcast({ t: 'grave', ev: 'die', by: z.lastHitBy ?? null });
  }

  // his pits, bolts, lanterns and electrified floor go with him (zombies already rising finish coming up)
  close() {
    this.pits = [];
    this.ward = false;
    this.strikes = [];
    this.lanterns = [];
    for (const q of this.pitZombies) q.lid = null;
    this.pitZombies.clear();
    for (const h of this.room.hazards) if (h.kind === 'volt') h.until = 0; // expire, never splice: a wipe can land us here from inside updateHazards
  }

  // room.endMatch: the defense fell mid-fight
  end() {
    if (!this.state) return;
    this.close();
    this.reset();
    this.room.broadcast({ t: 'grave', ev: 'end' });
  }

  syncTo(p) {
    if (this.busy()) this.room.send(p, { t: 'grave', ev: 'start', id: this.z.id, ward: this.ward, pits: this.pitList(), stage: this.state.stage, sync: true });
  }
}
