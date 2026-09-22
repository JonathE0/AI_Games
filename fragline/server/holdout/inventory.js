// Holdout inventories: a Minecraft-style grid per player (6 hotbar + 18 backpack slots, 4 armor slots),
// typed ammo and building materials as plain counters, the shop at the Core, the team chest (a shared
// 18-slot grid plus pooled money / materials / ammo), ground pickups and loot spilling. Server-authoritative.
import { WEAPONS } from '../../shared/weapons.js';
import { AMMO, AMMO_IDS, ITEMS, POWERUPS, MAT_CAP, MONEY_CAP, SHOP_RARITY, START_AMMO, shopEntry, ammoCap, elementPrice, RARITY, rarityCost, sellPrice, itemValue, TEAM_UPS, ADREN_CARRY } from '../../shared/holdout.js';
import { ELEMENTS } from '../../shared/elements.js';
import { INV_SIZE, HOTBAR, STASH_SIZE, SACK_SIZE, ARMOR, ARMOR_SLOTS, ATTACH, stackMax, magFor, kindOf, placeItem, countIn, tierCost, itemName, isConsumable, fits } from '../../shared/items.js';
import { MAT_IDS } from '../../shared/build.js';
import { nextUid } from '../baseRoom.js';
import { P, topAt } from '../../shared/physics.js';

const r2 = v => Math.round(v * 100) / 100;
const FALL_TERMINAL = 16; // m/s

// ---------- items ----------
export const makeGun = (id, r = 0, tier = 1, el = null) => ({ uid: nextUid(), id, kind: 'gun', r, tier, el, att: {} });
export const makeItem = (id, n = 1) => ({ uid: nextUid(), id, kind: kindOf(id), n });
export const makeArmor = (id, tier = 1) => ({ uid: nextUid(), id, kind: 'armor', tier });
// loot tables and old callers describe items loosely: { kind: 'gun', w, r } / { kind: 'item', id, n } / …
export function itemFrom(d) {
  if (d.uid && d.id && d.kind && d.kind !== 'item') return d;
  if (d.kind === 'gun') return { ...makeGun(d.w ?? d.id, d.r ?? 0, d.tier ?? 1, d.el ?? null), ...(d.mag !== undefined ? { mag: d.mag } : {}) };
  if (d.kind === 'armor') return makeArmor(d.id, d.tier ?? 1);
  return makeItem(d.itemId ?? d.id, d.n ?? 1);
}

export function freshBackpack() {
  const inv = Array(INV_SIZE).fill(null);
  inv[0] = makeGun('pistol');
  return { inv, sack: Array(SACK_SIZE).fill(null), armor: Object.fromEntries(ARMOR_SLOTS.map(s => [s, null])), ammo: { ...START_AMMO }, shield: 0 };
}

export const gunByUid = (p, uid) => p.inv.find(it => it?.kind === 'gun' && it.uid === uid) ?? null;
export const carries = (p, w) => w === 'knife' || p.inv.some(it => it?.kind === 'gun' && it.id === w);
export const countOf = (p, id) => countIn(p.inv, id) + (p.sack ? countIn(p.sack, id) : 0);

// Remove up to n of a stackable item (the sack first, then the backpack). Returns how many were taken.
export function takeItem(p, id, n = 1) {
  let left = n;
  if (p.sack) for (let i = 0; i < SACK_SIZE && left > 0; i++) {
    const it = p.sack[i];
    if (it?.id !== id) continue;
    const k = Math.min(left, it.n ?? 1);
    it.n = (it.n ?? 1) - k;
    left -= k;
    if (it.n <= 0) p.sack[i] = null;
  }
  for (let i = INV_SIZE - 1; i >= 0 && left > 0; i--) {
    const it = p.inv[i];
    if (it?.id !== id) continue;
    const k = Math.min(left, it.n ?? 1);
    it.n = (it.n ?? 1) - k;
    left -= k;
    if (it.n <= 0) p.inv[i] = null;
  }
  return n - left;
}
// Consumables go to the sack first (stack, else a free slot), then the backpack as usual.
export function giveItem(p, item) {
  if (p.sack && isConsumable(item)) {
    const left = placeItem(p.sack, item, SACK_SIZE);
    if (!left) return null;
    item = left;
  }
  return placeItem(p.inv, item);
}

// Add up to the backpack cap. Returns how many actually fit.
export function addAmmo(p, type, n) {
  const room = AMMO[type] ? ammoCap(type, p.cls) - (p.ammo[type] || 0) : 0, add = Math.max(0, Math.min(n, room));
  if (add) p.ammo[type] = (p.ammo[type] || 0) + add;
  return add;
}
export function addItem(p, id, n = 1) {
  const it = makeItem(id, n), left = giveItem(p, it);
  return n - (left?.n ?? 0);
}
export function addMats(p, mat, n) {
  const add = Math.max(0, Math.min(n, MAT_CAP - (p.mats[mat] || 0)));
  p.mats[mat] = (p.mats[mat] || 0) + add;
  return add;
}

// Slot references used by the inventory UI: 'i0'..'i23' (your grid), 'a:head' … (armor), 's0'..'s17' (team
// chest), 'k0'..'k3' (the consumables sack).
function parseRef(ref) {
  const s = String(ref ?? '');
  if (s.startsWith('a:') && ARMOR_SLOTS.includes(s.slice(2))) return { box: 'a', key: s.slice(2) };
  const n = parseInt(s.slice(1), 10);
  if (s[0] === 'i' && n >= 0 && n < INV_SIZE) return { box: 'i', key: n };
  if (s[0] === 's' && n >= 0 && n < STASH_SIZE) return { box: 's', key: n };
  if (s[0] === 'k' && n >= 0 && n < SACK_SIZE) return { box: 'k', key: n };
  return null;
}

export class Inventory {
  constructor(room) {
    this.room = room;
    this.reset();
  }

  reset() {
    this.pickups = new Map();
    this.nextId = 1;
    this.stash = { money: 0, mats: Object.fromEntries(MAT_IDS.map(m => [m, 0])), ammo: Object.fromEntries(AMMO_IDS.map(t => [t, 0])), items: Array(STASH_SIZE).fill(null) };
    this.autoAt = 0;
    this.restAt = 0;
  }

  // ---------- ground pickups ----------
  // data: an item (or loot description) | { kind: 'ammo', type, n } | { kind: 'mats', mat, n } | { kind: 'svsupply' }
  // boss: true marks boss-loot drops, which linger twice as long before despawning.
  spawn(data, pos, boss = false) {
    const raw = data.kind === 'ammo' || data.kind === 'mats' || data.kind === 'svsupply';
    const life = (boss ? 8 : 4) * 60000;
    const pk = { id: this.nextId++, ...(raw ? data : { kind: 'it', item: itemFrom(data) }), pos: [r2(pos[0]), r2(pos[1]), r2(pos[2])], expire: Date.now() + life, vy: 0, resting: false };
    this.pickups.set(pk.id, pk);
    this.room.broadcast({ t: 'pk', l: [this.tuple(pk)] });
    return pk;
  }

  // [id, kind, key (item id / ammo type / material), rarity or count, x, y, z, { k, t, el, left (ms to despawn) }]
  tuple(pk) {
    const left = Math.max(0, (pk.expire ?? Infinity) - Date.now());
    if (pk.kind === 'it') {
      const it = pk.item;
      return [pk.id, 'it', it.id, it.kind === 'gun' ? it.r ?? 0 : it.n ?? 1, ...pk.pos, { k: it.kind, t: it.tier ?? 0, el: it.el ?? null, left }];
    }
    return [pk.id, pk.kind, pk.type ?? pk.mat ?? '', pk.n ?? 0, ...pk.pos, { left }];
  }

  remove(pk) {
    if (!this.pickups.delete(pk.id)) return;
    this.room.broadcast({ t: 'pkdel', id: pk.id });
  }

  // Scatter a loot roll around a point (chest, supply drop, boss).
  scatter(list, at, radius = 1.6, boss = false) {
    list.forEach((d, i) => {
      const a = (i / list.length) * Math.PI * 2 + Math.random() * 0.5, r = radius * (0.6 + Math.random() * 0.5);
      this.spawn(d, [at[0] + Math.cos(a) * r, at[1] + 0.05, at[2] + Math.sin(a) * r], boss);
    });
  }

  // Drop something in front of a player.
  dropNear(p, item) {
    const d = [-Math.sin(p.st.y), 0, -Math.cos(p.st.y)];
    return this.spawn(item, [p.st.p[0] + d[0] * 1.2, p.st.p[1], p.st.p[2] + d[2] * 1.2]);
  }

  // Apply a pickup to a player; `held` = hotbar slot in hand (a full inventory swaps that one out).
  // Returns true when it was fully taken.
  take(p, pk, held) {
    const room = this.room;
    if (pk.kind === 'it') {
      const it = pk.item, before = it.n;
      if (it.kind === 'adrenaline') {
        const cap = Math.max(0, ADREN_CARRY - countOf(p, it.id));
        if (!cap) { room.send(p, { t: 'deny', text: `You can carry ${ADREN_CARRY} Adrenaline Shots` }); return false; }
        if (it.n > cap) {
          const got = cap - (giveItem(p, { ...it, uid: nextUid(), n: cap })?.n ?? 0);
          if (got > 0) room.send(p, { t: 'got', it: { ...it, n: got } });
          room.send(p, { t: 'deny', text: `You can carry ${ADREN_CARRY} Adrenaline Shots` });
          it.n = before - got;
          return false;
        }
      }
      const left = giveItem(p, it);
      if (!left) { room.send(p, { t: 'got', it }); return true; }
      if (it.kind === 'gun' || stackMax(it) === 1) {
        const slot = held >= 0 && held < HOTBAR ? held : 0, old = p.inv[slot];
        if (old?.locked) { room.send(p, { t: 'deny', text: 'Inventory full — the item in your hand is locked' }); return false; }
        p.inv[slot] = it;
        if (old) this.dropNear(p, old);
        room.send(p, { t: 'got', it });
        return true;
      }
      if (it.n !== before) room.send(p, { t: 'got', it: { ...it, n: before - it.n } });
      return false;
    }
    if (pk.kind === 'ammo') { pk.n -= addAmmo(p, pk.type, pk.n); return pk.n <= 0; }
    if (pk.kind === 'mats') { pk.n -= addMats(p, pk.mat, pk.n); return pk.n <= 0; }
    if (pk.kind === 'svsupply') { room.survivors.resupply(p); return true; }
    return false;
  }

  onPickup(p, m) {
    const pk = this.pickups.get(m.id | 0);
    if (!pk || !p.alive || p.downed) return;
    const d = Math.hypot(pk.pos[0] - p.st.p[0], pk.pos[1] - p.st.p[1], pk.pos[2] - p.st.p[2]);
    if (d > 2.8) return;
    const before = pk.item?.n ?? pk.n;
    if (this.take(p, pk, m.slot | 0)) this.remove(pk);
    else if ((pk.item?.n ?? pk.n) !== before) this.room.broadcast({ t: 'pk', l: [this.tuple(pk)] });
    else this.room.send(p, { t: 'deny', text: 'Inventory full' });
    this.room.sendInv(p);
  }

  // Ammo and materials are grabbed just by walking over them; every pickup despawns once its timer runs out.
  update(now) {
    if (now - this.autoAt < 200) return;
    this.autoAt = now;
    for (const pk of this.pickups.values()) {
      if (pk.expire && now >= pk.expire) { this.remove(pk); continue; }
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

  // Highest surface at (x, z) no higher than `y` — the same boxes players collide with (ground, built
  // floors/ramps, map props). The ground plane always covers the map, so this never comes up empty.
  surfaceBelow(x, z, y) {
    const boxes = this.room.grid.query(x - 0.15, z - 0.15, x + 0.15, z + 0.15, this.fallBoxes ??= []);
    let top = 0;
    for (const b of boxes) {
      if (x <= b.min[0] || x >= b.max[0] || z <= b.min[2] || z >= b.max[2]) continue;
      const t = topAt(b, x, z, 0);
      if (t <= y + 0.05 && t > top) top = t;
    }
    return top;
  }

  // Every pickup that isn't resting on something falls until it lands. Resting ones are re-checked every
  // ~200ms so a pickup on a floor that gets shot/edited away starts falling again. Broadcast cheaply: only
  // the pickups that actually moved this tick, and only their height (see holdout_ents.js fallPickup).
  updateGravity(now, dt) {
    const recheck = now - this.restAt >= 200;
    if (recheck) this.restAt = now;
    const moved = [];
    for (const pk of this.pickups.values()) {
      const [x, y, z] = pk.pos;
      if (pk.resting) {
        if (!recheck || this.surfaceBelow(x, z, y) >= y - 0.05) continue;
        pk.resting = false; // lost its floor
      }
      pk.vy = Math.max(pk.vy - P.gravity * dt, -FALL_TERMINAL);
      const ny = y + pk.vy * dt, top = this.surfaceBelow(x, z, y);
      if (ny <= top) { pk.pos[1] = r2(top); pk.vy = 0; pk.resting = true; } else pk.pos[1] = r2(ny);
      moved.push(pk);
    }
    if (moved.length) this.room.broadcast({ t: 'pkfall', l: moved.map(pk => [pk.id, pk.pos[1]]) });
  }

  // ---------- moving things around the grid (drag & drop) ----------
  slotsFor(p, r) { return r.box === 'i' ? p.inv : r.box === 's' ? this.stash.items : r.box === 'k' ? p.sack : null; }
  get(p, r) { return r.box === 'a' ? p.armor[r.key] : this.slotsFor(p, r)[r.key]; }
  set(p, r, it) { if (r.box === 'a') p.armor[r.key] = it; else this.slotsFor(p, r)[r.key] = it; }

  // m: { from, to } slot refs. Swaps, merges stacks, equips armor, and drops attachments onto guns.
  onMove(p, m) {
    const a = parseRef(m.from), b = parseRef(m.to), room = this.room, deny = text => room.send(p, { t: 'deny', text });
    if (!a || !b || !p.alive || (a.box === b.box && a.key === b.key)) return;
    if ((a.box === 's' || b.box === 's') && !this.nearStash(p)) return deny('Stand next to the team chest');
    const src = this.get(p, a), dst = this.get(p, b);
    if (!src) return;
    // Colossus-wave chest snipers: one per player per wave (see giveChestSnipers) — normal chest rules otherwise
    const takingChestSniper = a.box === 's' && b.box !== 's' && src.kind === 'gun' && src.chestGift;
    if (takingChestSniper && room.chestSniperTaken?.has(p.id)) return deny('You already grabbed a sniper from the chest this wave');
    if (b.box === 'k' && !isConsumable(src)) return deny('The sack only holds Adrenaline Shots');
    // an attachment dropped on a gun gets fitted (whatever was in that slot comes back) — an upgrade, so a lock on either side doesn't block it
    if (src.kind === 'attach' && dst?.kind === 'gun' && b.box !== 'a') {
      const slot = ATTACH[src.id].slot, old = dst.att?.[slot];
      dst.att = { ...dst.att, [slot]: src.id };
      src.n -= 1;
      if (src.n <= 0) this.set(p, a, null);
      if (old) { const left = giveItem(p, { uid: nextUid(), id: old, kind: 'attach', n: 1 }); if (left) this.dropNear(p, left); }
      room.send(p, { t: 'msg', text: `${ATTACH[src.id].name} fitted` });
      return this.changed(p, a, b);
    }
    if (src.locked || dst?.locked) return deny('Locked — press your lock key to unlock');
    // armor only goes into its own slot
    if (b.box === 'a' && (src.kind !== 'armor' || ARMOR[src.id].slot !== b.key)) return deny('That goes in another slot');
    if (a.box === 'a' && dst && (dst.kind !== 'armor' || ARMOR[dst.id].slot !== a.key)) return deny('That goes in another slot');
    // pulling Adrenaline Shots out of the team chest still respects the carry cap — move only up to it
    if (src.kind === 'adrenaline' && a.box === 's' && b.box !== 's') {
      const cap = ADREN_CARRY - countOf(p, src.id);
      if (cap <= 0) return deny(`You can carry ${ADREN_CARRY} Adrenaline Shots`);
      if (src.n > cap) {
        if (dst && dst.id !== src.id) return deny(`You can carry ${ADREN_CARRY} Adrenaline Shots`);
        if (dst) dst.n += cap; else this.set(p, b, { ...src, uid: nextUid(), n: cap });
        src.n -= cap;
        room.send(p, { t: 'deny', text: `You can carry ${ADREN_CARRY} Adrenaline Shots` });
        return this.changed(p, a, b);
      }
    }
    // merge stacks of the same thing
    if (dst && dst.id === src.id && dst.kind === src.kind && stackMax(dst) > 1) {
      const k = Math.min(stackMax(dst) - dst.n, src.n);
      dst.n += k; src.n -= k;
      if (src.n <= 0) this.set(p, a, null);
    } else { this.set(p, a, dst ?? null); this.set(p, b, src); }
    if (takingChestSniper) (room.chestSniperTaken ??= new Set()).add(p.id);
    this.changed(p, a, b);
  }

  changed(p, a, b) {
    this.room.sendInv(p);
    if (a.box === 's' || b.box === 's') this.broadcastStash();
    if (a.box === 'a' || b.box === 'a') this.room.armorChanged(p);
  }

  // m: { from, n?, mag? } — drop a slot (or part of a stack) on the ground
  onDrop(p, m) {
    const r = parseRef(m.from);
    if (!r || r.box === 's' || !p.alive || p.downed) return;
    const it = this.get(p, r);
    if (!it) return;
    if (it.locked) return this.room.send(p, { t: 'deny', text: 'Locked — press your lock key to unlock' });
    const n = Math.max(1, Math.min(it.n ?? 1, m.n | 0 || it.n || 1));
    let out = it;
    if ((it.n ?? 1) > n) { it.n -= n; out = { ...it, uid: nextUid(), n }; }
    else this.set(p, r, null);
    if (out.kind === 'gun' && Number.isFinite(+m.mag)) out.mag = Math.max(0, Math.min(magFor(out, p.cls), m.mag | 0));
    this.dropNear(p, out);
    this.room.sendInv(p);
    if (r.box === 'a') this.room.armorChanged(p);
  }

  // old "drop the gun in your hand" message: { slot (hotbar index), mag }
  onDropGun(p, m) { this.onDrop(p, { from: 'i' + (m.slot | 0), mag: m.mag }); }

  // m: { ref } — toggle a lock that blocks selling, dropping, moving/swapping and team-chest transfers of
  // that item until unlocked again. Upgrades (rarity, tier, the Blacksmith) still work on a locked item.
  onLock(p, m) {
    const r = parseRef(m.ref);
    if (!r || !p.alive) return;
    const it = this.get(p, r);
    if (!it) return;
    it.locked = !it.locked;
    this.room.sendInv(p);
    this.room.send(p, { t: 'msg', text: `${itemName(it)} ${it.locked ? 'locked' : 'unlocked'}` });
  }

  // ---------- reloading from the backpack ----------
  onReload(p, m) {
    const g = gunByUid(p, m.uid);
    if (!g) return;
    const w = WEAPONS[g.id], need = Math.max(0, Math.min(magFor(g, p.cls), m.need | 0)), n = Math.min(need, p.ammo[w.ammo] || 0);
    p.ammo[w.ammo] -= n;
    this.room.send(p, { t: 'grant', uid: g.uid, n });
    this.room.sendInv(p);
  }

  // ---------- shop (inside the ring around the Core) ----------
  onBuy(p, id, bank, slot, el) {
    const room = this.room, e = shopEntry(id), deny = text => room.send(p, { t: 'deny', text });
    if (!e) return;
    if (!room.canBuy(p)) return deny('Buy inside the ring around the Core');
    if (e.kind === 'power' && room.powerupRunning(id)) return deny('Already active');
    const withEl = e.kind === 'gun' && ELEMENTS[el] ? el : null;
    const price = withEl ? e.price + elementPrice(id) : e.price;
    const payer = bank ? this.stash : p;
    if (payer.money < price) return deny(bank ? 'The team bank is short' : 'Not enough money');
    if (e.kind === 'gun') {
      const g = makeGun(id, SHOP_RARITY, 1, withEl); // duplicates are fine: a free hotbar slot, else the backpack, else swap
      const i = slot >= 0 && slot < HOTBAR ? slot : 0;
      if (!fits(p.inv, p.sack, g) && p.inv[i]?.locked) return deny('Inventory full — the item in your hand is locked');
      if (giveItem(p, g)) { // full: swap with the gun in hand
        const old = p.inv[i];
        p.inv[i] = g;
        if (old) this.dropNear(p, old);
      }
    } else if (e.kind === 'ammo') {
      if (!addAmmo(p, e.type, AMMO[e.type].pack)) return deny('That ammo is full');
    } else if (e.kind === 'item') {
      const cap = id === 'adrenaline' ? ADREN_CARRY : ITEMS[id].max * 2;
      if (countOf(p, id) >= cap) return deny(id === 'adrenaline' ? `You can carry ${ADREN_CARRY} Adrenaline Shots` : `You can carry ${cap}`);
      if (giveItem(p, makeItem(id, 1))) return deny('Inventory full');
    } else if (e.kind === 'armor') {
      const a = makeArmor(id, 1), where = ARMOR[id].slot;
      if (!p.armor[where]) { p.armor[where] = a; room.armorChanged(p); } // wear it right away when that slot is free
      else if (giveItem(p, a)) return deny('Inventory full');
    } else if (e.kind === 'power') {
      if (!room.applyPowerup(id, p)) return deny('Already active');
    }
    payer.money -= price;
    room.sendInv(p);
    room.send(p, { t: 'bought', item: id });
    if (bank) this.broadcastStash();
  }

  // Tier II at the Core (tier III needs the Blacksmith). m: { uid }
  onTierUp(p, m, atSmith = false) {
    const room = this.room, it = p.inv.find(x => x && x.uid === m.uid) ?? ARMOR_SLOTS.map(s => p.armor[s]).find(x => x?.uid === m.uid);
    const deny = text => room.send(p, { t: 'deny', text });
    if (!it || (it.kind !== 'gun' && it.kind !== 'armor')) return;
    const to = (it.tier ?? 1) + 1;
    if (to > 3) return deny('Already tier III');
    if (to === 3 && !atSmith) return deny('Tier III is forged by the Blacksmith');
    if (!atSmith && !room.canBuy(p)) return deny('Upgrade inside the ring around the Core');
    const cost = tierCost(it, to);
    if (p.money < cost.money || p.mats.zink < cost.zink) return deny(`Needs $${cost.money}${cost.zink ? ` + ${cost.zink} Zinkonium` : ''}`);
    p.money -= cost.money;
    p.mats.zink -= cost.zink;
    it.tier = to;
    room.sendInv(p);
    if (it.kind === 'armor') room.armorChanged(p);
    room.send(p, { t: 'msg', text: `Upgraded to tier ${['', 'I', 'II', 'III'][to]}` });
  }

  // ---------- rarity, selling, buy-back ----------
  // Money-only rarity upgrade at the Core. m: { uid, bank }
  onRarity(p, m) {
    const room = this.room, deny = text => room.send(p, { t: 'deny', text });
    if (!room.canBuy(p)) return deny('Upgrade inside the ring around the Core');
    const it = p.inv.find(x => x?.kind === 'gun' && x.uid === m.uid);
    if (!it) return;
    const cost = rarityCost(it);
    if (cost === null) return deny('Already Legendary');
    const payer = m.bank ? this.stash : p;
    if (payer.money < cost) return deny(m.bank ? 'The team bank is short' : 'Not enough money');
    payer.money -= cost;
    it.r = (it.r ?? 0) + 1;
    room.sendInv(p);
    room.send(p, { t: 'msg', text: `${itemName(it)} is now ${RARITY[it.r].name}` });
    if (m.bank) this.broadcastStash();
  }

  // Standing close enough to the Banker's counter to trade with him.
  nearBanker(p) {
    const b = this.room.map.banker;
    return p.alive && !p.downed && Math.hypot(p.st.p[0] - b.x, p.st.p[2] - b.z) <= b.reach + 0.8;
  }

  // Sell the whole stack of an item from the backpack or the sack (worn armor can't be sold — unequip
  // first). m: { uid }
  onSell(p, m) {
    const room = this.room, deny = text => room.send(p, { t: 'deny', text });
    if (!this.nearBanker(p)) return deny('Talk to the Banker to sell');
    let idx = p.inv.findIndex(x => x?.uid === m.uid), from = p.inv;
    if (idx < 0 && p.sack) { idx = p.sack.findIndex(x => x?.uid === m.uid); from = p.sack; }
    if (idx < 0) return;
    const it = from[idx], price = sellPrice(it);
    if (it.locked) return deny('Locked — press your lock key to unlock');
    from[idx] = null;
    p.money = Math.min(MONEY_CAP, p.money + price);
    p.buyback = { item: it, price }; // only the last sale is kept
    room.sendInv(p);
    room.send(p, { t: 'msg', text: `Sold ${itemName(it)} for $${price}` });
  }

  // Buy back the last item sold, for what it sold for.
  onBuyback(p) {
    const room = this.room, deny = text => room.send(p, { t: 'deny', text }), bb = p.buyback;
    if (!bb) return;
    if (!this.nearBanker(p)) return deny('Talk to the Banker to sell');
    if (p.money < bb.price) return deny('Not enough money');
    if (!fits(p.inv, p.sack, bb.item)) return deny('Inventory full');
    p.money -= bb.price;
    giveItem(p, bb.item);
    p.buyback = null;
    room.sendInv(p);
  }

  // ---------- permanent team upgrades ----------
  // m: { id, bank }
  onTeamUp(p, m) {
    const room = this.room, up = TEAM_UPS[m.id], deny = text => room.send(p, { t: 'deny', text });
    if (!up) return;
    if (!room.canBuy(p)) return deny('Upgrade inside the ring around the Core');
    const level = room.teamUps[m.id] ?? 0;
    if (level >= 5) return deny('Already maxed');
    const cost = up.cost[level], payer = m.bank ? this.stash : p;
    if (payer.money < cost) return deny(m.bank ? 'The team bank is short' : 'Not enough money');
    payer.money -= cost;
    room.teamUps[m.id] = level + 1;
    if (m.id === 'vitality') {
      for (const q of room.players) { // sends p its own updated money too, along with everyone's new max HP
        const old = q.maxHp || 0;
        q.maxHp = room.maxHpFor(q);
        if (q.alive) q.hp += q.maxHp - old;
        room.sendInv(q);
      }
    } else {
      if (m.id === 'engineering') {
        const ratio = (1 + 0.1 * (level + 1)) / (1 + 0.1 * level);
        for (const s of room.builds()) { s.maxHp = Math.round(s.maxHp * ratio); s.hp = Math.min(s.maxHp, s.hp * ratio); room.dirtyPieces.add(s); }
        room.flowDirty = true;
      }
      room.sendInv(p); // otherwise only the buyer's money moved — refresh it right away (every panel reads from here)
    }
    room.broadcast({ t: 'msg', text: `${p.name} upgraded team ${up.name} to level ${level + 1}` });
    room.broadcast({ t: 'teamups', ups: room.teamUps });
    if (m.bank) this.broadcastStash();
  }

  // ---------- team chest ----------
  nearStash(p) {
    const st = this.room.map.stash;
    return p.alive && !p.downed && Math.hypot(p.st.p[0] - st.x, p.st.p[2] - st.z) <= st.reach + 1;
  }

  // Pooled counters. m: { op: 'put' | 'take', cat: 'money' | 'mats' | 'ammo', key, n }
  onStash(p, m) {
    if (!this.nearStash(p)) return this.room.send(p, { t: 'deny', text: 'Stand next to the team chest' });
    const n = Math.max(0, Math.floor(+m.n || 0)), s = this.stash, put = m.op === 'put';
    if (!n) return;
    if (m.cat === 'money') {
      const from = put ? p : s, to = put ? s : p, v = Math.min(n, from.money, put ? Infinity : Math.max(0, MONEY_CAP - p.money));
      from.money -= v; to.money += v;
    } else if (m.cat === 'mats' && MAT_IDS.includes(m.key)) {
      if (put) { const v = Math.min(n, p.mats[m.key]); p.mats[m.key] -= v; s.mats[m.key] += v; }
      else { const v = addMats(p, m.key, Math.min(n, s.mats[m.key])); s.mats[m.key] -= v; }
    } else if (m.cat === 'ammo' && AMMO[m.key]) {
      if (put) { const v = Math.min(n, p.ammo[m.key]); p.ammo[m.key] -= v; s.ammo[m.key] += v; }
      else { const v = addAmmo(p, m.key, Math.min(n, s.ammo[m.key])); s.ammo[m.key] -= v; }
    } else return;
    this.room.sendInv(p);
    this.broadcastStash();
  }

  broadcastStash() { this.room.broadcast({ t: 'stash', s: this.stash }); }

  // Colossus wave incoming: one SSG per player into the team chest (each may take only one — see onMove).
  // If the chest is full, clears its two cheapest items to make room.
  giveChestSnipers(n) {
    const room = this.room, items = this.stash.items;
    let cleared = false;
    if (items.every(Boolean)) {
      for (const i of items.map((it, idx) => idx).sort((i, j) => itemValue(items[i]) - itemValue(items[j])).slice(0, 2)) items[i] = null;
      cleared = true;
    }
    for (let i = 0; i < n; i++) {
      const gun = makeGun('h_ssg', SHOP_RARITY);
      gun.chestGift = true;
      const left = placeItem(items, gun);
      if (left) this.spawn(left, [room.map.stash.x, 0.2, room.map.stash.z]);
    }
    room.chestSniperTaken = new Set();
    this.broadcastStash();
    room.broadcast({ t: 'msg', text: `The squad's sniper rifles are in the team chest — one each!${cleared ? ' (cleared 2 chest items to make room)' : ''}` });
  }

  syncTo(p) {
    this.room.send(p, { t: 'pkall', l: [...this.pickups.values()].map(pk => this.tuple(pk)) });
    this.room.send(p, { t: 'stash', s: this.stash });
  }
}

export { POWERUPS };
