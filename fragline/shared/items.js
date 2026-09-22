// Holdout inventory rules shared by server and browser: the Minecraft-style grid (6 hotbar + 18 backpack
// slots, 4 armor slots), what stacks, gun tiers on top of rarity, attachments and the armor catalog.
// Items: { uid, id, kind: 'gun' | 'throw' | 'adrenaline' | 'trap' | 'deploy' | 'armor' | 'attach',
//          n (stack size), r (gun rarity), tier (1-5 guns, 1-3 armor), el / els (gun elements), att (gun attachments),
//          kills (weapon mastery), mods + modSlots (Blacksmith gun mods), ku (the Ronin's katana upgrades: SMITH.katana) }
import { WEAPONS } from './weapons.js';
import { ITEMS, RARITY, ARMOR, ATTACH, SMITH, GUN_MODS, KATANA } from './holdout.js';
export { ARMOR, ARMOR_IDS, ATTACH, ATTACH_IDS } from './holdout.js';
import { ELEMENTS } from './elements.js';

export const HOTBAR = 6, BACKPACK = 18, INV_SIZE = HOTBAR + BACKPACK, STASH_SIZE = 18;
export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'];
export const SACK_SIZE = 4; // a small pouch of consumables (Adrenaline Shots) everyone always carries
export const CONSUMABLE_KINDS = ['adrenaline'];
export const isConsumable = it => !!it && CONSUMABLE_KINDS.includes(it.kind);
// Hotbar slots a kit can use: the Ronin gets 3 (slot 1 holds his locked katana) — slots 4-6 stay empty, nothing lands there.
export const hotbarFor = cls => (cls === 'ronin' ? 3 : HOTBAR);
export const deadSlot = (cls, i) => i >= hotbarFor(cls) && i < HOTBAR;

// Tier upgrades sit on top of rarity: the damage multiplier stacks with the rarity one. IV and V are Blacksmith
// milestones for guns (SMITH.ups); armor stops at III.
export const TIERS = [null, { name: 'I', mult: 1 }, { name: 'II', mult: 1.25 }, { name: 'III', mult: 1.55 }, { name: 'IV', mult: 1.85 }, { name: 'V', mult: 2.2 }];
export const TIER_COLORS = [null, '#c98a4b', '#c9d1db', '#ffd166', '#5ee6d0', '#ff5a7a']; // bronze / silver / gold / mythril / ruby

// Weapon mastery: every kill made with an item counts on it (it.kills); the level is how many of these it has passed (1-8).
export const MASTERY = [0, 25, 60, 110, 180, 270, 380, 520];
export const masteryLevel = it => MASTERY.filter(k => (it?.kills || 0) >= k).length;

// Why a Blacksmith milestone (SMITH.ups — the Ronin's katana has its own tree, SMITH.katana) can't go on this gun right
// now — '' when it can. wave: the wave the squad has reached; el: Elemental Edge's pick. Shared so the panel greys out
// exactly what the server refuses, with the same reason.
export function milestoneBlock(id, it, wave, money, zink, el = null) {
  const kat = it?.id === 'katana', table = kat ? SMITH.katana : SMITH.ups;
  const u = Object.hasOwn(table, id) ? table[id] : null, w = WEAPONS[it?.id], t = it?.tier ?? 1, ku = it?.ku ?? {};
  if (!u || it?.kind !== 'gun' || !w) return kat ? 'Not a katana upgrade' : 'Only for guns';
  if (wave < u.wave) return `Unlocks at wave ${u.wave}`;
  if (kat) { // Edge levels in order, the rest once each — Elemental Edge again to switch element
    if (u.edge && (ku.edge ?? 0) >= u.edge) return 'Already forged';
    if (u.edge && (ku.edge ?? 0) < u.edge - 1) return `Forge ${SMITH.katana[`edge${u.edge - 1}`].name} first`;
    if (id === 'elem' && !KATANA.els.includes(el)) return 'Pick an element';
    if (id === 'elem' && it.el === el) return `Already ${ELEMENTS[el].name}`;
    if (!u.edge && id !== 'elem' && ku[id]) return 'Already forged';
  }
  if ((GUN_MODS[id] || id === 'slot2') && (w.cat === 'melee' || w.projectile)) return 'Only for guns that fire bullets';
  if (id === 'tier4' && t !== 3) return t > 3 ? `Already tier ${TIERS[t].name}` : 'Forge tier III first';
  if (id === 'tier5' && t !== 4) return t > 4 ? 'Already tier V' : 'Needs tier IV first';
  if (id === 'toxic' && (it.els ?? (it.el ? [it.el] : [])).includes('toxic')) return 'Already toxic';
  if (GUN_MODS[id] && it.mods?.includes(id)) return 'Already fitted';
  if (id === 'pierce' && w.pierce) return 'Already pierces';
  if (id === 'slot2' && (it.modSlots ?? 1) > 1) return 'Already has two mod slots';
  const lvl = masteryLevel(it);
  if (lvl < u.mastery) return `Needs mastery ${u.mastery} (this one is ${lvl})`;
  if (money < u.money) return `Needs $${u.money}`;
  if (zink < u.zink) return `Needs ${u.zink} Zinkonium`;
  return '';
}
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
export function placeItem(slots, item, hotbar = HOTBAR, cls = null) {
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
  for (const i of order) if (!slots[i] && !deadSlot(cls, i)) { slots[i] = item; return null; } // cls: skips a kit's closed hotbar slots
  return item;
}

export const countIn = (slots, id) => slots.reduce((n, it) => n + (it?.id === id ? it.n ?? 1 : 0), 0);

// Would `item` fit into `slots` without mutating anything? Mirrors placeItem's stacking + free-slot rules.
// Shared so the client can tell "wouldn't fit" apart from "fits" before ever sending a pickup/buyback request.
export function fitsIn(slots, item, cls = null) {
  const max = stackMax(item);
  if (max > 1) {
    let left = item.n ?? 1;
    for (const it of slots) {
      if (it && it.id === item.id && it.kind === item.kind && it.n < max) left -= Math.min(max - it.n, left);
      if (left <= 0) return true;
    }
  }
  return slots.some((s, i) => !s && !deadSlot(cls, i));
}
// Same, but checks the sack first for consumables (mirrors giveItem's placement order).
export const fits = (inv, sack, item, cls = null) => (sack && isConsumable(item) && fitsIn(sack, item)) || fitsIn(inv, item, cls);

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
  if (it.id === 'katana') return `${it.el ? ELEMENTS[it.el].name + ' ' : ''}Zinkonium Katana${it.ku?.edge ? ` +${it.ku.edge}` : ''}`;
  if (it.kind === 'gun') {
    const els = it.els ?? (it.el ? [it.el] : []);
    const el = els.length ? els.map(e => ELEMENTS[e].name).join('+') + ' ' : '';
    return `${RARITY[it.r ?? 0].name} ${el}${WEAPONS[it.id]?.name ?? it.id} ${TIERS[it.tier ?? 1].name}`;
  }
  if (it.kind === 'armor') return `${ARMOR[it.id]?.name ?? it.id} ${TIERS[it.tier ?? 1].name}`;
  if (it.kind === 'attach') return ATTACH[it.id]?.name ?? it.id;
  return ITEMS[it.id]?.name ?? it.id;
}
