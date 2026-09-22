// The Behemoth (wave 25, then every 5th boss): a walking fortress, 11 m long and 7 m wide, with a flat deck on its
// back. Tuning and geometry shared by the server (server/holdout/behemoth.js: collision, hit and reach checks) and
// the browser (public/js/boss_behemoth.js: model, riding the deck). It only ever walks along a lane axis, so its
// body is one axis-aligned box and every point on it is (center, heading) plus a local offset.

export const BEHEMOTH = {
  len: 11, wide: 7, deck: 6.4,  // body footprint and deck height (m): a level-1 stair tops out a step below the deck
  speed: 1.1, start: 41, stop: 8.9, // m/s; spawns this far out along its lane; halts with its nose 3.4 m from the Core (clear of the chest and spawns)
  heartHp: 3500, heartR: 0.8, heartUp: 0.45, // per heart (squad + boss-cycle scaling on top); sphere radius, height above the deck
  boltHits: 2, boltR: 0.3, reach: 3.2,       // harvest-tool hits per bolt; bolt hit radius; eye-to-bolt reach (a little lag slack)
  braceEvery: 20000, braceFor: 7000, shellAt: [1500, 2500, 3500], // ms: a brace starts every 20 s; shells leave this long into it
  shellCore: 150, shellR: 3.5, shellDmg: 30, shellG: 12,          // Core damage per shell (after armor), splash, player hit, gravity
  crushDps: 3000, crushStall: 1200, crushDmg: 20, // builds/props in its footprint; each build flattened costs it 1.2 s; players shoved
  crewEvery: 12000, crewCap: 6, rear: 2500,       // 2 crew zombies on the deck every 12 s (at most 6 aboard); rearing up after a heart dies
  slamEvery: 6000, slamFrac: 0.15, reward: 3000,  // at the Core: 15 % of its max HP every 6 s; $ each on the kill
};
export const HATCHES = [3.4, 0, -3.4]; // the three armoured hatches (a reactor heart under each), forward offsets along the deck
export const BOLTS = [[-0.75, 0.75], [0.75, 0.75], [0, -0.85]]; // [side, forward] of each hatch's three bolts

// World point of a local offset: s = to its right, u = height, f = forward. b = { x, z, fx, fz } (unit heading).
export const bhmPoint = (b, s, u, f) => [b.x + b.fz * s + b.fx * f, u, b.z - b.fx * s + b.fz * f];

// Its collision box, updated in place. mat 'b' (the map border's): stops bullets and blocks building like a wall,
// but never holds a piece up (shared/build.js support rule), so ramps can lean on it without attaching.
export function bhmBox(b, out = { min: [0, 0, 0], max: [0, 0, 0], mat: 'b', bhm: true }) {
  const hx = (Math.abs(b.fx) * BEHEMOTH.len + Math.abs(b.fz) * BEHEMOTH.wide) / 2, hz = (Math.abs(b.fz) * BEHEMOTH.len + Math.abs(b.fx) * BEHEMOTH.wide) / 2;
  out.min[0] = b.x - hx; out.min[2] = b.z - hz;
  out.max[0] = b.x + hx; out.max[1] = BEHEMOTH.deck; out.max[2] = b.z + hz;
  return out;
}

export const heartPos = (b, i) => bhmPoint(b, 0, BEHEMOTH.deck + BEHEMOTH.heartUp, HATCHES[i]);
export const boltPos = (b, i, j) => bhmPoint(b, BOLTS[j][0], BEHEMOTH.deck + 0.1, HATCHES[i] + BOLTS[j][1]);

// Feet resting on top of box b (radius r footprint). The deck moves, so whoever stands on it gets its displacement.
export const onDeck = (pos, b, r = 0.4) => Math.abs(pos[1] - b.max[1]) < 0.08 &&
  pos[0] + r > b.min[0] && pos[0] - r < b.max[0] && pos[2] + r > b.min[2] && pos[2] - r < b.max[2];
