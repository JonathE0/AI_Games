import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldoutRoom, HOLDOUT } from '../server/holdout/room.js';
import { countMult, hpMult, laneCount, aliveCap, coreHp, waveBudget, composeWave, WAVES } from '../shared/zombies.js';
import { GRID } from '../shared/build.js';
import { OUTPOST, OUTPOST_NODES } from '../shared/outpost.js';

// Fake clock: the room reads Date.now() for timers.
let T = 1_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 33) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };

function join(room, name = 'P') {
  const messages = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const player = room.addPlayer(ws, name);
  return { player, messages, last: t => messages.filter(m => m.t === t).at(-1) };
}
const tile = (x, z) => ({ i: (x - GRID.x0) / GRID.cell, k: (z - GRID.z0) / GRID.cell });
const rng = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(42);

test('player-count scaling matches the design table', () => {
  assert.deepEqual([1, 2, 3, 4].map(countMult), [1, 1.75, 2.5, 3.25]);
  assert.deepEqual([1, 2, 3, 4].map(n => +hpMult(n, 1).toFixed(2)), [1, 1.2, 1.4, 1.6]);
  assert.deepEqual([1, 2, 3, 4].map(n => [laneCount(n, 1), laneCount(n, WAVES)]), [[1, 4], [2, 4], [2, 4], [3, 4]]);
  assert.deepEqual([1, 2, 3, 4].map(aliveCap), [45, 60, 75, 90]);
  assert.deepEqual([1, 2, 3, 4].map(coreHp), [3000, 3450, 3900, 4350]);
  assert.equal(waveBudget(5, 4) / waveBudget(5, 1), 3.25);
  const solo = composeWave(6, 1, 1, rng).length, squad = composeWave(6, 4, 1, rng).length;
  assert.ok(squad > solo * 2.5, `${squad} vs ${solo}`);
});

test('rooms hold four; everyone ready starts the countdown, then wave 1 spawns from its lanes', () => {
  const room = new HoldoutRoom('ZOMB', { rng });
  const a = join(room, 'A');
  assert.equal(a.messages[0].t, 'welcome');
  assert.equal(a.messages[0].gameMode, 'zombies');
  const others = [join(room, 'B'), join(room, 'C'), join(room, 'D')];
  assert.ok(room.isFull());
  assert.equal(room.core.max, coreHp(4));
  room.handle(a.player, { t: 'ready', on: true });
  assert.equal(room.phase, 'lobby');
  for (const o of others) room.handle(o.player, { t: 'ready', on: true });
  assert.equal(room.phase, 'countdown');
  assert.equal(a.last('hphase').next.length, laneCount(4, 1));
  advance(room, HOLDOUT.countdown + 100);
  assert.equal(room.phase, 'wave');
  assert.equal(room.wave, 1);
  advance(room, 6000);
  assert.ok(room.zombies.size > 0);
  const zones = OUTPOST.lanes.filter(l => room.director.lanes.includes(l.id)).map(l => l.zone);
  const first = a.messages.find(m => m.t === 'zsp').z;
  for (const [, , , x, z] of first) assert.ok(zones.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1));
});

test('mid-wave joins add zombies to what is left; leaving trims it', () => {
  const room = new HoldoutRoom('ZOMB', { rng });
  const a = join(room, 'A');
  room.handle(a.player, { t: 'ready', on: true });
  advance(room, HOLDOUT.countdown + 100);
  const before = room.director.remaining;
  const b = join(room, 'B');
  assert.ok(room.director.remaining > before);
  const grown = room.director.remaining;
  room.removePlayer(b.player);
  assert.ok(room.director.remaining < grown);
});

test('building costs materials, grows, upgrades, repairs and can be demolished by its owner', () => {
  const room = new HoldoutRoom('ZOMB', { rng });
  const a = join(room, 'A'), b = join(room, 'B');
  a.player.st.p = [0, 0, -6];
  room.handle(a.player, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'wood' });
  assert.equal(room.pieces.size, 1);
  assert.equal(a.player.mats.wood, HOLDOUT.startMats.wood - 10);
  const s = [...room.pieces.values()][0];
  assert.ok(s.hp < 30);
  advance(room, 2100);
  assert.equal(Math.round(s.hp), 200);
  room.handle(a.player, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'wood' });
  assert.equal(a.last('deny').text, 'Already built');
  room.handle(a.player, { t: 'upgrade', id: s.id });
  assert.equal(s.mat, 'stone');
  assert.equal(a.player.mats.stone, HOLDOUT.startMats.stone - 10);
  advance(room, 4100);
  assert.equal(Math.round(s.hp), 400);
  room.damagePiece(s, 100);
  T += 1000;
  room.handle(a.player, { t: 'repair', id: s.id });
  assert.equal(Math.round(s.hp), 340);
  b.player.st.p = [0, 0, -6];
  room.handle(b.player, { t: 'demolish', id: s.id });
  assert.equal(b.last('deny').text, 'Only the builder can remove this');
  room.handle(a.player, { t: 'demolish', id: s.id });
  assert.equal(room.pieces.size, 0);
});

test('harvesting needs the knife and depletes nodes', () => {
  const room = new HoldoutRoom('ZOMB', { rng });
  const a = join(room, 'A');
  const tree = OUTPOST_NODES.find(n => n.type === 'tree');
  a.player.st.p = [tree.x + 1.2, 0, tree.z];
  room.handle(a.player, { t: 'harvest', id: tree.id });
  assert.equal(a.player.mats.wood, HOLDOUT.startMats.wood);
  a.player.st.w = 'knife';
  for (let i = 0; i < 12; i++) { T += 300; room.handle(a.player, { t: 'harvest', id: tree.id, weak: i === 0 }); }
  assert.equal(a.player.mats.wood, HOLDOUT.startMats.wood + 30 + 9 * 12);
  assert.equal(room.nodes[tree.id].hp, 0);
});

test('downed players bleed out unless a teammate revives them; solo players just respawn', () => {
  const room = new HoldoutRoom('ZOMB', { rng });
  const a = join(room, 'A'), b = join(room, 'B');
  room.phase = 'wave';
  room.director.queue = ['shambler']; // keeps the wave "running" (no lanes started, so nothing spawns)
  a.player.st.p = [0, 0, -3]; b.player.st.p = [1, 0, -3];
  room.hurtPlayer(a.player, 500, null);
  assert.equal(a.player.downed, true);
  assert.equal(a.player.alive, true);
  for (let t = 0; t < 3200; t += 200) { T += 200; room.handle(b.player, { t: 'revive', id: a.player.id }); room.update(T, 0.2); }
  assert.equal(a.player.downed, false);
  assert.equal(a.player.hp, HOLDOUT.reviveHp);
  room.hurtPlayer(a.player, 500, null);
  advance(room, HOLDOUT.bleed + 200, 100);
  assert.equal(a.player.alive, false);
  advance(room, HOLDOUT.respawnTeam + 200, 100);
  assert.equal(a.player.alive, true);
  room.removePlayer(b.player);
  room.phase = 'wave';
  room.hurtPlayer(a.player, 500, null);
  assert.equal(a.player.alive, false);
  assert.equal(a.player.downed, false);
});

test('the Core falling ends the match; the next one starts in the lobby', () => {
  const room = new HoldoutRoom('ZOMB', { rng });
  const a = join(room, 'A');
  room.handle(a.player, { t: 'ready', on: true });
  advance(room, HOLDOUT.countdown + 100);
  room.damageCore(1e6, null);
  assert.equal(room.phase, 'defeat');
  assert.equal(a.last('hend').win, false);
  advance(room, HOLDOUT.endScreen + 100);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.core.hp, room.core.max);
});

test('clearing the last wave wins', () => {
  const room = new HoldoutRoom('ZOMB', { rng });
  const a = join(room, 'A');
  room.startWave(WAVES);
  for (const z of [...room.zombies.values()]) room.killZombie(z, a.player, { id: 'ak47' }, false);
  room.director.queue = [];
  room.zombies.clear();
  room.update(T += 33, 0.033);
  assert.equal(room.phase, 'victory');
  assert.equal(a.last('hend').win, true);
});

test('hit claims must line up with where the zombie actually was', () => {
  const room = new HoldoutRoom('ZOMB', { rng });
  const a = join(room, 'A');
  room.startWave(1);
  const z = room.spawnZombie('shambler', 'N');
  z.pos = [0, 0, -20];
  a.player.st.p = [0, 0, -3];
  a.player.guns[1] = { w: 'ar', uid: 99, r: 0 };
  const o = [0, 1.6, -3];
  const shot = d => ({ t: 'shot', w: 'ar', o, d: [d], e: [], h: [{ id: z.id, part: 'chest', pen: 1, k: 0 }] });
  const len = Math.hypot(0, 1.3 - 1.6, -17), d = [0, (1.3 - 1.6) / len, -17 / len];
  room.handle(a.player, shot(d));
  assert.ok(z.hp < z.maxHp);
  const hp = z.hp;
  T += 500;
  room.handle(a.player, shot([0.6, 0, -0.8])); // way off to the side
  assert.equal(z.hp, hp);
});

test('zombies walk to an undefended Core and hurt it; a sealed ring gets smashed first', () => {
  const room = new HoldoutRoom('ZOMB', { rng });
  const a = join(room, 'A');
  a.player.st.p = [0, 0, 60]; // out of the way
  room.startWave(1);
  room.director.queue = [];
  for (let i = 0; i < 4; i++) room.spawnZombie('shambler', 'N');
  advance(room, 25000);
  assert.ok(room.core.hp < room.core.max, 'core untouched');

  const room2 = new HoldoutRoom('ZOMB', { rng });
  const b = join(room2, 'B');
  b.player.st.p = [0, 0, 60];
  for (let x = -12; x < 12; x += 4) for (const [z, o] of [[-12, 0], [12, 0]]) room2.addPiece({ kind: 'wall', ...tile(x, z), l: 0, o, mat: 'wood' }, null);
  for (let z = -12; z < 12; z += 4) for (const x of [-12, 12]) room2.addPiece({ kind: 'wall', ...tile(x, z), l: 0, o: 1, mat: 'wood' }, null);
  advance(room2, 2500);
  room2.startWave(1);
  room2.director.queue = [];
  for (let i = 0; i < 4; i++) room2.spawnZombie('shambler', 'N');
  advance(room2, 20000);
  assert.ok([...room2.pieces.values()].some(s => s.hp < s.maxHp) || room2.pieces.size < 24, 'no wall was attacked');
});

test('AI step stays cheap with a full horde and a big fort', () => {
  const room = new HoldoutRoom('ZOMB', { rng });
  const a = join(room, 'A');
  a.player.st.p = [0, 0, 0];
  let n = 0;
  for (let l = 0; l < 2; l++) for (let i = 2; i < 22; i++) for (let k = 2; k < 22; k++) {
    if (n >= 300) break;
    const x = GRID.x0 + i * GRID.cell, z = GRID.z0 + k * GRID.cell;
    if (Math.hypot(x, z) > 26 || Math.hypot(x, z) < 8 || (i + k + l) % 3) continue;
    room.addPiece({ kind: 'wall', i, k, l, o: (i + k) % 2, mat: 'wood' }, null);
    n++;
  }
  room.startWave(5);
  room.director.queue = [];
  for (let i = 0; i < 90; i++) room.spawnZombie(['shambler', 'runner', 'spitter', 'brute'][i % 4], 'NESW'[i % 4]);
  advance(room, 1000);
  const t0 = performance.now();
  advance(room, 3000, 50);
  const per = (performance.now() - t0) / 60;
  assert.ok(per < 5, `${per.toFixed(2)} ms per tick with ${room.pieces.size} pieces`);
});
