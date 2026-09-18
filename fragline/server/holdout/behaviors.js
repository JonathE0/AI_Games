// Specialist zombies (flags in shared/zombies.js), stepped from ai.js / the Holdout room:
// snipers camping their gate, burrowers tunnelling under a build, shieldbearers, bloater
// acid bursts, hexer ink, pyro fire trails, frost auras — and the burning / slowing / blinding they put on
// players (armor resistances in shared/items.js cut those down).
import { P, moveCharacter, blocked } from '../../shared/physics.js';
import { distToBox } from '../../shared/build.js';

const r2 = v => Math.round(v * 100) / 100;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const near = [], tmp = [];
const S = { MOVE: 0, WIND: 1, STRIKE: 2, AIM: 3 }; // same numbers as ai.js ZS (3 = lob / aim)
const face = (z, x, zz, dt, rate = 6) => {
  const want = Math.atan2(-(x - z.pos[0]), -(zz - z.pos[2]));
  z.yaw = wrap(z.yaw + Math.max(-rate * dt, Math.min(rate * dt, wrap(want - z.yaw))));
};

// Sniper shots lock a straight line (eye -> aim point) the moment the telegraph starts. On fire, only a
// target still within `tol` of that exact line counts as hit — stepping out of the shown laser dodges it.
export const BEAM_TOL = 0.6;
export function onBeam(e, a, p, tol = BEAM_TOL) {
  const dx = a[0] - e[0], dy = a[1] - e[1], dz = a[2] - e[2], l = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / l, uy = dy / l, uz = dz / l;
  const t = Math.max(0, (p[0] - e[0]) * ux + (p[1] - e[1]) * uy + (p[2] - e[2]) * uz);
  return Math.hypot(p[0] - (e[0] + ux * t), p[1] - (e[1] + uy * t), p[2] - (e[2] + uz * t)) <= tol;
}

// ---------- sniper: holds its gate, aims (a visible laser), fires ----------
function sniperTargets(room, z, eye) {
  const out = [];
  for (const p of room.targets()) {
    if (!p.alive || p.downed || p.state === 'carried' || p.state === 'wounded') continue;
    const q = p.st.p;
    out.push({ kind: p.isSurvivor ? 'sv' : 'p', ref: p, at: [q[0], q[1] + 1.3, q[2]] });
  }
  for (const d of room.defenses.list.values()) if (d.type === 'turret' || d.type === 'rturret') out.push({ kind: 'd', ref: d, at: [d.pos[0], d.pos[1] + 1, d.pos[2]] });
  let best = null, bd = z.t.range;
  for (const c of out) {
    const d = Math.hypot(c.at[0] - eye[0], c.at[2] - eye[2]);
    if (d < bd && room.lineOfSight(eye, c.at)) { bd = d; best = c; }
  }
  return best;
}

export function stepSniper(room, z, dt, now) {
  const t = z.t, pos = z.pos, eye = [pos[0], pos[1] + 1.6 * z.s, pos[2]], mul = room.director.dmgMul * (z.dmgMul ?? 1);
  z.post ??= [pos[0], pos[2]];
  if (z.state === S.AIM) {
    const c = z.target;
    if (c) face(z, c.at[0], c.at[2], dt, 3);
    if (now >= z.stateEnd) {
      z.state = S.STRIKE; z.stateEnd = now + 300; z.nextAtk = now + t.cooldown * 1000;
      if (c) {
        const from = z.lockEye ?? eye, at = c.at; // the exact line the telegraph showed, not a re-aim
        const validEntity = c.kind === 'd' ? room.defenses.list.get(c.ref.id) === c.ref : (c.ref.alive && !c.ref.downed);
        const clear = room.lineOfSight(from, at);
        room.broadcast({ t: 'zshot', id: z.id, a: from.map(r2), b: at.map(r2), hit: clear });
        if (clear && validEntity) {
          const cur = c.kind === 'd' ? [c.ref.pos[0], c.ref.pos[1] + 1, c.ref.pos[2]] : c.kind === 'sv' ? [c.ref.pos[0], c.ref.pos[1] + 1.3, c.ref.pos[2]] : [c.ref.st.p[0], c.ref.st.p[1] + 1.3, c.ref.st.p[2]];
          if (onBeam(from, at, cur)) { // still standing where the laser was aimed — didn't dodge
            if (c.kind === 'p') room.hurtPlayer(c.ref, t.dmg * mul, z);
            else if (c.kind === 'sv') room.survivors.hurt(c.ref, t.npcDmg * mul);
            else room.defenses.damage(c.ref, t.npcDmg * mul);
          }
        }
      }
      z.target = null; z.lockEye = null;
    }
    return;
  }
  if (z.state === S.STRIKE && now >= z.stateEnd) z.state = S.MOVE;
  // walk back to its post if something pushed it off
  const dx = z.post[0] - pos[0], dz = z.post[1] - pos[2], l = Math.hypot(dx, dz), speed = l > 2 ? t.speed : 0;
  z.vel[0] = speed ? (dx / l) * speed : 0; z.vel[2] = speed ? (dz / l) * speed : 0;
  z.vel[1] -= P.gravity * dt;
  z.g = moveCharacter(pos, z.vel, dt, 1.8 * z.s, room.grid.query(pos[0] - 1.5, pos[2] - 1.5, pos[0] + 1.5, pos[2] + 1.5, near), z.g);
  if (now >= z.thinkAt) {
    z.thinkAt = now + 400;
    z.aimAt = sniperTargets(room, z, eye);
  }
  const c = z.aimAt;
  if (c) face(z, c.at[0], c.at[2], dt, 3);
  if (c && z.state === S.MOVE && now >= z.nextAtk) {
    z.state = S.AIM; z.stateEnd = now + t.windup * 1000; z.target = c; z.lockEye = eye;
    room.broadcast({ t: 'zaim', id: z.id, a: eye.map(r2), p: c.at.map(r2), ms: t.windup * 1000 });
  }
}

// ---------- burrower: once, it digs under the build in its way and comes up one tile past it ----------
export function tryBurrow(room, z, goal, now, s = null) {
  if (!z.t.burrow || z.burrowed || z.under || !goal) return false;
  s ??= room.pieceNear(z.pos, z.t.reach + 0.4, true);
  if (!s || s.kind === 'prop') return false;
  z.burrowed = true; // one try, whatever happens
  const dx = goal[0] - z.pos[0], dz = goal[1] - z.pos[2], l = Math.hypot(dx, dz);
  if (l < 1e-3) return false;
  const u = [dx / l, dz / l];
  let k = 0.5;
  while (k < 12 && distToBox([z.pos[0] + u[0] * k, 0.9, z.pos[2] + u[1] * k], s.box) < 0.6) k += 0.25; // out the far side
  for (let extra = 4; extra >= 1.5; extra -= 0.5) { // one tile past it, closer if that spot is taken
    const x = z.pos[0] + u[0] * (k + extra), zz = z.pos[2] + u[1] * (k + extra);
    if (Math.hypot(x - room.map.core.x, zz - room.map.core.z) < 2.2) continue;
    if (!blocked(x, 0, zz, 1.8 * z.s, room.grid.query(x - 1.5, zz - 1.5, x + 1.5, zz + 1.5, tmp))) {
      const to = [x, 0, zz], dist = Math.hypot(to[0] - z.pos[0], to[2] - z.pos[2]);
      z.under = true;
      z.dig = { from: [...z.pos], to, t0: now, T: Math.max(900, (dist / 3.2) * 1000) };
      z.state = S.MOVE; z.target = null;
      room.broadcast({ t: 'zdig', id: z.id, from: z.dig.from.map(r2), to: to.map(r2), ms: z.dig.T });
      return true;
    }
  }
  return false;
}

export function stepBurrow(room, z, now) {
  const d = z.dig, k = Math.min(1, (now - d.t0) / d.T);
  for (let i = 0; i < 3; i++) z.pos[i] = d.from[i] + (d.to[i] - d.from[i]) * k;
  z.pos[1] = -1.9 * z.s * Math.sin(Math.PI * Math.min(1, k * 1.2 + 0.1)); // sinks, travels, rises
  if (k >= 1) {
    z.pos[1] = 0;
    z.under = false;
    z.dig = null;
    z.vel = [0, 0, 0];
    for (const p of room.targets()) {
      if (!p.alive || p.downed) continue;
      if (Math.hypot(p.st.p[0] - z.pos[0], p.st.p[2] - z.pos[2]) < 2.4) room.hurtPlayer(p, 14 * room.director.dmgMul, z);
    }
    room.broadcast({ t: 'zup', id: z.id, p: z.pos.map(r2) });
  }
}

// ---------- shieldbearer: is a shot coming at the shield? ----------
export function shieldBlocks(z, from, now) {
  if (!z.t.shield || now < (z.shieldDown || 0) || now < (z.frozenUntil || 0)) return false;
  const dx = from[0] - z.pos[0], dz = from[2] - z.pos[2], l = Math.hypot(dx, dz);
  if (l < 0.3) return false;
  const f = [-Math.sin(z.yaw), -Math.cos(z.yaw)];
  return (dx * f[0] + dz * f[1]) / l > Math.cos((70 * Math.PI) / 180);
}

// ---------- hazards: acid pools (bloaters), ink clouds (hexers), fire patches (pyros) ----------
export function addHazard(room, kind, p, r, life, dps = 0, sdps = 0, zdps = 0, owner = null) {
  const h = { id: ++room.hzId, kind, p: [...p], r, until: Date.now() + life * 1000, dps, sdps, zdps, owner, next: 0 };
  room.hazards.push(h);
  room.broadcast({ t: 'hz', id: h.id, k: kind, p: h.p.map(r2), r, life });
  return h;
}

export function bloaterBurst(room, z) {
  const b = z.t.burst, mul = room.director.dmgMul;
  for (const p of room.targets()) {
    if (!p.alive || p.downed || p.state === 'carried') continue;
    if (Math.hypot(p.st.p[0] - z.pos[0], p.st.p[2] - z.pos[2]) <= b.radius) room.hurtPlayer(p, b.dmg * mul, z, 'acid');
  }
  for (const s of room.builds()) if (distToBox(z.pos, s.box) <= b.radius) room.damagePiece(s, b.sdmg * mul, z);
  addHazard(room, 'acid', z.pos, b.radius * 0.8, b.pool, b.dps * mul, 30 * mul);
  room.broadcast({ t: 'splat', id: 0, p: [r2(z.pos[0]), r2(z.pos[1] + 0.8), r2(z.pos[2])], big: 1 });
}

export function updateHazards(room, now) {
  for (let i = room.hazards.length - 1; i >= 0; i--) {
    const h = room.hazards[i];
    if (now >= h.until) { room.hazards.splice(i, 1); continue; }
    if (now < h.next) continue;
    h.next = now + 250;
    for (const p of room.targets()) {
      if (!p.alive || p.downed || p.state === 'carried' || Math.hypot(p.st.p[0] - h.p[0], p.st.p[2] - h.p[2]) > h.r || Math.abs(p.st.p[1] - h.p[1]) > 2) continue;
      if (h.kind === 'fire') playerEffect(room, p, 'burn', 8, 2000);
      else if (h.kind === 'ink') playerEffect(room, p, 'blind', 1, 1200);
      else if (h.dps) room.hurtPlayer(p, h.dps * 0.25, null, 'acid');
    }
    if (h.sdps) for (const s of room.builds()) if (distToBox(h.p, s.box) <= h.r) room.damagePiece(s, h.sdps * 0.25);
    if (h.zdps) for (const z of room.zombies.values()) { // Brood Launcher bomblets: acid that only hurts zombies
      if (z.dead || Math.hypot(z.pos[0] - h.p[0], z.pos[2] - h.p[2]) > h.r) continue;
      room.damageZombie(z, h.zdps * 0.25, h.owner, 'broodlauncher');
    }
  }
}

// ---------- pyros leave fire behind them; frost walkers chill everyone around ----------
export function updateSpecials(room, now) {
  if (now - (room.specAt || 0) < 250) return;
  room.specAt = now;
  for (const z of room.zombies.values()) {
    if (z.dead || z.under) continue;
    if (z.t.ignite && now >= (z.trailAt || 0) && z.g) { z.trailAt = now + 1400; addHazard(room, 'fire', z.pos, 1.3, 4); }
    if (z.t.chillAura) {
      for (const p of room.targets()) {
        if (!p.alive || p.downed || Math.hypot(p.st.p[0] - z.pos[0], p.st.p[2] - z.pos[2]) > z.t.chillAura) continue;
        playerEffect(room, p, 'slow', 0.35, 700);
      }
    }
  }
}

// A zombie's melee hit landed on a player: pyros set them alight, frost walkers freeze their legs.
export function onMeleeHit(room, z, p) {
  if (z.t.ignite) playerEffect(room, p, 'burn', 8, z.t.ignite * 1000);
  if (z.t.chillAura) playerEffect(room, p, 'slow', 0.5, 2000);
}

// ---------- status on players (and survivors) ----------
// burn: damage per second for ms · slow: fraction of speed lost for ms · blind: screen inked for ms
export function playerEffect(room, p, kind, amount, ms) {
  const now = Date.now(), res = p.isSurvivor ? 0 : p.as?.[kind === 'burn' ? 'fire' : kind] ?? 0;
  if (res >= 0.99) return;
  p.fx ??= {};
  if (kind === 'burn') {
    p.fx.burnUntil = Math.max(p.fx.burnUntil || 0, now + ms * (1 - res * 0.5));
    p.fx.burnDps = Math.max(now < (p.fx.burnUntil || 0) ? p.fx.burnDps || 0 : 0, amount * (1 - res));
  } else if (kind === 'slow') {
    const k = amount * (1 - res);
    if (now < (p.fx.slowUntil || 0) && (p.fx.slow || 0) > k) { p.fx.slowUntil = Math.max(p.fx.slowUntil, now + ms); }
    else { p.fx.slow = k; p.fx.slowUntil = now + ms; }
  } else if (kind === 'blind') p.fx.blindUntil = Math.max(p.fx.blindUntil || 0, now + ms * (1 - res));
  if (!p.isSurvivor) room.send(p, { t: 'pfx', burn: Math.max(0, (p.fx.burnUntil || 0) - now), slow: now < (p.fx.slowUntil || 0) ? [r2(p.fx.slow), p.fx.slowUntil - now] : null, blind: Math.max(0, (p.fx.blindUntil || 0) - now) });
}

export function updatePlayerEffects(room, dt, now) {
  for (const p of room.targets()) {
    if (!p.fx || !p.alive || p.downed || !(now < p.fx.burnUntil)) continue;
    room.hurtPlayer(p, p.fx.burnDps * dt, null, 'fire');
  }
}
