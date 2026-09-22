// Cones (Fortnite roofs): slots, support, trap exclusivity, walking over them, integrity, aiming and breaking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldoutRoom } from '../server/holdout/room.js';
import { addItem } from '../server/holdout/inventory.js';
import { GRID, CONE_H, KNIFE_BREAK, checkPlacement, pieceBox, pieceBoxes, slotKey, aimBuildSlot, validMask } from '../shared/build.js';
import { OUTPOST, OUTPOST_BOXES, OUTPOST_NODES } from '../shared/outpost.js';
import { moveCharacter, dirFromAngles } from '../shared/physics.js';

let T = 30_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 50) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
// tile whose north-west corner is at world (x, z); the stretch x 0..4, z 16..28 south of the Core is open ground
const tile = (x, z) => ({ i: (x - GRID.x0) / GRID.cell, k: (z - GRID.z0) / GRID.cell });
const S = (kind, x, z, l, o = 0) => ({ kind, ...tile(x, z), l, o, mat: 'zink' });
const world = (extra = {}) => ({
  slots: new Map(), pieces: [], statics: OUTPOST_BOXES, nodes: OUTPOST_NODES.map(n => n.box), zombies: [],
  eye: null, mats: { zink: 100 }, core: OUTPOST.core, zone: OUTPOST.zone, ...extra,
});
const built = (...list) => world({ slots: new Map(list.map((s, n) => [slotKey(s), n + 1])), pieces: list.map(pieceBox) });

function setup() {
  const room = new HoldoutRoom('CN', {}), msgs = [];
  const p = room.addPlayer({ readyState: 1, send: s => { if (typeof s === 'string') msgs.push(JSON.parse(s)); } }, 'A');
  room.startPrep();
  p.st.p = [2, 0, 29];
  const build = (kind, x, z, l, o = 0) => {
    T += 100;
    room.handle(p, { t: 'build', ...S(kind, x, z, l, o) });
    return room.builds().find(s => slotKey(s) === slotKey(S(kind, x, z, l, o))) ?? null;
  };
  return { room, p, build, deny: () => msgs.filter(m => m.t === 'deny').at(-1)?.text };
}

test('a cone shares its tile and plane with a floor, and up a level it needs support like one', () => {
  const floor = S('floor', 0, 24, 0), cone = S('cone', 0, 24, 0);
  assert.notEqual(slotKey(floor), slotKey(cone));
  assert.equal(checkPlacement(cone, built(floor)), null, 'a cone on a built floor');
  assert.equal(checkPlacement(floor, built(cone)), null, 'a floor under a built cone');
  assert.equal(checkPlacement(cone, built(floor, cone)), 'Already built');
  const up = S('cone', 0, 24, 1);
  assert.equal(checkPlacement(up, world()), 'Needs support');
  assert.equal(checkPlacement(up, built(S('wall', 0, 24, 0))), null, 'resting on a wall below its edge');
  const b = pieceBox(cone);
  assert.deepEqual([b.min[1], b.max[1]].map(v => +v.toFixed(3)), [0.01, +(0.01 + CONE_H).toFixed(3)]);
});

test('floor traps and cones exclude each other; turrets and Rally Fires never block a cone (and keep working under it)', () => {
  const { room, p, build, deny } = setup();
  addItem(p, 'spikes', 2);
  const trapped = build('floor', 0, 24, 0);
  room.handle(p, { t: 'place', item: 'spikes', pid: trapped.id });
  assert.equal(room.defenses.list.size, 1);
  assert.equal(build('cone', 0, 24, 0), null);
  assert.equal(deny(), 'A trap is in the way');
  const coned = build('floor', 0, 20, 0);
  assert.ok(build('cone', 0, 20, 0), 'a cone on a bare floor');
  room.handle(p, { t: 'place', item: 'spikes', pid: coned.id });
  assert.equal(deny(), 'A cone is in the way');
  assert.equal(room.defenses.list.size, 1);

  const r2 = setup(), q = r2.p;
  addItem(q, 'turret', 1); addItem(q, 'campfire', 1);
  q.st.p = [2, 0, 22];
  r2.room.handle(q, { t: 'place', item: 'turret', ...tile(0, 16) });
  r2.room.handle(q, { t: 'place', item: 'campfire', ...tile(4, 16) });
  assert.equal(r2.room.defenses.list.size, 2);
  assert.ok(r2.build('cone', 0, 16, 0), 'right over the turret');
  assert.ok(r2.build('cone', 4, 16, 0), 'right over the Rally Fire');
  r2.room.startWave(1); r2.room.director.queue = [];
  const z = r2.room.spawnZombie('shambler', 'N');
  z.pos = [2, 0, 27.5]; z.hist = []; z.hp = z.maxHp = 5000; z.frozenUntil = T + 60000;
  advance(r2.room, 2000);
  assert.ok(z.hp < 5000 - 100, `the turret still shoots out from under its cone (${5000 - z.hp})`);
});

test('a player walks up and over a ground cone', () => {
  const cone = { id: 1, ...S('cone', 0, 24, 0) }; // x 0..4, z 24..28
  const boxes = [{ min: [-60, -1, -60], max: [60, 0, 60], mat: 'f' }, ...pieceBoxes(cone)];
  const pos = [2, 0, 28.6], vel = [0, 0, -5];
  let grounded = true, top = 0;
  for (let t = 0; t < 2; t += 1 / 128) {
    vel[1] -= 20 / 128; vel[2] = -5;
    grounded = moveCharacter(pos, vel, 1 / 128, 1.8, boxes, grounded);
    top = Math.max(top, pos[1]);
  }
  assert.ok(top >= CONE_H, `climbed to the tip (${top.toFixed(2)})`);
  assert.ok(pos[2] < 20, `came out the far side (z ${pos[2].toFixed(2)})`);
  assert.ok(Math.abs(pos[1]) < 1e-6 && grounded, 'back on the ground');
});

test('integrity: a roof cone stands on its wall and falls when the wall goes', () => {
  const { room, build } = setup();
  const wall = build('wall', 0, 24, 0), cone = build('cone', 0, 24, 1);
  assert.ok(wall && cone);
  room.integrityDirty = true; // re-check while the wall stands: the cone's base plate touches it
  advance(room, 1000);
  assert.equal(room.pieces.get(cone.id), cone, 'held up by the wall');
  room.removePiece(wall, 'broken');
  advance(room, 1000);
  assert.equal(room.pieces.get(cone.id), undefined, 'collapsed');
});

test('aiming a cone: looking up roofs your cell, looking down cones your feet', () => {
  const feet = [2, 0, 26], eye = [2, 1.64, 26], at = (pitch, w, hitT = null) =>
    aimBuildSlot({ kind: 'cone', mat: 'zink', turn: 0, eye, dir: dirFromAngles(0, pitch * Math.PI / 180), hitT, feet }, { ...w, eye });
  assert.deepEqual(at(80, built(S('wall', 0, 24, 0))), { slot: S('cone', 0, 24, 1), reason: null });
  const down = dirFromAngles(0, -70 * Math.PI / 180);
  assert.deepEqual(at(-70, world(), eye[1] / -down[1]), { slot: S('cone', 0, 24, 0), reason: null });
});

test('cone edits: remove 1-3 quarters; what is left still collides only over those quarters', () => {
  assert.ok([1, 6, 14].every(m => validMask('cone', m)) && !validMask('cone', 15));
  const cone = { id: 1, ...S('cone', 0, 24, 0) }, half = pieceBoxes({ ...cone, mask: 0b0101 }); // west column (x 0..2) gone
  assert.ok(half.length && half.every(b => b.min[0] >= 2 && b.sid === 1));
  assert.equal(Math.max(...half.map(b => b.max[1])).toFixed(2), (0.01 + CONE_H).toFixed(2));
});

test('the harvest tool breaks down your own cone in 3 hits and refunds it', () => {
  const { room, p, build } = setup();
  const cone = build('cone', 0, 24, 0);
  advance(room, 4100);
  assert.equal(Math.round(cone.hp), 750);
  const zink = p.mats.zink;
  p.st.w = 'knife';
  for (let i = 0; i < 3; i++) { T += 300; room.handle(p, { t: 'harvest', sid: cone.id }); }
  assert.equal(room.pieces.get(cone.id), undefined, `${KNIFE_BREAK} a hit`);
  assert.ok(p.mats.zink > zink, 'refund');
});
