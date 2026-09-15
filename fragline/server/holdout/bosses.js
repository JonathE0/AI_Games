// Boss waves after the Colossus (skyboss.js):
//  - wave 10 (25, 40…): the Brood Titan. Announced at the wave start, it arrives once the regular horde is
//    cleared: a giant that stomps builds flat, carrying riders that throw acid and can't be hurt until they
//    leap off (every ~18 s) or the Titan dies. Killing it unlocks the Blacksmith.
//  - wave 15 (30, 45…): the Maw. A colossal worm that hunts underground and erupts under builds and players.
//    Seismic thumpers in the houses lure it up with its mouth open (its gullet takes triple damage); below
//    60 % it spews swoopers, below 25 % it tries to devour the Core unless the team interrupts it.
import { ZTYPES, bossFor, bossCycle } from '../../shared/zombies.js';
import { THUMPER_SPOTS } from '../../shared/outpost.js';
import { rollLoot, MONEY_CAP } from '../../shared/holdout.js';
import { raySphere } from '../../shared/skyboss.js';
import { distToBox } from '../../shared/build.js';
import { addHazard } from './behaviors.js';

const r2 = v => Math.round(v * 100) / 100;
export const MAW = {
  hp: 12000, speed: 6.5, eruptR: 4.2, eruptDmg: 35, eruptSdmg: 900, warn: 1500, lure: 10000, thumpHold: 5000, pulse: 20000,
  gulletR: 1.6, gulletY: 7.5, bodyR: 3.6, devourWind: 12000, devourDmg: 0.4, devourBreak: 0.08, coreR: 5,
};
const RIDER_SEATS = [[-0.35, 0.18], [0.35, 0.18], [0, 0.36], [-0.3, -0.05], [0.3, -0.05], [0, 0.05], [-0.2, 0.3], [0.2, 0.3]];

export class Bosses {
  constructor(room) { this.room = room; this.reset(); }

  reset() {
    this.titan = null;        // { phase: 'waiting' | 'coming' | 'fighting', z, at }
    this.maw = null;
    this.thumpers = [];
    this.smith = false;       // the Blacksmith unlocks when the first Titan falls
  }

  // wave director asks: may the wave end?
  busy() { return !!(this.titan && this.titan.phase !== 'dead') || !!(this.maw && !this.maw.dead); }

  onWave(w, now = Date.now()) {
    const room = this.room, boss = bossFor(w);
    if (boss === 'titan') {
      this.titan = { phase: 'waiting', w, at: 0, z: null };
      room.broadcast({ t: 'task', text: 'THE BROOD TITAN is coming once this wave is cleared — build strong, save rockets' });
    } else if (boss === 'maw') this.startMaw(w, now);
  }

  update(dt, now) {
    const room = this.room;
    if (room.phase !== 'wave') return;
    if (this.titan) this.updateTitan(dt, now);
    if (this.maw && !this.maw.dead) this.updateMaw(dt, now);
    this.updateThumpers(now);
  }

  // ---------- Brood Titan ----------
  updateTitan(dt, now) {
    const room = this.room, T = this.titan;
    if (T.phase === 'waiting') {
      const horde = room.director.remaining + [...room.zombies.values()].filter(z => !z.t.boss).length;
      if (horde === 0) { T.phase = 'coming'; T.at = now + 5000; room.broadcast({ t: 'boss', ev: 'titanwarn', ms: 5000 }); }
    } else if (T.phase === 'coming' && now >= T.at) {
      T.phase = 'fighting';
      const lane = room.director.lanes[0] ?? 'N';
      const z = room.spawnZombie('titan', lane, '');
      z.maxHp = z.hp = Math.round(ZTYPES.titan.hp * (1 + 0.6 * (room.activeCount() - 1)) * (1 + 0.5 * bossCycle(T.w)));
      T.z = z;
      T.nextDrop = now + 18000;
      z.riders = [];
      const n = Math.min(RIDER_SEATS.length, 4 + room.activeCount());
      for (let i = 0; i < n; i++) {
        const r = room.spawnZombie('rider', lane, '');
        r.mount = z.id; r.seat = RIDER_SEATS[i]; r.nextAtk = now + 3000 + i * 500;
        z.riders.push(r);
      }
      room.broadcast({ t: 'boss', ev: 'titan', id: z.id, riders: z.riders.map(r => r.id) });
    } else if (T.phase === 'fighting') {
      const z = T.z;
      if (z.dead) {
        T.phase = 'dead';
        this.smith = true;
        for (const r of z.riders) if (!r.dead && r.mount) this.dismount(r, now, true);
        room.broadcast({ t: 'boss', ev: 'titandie', by: z.lastHitBy ?? null });
        room.onSmithUnlocked?.();
        return;
      }
      if (now >= T.nextDrop) { // one or two riders leap down to fight
        T.nextDrop = now + 18000;
        const mounted = z.riders.filter(r => !r.dead && r.mount);
        for (const r of mounted.slice(0, 1 + (Math.random() < 0.5 ? 1 : 0))) this.dismount(r, now, false);
      }
    }
  }

  dismount(r, now, stunned) {
    const t = this.room.zombies.get(r.mount);
    r.mount = null;
    r.pos[1] = Math.max(0, r.pos[1]);
    if (t) { r.pos[0] += (Math.random() - 0.5) * 4; r.pos[2] += (Math.random() - 0.5) * 4; }
    r.vel = [0, 4, 0];
    if (stunned) r.frozenUntil = now + 2000;
    this.room.broadcast({ t: 'boss', ev: 'leap', id: r.id });
  }

  // mounted riders ride on the Titan's back and lob acid (ai.js calls this instead of walking)
  stepRider(z, dt, now) {
    const room = this.room, t = room.zombies.get(z.mount);
    if (!t || t.dead) { this.dismount(z, now, true); return; }
    const s = t.s, c = Math.cos(t.yaw), sn = Math.sin(t.yaw), [ox, oz] = z.seat;
    z.pos[0] = t.pos[0] + (ox * c + oz * sn) * s * 1.1;
    z.pos[2] = t.pos[2] + (-ox * sn + oz * c) * s * 1.1;
    z.pos[1] = t.pos[1] + 1.45 * s;
    z.yaw = t.yaw;
    z.vel = [0, 0, 0];
    if (now < z.nextAtk) return;
    let best = null, bd = 26;
    for (const p of room.targets()) {
      if (!p.alive || p.downed || p.state === 'carried') continue;
      const d = Math.hypot(p.st.p[0] - z.pos[0], p.st.p[2] - z.pos[2]);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    z.nextAtk = now + 3200 + Math.random() * 1500;
    const o = [z.pos[0], z.pos[1] + 1, z.pos[2]], p = [best.st.p[0], best.st.p[1] + 0.9, best.st.p[2]];
    const dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2], dh = Math.hypot(dx, dz), T = Math.min(2, Math.max(0.8, dh / 12));
    room.addProjectile(o, [dx / T, dy / T + 0.5 * 12 * T, dz / T], z);
  }

  // riders can't be hurt while mounted
  immune(z) { return !!z.mount; }

  // ---------- the Maw ----------
  startMaw(w, now) {
    const room = this.room, n = room.activeCount();
    const hp = Math.round(MAW.hp * (1 + 0.6 * (n - 1)) * (1 + 0.5 * bossCycle(w)));
    const a = Math.random() * Math.PI * 2, edge = [Math.cos(a) * 44, Math.sin(a) * 44];
    this.maw = { hp, max: hp, dead: false, mode: 'enter', x: edge[0], z: edge[1], until: now + 4500, target: null, stage: 1, devoured: 0, devourAt: 0, dmgInWind: 0, t0: now, need: n >= 2 ? 2 : 1 };
    this.thumpers = THUMPER_SPOTS.map(s => ({ ...s, state: 'idle', until: 0, prog: 0, by: null }));
    room.broadcast({ t: 'maw', ev: 'enter', x: r2(edge[0]), z: r2(edge[1]), hp, max: hp, need: this.maw.need });
    room.broadcast({ t: 'task', text: `THE MAW hunts beneath the Outpost — arm ${this.maw.need === 1 ? 'a seismic thumper' : 'two seismic thumpers at once'} (hold E, in the houses) to lure it up, then shoot its throat` });
    this.syncThumpers();
  }

  mawPos() { const m = this.maw; return [m.x, 0, m.z]; }
  gullet() { const m = this.maw, up = m.mode === 'lured' || m.mode === 'devour' || m.mode === 'erupt'; return up ? [m.x, MAW.gulletY * (m.mode === 'erupt' ? 0.55 : 1), m.z] : null; }

  pickTarget() {
    const room = this.room, m = this.maw, r = Math.random();
    const builds = room.builds();
    if (r < 0.45 && builds.length) { // the thickest part of the fort
      const s = builds[Math.floor(Math.random() * builds.length)], c = s.box;
      return [(c.min[0] + c.max[0]) / 2, (c.min[2] + c.max[2]) / 2];
    }
    const ps = room.players.filter(p => p.alive && !p.downed);
    if (ps.length) { const p = ps[Math.floor(Math.random() * ps.length)]; return [p.st.p[0], p.st.p[2]]; }
    return [(Math.random() - 0.5) * 50, (Math.random() - 0.5) * 50];
  }

  updateMaw(dt, now) {
    const room = this.room, m = this.maw;
    if (m.mode === 'enter') { // the entrance: it bursts out at the edge, roars and dives
      if (now >= m.until) { m.mode = 'hunt'; m.target = this.pickTarget(); }
      return;
    }
    // stage changes
    const frac = m.hp / m.max;
    if (m.stage === 1 && frac < 0.6) { m.stage = 2; room.broadcast({ t: 'maw', ev: 'stage', stage: 2 }); }
    if (m.stage === 2 && frac < 0.25) { m.stage = 3; room.broadcast({ t: 'maw', ev: 'stage', stage: 3 }); m.devourAt = now + 3000; }
    // lured by thumpers: everything else waits
    const pulsing = this.thumpers.filter(t => t.state === 'pulse').length;
    if (pulsing >= m.need && m.mode !== 'lured' && m.mode !== 'dive' && now >= (m.lureCool || 0)) {
      if (m.mode === 'devour') room.broadcast({ t: 'maw', ev: 'interrupt' });
      const c = this.thumpers.filter(t => t.state === 'pulse');
      const lx = c.reduce((s, t) => s + t.x, 0) / c.length, lz = c.reduce((s, t) => s + t.z, 0) / c.length;
      const toward = Math.hypot(lx, lz) > 1 ? [lx * 0.55, lz * 0.55] : [lx, lz]; // comes up between the thumpers and the Core
      m.mode = 'lured'; m.x = toward[0]; m.z = toward[1]; m.until = now + MAW.lure; m.lureCool = now + MAW.lure + 6000;
      for (const t of c) { t.state = 'spent'; t.until = now + 8000; }
      this.syncThumpers();
      room.broadcast({ t: 'maw', ev: 'lured', x: r2(m.x), z: r2(m.z), ms: MAW.lure });
      return;
    }
    if (m.mode === 'lured') { if (now >= m.until) { m.mode = 'dive'; m.until = now + 1500; room.broadcast({ t: 'maw', ev: 'dive' }); } return; }
    if (m.mode === 'dive') { if (now >= m.until) { m.mode = 'hunt'; m.target = this.pickTarget(); } return; }
    // stage 3: goes for the Core
    if (m.stage === 3 && m.mode === 'hunt' && now >= m.devourAt) {
      m.mode = 'devour'; m.x = room.map.core.x + 3.5; m.z = room.map.core.z + 3.5; m.until = now + MAW.devourWind; m.dmgInWind = 0;
      room.broadcast({ t: 'maw', ev: 'devour', x: r2(m.x), z: r2(m.z), ms: MAW.devourWind });
      return;
    }
    if (m.mode === 'devour') {
      if (m.dmgInWind >= m.max * MAW.devourBreak) { // shot in the throat: it recoils
        room.broadcast({ t: 'maw', ev: 'interrupt' });
        m.mode = 'lured'; m.until = now + 5000; m.devourAt = now + 40000;
        return;
      }
      if (now >= m.until) {
        room.damageCore(room.core.max * MAW.devourDmg / 0.4, null); // CORE_ARMOR applies inside damageCore
        room.broadcast({ t: 'maw', ev: 'bite' });
        m.mode = 'dive'; m.until = now + 2000; m.devourAt = now + 40000;
      }
      return;
    }
    if (m.mode === 'warn') { // glowing ring where it will come up
      if (now >= m.until) this.erupt(now);
      return;
    }
    if (m.mode === 'erupt') { if (now >= m.until) { m.mode = 'hunt'; m.target = this.pickTarget(); } return; }
    // hunting underground
    const [tx, tz] = m.target ?? this.pickTarget(), dx = tx - m.x, dz = tz - m.z, l = Math.hypot(dx, dz);
    if (l < 0.8) { m.mode = 'warn'; m.until = now + MAW.warn; room.broadcast({ t: 'maw', ev: 'warn', x: r2(m.x), z: r2(m.z), r: MAW.eruptR, ms: MAW.warn }); return; }
    const step = Math.min(l, MAW.speed * dt);
    m.x += (dx / l) * step; m.z += (dz / l) * step;
    if (now - (m.netAt || 0) > 150) { m.netAt = now; room.broadcast({ t: 'maw', ev: 'move', x: r2(m.x), z: r2(m.z) }); }
    if (now - (m.retarget || 0) > 6000) { m.retarget = now; m.target = this.pickTarget(); }
  }

  erupt(now) {
    const room = this.room, m = this.maw, mul = room.director.dmgMul, at = [m.x, 0, m.z];
    for (const p of room.targets()) {
      if (!p.alive || p.downed || p.state === 'carried') continue;
      if (Math.hypot(p.st.p[0] - m.x, p.st.p[2] - m.z) <= MAW.eruptR + 0.5) room.hurtPlayer(p, MAW.eruptDmg * mul, { id: 0, pos: at, t: { name: 'the Maw' } });
    }
    for (const s of room.builds()) if (distToBox([m.x, 1, m.z], s.box) <= MAW.eruptR) room.damagePiece(s, MAW.eruptSdmg * mul);
    room.damageProps([m.x, 1, m.z], MAW.eruptR, 500);
    if (m.stage >= 2) { // it spews parasites and acid
      addHazard(room, 'acid', at, 3, 5, 12 * mul, 30);
      for (let i = 0; i < 2; i++) { const z = room.spawnZombie('swooper', room.director.lanes[0] ?? 'N', ''); z.pos = [m.x + (Math.random() - 0.5) * 3, 6, m.z + (Math.random() - 0.5) * 3]; }
    }
    m.mode = 'erupt'; m.until = now + 1600;
    room.broadcast({ t: 'maw', ev: 'erupt', x: r2(m.x), z: r2(m.z), r: MAW.eruptR });
  }

  // Sniper / rifle claims on the Maw: `k` = 'g' (gullet) or 'b' (body). Returns damage dealt.
  hitMaw(p, o, d, dmg, k) {
    const m = this.maw;
    if (!m || m.dead || !Array.isArray(d) || !d.every(Number.isFinite)) return 0;
    const l = Math.hypot(...d);
    if (!l) return 0;
    const u = d.map(v => v / l), g = this.gullet();
    let mult = 0;
    if (k === 'g' && g && raySphere(o, u, g, MAW.gulletR + 0.6) >= 0) mult = m.mode === 'erupt' ? 1 : 3;
    else if (g && raySphere(o, u, [m.x, g[1] * 0.6, m.z], MAW.bodyR + 0.6) >= 0) mult = 0.2;
    if (!mult) return 0;
    return this.damageMaw(dmg * mult, p);
  }

  // explosions near its exposed head
  blastMaw(at, radius, dmg, by) {
    const m = this.maw, g = m && !m.dead && this.gullet();
    if (!g) return;
    const d = Math.hypot(at[0] - g[0], (at[1] - g[1]) * 0.5, at[2] - g[2]);
    if (d <= radius + MAW.bodyR) this.damageMaw(dmg * (d <= radius + MAW.gulletR ? 1.5 : 0.4), by);
  }

  damageMaw(dmg, by) {
    const room = this.room, m = this.maw;
    if (!m || m.dead || !(dmg > 0)) return 0;
    const dealt = Math.min(dmg, m.hp);
    m.hp -= dealt;
    if (m.mode === 'devour') m.dmgInWind += dealt;
    if (by?.stats) by.stats.dmg += Math.round(dealt);
    if (now() - (m.hpAt || 0) > 120) { m.hpAt = now(); room.broadcast({ t: 'maw', ev: 'hp', hp: Math.round(m.hp) }); }
    if (m.hp <= 0) this.mawDie(by);
    return dealt;
  }

  mawDie(by) {
    const room = this.room, m = this.maw;
    m.dead = true;
    const at = [m.x, 0, m.z];
    for (const q of room.players) { q.money = Math.min(MONEY_CAP, q.money + 3000); room.sendInv(q); }
    const el = ['fire', 'water', 'ice', 'shock'][Math.floor(Math.random() * 4)];
    room.inventory.scatter([{ kind: 'gun', w: 'heavy_ar', r: 4, tier: 3, el }, ...rollLoot('boss')], at, 3);
    this.thumpers = [];
    this.syncThumpers();
    room.broadcast({ t: 'maw', ev: 'die', x: r2(m.x), z: r2(m.z), by: by?.id ?? null });
  }

  // ---------- seismic thumpers ----------
  // hold E (5 s, interrupted by taking damage) to arm; it pulses for 20 s
  onThump(p, m) {
    const room = this.room, t = this.thumpers[m.id | 0], now = Date.now();
    if (!t || !p.alive || p.downed || t.state !== 'idle') return;
    if (Math.hypot(p.st.p[0] - t.x, p.st.p[2] - t.z) > 2.8) return;
    if (t.by !== p.id || now - t.last > 500 || (p.hurtAt || 0) > t.last) { t.by = p.id; t.prog = 0; }
    else t.prog += Math.min(400, now - t.last);
    t.last = now;
    if (t.prog >= MAW.thumpHold) {
      t.state = 'pulse'; t.until = now + MAW.pulse; t.by = null;
      room.broadcast({ t: 'msg', text: `${p.name} armed a seismic thumper` });
      this.syncThumpers();
    }
  }

  updateThumpers(now) {
    let changed = false;
    for (const t of this.thumpers) {
      if ((t.state === 'pulse' || t.state === 'spent') && now >= t.until) { t.state = 'idle'; t.prog = 0; changed = true; }
    }
    if (changed) this.syncThumpers();
  }

  syncThumpers(p = null) {
    const msg = { t: 'thump', l: this.thumpers.map(t => [t.id, r2(t.x), r2(t.z), t.state, Math.max(0, t.until - Date.now())]) };
    if (p) this.room.send(p, msg); else this.room.broadcast(msg);
  }

  syncTo(p) {
    const m = this.maw;
    if (m && !m.dead) this.room.send(p, { t: 'maw', ev: 'sync', x: r2(m.x), z: r2(m.z), hp: Math.round(m.hp), max: m.max, mode: m.mode, need: m.need, stage: m.stage });
    if (this.thumpers.length) this.syncThumpers(p);
    if (this.smith) this.room.send(p, { t: 'smith', on: true });
  }
}

const now = () => Date.now();
