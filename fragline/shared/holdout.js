// Zombie Holdout gear shared by server and browser: rarities, backpack ammo, consumables, deployable
// defenses, team powerups, the shop catalog, loot tables and survivors. Money in $, times in seconds.
import { WEAPONS } from './weapons.js';
import { ELEMENT_IDS } from './elements.js';

export const RARITY = [
  { id: 'common', name: 'Common', color: '#b7bec7', mult: 1 },
  { id: 'uncommon', name: 'Uncommon', color: '#5fd35a', mult: 1.08 },
  { id: 'rare', name: 'Rare', color: '#4aa8ff', mult: 1.16 },
  { id: 'epic', name: 'Epic', color: '#c07bff', mult: 1.25 },
  { id: 'legendary', name: 'Legendary', color: '#ffb43c', mult: 1.35 },
];
// Money-only rarity upgrades at the Core: cost factor to reach rarity index 1..4 (guns priced 0, e.g. boss drops, use 1000).
export const RARITY_UP = [0, 0.6, 0.8, 1.2, 2.0];
export const rarityCost = it => it.r >= 4 ? null : Math.round(((WEAPONS[it.id]?.price || 1000) * RARITY_UP[(it.r ?? 0) + 1]) / 50) * 50;
export const SHOP_RARITY = 1;   // guns bought at the Core are Uncommon
export const GUN_SLOTS = 5;

// cap = most you can carry in the backpack; pack = rounds per shop purchase / loot pack
export const AMMO = {
  light: { name: 'Light Ammo', cap: 600, pack: 60, price: 120, color: '#e8d27a' },
  medium: { name: 'Medium Ammo', cap: 480, pack: 60, price: 180, color: '#7ac7e8' },
  heavy: { name: 'Heavy Ammo', cap: 60, pack: 10, price: 200, color: '#e87a7a' },
  shells: { name: 'Shells', cap: 80, pack: 16, price: 150, color: '#e8a24a' },
  rockets: { name: 'Rockets', cap: 50, pack: 5, price: 1000, color: '#b4e87a' },
};
export const AMMO_IDS = Object.keys(AMMO);
export const START_AMMO = { light: 180, medium: 60, heavy: 0, shells: 0, rockets: 0 };
export const MAT_CAP = 999;

// kind: throw (T), adrenaline (its own key / the sack), trap (on your floors / walls) and deploy (turrets &
// campfires on the ground), both placed with their building keys.
export const ITEMS = {
  grenade: { name: 'Grenade', kind: 'throw', price: 300, max: 6, dmg: 190, radius: 4.5, fuse: 1.6 },
  molotov: { name: 'Molotov', kind: 'throw', price: 350, max: 6, dps: 40, radius: 3.6, burn: 7 },
  // Blizzard: an icy field (radius m, time s) that slows zombies inside; `freezeAfter` s spent inside (cumulative)
  // freezes one solid for `freeze` s, taking `brittle`× damage while it lasts (server/holdout/combat.js)
  freeze: { name: 'Freeze Grenade', kind: 'throw', price: 400, max: 6, radius: 6, time: 6, slow: 0.5, freezeAfter: 1.5, freeze: 3, brittle: 1.25 },
  // the only carried heal: instant +hp and +sh (each capped), then +regen HP/s for `time` s; cooldown in ms
  adrenaline: { name: 'Adrenaline Shot', kind: 'adrenaline', price: 300, max: 10, hp: 25, sh: 25, time: 5, regen: 4, cooldown: 1500 },
  spikes: { name: 'Floor Spikes', kind: 'trap', mount: 'floor', price: 300, max: 10 },
  darts: { name: 'Wall Darts', kind: 'trap', mount: 'wall', price: 350, max: 10 },
  flame: { name: 'Flame Grill', kind: 'trap', mount: 'floor', price: 450, max: 10 },
  turret: { name: 'Auto Turret', kind: 'deploy', mount: 'ground', price: 1800, max: 3 },
  rturret: { name: 'Rocket Turret', kind: 'deploy', mount: 'ground', price: 3000, max: 2 },
  gturret: { name: 'Gatling Turret', kind: 'deploy', mount: 'ground', price: 1600, max: 3 },
  frturret: { name: 'Frost Turret', kind: 'deploy', mount: 'ground', price: 1500, max: 3 },
  flturret: { name: 'Flame Turret', kind: 'deploy', mount: 'ground', price: 1400, max: 3 },
  tesla: { name: 'Tesla Coil', kind: 'deploy', mount: 'ground', price: 2200, max: 2 },
  mortar: { name: 'Mortar', kind: 'deploy', mount: 'ground', price: 3500, max: 1 },
  campfire: { name: 'Rally Fire', kind: 'deploy', mount: 'ground', price: 400, max: 4 },
};
export const ITEM_IDS = Object.keys(ITEMS);
export const THROWABLES = ITEM_IDS.filter(id => ITEMS[id].kind === 'throw');
export const TRAPS = ITEM_IDS.filter(id => ITEMS[id].kind === 'trap');
export const DEPLOYS = ITEM_IDS.filter(id => ITEMS[id].kind === 'deploy');
export const SHIELD_CAP = 100; // the most shield anyone can hold
// Hard cap on total Adrenaline Shots carried at once (hotbar + backpack + sack combined): two stacks' worth,
// per class where a kit says otherwise. Pickups/buys/chest moves/grants past this leave the rest behind (see
// server/holdout/inventory.js and room.js).
export const ADREN_CARRY = 20;
export const ADREN_CARRY_BY_CLASS = { ronin: 30 };
export const adrenCarry = cls => ADREN_CARRY_BY_CLASS[cls] ?? ADREN_CARRY;
// Adrenaline Shot drops (server/holdout/room.js killZombie): any kill has a chance at one, these big zombies always
// drop 1-3; bosses carry 1-3 in their loot pile (rollLoot 'boss').
export const ADREN_DROP = { chance: 0.12, big: ['brute', 'warden', 'golem'] };

// Attachments: one per slot on each gun.
export const ATTACH = {
  extmag: { name: 'Extended Mag', slot: 'mag', price: 900, desc: '+50% magazine' },
  comp: { name: 'Compensator', slot: 'muzzle', price: 800, desc: '-35% recoil and spread bloom' },
  flashlight: { name: 'Flashlight', slot: 'light', price: 500, desc: 'Light your way at night (L)' },
  laser: { name: 'Laser Sight', slot: 'rail', price: 700, desc: '-30% hip-fire spread' },
};
export const ATTACH_IDS = Object.keys(ATTACH);

// Armor: each piece has per-tier stats (index = tier). def = damage reduction points (def / (def + 100)),
// fire / slow / blind = how much of that effect it shrugs off, speed = extra run speed.
export const ARMOR = {
  helmet: { name: 'Combat Helmet', slot: 'head', price: 600, def: [0, 8, 13, 18] },
  goggles: { name: 'Hex Goggles', slot: 'head', price: 900, def: [0, 3, 5, 7], blind: [0, 0.5, 0.7, 0.9], desc: 'Resist blindness, see further at night' },
  vest: { name: 'Kevlar Vest', slot: 'chest', price: 1000, def: [0, 15, 23, 32] },
  firevest: { name: 'Fireproof Vest', slot: 'chest', price: 1200, def: [0, 8, 12, 16], fire: [0, 0.5, 0.7, 0.9], desc: 'Resist burning' },
  pants: { name: 'Padded Pants', slot: 'legs', price: 700, def: [0, 9, 13, 18] },
  insulated: { name: 'Insulated Pants', slot: 'legs', price: 900, def: [0, 4, 6, 8], slow: [0, 0.5, 0.7, 0.9], desc: 'Resist slows and freezing' },
  boots: { name: 'Combat Boots', slot: 'feet', price: 500, def: [0, 6, 9, 12] },
  swift: { name: 'Swift Step Boots', slot: 'feet', price: 1100, def: [0, 2, 3, 4], speed: [0, 0.08, 0.12, 0.16], desc: 'Run faster' },
  nvg: { name: 'Night Vision Goggles', slot: 'head', price: 1500, def: [0, 2, 3, 4], nv: true, desc: 'See in the dark — switches on by itself at night (L flips them up)' },
};
export const ARMOR_IDS = Object.keys(ARMOR);

// How placed defenses behave (server/holdout/defenses.js). Turret family: turret/gturret/frturret/tesla
// hitscan a single target, rturret/mortar launch a tracked rocket (server/holdout/combat.js), flturret
// sprays a short cone. frturret/tesla/flturret always carry their element; the rest can be fitted with
// the Blacksmith's incendiary/frost rounds.
export const DEFENSES = {
  spikes: { uses: 90, tick: 0.5, dmg: 28, slow: 0.5 },
  darts: { uses: 70, tick: 0.6, dmg: 26, depth: 2.4 },
  flame: { uses: 45, tick: 1.4, dmg: 55, burn: 10, burnTime: 3 },
  turret: { hp: 350, range: 24, rate: 7, dmg: 13, ammo: 700 },
  rturret: { hp: 450, range: 30, rate: 1 / 3, dmg: 150, splash: 3.5, ammo: 30 },
  gturret: { hp: 280, range: 20, rate: 16, dmg: 5, ammo: 1000 },
  frturret: { hp: 300, range: 22, rate: 2.5, dmg: 9, ammo: 260 },
  flturret: { hp: 260, range: 9, tick: 1, dmg: 40, burn: 9, burnTime: 3, cos: Math.cos((40 * Math.PI) / 180), ammo: 200 },
  tesla: { hp: 320, range: 18, rate: 1, dmg: 26, ammo: 160 },
  mortar: { hp: 420, range: 46, minRange: 10, rate: 1 / 5, dmg: 230, splash: 5, ammo: 20 },
  campfire: { life: 30, heal: 6, shield: 5, radius: 3.6 },
};
// turret-family ids that the Blacksmith's anvil can upgrade (dmg/range/rate/ammo/plate, and inc/frost
// rounds on the ones without a built-in element)
export const TURRET_TYPES = ['turret', 'rturret', 'gturret', 'frturret', 'flturret', 'tesla', 'mortar'];
export const TURRET_EL = { frturret: 'ice', tesla: 'shock', flturret: 'fire' }; // built in: no incendiary / frost rounds for these

// The Core's own auto-turret, mounted on its roof (server/holdout/corecannon.js). Indestructible, unlimited
// ammo, always active during waves. Upgraded at the Core shop's CORE tab: every purchase raises room.coreLevel
// by one, which prices the next purchase and gates it behind a wave (see coreUpPrice below).
export const CORE_CANNON = { dmg: 30, rate: 2, range: 22 };
export const CORE_UPS = {
  dmg: { name: 'Cannon Damage', desc: '+35% damage per level' },
  rate: { name: 'Cannon Fire Rate', desc: '+25% fire rate per level' },
  range: { name: 'Cannon Range', desc: '+15% range per level' },
  fire: { name: 'Incendiary Rounds', desc: 'Burns whatever it hits', max: 1 },
  ice: { name: 'Cryo Rounds', desc: 'Chills and freezes whatever it hits', max: 1 },
  shock: { name: 'Shock Rounds', desc: 'Arcs to nearby zombies', max: 1 },
  barrels: { name: 'Extra Barrels', desc: '+1 target per shot per level' },
  plating: { name: 'Core Plating', desc: '+15% Core max HP per level, added right away' },
};
export const CORE_UP_IDS = Object.keys(CORE_UPS);
// price of the Core's next cannon upgrade (any kind) — scales off its overall level (room.coreLevel)
export const coreUpPrice = level => Math.round((3500 * 1.6 ** level) / 100) * 100;

// Bought by one player (or from the team bank) for the whole squad.
export const POWERUPS = {
  p_overshield: { name: 'Team Overshield', price: 4000, desc: 'Full shields for everyone' },
  p_damage: { name: 'Damage Boost', price: 5000, time: 60, desc: '+30% team damage for 60s' },
  p_rapid: { name: 'Rapid Fire', price: 5000, time: 60, desc: '+30% team fire rate for 60s' },
  p_fortify: { name: 'Fortify', price: 4000, desc: 'Repair and finish every build' },
  p_barrier: { name: 'Core Barrier', price: 6000, time: 20, desc: 'Core invulnerable 20s' },
};
export const BUFF = { damage: 1.3, rate: 1.3 };

// Permanent team-wide upgrades bought at the Core (or from the team bank), 5 levels each.
export const TEAM_UPS = {
  vitality: { name: 'Vitality', desc: '+10% max health per level', cost: [3000, 6000, 10000, 18000, 22000] },
  firepower: { name: 'Firepower', desc: '+8% damage per level', cost: [3500, 7000, 12000, 21600, 26400] },
  engineering: { name: 'Engineering', desc: '+20% build & repair speed, +10% build health per level', cost: [2500, 5000, 9000, 16200, 19800] },
  gunnery: { name: 'Gunnery', desc: '+10% reload speed and +6% fire rate per level', cost: [3000, 6000, 10000, 18000, 22000] },
};
export const TEAM_UP_IDS = Object.keys(TEAM_UPS);

export const AMMO_ITEMS = Object.fromEntries(AMMO_IDS.map(t => ['a_' + t, t]));
export const SHOP = [
  ['Pistols & SMGs', ['pistol', 'smg', 'tac_smg', 'compact']],
  ['Rifles', ['ar', 'burst', 'heavy_ar']],
  ['Shotguns & Heavy', ['pump', 'tac_shotgun', 'kinetic', 'hand_cannon', 'gl', 'rocket']],
  ['Snipers', ['h_ssg', 'h_awp']],
  ['Ammo', Object.keys(AMMO_ITEMS)],
  ['Throwables', THROWABLES],
  ['Adrenaline', ['adrenaline']],
  ['Traps', TRAPS],
  ['Turrets & Deployables', DEPLOYS],
  ['Armor', ARMOR_IDS],
  ['Team Powerups', Object.keys(POWERUPS)],
];

// Extra cost for an elemental version of a shop gun (Core sells tier I elemental guns at a markup).
export const elementPrice = id => 500 + Math.round((WEAPONS[id]?.price ?? 0) * 0.4 / 50) * 50;

// Price and display name of any shop entry.
export function shopEntry(id) {
  if (WEAPONS[id]?.mode === 'holdout') return { kind: 'gun', name: WEAPONS[id].name, price: WEAPONS[id].price };
  if (ARMOR[id]) return { kind: 'armor', name: ARMOR[id].name, price: ARMOR[id].price };
  if (AMMO_ITEMS[id]) { const a = AMMO[AMMO_ITEMS[id]]; return { kind: 'ammo', name: `${a.name} ×${a.pack}`, price: a.price, type: AMMO_ITEMS[id] }; }
  if (ITEMS[id]) return { kind: 'item', name: ITEMS[id].name, price: ITEMS[id].price };
  if (POWERUPS[id]) return { kind: 'power', name: POWERUPS[id].name, price: POWERUPS[id].price };
  return null;
}

// What an inventory item is worth (selling, and the buy-back price is half of this).
const GUN_R_MULT = [0.8, 1, 1.3, 1.7, 2.3], GUN_T_MULT = [1, 1.4, 2, 2.5, 3], ARMOR_T_MULT = [1, 1.4, 2];
export function itemValue(it) {
  if (!it) return 0;
  if (it.kind === 'gun') {
    if (WEAPONS[it.id]?.boss) return 6000;
    const base = (WEAPONS[it.id]?.price || 1000) * GUN_R_MULT[it.r ?? 0] * GUN_T_MULT[(it.tier ?? 1) - 1];
    const els = it.els ?? (it.el ? [it.el] : []);
    return Math.round(base + els.length * elementPrice(it.id));
  }
  if (it.kind === 'armor') return Math.round((ARMOR[it.id]?.price || 0) * ARMOR_T_MULT[(it.tier ?? 1) - 1]);
  if (it.kind === 'attach') return (ATTACH[it.id]?.price || 0) * (it.n ?? 1);
  return (ITEMS[it.id]?.price || 0) * (it.n ?? 1);
}
export const sellPrice = it => Math.floor(itemValue(it) * 0.5);

// ---------- loot ----------
const LOOT_GUNS = ['pistol', 'smg', 'tac_smg', 'compact', 'ar', 'burst', 'heavy_ar', 'pump', 'tac_shotgun', 'hand_cannon', 'h_ssg'];
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
export function rollRarity(rng, weights) {
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) <= 0) return i;
  return 0;
}
const ammoFor = (id, n = 1) => (WEAPONS[id].ammo ? { kind: 'ammo', type: WEAPONS[id].ammo, n: Math.round(AMMO[WEAPONS[id].ammo].pack * n * 1.5) } : null);
const adren = (n0, n1, rng) => ({ kind: 'item', id: 'adrenaline', n: n0 + Math.floor(rng() * (n1 - n0 + 1)) });
// a throwable, or (the 4-in-7 share the old heal items had) a stack of 2-4 Adrenaline Shots
const anyItem = rng => (rng() < 4 / 7 ? adren(2, 4, rng) : { kind: 'item', id: pick(rng, THROWABLES), n: 1 });
const mats = n => ({ kind: 'mats', mat: 'zink', n });
// a looted gun: rarity roll, a chance of an element, a chance of a higher tier
const lootGun = (rng, w, rw, elChance, t2 = 0, t3 = 0) => {
  const t = rng() < t3 ? 3 : rng() < t2 ? 2 : 1;
  return { kind: 'gun', w, r: rollRarity(rng, rw), tier: t, el: rng() < elChance ? pick(rng, ELEMENT_IDS) : null };
};
const lootArmor = (rng, t2 = 0, t3 = 0) => ({ kind: 'armor', id: pick(rng, ARMOR_IDS), tier: rng() < t3 ? 3 : rng() < t2 ? 2 : 1 });
const lootAttach = rng => ({ kind: 'item', id: pick(rng, ATTACH_IDS), n: 1 });

// Loot odds for traps/turrets/deployables: one weight per item, roughly the inverse of its price/impact
// so cheap traps are common and the big turrets are rare. Chests, supply drops, boss kills and elite/large
// zombie kills (shared/zombies.js ZTYPES[...].deployOdds) all roll from this same table.
export const DEPLOY_WEIGHT = {
  spikes: 100, darts: 90, flame: 60, campfire: 55,
  flturret: 22, frturret: 20, gturret: 18,
  turret: 14, tesla: 10,
  rturret: 5, mortar: 3,
};
export const DEPLOY_IDS = Object.keys(DEPLOY_WEIGHT);
const DEPLOY_TOTAL = DEPLOY_IDS.reduce((a, id) => a + DEPLOY_WEIGHT[id], 0);
export function rollDeploy(rng = Math.random) {
  let r = rng() * DEPLOY_TOTAL;
  for (const id of DEPLOY_IDS) if ((r -= DEPLOY_WEIGHT[id]) <= 0) return id;
  return DEPLOY_IDS[0];
}
// rolls > 1: pick the best (priciest) of several rolls — used to skew better loot sources toward the rarer turrets
const deployItem = (rng, rolls = 1) => {
  let id = rollDeploy(rng);
  for (let i = 1; i < rolls; i++) { const c = rollDeploy(rng); if (ITEMS[c].price > ITEMS[id].price) id = c; }
  return { kind: 'item', id, n: 1 };
};

// kind: 'chest' | 'drop' (supply balloon) | 'boss'. Returns pickups to scatter.
export function rollLoot(kind, rng = Math.random) {
  const out = [];
  if (kind === 'chest') {
    const w = pick(rng, LOOT_GUNS);
    out.push(lootGun(rng, w, [30, 30, 25, 12, 3], 0.1), ammoFor(w));
    if (rng() < 0.5) out.push(anyItem(rng));
    if (rng() < 0.15) out.push(lootArmor(rng));
    out.push(mats(45), deployItem(rng)); // mostly a cheap trap, rarely a good turret
  } else if (kind === 'drop') {
    const w = rng() < 0.25 ? pick(rng, ['rocket', 'minigun', 'gl', 'kinetic']) : pick(rng, LOOT_GUNS);
    out.push(lootGun(rng, w, [0, 10, 40, 35, 15], 0.4, 0.3), ammoFor(w, 2), anyItem(rng), anyItem(rng), mats(150), deployItem(rng, 2));
    if (rng() < 0.3) out.push(lootArmor(rng, 0.3));
    if (rng() < 0.25) out.push(lootAttach(rng));
  } else {
    for (let i = 0; i < 2; i++) { const w = pick(rng, [...LOOT_GUNS, 'rocket', 'minigun', 'gl', 'kinetic']); out.push({ ...lootGun(rng, w, [0, 0, 0, 1, 1], 0.6, 1, 0.35) }, ammoFor(w, 2)); }
    out.push(lootArmor(rng, 1, 0.35), lootAttach(rng), deployItem(rng, 4)); // best odds in the game at a good turret
    out.push(anyItem(rng), anyItem(rng), anyItem(rng), adren(1, 3, rng), mats(675), { kind: 'svsupply' }); // was 3x225 split across wood/stone/metal
  }
  return out.filter(Boolean);
}

// ---------- the Blacksmith (unlocks once wave 7 is cleared) ----------
// Turret upgrades with a `per` stack without limit (+per × base stat each level, price × 1.5 ** level, levels in
// d.mods); refill and incendiary / frost rounds are one-offs. They're also bought standing by the turret itself
// (turretReach m, the "Upgrade turret" key) — no Blacksmith needed for that.
// Milestones (ups): unlocked by the wave the squad has reached, each needs the gun's mastery level (shared/items.js
// MASTERY) plus money and Zinkonium — see milestoneBlock in shared/items.js.
export const SMITH = {
  x: -4.2, z: 3.6, reach: 3.6, turretReach: 3,
  infuse: { money: 1500, zink: 40 },
  turret: {
    dmg: { name: '+40% damage', price: 800, per: 0.4 },
    range: { name: '+25% range', price: 600, per: 0.25 },
    rate: { name: '+30% fire rate', price: 800, per: 0.3 },
    cap: { name: '+100% ammo capacity', price: 700, per: 1 },
    plate: { name: 'Plating +50% HP', price: 700, per: 0.5 },
    ammo: { name: 'Refill ammo', price: 400 },
    inc: { name: 'Incendiary rounds', price: 1000 },
    frost: { name: 'Frost rounds', price: 1000 },
  },
  ups: {
    multi: { name: 'Multishot', wave: 5, mastery: 2, money: 2500, zink: 120 },
    toxic: { name: 'Toxic element', wave: 5, mastery: 2, money: 2500, zink: 120 },
    tier4: { name: 'Tier IV', wave: 10, mastery: 4, money: 4000, zink: 200 },
    pierce: { name: 'Piercing', wave: 15, mastery: 3, money: 3500, zink: 160 },
    explo: { name: 'Explosive tips', wave: 15, mastery: 3, money: 3500, zink: 160 },
    tier5: { name: 'Tier V', wave: 20, mastery: 6, money: 8000, zink: 400 },
    slot2: { name: 'Second mod slot', wave: 25, mastery: 7, money: 6000, zink: 300 },
  },
  // The Ronin's katana tree (the panel's Katana section): the same gates as the milestones — the katana's mastery, money,
  // Zinkonium and the wave reached. Edge levels go in order; Elemental Edge is bought again to switch element.
  katana: {
    edge1: { name: 'Edge I', desc: '+20% damage', edge: 1, wave: 0, mastery: 1, money: 1000, zink: 60 },
    edge2: { name: 'Edge II', desc: '+20% damage', edge: 2, wave: 0, mastery: 2, money: 2000, zink: 100 },
    edge3: { name: 'Edge III', desc: '+20% damage', edge: 3, wave: 10, mastery: 3, money: 3500, zink: 160 },
    edge4: { name: 'Edge IV', desc: '+20% damage', edge: 4, wave: 15, mastery: 5, money: 5500, zink: 240 },
    edge5: { name: 'Edge V', desc: '+20% damage', edge: 5, wave: 20, mastery: 7, money: 8000, zink: 360 },
    twin: { name: 'Twin Fire Strike', desc: 'Fire Strike throws two crescents in a V', wave: 5, mastery: 3, money: 3000, zink: 150 },
    mirror: { name: 'Mirror Deflect', desc: 'Reflected projectiles hit twice as hard · perfect window 0.35 s', wave: 5, mastery: 3, money: 2500, zink: 120 },
    ember: { name: 'Ember Trail', desc: 'Fire Strike leaves burning ground for 3 s', wave: 10, mastery: 4, money: 4000, zink: 200 },
    chain: { name: 'Chain Dash', desc: 'Two dashes per cooldown', wave: 10, mastery: 4, money: 4000, zink: 180 },
    hemo: { name: 'Hemorrhage', desc: 'Bleed stacks to 10 and bleeds 50% harder', wave: 15, mastery: 5, money: 4500, zink: 200 },
    exec: { name: 'Execution', desc: 'The 3rd combo hit kills non-boss zombies under 15% HP', wave: 15, mastery: 6, money: 6000, zink: 260 },
    elem: { name: 'Elemental Edge', desc: 'The blade and Fire Strike carry an element (buy again to switch)', wave: 20, mastery: 5, money: 5000, zink: 220 },
  },
};
// a turret's stat multiplier from its upgrade levels, and what the next level of an upgrade costs
export const turretMul = (mods, up) => 1 + (SMITH.turret[up]?.per ?? 0) * (mods?.[up] || 0);
export const turretUpPrice = (up, mods) => { const u = SMITH.turret[up]; return u.per ? Math.round(u.price * 1.5 ** (mods?.[up] || 0)) : u.price; };
// Gun mods fitted at the Blacksmith (it.mods, one slot — two with the slot2 milestone). Bullet guns only.
export const GUN_MODS = {
  multi: { name: 'Multishot', desc: 'Every shot fires one extra round at 50% damage', frac: 0.5 },
  pierce: { name: 'Piercing', desc: 'Rounds go on through one more zombie at 70% damage', frac: 0.7 },
  explo: { name: 'Explosive tips', desc: 'Every hit bursts for 30% damage on zombies within 1.5 m', radius: 1.5, frac: 0.3 },
};

// ---------- player classes (picked in the lobby or at the Core during a break) ----------
export const CLASSES = {
  tank: {
    name: 'Tank', hp: 300, speed: 0.88, dr: 0.15, buildMul: 1.25,
    desc: '300 health · a bit slower · takes 15% less damage · immune to knockback and stuns from zombies · builds and repairs 25% faster · hold right-click with any gun but a sniper to raise a 1200 HP barrier',
  },
  assault: {
    name: 'Assault', hp: 200, speed: 1.1, dmg: 1.2, mag: 1.5, ammo: 1.5, killRate: 0.15, killRateMs: 3000,
    desc: '+20% damage · 50% bigger magazines · carries 50% more ammo · faster · +15% fire rate for 3s after a kill',
  },
  // the melee kit (server/holdout/ronin.js): heal HP/s anywhere once `healAfter` ms unhurt, +1 Adrenaline Shot every
  // `adrenEvery` ms (carries adrenCarry('ronin')), 3 hotbar slots with the Zinkonium Katana locked in the first
  ronin: {
    name: 'Ronin (Melee)', hp: 200, speed: 1.2, heal: 3, healAfter: 3000, adrenEvery: 5000,
    desc: '20% faster · heals 3 HP/s anywhere after 3 s unhurt · +1 Adrenaline Shot every 5 s (carries 30) · 3 hotbar slots, the Zinkonium Katana locked in slot 1: 3-hit combo, right-click Fire Strike, reload to Deflect, the dash key to dash',
  },
};
// how much of an ammo type you can carry (Assault carries more)
export const ammoCap = (type, cls) => Math.round((AMMO[type]?.cap ?? 0) * (CLASSES[cls]?.ammo ?? 1));
export const CLASS_IDS = Object.keys(CLASSES);
// The Tank's barrier (server/holdout/barrier.js): a wall of energy `dist` m in front, `width` × `height` m, facing
// your aim. hp; lowered it regrows `regen` HP/s after `delay` ms, broken it waits `cooldown` ms and regrows from 0.
// Raised: no firing and `speed`× run speed. Doesn't block movement.
export const BARRIER = { hp: 1200, regen: 150, delay: 2000, cooldown: 4000, dist: 1.2, width: 4, height: 2.6, speed: 0.6 };
// right-click raises it with any Holdout gun except snipers (they keep their scope)
export const canBarrier = id => WEAPONS[id]?.mode === 'holdout' && WEAPONS[id].cat !== 'sniper' && WEAPONS[id].cat !== 'melee';
// The Ronin's Zinkonium Katana (server/holdout/ronin.js; upgrades in SMITH.katana). Every hit deals its base × (1 + edge ×
// Edge level) × the team damage buffs, adds a bleed stack and crits ×crit from more than `back`° off the zombie's facing.
// combo: the LMB chain, a swing every swingMs, a swing within `window` ms of the last one's end continues it.
// strike: Fire Strike (RMB) — flaming crescents at `speed` m/s for `range` m, through every zombie within r m (each once)
// and through builds and props (never hurting them); the ground, the map's edge and the Core stop it. cd in ms.
// ember: Ember Trail's burning ground (zombies only), a patch every `every` m. deflect: the reload key — for `ms` it blocks
// zombie swings and projectiles from within `arc`° in front, reflecting projectiles at their shooter for `reflect`× their
// damage (× mirror more with Mirror Deflect); a block in the first `perfect` ms (mirrorPerfect with Mirror) is a perfect
// parry: +heal HP and +1 Adrenaline Shot, once a stance. dash: `dist` m along your aim over `ms`, through zombies (dmg
// each, within r m), walls stop it. bleed: dps per stack for `time` s, stacks to max (Hemorrhage: hemoMax, ×hemoMul).
export const KATANA = {
  reach: 3, maxHits: 8, swingMs: 350, window: 900, edge: 0.2, back: 110, crit: 1.5, exec: 0.15,
  combo: [{ dmg: 95, arc: 110 }, { dmg: 95, arc: 110 }, { dmg: 150, arc: 150, knock: 2.5 }],
  strike: { dmg: 120, speed: 25, range: 30, r: 1.3, cd: 6000, twin: 12 },
  ember: { r: 1.6, time: 3, dps: 40, every: 3 },
  deflect: { ms: 1200, cd: 3000, arc: 150, perfect: 250, mirrorPerfect: 350, heal: 15, reflect: 2, mirror: 2 },
  dash: { dist: 7, ms: 200, cd: 5000, dmg: 80, r: 1.1 },
  bleed: { dps: 3, time: 4, max: 5, hemoMax: 10, hemoMul: 1.5 },
  els: ['shock', 'ice', 'toxic', 'fire'], // Elemental Edge's picks
};

// ---------- survivor classes (rolled when a wounded survivor is rescued) ----------
// hpMult/dmgMult scale the tier's base numbers; guns[tier] curates which gun that class carries at each
// tier (tier itself still governs raw quality — see SURVIVOR.tiers). postBias steers pickPost(): positive
// holds nearer the outer edge of the ring ("the front"), negative nearer the Core ("the back").
export const SURVIVOR_CLASSES = {
  guardian: {
    name: 'Guardian', hpMult: 1.35, dmgMult: 0.85, postBias: 1, aggroMult: 0.7, color: 0x4d5866,
    desc: 'Most health · riot shield and a shotgun · holds the front of the ring and draws zombies',
    guns: ['pistol', 'pump', 'pump', 'tac_shotgun'],
  },
  medic: {
    name: 'Medic', hpMult: 0.75, dmgMult: 0.65, postBias: 0, heal: 3, healR: 4, color: 0xdce8dc,
    desc: 'Least damage · slowly heals nearby players and survivors',
    guns: ['pistol', 'pistol', 'smg', 'smg'],
  },
  ranger: {
    name: 'Ranger', hpMult: 1, dmgMult: 1.3, postBias: -1, color: 0x5c6b47,
    desc: 'Best damage · rifle or DMR · stays at the back of the ring',
    guns: ['pistol', 'ar', 'ar', 'h_ssg'],
  },
};
export const SURVIVOR_CLASS_IDS = Object.keys(SURVIVOR_CLASSES);

// ---------- survivors ----------
// Survivors come in tiers (raw gun quality: hp/dmg/rpm/hit/range/mag/ammo) crossed with a class (which
// actual gun they carry — see SURVIVOR_CLASSES[cls].guns — and their look). They heal very slowly on their own
// (Medic survivors and Rally Fires patch them up faster) and a dead survivor is gone for good.
export const SURVIVOR = {
  speed: 3.4, reload: 2.2, retreat: 6, leash: 14, // retreat: back off when a zombie is this close; leash: max stray from the Core
  tiers: [
    { name: 'Recruit', gun: 'Pistol', hp: 400, dmg: 16, rpm: 300, hit: 0.6, range: 18, mag: 12, ammo: 240 },
    { name: 'Guard', gun: 'SMG', hp: 500, dmg: 12, rpm: 600, hit: 0.55, range: 20, mag: 30, ammo: 420 },
    { name: 'Soldier', gun: 'Assault Rifle', hp: 600, dmg: 26, rpm: 420, hit: 0.62, range: 26, mag: 30, ammo: 360 },
    { name: 'Marksman', gun: 'DMR', hp: 550, dmg: 72, rpm: 110, hit: 0.8, range: 38, mag: 10, ammo: 120 },
  ],
};
// combined stats for a survivor's actual weapon: tier sets the numbers, class picks the gun (dmg scaled by class)
export function survivorGun(tier, cls) {
  const T = SURVIVOR.tiers[tier] ?? SURVIVOR.tiers[0], C = SURVIVOR_CLASSES[cls] ?? SURVIVOR_CLASSES.ranger;
  const w = C.guns[Math.min(tier, C.guns.length - 1)];
  return { ...T, w, dmg: Math.round(T.dmg * C.dmgMult), snd: WEAPONS[w]?.snd ?? 'glock' };
}
// wounded survivors wait in the shelters on waves 3, 7, 11, 15, …
export const rescueWave = w => w >= 3 && (w - 3) % 4 === 0;
export const RESCUE_WAVES = [3, 7, 11, 15, 19, 23, 27, 31];
// better survivors show up later in the game
export function survivorTier(wave, rng = Math.random) {
  const w = [Math.max(4, 60 - 5 * wave), 34, 4 + 3 * wave, Math.max(0, 2.5 * wave - 8)];
  return rollRarity(rng, w);
}
export const SURVIVOR_NAMES = ['Maya', 'Dex', 'Rook', 'Juno', 'Ivy', 'Otto', 'Kaz', 'Nell', 'Bram', 'Suki', 'Vale', 'Ren'];

export const intermissionFor = wave => Math.min(120, 35 + 7 * wave) * 1000; // longer breaks as waves get harder (2 min max)
export const MAW_BREAK = 4 * 60 * 1000; // the break after a Maw wave (15, 30 …) is longer instead — it wrecks the whole fort
export const MONEY_CAP = 50000;
