// Map events: RNG chests hidden around the Outpost (houses, ruins, shelters) and supply drops — crates that
// float down under balloons during waves. Both spill loot onto the ground when opened (hold E).
import { OUTPOST_CHESTS } from '../../shared/outpost.js';
import { rollLoot } from '../../shared/holdout.js';
import { rayWorld, blocked } from '../../shared/physics.js';

const r2 = v => Math.round(v * 100) / 100;
const DOWN = [0, -1, 0], near = [];

export class Events {
  constructor(room) { this.room = room; this.reset(); }

  reset() {
    this.chests = new Map();
    this.drops = new Map();
    this.nextDrop = 0;
    this.nextId = 1;
  }

  // Activate up to `count` chest spots (new ones appear on some breaks).
  refreshChests(count = 6) {
    const free = OUTPOST_CHESTS.filter(c => !this.chests.has(c.id)).sort(() => Math.random() - 0.5);
    while (this.chests.size < count && free.length) { const c = free.pop(); this.chests.set(c.id, c); }
    this.broadcastChests();
  }

  broadcastChests() { this.room.broadcast({ t: 'chests', l: [...this.chests.values()].map(c => [c.id, c.x, c.z]) }); }

  onOpen(p, m) {
    if (!p.alive || p.downed) return;
    const room = this.room;
    if (m.kind === 'chest') {
      const c = this.chests.get(m.id);
      if (!c || Math.hypot(c.x - p.st.p[0], c.z - p.st.p[2]) > 2.6) return;
      this.chests.delete(c.id);
      room.inventory.scatter(rollLoot('chest'), [c.x, 0, c.z], 1.3);
      room.broadcast({ t: 'opened', kind: 'chest', x: c.x, z: c.z });
      this.broadcastChests();
    } else if (m.kind === 'drop') {
      const d = this.drops.get(m.id);
      if (!d || !d.landed || Math.hypot(d.x - p.st.p[0], d.z - p.st.p[2]) > 2.9) return;
      this.drops.delete(d.id);
      room.inventory.scatter(rollLoot('drop'), [d.x, d.y, d.z], 1.8);
      room.broadcast({ t: 'sddel', id: d.id, opened: true });
    }
  }

  scheduleWave(now) { this.nextDrop = now + 25000 + Math.random() * 20000; }

  spawnDrop() {
    const room = this.room;
    let x = 0, z = 0;
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 26;
      x = room.map.core.x + Math.cos(a) * r; z = room.map.core.z + Math.sin(a) * r;
      if (!blocked(x, 0, z, 1.2, room.grid.query(x - 1, z - 1, x + 1, z + 1, near))) break;
    }
    const d = { id: this.nextId++, x, z, y: 60, speed: 3.5, landed: false };
    this.drops.set(d.id, d);
    room.broadcast({ t: 'sdrop', id: d.id, x: r2(x), z: r2(z), y: d.y, v: d.speed });
    room.broadcast({ t: 'msg', text: 'A supply drop is coming down — grab it!' });
  }

  // somebody shot the balloons: it drops fast
  onBalloon(p, m) {
    const d = this.drops.get(m.id);
    if (!d || d.landed || d.speed > 4) return;
    d.speed = 14;
    this.room.broadcast({ t: 'sdrop', id: d.id, x: r2(d.x), z: r2(d.z), y: r2(d.y), v: d.speed, popped: true });
  }

  update(dt, now) {
    const room = this.room;
    if (room.phase === 'wave' && now >= this.nextDrop) {
      this.nextDrop = now + 70000 + Math.random() * 30000;
      if ([...this.drops.values()].filter(d => !d.landed).length < 2) this.spawnDrop();
    }
    for (const d of this.drops.values()) {
      if (d.landed) continue;
      d.y -= d.speed * dt;
      const hit = rayWorld([d.x, d.y + 0.5, d.z], DOWN, 2, room.grid.query(d.x - 0.6, d.z - 0.6, d.x + 0.6, d.z + 0.6, near));
      const ground = hit ? d.y + 0.5 - hit.t : -Infinity;
      if (d.y <= Math.max(0, ground)) { d.y = Math.max(0, ground); d.landed = true; room.broadcast({ t: 'sdland', id: d.id, y: r2(d.y) }); }
    }
  }

  syncTo(p) {
    this.room.send(p, { t: 'chests', l: [...this.chests.values()].map(c => [c.id, c.x, c.z]) });
    for (const d of this.drops.values()) {
      this.room.send(p, { t: 'sdrop', id: d.id, x: r2(d.x), z: r2(d.z), y: r2(d.y), v: d.speed });
      if (d.landed) this.room.send(p, { t: 'sdland', id: d.id, y: r2(d.y) });
    }
  }
}
