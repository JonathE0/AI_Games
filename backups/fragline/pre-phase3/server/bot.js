// Server-side practice bot: A* over a floor grid, CS-style stop-and-shoot with
// reaction time, turn speed and aim error that scale with difficulty.
import { WEAPONS } from '../shared/weapons.js';
import { MAP_BOXES, BOUNDS } from '../shared/map.js';
import { P, moveCharacter, rayWorld, traceBullet, hitboxes, dirFromAngles } from '../shared/physics.js';

const DIFF = {
  easy: { react: 0.65, sigma: 1.9, head: 0.12, turn: 220, burst: [4, 8], spray: 0.3, strafe: false, awp: false },
  medium: { react: 0.4, sigma: 1.0, head: 0.3, turn: 420, burst: [3, 5], spray: 0.18, strafe: true, awp: true },
  hard: { react: 0.25, sigma: 0.5, head: 0.5, turn: 720, burst: [2, 4], spray: 0.1, strafe: true, awp: true },
};

// ---- navigation grid (floor level only) ----
const NX = BOUNDS.maxX - BOUNDS.minX, NZ = BOUNDS.maxZ - BOUNDS.minZ;
const SOLID = MAP_BOXES.filter(b => b.mat !== 'f');
const cx = i => BOUNDS.minX + i + 0.5, cz = k => BOUNDS.minZ + k + 0.5;
const walk = new Uint8Array(NX * NZ);
for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) {
  const x = cx(i), z = cz(k);
  walk[i + k * NX] = SOLID.some(b => x + 0.5 > b.min[0] && x - 0.5 < b.max[0] && z + 0.5 > b.min[2] && z - 0.5 < b.max[2]) ? 0 : 1;
}
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const r3 = v => Math.round(v * 1000) / 1000;
const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(6.2832 * Math.random());

function nearestWalkable(x, z) {
  const i0 = clamp(Math.floor(x - BOUNDS.minX), 0, NX - 1), k0 = clamp(Math.floor(z - BOUNDS.minZ), 0, NZ - 1);
  for (let r = 0; r < 8; r++) for (let di = -r; di <= r; di++) for (let dk = -r; dk <= r; dk++) {
    if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
    const i = i0 + di, k = k0 + dk;
    if (i >= 0 && k >= 0 && i < NX && k < NZ && walk[i + k * NX]) return i + k * NX;
  }
  return -1;
}

function findPath(sx, sz, gx, gz) {
  const s = nearestWalkable(sx, sz), goal = nearestWalkable(gx, gz);
  if (s < 0 || goal < 0) return [];
  const N = NX * NZ, g = new Float32Array(N).fill(Infinity), f = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const gi = goal % NX, gk = (goal / NX) | 0;
  const h = n => { const di = Math.abs(n % NX - gi), dk = Math.abs(((n / NX) | 0) - gk); return Math.max(di, dk) + 0.414 * Math.min(di, dk); };
  g[s] = 0; f[s] = h(s);
  const open = [s];
  while (open.length) {
    let bi = 0;
    for (let j = 1; j < open.length; j++) if (f[open[j]] < f[open[bi]]) bi = j;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % NX, ck = (cur / NX) | 0;
    for (const [di, dk] of DIRS) {
      const ni = ci + di, nk = ck + dk;
      if (ni < 0 || nk < 0 || ni >= NX || nk >= NZ) continue;
      const n = ni + nk * NX;
      if (!walk[n] || closed[n]) continue;
      if (di && dk && (!walk[ci + di + ck * NX] || !walk[ci + (ck + dk) * NX])) continue;
      const ng = g[cur] + (di && dk ? 1.414 : 1);
      if (ng < g[n]) { g[n] = ng; from[n] = cur; f[n] = ng + h(n); open.push(n); }
    }
  }
  if (goal !== s && from[goal] < 0) return [];
  const path = [];
  for (let c = goal; c !== s && c >= 0; c = from[c]) path.push([cx(c % NX), cz((c / NX) | 0)]);
  return path.reverse();
}

function clearLine(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 0.01) return true;
  const d = [dx / len, 0, dz / len], nx = -d[2] * 0.38, nz = d[0] * 0.38;
  for (const s of [-1, 0, 1]) if (rayWorld([ax + nx * s, 0.3, az + nz * s], d, len, SOLID)) return false;
  return true;
}

function anglesTo(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
}

const SPOTS = [[-10, 12], [0, 15], [10, 11], [-20, 12], [20, -12], [-8, 0.5], [8, -0.5], [-10, -12],
  [0, -15], [10, -12], [-4, 9.5], [4, -9.5], [16, 4], [-16, -4], [22.5, 12], [-22.5, -12]];

export class Bot {
  constructor(room, p, diff) {
    this.room = room;
    this.p = p;
    this.d = DIFF[diff] || DIFF.medium;
    this.mag = {};
    this.onSpawn();
  }

  get weapon() { return WEAPONS[this.p.s1?.w || this.p.s2?.w || 'knife']; }
  get item() { return this.p.s1 || this.p.s2; }

  onSpawn() {
    Object.assign(this, {
      vel: [0, 0, 0], g: true, yaw: this.p.st.y, pitch: 0, path: [], goal: null, repathAt: 0,
      holdUntil: 0, holdYaw: this.p.st.y, lastKnown: null, lastKnownAt: -1e9, seenSince: 0, lastSeen: -1e9,
      nextShot: 0, burst: 0, burstLen: 3, reloadEnd: 0, strafeDir: 0, strafeUntil: 0, lastHp: 100,
      stuckT: 0, hunting: false,
    });
  }

  onRoundStart() {
    const p = this.p, buy = item => this.room.onBuy(p, item);
    if (!p.s1) {
      if (this.d.awp && p.money >= 5750 && Math.random() < 0.3) buy('awp');
      else if (p.money >= 3350) buy(p.side === 'T' ? 'ak47' : (Math.random() < 0.5 ? 'm4a4' : 'm4a1s'));
      else if (p.money >= 2450 && Math.random() < 0.5) buy('galil');
      else if (p.money >= 1900 && this.room.round % 6 !== 1) buy(Math.random() < 0.5 ? 'mp9' : 'mac10');
    }
    if (p.money >= 1000) buy('helmet');
    else if (p.money >= 650) buy('kevlar');
    if (!p.s1 && p.money >= 700 && Math.random() < 0.5) buy('deagle');
  }

  visible(eye, tgt) {
    const hb = hitboxes(tgt.st.c);
    for (const part of [8, 3, 2, 0]) {
      const q = [tgt.st.p[0], tgt.st.p[1] + hb[part].c[1], tgt.st.p[2]];
      const d = [q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]], len = Math.hypot(...d);
      if (!rayWorld(eye, d.map(v => v / len), len, SOLID)) return q;
    }
    return null;
  }

  startReload(t, w) {
    if (this.reloadEnd || w.cat === 'melee') return;
    this.reloadEnd = t + (w.shellReload ? w.reloadStart + w.reload * w.mag : w.reload);
    this.room.broadcast({ t: 'snd', id: this.p.id, s: 'reload', w: w.id });
  }

  update(dt, now) {
    const p = this.p, room = this.room, d = this.d, w = this.weapon, t = now / 1000;
    if (!p.alive) return;
    const pos = p.st.p;
    const eye = [pos[0], pos[1] + P.standEye, pos[2]];
    const tgt = room.opponent(p);
    const live = room.phase === 'live';
    const key = this.item?.uid;
    if (!(key in this.mag)) this.mag[key] = w.mag;
    if (this.reloadEnd && t >= this.reloadEnd) { this.mag[key] = w.mag; this.reloadEnd = 0; }

    // ---- perception ----
    let seePt = null;
    if (live && tgt?.alive) {
      seePt = this.visible(eye, tgt);
      const dx = tgt.st.p[0] - pos[0], dz = tgt.st.p[2] - pos[2], dist = Math.hypot(dx, dz);
      const inFov = Math.abs(wrap(Math.atan2(-dx, -dz) - this.yaw)) < 1.3;
      const hurt = p.hp < this.lastHp;
      if (seePt && !(inFov || dist < 4 || hurt || t - this.lastSeen < 1.5)) seePt = null;
      const loud = Math.hypot(tgt.st.v[0], tgt.st.v[2]) > 3.6 && tgt.st.g && dist < 20;
      if (seePt || hurt || loud) { this.lastKnown = [...tgt.st.p]; this.lastKnownAt = t; }
      this.lastHp = p.hp;
    }
    if (seePt) {
      if (t - this.lastSeen > 0.6) {
        this.seenSince = t;
        this.aimPart = Math.random() < d.head ? 8 : 3;
      }
      this.lastSeen = t;
    }

    // ---- aim ----
    let wantYaw = this.yaw, wantPitch = 0, wish = [0, 0];
    if (seePt) {
      const hb = hitboxes(tgt.st.c)[this.aimPart];
      [wantYaw, wantPitch] = anglesTo(eye, [tgt.st.p[0], tgt.st.p[1] + hb.c[1], tgt.st.p[2]]);
    } else if (this.lastKnown && t - this.lastKnownAt < 2.5) {
      [wantYaw, wantPitch] = anglesTo(eye, [this.lastKnown[0], this.lastKnown[1] + 1.4, this.lastKnown[2]]);
    }

    // ---- movement ----
    const canMove = live || room.phase === 'roundEnd';
    if (canMove && seePt) {
      if (d.strafe && t < this.strafeUntil) wish = [Math.cos(this.yaw) * this.strafeDir, -Math.sin(this.yaw) * this.strafeDir];
    } else if (canMove) {
      const hunt = this.lastKnown && t - this.lastKnownAt < 8;
      if (hunt && (!this.hunting || t > this.repathAt)) {
        this.goal = [this.lastKnown[0], this.lastKnown[2]];
        this.path = findPath(pos[0], pos[2], this.goal[0], this.goal[1]);
        this.hunting = true;
        this.repathAt = t + 1;
      } else if (!hunt && !this.goal && t > this.holdUntil) {
        const s = SPOTS[(Math.random() * SPOTS.length) | 0];
        this.goal = s;
        this.path = findPath(pos[0], pos[2], s[0], s[1]);
        this.hunting = false;
      }
      while (this.path.length > 1 && clearLine(pos[0], pos[2], this.path[1][0], this.path[1][1])) this.path.shift();
      const n = this.path[0];
      if (n && Math.hypot(n[0] - pos[0], n[1] - pos[2]) < 0.5) this.path.shift();
      if (this.path.length) {
        const [nx, nz] = this.path[0], len = Math.hypot(nx - pos[0], nz - pos[2]) || 1;
        wish = [(nx - pos[0]) / len, (nz - pos[2]) / len];
        if (!this.lastKnown || t - this.lastKnownAt > 2.5) wantYaw = Math.atan2(-wish[0], -wish[1]);
      } else if (this.goal) { // arrived: hold an angle toward the enemy for a moment
        if (this.hunting) this.lastKnown = null;
        this.goal = null;
        this.hunting = false;
        this.holdUntil = t + rand(1.5, 4);
        const es = tgt?.spawnPos || [0, 0, 0];
        this.holdYaw = Math.atan2(-(es[0] - pos[0]), -(es[2] - pos[2]));
      }
      if (!this.path.length && t < this.holdUntil && !(this.lastKnown && t - this.lastKnownAt < 2.5)) wantYaw = this.holdYaw;
    }
    const maxTurn = (d.turn * Math.PI / 180) * dt;
    this.yaw = wrap(this.yaw + clamp(wrap(wantYaw - this.yaw), -maxTurn, maxTurn));
    this.pitch += clamp(wantPitch - this.pitch, -maxTurn, maxTurn);

    const k = Math.min(1, dt * 12);
    this.vel[0] += (wish[0] * w.speed - this.vel[0]) * k;
    this.vel[2] += (wish[1] * w.speed - this.vel[2]) * k;
    this.vel[1] -= P.gravity * dt;
    const before = [pos[0], pos[2]];
    this.g = moveCharacter(pos, this.vel, dt, P.standH, MAP_BOXES, this.g);
    const moved = Math.hypot(pos[0] - before[0], pos[2] - before[1]);
    if (Math.hypot(...wish) > 0.5 && moved < w.speed * dt * 0.2) {
      if ((this.stuckT += dt) > 0.8) { this.goal = null; this.path = []; this.holdUntil = 0; this.stuckT = 0; }
    } else this.stuckT = 0;

    // ---- shooting ----
    if (seePt && live && !this.reloadEnd && t >= this.nextShot && t - this.seenSince >= d.react * rand(0.8, 1.25)) {
      const err = Math.hypot(wrap(wantYaw - this.yaw), wantPitch - this.pitch);
      const hspd = Math.hypot(this.vel[0], this.vel[2]);
      if (err < 0.06 && (hspd < w.speed * 0.34 || w.cat === 'smg' || w.cat === 'shotgun')) this.fire(eye, tgt, w, t, key);
    }
    if (!seePt && !this.reloadEnd && this.mag[key] < w.mag * 0.4 && t - this.lastSeen > 2) this.startReload(t, w);

    p.st = { p: pos.map(r3), v: this.vel.map(r3), y: r3(this.yaw), pi: r3(this.pitch), c: 0, w: w.id, g: this.g };
    room.broadcast({ t: 'st', id: p.id, ...p.st, ts: now });
  }

  fire(eye, tgt, w, t, key) {
    if (this.mag[key] <= 0) return this.startReload(t, w);
    this.mag[key]--;
    const d = this.d;
    const sig = d.sigma * (1 + this.burst * d.spray) * (w.cat === 'sniper' ? 0.6 : 1) * Math.PI / 180;
    const target = { x: tgt.st.p[0], y: tgt.st.p[1], z: tgt.st.p[2], yaw: tgt.st.y, c: tgt.st.c };
    const dirs = [], ends = [], hits = [];
    for (let i = 0; i < w.pellets; i++) {
      let yaw = this.yaw + gauss() * sig, pitch = this.pitch + gauss() * sig;
      if (w.pellets > 1) {
        const a = Math.random() * 6.2832, r = Math.random() * w.pelletSpread * Math.PI / 180;
        yaw += Math.cos(a) * r; pitch += Math.sin(a) * r;
      }
      const dir = dirFromAngles(yaw, pitch);
      const tr = traceBullet(eye, dir, 300, MAP_BOXES, target, w.wallPen);
      dirs.push(dir.map(r3));
      ends.push(eye.map((v, j) => r3(v + dir[j] * tr.endT)));
      if (tr.player) hits.push(tr.player);
    }
    this.room.broadcast({ t: 'shot', id: this.p.id, w: w.id, o: eye.map(r3), d: dirs, e: ends });
    if (hits.length) this.room.applyHits(this.p, tgt, w, hits);
    this.burst++;
    const interval = 60 / w.rpm;
    if (w.auto && this.burst < this.burstLen) this.nextShot = t + interval;
    else {
      this.burst = 0;
      this.burstLen = Math.round(rand(d.burst[0], d.burst[1]));
      this.nextShot = t + Math.max(interval, w.auto ? rand(0.3, 0.55) : rand(0.25, 0.6));
      if (d.strafe && Math.random() < 0.6) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeUntil = t + rand(0.2, 0.45);
      }
    }
    if (this.mag[key] <= 0) this.startReload(t, w);
  }
}
