import test from 'node:test';
import assert from 'node:assert/strict';
import { addItem, countOf, makeGun } from '../server/holdout/inventory.js';
import { HoldoutRoom } from '../server/holdout/room.js';
import { GRID } from '../shared/build.js';
import { HOTBAR } from '../shared/items.js';
import { OUTPOST } from '../shared/outpost.js';
import { CLASSES, rarityCost, sellPrice, TEAM_UPS, SMITH } from '../shared/holdout.js';
import { WEAPONS } from '../shared/weapons.js';

let T = 9_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const advance = (room, ms, step = 50) => { for (let t = 0; t < ms; t += step) { T += step; room.update(T, step / 1000); } };
const tile = (x, z) => ({ i: (x - GRID.x0) / GRID.cell, k: (z - GRID.z0) / GRID.cell });
function join(room, name = 'P') {
  const messages = [];
  const ws = { readyState: 1, send: s => { if (typeof s === 'string') messages.push(JSON.parse(s)); } };
  const player = room.addPlayer(ws, name);
  return { player, messages, last: t => messages.filter(m => m.t === t).at(-1), all: t => messages.filter(m => m.t === t) };
}
const started = room => { room.phase = 'prep'; return room; };
const atCore = p => { p.st.p = [0, 0, 0]; };
const atBanker = p => { p.st.p = [OUTPOST.banker.x, 0, OUTPOST.banker.z]; };
const away = p => { p.st.p = [40, 0, 40]; };

test('rarity upgrade: cost, bank payment, stops at Legendary, denied away from the Core', () => {
  const room = started(new HoldoutRoom('SA', {}));
  const a = join(room, 'A'), p = a.player;
  const gun = p.inv[0]; // starting pistol, common
  p.money = 100000;
  away(p);
  room.handle(p, { t: 'rarity', uid: gun.uid });
  assert.equal(gun.r, 0, 'denied away from the Core');
  assert.match(a.last('deny').text, /Core/);

  atCore(p);
  const cost = rarityCost(gun), before = p.money;
  room.handle(p, { t: 'rarity', uid: gun.uid });
  assert.equal(gun.r, 1);
  assert.equal(p.money, before - cost, 'charged the rarity cost');

  // bank payment
  room.inventory.stash.money = 50000;
  const bankBefore = room.inventory.stash.money, moneyBefore = p.money;
  room.handle(p, { t: 'rarity', uid: gun.uid, bank: true });
  assert.equal(gun.r, 2);
  assert.equal(p.money, moneyBefore, 'paid from the bank, not the player');
  assert.ok(room.inventory.stash.money < bankBefore);

  // stops at Legendary
  gun.r = 4;
  room.handle(p, { t: 'rarity', uid: gun.uid });
  assert.equal(gun.r, 4);
  assert.match(a.last('deny').text, /Legendary/);
});

test('sell and buy back: money goes up, buy-back restores the identical item for the sell price, a second sale replaces it', () => {
  const room = started(new HoldoutRoom('SB', {}));
  const a = join(room, 'A'), p = a.player;
  atBanker(p);
  const gun = p.inv[0], uid1 = gun.uid, id1 = gun.id, r1 = gun.r, tier1 = gun.tier;
  const price1 = sellPrice(gun), before = p.money;
  room.handle(p, { t: 'sell', uid: uid1 });
  assert.equal(p.inv[0], null, 'removed from the inventory');
  assert.equal(p.money, before + price1, 'money went up by the sell price');
  assert.equal(p.buyback.item.uid, uid1);
  assert.equal(p.buyback.price, price1);

  const moneyAfterSell = p.money;
  room.handle(p, { t: 'buyback' });
  assert.equal(p.money, moneyAfterSell - price1, 'paid the sell price to buy back');
  const restored = p.inv.find(it => it?.uid === uid1);
  assert.ok(restored, 'the identical item (same uid) came back');
  assert.equal(restored.id, id1);
  assert.equal(restored.r, r1);
  assert.equal(restored.tier, tier1);
  assert.equal(p.buyback, null, 'buy-back cleared after use');

  // a second sale replaces the buy-back, not appends to it
  addItem(p, 'grenade', 3);
  const gr = p.inv.find(it => it?.id === 'grenade'), uid2 = gr.uid, price2 = sellPrice(gr);
  room.handle(p, { t: 'sell', uid: uid2 });
  assert.equal(p.buyback.item.uid, uid2);
  assert.equal(p.buyback.price, price2);
});

test('buy back denied without money and with a full inventory', () => {
  const room = started(new HoldoutRoom('SC', {}));
  const a = join(room, 'A'), p = a.player;
  atBanker(p);
  const gun = p.inv[0], uid = gun.uid;
  room.handle(p, { t: 'sell', uid });
  const price = p.buyback.price;

  p.money = 0;
  room.handle(p, { t: 'buyback' });
  assert.ok(p.buyback, 'still pending: no money');
  assert.match(a.last('deny').text, /money/i);

  p.money = price;
  p.inv.fill({ uid: -1, id: 'grenade', kind: 'throw', n: 1 }); // every slot occupied
  room.handle(p, { t: 'buyback' });
  assert.ok(p.buyback, 'still pending: no room');
  assert.match(a.last('deny').text, /full/i);

  p.inv[5] = null; // free one hotbar slot
  room.handle(p, { t: 'buyback' });
  assert.equal(p.buyback, null);
  assert.ok(p.inv.some(it => it?.uid === uid), 'restored once there was room');
});

test('team upgrades: vitality scales max HP off the class, firepower scales dmgMultFor, max level 3, bank payment', () => {
  const room = started(new HoldoutRoom('SD', {}));
  const a = join(room, 'A'), p = a.player;
  atCore(p);
  p.money = 200000;
  room.handle(p, { t: 'class', id: 'tank' });
  const baseHp = CLASSES.tank.hp;
  assert.equal(p.maxHp, baseHp);

  room.handle(p, { t: 'teamup', id: 'vitality' });
  assert.equal(room.teamUps.vitality, 1);
  assert.equal(p.maxHp, Math.round(baseHp * 1.1));
  assert.equal(p.hp, p.maxHp, 'an alive player gains the added HP right away');

  const dm0 = room.dmgMultFor(p);
  room.handle(p, { t: 'teamup', id: 'firepower' });
  assert.ok(room.dmgMultFor(p) > dm0, 'firepower raises dmgMultFor');

  for (let i = 0; i < 5; i++) room.handle(p, { t: 'teamup', id: 'vitality' });
  assert.equal(room.teamUps.vitality, 5, 'stops at level 5');
  const hpAtMax = p.maxHp;
  room.handle(p, { t: 'teamup', id: 'vitality' });
  assert.equal(p.maxHp, hpAtMax, 'no further gain once maxed');
  assert.match(a.last('deny').text, /max/i);

  // team-bank payment
  room.inventory.stash.money = 50000;
  const bankBefore = room.inventory.stash.money, moneyBefore = p.money;
  room.handle(p, { t: 'teamup', id: 'engineering', bank: true });
  assert.equal(room.teamUps.engineering, 1);
  assert.equal(p.money, moneyBefore, 'paid from the bank, not the player');
  assert.ok(room.inventory.stash.money < bankBefore);
});

test('team upgrades other than vitality still refresh the buyer\'s own money right away', () => {
  const room = started(new HoldoutRoom('SU', {}));
  const a = join(room, 'A'), p = a.player;
  atCore(p);
  p.money = 100000; // bypasses sendInv, so a.last('inv') is stale until the purchase pushes a fresh one
  room.handle(p, { t: 'teamup', id: 'firepower' });
  assert.ok(p.money < 100000, 'charged for the upgrade');
  assert.equal(a.last('inv').money, p.money, 'the buyer got a fresh inv with the new balance, not a stale one');

  room.handle(p, { t: 'teamup', id: 'engineering' });
  assert.equal(a.last('inv').money, p.money, 'same for engineering');
});

test('engineering raises new piece HP and growth rate, and rescales existing builds on level-up', () => {
  const room = started(new HoldoutRoom('SE', {}));
  const a = join(room, 'A'), p = a.player;
  p.mats.zink = 500;
  p.st.p = [0, 0, -6];
  room.handle(p, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'zink' });
  const [wall] = room.builds();
  const maxHp0 = wall.maxHp, hp0 = wall.hp, rate0 = wall.rate;

  atCore(p);
  p.money = 100000;
  room.handle(p, { t: 'teamup', id: 'engineering' });
  assert.ok(wall.maxHp > maxHp0, 'existing piece maxHp scaled up');
  assert.ok(wall.hp > hp0, 'existing piece hp scaled up by the same ratio');
  assert.ok(Math.abs(wall.hp / wall.maxHp - hp0 / maxHp0) < 1e-6, 'ratio preserved');

  T += 200;
  p.st.p = [0, 0, -6];
  room.handle(p, { t: 'build', kind: 'wall', ...tile(-4, -4), l: 0, o: 0, mat: 'zink' });
  const fresh = room.builds().find(s => s !== wall);
  assert.ok(fresh.rate > rate0, 'new pieces grow faster with engineering upgraded');
  assert.ok(fresh.maxHp > maxHp0, 'new pieces get more max HP with engineering upgraded');
});

test('buying a duplicate gun works: no "already carrying" deny, goes to a free slot', () => {
  const room = started(new HoldoutRoom('SK', {}));
  const a = join(room, 'A'), p = a.player;
  atCore(p);
  p.money = 100000;
  room.handle(p, { t: 'buy', item: 'pistol' }); // already carries the starting pistol
  assert.equal(a.all('deny').length, 0, 'no deny for a duplicate');
  assert.equal(p.inv.filter(it => it?.id === 'pistol').length, 2, 'a second pistol was added');
});

test('selling requires the Banker: denied at the Core, allowed at OUTPOST.banker', () => {
  const room = started(new HoldoutRoom('SL', {}));
  const a = join(room, 'A'), p = a.player;
  const gun = p.inv[0];
  atCore(p);
  room.handle(p, { t: 'sell', uid: gun.uid });
  assert.equal(p.inv[0], gun, 'not sold from the Core ring');
  assert.match(a.last('deny').text, /Banker/);

  atBanker(p);
  room.handle(p, { t: 'sell', uid: gun.uid });
  assert.equal(p.inv[0], null, 'sold at the Banker');
  assert.ok(p.buyback);
});

test('sack: heals go to the sack first, a sack item can be used, sold and moved to/from the backpack, and non-consumables are rejected', () => {
  const room = started(new HoldoutRoom('SM', {}));
  const a = join(room, 'A'), p = a.player;
  atCore(p);
  p.money = 100000;

  room.handle(p, { t: 'buy', item: 'bandage' });
  assert.ok(p.sack.some(it => it?.id === 'bandage'), 'a bought heal goes to the sack first');
  assert.ok(!p.inv.some(it => it?.id === 'bandage'), 'not duplicated into the backpack');

  p.hp = 50;
  room.handle(p, { t: 'use', item: 'bandage' });
  assert.ok(p.hp > 50, 'used straight from the sack');

  // a gun can't be dragged into the sack
  const gunUid = p.inv[0].uid;
  room.handle(p, { t: 'move', from: 'i0', to: 'k1' });
  assert.equal(p.inv[0].uid, gunUid, 'the gun stayed in the backpack');
  assert.match(a.last('deny').text, /sack/i);

  // a consumable bought/given goes to the sack (addItem uses the same placement rule)…
  addItem(p, 'medkit', 1);
  const sackIdx = p.sack.findIndex(it => it?.id === 'medkit');
  assert.ok(sackIdx >= 0, 'addItem also prefers the sack for consumables');

  // …and can be dragged out to the backpack and back
  const backFree = p.inv.findIndex((it, i) => !it && i >= HOTBAR);
  room.handle(p, { t: 'move', from: 'k' + sackIdx, to: 'i' + backFree });
  assert.equal(p.inv[backFree].id, 'medkit', 'moved out of the sack');
  room.handle(p, { t: 'move', from: 'i' + backFree, to: 'k' + sackIdx });
  assert.equal(p.sack[sackIdx].id, 'medkit', 'moved back into the sack');

  // selling works from the sack too
  atBanker(p);
  p.money = 100; // below the money cap, so the sale profit actually shows
  room.handle(p, { t: 'sell', uid: p.sack[sackIdx].uid });
  assert.equal(p.sack[sackIdx], null, 'sold out of the sack');
  assert.ok(p.money > 100);
});

test('adrenaline: instant heal with overflow to shield, a regen/damage boost, and a cooldown', () => {
  const room = started(new HoldoutRoom('SN', {}));
  room.phaseEnd = Infinity; // keep it in 'prep' so update() doesn't advance into a wave
  const a = join(room, 'A'), p = a.player;
  atCore(p);
  addItem(p, 'adrenaline', 2);
  p.hp = p.maxHp - 20; // +60 heal: 20 tops off HP, 40 overflows to shield
  p.shield = 0;

  room.handle(p, { t: 'use', item: 'adrenaline' });
  assert.equal(p.hp, p.maxHp, 'topped off to max HP');
  assert.equal(p.shield, 40, 'the rest overflowed into shield');
  assert.equal(countOf(p, 'adrenaline'), 1, 'consumed one');
  assert.ok(room.dmgMultFor(p) > 1, 'damage boost active right away');

  advance(room, 1000); // regen ticks, also overflowing into shield once HP is capped
  assert.ok(p.shield > 40, 'shield kept rising from the regen');

  const shBefore = p.shield;
  room.handle(p, { t: 'use', item: 'adrenaline' }); // still on cooldown (only 1s elapsed of 2s)
  assert.equal(p.shield, shBefore, 'no second dose yet');
  assert.equal(countOf(p, 'adrenaline'), 1, 'not consumed again');
});

test('pickups despawn after 4 minutes (8 minutes for boss loot)', () => {
  const room = started(new HoldoutRoom('SO', {}));
  room.phaseEnd = Infinity;
  const normal = room.inventory.spawn({ kind: 'item', id: 'bandage', n: 1 }, [0, 0, 0]);
  const boss = room.inventory.spawn({ kind: 'item', id: 'medkit', n: 1 }, [0, 0, 0], true);
  assert.ok(room.inventory.pickups.has(normal.id));
  assert.ok(room.inventory.pickups.has(boss.id));

  advance(room, 4 * 60000 - 2000, 2000); // just under 4 minutes
  assert.ok(room.inventory.pickups.has(normal.id), 'not expired yet');
  assert.ok(room.inventory.pickups.has(boss.id), 'boss loot lasts longer');

  advance(room, 4000, 2000); // cross the 4-minute mark
  assert.ok(!room.inventory.pickups.has(normal.id), 'normal pickup despawned at 4 minutes');
  assert.ok(room.inventory.pickups.has(boss.id), 'boss loot still alive at 4 minutes');

  advance(room, 4 * 60000, 5000); // cross the 8-minute mark
  assert.ok(!room.inventory.pickups.has(boss.id), 'boss loot despawned at 8 minutes');
});

test('stacking: a second element infusion adds on top (and costs more Zinkonium), both apply on a hit', () => {
  const room = started(new HoldoutRoom('SQ', {}));
  const a = join(room, 'A'), p = a.player;
  room.bosses.smith = true;
  p.money = 100000;
  p.mats.zink = 500;
  p.st.p = [SMITH.x, 0, SMITH.z];
  const gun = p.inv[1] = makeGun('ar');

  room.handle(p, { t: 'smith', op: 'infuse', uid: gun.uid, el: 'fire' });
  assert.deepEqual(gun.els, ['fire']);
  assert.equal(gun.el, 'fire', 'el stays the first element');
  const spentFirst = 500 - p.mats.zink;

  const beforeSecond = p.mats.zink;
  room.handle(p, { t: 'smith', op: 'infuse', uid: gun.uid, el: 'ice' });
  assert.deepEqual(gun.els, ['fire', 'ice'], 'adds on, never replaces');
  assert.equal(gun.el, 'fire', 'el is still the first element');
  const spentSecond = beforeSecond - p.mats.zink;
  assert.ok(spentSecond > spentFirst, 'the second infusion costs more Zinkonium');

  room.handle(p, { t: 'smith', op: 'infuse', uid: gun.uid, el: 'fire' });
  assert.deepEqual(gun.els, ['fire', 'ice'], 'already infused with fire: denied, not duplicated');

  const z = room.spawnZombie('shambler', 'N');
  z.pos = [0, 0, -3];
  z.hist = [];
  room.hitZombie(p, z, WEAPONS.ar, [{ part: 'chest', pen: 1 }], false, 1, gun.els);
  assert.ok(z.burnUntil > Date.now(), 'fire applied');
  assert.ok(z.chill > 0, 'ice applied too');
});

test('gunnery loosens the server\'s fire-rate gate', () => {
  const room = started(new HoldoutRoom('SR', {}));
  const a = join(room, 'A'), p = a.player;
  const shoot = () => room.handle(p, { t: 'shot', w: 'pistol', o: [...p.st.p], d: [], e: 0 });
  shoot();
  const t0 = p.lastShot.pistol;

  T += 90; // less than the base gap (60000/420 * 0.7 ≈ 100ms), more than gunnery's boosted gap
  shoot();
  assert.equal(p.lastShot.pistol, t0, 'still gated with no Gunnery');

  room.teamUps.gunnery = 5;
  T += 90;
  shoot();
  assert.ok(p.lastShot.pistol > t0, 'Gunnery loosens the gate enough to let the next shot through');
});

test('item lock: blocks sell, drop, move/swap and team-chest moves, but not upgrades; toggle sends a message', () => {
  const room = started(new HoldoutRoom('SV', {}));
  const a = join(room, 'A'), p = a.player;
  const gun = p.inv[0], uid = gun.uid;

  room.handle(p, { t: 'lock', ref: 'i0' });
  assert.equal(gun.locked, true, 'locked');
  assert.match(a.last('msg').text, /locked/i);

  // sell: denied even at the Banker
  atBanker(p);
  room.handle(p, { t: 'sell', uid });
  assert.equal(p.inv[0], gun, 'not sold while locked');
  assert.match(a.last('deny').text, /Locked/);

  // drop
  room.handle(p, { t: 'drop', from: 'i0' });
  assert.equal(p.inv[0], gun, 'not dropped while locked');
  assert.match(a.last('deny').text, /Locked/);

  // move/swap: locked source and locked destination both block it (covers hotkey-swap and quick-move too — same message)
  p.inv[1] = makeGun('ar');
  room.handle(p, { t: 'move', from: 'i1', to: 'i0' });
  assert.equal(p.inv[0], gun, 'locked destination blocks the swap');
  assert.equal(p.inv[1].id, 'ar', 'source unchanged too');
  assert.match(a.last('deny').text, /Locked/);
  room.handle(p, { t: 'move', from: 'i0', to: 'i2' });
  assert.equal(p.inv[0], gun, 'locked source blocks the move');

  // the team chest: can't move a locked item in
  p.st.p = [OUTPOST.stash.x, 0, OUTPOST.stash.z];
  room.handle(p, { t: 'move', from: 'i0', to: 's0' });
  assert.equal(p.inv[0], gun, 'locked item stays out of the team chest');
  assert.match(a.last('deny').text, /Locked/);

  // upgrades still work on a locked item
  p.money = 100000;
  atCore(p);
  room.handle(p, { t: 'rarity', uid });
  assert.equal(gun.r, 1, 'rarity upgrade still applies while locked');
  room.handle(p, { t: 'tierup', uid });
  assert.equal(gun.tier, 2, 'tier upgrade still applies while locked');

  // unlock, then the normal rules resume
  room.handle(p, { t: 'lock', ref: 'i0' });
  assert.equal(gun.locked, false);
  assert.match(a.last('msg').text, /unlocked/i);
  atBanker(p);
  room.handle(p, { t: 'sell', uid });
  assert.equal(p.inv[0], null, 'sells fine once unlocked');
});

test('item lock: attaching to a gun (an upgrade) still works even if the gun or the attachment is locked', () => {
  const room = started(new HoldoutRoom('SW', {}));
  const a = join(room, 'A'), p = a.player;
  const gun = p.inv[0];
  p.inv[1] = { uid: 9101, id: 'extmag', kind: 'attach', n: 1 };
  room.handle(p, { t: 'lock', ref: 'i0' });
  room.handle(p, { t: 'lock', ref: 'i1' });

  room.handle(p, { t: 'move', from: 'i1', to: 'i0' });
  assert.equal(gun.att.mag, 'extmag', 'fitted even though both the gun and the attachment were locked');
});
