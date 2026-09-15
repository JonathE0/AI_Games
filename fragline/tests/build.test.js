import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPlacement, pieceBox, slotKey, overlaps, GRID } from '../shared/build.js';
import { OUTPOST, OUTPOST_BOXES, OUTPOST_NODES } from '../shared/outpost.js';
import { blocked } from '../shared/physics.js';
import { FlowField } from '../server/holdout/flowfield.js';

// tile (i, k) whose north-west corner is at world (x, z)
const tile = (x, z) => ({ i: (x - GRID.x0) / GRID.cell, k: (z - GRID.z0) / GRID.cell });
const world = (extra = {}) => ({
  slots: new Map(), pieces: [], statics: OUTPOST_BOXES, nodes: OUTPOST_NODES.map(n => n.box), zombies: [],
  eye: [0, 1.6, -6], mats: { wood: 100, stone: 100, metal: 100 }, core: OUTPOST.core, zone: OUTPOST.zone, ...extra,
});

test('placement rules: slots, zone, Core, reach, materials, obstacles and support', () => {
  const wall = { kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'wood' }; // along x at z = -8
  assert.equal(checkPlacement(wall, world()), null);
  const w = world();
  w.slots.set(slotKey(wall), 1);
  assert.equal(checkPlacement(wall, w), 'Already built');
  assert.equal(checkPlacement({ ...wall, ...tile(-4, -44) }, world({ eye: null })), 'Outside the build zone');
  assert.equal(checkPlacement({ kind: 'floor', ...tile(-4, -4), l: 0, mat: 'wood' }, world({ eye: null })), 'Too close to the Core');
  assert.equal(checkPlacement({ kind: 'wall', ...tile(-4, -4), l: 0, o: 0, mat: 'wood' }, world({ eye: null })), null); // hugging the Core block is fine
  assert.equal(checkPlacement({ ...wall, ...tile(-4, -24) }, world()), 'Too far away');
  assert.equal(checkPlacement(wall, world({ mats: { wood: 5 } })), 'Not enough wood');
  assert.equal(checkPlacement({ kind: 'wall', ...tile(-12, -24), l: 0, o: 1, mat: 'wood' }, world({ eye: null })), null);
  assert.equal(checkPlacement({ kind: 'wall', ...tile(-8, -24), l: 0, o: 1, mat: 'wood' }, world({ eye: null })), 'Blocked'); // a wrecked car
  assert.equal(checkPlacement({ kind: 'floor', ...tile(-8, -28), l: 0, mat: 'wood' }, world({ eye: null })), 'Blocked'); // the ruin wall
  assert.equal(checkPlacement(wall, world({ zombies: [{ x: -2, y: 0, z: -8, s: 1 }] })), 'Blocked by a zombie');
  const floor1 = { kind: 'floor', ...tile(-4, -12), l: 1, mat: 'wood' };
  assert.equal(checkPlacement(floor1, world({ eye: null })), 'Needs support');
  const support = pieceBox({ kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'wood' });
  assert.equal(checkPlacement(floor1, world({ eye: null, pieces: [support] })), null);
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
      pieces.push({ id: id++, hp: weak === `${x},${z}` ? 50 : 700, box: pieceBox({ id, kind: 'wall', ...tile(x, z), l: 0, o, mat: 'metal' }) });
    }
    for (let z = -12; z < 12; z += 4) for (const x of [-12, 12]) {
      pieces.push({ id: id++, hp: 700, box: pieceBox({ id, kind: 'wall', ...tile(x, z), l: 0, o: 1, mat: 'metal' }) });
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
  const sealed = ring(null, '4,-12');
  ff.update([], sealed);
  const weakest = sealed.find(p => p.hp === 50).id;
  assert.deepEqual([...walk(ff).crossed], [weakest]);
});
