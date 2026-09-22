import test from 'node:test';
import assert from 'node:assert/strict';
import { addItem, countOf } from '../server/holdout/inventory.js';
import { HoldoutRoom, HOLDOUT } from '../server/holdout/room.js';
import { ITEMS, ITEM_IDS, SHOP, ATTACH, CLASSES, SHIELD_CAP, ADREN_DROP, ADREN_CARRY, ADREN_CARRY_BY_CLASS, adrenCarry, shopEntry, rollLoot } from '../shared/holdout.js';
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
// n Adrenaline Shots the way play hands them out: in stacks of at most 10
const carryShots = (p, n) => { for (; n > 0; n -= ITEMS.adrenaline.max) addItem(p, 'adrenaline', Math.min(n, ITEMS.adrenaline.max)); };

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

test('the Medic kit is gone: Adrenaline Shots heal the same for every kit, no free shots after waves, no shield regen at the Core', () => {
  assert.equal(CLASSES.medic, undefined);
  const room = quiet(new HoldoutRoom('AD3', {}));
  const m = join(room, 'M').player, q = join(room, 'Q').player;
  m.cls = 'assault';
  m.st.p = [40, 0, 40]; q.st.p = [40, 0, -40]; // out of the Core ring and out of each other's reach
  for (const p of [m, q]) { p.maxHp = 200; p.hp = 100; p.shield = 0; addItem(p, 'adrenaline', 1); hit(room, p, 0.1); }
  for (const p of [m, q]) room.handle(p, { t: 'use', item: 'adrenaline' });
  advance(room, 2500);
  assert.deepEqual([m.hp, m.shield], [q.hp, q.shield], 'same instant heal and regen whatever the kit');

  for (const w of [1, 2, 4]) { room.wave = w; room.waveCleared(); quiet(room); }
  assert.deepEqual([countOf(m, 'adrenaline'), countOf(q, 'adrenaline'), adrenPickups(room).length], [0, 0, 0], 'no free shots after waves');
  m.st.p = [0, 0, 0]; m.shield = 0;
  advance(room, 2000);
  assert.equal(m.shield, 0, 'nobody regenerates shield inside the Core ring');
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

test('Adrenaline Shot carry cap (20 total, two stacks of 10, shared across hotbar/backpack/sack): a pickup over the cap only takes what fits', () => {
  assert.deepEqual([ADREN_CARRY, ITEMS.adrenaline.max], [20, 10], 'carry 20, stacks of 10');
  const room = quiet(new HoldoutRoom('AC1', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [5, 0, 5];
  carryShots(p, 18);
  const pk = room.inventory.spawn({ kind: 'item', id: 'adrenaline', n: 5 }, [5, 0, 5]);

  room.handle(p, { t: 'pickup', id: pk.id, slot: 0 });
  assert.equal(countOf(p, 'adrenaline'), ADREN_CARRY, 'capped at 20, not 23');
  assert.deepEqual(p.sack.filter(Boolean).map(it => it.n), [10, 10], 'two full stacks in the sack');
  assert.match(a.last('deny').text, /carry 20 Adrenaline/);
  const left = room.inventory.pickups.get(pk.id);
  assert.ok(left, 'the leftover stays on the ground');
  assert.equal(left.item.n, 3, '18 + 5 - 20 = 3 left behind');

  // already at the cap: nothing at all is taken
  const pk2 = room.inventory.spawn({ kind: 'item', id: 'adrenaline', n: 1 }, [5, 0, 5]);
  room.handle(p, { t: 'pickup', id: pk2.id, slot: 0 });
  assert.equal(countOf(p, 'adrenaline'), ADREN_CARRY);
  assert.ok(room.inventory.pickups.has(pk2.id), 'untouched on the ground');
});

test('Adrenaline Shot carry cap: the shop refuses a buy that would exceed it; the cap is per class', () => {
  const room = quiet(new HoldoutRoom('AC2', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [0, 0, 0]; // inside the Core ring
  p.money = 100000;
  carryShots(p, ADREN_CARRY);

  room.handle(p, { t: 'buy', item: 'adrenaline' });
  assert.equal(countOf(p, 'adrenaline'), ADREN_CARRY, 'no 21st shot bought');
  assert.match(a.last('deny').text, /carry 20 Adrenaline/);

  ADREN_CARRY_BY_CLASS.assault = 30; // a kit may carry more (e.g. a later Ronin)
  try {
    p.cls = 'assault';
    assert.equal(adrenCarry('assault'), 30);
    room.handle(p, { t: 'buy', item: 'adrenaline' });
    assert.equal(countOf(p, 'adrenaline'), ADREN_CARRY + 1, 'that class carries past 20');
  } finally { delete ADREN_CARRY_BY_CLASS.assault; }
  assert.equal(adrenCarry('assault'), ADREN_CARRY);
});

test('Adrenaline Shot carry cap: pulling shots out of the team chest is capped the same way, never overfilling a stack', () => {
  const room = quiet(new HoldoutRoom('AC3', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [OUTPOST.stash.x, 0, OUTPOST.stash.z];
  carryShots(p, 18);
  room.inventory.stash.items[0] = { uid: -1, id: 'adrenaline', kind: 'adrenaline', n: 10 };

  room.handle(p, { t: 'move', from: 's0', to: 'i6' });
  assert.equal(countOf(p, 'adrenaline'), ADREN_CARRY, 'only 2 of the 10 moved over');
  assert.equal(room.inventory.stash.items[0].n, 8, '10 - 2 = 8 left in the chest');
  assert.match(a.last('deny').text, /carry 20 Adrenaline/);

  // 12 carried (7 + 5): room for 8 more, but the stack it lands on only holds 3
  p.sack = [{ uid: -2, id: 'adrenaline', kind: 'adrenaline', n: 7 }, { uid: -3, id: 'adrenaline', kind: 'adrenaline', n: 5 }, null, null];
  p.inv[6] = null;
  room.inventory.stash.items[0].n = 10;
  room.handle(p, { t: 'move', from: 's0', to: 'k0' });
  assert.equal(p.sack[0].n, 10, 'topped up to a full stack, not 15');
  assert.equal(room.inventory.stash.items[0].n, 7);
});

test('Adrenaline Shot carry cap: the Ronin carries 30, everyone else 20', () => {
  assert.deepEqual(ADREN_CARRY_BY_CLASS, { ronin: 30 });
  assert.deepEqual(['ronin', 'tank', 'assault', null].map(adrenCarry), [30, 20, 20, 20]);
  const room = quiet(new HoldoutRoom('AC4', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [0, 0, 0]; p.money = 100000;
  room.handle(p, { t: 'class', id: 'ronin' });
  carryShots(p, 29);
  room.handle(p, { t: 'buy', item: 'adrenaline' });
  room.handle(p, { t: 'buy', item: 'adrenaline' });
  assert.equal(countOf(p, 'adrenaline'), 30, 'up to 30, not 31');
  assert.match(a.last('deny').text, /carry 30 Adrenaline/);
});
