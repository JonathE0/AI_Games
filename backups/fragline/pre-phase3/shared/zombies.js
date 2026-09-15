// Holdout zombies and wave scaling: pure data + formulas shared by the server (spawning, AI) and the
// browser (models, sounds). Meters, m/s, seconds. Difficulty scales with the number of players (n).

// reach = melee range, windup = telegraphed swing time (step back to dodge), cooldown after a swing.
// dmg hits players, sdmg hits structures/the Core. armor/helmet use CS armor rules (thick hide).
export const ZTYPES = {
  shambler: { id: 'shambler', name: 'Shambler', hp: 120, speed: 2.6, scale: 1, dmg: 12, sdmg: 35, reach: 1.5, windup: 0.6, cooldown: 1.3, reward: 75, cost: 1, from: 1 },
  runner: { id: 'runner', name: 'Runner', hp: 80, speed: 5.2, scale: 0.92, dmg: 8, sdmg: 15, reach: 1.4, windup: 0.45, cooldown: 0.9, reward: 60, cost: 1.2, from: 2, aggro: 16 },
  spitter: { id: 'spitter', name: 'Spitter', hp: 120, speed: 2.4, scale: 1, dmg: 18, sdmg: 60, reach: 1.5, windup: 0.8, cooldown: 3.2, reward: 150, cost: 3, from: 3, ranged: true, range: 18, keep: 10, splash: 2 },
  brute: { id: 'brute', name: 'Brute', hp: 600, armor: 100, helmet: true, speed: 2.0, scale: 1.35, dmg: 35, sdmg: 180, reach: 1.9, windup: 0.9, cooldown: 1.8, reward: 400, cost: 8, from: 4 },
  // boss HP ignores the wave multiplier and scales harder with the squad instead (see bossHp)
  alpha: { id: 'alpha', name: 'Alpha Brute', hp: 3000, armor: 100, helmet: true, speed: 2.3, scale: 1.7, dmg: 50, sdmg: 400, reach: 2.4, windup: 1.0, cooldown: 2.0, reward: 2000, cost: 0, boss: true },
};
export const ZTYPE_IDS = Object.keys(ZTYPES); // index = id on the wire

export const WAVES = 10;
export const DIFFS = { casual: 0.7, normal: 1, hard: 1.4 };
export const AGGRO = 10;           // default melee aggro radius (needs line of sight)

const nn = n => Math.max(1, n);
export const countMult = n => 1 + 0.75 * (nn(n) - 1);
export const hpMult = (n, w) => (1 + 0.2 * (nn(n) - 1)) * (1 + 0.1 * (w - 1));
export const bossHp = (t, n) => Math.round(t.hp * (1 + 0.6 * (nn(n) - 1)));
export const CORE_ARMOR = 0.4; // the Core only takes 40 % of a zombie's structure damage
export const dmgMult = w => 1 + 0.05 * (w - 1);
export const laneCount = (n, w) => Math.max(1, Math.min(4, 1 + Math.floor((w - 1) / 3) + Math.floor(nn(n) / 2)));
export const aliveCap = n => 30 + 15 * nn(n);
export const coreHp = n => Math.round(3000 * (1 + 0.15 * (nn(n) - 1)));
export const waveBudget = (w, n, diff = 1) => (6 + 3 * w + 0.7 * w * w) * countMult(n) * diff; // solo: ~10 zombies on wave 1, ~105 on wave 10

// Type weights for a wave; specials get +10 % weight per extra player.
export function waveWeights(w, n) {
  const extra = 1 + 0.1 * (nn(n) - 1);
  const W = { shambler: 10 };
  if (w >= ZTYPES.runner.from) W.runner = 2 + w * 0.5;
  if (w >= ZTYPES.spitter.from) W.spitter = (1 + w * 0.25) * extra;
  if (w >= ZTYPES.brute.from) W.brute = (0.4 + w * 0.12) * extra;
  return W;
}

// Spend a budget on zombie types. Returns a list of type ids (the finale adds the Alpha Brute).
export function composeWave(w, n, diff = 1, rng = Math.random, budget = waveBudget(w, n, diff)) {
  const W = waveWeights(w, n), ids = Object.keys(W), total = ids.reduce((s, id) => s + W[id], 0);
  const list = [];
  while (budget > 0) {
    let r = rng() * total, id = ids[0];
    for (const k of ids) if ((r -= W[k]) <= 0) { id = k; break; }
    list.push(id);
    budget -= ZTYPES[id].cost;
  }
  return list;
}
