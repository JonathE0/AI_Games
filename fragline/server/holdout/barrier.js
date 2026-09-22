// The Tank's barrier (shared/holdout.js BARRIER): right-click with any gun but a sniper raises a wall of energy in
// front of you, facing your aim. Zombie swings, globs, sniper shots and boss projectiles that reach it from the
// front hit it instead of whoever stands behind it; it never blocks movement. State lives on the player (p.bar).
// Anything new that shoots at players should run its hit through room.barriers.stop(from, to, dmg, zombie, ranged) first
// (the Ronin's Deflect hooks in there too).
import { BARRIER as B, canBarrier } from '../../shared/holdout.js';

// Where segment a -> b enters p's barrier from the front, as a fraction of the way (-1: it doesn't).
export function barrierCross(p, a, b) {
  const fx = -Math.sin(p.st.y), fz = -Math.cos(p.st.y), cx = p.st.p[0] + fx * B.dist, cz = p.st.p[2] + fz * B.dist;
  const sa = (a[0] - cx) * fx + (a[2] - cz) * fz, sb = (b[0] - cx) * fx + (b[2] - cz) * fz;
  if (!(sa > 0 && sb <= 0)) return -1; // from behind (or alongside) it passes
  const t = sa / (sa - sb), x = a[0] + (b[0] - a[0]) * t - cx, z = a[2] + (b[2] - a[2]) * t - cz, h = a[1] + (b[1] - a[1]) * t - p.st.p[1];
  return Math.abs(x * fz - z * fx) <= B.width / 2 && h >= 0 && h <= B.height ? t : -1;
}

export class Barriers {
  constructor(room) { this.room = room; this.flushAt = 0; }

  reset() { for (const p of this.room.players) p.bar = null; }

  state(p) { return (p.bar ??= { up: false, hp: B.hp, regenAt: 0, readyAt: 0, dirty: false }); }

  allowed(p) { return p.cls === 'tank' && p.alive && !p.downed && !p.carrying && canBarrier(p.st.w) && this.room.hasWeapon(p, p.st.w); }

  // m: { on, w } — right-click held or let go, with the gun in hand (its 'st' may still be on the way after a swap).
  // A refused raise (broken, empty, wrong gun) tells only the asker.
  onMsg(p, m) {
    const bar = this.state(p);
    if (!m.on) return this.lower(p);
    if (canBarrier(m.w)) p.st.w = m.w;
    if (bar.up) return;
    if (!this.allowed(p) || Date.now() < bar.readyAt || bar.hp < 1) return this.room.send(p, { ...this.msg(p), no: 1 });
    bar.up = true;
    this.room.broadcast(this.msg(p));
  }

  lower(p, now = Date.now()) {
    const bar = p.bar;
    if (!bar?.up) return;
    bar.up = false;
    bar.regenAt = now + B.delay;
    this.room.broadcast(this.msg(p));
  }

  // Soaks dmg; at 0 it breaks: down for the cooldown, then it regrows from nothing.
  damage(p, dmg) {
    const bar = p.bar, now = Date.now();
    bar.hp -= dmg || 0;
    if (bar.hp > 0) { bar.dirty = true; return; }
    Object.assign(bar, { up: false, hp: 0, dirty: false, regenAt: now + B.cooldown, readyAt: now + B.cooldown });
    this.room.broadcast({ ...this.msg(p), broke: 1 });
  }

  // The first raised barrier segment a -> b runs into from the front soaks dmg. Returns where it hit, else null.
  // A Ronin's Deflect in the way first blocks it instead (ronin.js deflect): src = the zombie behind the attack,
  // ranged = a glob or sniper shot (reflected back at src) rather than a swing.
  stop(a, b, dmg, src = null, ranged = false) {
    let best = null, bt = Infinity;
    for (const p of this.room.players) {
      const t = p.bar?.up ? barrierCross(p, a, b) : -1;
      if (t >= 0 && t < bt) { bt = t; best = p; }
    }
    const parried = this.room.ronin.deflect(a, b, dmg, src, ranged, bt);
    if (parried) return parried;
    if (!best) return null;
    this.damage(best, dmg);
    return a.map((v, i) => v + (b[i] - v) * bt);
  }

  update(dt, now) {
    for (const p of this.room.players) {
      const bar = p.bar;
      if (!bar) continue;
      if (bar.up && !this.allowed(p)) this.lower(p, now); // died, went down, switched to a sniper, changed class…
      if (!bar.up && now >= bar.regenAt && bar.hp < B.hp) bar.hp = Math.min(B.hp, bar.hp + B.regen * dt);
    }
    if (now - this.flushAt < 100) return; // hits while it's up: HP (the cracks) at most 10×/s
    this.flushAt = now;
    for (const p of this.room.players) if (p.bar?.dirty) { p.bar.dirty = false; this.room.broadcast(this.msg(p)); }
  }

  msg(p) {
    const bar = this.state(p);
    return { t: 'bar', id: p.id, up: bar.up ? 1 : 0, hp: Math.round(bar.hp), cd: Math.max(0, bar.readyAt - Date.now()) };
  }

  syncTo(q) { for (const p of this.room.players) if (p.bar?.up) this.room.send(q, this.msg(p)); }
}
