// Placed defenses: floor spikes and flame grills on built floors, wall darts on a wall face, auto turrets,
// rocket turrets and campfires on the ground or on a floor. Traps credit their owner with kills.
import { DEFENSES, ITEMS } from '../../shared/holdout.js';
import { GRID, REACH, distToBox, overlaps } from '../../shared/build.js';
import { addItem, countOf, takeItem } from './inventory.js';

const r2 = v => Math.round(v * 100) / 100;

export class Defenses {
  constructor(room) { this.room = room; this.reset(); }

  reset() {
    this.list = new Map();
    this.nextId = 1;
    this.fx = [];      // turret shots / trap bursts to broadcast
    this.fxAt = 0;
  }

  tuple(d) { return [d.id, d.type, r2(d.pos[0]), r2(d.pos[1]), r2(d.pos[2]), d.axis ?? 0, d.side ?? 0, d.pid ?? 0, d.owner]; }

  // m: { item, pid (floor / wall piece), side (+1/-1 wall face), i, k (tile for ground defenses) }
  onPlace(p, m) {
    const room = this.room, it = ITEMS[m.item], deny = text => room.send(p, { t: 'deny', text });
    if (!it || (it.kind !== 'trap' && it.kind !== 'deploy') || !(countOf(p, m.item) > 0) || !p.alive || p.downed) return;
    const eye = room.eye(p), C = GRID.cell;
    let d;
    if (it.mount === 'floor' || it.mount === 'wall') {
      const s = room.pieces.get(m.pid);
      if (!s || s.kind !== it.mount) return deny(`Place it on a ${it.mount}`);
      if (distToBox(eye, s.box) > REACH) return deny('Too far away');
      const slot = it.mount === 'floor' ? 0 : (m.side > 0 ? 1 : -1); // side: 0 floor top, ±1 wall face, 2 ground
      if ([...this.list.values()].some(x => x.pid === s.id && x.side === slot)) return deny('Already trapped');
      const b = s.box;
      if (it.mount === 'floor') {
        d = { pos: [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2], area: { min: [b.min[0], b.max[1] - 0.2, b.min[2]], max: [b.max[0], b.max[1] + 1.6, b.max[2]] }, side: 0 };
      } else {
        const ax = s.o === 0 ? 2 : 0, face = slot > 0 ? b.max[ax] : b.min[ax], area = { min: [...b.min], max: [...b.max] };
        if (slot > 0) { area.min[ax] = b.max[ax]; area.max[ax] = b.max[ax] + DEFENSES.darts.depth; }
        else { area.max[ax] = b.min[ax]; area.min[ax] = b.min[ax] - DEFENSES.darts.depth; }
        const pos = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
        pos[ax] = face;
        d = { pos, area, side: slot, axis: ax };
      }
      d.pid = s.id;
    } else {
      const i = m.i | 0, k = m.k | 0, x = GRID.x0 + (i + 0.5) * C, z = GRID.z0 + (k + 0.5) * C;
      const floor = [...room.pieces.values()].find(s => s.kind === 'floor' && s.i === i && s.k === k && s.id === m.pid);
      const y = floor ? floor.box.max[1] : 0;
      if (Math.hypot(x - room.map.core.x, z - room.map.core.z) > room.map.zone) return deny('Outside the build zone');
      if (Math.hypot(x - eye[0], y - eye[1] + 1, z - eye[2]) > REACH + 1) return deny('Too far away');
      const foot = { min: [x - 0.6, y + 0.05, z - 0.6], max: [x + 0.6, y + 1.4, z + 0.6] };
      if (overlaps(foot, room.map.core.box)) return deny('Too close to the Core');
      if (room.statics.some(b => b.mat !== 'f' && overlaps(foot, b)) || room.aliveNodeBoxes().some(b => overlaps(foot, b))) return deny('Blocked');
      if ([...room.pieces.values()].some(s => s !== floor && s.boxes.some(b => !b.door && overlaps(foot, b)))) return deny('Blocked');
      if ([...this.list.values()].some(o => Math.hypot(o.pos[0] - x, o.pos[2] - z) < 1.5 && Math.abs(o.pos[1] - y) < 1)) return deny('Something is already there');
      d = { pos: [x, y, z], pid: floor?.id ?? 0, side: 2 };
    }
    const def = DEFENSES[m.item];
    Object.assign(d, { id: this.nextId++, type: m.item, owner: p.id, uses: def.uses ?? 0, ammo: def.ammo ?? 0, hp: def.hp ?? 0, next: 0, until: def.life ? Date.now() + def.life * 1000 : 0 });
    this.list.set(d.id, d);
    takeItem(p, m.item, 1);
    room.broadcast({ t: 'dadd', l: [this.tuple(d)] });
    room.sendInv(p);
  }

  remove(d, refund = false) {
    if (!this.list.delete(d.id)) return;
    if (refund) { const o = this.room.players.find(q => q.id === d.owner); if (o && addItem(o, d.type, 1)) this.room.sendInv(o); }
    this.room.broadcast({ t: 'ddel', id: d.id });
  }

  // A piece was destroyed (everything on it goes) or edited (traps mounted on it pop back into your backpack).
  pieceChanged(s, edited) { for (const d of [...this.list.values()]) if (d.pid === s.id && (!edited || d.side !== 2)) this.remove(d, edited); }

  inArea(z, a) {
    return z.pos[0] > a.min[0] && z.pos[0] < a.max[0] && z.pos[2] > a.min[2] && z.pos[2] < a.max[2] && z.pos[1] + 0.2 > a.min[1] && z.pos[1] < a.max[1];
  }

  owner(d) { return this.room.players.find(q => q.id === d.owner) || null; }

  // Blacksmith turret upgrades (d.mods: dmg / range / rate levels, inc / frost rounds, plate)
  maxAmmo(d) { return DEFENSES[d.type].ammo; }
  broadcastMods(d) { this.room.broadcast({ t: 'dmod', id: d.id, mods: d.mods ?? {}, ammo: d.ammo, hp: Math.round(d.hp) }); }

  update(dt, now) {
    const room = this.room;
    for (const d of [...this.list.values()]) {
      if (d.type === 'campfire') {
        if (now >= d.until) { this.remove(d); continue; }
        if (now < d.next) continue;
        d.next = now + 500;
        const heal = DEFENSES.campfire.heal * 0.5, shield = DEFENSES.campfire.shield * 0.5, shCap = ITEMS.shield.cap;
        for (const q of [...room.players, ...room.survivors.list.values()]) {
          if (!q.alive || q.downed || Math.hypot(q.st.p[0] - d.pos[0], q.st.p[2] - d.pos[2]) > DEFENSES.campfire.radius) continue;
          if (q.isSurvivor) { room.survivors.heal(q, heal * 3); continue; }
          const max = q.maxHp ?? 200;
          let changed = false;
          if (q.hp < max) { q.hp = Math.min(max, q.hp + heal); changed = true; }
          if (q.shield < shCap) { q.shield = Math.min(shCap, q.shield + shield); changed = true; }
          if (changed) room.send(q, { t: 'vit', hp: Math.round(q.hp), sh: Math.round(q.shield), rally: true }); // light update, twice a second
        }
        continue;
      }
      if (room.phase !== 'wave' || now < d.next) continue;
      const def = DEFENSES[d.type];
      if (d.type === 'spikes' || d.type === 'darts' || d.type === 'flame') {
        const hit = [...room.zombies.values()].filter(z => !z.dead && this.inArea(z, d.area));
        if (!hit.length) { d.next = now + 150; continue; }
        d.next = now + def.tick * 1000;
        for (const z of hit) {
          if (d.type === 'spikes') { z.slowUntil = now + 700; z.slow = Math.max(z.slow || 0, def.slow); }
          if (d.type === 'flame') { z.burnUntil = now + def.burnTime * 1000; z.burnDps = def.burn; z.burnBy = this.owner(d); }
          room.damageZombie(z, def.dmg, this.owner(d), d.type);
        }
        this.fx.push([d.id, 0]);
        if (--d.uses <= 0) this.remove(d);
      } else if (d.type === 'turret' || d.type === 'rturret') {
        const eye = [d.pos[0], d.pos[1] + 1.2, d.pos[2]], md = d.mods ?? {};
        let best = null, bd = def.range * (1 + 0.2 * (md.range || 0));
        for (const z of room.zombies.values()) {
          if (z.dead) continue;
          const dist = Math.hypot(z.pos[0] - eye[0], z.pos[2] - eye[2]);
          if (dist < bd && room.lineOfSight(eye, [z.pos[0], z.pos[1] + 1.1 * z.s, z.pos[2]])) { bd = dist; best = z; }
        }
        if (!best) { d.next = now + 250; continue; }
        d.next = now + 1000 / (def.rate * (1 + 0.2 * (md.rate || 0)));
        const aim = [best.pos[0], best.pos[1] + 1.1 * best.s, best.pos[2]], dmg = def.dmg * (1 + 0.25 * (md.dmg || 0)), el = md.inc ? 'fire' : md.frost ? 'ice' : null;
        if (d.type === 'turret') {
          room.damageZombie(best, dmg * (room.buffActive('damage') ? 1.3 : 1), this.owner(d), 'turret');
          if (el && !best.dead) room.applyElement(best, el, dmg, this.owner(d));
        } else {
          const dir = aim.map((v, j) => v - eye[j]), l = Math.hypot(...dir);
          room.combat.rocket([...eye], dir.map(v => v / l), this.owner(d), dmg, def.splash, el);
        }
        this.fx.push([d.id, best.id]);
        if (--d.ammo <= 0) this.remove(d);
      }
    }
    if (this.fx.length && now - this.fxAt > 100) { this.fxAt = now; room.broadcast({ t: 'dfx', l: this.fx }); this.fx = []; }
  }

  // turrets can be shot to pieces (zombie snipers go for them)
  damage(d, dmg) {
    if (!d.hp || this.list.get(d.id) !== d) return;
    d.hp -= dmg;
    if (d.hp <= 0) this.remove(d);
  }

  syncTo(p) { this.room.send(p, { t: 'dall', l: [...this.list.values()].map(d => this.tuple(d)) }); }
}
