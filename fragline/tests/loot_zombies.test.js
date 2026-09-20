// Batch 16: the Hoarder (ignores everyone, sprints for the Core, pays the squad if killed first, escapes
// with nothing if it reaches the Core), the loot family (Scavenger/Warden/Relic Bearer drop tables), the
// Iron Golem's HP nerf, and the longer rebuild break after a Maw wave. Helpers copied from zombies2.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldoutRoom } from '../server/holdout/room.js';
import { updateZombies, ZS } from '../server/holdout/ai.js';
import { ZTYPES, hoarderCash, bossFor } from '../shared/zombies.js';
import { intermissionFor, MAW_BREAK } from '../shared/holdout.js';
import { MAT_IDS } from '../shared/build.js';

let T = 9_500_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 50) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
const started = room => { room.phase = 'prep'; return room; };
const constRng = v => () => v; // a fixed roll, for deterministic drop-table tests
function join(room, name = 'P') {
  const messages = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const player = room.addPlayer(ws, name);
  return { player, messages, last: t => messages.filter(m => m.t === t).at(-1), all: t => messages.filter(m => m.t === t) };
}

test('Hoarder: ignores players and survivors entirely, and escapes with nothing paid if it reaches the Core', () => {
  const room = started(new HoldoutRoom('HD1', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(5); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const hoarder = room.spawnZombie('hoarder', 'N', '');
  hoarder.pos = [0, 0, -5];
  p.st.p = [0, 0, -5.5]; // right next to it, in plain sight — would normally aggro immediately
  advance(room, 300);
  assert.equal(hoarder.aggro, null, 'never aggros onto a nearby, visible player');

  // walk it up to the Core and force the strike that fires once it's in range
  hoarder.pos = [room.map.core.x, 0, room.map.core.z];
  const before = p.money;
  hoarder.state = ZS.WIND; hoarder.stateEnd = T - 1; hoarder.target = { kind: 'c' };
  updateZombies(room, 0.05, T);
  assert.ok(hoarder.escaping, 'starts sinking into its escape hole once it reaches the Core');
  advance(room, 1200); // past the ~900ms sink
  assert.equal(room.zombies.has(hoarder.id), false, 'gone for good');
  assert.equal(p.money, before, 'nobody gets paid — it got away');
  assert.ok(a.all('msg').some(m => /cash/i.test(m.text)), 'a taunting message');
  assert.equal(a.all('hoardcash').length, 0, 'no payout broadcast on an escape');
});

test('Hoarder: killed before the Core pays every player a flat, wave-scaled bonus (not split)', () => {
  const room = started(new HoldoutRoom('HD2', {}));
  const a = join(room, 'A'), b = join(room, 'B');
  room.startWave(6); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const hoarder = room.spawnZombie('hoarder', 'N', '');
  const [beforeA, beforeB] = [a.player.money, b.player.money];
  room.killZombie(hoarder, a.player, 'pistol');
  const expected = hoarderCash(room.wave);
  assert.equal(expected, 1200 + 120 * 6);
  assert.equal(a.player.money - beforeA, expected, 'the killer gets the full bonus, not a share of it');
  assert.equal(b.player.money - beforeB, expected, 'and so does every other player');
  assert.equal(a.last('hoardcash').amt, expected);
  assert.ok(a.all('zdie').some(m => m.by === a.player.id), 'still a normal kill-feed line');
});

test('Hoarder: guaranteed exactly once on every 4th wave from wave 4, never before wave 3', () => {
  const room = new HoldoutRoom('HD3', {});
  for (const w of [4, 8, 12, 16, 20]) {
    room.director.start(w);
    assert.equal(room.director.queue.filter(id => id === 'hoarder').length, 1, `wave ${w} should guarantee exactly one`);
  }
  for (const w of [1, 2]) {
    room.director.start(w);
    assert.equal(room.director.queue.filter(id => id === 'hoarder').length, 0, `wave ${w} is too early`);
  }
});

test('Iron Golem: HP nerfed from 1100 to 650, still a wall breaker, still scales with squad and wave', () => {
  assert.equal(ZTYPES.golem.hp, 650);
  assert.equal(ZTYPES.golem.breaker, true);
  const room = started(new HoldoutRoom('GHP', {}));
  room.startWave(7); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const g = room.spawnZombie('golem', 'N', '');
  assert.equal(g.maxHp, Math.round(650 * room.director.hpMul));
});

test('Scavenger: drops ammo, materials or (mostly) a cheap trap', () => {
  const room = started(new HoldoutRoom('LT1', {}));
  const z = { type: 'scavenger', pos: [1, 0, 2], t: ZTYPES.scavenger };

  room.rng = constRng(0.01); // low roll: a cheap trap
  room.typeDrop(z);
  assert.equal([...room.inventory.pickups.values()].at(-1).item.id, 'spikes');

  room.rng = constRng(0.5); // mid roll: materials (the single Zinkonium material)
  room.typeDrop(z);
  const mats = [...room.inventory.pickups.values()].at(-1);
  assert.deepEqual([mats.kind, mats.mat], ['mats', MAT_IDS[0]]);

  room.rng = constRng(0.89); // high roll: ammo
  room.typeDrop(z);
  const ammo = [...room.inventory.pickups.values()].at(-1);
  assert.deepEqual([ammo.kind, ammo.type], ['ammo', 'rockets']);
});

test('Warden: an armor piece and its own independent chance at a deployable — nothing forced', () => {
  const room = started(new HoldoutRoom('LT2', {}));
  const z = { type: 'warden', pos: [1, 0, 2], t: ZTYPES.warden };

  room.rng = constRng(0.1); // low roll: clears both independent chances
  room.typeDrop(z);
  const drops = [...room.inventory.pickups.values()];
  assert.ok(drops.some(pk => pk.item?.kind === 'armor'), 'an armor piece');
  assert.ok(drops.some(pk => pk.item && pk.item.kind !== 'armor'), 'plus its own deployOdds roll (a turret/trap)');

  room.inventory.pickups.clear();
  room.rng = constRng(0.9); // high roll: both chances miss
  room.typeDrop(z);
  assert.equal(room.inventory.pickups.size, 0, 'a chance, not a guarantee');
});

test('Relic Bearer: usually a high-rarity gun (sometimes elemental), otherwise a rare attachment', () => {
  const room = started(new HoldoutRoom('LT3', {}));
  room.wave = 7;
  const z = { type: 'relic', pos: [1, 0, 2], t: ZTYPES.relic };

  room.rng = constRng(0.1); // low roll: the rare attachment
  room.typeDrop(z);
  assert.equal([...room.inventory.pickups.values()].at(-1).item.id, 'extmag');

  room.rng = constRng(0.35); // higher roll: a legendary, elemental gun
  room.typeDrop(z);
  const gun = [...room.inventory.pickups.values()].at(-1).item;
  assert.equal(gun.kind, 'gun');
  assert.equal(gun.r, 4, 'legendary rarity');
  assert.equal(gun.el, 'water', 'sometimes elemental');
});

test('the break after a Maw wave (15, 30 …) is 4 minutes instead of the usual cap, and says so', () => {
  const room = started(new HoldoutRoom('MAWBRK', {}));
  const a = join(room, 'A');
  assert.equal(bossFor(15), 'maw'); // sanity: matches the spec's example waves
  room.wave = 15;
  const before = Date.now();
  room.waveCleared();
  assert.equal(room.phaseEnd - before, MAW_BREAK, 'exactly the longer Maw break');
  assert.ok(a.all('task').some(m => /Maw/i.test(m.text) && /4 minutes/i.test(m.text)), 'tells the squad why the break is longer');

  // a normal wave keeps the usual (much shorter) break
  const room2 = started(new HoldoutRoom('NORMBRK', {}));
  room2.wave = 14;
  const before2 = Date.now();
  room2.waveCleared();
  assert.equal(room2.phaseEnd - before2, intermissionFor(14));
  assert.ok(room2.phaseEnd - before2 < MAW_BREAK, 'much shorter than the Maw break');
});
