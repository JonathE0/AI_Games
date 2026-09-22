// Player explosives in the Holdout: grenades (bounce, then blow up), molotovs (fire pools), freeze grenades
// (a Blizzard field that slows zombies and freezes the ones that linger), and rockets from the Rocket Launcher / rocket turrets. Everything is simulated here and only hurts zombies.
import { WEAPONS } from '../../shared/weapons.js';
import { ITEMS } from '../../shared/holdout.js';
import { gunMult } from '../../shared/items.js';
import { countOf, takeItem, gunByUid } from './inventory.js';
import { rayWorld } from '../../shared/physics.js';
import { addHazard } from './behaviors.js';

const G = 15, r2 = v => Math.round(v * 100) / 100;
const tmp = [];

export class Combat {
  constructor(room) { this.room = room; this.reset(); }

  reset() {
    this.flying = [];   // thrown grenades / molotovs / freezes and rockets
    this.fires = [];    // burning molotov pools
    this.bomblets = [];  // Brood Launcher / Siegebreaker: bomblets waiting to burst after landing
    this.fields = [];   // Blizzard fields left by freeze grenades
    this.nextId = 1;
  }

  // ---------- messages ----------
  onThrow(p, m) {
    const it = ITEMS[m.item], now = Date.now();
    if (!it || it.kind !== 'throw' || !(countOf(p, m.item) > 0) || !p.alive || p.downed || now - (p.lastThrow || 0) < 700) return;
    const eye = this.room.eye(p);
    if (!Array.isArray(m.o) || !m.o.every(Number.isFinite) || Math.hypot(m.o[0] - eye[0], m.o[1] - eye[1], m.o[2] - eye[2]) > 2) return;
    let v = Array.isArray(m.v) && m.v.every(Number.isFinite) ? m.v : [0, 0, 0];
    const sp = Math.hypot(...v);
    if (sp > 24) v = v.map(x => (x * 24) / sp);
    takeItem(p, m.item, 1);
    p.lastThrow = now;
    const pr = { id: this.nextId++, kind: m.item, pos: [...m.o], vel: [...v], born: now, owner: p };
    this.flying.push(pr);
    this.room.broadcast({ t: 'thr', id: pr.id, item: m.item, o: pr.pos.map(r2), v: v.map(r2) });
    this.room.sendInv(p);
  }

  onRocket(p, m) {
    const g = gunByUid(p, m.uid), now = Date.now();
    if (!g || !WEAPONS[g.id].projectile || !p.alive || p.downed || p.bar?.up) return; // not from behind a raised barrier
    const w = WEAPONS[g.id], gap = (60000 / w.rpm) * 0.7 / (this.room.buffActive('rate') ? 1.3 : 1);
    if (now - (p.lastShot[g.id] || 0) < gap) return;
    p.lastShot[g.id] = now;
    const eye = this.room.eye(p);
    if (!Array.isArray(m.o) || !m.o.every(Number.isFinite) || Math.hypot(m.o[0] - eye[0], m.o[1] - eye[1], m.o[2] - eye[2]) > 2.5) return;
    const d = Array.isArray(m.d) && m.d.every(Number.isFinite) ? m.d : null, l = d && Math.hypot(...d);
    if (!l) return;
    const dir = d.map(v => v / l), dmg = w.dmg * gunMult(g) * this.room.dmgMultFor(p);
    if (w.projectile === 'grenade') return this.lob(p, [...m.o], dir, dmg, w.splash, g.el, w.bomblets || 0);
    if (w.projectile === 'blast') return this.room.blast(p, [...m.o], dir, w, gunMult(g) * this.room.dmgMultFor(p));
    this.rocket([...m.o], dir, p, dmg, w.splash, g.el, w.bomblets || 0);
  }

  // Grenade launcher round: arcs, explodes on the first thing it touches. bomblets: the Brood Launcher's perk.
  lob(owner, o, dir, dmg, splash, el = null, bomblets = 0) {
    const pr = { id: this.nextId++, kind: 'glnade', pos: o, vel: [dir[0] * 30, dir[1] * 30 + 2.5, dir[2] * 30], born: Date.now(), owner, dmg, splash, el, bomblets };
    this.flying.push(pr);
    this.room.broadcast({ t: 'thr', id: pr.id, item: 'glnade', o: o.map(r2), v: pr.vel.map(r2) });
  }

  // Brood Launcher / Siegebreaker: 3 bomblets land 2-4 m out and burst ~0.6 s later for half damage in a smaller
  // radius; the Brood Launcher's (grenade rounds) each leave a zombie-only acid pool for 5 s.
  spawnBomblets(center, pr, now) {
    for (let i = 0; i < pr.bomblets; i++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 2;
      this.bomblets.push({ p: [center[0] + Math.cos(a) * r, center[1], center[2] + Math.sin(a) * r], dmg: pr.dmg * 0.5, splash: pr.splash * 0.6, owner: pr.owner, at: now + 600, w: pr.kind === 'glnade' ? 'broodlauncher' : 'siegebreaker' });
    }
  }

  // Also used by rocket turrets (owner = the player who placed it).
  rocket(o, dir, owner, dmg, splash, el = null, bomblets = 0) {
    const pr = { id: this.nextId++, kind: 'rocket', pos: o, vel: dir.map(v => v * 42), born: Date.now(), owner, dmg, splash, el, bomblets };
    this.flying.push(pr);
    this.room.broadcast({ t: 'rkt', id: pr.id, o: o.map(r2), d: dir.map(v => Math.round(v * 1000) / 1000), by: owner?.id ?? null });
  }

  // ---------- simulation ----------
  update(dt, now) {
    const room = this.room;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const pr = this.flying[i], a = [...pr.pos];
      if (pr.kind !== 'rocket') pr.vel[1] -= G * dt;
      for (let j = 0; j < 3; j++) pr.pos[j] += pr.vel[j] * dt;
      const b = pr.pos, d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d);
      let hit = null;
      if (len > 1e-6) {
        const boxes = room.grid.query(Math.min(a[0], b[0]) - 0.5, Math.min(a[2], b[2]) - 0.5, Math.max(a[0], b[0]) + 0.5, Math.max(a[2], b[2]) + 0.5, tmp);
        const u = d.map(v => v / len), h = rayWorld(a, u, len, boxes);
        if (h) hit = { p: a.map((v, j) => v + u[j] * Math.max(0, h.t - 0.05)), n: h.n };
        if (pr.kind === 'rocket' || pr.kind === 'glnade' || pr.kind === 'molotov' || pr.kind === 'freeze') {
          for (const z of room.zombies.values()) { // direct hits on bodies
            if (z.dead) continue;
            const c = [z.pos[0], z.pos[1] + 0.9 * z.s, z.pos[2]];
            if (Math.hypot(c[0] - b[0], (c[1] - b[1]) * 0.6, c[2] - b[2]) < 0.7 * z.s) { hit = { p: [...b], n: [0, 1, 0] }; break; }
          }
        }
      }
      const age = now - pr.born;
      if (pr.kind === 'grenade') {
        if (hit) { // bounce
          pr.pos = hit.p;
          const dot = pr.vel[0] * hit.n[0] + pr.vel[1] * hit.n[1] + pr.vel[2] * hit.n[2];
          for (let j = 0; j < 3; j++) pr.vel[j] = (pr.vel[j] - 2 * dot * hit.n[j]) * 0.4;
        }
        if (age >= ITEMS.grenade.fuse * 1000) { this.flying.splice(i, 1); this.detonate(pr, pr.pos); }
      } else if (hit || age > 6000 || pr.pos[1] < -2) {
        this.flying.splice(i, 1);
        this.detonate(pr, hit ? hit.p : pr.pos);
      }
    }
    // burning pools
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (now >= f.until) { this.fires.splice(i, 1); continue; }
      if (now < f.nextTick) continue;
      f.nextTick = now + 250;
      for (const z of room.zombies.values()) {
        if (z.dead || Math.hypot(z.pos[0] - f.p[0], z.pos[2] - f.p[2]) > f.r || Math.abs(z.pos[1] - f.p[1]) > 2) continue;
        z.slowUntil = now + 400; z.slow = Math.max(z.slow || 0, 0.25);
        room.damageZombie(z, ITEMS.molotov.dps * 0.25, f.owner, 'molotov');
      }
    }
    // Blizzard fields: zombies inside are slowed, and the time they spend inside adds up (across fields and visits)
    // until they freeze solid — brittle while it lasts (room.damageZombie). Bodies riding or tunnelling are out of reach.
    if (this.fields.length) {
      const F = ITEMS.freeze;
      this.fields = this.fields.filter(f => now < f.until);
      for (const z of room.zombies.values()) {
        if (z.dead || z.mount || z.under || !this.fields.some(f => Math.hypot(z.pos[0] - f.p[0], z.pos[2] - f.p[2]) <= F.radius && Math.abs(z.pos[1] - f.p[1]) <= 2)) continue;
        z.slowUntil = Math.max(z.slowUntil, now + 250); z.slow = Math.max(z.slow || 0, F.slow);
        if (now < z.frozenUntil) continue;
        z.iceT = (z.iceT || 0) + dt;
        if (z.iceT >= F.freezeAfter) { z.iceT = 0; z.frozenUntil = z.brittleUntil = now + F.freeze * 1000; }
      }
    }
    // Brood Launcher / Siegebreaker bomblets: burst a beat after landing
    for (let i = this.bomblets.length - 1; i >= 0; i--) {
      const b = this.bomblets[i];
      if (now < b.at) continue;
      this.bomblets.splice(i, 1);
      for (const z of room.zombies.values()) {
        if (z.dead) continue;
        const d = Math.hypot(z.pos[0] - b.p[0], z.pos[2] - b.p[2]);
        if (d <= b.splash) room.damageZombie(z, b.dmg * (1 - (0.5 * d) / b.splash), b.owner, b.w);
      }
      if (b.w === 'broodlauncher') addHazard(room, 'acidz', b.p, b.splash * 0.7, 5, 0, 0, 18, b.owner);
      room.broadcast({ t: 'boom', id: 0, item: 'glnade', p: b.p.map(r2) });
    }
  }

  detonate(pr, p) {
    const room = this.room, now = Date.now();
    const inRange = r => [...room.zombies.values()].filter(z => !z.dead && Math.hypot(z.pos[0] - p[0], z.pos[1] + 0.9 * z.s - p[1], z.pos[2] - p[2]) <= r + 0.4 * z.s);
    if (pr.kind === 'grenade') {
      const it = ITEMS.grenade;
      for (const z of inRange(it.radius)) {
        const d = Math.hypot(z.pos[0] - p[0], z.pos[2] - p[2]);
        room.damageZombie(z, it.dmg * (1 - (0.6 * d) / it.radius) * (room.buffActive('damage') ? 1.3 : 1), pr.owner, 'grenade');
      }
      room.bosses.blastMaw(p, it.radius, it.dmg, pr.owner);
      room.bosses.behemoth.blast(p, it.radius, it.dmg, pr.owner);
    } else if (pr.kind === 'rocket' || pr.kind === 'glnade') {
      for (const z of inRange(pr.splash)) {
        const d = Math.hypot(z.pos[0] - p[0], z.pos[2] - p[2]), dmg = pr.dmg * (1 - (0.5 * d) / pr.splash);
        room.damageZombie(z, dmg, pr.owner, pr.kind === 'glnade' ? 'gl' : 'rocket');
        if (pr.el && !z.dead) room.applyElement(z, pr.el, dmg, pr.owner);
      }
      room.bosses.blastMaw(p, pr.splash, pr.dmg, pr.owner);
      room.bosses.behemoth.blast(p, pr.splash, pr.dmg, pr.owner);
      if (pr.bomblets) this.spawnBomblets(p, pr, now);
    } else if (pr.kind === 'molotov') {
      const it = ITEMS.molotov;
      this.fires.push({ p: [...p], r: it.radius, until: now + it.burn * 1000, nextTick: now, owner: pr.owner });
    } else if (pr.kind === 'freeze') { // the field lies on whatever surface is below the blast (a body hit bursts in mid-air)
      p = [p[0], room.inventory.surfaceBelow(p[0], p[2], p[1] + 0.1), p[2]];
      this.fields.push({ p, until: now + ITEMS.freeze.time * 1000 });
    }
    room.broadcast({ t: 'boom', id: pr.id, item: pr.kind, p: p.map(r2) });
  }

  syncTo(p) {
    const now = Date.now();
    for (const f of this.fires) this.room.send(p, { t: 'boom', id: 0, item: 'molotov', p: f.p.map(r2), left: f.until - now });
    for (const f of this.fields) this.room.send(p, { t: 'boom', id: 0, item: 'freeze', p: f.p.map(r2), left: f.until - now });
  }
}
