// Batch 5: reduced/group-scaled zombie damage to builds, the Iron Golem (wall breaker), the Core Seeker,
// the harder Brood Titan (immediate leaps, periodic minions, permanent Sniper Riders) and the Colossus
// back-weak-point reminder. Helpers copied from tests/holdout3.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGun } from '../server/holdout/inventory.js';
import { HoldoutRoom } from '../server/holdout/room.js';
import { updateZombies, ZS } from '../server/holdout/ai.js';
import { FlowField } from '../server/holdout/flowfield.js';
import { GRID } from '../shared/build.js';
import { ZTYPES, CORE_ARMOR } from '../shared/zombies.js';
import { SKY, SKY_POINTS, skyPoint } from '../shared/skyboss.js';

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
  return { player, messages, last: t => messages.filter(m => m.t === t).at(-1), all: t => messages.filter(m => m.t === t) };
}
const started = room => { room.phase = 'prep'; return room; };

test('zombies deal 45% damage to pieces, less still in a group, but the Core takes the full hit', () => {
  const room = started(new HoldoutRoom('Z1', {}));
  const wall = room.addPiece({ kind: 'wall', ...tile(0, -8), l: 0, o: 0, mat: 'metal' }, null);
  wall.hp = 100000;
  const zA = { id: 'a', t: {} }, zB = { id: 'b', t: {} };
  let hp = wall.hp;
  room.damagePiece(wall, 100, zA);
  const solo = hp - wall.hp;
  assert.ok(Math.abs(solo - 45) < 0.01, `one attacker should do 45% damage, did ${solo}`);
  hp = wall.hp;
  room.damagePiece(wall, 100, zB); // a second, distinct attacker within the 1.5s crowding window
  const group = hp - wall.hp;
  assert.ok(Math.abs(group - 100 * 0.45 / 1.45) < 0.01, `two attackers: 45% / (1 + 0.45) ≈ 31%, did ${group}`);
  assert.ok(group < solo, 'a group hit is weaker than a solo hit');
  T += 2000; // outside the 1.5s window: the piece forgets its hitters
  hp = wall.hp;
  room.damagePiece(wall, 100, zA);
  assert.ok(Math.abs((hp - wall.hp) - 45) < 0.01, 'back to solo damage once the old hitters expire');
  const core0 = room.core.hp;
  room.phase = 'wave';
  room.damageCore(100, null);
  assert.ok(Math.abs(core0 - room.core.hp - 100 * CORE_ARMOR) < 0.01, 'the Core only applies its own armor, never the piece reduction');
});

test('Iron Golem: ignores both damage reductions, splashes 40% to nearby pieces, and its flow field paths straight through builds', () => {
  const room = started(new HoldoutRoom('Z2', {}));
  room.startWave(7); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  room.addPiece({ kind: 'wall', ...tile(0, -12), l: 0, o: 0, mat: 'metal' }, null);
  room.addPiece({ kind: 'wall', ...tile(4, -12), l: 0, o: 0, mat: 'metal' }, null);
  const [wallA, wallB] = room.builds();
  wallA.hp = wallA.maxHp = 100000; wallB.hp = wallB.maxHp = 100000;
  const g = room.spawnZombie('golem', 'N', '');
  g.pos = [0, 0, -10];
  g.state = ZS.WIND; g.stateEnd = T - 1; g.target = { kind: 's', ref: wallA };
  const hpA = wallA.hp, hpB = wallB.hp;
  updateZombies(room, 0.05, T);
  const mul = room.director.dmgMul, expected = ZTYPES.golem.sdmg * mul;
  const lossA = hpA - wallA.hp, lossB = hpB - wallB.hp;
  assert.ok(Math.abs(lossA - expected) < 0.01, `the piece it hits takes the full, unreduced sdmg: ${lossA} vs ${expected}`);
  assert.ok(Math.abs(lossB - expected * 0.4) < 1, `a neighbour within 2.5m takes 40% splash, unreduced: ${lossB} vs ${expected * 0.4}`);

  // and a second hit right after (crowding would normally kick in) still does full damage — breakers ignore it
  const g2 = room.spawnZombie('golem', 'N', '');
  g2.state = ZS.WIND; g2.stateEnd = T - 1; g2.target = { kind: 's', ref: wallA };
  const hpA2 = wallA.hp;
  updateZombies(room, 0.05, T);
  assert.ok(Math.abs((hpA2 - wallA.hp) - expected) < 0.01, 'a second breaker hitting the same piece still does full damage');

  // FlowField: piece costs are ignored entirely — it beelines the Core and reports whatever build is in the way
  const bounds = { minX: 0, maxX: 20, minZ: 0, maxZ: 20 }, core = { x: 10, z: 18, half: 1 };
  const flow = new FlowField(bounds, [], core);
  const piece = { id: 1, hp: 3000, boxes: [{ min: [4, 0, 9], max: [16, 2, 10] }] }; // costly wall with open gaps on both sides
  flow.update([], [piece]);
  let x = 10, z = 1, breakerHitWall = false;
  for (let i = 0; i < 25 && !breakerHitWall; i++) {
    const st = flow.bstep(x, z);
    if (!st) break;
    if (st.sid === piece.id || st.here === piece.id) breakerHitWall = true;
    x = st.x; z = st.z;
  }
  assert.ok(breakerHitWall, 'the breaker field walks straight into the wall instead of detouring');
  x = 10; z = 1;
  let normalHitWall = false;
  for (let i = 0; i < 60; i++) {
    const st = flow.step(x, z);
    if (!st) break;
    if (st.sid === piece.id || st.here === piece.id) normalHitWall = true;
    if (st.goal) break;
    x = st.x; z = st.z;
  }
  assert.equal(normalHitWall, false, 'the normal (cost-aware) field detours around the same costly wall');
});

test('Core Seeker: never targets players or survivors, and chips the Core for a fixed 140 per hit', () => {
  const room = started(new HoldoutRoom('Z3', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(5); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const seeker = room.spawnZombie('seeker', 'N', '');
  seeker.pos = [0, 0, -5];
  p.st.p = [0, 0, -5.5]; // right next to it, in plain sight — would normally aggro immediately
  advance(room, 1000);
  assert.equal(seeker.aggro, null, 'never aggros onto a nearby, visible player');
  seeker.state = ZS.WIND; seeker.stateEnd = T - 1; seeker.target = { kind: 'c' };
  const core0 = room.core.hp;
  updateZombies(room, 0.05, T);
  const lost = core0 - room.core.hp;
  assert.ok(Math.abs(lost - 140 * CORE_ARMOR) < 0.01, `a fixed 140 * CORE_ARMOR per hit, lost ${lost}`);
});

test('Brood Titan: two riders leap immediately, it drops fresh minions every ~8s, and its two permanent Sniper Riders stay mounted and immune until it dies', () => {
  const room = started(new HoldoutRoom('Z4', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [40, 0, 40];
  room.startWave(10); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  advance(room, 5400); // 'coming' warning (5s), then it spawns
  const titan = [...room.zombies.values()].find(z => z.type === 'titan');
  assert.ok(titan, 'the Titan arrived');
  const riders = [...room.zombies.values()].filter(z => z.type === 'rider');
  const snipers = [...room.zombies.values()].filter(z => z.type === 'broodsniper');
  assert.equal(snipers.length, 2, 'two permanent Sniper Riders');
  assert.equal(riders.filter(r => !r.mount).length, 2, 'two normal riders leap down the moment it arrives');
  assert.ok(snipers.every(r => room.bosses.immune(r)), 'the Sniper Riders are immune while mounted, like other riders');
  const before = [...room.zombies.values()].filter(z => z.type === 'runner' || z.type === 'stalker').length;
  advance(room, 8200);
  const after = [...room.zombies.values()].filter(z => z.type === 'runner' || z.type === 'stalker').length;
  assert.ok(after >= before + 2, 'drops 2 fresh runners/stalkers off its back every ~8s');
  assert.ok(snipers.every(r => r.mount), 'still mounted after the minion drop — they never dismount on their own');
  room.killZombie(titan, p, 'rocket');
  advance(room, 100);
  assert.ok(snipers.every(r => !r.mount), 'fall off, stunned, once the Titan dies');
  assert.ok(snipers.every(r => !room.bosses.immune(r)), 'and become killable');
});

test("the Colossus: once only a back weak point is left, the squad is told exactly once", () => {
  const room = started(new HoldoutRoom('Z5', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(SKY.wave); room.director.queue = [];
  p.inv[1] = makeGun('h_awp');
  p.st.p = [0, 0, 0];
  const eye = [0, 1.6, 0];
  const aim = i => { const c = skyPoint((T - room.sky.state.t0) / 1000, i), d = c.map((v, j) => v - eye[j]), l = Math.hypot(...d); return d.map(v => v / l); };
  const backIdx = SKY_POINTS.findIndex(pt => pt[2] > 0);
  assert.ok(backIdx >= 0, 'sanity: shared/skyboss.js has a weak point on the back');
  for (let i = 0; i < SKY_POINTS.length; i++) {
    if (i === backIdx) continue;
    while (room.sky.state.hp[i] > 0) { T += 2000; room.handle(p, { t: 'shot', w: 'h_awp', o: eye, d: [aim(i)], e: [], h: [], sky: [[i, 0]] }); }
  }
  assert.equal(a.all('skyback').length, 1, 'fires the moment the back point is the only one left');
  assert.equal(a.last('skyback').i, backIdx);
  assert.ok(a.all('task').some(m => /BACK/.test(m.text)), 'also raises the usual task banner');
  T += 2000;
  room.handle(p, { t: 'shot', w: 'h_awp', o: eye, d: [aim(backIdx)], e: [], h: [], sky: [[backIdx, 0]] });
  assert.equal(a.all('skyback').length, 1, 'never repeats, even after more hits on it');
});
