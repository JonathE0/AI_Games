import test from 'node:test';
import assert from 'node:assert/strict';
import { aimBuildSlot, slotAtPoint, checkPlacement, pieceBox, slotKey, overlaps, GRID } from '../shared/build.js';
import { OUTPOST, OUTPOST_BOXES, OUTPOST_NODES } from '../shared/outpost.js';
import { dirFromAngles } from '../shared/physics.js';

// An open stretch south of the Core: you stand mid-tile at (2, 26) facing -z (yaw 0) toward two clear tiles.
// Walls along x at k = 18 sit on your tile's front edge (z = 24, 2 m ahead), k = 17 one tile further (z = 20).
const FEET = [2, 0, 26], EYE = [2, 1.64, 26], UP50 = dirFromAngles(0, 50 * Math.PI / 180);
const world = (extra = {}) => ({
  slots: new Map(), pieces: [], statics: OUTPOST_BOXES, nodes: OUTPOST_NODES.map(n => n.box), zombies: [],
  eye: EYE, mats: { zink: 100 }, core: OUTPOST.core, zone: OUTPOST.zone, ...extra,
});
const aim = (kind, pitchDeg, { feet = FEET, yaw = 0, hitT = null, turn = 0, w = world(), pending } = {}) => {
  const eye = [feet[0], feet[1] + 1.64, feet[2]];
  return aimBuildSlot({ kind, mat: 'zink', turn, eye, dir: dirFromAngles(yaw, pitchDeg * Math.PI / 180), hitT, feet }, { ...w, eye }, pending);
};
const S = (kind, o, i, k, l) => ({ kind, o, i, k, l, mat: 'zink' });
const wall = (k, l) => S('wall', 0, 12, k, l);
const built = (...list) => world({ slots: new Map(list.map((s, n) => [slotKey(s), n + 1])), pieces: list.map(pieceBox) });
const is = (...list) => s => list.some(x => slotKey(x) === slotKey(s));
const body = f => ({ min: [f[0] - 0.4, f[1], f[2] - 0.4], max: [f[0] + 0.4, f[1] + 1.8, f[2] + 0.4] });

test('build aim: looking up into open air, a floating wall falls back to the ground wall in front of you', () => {
  const open = { min: [-0.5, -0.5, 15.5], max: [4.5, 9, 28.5] };
  assert.ok(![...OUTPOST_BOXES.filter(b => b.mat !== 'f'), ...OUTPOST_NODES.map(n => n.box)].some(b => overlaps(open, b)), 'the test spot is open');
  // mid-tile, in the back half (the ray's ground-wall samples snap to the edge 1 m behind you) and at the
  // front edge (that wall would cut through you)
  for (const [feet, k] of [[FEET, 18], [[2, 0, 27], 18], [[2, 0, 24.3], 17]]) {
    const eye = [feet[0], 1.64, feet[2]], s0 = slotAtPoint('wall', eye.map((v, j) => v + UP50[j] * 4.5), UP50, 0, 0, 'zink');
    assert.equal(s0.l, 1);
    assert.equal(checkPlacement(s0, world({ eye })), 'Needs support');
    const { slot, reason } = aim('wall', 50, { feet });
    assert.deepEqual({ slot, reason }, { slot: wall(k, 0), reason: null });
    assert.ok(feet[2] - (GRID.z0 + slot.k * GRID.cell) >= 0.5, 'in front of you');
    assert.ok(!overlaps(pieceBox(slot), body(feet)), 'not inside you');
  }
});

test('build aim: with a wall under the aimed spot the aimed wall stacks on it (no fallback)', () => {
  assert.deepEqual(aim('wall', 50, { w: built(wall(18, 0)) }), { slot: wall(18, 1), reason: null });
});

test('build aim: aiming at the ground within reach keeps the slot under the crosshair', () => {
  const dir = dirFromAngles(0, -30 * Math.PI / 180), hitT = EYE[1] / -dir[1], t = (EYE[1] - 0.05) / -dir[1];
  const p = EYE.map((v, j) => v + dir[j] * t);
  for (const kind of ['wall', 'floor', 'ramp']) {
    const s = slotAtPoint(kind, p, dir, 0, 0, 'zink');
    assert.equal(checkPlacement(s, world()), null);
    assert.deepEqual(aim(kind, -30, { hitT }), { slot: s, reason: null });
    assert.deepEqual(aim(kind, -30, { hitT, pending: is(s) }), { slot: s, reason: 'Building…' }, 'a pending aimed slot stays put');
  }
});

test('build aim: blocked for any other reason (already built, materials) the ghost stays where you aim', () => {
  const w = built(wall(17, 0));
  assert.deepEqual(aim('wall', 0, { w, hitT: EYE[2] - pieceBox(wall(17, 0)).max[2] }), { slot: wall(17, 0), reason: 'Already built' });
  assert.deepEqual(aim('wall', 50, { w: world({ mats: { zink: 0 } }) }), { slot: wall(18, 1), reason: 'Not enough Zinkonium' });
});

test('build aim: a pending build is skipped for the next placeable slot, else the original red one', () => {
  assert.deepEqual(aim('wall', 20), { slot: wall(18, 0), reason: null });
  assert.deepEqual(aim('wall', 20, { pending: is(wall(18, 0)) }), { slot: wall(17, 0), reason: null });
  assert.deepEqual(aim('wall', 20, { pending: is(wall(18, 0), wall(17, 0)) }), { slot: wall(17, 1), reason: 'Needs support' });
});

test('build aim: ramps and floors fall back to the ground piece in front of you too', () => {
  for (const kind of ['ramp', 'floor']) {
    const s0 = slotAtPoint(kind, EYE.map((v, j) => v + UP50[j] * 4.5), UP50, 0, 0, 'zink');
    assert.equal(checkPlacement(s0, world()), 'Needs support');
  }
  assert.deepEqual(aim('ramp', 50), { slot: S('ramp', 3, 12, 17, 0), reason: null });
  assert.deepEqual(aim('ramp', 50, { turn: 1 }), { slot: S('ramp', 0, 12, 17, 0), reason: null });
  assert.deepEqual(aim('floor', 50), { slot: S('floor', 0, 12, 17, 0), reason: null });
});

test('build aim: nothing placeable along the aim keeps the original slot and its reason', () => {
  // at the map's east edge, far outside the build zone, looking up and out: the aimed wall is off the grid
  assert.deepEqual(aim('wall', 30, { feet: [47, 0, 1], yaw: -Math.PI / 2 }), { slot: S('wall', 1, 25, 12, 1), reason: 'Out of bounds' });
  assert.deepEqual(aim('wall', 50, { feet: [2, 0, 40] }), { slot: wall(21, 1), reason: 'Outside the build zone' });
});

test('build aim: slotAtPoint keeps the old grid snapping', () => {
  const N = [0, 0, -1], E = [1, 0, 0], W = [-1, 0, 0];
  // walls: the nearest tile edge across your view; the level flips 0.25 m below the level line
  assert.deepEqual(slotAtPoint('wall', [2, 1, 23.1], N, 0, 0, 'zink'), S('wall', 0, 12, 18, 0));
  assert.deepEqual(slotAtPoint('wall', [5.1, 2.8, -9], E, 0, 0, 'zink'), S('wall', 1, 13, 9, 1));
  assert.deepEqual(slotAtPoint('wall', [5.1, 2.7, -9], E, 0, 0, 'zink'), S('wall', 1, 13, 9, 0));
  // floors: the aimed tile, at most one level above your feet
  assert.deepEqual(slotAtPoint('floor', [2, 4.4, 23.1], N, 0, 0, 'zink'), S('floor', 0, 12, 17, 1));
  assert.deepEqual(slotAtPoint('floor', [2, 7.9, 23.1], N, 0, 0, 'zink'), S('floor', 0, 12, 17, 1));
  assert.deepEqual(slotAtPoint('floor', [2, 7.9, 23.1], N, 3.01, 0, 'zink'), S('floor', 0, 12, 17, 2));
  // ramps rise away from you (R adds quarter turns) and go up a level once you aim above the next level line
  assert.deepEqual(slotAtPoint('ramp', [2, 2.9, 23.1], N, 0, 0, 'zink'), S('ramp', 3, 12, 17, 0));
  assert.deepEqual(slotAtPoint('ramp', [2, 3.2, 23.1], N, 0, 1, 'zink'), S('ramp', 0, 12, 17, 1));
  assert.deepEqual(slotAtPoint('ramp', [2, 3.2, 23.1], W, 0, 1, 'zink'), S('ramp', 3, 12, 17, 1));
  assert.deepEqual(slotAtPoint('ramp', [2, 3.2, 23.1], E, 0, 2, 'zink'), S('ramp', 1, 12, 17, 1));
});
