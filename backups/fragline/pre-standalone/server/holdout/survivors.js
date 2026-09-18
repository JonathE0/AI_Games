// Survivors: on rescue waves wounded survivors wait in the corner shelters. A player carries one (hold E)
// back into the ring around the Core, where it becomes a defender: it holds posts inside the ring (climbing
// onto floors/ramps built there), walks through doors, and shoots zombies with a weak SMG until it runs
// dry. It has a lot of health but no second chance — if it dies it is gone.
import { SURVIVOR, SURVIVOR_NAMES, RESCUE_WAVES, MONEY_CAP, rescueWave, survivorTier } from '../../shared/holdout.js';
import { OUTPOST_SHELTERS } from '../../shared/outpost.js';
import { P, moveCharacter } from '../../shared/physics.js';

const STATES = ['wounded', 'carried', 'active'];
const r2 = v => Math.round(v * 100) / 100;
const near = [];
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Survivors {
  constructor(room) { this.room = room; this.reset(); }

  reset() {
    this.list = new Map();
    this.nextId = 1;
    this.shots = [];
    this.netAt = 0;
    this.names = [...SURVIVOR_NAMES].sort(() => Math.random() - 0.5);
  }

  spawnWounded(shelter, tier = survivorTier(this.room.wave, this.room.rng)) {
    const room = this.room, id = this.nextId++, T = SURVIVOR.tiers[tier], maxHp = Math.round(T.hp * (1 + 0.15 * (room.activeCount() - 1)));
    const pos = [shelter.x + (Math.random() - 0.5), 0, shelter.z + (Math.random() - 0.5)];
    const sv = {
      id, name: this.names[(id - 1) % this.names.length], isSurvivor: true, state: 'wounded', pos, vel: [0, 0, 0], yaw: 0,
      hp: maxHp, maxHp, alive: true, downed: false, carrier: null, tier, ammo: T.ammo, mag: T.mag,
      reloadEnd: 0, nextShot: 0, post: null, postAt: 0, g: true, stuck: 0, target: null, thinkAt: 0,
      owner: null, order: null, sidestepAt: 0, sidestepAng: 0,
    };
    sv.st = { p: sv.pos };
    this.list.set(id, sv);
    room.broadcast({ t: 'svadd', id, name: sv.name, tier });
    return sv;
  }

  // Bandages / medkits used on them, the Medic's aura, campfires: survivors never heal on their own.
  heal(sv, amount) {
    if (!sv.alive || sv.hp >= sv.maxHp) return 0;
    const add = Math.min(sv.maxHp - sv.hp, amount);
    sv.hp += add;
    return add;
  }

  // Wave start: on rescue waves, wounded survivors appear in two of the corner shelters.
  onWave(wave) {
    if (!rescueWave(wave)) return;
    const shelters = [...OUTPOST_SHELTERS].sort(() => Math.random() - 0.5).slice(0, 2);
    for (const s of shelters) this.spawnWounded(s);
    this.room.broadcast({ t: 'task', text: `RESCUE: wounded survivors in the ${shelters.map(s => shelterName(s)).join(' and ')} shelters — carry them into the Core ring` });
  }

  // hold E on a wounded survivor to pick them up; E again (while carrying) puts them down
  onCarry(p, m) {
    if (!p.alive || p.downed) return;
    if (p.carrying) return this.drop(p);
    const sv = this.list.get(m.id);
    if (!sv || sv.state !== 'wounded' || Math.hypot(sv.pos[0] - p.st.p[0], sv.pos[1] - p.st.p[1], sv.pos[2] - p.st.p[2]) > 2.6) return;
    sv.state = 'carried';
    sv.carrier = p.id;
    p.carrying = sv.id;
    this.room.sendInv(p);
  }

  drop(p) {
    const sv = this.list.get(p.carrying);
    p.carrying = null;
    if (sv && sv.state === 'carried') { sv.state = 'wounded'; sv.carrier = null; sv.pos[1] = p.st.p[1]; }
    this.room.sendInv(p);
  }

  // E on a nearby active survivor: assigns them to you (last assigner wins), or unassigns one of yours.
  onAssign(p, m) {
    if (!p.alive || p.downed) return;
    const sv = this.list.get(m.id | 0);
    if (!sv || sv.state !== 'active' || Math.hypot(sv.pos[0] - p.st.p[0], sv.pos[1] - p.st.p[1], sv.pos[2] - p.st.p[2]) > 3.2) return;
    sv.owner = sv.owner === p.id ? null : p.id;
    if (!sv.owner) sv.order = null; // no owner left to command it: back to holding posts
  }

  // Orders: send every survivor you own to a spot (they walk there and hold instead of picking posts), or
  // clear their orders when the spot is inside the Core ring.
  onCommand(p, m) {
    const room = this.room, now = Date.now();
    if (!p.alive || p.downed || now < (p.svcmdAt || 0)) return;
    let x = +m.x, z = +m.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    p.svcmdAt = now + 200;
    const B = room.map.bounds;
    x = Math.max(B.minX, Math.min(B.maxX, x));
    z = Math.max(B.minZ, Math.min(B.maxZ, z));
    const c = room.map.core, clear = Math.hypot(x - c.x, z - c.z) <= room.map.buyRadius;
    for (const sv of this.list.values()) if (sv.owner === p.id && sv.state === 'active') sv.order = clear ? null : [x, z];
  }

  hurt(sv, dmg) {
    if (!sv.alive || sv.state === 'carried') return;
    sv.hp -= Math.max(1, Math.round(dmg));
    if (sv.hp <= 0) this.perish(sv);
  }

  perish(sv) {
    sv.alive = false;
    this.list.delete(sv.id);
    const c = this.room.players.find(p => p.carrying === sv.id);
    if (c) { c.carrying = null; this.room.sendInv(c); }
    this.room.broadcast({ t: 'svdie', id: sv.id, name: sv.name });
  }

  // A boss's survivor supplies: every survivor is refilled and promoted one tier (better gun, no healing).
  resupply(by) {
    for (const sv of this.list.values()) {
      sv.tier = Math.min(SURVIVOR.tiers.length - 1, sv.tier + 1);
      const T = SURVIVOR.tiers[sv.tier];
      sv.ammo = T.ammo; sv.mag = T.mag;
    }
    this.room.broadcast({ t: 'msg', text: `${by?.name ?? 'Someone'} delivered survivor supplies — ammo refilled, survivors promoted` });
  }

  // posts: tops of floors/ramps built inside the ring (they climb up to them), else spots around the Core
  pickPost(sv) {
    const room = this.room, c = room.map.core, R = room.map.buyRadius - 1;
    const high = [];
    for (const s of room.pieces.values()) {
      if (s.kind === 'wall' || s.kind === 'prop') continue;
      const b = s.box, x = (b.min[0] + b.max[0]) / 2, z = (b.min[2] + b.max[2]) / 2;
      if (Math.hypot(x - c.x, z - c.z) <= R && b.max[1] > 0.4) high.push([x, z]);
    }
    if (high.length && Math.random() < 0.6) return high[(Math.random() * high.length) | 0];
    const a = Math.random() * Math.PI * 2, r = 3.3 + Math.random() * 1.8;
    return [c.x + Math.cos(a) * r, c.z + Math.sin(a) * r];
  }

  update(dt, now) {
    const room = this.room;
    for (const sv of [...this.list.values()]) {
      if (sv.state === 'carried') {
        const p = room.players.find(q => q.id === sv.carrier);
        if (!p || !p.alive || p.downed) { if (p) this.drop(p); else { sv.state = 'wounded'; sv.carrier = null; } continue; }
        sv.pos[0] = p.st.p[0]; sv.pos[1] = p.st.p[1]; sv.pos[2] = p.st.p[2]; sv.yaw = p.st.y;
        if (Math.hypot(sv.pos[0] - room.map.core.x, sv.pos[2] - room.map.core.z) <= room.map.buyRadius) {
          sv.state = 'active'; sv.carrier = null; p.carrying = null;
          for (const q of room.players) q.money = Math.min(MONEY_CAP, q.money + 500);
          p.stats.rescues = (p.stats.rescues || 0) + 1;
          room.broadcast({ t: 'msg', text: `${p.name} rescued ${sv.name}! (+$500 each)` });
          for (const q of room.players) room.sendInv(q);
        }
        continue;
      }
      if (sv.state === 'active') this.think(sv, dt, now);
    }
    if (now - this.netAt >= 100 && (this.list.size || this.shots.length)) {
      this.netAt = now;
      room.broadcast({ t: 'svs', l: [...this.list.values()].map(sv => this.tuple(sv)), shots: this.shots });
      this.shots = [];
    }
  }

  tuple(sv) { return [sv.id, STATES.indexOf(sv.state), r2(sv.pos[0]), r2(sv.pos[1]), r2(sv.pos[2]), Math.round(sv.yaw * 1000) / 1000, Math.round((sv.hp / sv.maxHp) * 100) / 100, sv.tier, sv.carrier ?? '', sv.ammo + sv.mag, sv.owner ?? '']; }

  think(sv, dt, now) {
    const room = this.room, eye = [sv.pos[0], sv.pos[1] + 1.5, sv.pos[2]], gun = SURVIVOR.tiers[sv.tier];
    if (sv.hp < sv.maxHp) sv.hp = Math.min(sv.maxHp, sv.hp + 1 * dt); // passive regen, very slow
    // targeting
    if (now >= sv.thinkAt) {
      sv.thinkAt = now + 300;
      let best = null, bd = gun.range;
      for (const z of room.zombies.values()) {
        if (z.dead) continue;
        const d = Math.hypot(z.pos[0] - sv.pos[0], z.pos[2] - sv.pos[2]);
        if (d < bd && room.lineOfSight(eye, [z.pos[0], z.pos[1] + 1.2 * z.s, z.pos[2]])) { bd = d; best = z; }
      }
      sv.target = best;
    }
    const tg = sv.target && !sv.target.dead ? sv.target : null;
    if (sv.reloadEnd && now >= sv.reloadEnd) { const n = Math.min(gun.mag, sv.ammo); sv.mag = n; sv.ammo -= n; sv.reloadEnd = 0; }
    if (tg && !sv.reloadEnd && now >= sv.nextShot) {
      if (sv.mag <= 0) { if (sv.ammo > 0) sv.reloadEnd = now + SURVIVOR.reload * 1000; }
      else {
        sv.mag--;
        sv.nextShot = now + (60000 / gun.rpm) * (1 + Math.random() * 0.35);
        const d = Math.hypot(tg.pos[0] - sv.pos[0], tg.pos[2] - sv.pos[2]);
        const hit = Math.random() < gun.hit * (d > gun.range * 0.55 ? 0.75 : 1);
        const end = [tg.pos[0] + (hit ? 0 : (Math.random() - 0.5) * 1.5), tg.pos[1] + 1.1 * tg.s + (hit ? 0 : Math.random() - 0.3), tg.pos[2] + (hit ? 0 : (Math.random() - 0.5) * 1.5)];
        if (this.shots.length < 40) this.shots.push([sv.id, r2(end[0]), r2(end[1]), r2(end[2])]);
        if (hit) room.damageZombie(tg, gun.dmg * (room.buffActive('damage') ? 1.3 : 1), sv, 'sv' + sv.tier);
      }
    }
    // movement: an active order takes priority over posts — walk there and hold
    let tx, tz;
    if (sv.order) {
      [tx, tz] = sv.order;
      if (sv.stuck > 2.5 && now >= sv.sidestepAt) { sv.sidestepAng = Math.random() * Math.PI * 2; sv.sidestepAt = now + 500; sv.stuck = 0; } // jammed on a corner: nudge sideways
    } else {
      if (!sv.post || now > sv.postAt || sv.stuck > 1.5) { sv.post = this.pickPost(sv); sv.postAt = now + 9000 + Math.random() * 5000; sv.stuck = 0; }
      [tx, tz] = sv.post;
    }
    const dx = tx - sv.pos[0], dz = tz - sv.pos[2], l = Math.hypot(dx, dz);
    let wx = 0, wz = 0;
    if (now < sv.sidestepAt) { wx = Math.cos(sv.sidestepAng); wz = Math.sin(sv.sidestepAng); }
    else if (l > 0.6) { wx = dx / l; wz = dz / l; }
    const k = Math.min(1, dt * 8);
    sv.vel[0] += (wx * SURVIVOR.speed - sv.vel[0]) * k;
    sv.vel[2] += (wz * SURVIVOR.speed - sv.vel[2]) * k;
    sv.vel[1] -= P.gravity * dt;
    const bx = sv.pos[0], bz = sv.pos[2];
    const boxes = room.grid.query(sv.pos[0] - 1.5, sv.pos[2] - 1.5, sv.pos[0] + 1.5, sv.pos[2] + 1.5, near).filter(b => !b.door); // doors open for survivors
    sv.g = moveCharacter(sv.pos, sv.vel, dt, P.standH, boxes, sv.g);
    const moved = Math.hypot(sv.pos[0] - bx, sv.pos[2] - bz);
    if (l > 0.6 && moved < SURVIVOR.speed * dt * 0.2) sv.stuck += dt; else sv.stuck = 0;
    const face = tg ? Math.atan2(-(tg.pos[0] - sv.pos[0]), -(tg.pos[2] - sv.pos[2])) : l > 0.6 ? Math.atan2(-dx, -dz) : sv.yaw;
    sv.yaw = wrap(sv.yaw + Math.max(-dt * 8, Math.min(dt * 8, wrap(face - sv.yaw))));
    if (sv.pos[1] < -3) { sv.pos[0] = room.map.core.x + 3; sv.pos[1] = 0; sv.pos[2] = room.map.core.z; }
  }

  syncTo(p) {
    for (const sv of this.list.values()) this.room.send(p, { t: 'svadd', id: sv.id, name: sv.name, tier: sv.tier });
  }
}

const shelterName = s => (s.z < 0 ? 'north' : 'south') + (s.x < 0 ? 'west' : 'east');
export { RESCUE_WAVES };
