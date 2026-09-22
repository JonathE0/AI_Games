// Local player: Source-engine style movement (ground friction + acceleration, air strafing,
// counter-strafing, crouch-jump, stair stepping). Ticked at a fixed 128 Hz by main.js.
import { P, moveCharacter, blocked, eyeHeight, bodyHeight } from '../../shared/physics.js';

// Bunny-hop tuning: a wider air-strafe window than CS makes speed easier to build, capped so it stays sane.
const BHOP = { airCap: 1.2, airAccel: 14, maxSpeed: 12 };

export class LocalPlayer {
  constructor() {
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.crouch = 0;
    this.grounded = true;
    this.alive = false;
    this.tag = 0;       // "tagging": getting shot slows you down briefly
    this.landSlow = 0;  // landing penalty (discourages bunny hopping)
    this.stepDist = 0;
    this.ladderCool = 0; // after jumping off a ladder
  }

  spawn(pos, yaw) {
    Object.assign(this, { pos: [...pos], vel: [0, 0, 0], yaw, pitch: 0, crouch: 0, grounded: true, alive: true, tag: 0, landSlow: 0 });
  }

  get eye() { return [this.pos[0], this.pos[1] + eyeHeight(this.crouch), this.pos[2]]; }
  get speed() { return Math.hypot(this.vel[0], this.vel[2]); }

  // input: { f, b, l, r, crouch, jump } (0/1). Returns events { jumped, landed, step }.
  // bhop = Krunker-style bunny hopping: no landing slowdown, snappier air strafing, speed capped.
  tick(dt, input, maxSpeed, boxes, frozen, bhop = false, phys = {}) {
    const ev = {};
    const tuning = { ...P, ...phys };
    const wasGrounded = this.grounded;

    // Crouch over ~120 ms. In the air the feet tuck up instead of the head dropping (crouch-jump).
    const want = input.crouch && this.alive ? 1 : 0;
    if (want !== this.crouch) {
      const c = Math.max(0, Math.min(1, this.crouch + Math.sign(want - this.crouch) * (dt / 0.12)));
      const dH = bodyHeight(this.crouch) - bodyHeight(c);
      if (!this.grounded && !blocked(this.pos[0], this.pos[1] + dH, this.pos[2], bodyHeight(c), boxes)) {
        this.pos[1] += dH;
        this.crouch = c;
      } else if (dH > 0 || !blocked(this.pos[0], this.pos[1], this.pos[2], bodyHeight(c), boxes)) {
        this.crouch = c;
      }
    }

    const fwd = input.f - input.b, side = input.r - input.l;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    // Ladders (Holdout Core): hold forward to climb, look down + forward to climb down, jump to let go.
    this.ladderCool = Math.max(0, this.ladderCool - dt);
    const lad = !frozen && this.alive && this.ladderCool <= 0 && phys.ladders?.find(l =>
      this.pos[0] + 0.45 > l.min[0] && this.pos[0] - 0.45 < l.max[0] && this.pos[2] + 0.45 > l.min[2] && this.pos[2] - 0.45 < l.max[2] &&
      this.pos[1] < l.max[1] && this.pos[1] + 1.7 > l.min[1] &&
      (this.pos[l.n[0] ? 0 : 2] - l.face) * (l.n[0] || l.n[2]) > 0.05); // in front of the face, not standing on the roof
    if (lad) {
      const toward = -(wx * lad.n[0] + wz * lad.n[2]) * wl; // pushing into the ladder
      this.vel[1] = (Math.abs(fwd) > 0 ? Math.sign(toward || fwd) * (this.pitch < -0.5 ? -1 : 1) : 0) * 3.4;
      this.vel[0] = wx * 1.6; this.vel[2] = wz * 1.6;
      if (input.jump) { this.vel[0] = lad.n[0] * 4; this.vel[2] = lad.n[2] * 4; this.vel[1] = 3.5; this.ladderCool = 0.4; }
      this.grounded = moveCharacter(this.pos, this.vel, dt, bodyHeight(this.crouch), boxes, false);
      ev.ladder = true;
      return ev;
    }
    const crouched = this.crouch > 0.5 && this.grounded;
    let wish = frozen || !this.alive || wl === 0 ? 0 : maxSpeed * (crouched ? P.crouchMul : 1);
    if (this.tag > 0) wish *= 0.55;
    if (this.landSlow > 0) wish *= 0.8;
    this.tag = Math.max(0, this.tag - dt);
    this.landSlow = Math.max(0, this.landSlow - dt);

    let jumped = false;
    if (this.grounded && input.jump && !frozen && this.alive) {
      this.vel[1] = tuning.jumpV;
      this.grounded = false;
      jumped = ev.jumped = true;
    }

    if (this.grounded) {
      const sp = Math.hypot(this.vel[0], this.vel[2]);
      if (sp > 0) {
        const drop = Math.max(sp, P.stopSpeed) * P.friction * dt;
        const k = Math.max(sp - drop, 0) / sp;
        this.vel[0] *= k;
        this.vel[2] *= k;
      }
      this.accelerate(wx, wz, wish, P.accel * wish * dt);
    } else {
      // Source air strafing: strafe (A/D) while turning the mouse the same way to gain speed.
      const cap = phys.airCap ?? (bhop ? BHOP.airCap : P.airCap), accel = phys.airAccel ?? (bhop ? BHOP.airAccel : P.airAccel);
      this.accelerate(wx, wz, Math.min(wish, cap), accel * wish * dt);
      if (bhop || phys.airMax) {
        const limit = phys.airMax ?? BHOP.maxSpeed;
        const sp = Math.hypot(this.vel[0], this.vel[2]);
        if (sp > limit) { this.vel[0] *= limit / sp; this.vel[2] *= limit / sp; }
      }
    }

    const vyBefore = this.vel[1];
    this.vel[1] -= tuning.gravity * dt;
    this.grounded = moveCharacter(this.pos, this.vel, dt, bodyHeight(this.crouch), boxes, wasGrounded && !jumped);
    if (this.grounded && !wasGrounded && !jumped) {
      ev.landed = -vyBefore;
      if (!bhop && -vyBefore > 4) this.landSlow = 0.25; // CS2-style landing penalty only without bhop
    }

    // Running is loud; crouching (or anything slower) is silent — just like CS.
    const sp = this.speed;
    if (this.grounded && sp > 3.4) {
      this.stepDist += sp * dt;
      if (this.stepDist > 2.1) { this.stepDist = 0; ev.step = true; }
    }
    return ev;
  }

  accelerate(wx, wz, wishSpeed, accel) {
    if (wishSpeed <= 0) return;
    const cur = this.vel[0] * wx + this.vel[2] * wz;
    const add = wishSpeed - cur;
    if (add <= 0) return;
    const a = Math.min(accel, add);
    this.vel[0] += a * wx;
    this.vel[2] += a * wz;
  }
}
