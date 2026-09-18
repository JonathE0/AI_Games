// Batch 13: the flying specialists (server/holdout/flyers.js) — the Swooper (circles, dives, climbs back, no
// projectiles, an easy hitbox) and the Sky Sniper (hovers at a vantage point and snipes exactly like a ground
// Sniper: a locked-line laser telegraph, step out to dodge).
import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldoutRoom } from '../server/holdout/room.js';
import { updateZombies } from '../server/holdout/ai.js';
import { ZTYPES, dmgMult } from '../shared/zombies.js';

let T = 9_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 50) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
function join(room, name = 'P') {
  const messages = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const player = room.addPlayer(ws, name);
  return { player, messages, last: t => messages.filter(m => m.t === t).at(-1), all: t => messages.filter(m => m.t === t) };
}
const started = room => { room.phase = 'prep'; return room; };

test('Swooper: an easy hitbox (hit tests use z.s), spawns airborne, circles then dives and hits once', () => {
  assert.ok(ZTYPES.swooper.scale >= 1, 'much bigger/easier to hit than a tiny critter would be');
  const room = started(new HoldoutRoom('FL1', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(8); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const sw = room.spawnZombie('swooper', 'N', '');
  assert.ok(sw.pos[1] > 5, 'spawns at altitude, not on the ground');
  assert.equal(sw.g, false, 'airborne — not treated as grounded');
  p.st.p = [sw.pos[0], 0, sw.pos[2]]; // directly underneath
  p.hp = p.maxHp;
  const hpBefore = p.hp;
  let hit = false;
  for (let i = 0; i < 300 && !hit; i++) { T += 50; updateZombies(room, 0.05, T); hit = p.hp < hpBefore; }
  assert.ok(hit, 'wound up, dove, and hit the player standing below it');
  for (let i = 0; i < 60; i++) { T += 50; updateZombies(room, 0.05, T); } // let it finish the dive and climb back out
  assert.ok(sw.pos[1] > 3, 'climbs back toward altitude afterwards, not left on the ground');
});

test('Sky Sniper: flies in, hovers at a vantage point, telegraphs, fires along its locked line — stepping out dodges it', () => {
  const room = started(new HoldoutRoom('FL2', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(9); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const sk = room.spawnZombie('skysniper', 'N', '');
  assert.ok(sk.pos[1] > 5, 'spawns airborne');
  assert.ok(sk.s >= 1, 'decent hitbox, scale >= 1.0');
  sk.post = [0, 15, -40]; sk.pos = [0, 15, -40]; // already hovering at its vantage point, out past the Core Cannon's own range
  p.st.p = [0, 0, -10]; p.hp = p.maxHp;

  advance(room, 100); // one think-tick: it notices the player and locks its aim
  const aimMsg = a.last('zaim');
  assert.ok(aimMsg, 'telegraphed the shot, same as a ground Sniper');
  p.st.p = [8, 0, -10]; // step out of the shown beam before it fires
  const hpBefore = p.hp;
  advance(room, 2200); // past the 2.2s windup
  assert.equal(p.hp, hpBefore, 'dodged by leaving the beam the laser showed');
  const shot = a.last('zshot');
  assert.ok(shot, 'still fires along the locked line');
  assert.deepEqual(shot.b, aimMsg.p, 'the fired line matches the locked telegraph, not the new position');

  // a second telegraph: stays on the beam this time — takes the hit, at the buffed ground-sniper damage
  p.st.p = [0, 0, -10];
  advance(room, 4200); // past its cooldown: re-evaluates and locks on again
  assert.ok(a.all('zaim').length >= 2, 'second telegraph');
  const hpBefore2 = p.hp;
  advance(room, 2200);
  assert.equal(hpBefore2 - p.hp, Math.round(ZTYPES.skysniper.dmg * dmgMult(9)), 'stayed on the beam: hit for the buffed sniper damage');
});
