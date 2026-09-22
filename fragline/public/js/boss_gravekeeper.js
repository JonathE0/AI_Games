// Client side of the Gravekeeper (server/holdout/gravekeeper.js). His body is an ordinary zombie rig (zombies.js);
// this adds what he carries — the bronze bell on his back (glows once the ward is down), scythe, lantern, top hat —
// and his spectral ward, plus the grave pits (violet cracks, minimap marks), telegraphed lightning and the
// crackling floor it leaves, lantern throws, scythe knockback on you, banners and the boss bar text.
import * as THREE from 'three';
import { hitboxes } from '/shared/physics.js';

const HB = hitboxes(0), SHOULDER = HB[4].c[1] + HB[4].h[1], HEAD_TOP = HB[8].c[1] + HB[8].h[1];
const VIOLET = 0x9b6bff, SPARK = 0xe4d8ff, BRONZE = 0xa8742c, SOOT = 0x15121b, SEALED = 0x3a2f4d;
const PATCH_R = 2.5, PATCH_LIFE = 4, RISE = 2.5; // match GRAVE.voltR / voltLife / rise (seconds)

export class GravekeeperView {
  constructor(h) {
    this.h = h;
    this.g = h.g;
    this.ents = h.ents;
    this.world = h.world;
    this.root = new THREE.Group();
    this.world.scene.add(this.root);
    this.t = 0;
    this.bellGeo = new THREE.CylinderGeometry(0.1, 0.27, 0.38, 16);
    this.arcGeo = new THREE.RingGeometry(0.8, 1, 24, 1, Math.PI / 12, (Math.PI * 5) / 6).rotateX(-Math.PI / 2); // 150° centred on -z (his front)
    this.wardMat = new THREE.MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.crackleMat = new THREE.LineBasicMaterial({ color: SPARK, transparent: true, opacity: 0.9 });
    this.body = this.buildBody();
    Object.assign(this, { id: null, ward: false, pits: new Map(), bolts: [], patches: [], lanterns: [], flashes: [], lanternBack: 0 });
  }

  // what he carries, in unscaled model units (posed onto his zombie every frame, scaled by his size)
  buildBody() {
    const E = this.ents, g = new THREE.Group();
    g.visible = false;
    E.mesh(E.cyl, SOOT, g, [0, HEAD_TOP + 0.13, -0.01], [0.1, 0.26, 0.1]);   // top hat
    E.mesh(E.cyl, SOOT, g, [0, HEAD_TOP + 0.01, -0.01], [0.19, 0.02, 0.19]); // brim
    const bell = new THREE.Group();
    bell.position.set(0, 1.3, 0.42);
    bell.add(new THREE.Mesh(this.bellGeo, E.mat(BRONZE)));
    E.mesh(E.sphere, 0x5a3a14, bell, [0, -0.2, 0], [0.05, 0.05, 0.05]);      // clapper
    E.mesh(E.box, 0x3a2a1a, g, [0, 1.52, 0.3], [0.5, 0.05, 0.05]);           // yoke over his shoulders
    const bellGlow = E.sprite(0xffc86b, 1.3, bell, [0, 0, 0]);
    g.add(bell);
    const scythe = new THREE.Group(); // pivots at the right shoulder, swings with the arm
    scythe.position.set(0.3, SHOULDER, 0);
    E.mesh(E.cyl, 0x4a3a2a, scythe, [-0.1, -0.1, -0.48], [0.022, 1.7, 0.022]);
    E.mesh(E.box, 0xc9ccd2, scythe, [0.2, 0.72, -0.48], [0.62, 0.06, 0.015]).rotation.z = -0.35;
    g.add(scythe);
    const lantern = new THREE.Group(); // left hand
    lantern.position.set(-0.3, SHOULDER, 0);
    E.mesh(E.box, 0x2b2f35, lantern, [0.13, -0.33, -0.48], [0.012, 0.14, 0.012]); // chain
    const lanternMesh = E.mesh(E.box, 0x2b2f35, lantern, [0.13, -0.47, -0.48], [0.1, 0.14, 0.1]);
    E.sprite(0x9dffb0, 0.5, lanternMesh, [0, 0, 0]).scale.setScalar(5); // the mesh is 0.1 wide: scale the glow back up
    g.add(lantern);
    const ward = new THREE.Mesh(E.sphere, this.wardMat);
    ward.position.y = 1;
    ward.scale.set(0.62, 1.1, 0.62);
    g.add(ward);
    this.root.add(g);
    return { g, bell, bellGlow, scythe, lantern, lanternMesh, ward };
  }

  onMsg(m) {
    const hud = this.g.hud, zb = this.boss();
    switch (m.ev) {
      case 'start':
        this.id = m.id; this.ward = !!m.ward; this.setPits(m.pits);
        if (!m.sync) { hud.banner('THE GRAVEKEEPER', 'Seal his grave pits with CONES to break his ward', 'lose', 5000); this.toll(); }
        return;
      case 'pits': return this.setPits(m.l);
      case 'ward':
        this.ward = m.on;
        if (!m.on) { hud.banner('THE WARD IS DOWN', 'Every grave is sealed — shoot the bell on his back!', 'win', 3500); this.g.sound.play('win', { vol: 0.5, rate: 1.3 }); }
        else if (m.broke) { hud.banner('A GRAVE REOPENED', 'The ward is back — reseal it with a cone', 'lose', 3500); this.g.sound.play('core_alarm', { vol: 0.4 }); }
        return;
      case 'toll': return this.toll();
      case 'bolt': return this.bolt(m.p, m.ms);
      case 'lantern': return this.throwLantern(m);
      case 'lboom':
        this.world.burst(m.p, [0, 1, 0], 0x9dffb0, 24, 5);
        this.g.sound.play('explode', { pos: m.p, vol: 1.1, ref: 6, rate: 1.3 });
        return;
      case 'sweep': return zb && this.sweepFx(zb);
      case 'knock': return this.knock(m.v);
      case 'stage':
        if (m.stage === 2) hud.banner('THE GRAVES WIDEN', 'Two more pits opened — seal them!', 'lose', 3500);
        else { hud.banner('DEATH KNELL', 'Lightning hunts every one of you — keep moving!', 'lose', 4000); this.h.alert('DEATH KNELL — KEEP MOVING', m.ms / 1000); }
        this.toll();
        return;
      case 'die':
        hud.banner('THE GRAVEKEEPER FALLS', `${this.g.name(m.by) || 'The squad'} rang his last knell · he dropped the Knell!`, 'win', 5000);
        this.g.sound.play('win', { vol: 0.7 });
        if (zb) for (let i = 0; i < 6; i++) this.world.burst([zb.pos[0], 1 + i * 0.7, zb.pos[2]], [0, 1, 0], VIOLET, 14, 5);
        this.clear(true);
        return;
      case 'end': return this.clear(true);
    }
  }

  boss() { const zb = this.id != null && this.h.zombies.list.get(this.id); return zb && !zb.dead ? zb : null; }

  setPits(list) {
    const keep = new Set(list.map(p => p[0]));
    for (const id of [...this.pits.keys()]) if (!keep.has(id)) this.removePit(id);
    for (const [id, x, z, sealed] of list) {
      let p = this.pits.get(id);
      if (!p) {
        const g = new THREE.Group(), cracks = [];
        g.position.set(x, 0.035, z);
        for (let i = 0; i < 7; i++) { // jagged violet cracks radiating from the grave
          const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5, len = 0.8 + Math.random() * 1.1;
          const c = this.ents.mesh(this.ents.box, VIOLET, g, [(Math.cos(a) * len) / 2, 0, (Math.sin(a) * len) / 2], [len, 0.02, 0.08], { basic: true });
          c.rotation.y = -a;
          cracks.push(c);
        }
        const glow = this.ents.sprite(VIOLET, 3.2, g, [0, 0.5, 0]);
        this.root.add(g);
        p = { id, x, z, g, cracks, glow, sealed: null };
        this.pits.set(id, p);
      }
      if (p.sealed === !!sealed) continue;
      p.sealed = !!sealed;
      p.glow.visible = !p.sealed;
      for (const c of p.cracks) c.material = this.ents.mat(p.sealed ? SEALED : VIOLET, { basic: true });
    }
  }

  removePit(id) {
    const p = this.pits.get(id);
    this.root.remove(p.g);
    p.glow.material.dispose();
    this.pits.delete(id);
  }

  // the bell tolls: a deep chime and a violet ring rolling out from him; open graves flare
  toll() {
    const zb = this.boss(), at = zb ? [zb.pos[0], 3, zb.pos[2]] : null;
    this.g.sound.play('chest_chime', { pos: at ?? undefined, vol: 1.6, ref: 40, rate: 0.28 });
    if (zb) this.flash(this.ents.ring, [zb.pos[0], 0.1, zb.pos[2]], VIOLET, 0.8, 14 / 0.62);
    for (const p of this.pits.values()) if (!p.sealed) p.flare = 1;
  }

  bolt([x, z], ms) {
    const mat = new THREE.MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(this.ents.ring, mat);
    ring.position.set(x, 0.07, z);
    ring.scale.set(PATCH_R / 0.62, 1, PATCH_R / 0.62);
    this.root.add(ring);
    this.bolts.push({ x, z, ring, at: this.t + ms / 1000 });
  }

  // the bolt lands: a jagged streak from the sky, a thunderclap, and a crackling patch where it hit
  strike(x, z) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const k = i / 12, j = i && i < 12 ? 0.7 : 0; pts.push(new THREE.Vector3(x + (Math.random() - 0.5) * j, 34 * (1 - k), z + (Math.random() - 0.5) * j)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: SPARK, transparent: true, opacity: 1 }));
    this.root.add(line);
    this.flashes.push({ s: line, t: 0.25, T: 0.25 });
    this.flash(null, [x, 1.2, z], SPARK, 0.3, 7);
    this.world.burst([x, 0.2, z], [0, 1, 0], VIOLET, 14, 5);
    this.world.burst([x, 0.1, z], [0, 1, 0], 0x6b5237, 10, 3);
    const me = this.g.player.pos, d = Math.hypot(me[0] - x, me[2] - z);
    this.g.sound.play('zap', { pos: [x, 1, z], vol: 1.3, ref: 6 });
    this.g.sound.play('explode', { pos: [x, 4, z], vol: 0.8, ref: 12, rate: 1.8 });
    if (d < 10) this.h.shake = Math.max(this.h.shake, 0.5 * (1 - d / 10));
    const crackle = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 8 }, () => new THREE.Vector3())), this.crackleMat);
    this.root.add(crackle);
    this.patches.push({ x, z, crackle, until: this.t + PATCH_LIFE, rise: this.t + RISE, next: 0 });
  }

  throwLantern(m) {
    const g = new THREE.Group();
    this.ents.mesh(this.ents.box, 0x2b2f35, g, [0, 0, 0], [0.3, 0.42, 0.3]);
    const glow = this.ents.sprite(0x9dffb0, 1.8, g, [0, 0, 0]);
    g.position.set(...m.a);
    this.root.add(g);
    this.lanterns.push({ g, glow, a: m.a, b: m.b, t0: this.t, T: m.ms / 1000 });
    this.lanternBack = this.t + m.ms / 1000 + 1;
    this.g.sound.play('throw', { pos: m.a, vol: 1, ref: 8, rate: 0.6 });
  }

  sweepFx(zb) {
    this.flash(this.arcGeo, [zb.pos[0], zb.pos[1] + 0.9 * zb.s, zb.pos[2]], 0xc9ccd2, 0.3, zb.t.reach + 1, zb.yaw);
    this.g.sound.play('z_swipe', { pos: zb.pos, vol: 1.5, ref: 8, rate: 0.5 });
  }

  // his scythe caught you: thrown back and up (the server skips Tanks)
  knock(v) {
    const pl = this.g.player;
    if (!pl.alive) return;
    pl.vel[0] += v[0]; pl.vel[2] += v[2]; pl.vel[1] = Math.max(pl.vel[1], v[1]);
    pl.grounded = false;
    this.h.shake = Math.max(this.h.shake, 0.7);
  }

  // a short-lived additive flash: geo = a flat shape (grows as it fades) or null for a glow sprite
  flash(geo, p, color, T, size, yaw = 0) {
    const mat = geo ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
      : new THREE.SpriteMaterial({ map: this.ents.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = geo ? new THREE.Mesh(geo, mat) : new THREE.Sprite(mat);
    s.position.set(...p);
    s.rotation.y = yaw;
    s.scale.setScalar(size);
    if (geo) s.scale.y = 1;
    this.root.add(s);
    this.flashes.push({ s, t: T, T, grow: geo ? size : 0 });
  }

  update(dt) {
    this.t += dt;
    this.poseBody();
    for (const p of this.pits.values()) {
      if (p.sealed) continue;
      p.flare = Math.max(0, (p.flare ?? 0) - dt * 1.5);
      p.glow.material.opacity = 0.35 + 0.15 * Math.sin(this.t * 3 + p.id) + p.flare * 0.5;
      p.glow.scale.setScalar(3.2 * (1 + p.flare * 0.6));
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.ring.material.opacity = 0.45 + 0.4 * Math.abs(Math.sin(this.t * 14));
      if (this.t < b.at) continue;
      this.root.remove(b.ring);
      b.ring.material.dispose();
      this.bolts.splice(i, 1);
      this.strike(b.x, b.z);
    }
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      if (this.t > p.until) { this.root.remove(p.crackle); p.crackle.geometry.dispose(); this.patches.splice(i, 1); continue; }
      if (this.t < p.next) continue;
      p.next = this.t + 0.07;
      const a = Math.random() * Math.PI * 2, r = Math.random() * PATCH_R, pos = p.crackle.geometry.attributes.position; // a fresh jagged spark each tick
      let x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      for (let k = 0; k < pos.count; k++) { pos.setXYZ(k, x, 0.05 + Math.random() * 0.25, z); x += (Math.random() - 0.5) * 0.7; z += (Math.random() - 0.5) * 0.7; }
      pos.needsUpdate = true;
      p.crackle.geometry.computeBoundingSphere();
      if (this.t < p.rise) this.world.burst([p.x, 0.1, p.z], [0, 1, 0], Math.random() < 0.5 ? 0x6b5237 : VIOLET, 2, 2); // something clawing its way up
    }
    for (let i = this.lanterns.length - 1; i >= 0; i--) {
      const L = this.lanterns[i], k = Math.min(1, (this.t - L.t0) / L.T);
      L.g.position.set(L.a[0] + (L.b[0] - L.a[0]) * k, L.a[1] + (L.b[1] - L.a[1]) * k + 16 * k * (1 - k), L.a[2] + (L.b[2] - L.a[2]) * k);
      L.g.rotation.y += dt * 8;
      if (k < 1) continue;
      this.root.remove(L.g);
      L.glow.material.dispose();
      this.lanterns.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      f.s.material.opacity = Math.max(0, f.t / f.T);
      if (f.grow) f.s.scale.set(f.grow * (1.3 - (0.3 * f.t) / f.T), 1, f.grow * (1.3 - (0.3 * f.t) / f.T));
      if (f.t > 0) continue;
      this.root.remove(f.s);
      f.s.material.dispose();
      if (f.s.isLine) f.s.geometry.dispose();
      this.flashes.splice(i, 1);
    }
  }

  // follows the rig's pose (zombies.js pose(): lean, sway, and the arm raising on the wind-up / slamming down)
  poseBody() {
    const b = this.body, zb = this.boss();
    b.g.visible = !!zb;
    if (!zb) return;
    const ph = zb.phase, sway = Math.sin(ph * 0.5);
    b.g.position.set(zb.pos[0], zb.pos[1], zb.pos[2]);
    b.g.rotation.set(-(0.18 + sway * 0.04), zb.yaw + sway * 0.06 * zb.wobble, sway * 0.05 * zb.wobble, 'YXZ');
    b.g.scale.setScalar(zb.s);
    let arm = Math.sin(ph * 0.5 + 1) * 0.12, swing = 0.4;
    if (zb.st === 1) { arm = Math.min(1, zb.stT / Math.max(0.2, zb.t.windup)) * 1.2; swing = 0.9; }
    else if (zb.st === 2) { arm = 0.3; swing = 0.9 - 1.8 * Math.min(1, zb.stT / 0.25); }
    b.scythe.rotation.set(arm, swing, 0, 'YXZ');
    b.lantern.rotation.x = Math.sin(ph * 0.5 + 1) * 0.12;
    b.lanternMesh.visible = this.t > this.lanternBack;
    b.ward.visible = this.ward;
    this.wardMat.opacity = 0.12 + 0.06 * Math.sin(this.t * 3);
    b.bellGlow.visible = !this.ward;
    b.bellGlow.material.opacity = 0.55 + 0.35 * Math.sin(this.t * 5);
  }

  // boss bar (holdout.js): { name, frac } while he's up
  bar() {
    const zb = this.boss();
    if (!zb) return null;
    const open = [...this.pits.values()].filter(p => !p.sealed).length;
    return { name: `THE GRAVEKEEPER · ${this.ward ? `WARDED — ${open} grave${open === 1 ? '' : 's'} open` : 'WARD DOWN — SHOOT THE BELL'}`, frac: zb.hp };
  }

  // minimap / full map (minimap.js): open graves a violet X in a ring, sealed ones a grey X
  drawMap(c, X, Z, k) {
    c.lineWidth = 2 * k;
    for (const p of this.pits.values()) {
      const x = X(p.x), z = Z(p.z), r = 3.5 * k;
      c.strokeStyle = p.sealed ? '#6b6478' : '#b58cff';
      c.beginPath(); c.moveTo(x - r, z - r); c.lineTo(x + r, z + r); c.moveTo(x + r, z - r); c.lineTo(x - r, z + r); c.stroke();
      if (!p.sealed) { c.beginPath(); c.arc(x, z, r * 1.5, 0, Math.PI * 2); c.stroke(); }
    }
  }

  // everything goes (his death, a defeat, a new world); volt: also the crackling floor the server just dropped
  clear(volt = false) {
    for (const id of [...this.pits.keys()]) this.removePit(id);
    for (const b of this.bolts) { this.root.remove(b.ring); b.ring.material.dispose(); }
    for (const p of this.patches) { this.root.remove(p.crackle); p.crackle.geometry.dispose(); }
    for (const L of this.lanterns) { this.root.remove(L.g); L.glow.material.dispose(); }
    for (const f of this.flashes) { this.root.remove(f.s); f.s.material.dispose(); if (f.s.isLine) f.s.geometry.dispose(); }
    Object.assign(this, { id: null, ward: false, bolts: [], patches: [], lanterns: [], flashes: [] });
    this.body.g.visible = false;
    const hz = this.ents.hazards;
    if (volt && hz) for (let i = hz.length - 1; i >= 0; i--) if (hz[i].k === 'volt') { this.ents.root.remove(hz[i].disc); hz[i].disc.geometry.dispose(); hz.splice(i, 1); }
  }

  dispose() {
    this.clear();
    this.world.scene.remove(this.root);
    this.body.bellGlow.material.dispose();
    this.body.lanternMesh.children[0].material.dispose();
    for (const x of [this.bellGeo, this.arcGeo, this.wardMat, this.crackleMat]) x.dispose();
  }
}
