// Wave director: picks the lanes each wave attacks from (announced ahead, shifting between waves),
// builds the wave from a budget scaled by player count and difficulty, and feeds zombies in groups
// without exceeding the alive cap. Joins/leaves mid-wave grow or trim what is still waiting to spawn.
import { OUTPOST } from '../../shared/outpost.js';
import { ZTYPES, composeWave, waveBudget, laneCount, hpMult, dmgMult, aliveCap, countMult, bossFor, alphaWave, nightRoll } from '../../shared/zombies.js';

const BOSS_HORDE = 0.5; // boss waves send a lighter ground horde without Brutes (the boss makes up the rest)

export class Director {
  constructor(room, rng = Math.random) {
    this.room = room;
    this.rng = rng;
    this.reset();
  }

  reset() {
    Object.assign(this, { wave: 0, queue: [], lanes: [], planned: null, lastLanes: [], nextGroup: {}, n: 1, hpMul: 1, dmgMul: 1 });
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
    Object.assign(this, { wave: w, n, lanes: this.planned.lanes, lastLanes: this.planned.lanes, hpMul: hpMult(n, w), dmgMul: dmgMult(w), night: this.planned.night });
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

  get remaining() { return this.queue.length; }
  done() { return !this.queue.length && this.room.zombies.size === 0 && !this.room.sky?.alive && !this.room.bosses?.busy(); }
}
