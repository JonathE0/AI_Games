// The Colossus: a giant zombie drifting in circles over the Outpost on wave 5. It can only be hurt through
// its glowing weak points, and only by sniper rifles. Its path is a pure function of time, so the server
// and every browser agree on where it (and each weak point) is without streaming positions.
import { hitboxes } from './physics.js';

export const SKY = {
  wave: 5, alt: 40, radius: 20, period: 90, scale: 9, pointR: 0.8, pointHp: 380,
  bombEvery: 5, minionsEvery: 25, reward: 1500, bombSplash: 4, bombDmg: 30, bombSdmg: 160,
};

const HB = hitboxes(0);
// weak points in the (unscaled) zombie model: head, heart, belly, both shoulders, back
export const SKY_POINTS = [
  [0, HB[8].c[1] + 0.02, HB[8].c[2] - 0.13],
  [0.1, HB[3].c[1] + 0.05, -0.16],
  [-0.08, HB[2].c[1], -0.14],
  [-0.3, HB[4].c[1] + 0.12, -0.08],
  [0.3, HB[5].c[1] + 0.12, -0.08],
  [0, HB[3].c[1], 0.16],
];

// Position (feet) and heading of the Colossus t seconds after it appeared.
export function skyTransform(t, out = {}) {
  const a = (t / SKY.period) * Math.PI * 2;
  out.x = Math.cos(a) * SKY.radius;
  out.z = Math.sin(a) * SKY.radius;
  out.y = SKY.alt + Math.sin(t * 0.7) * 1.5;
  out.yaw = Math.atan2(Math.sin(a), -Math.cos(a)); // faces along its circle (models look down -Z at yaw 0)
  out.bank = Math.sin(t * 0.5) * 0.08;
  return out;
}

export const SKY_LEAN = 0.6; // hunches forward to glare down at the fort (so its chest faces the players)

// World position of weak point i at time t (model: lean about X, then yaw, then scale).
export function skyPoint(t, i, tr = skyTransform(t)) {
  const [x0, y0, z0] = SKY_POINTS[i], cp = Math.cos(SKY_LEAN), sp = Math.sin(SKY_LEAN);
  const lx = x0, ly = y0 * cp + z0 * sp, lz = -y0 * sp + z0 * cp;
  const s = SKY.scale, c = Math.cos(tr.yaw), sn = Math.sin(tr.yaw);
  return [tr.x + (lx * c + lz * sn) * s, tr.y + ly * s, tr.z + (-lx * sn + lz * c) * s];
}

// Ray (unit d) vs sphere; returns the hit distance or -1.
export function raySphere(o, d, c, r) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2], q = ox * ox + oy * oy + oz * oz - r * r, h = b * b - q;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}
