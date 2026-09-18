// Survivors: on rescue waves wounded survivors wait in the corner shelters. A player carries one (hold E)
// back into the ring around the Core, where it becomes a defender: it holds posts inside the ring (climbing
// onto floors/ramps built there), walks through doors, and shoots zombies until it runs dry. It has a lot
// of health but no second chance — if it dies it is gone. They think for themselves: no player commands.
import { SURVIVOR, SURVIVOR_NAMES, SURVIVOR_CLASSES, SURVIVOR_CLASS_IDS, RESCUE_WAVES, MONEY_CAP, rescueWave, survivorTier, survivorGun } from '../../shared/holdout.js';
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

  spawnWounded(shelter, tier = survivorTier(this.room.wave, this.room.rng), cls = SURVIVOR_CLASS_IDS[(Math.random() * SURVIVOR_CLASS_IDS.length) | 0]) {
    const room = this.room, id = this.nextId++, C = SURVIVOR_CLASSES[cls], gun = survivorGun(tier, cls);
    const maxHp = Math.round(SURVIVOR.tiers[tier].hp * C.hpMult * (1 + 0.15 * (room.activeCount() - 1)));
    const pos = [shelter.x + (Math.random() - 0.5), 0, shelter.z + (Math.random() - 0.5)];
    const sv = {
      id, name: this.names[(id - 1) % this.names.length], isSurvivor: true, state: 'wounded', pos, vel: [0, 0, 0], yaw: 0,
      hp: maxHp, maxHp, alive: true, downed: false, carrier: null, tier, cls, gun, ammo: gun.ammo, mag: gun.mag,
      reloadEnd: 0, nextShot: 0, post: null, postAt: 0, g: true, stuck: 0, target: null, thinkAt: 0,
      threat: null, threatD: Infinity, sidestepAt: 0, sidestepAng: 0,
    };
    sv.st = { p: sv.pos };
    this.list.set(id, sv);
    room.broadcast({ t: 'svadd', id, name: sv.name, tier, cls });
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
      sv.gun = survivorGun(sv.tier, sv.cls);
      sv.ammo = sv.gun.ammo; sv.mag = sv.gun.mag;
    }
    this.room.broadcast({ t: 'msg', text: `${by?.name ?? 'Someone'} delivered survivor supplies — ammo refilled, survivors promoted` });
  }

  // posts: tops of floors/ramps built inside the ring (they climb up to them, and skip ones with a zombie
  // right next to them), else spots around the Core — biased toward the front (Guardians) or back (Rangers).
  pickPost(sv) {
    const room = this.room, c = room.map.core, R = room.map.buyRadius - 1, bias = SURVIVOR_CLASSES[sv.cls]?.postBias || 0;
    const spots = [];
    for (const s of room.pieces.values()) {
      if (s.kind === 'wall' || s.kind === 'prop') continue;
      const b = s.box, x = (b.min[0] + b.max[0]) / 2, z = (b.min[2] + b.max[2]) / 2, d = Math.hypot(x - c.x, z - c.z);
      if (d <= R && b.max[1] > 0.4) spots.push([x, z, d]);
    }
    const clear = spots.filter(([x, z]) => ![...room.zombies.values()].some(z2 => !z2.dead && Math.hypot(z2.pos[0] - x, z2.pos[2] - z) < 4));
    const high = clear.length ? clear : spots;
    if (high.length && Math.random() < 0.6) {
      if (bias) high.sort((a, b) => (b[2] - a[2]) * bias);
      const [x, z] = high[(Math.random() * Math.min(3, high.length)) | 0];
      return [x, z];
    }
    const a = Math.random() * Math.PI * 2, r = bias > 0 ? 4.2 + Math.random() * 0.9 : bias < 0 ? 3.3 + Math.random() * 0.6 : 3.3 + Math.random() * 1.8;
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

  tuple(sv) { return [sv.id, STATES.indexOf(sv.state), r2(sv.pos[0]), r2(sv.pos[1]), r2(sv.pos[2]), Math.round(sv.yaw * 1000) / 1000, Math.round((sv.hp / sv.maxHp) * 100) / 100, sv.tier, sv.carrier ?? '', sv.ammo + sv.mag]; }

  think(sv, dt, now) {
    const room = this.room, eye = [sv.pos[0], sv.pos[1] + 1.5, sv.pos[2]], gun = sv.gun;
    if (sv.hp < sv.maxHp) sv.hp = Math.min(sv.maxHp, sv.hp + 1 * dt); // passive regen, very slow
    // targeting: the best in-range/LOS zombie to shoot, and separately the single nearest zombie (any
    // range) so it can react to close threats even ones it can't line up a shot on yet
    if (now >= sv.thinkAt) {
      sv.thinkAt = now + 300;
      let best = null, bd = gun.range, near0 = null, nd = Infinity;
      for (const z of room.zombies.values()) {
        if (z.dead) continue;
        const d = Math.hypot(z.pos[0] - sv.pos[0], z.pos[2] - sv.pos[2]);
        if (d < nd) { nd = d; near0 = z; }
        if (d < bd && room.lineOfSight(eye, [z.pos[0], z.pos[1] + 1.2 * z.s, z.pos[2]])) { bd = d; best = z; }
      }
      sv.target = best;
      sv.threat = near0; sv.threatD = nd;
    }
    const tg = sv.target && !sv.target.dead ? sv.target : null;
    const threat = sv.threat && !sv.threat.dead ? sv.threat : null;
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
    // movement, in priority order: back away from a close threat (never past the post logic below, just
    // reposition), else drift back if it strayed past the leash or is low on health, else hold a post —
    // it keeps shooting through all of this.
    const c = room.map.core, distCore = Math.hypot(sv.pos[0] - c.x, sv.pos[2] - c.z);
    let tx, tz;
    if (threat && sv.threatD < SURVIVOR.retreat) {
      const ddx = sv.pos[0] - threat.pos[0], ddz = sv.pos[2] - threat.pos[2], dl = Math.hypot(ddx, ddz) || 1;
      tx = sv.pos[0] + (ddx / dl) * 4; tz = sv.pos[2] + (ddz / dl) * 4;
    } else if (distCore > SURVIVOR.leash || sv.hp < sv.maxHp * 0.35) {
      const a = Math.atan2(sv.pos[2] - c.z, sv.pos[0] - c.x);
      tx = c.x + Math.cos(a) * 3.6; tz = c.z + Math.sin(a) * 3.6;
    } else {
      if (!sv.post || now > sv.postAt || sv.stuck > 1.5) { sv.post = this.pickPost(sv); sv.postAt = now + 9000 + Math.random() * 5000; sv.stuck = 0; }
      [tx, tz] = sv.post;
    }
    if (sv.stuck > 2.5 && now >= sv.sidestepAt) { sv.sidestepAng = Math.random() * Math.PI * 2; sv.sidestepAt = now + 500; sv.stuck = 0; } // jammed on a corner: nudge sideways
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
    // face whatever it's shooting at, or the nearest threat while backing off — never its own retreat path
    const lookAt = tg ?? (threat && sv.threatD < SURVIVOR.retreat ? threat : null);
    const face = lookAt ? Math.atan2(-(lookAt.pos[0] - sv.pos[0]), -(lookAt.pos[2] - sv.pos[2])) : l > 0.6 ? Math.atan2(-dx, -dz) : sv.yaw;
    sv.yaw = wrap(sv.yaw + Math.max(-dt * 8, Math.min(dt * 8, wrap(face - sv.yaw))));
    if (sv.pos[1] < -3) { sv.pos[0] = room.map.core.x + 3; sv.pos[1] = 0; sv.pos[2] = room.map.core.z; }
  }

  syncTo(p) {
    for (const sv of this.list.values()) this.room.send(p, { t: 'svadd', id: sv.id, name: sv.name, tier: sv.tier, cls: sv.cls });
  }
}

const shelterName = s => (s.z < 0 ? 'north' : 'south') + (s.x < 0 ? 'west' : 'east');
export { RESCUE_WAVES };
