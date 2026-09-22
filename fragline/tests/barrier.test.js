// The Tank's barrier (server/holdout/barrier.js): right-click raises a wall of energy 1.2 m in front that soaks
// zombie swings, globs and sniper shots coming from the front, regrows when lowered, and blocks your own firing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGun } from '../server/holdout/inventory.js';
import { HoldoutRoom } from '../server/holdout/room.js';
import { barrierCross } from '../server/holdout/barrier.js';
import { BARRIER, canBarrier } from '../shared/holdout.js';
import { ZTYPES } from '../shared/zombies.js';

let T = 21_000_000;
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
// A wave with nothing in it but one frozen zombie far off (keeps the wave from clearing), and a Tank holding an AR at
// (0, 0, -10) facing -z: its barrier stands across z = -11.2, from x -2 to 2 and 0 to 2.6 m up.
function setup(code, wave = 1) {
  const room = new HoldoutRoom(code, {});
  const a = join(room, 'A'), p = a.player;
  room.startWave(wave); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const keep = room.spawnZombie('shambler', 'S', ''); keep.pos = [44, 0, 44]; keep.frozenUntil = T + 1e9; keep.hp = keep.maxHp = 1e6;
  room.cannon.next = Infinity;
  p.cls = 'tank'; p.maxHp = p.hp = 300;
  p.inv[1] = makeGun('ar');
  p.st = { ...p.st, p: [0, 0, -10], y: 0, w: 'ar' };
  return { room, a, p };
}
const zombieAt = (room, x, z, type = 'shambler') => { const zb = room.spawnZombie(type, 'N', ''); zb.pos = [x, 0, z]; zb.hist = []; zb.aggroBlock = T + 1e9; return zb; };
const swing = (room, z, p) => { z.state = 1; z.stateEnd = T; z.target = { kind: 'p', ref: p }; advance(room, 50); }; // the windup is over: it strikes

test('only a Tank raises it, only with a gun that is not a sniper (snipers keep their scope); it follows the aim', () => {
  assert.deepEqual(['ar', 'pistol', 'pump', 'rocket', 'minigun'].map(canBarrier), [true, true, true, true, true]);
  assert.deepEqual(['h_ssg', 'h_awp', 'skybreaker', 'knife', 'blade', 'hold_item'].map(canBarrier), [false, false, false, false, false, false]);
  const { room, a, p } = setup('B1');
  room.handle(p, { t: 'bar', on: true });
  assert.equal(p.bar.up, true, 'up');
  assert.deepEqual(a.last('bar'), { t: 'bar', id: p.id, up: 1, hp: BARRIER.hp, cd: 0 }, 'everyone is told');
  room.handle(p, { t: 'bar', on: false });
  assert.equal(p.bar.up, false);

  p.inv[2] = makeGun('h_awp'); p.st.w = 'h_awp';
  room.handle(p, { t: 'bar', on: true });
  assert.equal(p.bar.up, false, 'not with a sniper in hand');
  p.st.w = 'ar'; p.cls = 'assault';
  room.handle(p, { t: 'bar', on: true });
  assert.equal(p.bar.up, false, 'not for other classes');
  p.cls = 'tank';
  room.handle(p, { t: 'bar', on: true });
  p.st.w = 'h_awp';
  advance(room, 50);
  assert.equal(p.bar.up, false, 'switching to the sniper drops it');

  // geometry: 1.2 m ahead along the aim, 4 m wide, 2.6 m tall, only from the front
  p.st.y = Math.PI / 2; // facing -x now: the wall stands across x = -1.2
  assert.ok(barrierCross(p, [-3, 1, -10], [0, 1, -10]) > 0, 'from the front');
  assert.equal(barrierCross(p, [0, 1, -10], [-3, 1, -10]), -1, 'not from behind');
  assert.equal(barrierCross(p, [-3, 1, -7.9], [0, 1, -7.9]), -1, 'past its edge (2 m either side)');
  assert.equal(barrierCross(p, [-3, 2.8, -10], [0, 2.8, -10]), -1, 'over its top (2.6 m)');
  assert.equal(barrierCross(p, [-3, 1, -10], [-2, 1, -10]), -1, 'stops short of it');
});

test('swings from zombies in front hit the barrier for their full damage; one behind the Tank still lands', () => {
  const { room, p } = setup('B2');
  const q = join(room, 'B').player; q.maxHp = q.hp = 200; q.st.p = [0.8, 0, -10.2]; // a teammate sheltering behind it
  room.handle(p, { t: 'bar', on: true });
  const front = zombieAt(room, 0, -11.6), dmg = ZTYPES.shambler.dmg * room.director.dmgMul;
  swing(room, front, p);
  assert.equal(p.hp, 300, 'the Tank is untouched');
  assert.ok(Math.abs(p.bar.hp - (BARRIER.hp - dmg)) < 1e-9, `the barrier took ${BARRIER.hp - p.bar.hp}`);
  swing(room, front, q);
  assert.equal(q.hp, 200, 'so is anyone behind it');
  assert.ok(Math.abs(p.bar.hp - (BARRIER.hp - 2 * dmg)) < 1e-9, 'that swing hit the barrier too');

  const behind = zombieAt(room, 0, -8.7);
  swing(room, behind, p);
  assert.ok(p.hp < 300, 'hit from behind');
  assert.ok(Math.abs(p.bar.hp - (BARRIER.hp - 2 * dmg)) < 1e-9, 'the barrier took nothing from that one');

  room.handle(p, { t: 'bar', on: false });
  const hp = p.hp;
  swing(room, front, p);
  assert.ok(p.hp < hp, 'lowered, it protects nothing');
});

test('acid globs and sniper shots from the front splash on the barrier; a glob from behind still hits', () => {
  const { room, a, p } = setup('B3', 8);
  room.handle(p, { t: 'bar', on: true });
  const glob = { id: 0, pos: [0, 0, -16], t: { dmg: 20, sdmg: 0, splash: 2 } };
  room.addProjectile([0, 1.5, -16], [0, 3.34, 8.57], glob, 'acid'); // lobbed at the Tank from 6 m in front
  advance(room, 1000);
  assert.equal(p.hp, 300);
  assert.ok(Math.abs(p.bar.hp - (BARRIER.hp - 20 * room.director.dmgMul)) < 1e-9, 'the glob hit the barrier');
  const splat = a.last('splat');
  assert.ok(Math.abs(splat.p[2] + 11.2) < 0.05, `it splashed at the barrier (z ${splat.p[2]})`);

  room.addProjectile([0, 1.5, -4], [0, 3.34, -8.57], { ...glob, pos: [0, 0, -4] }, 'acid'); // from behind
  advance(room, 1000);
  assert.ok(p.hp < 300, 'from behind it passes through');

  const before = p.bar.hp, hp = p.hp, sn = room.spawnZombie('sniper', 'N', ''); sn.pos = [0, 0, -30]; sn.hist = [];
  advance(room, 50); // it locks its aim on the Tank
  assert.ok(a.last('zaim'), 'telegraphed');
  advance(room, ZTYPES.sniper.windup * 1000 + 100);
  const shot = a.last('zshot');
  assert.ok(shot && Math.abs(shot.b[2] + 11.2) < 0.05, 'the tracer stops at the barrier');
  assert.equal(p.hp, hp, 'the Tank behind it is untouched');
  assert.ok(Math.abs(before - p.bar.hp - ZTYPES.sniper.dmg * room.director.dmgMul) < 1e-9, 'the barrier took the shot');
});

test('lowered it regrows 150 HP/s after 2 s; broken it stays down for 4 s, then regrows from nothing', () => {
  const { room, a, p } = setup('B4');
  room.handle(p, { t: 'bar', on: true });
  room.barriers.damage(p, 500);
  advance(room, 150);
  assert.equal(a.last('bar').hp, BARRIER.hp - 500, 'the new HP (cracks) goes out to everyone');
  room.handle(p, { t: 'bar', on: false });
  advance(room, 1950);
  assert.equal(p.bar.hp, BARRIER.hp - 500, 'nothing for 2 s');
  advance(room, 1000);
  assert.ok(Math.abs(p.bar.hp - (BARRIER.hp - 500 + BARRIER.regen)) <= BARRIER.regen * 0.06, `+150/s: ${p.bar.hp}`);
  room.handle(p, { t: 'bar', on: true });
  advance(room, 1000);
  assert.ok(p.bar.hp < BARRIER.hp - 300, 'no regrowth while it is up');

  room.barriers.damage(p, 5000);
  const broke = a.last('bar');
  assert.deepEqual([p.bar.up, p.bar.hp, broke.up, broke.broke, broke.cd], [false, 0, 0, 1, BARRIER.cooldown], 'broken: down, empty, 4 s cooldown');
  advance(room, 3900);
  room.handle(p, { t: 'bar', on: true });
  assert.equal(p.bar.up, false, 'can\'t raise it during the cooldown');
  assert.deepEqual([a.last('bar').up, a.last('bar').no], [0, 1], 'the refusal corrects the client');
  assert.equal(p.bar.hp, 0, 'and it has not started regrowing');
  advance(room, 1100);
  assert.ok(p.bar.hp > 0 && p.bar.hp <= BARRIER.regen * 1.06, `regrowing from 0 for 1 s: ${p.bar.hp}`);
  room.handle(p, { t: 'bar', on: true });
  assert.equal(p.bar.up, true, 'back up once the cooldown is over');
});

test('no firing while it is up (rockets included); lowering it frees the trigger; a new match forgets it', () => {
  const { room, p } = setup('B5');
  const b = join(room, 'B');
  const gun = p.inv[1], z = zombieAt(room, 0, -14);
  z.hp = z.maxHp = 5000; z.frozenUntil = T + 1e9;
  const shot = () => room.handle(p, { t: 'shot', w: 'ar', uid: gun.uid, o: [0, 1.6, -10], d: [[0, -0.02, -1]], e: [[0, 1.5, -14]], h: [{ id: z.id, part: 'chest', pen: 1, k: 0 }] });
  room.handle(p, { t: 'bar', on: true });
  shot();
  assert.equal(z.hp, 5000, 'the shot was refused');
  assert.equal(b.all('shot').length, 0, 'and never relayed');
  p.inv[2] = makeGun('rocket'); p.ammo.rockets = 5;
  room.handle(p, { t: 'rocket', uid: p.inv[2].uid, o: [0, 1.6, -10], d: [0, 0, -1] });
  assert.equal(room.combat.flying.length, 0, 'no rocket either');
  room.handle(p, { t: 'bar', on: false });
  shot();
  assert.ok(z.hp < 5000, 'lowered: it fires again');

  room.handle(p, { t: 'bar', on: true });
  room.barriers.damage(p, 300);
  room.newMatch();
  assert.equal(p.bar, null, 'a fresh match: no barrier, full HP next time');
});
