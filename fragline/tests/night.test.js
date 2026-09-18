import test from 'node:test';
import assert from 'node:assert/strict';
import { waveWeights, composeWave, nightRoll } from '../shared/zombies.js';
import { ARMOR } from '../shared/holdout.js';
import { armorStats } from '../shared/items.js';
import { Director } from '../server/holdout/director.js';

const rng = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);

test('night waves are now a fifth of the time, not a quarter', () => {
  assert.equal(nightRoll(8, () => 0.19), true, 'just under the new 20% threshold');
  assert.equal(nightRoll(8, () => 0.2), false, 'boundary is exclusive');
  assert.equal(nightRoll(8, () => 0.22), false, 'would have rolled a night wave under the old 25% chance, not anymore');
  assert.equal(nightRoll(3, () => 0), false, 'still never before wave 4');
  assert.equal(nightRoll(5, () => 0), false, 'still never on a boss wave');
});

test('the Shade only shows up in wave weights on night waves, and never before wave 6', () => {
  assert.equal(waveWeights(5, 1, true).shade, undefined); // too early even at night
  assert.ok(waveWeights(6, 1, true).shade > 0);
  assert.equal(waveWeights(6, 1, false).shade, undefined); // not a night wave
  assert.ok(waveWeights(10, 2, true).shade > waveWeights(6, 1, true).shade); // grows with the wave
});

test('composeWave only spends budget on Shades when the night flag is set', () => {
  const dayWave = composeWave(20, 2, 1, rng, 400, false);
  assert.ok(!dayWave.includes('shade'));
  const nightWaveTooEarly = composeWave(5, 2, 1, rng, 400, true);
  assert.ok(!nightWaveTooEarly.includes('shade'));
  const nightWave = composeWave(20, 2, 1, rng, 400, true);
  assert.ok(nightWave.includes('shade'));
});

test('the director only plans/spawns Shades on a wave it planned as a night wave', () => {
  const room = { activeCount: () => 2, diff: 1, zombies: new Map() };
  const day = new Director(room, rng);
  day.plan(10);
  day.planned.night = false; // force the outcome instead of relying on the rng roll
  day.start(10);
  assert.ok(!day.queue.includes('shade'));

  const night = new Director(room, rng);
  night.plan(10);
  night.planned.night = true;
  night.start(10);
  assert.ok(night.queue.includes('shade'));
});

test('Night Vision Goggles are head armor with rising per-tier defense', () => {
  assert.equal(ARMOR.nvg.slot, 'head');
  const s1 = armorStats({ head: { id: 'nvg', tier: 1 } }).def;
  const s2 = armorStats({ head: { id: 'nvg', tier: 2 } }).def;
  const s3 = armorStats({ head: { id: 'nvg', tier: 3 } }).def;
  assert.ok(s1 > 0 && s2 > s1 && s3 > s2);
});
