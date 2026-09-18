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
  rockets: { name: 'Rockets', cap: 12, pack: 2, price: 400, color: '#b4e87a' },
};
export const AMMO_IDS = Object.keys(AMMO);
export const START_AMMO = { light: 180, medium: 60, heavy: 0, shells: 0, rockets: 0 };
export const MAT_CAP = 999;

// kind: throw (T), heal / shield (H), trap (on your floors / walls) and deploy (turrets & campfires on the ground),
// both placed from build mode.
export const ITEMS = {
  grenade: { name: 'Grenade', kind: 'throw', price: 300, max: 6, dmg: 190, radius: 4.5, fuse: 1.6 },
  molotov: { name: 'Molotov', kind: 'throw', price: 350, max: 6, dps: 40, radius: 3.6, burn: 7 },
  freeze: { name: 'Freeze Grenade', kind: 'throw', price: 400, max: 6, radius: 5, freeze: 4 },
  bandage: { name: 'Bandage', kind: 'heal', price: 150, max: 10, time: 3, hp: 15, cap: 75 },
  medkit: { name: 'Medkit', kind: 'heal', price: 500, max: 3, time: 6, hp: 100, cap: 100 },
  shield_s: { name: 'Small Shield', kind: 'shield', price: 300, max: 6, time: 2, sh: 25, cap: 50 },
  shield: { name: 'Shield Potion', kind: 'shield', price: 600, max: 3, time: 4, sh: 50, cap: 100 },
  adrenaline: { name: 'Adrenaline Shot', kind: 'adrenaline', price: 600, max: 3, hp: 60, time: 8, regen: 7, dmgMult: 1.2, speedMult: 1.15, cooldown: 2000 },
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
export const HEALS = ['bandage', 'medkit', 'shield_s', 'shield'];

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
  ['Healing', HEALS],
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
const GUN_R_MULT = [0.8, 1, 1.3, 1.7, 2.3], GUN_T_MULT = [1, 1.4, 2], ARMOR_T_MULT = [1, 1.4, 2];
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
const anyItem = rng => ({ kind: 'item', id: pick(rng, [...THROWABLES, ...HEALS]), n: 1 });
const mats = (rng, n) => ({ kind: 'mats', mat: pick(rng, ['wood', 'stone', 'metal']), n });
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
    out.push(mats(rng, 45), deployItem(rng)); // mostly a cheap trap, rarely a good turret
  } else if (kind === 'drop') {
    const w = rng() < 0.25 ? pick(rng, ['rocket', 'minigun', 'gl', 'kinetic']) : pick(rng, LOOT_GUNS);
    out.push(lootGun(rng, w, [0, 10, 40, 35, 15], 0.4, 0.3), ammoFor(w, 2), anyItem(rng), anyItem(rng), mats(rng, 150), deployItem(rng, 2));
    if (rng() < 0.3) out.push(lootArmor(rng, 0.3));
    if (rng() < 0.25) out.push(lootAttach(rng));
  } else {
    for (let i = 0; i < 2; i++) { const w = pick(rng, [...LOOT_GUNS, 'rocket', 'minigun', 'gl', 'kinetic']); out.push({ ...lootGun(rng, w, [0, 0, 0, 1, 1], 0.6, 1, 0.35) }, ammoFor(w, 2)); }
    out.push(lootArmor(rng, 1, 0.35), lootAttach(rng), deployItem(rng, 4)); // best odds in the game at a good turret
    out.push(anyItem(rng), anyItem(rng), anyItem(rng), { kind: 'mats', mat: 'wood', n: 225 }, { kind: 'mats', mat: 'stone', n: 225 }, { kind: 'mats', mat: 'metal', n: 225 }, { kind: 'svsupply' });
  }
  return out.filter(Boolean);
}

// ---------- the Blacksmith (unlocks once wave 7 is cleared) ----------
// turret upgrades stack without limit (price × 1.5 ** level, tracked per level in d.mods); "Refill ammo"
// stays a one-off (no level, just tops the magazine back up to DEFENSES[...].ammo).
export const SMITH = {
  x: -4.2, z: 3.6, reach: 3.6,
  infuse: { money: 1500, metal: 40 },
  turret: {
    dmg: { name: '+25% damage', price: 800 },
    range: { name: '+20% range', price: 600 },
    rate: { name: '+20% fire rate', price: 800 },
    ammo: { name: 'Refill ammo', price: 400 },
    inc: { name: 'Incendiary rounds', price: 1000 },
    frost: { name: 'Frost rounds', price: 1000 },
    plate: { name: 'Armor plate +300 HP', price: 700 },
  },
};

// ---------- player classes (picked in the lobby or at the Core during a break) ----------
export const CLASSES = {
  tank: {
    name: 'Tank', hp: 300, speed: 0.88, dr: 0.15, buildMul: 1.25,
    desc: '300 health · a bit slower · takes 15% less damage · immune to knockback and stuns from zombies · builds and repairs 25% faster',
  },
  assault: {
    name: 'Assault', hp: 200, speed: 1.1, dmg: 1.2, mag: 1.5, ammo: 1.5, killRate: 0.15, killRateMs: 3000,
    desc: '+20% damage · 50% bigger magazines · carries 50% more ammo · faster · +15% fire rate for 3s after a kill',
  },
  medic: {
    name: 'Medic', hp: 200, speed: 1, regen: 6, aura: 8, auraR: 5, revive: 0.5, healMul: 1.25, coreShieldRegen: 2,
    desc: 'Heals over time and heals people near you · revives twice as fast · healing items are 25% stronger · a free medkit every 2 waves · regenerates shield near the Core',
  },
};
// how much of an ammo type you can carry (Assault carries more)
export const ammoCap = (type, cls) => Math.round((AMMO[type]?.cap ?? 0) * (CLASSES[cls]?.ammo ?? 1));
export const CLASS_IDS = Object.keys(CLASSES);

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
// actual gun they carry — see SURVIVOR_CLASSES[cls].guns — and their look). They never heal on their own
// (medics, campfires and your bandages / medkits can patch them up) and a dead survivor is gone for good.
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
export const MONEY_CAP = 50000;
