import test from 'node:test';
import assert from 'node:assert/strict';
import { traceBullet, dirFromAngles } from '../shared/physics.js';
import { pieceBox } from '../shared/build.js';

const eye = [0, 1.6, 10];
const fwd = dirFromAngles(0, 0); // looking down -Z

test('single-target traces behave as before', () => {
  const tr = traceBullet(eye, fwd, 100, [], { x: 0, y: 0, z: 0, yaw: 0, c: 0 }, 2);
  assert.equal(tr.player.part, 'head');
  assert.equal(tr.player.pen, 1);
  assert.equal(tr.player.id, undefined);
  assert.equal(traceBullet(eye, fwd, 100, [], null, 2).player, null);
});

test('multi-target traces hit the nearest target and report its id', () => {
  const far = { id: 7, x: 0, y: 0, z: -5, yaw: 0, c: 0 }, near = { id: 3, x: 0, y: 0, z: 2, yaw: 0, c: 0 };
  assert.equal(traceBullet(eye, fwd, 100, [], [far, near], 2).player.id, 3);
  assert.equal(traceBullet(eye, fwd, 100, [], [far], 2).player.id, 7);
  assert.equal(traceBullet(eye, fwd, 100, [], [], 2).player, null);
});

test('scaled targets are bigger: a 1.7x brute head sits where a normal one has air', () => {
  const high = [0, 2.9, 10];
  assert.equal(traceBullet(high, fwd, 100, [], [{ id: 1, x: 0, y: 0, z: 0, yaw: 0, c: 0 }], 2).player, null);
  assert.equal(traceBullet(high, fwd, 100, [], [{ id: 2, x: 0, y: 0, z: 0, yaw: 0, c: 0, s: 1.7 }], 2).player.part, 'head');
});

test('built wood is shoot-through, stone halves rifle damage, metal stops bullets', () => {
  const tgt = [{ id: 1, x: 0, y: 0, z: -6, yaw: 0, c: 0 }];
  const wall = mat => [pieceBox({ id: 1, kind: 'wall', i: 11, k: 12, l: 0, o: 0, mat })]; // runs along x at z = 0
  const o = [-2, 1.6, 6];
  const pen = mat => traceBullet(o, [0, 0, -1], 100, wall(mat), [{ ...tgt[0], x: -2 }], 2).player?.pen ?? 0;
  assert.ok(pen('wood') > 0.85);
  assert.ok(pen('stone') > 0.4 && pen('stone') < 0.55);
  assert.equal(pen('metal'), 0);
});
