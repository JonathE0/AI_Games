import test from 'node:test';
import assert from 'node:assert/strict';
import { pieceBox, GRID, RAMP_THICK } from '../shared/build.js';
import { moveCharacter, bottomAt, rayWorld, traceBullet, P } from '../shared/physics.js';

const { level: H, thick: T } = GRID;
// ground-level slab ramp, tile (i=12,k=12) -> x:[0,4] z:[0,4] y:[0,3], rising toward +x (o=0)
const ramp = pieceBox({ id: 1, kind: 'ramp', i: 12, k: 12, l: 0, o: 0, mat: 'wood' });

test('walking sideways under the high part of a slab ramp is not blocked', () => {
  const pos = [3.7, 0, -3], vel = [0, 0, 4];
  let grounded = false;
  for (let i = 0; i < 150; i++) grounded = moveCharacter(pos, vel, 1 / 60, P.standH, [ramp], grounded);
  assert.ok(pos[2] > 6.9, `expected to pass under freely, z=${pos[2]}`);
  assert.equal(pos[1], 0);
});

test('walking under a slab ramp toward the low end stops at the underside, not teleported', () => {
  const pos = [3.7, 0, 2], vel = [-4, 0, 0];
  let grounded = false;
  for (let i = 0; i < 300; i++) grounded = moveCharacter(pos, vel, 1 / 60, P.standH, [ramp], grounded);
  const contactX = P.radius + (P.standH + RAMP_THICK) / ramp.ramp.slope;
  assert.ok(Math.abs(pos[0] - contactX) < 0.3, `expected to stop near x=${contactX}, got ${pos[0]}`);
  assert.equal(vel[0], 0);
});

test('walking up a slab ramp from the low end reaches the top at the high end', () => {
  const pos = [-0.05, 0, 2], vel = [3, 0, 0];
  let grounded = true;
  for (let i = 0; i < 300 && pos[0] < 4; i++) grounded = moveCharacter(pos, vel, 1 / 60, P.standH, [ramp], grounded);
  assert.ok(pos[0] >= 3.9, `expected to reach the high end, x=${pos[0]}`);
  assert.ok(Math.abs(pos[1] - H) < 0.1, `expected to end on top at ~${H}m, y=${pos[1]}`);
  assert.ok(grounded);
});

test('jumping under a slab ramp bumps the head on the underside', () => {
  const x = 3.87, z = 2, dt = 1 / 60;
  const pos = [x, 0, z], vel = [0, P.jumpV, 0];
  let grounded = false;
  for (let i = 0; i < 60 && vel[1] !== 0; i++) {
    vel[1] -= P.gravity * dt;
    grounded = moveCharacter(pos, vel, dt, P.standH, [ramp], grounded);
  }
  const bottom = bottomAt(ramp, pos[0], pos[2]);
  assert.ok(pos[1] + P.standH <= bottom + 1e-3, `feet+height should clear the underside: ${pos[1] + P.standH} vs ${bottom}`);
  assert.equal(vel[1], 0);
  assert.ok(!grounded, 'a head bump should not count as landing');
});

test('rays under a slab ramp pass through; from above they hit the top, and a metal slab stops traceBullet', () => {
  const miss = rayWorld([3.8, 1.0, -2], [0, 0, 1], 10, [ramp]);
  assert.equal(miss, null, 'a ray under the high end should pass through the slab');

  const hit = rayWorld([2, 10, 2], [0, -1, 0], 20, [ramp]);
  assert.ok(hit, 'a downward ray should hit the top surface');
  assert.ok(Math.abs(hit.t - 8.5) < 1e-6, `t=${hit.t}`);

  const metalRamp = pieceBox({ id: 2, kind: 'ramp', i: 12, k: 12, l: 0, o: 0, mat: 'metal' });
  const tr = traceBullet([2, 10, 2], [0, -1, 0], 20, [metalRamp], null, 2);
  assert.equal(tr.player, null);
  assert.ok(tr.endT < 20, `expected the bullet to stop on the metal ramp, endT=${tr.endT}`);
});

test('an elevated (level 1) slab ramp can still be walked under and climbed from a floor', () => {
  const floor = pieceBox({ id: 3, kind: 'floor', i: 11, k: 12, l: 1, mat: 'wood' });
  const elevated = pieceBox({ id: 4, kind: 'ramp', i: 12, k: 12, l: 1, o: 0, mat: 'wood' });
  const boxes = [floor, elevated];

  const under = [1.5, 0, -3], underVel = [0, 0, 4];
  let ug = false;
  for (let i = 0; i < 150; i++) ug = moveCharacter(under, underVel, 1 / 60, P.standH, boxes, ug);
  assert.ok(under[2] > 6.9, `expected to pass under the elevated ramp, z=${under[2]}`);

  const floorTop = H + T;
  const pos = [-2, floorTop, 2], vel = [3, 0, 0];
  let grounded = true;
  for (let i = 0; i < 300 && pos[0] < 4; i++) grounded = moveCharacter(pos, vel, 1 / 60, P.standH, boxes, grounded);
  assert.ok(pos[0] >= 3.9, `expected to reach the high end, x=${pos[0]}`);
  assert.ok(Math.abs(pos[1] - 2 * H) < 0.15, `expected to end on top at ~${2 * H}m, y=${pos[1]}`);
});

test('a wedge (map-style ramp without thick) still blocks underneath like before', () => {
  const wedge = { min: [...ramp.min], max: [...ramp.max], ramp: { axis: ramp.ramp.axis, dir: ramp.ramp.dir, slope: ramp.ramp.slope } };
  const pos = [3.7, 0, -3], vel = [0, 0, 4];
  let grounded = false;
  for (let i = 0; i < 150; i++) grounded = moveCharacter(pos, vel, 1 / 60, P.standH, [wedge], grounded);
  assert.ok(pos[2] < 0.5, `expected the wedge to block passage underneath, z=${pos[2]}`);
});
