// Player explosives in the Holdout: grenades (bounce, then blow up), molotovs (fire pools), freeze grenades,
// and rockets from the Rocket Launcher / rocket turrets. Everything is simulated here and only hurts zombies.
import { WEAPONS } from '../../shared/weapons.js';
import { ITEMS, RARITY } from '../../shared/holdout.js';
import { rayWorld } from '../../shared/physics.js';

const G = 15, r2 = v => Math.round(v * 100) / 100;
const tmp = [];

export class Combat {
  constructor(room) { this.room = room; this.reset(); }

  reset() {
    this.flying = [];   // thrown grenades / molotovs / freezes and rockets
    this.fires = [];    // burning molotov pools
    this.nextId = 1;
  }

  // ---------- messages ----------
  onThrow(p, m) {
    const it = ITEMS[m.item], now = Date.now();
    if (!it || it.kind !== 'throw' || !(p.items[m.item] > 0) || !p.alive || p.downed || now - (p.lastThrow || 0) < 700) return;
    const eye = this.room.eye(p);
    if (!Array.isArray(m.o) || !m.o.every(Number.isFinite) || Math.hypot(m.o[0] - eye[0], m.o[1] - eye[1], m.o[2] - eye[2]) > 2) return;
    let v = Array.isArray(m.v) && m.v.every(Number.isFinite) ? m.v : [0, 0, 0];
    const sp = Math.hypot(...v);
    if (sp > 24) v = v.map(x => (x * 24) / sp);
    p.items[m.item]--;
    p.lastThrow = now;
    const pr = { id: this.nextId++, kind: m.item, pos: [...m.o], vel: [...v], born: now, owner: p };
    this.flying.push(pr);
    this.room.broadcast({ t: 'thr', id: pr.id, item: m.item, o: pr.pos.map(r2), v: v.map(r2) });
    this.room.sendInv(p);
  }

  onRocket(p, m) {
    const g = p.guns.find(x => x && x.uid === m.uid && WEAPONS[x.w].projectile === 'rocket'), now = Date.now();
    if (!g || !p.alive || p.downed) return;
    const w = WEAPONS[g.w], gap = (60000 / w.rpm) * 0.7 / (this.room.buffActive('rate') ? 1.3 : 1);
    if (now - (p.lastShot[g.w] || 0) < gap) return;
    p.lastShot[g.w] = now;
    const eye = this.room.eye(p);
    if (!Array.isArray(m.o) || !m.o.every(Number.isFinite) || Math.hypot(m.o[0] - eye[0], m.o[1] - eye[1], m.o[2] - eye[2]) > 2.5) return;
    const d = Array.isArray(m.d) && m.d.every(Number.isFinite) ? m.d : null, l = d && Math.hypot(...d);
    if (!l) return;
    this.rocket([...m.o], d.map(v => v / l), p, w.dmg * RARITY[g.r ?? 0].mult, w.splash);
  }

  // Also used by rocket turrets (owner = the player who placed it).
  rocket(o, dir, owner, dmg, splash) {
    const pr = { id: this.nextId++, kind: 'rocket', pos: o, vel: dir.map(v => v * 42), born: Date.now(), owner, dmg, splash };
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
        if (pr.kind === 'rocket' || pr.kind === 'molotov' || pr.kind === 'freeze') {
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
    } else if (pr.kind === 'rocket') {
      for (const z of inRange(pr.splash)) {
        const d = Math.hypot(z.pos[0] - p[0], z.pos[2] - p[2]);
        room.damageZombie(z, pr.dmg * (1 - (0.5 * d) / pr.splash) * (room.buffActive('damage') ? 1.3 : 1), pr.owner, 'rocket');
      }
    } else if (pr.kind === 'molotov') {
      const it = ITEMS.molotov;
      this.fires.push({ p: [...p], r: it.radius, until: now + it.burn * 1000, nextTick: now, owner: pr.owner });
    } else if (pr.kind === 'freeze') {
      for (const z of inRange(ITEMS.freeze.radius)) z.frozenUntil = now + ITEMS.freeze.freeze * 1000;
    }
    room.broadcast({ t: 'boom', id: pr.id, item: pr.kind, p: p.map(r2) });
  }

  syncTo(p) {
    const now = Date.now();
    for (const f of this.fires) this.room.send(p, { t: 'boom', id: 0, item: 'molotov', p: f.p.map(r2), left: f.until - now });
  }
}
