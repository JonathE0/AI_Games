// Holdout inventory rules shared by server and browser: the Minecraft-style grid (6 hotbar + 18 backpack
// slots, 4 armor slots), what stacks, gun tiers on top of rarity, attachments and the armor catalog.
// Items: { uid, id, kind: 'gun' | 'throw' | 'adrenaline' | 'trap' | 'deploy' | 'armor' | 'attach',
//          n (stack size), r (gun rarity), tier (1-3, guns and armor), el (gun element), att (gun attachments) }
import { WEAPONS } from './weapons.js';
import { ITEMS, RARITY, ARMOR, ATTACH } from './holdout.js';
export { ARMOR, ARMOR_IDS, ATTACH, ATTACH_IDS } from './holdout.js';
import { ELEMENTS } from './elements.js';

export const HOTBAR = 6, BACKPACK = 18, INV_SIZE = HOTBAR + BACKPACK, STASH_SIZE = 18;
export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'];
export const SACK_SIZE = 4; // a small pouch of consumables (Adrenaline Shots) everyone always carries
export const CONSUMABLE_KINDS = ['adrenaline'];
export const isConsumable = it => !!it && CONSUMABLE_KINDS.includes(it.kind);

// Tier upgrades sit on top of rarity: the damage multiplier stacks with the rarity one.
export const TIERS = [null, { name: 'I', mult: 1 }, { name: 'II', mult: 1.25 }, { name: 'III', mult: 1.55 }];
export const TIER_COLORS = [null, '#c98a4b', '#c9d1db', '#ffd166']; // bronze / silver / gold
// what the next tier costs (money, Zinkonium): T2 at the Core, T3 at the Blacksmith
export const tierCost = (it, to) => {
  const r = it.r ?? 0;
  return to === 2 ? { money: 700 + 350 * r, zink: 0 } : { money: 1800 + 600 * r, zink: 60 };
};

export function kindOf(id) {
  if (WEAPONS[id]?.mode === 'holdout') return 'gun';
  if (ITEMS[id]) return ITEMS[id].kind;
  if (ARMOR[id]) return 'armor';
  if (ATTACH[id]) return 'attach';
  return null;
}

export function stackMax(it) {
  if (it.kind === 'gun' || it.kind === 'armor') return 1;
  if (it.kind === 'attach') return 3;
  return ITEMS[it.id]?.max ?? 1;
}

// Put `item` into `slots` (an inventory or the team chest). Stacks merge first; then weapons and
// consumables fill the hotbar before the backpack, armor and attachments the backpack first.
// Returns what did not fit (null when everything went in). `item.n` is reduced as it is merged.
export function placeItem(slots, item, hotbar = HOTBAR) {
  const max = stackMax(item);
  if (max > 1) {
    for (const it of slots) {
      if (!it || it.id !== item.id || it.kind !== item.kind || it.n >= max) continue;
      const k = Math.min(max - it.n, item.n);
      it.n += k;
      item.n -= k;
      if (item.n <= 0) return null;
    }
  }
  const back = item.kind === 'armor' || item.kind === 'attach';
  const order = [...slots.keys()];
  if (back) order.sort((a, b) => (a < hotbar) - (b < hotbar));
  for (const i of order) if (!slots[i]) { slots[i] = item; return null; }
  return item;
}

export const countIn = (slots, id) => slots.reduce((n, it) => n + (it?.id === id ? it.n ?? 1 : 0), 0);

// Would `item` fit into `slots` without mutating anything? Mirrors placeItem's stacking + free-slot rules.
// Shared so the client can tell "wouldn't fit" apart from "fits" before ever sending a pickup/buyback request.
export function fitsIn(slots, item) {
  const max = stackMax(item);
  if (max > 1) {
    let left = item.n ?? 1;
    for (const it of slots) {
      if (it && it.id === item.id && it.kind === item.kind && it.n < max) left -= Math.min(max - it.n, left);
      if (left <= 0) return true;
    }
  }
  return slots.some(s => !s);
}
// Same, but checks the sack first for consumables (mirrors giveItem's placement order).
export const fits = (inv, sack, item) => (sack && isConsumable(item) && fitsIn(sack, item)) || fitsIn(inv, item);

// Sum of the equipped armor's stats.
export function armorStats(armor) {
  const s = { def: 0, fire: 0, slow: 0, blind: 0, speed: 0 };
  for (const slot of ARMOR_SLOTS) {
    const it = armor?.[slot], a = it && ARMOR[it.id];
    if (!a) continue;
    for (const k of Object.keys(s)) if (a[k]) s[k] += a[k][it.tier ?? 1] ?? 0;
  }
  s.fire = Math.min(0.9, s.fire); s.slow = Math.min(0.9, s.slow); s.blind = Math.min(0.9, s.blind);
  return s;
}
export const damageReduction = def => def / (def + 100);

// Per-gun numbers that depend on the item (not just the weapon type).
export function magFor(it, cls = null) {
  const w = WEAPONS[it?.id];
  if (!w) return 0;
  return Math.round(w.mag * (it.att?.mag === 'extmag' ? 1.5 : 1) * (cls === 'assault' ? 1.5 : 1));
}
export const gunMult = it => (RARITY[it?.r ?? 0]?.mult ?? 1) * (TIERS[it?.tier ?? 1]?.mult ?? 1);

export function itemName(it) {
  if (!it) return '';
  if (it.kind === 'gun') {
    const els = it.els ?? (it.el ? [it.el] : []);
    const el = els.length ? els.map(e => ELEMENTS[e].name).join('+') + ' ' : '';
    return `${RARITY[it.r ?? 0].name} ${el}${WEAPONS[it.id]?.name ?? it.id} ${TIERS[it.tier ?? 1].name}`;
  }
  if (it.kind === 'armor') return `${ARMOR[it.id]?.name ?? it.id} ${TIERS[it.tier ?? 1].name}`;
  if (it.kind === 'attach') return ATTACH[it.id]?.name ?? it.id;
  return ITEMS[it.id]?.name ?? it.id;
}
