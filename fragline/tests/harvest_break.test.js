import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGun } from '../server/holdout/inventory.js';
import { HoldoutRoom } from '../server/holdout/room.js';
import { GRID, REFUND, KNIFE_BREAK } from '../shared/build.js';
import { OUTPOST_PROPS } from '../shared/outpost.js';

let T = 20_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 50) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
const tile = (x, z) => ({ i: (x - GRID.x0) / GRID.cell, k: (z - GRID.z0) / GRID.cell });
function join(room, name) {
  const messages = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const player = room.addPlayer(ws, name);
  return { player, messages, last: t => messages.filter(m => m.t === t).at(-1) };
}
// A room in prep; every named player builds a full-HP Zinkonium wall on the z = -8 line (4 m apart).
function setup(names = ['A']) {
  const room = new HoldoutRoom('HB', {});
  const ps = names.map(n => join(room, n));
  room.startPrep();
  const walls = ps.map(({ player: p }, n) => {
    const x = -4 - 4 * n;
    p.st.p = [x + 2, 0, -6];
    room.handle(p, { t: 'build', kind: 'wall', ...tile(x, -8), l: 0, o: 0, mat: 'zink' });
    return room.builds().find(s => s.owner === p.id);
  });
  advance(room, 4100);
  for (const s of walls) assert.equal(Math.round(s.hp), 750, 'full Zinkonium wall');
  return { room, ps, walls };
}
const knife = (room, p, s) => { T += 300; p.st.w = 'knife'; room.handle(p, { t: 'harvest', sid: s.id }); };
const facing = s => [(s.box.min[0] + s.box.max[0]) / 2, 0, s.box.min[2] - 1.3]; // just outside the wall's -z face
const houseWall = room => room.props.get(OUTPOST_PROPS.find(d => d.box.mat === 'd').id);
const besideProp = b => b.max[2] - b.min[2] > b.max[0] - b.min[0] ? [b.max[0] + 1, 0, (b.min[2] + b.max[2]) / 2] : [(b.min[0] + b.max[0]) / 2, 0, b.max[2] + 1];

test('guns and player explosives never damage props or builds', () => {
  const { room, ps: [a], walls: [s] } = setup();
  const p = a.player, prop = houseWall(room), hp = () => [prop.hp, s.hp, room.pieces.get(prop.id) === prop, room.pieces.get(s.id) === s];
  const before = hp();
  p.inv[1] = makeGun('ar');
  for (const [t, at] of [[prop, besideProp(prop.box)], [s, facing(s)]]) { // bullets lined up on each, with the old prop claim
    p.st.p = at;
    const o = [at[0], 1.6, at[2]], c = [0, 1, 2].map(i => (t.box.min[i] + t.box.max[i]) / 2), d = c.map((v, i) => v - o[i]), l = Math.hypot(...d);
    T += 1000;
    room.handle(p, { t: 'shot', w: 'ar', uid: p.inv[1].uid, o, d: [d.map(v => v / l)], e: [], h: [], pr: [[t.id, 0]] });
  }
  for (const t of [prop, s]) { // grenade, rocket (also rocket turrets), launcher grenade with Brood Launcher bomblets
    const at = [(t.box.min[0] + t.box.max[0]) / 2, 1, t.box.max[2] + 0.2];
    room.combat.detonate({ id: 0, kind: 'grenade', owner: p }, at);
    room.combat.detonate({ id: 0, kind: 'rocket', dmg: 5000, splash: 6, owner: p }, at);
    room.combat.detonate({ id: 0, kind: 'glnade', dmg: 5000, splash: 6, owner: p, bomblets: 3 }, at);
  }
  advance(room, 1500); // bomblets burst
  assert.deepEqual(hp(), before, 'nothing the players fired left a mark');
});

test('zombie blasts still break builds and props (bloater burst, the Maw)', () => {
  const { room, ps: [a], walls: [s] } = setup();
  a.player.st.p = [30, 0, 30];
  const bl = room.spawnZombie('bloater', 'N', '');
  bl.pos = [(s.box.min[0] + s.box.max[0]) / 2, 0, -9];
  room.killZombie(bl, a.player, 'ar');
  assert.ok(s.hp < s.maxHp, 'the bloater burst ate into the wall');
  const prop = houseWall(room), b = prop.box;
  room.bosses.maw = { x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2, stage: 1, dead: false };
  room.bosses.erupt(T);
  assert.ok(prop.hp < prop.maxHp || room.pieces.get(prop.id) !== prop, 'the Maw tore up the prop');
});

test('the knife breaks your own Zinkonium wall in 3 hits and refunds it; props still give materials', () => {
  const { room, ps: [a], walls: [s] } = setup();
  const p = a.player, zink = p.mats.zink;
  s.hp += 1e-9; // float residue from growing must not cost a 4th hit
  p.st.p = facing(s);
  knife(room, p, s);
  assert.equal(Math.round(s.hp), 750 - KNIFE_BREAK);
  knife(room, p, s);
  assert.equal(Math.round(s.hp), 750 - 2 * KNIFE_BREAK);
  assert.equal(p.mats.zink, zink, 'no materials per hit');
  knife(room, p, s);
  assert.equal(room.pieces.get(s.id), undefined, 'the third hit brings it down');
  assert.equal(a.last('sdel').why, 'broken');
  assert.equal(p.mats.zink, zink + REFUND, 'refunded when your own piece falls');
  const prop = houseWall(room);
  p.st.p = besideProp(prop.box);
  knife(room, p, prop);
  assert.equal(prop.hp, prop.maxHp - 60, 'props take the usual beating');
  assert.equal(p.mats.zink, zink + REFUND + 7, 'and still give materials');
});

test("a teammate's piece is theirs to break until they leave the room", () => {
  const { room, ps: [a, b], walls: [, theirs] } = setup(['A', 'B']);
  const p = a.player, zink = p.mats.zink;
  p.st.p = facing(theirs);
  knife(room, p, theirs);
  assert.equal(a.last('deny')?.text, 'Only the builder can break this');
  assert.equal(Math.round(theirs.hp), 750);
  room.removePlayer(b.player);
  for (let i = 0; i < 3; i++) knife(room, p, theirs);
  assert.equal(room.pieces.get(theirs.id), undefined, 'abandoned pieces can be broken by anyone');
  assert.equal(p.mats.zink, zink, "no refund for someone else's piece");
});

test("reach, cooldown and the knife are enforced; 'demolish' is gone", () => {
  const { room, ps: [a], walls: [s] } = setup();
  const p = a.player, zink = p.mats.zink;
  p.st.p = [facing(s)[0], 0, -3.5]; // eye 4.35 m from the wall
  knife(room, p, s);
  assert.equal(Math.round(s.hp), 750, 'out of reach');
  p.st.p = facing(s);
  p.st.w = 'pistol';
  T += 300;
  room.handle(p, { t: 'harvest', sid: s.id });
  assert.equal(Math.round(s.hp), 750, 'needs the knife');
  knife(room, p, s);
  assert.equal(Math.round(s.hp), 750 - KNIFE_BREAK);
  T += 100;
  room.handle(p, { t: 'harvest', sid: s.id });
  assert.equal(Math.round(s.hp), 750 - KNIFE_BREAK, 'one hit per 280 ms');
  room.handle(p, { t: 'demolish', id: s.id });
  assert.equal(room.pieces.get(s.id), s, "'demolish' does nothing");
  assert.equal(p.mats.zink, zink);
});
