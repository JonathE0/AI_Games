import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldoutRoom } from '../server/holdout/room.js';
import { CORE_UPS } from '../shared/holdout.js';

let T = 8_000_000;
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
const started = room => { room.phase = 'prep'; return room; };
const zombieAt = (room, x, z, type = 'shambler') => { const zb = room.spawnZombie(type, 'N'); zb.pos = [x, 0, z]; zb.hist = []; return zb; };

test('the Core regenerates a little on its own, all the time, never past max', () => {
  const room = started(new HoldoutRoom('CR', {}));
  room.phaseEnd = Infinity; // stays in 'prep' so update() doesn't advance into a wave
  join(room, 'A');
  const max = room.core.max;
  room.core.hp = max - 500;
  const hp0 = room.core.hp;
  advance(room, 10000);
  const gained = room.core.hp - hp0;
  assert.ok(gained > 0, 'regenerated a little');
  assert.ok(Math.abs(gained - max * 0.003) < 0.5, `expected ~0.03%/s of max (${max * 0.003}), got ${gained}`);
  assert.ok(gained < max * 0.01, 'very slow: nowhere near 1% of max in 10s');
  room.core.hp = max;
  advance(room, 5000);
  assert.equal(room.core.hp, max, 'never over max');
});

test('survivors: passive regen, assignment follows the last assigner, orders move only that owner\'s survivors', () => {
  const room = started(new HoldoutRoom('CS', {}));
  const a = join(room, 'A'), p = a.player;
  const b = join(room, 'B'), q = b.player;
  room.startWave(3); room.director.queue = []; // a rescue wave: two wounded survivors appear
  const [sv1, sv2] = [...room.survivors.list.values()];
  for (const [pl, sv] of [[p, sv1], [q, sv2]]) {
    pl.st.p = [sv.pos[0] + 1, 0, sv.pos[2]];
    room.handle(pl, { t: 'carry', id: sv.id });
    pl.st.p = [0, 0, -4]; // inside the ring
  }
  advance(room, 200);
  assert.equal(sv1.state, 'active');
  assert.equal(sv2.state, 'active');

  // passive healing, very slow
  room.survivors.hurt(sv1, 60);
  const hurtHp = sv1.hp;
  advance(room, 4000);
  assert.ok(sv1.hp > hurtHp, 'healed a little on its own');
  assert.ok(sv1.hp < hurtHp + 20, 'still very slow');

  // assignment: aiming (within range) at an active survivor assigns it; last assigner wins
  p.st.p = [sv1.pos[0], 0, sv1.pos[2]];
  room.handle(p, { t: 'svassign', id: sv1.id });
  assert.equal(sv1.owner, p.id);
  q.st.p = [sv1.pos[0], 0, sv1.pos[2]];
  room.handle(q, { t: 'svassign', id: sv1.id });
  assert.equal(sv1.owner, q.id, 'last assigner wins');
  room.handle(q, { t: 'svassign', id: sv1.id }); // pressing again on one of yours unassigns
  assert.equal(sv1.owner, null);

  // orders only move survivors owned by the player who sent them
  room.handle(p, { t: 'svassign', id: sv1.id }); // p re-assigns sv1 to themself
  q.st.p = [sv2.pos[0], 0, sv2.pos[2]];
  room.handle(q, { t: 'svassign', id: sv2.id }); // q owns sv2
  room.handle(p, { t: 'svcmd', x: 20, z: 20 });
  assert.deepEqual(sv1.order, [20, 20], 'p\'s survivor got the order');
  assert.equal(sv2.order, null, 'q\'s survivor is untouched by p\'s order');

  T += 250; // past the command's own cooldown
  room.handle(p, { t: 'svcmd', x: 0, z: 0 }); // aimed inside the Core ring: clears orders
  assert.equal(sv1.order, null);
});

test('Core cannon: fires at a zombie in range with line of sight during a wave', () => {
  const room = started(new HoldoutRoom('CC', {}));
  join(room, 'A');
  room.startWave(1); room.director.queue = [];
  const z = zombieAt(room, 0, -10);
  z.hp = z.maxHp = 5000;
  z.frozenUntil = T + 60000;
  advance(room, 2000);
  assert.ok(z.hp < 5000, 'the Core cannon hit it on its own, no player needed');
});

test('Core cannon upgrades: priced off the overall level, gated by wave, payable from the bank', () => {
  const room = started(new HoldoutRoom('CU', {}));
  const a = join(room, 'A'), p = a.player;
  p.money = 100000;
  p.st.p = [0, 0, 0]; // inside the ring

  const price0 = room.cannon.price();
  room.handle(p, { t: 'coreup', id: 'dmg' });
  assert.equal(room.coreUps.dmg, 1, 'the first upgrade is available immediately');
  assert.equal(room.coreLevel, 1);
  assert.equal(p.money, 100000 - price0);

  room.wave = 4;
  room.handle(p, { t: 'coreup', id: 'range' });
  assert.equal(room.coreUps.range, 0, 'denied before wave 5');
  assert.match(a.last('deny').text, /wave 5/);

  room.wave = 5;
  room.inventory.stash.money = 50000;
  const price1 = room.cannon.price(), bankBefore = room.inventory.stash.money, moneyBefore = p.money;
  room.handle(p, { t: 'coreup', id: 'range', bank: true });
  assert.equal(room.coreUps.range, 1, 'unlocked at wave 5');
  assert.equal(room.coreLevel, 2);
  assert.equal(p.money, moneyBefore, 'paid from the bank, not the player');
  assert.equal(room.inventory.stash.money, bankBefore - price1);
});

test('Core cannon: elemental rounds apply, plating raises the Core\'s max HP right away', () => {
  const room = started(new HoldoutRoom('CE', {}));
  const a = join(room, 'A'), p = a.player;
  p.money = 1000000;
  p.st.p = [0, 0, 0];

  room.handle(p, { t: 'coreup', id: 'fire' });
  assert.equal(room.coreUps.fire, 1);

  room.startWave(1); room.director.queue = [];
  const z = zombieAt(room, 0, -10);
  z.hp = z.maxHp = 5000;
  z.frozenUntil = T + 60000;
  advance(room, 1000);
  assert.ok(z.burnUntil > T, 'fire rounds set it burning');

  room.wave = 5; // unlock the next cannon level
  const maxBefore = room.core.max, hpBefore = room.core.hp;
  room.handle(p, { t: 'coreup', id: 'plating' });
  assert.ok(room.core.max > maxBefore, 'plating raised max HP');
  assert.ok(room.core.hp > hpBefore, 'and healed the Core by the same amount right away');
  assert.equal(CORE_UPS.plating.max, undefined, 'plating stacks without limit');
});

// sanity: the Core cannon's roster of upgrades is what the shop expects (shared/holdout.js CORE_UPS)
test('CORE_UPS covers damage, rate, range, the three elements, barrels and plating', () => {
  for (const id of ['dmg', 'rate', 'range', 'fire', 'ice', 'shock', 'barrels', 'plating']) assert.ok(CORE_UPS[id], id);
});
