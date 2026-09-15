// Zombie Holdout client: owns the horde view, built pieces (+ edits), harvest nodes, build / edit mode and all
// the world objects (loot, chests, supply drops, traps, survivors, the Colossus); handles every Holdout
// message; and drives the co-op HUD — wave + Core bar, lane compass, team list, hotbar, backpack and team
// chest, shop, boss bar, revive / use rings, name tags and the end-of-match report. The server is authoritative.
import * as THREE from 'three';
import { OUTPOST, OUTPOST_BOXES, CORE_LADDERS } from '/shared/outpost.js';
import { BMATS, REACH, distToBox } from '/shared/build.js';
import { WAVES } from '/shared/zombies.js';
import { WEAPONS } from '/shared/weapons.js';
import { RARITY, AMMO, ITEMS, POWERUPS, BUFF, THROWABLES, HEALS, SURVIVOR } from '/shared/holdout.js';
import { SKY } from '/shared/skyboss.js';
import { rayWorld, blocked, bodyHeight, topAt, dirFromAngles } from '/shared/physics.js';
import { ZombieView } from './zombies.js';
import { Structures, Nodes, BuildMode, EditMode } from './build.js';
import { Entities } from './holdout_ents.js';
import { hotbarHTML, buyHTML, bagHTML, saveRecord, recordText } from './holdout_ui.js';
import { setText, setHTML, setClass, setStyle, setHidden, hudReset } from './hud.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const r2 = v => Math.round(v * 100) / 100;
const LANE_NAME = { N: 'NORTH', E: 'EAST', S: 'SOUTH', W: 'WEST' };
const LANE_POS = Object.fromEntries(OUTPOST.lanes.map(l => [l.id, [(l.zone[0] + l.zone[2]) / 2, (l.zone[1] + l.zone[3]) / 2]]));
const GLOB_GRAVITY = 12; // matches server/holdout/ai.js
const PIECE_NAME = { wall: 'WALL', floor: 'FLOOR', ramp: 'RAMP', trap: 'TRAP' };
const SB_HOLDOUT = '<tr><th>PLAYER</th><th>KILLS</th><th>DMG</th><th>BUILDS</th><th>REPAIRED</th><th>REVIVES</th><th>RESCUES</th><th>PING</th></tr>';
const POWER_BUFF = { p_damage: 'damage', p_rapid: 'rate', p_barrier: 'barrier' };
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const bearing = (from, x, z) => Math.atan2(-(x - from[0]), -(z - from[2])); // yaw that faces (x, z)
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const _v = new THREE.Vector3();

function pickupName(pk) {
  if (pk.kind === 'gun') return `${RARITY[pk.r]?.name ?? ''} ${WEAPONS[pk.key]?.name ?? pk.key}`;
  if (pk.kind === 'item') return `${ITEMS[pk.key]?.name ?? pk.key} ×${pk.n}`;
  if (pk.kind === 'svsupply') return 'survivor supplies';
  if (pk.kind === 'ammo') return `${AMMO[pk.key]?.name} ×${pk.n}`;
  return `${pk.key} ×${pk.n}`;
}

export class Holdout {
  constructor(game, welcome) {
    this.g = game;
    this.world = game.world;
    this.zombies = new ZombieView(game.world.scene, (kind, z) => this.onZombieEvent(kind, z));
    this.nodes = new Nodes(game.world.scene);
    this.structs = new Structures(game.world.scene, () => this.refreshBoxes());
    this.build = new BuildMode(game, this);
    this.edit = new EditMode(game, this);
    this.ents = new Entities(game.world, game.sound);
    this.globs = new Map();
    this.globGeo = new THREE.SphereGeometry(0.22, 10, 8);
    this.globMat = new THREE.MeshBasicMaterial({ color: 0x9dff3d });
    this.bombMat = new THREE.MeshBasicMaterial({ color: 0xff4fd8 });
    this.phys = { ladders: CORE_LADDERS };
    this.mats = { wood: 0, stone: 0, metal: 0 };
    this.ammo = {};
    this.items = {};
    this.stash = { money: 0, mats: { wood: 0, stone: 0, metal: 0 }, ammo: {}, items: {} };
    Object.assign(this, {
      phase: 'lobby', wave: 0, waves: WAVES, core: [1, 1], lanes: [], next: [], left: 0, end: 0, diff: welcome.diff || 'normal',
      downed: false, bleedEnd: 0, respawnAt: 0, roster: [], reviveId: null, reviveStart: 0, lastInteract: 0,
      alertUntil: 0, alertText: '', shadowAt: 0, shadowDirty: true, groanAt: 0, dusk: 0, shield: 0, carrying: null,
      activeThrow: null, payBank: false, using: null, hold: null, holdLock: false, coreHealer: null, buffs: {},
      task: null, shake: 0, bagAtChest: false, it: null,
    });
    this.tags = new Map();
    this.refreshBoxes();
    this.enterDom();
    game.hud.banner('ZOMBIE HOLDOUT', 'Build, harvest with F, shop at the Core, then press Y when ready', '', 5000);
  }

  get building() { return this.build.active; }
  get rateMult() { return this.g.now < (this.buffs.rate || 0) ? BUFF.rate : 1; }
  blocksShooting() { return this.build.active || this.edit.active || this.downed || !!this.carrying || !!this.using; }
  targets() { return this.zombies.targets(); }
  skyTargets() { return this.ents.skyTargets(performance.now() / 1000); }
  balloonTargets() { return this.ents.balloonTargets(); }
  me() { return this.roster.find(p => p.id === this.g.me.id); }
  buffLeft(id) { const k = POWER_BUFF[id]; return k ? Math.max(0, (this.buffs[k] || 0) - this.g.now) : 0; }
  say(text, secs = 2.5) { this.g.hintMsg = text; this.g.hintUntil = this.g.now + secs; }
  noAmmo(w) { this.say(`Out of ${AMMO[w.ammo].name.toLowerCase()} — buy more at the Core or share from the team chest`); this.g.sound.play('dry', { vol: 0.6 }); }

  // Everything solid for you: the map, harvest nodes still standing, built pieces (doors open for players).
  refreshBoxes() {
    this.boxes = [...OUTPOST_BOXES, ...this.nodes.boxes, ...this.structs.boxes];
    this.g.boxes = this.g.moveBoxes = this.boxes;
    for (const r of this.g.remotes.values()) r.boxes = this.boxes;
    this.shadowDirty = true;
  }

  // Movement also collides with nearby zombie bodies (the horde can hem you in).
  moveBoxes() {
    const p = this.g.player.pos, near = this.zombies.boxesNear(p[0], p[2], 3, []);
    return near.length ? this.boxes.concat(near) : this.boxes;
  }

  placementWorld() {
    return {
      slots: this.structs.slots, pieces: [...this.structs.list.values()].flatMap(p => p.boxes), statics: OUTPOST_BOXES, nodes: this.nodes.boxes,
      zombies: this.zombies.targets(), eye: this.g.player.eye, mats: this.mats, core: OUTPOST.core, zone: OUTPOST.zone,
    };
  }

  canBuy() {
    const pl = this.g.player;
    return pl.alive && !this.downed && Math.hypot(pl.pos[0] - OUTPOST.core.x, pl.pos[2] - OUTPOST.core.z) <= OUTPOST.buyRadius;
  }

  nearStash() { const p = this.g.player.pos; return Math.hypot(p[0] - OUTPOST.stash.x, p[2] - OUTPOST.stash.z) < OUTPOST.stash.reach + 0.6; }

  // ---------- messages ----------
  onMsg(m) {
    const now = performance.now() / 1000;
    switch (m.t) {
      case 'sall': this.ents.clearAll(); this.task = null; this.structs.load(m.s); this.nodes.reset(m.nodes); this.refreshBoxes(); return;
      case 'sadd': for (const t of m.s) this.onPieceAdded(this.structs.add(t)); return;
      case 'supd':
        for (const u of m.s) { const r = this.structs.update(u); if (r && r.p.hp + r.p.grow < r.prevHp - 1) this.pieceSound(r.p, 'hit_', 0.9); }
        return;
      case 'sdel': { const p = this.structs.remove(m.id); if (p) this.pieceGone(p, m.why); return; }
      case 'sedit': { const p = this.structs.edit(m.id, m.mask); if (p) { this.pieceSound(p, 'build', 0.4); this.unstick(p.box); } return; }
      case 'node': if (this.nodes.setHp(m.id, m.hp)) this.refreshBoxes(); return;
      case 'harv': return this.feed(`+${m.n} ${m.mat.toUpperCase()}${m.weak ? ' · WEAK POINT!' : ''}`, m.mat);
      case 'zsp': for (const z of m.z) this.zombies.spawn(z, now); return;
      case 'zdie': return this.onZombieDied(m);
      case 'zclear': this.zombies.clear(); this.clearGlobs(); return;
      case 'proj': return this.addGlob(m);
      case 'splat': return this.splat(m);
      case 'hphase': return this.onPhase(m);
      case 'hstat': this.left = m.left; this.core = m.core; return;
      case 'coreHit': return this.onCoreHit(m);
      case 'pdown': return this.onDown(m);
      case 'prev': return this.onRevived(m);
      case 'pdie': return this.onPlayerDied(m);
      case 'hend': return this.onEnd(m);
      case 'grant': return this.g.weapons.onGrant(m.uid, m.n);
      case 'got': this.feed(`Picked up ${RARITY[m.r]?.name ?? ''} ${m.text}`, 'r' + (m.r ?? 0)); this.g.sound.play('pickup', { vol: 0.6 }); return;
      case 'pk': for (const t of m.l) this.ents.addPickup(t); return;
      case 'pkall': this.ents.clearPickups(); for (const t of m.l) this.ents.addPickup(t); return;
      case 'pkdel': this.ents.removePickup(m.id); return;
      case 'stash': this.stash = m.s; if (this.g.ui === 'bag') this.renderBag(); if (this.g.ui === 'buy') this.renderBuy(); return;
      case 'chests': return this.ents.setChests(m.l);
      case 'opened': this.g.sound.play('chest_chime', { pos: [m.x, 0.6, m.z], vol: 1, rate: 1.3 }); this.world.burst([m.x, 0.8, m.z], [0, 1, 0], 0xffd65a, 20, 4); return;
      case 'sdrop': this.ents.drop(m); return;
      case 'sdland': return this.ents.landDrop(m.id, m.y);
      case 'sddel': if (m.opened) { const d = this.ents.drops.get(m.id); if (d) this.world.burst([d.x, d.y + 1, d.z], [0, 1, 0], 0x6fb8ff, 24, 4); } return this.ents.removeDrop(m.id);
      case 'dadd': for (const t of m.l) this.ents.addDef(t); return;
      case 'dall': return this.ents.setDefs(m.l);
      case 'ddel': return this.ents.removeDef(m.id);
      case 'dfx': return this.ents.defFx(m.l, this.zombies);
      case 'thr': return this.ents.addThrown(m);
      case 'rkt': return this.ents.addRocket(m);
      case 'boom': this.shake = Math.max(this.shake, this.ents.boom(m, this.g.player.eye)); return;
      case 'svadd': return this.ents.svAdd(m.id, m.name);
      case 'svs': this.ents.svState(m.l, m.shots); return;
      case 'svdie': this.ents.svDie(m.id); this.alert(`SURVIVOR ${String(m.name).toUpperCase()} PERISHED`, 3); this.g.sound.play('lose', { vol: 0.4 }); return;
      case 'sky': this.ents.skyStart(m, now); this.g.hud.banner('THE COLOSSUS', 'Snipe its glowing weak points (SSG 08 / AWP)', 'lose', 5000); return;
      case 'skyhit': this.ents.skyHit(m.i, m.hp); if (m.by === this.g.me.id) this.g.sound.play('headshot', { vol: 0.8 }); return;
      case 'skydie': this.ents.skyDie(); this.g.hud.banner('COLOSSUS DOWN', `${this.g.name(m.by)} broke the last weak point · loot dropped`, 'win', 4500); return;
      case 'task': this.task = { text: m.text, until: this.g.now + 14 }; this.g.hud.banner('NEW TASK', m.text, '', 4500); this.g.sound.play('round_start', { vol: 0.5 }); return;
      case 'coreheal': this.coreHealer = m.id; return;
      case 'buffs':
        for (const k of ['damage', 'rate', 'barrier']) this.buffs[k] = this.g.now + (m[k] || 0) / 1000;
        if (m.damage || m.rate || m.barrier) this.g.sound.play('win', { vol: 0.4, rate: 1.4 });
        return;
    }
  }

  onBin(buf) { this.zombies.snapshot(buf, performance.now() / 1000); }

  onInv(m) {
    Object.assign(this, { mats: m.mats || this.mats, ammo: m.ammo || this.ammo, items: m.items || this.items, shield: m.shield || 0 });
    this.g.weapons.pool = this.ammo;
    const was = this.downed;
    this.downed = !!m.downed && m.alive;
    if (this.downed && !was) { this.build.toggle(false); this.edit.stop(); this.using = null; }
    if (m.carrying !== undefined) this.carrying = m.carrying;
    if (this.activeThrow && !(this.items[this.activeThrow] > 0)) this.activeThrow = null;
    this.activeThrow ??= THROWABLES.find(id => this.items[id] > 0) ?? null;
    if (this.g.ui === 'bag') this.renderBag();
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
    Object.assign(this, { phase: m.phase, wave: m.wave, waves: m.waves, lanes: m.lanes, next: m.next, core: m.core, left: m.left, end: this.g.now + m.endsIn / 1000, diff: m.diff });
    const names = l => l.map(id => LANE_NAME[id]).join(' · ');
    if (m.phase === 'countdown' && prev !== 'countdown') {
      hud.banner('GET READY', `Wave 1 comes from ${names(m.next)}`, '', 4000);
      this.g.sound.play('round_start', { vol: 0.6 });
    } else if (m.phase === 'wave' && prev !== 'wave') {
      hud.banner(m.wave === m.waves ? 'FINAL WAVE' : `WAVE ${m.wave}`, `Incoming: ${names(m.lanes)}`, 'lose', 3500);
      this.g.sound.play('wave_horn', { vol: 0.9 });
    } else if (m.phase === 'intermission' && prev === 'wave') {
      hud.banner(`WAVE ${m.wave} CLEARED`, `Break: ${Math.round(m.endsIn / 1000)}s · next from ${names(m.next)}`, 'win', 4000);
      this.g.sound.play('win', { vol: 0.5 });
    } else if (m.phase === 'lobby' && (prev === 'victory' || prev === 'defeat')) {
      $('hoEnd').hidden = true;
      hud.banner('NEW MATCH', 'Build, harvest, press Y when ready', '', 4000);
    }
    if (m.phase !== 'wave') this.ents.skyEnd();
    const st = {};
    for (const id of m.next) st[id] = 1;
    for (const id of m.lanes) st[id] = 2;
    this.world.setLanes(st);
  }

  onPieceAdded(p) {
    this.pieceSound(p, 'build', 0.7);
    this.unstick(p.box);
    this.build.sent.clear();
  }

  pieceGone(p, why) {
    const c = [0, 1, 2].map(i => (p.box.min[i] + p.box.max[i]) / 2);
    this.pieceSound(p, why === 'broken' ? 'break_' : 'build', why === 'broken' ? 1 : 0.4);
    for (let i = 0; i < 3; i++) this.world.burst([c[0] + (Math.random() - 0.5) * 2, c[1] + (Math.random() - 0.5), c[2] + (Math.random() - 0.5) * 2], [0, 1, 0], 0xb8a58a, 6, 3);
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
    const killer = m.by === this.g.me.id ? this.g.player.pos : this.g.remotes.get(m.by)?.pos;
    const zb0 = this.zombies.list.get(m.id);
    const dir = killer && zb0 ? [zb0.pos[0] - killer[0], 0, zb0.pos[2] - killer[2]] : null;
    const zb = this.zombies.die(m.id, dir);
    if (!zb) return;
    this.g.sound.play('z_die', { pos: [zb.pos[0], zb.pos[1] + 1.5 * zb.s, zb.pos[2]], vol: zb.t.boss ? 1.4 : 0.9, ref: 3, rate: zb.t.boss ? 0.6 : 0.9 + Math.random() * 0.2 });
    if (!m.by) return;
    const mine = m.by === this.g.me.id;
    const who = String(m.by).startsWith('sv') ? `${this.ents.survivors.get(+String(m.by).slice(2))?.name ?? 'Survivor'} (survivor)` : this.g.name(m.by);
    const weapon = WEAPONS[m.w] ? m.w : ITEMS[m.w]?.name ?? (m.w === 'svsmg' ? 'SMG' : m.w);
    this.g.hud.kill(who, zb.t.name, weapon, m.hs, false, mine);
    if (mine && !m.hs) this.g.sound.play('kill', { vol: 0.35 });
    if (zb.t.boss) this.g.hud.banner('ALPHA BRUTE DOWN', `${who} landed the final blow · loot dropped`, 'win', 3000);
  }

  onZombieEvent(kind, zb) {
    const me = this.g.player.pos, d = Math.hypot(zb.pos[0] - me[0], zb.pos[2] - me[2]);
    if (d > 30) return;
    const pos = [zb.pos[0], zb.pos[1] + 1.5 * zb.s, zb.pos[2]];
    if (kind === 'wind') {
      if ((zb.type === 'brute' || zb.type === 'alpha') && Math.random() < 0.5) this.g.sound.play('brute_roar', { pos, vol: 1.2, ref: 4, rate: zb.type === 'alpha' ? 0.8 : 1 });
      else this.g.sound.play('z_swipe', { pos, vol: 0.9, ref: 2.5, rate: 0.9 + Math.random() * 0.25 });
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

  onDown(m) {
    if (m.id === this.g.me.id) {
      this.downed = true;
      this.bleedEnd = this.g.now + m.bleed / 1000;
      this.build.toggle(false);
      this.edit.stop();
      this.using = null;
      this.g.weapons.cancelReload();
      this.g.weapons.scope = 0;
      this.g.sound.play('downed', { vol: 0.7 });
    } else {
      this.g.remotes.get(m.id)?.setDowned(true);
      this.g.hud.chat(null, `${this.g.name(m.id)} is down! Hold E next to them to revive`);
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
      this.respawnAt = this.g.now + m.respawn / 1000;
      this.build.toggle(false);
      this.edit.stop();
      this.using = null;
      this.g.weapons.cancelReload();
      this.g.weapons.scope = 0;
      this.g.deathMsg = m.by === 'bleeding out' ? 'You bled out' : `Killed by ${m.by || 'the horde'}`;
      $('deathCam').hidden = false;
      this.g.sound.play('death', { vol: 0.7 });
      if (this.g.ui === 'buy') this.g.toggleBuy(false);
      if (this.g.ui === 'bag') this.closeBag();
    } else {
      this.g.remotes.get(m.id)?.kill();
      this.g.hud.chat(null, `${this.g.name(m.id)} died — back at the Core soon`);
    }
  }

  onEnd(m) {
    const survived = m.win ? m.wave : Math.max(0, m.wave - 1);
    const title = m.win ? 'VICTORY' : 'DEFEAT', rec = saveRecord(m.diff || this.diff, survived, m.win);
    this.g.hud.banner(title, m.win ? `All ${m.wave} waves held` : `The Core fell on wave ${m.wave}`, m.win ? 'win' : 'lose', 6000);
    this.g.sound.play(m.win ? 'win' : 'lose', { vol: 0.7 });
    const best = key => { const top = [...m.stats].sort((a, b) => b[key] - a[key])[0]; return top && top[key] > 0 ? top.id : null; };
    const awards = [['kills', 'Exterminator'], ['builds', 'Architect'], ['revives', 'Medic'], ['harvested', 'Harvester'], ['rescues', 'Rescuer']];
    const mvp = {};
    for (const [k, a] of awards) { const id = best(k); if (id) (mvp[id] ??= []).push(a); }
    $('hoEndTitle').textContent = title;
    $('hoEnd').className = m.win ? 'win' : 'lose';
    $('hoEndSub').textContent = (m.win ? `Held the Outpost through ${m.wave} waves · ${this.diff}` : `Survived ${survived} of ${this.waves} waves · ${this.diff}`) + (rec.isNew ? ' · NEW PERSONAL BEST!' : '');
    $('hoEndTable').innerHTML = '<tr><th>PLAYER</th><th>KILLS</th><th>DMG</th><th>BUILDS</th><th>REPAIRED</th><th>REVIVES</th><th>RESCUES</th><th>MATS</th></tr>' + m.stats.map(s =>
      `<tr class="${s.id === this.g.me.id ? 'me' : ''}"><td>${esc(s.name)}${(mvp[s.id] || []).map(a => `<em>${a}</em>`).join('')}</td><td>${s.kills}</td><td>${s.dmg}</td><td>${s.builds}</td><td>${s.repaired}</td><td>${s.revives}</td><td>${s.rescues || 0}</td><td>${s.harvested}</td></tr>`).join('');
    $('hoEnd').hidden = false;
    $('hoBest').textContent = recordText();
  }

  // ---------- harvesting (called by the knife) ----------
  // Returns true when the swing hit a tree/rock/wreck/crate.
  harvestSwing(eye, dir, reach) {
    const hit = rayWorld(eye, dir, reach, this.nodes.boxes);
    if (!hit || hit.box.node === undefined) return false;
    const n = this.nodes.nodes[hit.box.node], p = eye.map((v, j) => v + dir[j] * hit.t);
    const nodes = this.nodes;
    let weak = false;
    if (nodes.weakNode === n.id && nodes.weak.visible) weak = nodes.weak.position.distanceTo(_v.set(...p)) < 0.45;
    if (weak || nodes.weakNode !== n.id) nodes.placeWeak(n, eye);
    this.g.net.send({ t: 'harvest', id: n.id, weak });
    const mat = { tree: 'wood', crate: 'wood', pallet: 'wood', rock: 'stone', rubble: 'stone' }[n.type] ?? 'metal';
    this.g.sound.play(weak ? 'weak_hit' : 'chop_' + mat, { vol: 0.8, rate: 0.9 + Math.random() * 0.2 });
    if (weak) this.g.sound.play('chop_' + mat, { vol: 0.6 });
    this.world.burst(p, hit.n, mat === 'wood' ? 0x9c6a3a : mat === 'stone' ? 0xcfc9bd : 0xffd27a, weak ? 12 : 6, 2.5);
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

  splat(m) {
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
  onAction(act) {
    const b = this.build, e = this.edit, g = this.g, pl = g.player, W = g.weapons;
    if (act === 'ready') { this.toggleReady(); return true; }
    if (act === 'backpack') { this.openBag(false); return true; }
    const needsBody = ['build', 'edit', 'demolish', 'interact', 'throw', 'heal', 'dropgun', 'slot4', 'slot5'];
    if (!pl.alive || this.downed) return needsBody.includes(act) || (this.downed && ['primary', 'secondary', 'knife', 'lastWeapon', 'prevWeapon', 'nextWeapon', 'reload', 'inspect', 'alt', 'jump'].includes(act));
    if (act === 'interact') return this.pressInteract();
    if (act === 'build') { e.stop(); b.toggle(); return true; }
    if (act === 'edit') { b.toggle(false); e.toggle(); return true; }
    if (act === 'throw') { this.throwItem(); return true; }
    if (act === 'heal') { this.heal(); return true; }
    if (act === 'dropgun') { this.dropGun(); return true; }
    if (act === 'demolish') { const p = b.aimedPiece(); if (p) g.net.send({ t: 'demolish', id: p.id }); return true; }
    if (e.active) {
      if (act === 'alt') { e.reset(); return true; }
      return ['fire', 'primary', 'secondary', 'knife', 'slot4', 'slot5', 'reload', 'inspect', 'nextWeapon', 'prevWeapon'].includes(act);
    }
    if (b.active) {
      switch (act) {
        case 'fire': b.tryPlace(); return true;
        case 'primary': b.select('wall'); return true;
        case 'secondary': b.select('floor'); return true;
        case 'knife': b.select('ramp'); return true;
        case 'slot4': b.select('trap'); return true;
        case 'nextWeapon': b.cycle(1); return true;
        case 'prevWeapon': b.cycle(-1); return true;
        case 'reload': b.rotate(); return true;
        case 'alt': { const p = b.aimedPiece(); if (p) g.net.send({ t: 'upgrade', id: p.id }); return true; }
        case 'lastWeapon': b.toggle(false); return true;
        case 'inspect': b.toggle(false); W.equip(0); return true;
        case 'slot5': return true;
      }
      return false;
    }
    if (this.using && (act === 'primary' || act === 'secondary' || act === 'knife' || act === 'slot4' || act === 'slot5' || act === 'inspect')) this.using = null;
    // hotbar: 1–5 guns, F = harvesting knife
    const slot = { primary: 1, secondary: 2, knife: 3, slot4: 4, slot5: 5, inspect: 0 }[act];
    if (slot !== undefined) { W.equip(slot); return true; }
    return false;
  }

  toggleReady() {
    if (this.phase !== 'lobby' && this.phase !== 'intermission') return;
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

  // Smart heal: shields when your health is fine, bandages / medkit when it isn't. Press again to cancel.
  heal(item = null) {
    if (this.using && !item) { this.using = null; return; }
    const hp = this.g.me.hp, sh = this.shield, has = id => this.items[id] > 0;
    let pick = item;
    if (!pick) {
      if (hp < 50 && has('medkit')) pick = 'medkit';
      else if (hp < 75 && has('bandage')) pick = 'bandage';
      else if (sh < 50 && has('shield_s')) pick = 'shield_s';
      else if (sh < 100 && has('shield')) pick = 'shield';
      else if (hp < 100 && has('medkit')) pick = 'medkit';
    }
    if (!pick) return this.say(HEALS.some(has) ? 'Already topped up' : 'No healing items — buy bandages, medkits or shields at the Core');
    this.using = { item: pick, start: this.g.now, end: this.g.now + ITEMS[pick].time };
    this.g.weapons.cancelReload();
  }

  dropGun() {
    const W = this.g.weapons;
    if (W.slot >= 1 && W.slots[W.slot]) this.g.net.send({ t: 'dropgun', slot: W.slot - 1, mag: W.clip?.mag ?? 0 });
  }

  // What E would do right now (highest priority first).
  interactTarget() {
    const g = this.g, pl = g.player, me = pl.pos;
    if (!pl.alive || this.downed) return null;
    for (const p of this.roster) {
      const r = p.downed && p.id !== g.me.id ? g.remotes.get(p.id) : null;
      if (r && dist3(r.pos, me) < 2.4) return { kind: 'revive', id: p.id, text: `Hold E to revive ${p.name}`, cont: true };
    }
    if (this.carrying) return { kind: 'putdown', text: 'Carry them into the ring around the Core · E to put down', press: true };
    for (const s of this.ents.survivors.values()) if (s.state === 0 && dist3(s.pos, me) < 2.4) return { kind: 'carry', id: s.id, text: `Hold E to pick up ${s.name}`, hold: 1.0 };
    for (const d of this.ents.drops.values()) if (d.landed && Math.hypot(d.x - me[0], d.z - me[2]) < 2.7) return { kind: 'opendrop', id: d.id, text: 'Hold E to open the supply drop', hold: 1.0 };
    for (const c of this.ents.chests.values()) if (Math.hypot(c.x - me[0], c.z - me[2]) < 2.4) return { kind: 'chest', id: c.id, text: 'Hold E to open the chest', hold: 0.8 };
    const pk = this.ents.nearestPickup(me, 2.3, p => p.kind === 'gun' || p.kind === 'item' || p.kind === 'svsupply');
    if (pk) return { kind: 'pickup', id: pk.id, text: `E: pick up ${pickupName(pk)}${pk.kind === 'gun' && g.weapons.order.every(s => s === 0 || g.weapons.slots[s]) ? ' (swaps with your current gun)' : ''}`, press: true };
    if (this.nearStash()) return { kind: 'stash', text: 'E: open the team chest', press: true };
    if (distToBox(pl.eye, OUTPOST.core.base) < 3.0 && this.core[0] < this.core[1]) {
      const other = this.coreHealer && this.coreHealer !== g.me.id ? this.roster.find(p => p.id === this.coreHealer) : null;
      return { kind: 'coreheal', text: other ? `${other.name} is healing the Core (one at a time)` : 'Hold E to heal the Core', cont: !other };
    }
    const piece = this.build.aimedPiece();
    if (piece && piece.hp + piece.grow < piece.maxHp - 1) return { kind: 'repair', id: piece.id, text: `Hold E to repair ${BMATS[piece.mat].name.toLowerCase()} ${piece.kind} (${Math.round(piece.hp)}/${piece.maxHp})`, cont: true };
    return null;
  }

  pressInteract() {
    const it = this.interactTarget(), g = this.g;
    if (!it?.press) return false;
    if (it.kind === 'pickup') g.net.send({ t: 'pickup', id: it.id, slot: Math.max(0, g.weapons.slot - 1) });
    else if (it.kind === 'putdown') g.net.send({ t: 'carry' });
    else if (it.kind === 'stash') this.openBag(true);
    return true;
  }

  // holds: revive / heal Core / repair send while held; carry / open need a full hold
  interact() {
    const g = this.g, now = g.now, it = this.it = this.interactTarget();
    const holding = g.held('interact') && !g.ui && g.input.locked;
    if (!holding) this.holdLock = false;
    this.reviveId = null;
    if (!holding || !it || it.press || this.holdLock) { this.hold = null; return; }
    if (it.cont) {
      if (it.kind === 'revive') { if (this.reviveTarget !== it.id) { this.reviveTarget = it.id; this.reviveStart = now; } this.reviveId = it.id; }
      if (now - this.lastInteract > 0.2) {
        this.lastInteract = now;
        g.net.send(it.kind === 'revive' ? { t: 'revive', id: it.id } : it.kind === 'coreheal' ? { t: 'coreheal' } : { t: 'repair', id: it.id });
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
    this.bagAtChest = atChest;
    g.ui = 'bag';
    $('bagMenu').hidden = false;
    this.renderBag();
    if (g.input.locked) g.setVCursor(innerWidth / 2, innerHeight / 2);
  }

  closeBag() {
    const g = this.g;
    if (g.ui !== 'bag') return;
    g.ui = null;
    $('bagMenu').hidden = true;
    g.setVCursor(null);
  }

  renderBag() {
    const atChest = this.bagAtChest && this.nearStash();
    $('bagTitle').textContent = atChest ? 'BACKPACK · TEAM CHEST' : 'BACKPACK';
    $('bagGrid').innerHTML = bagHTML(this, atChest);
    for (const b of $('bagGrid').querySelectorAll('button')) {
      b.onclick = () => {
        const d = b.dataset;
        if (d.op) this.g.net.send({ t: 'stash', op: d.op, cat: d.cat, key: d.key, n: +d.n });
        else if (d.use) { this.closeBag(); this.heal(d.use); }
        else if (d.sel) { this.activeThrow = d.sel; this.renderBag(); }
        this.g.sound.play('tick', { vol: 0.4 });
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
        if (b.dataset.bank) { this.payBank = !this.payBank; this.renderBuy(); return; }
        g.net.send({ t: 'buy', item: b.dataset.id, bank: this.payBank, slot: Math.max(0, g.weapons.slot - 1) });
      };
    }
  }

  // ---------- per frame ----------
  update(dt) {
    const g = this.g, now = g.now, pnow = performance.now() / 1000;
    this.zombies.update(dt, pnow);
    const people = [g.player.pos, ...[...g.remotes.values()].map(r => r.pos), ...[...this.ents.survivors.values()].map(s => s.pos)];
    this.structs.tick(dt, people);
    this.nodes.update(dt);
    this.updateGlobs(dt);
    this.ents.update(dt, pnow, { me: g.player.pos, meId: g.me.id, remotes: g.remotes });
    const firing = g.held('fire') && g.input.locked && !g.ui;
    this.build.update(dt, firing);
    this.edit.update(dt, firing);
    this.interact();
    if (this.using) {
      if (!g.player.alive || this.downed) this.using = null;
      else if (now >= this.using.end) { g.net.send({ t: 'use', item: this.using.item }); g.sound.play('heal_done', { vol: 0.6 }); this.using = null; }
    }
    this.dusk += ((this.phase === 'wave' ? 1 : 0) - this.dusk) * Math.min(1, dt * 0.7);
    this.world.setDusk(Math.round(this.dusk * 50) / 50);
    if (this.shadowDirty && now - this.shadowAt > 0.5) { this.world.refreshShadows(); this.shadowDirty = false; this.shadowAt = now; }
    if (now > this.groanAt) this.groan(now);
    if (this.shake > 0) { // explosion camera shake
      const c = g.world.camera, s = this.shake * 0.05;
      c.position.x += (Math.random() - 0.5) * s; c.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
  }

  groan(now) {
    this.groanAt = now + 0.35 + Math.random() * 0.5;
    const me = this.g.player.pos, near = [];
    for (const zb of this.zombies.list.values()) if (!zb.dead && Math.hypot(zb.pos[0] - me[0], zb.pos[2] - me[2]) < 28) near.push(zb);
    if (!near.length) return;
    const zb = near[(Math.random() * near.length) | 0], pos = [zb.pos[0], zb.pos[1] + 1.6 * zb.s, zb.pos[2]];
    const rate = { runner: 1.25, spitter: 1.1, brute: 0.72, alpha: 0.6 }[zb.type] ?? 0.9 + Math.random() * 0.2;
    this.g.sound.play('z_groan' + ((Math.random() * 4) | 0), { pos, vol: 0.55, ref: 2.5, roll: 1.3, rate, muffle: this.g.occluded(pos) ? 900 : 0 });
  }

  // ---------- HUD ----------
  enterDom() {
    hudReset();
    $('hud').classList.add('coop');
    for (const id of ['hoTop', 'compass', 'team', 'mats', 'hotbar']) $(id).hidden = false;
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
    if (!pl.alive) return `${g.deathMsg} — respawning at the Core in ${Math.max(0, Math.ceil(this.respawnAt - now))}s`;
    if (this.downed) return `DOWNED — bleeding out in ${Math.max(0, Math.ceil(this.bleedEnd - now))}s · a teammate can hold E to revive you`;
    if (this.edit.active) return `EDIT (${this.edit.describe()}) · click/drag tiles · V confirm · right-click reset`;
    const b = this.build;
    if (b.active) {
      const p = b.aimedPiece();
      const status = b.reason ? b.reason : `${PIECE_NAME[b.kind]} · ${b.costText()}`;
      const look = p && b.kind !== 'trap' ? ` · aiming at ${BMATS[p.mat].name.toLowerCase()} ${p.kind} ${Math.round(p.hp)}/${p.maxHp}` : '';
      return `${status}${look}`;
    }
    if (this.using) return `Using ${ITEMS[this.using.item].name}… (H to cancel)`;
    if (this.it) return this.it.text;
    if (this.phase === 'lobby') return this.canBuy() ? 'B shop · G build · V edit · F harvest · Y when ready' : 'G build · V edit · F harvest trees, rocks, cars and crates · Y when ready';
    if (this.phase === 'intermission') return `Rebuild, repair and restock · Y to skip the break${this.canBuy() ? ' · B to shop' : ''}`;
    return '';
  }

  refreshHud() {
    const g = this.g, now = g.now, ph = this.phase;
    const n = this.roster.length || 1, ready = this.roster.filter(p => p.ready).length;
    const title = { lobby: 'LOBBY', countdown: 'GET READY', victory: 'VICTORY', defeat: 'DEFEAT' }[ph] ?? `WAVE ${this.wave}/${this.waves}`;
    const sub = ph === 'lobby' ? `${ready}/${n} ready · press Y` : ph === 'intermission' ? `break · ${ready}/${n} ready` : ph === 'wave' ? `${this.diff} · ${n} player${n > 1 ? 's' : ''}` : this.diff;
    setText('hoWaveNo', title);
    setText('hoWaveSub', sub.toUpperCase());
    const [c, cm] = this.core, frac = Math.max(0, Math.min(1, c / cm)), barrier = now < (this.buffs.barrier || 0);
    setStyle('hoCoreFill', 'width', `${(frac * 100).toFixed(1)}%`);
    setClass('hoCore', 'low', frac < 0.3);
    setClass('hoCore', 'shielded', barrier);
    const healer = this.coreHealer && this.roster.find(p => p.id === this.coreHealer);
    setText('hoCoreText', `CORE ${c} / ${cm}${barrier ? ' · BARRIER' : ''}${healer ? ` · ${healer.name} healing` : ''}`);
    const left = Math.max(0, this.end - now);
    setText('hoTimer', ph === 'wave' ? String(this.left) : ph === 'lobby' ? '—' : fmt(left));
    setText('hoLeft', ph === 'wave' ? 'ZOMBIES LEFT' : ph === 'lobby' ? 'NO TIMER' : ph === 'countdown' ? 'UNTIL WAVE 1' : ph === 'intermission' ? 'UNTIL NEXT WAVE' : 'NEXT MATCH');
    setText('matWood', this.mats.wood);
    setText('matStone', this.mats.stone);
    setText('matMetal', this.mats.metal);
    setHTML('hotbar', hotbarHTML(this));
    this.drawCompass();
    setHTML('team', this.roster.map(p => {
      const state = !p.alive ? '☠' : p.downed ? '✚ DOWN' : ph === 'lobby' || ph === 'intermission' ? (p.ready ? '✔ READY' : '…') : `${p.hp}${p.shield ? ` +${p.shield}` : ''}`;
      return `<div class="tm${p.id === g.me.id ? ' me' : ''}${p.downed ? ' down' : ''}${p.alive ? '' : ' dead'}"><span class="n">${esc(p.name)}${p.host ? ' ★' : ''}${p.carrying ? ' ⛑' : ''}</span><span class="s">${state}</span><i style="width:${p.alive && !p.downed ? p.hp : 0}%"></i><u style="width:${p.alive ? p.shield || 0 : 0}%"></u></div>`;
    }).join('') + [...this.ents.survivors.values()].map(s => `<div class="tm sv"><span class="n">${esc(s.name)} <small>survivor</small></span><span class="s">${['wounded', 'carried', `${Math.round(s.hp * 100)}% · ${s.ammo} ammo`][s.state]}</span><i style="width:${s.hp * 100}%"></i></div>`).join(''));
    // boss bar
    const k = this.ents.sky;
    setHidden('hoBoss', !k || k.dead);
    if (k && !k.dead) {
      const alive = k.hp.filter(h => h > 0).length, sum = k.hp.reduce((a, b) => a + Math.max(0, b), 0);
      setText('hoBossName', `THE COLOSSUS · weak points ${alive}/${k.hp.length}`);
      setStyle('hoBossFill', 'width', `${((sum / (k.max * k.hp.length)) * 100).toFixed(1)}%`);
    }
    // buffs + task
    const chips = [['damage', 'DAMAGE +30%'], ['rate', 'RAPID FIRE'], ['barrier', 'CORE BARRIER']].filter(([key]) => now < (this.buffs[key] || 0)).map(([key, label]) => `<span>${label} ${Math.ceil(this.buffs[key] - now)}s</span>`);
    setHTML('hoBuffs', chips.join(''));
    setHidden('hoTask', !(this.task && now < this.task.until));
    if (this.task) setText('hoTask', this.task.text);
    const b = this.build;
    setHidden('buildBar', !b.active);
    if (b.active) {
      const trap = b.kind === 'trap';
      setHTML('buildBar', ['wall', 'floor', 'ramp', 'trap'].map((k2, i) => `<span class="${b.kind === k2 ? 'on' : ''}"><b>${i + 1}</b>${k2.toUpperCase()}</span>`).join('') +
        (trap ? `<span class="on"><b>⟳</b>${esc(ITEMS[b.trap]?.name ?? 'NONE')} ×${this.items[b.trap] || 0}</span>` : `<span class="mat ${b.mat} on"><b>⟳</b>${b.mat.toUpperCase()} ${this.mats[b.mat]}</span>`) +
        `<small>LMB place (hold) · RMB upgrade · R rotate · X demolish · V edit · G/Q exit</small>`);
    }
    // progress ring: reviving, holding E, using an item, or bleeding out
    let ring = null;
    if (this.reviveId) ring = [Math.min(1, (now - this.reviveStart) / 3), `REVIVING ${g.name(this.reviveId).toUpperCase()}`, 'var(--accent2)'];
    else if (this.hold) ring = [Math.min(1, (now - this.hold.start) / this.hold.it.hold), this.hold.it.kind === 'carry' ? 'PICKING UP' : 'OPENING', 'var(--gold)'];
    else if (this.using) ring = [(now - this.using.start) / (this.using.end - this.using.start), ITEMS[this.using.item].name.toUpperCase(), '#7fd0ff'];
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
      setText('sbMeta', `Zombie Holdout · ${this.diff} · wave ${this.wave}/${this.waves} · room ${g.code} · team bank $${this.stash.money}`);
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
    for (const s of this.ents.survivors.values()) if (s.state === 0) put(bearing(pl.pos, s.pos[0], s.pos[2]), 'svm', '✚');
    for (const p of this.roster) {
      const r = p.id !== this.g.me.id && this.g.remotes.get(p.id);
      if (r) put(bearing(pl.pos, r.pos[0], r.pos[2]), p.downed ? 'mate down' : 'mate', '●');
    }
    setHTML('compassTicks', marks.join(''));
  }

  // Name tags over teammates and survivors.
  updateTags() {
    const cam = this.g.world.camera, root = $('tags'), seen = new Set();
    const show = (key, pos, text, cls) => {
      seen.add(key);
      let el = this.tags.get(key);
      if (!el) { el = document.createElement('div'); root.append(el); this.tags.set(key, el); }
      _v.set(...pos).project(cam);
      const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      el.hidden = !vis;
      if (!vis) return;
      el.className = cls;
      if (el.textContent !== text) el.textContent = text;
      el.style.transform = `translate(${((_v.x + 1) / 2) * innerWidth}px, ${((1 - _v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
    };
    for (const p of this.roster) {
      const r = p.id !== this.g.me.id && p.alive ? this.g.remotes.get(p.id) : null;
      if (r) show(p.id, [r.pos[0], r.pos[1] + (p.downed ? 0.9 : 2.15), r.pos[2]], p.downed ? `✚ ${p.name}` : p.name, p.downed ? 'tag down' : 'tag');
    }
    for (const s of this.ents.survivors.values()) {
      if (s.state === 1) continue;
      show('sv' + s.id, [s.pos[0], s.pos[1] + (s.state === 0 ? 0.9 : 2.15), s.pos[2]], s.state === 0 ? `✚ ${s.name} (wounded)` : `${s.name} ${Math.round(s.hp * 100)}%`, s.state === 0 ? 'tag sv down' : 'tag sv');
    }
    for (const [id, el] of this.tags) if (!seen.has(id)) { el.remove(); this.tags.delete(id); }
  }

  dispose() {
    this.closeBag();
    this.zombies.dispose();
    this.structs.dispose();
    this.nodes.dispose();
    this.build.dispose();
    this.edit.dispose();
    this.ents.dispose();
    this.clearGlobs();
    this.globGeo.dispose();
    this.globMat.dispose();
    this.bombMat.dispose();
    for (const el of this.tags.values()) el.remove();
    this.world.setDusk(0);
    this.world.setLanes({});
    $('hud').classList.remove('coop', 'downed');
    for (const id of ['hoTop', 'compass', 'team', 'mats', 'buildBar', 'revive', 'hoAlert', 'hoEnd', 'hotbar', 'hoBoss', 'hoTask', 'bagMenu']) $(id).hidden = true;
    $('hoFeed').innerHTML = '';
    $('hoBuffs').innerHTML = '';
    if (this.sbHead) $('scoreboard').querySelector('thead').innerHTML = this.sbHead;
    hudReset(); // elements above were changed behind the HUD's value cache
  }
}
