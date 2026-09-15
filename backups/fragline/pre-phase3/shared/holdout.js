// Zombie Holdout gear shared by server and browser: rarities, backpack ammo, consumables, deployable
// defenses, team powerups, the shop catalog, loot tables and survivors. Money in $, times in seconds.
import { WEAPONS } from './weapons.js';

export const RARITY = [
  { id: 'common', name: 'Common', color: '#b7bec7', mult: 1 },
  { id: 'uncommon', name: 'Uncommon', color: '#5fd35a', mult: 1.08 },
  { id: 'rare', name: 'Rare', color: '#4aa8ff', mult: 1.16 },
  { id: 'epic', name: 'Epic', color: '#c07bff', mult: 1.25 },
  { id: 'legendary', name: 'Legendary', color: '#ffb43c', mult: 1.35 },
];
export const SHOP_RARITY = 1;   // guns bought at the Core are Uncommon
export const GUN_SLOTS = 5;

// cap = most you can carry in the backpack; pack = rounds per shop purchase / loot pack
export const AMMO = {
  light: { name: 'Light Ammo', cap: 600, pack: 60, price: 120, color: '#e8d27a' },
  medium: { name: 'Medium Ammo', cap: 480, pack: 60, price: 180, color: '#7ac7e8' },
  heavy: { name: 'Heavy Ammo', cap: 60, pack: 10, price: 200, color: '#e87a7a' },
  shells: { name: 'Shells', cap: 80, pack: 16, price: 150, color: '#e8a24a' },
  rockets: { name: 'Rockets', cap: 12, pack: 2, price: 400, color: '#b4e87a' },
};
export const AMMO_IDS = Object.keys(AMMO);
export const START_AMMO = { light: 180, medium: 60, heavy: 0, shells: 0, rockets: 0 };
export const MAT_CAP = 999;

// kind: throw (T), heal / shield (H), trap (placed from build mode, slot 4)
export const ITEMS = {
  grenade: { name: 'Grenade', kind: 'throw', price: 300, max: 6, dmg: 190, radius: 4.5, fuse: 1.6 },
  molotov: { name: 'Molotov', kind: 'throw', price: 350, max: 6, dps: 40, radius: 3.6, burn: 7 },
  freeze: { name: 'Freeze Grenade', kind: 'throw', price: 400, max: 6, radius: 5, freeze: 4 },
  bandage: { name: 'Bandage', kind: 'heal', price: 150, max: 10, time: 3, hp: 15, cap: 75 },
  medkit: { name: 'Medkit', kind: 'heal', price: 500, max: 3, time: 6, hp: 100, cap: 100 },
  shield_s: { name: 'Small Shield', kind: 'shield', price: 300, max: 6, time: 2, sh: 25, cap: 50 },
  shield: { name: 'Shield Potion', kind: 'shield', price: 600, max: 3, time: 4, sh: 50, cap: 100 },
  spikes: { name: 'Floor Spikes', kind: 'trap', mount: 'floor', price: 300, max: 10 },
  darts: { name: 'Wall Darts', kind: 'trap', mount: 'wall', price: 350, max: 10 },
  flame: { name: 'Flame Grill', kind: 'trap', mount: 'floor', price: 450, max: 10 },
  turret: { name: 'Auto Turret', kind: 'trap', mount: 'ground', price: 1500, max: 3 },
  rturret: { name: 'Rocket Turret', kind: 'trap', mount: 'ground', price: 2500, max: 2 },
  campfire: { name: 'Campfire', kind: 'trap', mount: 'ground', price: 400, max: 4 },
};
export const ITEM_IDS = Object.keys(ITEMS);
export const THROWABLES = ITEM_IDS.filter(id => ITEMS[id].kind === 'throw');
export const TRAPS = ITEM_IDS.filter(id => ITEMS[id].kind === 'trap');
export const HEALS = ['bandage', 'medkit', 'shield_s', 'shield'];

// How placed defenses behave (server/holdout/defenses.js).
export const DEFENSES = {
  spikes: { uses: 90, tick: 0.5, dmg: 28, slow: 0.5 },
  darts: { uses: 70, tick: 0.6, dmg: 26, depth: 2.4 },
  flame: { uses: 45, tick: 1.4, dmg: 55, burn: 10, burnTime: 3 },
  turret: { hp: 350, range: 24, rate: 7, dmg: 13, ammo: 700 },
  rturret: { hp: 450, range: 30, rate: 1 / 3, dmg: 150, splash: 3.5, ammo: 30 },
  campfire: { life: 30, heal: 3, radius: 3.6 },
};

// Bought by one player (or from the team bank) for the whole squad.
export const POWERUPS = {
  p_overshield: { name: 'Team Overshield', price: 4000, desc: 'Full shields for everyone' },
  p_damage: { name: 'Damage Boost', price: 5000, time: 60, desc: '+30% team damage for 60s' },
  p_rapid: { name: 'Rapid Fire', price: 5000, time: 60, desc: '+30% team fire rate for 60s' },
  p_fortify: { name: 'Fortify', price: 4000, desc: 'Repair and finish every build' },
  p_barrier: { name: 'Core Barrier', price: 6000, time: 20, desc: 'Core invulnerable 20s, +1500 HP' },
};
export const BUFF = { damage: 1.3, rate: 1.3 };

export const AMMO_ITEMS = Object.fromEntries(AMMO_IDS.map(t => ['a_' + t, t]));
export const SHOP = [
  ['Pistols & SMGs', ['pistol', 'smg', 'tac_smg', 'compact']],
  ['Rifles', ['ar', 'burst', 'heavy_ar']],
  ['Shotguns & Heavy', ['pump', 'tac_shotgun', 'hand_cannon', 'rocket']],
  ['Snipers', ['h_ssg', 'h_awp']],
  ['Ammo', Object.keys(AMMO_ITEMS)],
  ['Throwables', THROWABLES],
  ['Healing', HEALS],
  ['Defenses', TRAPS],
  ['Team Powerups', Object.keys(POWERUPS)],
];

// Price and display name of any shop entry.
export function shopEntry(id) {
  if (WEAPONS[id]?.mode === 'holdout') return { kind: 'gun', name: WEAPONS[id].name, price: WEAPONS[id].price };
  if (AMMO_ITEMS[id]) { const a = AMMO[AMMO_ITEMS[id]]; return { kind: 'ammo', name: `${a.name} ×${a.pack}`, price: a.price, type: AMMO_ITEMS[id] }; }
  if (ITEMS[id]) return { kind: 'item', name: ITEMS[id].name, price: ITEMS[id].price };
  if (POWERUPS[id]) return { kind: 'power', name: POWERUPS[id].name, price: POWERUPS[id].price };
  return null;
}

// ---------- loot ----------
const LOOT_GUNS = ['pistol', 'smg', 'tac_smg', 'compact', 'ar', 'burst', 'heavy_ar', 'pump', 'tac_shotgun', 'hand_cannon', 'h_ssg'];
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
export function rollRarity(rng, weights) {
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) <= 0) return i;
  return 0;
}
const ammoFor = (id, n = 1) => ({ kind: 'ammo', type: WEAPONS[id].ammo, n: AMMO[WEAPONS[id].ammo].pack * n });
const anyItem = rng => ({ kind: 'item', id: pick(rng, [...THROWABLES, ...HEALS]), n: 1 });
const mats = (rng, n) => ({ kind: 'mats', mat: pick(rng, ['wood', 'stone', 'metal']), n });

// kind: 'chest' | 'drop' (supply balloon) | 'boss'. Returns pickups to scatter.
export function rollLoot(kind, rng = Math.random) {
  const out = [];
  if (kind === 'chest') {
    const w = pick(rng, LOOT_GUNS);
    out.push({ kind: 'gun', w, r: rollRarity(rng, [30, 30, 25, 12, 3]) }, ammoFor(w));
    if (rng() < 0.5) out.push(anyItem(rng));
    out.push(mats(rng, 30));
  } else if (kind === 'drop') {
    const w = rng() < 0.25 ? pick(rng, ['rocket', 'minigun']) : pick(rng, LOOT_GUNS);
    out.push({ kind: 'gun', w, r: rollRarity(rng, [0, 10, 40, 35, 15]) }, ammoFor(w, 2), anyItem(rng), anyItem(rng), mats(rng, 100));
  } else {
    for (let i = 0; i < 2; i++) { const w = pick(rng, [...LOOT_GUNS, 'rocket', 'minigun']); out.push({ kind: 'gun', w, r: 3 + (rng() < 0.5 ? 1 : 0) }, ammoFor(w, 2)); }
    out.push(anyItem(rng), anyItem(rng), anyItem(rng), { kind: 'mats', mat: 'wood', n: 150 }, { kind: 'mats', mat: 'stone', n: 150 }, { kind: 'mats', mat: 'metal', n: 150 }, { kind: 'svsupply' });
  }
  return out;
}

// ---------- survivors ----------
export const SURVIVOR = {
  hp: 500, speed: 3.4, range: 22, mag: 30, ammo: 360, reload: 2.2,
  guns: [
    { name: 'Survivor SMG', dmg: 11, rpm: 540, hit: 0.55 },
    { name: 'Survivor SMG Mk II', dmg: 14, rpm: 570, hit: 0.62 },
    { name: 'Survivor SMG Mk III', dmg: 17, rpm: 600, hit: 0.7 },
  ],
};
export const RESCUE_WAVES = [3, 7];
export const SURVIVOR_NAMES = ['Maya', 'Dex', 'Rook', 'Juno', 'Ivy', 'Otto', 'Kaz', 'Nell', 'Bram', 'Suki', 'Vale', 'Ren'];

export const intermissionFor = wave => (35 + 7 * wave) * 1000; // longer breaks as waves get harder
