// Ground pickups obey gravity: they fall until they land on the ground, a built floor, or a map prop,
// using the same box data players collide with; losing that support (piece destroyed/edited) drops them again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldoutRoom } from '../server/holdout/room.js';
import { GRID } from '../shared/build.js';

let T = 9_000_000;
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
  return { player, messages, all: t => messages.filter(m => m.t === t) };
}

test('a pickup spawned in mid-air falls and lands on the ground', () => {
  const room = started(new HoldoutRoom('G1', {}));
  const pk = room.inventory.spawn({ kind: 'mats', mat: 'zink', n: 5 }, [0, 6, -44]); // open ground in the north lane
  assert.equal(pk.resting, false, 'starts out falling');
  advance(room, 2000);
  assert.equal(pk.resting, true, 'settles once it reaches the ground');
  assert.ok(Math.abs(pk.pos[1]) < 0.05, `expected to land at y=0, got ${pk.pos[1]}`);
});

test('a pickup lands on a built floor, then falls again once the floor is destroyed', () => {
  const room = started(new HoldoutRoom('G2', {}));
  const floor = room.addPiece({ kind: 'floor', ...tile(0, -8), l: 1, mat: 'zink' }, null);
  const top = floor.box.max[1];
  const pk = room.inventory.spawn({ kind: 'mats', mat: 'zink', n: 5 }, [floor.box.min[0] + 1, top + 5, floor.box.min[2] + 1]);
  advance(room, 2000);
  assert.equal(pk.resting, true, 'settles on the floor instead of falling through it');
  assert.ok(Math.abs(pk.pos[1] - top) < 0.05, `expected to land on the floor at ${top}, got ${pk.pos[1]}`);

  room.removePiece(floor, 'broken');
  advance(room, 300); // past the ~200ms re-check
  assert.equal(pk.resting, false, 'lost its floor and starts falling again');
  advance(room, 2000);
  assert.equal(pk.resting, true);
  assert.ok(Math.abs(pk.pos[1]) < 0.05, `expected to fall through to the ground, got y=${pk.pos[1]}`);
});

test('a pickup lands on a map prop it is dropped above', () => {
  const room = started(new HoldoutRoom('G3', {}));
  const wallDef = room.props.get([...room.props.keys()][0]);
  const top = wallDef.box.max[1], cx = (wallDef.box.min[0] + wallDef.box.max[0]) / 2, cz = (wallDef.box.min[2] + wallDef.box.max[2]) / 2;
  const pk = room.inventory.spawn({ kind: 'mats', mat: 'zink', n: 5 }, [cx, top + 6, cz]);
  advance(room, 2000);
  assert.equal(pk.resting, true);
  assert.ok(Math.abs(pk.pos[1] - top) < 0.05, `expected to land on the prop at ${top}, got ${pk.pos[1]}`);
});

test('falling pickups broadcast their height only while they are moving', () => {
  const room = started(new HoldoutRoom('G4', {}));
  const a = join(room, 'A');
  const pk = room.inventory.spawn({ kind: 'mats', mat: 'zink', n: 5 }, [20, 4, 20]);
  advance(room, 1500);
  assert.equal(pk.resting, true);
  assert.ok(a.all('pkfall').some(m => m.l.some(([id]) => id === pk.id)), 'broadcast while falling');
  const before = a.all('pkfall').length;
  advance(room, 500);
  assert.equal(a.all('pkfall').length, before, 'no more broadcasts once it has landed');
});
