// Boss-drop weapons (shared/weapons.js `boss: true`): Skybreaker (pierce + mark), Brood Launcher (bomblets +
// a zombie-only acid pool), Maw Fang (lifesteal + bite pull) and the Alpha Cleaver (knockdown), plus their
// unique drops from each boss's death.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGun } from '../server/holdout/inventory.js';
import { HoldoutRoom } from '../server/holdout/room.js';

let T = 9_000_000;
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

test('Skybreaker: pierce hits every zombie along the line and marks them; marked zombies take +25% damage', () => {
  const room = started(new HoldoutRoom('SB', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  const gun = makeGun('skybreaker');
  p.inv[1] = gun;
  p.st.p = [0, 0, -3];
  const [z1, z2, z3] = [-8, -14, -20].map(zz => {
    const z = room.spawnZombie('shambler', 'N', ''); z.pos = [0, 0, zz]; z.hp = z.maxHp = 5000; z.hist = []; return z;
  });
  const o = [0, 1.6, -3], d = [0, 0, -1];
  room.handle(p, { t: 'shot', w: 'skybreaker', uid: gun.uid, o, d: [d], e: [], h: [z1, z2, z3].map(z => ({ id: z.id, part: 'chest', pen: 1, k: 0 })) });
  for (const z of [z1, z2, z3]) {
    assert.ok(z.hp < 5000, `zombie at ${z.pos[2]} was pierced`);
    assert.ok(z.markUntil > T, `zombie at ${z.pos[2]} was marked`);
  }
  const before = z1.hp;
  room.damageZombie(z1, 100, p, 'ar');
  assert.equal(before - z1.hp, 125, 'marked zombies take +25% damage from any source');
});

test('Maw Fang: lifesteal heals the shooter', () => {
  const room = started(new HoldoutRoom('MF', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  const gun = makeGun('mawfang');
  p.inv[1] = gun;
  p.hp = 50;
  p.st.p = [0, 0, -3];
  const z = room.spawnZombie('brute', 'N', ''); z.pos = [0, 0, -6]; z.hp = z.maxHp = 5000; z.hist = [];
  const o = [0, 1.6, -3], dir = [0, 0, -1];
  room.handle(p, { t: 'shot', w: 'mawfang', uid: gun.uid, o, d: [dir, dir, dir], e: [], h: [0, 1, 2].map(k => ({ id: z.id, part: 'chest', pen: 1, k })) });
  assert.ok(z.hp < 5000, 'the shot dealt damage');
  assert.ok(p.hp > 50, `lifesteal healed the shooter (hp ${p.hp})`);
});

test('Maw Fang: every 5th shot pulls nearby zombies inward', () => {
  const room = started(new HoldoutRoom('MB', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  const gun = makeGun('mawfang');
  p.inv[1] = gun;
  p.st.p = [0, 0, -3];
  const tgt = room.spawnZombie('shambler', 'N', ''); tgt.pos = [0, 0, -10]; tgt.hp = tgt.maxHp = 5000; tgt.hist = [];
  const near = room.spawnZombie('shambler', 'N', ''); near.pos = [3, 0, -10]; near.hp = near.maxHp = 5000;
  const far = room.spawnZombie('shambler', 'N', ''); far.pos = [12, 0, -10]; far.hp = far.maxHp = 5000;
  const o = [0, 1.6, -3], d = [0, 0, -1];
  for (let i = 0; i < 5; i++) {
    T += 1000;
    room.handle(p, { t: 'shot', w: 'mawfang', uid: gun.uid, o, d: [d], e: [], h: [{ id: tgt.id, part: 'chest', pen: 1, k: 0 }] });
  }
  assert.equal(p.mfShots, 5);
  assert.ok(near.knock, 'a nearby zombie got pulled in');
  assert.ok(near.knock.ux < 0, 'pulled toward the first hit point, not away');
  assert.ok(!far.knock, 'one outside the 6m radius was left alone');
});

test('Alpha Cleaver: hits in a 150° arc, knocks down and stuns everything it hits', () => {
  const room = started(new HoldoutRoom('CL', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  const gun = makeGun('cleaver');
  p.inv[1] = gun;
  p.st.p = [0, 0, -3];
  p.st.y = 0; // facing -z
  const zs = [[-1, -5], [1, -5], [0, -1]].map(([x, zz]) => {
    const q = room.spawnZombie('shambler', 'N', ''); q.pos = [x, 0, zz]; q.hp = q.maxHp = 500; q.hist = []; return q;
  });
  room.handle(p, { t: 'shot', w: 'cleaver', uid: gun.uid, o: [0, 1.6, -3], d: [], e: [], h: zs.map(q => ({ id: q.id, part: 'chest', pen: 1 })) });
  assert.ok(zs[0].hp < 500 && zs[1].hp < 500, 'both in front were cut');
  assert.equal(zs[2].hp, 500, 'the one behind was not');
  assert.ok(zs[0].stunUntil > T && zs[1].stunUntil > T, 'hit zombies are stunned');
  assert.ok(zs[0].knock && zs[1].knock, 'hit zombies are shoved back');
  assert.ok(!zs[2].stunUntil || zs[2].stunUntil <= T, 'the one behind is unaffected');
});

test('Brood Launcher: bomblets scatter and leave a zombie-only acid pool', () => {
  const room = started(new HoldoutRoom('BL', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  p.inv[1] = makeGun('broodlauncher');
  p.st.p = [0, 0, -3];
  const trigger = room.spawnZombie('shambler', 'N', ''); trigger.pos = [0, 0, -10]; trigger.hp = trigger.maxHp = 5000; trigger.frozenUntil = T + 60000;
  room.handle(p, { t: 'rocket', uid: p.inv[1].uid, o: [0, 1.6, -3], d: [0, -0.05, -1] });
  advance(room, 300); // the round arcs in and explodes, scheduling bomblets
  assert.ok(room.combat.bomblets.length > 0, 'bomblets were scheduled');
  advance(room, 700); // ~0.6s after landing, the bomblets burst
  assert.equal(room.combat.bomblets.length, 0, 'every bomblet resolved');
  const pool = room.hazards.find(h => h.kind === 'acidz');
  assert.ok(pool, 'a zombie-only acid pool was left behind');
  assert.equal(pool.dps, 0, 'it does not hurt players');
  assert.equal(pool.sdps, 0, 'it does not hurt builds');
  assert.ok(pool.zdps > 0, 'it hurts zombies');
  const soak = room.spawnZombie('shambler', 'N', ''); soak.pos = [...pool.p]; soak.hp = soak.maxHp = 5000;
  advance(room, 300);
  assert.ok(soak.hp < 5000, 'the pool damages a zombie standing in it');
});

test('boss weapons: each boss drops its unique gun', () => {
  const room = started(new HoldoutRoom('DR', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  const dropped = id => [...room.inventory.pickups.values()].some(pk => pk.item?.id === id && pk.item?.tier === 3 && pk.item?.r === 4 && !pk.item?.el);

  room.sky.spawn(T, 5);
  room.sky.die(p);
  assert.ok(dropped('skybreaker'), 'the Colossus drops the Skybreaker');

  const titanZ = room.spawnZombie('titan', 'N', ''); titanZ.riders = [];
  room.bosses.titan = { phase: 'fighting', z: titanZ, w: 10, nextDrop: T + 1e9 };
  room.killZombie(titanZ, p, 'rocket');
  room.bosses.updateTitan(0.05, T);
  assert.ok(dropped('broodlauncher'), 'the Brood Titan drops the Brood Launcher');

  room.bosses.startMaw(15, T);
  room.bosses.mawDie(p);
  assert.ok(dropped('mawfang'), 'the Maw drops the Maw Fang');

  const alphaZ = room.spawnZombie('alpha', 'N', '');
  room.killZombie(alphaZ, p, 'ar');
  assert.ok(dropped('cleaver'), 'the Alpha Brute drops the Alpha Cleaver');
});
