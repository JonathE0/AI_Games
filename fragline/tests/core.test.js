import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldoutRoom } from '../server/holdout/room.js';
import { CORE_UPS, SURVIVOR_CLASS_IDS } from '../shared/holdout.js';

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

test('the Core mends itself: 1%/s of max during breaks, 0.2%/s in a wave once it has gone 8 s unhit, never past max', () => {
  const room = started(new HoldoutRoom('CR', {}));
  room.phaseEnd = Infinity; // stays in 'prep' so update() doesn't advance into a wave
  join(room, 'A');
  const max = room.core.max, near = (got, want, what) => assert.ok(Math.abs(got - want) <= max * 0.0002, `${what}: +${got}, expected ~${want}`);
  room.core.hp = max * 0.5;
  advance(room, 10000);
  near(room.core.hp - max * 0.5, max * 0.1, 'a break: 10 s at 1%/s');

  room.startWave(1); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const keep = zombieAt(room, 44, 44); keep.frozenUntil = T + 1e9; keep.hp = keep.maxHp = 1e6; // keeps the wave going
  room.core.hp = max * 0.5;
  room.damageCore(10, null);
  const hit = room.core.hp;
  advance(room, 7900);
  assert.equal(room.core.hp, hit, 'nothing within 8 s of a hit');
  advance(room, 5100); // 13 s after it: 5 s of mending
  near(room.core.hp - hit, max * 0.002 * 5, 'a wave: 5 s at 0.2%/s');
  room.damageCore(10, null);
  const hit2 = room.core.hp;
  advance(room, 6000);
  assert.equal(room.core.hp, hit2, 'every hit restarts the 8 s');
  room.core.hp = max - 0.1;
  advance(room, 9000);
  assert.equal(room.core.hp, max, 'never over max');
});

test('survivors: passive regen, rolled a class, retreat from a close threat, drift back inside the leash', () => {
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
  assert.ok(SURVIVOR_CLASS_IDS.includes(sv1.cls), 'rolled one of the survivor classes');
  sv1.cls = sv2.cls = 'ranger'; // pin away from Medic: its passive aura would otherwise heal sv1 too and flake this assertion

  // passive healing, very slow
  room.survivors.hurt(sv1, 60);
  const hurtHp = sv1.hp;
  advance(room, 4000);
  assert.ok(sv1.hp > hurtHp, 'healed a little on its own');
  assert.ok(sv1.hp < hurtHp + 20, 'still very slow');

  // a zombie right on top of it: backs away instead of standing and fighting or running past its target
  const z = zombieAt(room, sv1.pos[0], sv1.pos[2] + 2, 'shambler');
  z.hp = z.maxHp = 1e6;
  sv1.vel = [0, 0, 0];
  const d0 = Math.hypot(sv1.pos[0] - z.pos[0], sv1.pos[2] - z.pos[2]);
  for (let i = 0; i < 20; i++) { T += 50; room.survivors.think(sv1, 0.05, T); }
  const d1 = Math.hypot(sv1.pos[0] - z.pos[0], sv1.pos[2] - z.pos[2]);
  assert.ok(d1 > d0, 'backs away from a threat inside the retreat range');
  const faceZ = Math.atan2(-(z.pos[0] - sv1.pos[0]), -(z.pos[2] - sv1.pos[2]));
  assert.ok(Math.abs(Math.atan2(Math.sin(faceZ - sv1.yaw), Math.cos(faceZ - sv1.yaw))) < 0.2, 'keeps facing the threat while backing off');

  // dragged far outside the leash, it drifts back toward the Core on its own
  sv1.pos[0] = room.map.core.x + 40; sv1.pos[2] = room.map.core.z; sv1.vel = [0, 0, 0]; sv1.hp = sv1.maxHp;
  const before = Math.hypot(sv1.pos[0] - room.map.core.x, sv1.pos[2] - room.map.core.z);
  for (let i = 0; i < 100; i++) { T += 50; room.survivors.think(sv1, 0.05, T); }
  const after = Math.hypot(sv1.pos[0] - room.map.core.x, sv1.pos[2] - room.map.core.z);
  assert.ok(after < before, 'drifted back toward the Core once past the leash');
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
