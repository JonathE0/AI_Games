// Batch 13: a wave time limit stops a horde being farmed forever. When it runs out, normal spawns stop,
// everything still alive ("the originals", bosses included) goes berserk (faster, harder-hitting, heads for
// the Core) and small berserk reinforcements trickle in from the active lanes while any original survives.
// Reinforcements are worth no money or loot, and vanish the instant the last original dies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldoutRoom } from '../server/holdout/room.js';
import { waveTimeLimit, BERSERK_INTERVAL, BERSERK_SPEED_MULT, BERSERK_DMG_MULT } from '../shared/zombies.js';

let T = 9_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 200) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
function join(room, name = 'P') {
  const messages = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const player = room.addPlayer(ws, name);
  return { player, messages, last: t => messages.filter(m => m.t === t).at(-1), all: t => messages.filter(m => m.t === t) };
}
const started = room => { room.phase = 'prep'; return room; };

test('wave time limit grows with the wave, caps at 9 minutes, and boss waves get 4 extra minutes', () => {
  assert.equal(waveTimeLimit(1), 192);
  assert.equal(waveTimeLimit(4), 228);
  assert.equal(waveTimeLimit(48), 540, 'capped at 9 minutes on a plain wave');
  assert.equal(waveTimeLimit(10), 540, 'boss wave: capped base (300) + 240s bonus');
  assert.ok(waveTimeLimit(10) > waveTimeLimit(9), 'a boss wave runs longer than a nearby plain one');
});

test("time's up: the horde goes berserk, reinforcements trickle in worth nothing, and vanish once the last original dies", () => {
  const room = started(new HoldoutRoom('BZ', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [200, 0, 200]; // out of everyone's reach — only the berserk bookkeeping is under test here
  room.startWave(1);
  room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const original = room.spawnZombie('shambler', 'N', '');
  original.pos = [0, 0, -10];
  original.hp = original.maxHp = 1e6;
  original.frozenUntil = T + 1e9; // stays put and harmless — only its berserk flags/rewards are under test here
  const deadline = room.director.deadline;

  advance(room, deadline - T - 500); // right up to the deadline, but not past it
  assert.equal(room.director.berserk, false, 'not yet');
  room.director.queue = new Array(50).fill('shambler'); // a big chunk of the wave still queued
  for (const l of room.director.lanes) room.director.nextGroup[l] = deadline + 10000; // don't let it drain before time's actually up
  advance(room, 1000); // cross the deadline
  assert.equal(room.zombies.size, 1, 'sanity: nothing from that queue snuck out before the deadline hit');
  assert.equal(room.director.berserk, true, 'time is up: berserk triggers');
  assert.equal(room.director.queue.length, 0, 'no more normal spawns once time is up — the queue is cleared');
  assert.ok(a.all('berserk').some(m => m.ev === 'start'), 'announced to the squad');
  assert.equal(original.berserk, true, 'the surviving original goes berserk');
  assert.equal(original.spd, BERSERK_SPEED_MULT, 'faster');
  assert.equal(original.dmgMul, BERSERK_DMG_MULT, 'harder-hitting');

  // reinforcements trickle in from the active lanes while an original still lives
  const before = room.zombies.size, beforeIds = new Set(room.zombies.keys());
  advance(room, (BERSERK_INTERVAL + 2) * 1000);
  assert.ok(room.zombies.size > before, 'berserk reinforcements spawned while an original is still alive');
  const reinforcement = [...room.zombies.values()].find(z => !beforeIds.has(z.id));
  assert.ok(reinforcement, 'sanity: a reinforcement exists');
  assert.equal(reinforcement.berserk, true, 'reinforcements are berserk too (red-glowing, faster, harder-hitting)');
  assert.equal(reinforcement.noReward, true, 'flagged to give no reward');
  const moneyBefore = p.money;
  room.killZombie(reinforcement, p, 'ar');
  assert.equal(p.money, moneyBefore, 'killing a reinforcement gives no money');

  // the last original dies: every remaining berserk reinforcement vanishes (no reward), the wave clears normally
  const moneyBefore2 = p.money;
  room.killZombie(original, p, 'ar');
  assert.ok(p.money > moneyBefore2, 'the original itself still pays out normally');
  advance(room, 200);
  assert.equal(room.zombies.size, 0, 'every leftover berserk reinforcement vanished with the last original');
  assert.equal(room.director.berserk, false);
  assert.equal(room.phase, 'intermission', 'the wave cleared and the break started');
});
