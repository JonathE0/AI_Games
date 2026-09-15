// Holdout backpacks: five gun slots, typed ammo, consumables, materials — plus the shop at the Core, the
// team chest (shared stash + pooled money), ground pickups and loot spilling. Server-authoritative.
import { WEAPONS, ECON } from '../../shared/weapons.js';
import { AMMO, AMMO_IDS, ITEMS, POWERUPS, GUN_SLOTS, MAT_CAP, SHOP_RARITY, START_AMMO, shopEntry } from '../../shared/holdout.js';
import { MAT_IDS } from '../../shared/build.js';

const r2 = v => Math.round(v * 100) / 100;

export function freshBackpack(room) {
  return {
    guns: [room.newItem('pistol', 0), null, null, null, null],
    ammo: { ...START_AMMO },
    items: {},
    shield: 0,
  };
}

export const gunIndex = (p, uid) => p.guns.findIndex(g => g && g.uid === uid);
export const carries = (p, w) => w === 'knife' || p.guns.some(g => g && g.w === w);

// Add up to the backpack cap. Returns how many actually fit.
export function addAmmo(p, type, n) {
  const room = AMMO[type] ? AMMO[type].cap - (p.ammo[type] || 0) : 0, add = Math.max(0, Math.min(n, room));
  if (add) p.ammo[type] = (p.ammo[type] || 0) + add;
  return add;
}
export function addItem(p, id, n = 1) {
  const it = ITEMS[id];
  if (!it) return 0;
  const add = Math.max(0, Math.min(n, it.max - (p.items[id] || 0)));
  if (add) p.items[id] = (p.items[id] || 0) + add;
  return add;
}
export function addMats(p, mat, n) {
  const add = Math.max(0, Math.min(n, MAT_CAP - (p.mats[mat] || 0)));
  p.mats[mat] = (p.mats[mat] || 0) + add;
  return add;
}

export class Inventory {
  constructor(room) {
    this.room = room;
    this.reset();
  }

  reset() {
    this.pickups = new Map();
    this.nextId = 1;
    this.stash = { money: 0, mats: { wood: 0, stone: 0, metal: 0 }, ammo: Object.fromEntries(AMMO_IDS.map(t => [t, 0])), items: {} };
    this.autoAt = 0;
  }

  // Put a gun into the first free slot, or swap it with `slot` (the old gun lands on the ground).
  giveGun(p, item, slot = 0) {
    const free = p.guns.findIndex(g => !g);
    if (free >= 0) { p.guns[free] = item; return null; }
    const i = Math.max(0, Math.min(GUN_SLOTS - 1, slot | 0)), old = p.guns[i];
    p.guns[i] = item;
    return old;
  }

  // ---------- ground pickups ----------
  // data: { kind: 'gun', w, r, mag? } | { kind: 'ammo', type, n } | { kind: 'mats', mat, n } | { kind: 'item', id, n } | { kind: 'svsupply' }
  spawn(data, pos) {
    const pk = { id: this.nextId++, ...data, pos: [r2(pos[0]), r2(pos[1]), r2(pos[2])] };
    if (pk.kind === 'gun') pk.uid = pk.uid ?? this.room.newItem(pk.w, pk.r).uid;
    this.pickups.set(pk.id, pk);
    this.room.broadcast({ t: 'pk', l: [this.tuple(pk)] });
    return pk;
  }

  // [id, kind, key (gun / ammo type / material / item id), rarity or count, x, y, z]
  tuple(pk) { return [pk.id, pk.kind, pk.w ?? pk.type ?? pk.mat ?? pk.itemId ?? '', pk.r ?? pk.n ?? 0, ...pk.pos]; }

  remove(pk) {
    if (!this.pickups.delete(pk.id)) return;
    this.room.broadcast({ t: 'pkdel', id: pk.id });
  }

  // Scatter a loot roll around a point (chest, supply drop, boss).
  scatter(list, at, radius = 1.6) {
    list.forEach((d, i) => {
      const a = (i / list.length) * Math.PI * 2 + Math.random() * 0.5, r = radius * (0.6 + Math.random() * 0.5);
      const data = d.kind === 'item' ? { kind: 'item', itemId: d.id, n: d.n } : d;
      this.spawn(data, [at[0] + Math.cos(a) * r, at[1] + 0.05, at[2] + Math.sin(a) * r]);
    });
  }

  // Apply a pickup to a player. Returns true when it was fully taken.
  take(p, pk, slot) {
    const room = this.room;
    if (pk.kind === 'gun') {
      const old = this.giveGun(p, { w: pk.w, uid: pk.uid, r: pk.r, mag: pk.mag }, slot);
      if (old) this.spawn({ kind: 'gun', w: old.w, r: old.r, uid: old.uid, mag: old.mag }, p.st.p);
      room.send(p, { t: 'got', text: `${WEAPONS[pk.w].name}`, r: pk.r });
      return true;
    }
    if (pk.kind === 'ammo') { pk.n -= addAmmo(p, pk.type, pk.n); return pk.n <= 0; }
    if (pk.kind === 'mats') { pk.n -= addMats(p, pk.mat, pk.n); return pk.n <= 0; }
    if (pk.kind === 'item') { pk.n -= addItem(p, pk.itemId, pk.n); return pk.n <= 0; }
    if (pk.kind === 'svsupply') { room.survivors.resupply(p); return true; }
    return false;
  }

  onPickup(p, m) {
    const pk = this.pickups.get(m.id | 0);
    if (!pk || !p.alive || p.downed) return;
    const d = Math.hypot(pk.pos[0] - p.st.p[0], pk.pos[1] - p.st.p[1], pk.pos[2] - p.st.p[2]);
    if (d > 2.8) return;
    const before = pk.n;
    if (this.take(p, pk, m.slot)) this.remove(pk);
    else if (pk.n !== before) this.room.broadcast({ t: 'pk', l: [this.tuple(pk)] });
    else this.room.send(p, { t: 'deny', text: 'Backpack full' });
    this.room.sendInv(p);
  }

  // Ammo and materials are grabbed just by walking over them.
  update(now) {
    if (now - this.autoAt < 200) return;
    this.autoAt = now;
    for (const pk of this.pickups.values()) {
      if (pk.kind !== 'ammo' && pk.kind !== 'mats') continue;
      for (const p of this.room.players) {
        if (!p.alive || p.downed || Math.hypot(pk.pos[0] - p.st.p[0], pk.pos[2] - p.st.p[2]) > 1.4 || Math.abs(pk.pos[1] - p.st.p[1]) > 2) continue;
        const before = pk.n;
        if (this.take(p, pk)) this.remove(pk);
        else if (pk.n !== before) this.room.broadcast({ t: 'pk', l: [this.tuple(pk)] });
        if (pk.n !== before) this.room.sendInv(p);
        if (!this.pickups.has(pk.id)) break;
      }
    }
  }

  onDropGun(p, m) {
    const i = m.slot | 0, g = p.guns[i];
    if (!g || !p.alive || p.downed) return;
    p.guns[i] = null;
    const mag = Number.isFinite(+m.mag) ? Math.max(0, Math.min(WEAPONS[g.w].mag, m.mag | 0)) : undefined;
    const d = [-Math.sin(p.st.y), 0, -Math.cos(p.st.y)];
    this.spawn({ kind: 'gun', w: g.w, r: g.r, uid: g.uid, mag }, [p.st.p[0] + d[0] * 1.2, p.st.p[1], p.st.p[2] + d[2] * 1.2]);
    this.room.sendInv(p);
  }

  // ---------- reloading from the backpack ----------
  onReload(p, m) {
    const i = gunIndex(p, m.uid), g = p.guns[i];
    if (!g) return;
    const w = WEAPONS[g.w], need = Math.max(0, Math.min(w.mag, m.need | 0)), n = Math.min(need, p.ammo[w.ammo] || 0);
    p.ammo[w.ammo] -= n;
    this.room.send(p, { t: 'grant', uid: g.uid, n });
    this.room.sendInv(p);
  }

  // ---------- shop (inside the ring around the Core) ----------
  onBuy(p, id, bank, slot) {
    const room = this.room, e = shopEntry(id), deny = text => room.send(p, { t: 'deny', text });
    if (!e) return;
    if (!room.canBuy(p)) return deny('Buy inside the ring around the Core');
    if (e.kind === 'power' && room.powerupRunning(id)) return deny('Already active');
    const payer = bank ? this.stash : p;
    if (payer.money < e.price) return deny(bank ? 'The team bank is short' : 'Not enough money');
    if (e.kind === 'gun') {
      if (p.guns.some(g => g && g.w === id)) return deny(`Already carrying the ${e.name}`);
      const old = this.giveGun(p, room.newItem(id, SHOP_RARITY), slot);
      if (old) this.spawn({ kind: 'gun', w: old.w, r: old.r, uid: old.uid }, p.st.p);
    } else if (e.kind === 'ammo') {
      if (!addAmmo(p, e.type, AMMO[e.type].pack)) return deny('That ammo is full');
    } else if (e.kind === 'item') {
      if (!addItem(p, id, 1)) return deny(`You can carry ${ITEMS[id].max}`);
    } else if (e.kind === 'power') {
      if (!room.applyPowerup(id, p)) return deny('Already active');
    }
    payer.money -= e.price;
    room.sendInv(p);
    room.send(p, { t: 'bought', item: id });
    if (bank) this.broadcastStash();
  }

  // ---------- team chest ----------
  nearStash(p) {
    const st = this.room.map.stash;
    return p.alive && !p.downed && Math.hypot(p.st.p[0] - st.x, p.st.p[2] - st.z) <= st.reach + 1;
  }

  // m: { op: 'put' | 'take', cat: 'money' | 'mats' | 'ammo' | 'items', key, n }
  onStash(p, m) {
    if (!this.nearStash(p)) return this.room.send(p, { t: 'deny', text: 'Stand next to the team chest' });
    const n = Math.max(0, Math.floor(+m.n || 0)), s = this.stash, put = m.op === 'put';
    if (!n) return;
    if (m.cat === 'money') {
      const from = put ? p : s, to = put ? s : p, v = Math.min(n, from.money, put ? Infinity : Math.max(0, ECON.max - p.money));
      from.money -= v; to.money += v;
    } else if (m.cat === 'mats' && MAT_IDS.includes(m.key)) {
      if (put) { const v = Math.min(n, p.mats[m.key]); p.mats[m.key] -= v; s.mats[m.key] += v; }
      else { const v = addMats(p, m.key, Math.min(n, s.mats[m.key])); s.mats[m.key] -= v; }
    } else if (m.cat === 'ammo' && AMMO[m.key]) {
      if (put) { const v = Math.min(n, p.ammo[m.key]); p.ammo[m.key] -= v; s.ammo[m.key] += v; }
      else { const v = addAmmo(p, m.key, Math.min(n, s.ammo[m.key])); s.ammo[m.key] -= v; }
    } else if (m.cat === 'items' && ITEMS[m.key]) {
      if (put) { const v = Math.min(n, p.items[m.key] || 0); p.items[m.key] = (p.items[m.key] || 0) - v; s.items[m.key] = (s.items[m.key] || 0) + v; }
      else { const v = addItem(p, m.key, Math.min(n, s.items[m.key] || 0)); s.items[m.key] -= v; }
    } else return;
    this.room.sendInv(p);
    this.broadcastStash();
  }

  broadcastStash() { this.room.broadcast({ t: 'stash', s: this.stash }); }

  syncTo(p) {
    this.room.send(p, { t: 'pkall', l: [...this.pickups.values()].map(pk => this.tuple(pk)) });
    this.room.send(p, { t: 'stash', s: this.stash });
  }
}

export { POWERUPS };
