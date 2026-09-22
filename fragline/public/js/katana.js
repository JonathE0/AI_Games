// The Ronin's Zinkonium Katana on the client (server/holdout/ronin.js decides every hit): the first-person blade and its
// moves (buildKatana — models.js builds and poses it), and KatanaView: the LMB combo with its arc hit claims, RMB Fire
// Strike, Deflect on the reload key, the dash, the cooldown pips by the crosshair, and the effects everyone sees —
// flaming crescents, slash arcs, dash afterimages, deflect sparks and reflections, bleed drips, executions.
import * as THREE from 'three';
import { KATANA as K } from '/shared/holdout.js';
import { ELEMENTS } from '/shared/elements.js';
import { OUTPOST_STATIC } from '/shared/outpost.js';
import { rayWorld, dirFromAngles } from '/shared/physics.js';
import { setHTML, setHidden, setStyle } from './hud.js';

const DEG = Math.PI / 180;
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const EDGE = 0x5ee6d0; // Zinkonium's glow on a blade with no element
const edgeHex = el => (el ? ELEMENTS[el].hex : EDGE);
const ease = x => x * x * (3 - 2 * x);
const rotY = (v, deg) => { const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [v[0] * c + v[2] * s, v[1], v[2] * c - v[0] * s]; };
const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });

// ---------- the first-person katana ----------
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// polished steel, the wavy temper line (hamon) running along the edge side
const bladeTex = () => canvasTex(256, 64, (c, w, h) => {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#8e98a3'); g.addColorStop(0.45, '#d9e0e7'); g.addColorStop(1, '#f4f7fa');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 3; c.beginPath();
  for (let x = 0; x <= w; x += 4) c.lineTo(x, h * 0.62 + Math.sin(x * 0.11) * 4 + Math.sin(x * 0.037) * 3);
  c.stroke();
});
// the grip's cord wrap: dark diamonds over pale ray skin
const wrapTex = () => canvasTex(64, 128, (c, w, h) => {
  c.fillStyle = '#d8d0bd'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#15171d';
  for (let y = -16; y < h; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(w / 2, y + 8); c.lineTo(w, y); c.lineTo(w, y + 6); c.lineTo(w / 2, y + 14); c.lineTo(0, y + 6); c.fill(); }
});
// UVs stretched over the blade's outline so the whole texture shows along it
function fitUV(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox, pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - b.min.x) / (b.max.x - b.min.x), (pos.getY(i) - b.min.y) / (b.max.y - b.min.y));
  uv.needsUpdate = true;
}

// moves the gun group (the hand) through: [rx, ry, rz, px, py, pz] offsets from rest, [seconds to reach, pose] each
const REST = [0, 0, 0, 0, 0, 0];
const MOVES = {
  s1: [[0.06, [0.1, -1.0, -1.25, 0.06, 0.02, 0.02]], [0.12, [-0.05, 1.3, -1.35, -0.26, -0.03, -0.06]], [0.3, REST]], // right → left, flat
  s2: [[0.06, [-0.6, 1.0, 0.8, -0.2, -0.14, 0]], [0.12, [0.65, -1.1, 0.7, 0.12, 0.12, -0.06]], [0.3, REST]], // low left → high right
  s3: [[0.09, [1.25, 0.1, -0.2, 0.02, 0.16, 0.08]], [0.13, [-1.1, 0.15, -0.25, -0.05, -0.15, -0.1]], [0.35, REST]], // overhead chop
  strike: [[0.14, [1.5, 0.1, -0.2, 0, 0.2, 0.1]], [0.14, [-1.25, 0.1, -0.2, -0.04, -0.2, -0.16]], [0.4, REST]],
  dash: [[0.05, [-0.35, 0.25, -0.5, -0.06, -0.02, -0.18]], [0.2, [-0.35, 0.25, -0.5, -0.06, -0.02, -0.18]], [0.25, REST]], // a thrust
};
const GUARD = [0.35, 1.0, -1.45, -0.14, 0.1, 0.02]; // Deflect: the blade held flat across the view
function sample(move, t) {
  let from = REST;
  for (const [d, to] of move) {
    if (t < d) { const k = ease(t / d); return from.map((v, i) => v + (to[i] - v) * k); }
    t -= d;
    from = to;
  }
  return null;
}

// Fills the viewmodel group g (hand at the origin, -z forward): a gently curved blade with a glowing edge in the
// element's color, a gold-rimmed tsuba, a cord-wrapped grip, the glove and sleeve. userData: play(move), guard (0..1
// target), tint(item) and pose(dt) — models.js calls the last two.
export function buildKatana(g) {
  const sword = new THREE.Group();
  sword.rotation.set(0.45, 0.25, -0.35); // at rest: up and across the view
  const s = new THREE.Shape(); // profile along +x (edge down), extruded thin
  s.moveTo(0, -0.014);
  s.quadraticCurveTo(0.45, -0.012, 0.74, 0.018);
  s.quadraticCurveTo(0.8, 0.028, 0.815, 0.046); // the kissaki
  s.quadraticCurveTo(0.74, 0.05, 0.68, 0.047);
  s.quadraticCurveTo(0.4, 0.034, 0, 0.016);
  const bladeGeo = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0012, bevelSegments: 1, curveSegments: 18 });
  bladeGeo.translate(0, 0, -0.0025);
  fitUV(bladeGeo);
  bladeGeo.rotateY(Math.PI / 2).translate(0, 0, -0.055); // +x -> -z, starting past the collar
  sword.add(new THREE.Mesh(bladeGeo, new THREE.MeshStandardMaterial({ map: bladeTex(), metalness: 0.9, roughness: 0.22 })));
  const edge = new THREE.CurvePath();
  edge.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.01, -0.014, 0), new THREE.Vector3(0.45, -0.012, 0), new THREE.Vector3(0.74, 0.018, 0)));
  edge.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.74, 0.018, 0), new THREE.Vector3(0.8, 0.028, 0), new THREE.Vector3(0.815, 0.046, 0)));
  const edgeMat = new THREE.MeshBasicMaterial({ color: EDGE }), glowMat = additive(EDGE, 0.3);
  for (const [r, m] of [[0.0022, edgeMat], [0.007, glowMat]]) sword.add(new THREE.Mesh(new THREE.TubeGeometry(edge, 40, r, 5).rotateY(Math.PI / 2).translate(0, 0, -0.055), m));
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2622, metalness: 0.8, roughness: 0.4 }), gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 });
  const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.008, 20).rotateX(Math.PI / 2), iron);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.003, 6, 24), gold);
  tsuba.position.z = rim.position.z = -0.035;
  const habaki = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.036, 0.022), gold);
  habaki.position.set(0, 0.001, -0.05);
  const tsuka = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.034, 0.23), new THREE.MeshStandardMaterial({ map: wrapTex(), roughness: 0.9 }));
  tsuka.position.z = 0.085;
  const kashira = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.036, 0.016), gold);
  kashira.position.z = 0.205;
  sword.add(tsuba, rim, habaki, tsuka, kashira);
  const glove = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.075), new THREE.MeshLambertMaterial({ color: 0x33363d }));
  glove.position.set(0.005, -0.005, 0.04);
  const A = new THREE.Vector3(0.01, -0.03, 0.08), d = new THREE.Vector3(0.14, -0.3, 0.34).sub(A);
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, d.length()), new THREE.MeshLambertMaterial({ color: 0x52657a }));
  sleeve.position.copy(A).addScaledVector(d, 0.5);
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
  g.add(sword, glove, sleeve);
  const st = { move: null, t: 0, guard: 0, want: false };
  Object.assign(g.userData, {
    katana: st,
    muzzle: new THREE.Vector3(0, 0, -0.5),
    play: kind => { st.move = MOVES[kind]; st.t = 0; },
    tint: item => { edgeMat.color.setHex(edgeHex(item?.el)); glowMat.color.setHex(edgeHex(item?.el)); },
    pose: dt => { // after the inspect pass has set g's rest pose: add the move, blended toward the guard
      st.guard += ((st.want ? 1 : 0) - st.guard) * Math.min(1, dt * 14);
      const p = (st.move && sample(st.move, (st.t += dt))) || REST, k = st.guard;
      if (p === REST) st.move = null;
      const q = p.map((v, i) => v + (GUARD[i] - v) * k);
      g.rotation.x += q[0]; g.rotation.y += q[1]; g.rotation.z += q[2];
      g.position.x += q[3]; g.position.y += q[4]; g.position.z += q[5];
      glowMat.opacity = 0.3 + 0.45 * k + 0.15 * Math.sin(performance.now() / 90) * k;
    },
  });
  return g;
}

// ---------- effects, input and HUD ----------
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
// turn obj so its local +y runs along u with local +z leaning up, then roll it `roll` rad around u
function aim(obj, u, roll = 0) {
  _y.set(u[0], u[1], u[2]).normalize();
  _z.set(0, 1, 0).addScaledVector(_y, -_y.y);
  if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0);
  _z.normalize();
  _x.crossVectors(_y, _z);
  obj.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  if (roll) obj.rotateY(roll);
}

export class KatanaView {
  constructor(h) {
    this.h = h;
    this.g = h.g;
    this.world = h.world;
    this.root = new THREE.Group();
    this.world.scene.add(this.root);
    // an arc bulging along local +y in the local XY plane: crescents (Fire Strike) and swing trails (110° / 150°)
    const arc = (r0, r1, deg) => new THREE.RingGeometry(r0, r1, 28, 1, Math.PI / 2 - (deg * DEG) / 2, deg * DEG);
    this.geo = { crescent: arc(1.0, 1.5, 140), core: arc(1.12, 1.33, 120), 110: arc(1.1, 2.6, 110), 150: arc(1.1, 2.6, 150), ghost: new THREE.BoxGeometry(0.5, 1.75, 0.28).translate(0, 0.88, 0), flash: new THREE.SphereGeometry(0.35, 12, 8) };
    this.fx = [];        // { o, t, life, a (starting opacity), grow } fading meshes
    this.crescents = [];
    this.reset();
  }

  reset() {
    for (const f of this.fx) this.drop(f.o);
    for (const c of this.crescents) this.drop(c.g);
    this.fx = [];
    this.crescents = [];
    Object.assign(this, { combo: 0, swingAt: -9, strikeAt: 0, defAt: -9, defUntil: 0, defReady: 0, dashN: 1, dashReady: 0, ghostAt: 0, dripAt: 0, parry: 0 });
  }

  item() { return this.h.inv.find(it => it?.id === 'katana') ?? null; }
  ronin() { return this.h.cls === 'ronin'; }
  vm(move) { this.g.vm.guns.katana?.userData.play(move); }

  drop(o) {
    this.root.remove(o);
    o.traverse(x => { if (x.material) x.material.dispose(); });
  }

  // a fading mesh: t seconds, from opacity a, growing by `grow` per second
  fade(o, t, a, grow = 0) { this.root.add(o); this.fx.push({ o, t, life: t, a, grow }); }

  flash(p, color, size) {
    const m = new THREE.Mesh(this.geo.flash, additive(color, 0.8));
    m.position.set(...p);
    m.scale.setScalar(size);
    this.fade(m, 0.16, 0.8, 6);
  }

  // a swing's trail: an arc of light in front of eye, flat for the first swing, diagonal for the second, upright for the third
  slashArc(eye, yaw, n, el) {
    const m = new THREE.Mesh(this.geo[K.combo[n].arc], additive(edgeHex(el), 0.5)), f = [-Math.sin(yaw), 0, -Math.cos(yaw)];
    aim(m, f, [0.15, -0.6, 1.35][n]);
    m.position.set(eye[0] + Math.cos(yaw) * (n === 2 ? 0.2 : 0), eye[1] - 0.35, eye[2] - Math.sin(yaw) * (n === 2 ? 0.2 : 0));
    this.fade(m, 0.18, 0.5);
  }

  // ---------- your moves (predicted here; the server checks each and says 'no' when it disagrees) ----------
  // LMB with the katana in hand (weapons.js): the combo's next swing, claiming the zombies in its arc.
  swing() {
    const g = this.g, W = g.weapons, pl = g.player, now = g.now;
    this.combo = now - this.swingAt <= (K.swingMs + K.window) / 1000 ? (this.combo + 1) % 3 : 0;
    this.swingAt = now;
    this.defUntil = 0;
    W.nextFire = now + K.swingMs / 1000;
    W.inspectStart = -1;
    const step = K.combo[this.combo], eye = pl.eye, f = [-Math.sin(pl.yaw), -Math.cos(pl.yaw)], cos = Math.cos((step.arc / 2) * DEG), hits = [];
    for (const t of g.shotTargets()) {
      const s = t.s || 1, dx = t.x - eye[0], dz = t.z - eye[2], d = Math.hypot(dx, dz);
      if (d > K.reach + 0.6 * s || t.y > eye[1] + 0.5 || t.y + 1.8 * s < eye[1] - 2) continue;
      if (d > 0.4 && (dx * f[0] + dz * f[1]) / d < cos) continue;
      hits.push({ id: t.id, part: 'chest' });
      g.world.blood([t.x, t.y + 1.1 * s, t.z], [dx / Math.max(d, 0.01), 0, dz / Math.max(d, 0.01)], false);
    }
    this.vm('s' + (this.combo + 1));
    this.slashArc(eye, pl.yaw, this.combo, this.item()?.el);
    g.sound.play(hits.length ? 'kat_hit' : 'kat_slash', { vol: 0.9, rate: this.combo === 2 ? 0.8 : 1 + 0.1 * this.combo });
    g.net.send({ t: 'shot', w: 'katana', uid: W.cur.uid, o: eye.map(r3), h: hits.slice(0, K.maxHits) });
  }

  // RMB with the katana in hand: Fire Strike (two crescents in a V with Twin Fire Strike)
  strike() {
    const g = this.g, pl = g.player, now = g.now;
    if (now < this.strikeAt) return this.h.say(`Fire Strike recharging · ${Math.ceil(this.strikeAt - now)}s`, 1);
    this.strikeAt = now + K.strike.cd / 1000;
    this.defUntil = 0;
    g.weapons.nextFire = Math.max(g.weapons.nextFire, now + 0.4);
    const eye = pl.eye, d = dirFromAngles(pl.yaw, pl.pitch), it = this.item();
    g.net.send({ t: 'kat', op: 'strike', o: eye.map(r3), d: d.map(r3) });
    this.launch(eye, it?.ku?.twin ? [rotY(d, -K.strike.twin), rotY(d, K.strike.twin)] : [d], it?.el);
    this.vm('strike');
  }

  // the reload key with the katana in hand: Deflect
  deflect() {
    const g = this.g, now = g.now;
    if (now < this.defReady) return this.h.say(`Deflect recharging · ${Math.ceil(this.defReady - now)}s`, 1);
    Object.assign(this, { defAt: now, defUntil: now + K.deflect.ms / 1000, defReady: now + K.deflect.cd / 1000 });
    g.net.send({ t: 'kat', op: 'deflect' });
    g.sound.play('kat_guard', { vol: 0.7 });
  }

  // the dash key (a Ronin only): 7 m along your aim — player.js moves you, walls stop you, zombies don't
  dash() {
    const g = this.g, h = this.h, pl = g.player, now = g.now, D = K.dash, max = this.item()?.ku?.chain ? 2 : 1;
    if (!this.ronin() || h.carrying || h.build.active || h.edit.active || h.phys.dash?.left > 0) return;
    if (now >= this.dashReady) this.dashN = max;
    if (this.dashN <= 0) return h.say(`Dash recharging · ${Math.ceil(this.dashReady - now)}s`, 1);
    if (this.dashN === max) this.dashReady = now + D.cd / 1000;
    this.dashN--;
    this.defUntil = 0;
    const u = [-Math.sin(pl.yaw), -Math.cos(pl.yaw)], v = D.dist / (D.ms / 1000);
    h.phys.dash = { v: [u[0] * v, u[1] * v], left: D.ms / 1000, from: [...pl.pos] };
    g.net.send({ t: 'kat', op: 'dash', o: pl.pos.map(r2), d: u.map(r3) });
    this.vm('dash');
    g.sound.play('kat_dash', { vol: 0.9 });
  }

  // flaming crescents from o along each unit vector (yours at once, a teammate's from the server's 'strike')
  launch(o, list, el) {
    const color = el ? edgeHex(el) : 0xff7a2a;
    for (const u of list) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.geo.crescent, additive(color, 0.85)), new THREE.Mesh(this.geo.core, additive(0xfff1c8, 0.9)));
      aim(g, u, 0.25);
      g.position.set(...o).addScaledVector(_y.set(...u), -0.4); // starts just clear of the camera
      this.root.add(g);
      this.crescents.push({ g, pos: o.map((v, j) => v + u[j] * 0.8), u, went: 0.8, color, puff: 0 });
    }
    this.g.sound.play('kat_strike', { pos: o, vol: 1.1, ref: 5 });
  }

  // ---------- the server ----------
  // { ev: 'strike' | 'dash' | 'def' | 'block' | 'exec' | 'no', … } — see server/holdout/ronin.js
  onMsg(m) {
    const g = this.g, now = g.now, r = g.remotes.get(m.id);
    if (m.ev === 'strike') this.launch(m.o, m.l, m.el);
    else if (m.ev === 'dash') {
      for (let i = 0; i < 4; i++) { const k = i / 3; this.ghost([m.a[0] + (m.b[0] - m.a[0]) * k, m.a[1], m.a[2] + (m.b[2] - m.a[2]) * k], r?.yaw ?? 0, 0.12 + 0.06 * i); }
      this.streak(m.a, m.b);
      g.sound.play('kat_dash', { pos: m.b, vol: 1, ref: 4 });
    } else if (m.ev === 'def' && r) this.flash([r.pos[0], r.pos[1] + 1.2, r.pos[2]], 0x9ff4ff, 2.2);
    else if (m.ev === 'block') this.block(m);
    else if (m.ev === 'exec') {
      this.world.burst(m.p, [0, 1, 0], 0xff2a2a, 26, 5);
      this.flash(m.p, 0xffc04d, 2);
      g.sound.play('kat_hit', { pos: m.p, vol: 1.2, ref: 4, rate: 0.6 });
    } else if (m.ev === 'no') { // refused: take the server's cooldowns (and position, for a dash)
      const [s, d, dr, n] = m.cd;
      Object.assign(this, { strikeAt: now + s / 1000, defReady: now + d / 1000, dashReady: now + dr / 1000, dashN: n });
      if (m.what === 'deflect') this.defUntil = 0;
      if (m.p) {
        const pl = g.player;
        pl.pos = [...m.p];
        g.prevPos = [...m.p];
        pl.vel = [0, 0, 0];
        this.h.phys.dash = null;
      }
    }
  }

  // a Deflect blocked something: sparks, a flash, a clang — and a line back to the shooter when it was reflected
  block(m) {
    const g = this.g, pf = !!m.pf, color = pf ? 0xffd65a : 0xbfefff;
    this.world.burst(m.p, [0, 1, 0], color, pf ? 22 : 12, pf ? 5 : 3.5);
    this.flash(m.p, color, pf ? 1.8 : 1.1);
    g.sound.play(pf ? 'kat_parry' : 'kat_block', { pos: m.p, vol: 1, ref: 4 });
    if (m.r) { g.world.tracer(m.p, m.r, pf ? 0xffd65a : 0x9ff4ff); this.world.burst(m.r, [0, 1, 0], 0xff5a3c, 8, 3); }
    if (m.id === g.me.id && pf) { this.parry = 1; this.h.feed('PERFECT PARRY · +15 HP · +1 Adrenaline Shot', 'r4'); }
  }

  // a dash's streak of light from a to b (feet), a burst where it ends
  streak(a, b) {
    for (const y of [0.9, 1.3]) this.g.world.tracer([a[0], a[1] + y, a[2]], [b[0], b[1] + y, b[2]], EDGE);
    this.world.burst([b[0], b[1] + 1, b[2]], [0, 0.5, 0], EDGE, 10, 3);
  }

  ghost(p, yaw, life) {
    const m = new THREE.Mesh(this.geo.ghost, additive(edgeHex(null), 0.3));
    m.position.set(...p);
    m.rotation.y = yaw;
    this.fade(m, life + 0.25, 0.3);
  }

  // a teammate's swing (game.js onRemoteShot): its trail and sound; their model swings too
  remoteSwing(m, r) {
    if (!r?.alive) return;
    const n = (m.n | 0) % 3;
    this.slashArc([r.pos[0], r.pos[1] + 1.55, r.pos[2]], r.yaw, n, null);
    r.model.swing();
    this.g.sound.play('kat_slash', { pos: m.o, vol: 0.9, ref: 2, rate: n === 2 ? 0.8 : 1 + 0.1 * n });
  }

  // ---------- per frame ----------
  update(dt) {
    const g = this.g, h = this.h, now = g.now, W = g.weapons;
    if (W.id !== 'katana' || !g.player.alive) this.defUntil = 0; // the guard drops with the blade
    const kg = g.vm.guns.katana;
    if (kg) kg.userData.katana.want = now < this.defUntil;
    for (let i = this.crescents.length - 1; i >= 0; i--) {
      const c = this.crescents[i], step = Math.min(K.strike.speed * dt, K.strike.range - c.went), hit = rayWorld(c.pos, c.u, step, OUTPOST_STATIC), k = hit ? hit.t : step;
      for (let j = 0; j < 3; j++) c.pos[j] += c.u[j] * k;
      c.went += k;
      c.g.position.set(c.pos[0] - c.u[0] * 1.2, c.pos[1] - c.u[1] * 1.2, c.pos[2] - c.u[2] * 1.2); // its arc's front sits on the flight point
      const left = K.strike.range - c.went;
      c.g.children[0].material.opacity = 0.85 * Math.min(1, left / 4);
      if ((c.puff -= dt) <= 0) {
        c.puff = 0.03;
        const s = (Math.random() - 0.5) * 2.4, side = [c.u[2], 0, -c.u[0]];
        this.world.burst([c.pos[0] + side[0] * s, c.pos[1] - 0.2, c.pos[2] + side[2] * s], [-c.u[0], 0.4, -c.u[2]], Math.random() < 0.5 ? c.color : 0xffc34d, 2, 1.6);
      }
      if (hit || left <= 1e-3) {
        this.world.burst(c.pos, [0, 1, 0], c.color, 14, 4);
        this.drop(c.g);
        this.crescents.splice(i, 1);
      }
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t -= dt;
      f.o.material.opacity = f.a * Math.max(0, f.t / f.life);
      if (f.grow) f.o.scale.multiplyScalar(1 + f.grow * dt);
      if (f.t <= 0) { this.drop(f.o); this.fx.splice(i, 1); }
    }
    const dash = h.phys.dash;
    if (dash?.left > 0 && now >= this.ghostAt) { this.ghostAt = now + 0.04; this.ghost(g.player.pos, g.player.yaw, 0.2); } // your afterimages
    if (dash && dash.left <= 0 && dash.from) { this.streak(dash.from, g.player.pos); dash.from = null; }
    if (now >= this.dripAt) { // bleeding zombies drip (the stacks ride in the horde snapshot)
      this.dripAt = now + 0.12;
      for (const zb of h.zombies.list.values()) {
        if (zb.dead || !zb.bleed || Math.random() > 0.25 + 0.08 * zb.bleed) continue;
        this.world.burst([zb.pos[0] + (Math.random() - 0.5) * 0.4 * zb.s, zb.pos[1] + (0.8 + Math.random() * 0.5) * zb.s, zb.pos[2] + (Math.random() - 0.5) * 0.4 * zb.s], [0, -1, 0], 0x7a0707, 1 + (zb.bleed > 5 ? 1 : 0), 0.7);
      }
    }
    this.parry = Math.max(0, this.parry - dt * 2.5);
    setStyle('fxParry', 'opacity', this.parry.toFixed(2));
  }

  // cooldown pips under the crosshair: Fire Strike, Deflect, the dash (charges with Chain Dash)
  hud() {
    const h = this.h, on = this.ronin() && this.g.player.alive && !h.downed;
    setHidden('hoKat', !on);
    if (!on) return;
    const now = this.g.now, max = this.item()?.ku?.chain ? 2 : 1, ready = now >= this.dashReady, n = ready ? max : this.dashN;
    const pip = (id, label, left, total) => {
      const k = left > 0 ? 1 - left / total : 1;
      return `<i class="${left > 0 ? '' : 'ready'}" style="--p:${Math.round(k * 36) * 10}deg"><b>${h.key(id).replace('Mouse ', 'M')}</b><em>${label}</em></i>`;
    };
    setHTML('hoKat', pip('alt', 'STRIKE', this.strikeAt - now, K.strike.cd / 1000)
      + pip('reload', now < this.defUntil ? 'GUARD' : 'DEFLECT', this.defReady - now, K.deflect.cd / 1000)
      + pip('dash', max > 1 ? `DASH ×${n}` : 'DASH', n > 0 ? 0 : this.dashReady - now, K.dash.cd / 1000));
  }

  dispose() {
    this.reset();
    this.world.scene.remove(this.root);
    for (const x of Object.values(this.geo)) x.dispose();
  }
}
