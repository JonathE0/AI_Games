// The Behemoth (wave 25): a walking fortress marching down a lane at the Core. It crushes builds in its path (each
// one stalls it), braces to shell the Core, carries players on its moving deck, can only be hurt through its three
// reactor hearts (hatch bolts first, harvest tool only), rears up when one dies, slams the Core if it gets there,
// and drops the Siegebreaker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldoutRoom, HOLDOUT } from '../server/holdout/room.js';
import { makeGun } from '../server/holdout/inventory.js';
import { bossFor, bossCycle } from '../shared/zombies.js';
import { BEHEMOTH as B, HATCHES, BOLTS, bhmBox, bhmPoint, heartPos, boltPos, onDeck } from '../shared/behemoth.js';
import { moveCharacter, P } from '../shared/physics.js';
import { GRID, pieceBox } from '../shared/build.js';
import { BARRIER } from '../shared/holdout.js';

let T = 9_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 50) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
const tile = (x, z) => ({ i: (x - GRID.x0) / GRID.cell, k: (z - GRID.z0) / GRID.cell });
function join(room, name = 'P') {
  const messages = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const player = room.addPlayer(ws, name);
  player.st.p = [40, 0, 40]; // a far corner, out of its way
  return { player, messages, all: t => messages.filter(m => m.t === t), bhm: ev => messages.filter(m => m.t === 'bhm' && m.ev === ev) };
}
// Wave w with the horde already gone: it arrives ~5 s later, down the north lane (heading +z along x = 0).
function arrive(room, w = 25) {
  room.phase = 'prep';
  room.startWave(w);
  room.director.queue = [];
  room.director.lanes = ['N'];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  advance(room, 5100);
  const b = room.bosses.behemoth.b;
  b.nextCrew = Infinity; // no crew unless a test asks for them
  return b;
}
const openHatch = (room, p, b, i) => {
  const q = boltPos(b, i, 0);
  p.st.p = [q[0] + 1, B.deck, q[2]];
  p.st.w = 'knife';
  for (let j = 0; j < BOLTS.length; j++) for (let n = 0; n < B.boltHits; n++) { T += 300; room.handle(p, { t: 'harvest', bolt: [i, j] }); }
};

test('the Behemoth is the fifth boss: wave 25, then every 25 waves, 50 % tougher each time around', () => {
  assert.equal(bossFor(25), 'behemoth');
  assert.equal(bossFor(50), 'behemoth');
  assert.deepEqual([bossCycle(25), bossCycle(50)], [0, 1]);
  const room = new HoldoutRoom('BH1', {}), a = join(room, 'A');
  const b = arrive(room);
  assert.ok(a.all('task').some(m => /BEHEMOTH/.test(m.text)), 'announced at the start of the wave');
  assert.equal(a.bhm('warn').length, 1, 'a warning once the horde is gone');
  assert.equal(a.bhm('enter').length, 1);
  assert.equal(b.mode, 'march');
  assert.deepEqual(b.hearts.map(h => [h.max, h.open, h.bolts.join()]), HATCHES.map(() => [B.heartHp, false, '2,2,2']));
  const again = new HoldoutRoom('BH1b', {});
  join(again, 'A');
  assert.equal(arrive(again, 50).hearts[0].max, Math.round(B.heartHp * 1.5), 'second time around: +50 %');
});

test('it marches straight down its lane at ~1.1 m/s, its body a moving obstacle, and the wave waits for it', () => {
  const room = new HoldoutRoom('BH2', {}), a = join(room, 'A');
  const b = arrive(room);
  assert.deepEqual([b.fx, b.fz, b.x], [0, 1, 0], 'down the north lane, facing the Core');
  assert.ok(Math.abs(b.z + B.start) < 0.2, `spawned ${B.start} m out (z ${b.z})`);
  const z0 = b.z;
  advance(room, 5000);
  assert.ok(Math.abs(b.z - z0 - 5 * B.speed) < 0.1, `walked ${(b.z - z0).toFixed(2)} m in 5 s`);
  assert.equal(b.x, 0, 'no drift off the lane');
  const box = room.grid.query(b.x - 1, b.z - 1, b.x + 1, b.z + 1, []).find(q => q.bhm);
  assert.ok(box && box.max[2] === b.z + B.len / 2 && box.max[1] === B.deck, 'its collision box moved with it');
  assert.ok(room.statics.includes(box), 'nothing can be built into it');
  assert.ok(a.bhm('mv').some(m => m.on === 1), 'clients are told it is walking');
  assert.equal(room.phase, 'wave');
  // a player standing in its way is knocked aside and hurt; someone on its deck is not
  const p = a.player, front = bhmPoint(b, 1, 0, B.len / 2 + 0.3);
  p.st.p = front;
  const hp0 = p.hp;
  advance(room, 100);
  const kb = a.bhm('kb').at(-1);
  assert.ok(kb && kb.v[0] > 5 && kb.v[1] > 0, 'shoved out to its right side, and up');
  assert.ok(p.hp < hp0, 'it hurts');
});

test('builds in its path are crushed, each one costing it ~1.2 s', () => {
  const room = new HoldoutRoom('BH3', {}), a = join(room, 'A');
  const b = arrive(room);
  const walls = [-4, 0].map(x => room.addPiece({ kind: 'wall', ...tile(x, -28), l: 0, o: 0, mat: 'zink' }, null)); // across its path
  for (const s of walls) { s.hp = s.maxHp; s.grow = 0; }
  for (let t = 0; walls.some(s => room.pieces.get(s.id) === s); t += 50) { assert.ok(t < 15000, 'reached the walls'); advance(room, 50); }
  assert.equal(a.bhm('crush').length, 2, 'both walls flattened');
  const z0 = b.z;
  advance(room, 2 * B.crushStall - 300);
  assert.ok(Math.abs(b.z - z0) < 1e-6, 'held up for two builds\' worth');
  advance(room, 700);
  assert.ok(b.z > z0 + 0.2, 'then it walks on');
});

test('every ~20 s it braces for ~7 s and shells the Core: three telegraphed arcs, ~150 each', () => {
  const room = new HoldoutRoom('BH4', {}), a = join(room, 'A');
  const b = arrive(room);
  for (let t = 0; b.mode !== 'brace'; t += 50) { assert.ok(t < B.braceEvery + 500); advance(room, 50); }
  assert.equal(a.bhm('brace').length, 1);
  const x = b.x, z = b.z, core0 = room.core.hp;
  advance(room, B.braceFor - 200);
  assert.deepEqual([b.x, b.z], [x, z], 'stationary while braced');
  const shells = a.bhm('shell');
  assert.equal(shells.length, 3, 'three shells');
  for (const s of shells) { // each arc lands on the Core
    const t = s.ms / 1000, land = [s.o[0] + s.v[0] * t, s.o[1] + s.v[1] * t - 0.5 * B.shellG * t * t, s.o[2] + s.v[2] * t];
    assert.ok(Math.hypot(land[0], land[2]) < 2.2 && Math.abs(land[1] - 1) < 0.2, `lands at ${land.map(v => v.toFixed(1))}`);
  }
  assert.equal(room.bosses.behemoth.shells.length, 0, 'all three have landed');
  assert.ok(Math.abs(core0 - room.core.hp - 3 * B.shellCore) < 15, `the Core took ${Math.round(core0 - room.core.hp)}`);
  advance(room, 400);
  assert.equal(b.mode, 'march');
  assert.ok(b.z > z, 'marching again');
});

test("a Tank's barrier across a shell's arc takes the shell instead of the Core", () => {
  const room = new HoldoutRoom('BH4b', {}), a = join(room, 'A'), p = a.player;
  const b = arrive(room);
  b.nextBrace = T;
  for (let t = 0; !a.bhm('shell').length; t += 50) { assert.ok(t < 3000); advance(room, 50); }
  const s = a.bhm('shell')[0], t1 = s.ms / 1000 - 0.05, at = [s.o[0] + s.v[0] * t1, 0, s.o[2] + s.v[2] * t1]; // just before it lands
  const l = Math.hypot(s.v[0], s.v[2]), f = [-s.v[0] / l, -s.v[2] / l]; // facing the incoming shell
  p.cls = 'tank'; p.inv[1] = makeGun('ar');
  p.st = { ...p.st, p: [at[0] - f[0] * BARRIER.dist, 0, at[2] - f[1] * BARRIER.dist], y: Math.atan2(-f[0], -f[1]), w: 'ar' };
  room.handle(p, { t: 'bar', on: true });
  const core0 = room.core.hp;
  advance(room, 6000); // the last shell leaves 2 s after the first and flies ≤ 3.5 s
  const walled = a.bhm('shellhit');
  assert.ok(walled.some(m => m.id === s.id), 'the barrier took it');
  assert.ok(p.bar.hp < BARRIER.hp, 'and soaked its damage');
  assert.ok(Math.abs(core0 - room.core.hp - (3 - walled.length) * B.shellCore) < 15, 'only the shells that got past hit the Core');
});

test('its deck is a moving floor: whoever stands on it rides along, and a level-1 stair steps right onto it', () => {
  const b = { x: 0, z: -20, fx: 0, fz: 1 }, deck = bhmBox(b), ground = { min: [-48, -1, -48], max: [48, 0, 48], mat: 'f' };
  const dt = 1 / 128, rider = [1, B.deck, -20], vel = [0, 0, 0], bystander = [5, 0, -20];
  let g = true;
  for (let i = 0; i < 3 * 128; i++) { // 3 s at 128 Hz, like public/js/boss_behemoth.js + player.js
    const dz = B.speed * dt, on = g && onDeck(rider, deck), off = onDeck(bystander, deck);
    b.z += dz;
    bhmBox(b, deck);
    if (on) rider[2] += dz;
    if (off) bystander[2] += dz;
    vel[1] -= P.gravity * dt;
    g = moveCharacter(rider, vel, dt, P.standH, [ground, deck], g);
  }
  assert.ok(g && Math.abs(rider[1] - B.deck) < 1e-9, 'still standing on the deck');
  assert.ok(Math.abs(rider[2] - (-20 + 3 * B.speed)) < 1e-6, `carried ${(rider[2] + 20).toFixed(2)} m`);
  assert.equal(bystander[2], -20, 'someone beside it stays put');
  // boarding: a stair (level 1) on the tile beside its flank rises to 6 m; walking up it steps onto the 6.4 m deck
  const stair = pieceBox({ kind: 'ramp', ...tile(4, -20), l: 1, o: 1, mat: 'zink', id: 1 }); // rises toward -x, top edge at x = 4
  const pos = [5, 5.8, -18], v = [-3, 0, 0];
  let gr = false;
  for (let i = 0; i < 128 * 2; i++) { v[0] = -3; v[1] -= P.gravity * dt; gr = moveCharacter(pos, v, dt, P.standH, [ground, stair, deck], gr); }
  assert.ok(pos[0] < deck.max[0] - 1 && Math.abs(pos[1] - B.deck) < 1e-6, `walked off the stair onto the deck (${pos.map(q => q.toFixed(2))})`);
});

test('hatch bolts: the harvest tool only, within reach, 2 hits each; three broken bolts open the hatch', () => {
  const room = new HoldoutRoom('BH5', {}), a = join(room, 'A'), p = a.player;
  const b = arrive(room), h = b.hearts[0], q = boltPos(b, 0, 0);
  p.st.p = [q[0] + 1, B.deck, q[2]];
  p.st.w = 'ar';
  room.handle(p, { t: 'harvest', bolt: [0, 0] });
  assert.equal(h.bolts[0], 2, 'a gun does nothing to a bolt');
  p.st.w = 'knife';
  p.st.p = [q[0] + 5, B.deck, q[2]];
  room.handle(p, { t: 'harvest', bolt: [0, 0] });
  assert.equal(h.bolts[0], 2, 'out of reach');
  p.st.p = [q[0] + 1, B.deck, q[2]];
  room.handle(p, { t: 'harvest', bolt: [0, 0] });
  room.handle(p, { t: 'harvest', bolt: [0, 0] });
  assert.equal(h.bolts[0], 1, 'one hit, and the harvest cooldown holds the second');
  T += 300;
  room.handle(p, { t: 'harvest', bolt: [0, 0] });
  assert.equal(h.bolts[0], 0, 'broken in two hits');
  room.handle(p, { t: 'harvest', bolt: 'x' });
  room.handle(p, { t: 'harvest', bolt: [7, -1] });
  assert.equal(h.open, false, 'still two bolts to go');
  openHatch(room, p, b, 0);
  assert.equal(h.open, true, 'hatch open');
  assert.equal(a.bhm('open').length, 1);
  assert.ok(!b.hearts[1].open && !b.hearts[2].open, 'the others stay shut');
});

test('hearts are immune until their hatch opens, then take gun damage — but not through its body from below', () => {
  const room = new HoldoutRoom('BH6', {}), a = join(room, 'A'), p = a.player;
  const b = arrive(room), gun = p.inv[1] = makeGun('ar'), h = b.hearts[1], c = heartPos(b, 1);
  const shoot = o => { T += 1000; p.st.p = [o[0], o[1] - 1.6, o[2]]; room.handle(p, { t: 'shot', w: 'ar', uid: gun.uid, o, d: [c.map((v, i) => v - o[i])], e: [], h: [], bhm: [[1, 0]] }); };
  const onDeckEye = [c[0] + 2.5, B.deck + 1.6, c[2] + 1];
  shoot(onDeckEye);
  assert.equal(h.hp, h.max, 'a shut hatch: immune');
  openHatch(room, p, b, 1);
  shoot([c[0] + 12, 1.6, c[2]]);
  assert.equal(h.hp, h.max, 'from the ground its armoured body is in the way');
  shoot(onDeckEye);
  assert.ok(h.hp < h.max, 'an open heart takes the round');
  room.handle(p, { t: 'shot', w: 'ar', uid: gun.uid, o: onDeckEye, d: [[0, 1, 0]], e: [], h: [], bhm: [5, 'x', null] }); // junk claims are ignored
});

test('a heart bursting makes it rear up and throw everyone off the deck (Tanks hold on); the last one kills it', () => {
  const room = new HoldoutRoom('BH7', {}), a = join(room, 'A'), t = join(room, 'T'), g = join(room, 'G');
  const b = arrive(room), beh = room.bosses.behemoth;
  openHatch(room, a.player, b, 0);
  t.player.cls = 'tank';
  t.player.st.p = bhmPoint(b, -2, B.deck, 3);
  a.player.st.p = bhmPoint(b, 1.5, B.deck, 1);
  g.player.st.p = bhmPoint(b, 6, 0, 0);
  beh.damageHeart(0, b.hearts[0].hp + 1, a.player);
  const kb = a.bhm('kb').at(-1);
  assert.ok(kb && kb.v[0] >= 8 && kb.v[1] > 5, 'thrown off its right side');
  assert.equal(t.bhm('kb').length, 0, 'the Tank is immune to knockback');
  assert.equal(g.bhm('kb').length, 0, 'nobody on the ground is thrown');
  assert.equal(a.bhm('heart').length, 1);
  const z0 = b.z;
  advance(room, B.rear - 200);
  assert.equal(b.z, z0, 'rearing: it stops');
  for (const i of [1, 2]) { b.hearts[i].open = true; beh.damageHeart(i, 1e9, a.player); }
  assert.equal(b.mode, 'dead');
});

test('at the Core it slams it for 15 % of its max HP every 6 s', () => {
  const room = new HoldoutRoom('BH8', {}), a = join(room, 'A');
  const b = arrive(room), beh = room.bosses.behemoth;
  b.nextBrace = Infinity;
  beh.move(0, -(B.stop + 1) - b.z); // a metre short of where it halts
  for (let t = 0; b.mode !== 'siege'; t += 50) { assert.ok(t < 2000); advance(room, 50); }
  assert.equal(a.bhm('siege').length, 1);
  assert.ok(Math.abs(b.z + B.stop) < 1e-6, 'halts in front of the Core');
  const hp0 = room.core.hp;
  advance(room, B.slamEvery - 200);
  assert.ok(hp0 - room.core.hp < 10, 'not yet');
  advance(room, 400);
  assert.ok(Math.abs(hp0 - room.core.hp - room.core.max * B.slamFrac) < 10, `one slam: -${Math.round(hp0 - room.core.hp)}`);
  assert.equal(a.bhm('slam').length, 1);
  advance(room, B.slamEvery);
  assert.equal(a.bhm('slam').length, 2, 'and again');
});

test('death pays the squad, drops the Siegebreaker and clears its body; defeat and a new match clear it too', () => {
  const room = new HoldoutRoom('BH9', {}), a = join(room, 'A'), p = a.player;
  const b = arrive(room), beh = room.bosses.behemoth, box = room.statics.find(q => q.bhm);
  b.nextCrew = 0;
  advance(room, 100);
  assert.ok([...room.zombies.values()].some(z => z.crew && Math.abs(z.pos[1] - B.deck) < 0.2), 'crew climb onto the deck');
  const money = p.money;
  for (const [i, h] of b.hearts.entries()) { h.open = true; beh.damageHeart(i, 1e9, p); }
  assert.equal(b.mode, 'dead');
  assert.equal(beh.busy(), false);
  assert.equal(p.money, money + B.reward);
  assert.ok([...room.inventory.pickups.values()].some(pk => pk.item?.id === 'siegebreaker' && pk.item?.tier === 3 && pk.item?.r === 4), 'the Siegebreaker dropped');
  assert.ok(!room.statics.includes(box) && !room.grid.query(box.min[0], box.min[2], box.max[0], box.max[2], []).includes(box), 'its body is gone');
  assert.equal(a.bhm('die').length, 1);
  for (const z of [...room.zombies.values()]) room.killZombie(z, p, 'ar');
  advance(room, 100);
  assert.equal(room.phase, 'intermission', 'the wave ends once the crew is dead too');
  // the Core falls mid-fight: after the end screen the new match has no Behemoth
  const room2 = new HoldoutRoom('BH9b', {});
  join(room2, 'A');
  arrive(room2);
  room2.endMatch(false);
  advance(room2, HOLDOUT.endScreen + 100);
  assert.equal(room2.phase, 'lobby');
  assert.equal(room2.bosses.behemoth.b, null);
  assert.ok(!room2.statics.some(q => q.bhm), 'no body left behind');
});

test('Siegebreaker: its rockets split into 3 cluster bomblets on impact, with no acid pool', () => {
  const room = new HoldoutRoom('SG', {}), a = join(room, 'A'), p = a.player;
  room.phase = 'prep';
  room.startWave(1); room.director.queue = [];
  p.inv[1] = makeGun('siegebreaker');
  p.st.p = [0, 0, -3];
  const z = room.spawnZombie('shambler', 'N', ''); z.pos = [0, 0, -10]; z.hp = z.maxHp = 5000; z.frozenUntil = T + 60000;
  room.handle(p, { t: 'rocket', uid: p.inv[1].uid, o: [0, 1.6, -3], d: [0, -0.05, -1] });
  advance(room, 300);
  assert.ok(z.hp < 5000, 'the rocket hit');
  assert.equal(room.combat.bomblets.length, 3);
  advance(room, 700);
  assert.equal(room.combat.bomblets.length, 0, 'the bomblets burst');
  assert.ok(!room.hazards.some(h => h.kind === 'acidz'), 'no acid pool (that is the Brood Launcher)');
});
