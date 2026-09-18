import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalPlayer } from '../public/js/player.js';
import { Weapons } from '../public/js/weapons.js';
import { modeOf } from '../shared/modes.js';
import { LAKE_BOXES, LAKE_SPAWNS } from '../shared/lake.js';
import { blocked } from '../shared/physics.js';

test('Huntsman jump lasts nearly three seconds, reaches five meters, and lands safely', () => {
  const pl = new LocalPlayer();
  pl.spawn([-29, 0, -17], 0);
  const input = { f: 0, b: 0, l: 0, r: 0, jump: 1, crouch: 0, walk: 0 };
  let peak = 0, airtime = 0;
  do {
    pl.tick(1/128, input, 6, LAKE_BOXES, false, false, modeOf('scoutsman').phys);
    input.jump = 0;
    peak = Math.max(peak, pl.pos[1]); airtime += 1/128;
  } while (!pl.grounded && airtime < 5);
  assert.ok(peak > 5 && peak < 5.4, `peak ${peak}`);
  assert.ok(airtime > 2.7 && airtime < 2.9, `airtime ${airtime}`);
  assert.ok(pl.grounded);
  assert.ok(Math.abs(pl.pos[1]) < 0.01);
});

test('both Lake spawn areas are clear including random spawn offsets', () => {
  for (const sp of Object.values(LAKE_SPAWNS))
    for (const dx of [-1, 0, 1]) for (const dz of [-3, 0, 3])
      assert.equal(blocked(sp.x+dx, 0, sp.z+dz, 1.8, LAKE_BOXES), false);
});

test('scoped airborne SSG stays accurate only in Huntsman; no-scope still needs aiming', () => {
  const g = { player: { crouch: 0, speed: 8, grounded: false }, mode: modeOf('scoutsman') };
  const w = new Weapons(g);
  w.slots[1] = { w: 'ssg08', uid: 1 }; w.slot = 1; w.scope = 1;
  const accurate = w.inaccuracy();
  g.mode = modeOf('classic');
  assert.ok(w.inaccuracy() > accurate + 1);
  g.mode = modeOf('scoutsman'); w.scope = 0;
  assert.ok(w.inaccuracy() > accurate + 1);
});
