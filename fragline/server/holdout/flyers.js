// Flying specialists (shared/zombies.js `flyer: true`), stepped from ai.js instead of the ground flow field:
// they never touch the ground grid and never collide with builds — walls and roofs simply don't exist to them.
//  - Swooper (from wave 8): circles high above the fort, picks a player, winds up (a beat to react), dives
//    fast, hits once near the bottom of the dive, then climbs back to altitude. No projectiles.
//  - Sky Sniper (from wave 9, rarer): flies to a vantage point in the air, hovers, and snipes exactly like a
//    ground Sniper — a locked-line laser telegraph (behaviors.js onBeam), then fires; step out of the beam to
//    dodge. Targets players first, then survivors/turrets. Repositions after a few shots.
import { onBeam } from './behaviors.js';

const r2 = v => Math.round(v * 100) / 100;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const TURN = 3.4; // rad/s — flyers bank lazily, not twitchy like ground zombies
export const FLYER_ALT = 15;    // cruising/vantage altitude (m)
const ORBIT_R = 26;             // Swooper circling radius around the fort
const S = { MOVE: 0, WIND: 1, STRIKE: 2, AIM: 3 }; // same numbering as ai.js ZS / behaviors.js S

function face(z, x, zz, dt, rate = TURN) {
  const want = Math.atan2(-(x - z.pos[0]), -(zz - z.pos[2]));
  z.yaw = wrap(z.yaw + Math.max(-rate * dt, Math.min(rate * dt, wrap(want - z.yaw))));
}

// Closest living player within range (Swooper dive target, and the Sky Sniper's first choice).
function closestPlayer(room, z, range) {
  let best = null, bd = range;
  for (const p of room.players) {
    if (!p.alive || p.downed) continue;
    const d = Math.hypot(p.st.p[0] - z.pos[0], p.st.p[2] - z.pos[2]);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function stepFlyer(room, z, dt, now) {
  if (z.t.sniper) stepSkySniper(room, z, dt, now); else stepSwooper(room, z, dt, now);
}

// ---------- Swooper ----------
function stepSwooper(room, z, dt, now) {
  const t = z.t, pos = z.pos, mul = room.director.dmgMul * (z.dmgMul ?? 1);
  z.orbit ??= { cx: room.map.core.x, cz: room.map.core.z, a: Math.random() * Math.PI * 2, dir: Math.random() < 0.5 ? 1 : -1 };
  if (z.state === S.WIND) { // a beat locked onto the target before it commits — the tell that lets you react
    const tg = z.target;
    if (tg && tg.ref.alive && !tg.ref.downed) { tg.p = [tg.ref.st.p[0], 1.1, tg.ref.st.p[2]]; face(z, tg.p[0], tg.p[2], dt, 5); }
    if (now >= z.stateEnd) {
      z.state = S.STRIKE; z.stateEnd = now + 700; z.dived = false;
      z.diveFrom = [...pos];
      z.diveTo = tg && tg.ref.alive && !tg.ref.downed ? tg.p : [pos[0], 0.5, pos[2]];
    }
    return;
  }
  if (z.state === S.STRIKE) { // the dive itself
    const span = 700, k = Math.min(1, 1 - (z.stateEnd - now) / span);
    pos[0] = z.diveFrom[0] + (z.diveTo[0] - z.diveFrom[0]) * k;
    pos[2] = z.diveFrom[2] + (z.diveTo[2] - z.diveFrom[2]) * k;
    pos[1] = z.diveFrom[1] + (z.diveTo[1] - z.diveFrom[1]) * Math.sin((k * Math.PI) / 2);
    face(z, z.diveTo[0], z.diveTo[2], dt, 9);
    if (!z.dived) { // one hit, the moment it actually passes close enough (the arc's altitude isn't linear in k)
      for (const p of room.targets()) {
        if (!p.alive || p.downed) continue;
        if (Math.hypot(p.st.p[0] - pos[0], p.st.p[2] - pos[2]) <= t.reach + 1.2 && Math.abs(p.st.p[1] + 0.9 - pos[1]) < 2.2) {
          if (!room.barriers.stop([...pos], [p.st.p[0], p.st.p[1] + 0.9, p.st.p[2]], t.dmg * mul, z)) room.hurtPlayer(p, t.dmg * mul, z); // or into a Tank's barrier
          z.dived = true; break;
        }
      }
    }
    if (now >= z.stateEnd) { z.state = S.MOVE; z.nextAtk = now + t.cooldown * 1000; } // climbs back to altitude (see the circling code below)
    return;
  }
  // circling at altitude, screeching in for another pass once its cooldown is up
  z.orbit.a += ((z.orbit.dir * t.speed) / ORBIT_R) * dt;
  const gx = z.orbit.cx + Math.cos(z.orbit.a) * ORBIT_R, gz = z.orbit.cz + Math.sin(z.orbit.a) * ORBIT_R;
  pos[0] += (gx - pos[0]) * Math.min(1, dt * 1.2);
  pos[2] += (gz - pos[2]) * Math.min(1, dt * 1.2);
  pos[1] += (FLYER_ALT - pos[1]) * Math.min(1, dt);
  face(z, gx, gz, dt);
  if (now >= (z.nextAtk || 0)) {
    const tgt = closestPlayer(room, z, 34);
    if (tgt) { z.state = S.WIND; z.stateEnd = now + t.windup * 1000; z.target = { ref: tgt, p: [tgt.st.p[0], 1.1, tgt.st.p[2]] }; }
  }
}

// ---------- Sky Sniper ----------
// players first, then survivors/turrets — mirrors behaviors.js sniperTargets but from an airborne vantage point
function skyTargets(room, z) {
  const eye = z.pos, out = [];
  for (const p of room.targets()) {
    if (!p.alive || p.downed || p.state === 'carried' || p.state === 'wounded') continue;
    const q = p.st.p;
    out.push({ kind: p.isSurvivor ? 'sv' : 'p', ref: p, at: [q[0], q[1] + 1.3, q[2]], player: !p.isSurvivor });
  }
  for (const d of room.defenses.list.values()) if (d.type === 'turret' || d.type === 'rturret') out.push({ kind: 'd', ref: d, at: [d.pos[0], d.pos[1] + 1, d.pos[2]], player: false });
  let best = null, bd = z.t.range, bestAny = null, bdAny = z.t.range;
  for (const c of out) {
    const d = Math.hypot(c.at[0] - eye[0], c.at[1] - eye[1], c.at[2] - eye[2]);
    if (!room.lineOfSight(eye, c.at)) continue;
    if (d < bdAny) { bdAny = d; bestAny = c; }
    if (c.player && d < bd) { bd = d; best = c; }
  }
  return best ?? bestAny; // players first; only settle for survivors/turrets if no player qualifies
}

function pickVantage(room, z) {
  const c = room.map.core, a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 16;
  return [c.x + Math.cos(a) * r, FLYER_ALT + Math.random() * 6, c.z + Math.sin(a) * r];
}

function stepSkySniper(room, z, dt, now) {
  const t = z.t, pos = z.pos, mul = room.director.dmgMul * (z.dmgMul ?? 1);
  z.post ??= pickVantage(room, z);
  z.shots ??= 0;
  if (z.state === S.AIM) {
    const c = z.target;
    if (c) face(z, c.at[0], c.at[2], dt, 3);
    if (now >= z.stateEnd) {
      z.state = S.STRIKE; z.stateEnd = now + 300; z.nextAtk = now + t.cooldown * 1000;
      if (c) {
        const from = z.lockEye ?? [...pos], at = c.at;
        const validEntity = c.kind === 'd' ? room.defenses.list.get(c.ref.id) === c.ref : (c.ref.alive && !c.ref.downed);
        const clear = room.lineOfSight(from, at), wall = clear && room.barriers.stop(from, at, t.dmg * mul, z, true); // a Tank's barrier in the line takes it (a Deflect sends it back)
        room.broadcast({ t: 'zshot', id: z.id, a: from.map(r2), b: (wall || at).map(r2), hit: clear });
        if (clear && !wall && validEntity) {
          const cur = c.kind === 'd' ? [c.ref.pos[0], c.ref.pos[1] + 1, c.ref.pos[2]] : c.kind === 'sv' ? [c.ref.pos[0], c.ref.pos[1] + 1.3, c.ref.pos[2]] : [c.ref.st.p[0], c.ref.st.p[1] + 1.3, c.ref.st.p[2]];
          if (onBeam(from, at, cur)) { // still standing where the laser was aimed — didn't dodge
            if (c.kind === 'p') room.hurtPlayer(c.ref, t.dmg * mul, z);
            else if (c.kind === 'sv') room.survivors.hurt(c.ref, t.npcDmg * mul);
            else room.defenses.damage(c.ref, t.npcDmg * mul);
          }
        }
      }
      z.target = null; z.lockEye = null;
      if (++z.shots >= 3) { z.shots = 0; z.post = pickVantage(room, z); } // a few shots, then reposition
    }
    return;
  }
  if (z.state === S.STRIKE && now >= z.stateEnd) z.state = S.MOVE;
  const dx = z.post[0] - pos[0], dy = z.post[1] - pos[1], dz = z.post[2] - pos[2], d = Math.hypot(dx, dy, dz);
  const hovering = d < 1.5;
  if (!hovering) {
    const step = Math.min(d, t.speed * dt);
    pos[0] += (dx / d) * step; pos[1] += (dy / d) * step; pos[2] += (dz / d) * step;
    face(z, z.post[0], z.post[2], dt);
  }
  if (now >= z.thinkAt) { z.thinkAt = now + 400; z.aimAt = skyTargets(room, z); }
  const c = z.aimAt;
  if (c) face(z, c.at[0], c.at[2], dt, 3);
  if (c && hovering && z.state === S.MOVE && now >= z.nextAtk) {
    z.state = S.AIM; z.stateEnd = now + t.windup * 1000; z.target = c; z.lockEye = [...pos];
    room.broadcast({ t: 'zaim', id: z.id, a: pos.map(r2), p: c.at.map(r2), ms: t.windup * 1000 });
  }
}
