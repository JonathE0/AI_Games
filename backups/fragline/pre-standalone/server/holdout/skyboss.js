// Server side of the Colossus (wave 5): spawns, bombs the fort from the sky, drops runners, and can only be
// killed by destroying its weak points with sniper rifles. Its path is shared/skyboss.js (pure function of t).
import { SKY, SKY_POINTS, skyTransform, skyPoint, raySphere } from '../../shared/skyboss.js';
import { rollLoot, MONEY_CAP } from '../../shared/holdout.js';
import { bossCycle } from '../../shared/zombies.js';

export class SkyBoss {
  constructor(room) { this.room = room; this.state = null; }

  reset() { this.state = null; }
  get alive() { return !!this.state && !this.state.dead; }
  time(now) { return (now - this.state.t0) / 1000; }

  spawn(now = Date.now(), wave = SKY.wave) {
    const hp = Math.round(SKY.pointHp * (1 + 0.5 * (this.room.activeCount() - 1)) * (1 + 0.5 * bossCycle(wave))); // stronger every time around
    this.state = { t0: now, hp: SKY_POINTS.map(() => hp), max: hp, nextBomb: now + 7000, nextMinions: now + 20000, dead: false, backAlerted: false };
    this.room.broadcast({ t: 'sky', el: 0, hp: this.state.hp, max: hp });
  }

  update(now) {
    const s = this.state, room = this.room;
    if (!this.alive || room.phase !== 'wave') return;
    const t = this.time(now), tr = skyTransform(t);
    if (now >= s.nextBomb) {
      s.nextBomb = now + SKY.bombEvery * 1000;
      const players = room.players.filter(p => p.alive && !p.downed), pieces = room.builds();
      const roll = Math.random();
      let tgt;
      if (roll < 0.35 && players.length) { const p = players[(Math.random() * players.length) | 0]; tgt = [p.st.p[0], p.st.p[1] + 0.9, p.st.p[2]]; }
      else if (roll < 0.65 && pieces.length) { const b = pieces[(Math.random() * pieces.length) | 0].box; tgt = [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2]; }
      else tgt = [room.map.core.x + (Math.random() - 0.5) * 3, 1.5, room.map.core.z + (Math.random() - 0.5) * 3];
      const o = [tr.x, tr.y + 0.9 * SKY.scale, tr.z], T = Math.min(4, Math.max(2.2, Math.hypot(tgt[0] - o[0], tgt[2] - o[2]) / 14));
      const v = [(tgt[0] - o[0]) / T, (tgt[1] - o[1]) / T + 0.5 * 12 * T, (tgt[2] - o[2]) / T];
      room.addProjectile(o, v, { id: 0, pos: o, t: { dmg: SKY.bombDmg, sdmg: SKY.bombSdmg, splash: SKY.bombSplash, name: 'the Colossus' } }, 'bomb');
    }
    if (now >= s.nextMinions) {
      s.nextMinions = now + SKY.minionsEvery * 1000;
      const lane = room.map.lanes[(Math.random() * room.map.lanes.length) | 0].id;
      for (let i = 0; i < 3; i++) room.spawnZombie('runner', lane);
    }
  }

  // Sniper hit claim on weak point i: the shot ray must pass that point within the last ~400 ms.
  hit(p, i, o, d, dmg, now = Date.now()) {
    const s = this.state;
    if (!this.alive || !(s.hp[i] > 0) || !Array.isArray(d) || !d.every(Number.isFinite)) return false;
    const l = Math.hypot(...d);
    if (!l) return false;
    const u = d.map(v => v / l), t = this.time(now);
    let ok = false;
    for (let k = 0; k <= 4 && !ok; k++) ok = raySphere(o, u, skyPoint(t - k * 0.1, i), SKY.pointR + 0.4) >= 0;
    if (!ok) return false;
    s.hp[i] = Math.max(0, s.hp[i] - dmg);
    p.stats.dmg += Math.round(dmg);
    this.room.broadcast({ t: 'skyhit', i, hp: Math.round(s.hp[i]), by: p.id });
    if (s.hp.every(h => h <= 0)) this.die(p);
    else if (!s.backAlerted) {
      const remaining = s.hp.map((h, j) => (h > 0 ? j : -1)).filter(j => j >= 0);
      if (remaining.length && remaining.every(j => SKY_POINTS[j][2] > 0)) { // every point left is on its back (local z > 0)
        s.backAlerted = true;
        this.room.broadcast({ t: 'task', text: "The last weak point is on the Colossus' BACK — get behind it!" });
        this.room.broadcast({ t: 'skyback', i: remaining[0] });
      }
    }
    return true;
  }

  die(p) {
    const room = this.room, s = this.state, tr = skyTransform(this.time(Date.now()));
    s.dead = true;
    for (const q of room.players) { q.money = Math.min(MONEY_CAP, q.money + SKY.reward); room.sendInv(q); }
    const a = Math.atan2(tr.z, tr.x), at = [room.map.core.x + Math.cos(a) * 9, 0, room.map.core.z + Math.sin(a) * 9];
    room.inventory.scatter([{ kind: 'gun', w: 'skybreaker', r: 4, tier: 3, el: null }, ...rollLoot('boss')], at, 2.4, true);
    room.broadcast({ t: 'msg', text: 'The Colossus dropped the Skybreaker!' });
    room.broadcast({ t: 'skydie', by: p?.id ?? null, x: at[0], z: at[2] });
  }

  syncTo(p) {
    if (this.alive) this.room.send(p, { t: 'sky', el: Date.now() - this.state.t0, hp: this.state.hp, max: this.state.max });
  }
}
