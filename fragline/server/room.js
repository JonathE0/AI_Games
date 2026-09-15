// One 1v1 match: round flow, economy, damage and buy validation. Server-authoritative for
// health/money/inventory; clients report their own movement and hit claims.
import { WEAPONS, GEAR, ECON, DEFAULT_PISTOL, computeDamage } from '../shared/weapons.js';
import { BUY_RADIUS } from '../shared/map.js';
import { modeOf } from '../shared/modes.js';
import { mapOf } from '../shared/maps.js';
import { Bot } from './bot.js';
import { BaseRoom, nextUid } from './baseRoom.js';

export const RULES = {
  winRounds: 7, halfAfter: 6, freeze: 10000, roundTime: 90000, roundEnd: 5000,
  matchEnd: 12000, buyGrace: 15000, startDelay: 3000, warmupRespawn: 2000,
};
export const PARTS = new Set(['head', 'chest', 'arm', 'stomach', 'legs']);

export class Room extends BaseRoom {
  constructor(code, opts = {}) {
    super();
    this.code = code;
    this.mode = modeOf(opts.gameMode);
    this.rules = { ...RULES, ...this.mode.rules };
    this.spawns = mapOf(this.mode.map).spawns;
    this.vsBot = !!opts.bot;
    this.diff = opts.diff || 'medium';
    this.players = [];
    this.phase = 'warmup';
    this.phaseEnd = 0;
    this.round = 0;
    this.liveStart = 0;
    this.bot = null;
  }

  isFull() { return this.players.length >= 2; }
  opponent(p) { return this.players.find(q => q !== p); }
  hasWeapon(p, w) { return w === 'knife' || p.s1?.w === w || p.s2?.w === w; }

  makePlayer(name, ws, bot = false) {
    const side = this.players.some(q => q.side === 'T') ? 'CT' : 'T';
    return {
      id: bot ? 'bot' : 'p' + nextUid(), name, ws, bot, side,
      hp: 100, armor: 0, helmet: false, money: ECON.start, alive: false,
      s1: null, s2: this.newItem(DEFAULT_PISTOL[side]),
      score: 0, kills: 0, deaths: 0, dmgTotal: 0, lossStreak: 0,
      st: { p: [0, 0, 0], v: [0, 0, 0], y: 0, pi: 0, c: 0, w: DEFAULT_PISTOL[side], g: true },
      lastShot: {}, report: null, ping: 0, respawnAt: 0, spawnPos: null,
    };
  }

  addPlayer(ws, name) {
    const p = this.makePlayer(name, ws);
    this.players.push(p);
    this.send(p, { t: 'welcome', id: p.id, code: this.code, bot: this.vsBot, rules: this.rules, gameMode: this.mode.id });
    if (this.vsBot && !this.bot) {
      const bp = this.makePlayer('BOT ' + this.diff.toUpperCase(), null, true);
      this.players.push(bp);
      this.bot = new Bot(this, bp, this.diff);
    }
    if (this.players.length === 2) this.startMatch();
    else this.enterWarmup();
    this.broadcastRoster();
    return p;
  }

  removePlayer(p) {
    this.players = this.players.filter(q => q !== p && !q.bot);
    this.bot = null;
    this.broadcast({ t: 'msg', text: `${p.name} left the match` });
    if (this.players.length === 1) this.enterWarmup();
    this.broadcastRoster();
  }

  enterWarmup() {
    this.phase = 'warmup';
    this.phaseEnd = 0;
    this.round = 0;
    for (const p of this.players) { p.money = ECON.warmup; p.score = 0; this.spawn(p); }
    this.broadcastPhase();
  }

  startMatch() {
    this.round = 0;
    for (const p of this.players) {
      Object.assign(p, { score: 0, kills: 0, deaths: 0, dmgTotal: 0, lossStreak: 0, money: ECON.start, alive: false });
      this.sendInv(p);
    }
    this.phase = 'starting';
    this.phaseEnd = Date.now() + this.rules.startDelay;
    this.broadcastPhase();
    this.broadcast({ t: 'msg', text: `Match starting — first to ${this.rules.winRounds} rounds` });
  }

  startRound() {
    this.round++;
    this.phase = 'freeze';
    this.phaseEnd = Date.now() + this.rules.freeze;
    for (const p of this.players) {
      if (!p.alive) { // dying loses your gear, CS-style
        p.s1 = null; p.s2 = this.newItem(DEFAULT_PISTOL[p.side]); p.armor = 0; p.helmet = false;
      }
      p.report = { given: { dmg: 0, hits: 0 }, taken: { dmg: 0, hits: 0 } };
      this.spawn(p);
    }
    this.broadcastPhase();
    this.broadcastRoster();
    this.bot?.onRoundStart();
  }

  spawn(p) {
    const sp = this.spawns[p.side === 'T' ? 'A' : 'B'];
    const pos = [sp.x + (Math.random() - 0.5) * 2, 0, sp.z + (Math.random() - 0.5) * 6];
    // face the nearer exit around the spawn shield instead of staring at it
    const dir = Math.sign(-sp.x), ex = sp.x + dir * 6, ez = (pos[2] >= 0 ? 7 : -7);
    const yaw = this.mode.map === 'lake' ? sp.yaw : Math.atan2(-(ex - pos[0]), -(ez - pos[2]));
    if (!p.alive) { // respawning after a death: every gun is a brand-new copy with full ammo
      if (p.s1) p.s1 = this.newItem(p.s1.w);
      if (p.s2) p.s2 = this.newItem(p.s2.w);
    }
    if (this.mode.loadout) {
      p.s1 = this.newItem(this.mode.loadout); p.s2 = null;
      p.armor = this.mode.armor ? 100 : 0; p.helmet = !!this.mode.armor;
      p.st.w = this.mode.loadout; p.lastShot = {};
    }
    p.hp = 100;
    p.alive = true;
    p.respawnAt = 0;
    p.spawnPos = pos;
    p.st = { ...p.st, p: pos, v: [0, 0, 0], y: yaw, pi: 0, c: 0 };
    this.broadcast({ t: 'spawn', id: p.id, pos, yaw });
    this.sendInv(p);
    if (p.bot) this.bot?.onSpawn();
  }

  update(now, dt) {
    if (this.phase === 'starting' && now >= this.phaseEnd) this.startRound();
    else if (this.phase === 'freeze' && now >= this.phaseEnd) {
      this.phase = 'live';
      this.liveStart = now;
      this.phaseEnd = now + this.rules.roundTime;
      this.broadcastPhase();
    } else if (this.phase === 'live' && now >= this.phaseEnd) this.timeout();
    else if (this.phase === 'roundEnd' && now >= this.phaseEnd) this.afterRound();
    else if (this.phase === 'matchEnd' && now >= this.phaseEnd) {
      if (this.players.length === 2) this.startMatch(); else this.enterWarmup();
    }
    if (this.phase === 'warmup') {
      for (const p of this.players) if (!p.alive && p.respawnAt && now >= p.respawnAt) this.spawn(p);
    }
    this.bot?.update(dt, now);
  }

  // Time ran out: more HP wins, ties go to CT.
  timeout() {
    const alive = this.players.filter(p => p.alive);
    let winner;
    if (alive.length === 2) {
      winner = alive[0].hp === alive[1].hp ? alive.find(p => p.side === 'CT')
        : (alive[0].hp > alive[1].hp ? alive[0] : alive[1]);
    } else winner = alive[0] || this.players.find(p => p.side === 'CT');
    this.endRound(winner, 'time');
  }

  endRound(winner, reason) {
    if (this.phase !== 'live' && this.phase !== 'freeze') return;
    this.phase = 'roundEnd';
    this.phaseEnd = Date.now() + this.rules.roundEnd;
    for (const p of this.players) {
      if (p === winner) { p.score++; p.money += ECON.win; p.lossStreak = Math.max(0, p.lossStreak - 1); }
      else { p.money += ECON.lossBonus[Math.min(p.lossStreak, 4)]; p.lossStreak++; }
      p.money = Math.min(ECON.max, p.money);
    }
    const score = Object.fromEntries(this.players.map(p => [p.id, p.score]));
    for (const p of this.players) {
      const opp = this.opponent(p);
      this.send(p, { t: 'roundEnd', winner: winner?.id, reason, score, report: p.report, oppHp: opp?.alive ? opp.hp : 0 });
      this.sendInv(p);
    }
    this.broadcastPhase();
    this.broadcastRoster();
  }

  afterRound() {
    const champ = this.players.find(p => p.score >= this.rules.winRounds);
    if (champ) {
      this.phase = 'matchEnd';
      this.phaseEnd = Date.now() + this.rules.matchEnd;
      this.broadcast({ t: 'matchEnd', winner: champ.id });
      this.broadcastPhase();
      return;
    }
    if (this.round === this.rules.halfAfter) {
      for (const p of this.players) {
        p.side = p.side === 'T' ? 'CT' : 'T';
        Object.assign(p, { money: ECON.start, s1: null, armor: 0, helmet: false, lossStreak: 0, alive: false });
      }
      this.broadcast({ t: 'msg', text: 'Halftime — switching sides, economy reset' });
    }
    this.startRound();
  }

  handle(p, m) {
    switch (m.t) {
      case 'shot': return this.onShot(p, m);
      case 'buy': return this.onBuy(p, String(m.item));
      default: this.handleCommon(p, m);
    }
  }

  onShot(p, m) {
    const w = WEAPONS[m.w];
    if (!w || !p.alive || !this.hasWeapon(p, m.w)) return;
    if (!['live', 'warmup', 'roundEnd'].includes(this.phase)) return;
    const now = Date.now();
    const gap = (w.cat === 'melee' ? (m.alt ? 900 : 350) : 60000 / w.rpm) * 0.7;
    if (now - (p.lastShot[m.w] || 0) < gap) return; // faster than the gun can fire
    p.lastShot[m.w] = now;
    this.broadcast({ t: 'shot', id: p.id, w: m.w, o: m.o, d: m.d, e: m.e, alt: !!m.alt }, p);
    const target = this.opponent(p);
    if (!target?.alive || !Array.isArray(m.h) || !m.h.length) return;
    const hits = m.h.slice(0, w.pellets).filter(h => h && PARTS.has(h.part)).map(h => ({
      part: h.part, pen: Number.isFinite(+h.pen) ? Math.min(1, Math.max(0, +h.pen)) : 1,
    }));
    this.applyHits(p, target, w, hits, { alt: !!m.alt });
  }

  applyHits(att, vic, w, hits, opts = {}) {
    if (!vic.alive || !hits.length) return;
    const a = att.st.p, b = vic.st.p;
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let back = false;
    if (w.cat === 'melee') {
      if (dist > w.reach + 1.5) return;
      const fx = -Math.sin(vic.st.y), fz = -Math.cos(vic.st.y);
      const dx = a[0] - b[0], dz = a[2] - b[2];
      back = fx * dx + fz * dz < -0.3 * Math.hypot(dx, dz); // attacker is behind the victim
    }
    let total = 0, armorLoss = 0, hs = false, part = hits[0].part;
    for (const h of hits) {
      const r = computeDamage(w, h.part, dist, vic.armor - armorLoss, vic.helmet, h.pen, { alt: opts.alt, back });
      total += r.hp;
      armorLoss += r.armor;
      if (h.part === 'head') { hs = true; part = 'head'; }
    }
    vic.armor = Math.max(0, vic.armor - armorLoss);
    const dealt = Math.min(total, vic.hp);
    vic.hp -= total;
    att.dmgTotal += dealt;
    if (att.report) { att.report.given.dmg += dealt; att.report.given.hits += hits.length; }
    if (vic.report) { vic.report.taken.dmg += dealt; vic.report.taken.hits += hits.length; }
    this.broadcast({
      t: 'dmg', att: att.id, vic: vic.id, dmg: dealt, hp: Math.max(0, vic.hp), armor: vic.armor,
      part, w: w.id, helm: hs && vic.helmet, back, from: a,
    });
    if (vic.hp <= 0) this.kill(att, vic, w, hs && w.cat !== 'melee', hits.some(h => h.pen < 0.999));
  }

  kill(att, vic, w, hs, wallbang) {
    vic.alive = false;
    vic.hp = 0;
    vic.deaths++;
    att.kills++;
    if (this.phase !== 'warmup') att.money = Math.min(ECON.max, att.money + w.reward);
    this.broadcast({ t: 'kill', killer: att.id, victim: vic.id, w: w.id, hs, wb: wallbang });
    this.sendInv(att);
    this.sendInv(vic);
    if (this.phase === 'warmup') vic.respawnAt = Date.now() + this.rules.warmupRespawn;
    else if (this.phase === 'live') this.endRound(att, 'elim');
    this.broadcastRoster();
  }

  inBuyZone(p) {
    const sp = p.spawnPos;
    return !!sp && Math.hypot(p.st.p[0] - sp[0], p.st.p[2] - sp[2]) < BUY_RADIUS;
  }

  canBuy(p) {
    if (!p.alive || !this.mode.buy) return false;
    if (this.phase === 'warmup' || this.phase === 'freeze') return true;
    return this.phase === 'live' && Date.now() - this.liveStart < this.rules.buyGrace && this.inBuyZone(p);
  }

  onBuy(p, item) {
    const deny = text => this.send(p, { t: 'deny', text });
    if (!this.canBuy(p)) return deny(p.alive ? 'Buy time is over (or you left the buy zone)' : 'You are dead');
    const warm = this.phase === 'warmup';
    let cost;
    if (item === 'kevlar') {
      if (p.armor >= 100) return deny('Already wearing Kevlar');
      cost = GEAR.kevlar.price;
    } else if (item === 'helmet') {
      if (p.armor >= 100 && p.helmet) return deny('Already wearing Kevlar + Helmet');
      cost = p.armor >= 100 ? GEAR.helmet.upgrade : GEAR.helmet.price;
    } else {
      const w = WEAPONS[item];
      if (!w || w.cat === 'melee') return;
      if ((w.slot === 1 ? p.s1 : p.s2)?.w === item) return deny(`Already carrying the ${w.name}`);
      cost = w.price;
    }
    if (!warm && p.money < cost) return deny('Not enough money');
    if (!warm) p.money -= cost;
    if (item === 'kevlar') p.armor = 100;
    else if (item === 'helmet') { p.armor = 100; p.helmet = true; }
    else if (WEAPONS[item].slot === 1) p.s1 = this.newItem(item);
    else p.s2 = this.newItem(item);
    this.sendInv(p);
    this.send(p, { t: 'bought', item });
  }

  sendInv(p) {
    this.send(p, {
      t: 'inv', money: p.money, armor: p.armor, helmet: p.helmet, hp: p.hp,
      alive: p.alive, s1: p.s1, s2: p.s2, side: p.side,
    });
  }

  broadcastRoster() {
    this.broadcast({
      t: 'roster', players: this.players.map(p => ({
        id: p.id, name: p.name, side: p.side, score: p.score, kills: p.kills, deaths: p.deaths,
        dmg: p.dmgTotal, ping: p.ping, bot: p.bot, alive: p.alive,
      })), round: this.round,
    });
  }

  broadcastPhase() {
    this.broadcast({
      t: 'phase', phase: this.phase, endsIn: Math.max(0, this.phaseEnd - Date.now()),
      round: this.round, winTo: this.rules.winRounds, buyGrace: this.rules.buyGrace,
    });
  }
}
