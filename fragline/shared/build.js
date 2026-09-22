// Holdout building: a Fortnite-style grid of walls, floors, ramps and cones, shared by the server (placement
// validation, zombie damage) and the browser (ghost preview, collision, rendering).
// 4 m tiles and 3 m levels; walls sit on tile edges, floors, ramps and cones fill a tile.

export const GRID = { cell: 4, level: 3, thick: 0.3, x0: -48, z0: -48, cols: 24, rows: 24, levels: 4 };
export const FLOOR_LIFT = 0.01;     // floors sit flush with their level line, poking up just this much
export const REACH = 7;             // max distance from your eye to the nearest point of the piece
export const PIECE_COST = 10;
export const REPAIR_HP_PER_MAT = 15;
export const START_FRAC = 0.1;      // pieces appear at 10 % HP and grow to full while building
export const REFUND = 5;            // materials back when your knife breaks down your own piece
export const KNIFE_BREAK = 250;     // knife damage per hit on a built piece (full Zinkonium: 3 hits)
export const RAMP_THICK = 0.4;      // vertical thickness of a build ramp slab (~0.32 m perpendicular at this slope)
export const CONE_H = 1.2;          // a cone (roof) is a square pyramid over its tile, apex this high above the plane

// The one Holdout build material — tough, no upgrade path.
export const BMATS = {
  zink: { id: 'zink', name: 'Zinkonium', hp: 750, time: 4, code: 'Z', next: null },
};
export const MAT_IDS = ['zink'];
export const KINDS = ['wall', 'floor', 'ramp', 'cone']; // index = wire code: append only
// ramp orientation o -> the direction its surface rises toward (+x, -x, +z, -z)
export const RAMP_DIRS = [{ axis: 0, dir: 1 }, { axis: 0, dir: -1 }, { axis: 2, dir: 1 }, { axis: 2, dir: -1 }];
export const TURN_ORDER = [0, 2, 1, 3]; // ramp directions in 90° steps

// One slot per wall edge / floor tile / ramp tile / cone tile per level (a floor and a cone share a tile). Walls:
// o = 0 runs along x on the tile's north edge (z = z0), o = 1 runs along z on its west edge (x = x0); the far
// edges belong to the next tile.
export const slotKey = p => (p.kind === 'wall' ? `w:${p.i}:${p.k}:${p.l}:${p.o}` : `${p.kind[0]}:${p.i}:${p.k}:${p.l}`);

const int = v => Number.isInteger(v);
export function validSlot(p) {
  if (!p || !KINDS.includes(p.kind) || !BMATS[p.mat] || !int(p.i) || !int(p.k) || !int(p.l)) return false;
  if (p.l < 0 || p.l >= GRID.levels) return false;
  if (p.kind === 'wall') {
    if (p.o !== 0 && p.o !== 1) return false;
    return p.o === 0 ? p.i >= 0 && p.i < GRID.cols && p.k >= 0 && p.k <= GRID.rows
      : p.i >= 0 && p.i <= GRID.cols && p.k >= 0 && p.k < GRID.rows;
  }
  if (p.kind === 'ramp' && !(int(p.o) && p.o >= 0 && p.o < 4)) return false;
  return p.i >= 0 && p.i < GRID.cols && p.k >= 0 && p.k < GRID.rows;
}

// Collision/bullet box of a piece (same format as map boxes; ramps are wedges).
export function pieceBox(p) {
  const C = GRID.cell, H = GRID.level, T = GRID.thick;
  const x = GRID.x0 + p.i * C, z = GRID.z0 + p.k * C, y = p.l * H;
  let b;
  if (p.kind === 'wall') {
    b = p.o === 0 ? { min: [x, y, z - T / 2], max: [x + C, y + H, z + T / 2] }
      : { min: [x - T / 2, y, z], max: [x + T / 2, y + H, z + C] };
  } else if (p.kind === 'floor') {
    b = { min: [x, y - T + FLOOR_LIFT, z], max: [x + C, y + FLOOR_LIFT, z + C] };
  } else if (p.kind === 'cone') { // full bounds; pieceBoxes has the steps that actually collide
    b = { min: [x, y + FLOOR_LIFT, z], max: [x + C, y + FLOOR_LIFT + CONE_H, z + C] };
  } else {
    const r = RAMP_DIRS[p.o];
    b = { min: [x, y, z], max: [x + C, y + H, z + C], ramp: { axis: r.axis, dir: r.dir, slope: H / C, thick: RAMP_THICK } };
  }
  b.mat = BMATS[p.mat].code;
  b.sid = p.id;
  return b;
}

// A cone collides as a thin plate over its tile (so it joins the pieces around it like a floor does) plus three
// shrinking 0.4 m steps you walk up and over. Edited cones keep those boxes over their remaining quarters.
function coneBoxes(p) {
  const full = pieceBox(p), y = full.min[1], h = CONE_H / 3, half = GRID.cell / 2, mask = p.mask | 0;
  const layers = [[0, y, y + 0.05], [0.6, y, y + h], [1.2, y + h, y + 2 * h], [1.8, y + 2 * h, y + CONE_H]]; // [inset per side, bottom, top]
  const areas = mask ? [0, 1, 2, 3].filter(q => !(mask & (1 << q))).map(q => [q & 1, q >> 1, 1]) : [[0, 0, 2]]; // [col, row, size] in quarters
  const out = [];
  for (const [c, r, n] of areas) for (const [e, y0, y1] of layers) {
    const x0 = Math.max(full.min[0] + e, full.min[0] + c * half), x1 = Math.min(full.max[0] - e, full.min[0] + (c + n) * half);
    const z0 = Math.max(full.min[2] + e, full.min[2] + r * half), z1 = Math.min(full.max[2] - e, full.min[2] + (r + n) * half);
    if (x1 > x0 && z1 > z0) out.push({ min: [x0, y0, z0], max: [x1, y1, z1], mat: full.mat, sid: p.id });
  }
  return out;
}

// ---------- edits (Fortnite-style) ----------
// A piece's `mask` has one bit per removed tile. Walls: 3 columns (along the wall, col 0 at its low-coordinate
// end) × 3 rows (bit = row*3 + col, row 0 at the bottom); only the Fortnite templates in WALL_EDITS are valid.
// Floors: 2 × 2 quarters (bit = row*2 + col, col along x), any 1-3 of them. Ramps: bit 0 / 1 = the low / high
// half across the slope removed (a half ramp); they're edited by dragging over a 2 × 2 grid (rampEdit).
export const EDIT_GRID = { wall: [3, 3], floor: [2, 2], ramp: [2, 2], cone: [2, 2] }; // cones: quarters like floors
const FULL = { wall: 511, floor: 15, ramp: 3, cone: 15 };

// Wall outlines are in tile units: u along the wall, v up, both 0..3.
const TILE = ['BL', 'BM', 'BR', 'ML', 'MC', 'MR', 'TL', 'TM', 'TR'];
const tiles = s => s.split(' ').reduce((m, t) => m | (1 << TILE.indexOf(t)), 0);
const arc = (cx, cy, rx, ry, a0, a1, n = Math.ceil(Math.abs(a1 - a0) / 7.5)) => Array.from({ length: n + 1 }, (_, i) => {
  const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
  return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
});
const mirror = loop => loop.map(([u, v]) => [3 - u, v]).reverse();
// The arch: a semi-ellipse over the whole bottom, crown two tiles up. A half arch is its mirrored half widened
// to two tiles, so the opening's inner top corner is the round one.
const ARCH = [...arc(1.5, 0, 1.5, 2, 180, 0), [3, 3], [0, 3]];
const HALF_ARCH = [[3, 0], [3, 3], [0, 3], [0, 2], ...arc(0.5, 0, 1.5, 2, 90, 0)];
// removed tiles -> { name, door: door column or -1, loops: its outline when that isn't just the kept tiles }
export const WALL_EDITS = new Map([
  ['ML', 'window'], ['MC', 'window'], ['MR', 'window'], ['ML MR', 'two windows'],
  ['ML BL', 'door', 0], ['MC BM', 'door', 1], ['MR BR', 'door', 2],
  ['ML BL MR', 'door + window', 0], ['MR BR ML', 'door + window', 2],
  ['MC BL BM BR', 'arch', -1, [ARCH]],
  ['ML MC BL BM', 'half arch', -1, [HALF_ARCH]], ['MC MR BM BR', 'half arch', -1, [mirror(HALF_ARCH)]],
  ['TL TM ML', 'triangle', -1, [[[0, 0], [3, 0], [3, 3]]]], ['TM TR MR', 'triangle', -1, [[[0, 0], [3, 0], [0, 3]]]],
  ['ML BL BM', 'triangle', -1, [[[3, 0], [3, 3], [0, 3]]]], ['MR BM BR', 'triangle', -1, [[[0, 0], [3, 3], [0, 3]]]],
  ['TL TM TR', 'medium wall'], ['TL TM TR ML MC MR', 'low wall'],
  ['TL TM TR ML BL', 'medium wall + door', 0], ['TL TM TR MC BM', 'medium wall + door', 1], ['TL TM TR MR BR', 'medium wall + door', 2],
].map(([t, name, door = -1, loops]) => [tiles(t), { name, door, loops }]));

export const validMask = (kind, mask) => Number.isInteger(mask) && mask >= 0 && mask < FULL[kind] && (kind !== 'wall' || !mask || WALL_EDITS.has(mask));

// Door templates: players and survivors walk through, zombies have to break it. Returns { col, w } or null.
export const doorOf = mask => { const d = WALL_EDITS.get(mask)?.door ?? -1; return d < 0 ? null : { col: d, w: 1 }; };

// Solid outline loops of an edited wall in tile units (outer loops counter-clockwise, holes clockwise): the
// template's own outline, else traced around the kept tiles.
export function wallLoops(mask) {
  const own = WALL_EDITS.get(mask)?.loops;
  if (own) return own;
  const kept = (c, r) => c >= 0 && c < 3 && r >= 0 && r < 3 && !(mask & (1 << (r * 3 + c)));
  const next = new Map(); // corner -> next corner along the boundary, solid on the left
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (!kept(c, r)) continue;
    if (!kept(c, r - 1)) next.set(`${c},${r}`, `${c + 1},${r}`);
    if (!kept(c + 1, r)) next.set(`${c + 1},${r}`, `${c + 1},${r + 1}`);
    if (!kept(c, r + 1)) next.set(`${c + 1},${r + 1}`, `${c},${r + 1}`);
    if (!kept(c - 1, r)) next.set(`${c},${r + 1}`, `${c},${r}`);
  }
  const loops = [];
  while (next.size) {
    const loop = [];
    for (let k = next.keys().next().value; next.has(k);) { const n = next.get(k); next.delete(k); loop.push(k.split(',').map(Number)); k = n; }
    loops.push(loop);
  }
  return loops;
}

const BANDS = 3; // collision bands per wall tile row

// Solid runs [u0, u1] of outline loops across height v (even-odd).
function spans(loops, v) {
  const xs = [];
  for (const l of loops) l.forEach(([u0, v0], i) => {
    const [u1, v1] = l[(i + 1) % l.length];
    if ((v0 <= v) !== (v1 <= v)) xs.push(u0 + ((v - v0) / (v1 - v0)) * (u1 - u0));
  });
  xs.sort((a, b) => a - b);
  return xs.flatMap((u, i) => (i % 2 ? [] : [[u, xs[i + 1]]]));
}

// Ramp edits, Fortnite-style: `path` = the 2 × 2 tiles (bit = row*2 + col, col along x) in the order they were
// dragged over. All four, from one side to the opposite one, turn the full ramp to rise that way; two side by
// side make a half ramp on them rising from the first to the second. Returns { o, mask } or null.
export function rampEdit(path) {
  if (!Array.isArray(path) || (path.length !== 2 && path.length !== 4) || new Set(path).size !== path.length || !path.every(t => [0, 1, 2, 3].includes(t))) return null;
  const x = t => t & 1, z = t => t >> 1, [t0, t1] = path, half = path.length === 2;
  if (Math.abs(x(t1) - x(t0)) + Math.abs(z(t1) - z(t0)) !== 1) return null;
  const overX = (z(t1) === z(t0)) === half, end = half ? t1 : path[2]; // rises along x?
  const o = RAMP_DIRS.findIndex(r => r.axis === (overX ? 0 : 2) && r.dir === (overX ? x(end) - x(t0) : z(end) - z(t0)));
  return { o, mask: half ? ((overX ? z(t0) : x(t0)) ? 1 : 2) : 0 };
}

const sub = (full, p) => ({ min: [...full.min], max: [...full.max], mat: full.mat, sid: p.id });

// All collision/bullet boxes of a piece after edits. Door boxes carry `door: true` (they stop zombies only).
export function pieceBoxes(p) {
  if (p.kind === 'cone') return coneBoxes(p);
  const full = pieceBox(p), mask = p.mask | 0;
  if (!mask) return [full];
  const out = [];
  if (p.kind === 'wall') {
    // the outline cut into horizontal bands (1/3 m steps along arches and diagonals); runs that repeat in the
    // band above grow upward into one box
    const ax = p.o === 0 ? 0 : 2, L = GRID.cell / 3, R = GRID.level / 3, loops = wallLoops(mask), y = j => full.min[1] + (j * R) / BANDS;
    let below = [];
    for (let j = 0; j < 3 * BANDS; j++) {
      below = spans(loops, (j + 0.5) / BANDS).map(([a, c]) => {
        let s = below.find(q => q.a === a && q.c === c);
        if (!s) {
          s = { a, c, b: sub(full, p) };
          s.b.min[ax] = full.min[ax] + a * L; s.b.max[ax] = full.min[ax] + c * L; s.b.min[1] = y(j);
          out.push(s.b);
        }
        s.b.max[1] = y(j + 1);
        return s;
      });
    }
    const d = doorOf(mask);
    if (d) {
      const b = sub(full, p);
      b.min[ax] = full.min[ax] + d.col * L; b.max[ax] = full.min[ax] + (d.col + d.w) * L; b.max[1] = full.min[1] + 2 * R;
      b.door = true;
      out.push(b);
    }
  } else if (p.kind === 'floor') {
    const h = GRID.cell / 2;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        if (mask & (1 << (r * 2 + c))) continue;
        const e = c === 0 && !(mask & (1 << (r * 2 + 1))) ? 1 : c;
        const b = sub(full, p);
        b.min[0] = full.min[0] + c * h; b.max[0] = full.min[0] + (e + 1) * h;
        b.min[2] = full.min[2] + r * h; b.max[2] = full.min[2] + (r + 1) * h;
        out.push(b);
        c = e;
      }
    }
  } else {
    const perp = full.ramp.axis === 0 ? 2 : 0, mid = (full.min[perp] + full.max[perp]) / 2, b = sub(full, p);
    b.ramp = full.ramp;
    if (mask & 1) b.min[perp] = mid;
    if (mask & 2) b.max[perp] = mid;
    out.push(b);
  }
  return out;
}

// eps > 0 ignores touching faces; eps < 0 also counts boxes that merely touch.
export const overlaps = (a, b, eps = 0) =>
  a.min[0] < b.max[0] - eps && a.max[0] > b.min[0] + eps &&
  a.min[1] < b.max[1] - eps && a.max[1] > b.min[1] + eps &&
  a.min[2] < b.max[2] - eps && a.max[2] > b.min[2] + eps;

export const boxCenter = b => [0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2);

// ---------- structural integrity (Fortnite-style) ----------
// Everything built (and every breakable map prop) has to connect to the ground through touching pieces;
// whatever loses that connection collapses. pieces: [{ id, boxes }]; nearby(box) -> boxes around it
// (each carrying `sid`). Returns the pieces that are no longer supported.
const TOUCH = 0.06;
const touching = (a, b) => a.min[0] <= b.max[0] + TOUCH && a.max[0] >= b.min[0] - TOUCH
  && a.min[1] <= b.max[1] + TOUCH && a.max[1] >= b.min[1] - TOUCH
  && a.min[2] <= b.max[2] + TOUCH && a.max[2] >= b.min[2] - TOUCH;
export function unsupported(pieces, nearby) {
  const byId = new Map(), ok = new Set(), queue = [];
  for (const s of pieces) {
    byId.set(s.id, s);
    if (s.boxes.some(b => b.min[1] <= 0.05)) { ok.add(s.id); queue.push(s); }
  }
  while (queue.length) {
    const s = queue.pop();
    for (const b of s.boxes) {
      for (const o of nearby(b)) {
        if (o.sid === undefined || ok.has(o.sid) || !byId.has(o.sid) || !touching(b, o)) continue;
        ok.add(o.sid);
        queue.push(byId.get(o.sid));
      }
    }
  }
  return pieces.filter(s => !ok.has(s.id));
}

export function distToBox(p, b) {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const d = p[i] < b.min[i] ? b.min[i] - p[i] : p[i] > b.max[i] ? p[i] - b.max[i] : 0;
    s += d * d;
  }
  return Math.sqrt(s);
}

// Everything that decides whether a piece may go down. w = {
//   slots: Set/Map of taken slot keys, pieces: [piece boxes], statics: [map boxes], nodes: [harvest boxes],
//   zombies: [{ x, y, z, s }], eye: [x,y,z] | null, mats: { zink } | null,
//   core: { x, z, box }, zone: build radius around the Core, trapped: Set of floor slot keys carrying a floor trap }
// Returns null when the piece is allowed, otherwise a short reason for the HUD.
export function checkPlacement(p, w) {
  if (!validSlot(p)) return 'Out of bounds';
  if (w.slots.has(slotKey(p))) return 'Already built';
  if (p.kind === 'cone' && w.trapped?.has(slotKey({ ...p, kind: 'floor' }))) return 'A trap is in the way'; // turrets and Rally Fires never block
  const b = pieceBox(p), c = boxCenter(b);
  if (Math.hypot(c[0] - w.core.x, c[2] - w.core.z) > w.zone) return 'Outside the build zone';
  if (overlaps(b, w.core.box)) return 'Too close to the Core';
  if (w.eye && distToBox(w.eye, b) > REACH) return 'Too far away';
  if (w.mats && (w.mats[p.mat] ?? 0) < PIECE_COST) return `Not enough ${BMATS[p.mat].name}`;
  // eps smaller than FLOOR_LIFT so a flush floor's thin sliver still registers against ground-level statics
  for (const s of w.statics) if (s.mat !== 'f' && overlaps(b, s, 0.005)) return 'Blocked';
  for (const s of w.nodes) if (overlaps(b, s, 0.005)) return 'Blocked';
  for (const z of w.zombies) {
    const r = 0.4 * (z.s || 1);
    if (overlaps(b, { min: [z.x - r, z.y, z.z - r], max: [z.x + r, z.y + 1.8 * (z.s || 1), z.z + r] })) return 'Blocked by a zombie';
  }
  if (p.l > 0 && !w.pieces.some(s => overlaps(b, s, -0.05)) && !w.statics.some(s => s.mat !== 'f' && s.mat !== 'b' && overlaps(b, s, -0.05))) {
    return 'Needs support';
  }
  return null;
}

// ---------- aiming (the build ghost) ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Grid slot for an aimed point p: walls snap to the tile edge across your view, floors to the tile (up to one
// level above your feet), ramps to the tile and rise away from you, `turn` quarter turns further.
export function slotAtPoint(kind, p, dir, feetY, turn, mat) {
  const C = GRID.cell, H = GRID.level, top = GRID.levels - 1;
  const feetL = clamp(Math.floor((feetY + 0.6) / H), 0, top);
  const fx = (p[0] - GRID.x0) / C, fz = (p[2] - GRID.z0) / C, alongX = Math.abs(dir[0]) > Math.abs(dir[2]);
  let s;
  if (kind === 'wall') {
    const l = clamp(Math.floor((p[1] + 0.25) / H), 0, top);
    s = alongX ? { kind: 'wall', o: 1, i: Math.round(fx), k: Math.floor(fz), l } : { kind: 'wall', o: 0, i: Math.floor(fx), k: Math.round(fz), l };
  } else if (kind === 'floor' || kind === 'cone') { // a cone snaps like a floor: look up to roof your cell, down to cone your feet
    s = { kind, o: 0, i: Math.floor(fx), k: Math.floor(fz), l: clamp(Math.round(p[1] / H), 0, Math.min(top, feetL + 1)) };
  } else {
    const facing = alongX ? (dir[0] > 0 ? 0 : 1) : (dir[2] > 0 ? 2 : 3);
    s = { kind: 'ramp', o: TURN_ORDER[(TURN_ORDER.indexOf(facing) + turn) % 4], i: Math.floor(fx), k: Math.floor(fz), l: clamp(feetL + (p[1] > (feetL + 1) * H ? 1 : 0), 0, top) };
  }
  s.mat = mat;
  return s;
}

// Only these move the ghost; anything else (already built, blocked, Core, zone, materials) keeps it where you
// aim, so aiming at your own wall never jumps it somewhere else.
const FALLBACK = ['Needs support', 'Too far away', 'Out of bounds'];

// The build ghost: the slot under the crosshair or, when that one floats, is out of reach or off the grid, the
// placeable slot along your aim closest to the aimed spot (Fortnite-style). Walks the ray back toward you, then
// tries those slots one level lower at a time (looking up, the ray never gets low enough for a ground floor).
// a = { kind, mat, turn, eye, dir, hitT (aim ray hit distance, or null), feet: [x, y, z] };
// pending(slot) -> sent but not confirmed yet. Returns { slot, reason } (reason null when it can go down).
export function aimBuildSlot(a, w, pending = () => false) {
  const { eye, dir, feet } = a;
  let t = a.hitT != null ? Math.max(0, a.hitT - 0.05) : 4.5;
  if (eye[1] + dir[1] * t < 0.05 && dir[1] < -0.01) t = (eye[1] - 0.05) / -dir[1]; // aimed into the ground
  const at = d => slotAtPoint(a.kind, eye.map((v, j) => v + dir[j] * d), dir, feet[1], a.turn, a.mat);
  const slot = at(t), reason = checkPlacement(slot, w) || (pending(slot) ? 'Building…' : null);
  if (!FALLBACK.includes(reason)) return { slot, reason };
  const ray = [slot]; // the aim ray is 6.5 m, so at most ~25 samples
  for (let d = t - 0.25; d >= 0.3; d -= 0.25) ray.push(at(d));
  const cands = [...ray];
  for (let drop = 1; drop < GRID.levels; drop++) for (const s of ray) if (s.l >= drop) cands.push({ ...s, l: s.l - drop });
  const body = { min: [feet[0] - 0.4, feet[1], feet[2] - 0.4], max: [feet[0] + 0.4, feet[1] + 1.8, feet[2] + 0.4] };
  const seen = new Set([slotKey(slot)]);
  for (const s of cands) {
    const k = slotKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    const b = pieceBox(s), ax = s.o ? 0 : 2;
    if (s.kind === 'wall' && ((b.min[ax] + b.max[ax]) / 2 - eye[ax]) * Math.sign(dir[ax]) < 0.5) continue; // never behind or through you
    if (!overlaps(b, body) && !checkPlacement(s, w) && !pending(s)) return { slot: s, reason: null };
  }
  return { slot, reason };
}
