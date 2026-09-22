// The Behemoth on the client (wave 25, server/holdout/behemoth.js): its model, the deck you ride (standing on it
// moves you with it), the hatch bolts your harvest tool breaks, the open reactor hearts your guns can hit (the rest
// of it answers IMMUNE), siege-shell telegraphs and the boss bar. Its body box joins holdout.js's collision boxes.
import * as THREE from 'three';
import { BEHEMOTH as B, HATCHES, BOLTS, bhmBox, heartPos, boltPos, onDeck } from '/shared/behemoth.js';
import { raySphere } from '/shared/skyboss.js';
import { rayBox } from '/shared/physics.js';

const IRON = 0x464b53, DARK = 0x2b2e33, RUST = 0x7a4a2a, FLESH = 0x5e3c3a, DECK = 0x6d6457, GLOW = 0xff7a2a, HEART = 0xff2a3c, BOLT = 0xffd23c;

export class BehemothView {
  constructor(h) { this.h = h; this.b = null; this.boxes = []; this.shells = []; this.immuneAt = 0; }

  get alive() { return !!this.b && !this.b.dead; }

  onMsg(m) {
    const h = this.h, g = h.g, b = this.b;
    if (m.ev === 'warn') { g.hud.banner('THE BEHEMOTH', 'A walking fortress is coming — stair up onto its deck, break the hatch bolts with your harvest tool, shoot the hearts', 'lose', 5000); g.sound.play('wave_horn', { vol: 1, rate: 0.5 }); return; }
    if (m.ev === 'enter' || m.ev === 'sync') return this.start(m);
    if (!this.alive) return;
    switch (m.ev) {
      case 'mv': b.sx = m.x; b.sz = m.z; b.on = !!m.on; return;
      case 'brace': b.braceUntil = b.t + m.ms / 1000; g.sound.play('brute_roar', { pos: [b.x, 5, b.z], vol: 1.4, ref: 20, rate: 0.45 }); return;
      case 'shell': return this.addShell(m);
      case 'shellhit': { // a Tank's barrier took it in mid-air
        const i = this.shells.findIndex(s => s.id === m.id);
        h.world.burst(m.p, [0, 1, 0], GLOW, 24, 6);
        g.sound.play('explode', { pos: m.p, vol: 1.3, ref: 8, rate: 0.8 });
        if (i >= 0) this.removeShell(i);
        return;
      }
      case 'crush': h.world.burst(m.p, [0, 1, 0], 0x8a7a5a, 18, 5); g.sound.play('break_Z', { pos: m.p, vol: 1.3, ref: 8, rate: 0.6 }); return;
      case 'crew': h.world.burst(m.p, [0, 1, 0], FLESH, 12, 3); return;
      case 'bolt': {
        b.hearts[m.h].bolts[m.j] = m.n;
        const p = boltPos(b, m.h, m.j);
        h.world.burst(p, [0, 1, 0], BOLT, m.n ? 6 : 16, m.n ? 2.5 : 4);
        g.sound.play(m.n ? 'weak_hit' : 'break_Z', { pos: p, vol: 1, ref: 4, rate: m.n ? 1 : 1.3 });
        return;
      }
      case 'open': b.hearts[m.h].open = true; h.alert('A REACTOR HEART IS EXPOSED — SHOOT IT', 3); g.sound.play('sky_roar', { pos: [b.x, 6, b.z], vol: 1.2, ref: 20, rate: 0.8 }); return;
      case 'hp': b.hearts[m.h].hp = m.hp; return;
      case 'heart': {
        b.hearts[m.h].hp = 0;
        b.rearT = 0;
        const p = heartPos(b, m.h), d = Math.hypot(p[0] - g.player.pos[0], p[2] - g.player.pos[2]);
        for (let i = 0; i < 4; i++) h.world.burst(p, [0, 1, 0], i % 2 ? HEART : GLOW, 24, 8);
        g.sound.play('explode', { pos: p, vol: 1.8, ref: 15, rate: 0.6 });
        g.sound.play('sky_roar', { pos: p, vol: 1.5, ref: 25, rate: 0.55 });
        if (d < 25) h.shake = Math.max(h.shake, 1 - d / 25);
        return;
      }
      case 'kb': { const v = g.player.vel; v[0] = m.v[0]; v[1] = m.v[1]; v[2] = m.v[2]; g.player.grounded = false; return; }
      case 'siege': b.slamAt = b.t + m.ms / 1000; h.alert('THE BEHEMOTH REACHED THE CORE', 4); g.sound.play('core_alarm', { vol: 1 }); return;
      case 'slam': {
        b.slamAt = b.t + m.ms / 1000;
        const p = [b.x + b.fx * B.len / 2, 0.3, b.z + b.fz * B.len / 2], d = Math.hypot(p[0] - g.player.pos[0], p[2] - g.player.pos[2]);
        for (let i = 0; i < 6; i++) h.world.burst([p[0] + (Math.random() - 0.5) * 4, 0.3, p[2] + (Math.random() - 0.5) * 4], [0, 1, 0], 0x7a6a55, 10, 6);
        g.sound.play('explode', { pos: p, vol: 2, ref: 20, rate: 0.45 });
        if (d < 30) h.shake = Math.max(h.shake, 1.2 - d / 25);
        return;
      }
      case 'die': return this.die(m);
    }
  }

  start(m) {
    this.clear();
    const hearts = m.hearts.map(([hp, max, open, ...bolts]) => ({ hp, max, open: !!open, bolts }));
    const b = this.b = { x: m.x, z: m.z, sx: m.x, sz: m.z, fx: m.fx, fz: m.fz, on: !!m.on, hearts, t: 0, walk: 0, rearT: 9, braceUntil: 0, slamAt: m.mode === 'siege' ? B.slamEvery / 1000 : 0, dead: false };
    b.box = bhmBox(b);
    b.view = this.build();
    this.boxes = [b.box];
    this.h.refreshBoxes();
    if (m.ev === 'enter') this.h.g.sound.play('sky_roar', { pos: [b.x, 5, b.z], vol: 1.6, ref: 40, rate: 0.4 });
  }

  // Everything drawn sits inside its collision box: what you see is what stops you.
  build() {
    const E = this.h.ents, g = new THREE.Group(), pivot = new THREE.Group(), body = new THREE.Group(), L = B.len, W = B.wide, D = B.deck;
    g.add(pivot);
    pivot.add(body);
    pivot.position.z = -L / 2; body.position.z = L / 2; // rears up around its hind feet
    g.rotation.y = Math.atan2(this.b.fx, this.b.fz);  // local +z = its heading, +x = its right (shared/behemoth.js bhmPoint)
    const box = (color, pos, scale, parent = body, opts) => E.mesh(E.box, color, parent, pos, scale, opts);
    box(IRON, [0, 4.75, -0.4], [W - 0.3, 3.2, L - 1.4]);
    box(DECK, [0, D - 0.06, 0], [W, 0.12, L]);
    box(FLESH, [0, 2.9, -0.4], [W - 1.8, 0.6, L - 2.6]);
    for (const s of [-1, 1]) {
      box(DARK, [s * (W / 2 - 0.12), 5.1, -0.4], [0.24, 2.2, L - 2]);
      box(RUST, [s * (W / 2 - 0.1), D - 0.2, 0], [0.2, 0.3, L]);
    }
    const head = new THREE.Group();
    head.position.set(0, 4.3, L / 2 - 1.1);
    body.add(head);
    box(IRON, [0, 0.4, 0], [3.2, 2.4, 2.1], head);
    box(FLESH, [0, -0.95, 0.2], [2.6, 0.7, 1.5], head);
    for (const s of [-1, 1]) box(GLOW, [s * 0.8, 0.7, 1.06], [0.55, 0.22, 0.05], head, { basic: true });
    const mortar = new THREE.Group();
    mortar.position.set(0, D, L / 2 - 1);
    body.add(mortar);
    E.mesh(E.cyl, DARK, mortar, [0, 0.5, 0.25], [0.42, 1.3, 0.42]).rotation.x = 0.7;
    const legs = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([s, f]) => {
      const leg = new THREE.Group();
      leg.position.set(s * (W / 2 - 0.95), 3.3, f * (L / 2 - 1.7));
      body.add(leg);
      box(IRON, [0, -0.8, 0], [1.5, 2.0, 1.6], leg);
      box(DARK, [0, -2.3, 0], [1.3, 1.4, 1.3], leg);
      box(RUST, [0, -3.15, 0.1], [1.7, 0.3, 1.9], leg);
      leg.userData.side = s;
      return leg;
    });
    const glows = [];
    const hatches = HATCHES.map(f => {
      const hinge = new THREE.Group(); // on the hatch's rear edge, so it flips open backwards
      hinge.position.set(0, D, f - 0.95);
      body.add(hinge);
      box(RUST, [0, 0.06, 0.95], [1.8, 0.12, 1.9], hinge);
      const bolts = BOLTS.map(([s, df]) => E.mesh(E.cyl, BOLT, body, [s, D + 0.1, f + df], [0.14, 0.2, 0.14], { basic: true }));
      const heart = E.mesh(E.sphere, HEART, body, [0, D - 1, f], [B.heartR, B.heartR, B.heartR], { basic: true });
      glows.push(E.sprite(HEART, 3.5, heart, [0, 0, 0]));
      return { hinge, bolts, heart };
    });
    E.root.add(g);
    return { g, pivot, head, mortar, legs, hatches, glows };
  }

  update(dt) {
    this.updateShells(dt);
    const b = this.b, g = this.h.g;
    if (!b) return;
    b.t += dt;
    const v = b.view;
    if (b.dead) { // collapses onto its side and sinks, then it's gone
      b.deadT += dt;
      v.pivot.rotation.z = Math.min(0.5, b.deadT * 0.3);
      v.g.position.y = -Math.max(0, b.deadT - 1.2) * 1.2;
      if (Math.random() < dt * 8) this.h.world.burst([b.x + (Math.random() - 0.5) * B.wide, 0.5, b.z + (Math.random() - 0.5) * B.len], [0, 1, 0], 0x7a6a55, 8, 4);
      if (b.deadT > 5) this.clear();
      return;
    }
    // dead reckoning between the server's 'mv's, easing out whatever correction they bring
    const step = b.on ? B.speed * dt : 0, k = Math.min(1, dt * 4), pl = g.player;
    const dx = b.fx * step + (b.sx - b.x) * k, dz = b.fz * step + (b.sz - b.z) * k;
    b.sx += b.fx * step; b.sz += b.fz * step;
    if (pl.alive && pl.grounded && onDeck(pl.pos, b.box)) { pl.pos[0] += dx; pl.pos[2] += dz; g.prevPos[0] += dx; g.prevPos[2] += dz; } // you ride the deck
    b.x += dx; b.z += dz;
    bhmBox(b, b.box);
    this.unstick(pl);
    // the model
    v.g.position.set(b.x, 0, b.z);
    const moving = Math.hypot(dx, dz) > dt * 0.3, braced = b.t < b.braceUntil;
    if (moving) b.walk += dt * 3.4;
    v.legs.forEach((leg, i) => {
      leg.rotation.x += ((moving ? Math.sin(b.walk + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.3 : 0) - leg.rotation.x) * Math.min(1, dt * 8);
      leg.rotation.z += ((braced ? leg.userData.side * -0.16 : 0) - leg.rotation.z) * Math.min(1, dt * 4);
    });
    v.head.rotation.x = Math.sin(b.walk * 0.5) * 0.06;
    v.mortar.rotation.x = braced ? -0.35 : 0;
    const u = b.slamAt ? b.slamAt - b.t : 9, slam = u < 1.2 ? Math.min(1, 1 - u / 1.2) : 0; // front lifts before each slam
    const rear = b.rearT < B.rear / 1000 ? Math.sin((Math.PI * b.rearT) / (B.rear / 1000)) : 0;
    b.rearT += dt;
    v.pivot.rotation.x = -0.38 * rear - 0.25 * slam;
    b.hearts.forEach((hh, i) => {
      const hv = v.hatches[i];
      hv.hinge.rotation.x += ((hh.open ? -1.9 : 0) - hv.hinge.rotation.x) * Math.min(1, dt * 4);
      hv.bolts.forEach((m, j) => { m.visible = hh.bolts[j] > 0; });
      hv.heart.visible = hh.open && hh.hp > 0;
      if (hv.heart.visible) {
        hv.heart.position.y += (B.deck + B.heartUp - hv.heart.position.y) * Math.min(1, dt * 3);
        hv.heart.scale.setScalar(B.heartR * (1 + Math.sin(b.t * 7 + i) * 0.08));
      }
    });
  }

  // You never end up inside it: stepped out through the nearest face (the server knocks you aside as well).
  unstick(pl) {
    const p = pl.pos, box = this.b.box, r = 0.4;
    if (!pl.alive || p[1] > B.deck - 0.3 || p[0] + r <= box.min[0] || p[0] - r >= box.max[0] || p[2] + r <= box.min[2] || p[2] - r >= box.max[2]) return;
    const [a, to] = [[0, box.min[0] - r - 0.01], [0, box.max[0] + r + 0.01], [2, box.min[2] - r - 0.01], [2, box.max[2] + r + 0.01]]
      .reduce((best, o) => (Math.abs(o[1] - p[o[0]]) < Math.abs(best[1] - p[best[0]]) ? o : best));
    this.h.g.prevPos[a] += to - p[a];
    p[a] = to;
  }

  // One pellet of a gun shot (weapons.js fire): an open heart in front of whatever it hit takes it (claimed as
  // [heart, pellet]); a round that stops on the armour instead answers IMMUNE. Returns the pellet's end distance.
  trace(eye, d, endT, k, out) {
    const b = this.b;
    if (!this.alive) return endT;
    let hit = -1, t = endT;
    b.hearts.forEach((hh, i) => {
      if (!hh.open || hh.hp <= 0) return;
      const s = raySphere(eye, d, heartPos(b, i), B.heartR);
      if (s >= 0 && s < t) { t = s; hit = i; }
    });
    if (hit >= 0) {
      out.push([hit, k]);
      this.h.world.burst(eye.map((v, j) => v + d[j] * t), [0, 1, 0], HEART, 6, 3);
      return t;
    }
    const r = rayBox(eye, d, b.box.min, b.box.max), g = this.h.g;
    if (r && r.t <= endT + 0.05 && g.now > this.immuneAt) {
      this.immuneAt = g.now + 3;
      this.h.say(`IMMUNE — break a hatch's three bolts with your harvest tool (${this.h.keyOr('inspect')}), then shoot the reactor heart`, 2.5);
      g.sound.play('dink', { vol: 0.6 });
    }
    return endT;
  }

  // The harvest tool on a hatch bolt (holdout.js harvestSwing): the server counts the hits.
  swing(eye, dir, reach) {
    const b = this.b;
    if (!this.alive) return false;
    let hit = null, bt = reach;
    b.hearts.forEach((hh, i) => {
      if (!hh.open) hh.bolts.forEach((n, j) => { const t = n > 0 ? raySphere(eye, dir, boltPos(b, i, j), B.boltR + 0.1) : -1; if (t >= 0 && t < bt) { bt = t; hit = [i, j]; } });
    });
    if (!hit) return false;
    this.h.g.net.send({ t: 'harvest', bolt: hit });
    this.h.world.burst(eye.map((v, j) => v + dir[j] * bt), [0, 1, 0], BOLT, 6, 2.5);
    this.h.g.sound.play('chop_zink', { vol: 0.8, rate: 0.7 });
    return true;
  }

  addShell(m) {
    const E = this.h.ents, T = m.ms / 1000, at = t => [m.o[0] + m.v[0] * t, m.o[1] + m.v[1] * t - 0.5 * B.shellG * t * t, m.o[2] + m.v[2] * t];
    const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 25 }, (_, i) => new THREE.Vector3(...at((T * i) / 24)))),
      new THREE.LineBasicMaterial({ color: GLOW, transparent: true, opacity: 0.75 }));
    const end = at(T), ring = new THREE.Mesh(E.ring, new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.set(end[0], 0.08, end[2]);
    ring.scale.set(B.shellR / 0.62, 1, B.shellR / 0.62);
    const ball = E.mesh(E.sphere, DARK, E.root, m.o, [0.4, 0.4, 0.4]);
    E.root.add(arc, ring);
    this.shells.push({ id: m.id, at, T, t: 0, arc, ring, ball, end });
    this.h.g.sound.play('shot_rocket', { pos: m.o, vol: 1.3, ref: 20, rate: 0.5 });
  }

  updateShells(dt) {
    const h = this.h;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      s.ball.position.set(...s.at(Math.min(s.t, s.T)));
      s.ring.material.opacity = 0.45 + 0.35 * Math.sin(s.t * 14);
      if (s.t < s.T) continue;
      h.world.burst(s.end, [0, 1, 0], GLOW, 30, 7);
      h.g.sound.play('explode', { pos: s.end, vol: 1.6, ref: 10, rate: 0.7 });
      const d = Math.hypot(s.end[0] - h.g.player.pos[0], s.end[2] - h.g.player.pos[2]);
      if (d < 15) h.shake = Math.max(h.shake, 1 - d / 15);
      this.removeShell(i);
    }
  }

  removeShell(i) {
    const s = this.shells[i];
    this.h.ents.root.remove(s.arc, s.ring, s.ball);
    s.arc.geometry.dispose();
    s.arc.material.dispose();
    s.ring.material.dispose();
    this.shells.splice(i, 1);
  }

  die(m) {
    const b = this.b, h = this.h;
    b.dead = true;
    b.deadT = 0;
    this.boxes = [];
    h.refreshBoxes();
    for (let i = 0; i < 8; i++) h.world.burst([b.x + (Math.random() - 0.5) * B.wide, 2 + Math.random() * 4, b.z + (Math.random() - 0.5) * B.len], [0, 1, 0], i % 2 ? GLOW : 0x7a6a55, 24, 8);
    h.g.sound.play('explode', { pos: [b.x, 4, b.z], vol: 2, ref: 25, rate: 0.4 });
    h.g.hud.banner('THE BEHEMOTH FALLS', `${m.by ? h.g.name(m.by) : 'The squad'} burst its last heart · it dropped the Siegebreaker`, 'win', 5000);
    h.g.sound.play('win', { vol: 0.7 });
  }

  // boss bar (holdout.js refreshHud): its hearts, and what to do next
  bar() {
    if (!this.alive) return null;
    const hs = this.b.hearts, left = hs.filter(x => x.hp > 0).length, open = hs.filter(x => x.open && x.hp > 0).length;
    return { name: `THE BEHEMOTH · hearts ${left}/${hs.length} · ${open ? 'HEART EXPOSED — SHOOT IT' : 'break the hatch bolts'}`, frac: hs.reduce((s, x) => s + Math.max(0, x.hp), 0) / hs.reduce((s, x) => s + x.max, 0) };
  }

  // gone for good (dead and sunk, or a new world): the model, its shells, its collision box
  clear() {
    while (this.shells.length) this.removeShell(0);
    const v = this.b?.view;
    if (v) { this.h.ents.root.remove(v.g); for (const s of v.glows) s.material.dispose(); }
    this.b = null;
    if (this.boxes.length) { this.boxes = []; this.h.refreshBoxes(); }
  }
}
