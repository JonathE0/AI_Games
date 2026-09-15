// Zombie Holdout: 1–4 players defend the Core through 10 waves. Server-authoritative for zombies, built
// pieces (and their edits), backpacks, the shop and team chest, loot, traps, survivors, the Colossus,
// health, downs and revives; clients report movement and hit claims (validated against where each target
// was over the last few hundred ms).
import { WEAPONS, ECON, computeDamage } from '../../shared/weapons.js';
import { modeOf } from '../../shared/modes.js';
import { OUTPOST, OUTPOST_BOXES, OUTPOST_NODES, NODE_TYPES } from '../../shared/outpost.js';
import { BMATS, MAT_IDS, KINDS, PIECE_COST, REPAIR_HP_PER_MAT, START_FRAC, REFUND, REACH, pieceBox, pieceBoxes, slotKey, checkPlacement, distToBox, validMask } from '../../shared/build.js';
import { ZTYPES, ZTYPE_IDS, WAVES, DIFFS, CORE_ARMOR, coreHp, bossHp } from '../../shared/zombies.js';
import { ITEMS, RARITY, POWERUPS, BUFF, AMMO, MAT_CAP, intermissionFor, rollLoot } from '../../shared/holdout.js';
import { SKY } from '../../shared/skyboss.js';
import { rayWorld, blocked } from '../../shared/physics.js';
import { BoxGrid } from '../../shared/boxgrid.js';
import { BaseRoom, nextUid } from '../baseRoom.js';
import { PARTS } from '../room.js';
import { FlowField } from './flowfield.js';
import { Director } from './director.js';
import { updateZombies, updateProjectiles } from './ai.js';
import { Inventory, freshBackpack, carries } from './inventory.js';
import { Combat } from './combat.js';
import { Defenses } from './defenses.js';
import { Survivors } from './survivors.js';
import { SkyBoss } from './skyboss.js';
import { Events } from './events.js';

export const HOLDOUT = {
  startMoney: 800, startMats: { wood: 200, stone: 60, metal: 30 }, waveMats: { wood: 50, stone: 30, metal: 15 },
  countdown: 10000, readySkip: 3000, endScreen: 15000,
  bleed: 30000, revive: 3000, reviveHp: 40, respawnSolo: 8000, respawnTeam: 12000,
  aiStep: 0.05, coreHeal: 60, chests: 6,
};
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp16 = v => Math.max(-32767, Math.min(32767, Math.round(v)));
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
    this.mode = modeOf('zombies');
    this.maxPlayers = this.mode.maxPlayers;
    this.diffId = DIFFS[opts.diff] ? opts.diff : 'normal';
    this.diff = DIFFS[this.diffId];
    this.rng = opts.rng || Math.random;
    this.players = [];
    this.vsBot = false;
    this.public = false;
    this.host = null;
    this.map = OUTPOST;
    this.coreBase = OUTPOST.core.base;
    this.flow = new FlowField(OUTPOST.bounds, OUTPOST_BOXES, OUTPOST.core);
    this.director = new Director(this, this.rng);
    this.inventory = new Inventory(this);
    this.combat = new Combat(this);
    this.defenses = new Defenses(this);
    this.survivors = new Survivors(this);
    this.sky = new SkyBoss(this);
    this.events = new Events(this);
    this.zid = 0;
    this.pid = 0;
    this.resetWorld();
  }

  newItem(w, r = 0) { const it = super.newItem(w); it.r = r; return it; }

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
    for (const b of OUTPOST_BOXES) this.grid.add(b);
    for (const n of this.nodes) this.grid.add(n.box);
    this.core = { hp: coreHp(this.activeCount()), max: coreHp(this.activeCount()) };
    this.director.reset();
    for (const m of [this.inventory, this.combat, this.defenses, this.survivors, this.sky, this.events]) m.reset();
    this.buffs = {};
    this.coreHealer = null;
    this.coreHealAt = 0;
    this.flowDirty = true;
    Object.assign(this, { flowAt: 0, aiAcc: 0, snapAt: 0, pieceAt: 0, statAt: 0, rosterAt: 0, lastStat: '', coreAlarmAt: 0 });
    this.events.refreshChests(HOLDOUT.chests);
  }

  isFull() { return this.players.length >= this.maxPlayers; }
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
      ...freshBackpack(this), mats: { ...HOLDOUT.startMats }, ready: false, carrying: null,
      st: { p: [0, 0, 0], v: [0, 0, 0], y: 0, pi: 0, c: 0, w: 'pistol', g: true },
      lastShot: {}, ping: 0, spawnPos: null, stats: freshStats(),
      reviver: null, reviveProg: 0, reviveLast: 0, lastBuild: 0, lastRepair: 0, lastHarvest: 0, lastUse: 0, lastEdit: 0,
    };
  }

  addPlayer(ws, name) {
    const p = this.makePlayer(name, ws);
    this.players.push(p);
    this.host ??= p.id;
    this.send(p, { t: 'welcome', id: p.id, code: this.code, bot: false, rules: { winRounds: WAVES, buyGrace: 0 }, gameMode: this.mode.id, diff: this.diffId });
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
    Object.assign(p, { hp: 100, alive: true, downed: false, respawnAt: 0, bleedEnd: 0, reviver: null, reviveProg: 0, spawnPos: pos, spawnIdx: idx });
    p.st = { ...p.st, p: pos, v: [0, 0, 0], y: sp.yaw, pi: 0, c: 0 };
    this.broadcast({ t: 'spawn', id: p.id, pos, yaw: sp.yaw });
    this.sendInv(p);
  }

  // Everything a (late) joiner needs.
  syncWorld(p) {
    this.send(p, {
      t: 'sall', s: [...this.pieces.values()].map(pieceTuple),
      nodes: this.nodes.filter(n => n.hp < NODE_TYPES[n.type].hits).map(n => [n.id, n.hp]),
    });
    this.send(p, { t: 'zclear' });
    if (this.zombies.size) this.send(p, { t: 'zsp', z: [...this.zombies.values()].map(z => [z.id, z.ti, z.maxHp, r2(z.pos[0]), r2(z.pos[2]), r3(z.yaw)]) });
    for (const m of [this.inventory, this.defenses, this.survivors, this.sky, this.events, this.combat]) m.syncTo(p);
    this.send(p, this.buffMsg());
    this.send(p, this.phaseMsg());
  }

  // ---------- phases ----------
  onReady(p, on) {
    if (this.phase !== 'lobby' && this.phase !== 'intermission') return;
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
    } else if (this.phase === 'intermission' && this.phaseEnd - now > HOLDOUT.readySkip) {
      this.phaseEnd = now + HOLDOUT.readySkip;
      this.broadcastPhase();
    }
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
    if (w === SKY.wave) {
      this.sky.spawn(now);
      this.broadcast({ t: 'task', text: 'THE COLOSSUS: shoot its glowing weak points with a sniper (SSG 08 / AWP)' });
    }
    this.broadcastPhase();
    this.broadcastRoster();
  }

  waveCleared() {
    const w = this.wave;
    if (w >= WAVES) return this.endMatch(true);
    for (const p of this.players) {
      p.money = Math.min(ECON.max, p.money + 800 + 100 * w);
      for (const m of MAT_IDS) p.mats[m] = Math.min(MAT_CAP, p.mats[m] + HOLDOUT.waveMats[m]);
      if (p.downed) this.revive(p, null);
      else if (!p.alive) this.spawn(p);
      this.sendInv(p);
    }
    this.core.hp = Math.min(this.core.max, this.core.hp + this.core.max * 0.1);
    for (const pr of this.proj) this.broadcast({ t: 'splat', id: pr.id, p: pr.pos.map(r2) }); // globs still in the air fizzle
    this.proj = [];
    this.phase = 'intermission';
    this.phaseEnd = Date.now() + intermissionFor(w);
    this.director.plan(w + 1);
    if (w % 3 === 0) this.events.refreshChests(HOLDOUT.chests);
    if (w + 1 === SKY.wave) this.broadcast({ t: 'task', text: 'Something huge darkens the sky next wave — buy a sniper rifle at the Core!' });
    this.broadcastPhase();
    this.broadcastRoster();
  }

  endMatch(win) {
    this.phase = win ? 'victory' : 'defeat';
    this.phaseEnd = Date.now() + HOLDOUT.endScreen;
    for (const z of this.zombies.values()) z.dead = true;
    this.zombies.clear();
    this.proj = [];
    this.director.queue = [];
    this.broadcast({ t: 'zclear' });
    this.broadcast({ t: 'hend', win, wave: this.wave, diff: this.diffId, stats: this.players.map(p => ({ id: p.id, name: p.name, ...p.stats })) });
    this.broadcastPhase();
  }

  newMatch() {
    this.resetWorld();
    for (const p of this.players) {
      Object.assign(p, { money: HOLDOUT.startMoney, mats: { ...HOLDOUT.startMats }, ...freshBackpack(this), ready: false, carrying: null, stats: freshStats() });
      this.syncWorld(p);
      this.spawn(p);
    }
    this.broadcastRoster();
  }

  // ---------- tick ----------
  update(now, dt) {
    if ((this.phase === 'countdown' || this.phase === 'intermission') && now >= this.phaseEnd) this.startWave(this.wave + 1);
    else if ((this.phase === 'victory' || this.phase === 'defeat') && now >= this.phaseEnd) this.newMatch();
    if (this.phase === 'wave') {
      this.director.update(now);
      if (this.director.done()) this.waveCleared();
    }
    for (const p of this.players) {
      if (p.downed) {
        if (p.reviver && now - p.reviveLast < 500) p.bleedEnd += dt * 1000; // bleeding pauses while being revived
        else if (p.reviver) { p.reviver = null; p.reviveProg = 0; }
        if (now >= p.bleedEnd) this.die(p, null);
      }
      if (!p.alive && p.respawnAt && now >= p.respawnAt) this.spawn(p);
    }
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
        for (const z of [...this.zombies.values()]) if (z.burnUntil > now) this.damageZombie(z, z.burnDps * step, z.burnBy, 'flame');
      }
      this.combat.update(step, now);
      this.defenses.update(step, now);
      this.survivors.update(step, now);
      if (this.phase === 'victory' || this.phase === 'defeat') break; // the Core fell
    }
    this.events.update(dt, now);
    this.inventory.update(now);
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

  // Binary horde snapshot: [u8 1, u8 0, u16 count, f64 time] + per zombie
  // [u16 id, i16 x·100, i16 y·100, i16 z·100, i16 yaw·10000, u8 state (4 = frozen), u8 hp/max·255] (12 bytes).
  sendSnapshot(now) {
    const buf = Buffer.alloc(12 + this.zombies.size * 12);
    buf.writeUInt8(1, 0);
    buf.writeUInt16LE(this.zombies.size, 2);
    buf.writeDoubleLE(now, 4);
    let o = 12;
    for (const z of this.zombies.values()) {
      buf.writeUInt16LE(z.id, o);
      buf.writeInt16LE(clamp16(z.pos[0] * 100), o + 2);
      buf.writeInt16LE(clamp16(z.pos[1] * 100), o + 4);
      buf.writeInt16LE(clamp16(z.pos[2] * 100), o + 6);
      buf.writeInt16LE(clamp16(wrap(z.yaw) * 10000), o + 8);
      buf.writeUInt8(now < (z.frozenUntil || 0) ? 4 : z.state, o + 10);
      buf.writeUInt8(Math.max(0, Math.min(255, Math.round((z.hp / z.maxHp) * 255))), o + 11);
      o += 12;
    }
    for (const p of this.players) if (p.ws && p.ws.readyState === 1) p.ws.send(buf);
  }

  // ---------- zombies ----------
  spawnZombie(type, laneId) {
    const t = ZTYPES[type], lane = this.map.lanes.find(l => l.id === laneId) ?? this.map.lanes[0];
    const [x0, z0, x1, z1] = lane.zone;
    let x, z, tries = 0;
    do { x = x0 + this.rng() * (x1 - x0); z = z0 + this.rng() * (z1 - z0); }
    while (tries++ < 8 && blocked(x, 0, z, 1.8 * t.scale, this.grid.query(x - 1, z - 1, x + 1, z + 1, tmpBoxes)));
    do this.zid = (this.zid + 1) & 0xffff; while (!this.zid || this.zombies.has(this.zid));
    const maxHp = t.boss ? bossHp(t, this.director.n) : Math.round(t.hp * this.director.hpMul);
    const yaw = Math.atan2(x, z); // face the Core
    const zb = {
      id: this.zid, type, t, ti: ZTYPE_IDS.indexOf(type), pos: [x, 0, z], vel: [0, 0, 0], yaw, g: true,
      hp: maxHp, maxHp, armor: t.armor || 0, helmet: !!t.helmet, s: t.scale,
      state: 0, stateEnd: 0, nextAtk: 0, target: null, aggro: null, thinkAt: 0, aggroBlock: 0, stuck: 0,
      hist: [], dmgBy: new Map(), hurtAt: 0, dead: false, frozenUntil: 0, slowUntil: 0, slow: 0, burnUntil: 0,
    };
    this.zombies.set(zb.id, zb);
    this.spawnBatch.push([zb.id, zb.ti, maxHp, r2(x), r2(z), r3(yaw)]);
    return zb;
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
    const boxes = this.grid.query(Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2]), []);
    const hit = rayWorld(a, d.map(v => v / len), len, boxes);
    return !hit || hit.t >= len - 0.3;
  }

  // Nearest built piece standing on the ground within r of a zombie (walls, ramps, supports, doors).
  pieceNear(pos, r) {
    const body = [pos[0], pos[1] + 0.9, pos[2]];
    let best = null, bd = r;
    for (const b of this.grid.query(pos[0] - r - 1, pos[2] - r - 1, pos[0] + r + 1, pos[2] + r + 1, [])) {
      if (b.sid === undefined || b.min[1] > pos[1] + 1.5) continue;
      const d = distToBox(body, b);
      if (d <= bd) { bd = d; best = this.pieces.get(b.sid) ?? best; }
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
    for (const pl of this.targets()) {
      if (!pl.alive || pl.downed) continue;
      const d = Math.hypot(pl.st.p[0] - p[0], pl.st.p[1] + 0.9 - p[1], pl.st.p[2] - p[2]);
      if (d <= r + 0.4) this.hurtPlayer(pl, pr.dmg * mul * (1 - (0.5 * d) / (r + 0.4)), { id: pr.from, pos: p, t: pr.by ?? ZTYPES.spitter });
    }
    const hitPieces = new Set();
    for (const b of this.grid.query(p[0] - r, p[2] - r, p[0] + r, p[2] + r, [])) {
      if (b.sid !== undefined && distToBox(p, b) <= r) hitPieces.add(this.pieces.get(b.sid));
    }
    for (const s of hitPieces) if (s) this.damagePiece(s, pr.sdmg * mul);
    if (distToBox(p, this.coreBase) <= r) this.damageCore(pr.sdmg * mul * (pr.kind === 'bomb' ? 0.5 : 1), null); // the Core's shell shrugs off half a sky bomb
    this.broadcast({ t: 'splat', id: pr.id, p: p.map(r2) });
  }

  // ---------- damage ----------
  hurtPlayer(p, dmg, z) {
    if (p.isSurvivor) return this.survivors.hurt(p, dmg);
    if (!p.alive || p.downed || this.phase !== 'wave') return;
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
  }

  die(p, z) {
    if (p.carrying) this.survivors.drop(p);
    const wait = this.players.length < 2 ? HOLDOUT.respawnSolo : HOLDOUT.respawnTeam;
    Object.assign(p, { alive: false, downed: false, hp: 0, respawnAt: Date.now() + wait, reviver: null });
    this.broadcast({ t: 'pdie', id: p.id, by: z?.t?.name ?? (z === null ? 'bleeding out' : ''), respawn: wait });
    this.sendInv(p);
    this.broadcastRoster();
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
    if (now - this.coreAlarmAt > 4000) { this.coreAlarmAt = now; this.broadcast({ t: 'coreHit', from: z ? [r2(z.pos[0]), r2(z.pos[2])] : null }); }
    if (this.core.hp <= 0) { this.core.hp = 0; this.endMatch(false); }
  }

  damagePiece(s, dmg) {
    s.hp -= dmg;
    this.flowDirty = true;
    if (s.hp <= 0) this.removePiece(s, 'broken');
    else this.dirtyPieces.add(s);
  }

  // Any damage to a zombie (guns, explosives, traps, turrets, survivors). `by` = player, survivor or null.
  damageZombie(z, dmg, by, wId, hs = false) {
    if (z.dead || !(dmg > 0)) return 0;
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
    const reward = z.t.reward, player = killer?.stats ? killer : null;
    if (player) {
      player.money = Math.min(ECON.max, player.money + reward);
      player.stats.kills++;
      if (this.rng() < 0.25) player.mats.metal += 2; // scrap
      this.sendInv(player);
      // now and then a zombie drops a few rounds for the gun that killed it (ammo is otherwise bought)
      const type = WEAPONS[wId]?.ammo;
      if (type && type !== 'rockets' && this.rng() < 0.12) this.inventory.spawn({ kind: 'ammo', type, n: Math.max(2, Math.round(AMMO[type].pack / 4)) }, [z.pos[0], z.pos[1], z.pos[2]]);
    }
    for (const [pid, d] of z.dmgBy) {
      const q = pid !== player?.id && d >= z.maxHp * 0.25 && this.players.find(x => x.id === pid);
      if (q) { q.money = Math.min(ECON.max, q.money + Math.round(reward / 2)); this.sendInv(q); }
    }
    if (z.t.boss) { // bosses drop guns, ammo, materials and survivor supplies
      this.inventory.scatter(rollLoot('boss'), [z.pos[0], z.pos[1], z.pos[2]], 2.2);
      this.broadcast({ t: 'msg', text: 'The Alpha Brute dropped a pile of loot!' });
    }
    this.broadcast({ t: 'zdie', id: z.id, by: killer?.isSurvivor ? 'sv' + killer.id : killer?.id ?? null, hs, w: wId });
  }

  // ---------- players shooting ----------
  onShot(p, m) {
    const w = WEAPONS[m.w];
    if (!w || !p.alive || p.downed || p.carrying || !this.hasWeapon(p, m.w)) return;
    const now = Date.now();
    const gap = (w.cat === 'melee' ? (m.alt ? 900 : 350) : 60000 / w.rpm) * 0.7 / (this.buffActive('rate') ? BUFF.rate : 1);
    if (now - (p.lastShot[m.w] || 0) < gap) return;
    p.lastShot[m.w] = now;
    this.broadcast({ t: 'shot', id: p.id, w: m.w, o: m.o, d: m.d, e: m.e, alt: !!m.alt }, p);
    if (!Array.isArray(m.o) || m.o.length !== 3 || !m.o.every(Number.isFinite)) return;
    const eye = this.eye(p);
    if (Math.hypot(m.o[0] - eye[0], m.o[1] - eye[1], m.o[2] - eye[2]) > 2.5) return; // must shoot from where you are
    const item = p.guns.find(g => g && g.w === m.w), mult = RARITY[item?.r ?? 0].mult * (this.buffActive('damage') ? BUFF.damage : 1);
    if (Array.isArray(m.bal)) for (const id of m.bal.slice(0, 2)) this.events.onBalloon(p, { id });
    if (Array.isArray(m.sky) && w.cat === 'sniper') { // weak points of the Colossus: snipers only
      for (const [i, k] of m.sky.slice(0, 1)) this.sky.hit(p, i | 0, m.o, m.d?.[k | 0], w.dmg * 2 * mult, now);
    }
    if (!Array.isArray(m.h) || !m.h.length) return;
    const byZombie = new Map();
    for (const h of m.h.slice(0, w.pellets)) {
      const z = this.zombies.get(h?.id);
      if (!z || z.dead || !PARTS.has(h.part)) continue;
      if (w.cat === 'melee') {
        if (Math.hypot(z.pos[0] - eye[0], z.pos[2] - eye[2]) > w.reach + 1.2 * z.s) continue;
      } else if (!this.rayNearZombie(m.o, m.d?.[h.k | 0], z)) continue;
      const pen = Number.isFinite(+h.pen) ? Math.min(1, Math.max(0, +h.pen)) : 1;
      (byZombie.get(z) ?? byZombie.set(z, []).get(z)).push({ part: h.part, pen });
    }
    for (const [z, hits] of byZombie) this.hitZombie(p, z, w, hits, !!m.alt, mult);
  }

  // Lag tolerance: the claimed bullet must pass close to where the zombie was during the last ~400 ms.
  rayNearZombie(o, d, z) {
    if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) return false;
    const len = Math.hypot(...d);
    if (len < 1e-6) return false;
    const u = d.map(v => v / len), h = 1.9 * z.s, tol = 0.55 * z.s + 0.5;
    if (rayAxisDist(o, u, z.pos, h) <= tol) return true;
    for (let i = 0; i < z.hist.length; i += 4) {
      if (rayAxisDist(o, u, [z.hist[i + 1], z.hist[i + 2], z.hist[i + 3]], h) <= tol) return true;
    }
    return false;
  }

  hitZombie(att, z, w, hits, alt, mult = 1) {
    const a = att.st.p, dist = Math.hypot(a[0] - z.pos[0], a[1] - z.pos[1], a[2] - z.pos[2]);
    let total = 0, hs = false, part = hits[0].part;
    for (const h of hits) {
      total += computeDamage(w, h.part, dist, z.armor, z.helmet, h.pen, { alt, back: false }).hp * (w.cat === 'melee' ? 1 : mult);
      if (h.part === 'head') { hs = true; part = 'head'; }
    }
    total = Math.round(total);
    const left = z.hp - total;
    const dealt = this.damageZombie(z, total, att, w.id, hs && w.cat !== 'melee');
    this.send(att, {
      t: 'dmg', att: att.id, vic: 'z' + z.id, dmg: Math.round(dealt), hp: Math.max(0, left), part, w: w.id,
      helm: hs && z.helmet && w.cat !== 'melee', from: a,
    });
  }

  // ---------- building ----------
  placementWorld(p) {
    return {
      slots: this.slots, pieces: [...this.pieces.values()].flatMap(s => s.boxes), statics: OUTPOST_BOXES,
      nodes: this.aliveNodeBoxes(), zombies: [...this.zombies.values()].map(z => ({ x: z.pos[0], y: z.pos[1], z: z.pos[2], s: z.s })),
      eye: this.eye(p), mats: p.mats, core: this.map.core, zone: this.map.zone,
    };
  }

  onBuild(p, m) {
    if (!p.alive || p.downed || this.phase === 'victory' || this.phase === 'defeat') return;
    const now = Date.now();
    if (now - p.lastBuild < 80) return;
    const piece = { kind: m.kind, i: m.i, k: m.k, l: m.l, o: m.kind === 'floor' ? 0 : m.o, mat: m.mat };
    const why = checkPlacement(piece, this.placementWorld(p));
    if (why) return this.send(p, { t: 'deny', text: why });
    p.lastBuild = now;
    p.mats[piece.mat] -= PIECE_COST;
    p.stats.builds++;
    this.addPiece(piece, p);
    this.sendInv(p);
  }

  addPiece(piece, owner) {
    const mat = BMATS[piece.mat];
    Object.assign(piece, { id: this.nextSid++, owner: owner?.id ?? null, maxHp: mat.hp, hp: mat.hp * START_FRAC, mask: 0 });
    piece.grow = mat.hp - piece.hp;
    piece.rate = piece.grow / mat.time;
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
    this.broadcast({ t: 'sdel', id: s.id, why });
  }

  // a piece the player can touch (reach from their eye)
  reachable(p, id) {
    const s = this.pieces.get(id);
    return s && p.alive && !p.downed && distToBox(this.eye(p), s.box) <= REACH ? s : null;
  }

  // Fortnite-style edit: doors, windows, arches, half walls, floor holes, half ramps.
  onEdit(p, m) {
    const s = this.reachable(p, m.id), now = Date.now();
    if (!s || !validMask(s.kind, m.mask) || s.mask === m.mask || now - p.lastEdit < 150) return;
    p.lastEdit = now;
    for (const b of s.boxes) this.grid.remove(b);
    s.mask = m.mask;
    s.boxes = pieceBoxes(s);
    for (const b of s.boxes) this.grid.add(b);
    this.defenses.pieceChanged(s, true);
    this.flowDirty = true;
    this.broadcast({ t: 'sedit', id: s.id, mask: s.mask });
  }

  onUpgrade(p, m) {
    const s = this.reachable(p, m.id);
    if (!s) return;
    const next = BMATS[s.mat].next;
    if (!next) return this.send(p, { t: 'deny', text: 'Already metal' });
    if (p.mats[next] < PIECE_COST) return this.send(p, { t: 'deny', text: `Not enough ${next}` });
    p.mats[next] -= PIECE_COST;
    const add = BMATS[next].hp - s.maxHp;
    s.mat = next;
    s.maxHp = BMATS[next].hp;
    s.grow += add;
    s.rate = s.grow / BMATS[next].time;
    s.box.mat = BMATS[next].code;
    for (const b of s.boxes) b.mat = BMATS[next].code;
    this.flowDirty = true;
    this.broadcast({ t: 'supd', s: [pieceUpdate(s)] });
    this.sendInv(p);
  }

  onRepair(p, m) {
    const s = this.reachable(p, m.id), now = Date.now();
    if (!s || now - p.lastRepair < 180) return;
    const missing = s.maxHp - s.hp - s.grow;
    if (missing < 1) return;
    const heal = Math.min(missing, 40, p.mats[s.mat] * REPAIR_HP_PER_MAT);
    if (heal < 1) return this.send(p, { t: 'deny', text: `Not enough ${s.mat}` });
    p.lastRepair = now;
    p.mats[s.mat] -= Math.ceil(heal / REPAIR_HP_PER_MAT);
    s.hp += heal;
    p.stats.repaired += Math.round(heal);
    this.dirtyPieces.add(s);
    this.flowDirty = true;
    this.sendInv(p);
  }

  onDemolish(p, m) {
    const s = this.reachable(p, m.id);
    if (!s) return;
    if (s.owner !== p.id) return this.send(p, { t: 'deny', text: 'Only the builder can remove this' });
    this.removePiece(s, 'demolish');
    p.mats[s.mat] = Math.min(MAT_CAP, p.mats[s.mat] + REFUND);
    this.sendInv(p);
  }

  onHarvest(p, m) {
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

  // Hold E at the Core: heals it, but only one player at a time.
  onCoreHeal(p) {
    const now = Date.now();
    if (!p.alive || p.downed || distToBox(this.eye(p), this.coreBase) > 3.2) return;
    if (this.coreHealer && this.coreHealer !== p.id && now - this.coreHealAt < 600) {
      const who = this.players.find(q => q.id === this.coreHealer);
      return this.send(p, { t: 'deny', text: `${who?.name ?? 'Someone'} is already healing the Core` });
    }
    const dt = this.coreHealer === p.id ? Math.min(0.35, (now - this.coreHealAt) / 1000) : 0.2;
    if (this.coreHealer !== p.id) { this.coreHealer = p.id; this.broadcast({ t: 'coreheal', id: p.id }); }
    this.coreHealAt = now;
    this.core.hp = Math.min(this.core.max, this.core.hp + HOLDOUT.coreHeal * dt);
  }

  // bandages, medkits and shield potions
  onUse(p, m) {
    const it = ITEMS[m.item], now = Date.now(), deny = text => this.send(p, { t: 'deny', text });
    if (!it || (it.kind !== 'heal' && it.kind !== 'shield') || !(p.items[m.item] > 0) || !p.alive || p.downed) return;
    if (now - p.lastUse < it.time * 800) return;
    if (it.kind === 'heal') { if (p.hp >= it.cap) return deny('Already healed'); p.hp = Math.min(it.cap, p.hp + it.hp); }
    else { if (p.shield >= it.cap) return deny('Shields are full'); p.shield = Math.min(it.cap, p.shield + it.sh); }
    p.lastUse = now;
    p.items[m.item]--;
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
      for (const s of this.pieces.values()) { s.hp = s.maxHp; s.grow = 0; this.dirtyPieces.add(s); }
      this.flowDirty = true;
    } else if (id === 'p_barrier') {
      if (this.buffActive('barrier')) return false;
      this.buffs.barrier = now + pw.time * 1000;
      this.core.hp = Math.min(this.core.max, this.core.hp + 1500);
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
      case 'buy': return this.inventory.onBuy(p, String(m.item), !!m.bank, m.slot);
      case 'build': return this.onBuild(p, m);
      case 'edit': return this.onEdit(p, m);
      case 'upgrade': return this.onUpgrade(p, m);
      case 'repair': return this.onRepair(p, m);
      case 'demolish': return this.onDemolish(p, m);
      case 'harvest': return this.onHarvest(p, m);
      case 'revive': return this.onRevive(p, m);
      case 'ready': return this.onReady(p, !!m.on);
      case 'reload': return this.inventory.onReload(p, m);
      case 'pickup': return this.inventory.onPickup(p, m);
      case 'dropgun': return this.inventory.onDropGun(p, m);
      case 'stash': return this.inventory.onStash(p, m);
      case 'use': return this.onUse(p, m);
      case 'throw': return this.combat.onThrow(p, m);
      case 'rocket': return this.combat.onRocket(p, m);
      case 'place': return this.defenses.onPlace(p, m);
      case 'open': return this.events.onOpen(p, m);
      case 'carry': return this.survivors.onCarry(p, m);
      case 'coreheal': return this.onCoreHeal(p);
      default: this.handleCommon(p, m);
    }
  }

  sendInv(p) {
    this.send(p, {
      t: 'inv', money: p.money, armor: Math.round(p.shield), helmet: false, hp: Math.max(0, Math.round(p.hp)),
      alive: p.alive, guns: p.guns, side: p.side, mats: p.mats, downed: p.downed, ammo: p.ammo, items: p.items,
      shield: Math.round(p.shield), carrying: p.carrying ?? null,
    });
  }

  phaseMsg() {
    return {
      t: 'hphase', phase: this.phase, endsIn: this.phaseEnd ? Math.max(0, this.phaseEnd - Date.now()) : 0,
      wave: this.wave, waves: WAVES, lanes: this.phase === 'wave' ? this.director.lanes : [],
      next: this.phase === 'wave' ? [] : this.director.planned?.lanes ?? [], core: [Math.round(this.core.hp), this.core.max],
      left: this.director.remaining + this.zombies.size, diff: this.diffId,
    };
  }

  broadcastPhase() { this.broadcast(this.phaseMsg()); }

  broadcastRoster() {
    this.broadcast({
      t: 'roster', round: this.wave, players: this.players.map(p => ({
        id: p.id, name: p.name, side: p.side, hp: Math.max(0, Math.round(p.hp)), shield: Math.round(p.shield), alive: p.alive, downed: p.downed,
        ready: p.ready, host: p.id === this.host, ping: p.ping, bot: false, score: 0, deaths: p.stats.downs, carrying: p.carrying ?? null, ...p.stats,
      })),
    });
  }
}
