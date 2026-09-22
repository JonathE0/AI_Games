import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGun, addItem, countOf } from '../server/holdout/inventory.js';
import { HoldoutRoom, HOLDOUT } from '../server/holdout/room.js';
import { GRID } from '../shared/build.js';
import { BoxGrid } from '../shared/boxgrid.js';
import { WEAPONS } from '../shared/weapons.js';
import { ITEMS, SURVIVOR, SURVIVOR_CLASSES, SMITH, DEFENSES, TURRET_TYPES, DEPLOY_WEIGHT, DEPLOY_IDS, rollDeploy, rollLoot, rescueWave, elementPrice } from '../shared/holdout.js';
import { OUTPOST_PROPS, OUTPOST_SHELTERS, PROP_TYPES, NODE_TYPES } from '../shared/outpost.js';
import { ZTYPES } from '../shared/zombies.js';
import { MAW } from '../server/holdout/bosses.js';

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
// small seeded RNG so loot-weighting tests are deterministic (rollLoot/rollDeploy/rollRarity take an rng(), default Math.random)
const mulberry32 = seed => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test('builds that lose their connection to the ground collapse', () => {
  const room = started(new HoldoutRoom('I', {}));
  const a = join(room, 'A'), p = a.player;
  p.mats.zink = 500;
  p.st.p = [0, 0, -6];
  room.handle(p, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'zink' });
  T += 200;
  room.handle(p, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 1, o: 0, mat: 'zink' });
  T += 200;
  room.handle(p, { t: 'build', kind: 'floor', ...tile(-4, -12), l: 1, mat: 'zink' }); // hangs off the upper wall
  const [bottom, top, floor] = room.builds();
  assert.ok(bottom && top && floor, 'three pieces built');
  advance(room, 3000);
  room.removePiece(bottom, 'broken');
  advance(room, 150);
  assert.equal(room.builds().length, 2, 'falls a moment later, not instantly');
  advance(room, 1500);
  assert.equal(room.builds().length, 0, 'the wall above and the floor hanging off it came down');
  assert.ok(a.all('sdel').some(m => m.why === 'collapse'));
});

test('everything on the map breaks except the Core: props take hits, give materials and fall apart', () => {
  const room = started(new HoldoutRoom('P', {}));
  const a = join(room, 'A'), p = a.player;
  assert.equal(room.props.size, OUTPOST_PROPS.length);
  // knife on a house wall
  const wallDef = OUTPOST_PROPS.find(d => d.box.mat === 'd');
  const wall = room.props.get(wallDef.id), b = wall.box;
  p.st.p = [(b.min[0] + b.max[0]) / 2, 0, b.max[2] + 1];
  if (b.max[2] - b.min[2] > b.max[0] - b.min[0]) p.st.p = [b.max[0] + 1, 0, (b.min[2] + b.max[2]) / 2];
  p.st.w = 'knife';
  const zink = p.mats.zink;
  room.handle(p, { t: 'harvest', sid: wall.id });
  assert.ok(p.mats.zink > zink, 'harvesting a wall gives Zinkonium');
  assert.ok(wall.hp < wall.maxHp);
  // a roof comes down when every wall under it is gone
  const roof = [...room.props.values()].find(s => s.mat === 'h');
  const under = [...room.props.values()].filter(s => s !== roof && s.box.max[1] >= roof.box.min[1] - 0.06
    && s.box.min[0] < roof.box.max[0] && s.box.max[0] > roof.box.min[0] && s.box.min[2] < roof.box.max[2] && s.box.max[2] > roof.box.min[2]);
  assert.ok(under.length >= 3);
  for (const s of under) room.removePiece(s, 'broken');
  advance(room, 2000);
  assert.equal(room.pieces.get(roof.id), undefined, 'the roof collapsed');
  // the Core is not a prop
  assert.ok(![...room.props.values()].some(s => s.box.min[0] <= 0 && s.box.max[0] >= 0 && s.box.min[2] <= 0 && s.box.max[2] >= 0));
  assert.equal(PROP_TYPES.c.hp, 900);
});

test('nothing breaks and nothing gets built before the game starts', () => {
  const room = new HoldoutRoom('L', {});
  const a = join(room, 'A'), p = a.player;
  const prop = [...room.props.values()][0];
  p.st.p = [(prop.box.min[0] + prop.box.max[0]) / 2, 0, prop.box.max[2] + 1];
  p.st.w = 'knife';
  room.handle(p, { t: 'harvest', sid: prop.id });
  assert.equal(prop.hp, prop.maxHp);
  assert.match(a.last('deny').text, /Wait for the game/);
  room.damageProps([0, 0, 0], 100, 10000);
  assert.equal(room.props.size, [...room.props.values()].filter(s => room.pieces.get(s.id) === s).length, 'no prop destroyed in the lobby');
});

test('survivors: tiers carry different guns, heal passively but very slowly', () => {
  const room = started(new HoldoutRoom('V', {}));
  join(room, 'A');
  assert.ok(rescueWave(3) && rescueWave(7) && rescueWave(11) && !rescueWave(5));
  assert.equal(SURVIVOR.tiers.map(t => t.gun).join(','), 'Pistol,SMG,Assault Rifle,DMR');
  const sv = room.survivors.spawnWounded(OUTPOST_SHELTERS[0], 2, 'ranger');
  assert.equal(sv.maxHp, SURVIVOR.tiers[2].hp, 'Ranger has no hp multiplier');
  assert.equal(sv.gun.w, 'ar', 'tier 2 Ranger carries the AR curated for that class');
  assert.equal(sv.gun.dmg, Math.round(SURVIVOR.tiers[2].dmg * SURVIVOR_CLASSES.ranger.dmgMult));
  const tank = room.survivors.spawnWounded(OUTPOST_SHELTERS[1], 1, 'guardian');
  assert.equal(tank.gun.w, 'pump', 'Guardians fight up close with a shotgun');
  assert.equal(tank.maxHp, Math.round(SURVIVOR.tiers[1].hp * SURVIVOR_CLASSES.guardian.hpMult), 'Guardians have the most health');
  sv.state = 'active';
  sv.hp = 100;
  room.phase = 'intermission';
  room.phaseEnd = T + 60000;
  advance(room, 5000);
  assert.ok(Math.abs(sv.hp - 105) < 0.1, `passive regen is +1 HP/s (very slow): ${sv.hp}`);
});

test('turrets cost 1.5x; traps and deployables are separate kinds', () => {
  assert.equal(ITEMS.turret.price, 1800);
  assert.equal(ITEMS.rturret.price, 3000);
  assert.equal(ITEMS.turret.kind, 'deploy');
  assert.equal(ITEMS.spikes.kind, 'trap');
  assert.equal(HOLDOUT.countdown, 5000);
});

test('new turret types: gatling, frost, flame, tesla and mortar each fire and apply their own effect', () => {
  const room = started(new HoldoutRoom('T2', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  const zAt = (x, z) => { const zb = room.spawnZombie('shambler', 'N', ''); zb.pos = [x, 0, z]; zb.hp = zb.maxHp = 100000; zb.hist = []; return zb; };
  const place = (type, x, z) => {
    const d = { id: room.defenses.nextId++, type, pos: [x, 0, z], pid: 0, side: 2, owner: p.id, uses: 0, ammo: DEFENSES[type].ammo ?? 0, hp: DEFENSES[type].hp ?? 0, next: 0, until: 0 };
    room.defenses.list.set(d.id, d);
    return d;
  };
  for (const t of ['gturret', 'frturret', 'flturret', 'tesla', 'mortar']) assert.ok(TURRET_TYPES.includes(t), `${t} is a turret type`);

  // Gatling: high fire rate, low damage per shot, chews ammo
  const zg = zAt(20, -5), dg = place('gturret', 20, 0);
  const hp0 = zg.hp, ammo0 = dg.ammo;
  room.defenses.update(0.05, T += 50);
  assert.ok(zg.hp < hp0, 'gatling turret damaged its target');
  assert.ok(dg.ammo < ammo0, 'gatling turret spent ammo');

  // Frost: low damage, chills and slows what it hits
  const zf = zAt(100, -5); place('frturret', 100, 0);
  room.defenses.update(0.05, T += 50);
  assert.ok(zf.hp < 100000, 'frost turret damaged its target');
  assert.ok(zf.slow > 0 && zf.slowUntil > T, 'frost turret slows what it hits');

  // Flame: short-range cone, sets zombies burning (catches a second zombie standing in the same cone)
  const zm1 = zAt(200, -4), zm2 = zAt(201, -4.2); place('flturret', 200, 0);
  room.defenses.update(0.05, T += 50);
  assert.ok(zm1.burnUntil > T, 'flame turret ignites its target');
  assert.ok(zm2.burnUntil > T, 'flame turret cone also caught a zombie standing beside it');

  // Tesla: low rate, arcs to a couple of nearby zombies
  const zt1 = zAt(300, -5), zt2 = zAt(301.5, -5.5); place('tesla', 300, 0);
  const t1hp0 = zt1.hp, t2hp0 = zt2.hp;
  room.defenses.update(0.05, T += 50);
  assert.ok(zt1.hp < t1hp0, 'tesla coil hit its target');
  assert.ok(zt2.hp < t2hp0, 'tesla coil arced to a second nearby zombie');

  // Mortar: long range, splash, can't hit anything close (kept off the straight shot to the far target,
  // otherwise the shell would clip it in passing — it's the targeting/minimum-range rule under test here)
  const zNear = zAt(406, -1), zFar = zAt(400, -20), zSplash = zAt(401, -20.5); place('mortar', 400, 0);
  room.defenses.update(0.05, T += 50);
  for (let i = 0; i < 300; i++) room.combat.update(0.01, T += 10); // fine steps so the fast-moving shell can't skip past its target
  assert.equal(zNear.hp, zNear.maxHp, "mortar can't hit anything within its minimum range");
  assert.ok(zFar.hp < zFar.maxHp, 'mortar hit the farther target');
  assert.ok(zSplash.hp < zSplash.maxHp, 'mortar splash caught a zombie standing next to it');
});

test('deployable loot: one weighting table drives chests, drops, bosses and elite zombie kills', () => {
  // the table shape: every id is a real trap/turret item, every weight is a positive number, and it spans
  // from the cheapest traps to the priciest turrets
  assert.ok(DEPLOY_IDS.length >= 8);
  for (const id of DEPLOY_IDS) {
    assert.ok(ITEMS[id], `${id} is a real item`);
    assert.ok(['trap', 'deploy'].includes(ITEMS[id].kind), `${id} is a trap or deployable`);
    assert.ok(DEPLOY_WEIGHT[id] > 0, `${id} has a positive weight`);
  }
  assert.ok(DEPLOY_WEIGHT.spikes > DEPLOY_WEIGHT.turret, 'a cheap trap is far more common than a turret');
  assert.ok(DEPLOY_WEIGHT.turret > DEPLOY_WEIGHT.mortar, 'the base turret is more common than the priciest turret');
  assert.ok(DEPLOY_WEIGHT.turret > DEPLOY_WEIGHT.rturret, 'balanced against the rocket turret, per the spec');

  // rollDeploy always returns something rollable, and skews toward the table's weighting
  const rng = mulberry32(12345);
  const counts = {};
  for (let i = 0; i < 4000; i++) { const id = rollDeploy(rng); counts[id] = (counts[id] || 0) + 1; }
  assert.ok(counts.spikes > counts.mortar * 10, 'spikes come up far more often than mortars over many rolls');

  // chests mostly give a trap, rarely a good turret; bosses have the best odds of all at a good turret
  const avgDeployPrice = (kind, n, rngSeed) => {
    const r = mulberry32(rngSeed);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const it = rollLoot(kind, r).find(x => x.kind === 'item' && DEPLOY_WEIGHT[x.id]);
      total += ITEMS[it.id].price;
    }
    return total / n;
  };
  const chestAvg = avgDeployPrice('chest', 800, 1), bossAvg = avgDeployPrice('boss', 800, 2);
  assert.ok(bossAvg > chestAvg, `bosses should roll pricier deployables on average than chests (boss ${bossAvg} vs chest ${chestAvg})`);
});

test('inventory: 6 + 18 slots, stacking, drag between slots, armor slots, dropping, attachments', () => {
  const room = started(new HoldoutRoom('N', {}));
  const a = join(room, 'A'), p = a.player;
  assert.equal(p.inv.length, 24);
  addItem(p, 'grenade', 4); addItem(p, 'grenade', 4); // max 6 per stack -> 6 + 2
  assert.deepEqual(p.inv.filter(it => it?.id === 'grenade').map(it => it.n), [6, 2]);
  const g1 = p.inv.findIndex(it => it?.id === 'grenade' && it.n === 2), g0 = p.inv.findIndex(it => it?.id === 'grenade' && it.n === 6);
  p.inv[g0].n = 5;
  room.handle(p, { t: 'move', from: 'i' + g1, to: 'i' + g0 }); // merge
  assert.equal(p.inv[g0].n, 6);
  assert.equal(p.inv[g1].n, 1);
  room.handle(p, { t: 'move', from: 'i' + g1, to: 'i20' });
  assert.equal(p.inv[20].id, 'grenade');
  // armor: only in its own slot, stats follow
  p.inv[21] = { uid: 9001, id: 'vest', kind: 'armor', tier: 2 };
  room.handle(p, { t: 'move', from: 'i21', to: 'a:head' });
  assert.match(a.last('deny').text, /another slot/);
  room.handle(p, { t: 'move', from: 'i21', to: 'a:chest' });
  assert.equal(p.armor.chest.id, 'vest');
  assert.ok(p.as.def > 20);
  p.phase = 'wave'; room.phase = 'wave';
  room.hurtPlayer(p, 50, null);
  assert.ok(p.hp > 55, 'armor soaks part of the hit');
  room.phase = 'prep';
  // attachments fit onto guns
  p.inv[22] = { uid: 9002, id: 'extmag', kind: 'attach', n: 1 };
  room.handle(p, { t: 'move', from: 'i22', to: 'i0' });
  assert.equal(p.inv[0].att.mag, 'extmag');
  assert.equal(p.inv[22], null);
  // drop outside: lands on the ground
  room.handle(p, { t: 'drop', from: 'i20' });
  assert.equal(p.inv[20], null);
  assert.ok([...room.inventory.pickups.values()].some(pk => pk.item?.id === 'grenade'));
});

test('classes: tank health, assault damage and magazines, medic heals and revives faster', () => {
  const room = started(new HoldoutRoom('K', {}));
  const a = join(room, 'A'), b = join(room, 'B'), p = a.player, q = b.player;
  room.handle(p, { t: 'class', id: 'tank' });
  assert.equal(p.maxHp, 300);
  assert.equal(p.hp, 300);
  room.handle(q, { t: 'class', id: 'medic' });
  p.st.p = [0, 0, -3]; q.st.p = [1, 0, -3];
  p.hp = 60;
  room.phase = 'intermission'; room.phaseEnd = T + 60000;
  advance(room, 2000);
  assert.ok(p.hp > 72, 'medic aura heals teammates nearby');
  room.handle(p, { t: 'class', id: 'assault' });
  assert.equal(room.dmgMultFor(p), 1.2);
  p.st.p = [30, 0, 30]; // change class only at the Core once the game is on
  room.handle(p, { t: 'class', id: 'tank' });
  assert.equal(p.cls, 'assault');
});

test('elements: fire burns, water soaks, ice freezes soaked zombies, shock arcs; knockback depends on weight', () => {
  const room = started(new HoldoutRoom('X', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  const z = room.spawnZombie('shambler', 'N', ''), o = room.spawnZombie('shambler', 'N', '');
  z.pos = [0, 0, -12]; o.pos = [2, 0, -12];
  z.hp = z.maxHp = o.hp = o.maxHp = 5000;
  room.applyElement(z, 'fire', 100, p);
  assert.ok(z.burnUntil > T);
  room.applyElement(z, 'water', 100, p);
  assert.equal(z.burnUntil, 0, 'water puts out fire');
  room.applyElement(z, 'ice', 100, p);
  assert.ok(z.frozenUntil > T, 'ice on a soaked zombie freezes it');
  const hp = o.hp;
  room.applyElement(z, 'shock', 100, p);
  assert.ok(o.hp < hp, 'shock arcs to a neighbour');
  // Shockwave Blaster: a hit zombie flies back until it hits something solid or runs out of distance
  for (const zz of [...room.zombies.values()]) room.removeZombie(zz);
  p.st.p = [0, 0, -3];
  const FAKE = { dmg: 10, cone: 120, blastRange: 9 };
  // a zombie flung at a built wall stops at the wall, takes slam damage and is stunned
  room.addPiece({ kind: 'wall', ...tile(0, -16), l: 0, o: 0, mat: 'zink' }, null);
  const walled = room.spawnZombie('runner', 'N', ''); walled.pos = [0, 0, -11]; walled.hp = walled.maxHp = 5000;
  room.blast(p, [0, 1.6, -3], [0, 0, -1], FAKE, 1);
  for (let t = 0; t < 4000 && walled.knock; t += 50) advance(room, 50, 50);
  assert.ok(walled.pos[2] > -17 && walled.pos[2] < -9, `stopped near the wall (z ${walled.pos[2].toFixed(1)})`);
  assert.ok(walled.hp < 5000, 'the slam did damage');
  assert.ok(walled.stunUntil > T, 'stunned after slamming into the wall');
  // open ground: a runner (weight 0.5) flies ~20m, a brute (weight 3) moves far less, bosses don't move at all
  const openGrid = new BoxGrid(4);
  openGrid.add(room.statics.find(b => b.mat === 'f')); // keep the floor, drop every wall/prop obstacle
  room.grid = openGrid;
  const runner = room.spawnZombie('runner', 'N', ''); runner.pos = [-30, 0, -8]; runner.hp = runner.maxHp = 5000;
  const brute = room.spawnZombie('brute', 'N', ''); brute.pos = [-20, 0, -8]; brute.hp = brute.maxHp = 5000;
  const boss = room.spawnZombie('alpha', 'N', ''); boss.pos = [-10, 0, -8]; boss.hp = boss.maxHp = 1e6; boss.frozenUntil = T + 1e9;
  room.blast(p, [-30, 1.6, -3], [0, 0, -1], FAKE, 1);
  room.blast(p, [-20, 1.6, -3], [0, 0, -1], FAKE, 1);
  room.blast(p, [-10, 1.6, -3], [0, 0, -1], FAKE, 1);
  const settled = {}; // capture each one's distance the moment its own knockback ends, before normal AI resumes
  for (let t = 0; t < 4000 && (!('runner' in settled) || !('brute' in settled)); t += 50) {
    advance(room, 50, 50);
    if (!runner.knock && !('runner' in settled)) settled.runner = Math.hypot(runner.pos[0] - -30, runner.pos[2] - -8);
    if (!brute.knock && !('brute' in settled)) settled.brute = Math.hypot(brute.pos[0] - -20, brute.pos[2] - -8);
  }
  assert.ok(settled.runner > 18, `runner flew ${settled.runner.toFixed(1)}`);
  assert.ok(settled.brute <= 7.2, `brute moved ${settled.brute.toFixed(1)}`);
  assert.deepEqual([boss.pos[0], boss.pos[2]], [-10, -8], "bosses don't move");
});

test('Core shop sells elemental guns at a markup: valid element charges extra, unknown element buys plain, short funds deny', () => {
  const room = started(new HoldoutRoom('Y', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [0, 0, 0]; // inside the ring around the Core
  const price = WEAPONS.ar.price, total = price + elementPrice('ar');

  p.money = total;
  room.handle(p, { t: 'buy', item: 'ar', el: 'fire' });
  const bought = p.inv.find(it => it?.id === 'ar');
  assert.ok(bought && bought.el === 'fire' && bought.tier === 1, 'fire AR at tier I');
  assert.equal(p.money, 0, `charged the elemental price ${total}`);
  p.inv[p.inv.findIndex(it => it?.id === 'ar')] = null; // make room to buy it again below

  p.money = price;
  room.handle(p, { t: 'buy', item: 'ar', el: 'lava' }); // not a real element
  const plain = p.inv.find(it => it?.id === 'ar');
  assert.ok(plain && !plain.el, 'unknown element falls back to a plain buy');
  assert.equal(p.money, 0, `charged only the plain price ${price}`);
  p.inv[p.inv.findIndex(it => it?.id === 'ar')] = null;

  p.money = total - 1;
  room.handle(p, { t: 'buy', item: 'ar', el: 'water' });
  assert.ok(!p.inv.some(it => it?.id === 'ar'), 'denied: short of the elemental price');
  assert.equal(p.money, total - 1, 'nothing charged');
  assert.match(a.last('deny').text, /money/);
});

test('grenade launcher rounds explode on impact; the blade slashes everything in front', () => {
  const room = started(new HoldoutRoom('J', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(1); room.director.queue = [];
  p.inv[1] = makeGun('gl');
  p.st.p = [0, 0, -3];
  const z = room.spawnZombie('shambler', 'N', ''); z.pos = [0, 0, -10]; z.hp = z.maxHp = 100; z.frozenUntil = T + 60000;
  room.handle(p, { t: 'rocket', uid: p.inv[1].uid, o: [0, 1.6, -3], d: [0, -0.1, -1] });
  advance(room, 1200);
  assert.ok(z.dead, 'launcher grenade killed it');
  p.inv[2] = makeGun('blade');
  const zs = [[-1, -5], [1, -5], [0, -1]].map(([x, zz]) => { const q = room.spawnZombie('shambler', 'N', ''); q.pos = [x, 0, zz]; q.hp = q.maxHp = 500; q.hist = []; return q; });
  p.st.y = 0; // facing -z
  T += 2000;
  room.handle(p, { t: 'shot', w: 'blade', uid: p.inv[2].uid, o: [0, 1.6, -3], d: [], e: [], h: zs.map(q => ({ id: q.id, part: 'chest', pen: 1 })) });
  assert.ok(zs[0].hp < 500 && zs[1].hp < 500, 'both in front were cut');
  assert.equal(zs[2].hp, 500, 'the one behind was not');
});

test('specialists: snipers camp and hit survivors harder, hexers blind, bloaters burst', () => {
  const room = started(new HoldoutRoom('Z', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(8); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const keep = room.spawnZombie('shambler', 'S', ''); keep.pos = [44, 0, 44]; keep.frozenUntil = T + 1e9; keep.hp = keep.maxHp = 1e6; // keeps the wave going
  // sniper vs a survivor standing in the open
  const sv = room.survivors.spawnWounded({ x: 0, z: -10 }, 0); sv.state = 'active'; sv.pos = [0, 0, -10]; sv.post = [0, -10]; sv.postAt = T + 1e9; // inside the Core leash, so it holds still on the sniper's line
  p.st.p = [40, 0, 40];
  const sn = room.spawnZombie('sniper', 'N', ''); sn.pos = [0, 0, -44]; sn.hist = [];
  const spawnAt = [...sn.pos], hp0 = sv.hp;
  advance(room, 7000);
  assert.ok(Math.hypot(sn.pos[0] - spawnAt[0], sn.pos[2] - spawnAt[2]) < 3, 'the sniper stays at its gate');
  assert.ok(a.all('zaim').length >= 1, 'it telegraphs its shots');
  assert.ok(hp0 - sv.hp >= 40, `survivor took ${hp0 - sv.hp}`); // npcDmg 58 * wave mul, one shot in the 2.2 s windup window
  room.removeZombie(sn);
  room.survivors.perish(sv);
  p.st.p = [0, 0, -10];
  // hexer potion
  p.hp = 100;
  room.addProjectile([0, 3, -12], [0, 0, 0], { id: 0, pos: [0, 0, -12], t: { dmg: 5, sdmg: 0, splash: 3 } }, 'ink');
  advance(room, 1500);
  assert.ok(a.all('pfx').some(m => m.blind > 0), 'blinded');
  // bloater burst leaves acid
  const bl = room.spawnZombie('bloater', 'N', ''); bl.pos = [0, 0, -14];
  room.killZombie(bl, p, 'ar');
  assert.ok(room.hazards.some(h => h.kind === 'acid'));
});

test('burrowers dig under a build once and surface a tile past it; shields block bullets from the front', () => {
  const room = started(new HoldoutRoom('W', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [40, 0, 40];
  // a sealed Zinkonium ring around the Core
  for (let x = -12; x < 12; x += 4) for (const zz of [-12, 12]) room.addPiece({ kind: 'wall', ...tile(x, zz), l: 0, o: 0, mat: 'zink' }, null);
  for (let zz = -12; zz < 12; zz += 4) for (const x of [-12, 12]) room.addPiece({ kind: 'wall', ...tile(x, zz), l: 0, o: 1, mat: 'zink' }, null);
  advance(room, 7500);
  room.startWave(9); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const b = room.spawnZombie('burrower', 'N', ''); b.pos = [0.5, 0, -20];
  let dug = false;
  for (let i = 0; i < 400 && !(dug && !b.under); i++) { advance(room, 50); if (b.under) dug = true; }
  assert.ok(dug, 'it went underground');
  assert.ok(Math.abs(b.pos[2]) < 12, `came up inside the ring (z ${b.pos[2].toFixed(1)})`);
  assert.equal(b.burrowed, true);
  // shieldbearer
  const s = room.spawnZombie('shield', 'N', ''); s.pos = [30, 0, -30]; s.yaw = 0; s.hp = s.maxHp = 1000; s.hist = [];
  p.inv[1] = makeGun('ar');
  const shoot = from => { p.st.p = from; T += 1000; const o = [from[0], 1.6, from[2]], c = [30, 1.2, -30], d = c.map((v, i) => v - o[i]), l = Math.hypot(...d); room.handle(p, { t: 'shot', w: 'ar', o, d: [d.map(v => v / l)], e: [], h: [{ id: s.id, part: 'chest', pen: 1, k: 0 }] }); };
  let hp = s.hp; shoot([30, 0, -40]); const front = hp - s.hp; // yaw 0 faces -z: this is in front
  hp = s.hp; shoot([30, 0, -20]); const back = hp - s.hp;
  assert.ok(back > front * 3, `front ${front} vs back ${back}`);
});

test('Wave 10: two Brood Titans arrive together, each at 75% HP, riders leap immediately, drop minions every 8s, permanent Sniper Riders stay mounted until their Titan dies', () => {
  const room = started(new HoldoutRoom('B', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [40, 0, 40];
  room.startWave(10);
  assert.ok(a.all('task').some(m => /BROOD TITANS?/.test(m.text)), 'announced at the start of wave 10');
  room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  advance(room, 200);
  assert.equal(room.phase, 'wave', 'the wave waits for the Titans');
  advance(room, 5200);
  const titans = [...room.zombies.values()].filter(z => z.type === 'titan');
  assert.equal(titans.length, 2, 'both Titans arrived together');
  const solo = Math.round(ZTYPES.titan.hp * (1 + 0.6 * (room.director.n - 1)));
  for (const t of titans) assert.equal(t.maxHp, Math.round(solo * 0.75), 'each Titan runs at 75% of the old solo HP');
  const riders = [...room.zombies.values()].filter(z => z.type === 'rider');
  const snipers = [...room.zombies.values()].filter(z => z.type === 'broodsniper');
  assert.ok(riders.length >= 10, 'a full complement of normal riders on each Titan');
  assert.equal(snipers.length, 4, 'two permanent Sniper Riders per Titan');
  assert.equal(riders.filter(r => !r.mount).length, 4, 'two riders per Titan leap down and start fighting the moment it arrives');
  assert.ok(snipers.every(r => r.mount), 'the Sniper Riders stay mounted');
  const mounted = riders.find(r => r.mount);
  assert.equal(room.damageZombie(mounted, 100, p, 'ar'), 0, 'mounted riders cannot be hurt');
  assert.equal(room.damageZombie(snipers[0], 100, p, 'ar'), 0, 'mounted Sniper Riders cannot be hurt either');
  const minionsBefore = [...room.zombies.values()].filter(z => z.type === 'runner' || z.type === 'stalker').length;
  advance(room, 8500);
  const minionsAfter = [...room.zombies.values()].filter(z => z.type === 'runner' || z.type === 'stalker').length;
  assert.ok(minionsAfter >= minionsBefore + 4, 'both Titans drop fresh minions off their backs every ~8s');
  assert.ok(snipers.every(r => r.mount && !r.dead), 'still mounted after the minion drop');
  const mountedBefore = riders.filter(r => r.mount).length;
  advance(room, 4500); // ~13s since they arrived: past the new 12s (was 18s) regular dismount cycle
  assert.ok(riders.filter(r => r.mount).length < mountedBefore, 'the regular cycle leaps another rider down after ~12s');
  assert.ok(snipers.every(r => r.mount), 'permanent Sniper Riders never dismount on their own');
  room.killZombie(titans[0], p, 'rocket');
  advance(room, 100);
  assert.equal(room.phase, 'wave', 'one Titan down: the wave waits for the other plus every rider');
  room.killZombie(titans[1], p, 'rocket');
  advance(room, 100);
  assert.ok(riders.every(r => r.dead || !r.mount), 'the rest fall off once their Titan dies');
  assert.ok(snipers.every(r => !r.mount), 'the Sniper Riders fall off too, and are now killable');
  assert.equal(room.bosses.immune(snipers[0]), false, 'no longer immune once dismounted');
  assert.equal(room.bosses.smith, false, 'the Titan no longer gates the Blacksmith (it unlocks at wave 7 instead)');
  assert.equal(room.phase, 'wave', 'riders still have to be killed');
  for (const z of [...room.zombies.values()]) room.killZombie(z, p, 'ar'); // riders, snipers, and any dropped minions
  advance(room, 100);
  assert.equal(room.phase, 'intermission');
});

test('The Maw: thumpers lure it up, its throat takes triple damage, it tries to devour the Core', () => {
  const room = started(new HoldoutRoom('M', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(15);
  room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const B = room.bosses, m = B.maw;
  assert.ok(m && m.need === 1);
  assert.equal(MAW.hp, 48000, 'the Maw has 4x its old base HP (12000 -> 48000)');
  assert.equal(m.max, Math.round(MAW.hp * (1 + 0.6 * (room.director.n - 1))), 'solo scaling still applies on top of the new base');
  advance(room, 5000);
  assert.equal(m.mode === 'hunt' || m.mode === 'warn' || m.mode === 'erupt', true);
  // arm a thumper (hold E 5 s)
  const t = B.thumpers[0];
  p.st.p = [t.x + 1, 0, t.z];
  for (let i = 0; i < 30; i++) { T += 200; room.handle(p, { t: 'thump', id: 0 }); }
  assert.equal(t.state === 'pulse' || t.state === 'spent', true);
  advance(room, 200);
  assert.equal(m.mode, 'lured');
  const g = B.gullet(), o = [g[0], 1.6, g[2] + 20], d = g.map((v, i) => v - o[i]);
  p.inv[1] = makeGun('h_ssg');
  p.st.p = [o[0], 0, o[2]];
  const hp0 = m.hp;
  room.handle(p, { t: 'shot', w: 'h_ssg', uid: p.inv[1].uid, o, d: [d], e: [], h: [], maw: [[0, 'g']] });
  const throat = hp0 - m.hp;
  assert.ok(throat >= 88 * 3 * 0.99, `throat ${throat}`);
  // stage 3: devour the Core unless interrupted
  m.hp = m.max * 0.2;
  m.mode = 'hunt'; m.stage = 2; m.lureCool = T + 1e9;
  advance(room, 3600);
  assert.equal(m.mode, 'devour');
  const core0 = room.core.hp;
  advance(room, 12500);
  assert.ok(room.core.hp < core0 - room.core.max * 0.3, 'bit the Core');
  B.damageMaw(m.hp + 1, p);
  assert.equal(m.dead, true);
  assert.ok([...room.inventory.pickups.values()].some(pk => pk.item?.id === 'mawfang' && pk.item?.tier === 3), 'the Maw drops the Maw Fang');
});

test('Blacksmith: forges tier III, infuses, fits attachments and upgrades turrets; map pings reach the squad', () => {
  const room = started(new HoldoutRoom('S', {}));
  const a = join(room, 'A'), b = join(room, 'B'), p = a.player;
  const gun = p.inv[1] = makeGun('ar');
  gun.tier = 2;
  p.money = 20000;
  p.mats.zink = 200;
  p.st.p = [SMITH.x + 1, 0, SMITH.z];
  room.handle(p, { t: 'smith', op: 'forge', uid: gun.uid });
  assert.equal(gun.tier, 2, 'no Blacksmith before wave 7 is cleared');
  room.bosses.smith = true;
  room.handle(p, { t: 'smith', op: 'forge', uid: gun.uid });
  assert.equal(gun.tier, 3);
  assert.equal(p.mats.zink, 140, 'tier III costs Zinkonium');
  room.handle(p, { t: 'smith', op: 'infuse', uid: gun.uid, el: 'ice' });
  assert.equal(gun.el, 'ice');
  room.handle(p, { t: 'smith', op: 'fit', uid: gun.uid, id: 'flashlight' });
  assert.equal(gun.att.light, 'flashlight');
  room.handle(p, { t: 'smith', op: 'fit', uid: gun.uid, id: 'laser' });
  assert.equal(gun.att.rail, 'laser');
  assert.equal(gun.att.light, 'flashlight', 'the flashlight has its own slot, so the laser fits alongside it');
  assert.equal(countOf(p, 'flashlight'), 0, 'nothing was swapped out');
  const d = { id: 99, type: 'turret', pos: [-6, 0, 6], pid: 0, side: 2, owner: p.id, uses: 0, ammo: 10, hp: 350, next: 0, until: 0 };
  room.defenses.list.set(d.id, d);
  for (let i = 0; i < 3; i++) room.handle(p, { t: 'smith', op: 'turret', def: 99, up: 'dmg' });
  assert.equal(d.mods.dmg, 3, 'damage upgrades stack past the old cap');
  room.handle(p, { t: 'smith', op: 'turret', def: 99, up: 'ammo' });
  assert.equal(d.ammo, DEFENSES.turret.ammo);
  room.handle(p, { t: 'smith', op: 'turret', def: 99, up: 'plate' });
  assert.equal(d.hp, 650);
  p.st.p = [30, 0, 30];
  room.handle(p, { t: 'smith', op: 'infuse', uid: gun.uid, el: 'fire' });
  assert.equal(gun.el, 'ice', 'you have to stand at the anvil');
  room.handle(p, { t: 'ping', x: 12.34, z: -99 });
  const ping = b.last('ping');
  assert.deepEqual([ping.by, ping.x, ping.z], [p.id, 12.3, -48], 'clamped to the map');
  room.handle(p, { t: 'ping', x: 1, z: 1 });
  assert.equal(b.all('ping').length, 1, 'pings are rate limited');
});

test('game over resets the whole map: builds, traps, loot, props, trees and effects from the last match are gone', () => {
  const room = started(new HoldoutRoom('R', {}));
  const a = join(room, 'A'), p = a.player;
  p.mats.zink = 500;
  p.st.p = [0, 0, -6];
  room.handle(p, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'zink' });
  assert.equal(room.builds().length, 1);
  const prop = [...room.props.values()][0];
  prop.hp = 10;
  room.nodes[0].hp = 0;
  room.inventory.spawn({ kind: 'ammo', type: 'light', n: 5 }, [5, 0, 5]);
  room.defenses.list.set(99, { id: 99, type: 'turret', pos: [-6, 0, 6], pid: 0, side: 2, owner: p.id, uses: 0, ammo: 10, hp: 350, next: 0, until: 0 });
  room.survivors.spawnWounded(OUTPOST_SHELTERS[0]);
  p.fx = { burnUntil: T + 60000, burnDps: 5 };
  p.money = 12345;
  room.phase = 'wave';
  room.director.queue = ['shambler'];
  room.damageCore(1e6, null);
  assert.equal(room.phase, 'defeat');
  assert.ok(a.last('hend'), 'stats go out right away');
  advance(room, HOLDOUT.endScreen + 100);
  assert.equal(room.phase, 'lobby', 'a short beat, then the map resets');
  assert.equal(room.builds().length, 0);
  assert.equal(room.props.size, OUTPOST_PROPS.length);
  assert.ok([...room.props.values()].every(s => s.hp === s.maxHp && room.pieces.get(s.id) === s));
  assert.ok(room.nodes.every(n => n.hp === NODE_TYPES[n.type].hits));
  assert.equal(room.inventory.pickups.size, 0);
  assert.equal(room.defenses.list.size, 0);
  assert.equal(room.survivors.list.size, 0);
  assert.equal(p.fx, null);
  assert.equal(p.money, HOLDOUT.startMoney);
  const sall = a.last('sall');
  assert.deepEqual([sall.s.length, sall.nodes.length, sall.props.length], [0, 0, OUTPOST_PROPS.length], 'clients get an empty build list and a full map');
});
