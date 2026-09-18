// Wave director: picks the lanes each wave attacks from (announced ahead, shifting between waves),
// builds the wave from a budget scaled by player count and difficulty, and feeds zombies in groups
// without exceeding the alive cap. Joins/leaves mid-wave grow or trim what is still waiting to spawn.
import { OUTPOST } from '../../shared/outpost.js';
import {
  ZTYPES, composeWave, waveBudget, laneCount, hpMult, dmgMult, aliveCap, countMult, bossFor, alphaWave, nightRoll,
  waveTimeLimit, BERSERK_SPEED_MULT, BERSERK_DMG_MULT, berserkGroupSize, BERSERK_INTERVAL,
} from '../../shared/zombies.js';

const BOSS_HORDE = 0.5; // boss waves send a lighter ground horde without Brutes (the boss makes up the rest)

export class Director {
  constructor(room, rng = Math.random) {
    this.room = room;
    this.rng = rng;
    this.reset();
  }

  reset() {
    Object.assign(this, {
      wave: 0, queue: [], lanes: [], planned: null, lastLanes: [], nextGroup: {}, n: 1, hpMul: 1, dmgMul: 1,
      deadline: Infinity, timeLimit: 0, berserk: false, berserkOriginals: null, nextReinforce: 0,
    });
  }

  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // Choose (and remember) the lanes wave w will use; lanes that were quiet last wave go first.
  plan(w) {
    const count = laneCount(this.room.activeCount(), w);
    const ids = this.shuffle(OUTPOST.lanes.map(l => l.id));
    ids.sort((a, b) => this.lastLanes.includes(a) - this.lastLanes.includes(b));
    this.planned = { wave: w, lanes: ids.slice(0, count), night: nightRoll(w, this.rng), boss: bossFor(w) };
    return this.planned.lanes;
  }

  start(w, now = Date.now()) {
    const n = this.room.activeCount();
    if (this.planned?.wave !== w) this.plan(w);
    Object.assign(this, {
      wave: w, n, lanes: this.planned.lanes, lastLanes: this.planned.lanes, hpMul: hpMult(n, w), dmgMul: dmgMult(w), night: this.planned.night,
      deadline: now + waveTimeLimit(w) * 1000, timeLimit: waveTimeLimit(w) * 1000, berserk: false, berserkOriginals: null, nextReinforce: 0,
    });
    const boss = bossFor(w), budget = waveBudget(w, n, this.room.diff) * (boss ? BOSS_HORDE : 1);
    this.queue = this.shuffle(composeWave(w, n, this.room.diff, this.rng, budget, this.night).filter(id => !boss || id !== 'brute'));
    if (alphaWave(w)) this.queue.splice(Math.floor(this.queue.length * 0.7), 0, 'alpha'); // pop() order: arrives ~30 % in
    for (const l of this.lanes) this.nextGroup[l] = now + 1500 + this.rng() * 1500;
  }

  // Player count changed mid-wave: scale what's left to spawn by the count multiplier ratio.
  rescale(n) {
    if (n === this.n) return;
    const ratio = countMult(n) / countMult(this.n);
    const left = this.queue.reduce((s, id) => s + ZTYPES[id].cost, 0);
    if (ratio > 1 && left > 0) {
      this.queue.push(...composeWave(this.wave, n, 1, this.rng, left * (ratio - 1), this.night));
      this.shuffle(this.queue);
      const a = this.queue.indexOf('alpha'); // keep the boss roughly where it was
      if (a >= 0) { this.queue.splice(a, 1); this.queue.splice(Math.floor(this.queue.length * 0.7), 0, 'alpha'); }
    } else if (ratio < 1) {
      const keep = Math.ceil(this.queue.length * ratio);
      const boss = this.queue.includes('alpha');
      this.queue = this.queue.filter(id => id !== 'alpha').slice(0, keep - (boss ? 1 : 0));
      if (boss) this.queue.splice(Math.floor(this.queue.length * 0.7), 0, 'alpha');
    }
    this.n = n;
    this.hpMul = hpMult(n, this.wave);
  }

  update(now) {
    if (this.berserk || now >= this.deadline) this.checkBerserk(now);
    if (!this.queue.length) return;
    const cap = aliveCap(this.n);
    for (const l of this.lanes) {
      if (now < (this.nextGroup[l] ?? 0) || !this.queue.length) continue;
      const free = cap - this.room.zombies.size;
      if (free <= 0) { this.nextGroup[l] = now + 600; continue; }
      const size = Math.min(free, this.queue.length, 3 + Math.floor(this.rng() * 5));
      for (let i = 0; i < size; i++) this.room.spawnZombie(this.queue.pop(), l);
      this.nextGroup[l] = now + 2500 + this.rng() * 2500;
    }
  }

  // Time's up: normal spawns stop, everything still alive ("the originals", bosses included) goes berserk
  // (faster, harder-hitting, red-glowing, beelines for the Core) and shows on the minimap. While any original
  // survives, more berserk reinforcements trickle in from the active lanes — worth no money or loot. The
  // instant the last original dies, every reinforcement vanishes and the wave clears normally.
  checkBerserk(now) {
    const room = this.room;
    if (!this.berserk) {
      this.berserk = true;
      this.queue = [];
      this.berserkOriginals = new Set(room.zombies.keys());
      for (const z of room.zombies.values()) this.makeBerserk(z, false);
      this.nextReinforce = now + BERSERK_INTERVAL * 1000;
      room.broadcast({ t: 'berserk', ev: 'start' });
      room.broadcast({ t: 'task', text: "TIME'S UP — THE HORDE GOES BERSERK! Kill the stragglers to end the wave" });
      return;
    }
    for (const id of this.berserkOriginals) if (!room.zombies.has(id)) this.berserkOriginals.delete(id);
    if (this.berserkOriginals.size === 0) { // the last original died: every reinforcement vanishes, no reward
      for (const z of [...room.zombies.values()]) room.removeZombie(z, false);
      this.berserk = false;
      room.broadcast({ t: 'berserk', ev: 'end' });
      return;
    }
    if (now >= this.nextReinforce) { this.nextReinforce = now + BERSERK_INTERVAL * 1000; this.spawnReinforcements(now); }
  }

  spawnReinforcements(now) {
    const room = this.room, cap = aliveCap(this.n);
    const free = cap - room.zombies.size;
    if (free <= 0 || !this.lanes.length) return;
    const budget = Math.max(1, waveBudget(this.wave, this.n, room.diff) * 0.12); // small groups, not a full wave
    const ids = composeWave(this.wave, this.n, room.diff, this.rng, budget, this.night);
    const n = Math.min(berserkGroupSize(this.n), ids.length, free), lane = this.lanes[Math.floor(this.rng() * this.lanes.length)];
    for (let i = 0; i < n; i++) this.makeBerserk(room.spawnZombie(ids[i], lane), true);
  }

  makeBerserk(z, reinforcement) {
    z.berserk = true;
    z.aggro = null;
    z.spd = (z.spd ?? 1) * BERSERK_SPEED_MULT;
    z.dmgMul = (z.dmgMul ?? 1) * BERSERK_DMG_MULT;
    if (reinforcement) z.noReward = true;
  }

  get remaining() { return this.queue.length; }
  done() { return !this.queue.length && this.room.zombies.size === 0 && !this.room.sky?.alive && !this.room.bosses?.busy(); }
}
