import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPlacement, pieceBox, pieceBoxes, doorOf, unsupported, slotKey, overlaps, GRID } from '../shared/build.js';
import { OUTPOST, OUTPOST_BOXES, OUTPOST_NODES, OUTPOST_PROPS, OUTPOST_CHESTS, OUTPOST_SHELTERS } from '../shared/outpost.js';
import { blocked, P } from '../shared/physics.js';
import { FlowField } from '../server/holdout/flowfield.js';

// tile (i, k) whose north-west corner is at world (x, z)
const tile = (x, z) => ({ i: (x - GRID.x0) / GRID.cell, k: (z - GRID.z0) / GRID.cell });
const world = (extra = {}) => ({
  slots: new Map(), pieces: [], statics: OUTPOST_BOXES, nodes: OUTPOST_NODES.map(n => n.box), zombies: [],
  eye: [0, 1.6, -6], mats: { zink: 100 }, core: OUTPOST.core, zone: OUTPOST.zone, ...extra,
});

test('placement rules: slots, zone, Core, reach, materials, obstacles and support', () => {
  const wall = { kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'zink' }; // along x at z = -8
  assert.equal(checkPlacement(wall, world()), null);
  const w = world();
  w.slots.set(slotKey(wall), 1);
  assert.equal(checkPlacement(wall, w), 'Already built');
  assert.equal(checkPlacement({ ...wall, ...tile(-4, -44) }, world({ eye: null })), 'Outside the build zone');
  assert.equal(checkPlacement({ kind: 'floor', ...tile(-4, -4), l: 0, mat: 'zink' }, world({ eye: null })), 'Too close to the Core');
  assert.equal(checkPlacement({ kind: 'wall', ...tile(-4, -4), l: 0, o: 0, mat: 'zink' }, world({ eye: null })), null); // hugging the Core block is fine
  assert.equal(checkPlacement({ ...wall, ...tile(-4, -24) }, world()), 'Too far away');
  assert.equal(checkPlacement(wall, world({ mats: { zink: 5 } })), 'Not enough Zinkonium');
  assert.equal(checkPlacement({ kind: 'wall', ...tile(-12, -24), l: 0, o: 1, mat: 'zink' }, world({ eye: null })), null);
  assert.equal(checkPlacement({ kind: 'wall', ...tile(-8, -24), l: 0, o: 1, mat: 'zink' }, world({ eye: null })), 'Blocked'); // a wrecked car
  assert.equal(checkPlacement({ kind: 'floor', ...tile(-8, -28), l: 0, mat: 'zink' }, world({ eye: null })), 'Blocked'); // the ruin wall
  assert.equal(checkPlacement(wall, world({ zombies: [{ x: -2, y: 0, z: -8, s: 1 }] })), 'Blocked by a zombie');
  const floor1 = { kind: 'floor', ...tile(-4, -12), l: 1, mat: 'zink' };
  assert.equal(checkPlacement(floor1, world({ eye: null })), 'Needs support');
  const support = pieceBox({ kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'zink' });
  assert.equal(checkPlacement(floor1, world({ eye: null, pieces: [support] })), null);
});

test('floors sit flush with their level line: a standing player clears a ground-level door, walls and floors keep their integrity roles', () => {
  // a standing player on a level-0 floor walks through a door cut into a level-0 wall
  const floor = pieceBox({ kind: 'floor', ...tile(0, 0), l: 0, mat: 'zink' });
  const mask = (1 << 0) | (1 << 3); // bottom two tiles of column 0: a one-tile door
  const wall = { id: 9, kind: 'wall', ...tile(0, -4), l: 0, o: 0, mat: 'zink', mask };
  assert.ok(doorOf(mask), 'a valid door shape');
  const doorBoxes = pieceBoxes(wall).filter(b => !b.door); // player collision: the door gap itself doesn't collide
  const full = pieceBox(wall), dx = full.min[0] + GRID.cell / 6, dz = (full.min[2] + full.max[2]) / 2;
  assert.equal(blocked(dx, floor.max[1], dz, P.standH, doorBoxes), false, 'a standing player fits through the door');

  // a level-1 floor is still supported by level-0 walls, and a level-0 floor is still an integrity anchor
  const wSupport = { id: 1, kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'zink' };
  const wBox = Object.assign(pieceBox(wSupport), { sid: 1 });
  const fUp = { id: 2, kind: 'floor', ...tile(-4, -8), l: 1, mat: 'zink' };
  const fUpBox = Object.assign(pieceBox(fUp), { sid: 2 });
  const supported = [{ id: 1, boxes: [wBox] }, { id: 2, boxes: [fUpBox] }];
  assert.equal(unsupported(supported, () => [wBox, fUpBox]).length, 0, 'the level-1 floor hangs off the level-0 wall');

  const fGround = { id: 3, kind: 'floor', ...tile(8, 8), l: 0, mat: 'zink' };
  const fGroundBox = Object.assign(pieceBox(fGround), { sid: 3 });
  assert.equal(unsupported([{ id: 3, boxes: [fGroundBox] }], () => [fGroundBox]).length, 0, 'a level-0 floor still anchors to the ground');
});

test('Outpost is consistent: spawns, lanes and nodes are clear of each other', () => {
  const solid = OUTPOST_BOXES.filter(b => b.mat !== 'f');
  const nodes = OUTPOST_NODES.map(n => n.box);
  for (const sp of OUTPOST.spawns) assert.equal(blocked(sp.x, 0, sp.z, 1.8, [...solid, ...nodes]), false);
  for (const lane of OUTPOST.lanes) {
    const [x0, z0, x1, z1] = lane.zone;
    const zone = { min: [x0 - 0.5, 0, z0 - 0.5], max: [x1 + 0.5, 3, z1 + 0.5] };
    assert.ok(![...solid.filter(b => b.mat !== 'b'), ...nodes].some(b => overlaps(zone, b)), `lane ${lane.id} obstructed`);
  }
  for (const [i, a] of nodes.entries()) {
    assert.ok(!solid.some(b => overlaps(a, b)), `node ${i} inside the map`);
    for (const b of nodes.slice(i + 1)) assert.ok(!overlaps(a, b, -0.3), `node ${i} crowds another`);
  }
  assert.equal(OUTPOST_NODES.length, 108);
});

test('flow field: zombies use a gap when there is one and break the weakest wall when sealed', () => {
  const ring = (skip, weak) => {
    const pieces = [];
    let id = 1;
    for (let x = -12; x < 12; x += 4) for (const [z, o] of [[-12, 0], [12, 0]]) {
      if (skip === `${x},${z}`) continue;
      pieces.push({ id: id++, hp: weak === `${x},${z}` ? 50 : 700, box: pieceBox({ id, kind: 'wall', ...tile(x, z), l: 0, o, mat: 'zink' }) });
    }
    for (let z = -12; z < 12; z += 4) for (const x of [-12, 12]) {
      pieces.push({ id: id++, hp: 700, box: pieceBox({ id, kind: 'wall', ...tile(x, z), l: 0, o: 1, mat: 'zink' }) });
    }
    for (const p of pieces) p.box.sid = p.id;
    return pieces;
  };
  const walk = ff => { // follow the field from the north gate; return the pieces crossed
    let [x, z] = [0.5, -30.5];
    const crossed = new Set();
    for (let i = 0; i < 200; i++) {
      const st = ff.step(x, z);
      if (!st || st.goal) break;
      if (st.sid >= 0) crossed.add(st.sid);
      [x, z] = [st.x, st.z];
    }
    return { crossed, end: Math.hypot(x, z) };
  };
  const ff = new FlowField(OUTPOST.bounds, OUTPOST_BOXES, OUTPOST.core);
  ff.update([], ring('-4,-12'));
  const open = walk(ff);
  assert.equal(open.crossed.size, 0);
  assert.ok(open.end < 4);
  const sealed = ring(null, '0,-12'); // the lane (past the sandbag gap) reaches the ring here
  ff.update([], sealed);
  const weakest = sealed.find(p => p.hp === 50).id;
  assert.deepEqual([...walk(ff).crossed], [weakest]);
});

test('the new ruins (apartment, gas station, bus, watchtower) fit the map without overlapping props or nodes', () => {
  const nodes = OUTPOST_NODES.map(n => n.box);
  assert.equal(OUTPOST_PROPS.length, 124, 'one new ruin per quarter, plus the sandbag line, over the old 96');
  for (const p of OUTPOST_PROPS) {
    assert.ok(p.box.min[0] >= -48 && p.box.max[0] <= 48 && p.box.min[2] >= -48 && p.box.max[2] <= 48, `prop ${p.id} outside the map`);
    for (const n of nodes) assert.ok(!overlaps(p.box, n), `prop ${p.id} overlaps a harvest node`);
  }
});

test('chest and shelter spots (including the ones in the new ruins) sit in the open, not inside a wall', () => {
  const solid = OUTPOST_BOXES.filter(b => b.mat !== 'f');
  const nodes = OUTPOST_NODES.map(n => n.box);
  assert.equal(OUTPOST_CHESTS.length, 20, '5 chest spots per quarter now the new ruin has one');
  assert.equal(OUTPOST_SHELTERS.length, 8, 'a second shelter per quarter, inside the new ruin');
  for (const c of OUTPOST_CHESTS) assert.equal(blocked(c.x, 0, c.z, 1.8, [...solid, ...nodes]), false, `chest ${c.id} boxed in`);
  for (const s of OUTPOST_SHELTERS) assert.equal(blocked(s.x, 0, s.z, 1.8, [...solid, ...nodes]), false, `shelter ${s.id} boxed in`);
});
