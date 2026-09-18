// Zombie brains, stepped by the Holdout room at a fixed 20 Hz: follow the Core flow field, aggro onto
// players they can see, smash pieces in the way (or the ones holding a player up), telegraph every
// swing so it can be dodged, and — Spitters — lob acid over walls from range.
import { P, moveCharacter, rayWorld } from '../../shared/physics.js';
import { distToBox, boxCenter } from '../../shared/build.js';
import { AGGRO } from '../../shared/zombies.js';
import { SURVIVOR_CLASSES } from '../../shared/holdout.js';
import { stepSniper, tryBurrow, stepBurrow, onMeleeHit } from './behaviors.js';
import { stepFlyer } from './flyers.js';

export const ZS = { MOVE: 0, WIND: 1, STRIKE: 2, LOB: 3 }; // also the animation state sent to clients
export const GLOB_GRAVITY = 12;
const TURN = 7;          // rad/s
const SEP = 0.95;        // personal space between zombies (scaled by size)
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const hkey = (x, z) => (Math.floor(x / 2) + 64) * 256 + (Math.floor(z / 2) + 64);
// Is box b roughly ahead (within ~60°) on the way from pos to goal?
function inFront(pos, goal, b) {
  const px = Math.max(b.min[0], Math.min(b.max[0], pos[0])) - pos[0], pz = Math.max(b.min[2], Math.min(b.max[2], pos[2])) - pos[2];
  const gx = goal[0] - pos[0], gz = goal[1] - pos[2], lp = Math.hypot(px, pz), lg = Math.hypot(gx, gz);
  return lp < 1e-3 || lg < 1e-3 || (px * gx + pz * gz) / (lp * lg) > 0.5;
}
const nearBoxes = [], projBoxes = [];

export function updateZombies(room, dt, now) {
  const hash = new Map();
  for (const z of room.zombies.values()) {
    const k = hkey(z.pos[0], z.pos[2]);
    let list = hash.get(k);
    if (!list) hash.set(k, list = []);
    list.push(z);
  }
  for (const z of [...room.zombies.values()]) if (!z.dead) step(room, z, dt, now, hash);
}

function think(room, z, now) {
  if (z.t.noAggro || z.berserk || now < z.aggroBlock) { z.aggro = null; return; } // Core Seekers/berserk stragglers never chase players — they beeline for the Core
  const t = z.t, pos = z.pos, eye = [pos[0], pos[1] + 1.6 * z.s, pos[2]];
  let best = null, bd = t.ranged ? t.range : (t.aggro ?? AGGRO) + (now - z.hurtAt < 3000 ? 8 : 0);
  for (const p of room.targets()) { // players and survivors
    if (!p.alive || p.downed) continue;
    const pp = p.st.p, raw = Math.hypot(pp[0] - pos[0], pp[2] - pos[2]);
    const d = p.isSurvivor && p.cls === 'guardian' ? raw * SURVIVOR_CLASSES.guardian.aggroMult : raw; // Guardians draw zombies
    if (d >= bd) continue;
    if (!t.ranged && !room.lineOfSight(eye, [pp[0], pp[1] + 1.4, pp[2]])) continue;
    best = p;
    bd = d;
  }
  z.aggro = best;
}

// What a Spitter shells: a player in range, else the Core, else the first piece on its path.
function lobTarget(room, z) {
  const t = z.t, pos = z.pos;
  if (z.aggro) { const pp = z.aggro.st.p; return { kind: 'p', ref: z.aggro, p: [pp[0], pp[1] + 0.9, pp[2]] }; }
  const c = room.map.core;
  if (Math.hypot(c.x - pos[0], c.z - pos[2]) <= t.range) return { kind: 'c', p: [c.x, 1.6, c.z] };
  const sid = room.flow.pieceAhead(pos[0], pos[2], 16);
  const s = sid >= 0 ? room.pieces.get(sid) : null;
  if (s) {
    const p = boxCenter(s.box);
    if (Math.hypot(p[0] - pos[0], p[2] - pos[2]) <= t.range) return { kind: 's', ref: s, p };
  }
  return null;
}

function step(room, z, dt, now, hash) {
  const t = z.t, pos = z.pos;
  z.hist.push(now, pos[0], pos[1], pos[2]);
  if (z.hist.length > 36) z.hist.splice(0, 4);
  if (z.under) { stepBurrow(room, z, now); return; } // tunnelling
  if (now < z.frozenUntil) { // freeze grenade: stuck in place, swing interrupted
    z.vel[0] = z.vel[2] = 0;
    z.state = ZS.MOVE;
    z.target = null;
    z.nextAtk = Math.max(z.nextAtk, z.frozenUntil + 300);
    return;
  }
  if (z.knock) { // flung by a Shockwave Blaster (or pulled/pushed by a boss weapon perk): flies until it
    const kn = z.knock, elapsed = (now - kn.t0) / 1000, remain = kn.dist - kn.traveled; // hits something solid or runs out of distance
    if (remain <= 0.03 || elapsed > 3) z.knock = null;
    else {
      const speed = kn.speed0 * (1 - 0.3 * Math.min(1, elapsed / 1.2)), step = Math.min(speed * dt, remain);
      z.vel[0] = (kn.ux * step) / dt; z.vel[2] = (kn.uz * step) / dt;
      z.vel[1] -= P.gravity * dt;
      const bx = pos[0], bz = pos[2];
      z.g = moveCharacter(pos, z.vel, dt, 1.8 * z.s, room.grid.query(pos[0] - 2, pos[2] - 2, pos[0] + 2, pos[2] + 2, nearBoxes), z.g);
      const moved = Math.hypot(pos[0] - bx, pos[2] - bz);
      kn.traveled += moved;
      if (step > 0.03 && moved < step * 0.4) { // hit something solid: a slam, unless the perk that threw it says otherwise
        if (!kn.noSlam) {
          const frac = Math.max(0.4, speed / kn.speed0);
          room.damageZombie(z, Math.round((35 + kn.dmgHit * 0.45) * frac), room.players.find(pl => pl.id === kn.by) ?? null, 'kinetic');
          z.stunUntil = now + 1000;
          room.broadcast({ t: 'slam', p: [Math.round(pos[0] * 100) / 100, Math.round(pos[1] * 100) / 100, Math.round(pos[2] * 100) / 100] });
        }
        z.knock = null;
      } else if (kn.traveled >= kn.dist - 0.03) z.knock = null;
      if (pos[1] < -4) room.removeZombie(z, true);
      if (z.knock) return; // still flying
    }
  }
  if (now < (z.stunUntil || 0)) { // stunned (just slammed, or the Alpha Cleaver's knockdown): no moving or attacking
    z.vel[0] = z.vel[2] = 0;
    z.state = ZS.MOVE;
    z.target = null;
    z.nextAtk = Math.max(z.nextAtk, z.stunUntil + 200);
    return;
  }
  if (z.mount) return room.bosses.stepRider(z, dt, now); // riding the Brood Titan
  if (t.flyer) return stepFlyer(room, z, dt, now); // Swooper / Sky Sniper: airborne, ignores the ground flow field
  if (t.sniper) return stepSniper(room, z, dt, now);
  if (now >= z.thinkAt) { z.thinkAt = now + 200 + Math.random() * 150; think(room, z, now); }

  let goal = null, attack = null, face = null;
  const body = [pos[0], pos[1] + 0.9, pos[2]];
  if (z.state === ZS.MOVE) {
    if (t.ranged) {
      const tg = lobTarget(room, z);
      if (tg) {
        face = tg.p;
        const dh = Math.hypot(tg.p[0] - pos[0], tg.p[2] - pos[2]);
        if (tg.kind === 'p' && dh < t.keep) goal = [pos[0] - (tg.p[0] - pos[0]), pos[2] - (tg.p[2] - pos[2])]; // back off
        else if (now >= z.nextAtk) { z.state = ZS.LOB; z.stateEnd = now + t.windup * 1000; z.target = tg; }
      }
    } else if (z.aggro) {
      const pp = z.aggro.st.p, dh = Math.hypot(pp[0] - pos[0], pp[2] - pos[2]), dy = pp[1] - pos[1];
      if (dy > 1.3) { // up on a build: smash what holds them up, else get underneath
        const s = room.pieceNear(pos, t.reach + 0.6);
        if (s && dh < 5) attack = { kind: 's', ref: s };
        else goal = [pp[0], pp[2]];
      } else if (dh <= t.reach && dy > -1.2) attack = { kind: 'p', ref: z.aggro };
      else goal = [pp[0], pp[2]];
    }
    if (!attack && !goal && !face) { // head for the Core (Spitters too, until something is in range)
      if (distToBox(body, room.coreBase) <= t.reach) attack = { kind: 'c' };
      else {
        const st = t.breaker ? room.flow.bstep(pos[0], pos[2]) : room.flow.step(pos[0], pos[2]);
        if (st) {
          // only smash the piece the path goes through, not ones it merely walks past
          const s = st.sid >= 0 ? room.pieces.get(st.sid) : null;
          if (s && distToBox(body, s.box) <= t.reach && t.burrow && !z.burrowed && tryBurrow(room, z, [st.x, st.z], now, s)) return;
          if (s && distToBox(body, s.box) <= t.reach) attack = { kind: 's', ref: s };
          else goal = [st.x, st.z];
        }
      }
    }
    if (!attack && !face && z.stuck > 0.8 && goal) { // blocked by a piece right in front: hit it (or dig under it)
      if (t.burrow && !z.burrowed && tryBurrow(room, z, goal, now)) return;
      // breakers also check overhead — a floor or ramp pinning them down counts as "in the way" too
      const s = room.pieceNear(pos, t.reach, false, t.breaker ? t.reach + 1.8 * z.s : 1.5);
      if (s && inFront(pos, goal, s.box)) attack = { kind: 's', ref: s };
    }
    if (attack) {
      goal = null;
      if (now >= z.nextAtk) { z.state = ZS.WIND; z.stateEnd = now + t.windup * 1000; z.target = attack; }
    }
  }

  if (z.state === ZS.WIND && now >= z.stateEnd) {
    strike(room, z);
    z.state = ZS.STRIKE; z.stateEnd = now + 250; z.nextAtk = now + t.cooldown * 1000;
  } else if (z.state === ZS.LOB && now >= z.stateEnd) {
    launch(room, z);
    z.state = ZS.STRIKE; z.stateEnd = now + 300; z.nextAtk = now + t.cooldown * 1000;
  } else if (z.state === ZS.STRIKE && now >= z.stateEnd) z.state = ZS.MOVE;
  if (z.dead) return;

  // facing: the thing being attacked, else where it walks
  const tg = z.target;
  if (z.state !== ZS.MOVE && tg) {
    face = tg.kind === 'p' ? tg.ref.st.p : tg.kind === 'c' ? [room.map.core.x, 0, room.map.core.z] : tg.p ?? boxCenter(tg.ref.box);
  }
  let wx = 0, wz = 0;
  if (goal && z.state === ZS.MOVE) {
    const dx = goal[0] - pos[0], dz = goal[1] - pos[2], l = Math.hypot(dx, dz);
    if (l > 0.05) { wx = dx / l; wz = dz / l; }
    if (!face) face = [goal[0], 0, goal[1]];
  }
  if (face) {
    const want = Math.atan2(-(face[0] - pos[0]), -(face[2] - pos[2]));
    const d = wrap(want - z.yaw), mt = TURN * dt;
    z.yaw = wrap(z.yaw + Math.max(-mt, Math.min(mt, d)));
  }

  // separation from nearby zombies
  let sx = 0, sz = 0;
  const hi = Math.floor(pos[0] / 2), hk = Math.floor(pos[2] / 2);
  for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) {
    const list = hash.get((hi + i + 64) * 256 + hk + k + 64);
    if (list) for (const o of list) {
      if (o === z || o.dead) continue;
      const dx = pos[0] - o.pos[0], dz = pos[2] - o.pos[2], d2 = dx * dx + dz * dz, r = SEP * (z.s + o.s) / 2;
      if (d2 < r * r && d2 > 1e-8) { const d = Math.sqrt(d2), f = (r - d) / r; sx += (dx / d) * f; sz += (dz / d) * f; }
    }
  }
  wx += sx * 1.2; wz += sz * 1.2;
  const wl = Math.hypot(wx, wz);
  if (wl > 1.3) { wx *= 1.3 / wl; wz *= 1.3 / wl; }

  const speed = z.state === ZS.MOVE ? t.speed * (z.spd ?? 1) * (now < z.slowUntil ? 1 - z.slow : 1) : 0;
  if (now >= z.slowUntil) z.slow = 0;
  const k = Math.min(1, dt * 8);
  z.vel[0] += (wx * speed - z.vel[0]) * k;
  z.vel[2] += (wz * speed - z.vel[2]) * k;
  z.vel[1] -= P.gravity * dt;
  const bx = pos[0], bz = pos[2];
  const boxes = room.grid.query(pos[0] - 1.5, pos[2] - 1.5, pos[0] + 1.5, pos[2] + 1.5, nearBoxes);
  z.g = moveCharacter(pos, z.vel, dt, 1.8 * z.s, boxes, z.g);
  const moved = Math.hypot(pos[0] - bx, pos[2] - bz), want = Math.min(1, Math.hypot(wx, wz)) * speed * dt;
  if (want > 0.02 && moved < want * 0.25) z.stuck += dt; else z.stuck = Math.max(0, z.stuck - dt * 2);
  if (z.stuck > 2.5 && z.aggro) { z.aggroBlock = now + 2500; z.aggro = null; z.stuck = 0; } // can't get there: back to the path
  if (pos[1] < -4) room.removeZombie(z, true);
}

function strike(room, z) {
  const a = z.target, t = z.t, mul = room.director.dmgMul * (z.dmgMul ?? 1);
  z.target = null;
  if (!a) return;
  if (t.stomp) { // the Titan's stomp flattens everything around its feet
    for (const p of room.targets()) if (p.alive && !p.downed && Math.hypot(p.st.p[0] - z.pos[0], p.st.p[2] - z.pos[2]) <= t.stomp && p.st.p[1] - z.pos[1] < 3) room.hurtPlayer(p, t.dmg * mul, z);
    for (const s of room.builds()) if (distToBox([z.pos[0], z.pos[1] + 1, z.pos[2]], s.box) <= t.stomp) room.damagePiece(s, t.sdmg * mul * 0.5, z);
    room.broadcast({ t: 'stomp', p: [Math.round(z.pos[0] * 100) / 100, 0, Math.round(z.pos[2] * 100) / 100], r: t.stomp });
    if (a.kind === 'c') room.damageCore(t.sdmg * mul, z); else if (a.kind === 's' && room.pieces.get(a.ref.id) === a.ref) room.damagePiece(a.ref, t.sdmg * mul, z);
    return;
  }
  if (a.kind === 'p') {
    const p = a.ref, pp = p.st.p, dh = Math.hypot(pp[0] - z.pos[0], pp[2] - z.pos[2]), dy = pp[1] - z.pos[1];
    if (p.alive && !p.downed && dh <= t.reach + 0.5 && dy > -1.2 && dy < 1.8 * z.s) { room.hurtPlayer(p, t.dmg * mul, z); onMeleeHit(room, z, p); }
  } else if (a.kind === 's') {
    if (room.pieces.get(a.ref.id) === a.ref) {
      room.damagePiece(a.ref, t.sdmg * mul, z);
      if (t.breaker) {
        breakerSplash(room, a.ref, t.sdmg * mul, z); // smashes through: 40% splash to nearby pieces, no reductions
        const c = boxCenter(a.ref.box);
        room.broadcast({ t: 'gsmash', p: [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100, Math.round(c[2] * 100) / 100] });
      }
    }
  } else room.damageCore(t.cdmg ?? t.sdmg * mul, z); // Core Seeker: a fixed amount per hit, unscaled by wave difficulty
}

// Wall breakers (Iron Golem): the piece it hits takes full sdmg; other pieces within range take 40% of that,
// also unreduced.
function breakerSplash(room, hit, dmg, z) {
  const c = boxCenter(hit.box), splash = dmg * 0.4;
  for (const s of room.pieces.values()) if (s !== hit && distToBox(c, s.box) <= 2.5) room.damagePiece(s, splash, z);
}

// Acid glob on a ballistic arc toward where the target is now.
function launch(room, z) {
  const tg = z.target;
  z.target = null;
  if (!tg) return;
  let p = tg.p;
  if (tg.kind === 'p') { const pp = tg.ref.st.p; p = [pp[0], pp[1] + 0.9, pp[2]]; }
  const o = [z.pos[0], z.pos[1] + 1.5 * z.s, z.pos[2]];
  const dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2], dh = Math.hypot(dx, dz);
  const T = Math.min(1.8, Math.max(0.7, dh / 11));
  room.addProjectile(o, [dx / T, dy / T + 0.5 * GLOB_GRAVITY * T, dz / T], z, z.t.potion ? 'ink' : 'acid');
}

const segPointDist = (a, b, c) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = l2 > 0 ? Math.max(0, Math.min(1, (ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2]) / l2)) : 0;
  return Math.hypot(ac[0] - ab[0] * t, ac[1] - ab[1] * t, ac[2] - ab[2] * t);
};

export function updateProjectiles(room, dt, now) {
  for (let i = room.proj.length - 1; i >= 0; i--) {
    const pr = room.proj[i], a = [...pr.pos];
    pr.vel[1] -= GLOB_GRAVITY * dt;
    for (let j = 0; j < 3; j++) pr.pos[j] += pr.vel[j] * dt;
    const b = pr.pos, d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d);
    let hit = null;
    for (const p of room.targets()) {
      if (!p.alive || p.downed) continue;
      const pp = p.st.p;
      if (segPointDist(a, b, [pp[0], pp[1] + 0.9, pp[2]]) < 0.7) { hit = [...b]; break; }
    }
    if (!hit && len > 1e-6) {
      const boxes = room.grid.query(Math.min(a[0], b[0]) - 0.5, Math.min(a[2], b[2]) - 0.5, Math.max(a[0], b[0]) + 0.5, Math.max(a[2], b[2]) + 0.5, projBoxes);
      const u = d.map(v => v / len), h = rayWorld(a, u, len, boxes);
      if (h) hit = a.map((v, j) => v + u[j] * Math.max(0, h.t - 0.05));
    }
    if (!hit && (b[1] < 0 || now - pr.born > 5000)) hit = [b[0], Math.max(0, b[1]), b[2]];
    if (hit) { room.proj.splice(i, 1); room.splash(pr, hit); }
  }
}
