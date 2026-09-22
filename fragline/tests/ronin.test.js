// The Ronin (melee kit, replaced the Medic): a 3-slot hotbar with the Zinkonium Katana locked in slot 1, the passive
// heal and Adrenaline Shot regen, the katana's combo / Fire Strike / Deflect / dash, bleed and backstab crits, its
// upgrade tree at the Blacksmith, and the dash key sharing hotbar slot 4's key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { HoldoutRoom } from '../server/holdout/room.js';
import { makeGun, makeItem, addItem, countOf, giveItem } from '../server/holdout/inventory.js';
import { CLASSES, KATANA, SMITH, adrenCarry } from '../shared/holdout.js';
import { MASTERY, hotbarFor, fits, itemName, milestoneBlock } from '../shared/items.js';
import { GRID } from '../shared/build.js';
import { OUTPOST } from '../shared/outpost.js';

// the browser serves shared/ at /shared/ — map that so hud.js imports unchanged
const ROOT = new URL('../', import.meta.url).href;
registerHooks({ resolve: (spec, ctx, next) => next(spec.startsWith('/shared/') ? ROOT + spec.slice(1) : spec, ctx) });
const { defaultBinds, leftHandedBinds, setBind, keyAction, loadBinds, BINDS_VERSION } = await import('../public/js/hud.js');

let T = 5_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 50) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
const tile = (x, z) => ({ i: (x - GRID.x0) / GRID.cell, k: (z - GRID.z0) / GRID.cell });
function join(room, name = 'P') {
  const messages = [], bins = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); else bins.push(s); } };
  const player = room.addPlayer(ws, name);
  return { player, bins, last: t => messages.filter(m => m.t === t).at(-1), all: t => messages.filter(m => m.t === t) };
}
// a Ronin at (2, 0, -3) facing -z, in a running wave with nothing queued (a far-off frozen zombie keeps it from clearing)
function ronin(code) {
  const room = new HoldoutRoom(code, {}), a = join(room, 'R'), p = a.player;
  room.handle(p, { t: 'class', id: 'ronin' });
  room.startWave(1);
  room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  zed(room, 40, 40, { hp: 1e6 });
  room.cannon.update = () => {}; // the Core's own turret would chip at every zombie near the Core
  Object.assign(p.st, { p: [2, 0, -3], y: 0, w: 'katana' });
  return { room, a, p, kat: p.inv[0] };
}
// an unarmored shambler that never moves or swings, at (x, z), facing +z (toward the Ronin) unless told otherwise
function zed(room, x, z, { hp = 5000, yaw = Math.PI, frozen = true } = {}) {
  const zb = room.spawnZombie('shambler', 'N', '');
  Object.assign(zb, { pos: [x, 0, z], hist: [], hp, maxHp: Math.max(hp, 5000), armor: 0, helmet: false, yaw, frozenUntil: frozen ? T + 1e9 : 0 });
  return zb;
}
const eye = p => [p.st.p[0], p.st.p[1] + 1.6, p.st.p[2]];
const swing = (room, p, zs, gap = 400) => { T += gap; room.handle(p, { t: 'shot', w: 'katana', uid: p.inv[0].uid, o: eye(p), h: zs.map(z => ({ id: z.id, part: 'chest' })) }); };
const lost = z => z.maxHp - z.hp;
const hitsOn = (a, z) => a.all('dmg').filter(m => m.w === 'katana' && m.vic === 'z' + z.id).length;
const carryShots = (p, n) => { for (; n > 0; n -= 10) addItem(p, 'adrenaline', Math.min(n, 10)); };

test('the Ronin replaces the Medic: 200 HP, 20% faster, 30 shots; a stale Medic pick becomes the Ronin; slots 1 and 4-6 empty into the backpack', () => {
  assert.equal(CLASSES.medic, undefined, 'the Medic kit is gone');
  assert.deepEqual([CLASSES.ronin.hp, CLASSES.ronin.speed, adrenCarry('ronin')], [200, 1.2, 30]);
  const room = new HoldoutRoom('RK1', {});
  const a = join(room, 'A'), p = a.player;
  p.inv[0] = makeGun('ar'); p.inv[1] = makeGun('smg'); p.inv[3] = makeItem('grenade', 2); p.inv[5] = makeGun('pump');
  room.handle(p, { t: 'class', id: 'medic' });
  assert.equal(p.cls, 'ronin', 'an old Medic pick becomes the Ronin');
  assert.equal(p.maxHp, 200);
  assert.deepEqual([p.inv[0].id, p.inv[0].locked, p.inv[1].id], ['katana', true, 'smg'], 'the katana, locked, in slot 1; slot 2 untouched');
  assert.deepEqual(p.inv.slice(3, 6), [null, null, null], 'slots 4-6 closed');
  assert.deepEqual(p.inv.slice(6).filter(Boolean).map(it => it.id).sort(), ['ar', 'grenade', 'pump'], 'into the backpack');
  assert.equal(a.last('inv').cls, 'ronin');

  // upgrades and kills live with the katana on the player: out of the kit and back keeps them
  const kat = p.inv[0];
  kat.kills = 77; kat.ku.edge = 2; kat.el = 'toxic';
  room.handle(p, { t: 'class', id: 'tank' });
  assert.ok(!p.inv.some(it => it?.id === 'katana'), 'leaving the kit takes the katana away');
  assert.equal(p.katana, kat);
  room.handle(p, { t: 'class', id: 'ronin' });
  assert.equal(p.inv[0], kat);
  assert.deepEqual([kat.kills, kat.ku.edge, kat.el, itemName(kat)], [77, 2, 'toxic', 'Toxic Zinkonium Katana +2']);

  // a full backpack: what can't move over drops at your feet
  room.handle(p, { t: 'class', id: 'tank' });
  for (let i = 0; i < p.inv.length; i++) p.inv[i] ??= makeItem('spikes', 1);
  room.handle(p, { t: 'class', id: 'ronin' });
  assert.equal(p.inv[0], kat);
  assert.equal([...room.inventory.pickups.values()].filter(pk => pk.item?.id === 'spikes').length, 4, 'slots 1 and 4-6 dropped');

  // a new match forges a fresh katana
  room.newMatch();
  assert.equal(p.inv[0].id, 'katana');
  assert.notEqual(p.inv[0], kat);
  assert.deepEqual([p.inv[0].kills, p.inv[0].ku], [0, {}]);
});

test('3 hotbar slots: the katana can\'t be moved, dropped, sold, stashed, unlocked or forged, and nothing lands in slots 4-6', () => {
  const { room, a, p, kat } = ronin('RK2');
  const deny = () => a.last('deny').text;
  assert.equal(hotbarFor('ronin'), 3);
  assert.equal(hotbarFor('tank'), 6);
  room.handle(p, { t: 'move', from: 'i0', to: 'i1' });
  assert.equal(p.inv[0], kat);
  assert.match(deny(), /bound to hotbar slot 1/);
  p.inv[7] = makeGun('ar');
  room.handle(p, { t: 'move', from: 'i7', to: 'i0' });
  assert.deepEqual([p.inv[0], p.inv[7].id], [kat, 'ar'], 'nothing swaps into its slot');
  room.handle(p, { t: 'move', from: 'i7', to: 'i4' });
  assert.deepEqual([p.inv[4], p.inv[7].id], [null, 'ar'], 'slots 4-6 are closed');
  assert.match(deny(), /3 hotbar slots/);
  room.handle(p, { t: 'drop', from: 'i0' });
  assert.equal(p.inv[0], kat);
  room.handle(p, { t: 'lock', ref: 'i0' });
  assert.equal(kat.locked, true, 'the lock can\'t be lifted');
  p.st.p = [OUTPOST.banker.x, 0, OUTPOST.banker.z];
  const money = p.money;
  room.handle(p, { t: 'sell', uid: kat.uid });
  assert.deepEqual([p.inv[0], p.money], [kat, money], 'the Banker won\'t buy it');
  p.st.p = [OUTPOST.stash.x, 0, OUTPOST.stash.z];
  room.handle(p, { t: 'move', from: 'i0', to: 's0' });
  assert.deepEqual([p.inv[0], room.inventory.stash.items[0]], [kat, null], 'never into the team chest');
  p.st.p = [0, 0, -2]; p.money = 99999; p.mats.zink = 999;
  room.handle(p, { t: 'tierup', uid: kat.uid });
  room.bosses.smith = true; p.st.p = [SMITH.x, 0, SMITH.z];
  for (const m of [{ op: 'forge' }, { op: 'infuse', el: 'fire' }, { op: 'fit', id: 'laser' }]) room.handle(p, { t: 'smith', uid: kat.uid, ...m });
  assert.deepEqual([kat.tier, kat.el, kat.att, p.money], [1, null, {}, 99999], 'no tiers, infusions or attachments: it has its own tree');

  // items land in slots 2-3, then the backpack — never 4-6 (buys, pickups, the fits() check the client shares)
  p.inv.fill(null, 1);
  for (const id of ['smg', 'pump', 'ar']) giveItem(p, makeGun(id));
  assert.deepEqual([p.inv[1].id, p.inv[2].id, p.inv[3], p.inv[6].id], ['smg', 'pump', null, 'ar']);
  for (let i = 6; i < p.inv.length; i++) p.inv[i] ??= makeItem('spikes', 1);
  assert.equal(fits(p.inv, p.sack, makeGun('smg'), 'ronin'), false, 'only closed slots free: full');
  assert.equal(fits(p.inv, p.sack, makeGun('smg'), 'tank'), true, 'any other kit could use them');
  p.st.p = [2, 0, -3];
  const pk = room.inventory.spawn({ kind: 'gun', w: 'smg', r: 1 }, [2, 0, -3]);
  room.handle(p, { t: 'pickup', id: pk.id, slot: 4 }); // a closed slot "in hand" counts as slot 1: the locked katana
  assert.ok(room.inventory.pickups.has(pk.id), 'nothing swapped out');
  assert.deepEqual([p.inv[0], p.inv[4]], [kat, null]);
});

test('passive heal: 3 HP/s anywhere once 3 s unhurt — only for the Ronin', () => {
  const room = new HoldoutRoom('RHL', {});
  const r = join(room, 'R').player, t = join(room, 'T').player;
  room.handle(r, { t: 'class', id: 'ronin' });
  room.handle(t, { t: 'class', id: 'tank' });
  room.phase = 'prep'; room.phaseEnd = Infinity;
  r.st.p = [40, 0, 40]; t.st.p = [-40, 0, 40]; // far outside the Core ring
  r.hp = t.hp = 100;
  room.phase = 'wave'; room.hurtPlayer(r, 1, null); room.phase = 'prep';
  const hurt = r.hp;
  advance(room, 2900);
  assert.equal(r.hp, hurt, 'nothing within 3 s of a hit');
  advance(room, 1100); // 4 s after it: about 1 s of healing
  assert.ok(r.hp - hurt >= 2.2 && r.hp - hurt <= 4, `+3 HP/s: ${r.hp - hurt}`);
  assert.equal(t.hp, 100, 'no other kit heals out there');
  r.hp = r.maxHp - 1;
  advance(room, 1000);
  assert.equal(r.hp, r.maxHp, 'never past max HP');
});

test('Adrenaline regen: +1 shot every 5 s up to 30 once the match is on, into the sack like a pickup', () => {
  const room = new HoldoutRoom('RAD', {});
  const a = join(room, 'R'), p = a.player, q = join(room, 'T').player;
  room.handle(p, { t: 'class', id: 'ronin' });
  advance(room, 11000);
  assert.equal(countOf(p, 'adrenaline'), 0, 'not in the lobby');
  room.phase = 'prep'; room.phaseEnd = Infinity;
  advance(room, 4800);
  assert.equal(countOf(p, 'adrenaline'), 0, 'the first one takes 5 s');
  advance(room, 400);
  assert.equal(countOf(p, 'adrenaline'), 1);
  assert.equal(p.sack[0]?.n, 1, 'into the sack');
  advance(room, 5000);
  assert.equal(countOf(p, 'adrenaline'), 2, 'one every 5 s');
  assert.equal(countOf(q, 'adrenaline'), 0, 'only the Ronin');
  carryShots(p, 27);
  advance(room, 5000);
  assert.equal(countOf(p, 'adrenaline'), 30);
  advance(room, 15000);
  assert.equal(countOf(p, 'adrenaline'), 30, 'capped at 30');
});

test('combo: 95 / 95 / 150, 110° arcs then a 150° arc that shoves; 0.35 s swings; the chain resets after the 0.9 s window', () => {
  const { room, a, p } = ronin('RCB');
  const b = join(room, 'B');
  const front = zed(room, 2, -5.5), side = zed(room, 2 + 2.5 * Math.sin(80 * Math.PI / 180), -3 - 2.5 * Math.cos(80 * Math.PI / 180)), far = zed(room, 2, -9);
  const all = [front, side, far];
  swing(room, p, all);
  assert.deepEqual([lost(front), lost(side), lost(far)], [95, 0, 0], 'first swing: 110°, 3 m reach');
  assert.equal(b.last('shot').n, 0, 'teammates see which swing it was');
  swing(room, p, all, 100);
  assert.equal(lost(front), 95, 'too soon: ignored');
  swing(room, p, all);
  assert.deepEqual([lost(front), lost(side)], [190, 0]);
  swing(room, p, all);
  assert.deepEqual([lost(front), lost(side), lost(far)], [340, 150, 0], 'the third: 150 in a 150° arc');
  assert.equal(front.knock?.dist, KATANA.combo[2].knock, 'and a small knockback');
  swing(room, p, [front]);
  assert.equal(lost(front), 435, 'then the chain starts over');
  swing(room, p, [front], 1600);
  swing(room, p, [front]);
  assert.equal(lost(front), 625, 'a pause resets it: 95 + 95');
  swing(room, p, [front]);
  assert.equal(lost(front), 775, '150 on the third again');
});

test('bleed: a stack per hit (3 dps, 4 s, max 5), shown in the horde snapshot; hits from behind crit ×1.5', () => {
  const { room, a, p } = ronin('RBL');
  const z = zed(room, 2, -5);
  swing(room, p, [z]);
  assert.deepEqual([z.bleedN, z.bleedUntil], [1, T + 4000]);
  const hp = z.hp;
  advance(room, 1000);
  assert.ok(Math.abs(hp - z.hp - 3) < 0.2, `3 dps: ${hp - z.hp}`);
  for (let i = 0; i < 6; i++) swing(room, p, [z]);
  assert.equal(z.bleedN, KATANA.bleed.max, 'stacks to 5');
  room.sendSnapshot(T);
  const v = new DataView(a.bins.at(-1));
  let o = 12;
  while (v.getUint16(o, true) !== z.id) o += 14;
  assert.equal(v.getUint8(o + 13), 5, 'the snapshot carries the stacks (bleed drips on clients)');
  const before = z.hp;
  advance(room, 1000);
  assert.ok(Math.abs(before - z.hp - 15) < 0.5, `5 stacks: 15 dps (${before - z.hp})`);
  advance(room, 3500);
  const done = z.hp;
  advance(room, 1000);
  assert.equal(z.hp, done, 'it runs out after 4 s');

  const back = zed(room, 2, -5, { yaw: 0 }); // facing away from the Ronin
  const side = zed(room, 2.5, -5, { yaw: Math.PI / 2 }); // side-on: 90° is not "behind"
  swing(room, p, [back, side], 1600);
  assert.deepEqual([lost(back), lost(side)], [Math.round(95 * KATANA.crit), 95], 'backstab crit');
  assert.equal(a.all('dmg').at(-2).part, 'head', 'a crit rings like a headshot');
});

test('Fire Strike: a flaming crescent through every zombie and build in its path (never hurting builds), 30 m, 6 s cooldown', () => {
  const { room, a, p } = ronin('RFS');
  const b = join(room, 'B');
  const wall = room.addPiece({ kind: 'wall', ...tile(0, -8), l: 0, o: 0, mat: 'zink' }, p); // across the path at z = -8
  const line = [-6, -12, -20, -30].map(z => zed(room, 2, z)), far = zed(room, 2, -40), off = zed(room, 6, -12);
  const hp0 = wall.hp + wall.grow;
  room.handle(p, { t: 'kat', op: 'strike', o: eye(p), d: [0, 0, -1] });
  assert.equal(b.last('kat').ev, 'strike');
  assert.equal(b.last('kat').l.length, 1, 'one crescent');
  advance(room, 1500);
  for (const z of line) {
    assert.equal(hitsOn(a, z), 1, `hit once at z=${z.pos[2]}`);
    assert.ok(lost(z) >= KATANA.strike.dmg && z.burnUntil > T, 'and set burning');
  }
  assert.deepEqual([lost(far), lost(off)], [0, 0], 'not past 30 m or beside its path');
  assert.ok(Math.abs(wall.hp + wall.grow - hp0) < 1e-6, 'the wall it flew through is untouched');
  assert.equal(room.ronin.strikes.length, 0, 'done');

  room.handle(p, { t: 'kat', op: 'strike', o: eye(p), d: [0, 0, -1] });
  assert.deepEqual([room.ronin.strikes.length, a.last('kat').ev, a.last('kat').what], [0, 'no', 'strike'], '6 s cooldown');
  T += KATANA.strike.cd;
  room.handle(p, { t: 'kat', op: 'strike', o: eye(p), d: [0, 0, -1] });
  assert.equal(room.ronin.strikes.length, 1);

  // the map's solid ground, edge and the Core stop it
  T += KATANA.strike.cd;
  Object.assign(p.st, { p: [0, 0, -7], y: Math.PI });
  const before = zed(room, 0, -4), behind = zed(room, 0, 4);
  room.handle(p, { t: 'kat', op: 'strike', o: eye(p), d: [0, 0, 1] });
  advance(room, 1500);
  assert.deepEqual([hitsOn(a, before), hitsOn(a, behind)], [1, 0], 'the Core stops it');
});

test('Deflect: blocks frontal swings and projectiles for 1.2 s (3 s cooldown), reflects projectiles, a perfect parry heals and grants a shot', () => {
  const { room, a, p } = ronin('RDF');
  const sh = zed(room, 2, -4.4), from = [2, 1, -4.4], at = [2, 1, -3];
  assert.equal(room.barriers.stop(from, at, 20, sh), null, 'no stance: it lands');
  p.hp = 150;
  room.handle(p, { t: 'kat', op: 'deflect' });
  T += 100;
  assert.ok(room.barriers.stop(from, at, 20, sh), 'a frontal swing is blocked');
  assert.deepEqual([p.hp, countOf(p, 'adrenaline')], [165, 1], 'perfect parry: +15 HP, +1 Adrenaline Shot');
  assert.ok(sh.stunUntil > T, 'the parried zombie staggers');
  assert.equal(a.last('kat').pf, 1);
  T += 100;
  assert.ok(room.barriers.stop(from, at, 20, sh));
  assert.deepEqual([p.hp, countOf(p, 'adrenaline'), a.last('kat').pf], [165, 1, 0], 'once a stance');
  assert.equal(room.barriers.stop([2, 1, -1.4], at, 20, null), null, 'from behind it lands');

  const sn = zed(room, 2, -30), glob = zed(room, 0, -12);
  assert.ok(room.barriers.stop([2, 1.6, -30], [2, 1.3, -3], 29, sn, true), 'a sniper shot');
  assert.equal(lost(sn), 58, 'reflected: the sniper takes 2× its damage');
  assert.deepEqual(a.last('kat').r, [2, 1.2, -30], 'back along a line to the shooter');
  assert.ok(room.barriers.stop([2, 1.5, -4.5], [2, 1.2, -3.6], 18, glob, true), 'an acid glob');
  assert.equal(lost(glob), 36);

  T += KATANA.deflect.ms;
  assert.equal(room.barriers.stop(from, at, 20, sh), null, 'the stance is over after 1.2 s');
  room.handle(p, { t: 'kat', op: 'deflect' });
  assert.deepEqual([a.last('kat').ev, a.last('kat').what], ['no', 'deflect'], '3 s cooldown');
  T += KATANA.deflect.cd - KATANA.deflect.ms;

  // Mirror Deflect: reflections ×2 more, a 0.35 s perfect window
  p.inv[0].ku.mirror = 1;
  room.handle(p, { t: 'kat', op: 'deflect' });
  T += 300;
  room.barriers.stop([2, 1.6, -30], [2, 1.3, -3], 29, sn, true);
  assert.deepEqual([lost(sn), a.last('kat').pf], [58 + 116, 1], '×4 and still perfect at 0.3 s');

  // the real thing: a shambler's swing lands on the blade, not on him
  T += KATANA.deflect.cd;
  const real = zed(room, 2, -4.2, { frozen: false });
  const hp = p.hp, blocks = () => a.all('kat').filter(m => m.ev === 'block').length, n = blocks();
  room.handle(p, { t: 'kat', op: 'deflect' });
  advance(room, 1000);
  assert.ok(real.nextAtk > 0, 'it did swing');
  assert.equal(blocks(), n + 1, 'onto the blade');
  assert.equal(p.hp >= hp, true, 'no damage through the guard');
});

test('Deflect: a real Sniper shot bounces back and hits the sniper for 2× its damage', () => {
  const { room, p } = ronin('RSN');
  Object.assign(p.st, { p: [2, 0, -10], y: 0 });
  const sn = room.spawnZombie('sniper', 'N', '');
  Object.assign(sn, { pos: [2, 0, -30], hist: [] });
  const hp = p.hp, snHp = sn.hp;
  advance(room, 50);
  assert.equal(sn.state, 3, 'aiming');
  advance(room, 1300);
  room.handle(p, { t: 'kat', op: 'deflect' });
  advance(room, 1000);
  assert.equal(p.hp, hp, 'he took nothing');
  assert.ok(Math.abs(snHp - sn.hp - 2 * 29 * room.director.dmgMul) < 1e-6, `the sniper took ${snHp - sn.hp}`);
});

test('dash: 7 m along your aim through zombies (80 each), walls stop it, 5 s cooldown; Chain Dash gives two', () => {
  const { room, a, p } = ronin('RDS');
  const b = join(room, 'B');
  const on = zed(room, 2, -6), grazed = zed(room, 2.9, -8), side = zed(room, 5, -6), past = zed(room, 2, -12);
  room.handle(p, { t: 'kat', op: 'dash', o: [2, 0, -3], d: [0, -1] });
  assert.deepEqual([lost(on), lost(grazed), lost(side), lost(past)], [80, 80, 0, 0], 'cut on the way, 7 m and no further');
  assert.deepEqual(b.last('kat').b, [2, 0, -10], 'teammates see where it ends');
  T += 1000;
  room.handle(p, { t: 'kat', op: 'dash', o: [2, 0, -3], d: [0, -1] });
  assert.equal(lost(on), 80, 'on cooldown');
  assert.deepEqual([a.last('kat').what, a.last('kat').p], ['dash', [2, 0, -3]], 'refused: snapped back where the server has you');
  T += KATANA.dash.cd;
  room.addPiece({ kind: 'wall', ...tile(0, -8), l: 0, o: 0, mat: 'zink' }, p); // across the path at z = -8
  const beyond = zed(room, 2, -9.5);
  room.handle(p, { t: 'kat', op: 'dash', o: [2, 0, -3], d: [0, -1] });
  assert.equal(lost(on), 160);
  assert.equal(lost(beyond), 0, 'the wall stopped it');
  assert.ok(b.last('kat').b[2] > -8, `stops short of the wall (${b.last('kat').b[2]})`);

  T += KATANA.dash.cd;
  p.inv[0].ku.chain = 1;
  for (let i = 0; i < 3; i++) { T += 300; room.handle(p, { t: 'kat', op: 'dash', o: [2, 0, -3], d: [0, -1] }); }
  assert.equal(lost(on), 320, 'Chain Dash: two per cooldown, not three');
});

test('the katana tree: each upgrade needs its wave, the katana\'s mastery, money and Zinkonium, in order; effects land', () => {
  const { room, a, p, kat } = ronin('RUP');
  room.bosses.smith = true;
  p.st.p = [SMITH.x, 0, SMITH.z];
  const deny = () => a.last('deny').text, buy = (id, el) => room.handle(p, { t: 'smith', op: 'mile', uid: kat.uid, id, el });
  const fill = (money, zink, kills) => { p.money = money; p.mats.zink = zink; kat.kills = kills; };
  fill(99999, 999, 9999);
  room.wave = 30;
  buy('edge2');
  assert.equal(deny(), 'Forge Edge I first');
  p.inv[1] = makeGun('ar');
  buy('multi');
  room.handle(p, { t: 'smith', op: 'mile', uid: p.inv[1].uid, id: 'twin' });
  assert.deepEqual([kat.mods, p.inv[1].ku, p.money], [undefined, undefined, 99999], 'gun milestones stay off it, its tree off guns');
  assert.deepEqual([milestoneBlock('multi', kat, 30, 1e5, 999), milestoneBlock('twin', p.inv[1], 30, 1e5, 999)], ['Not a katana upgrade', 'Only for guns']);
  const want = { edge1: 0, edge2: 0, edge3: 10, edge4: 15, edge5: 20, twin: 5, mirror: 5, ember: 10, chain: 10, hemo: 15, exec: 15, elem: 20 };
  assert.deepEqual(Object.fromEntries(Object.entries(SMITH.katana).map(([id, u]) => [id, u.wave])), want);
  for (const [id, u] of Object.entries(SMITH.katana)) {
    const need = MASTERY[u.mastery - 1], el = id === 'elem' ? 'toxic' : undefined;
    if (u.wave > 0) {
      room.wave = u.wave - 1; fill(99999, 999, 9999); buy(id, el);
      assert.equal(deny(), `Unlocks at wave ${u.wave}`, id);
    }
    room.wave = u.wave;
    if (need > 0) { fill(99999, 999, need - 1); buy(id, el); assert.match(deny(), new RegExp(`Needs mastery ${u.mastery} `), id); }
    fill(u.money - 1, 999, need); buy(id, el);
    assert.equal(deny(), `Needs $${u.money}`, id);
    fill(u.money, u.zink - 1, need); buy(id, el);
    assert.equal(deny(), `Needs ${u.zink} Zinkonium`, id);
    fill(u.money, u.zink, need); buy(id, el);
    assert.deepEqual([p.money, p.mats.zink], [0, 0], `${id}: paid in full`);
    assert.equal(u.edge ? kat.ku.edge : id === 'elem' ? kat.el : kat.ku[id], u.edge ?? (id === 'elem' ? 'toxic' : 1), id);
    fill(99999, 999, 9999); buy(id, el);
    assert.match(deny(), /Already/, `${id} only once`);
  }
  fill(SMITH.katana.elem.money, SMITH.katana.elem.zink, 9999);
  buy('elem', 'fire');
  assert.deepEqual([kat.el, p.money, p.mats.zink], ['fire', 0, 0], 'switching element costs again');
  buy('elem', 'water');
  assert.equal(kat.el, 'fire', 'only shock, cryo, toxic or fire');
  assert.equal(itemName(kat), 'Fire Zinkonium Katana +5');
});

test('upgrade effects: Edge damage, Twin Fire Strike, Ember Trail, Hemorrhage, Execution, Elemental Edge', () => {
  const { room, a, p, kat } = ronin('RFX');
  const z = zed(room, 2, -5);
  kat.ku.edge = 3;
  swing(room, p, [z]);
  assert.equal(lost(z), Math.round(95 * 1.6), 'Edge III: +60%');
  kat.ku.edge = 0;

  kat.ku.twin = 1; kat.ku.ember = 1;
  room.handle(p, { t: 'kat', op: 'strike', o: eye(p), d: [0, 0, -1] });
  const [l, r] = room.ronin.strikes.map(c => c.u);
  assert.ok(l && r && Math.abs(l[0] + r[0]) < 1e-9 && Math.abs(Math.atan2(r[0], -r[2]) * 180 / Math.PI) - KATANA.strike.twin < 1e-6, 'Twin: two crescents 12° either side');
  advance(room, 1500);
  const embers = room.hazards.filter(h => h.kind === 'ember');
  assert.ok(embers.length >= 12 && embers.every(h => h.zdps === KATANA.ember.dps && h.dps === 0 && h.w === 'ember'), `Ember Trail: burning ground that only hurts zombies (${embers.length})`);
  const walker = zed(room, embers[3].p[0], embers[3].p[2]);
  p.st.p = [embers[3].p[0], 0, embers[3].p[2]];
  const php = p.hp;
  advance(room, 1000);
  assert.ok(lost(walker) >= KATANA.ember.dps * 0.75, `a zombie in it burns (${lost(walker)})`);
  assert.equal(p.hp >= php, true, 'the Ronin standing in it doesn\'t');

  p.st.p = [2, 0, -3];
  kat.ku.hemo = 1;
  const h = zed(room, 2, -5);
  for (let i = 0; i < 12; i++) swing(room, p, [h]);
  assert.deepEqual([h.bleedN, h.bleedDps], [KATANA.bleed.hemoMax, KATANA.bleed.dps * KATANA.bleed.hemoMul], 'Hemorrhage: 10 stacks, +50%');

  const weak = zed(room, 2, -5, { hp: 400 }), boss = zed(room, 2.3, -5, { hp: 400 });
  boss.t = { ...boss.t, boss: true };
  weak.maxHp = boss.maxHp = 2000;
  swing(room, p, [weak, boss], 1600);
  swing(room, p, [weak, boss]);
  assert.ok(!weak.dead && !boss.dead);
  kat.ku.exec = 1;
  swing(room, p, [weak, boss]);
  assert.equal(weak.dead, true, 'Execution: the third hit finishes a zombie under 15%');
  assert.equal(boss.dead, false, 'never a boss');
  assert.equal(a.all('kat').some(m => m.ev === 'exec'), true);

  kat.el = 'toxic';
  const tox = zed(room, 2, -5);
  swing(room, p, [tox], 1600);
  assert.ok(tox.poisonUntil > T, 'Elemental Edge: the blade poisons');
});

test('the dash key shares hotbar slot 4\'s key: a Ronin dashes, everyone else picks the slot; rebinding lets only slots 4-6 share it', () => {
  const R = defaultBinds(), L = leftHandedBinds();
  assert.deepEqual([R.dash[0], L.dash[0]], ['Digit4', 'Digit8']);
  const map = { Digit4: 'slot4', Digit5: 'slot5', KeyQ: 'bWall' };
  assert.equal(keyAction(map, R, 'Digit4', true), 'dash');
  assert.equal(keyAction(map, R, 'Digit4', false), 'slot4');
  assert.equal(keyAction({ Digit4: 'dash' }, R, 'Digit4', false), 'slot4', 'whichever the map kept');
  assert.equal(keyAction(map, R, 'Digit5', true), 'slot5', 'other hotbar keys do nothing special');
  assert.equal(keyAction(map, R, 'KeyQ', true), 'bWall');
  const b = defaultBinds();
  setBind(b, 'dash', 0, 'Digit6');
  assert.deepEqual([b.dash[0], b.slot6[0], b.slot4[0]], ['Digit6', 'Digit6', 'Digit4'], 'slot 6 keeps its key');
  setBind(b, 'dash', 0, 'KeyQ');
  assert.deepEqual([b.dash[0], b.bWall[0]], ['KeyQ', ''], 'nothing else may share it');
  setBind(b, 'slot5', 0, 'KeyQ');
  assert.deepEqual([b.dash[0], b.slot5[0]], ['KeyQ', 'KeyQ']);
  setBind(b, 'forward', 0, 'KeyQ');
  assert.deepEqual([b.dash[0], b.slot5[0], b.forward[0]], ['', '', 'KeyQ']);
  // a save from before the dash: it takes slot 4's key, unless that key already does something else
  assert.equal(loadBinds({ forward: ['KeyW', ''] }, BINDS_VERSION).dash[0], 'Digit4');
  const old = loadBinds({ bWall: ['Digit4', ''], slot4: ['KeyZ', ''] }, BINDS_VERSION);
  assert.equal(old.dash[0], '', 'left unbound rather than clash');
});
