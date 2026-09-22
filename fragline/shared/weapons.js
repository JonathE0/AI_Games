// Weapon + economy definitions shared by client and server.
// Units: meters, seconds, degrees. Damage/economy numbers follow CS2 where possible.

// Spray pattern from sparse keypoints [bulletIndex, x, y] (degrees, +x right, +y up),
// linearly interpolated. Entry i is the cumulative offset of bullet i from where you aimed.
function pattern(count, keys, scale = 1) {
  const out = [];
  for (let i = 0; i < count; i++) {
    let k = 0;
    while (k < keys.length - 1 && keys[k + 1][0] <= i) k++;
    const a = keys[k], b = keys[Math.min(k + 1, keys.length - 1)];
    const t = b[0] === a[0] ? 0 : Math.min(1, (i - a[0]) / (b[0] - a[0]));
    out.push([(a[1] + (b[1] - a[1]) * t) * scale, (a[2] + (b[2] - a[2]) * t) * scale]);
  }
  return out;
}

// AK: straight up for ~9 bullets, hard left, sweep right, back left (the classic "7").
const AK_KEYS = [[0,0,0],[1,0,0.4],[2,0.05,1.0],[3,-0.05,1.75],[4,0.1,2.55],[5,0.2,3.3],[6,0.3,3.95],
  [7,0.35,4.5],[8,0.2,4.95],[9,-0.3,5.25],[10,-0.9,5.45],[11,-1.5,5.6],[12,-2.0,5.7],[13,-2.25,5.85],
  [14,-1.9,5.95],[15,-1.1,6.0],[16,-0.1,6.05],[17,0.9,6.0],[18,1.8,6.1],[19,2.4,6.25],[20,2.65,6.35],
  [21,2.3,6.45],[22,1.6,6.4],[23,0.9,6.5],[24,0.2,6.6],[25,-0.4,6.7],[26,-1.0,6.65],[27,-1.6,6.7],
  [28,-2.0,6.8],[29,-2.2,6.9]];
const M4_KEYS = [[0,0,0],[1,0,0.35],[2,0,0.85],[3,0.05,1.45],[4,0.1,2.1],[5,0.15,2.7],[6,0.2,3.25],
  [7,0.15,3.7],[8,0,4.05],[9,-0.3,4.3],[10,-0.7,4.5],[11,-1.1,4.6],[12,-1.35,4.7],[13,-1.2,4.8],
  [14,-0.7,4.85],[15,-0.1,4.9],[16,0.5,4.95],[17,1.0,5.0],[18,1.4,5.05],[19,1.55,5.1],[20,1.3,5.15],
  [21,0.8,5.2],[22,0.3,5.2],[23,-0.2,5.25],[24,-0.6,5.3],[25,-0.9,5.3],[26,-1.1,5.35],[27,-0.8,5.4],
  [28,-0.4,5.4],[29,0,5.45]];
const M4S_KEYS = [[0,0,0],[1,0,0.3],[3,0.05,1.2],[6,0.1,2.6],[8,-0.1,3.3],[10,-0.7,3.7],[12,-1.0,3.9],
  [14,-0.4,4.1],[16,0.4,4.25],[19,0.9,4.4]];

const W = {};
function def(id, o) {
  W[id] = { id, head: 4, wallPen: 1, pellets: 1, auto: false, silenced: false, scope: null, jitter: 0.15, ...o };
}

// acc: spread radius in degrees. stand/crouch = standing still, move = extra at full run speed,
// air = extra while airborne, fire = bloom added per shot (capped at fireMax, recovers over `recover` s).
def('knife', { name: '★ Karambit', skin: 'Case Hardened', rarity: 'knife', slot: 3, cat: 'melee', model: 'knife', snd: 'knife', price: 0, reward: 1500,
  dmg: 40, dmgAlt: 65, pen: 0.85, range: 1, rpm: 150, mag: 0, reserve: 0, reload: 0, deploy: 0.4, speed: 6.35,
  reach: 1.7, acc: null, recoil: [[0, 0]], idxRecover: 1 });

def('glock', { name: 'Glock-18', skin: 'Fade', rarity: 'restricted', slot: 2, cat: 'pistol', model: 'pistol', snd: 'glock', price: 200, reward: 300,
  dmg: 30, pen: 0.47, range: 0.85, rpm: 400, mag: 20, reserve: 120, reload: 1.8, deploy: 0.6, speed: 6.10,
  acc: { stand: 0.75, crouch: 0.6, move: 2.2, air: 5, fire: 0.35, fireMax: 2.2, recover: 0.3 },
  recoil: pattern(20, [[0,0,0],[1,0,0.6],[3,0.2,1.6],[6,-0.3,2.6],[10,0.4,3.2],[14,-0.4,3.6],[19,0.2,4.0]], 0.7), idxRecover: 11 });

def('usp', { name: 'USP-S', skin: 'Kill Confirmed', rarity: 'covert', slot: 2, cat: 'pistol', model: 'pistolS', snd: 'usp', silenced: true, price: 200, reward: 300,
  dmg: 35, pen: 0.505, range: 0.91, rpm: 352, mag: 12, reserve: 24, reload: 1.7, deploy: 0.6, speed: 6.10,
  acc: { stand: 0.3, crouch: 0.24, move: 2.6, air: 6, fire: 0.55, fireMax: 2.6, recover: 0.35 },
  recoil: pattern(12, [[0,0,0],[1,0,0.8],[3,0.1,2.0],[6,-0.2,3.0],[11,0.3,3.8]], 0.7), idxRecover: 10 });

def('p250', { name: 'P250', skin: 'Asiimov', rarity: 'covert', slot: 2, cat: 'pistol', model: 'pistol', snd: 'p250', price: 300, reward: 300,
  dmg: 38, pen: 0.64, range: 0.85, rpm: 400, mag: 13, reserve: 26, reload: 1.8, deploy: 0.6, speed: 6.10,
  acc: { stand: 0.6, crouch: 0.5, move: 2.4, air: 5.5, fire: 0.6, fireMax: 2.6, recover: 0.35 },
  recoil: pattern(13, [[0,0,0],[1,0,0.9],[4,0.2,2.6],[8,-0.3,3.6],[12,0.2,4.2]], 0.75), idxRecover: 10, jitter: 0.2 });

def('deagle', { name: 'Desert Eagle', skin: 'Blaze', rarity: 'restricted', slot: 2, cat: 'pistol', model: 'deagle', snd: 'deagle', price: 700, reward: 300,
  dmg: 53, pen: 0.932, range: 0.85, wallPen: 2, rpm: 267, mag: 7, reserve: 35, reload: 2.0, deploy: 0.8, speed: 5.84,
  acc: { stand: 0.35, crouch: 0.28, move: 5.5, air: 10, fire: 1.8, fireMax: 5, recover: 0.5 },
  recoil: pattern(7, [[0,0,0],[1,0.1,2.2],[2,-0.2,4.0],[3,0.3,5.5],[6,0,7.5]], 0.75), idxRecover: 5, jitter: 0.3 });

def('mac10', { name: 'MAC-10', skin: 'Neon Rider', rarity: 'covert', slot: 1, cat: 'smg', model: 'smg', snd: 'mac10', auto: true, price: 1050, reward: 600,
  dmg: 29, pen: 0.575, range: 0.8, rpm: 800, mag: 30, reserve: 100, reload: 2.1, deploy: 0.75, speed: 6.10,
  acc: { stand: 1.1, crouch: 0.9, move: 2.4, air: 6, fire: 0.15, fireMax: 2.0, recover: 0.35 },
  recoil: pattern(30, [[0,0,0],[1,0,0.5],[4,0.2,1.9],[8,-0.4,3.0],[12,-1.2,3.6],[16,-0.6,4.0],[20,0.6,4.3],[24,1.4,4.5],[29,0.8,4.8]], 1.2),
  idxRecover: 24, jitter: 0.25 });

def('mp9', { name: 'MP9', skin: 'Starlight Protector', rarity: 'covert', slot: 1, cat: 'smg', model: 'smg', snd: 'mp9', auto: true, price: 1250, reward: 600,
  dmg: 26, pen: 0.6, range: 0.87, rpm: 857, mag: 30, reserve: 120, reload: 2.0, deploy: 0.75, speed: 6.10,
  acc: { stand: 0.85, crouch: 0.7, move: 2.2, air: 6, fire: 0.15, fireMax: 1.8, recover: 0.35 },
  recoil: pattern(30, [[0,0,0],[1,0,0.45],[3,0.1,1.6],[6,0.3,3.0],[9,0.8,3.8],[12,1.6,4.2],[15,2.2,4.4],[18,1.8,4.6],[21,1.0,4.8],[24,1.6,5.0],[27,2.4,5.1],[29,2.0,5.2]], 1.2),
  idxRecover: 26, jitter: 0.2 });

def('p90', { name: 'P90', skin: 'Death by Kitty', rarity: 'covert', slot: 1, cat: 'smg', model: 'p90', snd: 'p90', auto: true, price: 2350, reward: 300,
  dmg: 26, pen: 0.69, range: 0.86, rpm: 857, mag: 50, reserve: 100, reload: 2.8, deploy: 0.75, speed: 5.84,
  acc: { stand: 0.95, crouch: 0.8, move: 2.6, air: 6, fire: 0.12, fireMax: 1.8, recover: 0.4 },
  recoil: pattern(50, [[0,0,0],[1,0,0.3],[4,0.05,1.3],[8,-0.1,2.5],[12,-0.5,3.2],[16,-1.1,3.6],[20,-1.6,3.9],[25,-1.0,4.1],[30,0,4.25],[35,0.9,4.35],[40,1.4,4.45],[45,0.8,4.55],[49,0.2,4.6]], 1.2),
  idxRecover: 30, jitter: 0.2 });

def('nova', { name: 'Nova', skin: 'Hyper Beast', rarity: 'covert', slot: 1, cat: 'shotgun', model: 'shotgun', snd: 'nova', price: 1050, reward: 900,
  dmg: 26, pellets: 9, pelletSpread: 2.8, pen: 0.5, range: 0.7, wallPen: 0.5, rpm: 68, mag: 8, reserve: 32,
  reload: 0.4, reloadStart: 0.35, shellReload: true, deploy: 0.9, speed: 5.59,
  acc: { stand: 0.4, crouch: 0.35, move: 1.6, air: 4, fire: 0, fireMax: 0, recover: 0.5 },
  recoil: pattern(8, [[0,0,0],[1,0,2.4],[7,0,4]]), idxRecover: 3, jitter: 0.3 });

def('galil', { name: 'Galil AR', skin: 'Chatterbox', rarity: 'covert', slot: 1, cat: 'rifle', model: 'galil', snd: 'galil', auto: true, price: 1800, reward: 300,
  dmg: 30, pen: 0.775, range: 0.98, wallPen: 2, rpm: 666, mag: 35, reserve: 90, reload: 2.4, deploy: 1.0, speed: 5.84,
  acc: { stand: 0.45, crouch: 0.34, move: 6.5, air: 12, fire: 0.14, fireMax: 1.5, recover: 0.4 },
  recoil: pattern(35, [[0,0,0],[1,0,0.4],[4,0.1,2.2],[8,0.15,4.2],[10,-0.6,4.6],[13,-1.8,5.0],[16,-0.4,5.2],[19,1.4,5.35],[22,2.0,5.5],[25,0.8,5.6],[28,-0.6,5.7],[31,-1.5,5.8],[34,-1.0,5.9]], 1.3),
  idxRecover: 22, jitter: 0.2 });

def('ak47', { name: 'AK-47', skin: 'Fire Serpent', rarity: 'covert', slot: 1, cat: 'rifle', model: 'ak', snd: 'ak47', auto: true, price: 2700, reward: 300,
  dmg: 36, pen: 0.775, range: 0.98, wallPen: 2, rpm: 600, mag: 30, reserve: 90, reload: 2.2, deploy: 1.0, speed: 5.46,
  acc: { stand: 0.32, crouch: 0.24, move: 7.5, air: 14, fire: 0.12, fireMax: 1.4, recover: 0.37 },
  recoil: pattern(30, AK_KEYS, 1.3), idxRecover: 20, jitter: 0.18 });

def('m4a4', { name: 'M4A4', skin: 'Howl', rarity: 'contraband', slot: 1, cat: 'rifle', model: 'm4', snd: 'm4a4', auto: true, price: 2900, reward: 300,
  dmg: 33, pen: 0.7, range: 0.97, wallPen: 2, rpm: 666, mag: 30, reserve: 90, reload: 2.5, deploy: 1.0, speed: 5.72,
  acc: { stand: 0.26, crouch: 0.2, move: 6.8, air: 13, fire: 0.1, fireMax: 1.2, recover: 0.35 },
  recoil: pattern(30, M4_KEYS, 1.3), idxRecover: 22, jitter: 0.15 });

def('m4a1s', { name: 'M4A1-S', skin: 'Printstream', rarity: 'covert', slot: 1, cat: 'rifle', model: 'm4s', snd: 'm4a1s', silenced: true, auto: true, price: 2900, reward: 300,
  dmg: 38, pen: 0.7, range: 0.99, wallPen: 2, rpm: 600, mag: 20, reserve: 80, reload: 2.5, deploy: 1.0, speed: 5.72,
  acc: { stand: 0.2, crouch: 0.15, move: 6.8, air: 13, fire: 0.08, fireMax: 1.0, recover: 0.33 },
  recoil: pattern(20, M4S_KEYS, 1.25), idxRecover: 22, jitter: 0.12 });

// Snipers: scope = zoom factors per zoom level; `unscoped` replaces stand/crouch spread when not zoomed.
def('ssg08', { name: 'SSG 08', skin: 'Dragonfire', rarity: 'covert', slot: 1, cat: 'sniper', model: 'ssg', snd: 'ssg08', bolt: true, price: 1700, reward: 300,
  dmg: 88, pen: 0.85, range: 0.95, wallPen: 2.5, rpm: 48, mag: 10, reserve: 90, reload: 2.8, deploy: 1.1, speed: 5.84,
  scope: [2.2, 6.0], scopedSpeed: 5.84,
  acc: { stand: 0.06, crouch: 0.05, unscoped: 2.8, move: 4.0, air: 3.5, fire: 0, fireMax: 0, recover: 0.3 },
  recoil: pattern(10, [[0,0,0],[1,0,2.0],[9,0,3.0]]), idxRecover: 4, jitter: 0.2 });

def('awp', { name: 'AWP', skin: 'Dragon Lore', rarity: 'covert', slot: 1, cat: 'sniper', model: 'awp', snd: 'awp', bolt: true, price: 4750, reward: 100,
  dmg: 115, pen: 0.975, range: 0.99, wallPen: 2.5, rpm: 41, mag: 5, reserve: 30, reload: 3.2, deploy: 1.25, speed: 5.08,
  scope: [2.75, 11.4], scopedSpeed: 2.54,
  acc: { stand: 0.04, crouch: 0.03, unscoped: 7, move: 10, air: 20, fire: 0, fireMax: 0, recover: 0.3 },
  recoil: pattern(5, [[0,0,0],[1,0,3],[4,0,4]]), idxRecover: 3, jitter: 0.3 });

// ---------- Zombie Holdout arsenal ----------
// Arcade-shooter style guns (bloom instead of hard spray, small movement penalty, double-size magazines)
// plus the two CS snipers kept as-is. Damage is tuned against zombie health, not player-vs-player TTK.
// `ammo` = backpack ammo type; items also carry a rarity (shared/holdout.js).
const soft = (n, climb, drift = 0.15) => pattern(n, [[0, 0, 0], [1, 0, climb * 0.2], [Math.max(2, n - 1), drift, climb]]);
function gun(id, o) { def(id, { mode: 'holdout', slot: 1, reward: 0, reserve: 0, rarity: 'restricted', idxRecover: 12, jitter: 0.1, ...o }); }

gun('pistol', { name: 'Pistol', short: 'Pistol', cat: 'pistol', model: 'pistol', snd: 'glock', ammo: 'light', price: 200,
  dmg: 30, head: 2, pen: 0.8, range: 0.9, rpm: 420, mag: 32, reload: 1.4, deploy: 0.45, speed: 6.1,
  acc: { stand: 0.35, crouch: 0.3, move: 1.2, air: 3, fire: 0.3, fireMax: 2, recover: 0.3 }, recoil: soft(32, 1.2) });
gun('smg', { name: 'Submachine Gun', short: 'SMG', cat: 'smg', model: 'smg', snd: 'mp9', ammo: 'light', auto: true, price: 900,
  dmg: 24, head: 2, pen: 0.8, range: 0.85, rpm: 720, mag: 60, reload: 2.0, deploy: 0.5, speed: 6.0,
  acc: { stand: 0.9, crouch: 0.75, move: 0.9, air: 2.5, fire: 0.1, fireMax: 2.2, recover: 0.35 }, recoil: soft(60, 2.2, 0.4) });
gun('tac_smg', { name: 'Tactical SMG', short: 'Tac SMG', cat: 'smg', model: 'smg', snd: 'mac10', ammo: 'light', auto: true, price: 1100,
  dmg: 26, head: 2, pen: 0.8, range: 0.86, rpm: 780, mag: 50, reload: 2.2, deploy: 0.5, speed: 6.0,
  acc: { stand: 0.8, crouch: 0.65, move: 0.9, air: 2.5, fire: 0.1, fireMax: 2, recover: 0.35 }, recoil: soft(50, 2.4, -0.3) });
gun('compact', { name: 'Compact SMG', short: 'Compact', cat: 'smg', model: 'p90', snd: 'p90', ammo: 'light', auto: true, price: 1300,
  dmg: 26, head: 2, pen: 0.82, range: 0.87, rpm: 700, mag: 80, reload: 2.6, deploy: 0.55, speed: 5.95,
  acc: { stand: 0.75, crouch: 0.6, move: 0.8, air: 2.5, fire: 0.08, fireMax: 1.8, recover: 0.35 }, recoil: soft(80, 2.2, 0.2) });
gun('ar', { name: 'Assault Rifle', short: 'AR', cat: 'rifle', model: 'm4', snd: 'm4a4', ammo: 'medium', auto: true, price: 1400, wallPen: 2,
  dmg: 50, head: 2, pen: 0.85, range: 0.96, rpm: 330, mag: 60, reload: 2.3, deploy: 0.6, speed: 5.9,
  acc: { stand: 0.3, crouch: 0.22, move: 1.2, air: 3, fire: 0.2, fireMax: 2.4, recover: 0.35 }, recoil: soft(60, 1.8, 0.3) });
gun('burst', { name: 'Burst Rifle', short: 'Burst', cat: 'rifle', model: 'galil', snd: 'galil', ammo: 'medium', burst: 3, burstDelay: 0.34, price: 1300, wallPen: 2,
  dmg: 44, head: 2, pen: 0.85, range: 0.96, rpm: 720, mag: 60, reload: 2.5, deploy: 0.6, speed: 5.9,
  acc: { stand: 0.28, crouch: 0.2, move: 1.1, air: 3, fire: 0.12, fireMax: 1.8, recover: 0.4 }, recoil: soft(60, 1.6, -0.2) });
gun('heavy_ar', { name: 'Heavy Rifle', short: 'Heavy AR', cat: 'rifle', model: 'ak', snd: 'ak47', ammo: 'medium', auto: true, price: 2000, wallPen: 2,
  dmg: 68, head: 2, pen: 0.9, range: 0.97, rpm: 230, mag: 50, reload: 2.8, deploy: 0.7, speed: 5.75,
  acc: { stand: 0.35, crouch: 0.25, move: 1.4, air: 3.5, fire: 0.35, fireMax: 3, recover: 0.4 }, recoil: soft(50, 3.2, 0.5) });
gun('pump', { name: 'Pump Shotgun', short: 'Pump', cat: 'shotgun', model: 'shotgun', snd: 'nova', ammo: 'shells', price: 1200, wallPen: 0.5,
  dmg: 16, pellets: 10, pelletSpread: 3.2, head: 2, pen: 0.8, range: 0.7, rpm: 55, mag: 10, reload: 0.5, reloadStart: 0.3, shellReload: true, deploy: 0.6, speed: 5.8,
  acc: { stand: 0.3, crouch: 0.25, move: 0.8, air: 2, fire: 0, fireMax: 0, recover: 0.5 }, recoil: pattern(10, [[0, 0, 0], [1, 0, 2.4], [9, 0, 3]]), idxRecover: 3 });
gun('tac_shotgun', { name: 'Tactical Shotgun', short: 'Tac Shotty', cat: 'shotgun', model: 'shotgun', snd: 'nova', ammo: 'shells', price: 1000, wallPen: 0.5,
  dmg: 11, pellets: 10, pelletSpread: 3.6, head: 2, pen: 0.8, range: 0.7, rpm: 100, mag: 16, reload: 0.35, reloadStart: 0.3, shellReload: true, deploy: 0.55, speed: 5.9,
  acc: { stand: 0.35, crouch: 0.3, move: 0.8, air: 2, fire: 0, fireMax: 0, recover: 0.5 }, recoil: pattern(16, [[0, 0, 0], [1, 0, 1.6], [15, 0, 2.2]]), idxRecover: 4 });
gun('hand_cannon', { name: 'Hand Cannon', short: 'Hand Cannon', cat: 'pistol', model: 'deagle', snd: 'deagle', ammo: 'heavy', price: 1000, wallPen: 2,
  dmg: 110, head: 2, pen: 0.93, range: 0.9, rpm: 90, mag: 14, reload: 2.0, deploy: 0.7, speed: 5.9,
  acc: { stand: 0.3, crouch: 0.25, move: 1.5, air: 4, fire: 1.4, fireMax: 3.5, recover: 0.5 }, recoil: pattern(14, [[0, 0, 0], [1, 0.1, 2.2], [13, 0, 5]], 0.7), idxRecover: 5 });
gun('h_ssg', { ...W.ssg08, id: 'h_ssg', mode: 'holdout', skinOf: 'ssg08', short: 'SSG 08', ammo: 'heavy', reserve: 0, reward: 0, mag: 20 });
gun('h_awp', { ...W.awp, id: 'h_awp', mode: 'holdout', skinOf: 'awp', short: 'AWP', ammo: 'heavy', reserve: 0, reward: 0, mag: 10 });
gun('rocket', { name: 'Rocket Launcher', short: 'Rockets', cat: 'launcher', model: 'rocket', snd: 'rocket', ammo: 'rockets', projectile: 'rocket', price: 3000,
  dmg: 260, splash: 4.5, head: 1, pen: 1, range: 1, rpm: 50, mag: 2, reload: 2.6, deploy: 0.8, speed: 5.3,
  acc: { stand: 0.2, crouch: 0.15, move: 0.8, air: 2, fire: 0, fireMax: 0, recover: 0.5 }, recoil: pattern(2, [[0, 0, 0], [1, 0, 3]]), idxRecover: 3 });
gun('gl', { name: 'Grenade Launcher', short: 'Launcher', cat: 'launcher', model: 'gl', snd: 'rocket', ammo: 'rockets', projectile: 'grenade', price: 2600,
  dmg: 150, splash: 3.6, head: 1, pen: 1, range: 1, rpm: 90, mag: 6, reload: 0.55, reloadStart: 0.35, shellReload: true, deploy: 0.7, speed: 5.6,
  acc: { stand: 0.3, crouch: 0.2, move: 0.9, air: 2, fire: 0, fireMax: 0, recover: 0.5 }, recoil: pattern(6, [[0, 0, 0], [1, 0, 2.2], [5, 0, 3]]), idxRecover: 3 });
// crowd control: a cone of force that throws zombies back (light ones far, heavy ones barely)
gun('kinetic', { name: 'Shockwave Blaster', short: 'Shockwave', cat: 'shotgun', model: 'kinetic', snd: 'kinetic', ammo: 'shells', projectile: 'blast', price: 1800,
  dmg: 66, cone: 60, blastRange: 9, head: 1, pen: 1, range: 1, rpm: 45, mag: 8, reload: 0.5, reloadStart: 0.3, shellReload: true, deploy: 0.6, speed: 5.8,
  acc: { stand: 0.3, crouch: 0.25, move: 0.8, air: 2, fire: 0, fireMax: 0, recover: 0.5 }, recoil: pattern(8, [[0, 0, 0], [1, 0, 3], [7, 0, 3.5]]), idxRecover: 3 });
// the Stalker's blade: a wide slash that hits everything in front of you, and you run faster holding it
gun('blade', { name: 'Slasher Blade', short: 'Blade', cat: 'melee', model: 'blade', snd: 'knife', price: 0, pellets: 6, arc: 120, speedBuff: 1.15,
  dmg: 60, dmgAlt: 95, pen: 0.9, range: 1, rpm: 100, mag: 0, reload: 0, deploy: 0.4, speed: 6.35, reach: 2.8, acc: null, recoil: [[0, 0]], idxRecover: 1 });
// the Ronin's Zinkonium Katana: never sold or looted, locked in his hotbar slot 1 — its moves and numbers live in
// shared/holdout.js KATANA (server/holdout/ronin.js)
gun('katana', { name: 'Zinkonium Katana', short: 'Katana', cat: 'melee', model: 'katana', snd: 'knife', price: 0, arc: 110,
  dmg: 95, dmgAlt: 150, pen: 1, range: 1, rpm: 170, mag: 0, reload: 0, deploy: 0.35, speed: 6.35, reach: 3, acc: null, recoil: [[0, 0]], idxRecover: 1 });
gun('minigun', { name: 'Minigun', short: 'Minigun', cat: 'rifle', model: 'minigun', snd: 'minigun', ammo: 'medium', auto: true, spin: 0.6, price: 0, wallPen: 1.5,
  dmg: 22, head: 1.5, pen: 0.85, range: 0.93, rpm: 1000, mag: 200, reload: 4.2, deploy: 1.0, speed: 4.6,
  acc: { stand: 1.1, crouch: 0.9, move: 0.8, air: 2.5, fire: 0.05, fireMax: 1.6, recover: 0.4 }, recoil: soft(200, 1.4, 0.3) });

// ---------- boss weapons: unique drops only (never sold), always Legendary tier III with no element ----------
gun('skybreaker', { name: 'Skybreaker', short: 'Skybreaker', cat: 'sniper', model: 'awp', snd: 'awp', bolt: true, ammo: 'heavy', boss: true, price: 0,
  dmg: 150, pen: 0.975, range: 0.99, wallPen: 2.5, rpm: 41, mag: 8, reload: 3.2, deploy: 1.25, speed: 5.08,
  scope: [2.75, 11.4], scopedSpeed: 2.54, pierce: 8, mark: true, // pierce: hits up to 8 zombies per bullet; mark: +25% dmg taken for 5s
  acc: { stand: 0.04, crouch: 0.03, unscoped: 7, move: 10, air: 20, fire: 0, fireMax: 0, recover: 0.3 },
  recoil: pattern(8, [[0, 0, 0], [1, 0, 3], [7, 0, 4]]), idxRecover: 3, jitter: 0.3 });
gun('broodlauncher', { name: 'Brood Launcher', short: 'Brood Launcher', cat: 'launcher', model: 'gl', snd: 'rocket', ammo: 'rockets', projectile: 'grenade', boss: true, price: 0,
  dmg: 150, splash: 3.6, bomblets: 3, head: 1, pen: 1, range: 1, rpm: 90, mag: 6, reload: 0.55, reloadStart: 0.35, shellReload: true, deploy: 0.7, speed: 5.6,
  acc: { stand: 0.3, crouch: 0.2, move: 0.9, air: 2, fire: 0, fireMax: 0, recover: 0.5 }, recoil: pattern(6, [[0, 0, 0], [1, 0, 2.2], [5, 0, 3]]), idxRecover: 3 });
gun('mawfang', { name: 'Maw Fang', short: 'Maw Fang', cat: 'shotgun', model: 'shotgun', snd: 'nova', ammo: 'shells', boss: true, price: 0, wallPen: 0.5,
  dmg: 20, pellets: 12, pelletSpread: 3.2, head: 2, pen: 0.8, range: 0.7, rpm: 55, mag: 12, reload: 0.5, reloadStart: 0.3, shellReload: true, deploy: 0.6, speed: 5.8,
  lifesteal: 0.1, bite: 5, // lifesteal: heal 10% of damage dealt; bite: every 5th shot pulls nearby zombies in
  acc: { stand: 0.3, crouch: 0.25, move: 0.8, air: 2, fire: 0, fireMax: 0, recover: 0.5 }, recoil: pattern(12, [[0, 0, 0], [1, 0, 2.4], [11, 0, 3]]), idxRecover: 3 });
gun('cleaver', { name: 'Alpha Cleaver', short: 'Cleaver', cat: 'melee', model: 'blade', snd: 'knife', boss: true, price: 0, pellets: 8, arc: 150, speedBuff: 1.15, knockdown: true,
  dmg: 110, dmgAlt: 170, pen: 0.9, range: 1, rpm: 100, mag: 0, reload: 0, deploy: 0.4, speed: 6.35, reach: 3.4, acc: null, recoil: [[0, 0]], idxRecover: 1 });
// the Gravekeeper's lightning rifle — chain: every hit arcs to the 2 nearest zombies like shock rounds; pool: every
// 4th shot that hits leaves a 2 s shock pool that only hurts zombies (server/holdout/gravekeeper.js knellPool)
gun('knell', { name: 'Knell', short: 'Knell', cat: 'rifle', model: 'm4', snd: 'm4a4', ammo: 'medium', auto: true, boss: true, price: 0, wallPen: 2,
  dmg: 52, head: 2, pen: 0.9, range: 0.97, rpm: 330, mag: 45, reload: 2.4, deploy: 0.6, speed: 5.85,
  chain: true, pool: { every: 4, r: 2.5, time: 2, dps: 60 },
  acc: { stand: 0.28, crouch: 0.2, move: 1.1, air: 3, fire: 0.18, fireMax: 2.2, recover: 0.35 }, recoil: soft(45, 1.7, 0.25) });
// the Behemoth's launcher — bomblets: each rocket splits into 3 cluster bomblets on impact (server/holdout/combat.js)
gun('siegebreaker', { name: 'Siegebreaker', short: 'Siegebreaker', cat: 'launcher', model: 'rocket', snd: 'rocket', ammo: 'rockets', projectile: 'rocket', boss: true, price: 0,
  dmg: 280, splash: 4.5, bomblets: 3, head: 1, pen: 1, range: 1, rpm: 60, mag: 3, reload: 2.4, deploy: 0.8, speed: 5.3,
  acc: { stand: 0.2, crouch: 0.15, move: 0.8, air: 2, fire: 0, fireMax: 0, recover: 0.5 }, recoil: pattern(3, [[0, 0, 0], [1, 0, 3], [2, 0, 3]]), idxRecover: 3 });

// Boss gun perk blurbs, appended to the shop/inventory gun description (holdout_ui.js, inventory_ui.js).
export const BOSS_PERKS = {
  skybreaker: 'BOSS · pierces and marks zombies (+25% damage)',
  broodlauncher: 'BOSS · scatters acid bomblets on impact',
  mawfang: 'BOSS · lifesteal · every 5th shot pulls zombies in',
  cleaver: 'BOSS · knocks down everything it hits',
  knell: 'BOSS · hits chain to 2 zombies · every 4th hit leaves a shock pool',
  siegebreaker: 'BOSS · rockets split into 3 cluster bomblets on impact',
};

// Holdout: holding a non-gun hotbar item (grenade, adrenaline shot, trap…) — nothing to shoot, the item gets used.
def('hold_item', { mode: 'hold', name: 'Item', short: 'Item', cat: 'item', model: 'item', slot: 1, price: 0, reward: 0,
  dmg: 0, pen: 0, range: 1, rpm: 120, mag: 0, reserve: 0, reload: 0, deploy: 0.25, speed: 6.2 });

export const WEAPONS = W;

export const PART_MULT = { chest: 1, arm: 1, stomach: 1.25, legs: 0.75 };
const RANGE_UNIT = 12.7; // CS range modifiers apply per 500 units (12.7 m)

export function maxSpeed(w, scoped) {
  return scoped && w.scopedSpeed ? w.scopedSpeed : w.speed;
}

// CS-style damage: range falloff, hitgroup multiplier, then armor absorption.
// Returns { hp, armor } = health removed and armor removed.
export function computeDamage(w, part, dist, armor, helmet, penMult = 1, opts = {}) {
  let d;
  if (w.cat === 'melee') {
    d = opts.alt ? (opts.back ? 180 : w.dmgAlt) : (opts.back ? 90 : w.dmg);
  } else {
    d = w.dmg * Math.pow(w.range, dist / RANGE_UNIT) * penMult;
    d *= part === 'head' ? w.head : (PART_MULT[part] ?? 1);
  }
  let armorLoss = 0;
  const armored = armor > 0 && (part === 'head' ? helmet : part !== 'legs');
  if (armored) {
    let hpDmg = d * w.pen;
    let aDmg = (d - hpDmg) * 0.5;
    if (aDmg > armor) { aDmg = armor; hpDmg = d - aDmg * 2; }
    armorLoss = aDmg;
    d = hpDmg;
  }
  return { hp: Math.max(1, Math.floor(d)), armor: Math.floor(armorLoss), armored };
}
