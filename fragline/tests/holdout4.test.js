// Batch 10: Colossus chest snipers, a faster crawl, the Blacksmith unlocking at wave 7, softer zombie
// damage to walls, a bigger buy ring, an honest (locked-line) Sniper laser, rewards for skipping a break,
// class kit perks + kit-change gating, and the Medic's reworked wave kit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGun, addItem } from '../server/holdout/inventory.js';
import { HoldoutRoom, HOLDOUT } from '../server/holdout/room.js';
import { CLASSES, ITEMS } from '../shared/holdout.js';
import { ZTYPES, dmgMult } from '../shared/zombies.js';
import { GRID } from '../shared/build.js';
import { OUTPOST } from '../shared/outpost.js';

let T = 3_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 50) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
const tile = (x, z) => ({ i: (x - GRID.x0) / GRID.cell, k: (z - GRID.z0) / GRID.cell });
const started = room => { room.phase = 'prep'; return room; };
function join(room, name = 'P') {
  const messages = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const player = room.addPlayer(ws, name);
  return { player, messages, last: t => messages.filter(m => m.t === t).at(-1), all: t => messages.filter(m => m.t === t) };
}

test('sniper zombies: +30% damage over the old nerf, same telegraph, Brood Sniper Riders match', () => {
  assert.deepEqual([ZTYPES.sniper.dmg, ZTYPES.sniper.npcDmg, ZTYPES.sniper.windup], [29, 58, 2.2]);
  assert.deepEqual([ZTYPES.broodsniper.dmg, ZTYPES.broodsniper.npcDmg, ZTYPES.broodsniper.windup], [29, 58, 2.2]);
});

test('a Sniper zombie traces the exact laser it showed: stepping out dodges it, staying in it does not', () => {
  const room = started(new HoldoutRoom('SNL', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(8); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const keep = room.spawnZombie('shambler', 'S', ''); keep.pos = [44, 0, 44]; keep.frozenUntil = T + 1e9; keep.hp = keep.maxHp = 1e6;
  const sn = room.spawnZombie('sniper', 'N', ''); sn.pos = [0, 0, -30]; sn.hist = [];
  p.st.p = [0, 0, -10]; p.hp = p.maxHp; // in the lane, clear of the Core's own collision box at the origin
  advance(room, 50); // one AI tick: it notices p and locks its aim immediately
  const aimMsg = a.last('zaim');
  assert.ok(aimMsg, 'telegraphed the shot');
  p.st.p = [8, 0, -10]; // step out of the shown beam before it fires
  const hpBefore = p.hp;
  advance(room, 2200); // past the (now longer) 2.2s windup
  assert.equal(p.hp, hpBefore, 'dodged by leaving the beam the laser showed');
  const shot = a.last('zshot');
  assert.ok(shot, 'still fires along the locked line');
  assert.deepEqual(shot.b, aimMsg.p, 'the fired line matches the locked telegraph, not the new position');

  // a second target that stays on the line takes the (nerfed) hit
  p.st.p = [200, 0, 200]; // well out of the way so it can't be picked as the closer target
  const sn2 = room.spawnZombie('sniper', 'N', ''); sn2.pos = [0, 0, -30]; sn2.hist = [];
  const q = join(room, 'B').player; q.st.p = [0, 0, -10]; q.hp = q.maxHp;
  advance(room, 50);
  assert.ok(a.all('zaim').length >= 2, 'second telegraph');
  const hpBefore2 = q.hp;
  advance(room, 2200);
  assert.equal(hpBefore2 - q.hp, Math.round(29 * dmgMult(8)), 'stayed on the beam: hit for the buffed base damage');
});

test('Brood Sniper Riders share the same locked-beam logic once dismounted', () => {
  const room = started(new HoldoutRoom('BSN', {}));
  const a = join(room, 'A'), p = a.player;
  const z = room.spawnZombie('broodsniper', 'N', ''); z.pos = [0, 0, -20]; z.mount = null;
  p.st.p = [0, 0, -16]; p.hp = p.maxHp; // close by, clear of the Core and the low cover further down the lane
  room.bosses.stepRiderSniper(z, T);
  assert.equal(z.state, 1, 'aiming');
  const locked = z.target.at.map(v => Math.round(v * 100) / 100);
  p.st.p = [8, 0, -16]; // steps out before it fires
  T += z.t.windup * 1000 + 10;
  room.bosses.stepRiderSniper(z, T);
  assert.equal(p.hp, p.maxHp, 'dodged — the locked line missed the new position');
  assert.deepEqual(a.last('zshot').b, locked, 'the shot still traces the point it aimed at');
});

test('the Blacksmith unlocks once wave 7 clears, no longer tied to the Brood Titan', () => {
  const room = started(new HoldoutRoom('BS7', {}));
  const a = join(room, 'A');
  room.wave = 6; room.waveCleared();
  assert.equal(room.bosses.smith, false, 'not yet — wave 6 just cleared');
  room.wave = 7; room.waveCleared();
  assert.equal(room.bosses.smith, true, 'unlocked once wave 7 clears');
  assert.ok(a.all('task').some(m => /BLACKSMITH/.test(m.text)), 'told the client');
});

test('Colossus chest snipers: one SSG per player in the team chest, one grab each, clears the chest if full', () => {
  const room = started(new HoldoutRoom('CS', {}));
  const a = join(room, 'A'), b = join(room, 'B');
  room.wave = 4; room.waveCleared(); // the break before wave 5 (bossFor(5) === 'sky')
  assert.ok(a.all('task').some(m => /team chest/.test(m.text)), 'banner points at the chest, not "buy at the Core"');
  const items = room.inventory.stash.items;
  assert.equal(items.filter(it => it?.id === 'h_ssg' && it.chestGift).length, 2, 'one SSG per player');

  for (const p of [a.player, b.player]) p.st.p = [OUTPOST.stash.x, 0, OUTPOST.stash.z];
  let slot = items.findIndex(it => it?.chestGift);
  room.handle(a.player, { t: 'move', from: 's' + slot, to: 'i6' });
  assert.equal(a.player.inv[6]?.id, 'h_ssg', 'A takes one');

  slot = items.findIndex(it => it?.chestGift);
  room.handle(a.player, { t: 'move', from: 's' + slot, to: 'i7' });
  assert.equal(a.player.inv[7], null, 'A is denied a second sniper from the chest');
  assert.match(a.last('deny').text, /already grabbed/i);

  room.handle(b.player, { t: 'move', from: 's' + slot, to: 'i6' });
  assert.equal(b.player.inv[6]?.id, 'h_ssg', 'B still gets theirs');

  // a full chest: the two cheapest items are cleared to make room
  const room2 = started(new HoldoutRoom('CS2', {}));
  const c = join(room2, 'C');
  const items2 = room2.inventory.stash.items;
  for (let i = 0; i < items2.length; i++) items2[i] = { uid: -100 - i, id: 'adrenaline', kind: 'adrenaline', n: 1 };
  items2[0] = { uid: -1, id: 'rocket', kind: 'gun', r: 4, tier: 3, el: null };
  room2.wave = 4; room2.waveCleared();
  assert.equal(items2[0]?.id, 'rocket', 'the most valuable item was kept');
  assert.equal(items2.filter(it => it?.chestGift).length, 1, 'one player, one sniper made room for');
  assert.ok(c.all('msg').some(m => /cleared 2 chest items/.test(m.text)), 'says so in the message');
});

test('skipping a break early pays $12 per second saved, capped at $600, nothing under 10s', () => {
  const room = new HoldoutRoom('SK', {});
  const a = join(room, 'A'), b = join(room, 'B');
  room.phase = 'intermission'; room.phaseEnd = T + 60000; // plenty left: hits the cap
  const before = a.player.money;
  room.handle(a.player, { t: 'ready', on: true });
  room.handle(b.player, { t: 'ready', on: true });
  assert.equal(room.phaseEnd, T + HOLDOUT.readySkip, 'break shortens to the ready-skip window');
  assert.equal(a.player.money, before + 600, 'capped at $600');
  assert.match(a.last('msg').text, /Skipped early: \+\$600 each/);

  const room2 = new HoldoutRoom('SK2', {});
  const c = join(room2, 'C');
  room2.phase = 'prep'; room2.phaseEnd = T + HOLDOUT.readySkip + 20000; // 20s actually saved
  room2.handle(c.player, { t: 'ready', on: true });
  assert.equal(c.player.money, HOLDOUT.startMoney + 240, '$12 * 20s');

  const room3 = new HoldoutRoom('SK3', {});
  const e = join(room3, 'E');
  room3.phase = 'intermission'; room3.phaseEnd = T + HOLDOUT.readySkip + 5000; // only 5s saved
  const beforeE = e.player.money;
  room3.handle(e.player, { t: 'ready', on: true });
  assert.equal(e.player.money, beforeE, 'nothing under a 10s save');
});

test('kit changes: free in prep, locked mid-wave and off-cycle, open again every 5th wave-break', () => {
  const room = started(new HoldoutRoom('KC', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [0, 0, 0];
  room.handle(p, { t: 'class', id: 'tank' });
  assert.equal(p.cls, 'tank', 'allowed in prep, before wave 1');

  room.phase = 'wave';
  room.handle(p, { t: 'class', id: 'medic' });
  assert.equal(p.cls, 'tank', 'never mid-wave');
  assert.match(a.last('deny').text, /between waves/i);

  room.phase = 'intermission'; room.wave = 6; // break after wave 6: not a multiple of 5
  room.handle(p, { t: 'class', id: 'medic' });
  assert.equal(p.cls, 'tank', 'locked outside the every-5-wave window');
  assert.match(a.last('deny').text, /wave 10/);

  room.wave = 5; // break after wave 5: open
  room.handle(p, { t: 'class', id: 'medic' });
  assert.equal(p.cls, 'medic');
});

test('kit perks: Tank takes less damage and builds faster, Assault buffs fire rate after a kill, Medic Adrenaline Shots heal harder', () => {
  const room = started(new HoldoutRoom('KIT', {}));
  const a = join(room, 'A'), p = a.player;
  room.phase = 'wave';
  p.cls = 'tank'; p.maxHp = room.maxHpFor(p); p.hp = p.maxHp;
  room.hurtPlayer(p, 100, null);
  assert.equal(p.maxHp - p.hp, Math.round(100 * (1 - CLASSES.tank.dr)), 'Tank takes 15% less damage');

  const wallTank = room.addPiece({ kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'zink' }, p);
  const wallOther = room.addPiece({ kind: 'wall', ...tile(4, -8), l: 0, o: 0, mat: 'zink' }, { id: 'x', cls: null });
  assert.ok(Math.abs(wallTank.rate / wallOther.rate - CLASSES.tank.buildMul) < 1e-9, 'Tank builds 25% faster');

  const q = join(room, 'B').player;
  q.cls = 'assault'; q.inv[1] = makeGun('ar');
  const z = room.spawnZombie('shambler', 'N', '');
  room.killZombie(z, q, 'ar');
  assert.ok(q.assaultBuffUntil > Date.now(), 'a fire-rate window opens after a kill');

  const m = join(room, 'M').player;
  m.cls = 'medic'; m.hp = 50; m.maxHp = 200; m.shield = 0;
  addItem(m, 'adrenaline', 1);
  room.handle(m, { t: 'use', item: 'adrenaline' });
  assert.equal(m.hp, 50 + ITEMS.adrenaline.hp * CLASSES.medic.healMul, 'a Medic\'s shot heals 25% more');
  assert.equal(m.shield, ITEMS.adrenaline.sh * CLASSES.medic.healMul, 'and shields 25% more');
});

test('the buy ring grew to 11.7m and the Banker still sits well inside it', () => {
  assert.equal(OUTPOST.buyRadius, 11.7);
  const bankerDist = Math.hypot(OUTPOST.banker.x - OUTPOST.core.x, OUTPOST.banker.z - OUTPOST.core.z);
  assert.ok(bankerDist < OUTPOST.buyRadius - 1, `Banker at ${bankerDist.toFixed(1)}m, ring at ${OUTPOST.buyRadius}m`);
});
