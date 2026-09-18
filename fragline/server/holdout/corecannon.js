// The Core's own defense: an indestructible auto-turret mounted on its roof. Targets the nearest zombie in
// range with line of sight, same as the placed turrets in defenses.js — unlimited ammo, active through every
// wave. Bought upgrades (shop CORE tab) raise room.coreLevel by one each time, which both prices the next
// upgrade and gates it behind a wave (buy while room.wave >= 5 * room.coreLevel).
import { CORE_CANNON, CORE_UPS, CORE_UP_IDS, coreUpPrice } from '../../shared/holdout.js';

const POS = [0, 2.2, 0]; // atop the Core's roof
const ELS = ['fire', 'ice', 'shock'];

export class CoreCannon {
  constructor(room) { this.room = room; this.reset(); }

  reset() {
    this.room.coreUps = Object.fromEntries(CORE_UP_IDS.map(id => [id, 0]));
    this.room.coreLevel = 0;
    this.next = 0;
    this.target = null;
    this.fx = [];
    this.fxAt = 0;
  }

  price() { return coreUpPrice(this.room.coreLevel); }
  unlocked() { return this.room.wave >= 5 * this.room.coreLevel; }

  // m: { id, bank }
  onBuy(p, id, bank) {
    const room = this.room, u = CORE_UPS[id], deny = text => room.send(p, { t: 'deny', text });
    if (!u) return;
    if (!room.canBuy(p)) return deny('Buy inside the ring around the Core');
    if (u.max && (room.coreUps[id] || 0) >= u.max) return deny('Already maxed');
    if (!this.unlocked()) return deny(`Unlocks at wave ${5 * room.coreLevel}`);
    const price = this.price(), payer = bank ? room.inventory.stash : p;
    if (payer.money < price) return deny(bank ? 'The team bank is short' : 'Not enough money');
    payer.money -= price;
    room.coreUps[id] = (room.coreUps[id] || 0) + 1;
    room.coreLevel++;
    if (id === 'plating') { const add = room.core.max * 0.15; room.core.max += add; room.core.hp += add; }
    room.broadcast({ t: 'msg', text: `${p.name} upgraded the Core cannon: ${u.name}` });
    room.broadcast({ t: 'coreups', ups: room.coreUps, level: room.coreLevel });
    room.sendInv(p);
    if (bank) room.inventory.broadcastStash();
  }

  update(dt, now) {
    const room = this.room;
    if (room.phase !== 'wave') { this.target = null; return; }
    if (now < this.next) return;
    const ups = room.coreUps, range = CORE_CANNON.range * (1 + 0.15 * (ups.range || 0));
    const eye = [POS[0], POS[1] + 1.3, POS[2]];
    const cands = [];
    for (const z of room.zombies.values()) {
      if (z.dead) continue;
      const d = Math.hypot(z.pos[0] - eye[0], z.pos[2] - eye[2]);
      if (d <= range && room.lineOfSight(eye, [z.pos[0], z.pos[1] + 1.1 * z.s, z.pos[2]])) cands.push([d, z]);
    }
    if (!cands.length) { this.next = now + 200; this.target = null; return; }
    cands.sort((a, b) => a[0] - b[0]);
    const targets = cands.slice(0, 1 + (ups.barrels || 0)).map(c => c[1]);
    this.target = targets[0];
    this.next = now + 1000 / (CORE_CANNON.rate * (1 + 0.25 * (ups.rate || 0)));
    const dmg = CORE_CANNON.dmg * (1 + 0.35 * (ups.dmg || 0)) * (room.buffActive('damage') ? 1.3 : 1);
    const elements = ELS.filter(el => ups[el]);
    const ids = [];
    for (const z of targets) {
      room.damageZombie(z, dmg, null, 'corecannon');
      for (const el of elements) if (!z.dead) room.applyElement(z, el, dmg, null);
      ids.push(z.id);
    }
    this.fx.push(ids);
    if (this.fx.length && now - this.fxAt > 100) { this.fxAt = now; room.broadcast({ t: 'corefx', l: this.fx }); this.fx = []; }
  }

  syncTo(p) { this.room.send(p, { t: 'coreups', ups: this.room.coreUps, level: this.room.coreLevel }); }
}
