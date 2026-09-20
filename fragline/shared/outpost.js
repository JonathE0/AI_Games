// "Outpost" — the Zombie Holdout map: a 96 m field with the Core in the middle, four lanes (N/E/S/W)
// where the horde enters, a ring of ruined walls with gates ~26 m out, a shack in every corner and
// harvestable trees, rocks and wrecked cars. One quarter (north lane + NE corner) is rotated 4x.
// Each quarter also gets one distinct ruin out past the ring — a collapsed apartment block, a gutted
// gas station, a toppled bus or a watchtower — so all four corners of the map read as overgrown ruin.
// Entry: [minX, minY, minZ, maxX, maxY, maxZ, material] (bullet penetration per material in shared/physics.js MAT_RESIST).

const CENTER = [
  [-48, -1, -48, 48, 0, 48, 'f'],
  [-49, 0, -49, 49, 28, -48, 'b'], [-49, 0, 48, 49, 28, 49, 'b'],
  [-49, 0, -48, -48, 28, 48, 'b'], [48, 0, -48, 49, 28, 48, 'b'],
];
const CORE_BASE = { min: [-1.5, 0, -1.5], max: [1.5, 2.2, 1.5], mat: 'm' }; // the Core's armored base

const QUARTER = [
  // ruined wall with a 10 m gate across the north lane
  [-16, 0, -26.4, -5, 2.4, -25.8, 'c'], [5, 0, -26.4, 16, 2.4, -25.8, 'c'],
  [-5.6, 0, -26.6, -4.8, 3.2, -25.6, 'c'], [4.8, 0, -26.6, 5.6, 3.2, -25.6, 'c'],
  // low cover and crates
  [-3, 0, -14.3, 3, 1.1, -13.7, 'c'],
  [8, 0, -19, 9.2, 1.2, -17.8, 'w'], [9.2, 0, -19, 10.4, 2.4, -17.8, 'w'], [-10, 0, -34, -8.8, 1.2, -32.8, 'w'],
  // sandbag barricade line screening the inner path, split so the lane through the middle stays open
  [-9, 0, -11.7, -4, 0.75, -11.1, 'w'], [4, 0, -11.7, 9, 0.75, -11.1, 'w'],
  // corner shack: door facing the Core, window to the west
  [27, 0, -36, 33, 3, -35.7, 'd'],
  [27, 0, -30.3, 29.2, 3, -30, 'd'], [30.8, 0, -30.3, 33, 3, -30, 'd'], [29.2, 2.3, -30.3, 30.8, 3, -30, 'd'],
  [27, 0, -36, 27.3, 3, -34, 'd'], [27, 0, -32, 27.3, 3, -30, 'd'], [27, 0, -34, 27.3, 1, -32, 'd'], [27, 2.2, -34, 27.3, 3, -32, 'd'],
  [32.7, 0, -36, 33, 3, -30, 'd'],
  [26.8, 3, -36.2, 33.2, 3.2, -29.8, 'h'],
];

// Enterable buildings on the diagonals, inside the build zone: a small house on quarters 0/2 (door facing the
// Core, windows, flat roof) and a crumbling ruin on quarters 1/3.
const HOUSE = [
  [12, 0, -19, 19, 3, -18.7, 'd'], [18.7, 0, -19, 19, 3, -13, 'd'],
  [12, 0, -13.3, 14.5, 3, -13, 'd'], [16.5, 0, -13.3, 19, 3, -13, 'd'], [14.5, 0, -13.3, 16.5, 1, -13, 'd'], [14.5, 2.2, -13.3, 16.5, 3, -13, 'd'],
  [12, 0, -19, 12.3, 3, -16.8, 'd'], [12, 0, -15.2, 12.3, 3, -13, 'd'], [12, 2.3, -16.8, 12.3, 3, -15.2, 'd'],
  [11.8, 3, -19.2, 19.2, 3.25, -12.8, 'h'],
];
const RUIN = [
  [12, 0, -19, 17, 2.2, -18.6, 'c'], [18.6, 0, -19, 19, 1.4, -15, 'c'], [12, 0, -19, 12.4, 2.6, -15.5, 'c'],
  [14, 0, -13.4, 19, 1.2, -13, 'c'], [16.5, 0, -16.5, 17.3, 3.2, -15.7, 'c'],
];

// One more ruin in the open pocket between the ring and the corner shack — a different building per
// quarter (they never coexist, so all four share the same footprint). Chest/shelter spots below sit inside them.
const APARTMENT = [ // collapsed apartment block: one facade still up, the rest fell into rubble
  [26, 0, -26.5, 35.2, 4.2, -25.9, 'c'],
  [26, 0, -25.9, 26.6, 1.6, -20.5, 'c'], [34.6, 0, -25.9, 35.2, 2.6, -20, 'c'],
  [30, 0, -22.5, 33, 1.2, -21.7, 'c'],
  [27, 1.6, -23.5, 34.6, 1.9, -22, 'h'], // fallen floor slab resting on the rubble
];
const GAS_STATION = [ // gutted kiosk with its canopy still standing over the pumps
  [26, 0, -22.5, 30, 2.6, -20.4, 'c'],
  [27, 3, -26.5, 35, 3.3, -20.5, 'h'],
  [27.7, 0, -26.1, 28.3, 3, -25.5, 'h'], [33.7, 0, -26.1, 34.3, 3, -25.5, 'h'],
];
const BUS = [ // a toppled bus, torn open along the roof
  [27, 0, -23.5, 35, 2.4, -20.9, 'h'],
  [27, 2.4, -23, 28.5, 3.4, -21.5, 'h'],
];
const WATCHTOWER = [ // a wooden lookout post, platform overhead so it never blocks the ground
  [30, 0, -22.5, 32, 3.6, -20.5, 'd'],
  [28.5, 3.6, -24, 33.5, 4.0, -19.5, 'd'],
  [30, 4.0, -22.5, 32, 5.6, -20.5, 'w'],
];
const EXTRAS = [APARTMENT, GAS_STATION, BUS, WATCHTOWER];

// harvestable nodes of one quarter: [type, x, z, rot] (cars: rot 0 = long along z, 1 = along x)
const QUARTER_NODES = [
  ['tree', 20, -42], ['tree', 24, -39], ['tree', 36, -42], ['tree', 41, -37], ['tree', 38, -26], ['tree', 43, -31],
  ['tree', 22, -33], ['tree', 35, -19], ['tree', 42, -15], ['tree', 19, -37.5], ['tree', -13, -38], ['tree', -21, -36],
  ['rock', 31, -42], ['rock', 44, -41], ['rock', -19, -29], ['rock', 15, -34],
  ['car', 6, -37, 0], ['car', -7, -21, 1], ['car', 13, -21, 1],
  // small breakables closer in
  ['crate', 7, -30], ['crate', -8, -29], ['crate', 23.5, -10.5], ['barrel', 5.8, -22.6], ['barrel', 24, -23],
  ['rubble', -22, -19.5], ['pallet', 9, -10], ['rubble', 29.5, -12.5],
];

// mat = what harvesting yields (always Zinkonium); hits = knife hits until depleted; per = yield per hit
export const NODE_TYPES = {
  tree: { mat: 'zink', hits: 10, per: 12, box: 'w' },
  rock: { mat: 'zink', hits: 10, per: 8, box: 'c' },
  car: { mat: 'zink', hits: 12, per: 6, box: 'm' },
  crate: { mat: 'zink', hits: 4, per: 10, box: 'w' },
  barrel: { mat: 'zink', hits: 4, per: 6, box: 'm' },
  rubble: { mat: 'zink', hits: 5, per: 7, box: 'c' },
  pallet: { mat: 'zink', hits: 3, per: 8, box: 'w' },
};
// half extents [x, z] and height of each node's collision box
const NODE_SIZE = { tree: [0.4, 0.4, 5], rock: [1.1, 0.9, 1.3], crate: [0.6, 0.6, 1.2], barrel: [0.4, 0.4, 1.1], rubble: [0.8, 0.7, 0.7], pallet: [0.6, 0.5, 0.6] };

// chest spots per quarter (house/ruin, shack, the new EXTRAS ruin, outdoors) and shelters where wounded
// survivors wait (corner shack, and one inside the new EXTRAS ruin)
const QUARTER_CHESTS = [[16.8, -17.3], [28.6, -34.6], [-10.6, -31.4], [34.5, -11.5], [32, -24.5]];
const QUARTER_SHELTERS = [[30.4, -32.6], [29, -24.5]];

// quarter turn: (x, z) -> (-z, x)  (north -> east -> south -> west)
const turn = (x, z, q) => { for (let i = 0; i < q; i++) [x, z] = [-z, x]; return [x, z]; };

function turnBox([a, b, c, d, e, f, mat], q) {
  const [x0, z0] = turn(a, c, q), [x1, z1] = turn(d, f, q);
  return [Math.min(x0, x1), b, Math.min(z0, z1), Math.max(x0, x1), e, Math.max(z0, z1), mat];
}

const toBox = ([a, b, c, d, e, f, mat]) => ({ min: [a, b, c], max: [d, e, f], mat });

// the team chest (shared stash) beside the Core
const STASH_BOX = { min: [2.3, 0, 2.45], max: [3.3, 0.9, 3.15], mat: 'm' };
// the Banker's counter (selling), also inside the ring — center matches OUTPOST.banker below
const BANKER_BOX = { min: [4.5, 0, -5.0], max: [5.9, 0.9, -4.2], mat: 'm' };

// Unbreakable: the ground, the border, the Core, the team chest and the Banker's counter.
export const OUTPOST_STATIC = [...CENTER.map(toBox), CORE_BASE, STASH_BOX, BANKER_BOX];
export { BANKER_BOX };

// Breakable map props (walls, cover, crates, shacks, houses, ruins): HP and what harvesting them yields
// (always Zinkonium).
export const PROP_TYPES = {
  w: { name: 'crate', hp: 150, mat: 'zink' },
  d: { name: 'wall', hp: 300, mat: 'zink' },
  h: { name: 'roof', hp: 250, mat: 'zink' },
  c: { name: 'concrete', hp: 900, mat: 'zink' },
};
export const OUTPOST_PROPS = [0, 1, 2, 3]
  .flatMap(q => [...QUARTER, ...(q % 2 ? RUIN : HOUSE), ...EXTRAS[q]].map(b => turnBox(b, q)))
  .map((b, id) => ({ id, box: toBox(b), hp: PROP_TYPES[b[6]].hp }));

export const OUTPOST_BOXES = [...OUTPOST_STATIC, ...OUTPOST_PROPS.map(p => p.box)];

export const OUTPOST_NODES = [0, 1, 2, 3].flatMap(q => QUARTER_NODES.map(([type, x0, z0, rot = 0]) => {
  const [x, z] = turn(x0, z0, q), along = (rot + q) % 2; // cars keep their heading relative to the lane
  const [hx, hz, h] = type === 'car' ? (along ? [2.1, 1, 1.5] : [1, 2.1, 1.5]) : NODE_SIZE[type];
  const [sx, sz] = type !== 'car' && q % 2 ? [hz, hx] : [hx, hz];
  return { type, x, z, along, box: { min: [x - sx, 0, z - sz], max: [x + sx, h, z + sz], mat: NODE_TYPES[type].box } };
})).map((n, id) => { n.id = id; n.box.node = id; return n; });

export const OUTPOST_CHESTS = [0, 1, 2, 3].flatMap(q => QUARTER_CHESTS.map(([x, z]) => turn(x, z, q))).map(([x, z], id) => ({ id, x, z }));
export const OUTPOST_SHELTERS = [0, 1, 2, 3].flatMap(q => QUARTER_SHELTERS.map(([x, z]) => turn(x, z, q))).map(([x, z], id) => ({ id, x, z }));
// the Maw's seismic thumpers (wave 15): inside the two houses and one corner shack
export const THUMPER_SPOTS = [[15.5, -15.8, 0], [15.5, -15.8, 2], [30.2, -33.2, 1]].map(([x, z, q], id) => { const [tx, tz] = turn(x, z, q); return { id, x: tx, z: tz }; });

// Ladder volumes on the four faces of the Core (stand in one and hold forward to climb onto its roof).
const LADDER_W = 0.45, LADDER_D = 0.35, LADDER_TOP = 2.75;
// n = outward face normal, face = coordinate of the Core face along that axis
export const CORE_LADDERS = [
  { min: [-LADDER_W, 0, -1.5 - LADDER_D], max: [LADDER_W, LADDER_TOP, -1.5], n: [0, 0, -1], face: -1.5 },
  { min: [-LADDER_W, 0, 1.5], max: [LADDER_W, LADDER_TOP, 1.5 + LADDER_D], n: [0, 0, 1], face: 1.5 },
  { min: [1.5, 0, -LADDER_W], max: [1.5 + LADDER_D, LADDER_TOP, LADDER_W], n: [1, 0, 0], face: 1.5 },
  { min: [-1.5 - LADDER_D, 0, -LADDER_W], max: [-1.5, LADDER_TOP, LADDER_W], n: [-1, 0, 0], face: -1.5 },
];

export const OUTPOST = {
  bounds: { minX: -48, maxX: 48, minZ: -48, maxZ: 48 },
  // base = the solid pedestal zombies hit; box = no-build block (walls on its edge are allowed)
  core: { x: 0, z: 0, half: 1.5, top: 2.2, base: CORE_BASE, box: { min: [-3.8, -1, -3.8], max: [3.8, 60, 3.8] } },
  zone: 30,        // build radius around the Core
  buyRadius: 11.7, // shop and banker at the Core (the glowing ring); survivors hold inside it
  banker: { x: 5.2, z: -4.6, reach: 3.2 }, // the Banker's counter (selling) inside the ring
  stash: { x: 2.8, z: 2.8, box: STASH_BOX, reach: 2.6 },
  // zone = [minX, minZ, maxX, maxZ] where the horde appears; yaw = compass bearing seen from the Core
  lanes: [
    { id: 'N', name: 'NORTH', yaw: 0, zone: [-10, -46, 10, -42] },
    { id: 'E', name: 'EAST', yaw: -Math.PI / 2, zone: [42, -10, 46, 10] },
    { id: 'S', name: 'SOUTH', yaw: Math.PI, zone: [-10, 42, 10, 46] },
    { id: 'W', name: 'WEST', yaw: Math.PI / 2, zone: [-46, -10, -42, 10] },
  ],
  // inside the Core's no-build block, so respawning players never land in a wall
  spawns: [
    { x: 0, z: -2.9, yaw: 0 }, { x: 2.9, z: 0, yaw: -Math.PI / 2 },
    { x: 0, z: 2.9, yaw: Math.PI }, { x: -2.9, z: 0, yaw: Math.PI / 2 },
  ],
};
