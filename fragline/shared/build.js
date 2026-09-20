// Holdout building: a Fortnite-style grid of walls, floors and ramps, shared by the server (placement
// validation, zombie damage) and the browser (ghost preview, collision, rendering).
// 4 m tiles and 3 m levels; walls sit on tile edges, floors and ramps fill a tile.

export const GRID = { cell: 4, level: 3, thick: 0.3, x0: -48, z0: -48, cols: 24, rows: 24, levels: 4 };
export const FLOOR_LIFT = 0.01;     // floors sit flush with their level line, poking up just this much
export const REACH = 7;             // max distance from your eye to the nearest point of the piece
export const PIECE_COST = 10;
export const REPAIR_HP_PER_MAT = 15;
export const START_FRAC = 0.1;      // pieces appear at 10 % HP and grow to full while building
export const REFUND = 5;            // materials back when you demolish your own piece
export const RAMP_THICK = 0.4;      // vertical thickness of a build ramp slab (~0.32 m perpendicular at this slope)

// The one Holdout build material — tough, no upgrade path.
export const BMATS = {
  zink: { id: 'zink', name: 'Zinkonium', hp: 750, time: 4, code: 'Z', next: null },
};
export const MAT_IDS = ['zink'];
export const KINDS = ['wall', 'floor', 'ramp'];
// ramp orientation o -> the direction its surface rises toward (+x, -x, +z, -z)
export const RAMP_DIRS = [{ axis: 0, dir: 1 }, { axis: 0, dir: -1 }, { axis: 2, dir: 1 }, { axis: 2, dir: -1 }];

// One slot per wall edge / floor tile / ramp tile per level. Walls: o = 0 runs along x on the tile's
// north edge (z = z0), o = 1 runs along z on its west edge (x = x0); the far edges belong to the next tile.
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
  } else {
    const r = RAMP_DIRS[p.o];
    b = { min: [x, y, z], max: [x + C, y + H, z + C], ramp: { axis: r.axis, dir: r.dir, slope: H / C, thick: RAMP_THICK } };
  }
  b.mat = BMATS[p.mat].code;
  b.sid = p.id;
  return b;
}

// ---------- edits (Fortnite-style) ----------
// A piece's `mask` has one bit per removed tile. Walls: 3 columns (along the wall) × 3 rows (bit = row*3 + col,
// row 0 at the bottom). Floors: 2 × 2 quarters (bit = row*2 + col, col along x). Ramps: two halves across the
// slope (bit 0 = low-coordinate half) — remove one for a half ramp.
export const EDIT_GRID = { wall: [3, 3], floor: [2, 2], ramp: [2, 1] };
const FULL = { wall: 511, floor: 15, ramp: 3 };

export const validMask = (kind, mask) => Number.isInteger(mask) && mask >= 0 && mask < FULL[kind] && FULL[kind] !== undefined;

// Removing exactly the bottom two tiles of one column (or two neighbouring columns) makes a door that
// players and survivors walk through while zombies have to break it. Returns { col, w } or null.
export function doorOf(mask) {
  for (let c = 0; c < 3; c++) {
    const single = (1 << c) | (1 << (3 + c));
    if (mask === single) return { col: c, w: 1 };
    if (c < 2 && mask === (single | (1 << (c + 1)) | (1 << (4 + c)))) return { col: c, w: 2 };
  }
  return null;
}

const sub = (full, p) => ({ min: [...full.min], max: [...full.max], mat: full.mat, sid: p.id });

// All collision/bullet boxes of a piece after edits. Door boxes carry `door: true` (they stop zombies only).
export function pieceBoxes(p) {
  const full = pieceBox(p), mask = p.mask | 0;
  if (!mask) return [full];
  const out = [];
  if (p.kind === 'wall') {
    const ax = p.o === 0 ? 0 : 2, L = GRID.cell / 3, R = GRID.level / 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (mask & (1 << (r * 3 + c))) continue;
        let e = c;
        while (e + 1 < 3 && !(mask & (1 << (r * 3 + e + 1)))) e++;
        const b = sub(full, p);
        b.min[ax] = full.min[ax] + c * L; b.max[ax] = full.min[ax] + (e + 1) * L;
        b.min[1] = full.min[1] + r * R; b.max[1] = full.min[1] + (r + 1) * R;
        out.push(b);
        c = e;
      }
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
//   core: { x, z, box }, zone: build radius around the Core }
// Returns null when the piece is allowed, otherwise a short reason for the HUD.
export function checkPlacement(p, w) {
  if (!validSlot(p)) return 'Out of bounds';
  if (w.slots.has(slotKey(p))) return 'Already built';
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
