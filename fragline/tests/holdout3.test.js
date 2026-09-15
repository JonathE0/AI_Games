import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGun, addItem, countOf } from '../server/holdout/inventory.js';
import { HoldoutRoom, HOLDOUT } from '../server/holdout/room.js';
import { GRID } from '../shared/build.js';
import { WEAPONS } from '../shared/weapons.js';
import { ITEMS, SURVIVOR, SMITH, DEFENSES, rescueWave, elementPrice } from '../shared/holdout.js';
import { OUTPOST_PROPS, OUTPOST_SHELTERS, PROP_TYPES, NODE_TYPES } from '../shared/outpost.js';

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

test('builds that lose their connection to the ground collapse', () => {
  const room = started(new HoldoutRoom('I', {}));
  const a = join(room, 'A'), p = a.player;
  p.mats.wood = 500;
  p.st.p = [0, 0, -6];
  room.handle(p, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'wood' });
  T += 200;
  room.handle(p, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 1, o: 0, mat: 'wood' });
  T += 200;
  room.handle(p, { t: 'build', kind: 'floor', ...tile(-4, -12), l: 1, mat: 'wood' }); // hangs off the upper wall
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
  const wood = p.mats.wood;
  room.handle(p, { t: 'harvest', prop: wall.id });
  assert.ok(p.mats.wood > wood, 'harvesting a wall gives wood');
  assert.ok(wall.hp < wall.maxHp);
  // guns chip props (validated against the prop's box)
  p.inv[1] = makeGun('ar');
  const c = [(b.min[0] + b.max[0]) / 2, 1.5, (b.min[2] + b.max[2]) / 2], o = [p.st.p[0], 1.6, p.st.p[2]];
  const d = c.map((v, i) => v - o[i]), l = Math.hypot(...d);
  const hp = wall.hp;
  T += 1000;
  room.handle(p, { t: 'shot', w: 'ar', o, d: [d.map(v => v / l)], e: [], h: [], pr: [[wall.id, 0]] });
  assert.ok(wall.hp < hp, 'bullets chip the wall');
  T += 1000;
  room.handle(p, { t: 'shot', w: 'ar', o, d: [[0, 1, 0]], e: [], h: [], pr: [[wall.id, 0]] });
  assert.ok(wall.hp > hp - 60, 'a claim that does not line up is ignored');
  // a roof comes down when every wall under it is gone
  const roof = [...room.props.values()].find(s => s.mat === 'h');
  const under = [...room.props.values()].filter(s => s !== roof && s.box.max[1] >= roof.box.min[1] - 0.06
    && s.box.min[0] < roof.box.max[0] && s.box.max[0] > roof.box.min[0] && s.box.min[2] < roof.box.max[2] && s.box.max[2] > roof.box.min[2]);
  assert.ok(under.length >= 3);
  for (const s of under) room.removePiece(s, 'broken');
  advance(room, 2000);
  assert.equal(room.pieces.get(roof.id), undefined, 'the roof collapsed');
  // explosions break props, the Core is not a prop
  assert.ok(![...room.props.values()].some(s => s.box.min[0] <= 0 && s.box.max[0] >= 0 && s.box.min[2] <= 0 && s.box.max[2] >= 0));
  assert.equal(PROP_TYPES.c.hp, 900);
});

test('nothing breaks and nothing gets built before the game starts', () => {
  const room = new HoldoutRoom('L', {});
  const a = join(room, 'A'), p = a.player;
  const prop = [...room.props.values()][0];
  p.st.p = [(prop.box.min[0] + prop.box.max[0]) / 2, 0, prop.box.max[2] + 1];
  p.st.w = 'knife';
  room.handle(p, { t: 'harvest', prop: prop.id });
  assert.equal(prop.hp, prop.maxHp);
  assert.match(a.last('deny').text, /Wait for the game/);
  room.damageProps([0, 0, 0], 100, 10000);
  assert.equal(room.props.size, [...room.props.values()].filter(s => room.pieces.get(s.id) === s).length, 'no prop destroyed in the lobby');
});

test('survivors: tiers carry different guns, never heal on their own, bandages patch them up', () => {
  const room = started(new HoldoutRoom('V', {}));
  const a = join(room, 'A'), p = a.player;
  assert.ok(rescueWave(3) && rescueWave(7) && rescueWave(11) && !rescueWave(5));
  assert.equal(SURVIVOR.tiers.map(t => t.gun).join(','), 'Pistol,SMG,Assault Rifle,DMR');
  const sv = room.survivors.spawnWounded(OUTPOST_SHELTERS[0], 2);
  assert.equal(sv.maxHp, SURVIVOR.tiers[2].hp);
  sv.state = 'active';
  sv.hp = 100;
  room.phase = 'intermission';
  room.phaseEnd = T + 60000;
  advance(room, 5000);
  assert.equal(sv.hp, 100, 'no passive healing');
  addItem(p, 'bandage', 2);
  p.st.p = [sv.pos[0] + 1, 0, sv.pos[2]];
  room.handle(p, { t: 'use', item: 'bandage', sv: sv.id });
  assert.ok(sv.hp > 100);
  assert.equal(countOf(p, 'bandage'), 1);
});

test('turrets cost 1.5x; traps and deployables are separate kinds', () => {
  assert.equal(ITEMS.turret.price, 2250);
  assert.equal(ITEMS.rturret.price, 3750);
  assert.equal(ITEMS.turret.kind, 'deploy');
  assert.equal(ITEMS.spikes.kind, 'trap');
  assert.equal(HOLDOUT.countdown, 5000);
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
  assert.equal(p.maxHp, 150);
  assert.equal(p.hp, 150);
  room.handle(q, { t: 'class', id: 'medic' });
  p.st.p = [0, 0, -3]; q.st.p = [1, 0, -3];
  p.hp = 60;
  room.phase = 'intermission'; room.phaseEnd = T + 60000;
  advance(room, 2000);
  assert.ok(p.hp > 64, 'medic aura heals teammates nearby');
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
  // Shockwave Blaster
  const light = room.spawnZombie('runner', 'N', ''), heavy = room.spawnZombie('brute', 'N', '');
  light.pos = [-3, 0, -8]; heavy.pos = [3, 0, -8];
  light.hp = heavy.hp = 5000;
  p.st.p = [0, 0, -3];
  room.blast(p, [0, 1.6, -3], [0, 0, -1], { dmg: 10, cone: 120, blastRange: 9, push: 2.5 }, 1);
  const l0 = [...light.pos], h0 = [...heavy.pos];
  advance(room, 600);
  const lm = Math.hypot(light.pos[0] - l0[0], light.pos[2] - l0[2]), hm = Math.hypot(heavy.pos[0] - h0[0], heavy.pos[2] - h0[2]);
  assert.ok(lm > hm * 2, `light ${lm.toFixed(1)} vs heavy ${hm.toFixed(1)}`);
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

test('specialists: snipers camp and hit survivors harder, swoopers fly and dive, hexers blind, bloaters burst', () => {
  const room = started(new HoldoutRoom('Z', {}));
  const a = join(room, 'A'), p = a.player;
  room.startWave(8); room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  const keep = room.spawnZombie('shambler', 'S', ''); keep.pos = [44, 0, 44]; keep.frozenUntil = T + 1e9; keep.hp = keep.maxHp = 1e6; // keeps the wave going
  // sniper vs a survivor standing in the open
  const sv = room.survivors.spawnWounded({ x: 0, z: -20 }, 0); sv.state = 'active'; sv.pos = [0, 0, -20]; sv.post = [0, -20]; sv.postAt = T + 1e9;
  p.st.p = [40, 0, 40];
  const sn = room.spawnZombie('sniper', 'N', ''); sn.pos = [0, 0, -44]; sn.hist = [];
  const spawnAt = [...sn.pos], hp0 = sv.hp;
  advance(room, 7000);
  assert.ok(Math.hypot(sn.pos[0] - spawnAt[0], sn.pos[2] - spawnAt[2]) < 3, 'the sniper stays at its gate');
  assert.ok(a.all('zaim').length >= 1, 'it telegraphs its shots');
  assert.ok(hp0 - sv.hp >= 80, `survivor took ${hp0 - sv.hp}`);
  room.removeZombie(sn);
  room.survivors.perish(sv); // the swooper should go for the player
  // swooper
  p.st.p = [0, 0, -10];
  const sw = room.spawnZombie('swooper', 'N', ''); sw.pos = [0, 7, -30];
  let high = 0;
  const php = p.hp;
  for (let i = 0; i < 160 && p.hp === php; i++) { advance(room, 50); high = Math.max(high, sw.pos[1]); }
  assert.ok(high > 5, 'flies high');
  assert.ok(p.hp < php, 'dives into you');
  room.removeZombie(sw);
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
  // a sealed metal ring around the Core
  for (let x = -12; x < 12; x += 4) for (const zz of [-12, 12]) room.addPiece({ kind: 'wall', ...tile(x, zz), l: 0, o: 0, mat: 'metal' }, null);
  for (let zz = -12; zz < 12; zz += 4) for (const x of [-12, 12]) room.addPiece({ kind: 'wall', ...tile(x, zz), l: 0, o: 1, mat: 'metal' }, null);
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

test('Brood Titan: arrives after the wave-10 horde, riders are immune until they leap off or it dies', () => {
  const room = started(new HoldoutRoom('B', {}));
  const a = join(room, 'A'), p = a.player;
  p.st.p = [40, 0, 40];
  room.startWave(10);
  assert.ok(a.all('task').some(m => /BROOD TITAN/.test(m.text)), 'announced at the start of wave 10');
  room.director.queue = [];
  for (const z of [...room.zombies.values()]) room.removeZombie(z);
  advance(room, 200);
  assert.equal(room.phase, 'wave', 'the wave waits for the Titan');
  advance(room, 5200);
  const titan = [...room.zombies.values()].find(z => z.type === 'titan');
  assert.ok(titan, 'the Titan arrived');
  const riders = [...room.zombies.values()].filter(z => z.type === 'rider');
  assert.ok(riders.length >= 5 && riders.every(r => r.mount));
  assert.equal(room.damageZombie(riders[0], 100, p, 'ar'), 0, 'mounted riders cannot be hurt');
  advance(room, 18500);
  assert.ok(riders.some(r => !r.mount), 'riders leap down to fight');
  room.killZombie(titan, p, 'rocket');
  advance(room, 100);
  assert.ok(riders.every(r => r.dead || !r.mount), 'the rest fall off when it dies');
  assert.equal(room.bosses.smith, true, 'the Blacksmith unlocks');
  assert.equal(room.phase, 'wave', 'riders still have to be killed');
  for (const r of riders) if (!r.dead) room.killZombie(r, p, 'ar');
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
  assert.ok([...room.inventory.pickups.values()].some(pk => pk.item?.tier === 3 && pk.item?.el), 'the Maw drops a tier III elemental gun');
});

test('Blacksmith: forges tier III, infuses, fits attachments and upgrades turrets; map pings reach the squad', () => {
  const room = started(new HoldoutRoom('S', {}));
  const a = join(room, 'A'), b = join(room, 'B'), p = a.player;
  const gun = p.inv[1] = makeGun('ar');
  gun.tier = 2;
  p.money = 20000;
  p.mats.metal = 200;
  p.st.p = [SMITH.x + 1, 0, SMITH.z];
  room.handle(p, { t: 'smith', op: 'forge', uid: gun.uid });
  assert.equal(gun.tier, 2, 'no Blacksmith before the first Titan falls');
  room.bosses.smith = true;
  room.handle(p, { t: 'smith', op: 'forge', uid: gun.uid });
  assert.equal(gun.tier, 3);
  assert.equal(p.mats.metal, 140, 'tier III costs metal');
  room.handle(p, { t: 'smith', op: 'infuse', uid: gun.uid, el: 'ice' });
  assert.equal(gun.el, 'ice');
  room.handle(p, { t: 'smith', op: 'fit', uid: gun.uid, id: 'flashlight' });
  assert.equal(gun.att.rail, 'flashlight');
  room.handle(p, { t: 'smith', op: 'fit', uid: gun.uid, id: 'laser' });
  assert.equal(gun.att.rail, 'laser');
  assert.equal(countOf(p, 'flashlight'), 1, 'the swapped-out attachment goes back in the backpack');
  const d = { id: 99, type: 'turret', pos: [-6, 0, 6], pid: 0, side: 2, owner: p.id, uses: 0, ammo: 10, hp: 350, next: 0, until: 0 };
  room.defenses.list.set(d.id, d);
  for (let i = 0; i < 3; i++) room.handle(p, { t: 'smith', op: 'turret', def: 99, up: 'dmg' });
  assert.equal(d.mods.dmg, 2, 'damage upgrades stop at their cap');
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
  p.mats.wood = 500;
  p.st.p = [0, 0, -6];
  room.handle(p, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'wood' });
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
