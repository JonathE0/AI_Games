// "Duel" — a small symmetric 1v1 map built from axis-aligned boxes and ramps.
// Entry: [minX, minY, minZ, maxX, maxY, maxZ, material, ramp?]
// ramp = direction the surface rises toward ('+x' | '-x' | '+z' | '-z'); omitted for plain boxes.
// Materials (bullet penetration in shared/physics.js MAT_RESIST):
//   f floor, b boundary (solid) · c concrete (bangable only through corners/edges) · m container steel
//   w wooden crate · p plywood · d drywall · h sheet metal (all wallbangable)
// HALF is mirrored through the map center (x,z) -> (-x,-z), so both sides play identically.

const CENTER = [
  [-30, -1, -20, 30, 0, 20, 'f'],
  [-31, 0, 20, 31, 7, 21, 'b'],
  [-31, 0, -21, 31, 7, -20, 'b'],
  [30, 0, -20, 31, 7, 20, 'b'],
  [-31, 0, -20, -30, 7, 20, 'b'],
  [-2, 0, -2, 2, 3.5, 2, 'c'], // mid block
];

const HALF = [
  // spawn shield (spawn A sits behind it)
  [-22.6, 0, -5, -21.6, 4, 5, 'c'],
  // lane dividers
  [-18, 0, 7.5, -8, 3, 8.5, 'c'],
  [-14, 0, -8.5, -4, 3, -7.5, 'c'],
  // pillar between spawn and mid
  [-15, 0, -0.5, -14, 3, 0.5, 'c'],
  // corner platform: stairs on the lane side, a wide ramp up from the spawn side, drywall parapet
  [-30, 0, -19, -20, 1.6, -13, 'c'],
  [-20, 0, -16, -19.4, 1.2, -13, 'c'],
  [-19.4, 0, -16, -18.8, 0.8, -13, 'c'],
  [-18.8, 0, -16, -18.2, 0.4, -13, 'c'],
  [-30, 0, -13, -27, 1.6, -8, 'c', '-z'],
  [-20.4, 1.6, -19, -20, 2.6, -16, 'd'],
  // shipping container in the south lane with a sheet-metal ramp onto its roof
  [-12, 0, -18, -6, 2.4, -15.5, 'm'],
  [-6, 0, -18, 0, 2.4, -15.5, 'h', '-x'],
  // north lane: crates and a plywood partition (shoot straight through it)
  [-13, 0, 13.5, -12, 1, 14.5, 'w'],
  [-12, 0, 13.5, -11, 2, 14.5, 'w'],
  [-3, 0, 11, -1.6, 1.4, 12.4, 'w'],
  [-19, 0, 10.5, -17.8, 1.2, 11.7, 'w'],
  [-8.05, 0, 15, -7.95, 2.6, 20, 'p'],
  // mid lane: crates and a low sheet-metal wall
  [-9, 0, -4.5, -8, 1, -3.5, 'w'],
  [-10.2, 0, -4.7, -9, 2, -3.5, 'w'],
  [-7, 0, 2.5, -5.8, 1.2, 3.7, 'w'],
  [-6, 0, 5, -4.8, 2, 6.2, 'w'],
  [-12.05, 0, -1.8, -11.95, 1.3, 1.8, 'h'],
];

const FLIP = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };
const mirror = b => [-b[3], b[1], -b[5], -b[0], b[4], -b[2], b[6], b[7] && FLIP[b[7]]];

export const MAP_BOXES = [...CENTER, ...HALF, ...HALF.map(mirror)].map(([a, b, c, d, e, f, mat, ramp]) => {
  const box = { min: [a, b, c], max: [d, e, f], mat };
  if (ramp) {
    const axis = ramp[1] === 'x' ? 0 : 2;
    box.ramp = { axis, dir: ramp[0] === '+' ? 1 : -1, slope: (e - b) / (axis === 0 ? d - a : f - c) };
  }
  return box;
});

// yaw -PI/2 faces +X, +PI/2 faces -X
export const SPAWNS = {
  A: { x: -26, z: 0, yaw: -Math.PI / 2 },
  B: { x: 26, z: 0, yaw: Math.PI / 2 },
};
export const BUY_RADIUS = 8;
export const BOUNDS = { minX: -30, maxX: 30, minZ: -20, maxZ: 20 };
