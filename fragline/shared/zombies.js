// Holdout zombies and wave scaling: pure data + formulas shared by the server (spawning, AI) and the
// browser (models, sounds). Meters, m/s, seconds. Difficulty scales with the number of players (n).

// reach = melee range, windup = telegraphed swing time (step back to dodge), cooldown after a swing.
// dmg hits players, sdmg hits structures/the Core. armor/helmet use CS armor rules (thick hide).
export const ZTYPES = {
  shambler: { id: 'shambler', name: 'Shambler', weight: 1, hp: 120, speed: 2.6, scale: 1, dmg: 12, sdmg: 35, reach: 1.5, windup: 0.6, cooldown: 1.3, reward: 75, cost: 1, from: 1 },
  runner: { id: 'runner', name: 'Runner', weight: 0.5, hp: 80, speed: 5.2, scale: 0.92, dmg: 8, sdmg: 15, reach: 1.4, windup: 0.45, cooldown: 0.9, reward: 60, cost: 1.2, from: 2, aggro: 16 },
  spitter: { id: 'spitter', name: 'Spitter', weight: 1, hp: 120, speed: 2.4, scale: 1, dmg: 18, sdmg: 60, reach: 1.5, windup: 0.8, cooldown: 3.2, reward: 150, cost: 3, from: 3, ranged: true, range: 18, keep: 10, splash: 2 },
  brute: { id: 'brute', name: 'Brute', weight: 3, hp: 600, armor: 100, helmet: true, speed: 2.0, scale: 1.35, dmg: 35, sdmg: 180, reach: 1.9, windup: 0.9, cooldown: 1.8, reward: 400, cost: 8, from: 4, deployOdds: 0.05 },
  // boss HP ignores the wave multiplier and scales harder with the squad instead (see bossHp)
  alpha: { id: 'alpha', name: 'Alpha Brute', hp: 3000, armor: 100, helmet: true, speed: 2.3, scale: 1.7, dmg: 50, sdmg: 400, reach: 2.4, windup: 1.0, cooldown: 2.0, reward: 2000, cost: 0, boss: true },
  // ---- specialists (server/holdout/behaviors.js) ----
  // small, fast knife-fighter: a tiny hitbox and quick combos
  stalker: { id: 'stalker', name: 'Stalker', weight: 0.5, hp: 70, speed: 6.2, scale: 0.72, dmg: 9, sdmg: 12, reach: 1.3, windup: 0.3, cooldown: 0.55, reward: 90, cost: 1.4, from: 4, aggro: 18 },
  // stays back by its spawn gate and snipes (survivors and turrets take double); a laser gives it away
  sniper: { id: 'sniper', name: 'Sniper', weight: 1, hp: 140, speed: 2.6, scale: 1, dmg: 29, npcDmg: 58, sdmg: 20, reach: 1.5, windup: 2.2, cooldown: 4, reward: 220, cost: 3, from: 6, sniper: true, range: 70, noVariant: true },
  // bursts into an acid pool when it dies: shoot it before it reaches you
  bloater: { id: 'bloater', name: 'Bloater', weight: 1.5, hp: 300, speed: 1.8, scale: 1.2, dmg: 14, sdmg: 40, reach: 1.6, windup: 0.8, cooldown: 1.6, reward: 180, cost: 3, from: 6, burst: { radius: 4, dmg: 30, sdmg: 120, pool: 5, dps: 12 }, deployOdds: 0.05 },
  // lobs blindness potions and leaves ink clouds
  hexer: { id: 'hexer', name: 'Hexer', weight: 1, hp: 130, speed: 2.4, scale: 1, dmg: 10, sdmg: 20, reach: 1.5, windup: 0.9, cooldown: 4.5, reward: 200, cost: 3, from: 7, ranged: true, range: 16, keep: 8, splash: 3, potion: 'blind' },
  // tunnels once under a build that blocks it and comes up one tile past it
  burrower: { id: 'burrower', name: 'Burrower', weight: 1, hp: 180, speed: 2.8, scale: 1, dmg: 16, sdmg: 45, reach: 1.5, windup: 0.6, cooldown: 1.2, reward: 160, cost: 2, from: 9, burrow: true },
  // riot shield: bullets from the front barely hurt; flank it, blow it up, burn it or knock it over
  shield: { id: 'shield', name: 'Shieldbearer', weight: 3, hp: 400, speed: 2.2, scale: 1.1, dmg: 20, sdmg: 70, reach: 1.6, windup: 0.8, cooldown: 1.6, reward: 260, cost: 4, from: 9, shield: 0.15, deployOdds: 0.05 },
  // sets you on fire and leaves burning footprints; fire does nothing to it, water and ice hurt it more
  pyro: { id: 'pyro', name: 'Pyro', weight: 1, hp: 220, speed: 2.8, scale: 1.05, dmg: 16, sdmg: 50, reach: 1.6, windup: 0.6, cooldown: 1.3, reward: 200, cost: 3, from: 11, immune: 'fire', weak: ['water', 'ice'], ignite: 3 },
  // freezing aura that slows everyone around it; ice does nothing to it, fire hurts it more
  // wall breaker: paths straight at the Core ignoring piece costs (flowfield.js bstep) and smashes through
  // whatever is in its way at full sdmg (no group/global reduction), splashing 40% to nearby pieces too
  golem: { id: 'golem', name: 'Iron Golem', weight: 3, hp: 1100, armor: 100, helmet: true, speed: 1.9, scale: 1.35, dmg: 28, sdmg: 520, reach: 2.2, windup: 1.2, cooldown: 2.2, reward: 450, cost: 7, from: 7, noVariant: true, breaker: true, deployOdds: 0.06 },
  // ignores players and survivors entirely; beelines the normal flow field for the Core and chips the Core
  // itself for a fixed amount per hit once it gets there (damageCore still applies CORE_ARMOR on top)
  seeker: { id: 'seeker', name: 'Core Seeker', weight: 0.8, hp: 240, speed: 3.3, scale: 0.95, dmg: 0, sdmg: 50, reach: 1.5, windup: 0.5, cooldown: 1.0, reward: 250, cost: 3, from: 5, noVariant: true, noAggro: true, cdmg: 140 },
  // ---- flyers (server/holdout/flyers.js): airborne, ignore the ground flow field and every wall ----
  // circles high, screeches, dives at a player, climbs back; no projectiles, a big/easy hitbox to compensate
  swooper: { id: 'swooper', name: 'Swooper', weight: 0.6, hp: 150, speed: 9, scale: 1, dmg: 24, sdmg: 0, reach: 1.6, windup: 0.5, cooldown: 2.4, reward: 170, cost: 2.2, from: 8, noVariant: true, flyer: true },
  // hovers at a vantage point in the air and snipes exactly like a ground Sniper (locked-line laser telegraph,
  // same damage); repositions after a few shots. Rarer than the Swooper.
  skysniper: { id: 'skysniper', name: 'Sky Sniper', weight: 0.18, hp: 170, speed: 7, scale: 1.15, dmg: 29, npcDmg: 58, sdmg: 0, reach: 0, windup: 2.2, cooldown: 4, reward: 260, cost: 4, from: 9, noVariant: true, flyer: true, sniper: true, range: 70 },
  // ---- bosses (server/holdout/bosses.js) ----
  // wave 10: a giant that smashes builds with stomps, carrying riders that throw acid and cannot be hurt until they jump off
  titan: { id: 'titan', name: 'Brood Titan', hp: 18000, speed: 1.5, scale: 4.2, dmg: 45, sdmg: 600, reach: 4.2, windup: 1.3, cooldown: 2.6, reward: 3000, cost: 0, boss: true, noVariant: true, stomp: 5.5 },
  rider: { id: 'rider', name: 'Brood Rider', weight: 0.7, hp: 160, speed: 3.6, scale: 0.8, dmg: 12, sdmg: 25, reach: 1.4, windup: 0.5, cooldown: 1.1, reward: 120, cost: 0, noVariant: true, splash: 2, deployOdds: 0.03 },
  // two permanent seats on the Titan's back: never dismount on their own, immune while mounted (same rule as
  // other riders), snipe like a ground Sniper once they fall off with it dead
  broodsniper: { id: 'broodsniper', name: 'Brood Sniper Rider', weight: 0.7, hp: 200, speed: 3.6, scale: 0.8, dmg: 29, npcDmg: 58, sdmg: 20, reach: 1.4, windup: 2.2, cooldown: 4.5, reward: 180, cost: 0, noVariant: true, sniper: true, range: 70, deployOdds: 0.04 },
  frost: { id: 'frost', name: 'Frost Walker', weight: 1.2, hp: 260, speed: 2.4, scale: 1.1, dmg: 14, sdmg: 45, reach: 1.6, windup: 0.7, cooldown: 1.4, reward: 220, cost: 3, from: 12, immune: 'ice', weak: ['fire'], chillAura: 5 },
  // only spawns on night waves: nothing special about its AI, it just hides in the dark (see public/js/zombies.js)
  shade: { id: 'shade', name: 'Shade', weight: 0.6, hp: 160, speed: 3.6, scale: 1, dmg: 6, sdmg: 8, reach: 1.5, windup: 0.5, cooldown: 1.3, reward: 180, cost: 1.4, from: 6, nightOnly: true, noVariant: true },
};
export const ZTYPE_IDS = Object.keys(ZTYPES); // index = id on the wire

// Zombie "classes", mirroring the players': armored tanks, frenzied assaulters and plague medics that
// heal the zombies around them (kill those first). Rolled on top of the normal types from wave 6 on.
export const ZCLASSES = {
  tank: { name: 'Armored', hp: 2, speed: 0.8, scale: 1.15 },
  assault: { name: 'Frenzied', dmg: 1.35, speed: 1.25 },
  medic: { name: 'Plague Medic', heal: 0.06, radius: 6 },
};
export const ZCLASS_IDS = ['', 'tank', 'assault', 'medic']; // index = id on the wire
export const variantChance = w => (w < 6 ? 0 : Math.min(0.4, 0.1 + (w - 6) * 0.0215));

// What special zombies drop when they die.
export const ZDROPS = {
  sniper: { chance: 0.35, gun: w => (w >= 15 ? 'h_awp' : 'h_ssg') },
  stalker: { chance: 0.2, gun: 'blade' },
  bloater: { chance: 0.1, gun: 'gl' },
};

export const WAVES = 10; // the old finale; waves now go on forever and simply keep getting harder
export const DIFFS = { casual: 0.7, normal: 1, hard: 1.4 };

// A boss every 5 waves, rotating: the Colossus (5, 20, 35…), the Brood Titan (10, 25…), the Maw (15, 30…).
export const BOSS_ROTATION = ['sky', 'titan', 'maw'];
export const bossFor = w => (w > 0 && w % 5 === 0 ? BOSS_ROTATION[(w / 5 - 1) % BOSS_ROTATION.length] : null);
export const bossCycle = w => Math.max(0, Math.floor((w / 5 - 1) / BOSS_ROTATION.length)); // 0 = first time around
// the Alpha Brute shows up as an elite every 4th wave from wave 12 (never on a boss wave)
export const alphaWave = w => w >= 12 && w % 4 === 0 && !bossFor(w);
// night waves: a fifth of the time from wave 4, never with a boss
export const nightRoll = (w, rng = Math.random) => w >= 4 && !bossFor(w) && rng() < 0.2;
export const AGGRO = 10;           // default melee aggro radius (needs line of sight)

// Wave time limit: stops a horde being farmed forever. Grows with the wave, caps at 9 min, plus 4 extra
// minutes on boss waves (those fights are long by design). berserk.js (director) enforces it server-side.
export const waveTimeLimit = w => Math.min(540, 180 + 12 * w) + (bossFor(w) ? 240 : 0);
// Berserk (time's up): every zombie still alive speeds up and hits harder, and reinforcements trickle in
// scaled by the squad size, never worth money or loot.
export const BERSERK_SPEED_MULT = 1.5, BERSERK_DMG_MULT = 1.4;
export const berserkGroupSize = n => 1 + Math.floor(Math.max(1, n) / 2); // reinforcements per spawn tick
export const BERSERK_INTERVAL = 6; // seconds between reinforcement groups

const nn = n => Math.max(1, n);
export const countMult = n => 1 + 0.75 * (nn(n) - 1);
export const hpMult = (n, w) => (1 + 0.2 * (nn(n) - 1)) * (1 + 0.1 * (w - 1));
export const bossHp = (t, n) => Math.round(t.hp * (1 + 0.6 * (nn(n) - 1)));
export const CORE_ARMOR = 0.4; // the Core only takes 40 % of a zombie's structure damage
export const dmgMult = w => 1 + 0.05 * (w - 1);
export const laneCount = (n, w) => Math.max(1, Math.min(4, 1 + Math.floor((w - 1) / 3) + Math.floor(nn(n) / 2)));
export const aliveCap = n => 30 + 15 * nn(n);
export const coreHp = n => Math.round(3000 * (1 + 0.15 * (nn(n) - 1)));
// solo: ~10 zombies on wave 1, ~70 on wave 10; after that it grows steadily (the HP multiplier keeps climbing too)
const baseBudget = w => (w <= 10 ? 6 + 3 * w + 0.7 * w * w : 106 + 14 * (w - 10));
export const waveBudget = (w, n, diff = 1) => baseBudget(w) * countMult(n) * diff;

// Type weights for a wave; specials get +10 % weight per extra player. night: this wave is a night wave
// (only then can nightOnly types like the Shade appear — enforced below regardless of who calls this).
export function waveWeights(w, n, night = false) {
  const extra = 1 + 0.1 * (nn(n) - 1);
  const W = { shambler: 10 };
  if (w >= ZTYPES.runner.from) W.runner = 2 + w * 0.5;
  if (w >= ZTYPES.spitter.from) W.spitter = (1 + w * 0.25) * extra;
  if (w >= ZTYPES.brute.from) W.brute = (0.4 + w * 0.12) * extra;
  const spec = (id, base, per) => { if (w >= ZTYPES[id].from) W[id] = (base + (w - ZTYPES[id].from) * per) * extra; };
  spec('stalker', 1.4, 0.12); spec('sniper', 0.5, 0.05); spec('bloater', 0.8, 0.06); spec('hexer', 0.6, 0.05);
  spec('burrower', 0.8, 0.06); spec('shield', 0.5, 0.05); spec('pyro', 0.8, 0.06); spec('frost', 0.8, 0.06);
  spec('shade', 1.0, 0.08); spec('seeker', 0.8, 0.07); spec('golem', 0.15, 0.03); // golem: rarer than the Brute
  spec('swooper', 0.4, 0.05); spec('skysniper', 0.1, 0.015); // flyers: the Sky Sniper is rarer still
  if (!night) for (const id of Object.keys(W)) if (ZTYPES[id].nightOnly) delete W[id];
  return W;
}
// snipers camp at their gates: only a few per wave
export const sniperCap = w => 1 + Math.floor(w / 8);

// Spend a budget on zombie types. Returns a list of type ids (the finale adds the Alpha Brute).
// night: pass the wave's planned night flag through so Shades only turn up when it's actually dark.
export function composeWave(w, n, diff = 1, rng = Math.random, budget = waveBudget(w, n, diff), night = false) {
  const W = waveWeights(w, n, night), ids = Object.keys(W), total = ids.reduce((s, id) => s + W[id], 0);
  const list = [];
  while (budget > 0) {
    let r = rng() * total, id = ids[0];
    for (const k of ids) if ((r -= W[k]) <= 0) { id = k; break; }
    if (id === 'sniper' && list.filter(x => x === 'sniper').length >= sniperCap(w)) id = 'shambler';
    list.push(id);
    budget -= ZTYPES[id].cost;
  }
  return list;
}
