// Weapon mastery (kills per item), the Blacksmith's wave milestones (tier IV / V, Multishot / Piercing / Explosive
// tips, the Toxic element, a second mod slot — each needs mastery + money + Zinkonium), and turret upgrades (bigger
// per-level buffs, bought at the anvil or standing by the turret with the "Upgrade turret" key).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGun } from '../server/holdout/inventory.js';
import { HoldoutRoom } from '../server/holdout/room.js';
import { updateHazards } from '../server/holdout/behaviors.js';
import { WEAPONS } from '../shared/weapons.js';
import { SMITH, DEFENSES, GUN_MODS, itemValue, turretMul } from '../shared/holdout.js';
import { TIERS, MASTERY, masteryLevel, gunMult, itemName } from '../shared/items.js';
import { EL } from '../shared/elements.js';
import { GRID, distToBox } from '../shared/build.js';

let T = 9_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 50) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
function join(room, name = 'P') {
  const messages = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const player = room.addPlayer(ws, name);
  return { player, messages, last: t => messages.filter(m => m.t === t).at(-1), all: t => messages.filter(m => m.t === t) };
}
function setup(code) {
  const room = new HoldoutRoom(code, {}), a = join(room, 'A'), p = a.player;
  room.startWave(1);
  room.director.queue = [];
  p.st.p = [0, 0, -3];
  return { room, a, p };
}
// a plain, unarmored shambler standing at (x, z), tough enough to count damage on
function zed(room, x, z, hp = 5000) {
  const zb = room.spawnZombie('shambler', 'N', '');
  Object.assign(zb, { pos: [x, 0, z], hist: [], hp, maxHp: Math.max(hp, 5000), armor: 0, helmet: false });
  return zb;
}
const O = [0, 1.2, -3], FWD = [0, 0, -1]; // a level shot at chest height along -z, from the player at (0, 0, -3)
const shoot = (room, p, gun, h, d = [FWD, FWD]) => { T += 1000; room.handle(p, { t: 'shot', w: gun.id, uid: gun.uid, o: O, d, e: [], h }); };
const atSmith = (room, p) => { room.bosses.smith = true; p.st.p = [SMITH.x, 0, SMITH.z]; };

test('mastery: levels 1-8 at the kill thresholds; kills count on the exact item that made them and ride along with the inventory', () => {
  assert.deepEqual(MASTERY, [0, 25, 60, 110, 180, 270, 380, 520]);
  assert.deepEqual([0, 24, 25, 59, 60, 110, 519, 520, 9999].map(kills => masteryLevel({ kills })), [1, 1, 2, 2, 3, 4, 7, 8, 8]);
  assert.equal(masteryLevel({}), 1, 'a fresh gun is mastery 1');
  const { room, a, p } = setup('MA');
  const ar1 = p.inv[1] = makeGun('ar'), ar2 = p.inv[2] = makeGun('ar');
  for (let i = 0; i < 25; i++) shoot(room, p, ar2, [{ id: zed(room, 0, -10, 1).id, part: 'chest', pen: 1, k: 0 }]);
  assert.equal(ar2.kills, 25, 'every kill with the second AR counts on it');
  assert.equal(ar1.kills, undefined, 'the other AR of the same type gets nothing');
  assert.equal(masteryLevel(ar2), 2);
  assert.equal(a.last('inv').inv[2].kills, 25, 'kills are sent with the inventory');
  // a launcher's rocket lands later: it counts if you fired that launcher in the last few seconds
  const rl = p.inv[3] = makeGun('rocket');
  p.lastShot.rocket = T;
  room.killZombie(zed(room, 5, -10), p, 'rocket');
  assert.equal(rl.kills, 1);
  T += 7000;
  room.killZombie(zed(room, 5, -10), p, 'rocket'); // your rocket turret's rocket, not your launcher
  room.killZombie(zed(room, 5, -10), p, 'toxic');  // poison ticking on after the shot
  room.killZombie(zed(room, 5, -10), p, 'turret');
  assert.deepEqual([rl.kills, ar2.kills], [1, 25], 'turrets and damage over time don\'t count toward mastery');
});

test('milestones unlock by the wave reached, each only once its wave comes', () => {
  const { room, a, p } = setup('ML');
  atSmith(room, p);
  const want = { multi: 5, toxic: 5, tier4: 10, pierce: 15, explo: 15, tier5: 20, slot2: 25 };
  assert.deepEqual(Object.fromEntries(Object.entries(SMITH.ups).map(([id, u]) => [id, u.wave])), want);
  for (const [id, wave] of Object.entries(want)) {
    const gun = p.inv[1] = makeGun('ar', 1, id === 'tier4' ? 3 : id === 'tier5' ? 4 : 1);
    gun.kills = 1000;
    p.money = 50000;
    p.mats.zink = 900;
    room.wave = wave - 1;
    room.handle(p, { t: 'smith', op: 'mile', uid: gun.uid, id });
    assert.equal(a.last('deny').text, `Unlocks at wave ${wave}`, id);
    assert.deepEqual([p.money, p.mats.zink], [50000, 900], `${id}: nothing charged while locked`);
    room.wave = wave;
    room.handle(p, { t: 'smith', op: 'mile', uid: gun.uid, id });
    const u = SMITH.ups[id];
    assert.deepEqual([p.money, p.mats.zink], [50000 - u.money, 900 - u.zink], `${id}: charged once unlocked`);
    if (id === 'tier4' || id === 'tier5') assert.equal(gun.tier, id === 'tier4' ? 4 : 5);
    else if (id === 'toxic') assert.deepEqual(gun.els, ['toxic']);
    else if (id === 'slot2') assert.equal(gun.modSlots, 2);
    else assert.deepEqual(gun.mods, [id]);
  }
  room.bosses.smith = false;
  const gun = p.inv[1] = makeGun('ar');
  gun.kills = 1000;
  room.handle(p, { t: 'smith', op: 'mile', uid: gun.uid, id: 'multi' });
  assert.equal(gun.mods, undefined, 'milestones are bought from the Blacksmith himself');
});

test('milestones: the server enforces mastery, money and Zinkonium, the tier order, and bullet-only mods', () => {
  const { room, a, p } = setup('MR');
  atSmith(room, p);
  room.wave = 30;
  const gun = p.inv[1] = makeGun('ar');
  const tryUp = (id, it = gun) => room.handle(p, { t: 'smith', op: 'mile', uid: it.uid, id });
  const fill = (money, zink, kills) => { p.money = money; p.mats.zink = zink; gun.kills = kills; };
  fill(10000, 500, 24);
  tryUp('multi');
  assert.match(a.last('deny').text, /Needs mastery 2/);
  fill(2499, 500, 25);
  tryUp('multi');
  assert.equal(a.last('deny').text, 'Needs $2500');
  fill(2500, 119, 25);
  tryUp('multi');
  assert.equal(a.last('deny').text, 'Needs 120 Zinkonium');
  assert.equal(gun.mods, undefined, 'nothing fitted while a requirement is short');
  fill(2500, 120, 25);
  tryUp('multi');
  assert.deepEqual([gun.mods, p.money, p.mats.zink], [['multi'], 0, 0], 'exactly the requirements: fitted, paid in full');
  fill(99999, 999, 1000);
  tryUp('multi');
  assert.equal(a.last('deny').text, 'Already fitted');
  tryUp('pierce');
  assert.deepEqual(gun.mods, ['pierce'], 'one slot: a new mod replaces the old one');
  tryUp('slot2');
  tryUp('explo');
  assert.deepEqual(gun.mods, ['pierce', 'explo'], 'two slots once the second-slot milestone is bought');
  tryUp('multi');
  assert.deepEqual(gun.mods, ['explo', 'multi'], 'both full: the oldest goes');
  tryUp('tier5');
  assert.equal(a.last('deny').text, 'Needs tier IV first');
  tryUp('tier4');
  assert.equal(a.last('deny').text, 'Forge tier III first');
  gun.tier = 3;
  fill(99999, 999, 1000);
  tryUp('tier4');
  tryUp('tier5');
  assert.equal(gun.tier, 5);
  const rl = p.inv[2] = makeGun('rocket');
  rl.kills = 1000;
  tryUp('multi', rl);
  assert.equal(a.last('deny').text, 'Only for guns that fire bullets');
  assert.equal(rl.mods, undefined);
  room.handle(p, { t: 'smith', op: 'mile', uid: p.inv[1].uid, id: 'bogus' });
  room.handle(p, { t: 'smith', op: 'mile', uid: 123456, id: 'tier4' });
  assert.equal(a.last('deny').text, 'Only for guns');
});

test('tier IV and V: ×1.85 and ×2.2 damage on top of rarity; names, colors and value keep up', () => {
  assert.deepEqual(TIERS.slice(1).map(t => [t.name, t.mult]), [['I', 1], ['II', 1.25], ['III', 1.55], ['IV', 1.85], ['V', 2.2]]);
  assert.equal(gunMult({ r: 4, tier: 5 }), 1.35 * 2.2);
  const { room, p } = setup('MT');
  const hitWith = tier => {
    const gun = p.inv[1] = makeGun('ar', 0, tier), z = zed(room, 0, -10);
    shoot(room, p, gun, [{ id: z.id, part: 'chest', pen: 1, k: 0 }]);
    return 5000 - z.hp;
  };
  const [t3, t4, t5] = [3, 4, 5].map(hitWith);
  assert.ok(Math.abs(t4 - (t3 * 1.85) / 1.55) <= 1.5, `tier IV ${t4} vs tier III ${t3}`);
  assert.ok(Math.abs(t5 - (t3 * 2.2) / 1.55) <= 1.5, `tier V ${t5} vs tier III ${t3}`);
  const g5 = makeGun('ar', 2, 5);
  assert.match(itemName(g5), / V$/);
  assert.ok(Number.isFinite(itemValue(g5)) && itemValue(g5) > itemValue(makeGun('ar', 2, 3)));
});

test('Multishot: an extra round at 50% damage; without the mod that claim is thrown out', () => {
  const { room, p } = setup('MM');
  const gun = p.inv[1] = makeGun('ar'), z = zed(room, 0, -10);
  shoot(room, p, gun, [{ id: z.id, part: 'chest', pen: 1, k: 0 }]);
  const full = 5000 - z.hp;
  shoot(room, p, gun, [{ id: z.id, part: 'chest', pen: 1, k: 1 }]);
  assert.equal(5000 - z.hp, full, 'no Multishot: a second round index is refused');
  gun.mods = ['multi'];
  let hp = z.hp;
  shoot(room, p, gun, [{ id: z.id, part: 'chest', pen: 1, k: 1 }]);
  assert.ok(Math.abs(hp - z.hp - full * GUN_MODS.multi.frac) <= 1, `extra round ${hp - z.hp} vs ${full}`);
  hp = z.hp;
  shoot(room, p, gun, [0, 1, 2].map(k => ({ id: z.id, part: 'chest', pen: 1, k })), [FWD, FWD, FWD]);
  assert.ok(Math.abs(hp - z.hp - full * 1.5) <= 2, 'the shot and its extra round land; a third index does not');
  const sb = p.inv[2] = makeGun('skybreaker'), za = zed(room, 0, -10), zb = zed(room, 0.3, -10); // pierces on its own
  sb.mods = ['multi'];
  T += 2000;
  shoot(room, p, sb, [{ id: za.id, part: 'chest', pen: 1, k: 0 }]);
  T += 2000;
  shoot(room, p, sb, [{ id: zb.id, part: 'chest', pen: 1, k: 1 }]);
  assert.ok(Math.abs(5000 - zb.hp - (5000 - za.hp) / 2) <= 1, 'the Skybreaker\'s extra round is half damage too');
});

test('Piercing: a round goes on through one more zombie at 70%, never a third, never the same one twice', () => {
  const { room, p } = setup('MP');
  const gun = p.inv[1] = makeGun('ar');
  const [z1, z2, z3] = [-10, -16, -22].map(zz => zed(room, 0, zz));
  const claims = zs => zs.map(z => ({ id: z.id, part: 'chest', pen: 1, k: 0 }));
  shoot(room, p, gun, claims([z1, z2]));
  assert.ok(z1.hp < 5000);
  assert.equal(z2.hp, 5000, 'no Piercing: one zombie per round');
  shoot(room, p, gun, claims([z2]));
  const full = 5000 - z2.hp;
  gun.mods = ['pierce'];
  const hp1 = z1.hp, hp2 = z2.hp;
  shoot(room, p, gun, claims([z1, z2, z3]));
  assert.ok(z1.hp < hp1, 'the first zombie takes the round');
  assert.ok(Math.abs(hp2 - z2.hp - full * GUN_MODS.pierce.frac) <= 1.5, `pierced ${hp2 - z2.hp} vs ${full}`);
  assert.equal(z3.hp, 5000, 'only one more zombie');
  const before = z1.hp;
  shoot(room, p, gun, claims([z1, z1]));
  assert.ok(Math.abs(before - z1.hp - (5000 - hp1)) <= 1, 'the same zombie claimed twice by one round counts once');
});

test('Explosive tips: 30% splash on zombies within 1.5 m of each hit — never on builds or props', () => {
  const { room, a, p } = setup('ME');
  const gun = p.inv[1] = makeGun('ar');
  gun.mods = ['explo'];
  const z1 = zed(room, 0, -10), near = zed(room, 1.2, -10), far = zed(room, 2.2, -10);
  room.addPiece({ kind: 'floor', i: Math.floor(-GRID.x0 / GRID.cell), k: Math.floor((-10 - GRID.z0) / GRID.cell), l: 0, mat: 'zink' }, p); // right under the burst
  assert.ok([...room.pieces.values()].some(s => s.kind === 'floor' && distToBox([0, 1.1, -10], s.box) < 1.5), 'a build inside the burst');
  const hpOf = () => [...room.pieces.values()].map(s => s.hp);
  const pieces = hpOf();
  shoot(room, p, gun, [{ id: z1.id, part: 'chest', pen: 1, k: 0 }]);
  assert.ok(z1.hp < 5000, 'the zombie hit takes the round');
  assert.equal(5000 - near.hp, WEAPONS.ar.dmg * GUN_MODS.explo.frac, 'a zombie 1.2 m away takes 30% of the round');
  assert.equal(far.hp, 5000, '2.2 m is out of the burst');
  assert.deepEqual(hpOf(), pieces, 'builds and props are untouched');
  assert.ok(a.last('etip'), 'everyone sees the burst');
  const dying = zed(room, 0, -10, 1), next = zed(room, 0.8, -10);
  z1.pos = [30, 0, 30];
  shoot(room, p, gun, [{ id: dying.id, part: 'chest', pen: 1, k: 0 }]);
  assert.ok(dying.dead && next.hp < 5000, 'a killing round still bursts');
});

test('Toxic: poison over 4 s; a zombie that dies poisoned leaves a 3 m cloud for 3 s that poisons zombies only; never sold or infused', () => {
  const { room, a, p } = setup('MX');
  const z = zed(room, 40, 40);
  z.frozenUntil = T + 1e7; // stays put far from the Core cannon
  room.applyElement(z, 'toxic', 100, p);
  const dps = (100 * EL.poisonFrac) / EL.poisonTime;
  assert.deepEqual([z.poisonUntil, z.poisonDps], [T + 4000, dps]);
  advance(room, 1000);
  assert.ok(Math.abs(5000 - z.hp - dps) < 2, `about ${dps} poison damage in 1 s, took ${5000 - z.hp}`);
  advance(room, 3500);
  const after = z.hp;
  advance(room, 1000);
  assert.equal(z.hp, after, 'worn off after 4 s');
  // dies poisoned: a cloud that poisons what's around it
  const victim = zed(room, 40, 40, 1), inCloud = zed(room, 42, 40), outside = zed(room, 45, 40);
  for (const q of [victim, inCloud, outside]) q.frozenUntil = T + 1e7;
  room.applyElement(victim, 'toxic', 100, p);
  p.st.p = [41, 0, 40];
  const hp = p.hp;
  room.damageZombie(victim, 5, p, 'ar');
  const cloud = room.hazards.find(h => h.kind === 'toxic');
  assert.ok(cloud && cloud.r === EL.cloudR && cloud.until === T + EL.cloudTime * 1000, 'a 3 m cloud for 3 s');
  assert.ok(a.last('hz')?.k === 'toxic', 'clients are told about the cloud');
  updateHazards(room, T);
  assert.ok(inCloud.poisonUntil > T && inCloud.poisonDps === dps, 'a zombie in the cloud is poisoned');
  assert.ok(!(outside.poisonUntil > T), '5 m away is outside it');
  assert.equal(p.hp, hp, 'the cloud never hurts players');
  // the Toxic element is a Blacksmith milestone: never an infusion or a Core purchase
  const gun = p.inv[1] = makeGun('ar');
  atSmith(room, p);
  p.money = 20000; p.mats.zink = 500;
  room.handle(p, { t: 'smith', op: 'infuse', uid: gun.uid, el: 'toxic' });
  assert.deepEqual([gun.els, p.money], [undefined, 20000], 'no toxic infusion');
  p.st.p = [2, 0, 5];
  room.handle(p, { t: 'buy', item: 'ar', el: 'toxic' });
  assert.ok(p.inv.filter(it => it?.id === 'ar').every(it => !it.el), 'the shop sells no toxic guns');
  assert.equal(p.money, 20000 - WEAPONS.ar.price, 'a plain AR at the plain price');
  // milestone toxic rounds poison on hit
  gun.els = ['toxic']; gun.el = 'toxic';
  const t = zed(room, 0, -10);
  room.hitZombie(p, t, WEAPONS.ar, [{ part: 'chest', pen: 1 }], false, 1, gun.els);
  assert.ok(t.poisonUntil > T);
});

test('turret upgrades: +40% damage, +25% range, +30% fire rate, +100% ammo capacity, +50% HP per level — and everyone sees them', () => {
  const { room, a, p } = setup('MU');
  const b = join(room, 'B');
  atSmith(room, p);
  p.money = 100000;
  const d = { id: 50, type: 'turret', pos: [-6, 0, 6], pid: 0, side: 2, owner: p.id, uses: 0, ammo: 10, hp: 350, next: 0, until: 0 };
  room.defenses.list.set(d.id, d);
  const up = what => room.handle(p, { t: 'smith', op: 'turret', def: 50, up: what });
  for (const k of ['dmg', 'range', 'rate', 'cap', 'plate']) up(k);
  assert.deepEqual(['dmg', 'range', 'rate', 'cap', 'plate'].map(k => turretMul(d.mods, k)), [1.4, 1.25, 1.3, 2, 1.5]);
  assert.equal(room.defenses.maxAmmo(d), DEFENSES.turret.ammo * 2);
  assert.equal(d.ammo, 10 + DEFENSES.turret.ammo, 'the new capacity comes loaded');
  assert.deepEqual([d.hp, d.maxHp], [350 + 175, 525]);
  up('ammo');
  assert.equal(d.ammo, DEFENSES.turret.ammo * 2, 'a refill fills the bigger magazine');
  up('inc');
  up('frost');
  assert.deepEqual([d.mods.inc, d.mods.frost], [undefined, 1], 'one kind of rounds at a time');
  const money = p.money;
  up('frost');
  assert.equal(p.money, money, 'rounds are a one-off');
  assert.deepEqual(b.last('dmod').mods, d.mods, 'the other players get the upgrade state');
  assert.deepEqual(room.defenses.tuple(d)[9], d.mods, 'late joiners see it too');
  // in action: range 24 m ×1.25 reaches a zombie 27 m out, each shot hits for 13 ×1.4, fire rate 7/s ×1.3
  d.pos = [-38, 0, 24];
  const z = zed(room, -11, 24);
  assert.ok(room.lineOfSight([-38, 1.2, 24], [-11, 1.1, 24]), 'clear line of fire');
  d.next = 0;
  room.defenses.update(0.05, T);
  assert.ok(Math.abs(5000 - z.hp - 13 * 1.4) < 1e-6, `one upgraded shot: ${5000 - z.hp}`);
  assert.ok(Math.abs(d.next - T - 1000 / (7 * 1.3)) < 1e-6, 'fires 30% faster');
  const plain = { id: 51, type: 'turret', pos: [-38, 0, 24], pid: 0, side: 2, owner: p.id, uses: 0, ammo: 700, hp: 350, next: 0, until: 0 };
  room.defenses.list.delete(50);
  room.defenses.list.set(51, plain);
  const hp = z.hp;
  room.defenses.update(0.05, T);
  assert.equal(z.hp, hp, 'an un-upgraded turret can\'t reach 27 m');
  const tesla = { id: 52, type: 'tesla', pos: [20, 0, 20], pid: 0, side: 2, owner: p.id, uses: 0, ammo: 160, hp: 320, next: 0, until: 0 };
  room.defenses.list.set(52, tesla);
  room.handle(p, { t: 'smith', op: 'turret', def: 52, up: 'inc' });
  assert.equal(tesla.mods?.inc, undefined, 'built-in elements take no rounds');
  assert.ok(a.all('deny').length > 0);
});

test('the "Upgrade turret" key: within 3 m of a turret its upgrades work without the Blacksmith; farther away they don\'t', () => {
  const { room, a, p } = setup('MK');
  room.bosses.smith = false;
  const d = { id: 60, type: 'gturret', pos: [10, 0, 10], pid: 0, side: 2, owner: p.id, uses: 0, ammo: 1000, hp: 280, next: 0, until: 0 };
  room.defenses.list.set(d.id, d);
  p.money = 5000;
  p.st.p = [12, 0, 10];
  room.handle(p, { t: 'smith', op: 'turret', def: 60, up: 'dmg' });
  assert.deepEqual([d.mods?.dmg, p.money], [1, 5000 - SMITH.turret.dmg.price], 'standing by it: upgraded, no Blacksmith needed');
  assert.equal(a.last('inv').money, p.money, 'the new balance is sent');
  p.st.p = [15, 0, 10];
  room.handle(p, { t: 'smith', op: 'turret', def: 60, up: 'dmg' });
  assert.deepEqual([d.mods.dmg, p.money], [1, 5000 - SMITH.turret.dmg.price], '5 m away: refused, nothing charged');
  assert.match(a.last('deny').text, /within 3 m/);
  p.st.p = [12, 0, 10];
  p.downed = true;
  room.handle(p, { t: 'smith', op: 'turret', def: 60, up: 'dmg' });
  assert.equal(d.mods.dmg, 1, 'not while downed');
});
