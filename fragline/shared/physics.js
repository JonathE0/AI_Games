// Shared movement, collision and ray casting (pure math — runs in the browser and on the server).
// Units are meters; CS values converted at 1 unit = 2.54 cm.

export const P = {
  radius: 0.4, standH: 1.8, crouchH: 1.32, standEye: 1.64, crouchEye: 1.2,
  step: 0.45, gravity: 20, jumpV: 6.8,
  friction: 5.2, stopSpeed: 2.0, accel: 5.5, airAccel: 12, airCap: 0.76,
  walkMul: 0.52, crouchMul: 0.34,
};

// Bullet penetration resistance per meter of material (Infinity = bullets stop). Damage left after a
// wall = 1 - thickness * resist / weapon.wallPen, so thin/soft materials are wallbangable, and even
// concrete gives way where a bullet only clips a corner or edge.
export const MAT_RESIST = {
  f: Infinity, // floor
  b: Infinity, // map boundary
  c: 3.5,      // concrete: corners/edges only
  m: 3,        // container steel
  w: 0.6,      // wooden crates
  p: 0.4,      // plywood panels
  d: 0.8,      // drywall
  h: 1.5,      // sheet metal
  Z: 5,        // Holdout Zinkonium build: tougher than old stone, softer than old metal — rifles get very little through
};

export const lerp = (a, b, t) => a + (b - a) * t;
export const eyeHeight = c => lerp(P.standEye, P.crouchEye, c);
export const bodyHeight = c => lerp(P.standH, P.crouchH, c);

// yaw 0 looks down -Z; positive yaw turns left; positive pitch looks up.
export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

// Slab test. Returns { t, tOut, axis, sign } (entry/exit distance, entry face) or null.
export function rayBox(o, d, min, max) {
  let tmin = -Infinity, tmax = Infinity, axis = 0, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (min[i] - o[i]) * inv, t2 = (max[i] - o[i]) * inv, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), tOut: tmax, axis, sign };
}

const normalOf = (axis, sign) => { const n = [0, 0, 0]; n[axis] = sign; return n; };

// Ramps are wedges (or, when ramp.thick is set, thin slabs — see bottomAt below): a box whose top rises
// linearly along ramp.axis (0 = x, 2 = z) toward ramp.dir. Ray vs shape by clipping against its planes
// (n·p <= c inside): 6 for a wedge, plus a 7th underside plane parallel to the top for a slab.
function rayRamp(o, d, b) {
  const { axis, dir, slope, thick } = b.ramp;
  const top = [0, 1, 0];
  top[axis] = -dir * slope;
  const cTop = b.min[1] + slope * (dir > 0 ? -b.min[axis] : b.max[axis]);
  const planes = [
    [[-1, 0, 0], -b.min[0]], [[1, 0, 0], b.max[0]],
    [[0, 0, -1], -b.min[2]], [[0, 0, 1], b.max[2]],
    [[0, -1, 0], -b.min[1]],
    [top, cTop],
  ];
  if (thick) planes.push([top.map(v => -v), thick - cTop]);
  let tIn = -Infinity, tOut = Infinity, nIn = null;
  for (const [n, c] of planes) {
    const denom = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
    const dist = c - (n[0] * o[0] + n[1] * o[1] + n[2] * o[2]);
    if (Math.abs(denom) < 1e-12) { if (dist < 0) return null; continue; }
    const t = dist / denom;
    if (denom < 0) { if (t > tIn) { tIn = t; nIn = n; } } else if (t < tOut) tOut = t;
    if (tIn > tOut) return null;
  }
  if (tOut < 0 || !nIn) return null;
  const len = Math.hypot(nIn[0], nIn[1], nIn[2]);
  return { t: Math.max(0, tIn), tOut, n: [nIn[0] / len, nIn[1] / len, nIn[2] / len] };
}

function rayShape(o, d, b) {
  if (b.ramp) return rayRamp(o, d, b);
  const r = rayBox(o, d, b.min, b.max);
  return r && { t: r.t, tOut: r.tOut, n: normalOf(r.axis, r.sign) };
}

export function rayWorld(o, d, maxDist, boxes) {
  let best = null;
  for (const b of boxes) {
    const r = rayShape(o, d, b);
    if (r && r.t <= maxDist && (!best || r.t < best.t)) best = { t: r.t, box: b, n: r.n };
  }
  return best;
}

function rayWorldAll(o, d, maxDist, boxes) {
  const hits = [];
  for (const b of boxes) {
    const r = rayShape(o, d, b);
    if (r && r.t <= maxDist) hits.push({ t: r.t, tOut: r.tOut, box: b, n: r.n });
  }
  return hits.sort((a, b) => a.t - b.t);
}

// Top of a box, or for a ramp the surface height at the uphill edge of a character footprint.
export function topAt(b, x, z, r = P.radius) {
  if (!b.ramp) return b.max[1];
  const { axis, dir, slope } = b.ramp;
  const c = axis === 0 ? x : z;
  const u = dir > 0 ? Math.min(c + r, b.max[axis]) : Math.max(c - r, b.min[axis]);
  const run = dir > 0 ? u - b.min[axis] : b.max[axis] - u;
  return Math.min(b.max[1], b.min[1] + Math.max(0, run) * slope);
}

// Underside of a box: b.min[1] for a solid wedge/box, or for a slab ramp (ramp.thick set) the lowest
// underside height over the footprint — the underside at the footprint's downhill edge. Tapers to
// b.min[1] near the low end, where the slab is too thin to reach full thickness above the floor.
export function bottomAt(b, x, z, r = P.radius) {
  if (!b.ramp?.thick) return b.min[1];
  const { axis, dir, slope, thick } = b.ramp;
  const c = axis === 0 ? x : z;
  const u = dir > 0 ? Math.max(c - r, b.min[axis]) : Math.min(c + r, b.max[axis]);
  const run = dir > 0 ? u - b.min[axis] : b.max[axis] - u;
  return Math.max(b.min[1], b.min[1] + Math.max(0, run) * slope - thick);
}

// Hitboxes in player-local space (origin at feet, facing -Z), c = crouch 0..1.
// The visible character is built from exactly these boxes: what you see is what you hit.
export function hitboxes(c = 0) {
  const legH = lerp(0.86, 0.48, c), stomH = lerp(0.26, 0.23, c);
  const chestH = lerp(0.38, 0.34, c), headH = lerp(0.28, 0.26, c);
  const yS = legH, yC = yS + stomH, yH = yC + chestH + 0.02;
  const lean = -0.06 * c;
  return [
    { part: 'legs', c: [-0.11, legH / 2, 0], h: [0.09, legH / 2, 0.1] },
    { part: 'legs', c: [0.11, legH / 2, 0], h: [0.09, legH / 2, 0.1] },
    { part: 'stomach', c: [0, yS + stomH / 2, lean * 0.5], h: [0.2, stomH / 2, 0.13] },
    { part: 'chest', c: [0, yC + chestH / 2, lean], h: [0.24, chestH / 2, 0.15] },
    { part: 'arm', c: [-0.3, yC + chestH * 0.55, lean], h: [0.06, chestH * 0.42, 0.07] },
    { part: 'arm', c: [0.3, yC + chestH * 0.55, lean], h: [0.06, chestH * 0.42, 0.07] },
    { part: 'arm', c: [-0.17, yC + chestH * 0.3, lean - 0.3], h: [0.05, 0.05, 0.2] },
    { part: 'arm', c: [0.2, yC + chestH * 0.3, lean - 0.3], h: [0.05, 0.05, 0.2] },
    { part: 'head', c: [0, yH + headH / 2, lean - 0.01], h: [0.11, headH / 2, 0.12] },
  ];
}

// Ray vs a player's hitboxes. pl = { x, y, z, yaw, c, s?, id? } (s = size scale, e.g. big zombies).
// Returns { t, part, id } (closest) or null.
export function rayPlayer(o, d, maxDist, pl) {
  const s = pl.s || 1, cy = Math.cos(pl.yaw), sy = Math.sin(pl.yaw);
  const ox = o[0] - pl.x, oz = o[2] - pl.z;
  // local space is scaled by 1/s, so a local hit distance maps back to world distance * s
  const lo = [(ox * cy - oz * sy) / s, (o[1] - pl.y) / s, (ox * sy + oz * cy) / s];
  const ld = [d[0] * cy - d[2] * sy, d[1], d[0] * sy + d[2] * cy];
  if (!rayBox(lo, ld, [-0.6, 0, -0.8], [0.6, 2.0, 0.6])) return null;
  let best = null;
  for (const hb of hitboxes(pl.c || 0)) {
    const r = rayBox(lo, ld,
      [hb.c[0] - hb.h[0], hb.c[1] - hb.h[1], hb.c[2] - hb.h[2]],
      [hb.c[0] + hb.h[0], hb.c[1] + hb.h[1], hb.c[2] + hb.h[2]]);
    if (r && r.t * s <= maxDist && (!best || r.t * s < best.t)) best = { t: r.t * s, part: hb.part, id: pl.id };
  }
  return best;
}

// Closest hit among one target or a list of them (the Holdout horde).
function rayTargets(o, d, maxDist, targets) {
  if (!targets) return null;
  if (!Array.isArray(targets)) return rayPlayer(o, d, maxDist, targets);
  let best = null;
  for (const tg of targets) {
    const r = rayPlayer(o, d, best ? best.t : maxDist, tg);
    if (r) best = r;
  }
  return best;
}

// Full bullet trace with wall penetration. target = one player, an array of them, or null. Returns
// { endT, player: { part, pen, id } | null, impacts: [{ t, n, mat, exit }] }
// pen = damage multiplier left after passing through penetrable boxes.
export function traceBullet(o, d, maxDist, boxes, target, wallPen) {
  const walls = rayWorldAll(o, d, maxDist, boxes);
  const ph = rayTargets(o, d, maxDist, target);
  let pen = 1;
  const impacts = [];
  for (const h of walls) {
    if (ph && h.t > ph.t) break;
    impacts.push({ t: h.t, n: h.n, mat: h.box.mat, box: h.box });
    const resist = MAT_RESIST[h.box.mat] ?? Infinity;
    if (!isFinite(resist)) return { endT: h.t, player: null, impacts };
    pen *= 1 - ((h.tOut - h.t) * resist) / Math.max(wallPen, 0.01);
    if (pen < 0.15 || impacts.length > 6) return { endT: h.t, player: null, impacts };
    if (ph && h.tOut > ph.t) break;
    impacts.push({ t: h.tOut, n: h.n.map(v => -v), mat: h.box.mat, exit: true });
  }
  if (ph) return { endT: ph.t, player: { part: ph.part, pen, id: ph.id }, impacts };
  return { endT: maxDist, player: null, impacts };
}

function overlapsBox(x, y, z, h, b) {
  const r = P.radius;
  return x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2] &&
    y + h > bottomAt(b, x, z) && y < topAt(b, x, z) - 1e-6;
}

export function blocked(x, y, z, h, boxes) {
  for (const b of boxes) if (overlapsBox(x, y, z, h, b)) return true;
  return false;
}

// Moves an upright box character (pos = feet center) with per-axis collision and stair stepping.
// Mutates pos and vel. Returns true when standing on something.
export function moveCharacter(pos, vel, dt, h, boxes, wasGrounded) {
  const dist = Math.hypot(vel[0], vel[1], vel[2]) * dt;
  const n = Math.min(16, Math.max(1, Math.ceil(dist / 0.15)));
  const sdt = dt / n;
  let grounded = false;
  for (let s = 0; s < n; s++) {
    for (const a of [0, 2]) {
      const delta = vel[a] * sdt;
      if (!delta) continue;
      const pre = pos[a];
      pos[a] += delta;
      // Step onto everything low enough at once (stairs, ledges, a ramp running into the floor at its top);
      // a ramp's slope lifts you even mid-air (you're touching it). Anything taller is a wall.
      let stepTo = -Infinity, onRamp = false, wall = false;
      for (const b of boxes) {
        if (!overlapsBox(pos[0], pos[1], pos[2], h, b)) continue;
        const top = topAt(b, pos[0], pos[2]), up = top - pos[1];
        if ((wasGrounded || grounded || b.ramp) && up > 0 && up <= P.step) { stepTo = Math.max(stepTo, top); onRamp ||= !!b.ramp; }
        else wall = true;
      }
      if (!wall && stepTo === -Infinity) continue;
      if (!wall && !blocked(pos[0], stepTo + 0.001, pos[2], h, boxes)) {
        pos[1] = stepTo;
        if (onRamp && vel[1] < 0) vel[1] = 0;
        continue;
      }
      for (const b of boxes) {
        if (!overlapsBox(pos[0], pos[1], pos[2], h, b)) continue;
        if (b.ramp?.thick) {
          // under a slab ramp: snapping to the tile edge would teleport you past it, so bisect instead
          // for the furthest point on this axis (between the pre- and post-move position) that clears it
          let lo = pre, hi = pos[a];
          for (let i = 0; i < 6; i++) {
            const mid = (lo + hi) / 2;
            const hit = a === 0 ? overlapsBox(mid, pos[1], pos[2], h, b) : overlapsBox(pos[0], pos[1], mid, h, b);
            if (hit) hi = mid; else lo = mid;
          }
          pos[a] = lo;
        } else {
          pos[a] = delta > 0 ? b.min[a] - P.radius - 1e-4 : b.max[a] + P.radius + 1e-4;
        }
        vel[a] = 0;
      }
    }
    const dy = vel[1] * sdt;
    pos[1] += dy;
    for (const b of boxes) {
      if (!overlapsBox(pos[0], pos[1], pos[2], h, b)) continue;
      const top = topAt(b, pos[0], pos[2]);
      if (dy <= 0 && top - pos[1] <= -dy + 0.05) {
        pos[1] = top; vel[1] = 0; grounded = true;
      } else if (dy > 0 && pos[1] + h - bottomAt(b, pos[0], pos[2]) <= dy + 0.05) {
        pos[1] = bottomAt(b, pos[0], pos[2]) - h - 1e-4; vel[1] = 0;
      }
    }
  }
  // Stick to the ground when walking down stairs/ramps instead of floating off them.
  if (!grounded && wasGrounded && vel[1] <= 0) {
    let top = -Infinity;
    for (const b of boxes) {
      if (pos[0] + P.radius > b.min[0] && pos[0] - P.radius < b.max[0] &&
        pos[2] + P.radius > b.min[2] && pos[2] - P.radius < b.max[2]) {
        const t = topAt(b, pos[0], pos[2]);
        if (t <= pos[1] + 1e-3 && t >= pos[1] - P.step) top = Math.max(top, t);
      }
    }
    if (top > -Infinity) { pos[1] = top; vel[1] = 0; grounded = true; }
  }
  return grounded;
}
