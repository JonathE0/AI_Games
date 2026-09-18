// Zombie Holdout night waves: the Outpost goes nearly black (world.setNight does the sky, fog and ambient
// light), so you find zombies by their glowing eyes, muzzle flashes and sound — or with a flashlight
// attachment (L). All lights are created once and only dimmed, so shaders never recompile mid-fight.
import * as THREE from 'three';

export class NightFx {
  constructor(game) {
    this.g = game;
    const scene = game.world.scene;
    this.spot = new THREE.SpotLight(0xfff1d6, 0, 46, 0.36, 0.5, 1.1); // your flashlight
    this.spot.castShadow = false;
    scene.add(this.spot, this.spot.target);
    this.pool = Array.from({ length: 4 }, () => { // muzzle flashes (yours + nearby ones)
      const l = new THREE.PointLight(0xffc16b, 0, 13, 1.7);
      scene.add(l);
      return { l, t: 0 };
    });
    const cone = new THREE.ConeGeometry(2.2, 12, 18, 1, true);
    cone.translate(0, -6, 0);
    cone.rotateX(Math.PI / 2); // apex at the origin, opening toward -z (where a model looks)
    this.coneGeo = cone;
    this.coneMat = new THREE.MeshBasicMaterial({ color: 0xfff1d6, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.cones = new Map();
    this.k = 0;
  }

  // a gun went off at `pos` (only lights things up at night)
  flash(pos) {
    if (this.k < 0.15) return;
    this.g.holdout?.minimap?.revealNear(pos);
    const f = this.pool.reduce((a, b) => (b.t < a.t ? b : a));
    f.l.position.set(pos[0], pos[1], pos[2]);
    f.t = 0.07;
    f.l.intensity = 38 * this.k;
  }

  // k: 0 day … 1 night · torch: your flashlight is on · remotes: teammates (theirs show as light cones)
  // The torch works on every wave (not just night ones), just dimmer where there is already daylight.
  update(dt, k, torch, remotes) {
    this.k = k;
    const cam = this.g.world.camera;
    const on = !!torch;
    this.spot.intensity = on ? 45 + 50 * k : 0;
    if (on) {
      const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      this.spot.position.copy(cam.position).addScaledVector(d, 0.3).y -= 0.15;
      this.spot.target.position.copy(cam.position).addScaledVector(d, 12);
      this.spot.target.updateMatrixWorld();
    }
    for (const f of this.pool) {
      if (f.t <= 0) { if (f.l.intensity) f.l.intensity = 0; continue; }
      f.t -= dt;
      f.l.intensity *= 0.7;
    }
    const seen = new Set();
    for (const r of remotes.values()) {
      if (!r.fl || !r.alive || k < 0.05) continue;
      seen.add(r);
      let c = this.cones.get(r);
      if (!c) { c = new THREE.Mesh(this.coneGeo, this.coneMat); this.g.world.scene.add(c); this.cones.set(r, c); }
      c.position.set(r.pos[0], r.pos[1] + 1.5, r.pos[2]);
      c.rotation.set(r.pitch ?? 0, r.yaw ?? 0, 0, 'YXZ');
    }
    for (const [r, c] of this.cones) if (!seen.has(r)) { this.g.world.scene.remove(c); this.cones.delete(r); }
  }

  dispose() {
    const scene = this.g.world.scene;
    scene.remove(this.spot, this.spot.target);
    for (const f of this.pool) scene.remove(f.l);
    for (const c of this.cones.values()) scene.remove(c);
    this.coneGeo.dispose();
    this.coneMat.dispose();
  }
}
