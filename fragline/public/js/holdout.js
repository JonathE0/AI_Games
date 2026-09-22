// Zombie Holdout client: owns the horde view, built pieces (+ edits), harvest nodes, build / edit mode and all
// the world objects (loot, chests, supply drops, traps, survivors, the Colossus); handles every Holdout
// message; and drives the co-op HUD — wave + Core bar, lane compass, team list, hotbar, backpack and team
// chest, shop, boss bar, revive / use rings, name tags and the end-of-match report. The server is authoritative.
import * as THREE from 'three';
import { OUTPOST, OUTPOST_STATIC, CORE_LADDERS } from '/shared/outpost.js';
import { BMATS, MAT_IDS, REACH, distToBox, slotKey } from '/shared/build.js';
import { WAVES } from '/shared/zombies.js';
import { WEAPONS } from '/shared/weapons.js';
import { RARITY, AMMO, ITEMS, POWERUPS, BUFF, THROWABLES, SURVIVOR, SURVIVOR_CLASSES, ARMOR, CLASSES, SMITH, TURRET_TYPES, CORE_UP_IDS, BARRIER, adrenCarry, canBarrier } from '/shared/holdout.js';
import { HOTBAR, INV_SIZE, SACK_SIZE, ARMOR_SLOTS, countIn, itemName, armorStats, stackMax, fits } from '/shared/items.js';
import { SKY } from '/shared/skyboss.js';
import { rayWorld, blocked, bodyHeight, topAt, dirFromAngles } from '/shared/physics.js';
import { ZombieView } from './zombies.js';
import { Structures, Nodes, BuildMode, EditMode } from './build.js';
import { Entities } from './holdout_ents.js';
import { Props, Decor } from './props.js';
import { NightFx } from './night.js';
import { hotbarHTML, buyHTML, smithHTML, bankHTML, saveRecord, recordText } from './holdout_ui.js';
import { InventoryUI } from './inventory_ui.js';
import { Minimap } from './minimap.js';
import { GravekeeperView } from './boss_gravekeeper.js';
import { BehemothView } from './boss_behemoth.js';
import { KatanaView } from './katana.js';
import { setText, setHTML, setClass, setStyle, setHidden, hudReset, keyName, smartKey, smartRoute } from './hud.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const r2 = v => Math.round(v * 100) / 100;
const LANE_NAME = { N: 'NORTH', E: 'EAST', S: 'SOUTH', W: 'WEST' };
const LANE_POS = Object.fromEntries(OUTPOST.lanes.map(l => [l.id, [(l.zone[0] + l.zone[2]) / 2, (l.zone[1] + l.zone[3]) / 2]]));
const GLOB_GRAVITY = 12; // matches server/holdout/ai.js
const PIECE_NAME = { wall: 'WALL', floor: 'FLOOR', ramp: 'STAIR', cone: 'CONE', trap: 'TRAP', deploy: 'DEPLOY' };
const PIECE_KEYS = { bWall: 'wall', bFloor: 'floor', bStair: 'ramp', bCone: 'cone', bTrap: 'trap', bDeploy: 'deploy' }; // action -> BuildMode kind
const ZINK_TINT = 0x8fc9bf; // Zinkonium's pale blue-green — harvest sparks and bursts
const SB_HOLDOUT = '<tr><th>PLAYER</th><th>KILLS</th><th>DMG</th><th>BUILDS</th><th>REPAIRED</th><th>REVIVES</th><th>RESCUES</th><th>PING</th></tr>';
const POWER_BUFF = { p_damage: 'damage', p_rapid: 'rate', p_barrier: 'barrier' };
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const bearing = (from, x, z) => Math.atan2(-(x - from[0]), -(z - from[2])); // yaw that faces (x, z)
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const _v = new THREE.Vector3();
const hex = n => '#' + n.toString(16).padStart(6, '0');

function pickupName(pk) {
  if (pk.kind === 'it') return itemName({ id: pk.key, kind: pk.ik, r: pk.r, tier: pk.t, el: pk.el, n: pk.n }) + (pk.ik !== 'gun' && pk.ik !== 'armor' && pk.n > 1 ? ` ×${pk.n}` : '');
  if (pk.kind === 'svsupply') return 'survivor supplies';
  if (pk.kind === 'ammo') return `${AMMO[pk.key]?.name} ×${pk.n}`;
  return `${pk.key} ×${pk.n}`;
}

// A small tile of grayscale static for the Night Vision grain overlay (#fxNVGrain); generated once, jittered
// each frame by scrolling its background-position.
function noiseTile(n = 64) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(n, n);
  for (let i = 0; i < img.data.length; i += 4) { const v = (Math.random() * 255) | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL();
}

export class Holdout {
  constructor(game, welcome) {
    this.g = game;
    this.world = game.world;
    this.zombies = new ZombieView(game.world.scene, (kind, z) => this.onZombieEvent(kind, z));
    this.nodes = new Nodes(game.world.scene);
    this.structs = new Structures(game.world.scene, () => this.refreshBoxes());
    this.props = new Props(game.world.scene);
    this.decor = new Decor(game.world.scene); // cosmetic clutter only — no collision, never resets mid-match
    this.nightFx = new NightFx(game);
    this.nightK = 0;
    this.flashOn = false;
    this.flashOffThisNight = false; // a manual off during a night blocks that night's auto-on, not the next one
    this.nvK = 0;                   // Night Vision Goggles: eased 0..1 activation factor
    this.nvUp = false;              // flipped up (off) by the player
    this.nvWasActive = false;
    this.shadeStingAt = 0;          // global cooldown for the shade_sting jump-scare cue
    $('fxNVGrain').style.backgroundImage = `url(${noiseTile()})`;
    this.build = new BuildMode(game, this);
    this.edit = new EditMode(game, this);
    this.ents = new Entities(game.world, game.sound);
    this.globs = new Map();
    this.globGeo = new THREE.SphereGeometry(0.22, 10, 8);
    this.globMat = new THREE.MeshBasicMaterial({ color: 0x9dff3d });
    this.bombMat = new THREE.MeshBasicMaterial({ color: 0xff4fd8 });
    this.phys = { ladders: CORE_LADDERS };
    this.mats = Object.fromEntries(MAT_IDS.map(m => [m, 0]));
    this.ammo = {};
    this.items = {};                              // item id -> how many you carry (summed over the grid)
    this.inv = Array(INV_SIZE).fill(null);         // 0-5 hotbar, 6-23 backpack
    this.sack = Array(SACK_SIZE).fill(null);       // 4-slot consumables pouch
    this.armor = Object.fromEntries(ARMOR_SLOTS.map(s => [s, null]));
    this.cls = null;
    this.maxHp = 200;
    this.stash = { money: 0, mats: Object.fromEntries(MAT_IDS.map(m => [m, 0])), ammo: {}, items: [] };
    Object.assign(this, {
      phase: 'lobby', wave: 0, waves: WAVES, core: [1, 1], lanes: [], next: [], left: 0, end: 0, diff: welcome.diff || 'normal',
      downed: false, bleedEnd: 0, respawnAt: 0, roster: [], reviveId: null, reviveStart: 0, lastInteract: 0,
      alertUntil: 0, alertText: '', shadowAt: 0, shadowDirty: true, groanAt: 0, dusk: 0, shield: 0, carrying: null,
      activeThrow: null, payBank: false, hold: null, holdLock: false, coreHealer: null, buffs: {},
      task: null, shake: 0, bagAtChest: false, it: null, shopTab: 'shop', buyback: null, bankSel: null,
      teamUps: { vitality: 0, firepower: 0, engineering: 0, gunnery: 0 },
      coreLevel: 0, coreUps: Object.fromEntries(CORE_UP_IDS.map(id => [id, 0])),
      nvManualOn: false, adrenUntil: 0, adrenPulseAt: 0, rallyUntil: 0, rallyK: 0, coreMendAt: 0,
      bar: { want: false, blocked: false, hp: BARRIER.hp, cdUntil: 0 }, barrierUp: false,
    });
    this.tags = new Map();
    this.invUI = new InventoryUI(this);
    this.minimap = new Minimap(this);
    this.gk = new GravekeeperView(this); // wave 20's boss: pits, bolts, ward, his bell and scythe
    this.bhm = new BehemothView(this); // wave 25's boss: the walking fortress, its deck, hatch bolts and hearts
    this.kat = new KatanaView(this); // the Ronin's katana: its moves, cooldown pips and effects
    this.refreshBoxes();
    this.enterDom();
    game.hud.banner('ZOMBIE HOLDOUT', `Build, harvest with ${this.keyOr('inspect')}, shop at the Core, then press ${this.keyOr('ready')} when ready`, '', 5000);
  }

  get building() { return this.build.active; }
  // run speed on top of the weapon limit: class, Swift Step boots, the Slasher Blade in hand, a raised barrier
  get speedMult() {
    const st = this.as ?? (this.as = armorStats(this.armor)), slowed = this.pfx && this.g.now < this.pfx.slowUntil ? 1 - this.pfx.slow : 1;
    return (CLASSES[this.cls]?.speed ?? 1) * (1 + st.speed) * (this.g.weapons.w?.speedBuff ?? 1) * slowed * (this.barrierUp ? BARRIER.speed : 1);
  }
  get rateMult() { return (this.g.now < (this.buffs.rate || 0) ? BUFF.rate : 1) * (1 + 0.06 * (this.teamUps.gunnery || 0)); }
  get reloadMult() { return 1 + 0.1 * (this.teamUps.gunnery || 0); }
  blocksShooting() { return this.build.active || this.edit.active || this.downed || !!this.carrying || this.barrierUp; }
  targets() { return this.zombies.targets(); }
  skyTargets() { return this.ents.skyTargets(performance.now() / 1000); }
  balloonTargets() { return this.ents.balloonTargets(); }
  me() { return this.roster.find(p => p.id === this.g.me.id); }
  buffLeft(id) { const k = POWER_BUFF[id]; return k ? Math.max(0, (this.buffs[k] || 0) - this.g.now) : 0; }
  say(text, secs = 2.5) { this.g.hintMsg = text; this.g.hintUntil = this.g.now + secs; }
  noAmmo(w) { this.say(`Out of ${AMMO[w.ammo].name.toLowerCase()} — buy more at the Core or share from the team chest`); this.g.sound.play('dry', { vol: 0.6 }); }

  // Everything solid for you: the map, harvest nodes still standing, built pieces (doors open for players).
  refreshBoxes() {
    this.boxes = [...OUTPOST_STATIC, ...this.props.boxes, ...this.nodes.boxes, ...this.structs.boxes, ...this.bhm.boxes];
    this.g.boxes = this.g.moveBoxes = this.boxes;
    for (const r of this.g.remotes.values()) r.boxes = this.boxes;
    this.shadowDirty = true;
  }

  // Movement also collides with nearby zombie bodies (the horde can hem you in).
  moveBoxes() {
    if (this.phys.dash?.left > 0) return this.boxes; // the katana dash cuts through the horde
    const p = this.g.player.pos, near = this.zombies.boxesNear(p[0], p[2], 3, []);
    return near.length ? this.boxes.concat(near) : this.boxes;
  }

  placementWorld() {
    const trapped = [...this.ents.defs.values()].filter(d => d.side === 0).map(d => this.structs.list.get(d.pid)).filter(Boolean);
    return {
      slots: this.structs.slots, pieces: [...this.structs.list.values()].flatMap(p => p.boxes), statics: [...OUTPOST_STATIC, ...this.props.boxes, ...this.bhm.boxes], nodes: this.nodes.boxes,
      zombies: this.zombies.targets(), eye: this.g.player.eye, mats: this.mats, core: OUTPOST.core, zone: OUTPOST.zone, trapped: new Set(trapped.map(slotKey)),
    };
  }

  canBuy() {
    const pl = this.g.player;
    return pl.alive && !this.downed && Math.hypot(pl.pos[0] - OUTPOST.core.x, pl.pos[2] - OUTPOST.core.z) <= OUTPOST.buyRadius;
  }

  nearStash() { const p = this.g.player.pos; return Math.hypot(p[0] - OUTPOST.stash.x, p[2] - OUTPOST.stash.z) < OUTPOST.stash.reach + 0.6; }

  nearBanker() { const p = this.g.player.pos; return Math.hypot(p[0] - OUTPOST.banker.x, p[2] - OUTPOST.banker.z) < OUTPOST.banker.reach + 0.8; }

  // ---------- messages ----------
  onMsg(m) {
    const now = performance.now() / 1000;
    switch (m.t) {
      case 'sall': this.resetMatch(); this.structs.load(m.s); this.props.load(m.props || []); this.nodes.reset(m.nodes); this.refreshBoxes(); return;
      case 'sadd': for (const t of m.s) this.onPieceAdded(this.structs.add(t)); return;
      case 'supd':
        for (const u of m.s) {
          if (this.props.has(u[0])) { const r = this.props.setHp(u[0], u[2]); if (r && u[2] < r.prev - 1) this.propSound(r.p, 0.8); continue; }
          const r = this.structs.update(u);
          if (r && r.p.hp + r.p.grow < r.prevHp - 1) this.pieceSound(r.p, 'hit_', 0.9);
        }
        return;
      case 'sdel': {
        if (this.props.has(m.id)) { const p = this.props.remove(m.id); this.propGone(p, m.why); this.refreshBoxes(); return; }
        const p = this.structs.remove(m.id);
        if (p) this.pieceGone(p, m.why);
        return;
      }
      case 'sedit': { const p = this.structs.edit(m.id, m.mask, m.o); if (p) { this.pieceSound(p, 'build', 0.4); this.unstick(p.box); } return; }
      case 'node': if (this.nodes.setHp(m.id, m.hp)) this.refreshBoxes(); return;
      case 'harv': return this.feed(`+${m.n} ${BMATS[m.mat].name.toUpperCase()}${m.weak ? ' · WEAK POINT!' : ''}`, m.mat);
      case 'zsp': for (const z of m.z) this.zombies.spawn(z, now); return;
      case 'zdie': return this.onZombieDied(m);
      case 'zclear': this.zombies.clear(); this.clearGlobs(); return;
      case 'proj': return this.addGlob(m);
      case 'splat': return this.splat(m);
      case 'hphase': return this.onPhase(m);
      case 'hstat': if (m.core[0] > this.core[0]) this.coreMendAt = this.g.now; this.left = m.left; this.core = m.core; return; // rising: pulse the Core bar
      case 'coreHit': return this.onCoreHit(m);
      case 'pdown': return this.onDown(m);
      case 'prev': return this.onRevived(m);
      case 'pdie': return this.onPlayerDied(m);
      case 'hend': return this.onEnd(m);
      case 'grant': return this.g.weapons.onGrant(m.uid, m.n);
      case 'got': this.feed(`Picked up ${itemName(m.it)}${m.it.n > 1 ? ` ×${m.it.n}` : ''}`, m.it.kind === 'gun' ? 'r' + (m.it.r ?? 0) : ''); this.g.sound.play('pickup', { vol: 0.6 }); return;
      case 'pk': for (const t of m.l) this.ents.addPickup(t); return;
      case 'pkall': this.ents.clearPickups(); for (const t of m.l) this.ents.addPickup(t); return;
      case 'pkdel': this.ents.removePickup(m.id); return;
      case 'pkfall': for (const [id, y] of m.l) this.ents.fallPickup(id, y); return;
      case 'stash': this.stash = m.s; if (this.g.ui === 'bag') this.renderBag(); if (this.g.ui === 'buy') this.renderBuy(); return;
      case 'chests': return this.ents.setChests(m.l);
      case 'opened': this.g.sound.play('chest_chime', { pos: [m.x, 0.6, m.z], vol: 1, rate: 1.3 }); this.world.burst([m.x, 0.8, m.z], [0, 1, 0], 0xffd65a, 20, 4); return;
      case 'sdrop': this.ents.drop(m); return;
      case 'sdland': return this.ents.landDrop(m.id, m.y);
      case 'sddel': if (m.opened) { const d = this.ents.drops.get(m.id); if (d) this.world.burst([d.x, d.y + 1, d.z], [0, 1, 0], 0x6fb8ff, 24, 4); } return this.ents.removeDrop(m.id);
      case 'dadd': for (const t of m.l) this.ents.addDef(t); return;
      case 'dall': return this.ents.setDefs(m.l);
      case 'ddel': this.ents.removeDef(m.id); if (this.g.ui === 'smith') this.renderSmith(); return;
      case 'dfx': return this.ents.defFx(m.l, this.zombies);
      case 'corefx': return this.ents.coreFx(m.l, this.zombies);
      case 'thr': return this.ents.addThrown(m);
      case 'rkt': return this.ents.addRocket(m);
      case 'blast': this.ents.blastFx(m); if (m.by !== this.g.me.id) this.g.sound.play('shot_kinetic', { pos: m.o, vol: 1, ref: 4 }); return;
      case 'slam': return this.ents.slamFx(m);
      case 'bite': return this.ents.biteFx(m);
      case 'arc': return this.ents.arcFx(m.a, m.b);
      case 'etip': return this.explosiveTip(m.p);
      case 'zaim': this.ents.laser(m.id, m.a, m.p, m.ms, this.nightK > 0.3); { const z = this.zombies.list.get(m.id); if (z) this.g.sound.play('scope', { pos: z.pos, vol: 1, ref: 8, rate: 0.7 }); } return;
      case 'gsmash': { this.ents.golemSmash(m.p); const d = Math.hypot(m.p[0] - this.g.player.pos[0], m.p[2] - this.g.player.pos[2]); if (d < 12) this.shake = Math.max(this.shake, 1 - d / 12); return; }
      case 'zshot': this.g.world.tracer(m.a, m.b, 0xff4040); this.g.sound.play('shot_awp', { pos: m.a, vol: 1.3, ref: 12, roll: 0.6 }); return;
      case 'zdig': return this.ents.dig(m);
      case 'zup': this.world.burst(m.p, [0, 1, 0], 0x6b5237, 30, 5); this.g.sound.play('break_S', { pos: m.p, vol: 1, ref: 4 }); this.shake = Math.max(this.shake, 0.4); return;
      case 'hoardcash': this.world.burst(m.p, [0, 1, 0], 0xffd700, 40, 6); this.g.sound.play('cash', { pos: m.p, vol: 1 }); this.g.hud.banner('HOARDER DOWN', `+$${m.amt} for the squad!`, 'win', 3500); return;
      case 'hz': return this.ents.addHazard(m);
      case 'maw': this.onMaw(m); return;
      case 'grave': return this.gk.onMsg(m);
      case 'bhm': return this.bhm.onMsg(m);
      case 'thump': return this.ents.setThumpers(m.l);
      case 'stomp': { this.ents.stomp(m); const d = Math.hypot(m.p[0] - this.g.player.pos[0], m.p[2] - this.g.player.pos[2]); if (d < 18) this.shake = Math.max(this.shake, 1 - d / 18); return; }
      case 'boss': return this.onBoss(m);
      case 'berserk': return this.onBerserk(m);
      case 'smith': this.smithOn = !!m.on; if (m.on) this.ents.smithShow(SMITH); return;
      case 'ping': this.minimap.onPing(m); return;
      case 'dmod': { const d = this.ents.defs.get(m.id); if (d) { Object.assign(d, { mods: m.mods, ammo: m.ammo, hp: m.hp }); this.ents.defMods(d); } if (this.g.ui === 'smith') this.renderSmith(); return; }
      case 'pfx': return this.onEffects(m);
      case 'boom': this.shake = Math.max(this.shake, this.ents.boom(m, this.g.player.eye)); return;
      case 'svadd': return this.ents.svAdd(m.id, m.name, m.tier ?? 0, m.cls);
      case 'svs': this.ents.svState(m.l, m.shots); return;
      case 'svdie': this.ents.svDie(m.id); this.alert(`SURVIVOR ${String(m.name).toUpperCase()} PERISHED`, 3); this.g.sound.play('lose', { vol: 0.4 }); return;
      case 'sky': this.ents.skyStart(m, now); this.g.hud.banner('THE COLOSSUS', 'Snipe its glowing weak points (SSG 08 / AWP)', 'lose', 5000); return;
      case 'skyhit': this.ents.skyHit(m.i, m.hp); if (m.by === this.g.me.id) this.g.sound.play('headshot', { vol: 0.8 }); return;
      case 'skydie': this.ents.skyDie(); this.g.hud.banner('COLOSSUS DOWN', `${this.g.name(m.by)} broke the last weak point · loot dropped`, 'win', 4500); return;
      case 'skyback': this.ents.skyBack(m.i); return;
      case 'task': this.task = { text: m.text, until: this.g.now + 14 }; this.g.hud.banner('NEW TASK', m.text, '', 4500); this.g.sound.play('round_start', { vol: 0.5 }); return;
      case 'coreheal': this.coreHealer = m.id; return;
      case 'bar': return this.onBarrier(m);
      case 'kat': return this.kat.onMsg(m);
      case 'vit': {
        const dHp = m.hp - this.g.me.hp, dSh = m.sh - this.shield;
        this.g.me.hp = m.hp; this.shield = this.g.me.armor = m.sh; // me.armor is the HUD's SHIELD number
        if (m.rally) { this.rallyUntil = this.g.now + 0.6; this.rallyTick(dHp, dSh); }
        return;
      }
      case 'boost': this.adrenUntil = this.g.now + m.ms / 1000; this.adrenPulseAt = this.g.now; this.g.sound.play('inject', { vol: 0.6 }); return;
      case 'buffs':
        for (const k of ['damage', 'rate', 'barrier']) this.buffs[k] = this.g.now + (m[k] || 0) / 1000;
        if (m.damage || m.rate || m.barrier) this.g.sound.play('win', { vol: 0.4, rate: 1.4 });
        return;
      case 'teamups': this.teamUps = m.ups; if (this.g.ui === 'buy') this.renderBuy(); return;
      case 'coreups': this.coreLevel = m.level; this.coreUps = m.ups; if (this.g.ui === 'buy') this.renderBuy(); return;
    }
  }

  onBin(buf) { this.zombies.snapshot(buf, performance.now() / 1000); }

  onInv(m) {
    Object.assign(this, { mats: m.mats || this.mats, ammo: m.ammo || this.ammo, shield: m.shield || 0 });
    if (m.inv) this.inv = m.inv;
    if (m.sack) this.sack = m.sack;
    if (m.inv || m.sack) {
      this.items = {};
      for (const it of [...this.inv, ...this.sack]) if (it && it.kind !== 'gun' && it.kind !== 'armor') this.items[it.id] = (this.items[it.id] || 0) + (it.n ?? 1);
    }
    if (m.gear) { this.armor = m.gear; this.as = armorStats(this.armor); }
    if (m.maxHp) this.maxHp = m.maxHp;
    if (m.cls !== undefined) this.cls = m.cls;
    if (m.buyback !== undefined) this.buyback = m.buyback;
    this.g.weapons.pool = this.ammo;
    const was = this.downed;
    this.downed = !!m.downed && m.alive;
    if (this.downed && !was) { this.build.toggle(false); this.edit.stop(); }
    if (m.carrying !== undefined) this.carrying = m.carrying;
    if (this.activeThrow && !(this.items[this.activeThrow] > 0)) this.activeThrow = null;
    this.activeThrow ??= THROWABLES.find(id => this.items[id] > 0) ?? null;
    if (this.g.ui === 'bag') this.renderBag();
    if (this.g.ui === 'smith') this.renderSmith();
    if (this.g.ui === 'bank') this.renderBank();
    if (this.g.ui === 'buy') this.renderBuy();
  }

  // weapons.js view of the hotbar: guns by weapon id, anything else held as 'hold_item'
  hotbarSlots() {
    const out = {};
    for (let i = 0; i < HOTBAR; i++) {
      const it = this.inv[i];
      out[i + 1] = !it ? null : it.kind === 'gun' ? { w: it.id, uid: it.uid, r: it.r, mag: it.mag, item: it } : { w: 'hold_item', uid: it.uid, item: it };
    }
    return out;
  }

  // key name of an action's first binding, for HUD labels and hints
  key(id) { return keyName(this.g.hud.settings.binds[id]?.[0]); }
  // same, spelled out for use inside a sentence (key()'s bare '—' reads oddly there)
  keyOr(id) { const k = this.key(id); return k === '—' ? '(unbound)' : k; }
  // key names for hotbar slots 1-6 and the harvest tool
  hotkeys() { return ['primary', 'secondary', 'knife', 'slot4', 'slot5', 'slot6', 'inspect'].map(id => this.key(id)); }

  heldItem() { const W = this.g.weapons; return W.slot >= 1 ? this.inv[W.slot - 1] ?? null : null; }

  // LMB with a non-gun item in hand: throw it, use it, place it, wear it
  useHeld() {
    const it = this.heldItem();
    if (!it || it.kind === 'gun') return false;
    if (it.kind === 'throw') { this.activeThrow = it.id; this.throwItem(); }
    else if (it.kind === 'adrenaline') this.useAdrenaline();
    else if (it.kind === 'trap' || it.kind === 'deploy') { this.build.pick[it.kind] = it.id; this.build.select(it.kind); }
    else if (it.kind === 'armor') this.g.net.send({ t: 'move', from: 'i' + (this.g.weapons.slot - 1), to: 'a:' + ARMOR[it.id].slot });
    else if (it.kind === 'attach') this.say(`Open your inventory (${this.key('backpack')}) and drop it on a gun to fit it`);
    return true;
  }

  hasFlashlight() { const it = this.heldItem(); return it?.kind === 'gun' && it.att?.light === 'flashlight'; }

  nextThrow() {
    const owned = THROWABLES.filter(id => this.items[id] > 0);
    if (!owned.length) return this.say('No throwables — buy grenades, molotovs or freezes at the Core');
    this.activeThrow = owned[(owned.indexOf(this.activeThrow) + 1) % owned.length];
    this.say(`${this.keyOr('throw')} throws: ${ITEMS[this.activeThrow].name} ×${this.items[this.activeThrow]}`, 1.5);
    this.g.sound.play('tick', { vol: 0.4 });
  }

  onRoster(players) {
    this.roster = players;
    for (const p of players) {
      const r = this.g.remotes.get(p.id);
      if (r) { if (!p.alive) { if (r.alive) r.kill(); } else r.setDowned(p.downed); }
    }
  }

  onSelfSpawn() {
    this.respawnAt = 0;
    this.downed = false;
  }

  onPhase(m) {
    const prev = this.phase, hud = this.g.hud;
    Object.assign(this, { phase: m.phase, wave: m.wave, lanes: m.lanes, next: m.next, core: m.core, left: m.left, end: this.g.now + m.endsIn / 1000, night: !!m.night, nextNight: !!m.nextNight, boss: m.boss, nextBoss: m.nextBoss, waveEnd: m.waveEndsIn ? this.g.now + m.waveEndsIn / 1000 : 0 });
    const names = l => l.map(id => LANE_NAME[id]).join(' · ');
    if (m.phase === 'countdown' && prev !== 'countdown') {
      hud.banner('GAME STARTING', 'Everyone to the Core!', '', 3000);
      this.g.sound.play('round_start', { vol: 0.6 });
    } else if (m.phase === 'prep' && prev !== 'prep') {
      hud.banner('FORTIFY THE CORE', `Build, harvest and shop — wave 1 comes from ${names(m.next)} in ${Math.round(m.endsIn / 1000)}s`, '', 5000);
      this.g.sound.play('wave_horn', { vol: 0.5, rate: 1.2 });
    } else if (m.phase === 'wave' && prev !== 'wave') {
      const boss = { sky: 'THE COLOSSUS WAVE', titan: 'TWO BROOD TITANS WAVE', maw: 'THE MAW WAVE', grave: 'THE GRAVEKEEPER WAVE', behemoth: 'THE BEHEMOTH WAVE' }[m.boss];
      hud.banner(boss ?? `WAVE ${m.wave}`, `${m.night ? 'NIGHT · ' : ''}Incoming: ${names(m.lanes)}`, 'lose', 3500);
      this.g.sound.play('wave_horn', { vol: 0.9 });
    } else if (m.phase === 'intermission' && prev === 'wave') {
      hud.banner(`WAVE ${m.wave} CLEARED`, `Break: ${Math.round(m.endsIn / 1000)}s · next from ${names(m.next)}`, 'win', 4000);
      this.g.sound.play('win', { vol: 0.5 });
    } else if (m.phase === 'lobby' && (prev === 'victory' || prev === 'defeat')) {
      hud.banner('MAP RESET', `New match — press ${this.keyOr('ready')} when ready`, '', 4000); // the stats panel stays up until the next game starts
    }
    if (m.phase === 'countdown') $('hoEnd').hidden = true;
    if (m.phase !== 'wave') { this.ents.skyEnd(); this.gk.clear(); }
    if (m.phase !== 'wave' && this.bhm.alive) this.bhm.clear(); // the Core fell with it still standing
    const st = {};
    for (const id of m.next) st[id] = 1;
    for (const id of m.lanes) st[id] = 2;
    this.world.setLanes(st);
  }

  // A fresh world arrives (joining, or the next match after one ended): nothing from before may linger.
  resetMatch() {
    this.ents.clearAll();
    this.ents.bankerShow(); // the Banker is always present, including the lobby
    this.zombies.clear();
    this.clearGlobs();
    this.world.clearDecals();
    this.world.setNight(0);
    this.nightK = 0;
    this.flashOn = false;
    this.flashOffThisNight = false;
    this.nvUp = false;
    this.nvManualOn = false;
    this.nvWasActive = false;
    this.shadeStingAt = 0;
    this.nvK = 0;
    this.applyNV();
    this.build.toggle(false);
    this.edit.stop();
    Object.assign(this, {
      pfx: null, task: null, buffs: {}, alertUntil: 0, downed: false, carrying: null, hold: null, holdLock: false,
      reviveId: null, coreHealer: null, shake: 0, respawnAt: 0, spectate: null, it: null, buyback: null, bankSel: null,
      teamUps: { vitality: 0, firepower: 0, engineering: 0, gunnery: 0 },
      coreLevel: 0, coreUps: Object.fromEntries(CORE_UP_IDS.map(id => [id, 0])),
      adrenUntil: 0, adrenPulseAt: 0, rallyUntil: 0, rallyK: 0, coreMendAt: 0,
      bar: { want: false, blocked: false, hp: BARRIER.hp, cdUntil: 0 }, barrierUp: false,
    });
    if (this.g.ui === 'bag') this.closeBag();
    if (this.g.ui === 'smith') this.closeSmith();
    if (this.g.ui === 'bank') this.closeBank();
    this.minimap.reset();
    this.gk.clear();
    this.bhm.clear();
    this.kat.reset();
    this.phys.dash = null;
    this.smithOn = false;
    $('skyBackMark').hidden = true;
    $('deathCam').hidden = true;
    $('hoFeed').innerHTML = '';
    $('killfeed').innerHTML = '';
    for (const el of this.tags.values()) el.remove();
    this.tags.clear();
    this.world.setLanes({});
    hudReset();
  }

  onPieceAdded(p) {
    this.pieceSound(p, 'build', 0.7);
    this.unstick(p.box);
    this.build.sent.clear();
  }

  pieceGone(p, why) {
    const c = [0, 1, 2].map(i => (p.box.min[i] + p.box.max[i]) / 2), fell = why === 'broken' || why === 'collapse';
    this.pieceSound(p, fell ? 'break_' : 'build', fell ? 1 : 0.4);
    for (let i = 0; i < (why === 'collapse' ? 6 : 3); i++) this.world.burst([c[0] + (Math.random() - 0.5) * 2, c[1] + (Math.random() - 0.5), c[2] + (Math.random() - 0.5) * 2], [0, why === 'collapse' ? -1 : 1, 0], 0xb8a58a, 6, 3);
    this.world.clearDecalsIn(p.box);
  }

  // map props: wood planks/crates sound like wood, roofs like metal, concrete like stone
  propSound(p, vol, prefix = 'hit_') {
    const c = [0, 1, 2].map(i => (p.box.min[i] + p.box.max[i]) / 2), code = { w: 'W', d: 'W', h: 'Z', c: 'S' }[p.box.mat] ?? 'S';
    this.g.sound.play(prefix + code, { pos: c, vol, ref: 3, roll: 1.1, muffle: this.g.occluded(c) ? 1400 : 0 });
  }

  propGone(p, why) {
    if (!p) return;
    const b = p.box, c = [0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2), size = Math.max(1, (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) * (b.max[1] - b.min[1]));
    this.propSound(p, 1.1, 'break_');
    const color = { w: 0x9c6a3a, d: 0xe6dcc2, h: 0x485963, c: 0xb9b2a4 }[b.mat] ?? 0xb8a58a;
    for (let i = 0; i < Math.min(8, 2 + size / 3); i++) this.world.burst([b.min[0] + Math.random() * (b.max[0] - b.min[0]), c[1], b.min[2] + Math.random() * (b.max[2] - b.min[2])], [0, why === 'collapse' ? -1 : 1, 0], color, 8, 3.5);
    this.world.clearDecalsIn(b);
    this.shadowDirty = true;
  }

  pieceSound(p, name, vol) {
    const c = [0, 1, 2].map(i => (p.box.min[i] + p.box.max[i]) / 2);
    const s = name.endsWith('_') ? name + BMATS[p.mat].code : name;
    this.g.sound.play(s, { pos: c, vol, ref: 3, roll: 1.1, muffle: this.g.occluded(c) ? 1400 : 0 });
  }

  // A piece appeared (or changed) on top of you: ride it up (ramp rush) or step out of it.
  unstick(b) {
    const pl = this.g.player, h = bodyHeight(pl.crouch), pp = this.g.prevPos;
    if (!pl.alive || !blocked(pl.pos[0], pl.pos[1], pl.pos[2], h, this.structs.boxes.filter(x => x.sid === b.sid))) return;
    const top = topAt(b, pl.pos[0], pl.pos[2]);
    if (top - pl.pos[1] < 3.4 && !blocked(pl.pos[0], top + 0.01, pl.pos[2], h, this.boxes)) {
      pl.pos[1] = pp[1] = top + 0.01;
      pl.vel[1] = Math.max(0, pl.vel[1]);
      return;
    }
    const r = 0.42, opts = [[b.min[0] - r, pl.pos[2]], [b.max[0] + r, pl.pos[2]], [pl.pos[0], b.min[2] - r], [pl.pos[0], b.max[2] + r]];
    opts.sort((a, c) => Math.hypot(a[0] - pl.pos[0], a[1] - pl.pos[2]) - Math.hypot(c[0] - pl.pos[0], c[1] - pl.pos[2]));
    for (const [x, z] of opts) if (!blocked(x, pl.pos[1], z, h, this.boxes)) { pl.pos[0] = pp[0] = x; pl.pos[2] = pp[2] = z; return; }
  }

  onZombieDied(m) {
    if (m.silent) { this.zombies.remove(m.id); return; } // Hoarder finishing its escape: just gone, no death fx
    const killer = m.by === this.g.me.id ? this.g.player.pos : this.g.remotes.get(m.by)?.pos;
    const zb0 = this.zombies.list.get(m.id);
    const dir = killer && zb0 ? [zb0.pos[0] - killer[0], 0, zb0.pos[2] - killer[2]] : null;
    const zb = this.zombies.die(m.id, dir);
    if (!zb) return;
    this.g.sound.play('z_die', { pos: [zb.pos[0], zb.pos[1] + 1.5 * zb.s, zb.pos[2]], vol: zb.t.boss ? 1.4 : 0.9, ref: 3, rate: zb.t.boss ? 0.6 : 0.9 + Math.random() * 0.2 });
    if (!m.by) return;
    const mine = m.by === this.g.me.id;
    const who = String(m.by).startsWith('sv') ? `${this.ents.survivors.get(+String(m.by).slice(2))?.name ?? 'Survivor'} (survivor)` : this.g.name(m.by);
    const weapon = WEAPONS[m.w] ? m.w : ITEMS[m.w]?.name ?? (/^sv\d$/.test(m.w) ? SURVIVOR.tiers[+m.w[2]]?.gun : m.w);
    this.g.hud.kill(who, zb.t.name, weapon, m.hs, false, mine);
    if (mine && !m.hs) this.g.sound.play('kill', { vol: 0.35 });
    if (zb.t.boss) this.g.hud.banner(`${zb.t.name.toUpperCase()} DOWN`, `${who} landed the final blow · loot dropped`, 'win', 3000);
  }

  onZombieEvent(kind, zb) {
    const me = this.g.player.pos, d = Math.hypot(zb.pos[0] - me[0], zb.pos[2] - me[2]);
    if (d > 30) return;
    const pos = [zb.pos[0], zb.pos[1] + 1.5 * zb.s, zb.pos[2]];
    if (kind === 'wind') {
      if (zb.type === 'swooper') this.g.sound.play('brute_roar', { pos, vol: 1, ref: 6, rate: 1.8 }); // screech: locked onto a target, diving in a beat
      else if ((zb.type === 'brute' || zb.type === 'alpha') && Math.random() < 0.5) this.g.sound.play('brute_roar', { pos, vol: 1.2, ref: 4, rate: zb.type === 'alpha' ? 0.8 : 1 });
      else this.g.sound.play('z_swipe', { pos, vol: 0.9, ref: 2.5, rate: 0.9 + Math.random() * 0.25 });
    }
  }

  // Hoarders leave a trail of gold dust as they sprint for the Core — hard to miss, easy to follow.
  hoarderTrail(dt) {
    for (const zb of this.zombies.list.values()) {
      if (zb.dead || zb.type !== 'hoarder') continue;
      zb.trailAt = (zb.trailAt ?? 0) - dt;
      if (zb.trailAt > 0) continue;
      zb.trailAt = 0.08;
      this.world.burst([zb.pos[0], zb.pos[1] + 0.3, zb.pos[2]], [0, 1, 0], 0xffd700, 2, 1.2);
    }
  }

  onCoreHit(m) {
    this.world.coreHit();
    this.g.sound.play('core_alarm', { vol: 0.45 });
    let where = '';
    if (m.from) {
      const b = Math.atan2(-m.from[0], -m.from[1]); // bearing from the Core
      where = ' — ' + OUTPOST.lanes.reduce((best, l) => (Math.abs(wrap(l.yaw - b)) < Math.abs(wrap(best.yaw - b)) ? l : best)).name + ' SIDE';
    }
    this.alert(`CORE UNDER ATTACK${where}`);
  }

  alert(text, secs = 3) { this.alertText = text; this.alertUntil = this.g.now + secs; }

  // Rally Fire feedback: a floating "+HP" / "+SHIELD" tick beside the vitals boxes.
  rallyTick(dHp, dSh) {
    if (dHp > 0) this.floatTick('hp', `+${Math.round(dHp)}`);
    if (dSh > 0) this.floatTick('armor', `+${Math.round(dSh)}`);
  }

  floatTick(vitalId, text) {
    const el = $(vitalId)?.closest('.vital');
    if (!el) return;
    const d = document.createElement('div');
    d.className = 'vitalTick';
    d.textContent = text;
    el.append(d);
    setTimeout(() => d.remove(), 900);
  }

  onDown(m) {
    if (m.id === this.g.me.id) {
      this.downed = true;
      this.bleedEnd = this.g.now + m.bleed / 1000;
      this.build.toggle(false);
      this.edit.stop();
      this.g.weapons.cancelReload();
      this.g.weapons.scope = 0;
      this.g.sound.play('downed', { vol: 0.7 });
    } else {
      this.g.remotes.get(m.id)?.setDowned(true);
      this.g.hud.chat(null, `${this.g.name(m.id)} is down! Hold ${this.keyOr('interact')} next to them to revive`);
      this.alert(`${this.g.name(m.id).toUpperCase()} IS DOWN`, 2.5);
    }
  }

  onRevived(m) {
    if (m.id === this.g.me.id) {
      this.downed = false;
      this.g.sound.play('revive', { vol: 0.6 });
      this.feed(m.by ? `Revived by ${this.g.name(m.by)}` : 'Back on your feet');
    } else {
      this.g.remotes.get(m.id)?.setDowned(false);
      if (m.by === this.g.me.id) { this.g.sound.play('revive', { vol: 0.6 }); this.feed(`You revived ${this.g.name(m.id)}`); }
    }
    this.reviveId = null;
  }

  onPlayerDied(m) {
    if (m.id === this.g.me.id) {
      this.downed = false;
      this.respawnAt = 0;
      this.spectate = null;
      this.build.toggle(false);
      this.edit.stop();
      this.g.weapons.cancelReload();
      this.g.weapons.scope = 0;
      this.g.deathMsg = m.by === 'bleeding out' ? 'You bled out' : `Killed by ${m.by || 'the horde'}`;
      $('deathCam').hidden = false;
      this.g.sound.play('death', { vol: 0.7 });
      if (this.g.ui === 'buy') this.g.toggleBuy(false);
      if (this.g.ui === 'bag') this.closeBag();
    } else {
      this.g.remotes.get(m.id)?.kill();
      this.g.hud.chat(null, `${this.g.name(m.id)} is out until the wave is cleared`);
    }
  }

  onEnd(m) {
    const survived = Math.max(0, m.wave - 1), rec = saveRecord(survived), title = 'DEFEAT';
    const why = m.why === 'wipe' ? `The whole squad went down on wave ${m.wave}` : `The Core fell on wave ${m.wave}`;
    this.g.hud.banner(title, why, 'lose', 6000);
    this.g.sound.play(m.win ? 'win' : 'lose', { vol: 0.7 });
    const best = key => { const top = [...m.stats].sort((a, b) => b[key] - a[key])[0]; return top && top[key] > 0 ? top.id : null; };
    const awards = [['kills', 'Exterminator'], ['builds', 'Architect'], ['revives', 'Medic'], ['harvested', 'Harvester'], ['rescues', 'Rescuer']];
    const mvp = {};
    for (const [k, a] of awards) { const id = best(k); if (id) (mvp[id] ??= []).push(a); }
    $('hoEndTitle').textContent = title;
    $('hoEnd').className = m.win ? 'win' : 'lose';
    $('hoEndSub').textContent = `${why} · survived ${survived} wave${survived === 1 ? '' : 's'}` + (rec.isNew ? ' · NEW PERSONAL BEST!' : rec.best ? ` · record ${rec.best.survived}` : '');
    $('hoEndTable').innerHTML = '<tr><th>PLAYER</th><th>KILLS</th><th>DMG</th><th>BUILDS</th><th>REPAIRED</th><th>REVIVES</th><th>RESCUES</th><th>MATS</th></tr>' + m.stats.map(s =>
      `<tr class="${s.id === this.g.me.id ? 'me' : ''}"><td>${esc(s.name)}${(mvp[s.id] || []).map(a => `<em>${a}</em>`).join('')}</td><td>${s.kills}</td><td>${s.dmg}</td><td>${s.builds}</td><td>${s.repaired}</td><td>${s.revives}</td><td>${s.rescues || 0}</td><td>${s.harvested}</td></tr>`).join('');
    $('hoEnd').hidden = false;
    $('hoBest').textContent = recordText();
  }

  // Dead in a wave: follow a living teammate (click to switch) until everyone is brought back.
  spectateCam(cam) {
    const alive = this.roster.filter(p => p.id !== this.g.me.id && p.alive && this.g.remotes.get(p.id));
    if (!alive.length) return false;
    if (!alive.some(p => p.id === this.spectate)) this.spectate = alive[0].id;
    const r = this.g.remotes.get(this.spectate), yaw = r.yaw ?? 0;
    const back = [Math.sin(yaw) * 3.2, 2.3, Math.cos(yaw) * 3.2];
    cam.position.set(r.pos[0] + back[0], r.pos[1] + back[1], r.pos[2] + back[2]);
    cam.lookAt(r.pos[0], r.pos[1] + 1.4, r.pos[2]);
    return true;
  }

  cycleSpectate() {
    const alive = this.roster.filter(p => p.id !== this.g.me.id && p.alive);
    if (alive.length < 2) return;
    const i = alive.findIndex(p => p.id === this.spectate);
    this.spectate = alive[(i + 1) % alive.length].id;
  }

  // ---------- harvesting (called by the knife) ----------
  // Returns true when the swing hit a tree/rock/wreck/crate, a map prop or a built piece (the server decides
  // whose pieces you may break).
  harvestSwing(eye, dir, reach) {
    if (this.bhm.swing(eye, dir, reach)) return true; // a bolt on one of the Behemoth's hatches
    const hit = rayWorld(eye, dir, reach, [...this.nodes.boxes, ...this.props.boxes, ...this.structs.boxes]);
    if (hit?.box.sid !== undefined) {
      if (this.phase === 'lobby' || this.phase === 'countdown') { this.say('Wait for the game to start before breaking things'); return false; }
      const p = eye.map((v, j) => v + dir[j] * hit.t);
      this.g.net.send({ t: 'harvest', sid: hit.box.sid });
      this.g.sound.play('chop_zink', { vol: 0.8, rate: 0.9 + Math.random() * 0.2 });
      this.world.burst(p, hit.n, ZINK_TINT, 6, 2.5);
      return true;
    }
    if (!hit || hit.box.node === undefined) return false;
    if (this.phase === 'lobby' || this.phase === 'countdown') { this.say('Wait for the game to start before harvesting'); return false; }
    const n = this.nodes.nodes[hit.box.node], p = eye.map((v, j) => v + dir[j] * hit.t);
    const nodes = this.nodes;
    let weak = false;
    if (nodes.weakNode === n.id && nodes.weak.visible) weak = nodes.weak.position.distanceTo(_v.set(...p)) < 0.45;
    if (weak || nodes.weakNode !== n.id) nodes.placeWeak(n, eye);
    this.g.net.send({ t: 'harvest', id: n.id, weak });
    this.g.sound.play(weak ? 'weak_hit' : 'chop_zink', { vol: 0.8, rate: 0.9 + Math.random() * 0.2 });
    if (weak) this.g.sound.play('chop_zink', { vol: 0.6 });
    this.world.burst(p, hit.n, ZINK_TINT, weak ? 12 : 6, 2.5);
    return true;
  }

  skyFlash(i, p) { this.world.burst(p, [0, 1, 0], 0xff4fd8, 10, 3); }

  // ---------- acid globs + sky bombs ----------
  addGlob(m) {
    const bomb = m.k === 'bomb', mesh = new THREE.Mesh(this.globGeo, bomb ? this.bombMat : this.globMat);
    if (bomb) mesh.scale.setScalar(3);
    mesh.position.set(...m.o);
    this.world.scene.add(mesh);
    this.globs.set(m.id, { mesh, pos: [...m.o], vel: [...m.v], bomb });
    this.g.sound.play(bomb ? 'brute_roar' : 'spit', { pos: m.o, vol: bomb ? 0.8 : 0.9, ref: bomb ? 20 : 3, rate: bomb ? 0.6 : 1 });
  }

  updateGlobs(dt) {
    for (const [id, gl] of this.globs) {
      gl.vel[1] -= GLOB_GRAVITY * dt;
      for (let i = 0; i < 3; i++) gl.pos[i] += gl.vel[i] * dt;
      gl.mesh.position.set(...gl.pos);
      if (gl.pos[1] < -1) this.removeGlob(id);
    }
  }

  onBoss(m) {
    const hud = this.g.hud;
    if (m.ev === 'titanwarn') {
      const two = (m.n ?? 1) > 1;
      hud.banner(two ? 'TWO BROOD TITANS' : 'THE BROOD TITAN', `${two ? 'They are' : 'It is'} coming — riders can't be hurt until they jump off`, 'lose', 5000);
      this.g.sound.play('wave_horn', { vol: 1, rate: 0.6 });
    } else if (m.ev === 'titan') { this.g.sound.play('sky_roar', { vol: 1.2, rate: 0.6 }); this.task = { text: 'BROOD TITAN: shoot the glowing egg sac on its back (double damage) · its riders fall when it dies', until: this.g.now + 20 }; }
    else if (m.ev === 'leap') { const z = this.zombies.list.get(m.id); if (z) this.g.sound.play('brute_roar', { pos: z.pos, vol: 0.8, ref: 5, rate: 1.4 }); }
    else if (m.ev === 'mdrop') this.ents.mdropFx(m.p);
    else if (m.ev === 'titandie') { hud.banner((m.left ?? 0) > 0 ? 'A BROOD TITAN DOWN' : 'BROOD TITAN DOWN', 'It dropped the Brood Launcher!', 'win', 5000); this.g.sound.play('win', { vol: 0.6 }); }
  }

  // Wave time limit ran out: every zombie still alive goes berserk; reinforcements trickle in until the last
  // one dies, then the wave clears like normal (server: director.js).
  onBerserk(m) {
    const hud = this.g.hud;
    if (m.ev === 'start') { hud.banner("TIME'S UP", 'THE HORDE GOES BERSERK! Kill the stragglers to end the wave', 'lose', 6000); this.g.sound.play('wave_horn', { vol: 1, rate: 0.5 }); }
  }

  onMaw(m) {
    const hud = this.g.hud;
    this.shake = Math.max(this.shake, this.ents.mawEvent(m, this.g.now));
    if (m.ev === 'enter') { hud.banner('THE MAW', 'The ground trembles… it is hunting beneath the Outpost', 'lose', 6000); this.shake = 1; }
    else if (m.ev === 'lured') hud.banner('IT\'S EXPOSED', 'Shoot the glowing throat!', 'win', 3000);
    else if (m.ev === 'devour') { hud.banner('THE MAW GOES FOR THE CORE', 'Arm the thumpers or blast its throat to stop it!', 'lose', 5000); this.alert('THE MAW IS DEVOURING THE CORE', 12); }
    else if (m.ev === 'interrupt') this.alert('IT RECOILS!', 2);
    else if (m.ev === 'stage') hud.banner(m.stage === 2 ? 'THE MAW IS ENRAGED' : 'THE MAW IS STARVING', m.stage === 2 ? 'It spews parasites when it erupts' : 'It will go for the Core', 'lose', 3500);
    else if (m.ev === 'die') { hud.banner('THE MAW IS DEAD', `${this.g.name(m.by) || 'The squad'} landed the killing shot · loot dropped`, 'win', 5000); this.g.sound.play('win', { vol: 0.7 }); }
  }

  mawTargets() { return this.ents.mawTargets(); }

  // burning / slowed / blinded (server/holdout/behaviors.js playerEffect)
  onEffects(m) {
    const now = this.g.now;
    this.pfx = { burnUntil: now + (m.burn || 0) / 1000, slow: m.slow ? m.slow[0] : 0, slowUntil: m.slow ? now + m.slow[1] / 1000 : 0, blindUntil: now + (m.blind || 0) / 1000 };
    if (m.blind > 0) this.g.sound.play('splat', { vol: 0.8, rate: 0.7 });
  }

  splat(m) {
    if (m.ink) { this.world.burst(m.p, [0, 1, 0], 0x2a0f3a, 30, 3.5); this.g.sound.play('splat', { pos: m.p, vol: 1, rate: 0.6, ref: 3 }); this.removeGlob(m.id); return; }
    if (m.big) { this.world.burst(m.p, [0, 1, 0], 0x9dff3d, 50, 6); this.g.sound.play('splat', { pos: m.p, vol: 1.4, rate: 0.8, ref: 5 }); return; }
    const gl = this.globs.get(m.id), bomb = gl?.bomb;
    this.removeGlob(m.id);
    this.g.sound.play(bomb ? 'explode' : 'splat', { pos: m.p, vol: bomb ? 1.4 : 1, ref: bomb ? 6 : 3 });
    this.world.burst(m.p, [0, 1, 0], bomb ? 0xff4fd8 : 0x9dff3d, bomb ? 40 : 16, bomb ? 6 : 3.5);
  }

  removeGlob(id) {
    const gl = this.globs.get(id);
    if (!gl) return;
    this.world.scene.remove(gl.mesh);
    this.globs.delete(id);
  }

  clearGlobs() { for (const id of [...this.globs.keys()]) this.removeGlob(id); }

  // ---------- input ----------
  // Returns true when the action was used by the Holdout (build/edit mode, hotbar, items, E, ready…).
  onAction(act, code) {
    const b = this.build, e = this.edit, g = this.g, pl = g.player, W = g.weapons;
    if (act === 'ready') { this.toggleReady(); return true; }
    if ((act === 'interact' || act === 'backpack') && smartKey(g.hud.settings.binds, code)) { // one key for Use and Inventory
      if (smartRoute(false, pl.alive && !this.downed ? this.interactTarget() : null) === 'use') this.pressInteract(); // holds run from interact()
      else this.openBag(false);
      return true;
    }
    if (act === 'backpack') { this.openBag(false); return true; }
    if (act === 'map') { this.minimap.toggle(true); return true; }
    const needsBody = ['edit', 'interact', 'throw', 'nextThrow', 'slot4', 'slot5', 'slot6', 'dash', 'adrenaline', 'sack1', 'sack2', 'sack3', 'sack4', 'turretUp'];
    if (!pl.alive && act === 'fire') { this.cycleSpectate(); return true; }
    if (!pl.alive || this.downed) return needsBody.includes(act) || (this.downed && ['primary', 'secondary', 'knife', 'lastWeapon', 'prevWeapon', 'nextWeapon', 'reload', 'inspect', 'alt', 'jump'].includes(act));
    if (act === 'dash') { this.kat.dash(); return true; } // the Ronin's katana dash (anything else: nothing)
    if (act === 'interact') return this.pressInteract();
    if (act === 'turretUp') { this.openTurret(); return true; }
    if (PIECE_KEYS[act]) { b.select(PIECE_KEYS[act]); return true; } // no build mode: a piece key builds from anywhere
    if (act === 'edit') { b.toggle(false); e.toggle(); return true; }
    if (act === 'throw') { this.throwItem(); return true; }
    if (act === 'nextThrow') { this.nextThrow(); return true; }
    if (act === 'flashlight') {
      // a flashlight on the held gun takes priority; otherwise L flips Night Vision Goggles up/down
      if (this.hasFlashlight()) { this.flashOn = !this.flashOn; this.flashOffThisNight = !this.flashOn; this.g.sound.play('tick', { vol: 0.5, rate: 1.4 }); }
      else if (this.armor.head?.id === 'nvg') {
        this.nvUp = !this.nvUp;
        this.nvManualOn = !this.nvUp; // flipping them down by hand also works in daylight during a wave
        this.g.sound.play('tick', { vol: 0.5, rate: 1.4 });
      }
      else this.say('No flashlight on this gun — fit one at the Blacksmith, or find one on a night wave');
      return true;
    }
    if (act === 'adrenaline') { this.useAdrenaline(); return true; }
    if (act === 'sack1' || act === 'sack2' || act === 'sack3' || act === 'sack4') { this.useSackSlot(+act.slice(4) - 1); return true; }
    if (e.active) {
      if (act === 'alt') { e.reset(); return true; }
      return ['fire', 'primary', 'secondary', 'knife', 'slot4', 'slot5', 'slot6', 'reload', 'inspect', 'nextWeapon', 'prevWeapon'].includes(act);
    }
    if (b.active) {
      switch (act) {
        case 'fire': b.tryPlace(); return true;
        case 'bRotate': case 'reload': b.rotate(); return true;
        case 'nextWeapon': b.cycle(1); return true;
        case 'prevWeapon': b.cycle(-1); return true;
        case 'alt': { const p = b.aimedPiece(); if (p) g.net.send({ t: 'upgrade', id: p.id }); return true; }
        case 'lastWeapon': b.toggle(false); return true;
        case 'primary': case 'secondary': case 'knife': case 'slot4': case 'slot5': case 'slot6': case 'inspect': b.toggle(false); break; // a hotbar key stops building, onto that slot
        default: return false;
      }
    }
    if (W.id === 'katana' && (act === 'alt' || act === 'reload')) { if (act === 'alt') this.kat.strike(); else this.kat.deflect(); return true; } // Fire Strike, Deflect
    const slot = { primary: 1, secondary: 2, knife: 3, slot4: 4, slot5: 5, slot6: 6, inspect: 0 }[act];
    // hotbar: 1-6 (guns or items), the harvest tool key = harvesting knife (again while holding it: inspect)
    if (act === 'inspect' && W.slot === W.knifeSlot) { W.inspect(); return true; }
    if (slot !== undefined) { W.equip(slot); return true; }
    if (act === 'fire' && W.w.cat === 'item') return this.useHeld();
    return false;
  }

  toggleReady() {
    if (this.phase !== 'lobby' && this.phase !== 'prep' && this.phase !== 'intermission') return;
    $('hoEnd').hidden = true;
    const on = !this.me()?.ready;
    this.g.net.send({ t: 'ready', on });
    this.g.sound.play(on ? 'buy' : 'tick', { vol: 0.5 });
  }

  throwItem() {
    const g = this.g, th = this.activeThrow && this.items[this.activeThrow] > 0 ? this.activeThrow : THROWABLES.find(id => this.items[id] > 0);
    if (!th) return this.say('No throwables — buy grenades, molotovs or freezes at the Core');
    this.activeThrow = th;
    const pl = g.player, d = dirFromAngles(pl.yaw, pl.pitch), eye = pl.eye;
    g.net.send({ t: 'throw', item: th, o: eye.map(r2), v: [d[0] * 17, d[1] * 17 + 3.5, d[2] * 17].map(r2) });
    g.vm.knife(false);
  }

  // the adrenaline key, a sack key or LMB with one in hand: instant (the server checks the cooldown).
  useAdrenaline() {
    if (!(this.items.adrenaline > 0)) return this.say('No adrenaline shots — buy them at the Core or find them on zombies');
    this.g.net.send({ t: 'use', item: 'adrenaline' });
  }

  // Use whatever sits in sack slot `idx` (0-3) — only Adrenaline Shots go in there.
  useSackSlot(idx) { if (this.sack[idx]?.kind === 'adrenaline') this.useAdrenaline(); }

  // ---------- the Tank's barrier (server/holdout/barrier.js) ----------
  // Right-click held with a barrier gun: tell the server whenever that changes and show it at once (it corrects us).
  // After it breaks (or the server refuses) it stays down until you let go and raise it again.
  updateBarrier() {
    const g = this.g, b = this.bar, was = this.barrierUp;
    const want = this.cls === 'tank' && canBarrier(g.weapons.id) && g.held('alt') && !g.ui && g.input.locked && g.player.alive
      && !this.downed && !this.carrying && !this.build.active && !this.edit.active;
    if (want !== b.want) {
      b.want = want;
      b.blocked = want && g.now < b.cdUntil; // still recharging after a break
      if (!b.blocked) g.net.send({ t: 'bar', on: want, w: g.weapons.id });
    }
    this.barrierUp = want && !b.blocked;
    if (this.barrierUp !== was) g.sound.play(this.barrierUp ? 'zap' : 'tick', { vol: 0.45, rate: this.barrierUp ? 0.55 : 1.3 });
    this.ents.setBarrier(g.me.id, this.barrierUp, b.hp / BARRIER.hp, true);
  }

  // { id, up, hp, cd (ms until it can go up again), broke, no (your raise was refused) }
  onBarrier(m) {
    const b = this.bar, mine = m.id === this.g.me.id, pos = mine ? this.g.player.pos : this.g.remotes.get(m.id)?.pos;
    if (mine) {
      Object.assign(b, { hp: m.hp, cdUntil: this.g.now + (m.cd || 0) / 1000 });
      if ((m.broke || m.no) && b.want) b.blocked = true; // let go and raise it again (a plain 'down' may just be a stale echo)
    } else this.ents.setBarrier(m.id, !!m.up, m.hp / BARRIER.hp);
    if (m.broke && pos) {
      this.g.sound.play('break_Z', { pos, vol: 1.1, ref: 4, rate: 1.3 });
      this.world.burst([pos[0], pos[1] + 1.4, pos[2]], [0, 1, 0], 0x8fe8ff, 30, 5);
    }
  }

  // Would a ground item pickup actually go somewhere? Mirrors the server's take(): guns/armor/anything else
  // with a stack size of 1 always succeeds by swapping into your held hotbar slot, so only a full stack of a
  // stackable consumable/trap/deployable can fail (sack full for consumables, then the backpack full too).
  pickupFits(pk) {
    const it = { id: pk.key, kind: pk.ik, n: pk.n, r: pk.r, tier: pk.t, el: pk.el };
    if (it.kind === 'adrenaline' && this.items.adrenaline >= adrenCarry(this.cls)) return false;
    if (fits(this.inv, this.sack, it, this.cls)) return true;
    return stackMax(it) === 1 && !this.heldItem()?.locked; // a full inventory swaps with what you hold — never a locked item
  }

  // What E would do right now (highest priority first).
  interactTarget() {
    const g = this.g, pl = g.player, me = pl.pos, k = this.keyOr('interact');
    if (!pl.alive || this.downed) return null;
    for (const p of this.roster) {
      const r = p.downed && p.id !== g.me.id ? g.remotes.get(p.id) : null;
      if (r && dist3(r.pos, me) < 2.4) return { kind: 'revive', id: p.id, text: `Hold ${k} to revive ${p.name}`, cont: true };
    }
    if (this.carrying) return { kind: 'putdown', text: `Carry them into the ring around the Core · ${k} to put down`, press: true };
    for (const s of this.ents.survivors.values()) if (s.state === 0 && dist3(s.pos, me) < 2.4) return { kind: 'carry', id: s.id, text: `Hold ${k} to pick up ${s.name}`, hold: 1.0 };
    for (const t of this.ents.thumpers?.values() ?? []) if (t.state === 'idle' && Math.hypot(t.x - me[0], t.z - me[2]) < 2.6) return { kind: 'thump', id: t.id, text: `Hold ${k} to arm the seismic thumper (taking damage interrupts it)`, cont: true };
    for (const d of this.ents.drops.values()) if (d.landed && Math.hypot(d.x - me[0], d.z - me[2]) < 2.7) return { kind: 'opendrop', id: d.id, text: `Hold ${k} to open the supply drop`, hold: 1.0 };
    for (const c of this.ents.chests.values()) if (Math.hypot(c.x - me[0], c.z - me[2]) < 2.4) return { kind: 'chest', id: c.id, text: `Hold ${k} to open the chest`, hold: 0.8 };
    const pk = this.ents.nearestPickup(me, 2.3, p => p.kind === 'it' || p.kind === 'svsupply');
    if (pk) {
      const name = pickupName(pk);
      if (pk.kind === 'it' && !this.pickupFits(pk)) return { kind: 'nopickup', text: `Inventory full — can't pick up ${name}` };
      return { kind: 'pickup', id: pk.id, text: `${k}: pick up ${name}${pk.ik === 'gun' && this.inv.every(Boolean) ? ' (swaps with what you hold)' : ''}`, press: true };
    }
    if (this.smithOn && Math.hypot(SMITH.x - me[0], SMITH.z - me[2]) < SMITH.reach) return { kind: 'smith', text: `${k}: talk to the Blacksmith (forge, infuse, attachments, turrets)`, press: true };
    if (this.nearBanker()) return { kind: 'bank', text: `${k} — talk to the Banker`, press: true };
    if (this.nearStash()) return { kind: 'stash', text: `${k}: open the team chest`, press: true };
    if (distToBox(pl.eye, OUTPOST.core.base) < 3.0 && this.core[0] < this.core[1]) {
      if (this.phase === 'wave') return { kind: 'coreheal', text: 'The Core can only be repaired between waves' };
      const other = this.coreHealer && this.coreHealer !== g.me.id ? this.roster.find(p => p.id === this.coreHealer) : null;
      return { kind: 'coreheal', text: other ? `${other.name} is healing the Core (one at a time)` : `Hold ${k} to heal the Core`, cont: !other };
    }
    const piece = this.build.aimedPiece();
    if (piece && piece.hp + piece.grow < piece.maxHp - 1) return { kind: 'repair', id: piece.id, text: `Hold ${k} to repair ${BMATS[piece.mat].name.toLowerCase()} ${piece.kind} (${Math.round(piece.hp)}/${piece.maxHp})`, cont: true };
    return null;
  }

  pressInteract() {
    const it = this.interactTarget(), g = this.g;
    if (it?.kind === 'nopickup') { this.say(it.text); return true; } // wouldn't fit — flash why
    if (!it?.press) return false;
    if (it.kind === 'pickup') g.net.send({ t: 'pickup', id: it.id, slot: Math.max(0, g.weapons.slot - 1) });
    else if (it.kind === 'putdown') g.net.send({ t: 'carry' });
    else if (it.kind === 'stash') this.openBag(true);
    else if (it.kind === 'smith') this.openSmith();
    else if (it.kind === 'bank') this.openBank();
    return true;
  }

  // holds: revive / heal Core / repair send while held; carry / open need a full hold
  interact() {
    const g = this.g, now = g.now, it = this.it = this.interactTarget();
    const holding = g.held('interact') && !g.ui && g.input.locked;
    if (!holding) this.holdLock = false;
    this.reviveId = null;
    this.thumpId = null;
    if (!holding || !it || it.press || this.holdLock) { this.hold = null; if (!holding) this.reviveTarget = null; return; }
    if (it.cont) {
      if (it.kind === 'revive' || it.kind === 'thump') {
        const key = it.kind + it.id;
        if (this.reviveTarget !== key) { this.reviveTarget = key; this.reviveStart = now; }
        if (it.kind === 'revive') this.reviveId = it.id; else this.thumpId = it.id;
      }
      if (now - this.lastInteract > 0.2) {
        this.lastInteract = now;
        g.net.send(it.kind === 'revive' ? { t: 'revive', id: it.id } : it.kind === 'thump' ? { t: 'thump', id: it.id } : it.kind === 'coreheal' ? { t: 'coreheal' } : { t: 'repair', id: it.id });
      }
      return;
    }
    if (it.hold) {
      const key = it.kind + it.id;
      if (!this.hold || this.hold.key !== key) this.hold = { key, start: now, it };
      if (now - this.hold.start >= it.hold) {
        g.net.send(it.kind === 'carry' ? { t: 'carry', id: it.id } : { t: 'open', kind: it.kind === 'chest' ? 'chest' : 'drop', id: it.id });
        this.hold = null;
        this.holdLock = true; // let go of E before the next one
      }
    }
  }

  // ---------- panels ----------
  openBag(atChest) {
    const g = this.g;
    if (g.ui || !g.player.alive) return;
    this.bagAtChest = atChest || this.nearStash();
    g.ui = 'bag';
    $('bagMenu').hidden = false;
    $('bagKey').textContent = this.key('backpack');
    this.renderBag();
    if (g.input.locked) g.setVCursor(innerWidth / 2, innerHeight / 2);
  }

  closeBag() {
    const g = this.g;
    if (g.ui !== 'bag') return;
    g.ui = null;
    this.invUI.drag = null;
    this.invUI.ghost.hidden = true;
    $('bagMenu').hidden = true;
    g.setVCursor(null);
  }

  renderBag() { this.invUI.render(); }

  // ---------- Blacksmith panel ----------
  // turret: a turret id opens just that turret's upgrades (the "Upgrade turret" key, no Blacksmith needed)
  openSmith(turret = null) {
    const g = this.g;
    if (g.ui || !g.player.alive) return;
    g.ui = 'smith';
    this.smithTurret = turret;
    $('smithMenu').hidden = false;
    $('smithMenu').querySelector('h2').textContent = turret ? 'TURRET UPGRADES' : 'THE BLACKSMITH';
    $('smithKey').textContent = this.key(turret ? 'turretUp' : 'interact');
    this.renderSmith();
    if (g.input.locked) g.setVCursor(innerWidth / 2, innerHeight / 2);
  }

  closeSmith() {
    const g = this.g;
    if (g.ui !== 'smith') return;
    g.ui = null;
    this.smithTurret = null;
    $('smithMenu').hidden = true;
    g.setVCursor(null);
  }

  // the closest turret within SMITH.turretReach (the server checks the same distance)
  nearTurret() {
    const me = this.g.player.pos;
    let best = null, bd = SMITH.turretReach;
    for (const d of this.ents.defs.values()) {
      const dist = Math.hypot(d.pos[0] - me[0], d.pos[2] - me[2]);
      if (TURRET_TYPES.includes(d.type) && dist <= bd && Math.abs(d.pos[1] - me[1]) < 3) { bd = dist; best = d; }
    }
    return best;
  }

  openTurret() {
    const d = this.nearTurret();
    if (d) this.openSmith(d.id);
    else this.say(`Stand within ${SMITH.turretReach} m of a turret to upgrade it`);
  }

  // Explosive tips (gun mod) went off: a small burst, the pop rate-limited so an SMG doesn't drown everything out
  explosiveTip(p) {
    this.world.burst(p, [0, 1, 0], 0xffa23a, 8, 3);
    if (this.g.now - (this.etipAt || 0) > 0.12) { this.etipAt = this.g.now; this.g.sound.play('explode', { pos: p, vol: 0.25, rate: 1.9, ref: 2 }); }
  }

  renderSmith() {
    $('smithMoney').textContent = `$${this.g.me.money} · zinkonium ${this.mats.zink || 0}`;
    $('smithGrid').innerHTML = smithHTML(this);
    for (const b of $('smithGrid').querySelectorAll('button')) {
      b.onclick = () => {
        const d = b.dataset;
        this.g.net.send({ t: 'smith', op: d.op, uid: d.uid ? +d.uid : undefined, el: d.el, id: d.id, def: d.def ? +d.def : undefined, up: d.up });
        this.g.sound.play('buy', { vol: 0.5 });
      };
    }
    if (this.g.vcur) this.g.setVCursor(...this.g.vcur);
  }

  // ---------- the Banker panel (sell gear, buy back the last sale) ----------
  openBank() {
    const g = this.g;
    if (g.ui || !g.player.alive) return;
    g.ui = 'bank';
    this.bankSel = null;
    $('bankMenu').hidden = false;
    $('bankKey').textContent = this.key('interact');
    this.renderBank();
    if (g.input.locked) g.setVCursor(innerWidth / 2, innerHeight / 2);
  }

  closeBank() {
    const g = this.g;
    if (g.ui !== 'bank') return;
    g.ui = null;
    $('bankMenu').hidden = true;
    g.setVCursor(null);
  }

  renderBank() {
    $('bankMoney').textContent = `$${this.g.me.money}`;
    $('bankGrid').innerHTML = bankHTML(this);
    for (const b of $('bankGrid').querySelectorAll('button, .slot')) {
      b.onclick = e => {
        const d = b.dataset;
        if (d.sell) { this.g.net.send({ t: 'sell', uid: +d.sell }); this.bankSel = null; this.g.sound.play('buy', { vol: 0.5 }); return; }
        if (d.buyback) { this.g.net.send({ t: 'buyback' }); this.g.sound.play('buy', { vol: 0.5 }); return; }
        if (d.ref && d.ref !== 'bb') {
          if (e.shiftKey && d.uid) { this.g.net.send({ t: 'sell', uid: +d.uid }); this.bankSel = null; this.g.sound.play('buy', { vol: 0.5 }); return; }
          this.bankSel = d.ref; this.renderBank(); this.g.sound.play('tick', { vol: 0.3 });
        }
      };
    }
    if (this.g.vcur) this.g.setVCursor(...this.g.vcur);
  }

  renderBuy() {
    const g = this.g;
    $('buyMoney').textContent = `$${g.me.money}`;
    $('buyTimer').textContent = g.canBuyNow() ? `Core supply · team bank $${this.stash.money}` : 'Walk into the ring around the Core to buy';
    $('buyGrid').innerHTML = buyHTML(this);
    for (const b of $('buyGrid').querySelectorAll('button')) {
      b.onclick = () => {
        const d = b.dataset;
        if (d.bank) { this.payBank = !this.payBank; this.renderBuy(); return; }
        if (d.tab) { this.shopTab = d.tab; this.renderBuy(); return; }
        if (d.cls) { g.net.send({ t: 'class', id: d.cls }); return; }
        if (d.rarity) { g.net.send({ t: 'rarity', uid: +d.rarity, bank: this.payBank }); return; }
        if (d.tierup) { g.net.send({ t: 'tierup', uid: +d.tierup }); return; }
        if (d.teamup) { g.net.send({ t: 'teamup', id: d.teamup, bank: this.payBank }); return; }
        if (d.coreup) { g.net.send({ t: 'coreup', id: d.coreup, bank: this.payBank }); return; }
        g.net.send({ t: 'buy', item: d.id, bank: this.payBank, slot: Math.max(0, g.weapons.slot - 1), el: d.el });
      };
    }
    if (this.g.vcur) this.g.setVCursor(...this.g.vcur);
  }

  // ---------- per frame ----------
  update(dt) {
    const g = this.g, now = g.now, pnow = performance.now() / 1000;
    this.zombies.update(dt, pnow, { pos: g.player.pos, nightK: this.nightK, nvK: this.nvK });
    this.hoarderTrail(dt);
    this.updateShades(now);
    const people = [g.player.pos, ...[...g.remotes.values()].map(r => r.pos), ...[...this.ents.survivors.values()].map(s => s.pos)];
    this.structs.tick(dt, people);
    this.nodes.update(dt);
    this.updateGlobs(dt);
    this.updateBarrier();
    this.kat.update(dt);
    this.ents.update(dt, pnow, { me: g.player.pos, meYaw: g.player.yaw, meId: g.me.id, remotes: g.remotes });
    this.ents.updateSpecials(dt, this.zombies);
    this.gk.update(dt);
    this.bhm.update(dt);
    this.minimap.update();
    const fx = this.pfx, blind = fx && now < fx.blindUntil ? Math.min(1, (fx.blindUntil - now) / 1.2) : 0, burn = fx && now < fx.burnUntil ? 0.55 + 0.25 * Math.sin(now * 12) : 0;
    setStyle('fxBlind', 'opacity', blind.toFixed(2));
    setStyle('fxBurn', 'opacity', burn.toFixed(2));
    const adrenPulse = Math.max(0, 1 - (now - this.adrenPulseAt) / 0.6);
    setStyle('fxAdren', 'opacity', (adrenPulse * 0.5).toFixed(2));
    setStyle('fxRally', 'opacity', (this.rallyK * 0.5).toFixed(2));
    const firing = g.held('fire') && g.input.locked && !g.ui;
    if (g.ui === 'bag') this.invUI.tick(g.vcur, g.input.down('Mouse0'));
    this.build.update(dt, firing);
    this.edit.update(dt, firing);
    this.interact();
    this.dusk += ((this.phase === 'wave' ? 1 : 0) - this.dusk) * Math.min(1, dt * 0.7);
    this.world.setDusk(Math.round(this.dusk * 50) / 50);
    const wasNight = this.nightK > 0.3;
    this.nightK += ((this.phase === 'wave' && this.night ? 1 : 0) - this.nightK) * Math.min(1, dt * 0.5);
    this.world.setNight(Math.round(this.nightK * 50) / 50);
    const isNight = this.nightK > 0.3;
    if (!wasNight && isNight) this.flashOffThisNight = false; // a new night: flashlights come on by themselves again
    // in the dark a flashlight gun lights up when you pull it out, unless you switched it off this night
    if (isNight && !this.flashOn && !this.flashOffThisNight && this.hasFlashlight()) this.flashOn = true;
    if (this.flashOn && !this.hasFlashlight()) this.flashOn = false;
    this.nightFx.update(dt, this.nightK, this.flashOn && g.player.alive, g.remotes);
    // auto-on stays night-only; flipping the goggles down by hand (nvManualOn) also works in daylight during a wave
    const nvActive = !!(this.armor.head?.id === 'nvg' && !this.nvUp && g.player.alive && (isNight || (this.nvManualOn && this.dusk > 0.5)));
    if (nvActive !== this.nvWasActive) { this.g.sound.play(nvActive ? 'nv_on' : 'nv_off', { vol: 0.6 }); this.nvWasActive = nvActive; }
    this.nvK += ((nvActive ? 1 : 0) - this.nvK) * Math.min(1, dt * 3);
    this.applyNV();
    this.rallyK += ((now < this.rallyUntil ? 1 : 0) - this.rallyK) * Math.min(1, dt * 5);
    if (this.shadowDirty && now - this.shadowAt > 0.5) { this.world.refreshShadows(); this.shadowDirty = false; this.shadowAt = now; }
    if (now > this.groanAt) this.groan(now);
    if (this.shake > 0) { // explosion camera shake
      const c = g.world.camera, s = this.shake * 0.05;
      c.position.x += (Math.random() - 0.5) * s; c.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
  }

  // Canvas filter + #fxNV overlay + world lighting boost, driven by the eased nvK factor.
  applyNV() {
    const k = this.nvK;
    this.world.setNV(k);
    setStyle('fxNV', 'opacity', k.toFixed(2));
    $('game').style.filter = k > 0.004
      ? `brightness(${(1 + k * 0.7).toFixed(2)}) contrast(${(1 + k * 0.3).toFixed(2)}) grayscale(${k.toFixed(2)}) sepia(${k.toFixed(2)}) hue-rotate(${(80 * k).toFixed(0)}deg) saturate(${(1 + k * 5).toFixed(2)})`
      : '';
    if (k > 0.01) setStyle('fxNVGrain', 'backgroundPosition', `${(Math.random() * 150) | 0}px ${(Math.random() * 150) | 0}px`);
  }

  // Shade audio cues: a one-shot sting the first time you spot one on screen (global cooldown), then a
  // breathy positional whisper every few seconds for as long as it stays visible.
  updateShades(now) {
    const cam = this.g.world.camera;
    for (const zb of this.zombies.list.values()) {
      if (zb.type !== 'shade') continue;
      const seen = (zb.vis ?? 0) > 0.5;
      if (seen && !zb.wasSeen && !zb.stung && now > this.shadeStingAt) {
        _v.set(zb.pos[0], zb.pos[1] + 1.5 * zb.s, zb.pos[2]).project(cam);
        if (_v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05) {
          this.g.sound.play('shade_sting', { vol: 0.7 });
          zb.stung = true;
          this.shadeStingAt = now + 10;
        }
      }
      if (seen && now > (zb.whisperAt || 0)) { this.g.sound.play('shade_whisper', { pos: zb.pos, vol: 0.55, ref: 4 }); zb.whisperAt = now + 3 + Math.random() * 2; }
      zb.wasSeen = seen;
    }
  }

  groan(now) {
    this.groanAt = now + 0.35 + Math.random() * 0.5;
    const me = this.g.player.pos, near = [];
    for (const zb of this.zombies.list.values()) if (!zb.dead && Math.hypot(zb.pos[0] - me[0], zb.pos[2] - me[2]) < 28) near.push(zb);
    if (!near.length) return;
    const zb = near[(Math.random() * near.length) | 0], pos = [zb.pos[0], zb.pos[1] + 1.6 * zb.s, zb.pos[2]];
    const loud = 1 + this.nightK * 0.8; // at night you hear them before you see them
    const rate = { runner: 1.25, spitter: 1.1, brute: 0.72, alpha: 0.6 }[zb.type] ?? 0.9 + Math.random() * 0.2;
    this.g.sound.play('z_groan' + ((Math.random() * 4) | 0), { pos, vol: 0.55 * loud, ref: 2.5 * loud, roll: 1.3, rate, muffle: this.g.occluded(pos) ? 900 : 0 });
  }

  // ---------- HUD ----------
  enterDom() {
    hudReset();
    $('hud').classList.add('coop');
    for (const id of ['hoTop', 'compass', 'team', 'mats', 'hotbar', 'minimap']) $(id).hidden = false;
    this.sbHead = $('scoreboard').querySelector('thead').innerHTML;
    $('scoreboard').querySelector('thead').innerHTML = SB_HOLDOUT;
    $('hoEnd').hidden = true;
  }

  feed(text, cls = '') {
    const d = document.createElement('div');
    d.textContent = text;
    d.className = cls;
    $('hoFeed').prepend(d);
    setTimeout(() => d.remove(), 2600);
    while ($('hoFeed').children.length > 5) $('hoFeed').lastChild.remove();
  }

  hintText() {
    const g = this.g, pl = g.player, now = g.now;
    if (now < g.hintUntil) return g.hintMsg;
    if (!pl.alive) {
      const who = this.spectate && this.roster.find(p => p.id === this.spectate);
      return `${g.deathMsg} — you're out until wave ${this.wave} is cleared${who ? ` · watching ${who.name} (click to switch)` : ''}`;
    }
    if (this.downed) return `DOWNED — bleeding out in ${Math.max(0, Math.ceil(this.bleedEnd - now))}s · a teammate can hold ${this.keyOr('interact')} to revive you`;
    if (this.edit.active) return `EDIT (${this.edit.describe()}) · drag tiles, release to apply · ${this.keyOr('edit')} done · right-click reset`;
    const b = this.build;
    if (b.active) {
      const p = b.aimedPiece();
      const status = b.reason ? b.reason : `${PIECE_NAME[b.kind]} · ${b.costText()}`;
      const look = p && !b.placing ? ` · aiming at ${BMATS[p.mat].name.toLowerCase()} ${p.kind} ${Math.round(p.hp)}/${p.maxHp}` : '';
      return `${status}${look}`;
    }
    if (this.it) return this.it.text;
    if ((this.phase === 'lobby' || this.phase === 'countdown') && !this.cls) return `Pick a class: press ${this.keyOr('buy')} at the Core (Tank · Assault · Ronin) · then ${this.keyOr('ready')} when ready`;
    if (this.phase === 'lobby' || this.phase === 'countdown') return `Waiting for the squad — press ${this.keyOr('ready')} when ready · building and harvesting open when the game starts${this.canBuy() ? ` · ${this.keyOr('buy')} shop` : ''}`;
    if (this.phase === 'prep') return `Get ready: build with ${['bWall', 'bFloor', 'bStair', 'bCone'].map(id => this.key(id)).join(' ')} · ${this.keyOr('inspect')} harvest · ${this.keyOr('buy')} shop at the Core · ${this.keyOr('ready')} to start wave 1 early`;
    if (this.phase === 'intermission') return `Rebuild, repair and restock · ${this.keyOr('ready')} to skip the break${this.canBuy() ? ` · ${this.keyOr('buy')} to shop` : ''}`;
    return '';
  }

  refreshHud() {
    const g = this.g, now = g.now, ph = this.phase;
    const n = this.roster.length || 1, ready = this.roster.filter(p => p.ready).length;
    const title = { lobby: 'LOBBY', countdown: 'GET READY', prep: 'PREPARE', victory: 'VICTORY', defeat: 'DEFEAT' }[ph] ?? `WAVE ${this.wave}`;
    const sub = ph === 'lobby' ? `${ready}/${n} ready · press ${this.keyOr('ready')}` : ph === 'intermission' || ph === 'prep' ? `break · ${ready}/${n} ready` : ph === 'wave' ? `${n} player${n > 1 ? 's' : ''}` : '';
    setText('hoWaveNo', title);
    setText('hoWaveSub', sub.toUpperCase());
    const [c, cm] = this.core, frac = Math.max(0, Math.min(1, c / cm)), barrier = now < (this.buffs.barrier || 0);
    setStyle('hoCoreFill', 'width', `${(frac * 100).toFixed(1)}%`);
    setClass('hoCore', 'low', frac < 0.3);
    setClass('hoCore', 'shielded', barrier);
    setClass('hoCore', 'mending', now - this.coreMendAt < 0.9);
    const healer = this.coreHealer && this.roster.find(p => p.id === this.coreHealer);
    setText('hoCoreText', `CORE ${c} / ${cm}${barrier ? ' · BARRIER' : ''}${healer ? ` · ${healer.name} healing` : ''}`);
    // the Tank's barrier while you hold right-click: its HP, or why it's down
    const bar = this.bar;
    setHidden('hoBarrier', !bar.want);
    if (bar.want) {
      const cd = bar.cdUntil - now;
      setClass('hoBarrier', 'down', !this.barrierUp);
      setStyle('hoBarrierFill', 'width', `${(Math.max(0, Math.min(1, bar.hp / BARRIER.hp)) * 100).toFixed(1)}%`);
      setText('hoBarrierText', cd > 0 ? `BARRIER BROKEN · ${Math.ceil(cd)}s` : this.barrierUp ? `BARRIER ${Math.round(bar.hp)} / ${BARRIER.hp}` : 'BARRIER DOWN · let go and raise it again');
    }
    const left = Math.max(0, this.end - now);
    const waveLeft = this.waveEnd ? Math.max(0, this.waveEnd - now) : 0;
    const berserkSoon = ph === 'wave' && waveLeft > 0 && waveLeft <= 60; // last minute: show the clock instead of the zombie count
    setText('hoTimer', berserkSoon ? fmt(waveLeft) : ph === 'wave' ? String(this.left) : ph === 'lobby' ? '—' : fmt(left));
    setText('hoLeft', berserkSoon ? 'TILL BERSERK' : ph === 'wave' ? 'ZOMBIES LEFT' : ph === 'lobby' ? 'NO TIMER' : ph === 'countdown' ? 'STARTING' : ph === 'prep' ? 'UNTIL WAVE 1' : ph === 'intermission' ? 'UNTIL NEXT WAVE' : 'NEXT MATCH');
    setText('matZink', this.mats.zink);
    setHTML('hotbar', hotbarHTML(this));
    this.kat.hud();
    const flash = this.hasFlashlight();
    setHidden('hoFlash', !flash);
    if (flash) { setText('hoFlash', `FLASHLIGHT ${this.flashOn ? 'ON' : 'OFF'} · ${this.key('flashlight')}`); setClass('hoFlash', 'on', this.flashOn); }
    const nvg = this.armor.head?.id === 'nvg';
    setHidden('hoNV', !nvg);
    if (nvg) {
      const fk = this.key('flashlight'), label = this.nvK > 0.5 ? `NIGHT VISION ON · ${fk}` : this.nvUp ? `NIGHT VISION UP · ${fk}` : `NIGHT VISION (switches on at night) · ${fk}`;
      setText('hoNV', label);
      setClass('hoNV', 'on', this.nvK > 0.5);
    }
    setClass('vitals', 'rally', this.rallyK > 0.15);
    this.drawCompass();
    this.drawSkyBackMark();
    setHTML('team', this.roster.map(p => {
      const state = !p.alive ? '☠' : p.downed ? '✚ DOWN' : ph === 'lobby' || ph === 'intermission' || ph === 'prep' ? (p.ready ? '✔ READY' : '…') : `${p.hp}${p.shield ? ` +${p.shield}` : ''}`;
      const badge = p.cls ? `<i class="cls ${p.cls}">${CLASSES[p.cls].name[0]}</i>` : '';
      return `<div class="tm${p.id === g.me.id ? ' me' : ''}${p.downed ? ' down' : ''}${p.alive ? '' : ' dead'}"><span class="n">${badge}${esc(p.name)}${p.host ? ' ★' : ''}${p.carrying ? ' ⛑' : ''}</span><span class="s">${state}</span><i style="width:${p.alive && !p.downed ? (p.hp / (p.maxHp || 200)) * 100 : 0}%"></i><u style="width:${p.alive ? p.shield || 0 : 0}%"></u></div>`;
    }).join('') + [...this.ents.survivors.values()].map(s => {
      const cls = SURVIVOR_CLASSES[s.cls];
      const clsTxt = cls ? ` <small style="color:${hex(cls.color)}">${cls.name}</small>` : '';
      return `<div class="tm sv"><span class="n">${esc(s.name)}${clsTxt} <small>${SURVIVOR.tiers[s.tier]?.name ?? 'survivor'}</small></span><span class="s">${['wounded', 'carried', `${Math.round(s.hp * 100)}% · ${s.ammo} ammo`][s.state]}</span><i style="width:${s.hp * 100}%"></i></div>`;
    }).join(''));
    // boss bar
    const k = this.ents.sky, mw = this.ents.maw, titans = [...this.zombies.list.values()].filter(z => z.type === 'titan' && !z.dead);
    const gk = this.gk.bar() ?? this.bhm.bar(); // the Gravekeeper's or the Behemoth's { name, frac }
    setHidden('hoBoss', !((k && !k.dead) || mw || titans.length || gk));
    if (k && !k.dead) {
      const alive = k.hp.filter(h => h > 0).length, sum = k.hp.reduce((a, b) => a + Math.max(0, b), 0);
      setText('hoBossName', `THE COLOSSUS · weak points ${alive}/${k.hp.length}`);
      setStyle('hoBossFill', 'width', `${((sum / (k.max * k.hp.length)) * 100).toFixed(1)}%`);
    } else if (mw) {
      const pulsing = [...(this.ents.thumpers?.values() ?? [])].filter(t => t.state === 'pulse').length;
      setText('hoBossName', `THE MAW · ${mw.mode === 'lured' ? 'EXPOSED — SHOOT THE THROAT' : mw.mode === 'devour' ? 'DEVOURING THE CORE' : `thumpers ${pulsing}/${mw.need}`}`);
      setStyle('hoBossFill', 'width', `${((mw.hp / mw.max) * 100).toFixed(1)}%`);
    } else if (titans.length) { // combined HP bar across both Titans
      const totalMax = titans.reduce((s, t) => s + t.maxHp, 0), totalHp = titans.reduce((s, t) => s + t.hp * t.maxHp, 0);
      setText('hoBossName', titans.length > 1 ? `THE BROOD TITANS (${titans.length})` : 'THE BROOD TITAN');
      setStyle('hoBossFill', 'width', `${((totalHp / totalMax) * 100).toFixed(1)}%`);
    } else if (gk) {
      setText('hoBossName', gk.name);
      setStyle('hoBossFill', 'width', `${(gk.frac * 100).toFixed(1)}%`);
    }
    // buffs + task
    const chips = [['damage', 'DAMAGE +30%'], ['rate', 'RAPID FIRE'], ['barrier', 'CORE BARRIER']].filter(([key]) => now < (this.buffs[key] || 0)).map(([key, label]) => `<span>${label} ${Math.ceil(this.buffs[key] - now)}s</span>`);
    if (now < this.adrenUntil) chips.push(`<span class="adren">ADRENALINE ${Math.ceil(this.adrenUntil - now)}s</span>`);
    setHTML('hoBuffs', chips.join(''));
    setHidden('hoTask', !(this.task && now < this.task.until));
    if (this.task) setText('hoTask', this.task.text);
    const b = this.build;
    setHidden('buildBar', !b.active);
    if (b.active) {
      const binds = g.hud.settings.binds, k = id => keyName(binds[id]?.[0]);
      setHTML('buildBar', Object.entries(PIECE_KEYS).map(([id, k2]) => `<span class="${b.kind === k2 ? 'on' : ''}"><b>${k(id)}</b>${PIECE_NAME[k2]}</span>`).join('') +
        (b.placing ? `<span class="on"><b>⟳</b>${esc(ITEMS[b.item]?.name ?? 'NONE')} ×${this.items[b.item] || 0}</span>` : `<span class="mat ${b.mat} on">${BMATS[b.mat].name.toUpperCase()} ${this.mats[b.mat]}</span>`) +
        `<small>LMB place (hold) · ${k('bRotate')} rotate stair${b.placing ? ' · wheel type' : ''} · ${k('edit')} edit · hotbar keys: weapons</small>`);
    }
    // progress ring: reviving, holding E, or bleeding out
    let ring = null;
    if (this.reviveId) ring = [Math.min(1, (now - this.reviveStart) / 3), `REVIVING ${g.name(this.reviveId).toUpperCase()}`, 'var(--accent2)'];
    else if (this.thumpId !== null && this.thumpId !== undefined) ring = [Math.min(1, (now - this.reviveStart) / 5), 'ARMING THUMPER', '#5dff7a'];
    else if (this.hold) ring = [Math.min(1, (now - this.hold.start) / this.hold.it.hold), this.hold.it.kind === 'carry' ? 'PICKING UP' : 'OPENING', 'var(--gold)'];
    else if (this.downed) ring = [Math.max(0, (this.bleedEnd - now) / 30), 'DOWNED', 'var(--accent)'];
    setHidden('revive', !ring);
    if (ring) {
      setStyle('reviveRing', 'background', `conic-gradient(${ring[2]} ${ring[0] * 360}deg, rgba(255,255,255,0.12) 0)`);
      setText('reviveText', ring[1]);
    }
    setClass('hud', 'downed', this.downed);
    g.hud.hint(this.hintText());
    setHidden('hoAlert', now > this.alertUntil);
    setText('hoAlert', this.alertText);
    this.updateTags();
    const sb = g.held('scoreboard') && !g.ui;
    setHidden('scoreboard', !sb);
    if (sb) {
      setHTML('sbBody', this.roster.map(p => `<tr class="${p.id === g.me.id ? 'me' : ''} ${p.alive ? '' : 'dead'}"><td>${esc(p.name)}${p.host ? ' ★' : ''}</td><td>${p.kills}</td><td>${p.dmg}</td><td>${p.builds}</td><td>${p.repaired}</td><td>${p.revives}</td><td>${p.rescues || 0}</td><td>${p.ping}</td></tr>`).join(''));
      setText('sbMeta', `Zombie Holdout · endless · wave ${this.wave} · room ${g.code} · team bank $${this.stash.money}`);
    }
    if (g.ui === 'bag' && this.bagAtChest && !this.nearStash()) this.renderBag();
  }

  // Compass strip: ±90° around your view. Lanes (red = attacking, amber = next), Core, teammates, drops.
  drawCompass() {
    const pl = this.g.player, W = 230, marks = [];
    const put = (yaw, cls, label) => {
      const rel = wrap(yaw - pl.yaw), edge = Math.abs(rel) > Math.PI / 2;
      const x = Math.max(-1, Math.min(1, -rel / (Math.PI / 2))) * W;
      marks.push(`<span class="${cls}${edge ? ' edge' : ''}" style="transform:translateX(${x.toFixed(0)}px)">${label}</span>`);
    };
    for (const [id, yaw] of [['N', 0], ['E', -Math.PI / 2], ['S', Math.PI], ['W', Math.PI / 2]]) {
      if (Math.abs(wrap(yaw - pl.yaw)) < Math.PI / 2) put(yaw, 'card', id);
    }
    for (const id of new Set([...this.lanes, ...this.next])) {
      const [x, z] = LANE_POS[id];
      put(bearing(pl.pos, x, z), this.lanes.includes(id) ? 'lane now' : 'lane next', '▼');
    }
    if (Math.hypot(pl.pos[0], pl.pos[2]) > 3) put(bearing(pl.pos, OUTPOST.core.x, OUTPOST.core.z), 'core', '◆');
    for (const d of this.ents.drops.values()) put(bearing(pl.pos, d.x, d.z), 'drop', '✦');
    for (const p of this.minimap.pings) put(bearing(pl.pos, p.x, p.z), 'ping', '◆');
    for (const s of this.ents.survivors.values()) if (s.state === 0) put(bearing(pl.pos, s.pos[0], s.pos[2]), 'svm', '✚');
    for (const zb of this.zombies.list.values()) if (!zb.dead && zb.type === 'seeker') put(bearing(pl.pos, zb.pos[0], zb.pos[2]), 'seeker', '▲');
    for (const zb of this.zombies.list.values()) if (!zb.dead && zb.type === 'hoarder') put(bearing(pl.pos, zb.pos[0], zb.pos[2]), 'hoarder', '$');
    for (const p of this.roster) {
      const r = p.id !== this.g.me.id && this.g.remotes.get(p.id);
      if (r) put(bearing(pl.pos, r.pos[0], r.pos[2]), p.downed ? 'mate down' : 'mate', '●');
    }
    setHTML('compassTicks', marks.join(''));
  }

  // Colossus back weak-point reminder: a ring around it on screen, or an arrow clamped to the screen edge
  // pointing toward it when it's off-screen (or behind you).
  drawSkyBackMark() {
    const s = this.ents.sky, i = s?.backIdx ?? -1, p = i >= 0 ? s.points[i] : null;
    if (!s || s.dead || i < 0 || !p || !p.visible) { setHidden('skyBackMark', true); return; }
    const cam = this.g.world.camera;
    p.getWorldPosition(_v);
    _v.project(cam);
    const behind = _v.z > 1, cx = innerWidth / 2, cy = innerHeight / 2;
    let x = cx + _v.x * cx, y = cy - _v.y * cy;
    if (behind) { x = 2 * cx - x; y = 2 * cy - y; }
    const onScreen = !behind && _v.x >= -1 && _v.x <= 1 && _v.y >= -1 && _v.y <= 1;
    const el = $('skyBackMark');
    el.hidden = false;
    if (onScreen) {
      el.className = 'ring';
      el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    } else {
      const dx = x - cx, dy = y - cy, pad = 42;
      const k = Math.min((innerWidth / 2 - pad) / Math.max(1, Math.abs(dx)), (innerHeight / 2 - pad) / Math.max(1, Math.abs(dy)));
      el.className = 'arrow';
      el.style.transform = `translate(${(cx + dx * k).toFixed(0)}px, ${(cy + dy * k).toFixed(0)}px) rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
    }
  }

  // Name tags over teammates and survivors.
  updateTags() {
    const cam = this.g.world.camera, root = $('tags'), seen = new Set();
    const show = (key, pos, text, cls, color = '') => {
      seen.add(key);
      let el = this.tags.get(key);
      if (!el) { el = document.createElement('div'); root.append(el); this.tags.set(key, el); }
      _v.set(...pos).project(cam);
      const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      el.hidden = !vis;
      if (!vis) return;
      el.className = cls;
      if (el.textContent !== text) el.textContent = text;
      el.style.color = color;
      el.style.transform = `translate(${((_v.x + 1) / 2) * innerWidth}px, ${((1 - _v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
    };
    for (const p of this.roster) {
      const r = p.id !== this.g.me.id && p.alive ? this.g.remotes.get(p.id) : null;
      if (r) show(p.id, [r.pos[0], r.pos[1] + (p.downed ? 0.9 : 2.15), r.pos[2]], p.downed ? `✚ ${p.name}` : p.name, p.downed ? 'tag down' : 'tag');
    }
    for (const s of this.ents.survivors.values()) {
      if (s.state === 1) continue;
      const tier = SURVIVOR.tiers[s.tier]?.name ?? '', cls = SURVIVOR_CLASSES[s.cls];
      const label = cls ? `${cls.name} ${tier}` : tier;
      show('sv' + s.id, [s.pos[0], s.pos[1] + (s.state === 0 ? 0.9 : 2.15), s.pos[2]], s.state === 0 ? `✚ ${s.name} · ${label} (wounded)` : `${s.name} · ${label} ${Math.round(s.hp * 100)}%`, s.state === 0 ? 'tag sv down' : 'tag sv', cls ? hex(cls.color) : '');
    }
    const me = this.g.player.pos;
    for (const zb of this.zombies.list.values()) {
      if (zb.dead) continue;
      if (zb.type === 'golem' && Math.hypot(zb.pos[0] - me[0], zb.pos[2] - me[2]) < 40) show('zg' + zb.id, [zb.pos[0], zb.pos[1] + 2.7 * zb.s, zb.pos[2]], 'WALL BREAKER', 'tag breaker');
      else if (zb.type === 'seeker' && Math.hypot(zb.pos[0] - me[0], zb.pos[2] - me[2]) < 45) show('zs' + zb.id, [zb.pos[0], zb.pos[1] + 2.2 * zb.s, zb.pos[2]], '!', 'tag seeker');
      else if (zb.type === 'hoarder') show('zh' + zb.id, [zb.pos[0], zb.pos[1] + 2.4 * zb.s, zb.pos[2]], 'HOARDER', 'tag hoarder');
      else if (zb.type === 'relic' && Math.hypot(zb.pos[0] - me[0], zb.pos[2] - me[2]) < 40) show('zr' + zb.id, [zb.pos[0], zb.pos[1] + 2.3 * zb.s, zb.pos[2]], 'RELIC BEARER', 'tag relic');
    }
    for (const [id, el] of this.tags) if (!seen.has(id)) { el.remove(); this.tags.delete(id); }
  }

  dispose() {
    this.closeBag();
    this.closeSmith();
    this.closeBank();
    this.bhm.clear(); // first: it hands its collision box back through refreshBoxes
    this.zombies.dispose();
    this.structs.dispose();
    this.props.dispose();
    this.decor.dispose();
    this.nodes.dispose();
    this.build.dispose();
    this.edit.dispose();
    this.ents.dispose();
    this.gk.dispose();
    this.kat.dispose();
    this.invUI.dispose();
    this.minimap.dispose();
    this.clearGlobs();
    this.globGeo.dispose();
    this.globMat.dispose();
    this.bombMat.dispose();
    for (const el of this.tags.values()) el.remove();
    this.world.setDusk(0);
    this.world.setNight(0);
    this.world.setNV(0);
    this.nvK = 0;
    $('game').style.filter = '';
    setStyle('fxNV', 'opacity', '0');
    this.nightFx.dispose();
    this.world.setLanes({});
    $('hud').classList.remove('coop', 'downed');
    for (const id of ['hoTop', 'compass', 'team', 'mats', 'buildBar', 'revive', 'hoAlert', 'hoEnd', 'hotbar', 'hoBoss', 'hoTask', 'hoFlash', 'hoNV', 'bagMenu', 'smithMenu', 'bankMenu', 'minimap', 'mapWrap', 'skyBackMark', 'hoBarrier', 'hoKat']) $(id).hidden = true;
    $('hoFeed').innerHTML = '';
    $('hoBuffs').innerHTML = '';
    if (this.sbHead) $('scoreboard').querySelector('thead').innerHTML = this.sbHead;
    hudReset(); // elements above were changed behind the HUD's value cache
  }
}
