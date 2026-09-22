// The Gravekeeper (server/holdout/gravekeeper.js), the 'grave' boss slot: grave pits sealed by player cones, the
// spectral ward, lightning arrivals that rise out of the ground over an electrified floor, lids under attack,
// his scythe and phases, his drop (the Knell) and cleanup on death, defeat and a new match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldoutRoom } from '../server/holdout/room.js';
import { GRAVE } from '../server/holdout/gravekeeper.js';
import { makeGun } from '../server/holdout/inventory.js';
import { FLYER_ALT } from '../server/holdout/flyers.js';
import { WEAPONS } from '../shared/weapons.js';
import { bossFor, bossCycle, BOSS_ROTATION, ZTYPES } from '../shared/zombies.js';
import { MAW_BREAK, intermissionFor } from '../shared/holdout.js';
import { checkPlacement } from '../shared/build.js';

let T = 5_000_000;
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
// a Gravekeeper wave with nothing else queued: just him and his graves
function graveWave(n = 1, w = 20) {
  const room = started(new HoldoutRoom('GK', {}));
  const cs = Array.from({ length: n }, (_, i) => join(room, 'P' + i));
  room.startWave(w);
  room.director.queue = [];
  const G = room.bosses.grave;
  return { room, G, z: G.z, a: cs[0], p: cs[0].player };
}
const seal = (room, pit) => { const s = room.addPiece({ kind: 'cone', i: pit.i, k: pit.k, l: 0, o: 0, mat: 'zink' }, null); s.hp = s.maxHp; s.grow = 0; return s; };
const graveMsgs = (a, ev) => a.all('grave').filter(m => m.ev === ev);

test('rotation: wave 20 (and every repeat of its slot) is the Gravekeeper, +50% HP per cycle; the long break still only follows the Maw', () => {
  assert.equal(bossFor(20), 'grave');
  assert.deepEqual([5, 10, 15].map(bossFor), ['sky', 'titan', 'maw']);
  const again = 20 + 5 * BOSS_ROTATION.length;
  assert.equal(bossFor(again), 'grave');
  assert.equal(bossCycle(again), 1);
  assert.equal(graveWave().z.maxHp, ZTYPES.gravekeeper.hp, 'solo, first time around');
  assert.equal(graveWave(2).z.maxHp, Math.round(ZTYPES.gravekeeper.hp * 1.6), 'scaled by the squad like the Maw');
  assert.equal(graveWave(1, again).z.maxHp, Math.round(ZTYPES.gravekeeper.hp * 1.5), 'second time around');
  const room = started(new HoldoutRoom('GR', {}));
  join(room);
  room.wave = 20;
  room.waveCleared();
  assert.equal(room.phaseEnd - Date.now(), intermissionFor(20), 'a normal break after the Gravekeeper');
  room.wave = 15;
  room.waveCleared();
  assert.equal(room.phaseEnd - Date.now(), MAW_BREAK, 'the Maw keeps its long break');
});

test('grave pits: 4 + 1 per extra player, on open buildable ground 12-24 m out, spread around, each sealable with a level-0 cone', () => {
  for (const [n, want] of [[1, 4], [2, 5], [4, 7]]) {
    const { room, G } = graveWave(n);
    assert.equal(G.pits.length, want, `${n} player(s)`);
    const w = { ...room.placementWorld({ st: { p: [0, 0, 0] } }), eye: null, mats: null };
    for (const p of G.pits) {
      const d = Math.hypot(p.x, p.z);
      assert.ok(d >= GRAVE.pitMin && d <= GRAVE.pitMax, `pit ${d.toFixed(1)} m from the Core`);
      assert.equal(checkPlacement({ kind: 'cone', i: p.i, k: p.k, l: 0, mat: 'zink' }, w), null, 'a cone fits on it');
      for (const q of G.pits) if (q !== p) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) >= GRAVE.pitGap, 'pits keep apart');
    }
    const as = G.pits.map(p => Math.atan2(p.z, p.x)).sort((x, y) => x - y);
    const gaps = as.map((x, i) => (i + 1 < as.length ? as[i + 1] : as[0] + 2 * Math.PI) - x);
    assert.ok(Math.max(...gaps) < (4 * Math.PI) / want, 'spread around the Core, no big empty side');
  }
});

test('the spectral ward: immune while any pit is open, cones on every pit drop it, the bell (from behind) takes double', () => {
  const { room, G, z, a, p } = graveWave();
  z.frozenUntil = T + 1e9;
  assert.equal(G.ward, true);
  assert.equal(room.damageZombie(z, 500, p, 'ar'), 0, 'warded');
  room.hitZombie(p, z, WEAPONS.ar, [{ part: 'chest', pen: 1 }], false);
  assert.equal(a.last('dmg').immune, 'ward', 'IMMUNE feedback names the ward');
  const lids = G.pits.slice(0, -1).map(pit => seal(room, pit));
  advance(room, 100);
  assert.equal(G.ward, true, 'one pit still open');
  lids.push(seal(room, G.pits.at(-1)));
  advance(room, 100);
  assert.equal(G.ward, false, 'every pit sealed');
  assert.equal(graveMsgs(a, 'ward').at(-1).on, false);
  assert.equal(room.damageZombie(z, 500, p, 'ar'), 500, 'hits land now');
  z.yaw = 0; // faces -z
  const hit = at => { p.st.p = at; const hp = z.hp; room.hitZombie(p, z, WEAPONS.ar, [{ part: 'chest', pen: 1 }], false); return hp - z.hp; };
  const front = hit([z.pos[0], 0, z.pos[2] - 6]), back = hit([z.pos[0], 0, z.pos[2] + 6]);
  assert.ok(front > 0);
  assert.equal(back, front * GRAVE.bell, 'the bell doubles it');
  // a lid breaks: the ward is back
  room.damagePiece(lids[1], 1e6);
  advance(room, 100);
  assert.equal(G.ward, true);
  assert.equal(graveMsgs(a, 'ward').at(-1).broke, true);
  assert.equal(room.damageZombie(z, 500, p, 'ar'), 0, 'immune again');
  seal(room, G.pits[1]);
  advance(room, 100);
  assert.equal(G.ward, false, 'resealed');
});

test('every spawn arrives by lightning: telegraphed bolt, a slow rise it cannot attack out of, an electrified floor that hurts players only', () => {
  const { room, G, a, p } = graveWave();
  G.z.frozenUntil = T + 1e9;
  const z = room.spawnZombie('shambler', 'N', '');
  assert.ok(z.pos[1] < -1.5, 'waits underground');
  assert.ok(graveMsgs(a, 'bolt').some(m => Math.abs(m.p[0] - z.pos[0]) < 0.01 && Math.abs(m.p[1] - z.pos[2]) < 0.01), 'a telegraphed bolt over the spot');
  const bystander = room.spawnZombie('brute', 'N', ''); // another riser, parked in the patch later
  p.st.p = [z.pos[0] + 1, 0, z.pos[2]];
  const hp0 = p.hp;
  let swungWhileRising = false, midRise = null;
  for (let t = 0; t < GRAVE.warn + GRAVE.rise; t += 50) {
    advance(room, 50);
    if (z.state !== 0) swungWhileRising = true;
    if (t > GRAVE.warn + GRAVE.rise / 2 && midRise === null) midRise = z.pos[1];
  }
  assert.equal(swungWhileRising, false, "can't attack while rising");
  assert.ok(midRise < -0.3 && midRise > -2, `rises slowly (${midRise})`);
  const h = room.hazards.find(x => x.kind === 'volt' && Math.hypot(x.p[0] - z.pos[0], x.p[2] - z.pos[2]) < 0.01);
  assert.ok(h, 'the strike left an electrified patch');
  assert.equal(h.r, GRAVE.voltR);
  assert.ok(h.dps > 0 && !h.zdps && !h.sdps, 'players only');
  assert.ok(p.hp < hp0, 'standing in it hurts');
  bystander.pos = [...h.p]; bystander.rise = null; room.bosses.grave.risers.delete(bystander);
  const bhp = bystander.hp;
  advance(room, 500);
  assert.equal(bystander.hp, bhp, 'zombies standing in it are fine');
  assert.ok(Math.abs(z.pos[1]) < 0.05, 'up on the ground');
  let swung = false;
  for (let t = 0; t < 3000 && !swung; t += 50) { advance(room, 50); swung = z.state !== 0; }
  assert.ok(swung, 'risen, it goes for the player right next to it');
  const flyer = room.spawnZombie('swooper', 'N', '');
  assert.equal(flyer.pos[1], FLYER_ALT, 'flyers still arrive by air');
  assert.ok(!flyer.rise);
});

test('shootable while rising', () => {
  const { room, G, p } = graveWave();
  G.z.frozenUntil = T + 1e9;
  const z = room.spawnZombie('shambler', 'N', '');
  advance(room, GRAVE.warn + 1000);
  assert.ok(z.rise && z.pos[1] < 0);
  assert.ok(room.damageZombie(z, 30, p, 'ar') > 0);
});

test('bell tolls: each open pit raises 2 zombies from it; sealed pits raise none; pit zombies go for the lids', () => {
  const { room, G, a } = graveWave();
  G.z.frozenUntil = T + 1e9;
  const lid = seal(room, G.pits[0]);
  advance(room, 100);
  const before = new Set(room.zombies.keys());
  advance(room, GRAVE.toll);
  assert.ok(graveMsgs(a, 'toll').length >= 1);
  const raised = [...room.zombies.values()].filter(z => !before.has(z.id));
  assert.equal(raised.length, GRAVE.perPit * (G.pits.length - 1));
  for (const z of raised) {
    const at = G.pits.find(p => Math.hypot(p.x - z.rise.x, p.z - z.rise.z) < 1.5);
    assert.ok(at && at !== G.pits[0], 'rises out of an open pit');
  }
  advance(room, GRAVE.warn + GRAVE.rise + 1200);
  const seekers = raised.filter(z => !z.dead && !z.t.ranged && !z.t.noAggro);
  assert.ok(seekers.length > 0);
  for (const z of seekers) assert.equal(z.lid, lid.id, 'after the nearest lid');
});

test('his lantern: every ~15 s it is hurled at the nearest lid for big structure damage', () => {
  const { room, G, a } = graveWave();
  G.z.frozenUntil = T + 1e9;
  const lids = G.pits.map(pit => seal(room, pit));
  advance(room, GRAVE.lantern + 50);
  const throws = graveMsgs(a, 'lantern');
  assert.equal(throws.length, 1);
  const target = lids.reduce((b, s) => (Math.hypot(s.box.min[0] - G.z.pos[0], s.box.min[2] - G.z.pos[2]) < Math.hypot(b.box.min[0] - G.z.pos[0], b.box.min[2] - G.z.pos[2]) ? s : b));
  advance(room, GRAVE.lanternMs + 100);
  assert.equal(target.maxHp - target.hp, GRAVE.lanternSdmg, 'the nearest lid took the lantern');
  assert.ok(lids.filter(s => s !== target).every(s => s.hp === s.maxHp), 'only that one');
});

test('scythe sweep: hits and knocks back players in its arc (never a Tank), not the ones behind; smashes builds in front', () => {
  const { room, G, z, a, p } = graveWave();
  z.pos = [0, 0, -8]; z.yaw = 0; // faces -z
  p.st.p = [0.5, 0, -11];
  const hp0 = p.hp;
  G.sweep(z, { kind: 'p', ref: p });
  assert.ok(p.hp < hp0);
  const kb = graveMsgs(a, 'knock').at(-1);
  assert.ok(kb && kb.v[2] < 0 && kb.v[1] > 0, 'thrown away from him');
  p.cls = 'tank';
  const n = graveMsgs(a, 'knock').length;
  G.sweep(z, { kind: 'p', ref: p });
  assert.equal(graveMsgs(a, 'knock').length, n, 'Tanks stand firm');
  p.cls = null;
  p.st.p = [0, 0, -5];
  const hp1 = p.hp;
  G.sweep(z, { kind: 'c' });
  assert.equal(p.hp, hp1, 'behind him is safe');
});

test('phases: two more pits at 60% (the ward returns), the Death Knell at 30% strikes around every player', () => {
  const { room, G, z, a, p } = graveWave();
  z.frozenUntil = T + 1e9;
  for (const pit of G.pits) seal(room, pit);
  advance(room, 100);
  assert.equal(G.ward, false);
  z.hp = z.maxHp * 0.59;
  advance(room, 100);
  assert.equal(G.state.stage, 2);
  assert.equal(G.pits.length, GRAVE.pits + GRAVE.extraPits);
  assert.equal(G.ward, true, 'the new pits are open');
  for (const pit of G.pits.slice(GRAVE.pits)) seal(room, pit);
  advance(room, 100);
  assert.equal(G.ward, false);
  p.st.p = [3, 0, 3];
  z.hp = z.maxHp * 0.29;
  advance(room, 100);
  assert.equal(G.state.stage, 3);
  assert.ok(graveMsgs(a, 'bolt').some(m => Math.hypot(m.p[0] - 3, m.p[1] - 3) <= GRAVE.knellR + 0.01), 'a bolt by the player');
  advance(room, GRAVE.warn + 100);
  assert.ok(room.hazards.some(h => h.kind === 'volt' && Math.hypot(h.p[0] - 3, h.p[2] - 3) <= GRAVE.knellR + 0.01), 'the same floor hazard');
  advance(room, GRAVE.knell);
  const n = graveMsgs(a, 'bolt').length;
  advance(room, 2000);
  assert.equal(graveMsgs(a, 'bolt').length, n, 'the Knell ends after 10 s');
});

test('his death: cash for everyone, the Knell drops, pits and electrified floor are cleaned up, and the wave can end', () => {
  const { room, G, z, a, p } = graveWave();
  room.spawnZombie('shambler', 'N', '');
  advance(room, GRAVE.warn + 100);
  assert.ok(room.hazards.some(h => h.kind === 'volt'));
  const money = p.money;
  room.killZombie(z, p, 'ar');
  advance(room, 100);
  assert.equal(G.busy(), false);
  assert.equal(G.pits.length, 0);
  assert.ok(!room.hazards.some(h => h.kind === 'volt'), 'the electrified floor goes with him');
  assert.ok(p.money >= money + GRAVE.reward);
  assert.ok([...room.inventory.pickups.values()].some(pk => pk.item?.id === 'knell' && pk.item?.tier === 3 && pk.item?.r === 4 && !pk.item?.el), 'the Knell: Legendary tier III');
  assert.ok(graveMsgs(a, 'die').length === 1);
  const late = room.spawnZombie('shambler', 'N', '');
  assert.equal(late.pos[1], 0, 'no more lightning arrivals');
  for (const q of [...room.zombies.values()]) room.killZombie(q, p, 'ar');
  advance(room, 100);
  assert.equal(room.phase, 'intermission');
});

test('cleanup: a defeat and a new match leave no pits, bolts, risers or electrified floor behind', () => {
  const { room, G, a } = graveWave();
  room.spawnZombie('shambler', 'N', '');
  advance(room, GRAVE.warn + 100);
  room.spawnZombie('runner', 'N', '');
  assert.ok(G.strikes.length && G.risers.size && G.pits.length);
  room.endMatch(false);
  assert.equal(G.busy(), false);
  assert.deepEqual([G.pits.length, G.strikes.length, G.risers.size, G.lanterns.length], [0, 0, 0, 0]);
  assert.ok(room.hazards.every(h => h.kind !== 'volt' || h.until <= T), 'the electrified floor is spent');
  assert.equal(graveMsgs(a, 'end').length, 1);
  const again = graveWave();
  advance(again.room, 200);
  again.room.newMatch();
  assert.equal(again.G.busy(), false);
  assert.equal(again.G.pits.length, 0);
  assert.equal(again.room.hazards.length, 0);
});

test('the Knell: hits chain to 2 nearby zombies, every 4th hit leaves a 2 s shock pool that only hurts zombies', () => {
  const room = started(new HoldoutRoom('KN', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  const gun = p.inv[1] = makeGun('knell');
  p.st.p = [0, 0, -3];
  const mk = (x, zz) => { const z = room.spawnZombie('shambler', 'N', ''); z.pos = [x, 0, zz]; z.hp = z.maxHp = 50000; z.hist = []; z.frozenUntil = T + 1e9; return z; };
  const tgt = mk(0, -10), n1 = mk(2, -10), n2 = mk(-2, -11), far = mk(0, -30);
  const shoot = () => { T += 300; room.handle(p, { t: 'shot', w: 'knell', uid: gun.uid, o: [0, 1.6, -3], d: [[0, 0, -1]], e: [], h: [{ id: tgt.id, part: 'chest', pen: 1, k: 0 }] }); };
  shoot();
  assert.ok(tgt.hp < 50000);
  assert.ok(n1.hp < 50000 && n2.hp < 50000, 'the hit chained to both neighbours');
  assert.equal(far.hp, 50000);
  for (let i = 0; i < 3; i++) shoot();
  const pools = room.hazards.filter(h => h.kind === 'shockz');
  assert.equal(pools.length, 1, 'the 4th hit left a pool');
  const pool = pools[0];
  assert.equal(pool.life ?? (pool.until - T) / 1000, WEAPONS.knell.pool.time);
  assert.ok(pool.zdps > 0 && !pool.dps && !pool.sdps, 'zombies only');
  const inPool = mk(pool.p[0] + 0.5, pool.p[2]), hp = inPool.hp;
  p.st.p = [pool.p[0], 0, pool.p[2]];
  const php = p.hp;
  advance(room, 600);
  assert.ok(inPool.hp < hp, 'a zombie in it gets shocked');
  assert.equal(p.hp, php, 'the player standing in it does not');
});

test('a wipe from his lightning floor or lantern ends the match cleanly (no half-reset state mid-tick)', () => {
  for (const how of ['volt', 'lantern']) {
    const { room, G, p } = graveWave();
    G.z.frozenUntil = T + 1e9;
    if (how === 'volt') {
      const z = room.spawnZombie('shambler', 'N', '');
      p.st.p = [z.pos[0], 0, z.pos[2]];
    } else {
      const lids = G.pits.map(pit => seal(room, pit));
      advance(room, GRAVE.lantern - 200);
      const s = lids.reduce((b, q) => (Math.hypot(q.box.min[0] - G.z.pos[0], q.box.min[2] - G.z.pos[2]) < Math.hypot(b.box.min[0] - G.z.pos[0], b.box.min[2] - G.z.pos[2]) ? q : b));
      p.st.p = [(s.box.min[0] + s.box.max[0]) / 2 + 1, 0, (s.box.min[2] + s.box.max[2]) / 2];
    }
    p.hp = 1;
    advance(room, GRAVE.warn + GRAVE.lanternMs + 800);
    assert.equal(room.phase, 'defeat', `${how}: the squad fell`);
    assert.equal(G.busy(), false);
  }
});
