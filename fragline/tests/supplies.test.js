// Supplies: the freeze grenade's Blizzard field and the bigger rocket stock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addAmmo } from '../server/holdout/inventory.js';
import { HoldoutRoom } from '../server/holdout/room.js';
import { AMMO, ITEMS, ammoCap } from '../shared/holdout.js';

let T = 23_000_000;
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
// held in place (a zero-speed "slow" can't be used: the Blizzard must be free to set its own), far from anyone
const still = (room, x, z) => { const zb = room.spawnZombie('shambler', 'N', ''); zb.pos = [x, 0, z]; zb.hist = []; zb.hp = zb.maxHp = 5000; zb.aggroBlock = T + 1e9; zb.spd = 0; return zb; };

test('Blizzard: a 6 m icy field for 6 s; zombies inside slowed 50%, frozen solid 3 s after 1.5 s inside (cumulative), +25% damage while frozen; players untouched', () => {
  const F = ITEMS.freeze;
  assert.deepEqual([F.radius, F.time, F.slow, F.freezeAfter, F.freeze, F.brittle], [6, 6, 0.5, 1.5, 3, 1.25]);
  const room = new HoldoutRoom('BZ', {});
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  room.cannon.next = Infinity;
  const inside = still(room, 3, -20), outside = still(room, 8, -20), roamer = still(room, 12, -12);
  p.st.p = [-2, 0, -20]; p.hp = 200;

  room.combat.detonate({ id: 7, kind: 'freeze', owner: p }, [0, 0.1, -20]);
  assert.deepEqual(a.last('boom'), { t: 'boom', id: 7, item: 'freeze', p: [0, 0, -20] }, 'the field lies on the ground');
  advance(room, 500);
  assert.equal(inside.slow, F.slow, 'slowed 50% inside');
  assert.ok(inside.slowUntil > T);
  assert.ok(!(outside.slowUntil > T), 'nothing outside the 6 m');
  assert.ok(!(inside.frozenUntil > T), 'not frozen yet');

  roamer.pos = [2, 0, -18]; // walks in for 1 s, back out, and in again: the time inside adds up
  advance(room, 500);
  roamer.pos = [12, 0, -12];
  advance(room, 500);
  assert.ok(inside.frozenUntil > T && inside.brittleUntil === inside.frozenUntil, 'frozen solid after 1.5 s inside');
  assert.ok(Math.abs(inside.frozenUntil - T - F.freeze * 1000) <= 100, 'for 3 s');
  assert.ok(!(roamer.frozenUntil > T), '0.5 s inside is not enough');
  roamer.pos = [2, 0, -18];
  advance(room, 1050);
  assert.ok(roamer.frozenUntil > T, '0.5 s + 1 s more: frozen');

  const hp0 = inside.hp, hp1 = outside.hp;
  room.damageZombie(inside, 100, p, 'ar');
  room.damageZombie(outside, 100, p, 'ar');
  assert.equal(hp0 - inside.hp, 125, 'frozen zombies take +25%');
  assert.equal(hp1 - outside.hp, 100);
  assert.deepEqual([p.hp, p.fx?.slowUntil ?? 0], [200, 0], 'players in the field are never hurt or slowed');

  const late = join(room, 'B');
  assert.ok(late.all('boom').some(m => m.item === 'freeze' && m.left > 0), 'a late joiner sees the field too');
  advance(room, 3500); // 6 s after it went off
  const fresh = still(room, 1, -20);
  advance(room, 500);
  assert.ok(!(fresh.slowUntil > T), 'gone after 6 s');
});

test('rockets: carry 50 (75 as Assault), 5 per pack', () => {
  assert.deepEqual([AMMO.rockets.cap, AMMO.rockets.pack], [50, 5]);
  assert.deepEqual(['tank', 'ronin', 'assault'].map(c => ammoCap('rockets', c)), [50, 50, 75]);
  const room = new HoldoutRoom('RK', {});
  const p = join(room, 'A').player;
  p.cls = 'assault';
  assert.equal(addAmmo(p, 'rockets', 100), 75);
  p.cls = 'tank'; p.ammo.rockets = 0; p.money = 1e5; p.st.p = [0, 0, 0];
  room.phase = 'prep';
  room.handle(p, { t: 'buy', item: 'a_rockets' });
  assert.equal(p.ammo.rockets, 5, 'a pack is 5 rockets');
});
