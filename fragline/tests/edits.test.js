import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID, WALL_EDITS, validMask, doorOf, pieceBoxes, rampEdit } from '../shared/build.js';
import { blocked, P } from '../shared/physics.js';
import { HoldoutRoom } from '../server/holdout/room.js';

let T = 7_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });

// wall tiles by name: bottom BL BM BR, middle ML MC MR, top TL TM TR
const NAMES = ['BL', 'BM', 'BR', 'ML', 'MC', 'MR', 'TL', 'TM', 'TR'];
const m = s => s.split(' ').reduce((a, t) => a | (1 << NAMES.indexOf(t)), 0);
const tile = (x, z) => ({ i: (x - GRID.x0) / GRID.cell, k: (z - GRID.z0) / GRID.cell });
const wall = mask => ({ id: 1, kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'zink', mask }); // x -4..0 along z = -8
const X = u => -4 + (u * GRID.cell) / 3; // u, v in tiles from the wall's low end / bottom
const solid = (mask, u, v) => pieceBoxes(wall(mask)).some(b => !b.door && X(u) > b.min[0] && X(u) < b.max[0] && v > b.min[1] && v < b.max[1]);
const standing = (mask, u) => !blocked(X(u), 0, -8, P.standH, pieceBoxes(wall(mask)).filter(b => !b.door));

const TEMPLATES = ['ML', 'MC', 'MR', 'ML MR', 'ML BL', 'MC BM', 'MR BR', 'ML BL MR', 'MR BR ML', 'MC BL BM BR', 'ML MC BL BM', 'MC MR BM BR',
  'TL TM ML', 'TM TR MR', 'ML BL BM', 'MR BM BR', 'TL TM TR', 'TL TM TR ML MC MR', 'TL TM TR ML BL', 'TL TM TR MC BM', 'TL TM TR MR BR'];

test('wall edits: only the Fortnite templates are valid', () => {
  for (const t of TEMPLATES) assert.ok(validMask('wall', m(t)), t);
  assert.equal(WALL_EDITS.size, TEMPLATES.length);
  assert.ok(validMask('wall', 0), 'a reset');
  for (const t of ['TM', 'TL', 'BM', 'BL BR', 'TL MC BR', 'TL BM MR', 'ML TL BL', 'ML MC MR', 'BL BM BR', 'ML MC MR BL BM BR TL TM TR'])
    assert.equal(validMask('wall', m(t)), false, t);
  for (const bad of [-1, 1.5, 512, '9']) assert.equal(validMask('wall', bad), false);
  // the old 2-wide doors are half arches now: open, no door
  for (const t of ['ML MC BL BM', 'MC MR BM BR']) { assert.equal(doorOf(m(t)), null); assert.equal(WALL_EDITS.get(m(t)).name, 'half arch'); }
  // floors keep "any 1-3 quarters", stairs one half
  for (let q = 1; q < 15; q++) assert.ok(validMask('floor', q));
  assert.equal(validMask('floor', 15), false);
  assert.equal(validMask('ramp', 3), false);
});

test('wall edits: door templates have exactly one door box, nothing else does', () => {
  for (const t of TEMPLATES) {
    const doors = pieceBoxes(wall(m(t))).filter(b => b.door), d = doorOf(m(t));
    assert.equal(doors.length, d ? 1 : 0, t);
    if (d) assert.ok(Math.abs(doors[0].max[0] - doors[0].min[0] - GRID.cell / 3) < 1e-9 && Math.abs(doors[0].max[1] - 2) < 1e-9, t);
  }
  assert.ok(standing(m('MC BM'), 1.5), 'a standing player fits through the door gap');
});

test('wall edits: the left 2 × 2 is a half arch — open, two tiles tall on the outside, round toward the middle', () => {
  const mask = m('ML MC BL BM');
  assert.equal(pieceBoxes(wall(mask)).filter(b => b.door).length, 0);
  assert.ok(!solid(mask, 0.3, 1.95) && !solid(mask, 1, 0.5) && !solid(mask, 1.9, 0.5), 'open');
  assert.ok(solid(mask, 0.3, 2.05) && solid(mask, 2.5, 1.2), 'top row and the right column stay');
  assert.ok(solid(mask, 1.9, 1.9), 'the inner top corner is rounded off');
  assert.ok(standing(mask, 0.45), 'a standing player fits through the outer part');
  const right = m('MC MR BM BR');
  assert.ok(!solid(right, 2.7, 1.95) && solid(right, 1.1, 1.9) && solid(right, 0.5, 1.2));
});

test('wall edits: the arch is open through the middle for a standing player', () => {
  const mask = m('MC BL BM BR');
  assert.equal(pieceBoxes(wall(mask)).filter(b => b.door).length, 0);
  assert.ok(standing(mask, 1.5));
  assert.ok(!standing(mask, 0.3), 'too low near the sides');
  assert.ok(!solid(mask, 1.5, 1.9) && solid(mask, 1.5, 2.1) && solid(mask, 0.05, 1.5));
  assert.ok(pieceBoxes(wall(mask)).some(b => b.min[1] <= 0.05), 'still stands on the ground');
});

test('wall edits: triangles block their kept half only', () => {
  // [kept points, removed points] in tiles; the cut runs corner to corner
  const cases = {
    'TL TM ML': [[[2.4, 0.6], [1.8, 1.2]], [[0.6, 2.4], [1.2, 1.8]]],
    'TM TR MR': [[[0.6, 0.6], [1.2, 1.2]], [[2.4, 2.4], [1.8, 1.8]]],
    'ML BL BM': [[[2.4, 2.4], [1.8, 1.8]], [[0.6, 0.6], [1.2, 1.2]]],
    'MR BM BR': [[[0.6, 2.4], [1.2, 1.8]], [[2.4, 0.6], [1.8, 1.2]]],
  };
  for (const [t, [kept, gone]] of Object.entries(cases)) {
    for (const [u, v] of kept) assert.ok(solid(m(t), u, v), `${t} keeps ${u},${v}`);
    for (const [u, v] of gone) assert.ok(!solid(m(t), u, v), `${t} drops ${u},${v}`);
    assert.ok(pieceBoxes(wall(m(t))).some(b => b.min[1] <= 0.05), `${t} still stands on the ground`);
  }
});

test('stair edits: a drag over all four tiles turns it, two side by side make a half stair', () => {
  assert.deepEqual(rampEdit([0, 2, 3, 1]), { o: 0, mask: 0 }); // up the -x column, over to +x: rises toward +x
  assert.deepEqual(rampEdit([3, 1, 0, 2]), { o: 1, mask: 0 });
  assert.deepEqual(rampEdit([0, 1, 3, 2]), { o: 2, mask: 0 });
  assert.deepEqual(rampEdit([2, 3, 0, 1]), { o: 3, mask: 0 });
  assert.deepEqual(rampEdit([0, 1]), { o: 0, mask: 2 }); // low-z row, rising toward +x: the high-z half goes
  assert.deepEqual(rampEdit([3, 1]), { o: 3, mask: 1 }); // high-x column, rising toward -z: the low-x half goes
  for (const bad of [[0], [0, 3], [1, 2], [0, 1, 3], [0, 3, 1, 2], [0, 0], [0, 5], ['0', '1'], null, 'x']) assert.equal(rampEdit(bad), null, JSON.stringify(bad));
  const half = pieceBoxes({ id: 2, kind: 'ramp', ...tile(-4, -8), l: 0, o: 3, mat: 'zink', mask: 1 })[0];
  assert.ok(half.min[0] === -2 && half.max[0] === 0 && half.ramp.axis === 2 && half.ramp.dir === -1, 'the half left is on the dragged tiles');
});

test('server edits: templates and stair drags go through, anything else is refused', () => {
  const room = new HoldoutRoom('ED', {});
  room.phase = 'prep';
  const messages = [], ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const p = room.addPlayer(ws, 'A'), edits = () => messages.filter(x => x.t === 'sedit');
  p.st.p = [2, 0, -10];
  p.mats.zink = 100;
  room.handle(p, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'zink' });
  T += 500;
  room.handle(p, { t: 'build', kind: 'ramp', ...tile(-4, -12), l: 0, o: 0, mat: 'zink' });
  const [w, r] = room.builds();
  assert.ok(w && r && r.kind === 'ramp');
  const send = msg => { T += 1000; room.handle(p, { t: 'edit', ...msg }); };
  send({ id: w.id, mask: m('TM') });
  send({ id: w.id, mask: m('ML MC MR') });
  assert.equal(edits().length, 0, 'non-templates are refused');
  send({ id: w.id, mask: m('ML MC BL BM') });
  assert.equal(w.mask, m('ML MC BL BM'));
  assert.ok(!w.boxes.some(b => b.door));
  send({ id: r.id, path: [0, 3] });
  send({ id: r.id, path: [0, 1, 3] });
  send({ id: r.id, path: 'oops' });
  assert.equal(edits().length, 1, 'invalid stair drags are refused');
  send({ id: r.id, path: [0, 1, 3, 2] });
  assert.deepEqual([r.o, r.mask, r.box.ramp.axis, r.box.ramp.dir], [2, 0, 2, 1]);
  assert.deepEqual(edits().at(-1), { t: 'sedit', id: r.id, mask: 0, o: 2 });
  send({ id: r.id, path: [3, 1] });
  assert.deepEqual([r.o, r.mask], [3, 1]);
  assert.equal(r.boxes[0].min[0], -2);
  send({ id: r.id, mask: 0 }); // right-click reset: the full stair, still facing the new way
  assert.deepEqual([r.o, r.mask], [3, 0]);
});
