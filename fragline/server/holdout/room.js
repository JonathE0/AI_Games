// Zombie Holdout: 1–4 players defend the Core through 10 waves. Server-authoritative for zombies, built
// pieces (and their edits), backpacks, the shop and team chest, loot, traps, survivors, the Colossus,
// health, downs and revives; clients report movement and hit claims (validated against where each target
// was over the last few hundred ms).
import { WEAPONS, computeDamage } from '../../shared/weapons.js';
import { OUTPOST, OUTPOST_STATIC, OUTPOST_PROPS, PROP_TYPES, OUTPOST_NODES, NODE_TYPES } from '../../shared/outpost.js';
import { armorStats, damageReduction, gunMult } from '../../shared/items.js';
import { EL, ELEMENT_IDS } from '../../shared/elements.js';
import { shieldBlocks, bloaterBurst, addHazard, updateHazards, updateSpecials, updatePlayerEffects, playerEffect } from './behaviors.js';
import { FLYER_ALT } from './flyers.js';
import { BMATS, MAT_IDS, KINDS, PIECE_COST, REPAIR_HP_PER_MAT, START_FRAC, REFUND, KNIFE_BREAK, REACH, pieceBox, pieceBoxes, slotKey, checkPlacement, distToBox, validMask, rampEdit, unsupported } from '../../shared/build.js';
import { ZTYPES, ZTYPE_IDS, ZCLASSES, ZCLASS_IDS, ZDROPS, CORE_ARMOR, coreHp, bossHp, bossFor, variantChance, hoarderCash } from '../../shared/zombies.js';
import { ITEMS, RARITY, POWERUPS, BUFF, AMMO, AMMO_IDS, ARMOR_IDS, ATTACH_IDS, MAT_CAP, MONEY_CAP, CLASSES, SURVIVOR_CLASSES, SHIELD_CAP, ADREN_DROP, intermissionFor, MAW_BREAK, rollLoot, rollDeploy, GUN_MODS } from '../../shared/holdout.js';
import { rayWorld, blocked } from '../../shared/physics.js';
import { BoxGrid } from '../../shared/boxgrid.js';
import { BaseRoom, nextUid } from '../baseRoom.js';
import { FlowField } from './flowfield.js';
import { Director } from './director.js';
import { updateZombies, updateProjectiles } from './ai.js';
import { Inventory, freshBackpack, carries, gunByUid, countOf, takeItem, makeGun } from './inventory.js';
import { Combat } from './combat.js';
import { Defenses } from './defenses.js';
import { CoreCannon } from './corecannon.js';
import { Survivors } from './survivors.js';
import { SkyBoss } from './skyboss.js';
import { Events } from './events.js';
import { Bosses } from './bosses.js';
import { Blacksmith } from './blacksmith.js';
import { Barriers } from './barrier.js';
import { Ronin } from './ronin.js';

export const HOLDOUT = {
  startMoney: 800, startMats: { zink: 290 }, waveMats: { zink: 95 },
  countdown: 5000, readySkip: 3000, endScreen: 2500, // endScreen: the beat after a defeat before the map resets
  bleed: 30000, revive: 3000, reviveHp: 80, respawnSolo: 8000, respawnTeam: 12000,
  aiStep: 0.05, coreHeal: 60, chests: 6,
  coreRegen: 2, coreRegenAfter: 4000, // passive HP/s inside the Core ring, starting this long (ms) after your last hit
  // the Core mends itself (fraction of max HP per s): during breaks, and during a wave once it's gone this long (ms) unhit
  coreMend: 0.01, coreMendWave: 0.002, coreMendAfter: 8000,
};
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const clamp16 = v => Math.max(-32767, Math.min(32767, Math.round(v)));
const MARK_MULT = 1.25; // Skybreaker's "mark" perk: +25% damage from every source while marked
const isBuild = s => s.kind !== 'prop';
const PARTS = new Set(['head', 'chest', 'arm', 'stomach', 'legs']);
const cloneBox = b => ({ ...b, min: [...b.min], max: [...b.max] });
const pieceTuple = s => [s.id, KINDS.indexOf(s.kind), s.i, s.k, s.l, s.o ?? 0, MAT_IDS.indexOf(s.mat), Math.round(s.hp), s.maxHp, Math.round(s.grow), Math.round(s.rate), s.owner, s.mask | 0];
const pieceUpdate = s => [s.id, MAT_IDS.indexOf(s.mat), Math.round(s.hp), s.maxHp, Math.round(s.grow), Math.round(s.rate)];
const POWER_BUFF = { p_damage: 'damage', p_rapid: 'rate', p_barrier: 'barrier' }; // timed team powerups
const freshStats = () => ({ kills: 0, dmg: 0, builds: 0, repaired: 0, revives: 0, harvested: 0, downs: 0, rescues: 0 });
const tmpBoxes = [];

// Closest distance between a ray (o + u t, t >= 0, |u| = 1) and the vertical segment a .. a + (0, h, 0).
function rayAxisDist(o, u, a, h) {
  const w = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const b = u[1] * h, c = h * h, d = u[0] * w[0] + u[1] * w[1] + u[2] * w[2], e = h * w[1];
  const den = c - b * b;
  let s = den > 1e-9 ? (e - b * d) / den : 0;
  s = Math.max(0, Math.min(1, s));
  const t = Math.max(0, b * s - d);
  s = Math.max(0, Math.min(1, (t * b + e) / c));
  return Math.hypot(w[0] + u[0] * t, w[1] + u[1] * t - h * s, w[2] + u[2] * t);
}

export class HoldoutRoom extends BaseRoom {
  constructor(code, opts = {}) {
    super();
    this.code = code;
    this.maxPlayers = 4;
    this.diffId = 'endless'; // one curve: the waves just keep getting harder
    this.diff = 1;
    this.rng = opts.rng || Math.random;
    this.players = [];
    this.public = false;
    this.host = null;
    this.map = OUTPOST;
    this.coreBase = OUTPOST.core.base;
    this.flow = new FlowField(OUTPOST.bounds, OUTPOST_STATIC, OUTPOST.core);
    this.director = new Director(this, this.rng);
    this.inventory = new Inventory(this);
    this.combat = new Combat(this);
    this.defenses = new Defenses(this);
    this.cannon = new CoreCannon(this);
    this.survivors = new Survivors(this);
    this.sky = new SkyBoss(this);
    this.events = new Events(this);
    this.bosses = new Bosses(this);
    this.smith = new Blacksmith(this);
    this.barriers = new Barriers(this);
    this.ronin = new Ronin(this); // the melee kit: the katana's moves, bleed, Deflect
    this.zid = 0;
    this.pid = 0;
    this.resetWorld();
  }

  newItem(w, r = 0) { return makeGun(w, r); }

  // ---------- world state ----------
  resetWorld() {
    this.phase = 'lobby';
    this.phaseEnd = 0;
    this.wave = 0;
    this.pieces = new Map();
    this.slots = new Map();
    this.nextSid = 1;
    this.nodes = OUTPOST_NODES.map(n => ({ ...n, hp: NODE_TYPES[n.type].hits }));
    this.zombies = new Map();
    this.proj = [];
    this.spawnBatch = [];
    this.dirtyPieces = new Set();
    this.grid = new BoxGrid(4);
    this.statics = OUTPOST_STATIC.map(cloneBox); // per room: grids tag the boxes they hold
    for (const b of this.statics) this.grid.add(b);
    for (const n of this.nodes) { n.box = cloneBox(n.box); this.grid.add(n.box); }
    this.props = new Map(); // map index -> prop piece; props are breakable pieces with kind 'prop'
    for (const d of OUTPOST_PROPS) {
      const box = cloneBox(d.box), s = { id: this.nextSid++, kind: 'prop', prop: d.id, mat: box.mat, hp: d.hp, maxHp: d.hp, grow: 0, rate: 0, owner: null, mask: 0, box, boxes: [box] };
      box.sid = s.id;
      this.pieces.set(s.id, s);
      this.props.set(d.id, s);
      this.grid.add(box);
    }
    this.collapse = [];      // [{ s, at }] pieces falling after losing support
    this.hazards = [];       // acid pools, ink clouds, fire patches (behaviors.js)
    this.hzId = 0;
    this.integrityDirty = false;
    this.core = { hp: coreHp(this.activeCount()), max: coreHp(this.activeCount()) };
    this.director.reset();
    for (const m of [this.inventory, this.combat, this.defenses, this.cannon, this.survivors, this.sky, this.events, this.bosses, this.barriers, this.ronin]) m.reset();
    this.buffs = {};
    this.teamUps = { vitality: 0, firepower: 0, engineering: 0, gunnery: 0 };
    this.coreHealer = null;
    this.coreHealAt = 0;
    this.coreHitAt = 0;
    this.flowDirty = true;
    Object.assign(this, { flowAt: 0, aiAcc: 0, snapAt: 0, pieceAt: 0, statAt: 0, rosterAt: 0, lastStat: '', coreAlarmAt: 0, golemWaveAlert: -1, seekerAlertAt: 0, flyerWaveAlert: -1 });
    this.chestSniperTaken = new Set(); // Colossus-wave chest snipers: one per player, reset with the world
    this.events.refreshChests(HOLDOUT.chests);
  }

  isFull() { return this.players.length >= this.maxPlayers; }
  // building, harvesting, looting and breaking things only once the match has started
  started() { return this.phase === 'prep' || this.phase === 'wave' || this.phase === 'intermission'; }
  notYet(p) { if (this.started()) return false; this.send(p, { t: 'deny', text: this.phase === 'lobby' || this.phase === 'countdown' ? 'Wait for the game to start — press your ready key when ready' : 'The match is over' }); return true; }
  builds() { return [...this.pieces.values()].filter(isBuild); }
  activeCount() { return Math.max(1, this.players?.length || 0); }
  hasWeapon(p, w) { return carries(p, w); }
  aliveNodeBoxes() { return this.nodes.filter(n => n.hp > 0).map(n => n.box); }
  eye(p) { return [p.st.p[0], p.st.p[1] + 1.6, p.st.p[2]]; }
  buffActive(kind) { return Date.now() < (this.buffs[kind] || 0); }
  // players and survivors zombies may go after
  targets() { return [...this.players, ...[...this.survivors.list.values()].filter(s => s.state !== 'carried')]; }

  makePlayer(name, ws) {
    return {
      id: 'p' + nextUid(), name, ws, bot: false, side: 'CT',
      hp: 100, money: HOLDOUT.startMoney, alive: false, downed: false, bleedEnd: 0, respawnAt: 0,
      ...freshBackpack(), mats: { ...HOLDOUT.startMats }, ready: false, carrying: null, buyback: null, cls: null, maxHp: 200, as: armorStats(null),
      st: { p: [0, 0, 0], v: [0, 0, 0], y: 0, pi: 0, c: 0, w: 'pistol', g: true },
      lastShot: {}, ping: 0, spawnPos: null, stats: freshStats(),
      reviver: null, reviveProg: 0, reviveLast: 0, lastBuild: 0, lastRepair: 0, lastHarvest: 0, lastEdit: 0, lastCoreHealDeny: 0,
    };
  }

  addPlayer(ws, name) {
    const p = this.makePlayer(name, ws);
    this.players.push(p);
    this.host ??= p.id;
    this.send(p, { t: 'welcome', id: p.id, code: this.code, maxPlayers: this.maxPlayers, diff: this.diffId });
    this.syncWorld(p);
    this.spawn(p);
    if (this.phase === 'lobby') this.core.hp = this.core.max = coreHp(this.activeCount());
    if (this.phase === 'wave') this.director.rescale(this.activeCount());
    this.broadcast({ t: 'msg', text: `${name} joined the defense` }, p);
    this.broadcastPhase();
    this.broadcastRoster();
    return p;
  }

  removePlayer(p) {
    if (p.carrying) this.survivors.drop(p);
    this.players = this.players.filter(q => q !== p);
    if (this.host === p.id) this.host = this.players[0]?.id ?? null;
    if (this.coreHealer === p.id) this.coreHealer = null;
    for (const q of this.players) if (q.reviver === p.id) { q.reviver = null; q.reviveProg = 0; }
    if (this.phase === 'lobby') this.core.hp = this.core.max = coreHp(this.activeCount());
    if (this.phase === 'wave' && this.players.length) this.director.rescale(this.activeCount());
    this.broadcast({ t: 'msg', text: `${p.name} left` });
    this.checkReady();
    this.broadcastRoster();
  }

  spawn(p) {
    const used = new Set(this.players.filter(q => q !== p && q.alive).map(q => q.spawnIdx));
    const idx = [0, 1, 2, 3].find(i => !used.has(i)) ?? 0, sp = this.map.spawns[idx];
    const pos = [sp.x, 0, sp.z];
    p.maxHp = this.maxHpFor(p);
    Object.assign(p, { hp: p.maxHp, alive: true, downed: false, respawnAt: 0, bleedEnd: 0, reviver: null, reviveProg: 0, spawnPos: pos, spawnIdx: idx });
    p.st = { ...p.st, p: pos, v: [0, 0, 0], y: sp.yaw, pi: 0, c: 0 };
    this.broadcast({ t: 'spawn', id: p.id, pos, yaw: sp.yaw });
    this.sendInv(p);
  }

  // Everything a (late) joiner needs.
  syncWorld(p) {
    this.send(p, {
      t: 'sall', s: this.builds().map(pieceTuple),
      nodes: this.nodes.filter(n => n.hp < NODE_TYPES[n.type].hits).map(n => [n.id, n.hp]),
      props: [...this.props.values()].filter(s => this.pieces.get(s.id) === s).map(s => [s.prop, s.id, Math.round(s.hp)]),
    });
    this.send(p, { t: 'zclear' });
    if (this.zombies.size) this.send(p, { t: 'zsp', z: [...this.zombies.values()].map(z => [z.id, z.ti, z.maxHp, r2(z.pos[0]), r2(z.pos[2]), r3(z.yaw), z.ci, r2(z.pos[1])]) });
    for (const m of [this.inventory, this.defenses, this.cannon, this.survivors, this.sky, this.events, this.combat, this.bosses, this.barriers]) m.syncTo(p);
    this.send(p, this.buffMsg());
    this.send(p, { t: 'teamups', ups: this.teamUps });
    this.send(p, this.phaseMsg());
  }

  // ---------- phases ----------
  onReady(p, on) {
    if (this.phase !== 'lobby' && this.phase !== 'prep' && this.phase !== 'intermission') return;
    p.ready = on;
    this.broadcastRoster();
    this.checkReady();
  }

  checkReady() {
    if (!this.players.length || !this.players.every(p => p.ready)) return;
    const now = Date.now();
    if (this.phase === 'lobby') {
      this.phase = 'countdown';
      this.phaseEnd = now + HOLDOUT.countdown;
      this.core.hp = this.core.max = coreHp(this.activeCount());
      this.director.plan(1);
      this.broadcastPhase();
    } else if ((this.phase === 'intermission' || this.phase === 'prep') && this.phaseEnd - now > HOLDOUT.readySkip) {
      const skippedSec = (this.phaseEnd - now - HOLDOUT.readySkip) / 1000;
      this.phaseEnd = now + HOLDOUT.readySkip;
      if (skippedSec >= 10) {
        const reward = Math.min(600, Math.round(12 * skippedSec));
        for (const p of this.players) { p.money = Math.min(MONEY_CAP, p.money + reward); this.sendInv(p); }
        this.broadcast({ t: 'msg', text: `Skipped early: +$${reward} each` });
      }
      this.broadcastPhase();
    }
  }

  // The game begins: everyone is put around the Core with a break to build and shop before wave 1.
  startPrep() {
    const now = Date.now();
    this.phase = 'prep';
    this.phaseEnd = now + intermissionFor(0);
    for (const p of this.players) { p.ready = false; if (p.carrying) this.survivors.drop(p); this.spawn(p); }
    this.broadcastPhase();
    this.broadcastRoster();
  }

  startWave(w) {
    const now = Date.now();
    this.wave = w;
    this.phase = 'wave';
    this.phaseEnd = 0;
    for (const p of this.players) p.ready = false;
    const max = coreHp(this.activeCount());
    if (max > this.core.max) { this.core.hp += max - this.core.max; this.core.max = max; }
    this.director.start(w, now);
    this.events.scheduleWave(now);
    this.survivors.onWave(w);
    this.bosses.onWave(w, now);
    if (bossFor(w) === 'sky') {
      this.sky.spawn(now, w);
      this.broadcast({ t: 'task', text: 'THE COLOSSUS: shoot its glowing weak points with a sniper (SSG 08 / AWP)' });
    }
    this.broadcastPhase();
    this.broadcastRoster();
  }

  waveCleared() {
    const w = this.wave;
    for (const p of this.players) {
      p.money = Math.min(MONEY_CAP, p.money + 800 + 100 * w);
      for (const m of MAT_IDS) p.mats[m] = Math.min(MAT_CAP, p.mats[m] + HOLDOUT.waveMats[m]);
      if (p.downed) this.revive(p, null);
      else if (!p.alive) this.spawn(p);
      this.sendInv(p);
    }
    this.core.hp = Math.min(this.core.max, this.core.hp + this.core.max * 0.1);
    for (const pr of this.proj) this.broadcast({ t: 'splat', id: pr.id, p: pr.pos.map(r2) }); // globs still in the air fizzle
    this.proj = [];
    this.phase = 'intermission';
    const mawBreak = bossFor(w) === 'maw'; // it wrecks the whole fort: a much longer break to rebuild
    this.phaseEnd = Date.now() + (mawBreak ? MAW_BREAK : intermissionFor(w));
    this.director.plan(w + 1);
    if (w % 3 === 0) this.events.refreshChests(HOLDOUT.chests);
    if (w === 7 && !this.bosses.smith) { this.bosses.smith = true; this.onSmithUnlocked(); }
    if (mawBreak) this.broadcast({ t: 'task', text: 'The Maw wrecked the fort — 4 minutes to rebuild this break' });
    const next = bossFor(w + 1);
    if (next === 'sky') {
      this.broadcast({ t: 'task', text: "Something huge darkens the sky next wave — the squad's sniper rifles are waiting in the team chest, one each!" });
      this.inventory.giveChestSnipers(this.players.length);
    } else if (next === 'grave') this.broadcast({ t: 'task', text: 'THE GRAVEKEEPER comes next wave — only CONES seal his grave pits: save materials' });
    if (this.director.planned?.night) this.broadcast({ t: 'task', text: 'Night falls next wave — zombies will be hard to see. Flashlights help!' });
    this.broadcastPhase();
    this.broadcastRoster();
  }

  endMatch(win, why = win ? 'win' : 'core') {
    this.phase = win ? 'victory' : 'defeat';
    this.phaseEnd = Date.now() + HOLDOUT.endScreen;
    for (const z of this.zombies.values()) z.dead = true;
    this.zombies.clear();
    this.proj = [];
    this.director.queue = [];
    this.bosses.grave.end();
    this.broadcast({ t: 'zclear' });
    this.broadcast({ t: 'hend', win, why, wave: this.wave, diff: this.diffId, stats: this.players.map(p => ({ id: p.id, name: p.name, ...p.stats })) });
    this.broadcastPhase();
  }

  newMatch() {
    this.resetWorld();
    for (const p of this.players) {
      Object.assign(p, { money: HOLDOUT.startMoney, mats: { ...HOLDOUT.startMats }, ...freshBackpack(), ready: false, carrying: null, buyback: null, stats: freshStats(), as: armorStats(null), fx: null, adrenUntil: 0, lastAdrenaline: 0, katana: null, kat: null });
      this.ronin.onKit(p); // a Ronin gets a fresh katana in slot 1
      this.syncWorld(p);
      this.spawn(p);
    }
    this.broadcastRoster();
  }

  // ---------- tick ----------
  update(now, dt) {
    if (this.phase === 'countdown' && now >= this.phaseEnd) this.startPrep();
    else if ((this.phase === 'prep' || this.phase === 'intermission') && now >= this.phaseEnd) this.startWave(this.wave + 1);
    else if ((this.phase === 'victory' || this.phase === 'defeat') && now >= this.phaseEnd) this.newMatch();
    if (this.phase === 'wave') {
      this.director.update(now);
      if (this.director.done()) this.waveCleared();
    }
    // the Core mends itself (on top of the hold-E repair between waves): fast during breaks, slowly in a wave once it's left alone
    const mend = this.phase !== 'wave' ? HOLDOUT.coreMend : now - this.coreHitAt >= HOLDOUT.coreMendAfter ? HOLDOUT.coreMendWave : 0;
    if (this.started() && mend && this.core.hp < this.core.max) this.core.hp = Math.min(this.core.max, this.core.hp + this.core.max * mend * dt);
    for (const p of this.players) {
      if (p.downed) {
        if (p.reviver && now - p.reviveLast < 500) p.bleedEnd += dt * 1000; // bleeding pauses while being revived
        else if (p.reviver) { p.reviver = null; p.reviveProg = 0; }
        if (now >= p.bleedEnd) this.die(p, null);
      }
      if (!p.alive && p.respawnAt && now >= p.respawnAt) this.spawn(p);
    }
    if (this.collapse.length) this.updateCollapse(now);
    this.updateMedics(now);
    this.updateAdrenaline(now);
    this.updateZombieMedics(now);
    if (this.integrityDirty) this.checkIntegrity(now);
    for (const s of this.pieces.values()) if (s.grow > 0) {
      const add = Math.min(s.grow, s.rate * dt);
      s.hp += add;
      s.grow -= add;
      this.flowDirty = true; // zombies re-price walls as they harden (recomputed at most 4×/s)
    }
    this.aiAcc = Math.min(this.aiAcc + dt, HOLDOUT.aiStep * 3);
    while (this.aiAcc >= HOLDOUT.aiStep) {
      const step = HOLDOUT.aiStep;
      this.aiAcc -= step;
      if (this.phase === 'wave') {
        updateZombies(this, step, now);
        updateProjectiles(this, step, now);
        this.sky.update(now);
        this.bosses.update(step, now);
        updateHazards(this, now);
        updateSpecials(this, now);
        updatePlayerEffects(this, step, now);
        for (const z of [...this.zombies.values()]) {
          if (z.burnUntil > now) this.damageZombie(z, z.burnDps * step, z.burnBy, 'flame');
          if (z.poisonUntil > now) this.damageZombie(z, z.poisonDps * step, z.poisonBy, 'toxic');
        }
      }
      this.combat.update(step, now);
      this.ronin.update(step, now);
      this.defenses.update(step, now);
      this.cannon.update(step, now);
      this.survivors.update(step, now);
      if (this.phase === 'victory' || this.phase === 'defeat') break; // the Core fell
    }
    this.barriers.update(dt, now);
    this.events.update(dt, now);
    this.inventory.update(now);
    this.inventory.updateGravity(now, dt);
    if (this.coreHealer && now - this.coreHealAt > 600) { this.coreHealer = null; this.broadcast({ t: 'coreheal', id: null }); }
    if (this.flowDirty && now - this.flowAt >= 250) {
      this.flow.update(this.aliveNodeBoxes(), [...this.pieces.values()]);
      this.flowDirty = false;
      this.flowAt = now;
    }
    this.flushNet(now);
  }

  flushNet(now) {
    if (this.spawnBatch.length) { this.broadcast({ t: 'zsp', z: this.spawnBatch }); this.spawnBatch = []; }
    if (now - this.snapAt >= 66 && (this.zombies.size || this.snapLive)) {
      this.snapAt = now;
      this.snapLive = this.zombies.size > 0;
      this.sendSnapshot(now);
    }
    if (now - this.pieceAt >= 200 && this.dirtyPieces.size) {
      this.pieceAt = now;
      const s = [...this.dirtyPieces].filter(p => this.pieces.get(p.id) === p).map(pieceUpdate);
      this.dirtyPieces.clear();
      if (s.length) this.broadcast({ t: 'supd', s });
    }
    if (now - this.statAt >= 250) {
      this.statAt = now;
      const left = this.director.remaining + this.zombies.size, core = Math.max(0, Math.round(this.core.hp));
      const key = `${left}|${core}|${this.core.max}`;
      if (key !== this.lastStat) { this.lastStat = key; this.broadcast({ t: 'hstat', left, core: [core, this.core.max] }); }
    }
    if (now - this.rosterAt >= 1000) { this.rosterAt = now; this.broadcastRoster(); }
  }

  // Binary horde snapshot (little-endian): [u8 1, u8 0, u16 count, f64 time] + per zombie
  // [u16 id, i16 x·100, i16 y·100, i16 z·100, i16 yaw·10000, u8 state (4 = frozen), u8 hp/max·255,
  //  u8 status (1 burning, 2 soaked, 4 chilled, 8 underground, 16 shield up, 32 marked, 64 berserk, 128 poisoned), u8 bleed stacks (the Ronin's katana)] (14 bytes).
  // A plain ArrayBuffer (no Node Buffer) so the room also runs in the browser's solo worker.
  sendSnapshot(now) {
    const buf = new ArrayBuffer(12 + this.zombies.size * 14), v = new DataView(buf);
    v.setUint8(0, 1);
    v.setUint16(2, this.zombies.size, true);
    v.setFloat64(4, now, true);
    let o = 12;
    for (const z of this.zombies.values()) {
      v.setUint16(o, z.id, true);
      v.setInt16(o + 2, clamp16(z.pos[0] * 100), true);
      v.setInt16(o + 4, clamp16(z.pos[1] * 100), true);
      v.setInt16(o + 6, clamp16(z.pos[2] * 100), true);
      v.setInt16(o + 8, clamp16(wrap(z.yaw) * 10000), true);
      v.setUint8(o + 10, now < (z.frozenUntil || 0) ? 4 : z.state);
      v.setUint8(o + 11, Math.max(0, Math.min(255, Math.round((z.hp / z.maxHp) * 255))));
      v.setUint8(o + 12, (z.burnUntil > now ? 1 : 0) | (z.soakUntil > now ? 2 : 0) | (z.chillAt && now - z.chillAt < 3000 && z.chill > 0 ? 4 : 0) | (z.under ? 8 : 0) | (z.t.shield && now >= (z.shieldDown || 0) ? 16 : 0) | (z.markUntil > now ? 32 : 0) | (z.berserk ? 64 : 0) | (z.poisonUntil > now ? 128 : 0));
      v.setUint8(o + 13, z.bleedUntil > now ? z.bleedN : 0);
      o += 14;
    }
    for (const p of this.players) if (p.ws && p.ws.readyState === 1) p.ws.send(buf);
  }

  // ---------- zombies ----------
  spawnZombie(type, laneId, variant = null) {
    const t = ZTYPES[type], lane = this.map.lanes.find(l => l.id === laneId) ?? this.map.lanes[0];
    const [x0, z0, x1, z1] = lane.zone;
    let x, z, tries = 0;
    if (t.flyer) { x = x0 + this.rng() * (x1 - x0); z = z0 + this.rng() * (z1 - z0); } // flies in — no ground clearance needed
    else do { x = x0 + this.rng() * (x1 - x0); z = z0 + this.rng() * (z1 - z0); }
    while (tries++ < 8 && blocked(x, 0, z, 1.8 * t.scale, this.grid.query(x - 1, z - 1, x + 1, z + 1, tmpBoxes)));
    do this.zid = (this.zid + 1) & 0xffff; while (!this.zid || this.zombies.has(this.zid));
    const cls = variant ?? (!t.boss && !t.noVariant && this.rng() < variantChance(this.wave) ? ZCLASS_IDS[1 + Math.floor(this.rng() * 3)] : '');
    const C = ZCLASSES[cls] ?? {};
    const maxHp = Math.round((t.boss ? bossHp(t, this.director.n) : t.hp * this.director.hpMul) * (C.hp ?? 1));
    const yaw = Math.atan2(x, z); // face the Core
    const zb = {
      id: this.zid, type, t, ti: ZTYPE_IDS.indexOf(type), pos: [x, t.flyer ? FLYER_ALT : 0, z], vel: [0, 0, 0], yaw, g: !t.flyer,
      hp: maxHp, maxHp, armor: (t.armor || 0) + (cls === 'tank' ? 60 : 0), helmet: !!t.helmet || cls === 'tank', s: t.scale * (C.scale ?? 1),
      cls, ci: ZCLASS_IDS.indexOf(cls), spd: C.speed ?? 1, dmgMul: C.dmg ?? 1,
      state: 0, stateEnd: 0, nextAtk: 0, target: null, aggro: null, thinkAt: 0, aggroBlock: 0, stuck: 0,
      hist: [], dmgBy: new Map(), hurtAt: 0, dead: false, frozenUntil: 0, slowUntil: 0, slow: 0, burnUntil: 0,
      stunUntil: 0, markUntil: 0, knock: null,
    };
    this.bosses.grave.arrive(zb); // the Gravekeeper's wave: it arrives by lightning, from underground (maybe at a pit)
    this.zombies.set(zb.id, zb);
    this.spawnBatch.push([zb.id, zb.ti, maxHp, r2(zb.pos[0]), r2(zb.pos[2]), r3(zb.yaw), zb.ci, r2(zb.pos[1])]);
    if (type === 'golem' && this.golemWaveAlert !== this.wave) {
      this.golemWaveAlert = this.wave;
      this.broadcast({ t: 'task', text: 'IRON GOLEM — it smashes through walls!' });
    } else if (type === 'seeker') {
      const now = Date.now();
      if (now - this.seekerAlertAt > 20000) { this.seekerAlertAt = now; this.broadcast({ t: 'task', text: "CORE SEEKER — it's going for the Core!" }); }
    } else if ((type === 'swooper' || type === 'skysniper') && this.flyerWaveAlert !== this.wave) {
      this.flyerWaveAlert = this.wave;
      this.broadcast({ t: 'task', text: type === 'swooper' ? 'SWOOPER — incoming from above!' : 'SKY SNIPER — a laser from the sky means take cover!' });
    } else if (type === 'hoarder') { // one per wave at most, always worth an alert
      this.broadcast({ t: 'task', text: 'A HOARDER is running for the Core — kill it for the cash!' });
    }
    return zb;
  }

  // Plague medics mend the zombies around them.
  updateZombieMedics(now) {
    if (this.phase !== 'wave' || now - (this.zmedAt || 0) < 250) return;
    this.zmedAt = now;
    const R = ZCLASSES.medic.radius;
    for (const m of this.zombies.values()) {
      if (m.cls !== 'medic' || m.dead) continue;
      for (const z of this.zombies.values()) {
        if (z === m || z.dead || z.t.boss || z.hp >= z.maxHp || Math.hypot(z.pos[0] - m.pos[0], z.pos[2] - m.pos[2]) > R) continue;
        z.hp = Math.min(z.maxHp, z.hp + z.maxHp * ZCLASSES.medic.heal * 0.25);
      }
    }
  }

  // Remove without a kill (fell out of the world): its type goes back in the queue.
  removeZombie(z, requeue = false) {
    z.dead = true;
    this.zombies.delete(z.id);
    if (requeue && this.phase === 'wave') this.director.queue.push(z.type);
    this.broadcast({ t: 'zdie', id: z.id, by: null });
  }

  lineOfSight(a, b) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d);
    if (len < 0.3) return true;
    const boxes = this.grid.query(Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2]), [])
      .filter(x => x.ramp || !(a[0] > x.min[0] && a[0] < x.max[0] && a[1] >= x.min[1] && a[1] <= x.max[1] && a[2] > x.min[2] && a[2] < x.max[2])); // a turret under a cone still sees out
    const hit = rayWorld(a, d.map(v => v / len), len, boxes);
    return !hit || hit.t >= len - 0.3;
  }

  // Nearest built piece standing on the ground within r of a zombie (walls, ramps, supports, doors).
  // buildsOnly: skip map props. maxUp: how far overhead a box may sit and still count (breakers stuck under
  // a floor/ramp need a taller window than the default hip-height cutoff).
  pieceNear(pos, r, buildsOnly = false, maxUp = 1.5) {
    const body = [pos[0], pos[1] + 0.9, pos[2]];
    let best = null, bd = r;
    for (const b of this.grid.query(pos[0] - r - 1, pos[2] - r - 1, pos[0] + r + 1, pos[2] + r + 1, [])) {
      if (b.sid === undefined || b.min[1] > pos[1] + maxUp) continue;
      const d = distToBox(body, b);
      const s = this.pieces.get(b.sid);
      if (d <= bd && s && (!buildsOnly || s.kind !== 'prop')) { bd = d; best = s; }
    }
    return best;
  }

  addProjectile(o, v, z, kind = 'acid') {
    const pr = { id: ++this.pid, pos: o, vel: v, dmg: z.t.dmg, sdmg: z.t.sdmg, splash: z.t.splash || 2, born: Date.now(), from: z.id, by: z.t, kind };
    this.proj.push(pr);
    this.broadcast({ t: 'proj', id: pr.id, o: o.map(r2), v: v.map(r2), k: kind });
  }

  splash(pr, p) {
    const r = pr.splash, mul = this.director.dmgMul;
    if (pr.kind === 'ink') { // Hexer potion: blinds whoever it splashes, leaves a cloud of ink
      for (const pl of this.targets()) {
        if (!pl.alive || pl.downed) continue;
        if (Math.hypot(pl.st.p[0] - p[0], pl.st.p[1] + 0.9 - p[1], pl.st.p[2] - p[2]) <= r + 0.4) { this.hurtPlayer(pl, pr.dmg * mul, null); playerEffect(this, pl, 'blind', 1, 4000); }
      }
      addHazard(this, 'ink', p, r, 4);
      this.broadcast({ t: 'splat', id: pr.id, p: p.map(r2), ink: 1 });
      return;
    }
    for (const pl of this.targets()) {
      if (!pl.alive || pl.downed) continue;
      const d = Math.hypot(pl.st.p[0] - p[0], pl.st.p[1] + 0.9 - p[1], pl.st.p[2] - p[2]);
      if (d <= r + 0.4) this.hurtPlayer(pl, pr.dmg * mul * (1 - (0.5 * d) / (r + 0.4)), { id: pr.from, pos: p, t: pr.by ?? ZTYPES.spitter });
    }
    const hitPieces = new Set();
    for (const b of this.grid.query(p[0] - r, p[2] - r, p[0] + r, p[2] + r, [])) {
      if (b.sid !== undefined && distToBox(p, b) <= r) hitPieces.add(this.pieces.get(b.sid));
    }
    for (const s of hitPieces) if (s) this.damagePiece(s, pr.sdmg * mul, { id: pr.from, t: pr.by });
    if (distToBox(p, this.coreBase) <= r) this.damageCore(pr.sdmg * mul * (pr.kind === 'bomb' ? 0.5 : 1), null); // the Core's shell shrugs off half a sky bomb
    this.broadcast({ t: 'splat', id: pr.id, p: p.map(r2) });
  }

  // ---------- damage ----------
  hurtPlayer(p, dmg, z, kind = null) {
    if (p.isSurvivor) return this.survivors.hurt(p, dmg);
    if (!p.alive || p.downed || this.phase !== 'wave') return;
    dmg *= 1 - damageReduction(p.as?.def ?? 0); // armor
    if (p.cls === 'tank') dmg *= 1 - CLASSES.tank.dr; // Tank: takes less damage (and never gets knocked back or stunned — zombies don't do either to players)
    p.hurtAt = Date.now();
    let left = dmg;
    if (p.shield > 0) { const a = Math.min(p.shield, left); p.shield -= a; left -= a; } // shields soak damage first
    const hp = left > 0 ? Math.max(1, Math.round(left)) : 0;
    p.hp -= hp;
    this.send(p, {
      t: 'dmg', att: 'z' + (z?.id ?? 0), vic: p.id, dmg: Math.round(dmg), hp: Math.max(0, p.hp), armor: Math.round(p.shield),
      part: 'chest', w: 'zombie', from: (z?.pos ?? p.st.p).map(r2),
    });
    if (p.hp <= 0) this.down(p, z);
  }

  down(p, z) {
    if (p.carrying) this.survivors.drop(p);
    if (this.players.length < 2) return this.die(p, z); // solo: no downed state
    Object.assign(p, { downed: true, hp: 0, bleedEnd: Date.now() + HOLDOUT.bleed, reviver: null, reviveProg: 0 });
    p.stats.downs++;
    this.broadcast({ t: 'pdown', id: p.id, bleed: HOLDOUT.bleed, by: z?.t?.name ?? '' });
    this.sendInv(p);
    this.broadcastRoster();
    this.checkWipe();
  }

  // Dead players sit out until the wave is cleared (no timed respawns mid-wave).
  die(p, z) {
    if (p.carrying) this.survivors.drop(p);
    Object.assign(p, { alive: false, downed: false, hp: 0, respawnAt: 0, reviver: null });
    this.broadcast({ t: 'pdie', id: p.id, by: z?.t?.name ?? (z === null ? 'bleeding out' : ''), respawn: 0 });
    this.sendInv(p);
    this.broadcastRoster();
    this.checkWipe();
  }

  // Every real player down or dead at the same time: the defense has fallen.
  checkWipe() {
    if (this.phase === 'wave' && this.players.length && this.players.every(p => !p.alive || p.downed)) this.endMatch(false, 'wipe');
  }

  revive(p, by) {
    Object.assign(p, { downed: false, hp: HOLDOUT.reviveHp, bleedEnd: 0, reviver: null, reviveProg: 0 });
    if (by) by.stats.revives++;
    this.broadcast({ t: 'prev', id: p.id, by: by?.id ?? null });
    this.sendInv(p);
    this.broadcastRoster();
  }

  damageCore(dmg, z) {
    if (this.phase !== 'wave' || this.buffActive('barrier')) return;
    this.core.hp -= dmg * CORE_ARMOR;
    const now = Date.now();
    this.coreHitAt = now; // holds off its in-wave self-repair
    if (now - this.coreAlarmAt > 4000) { this.coreAlarmAt = now; this.broadcast({ t: 'coreHit', from: z ? [r2(z.pos[0]), r2(z.pos[2])] : null }); }
    if (this.core.hp <= 0) { this.core.hp = 0; this.endMatch(false); }
  }

  // attacker: the zombie dealing the hit (or a { id, t } stand-in for a projectile splash), optional.
  // Zombies deal 45% damage to pieces/props (not the Core), further scaled down the more of them are
  // hitting the same piece at once (each hit remembered for 1.5 s). Wall breakers ignore both cuts.
  damagePiece(s, dmg, attacker = null) {
    if (attacker && !attacker.t?.breaker) {
      const now = Date.now(), hitters = s.hitters ??= new Map();
      hitters.set(attacker.id, now);
      for (const [id, at] of hitters) if (now - at > 1500) hitters.delete(id);
      dmg *= 0.45 / (1 + 0.45 * (hitters.size - 1));
    }
    s.hp -= dmg;
    this.flowDirty = true;
    if (s.hp < 1) this.removePiece(s, 'broken'); // < 1, not <= 0: float residue from growing must not cost an extra hit
    else this.dirtyPieces.add(s);
  }

  // Any damage to a zombie (guns, explosives, traps, turrets, survivors). `by` = player, survivor or null.
  damageZombie(z, dmg, by, wId, hs = false) {
    if (z.dead || !(dmg > 0) || z.under || z.escaping) return 0; // nothing reaches a burrower underground, or a Hoarder already mid-escape
    if (this.bosses.immune(z)) return 0;           // Brood riders on the Titan's back
    if (z.markUntil > Date.now()) dmg *= MARK_MULT; // Skybreaker: marked zombies take extra from everything
    if (z.brittleUntil > Date.now()) dmg *= ITEMS.freeze.brittle; // frozen solid by a Blizzard: shatters easier
    if (by?.stats) z.lastHitBy = by.id;
    const dealt = Math.min(dmg, z.hp);
    z.hp -= dmg;
    z.hurtAt = Date.now();
    if (by?.stats) { by.stats.dmg += Math.round(dealt); z.dmgBy.set(by.id, (z.dmgBy.get(by.id) || 0) + dealt); }
    if (z.hp <= 0) this.killZombie(z, by, wId, hs);
    return dealt;
  }

  killZombie(z, killer, wId, hs = false) {
    if (z.dead) return;
    z.dead = true;
    this.zombies.delete(z.id);
    if (z.poisonUntil > Date.now()) addHazard(this, 'toxic', z.pos, EL.cloudR, EL.cloudTime, 0, 0, z.poisonDps, z.poisonBy); // dies poisoned: a cloud that poisons the rest
    if (z.type === 'hoarder') return this.hoarderPayout(z, killer, wId, hs);
    const reward = z.t.reward, player = killer?.stats ? killer : null;
    if (player) {
      player.stats.kills++;
      this.masteryKill(player, wId);
      if (!z.noReward) { // berserk reinforcements (director.js) are worth nothing — time's up, no farming them
        player.money = Math.min(MONEY_CAP, player.money + reward);
        if (player.cls === 'assault') player.assaultBuffUntil = Date.now() + CLASSES.assault.killRateMs; // +fire rate briefly after a kill
        if (this.rng() < 0.25) player.mats.zink += 3; // scrap
      }
      this.sendInv(player);
      // now and then a zombie drops a few rounds for the gun that killed it (ammo is otherwise bought)
      const type = WEAPONS[wId]?.ammo;
      if (!z.noReward && type && type !== 'rockets' && this.rng() < 0.2) this.inventory.spawn({ kind: 'ammo', type, n: Math.max(3, Math.round((AMMO[type].pack / 4) * 1.5)) }, [z.pos[0], z.pos[1], z.pos[2]]);
    }
    if (!z.noReward) for (const [pid, d] of z.dmgBy) {
      const q = pid !== player?.id && d >= z.maxHp * 0.25 && this.players.find(x => x.id === pid);
      if (q) { q.money = Math.min(MONEY_CAP, q.money + Math.round(reward / 2)); this.sendInv(q); }
    }
    if (!z.noReward) this.typeDrop(z);
    if (!z.noReward) { // Adrenaline Shots, the carried heal: a chance on any kill, big zombies always carry a few
      const big = ADREN_DROP.big.includes(z.type);
      if (big || this.rng() < ADREN_DROP.chance) this.inventory.spawn({ kind: 'item', id: 'adrenaline', n: big ? 1 + Math.floor(this.rng() * 3) : 1 }, [z.pos[0], z.pos[1] + 0.2, z.pos[2]]);
    }
    if (z.t.burst) bloaterBurst(this, z);
    if (z.t.boss) { // bosses drop guns, ammo, materials and survivor supplies
      this.inventory.scatter(rollLoot('boss'), [z.pos[0], z.pos[1], z.pos[2]], 2.2, true);
      this.broadcast({ t: 'msg', text: `The ${z.t.name} dropped a pile of loot!` });
      if (z.type === 'alpha') {
        this.inventory.scatter([{ kind: 'gun', w: 'cleaver', r: 4, tier: 3, el: null }], [z.pos[0], z.pos[1], z.pos[2]], 2.2, true);
        this.broadcast({ t: 'msg', text: 'The Alpha Brute dropped the Alpha Cleaver!' });
      }
    }
    this.broadcast({ t: 'zdie', id: z.id, by: killer?.isSurvivor ? 'sv' + killer.id : killer?.id ?? null, hs, w: wId });
  }

  // The Hoarder, killed before it reaches the Core: a flat cash bonus for the whole squad (every player gets
  // the full amount, not a split), scaling with wave. Still a normal kill otherwise (feed line, z_die, loot rules).
  hoarderPayout(z, killer, wId, hs) {
    if (killer?.stats) { killer.stats.kills++; this.masteryKill(killer, wId); }
    const cash = hoarderCash(this.wave);
    for (const p of this.players) { p.money = Math.min(MONEY_CAP, p.money + cash); this.sendInv(p); }
    this.broadcast({ t: 'hoardcash', p: [r2(z.pos[0]), r2(z.pos[1]), r2(z.pos[2])], amt: cash });
    this.broadcast({ t: 'zdie', id: z.id, by: killer?.isSurvivor ? 'sv' + killer.id : killer?.id ?? null, hs, w: wId });
  }

  // The Hoarder reached the Core: it dives down a hole with the cash. Nobody gets paid — just a taunt.
  // ai.js ticks z.escaping (a quick sink) and calls despawnZombie once it's done.
  hoarderEscape(z) {
    if (z.dead || z.escaping) return;
    z.escaping = { t0: Date.now(), T: 900 };
    z.target = null;
    this.broadcast({ t: 'msg', text: 'The HOARDER got away with the cash — nobody gets paid!' });
  }

  // Silent removal: no death animation, no sound, no reward (only the Hoarder's escape uses this).
  despawnZombie(z) {
    if (z.dead) return;
    z.dead = true;
    this.zombies.delete(z.id);
    this.broadcast({ t: 'zdie', id: z.id, by: null, silent: true });
  }

  // Some zombies carry something worth taking (shared/zombies.js ZDROPS), elite/large ones can also drop a
  // trap or turret (deployOdds, weighted by shared/holdout.js DEPLOY_WEIGHT), and at night any of them may
  // drop a flashlight.
  typeDrop(z) {
    const at = [z.pos[0], z.pos[1] + 0.2, z.pos[2]], d = ZDROPS[z.type];
    if (d && this.rng() < d.chance) {
      if (d.kind === 'common') this.commonDrop(at);
      else if (d.kind === 'armor') this.inventory.spawn({ kind: 'armor', id: pick(this.rng, ARMOR_IDS), tier: 1 + (this.rng() < 0.3 ? 1 : 0) }, at);
      else if (d.kind === 'relic') this.relicDrop(d, at);
      else {
        const w = typeof d.gun === 'function' ? d.gun(this.wave) : d.gun;
        this.inventory.spawn({ kind: 'gun', w, r: Math.min(4, 1 + Math.floor(this.rng() * 3)), tier: 1, el: null }, at);
      }
    }
    if (z.t.deployOdds && this.rng() < z.t.deployOdds) this.inventory.spawn({ kind: 'item', id: rollDeploy(this.rng), n: 1 }, at);
    if (this.director.night && this.rng() < 0.08) this.inventory.spawn({ kind: 'item', id: 'flashlight', n: 1 }, at);
  }

  // Scavenger: whatever's quick to grab — ammo, a stack of materials, or (usually, per DEPLOY_WEIGHT) a cheap trap.
  commonDrop(at) {
    const r = this.rng();
    if (r < 0.4) this.inventory.spawn({ kind: 'item', id: rollDeploy(this.rng), n: 1 }, at);
    else if (r < 0.7) this.inventory.spawn({ kind: 'mats', mat: MAT_IDS[0], n: 30 + Math.floor(this.rng() * 40) }, at);
    else { const type = pick(this.rng, AMMO_IDS); this.inventory.spawn({ kind: 'ammo', type, n: AMMO[type].pack }, at); }
  }

  // Relic Bearer: usually a high-rarity gun (sometimes elemental, sometimes a tier up), else a rare attachment.
  relicDrop(d, at) {
    if (this.rng() < 0.3) { this.inventory.spawn({ kind: 'item', id: pick(this.rng, ATTACH_IDS), n: 1 }, at); return; }
    const w = typeof d.gun === 'function' ? d.gun(this.wave) : d.gun;
    this.inventory.spawn({ kind: 'gun', w, r: 3 + (this.rng() < 0.4 ? 1 : 0), tier: this.rng() < 0.3 ? 2 : 1, el: this.rng() < 0.4 ? pick(this.rng, ELEMENT_IDS) : null }, at);
  }

  // ---------- players shooting ----------
  onShot(p, m) {
    if (m.w === 'katana') return this.ronin.onSwing(p, m); // the Ronin's combo keeps its own rules
    const w = WEAPONS[m.w];
    if (!w || !p.alive || p.downed || p.carrying || p.bar?.up || !this.hasWeapon(p, m.w)) return; // no firing behind a raised barrier
    const now = Date.now();
    const gunnery = 1 + 0.06 * (this.teamUps?.gunnery || 0);
    const assaultBuff = p.cls === 'assault' && now < (p.assaultBuffUntil || 0) ? 1 + CLASSES.assault.killRate : 1;
    const gap = (w.cat === 'melee' ? (m.alt ? 900 : 350) : 60000 / w.rpm) * 0.7 / ((this.buffActive('rate') ? BUFF.rate : 1) * gunnery * assaultBuff);
    if (now - (p.lastShot[m.w] || 0) < gap) return;
    p.lastShot[m.w] = now;
    this.broadcast({ t: 'shot', id: p.id, w: m.w, o: m.o, d: m.d, e: m.e, alt: !!m.alt }, p);
    if (!Array.isArray(m.o) || m.o.length !== 3 || !m.o.every(Number.isFinite)) return;
    const eye = this.eye(p);
    if (Math.hypot(m.o[0] - eye[0], m.o[1] - eye[1], m.o[2] - eye[2]) > 2.5) return; // must shoot from where you are
    const item = (m.uid !== undefined && gunByUid(p, m.uid)) || p.inv.find(g => g?.kind === 'gun' && g.id === m.w), mult = gunMult(item) * this.dmgMultFor(p);
    if (Array.isArray(m.bal)) for (const id of m.bal.slice(0, 2)) this.events.onBalloon(p, { id });
    if (Array.isArray(m.sky) && w.cat === 'sniper') { // weak points of the Colossus: snipers only
      for (const [i, k] of m.sky.slice(0, 1)) this.sky.hit(p, i | 0, m.o, m.d?.[k | 0], w.dmg * 2 * mult, now);
    }
    if (Array.isArray(m.maw) && w.cat !== 'melee') for (const [k, key] of m.maw.slice(0, w.pellets)) this.bosses.hitMaw(p, m.o, m.d?.[k | 0], w.dmg * mult, key);
    if (Array.isArray(m.bhm) && w.cat !== 'melee') for (const c of m.bhm.slice(0, w.pellets)) this.bosses.behemoth.hitHeart(p, c?.[0] | 0, m.o, m.d?.[c?.[1] | 0], w.dmg * mult); // the Behemoth's open hearts: [heart, pellet]
    if (!Array.isArray(m.h) || !m.h.length) return;
    // gun mods (bullet guns only): Multishot adds a round (k = pellets) at half damage; Piercing lets a round's second
    // claim (the zombie behind the first) through at 70%. Otherwise one claim per round.
    const mods = w.cat === 'melee' || w.projectile ? [] : item?.mods ?? [], shots = w.pellets + (mods.includes('multi') ? 1 : 0), perRound = mods.includes('pierce') ? 2 : 1;
    const byZombie = new Map(), rounds = new Map();
    for (const h of m.h.slice(0, shots * (w.pierce || perRound))) { // pierce (Skybreaker): several claims can share one pellet index
      const z = this.zombies.get(h?.id);
      if (!z || z.dead || !PARTS.has(h.part)) continue;
      if (w.cat === 'melee') {
        if (Math.hypot(z.pos[0] - eye[0], z.pos[2] - eye[2]) > w.reach + 1.2 * z.s) continue;
        if (w.arc) { // a sweeping slash: only what is in front of you
          const dx = z.pos[0] - eye[0], dz = z.pos[2] - eye[2], f = [-Math.sin(p.st.y), -Math.cos(p.st.y)];
          if ((dx * f[0] + dz * f[1]) / Math.max(1e-3, Math.hypot(dx, dz)) < Math.cos(((w.arc / 2 + 15) * Math.PI) / 180)) continue;
        }
      } else if (!this.rayNearZombie(m.o, m.d?.[h.k | 0], z)) continue;
      let pen = Number.isFinite(+h.pen) ? Math.min(1, Math.max(0, +h.pen)) : 1;
      if (w.cat !== 'melee') { // (the Skybreaker pierces on its own: any number of claims per round, all at full damage)
        const k = h.k | 0, got = rounds.get(k) ?? [];
        if (k >= shots || (!w.pierce && (got.length >= perRound || got.includes(z)))) continue;
        rounds.set(k, [...got, z]);
        pen *= (k >= w.pellets ? GUN_MODS.multi.frac : 1) * (got.length && !w.pierce ? GUN_MODS.pierce.frac : 1);
      }
      (byZombie.get(z) ?? byZombie.set(z, []).get(z)).push({ part: h.part, pen });
    }
    p.shotItem = item; // kills while this shot resolves (hits, splash, arcs) count toward the gun's mastery
    for (const [z, hits] of byZombie) this.hitZombie(p, z, w, hits, !!m.alt, mult, item?.els ?? (item?.el ? [item.el] : []));
    if (mods.includes('explo')) this.explodeTips(p, byZombie, w, mult);
    p.shotItem = null;
    if (w.bite && byZombie.size) { // Maw Fang: every 5th shot pulls nearby zombies toward the first hit
      p.mfShots = (p.mfShots || 0) + 1;
      if (p.mfShots % w.bite === 0) {
        const at = byZombie.keys().next().value.pos;
        for (const z of this.zombies.values()) {
          if (z.dead || z.t.boss) continue;
          const dx = z.pos[0] - at[0], dz = z.pos[2] - at[2], d = Math.hypot(dx, dz);
          if (d > 6) continue;
          this.knockZombie(z, d > 0.1 ? -dx / d : 0, d > 0.1 ? -dz / d : 1, Math.min(3, d), 12, { noSlam: true });
        }
        this.broadcast({ t: 'bite', p: at.map(r2) });
      }
    }
    if (w.pool && byZombie.size && (p.knShots = (p.knShots || 0) + 1) % w.pool.every === 0) this.bosses.grave.knellPool(p, byZombie.keys().next().value.pos, w); // Knell
  }

  // The Maw's eruption tears up map props too. Player guns and explosives never damage props or builds.
  damageProps(at, radius, dmg) {
    if (!this.started()) return;
    for (const s of this.props.values()) {
      if (this.pieces.get(s.id) !== s) continue;
      const d = distToBox(at, s.box);
      if (d <= radius) this.damagePiece(s, dmg * (1 - (0.5 * d) / radius));
    }
  }

  // Lag tolerance: the claimed bullet must pass close to where the zombie was during the last second (clients
  // draw the horde 100 ms in the past, plus the round trip). tol covers the drawn pose around the feet axis —
  // up to 1.2·s for a lunging Runner's arms, a leaning head or a flyer's wings — and the history is walked in
  // ≤ 0.5 m steps so a diving Swooper's 1.7 m jumps between 50 ms samples leave no gaps.
  rayNearZombie(o, d, z) {
    if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) return false;
    const len = Math.hypot(...d);
    if (len < 1e-6) return false;
    const u = d.map(v => v / len), h = 1.9 * z.s, tol = 1.25 * z.s + 0.5, H = z.hist;
    let prev = null;
    for (let i = 0; i <= H.length; i += 4) {
      const a = i < H.length ? [H[i + 1], H[i + 2], H[i + 3]] : z.pos;
      const n = prev ? Math.min(8, Math.ceil(Math.hypot(a[0] - prev[0], a[1] - prev[1], a[2] - prev[2]) / 0.5)) || 1 : 1;
      for (let k = 1; k <= n; k++) {
        if (rayAxisDist(o, u, prev ? prev.map((v, j) => v + ((a[j] - v) * k) / n) : a, h) <= tol) return true;
      }
      prev = a;
    }
    return false;
  }

  hitZombie(att, z, w, hits, alt, mult = 1, els = []) {
    const a = att.st.p, dist = Math.hypot(a[0] - z.pos[0], a[1] - z.pos[1], a[2] - z.pos[2]);
    let total = 0, hs = false, part = hits[0].part;
    for (const h of hits) {
      total += computeDamage(w, h.part, dist, z.armor, z.helmet, h.pen, { alt, back: false }).hp * (w.cat === 'melee' ? 1 : mult);
      if (h.part === 'head') { hs = true; part = 'head'; }
    }
    if (els.some(el => z.t.weak?.includes(el))) total *= 1.5; // pyros hate water and ice, frost walkers hate fire
    if (z.type === 'titan') { // the glowing egg sac on its back takes double
      const dx = a[0] - z.pos[0], dz = a[2] - z.pos[2], l = Math.hypot(dx, dz), f = [-Math.sin(z.yaw), -Math.cos(z.yaw)];
      if (l > 0.1 && (dx * f[0] + dz * f[1]) / l < -0.3) total *= 2;
    }
    if (z.type === 'gravekeeper') total *= this.bosses.grave.bellMult(z, a); // the bell on his back takes double
    const immune = this.bosses.immune(z);
    const blocked = w.cat !== 'melee' && shieldBlocks(z, a, Date.now());
    if (blocked) total *= z.t.shield; // rounds spark off the riot shield
    total = Math.round(total);
    const left = z.hp - total;
    const dealt = this.damageZombie(z, total, att, w.id, hs && w.cat !== 'melee');
    if (els.length && !z.dead) { const k = els.length > 1 ? 0.8 : 1; for (const el of els) this.applyElement(z, el, total * k, att); } // several elements: each at reduced strength
    if (w.mark && !z.dead) z.markUntil = Date.now() + 5000; // Skybreaker: marked for 5s
    if (w.chain) this.applyElement(z, 'shock', total, att); // Knell: arcs to the 2 nearest zombies like shock rounds
    if (w.lifesteal && dealt > 0) this.healPlayer(att, dealt * w.lifesteal); // Maw Fang
    if (w.knockdown && !z.dead) { // Alpha Cleaver: stunned and shoved off, no slam
      const dx = z.pos[0] - a[0], dz = z.pos[2] - a[2], d = Math.hypot(dx, dz);
      this.knockZombie(z, d > 0.1 ? dx / d : 0, d > 0.1 ? dz / d : 1, 2, 14, { noSlam: true });
      z.stunUntil = Date.now() + 1000;
    }
    this.send(att, {
      t: 'dmg', att: att.id, vic: 'z' + z.id, dmg: Math.round(dealt), hp: Math.max(0, left), part, w: w.id,
      helm: (hs && z.helmet && w.cat !== 'melee') || blocked || immune, immune, from: a,
    });
  }

  // Elemental rounds (shared/elements.js): burn, soak, chill/freeze, arcing shock.
  applyElement(z, el, dmg, by) {
    const now = Date.now();
    if (z.t.immune === el) return;
    const soaked = now < (z.soakUntil || 0);
    if (el === 'fire') {
      if (soaked) { z.soakUntil = 0; return; } // steam
      z.burnUntil = now + EL.burnTime * 1000;
      z.burnDps = Math.max(z.burnUntil > now ? z.burnDps || 0 : 0, (dmg * EL.burnFrac) / EL.burnTime);
      z.burnBy = by;
    } else if (el === 'water') {
      z.soakUntil = now + EL.soakTime * 1000;
      z.burnUntil = 0;
      z.slowUntil = Math.max(z.slowUntil, now + 1500); z.slow = Math.max(z.slow || 0, EL.soakSlow);
    } else if (el === 'ice') {
      if (now - (z.chillAt || 0) > EL.chillTime * 1000) z.chill = 0;
      z.chillAt = now;
      z.chill = (z.chill || 0) + (z.t.boss ? EL.chillPer / 4 : EL.chillPer);
      z.slowUntil = Math.max(z.slowUntil, now + 1500); z.slow = Math.max(z.slow || 0, 0.3);
      if (soaked || z.chill >= 1) { z.frozenUntil = now + EL.freeze * 1000 * (z.t.boss ? 0.3 : 1); z.chill = 0; z.soakUntil = 0; }
    } else if (el === 'shock') {
      if (soaked) this.damageZombie(z, dmg, by, 'shock');
      const near = [...this.zombies.values()].filter(o => o !== z && !o.dead && Math.hypot(o.pos[0] - z.pos[0], o.pos[2] - z.pos[2]) <= EL.arcRange)
        .sort((a, b) => Math.hypot(a.pos[0] - z.pos[0], a.pos[2] - z.pos[2]) - Math.hypot(b.pos[0] - z.pos[0], b.pos[2] - z.pos[2])).slice(0, EL.arcs);
      for (const o of near) {
        this.broadcast({ t: 'arc', a: [r2(z.pos[0]), r2(z.pos[1] + 1.2 * z.s), r2(z.pos[2])], b: [r2(o.pos[0]), r2(o.pos[1] + 1.2 * o.s), r2(o.pos[2])] });
        this.damageZombie(o, dmg * EL.arcFrac * (now < (o.soakUntil || 0) ? 2 : 1), by, 'shock');
      }
    } else if (el === 'toxic') this.poison(z, (dmg * EL.poisonFrac) / EL.poisonTime, by);
  }

  // Toxic: poison ticks with the burns (update); the strongest dose wins and the timer restarts. Also what a
  // poisoned zombie's death cloud does to the ones standing in it (behaviors.js updateHazards).
  poison(z, dps, by) {
    const now = Date.now();
    if (z.dead || z.t.immune === 'toxic') return;
    z.poisonDps = Math.max(z.poisonUntil > now ? z.poisonDps || 0 : 0, dps);
    z.poisonUntil = now + EL.poisonTime * 1000;
    z.poisonBy = by;
  }

  // Explosive tips (gun mod): each round that hits a zombie bursts on the zombies around it for a share of its damage.
  // Zombies only — player weapons never touch builds or props.
  explodeTips(p, byZombie, w, mult) {
    const E = GUN_MODS.explo;
    for (const [z, hits] of byZombie) {
      const c = z.pos, dmg = w.dmg * mult * E.frac * hits.reduce((a, h) => a + h.pen, 0);
      for (const o of [...this.zombies.values()]) {
        if (o !== z && !o.dead && Math.hypot(o.pos[0] - c[0], o.pos[2] - c[2]) <= E.radius && Math.abs(o.pos[1] - c[1]) < 2) this.damageZombie(o, dmg, p, w.id);
      }
      this.broadcast({ t: 'etip', p: [r2(c[0]), r2(c[1] + 1.1 * z.s), r2(c[2])] });
    }
  }

  // Weapon mastery: a kill counts for the item that made it — the gun whose shot is resolving (p.shotItem), else a
  // launcher of that id fired in the last 6 s (its rocket / grenade / blast landed). Burns, poison and turrets don't count.
  // ponytail: projectiles don't carry their item, so a rocket-turret kill inside that window counts for your launcher
  // too (and a Brood Launcher's direct hits, reported as 'gl', don't) — tag combat.js projectiles with it.uid if it matters.
  masteryKill(p, wId) {
    const it = p.shotItem ?? p.inv.find(g => g?.kind === 'gun' && g.id === wId && Date.now() - (p.lastShot[wId] || 0) < 6000);
    if (it) it.kills = (it.kills || 0) + 1;
  }

  // Shockwave Blaster: a cone of force; a hit zombie flies back until it hits something solid or runs out
  // of distance (min(20, 20/weight) m, less for Tanks). Bosses take damage but never move.
  blast(p, o, dir, w, mult) {
    const now = Date.now(), cos = Math.cos(((w.cone / 2) * Math.PI) / 180), hl = Math.hypot(dir[0], dir[2]) || 1, f = [dir[0] / hl, dir[2] / hl];
    let hit = 0;
    for (const z of [...this.zombies.values()]) {
      if (z.dead) continue;
      const dx = z.pos[0] - o[0], dz = z.pos[2] - o[2], d = Math.hypot(dx, dz);
      if (d > w.blastRange + 0.5 * z.s || (d > 0.8 && (dx * f[0] + dz * f[1]) / d < cos)) continue;
      hit++;
      const dmgHit = w.dmg * mult * (1 - (0.5 * d) / w.blastRange);
      this.damageZombie(z, dmgHit, p, w.id);
      if (z.dead || z.t.boss) continue;
      const maxDist = Math.min(20, 20 / (z.t.weight ?? 1)) * (z.cls === 'tank' ? 0.6 : 1);
      const ux = d > 0.1 ? dx / d : f[0], uz = d > 0.1 ? dz / d : f[1];
      this.knockZombie(z, ux, uz, maxDist, 18, { dmgHit, by: p.id });
      z.shieldDown = now + 2500; // knocked off balance: the shield drops
      z.vel[1] = Math.max(z.vel[1], 4);
      z.state = 0; z.target = null; z.nextAtk = Math.max(z.nextAtk, now + 700);
    }
    this.broadcast({ t: 'blast', o: o.map(r2), d: [r2(f[0]), 0, r2(f[1])], by: p.id, n: hit });
  }

  // Sets up a fling that ai.js drives every tick: it moves at `speed` m/s (easing off a little) along
  // (ux, uz) until it travels `dist` m or hits something solid. opts.dmgHit lets a wall-slam scale off the
  // blast that caused it; opts.noSlam skips the slam damage/stun entirely (boss weapon pulls/pushes).
  knockZombie(z, ux, uz, dist, speed, opts = {}) {
    z.knock = { ux, uz, dist, traveled: 0, t0: Date.now(), speed0: speed, dmgHit: opts.dmgHit ?? 0, by: opts.by ?? null, noSlam: !!opts.noSlam };
  }

  // ---------- building ----------
  placementWorld(p) {
    const trapped = [...this.defenses.list.values()].filter(d => d.side === 0).map(d => this.pieces.get(d.pid)).filter(Boolean); // floors carrying a floor trap
    return {
      slots: this.slots, pieces: this.builds().flatMap(s => s.boxes), statics: [...this.statics, ...[...this.props.values()].filter(s => this.pieces.get(s.id) === s).map(s => s.box)],
      nodes: this.aliveNodeBoxes(), zombies: [...this.zombies.values()].map(z => ({ x: z.pos[0], y: z.pos[1], z: z.pos[2], s: z.s })),
      eye: this.eye(p), mats: p.mats, core: this.map.core, zone: this.map.zone, trapped: new Set(trapped.map(slotKey)),
    };
  }

  onBuild(p, m) {
    if (!p.alive || p.downed || this.notYet(p)) return;
    const now = Date.now();
    if (now - p.lastBuild < 80) return;
    const piece = { kind: m.kind, i: m.i, k: m.k, l: m.l, o: m.kind === 'wall' || m.kind === 'ramp' ? m.o : 0, mat: m.mat };
    const why = checkPlacement(piece, this.placementWorld(p));
    if (why) return this.send(p, { t: 'deny', text: why });
    p.lastBuild = now;
    p.mats[piece.mat] -= PIECE_COST;
    p.stats.builds++;
    this.addPiece(piece, p);
    this.sendInv(p);
  }

  addPiece(piece, owner) {
    const mat = BMATS[piece.mat], eng = this.teamUps?.engineering || 0, maxHp = this.pieceMaxHp(piece.mat);
    Object.assign(piece, { id: this.nextSid++, owner: owner?.id ?? null, maxHp, hp: maxHp * START_FRAC, mask: 0 });
    piece.grow = maxHp - piece.hp;
    piece.rate = (piece.grow / mat.time) * (1 + 0.2 * eng) * (owner?.cls === 'tank' ? CLASSES.tank.buildMul : 1);
    piece.box = pieceBox(piece);          // full bounds (reach / distance checks)
    piece.boxes = pieceBoxes(piece);      // what actually collides (changes with edits)
    this.pieces.set(piece.id, piece);
    this.slots.set(slotKey(piece), piece.id);
    for (const b of piece.boxes) this.grid.add(b);
    this.flowDirty = true;
    this.broadcast({ t: 'sadd', s: [pieceTuple(piece)] });
    return piece;
  }

  removePiece(s, why) {
    if (this.pieces.get(s.id) !== s) return;
    this.pieces.delete(s.id);
    this.slots.delete(slotKey(s));
    for (const b of s.boxes) this.grid.remove(b);
    this.dirtyPieces.delete(s);
    this.defenses.pieceChanged(s, false);
    this.flowDirty = true;
    this.integrityDirty = true;
    this.broadcast({ t: 'sdel', id: s.id, why });
  }

  // Pieces (and props) that lost every path to the ground fall a moment later, one after another.
  checkIntegrity(now) {
    this.integrityDirty = false;
    const tmp = [], falling = new Set(this.collapse.map(c => c.s));
    const loose = unsupported([...this.pieces.values()], b => this.grid.query(b.min[0] - 0.1, b.min[2] - 0.1, b.max[0] + 0.1, b.max[2] + 0.1, tmp));
    loose.sort((a, b) => a.box.min[1] - b.box.min[1]); // bottom first
    let i = 0;
    for (const s of loose) if (!falling.has(s)) this.collapse.push({ s, at: now + 250 + 90 * i++ });
  }

  updateCollapse(now) {
    for (let i = this.collapse.length - 1; i >= 0; i--) {
      const c = this.collapse[i];
      if (now < c.at) continue;
      this.collapse.splice(i, 1);
      if (this.pieces.get(c.s.id) === c.s) this.removePiece(c.s, 'collapse');
    }
  }

  // a piece the player can touch (reach from their eye)
  reachable(p, id) {
    const s = this.pieces.get(id);
    return s && isBuild(s) && p.alive && !p.downed && distToBox(this.eye(p), s.box) <= REACH ? s : null;
  }

  // Fortnite-style edit: wall templates (windows, doors, arches, triangles, half walls), floor holes, and stairs
  // turned or halved by a drag (m.path: their 2 × 2 tiles in drag order).
  onEdit(p, m) {
    if (this.notYet(p)) return;
    const s = this.reachable(p, m.id), now = Date.now();
    const e = s && (s.kind === 'ramp' && m.path !== undefined ? rampEdit(m.path) : { o: s.o, mask: m.mask });
    if (!e || !validMask(s.kind, e.mask) || (s.mask === e.mask && s.o === e.o) || now - p.lastEdit < 150) return;
    p.lastEdit = now;
    for (const b of s.boxes) this.grid.remove(b);
    s.mask = e.mask;
    if (s.o !== e.o) { s.o = e.o; s.box = pieceBox(s); }
    s.boxes = pieceBoxes(s);
    for (const b of s.boxes) this.grid.add(b);
    this.defenses.pieceChanged(s, true);
    this.flowDirty = true;
    this.integrityDirty = true;
    this.broadcast({ t: 'sedit', id: s.id, mask: s.mask, o: s.o });
  }

  // One material, no upgrade path — kept as a no-op so a stray client message is refused cleanly.
  onUpgrade(p, m) {
    if (this.notYet(p)) return;
    const s = this.reachable(p, m.id);
    if (s) this.send(p, { t: 'deny', text: "Zinkonium doesn't upgrade" });
  }

  onRepair(p, m) {
    if (!this.started()) return;
    const s = this.reachable(p, m.id), now = Date.now();
    if (!s || now - p.lastRepair < 180) return;
    const missing = s.maxHp - s.hp - s.grow;
    if (missing < 1) return;
    const cap = 40 * (1 + 0.2 * (this.teamUps?.engineering || 0)) * (p.cls === 'tank' ? CLASSES.tank.buildMul : 1); // engineering + Tank: more HP per repair action, same mats per HP
    const heal = Math.min(missing, cap, p.mats[s.mat] * REPAIR_HP_PER_MAT);
    if (heal < 1) return this.send(p, { t: 'deny', text: `Not enough ${BMATS[s.mat].name}` });
    p.lastRepair = now;
    p.mats[s.mat] -= Math.ceil(heal / REPAIR_HP_PER_MAT);
    s.hp += heal;
    p.stats.repaired += Math.round(heal);
    this.dirtyPieces.add(s);
    this.flowDirty = true;
    this.sendInv(p);
  }

  // Knife on a map prop: materials, and the prop takes a beating. On a built piece: no materials, it just
  // breaks down (the builder gets REFUND back when their own hit brings it down). Only the builder may break
  // a piece, unless they've left the room.
  onHarvestPiece(p, m) {
    const s = this.pieces.get(m.sid | 0), now = Date.now();
    if (!s || !p.alive || p.downed || p.st.w !== 'knife' || now - p.lastHarvest < 280 || this.notYet(p)) return;
    if (distToBox(this.eye(p), s.box) > 2.8) return;
    p.lastHarvest = now;
    if (isBuild(s)) {
      if (s.owner !== p.id && this.players.some(q => q.id === s.owner)) return this.send(p, { t: 'deny', text: 'Only the builder can break this' });
      this.damagePiece(s, KNIFE_BREAK);
      if (s.owner === p.id && this.pieces.get(s.id) !== s) { p.mats[s.mat] = Math.min(MAT_CAP, p.mats[s.mat] + REFUND); this.sendInv(p); }
      return;
    }
    const mat = PROP_TYPES[s.mat].mat, amount = 7;
    p.mats[mat] = Math.min(MAT_CAP, p.mats[mat] + amount);
    p.stats.harvested += amount;
    this.damagePiece(s, 60);
    this.send(p, { t: 'harv', id: -1, mat, n: amount, weak: false });
    this.sendInv(p);
  }

  onHarvest(p, m) {
    if (m.sid !== undefined) return this.onHarvestPiece(p, m);
    if (m.bolt !== undefined) return this.bosses.behemoth.onBolt(p, m); // a bolt on one of the Behemoth's hatches
    if (this.notYet(p)) return;
    const n = this.nodes[m.id | 0], now = Date.now();
    if (!n || n.hp <= 0 || !p.alive || p.downed || p.st.w !== 'knife' || now - p.lastHarvest < 280) return;
    if (distToBox(this.eye(p), n.box) > 2.6) return;
    p.lastHarvest = now;
    const T = NODE_TYPES[n.type], amount = Math.round(T.per * (m.weak ? 2.5 : 1));
    p.mats[T.mat] = Math.min(MAT_CAP, p.mats[T.mat] + amount);
    p.stats.harvested += amount;
    n.hp--;
    if (n.hp <= 0) { this.grid.remove(n.box); this.flowDirty = true; }
    this.send(p, { t: 'harv', id: n.id, mat: T.mat, n: amount, weak: !!m.weak });
    this.broadcast({ t: 'node', id: n.id, hp: n.hp });
    this.sendInv(p);
  }

  onRevive(p, m) {
    const tgt = this.players.find(q => q.id === m.id), now = Date.now();
    if (!tgt || !tgt.downed || tgt === p || !p.alive || p.downed) return;
    if (Math.hypot(p.st.p[0] - tgt.st.p[0], p.st.p[1] - tgt.st.p[1], p.st.p[2] - tgt.st.p[2]) > 2.6) return;
    if (tgt.reviver !== p.id || now - tgt.reviveLast > 500) { tgt.reviver = p.id; tgt.reviveProg = 0; }
    else tgt.reviveProg += Math.min(400, now - tgt.reviveLast);
    tgt.reviveLast = now;
    if (tgt.reviveProg >= HOLDOUT.revive) this.revive(tgt, p);
  }

  // Pick a class: in the lobby, or at the Core between waves. (The old Medic kit became the Ronin.)
  onClass(p, m) {
    const id = m.id === 'medic' ? 'ronin' : m.id, c = Object.hasOwn(CLASSES, id) ? CLASSES[id] : null;
    if (!c || p.cls === id) return;
    if (this.phase === 'wave') return this.send(p, { t: 'deny', text: 'Change class between waves' });
    if (this.phase === 'intermission' && this.wave % 5 !== 0) {
      const next = Math.ceil((this.wave + 1) / 5) * 5;
      return this.send(p, { t: 'deny', text: `Kits are locked until the break after wave ${next}` });
    }
    if (this.started() && !this.canBuy(p)) return this.send(p, { t: 'deny', text: 'Change class at the Core' });
    const old = p.maxHp || 200;
    p.cls = id;
    this.ronin.onKit(p); // into the Ronin: the katana takes hotbar slot 1; out of it: the katana goes
    p.maxHp = this.maxHpFor(p);
    if (p.alive) p.hp = Math.max(1, Math.round((p.hp / old) * p.maxHp));
    this.sendInv(p);
    this.broadcastRoster();
    this.broadcast({ t: 'msg', text: `${p.name} is playing ${c.name}` });
  }

  // Passive healing, 4×/s: anyone resting inside the Core ring (HOLDOUT.coreRegen), and Medic-class survivors patch up
  // the players and survivors around them (SURVIVOR_CLASSES.medic). (The Ronin's own heal: ronin.js.)
  updateMedics(now) {
    if (now - (this.medicAt || 0) < 250) return;
    this.medicAt = now;
    for (const p of this.players) if (this.canBuy(p) && now - (p.hurtAt || 0) > HOLDOUT.coreRegenAfter) this.healPlayer(p, HOLDOUT.coreRegen * 0.25);
    for (const sv of this.survivors.list.values()) {
      if (sv.state !== 'active' || sv.cls !== 'medic') continue;
      const C = SURVIVOR_CLASSES.medic;
      for (const q of this.players) if (q.alive && !q.downed && Math.hypot(q.st.p[0] - sv.pos[0], q.st.p[2] - sv.pos[2]) <= C.healR) this.healPlayer(q, C.heal * 0.25);
      for (const o of this.survivors.list.values()) if (o !== sv && o.state === 'active' && Math.hypot(o.pos[0] - sv.pos[0], o.pos[2] - sv.pos[2]) <= C.healR) this.survivors.heal(o, C.heal * 0.25 * 1.5);
    }
  }

  healPlayer(p, n) {
    if (p.hp >= p.maxHp) return;
    p.hp = Math.min(p.maxHp, p.hp + n);
    this.send(p, { t: 'vit', hp: Math.round(p.hp), sh: Math.round(p.shield) });
  }

  // Hold E at the Core: heals it, but only one player at a time, and only between waves.
  onCoreHeal(p) {
    const now = Date.now();
    if (!p.alive || p.downed || distToBox(this.eye(p), this.coreBase) > 3.2) return;
    if (this.phase === 'wave') {
      if (now - p.lastCoreHealDeny > 2000) { p.lastCoreHealDeny = now; this.send(p, { t: 'deny', text: 'The Core can only be repaired between waves' }); }
      return;
    }
    if (this.coreHealer && this.coreHealer !== p.id && now - this.coreHealAt < 600) {
      const who = this.players.find(q => q.id === this.coreHealer);
      return this.send(p, { t: 'deny', text: `${who?.name ?? 'Someone'} is already healing the Core` });
    }
    const dt = this.coreHealer === p.id ? Math.min(0.35, (now - this.coreHealAt) / 1000) : 0.2;
    if (this.coreHealer !== p.id) { this.coreHealer = p.id; this.broadcast({ t: 'coreheal', id: p.id }); }
    this.coreHealAt = now;
    this.core.hp = Math.min(this.core.max, this.core.hp + HOLDOUT.coreHeal * dt);
  }

  // Adrenaline Shot, the one carried heal (its key, a sack key, or LMB with it in hand): instant +HP and +shield, each
  // capped, then a short regen (updateAdrenaline). Only ever on yourself.
  onUse(p, m) {
    const it = ITEMS[m.item], now = Date.now();
    if (it?.kind !== 'adrenaline' || !p.alive || p.downed || !(countOf(p, m.item) > 0) || now - (p.lastAdrenaline || 0) < it.cooldown) return;
    if (p.hp >= p.maxHp && p.shield >= SHIELD_CAP) return this.send(p, { t: 'deny', text: 'Already topped up' });
    takeItem(p, m.item, 1);
    p.lastAdrenaline = now;
    p.hp = Math.min(p.maxHp, p.hp + it.hp);
    p.shield = Math.min(SHIELD_CAP, p.shield + it.sh);
    p.adrenUntil = now + it.time * 1000;
    this.send(p, { t: 'boost', ms: it.time * 1000 });
    this.send(p, { t: 'vit', hp: Math.round(p.hp), sh: Math.round(p.shield) });
    this.sendInv(p);
    this.broadcastRoster();
  }

  // an Adrenaline Shot's regen (ITEMS.adrenaline.regen HP/s) while it lasts, 4×/s
  updateAdrenaline(now) {
    if (now - (this.adrenAt || 0) < 250) return;
    this.adrenAt = now;
    const R = ITEMS.adrenaline;
    for (const p of this.players) if (p.alive && !p.downed && now < (p.adrenUntil || 0)) this.healPlayer(p, R.regen * 0.25);
  }

  // the first Brood Titan fell: the Blacksmith sets up by the Core
  // a map ping (M, click): the squad sees it on the minimap and as a marker in the world for 8 s
  onPing(p, m) {
    const now = Date.now(), B = OUTPOST.bounds, x = +m.x, z = +m.z;
    if (now < (p.pingAt || 0) || !Number.isFinite(x) || !Number.isFinite(z)) return;
    p.pingAt = now + 400;
    const r1 = v => Math.round(v * 10) / 10;
    this.broadcast({ t: 'ping', by: p.id, x: r1(Math.max(B.minX, Math.min(B.maxX, x))), z: r1(Math.max(B.minZ, Math.min(B.maxZ, z))) });
  }

  onSmithUnlocked() {
    this.broadcast({ t: 'smith', on: true });
    this.broadcast({ t: 'task', text: 'THE BLACKSMITH is at the Core: tier III forging, elements, attachments and turret upgrades' });
  }

  // guns, rockets and explosives: team damage boost, the Assault class and the Firepower team upgrade
  dmgMultFor(p) {
    return (this.buffActive('damage') ? BUFF.damage : 1) * (p?.cls === 'assault' ? 1.2 : 1) * (1 + 0.08 * (this.teamUps?.firepower || 0));
  }

  // Vitality team upgrade scales max HP off the class base (or 200 with no class).
  // a built piece's full health (Engineering team upgrade: +10 % per level)
  pieceMaxHp(mat) { return Math.round(BMATS[mat].hp * (1 + 0.1 * (this.teamUps?.engineering || 0))); }
  maxHpFor(p) { return Math.round((CLASSES[p?.cls]?.hp ?? 200) * (1 + 0.1 * (this.teamUps?.vitality || 0))); }

  // Armor went on or came off: new resistances and speed.
  armorChanged(p) {
    p.as = armorStats(p.armor);
    this.sendInv(p);
    this.broadcastRoster();
  }

  // ---------- shop helpers ----------
  canBuy(p) {
    const c = this.map.core;
    return p.alive && !p.downed && Math.hypot(p.st.p[0] - c.x, p.st.p[2] - c.z) <= this.map.buyRadius;
  }

  powerupRunning(id) { return !!POWER_BUFF[id] && this.buffActive(POWER_BUFF[id]); }

  // Team powerups (bought by one player or from the team bank). Returns false if already running.
  applyPowerup(id, p) {
    const now = Date.now(), pw = POWERUPS[id];
    if (id === 'p_overshield') for (const q of this.players) { q.shield = 100; this.sendInv(q); }
    else if (id === 'p_damage') { if (this.buffActive('damage')) return false; this.buffs.damage = now + pw.time * 1000; }
    else if (id === 'p_rapid') { if (this.buffActive('rate')) return false; this.buffs.rate = now + pw.time * 1000; }
    else if (id === 'p_fortify') {
      for (const s of this.builds()) { s.hp = s.maxHp; s.grow = 0; this.dirtyPieces.add(s); }
      this.flowDirty = true;
    } else if (id === 'p_barrier') {
      if (this.buffActive('barrier')) return false;
      this.buffs.barrier = now + pw.time * 1000;
    } else return false;
    this.broadcast({ t: 'msg', text: `${p.name} activated ${pw.name}!` });
    this.broadcast(this.buffMsg());
    return true;
  }

  buffMsg() {
    const now = Date.now(), left = k => Math.max(0, (this.buffs[k] || 0) - now);
    return { t: 'buffs', damage: left('damage'), rate: left('rate'), barrier: left('barrier') };
  }

  // ---------- messages ----------
  handle(p, m) {
    switch (m.t) {
      case 'shot': return this.onShot(p, m);
      case 'buy': return this.inventory.onBuy(p, String(m.item), !!m.bank, m.slot, m.el);
      case 'build': return this.onBuild(p, m);
      case 'edit': return this.onEdit(p, m);
      case 'upgrade': return this.onUpgrade(p, m);
      case 'repair': return this.onRepair(p, m);
      case 'harvest': return this.onHarvest(p, m);
      case 'revive': return this.onRevive(p, m);
      case 'ready': return this.onReady(p, !!m.on);
      case 'reload': return this.inventory.onReload(p, m);
      case 'pickup': return this.inventory.onPickup(p, m);
      case 'dropgun': return this.inventory.onDropGun(p, m);
      case 'move': return this.inventory.onMove(p, m);
      case 'drop': return this.inventory.onDrop(p, m);
      case 'lock': return this.inventory.onLock(p, m);
      case 'tierup': return this.inventory.onTierUp(p, m);
      case 'rarity': return this.inventory.onRarity(p, m);
      case 'sell': return this.inventory.onSell(p, m);
      case 'buyback': return this.inventory.onBuyback(p);
      case 'teamup': return this.inventory.onTeamUp(p, m);
      case 'stash': return this.inventory.onStash(p, m);
      case 'use': return this.onUse(p, m);
      case 'throw': return this.combat.onThrow(p, m);
      case 'rocket': return this.combat.onRocket(p, m);
      case 'place': return this.notYet(p) ? undefined : this.defenses.onPlace(p, m);
      case 'open': return this.notYet(p) ? undefined : this.events.onOpen(p, m);
      case 'carry': return this.survivors.onCarry(p, m);
      case 'coreup': return this.cannon.onBuy(p, String(m.id), !!m.bank);
      case 'coreheal': return this.onCoreHeal(p);
      case 'class': return this.onClass(p, m);
      case 'thump': return this.bosses.onThump(p, m);
      case 'smith': return this.smith.handle(p, m);
      case 'bar': return this.barriers.onMsg(p, m);
      case 'kat': return this.ronin.onMsg(p, m);
      case 'ping': return 'ts' in m ? this.handleCommon(p, m) : this.onPing(p, m); // net latency ping (ts) vs map ping (x/z)
      default: this.handleCommon(p, m);
    }
  }

  sendInv(p) {
    this.send(p, {
      t: 'inv', money: p.money, armor: Math.round(p.shield), helmet: false, hp: Math.max(0, Math.round(p.hp)),
      alive: p.alive, inv: p.inv, sack: p.sack, gear: p.armor, maxHp: p.maxHp, cls: p.cls, side: p.side, mats: p.mats, downed: p.downed, ammo: p.ammo,
      shield: Math.round(p.shield), carrying: p.carrying ?? null,
      buyback: p.buyback ? { item: p.buyback.item, price: p.buyback.price } : null,
    });
  }

  phaseMsg() {
    return {
      t: 'hphase', phase: this.phase, endsIn: this.phaseEnd ? Math.max(0, this.phaseEnd - Date.now()) : 0,
      wave: this.wave, waves: 0, lanes: this.phase === 'wave' ? this.director.lanes : [],
      night: this.phase === 'wave' ? !!this.director.night : false, nextNight: this.phase !== 'wave' && !!this.director.planned?.night,
      boss: this.phase === 'wave' ? bossFor(this.wave) : null, nextBoss: this.phase !== 'wave' ? bossFor(this.wave + 1) : null,
      next: this.phase === 'wave' ? [] : this.director.planned?.lanes ?? [], core: [Math.round(this.core.hp), this.core.max],
      left: this.director.remaining + this.zombies.size, diff: this.diffId,
      // time left before the horde goes berserk (0 once it already has, or outside the wave phase)
      waveEndsIn: this.phase === 'wave' && !this.director.berserk ? Math.max(0, this.director.deadline - Date.now()) : 0,
    };
  }

  broadcastPhase() { this.broadcast(this.phaseMsg()); }

  broadcastRoster() {
    this.broadcast({
      t: 'roster', round: this.wave, players: this.players.map(p => ({
        id: p.id, name: p.name, side: p.side, hp: Math.max(0, Math.round(p.hp)), shield: Math.round(p.shield), alive: p.alive, downed: p.downed,
        ready: p.ready, host: p.id === this.host, ping: p.ping, bot: false, score: 0, deaths: p.stats.downs, carrying: p.carrying ?? null, cls: p.cls, maxHp: p.maxHp, ...p.stats,
      })),
    });
  }
}
