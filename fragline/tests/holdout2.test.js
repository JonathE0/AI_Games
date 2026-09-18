import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGun, addItem, countOf } from '../server/holdout/inventory.js';
import { HoldoutRoom } from '../server/holdout/room.js';
import { GRID, pieceBoxes, validMask, doorOf } from '../shared/build.js';
import { AMMO, ITEMS, intermissionFor, MONEY_CAP } from '../shared/holdout.js';
import { SKY, skyPoint } from '../shared/skyboss.js';
import { OUTPOST, OUTPOST_SHELTERS } from '../shared/outpost.js';
import { WEAPONS } from '../shared/weapons.js';

let T = 5_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 50) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
const tile = (x, z) => ({ i: (x - GRID.x0) / GRID.cell, k: (z - GRID.z0) / GRID.cell });
function join(room, name = 'P') {
  const messages = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const player = room.addPlayer(ws, name);
  return { player, messages, last: t => messages.filter(m => m.t === t).at(-1) };
}
const started = room => { room.phase = 'prep'; return room; }; // building, looting and traps open once a game is on
const zombieAt = (room, x, z, type = 'shambler') => { const zb = room.spawnZombie(type, 'N'); zb.pos = [x, 0, z]; zb.hist = []; return zb; };

test('edits: doors, windows, floor holes and half ramps change what collides', () => {
  const door = (1 << 1) | (1 << 4); // middle column, bottom two tiles
  assert.deepEqual(doorOf(door), { col: 1, w: 1 });
  assert.equal(doorOf(1 << 4), null);                 // a window is not a door
  assert.equal(validMask('wall', 511), false);        // can't remove everything
  assert.equal(validMask('ramp', 3), false);
  const wall = { id: 1, kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'wood', mask: door };
  const boxes = pieceBoxes(wall);
  assert.equal(boxes.filter(b => b.door).length, 1);
  const d = boxes.find(b => b.door);
  assert.ok(Math.abs(d.min[0] - (-4 + 4 / 3)) < 1e-9 && Math.abs(d.max[1] - 2) < 1e-9);
  const floor = pieceBoxes({ id: 2, kind: 'floor', ...tile(-4, -8), l: 0, mat: 'wood', mask: 1 });
  assert.equal(floor.reduce((a, b) => a + (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]), 0), 12); // 3 of 4 quarters
  const half = pieceBoxes({ id: 3, kind: 'ramp', ...tile(-4, -8), l: 0, o: 0, mat: 'wood', mask: 1 })[0];
  assert.equal(half.max[2] - half.min[2], 2);
  assert.ok(half.ramp);
});

test('server edits: zombies walk through openings but must break doors', () => {
  const room = started(new HoldoutRoom('E', {}));
  const a = join(room, 'A');
  a.player.st.p = [0, 0, -6];
  room.handle(a.player, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'metal' });
  const s = room.builds()[0];
  advance(room, 8000);
  const cellCost = () => { room.flow.update(room.aliveNodeBoxes(), [...room.pieces.values()]); return room.flow.cost[room.flow.idx(-3.5, -7.5)]; };
  assert.ok(cellCost() > 0);
  T += 1000;
  room.handle(a.player, { t: 'edit', id: s.id, mask: 1 | 8 | 64 }); // whole left column gone: an open slot, not a door
  assert.equal(a.last('sedit').mask, 73);
  assert.equal(cellCost(), 0);
  T += 1000;
  room.handle(a.player, { t: 'edit', id: s.id, mask: 1 | 8 }); // left door
  assert.ok(cellCost() > 0);
});

test('backpack: five gun slots, typed ammo bought at the Core, reloads draw from the backpack', () => {
  const room = started(new HoldoutRoom('B', {}));
  const a = join(room, 'A'), p = a.player;
  assert.equal(p.inv[0].id, 'pistol');
  assert.equal(p.inv.length, 24);
  p.money = 20000;
  room.handle(p, { t: 'buy', item: 'ar' });
  assert.equal(p.inv[1].id, 'ar');
  assert.equal(p.inv[1].r, 1);
  const med = p.ammo.medium;
  room.handle(p, { t: 'buy', item: 'a_medium' });
  assert.equal(p.ammo.medium, Math.min(AMMO.medium.cap, med + AMMO.medium.pack));
  room.handle(p, { t: 'reload', uid: p.inv[1].uid, need: 60 });
  assert.equal(a.last('grant').n, Math.min(60, med + AMMO.medium.pack));
  for (const id of ['smg', 'pump', 'h_ssg', 'burst']) room.handle(p, { t: 'buy', item: id });
  assert.ok(p.inv.slice(0, 6).every(Boolean), 'guns fill the hotbar');
  room.handle(p, { t: 'buy', item: 'rocket' });
  assert.equal(p.inv[6].id, 'rocket', 'then the backpack');
  for (let i = 7; i < 24; i++) p.inv[i] = makeGun('pistol');
  room.handle(p, { t: 'buy', item: 'tac_smg', slot: 2 }); // everything full: swaps with the slot in hand, old gun drops
  assert.equal(p.inv[2].id, 'tac_smg');
  const dropped = [...room.inventory.pickups.values()].find(pk => pk.kind === 'it' && pk.item.id === 'smg');
  assert.ok(dropped);
  p.st.p = [...dropped.pos];
  room.handle(p, { t: 'pickup', id: dropped.id, slot: 0 });
  assert.equal(p.inv[0].id, 'smg');
  assert.ok([...room.inventory.pickups.values()].some(pk => pk.item?.id === 'pistol'));
  p.st.p = [30, 0, 30];
  room.handle(p, { t: 'buy', item: 'bandage' });
  assert.match(a.last('deny').text, /ring around the Core/);
});

test('team chest pools money and resources; team powerups can be paid from the bank', () => {
  const room = started(new HoldoutRoom('S', {}));
  const a = join(room, 'A'), b = join(room, 'B');
  for (const q of [a.player, b.player]) q.st.p = [OUTPOST.stash.x - 1.2, 0, OUTPOST.stash.z];
  a.player.money = 5000; b.player.money = 3000;
  room.handle(a.player, { t: 'stash', op: 'put', cat: 'money', n: 3000 });
  room.handle(b.player, { t: 'stash', op: 'put', cat: 'money', n: 2500 });
  room.handle(a.player, { t: 'stash', op: 'put', cat: 'mats', key: 'wood', n: 100 });
  assert.equal(room.inventory.stash.money, 5500);
  assert.equal(b.last('stash').s.mats.wood, 100);
  room.handle(b.player, { t: 'stash', op: 'take', cat: 'mats', key: 'wood', n: 60 });
  assert.equal(b.player.mats.wood, 260);
  room.handle(a.player, { t: 'buy', item: 'p_damage', bank: true });
  assert.ok(room.buffActive('damage'));
  assert.equal(room.inventory.stash.money, 500);
  room.handle(a.player, { t: 'buy', item: 'p_damage' });
  assert.match(a.last('deny').text, /Already active/);
  a.player.st.p = [30, 0, 30];
  room.handle(a.player, { t: 'stash', op: 'take', cat: 'money', n: 100 });
  assert.match(a.last('deny').text, /team chest/);
});

test('only one player at a time can heal the Core', () => {
  const room = started(new HoldoutRoom('H', {}));
  const a = join(room, 'A'), b = join(room, 'B');
  a.player.st.p = [0, 0, -2.4]; b.player.st.p = [0, 0, 2.4];
  room.core.hp = 1000;
  room.handle(a.player, { t: 'coreheal' });
  for (let i = 0; i < 10; i++) { T += 200; room.handle(a.player, { t: 'coreheal' }); room.handle(b.player, { t: 'coreheal' }); }
  assert.match(b.last('deny').text, /already healing/);
  assert.ok(room.core.hp > 1100 && room.core.hp < 1200, String(room.core.hp));
  advance(room, 1000);
  room.phase = 'prep'; // advance() ticks the wave-less room into wave 1; healing is only between waves
  room.handle(b.player, { t: 'coreheal' });
  assert.equal(room.coreHealer, b.player.id);
});

test('the Core can only be repaired between waves', () => {
  const room = new HoldoutRoom('CW', {});
  const a = join(room, 'A'), p = a.player;
  room.phase = 'wave';
  p.st.p = [0, 0, -2.4];
  room.core.hp = 1000;
  const denyCount = () => a.messages.filter(m => m.t === 'deny').length;
  room.handle(p, { t: 'coreheal' });
  assert.equal(room.core.hp, 1000, 'no repair during a wave');
  assert.match(a.last('deny').text, /only be repaired between waves/);
  assert.equal(denyCount(), 1);
  T += 500;
  room.handle(p, { t: 'coreheal' });
  assert.equal(denyCount(), 1, 'denial is throttled to once every 2s');
  T += 2000;
  room.handle(p, { t: 'coreheal' });
  assert.equal(denyCount(), 2);
});

test('grenades, molotovs and freeze grenades hurt only zombies and credit the thrower', () => {
  const room = started(new HoldoutRoom('G', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  room.cannon.next = Infinity; // isolate throwables from the Core's own cannon
  addItem(p, 'grenade', 2); addItem(p, 'freeze', 1); addItem(p, 'molotov', 1);
  p.st.p = [0, 0, -6];
  const z = zombieAt(room, 0, -11);
  z.hp = z.maxHp = 100;
  room.handle(p, { t: 'throw', item: 'grenade', o: [0, 1.6, -6], v: [0, 2, -5] });
  advance(room, 2000);
  assert.ok(z.dead, 'grenade kill');
  assert.equal(p.stats.kills, 1);
  const f = zombieAt(room, 0, -10);
  f.hp = f.maxHp = 5000;
  T += 1000;
  room.handle(p, { t: 'throw', item: 'freeze', o: [0, 1.6, -6], v: [0, 1, -6] });
  advance(room, 900);
  assert.ok(f.frozenUntil > T);
  T += 1000;
  room.handle(p, { t: 'throw', item: 'molotov', o: [0, 1.6, -6], v: [0, 1, -6] });
  const hp0 = f.hp;
  advance(room, 3000);
  assert.ok(f.hp < hp0 - 60, `burned ${hp0 - f.hp}`);
  assert.equal(p.hp, 200);
});

test('traps and turrets defend on their own; campfires heal and recharge shields', () => {
  const room = started(new HoldoutRoom('D', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [0, 0, -6];
  room.handle(p, { t: 'build', kind: 'floor', ...tile(-4, -12), l: 0, mat: 'wood' });
  T += 500;
  room.handle(p, { t: 'build', kind: 'wall', ...tile(4, -12), l: 0, o: 1, mat: 'wood' });
  const [floor, wall] = room.builds();
  addItem(p, 'spikes', 1); addItem(p, 'darts', 1); addItem(p, 'campfire', 1);
  room.handle(p, { t: 'place', item: 'spikes', pid: floor.id });
  room.handle(p, { t: 'place', item: 'darts', pid: wall.id, side: 1 });
  room.handle(p, { t: 'place', item: 'campfire', ...tile(0, -8) });
  assert.equal(room.defenses.list.size, 3);
  room.startWave(1); room.director.queue = [];
  const onSpikes = zombieAt(room, -2, -10), byDarts = zombieAt(room, 5.2, -10);
  for (const z of [onSpikes, byDarts]) { z.hp = z.maxHp = 5000; z.frozenUntil = T + 60000; }
  advance(room, 3000);
  assert.ok(onSpikes.hp < 5000 - 100, 'spikes');
  assert.ok(byDarts.hp < 5000 - 80, 'darts');
  p.hp = 50;
  p.shield = 0;
  p.st.p = [2, 0, -6];
  advance(room, 2000);
  assert.ok(p.hp > 53, 'campfire heal');
  assert.ok(p.shield > 5, 'rally fire recharges shields');

  const r2 = started(new HoldoutRoom('T', {})), q = join(r2, 'Q').player;
  q.st.p = [-6, 0, -3];
  addItem(q, 'turret', 1);
  r2.handle(q, { t: 'place', item: 'turret', ...tile(-8, -8) });
  r2.startWave(1); r2.director.queue = [];
  const far = zombieAt(r2, -6, -20);
  far.hp = far.maxHp = 5000; far.frozenUntil = T + 60000;
  advance(r2, 3000);
  assert.ok(far.hp < 5000 - 150, `turret ${5000 - far.hp}`);
});

test('rescue waves: carry a wounded survivor into the ring and it defends the Core', () => {
  const room = started(new HoldoutRoom('R', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(3); room.director.queue = [];
  assert.equal(room.survivors.list.size, 2);
  const sv = [...room.survivors.list.values()][0];
  assert.ok(OUTPOST_SHELTERS.some(s => Math.hypot(s.x - sv.pos[0], s.z - sv.pos[2]) < 1));
  p.st.p = [sv.pos[0] + 1, 0, sv.pos[2]];
  room.handle(p, { t: 'carry', id: sv.id });
  assert.equal(sv.state, 'carried');
  assert.equal(p.carrying, sv.id);
  p.st.p = [0, 0, -4];
  advance(room, 200);
  assert.equal(sv.state, 'active');
  assert.equal(p.carrying, null);
  const z = zombieAt(room, 0, -14);
  z.hp = z.maxHp = 60; z.frozenUntil = T + 20000;
  advance(room, 6000);
  assert.ok(z.dead, 'the survivor shot the zombie');
  room.survivors.hurt(sv, 100000);
  assert.equal(room.survivors.list.has(sv.id), false);
  assert.ok(a.messages.some(m => m.t === 'svdie'));
});

test('the Colossus: only snipers hurt its weak points, and the wave waits for it', () => {
  const room = started(new HoldoutRoom('C', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(SKY.wave);
  const horde = room.director.queue.length;
  assert.ok(horde > 0 && !room.director.queue.includes('brute'), 'the Colossus brings a lighter horde without Brutes');
  room.director.queue = [];
  assert.ok(room.sky.alive);
  advance(room, 100);
  assert.equal(room.phase, 'wave');
  p.inv[1] = makeGun('h_awp');
  p.inv[2] = makeGun('ar');
  p.st.p = [0, 0, 0];
  const eye = [0, 1.6, 0];
  const aim = i => { const c = skyPoint((T - room.sky.state.t0) / 1000, i), d = c.map((v, j) => v - eye[j]), l = Math.hypot(...d); return d.map(v => v / l); };
  const hp0 = room.sky.state.hp[0];
  room.handle(p, { t: 'shot', w: 'ar', o: eye, d: [aim(0)], e: [], h: [], sky: [[0, 0]] });
  assert.equal(room.sky.state.hp[0], hp0);
  T += 2000;
  room.handle(p, { t: 'shot', w: 'h_awp', o: eye, d: [aim(0)], e: [], h: [], sky: [[0, 0]] });
  assert.ok(room.sky.state.hp[0] < hp0);
  T += 2000;
  room.handle(p, { t: 'shot', w: 'h_awp', o: eye, d: [[1, 0, 0]], e: [], h: [], sky: [[1, 0]] });
  assert.equal(room.sky.state.hp[1], room.sky.state.max, 'a miss does not count');
  for (let i = 0; i < 6; i++) while (room.sky.state.hp[i] > 0) { T += 2000; room.handle(p, { t: 'shot', w: 'h_awp', o: eye, d: [aim(i)], e: [], h: [], sky: [[i, 0]] }); }
  assert.equal(room.sky.alive, false);
  assert.ok([...room.inventory.pickups.values()].some(pk => pk.kind === 'svsupply'));
  advance(room, 200);
  assert.equal(room.phase, 'intermission');
});

test('supply drops fall, land and spill loot; chests too; breaks get longer', () => {
  const room = started(new HoldoutRoom('L', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(2); room.director.queue = [];
  room.zombies.clear();
  room.events.spawnDrop();
  const d = [...room.events.drops.values()][0];
  room.sky.state = { dead: false }; // keep the wave running
  advance(room, 20000, 100);
  assert.ok(d.landed);
  p.st.p = [d.x + 1, d.y, d.z];
  room.handle(p, { t: 'open', kind: 'drop', id: d.id });
  assert.ok(room.inventory.pickups.size >= 5);
  const c = [...room.events.chests.values()][0], n = room.inventory.pickups.size;
  p.st.p = [c.x + 1, 0, c.z];
  room.handle(p, { t: 'open', kind: 'chest', id: c.id });
  assert.ok(room.inventory.pickups.size > n);
  assert.ok(intermissionFor(8) > intermissionFor(2) + 30000);
});

test('money cap is $50,000: kill rewards, assists, wave clears and boss kills all respect it', () => {
  assert.equal(MONEY_CAP, 50000);
  const room = started(new HoldoutRoom('MC', {}));
  const a = join(room, 'A'), p = a.player;
  p.money = MONEY_CAP - 10;
  room.startWave(1); room.director.queue = [];
  const z = room.spawnZombie('alpha', 'N', '');
  room.killZombie(z, p, 'ar');
  assert.equal(p.money, MONEY_CAP, 'a big reward is clamped to the cap, not overflowed past it');
  room.wave = 1;
  room.waveCleared();
  assert.equal(p.money, MONEY_CAP, 'the wave-clear payout is clamped too');
});

test('holdout guns: Fortnite-style roster with double magazines, snipers kept', () => {
  assert.equal(WEAPONS.ar.mag, 60);
  assert.equal(WEAPONS.smg.mag, 60);
  assert.equal(WEAPONS.h_ssg.mag, WEAPONS.ssg08.mag * 2);
  assert.equal(WEAPONS.h_awp.dmg, WEAPONS.awp.dmg);
  assert.equal(ITEMS.medkit.cap, 100);
});
