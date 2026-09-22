import test from 'node:test';
import assert from 'node:assert/strict';
import { addItem, countOf, makeGun } from '../server/holdout/inventory.js';
import { HoldoutRoom, HOLDOUT } from '../server/holdout/room.js';
import { ITEMS, ITEM_IDS, SHOP, ATTACH, CLASSES, SHIELD_CAP, ADREN_DROP, ADREN_CARRY, shopEntry, rollLoot } from '../shared/holdout.js';
import { CONSUMABLE_KINDS } from '../shared/items.js';
import { OUTPOST, OUTPOST_SHELTERS } from '../shared/outpost.js';

let T = 12_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 50) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
function join(room, name = 'P') {
  const messages = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const player = room.addPlayer(ws, name);
  return { player, messages, last: t => messages.filter(m => m.t === t).at(-1) };
}
// 'prep' that never runs out, so update() ticks the heals without ever starting a wave
const quiet = room => { room.phase = 'prep'; room.phaseEnd = Infinity; return room; };
const hit = (room, p, dmg) => { room.phase = 'wave'; room.hurtPlayer(p, dmg, null); room.phase = 'prep'; };
const mulberry32 = seed => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const adrenPickups = room => [...room.inventory.pickups.values()].filter(pk => pk.item?.id === 'adrenaline');

test('heal items are gone: not in ITEMS, the shop or any loot roll; adrenaline takes their loot share in stacks of 2-4', () => {
  for (const id of ['bandage', 'medkit', 'shield_s', 'shield']) assert.equal(ITEMS[id], undefined, `${id} is gone`);
  assert.ok(ITEM_IDS.every(id => ITEMS[id].kind !== 'heal' && ITEMS[id].kind !== 'shield'));
  assert.deepEqual(CONSUMABLE_KINDS, ['adrenaline'], 'the sack only takes Adrenaline Shots');
  assert.ok(!SHOP.some(([name]) => name === 'Healing'), 'no Healing shop section');
  const sold = SHOP.flatMap(([, ids]) => ids);
  assert.ok(sold.includes('adrenaline') && sold.every(id => shopEntry(id)), 'everything left in the shop is real');

  const rng = mulberry32(7), n = { throw: 0, adren: 0 }, boss = [];
  for (const kind of ['chest', 'drop', 'boss']) for (let i = 0; i < 400; i++) {
    const items = rollLoot(kind, rng).filter(it => it.kind === 'item');
    for (const it of items) assert.ok(ITEMS[it.id] || ATTACH[it.id], `${kind} rolled a real item (${it.id})`);
    const shots = items.filter(it => it.id === 'adrenaline');
    if (kind === 'boss') { boss.push(shots); continue; }
    for (const it of shots) assert.ok(it.n >= 2 && it.n <= 4, `chests and drops give stacks of 2-4 (${it.n})`);
    n.adren += shots.length;
    n.throw += items.filter(it => ITEMS[it.id]?.kind === 'throw').length;
  }
  const share = n.adren / (n.adren + n.throw);
  assert.ok(share > 0.5 && share < 0.65, `adrenaline took the heals' 4-in-7 share: ${share.toFixed(3)}`);
  assert.ok(boss.every(shots => shots.some(it => it.n >= 1 && it.n <= 3)), 'every boss pile has 1-3 shots');
});

test('Adrenaline Shot: stacks to 10, instant +25 HP and +25 shield (each capped, no overflow), +4 HP/s for 5 s, 1.5 s cooldown', () => {
  const A = ITEMS.adrenaline;
  assert.deepEqual([A.max, A.price, A.hp, A.sh, A.regen, A.time, A.cooldown], [10, 300, 25, 25, 4, 5, 1500]);
  const room = quiet(new HoldoutRoom('AD1', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [40, 0, 40]; // outside the Core ring: no passive regen muddying the numbers
  addItem(p, 'adrenaline', 9); addItem(p, 'adrenaline', 3);
  assert.deepEqual(p.sack.filter(Boolean).map(it => it.n), [10, 2], 'a stack holds 10');

  p.hp = 100; p.shield = 0;
  room.handle(p, { t: 'use', item: 'adrenaline' });
  assert.deepEqual([p.hp, p.shield, countOf(p, 'adrenaline')], [125, 25, 11], 'instant +25 / +25, one used');
  assert.equal(room.dmgMultFor(p), 1, 'no damage boost any more');

  advance(room, 1000);
  room.handle(p, { t: 'use', item: 'adrenaline' });
  assert.equal(countOf(p, 'adrenaline'), 11, 'still on cooldown after 1 s');
  advance(room, 4000);
  assert.ok(Math.abs(p.hp - 145) <= 1, `+4 HP/s for 5 s: ${p.hp}`);
  const after = p.hp;
  advance(room, 2000);
  assert.equal(p.hp, after, 'the regen stops after 5 s');
  assert.equal(p.shield, 25, 'the regen never touches shield');

  p.hp = p.maxHp - 10; p.shield = SHIELD_CAP - 5;
  room.handle(p, { t: 'use', item: 'adrenaline' });
  assert.deepEqual([p.hp, p.shield], [p.maxHp, SHIELD_CAP], 'both capped, HP overflow does not spill into shield');
  advance(room, 2000);
  assert.deepEqual([p.hp, p.shield], [p.maxHp, SHIELD_CAP], 'the regen never pushes past max HP');

  const left = countOf(p, 'adrenaline');
  room.handle(p, { t: 'use', item: 'adrenaline' });
  assert.equal(countOf(p, 'adrenaline'), left, 'not wasted when already topped up');
  assert.match(a.last('deny').text, /topped up/);
});

test('survivors can no longer be patched up with items', () => {
  const room = quiet(new HoldoutRoom('AD2', {}));
  const p = join(room, 'A').player;
  const sv = room.survivors.spawnWounded(OUTPOST_SHELTERS[0], 1, 'ranger');
  sv.state = 'active'; sv.hp = 100;
  addItem(p, 'adrenaline', 1);
  p.st.p = [sv.pos[0] + 1, 0, sv.pos[2]];
  room.handle(p, { t: 'use', item: 'adrenaline', sv: sv.id });
  assert.equal(sv.hp, 100);
});

test('Medic: Adrenaline Shots 25% stronger, 3 free every 2 waves (dropped at your feet when full), shield regen at the Core', () => {
  const room = quiet(new HoldoutRoom('AD3', {}));
  const m = join(room, 'M').player, q = join(room, 'Q').player;
  m.cls = 'medic';
  m.st.p = [40, 0, 40]; q.st.p = [40, 0, -40]; // out of the Core ring and out of each other's reach
  for (const p of [m, q]) { p.maxHp = 200; p.hp = 100; p.shield = 0; addItem(p, 'adrenaline', 1); hit(room, p, 0.1); }
  const hp0 = m.hp; // (the hit keeps the Medic's own self-heal quiet for 3 s)
  for (const p of [m, q]) room.handle(p, { t: 'use', item: 'adrenaline' });
  advance(room, 2500);
  assert.equal(m.shield, ITEMS.adrenaline.sh * CLASSES.medic.healMul);
  assert.ok(Math.abs((m.hp - hp0) - (q.hp - hp0) * CLASSES.medic.healMul) < 1e-6, `instant + regen both 25% stronger: ${m.hp - hp0} vs ${q.hp - hp0}`);

  const n0 = countOf(m, 'adrenaline');
  room.wave = 1; room.waveCleared(); quiet(room);
  assert.equal(countOf(m, 'adrenaline'), n0, 'nothing after an odd wave');
  room.wave = 2; room.waveCleared(); quiet(room);
  assert.equal(countOf(m, 'adrenaline'), n0 + 3, '3 shots every 2 waves');
  assert.equal(countOf(q, 'adrenaline'), 0, 'only for Medics');

  m.sack = m.sack.map(() => ({ uid: -1, id: 'adrenaline', kind: 'adrenaline', n: 10 }));
  for (let i = 0; i < m.inv.length; i++) m.inv[i] ??= makeGun('pistol');
  room.wave = 4; room.waveCleared(); quiet(room);
  assert.ok(adrenPickups(room).some(pk => pk.item.n === 3), 'no room: dropped at your feet');

  m.st.p = [0, 0, 0]; m.shield = 0;
  advance(room, 2000);
  assert.ok(m.shield > 0, 'a Medic regenerates shield inside the Core ring');
});

test('adrenaline drops: about 12% of kills, big zombies always 1-3, reinforcements nothing', () => {
  const room = quiet(new HoldoutRoom('AD4', {}));
  room.rng = mulberry32(42);
  const N = 1500;
  for (let i = 0; i < N; i++) room.killZombie(room.spawnZombie('shambler', 'N', ''), null, 'ar');
  const drops = adrenPickups(room);
  assert.ok(drops.every(pk => pk.item.n === 1), 'a normal kill drops a single shot');
  assert.ok(Math.abs(drops.length / N - ADREN_DROP.chance) < 0.02, `about 12%: ${(drops.length / N).toFixed(3)}`);

  for (const type of ADREN_DROP.big) for (let i = 0; i < 10; i++) {
    room.inventory.pickups.clear();
    room.killZombie(room.spawnZombie(type, 'N', ''), null, 'ar');
    const [pk, extra] = adrenPickups(room);
    assert.ok(pk && !extra && pk.item.n >= 1 && pk.item.n <= 3, `${type} drops 1-3 shots`);
  }
  room.inventory.pickups.clear();
  const z = room.spawnZombie('brute', 'N', '');
  z.noReward = true;
  room.killZombie(z, null, 'ar');
  assert.equal(adrenPickups(room).length, 0, 'berserk reinforcements drop nothing');
});

test('passive healing: +2 HP/s inside the Core ring after 4 s unhurt, never outside it, never past max HP', () => {
  assert.deepEqual([HOLDOUT.coreRegen, HOLDOUT.coreRegenAfter], [2, 4000]);
  const room = quiet(new HoldoutRoom('AD5', {}));
  const p = join(room, 'A').player, q = join(room, 'B').player;
  p.st.p = [0, 0, 0]; q.st.p = [40, 0, 40];
  p.hp = q.hp = 100;
  hit(room, p, 20);
  const hurt = p.hp;
  advance(room, 3500);
  assert.equal(p.hp, hurt, 'nothing within 4 s of a hit');
  advance(room, 2500); // 6 s after the hit: 2 s of regen
  assert.ok(Math.abs(p.hp - (hurt + 4)) < 1e-6, `+2 HP/s: ${p.hp - hurt}`);
  assert.equal(q.hp, 100, 'nothing outside the ring, even unhurt');
  assert.equal(p.shield, 0, 'health only');
  p.hp = p.maxHp - 0.2;
  advance(room, 1000);
  assert.equal(p.hp, p.maxHp);
});

test('Adrenaline Shot carry cap (10 total, shared across hotbar/backpack/sack): a pickup over the cap only takes what fits', () => {
  assert.equal(ADREN_CARRY, ITEMS.adrenaline.max, 'the carry cap matches the stack size');
  const room = quiet(new HoldoutRoom('AC1', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [5, 0, 5];
  addItem(p, 'adrenaline', 8);
  const pk = room.inventory.spawn({ kind: 'item', id: 'adrenaline', n: 5 }, [5, 0, 5]);

  room.handle(p, { t: 'pickup', id: pk.id, slot: 0 });
  assert.equal(countOf(p, 'adrenaline'), ADREN_CARRY, 'capped at 10, not 13');
  assert.match(a.last('deny').text, /carry 10 Adrenaline/);
  const left = room.inventory.pickups.get(pk.id);
  assert.ok(left, 'the leftover stays on the ground');
  assert.equal(left.item.n, 3, '8 + 5 - 10 = 3 left behind');

  // already at the cap: nothing at all is taken
  const pk2 = room.inventory.spawn({ kind: 'item', id: 'adrenaline', n: 1 }, [5, 0, 5]);
  room.handle(p, { t: 'pickup', id: pk2.id, slot: 0 });
  assert.equal(countOf(p, 'adrenaline'), ADREN_CARRY);
  assert.ok(room.inventory.pickups.has(pk2.id), 'untouched on the ground');
});

test('Adrenaline Shot carry cap: the shop refuses a buy that would exceed it', () => {
  const room = quiet(new HoldoutRoom('AC2', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [0, 0, 0]; // inside the Core ring
  p.money = 100000;
  addItem(p, 'adrenaline', ADREN_CARRY);

  room.handle(p, { t: 'buy', item: 'adrenaline' });
  assert.equal(countOf(p, 'adrenaline'), ADREN_CARRY, 'no 11th shot bought');
  assert.match(a.last('deny').text, /carry 10 Adrenaline/);
});

test('Adrenaline Shot carry cap: pulling shots out of the team chest is capped the same way', () => {
  const room = quiet(new HoldoutRoom('AC3', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [OUTPOST.stash.x, 0, OUTPOST.stash.z];
  addItem(p, 'adrenaline', 8);
  room.inventory.stash.items[0] = { uid: -1, id: 'adrenaline', kind: 'adrenaline', n: 10 };

  room.handle(p, { t: 'move', from: 's0', to: 'i6' });
  assert.equal(countOf(p, 'adrenaline'), ADREN_CARRY, 'only 2 of the 10 moved over');
  assert.equal(room.inventory.stash.items[0].n, 8, '10 - 2 = 8 left in the chest');
  assert.match(a.last('deny').text, /carry 10 Adrenaline/);
});

test('Adrenaline Shot carry cap: the Medic\'s free shots are capped too, the overflow drops at your feet', () => {
  const room = quiet(new HoldoutRoom('AC4', {}));
  const p = join(room, 'A').player;
  p.cls = 'medic';
  addItem(p, 'adrenaline', 9);

  room.wave = 2; room.waveCleared(); quiet(room);
  assert.equal(countOf(p, 'adrenaline'), ADREN_CARRY, 'only 1 of the 3 free shots fit');
  assert.ok(adrenPickups(room).some(pk => pk.item.n === 2), 'the other 2 dropped at your feet');
});
