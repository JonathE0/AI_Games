// The opponent: snapshot buffer rendered 100 ms in the past (smooth interpolation), its model,
// and its footsteps (running is audible, walking is silent).
import { PlayerModel } from './models.js';
import { MAP_BOXES } from '/shared/map.js';
import { rayWorld } from '/shared/physics.js';

const DOWN = [0, -1, 0], ORIGIN = [0, 0, 0];

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const DELAY = 0.1;

export class RemotePlayer {
  // color: body color (Holdout teammates are blue, opponents red)
  constructor(scene, id, boxes = MAP_BOXES, color = undefined) {
    this.id = id;
    this.boxes = boxes;
    this.model = new PlayerModel(scene, color);
    this.downed = false;
    this.snaps = [];
    this.alive = true;
    this.pos = [0, -50, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.c = 0;
    this.w = 'knife';
    this.grounded = true;
    this.wasGrounded = true;
    this.stepDist = 0;
  }

  // Snapshots are timed with the sender's clock (m.ts), so network jitter doesn't make movement stutter.
  // offset maps sender time to ours: the lowest observed one-way delay, drifting up slowly if it grows.
  push(m, now) {
    let t = now;
    if (typeof m.ts === 'number') {
      const st = m.ts / 1000, lat = now - st;
      this.offset = this.offset === undefined || lat < this.offset ? lat : this.offset + (lat - this.offset) * 0.02;
      this.senderClock = true;
      t = st;
    }
    this.snaps.push({ t, p: m.p, y: m.y, pi: m.pi, c: m.c, w: m.w, v: m.v, g: m.g });
    if (this.snaps.length > 60) this.snaps.shift();
  }

  clock(now) { return this.senderClock ? now - this.offset : now; }

  spawn(pos, yaw, now) {
    this.snaps = [{ t: this.clock(now) - DELAY, p: pos, y: yaw, pi: 0, c: 0, w: this.w, v: [0, 0, 0], g: true }];
    this.alive = true;
    this.downed = false;
    this.model.setDead(false);
  }

  kill() {
    this.alive = false;
    this.model.setDead(true);
  }

  // Holdout: knocked down but alive (lies on the ground until revived).
  setDowned(d) {
    if (d === this.downed || !this.alive) return;
    this.downed = d;
    this.model.setDead(d);
  }

  update(dt, now, onStep) {
    const s = this.snaps;
    if (!s.length) return;
    const rt = this.clock(now) - DELAY;
    let a = s[0], b = s[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].t <= rt) { a = s[i]; b = s[i + 1] || s[i]; break; }
    }
    const k = b === a ? 0 : Math.min(1, (rt - a.t) / Math.max(1e-3, b.t - a.t));
    for (let i = 0; i < 3; i++) this.pos[i] = a.p[i] + (b.p[i] - a.p[i]) * k;
    this.yaw = a.y + wrap(b.y - a.y) * k;
    this.pitch = a.pi + (b.pi - a.pi) * k;
    this.c = a.c + (b.c - a.c) * k;
    this.w = b.w;
    this.fl = !!b.fl; // Holdout: flashlight on
    this.vel = b.v || [0, 0, 0];
    this.grounded = b.g;
    while (s.length > 2 && s[1].t < rt - 0.5) s.shift();

    const g = this.model.group;
    g.position.set(...this.pos);
    if (!this.model.dead) g.rotation.y = this.yaw;
    this.model.pose(this.c, this.pitch, this.w);
    this.model.update(dt);
    const [x, y, z] = this.pos;
    ORIGIN[0] = x; ORIGIN[1] = y + 0.2; ORIGIN[2] = z;
    const g0 = rayWorld(ORIGIN, DOWN, 30, this.boxes);
    const gy = g0 ? y + 0.2 - g0.t : 0;
    this.model.blob.position.set(x, gy + 0.02, z);
    this.model.blob.scale.setScalar(Math.max(0.35, 1 - (y - gy) * 0.35));

    const sp = Math.hypot(this.vel[0], this.vel[2]);
    if (this.alive && this.grounded && !this.wasGrounded) onStep(this.pos); // landing thud (hear bhoppers)
    this.wasGrounded = this.grounded;
    if (this.alive && this.grounded && sp > 3.4) {
      this.stepDist += sp * dt;
      if (this.stepDist > 2.1) { this.stepDist = 0; onStep(this.pos); }
    }
  }

  target() {
    return this.alive ? { x: this.pos[0], y: this.pos[1], z: this.pos[2], yaw: this.yaw, c: this.c } : null;
  }

  dispose(scene) { scene.remove(this.model.group, this.model.blob); }
}
