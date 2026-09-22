// Box-built third-person player (identical to its hitboxes) and first-person weapon viewmodels.
import * as THREE from 'three';
import { hitboxes } from '/shared/physics.js';
import { WEAPONS } from '/shared/weapons.js';
import { RARITY } from '/shared/holdout.js';
import { ELEMENTS } from '/shared/elements.js';
import { skinFor } from './skins.js';
import { buildKatana } from './katana.js';

const RARITY_COLORS = RARITY.map(r => r.color);
// held non-gun items: [size], default color per kind; some items get their own color
const ITEM_LOOK = {
  throw: [[0.07, 0.07, 0.07], 0x4d6b35], adrenaline: [[0.04, 0.04, 0.14], 0xff5a3c],
  trap: [[0.14, 0.04, 0.14], 0x6b7280], deploy: [[0.12, 0.1, 0.12], 0x3a3f46], armor: [[0.14, 0.12, 0.06], 0x55606b], attach: [[0.05, 0.05, 0.1], 0x2b2f35],
};
const ITEM_COLOR = {
  molotov: 0xc9772e, freeze: 0x9ff2ff, campfire: 0xff8a3c, flame: 0xe0632d, rturret: 0x4b5a3e,
  gturret: 0x767b80, frturret: 0x8fd6e8, flturret: 0x8a2f1c, tesla: 0x9d8bf0, mortar: 0x3c4034,
};

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12).rotateX(Math.PI / 2);
const matCache = {};
const mat = hex => (matCache[hex] ??= new THREE.MeshLambertMaterial({ color: hex }));

function box(parent, color, size, pos, rot) {
  const m = new THREE.Mesh(BOX, mat(color));
  m.scale.set(...size);
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  parent.add(m);
  return m;
}
function limb(parent, color, a, b, t) {
  const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A);
  const m = new THREE.Mesh(BOX, mat(color));
  m.scale.set(t, t, d.length());
  m.position.copy(A).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
  parent.add(m);
  return m;
}
function cyl(parent, color, r, len, pos) {
  const m = new THREE.Mesh(CYL, mat(color));
  m.scale.set(r, r, len);
  m.position.set(...pos);
  parent.add(m);
  return m;
}

const GUN_LEN = { melee: 0.28, pistol: 0.22, smg: 0.46, shotgun: 0.85, rifle: 0.8, sniper: 1.05, launcher: 0.95 };
// Boss-drop guns reuse an existing model with a distinct finish (a = body, b = accent/glow, c = dark trim).
const BOSS_FINISH = {
  skybreaker: { a: 0x8a6a1a, b: 0x5a2f9c },
  broodlauncher: { b: 0x8fe03a, c: 0x1f2b16 },
  mawfang: { a: 0x3a1414, b: 0xd9d0b0 },
  knell: { a: 0x8a5a22, b: 0x7a5ad8 },
  siegebreaker: { a: 0x4a4f57, b: 0xff7a2a, c: 0x7a4a2a },
};
// A teammate's Zinkonium Katana: a long thin blade with a glowing edge over a gold tsuba and a dark grip, held up a little.
const KAT_GLOW = new THREE.MeshBasicMaterial({ color: 0x5ee6d0 }); // shared, never disposed (like the mat() cache)
function katana3P(parent) {
  const k = new THREE.Group();
  k.rotation.x = 0.3;
  box(k, 0x15171d, [0.035, 0.04, 0.24], [0, 0, 0.04]);
  box(k, 0xc9a24a, [0.08, 0.075, 0.012], [0, 0, -0.085]);
  box(k, 0xd4dbe2, [0.012, 0.045, 0.92], [0, 0.006, -0.55]);
  const edge = new THREE.Mesh(BOX, KAT_GLOW);
  edge.scale.set(0.014, 0.008, 0.9);
  edge.position.set(0, -0.018, -0.55);
  k.add(edge);
  parent.add(k);
  return k;
}
const skinId = id => WEAPONS[id]?.skinOf || id; // Holdout's SSG/AWP wear the same skins
const skin3P = {};
const skinMat3P = id => (skin3P[id] ??= (() => {
  const s = skinFor(skinId(id));
  return s ? new THREE.MeshLambertMaterial({ map: s.tex }) : mat(0x1d2127);
})());

export class PlayerModel {
  constructor(scene, color = 0xe23c4a) {
    this.group = new THREE.Group();
    const cols = { head: 0xf1c29b, legs: 0x2b3038, chest: color, stomach: color, arm: color };
    this.parts = hitboxes(0).map(hb => {
      const m = new THREE.Mesh(BOX, mat(cols[hb.part]));
      this.group.add(m);
      return m;
    });
    // the map's shadow map is static, so players get a cheap blob shadow instead
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    scene.add(this.blob);
    this.visor = new THREE.Mesh(BOX, mat(0x161a20));
    this.group.add(this.visor);
    this.gunPivot = new THREE.Group();
    this.group.add(this.gunPivot);
    this.gun = new THREE.Mesh(BOX, mat(0x1d2127));
    this.gunPivot.add(this.gun);
    this.weapon = null;
    this.dead = false;
    this.deadT = 0;
    scene.add(this.group);
    this.pose(0, 0, 'knife');
  }

  pose(c, pitch, weapon) {
    const hbs = hitboxes(c);
    hbs.forEach((hb, i) => {
      this.parts[i].position.set(...hb.c);
      this.parts[i].scale.set(hb.h[0] * 2, hb.h[1] * 2, hb.h[2] * 2);
    });
    const head = hbs[8], fore = hbs[6];
    this.visor.position.set(head.c[0], head.c[1] + 0.02, head.c[2] - head.h[2] - 0.006);
    this.visor.scale.set(head.h[0] * 1.7, 0.07, 0.02);
    this.gunPivot.position.set(0.03, fore.c[1] + 0.06, fore.c[2]);
    const s = Math.sin((this.swingT || 0) * Math.PI); // a katana swing sweeps across (swing())
    this.gunPivot.rotation.set(pitch * 0.8 - s * 0.9, s * ((this.swingT || 0) - 0.5) * 3, 0);
    if (weapon !== this.weapon) {
      this.weapon = weapon;
      this.gun.material = weapon === 'knife' ? mat(0x2b5ce0) : skinMat3P(weapon); // skins on teammates' guns too
      const len = GUN_LEN[WEAPONS[weapon]?.cat] ?? 0.5;
      this.gun.scale.set(0.05, 0.08, len);
      this.gun.position.set(0, 0, -len / 2 - 0.05);
      if (weapon === 'katana') this.katana ??= katana3P(this.gunPivot);
      this.gun.visible = weapon !== 'katana';
      if (this.katana) this.katana.visible = weapon === 'katana';
    }
  }

  swing() { this.swingT = 1; }

  // world position of the muzzle (for remote tracers / flashes)
  muzzle() {
    const v = new THREE.Vector3(0, 0, -0.5);
    this.gun.localToWorld(v);
    return [v.x, v.y, v.z];
  }

  setDead(d) {
    this.dead = d;
    this.deadT = 0;
    if (!d) { this.group.rotation.x = 0; this.group.rotation.z = 0; }
  }

  update(dt) {
    this.swingT = Math.max(0, (this.swingT || 0) - dt * 3.2);
    if (!this.dead) return;
    this.deadT = Math.min(1, this.deadT + dt * 2.5);
    const e = 1 - (1 - this.deadT) ** 3;
    this.group.rotation.x = e * (Math.PI / 2 - 0.1);
  }

  set visible(v) { this.group.visible = v; this.blob.visible = v; }
}

// ---------- first-person viewmodels ----------
const DARK = 0x3a4049, STEEL = 0xa7b0ba, WOOD = 0xa8683a, SLEEVE = 0x52657a, GLOVE = 0x33363d;

// Case Hardened "Blue Gem" (Factory New): deep blue heat-treated steel, lighter swirls, barely any gold.
const blueGemTex = (() => {
  const W = 512, H = 256, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const base = c.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, '#0f2a8a'); base.addColorStop(0.5, '#1f4fd6'); base.addColorStop(1, '#123a9e');
  c.fillStyle = base;
  c.fillRect(0, 0, W, H);
  let s = 387; // pattern seed — #387 is the famous blue gem
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const blob = (x, y, r, rgb, a) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
  };
  for (let i = 0; i < 90; i++) blob(rnd() * W, rnd() * H, 20 + rnd() * 70, '90,160,255', 0.35);
  for (let i = 0; i < 40; i++) blob(rnd() * W, rnd() * H, 15 + rnd() * 50, '8,20,80', 0.45);
  for (let i = 0; i < 25; i++) blob(rnd() * W, rnd() * H, 8 + rnd() * 30, '120,230,255', 0.3);
  for (let i = 0; i < 6; i++) blob(rnd() * W, rnd() * H, 6 + rnd() * 16, '210,170,60', 0.22);
  c.globalCompositeOperation = 'overlay'; // flowing heat-treatment bands
  for (let y = 0; y < H; y += 2) {
    const off = Math.sin(y * 0.05) * 30 + Math.sin(y * 0.013) * 60;
    c.fillStyle = `rgba(255,255,255,${0.04 + 0.04 * Math.sin((y + off) * 0.09)})`;
    c.fillRect(0, y, W, 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
})();
const blueGemMat = new THREE.MeshStandardMaterial({ map: blueGemTex, metalness: 1, roughness: 0.16 });
const gripMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, metalness: 0, roughness: 0.85, envMapIntensity: 0.3 });

// UVs stretched over the part's outline so the whole pattern shows on the blade
function fitUV(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox, pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - b.min.x) / (b.max.x - b.min.x), (pos.getY(i) - b.min.y) / (b.max.y - b.min.y));
  uv.needsUpdate = true;
}

// Karambit drawn in a 2D profile (x forward, y up), extruded for thickness, pivoting on its finger ring.
function buildKarambit(g) {
  const body = new THREE.Group();
  const blade = new THREE.Shape();
  blade.moveTo(0, 0.005);
  blade.bezierCurveTo(0.05, 0.006, 0.1, -0.008, 0.126, -0.05);
  blade.bezierCurveTo(0.129, -0.057, 0.124, -0.061, 0.117, -0.056);
  blade.bezierCurveTo(0.094, -0.03, 0.05, -0.019, 0, -0.021);
  blade.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 1, curveSegments: 16 });
  bladeGeo.translate(0, 0, -0.002);
  fitUV(bladeGeo);
  body.add(new THREE.Mesh(bladeGeo, blueGemMat));
  const handle = new THREE.Shape();
  handle.moveTo(0.006, 0.01);
  handle.quadraticCurveTo(-0.04, 0.022, -0.086, 0.013);
  handle.lineTo(-0.09, -0.011);
  handle.quadraticCurveTo(-0.04, -0.006, 0.006, -0.025);
  handle.closePath();
  const handleGeo = new THREE.ExtrudeGeometry(handle, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 10 });
  handleGeo.translate(0, 0, -0.007);
  body.add(new THREE.Mesh(handleGeo, gripMat));
  const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.038, 0.017), blueGemMat);
  bolster.position.set(0.004, -0.007, 0);
  body.add(bolster);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0055, 10, 28), blueGemMat);
  ring.position.set(-0.106, 0.001, 0);
  body.add(ring);
  body.rotation.y = Math.PI / 2; // profile x -> forward (-z), thickness -> sideways
  body.position.z = -0.106;      // finger ring at the spinner's origin
  const spinner = new THREE.Group();
  spinner.add(body);
  const pose = new THREE.Group(); // idle hold: tilted so the pattern faces the camera
  pose.position.set(-0.03, 0.05, 0.05);
  pose.rotation.set(0.12, 0.25, -0.35);
  pose.add(spinner);
  g.add(pose);
  g.userData.spinner = spinner;
}

// Bake each gun part into gun space and give it UVs projected onto the gun's side view, so one skin
// texture runs across the whole weapon (muzzle = left edge of the art, stock = right edge).
function applySkin(g, id) {
  const skin = skinFor(skinId(id));
  if (!skin) return;
  const material = new THREE.MeshStandardMaterial({ map: skin.tex, metalness: skin.metal, roughness: skin.rough });
  const parts = g.children.filter(m => m.isMesh);
  g.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  for (const m of parts) bounds.expandByObject(m);
  const len = bounds.max.z - bounds.min.z, hgt = bounds.max.y - bounds.min.y;
  for (const m of parts) {
    const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getZ(i) - bounds.min.z) / len;
      const v = Math.abs(nor.getY(i)) > 0.7 ? 0.5 + pos.getX(i) * 3 : (pos.getY(i) - bounds.min.y) / hgt;
      uv.setXY(i, u, v);
    }
    m.geometry = geo;
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
    m.material = material;
  }
}

function buildGun(model, id) {
  const g = new THREE.Group();
  let muzzle = -0.3;
  switch (model) {
    case 'knife':
      buildKarambit(g);
      break;
    case 'pistol': case 'pistolS': case 'deagle': {
      const big = model === 'deagle';
      box(g, big ? STEEL : DARK, [0.034, big ? 0.05 : 0.04, big ? 0.25 : 0.19], [0, 0.02, -0.04]);
      box(g, 0x2e3238, [0.03, 0.1, 0.045], [0, -0.045, 0.03], [-0.25, 0, 0]);
      muzzle = big ? -0.17 : -0.14;
      if (model === 'pistolS') { cyl(g, 0x30343a, 0.017, 0.13, [0, 0.022, -0.2]); muzzle = -0.27; }
      break;
    }
    case 'smg':
      box(g, DARK, [0.05, 0.07, 0.3], [0, 0, -0.08]);
      box(g, DARK, [0.02, 0.02, 0.09], [0, 0.01, -0.27]);
      box(g, 0x30343a, [0.03, 0.15, 0.04], [0, -0.09, -0.12]);
      box(g, 0x30343a, [0.03, 0.1, 0.04], [0, -0.06, 0.03], [-0.25, 0, 0]);
      box(g, DARK, [0.03, 0.04, 0.12], [0, 0, 0.12]);
      muzzle = -0.32;
      break;
    case 'p90':
      box(g, 0x3d4a3b, [0.06, 0.09, 0.38], [0, 0, -0.05]);
      box(g, 0x9fb3a0, [0.04, 0.02, 0.26], [0, 0.055, -0.06]);
      box(g, DARK, [0.02, 0.02, 0.06], [0, 0.01, -0.26]);
      muzzle = -0.29;
      break;
    case 'shotgun': { // the Maw Fang: dark red with bone-white accents
      const boss = BOSS_FINISH[id];
      box(g, boss ? boss.a : DARK, [0.05, 0.07, 0.28], [0, 0, 0]);
      box(g, 0x2e3238, [0.026, 0.026, 0.5], [0, 0.02, -0.38]);
      box(g, boss ? boss.b : WOOD, [0.046, 0.046, 0.14], [0, -0.02, -0.3]);
      box(g, boss ? boss.b : WOOD, [0.04, 0.09, 0.25], [0, -0.03, 0.25], [-0.15, 0, 0]);
      muzzle = -0.63;
      break;
    }
    case 'ak': case 'galil': case 'm4': case 'm4s': {
      const ak = model === 'ak', gal = model === 'galil', boss = BOSS_FINISH[id]; // the Knell: bronze body, violet furniture
      const body = boss ? boss.a : ak ? 0x2b2b2b : gal ? 0x4a5240 : 0x1f2226;
      const furn = boss ? boss.b : ak ? WOOD : gal ? 0x3a4034 : 0x2b2f35;
      box(g, body, [0.05, 0.075, 0.34], [0, 0, -0.02]);
      box(g, furn, [0.056, 0.06, 0.2], [0, -0.005, -0.28]);
      box(g, 0x2a2a2a, [0.018, 0.018, 0.22], [0, 0.01, -0.46]);
      box(g, ak ? 0x8a4b22 : 0x30343a, [0.035, 0.16, 0.055], [0, -0.1, -0.1], [ak ? 0.35 : 0.12, 0, 0]);
      box(g, 0x30343a, [0.03, 0.09, 0.04], [0, -0.07, 0.07], [-0.3, 0, 0]);
      box(g, furn, [0.045, 0.08, 0.26], [0, -0.02, 0.27], [-0.08, 0, 0]);
      if (!ak) box(g, 0x2b2f35, [0.02, 0.02, 0.28], [0, 0.05, -0.05]);
      muzzle = -0.57;
      if (model === 'm4s') { cyl(g, 0x2c3036, 0.02, 0.22, [0, 0.01, -0.66]); muzzle = -0.77; }
      break;
    }
    case 'ssg': case 'awp': {
      const awp = model === 'awp', boss = BOSS_FINISH[id]; // the Skybreaker: gold body, purple scope/stripe
      const body = boss ? boss.a : awp ? 0x445e3e : 0x3a3f46;
      box(g, body, [0.06, 0.08, 0.5], [0, 0, 0.02]);
      box(g, boss ? boss.b : 0x2a2a2a, [0.022, 0.022, 0.55], [0, 0.015, -0.5]);
      cyl(g, boss ? boss.b : 0x1b1d21, awp ? 0.03 : 0.022, awp ? 0.32 : 0.26, [0, 0.085, -0.02]);
      box(g, body, [0.05, 0.1, 0.3], [0, -0.03, 0.38], [-0.1, 0, 0]);
      box(g, 0x30343a, [0.035, 0.12, 0.05], [0, -0.08, -0.08], [0.1, 0, 0]);
      muzzle = -0.78;
      break;
    }
    case 'rocket': { // shoulder tube with a warhead poking out (the Siegebreaker: iron, rust bands, a glowing warhead)
      const boss = BOSS_FINISH[id];
      cyl(g, boss ? boss.a : 0x4b5a3e, 0.075, 0.95, [0, 0.02, -0.12]);
      cyl(g, boss ? boss.c : 0x2b2f35, 0.085, 0.08, [0, 0.02, -0.6]);
      cyl(g, boss ? boss.c : 0x2b2f35, 0.085, 0.08, [0, 0.02, 0.35]);
      box(g, 0x30343a, [0.03, 0.12, 0.05], [0, -0.1, -0.02], [-0.2, 0, 0]);
      box(g, 0x1b1d21, [0.03, 0.05, 0.1], [0.06, 0.1, -0.1]);
      box(g, boss ? boss.b : 0xb04030, [0.06, 0.06, 0.12], [0, 0.02, -0.68]);
      muzzle = -0.72;
      break;
    }
    case 'item': { // a held grenade / adrenaline shot / trap: the shape and color follow the item (ViewModel.set)
      const m = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0xffffff })); // own material: recolored per item
      m.position.set(0, -0.02, -0.08);
      g.add(m);
      g.userData.itemMesh = m;
      box(g, GLOVE, [0.06, 0.06, 0.07], [0, -0.06, -0.02]);
      limb(g, SLEEVE, [0.01, -0.08, 0.0], [0.14, -0.3, 0.34], 0.07);
      g.userData.muzzle = new THREE.Vector3(0, 0, -0.15);
      return g;
    }
    case 'gl': { // stubby grenade launcher with a drum (the Brood Launcher: acid green)
      const boss = BOSS_FINISH[id];
      box(g, boss ? boss.c : 0x3a4436, [0.07, 0.08, 0.34], [0, 0, -0.05]);
      cyl(g, 0x2b2f35, 0.045, 0.3, [0, 0.02, -0.34]);
      cyl(g, boss ? boss.b : 0x4b5a3e, 0.06, 0.12, [0, -0.04, -0.08]);
      box(g, 0x30343a, [0.035, 0.13, 0.05], [0, -0.1, 0.05], [-0.25, 0, 0]);
      muzzle = -0.5;
      break;
    }
    case 'kinetic': // the Shockwave Blaster: a flared emitter with a glowing core
      box(g, 0x2e3440, [0.08, 0.09, 0.36], [0, 0, 0]);
      cyl(g, 0x5a6a80, 0.07, 0.12, [0, 0.01, -0.26]);
      box(g, 0x7fd0ff, [0.03, 0.03, 0.2], [0, 0.055, -0.05]);
      box(g, 0x30343a, [0.035, 0.13, 0.05], [0, -0.1, 0.07], [-0.25, 0, 0]);
      muzzle = -0.36;
      break;
    case 'blade': { // the Stalker's machete (the Alpha Cleaver: bigger, dark steel, a red edge)
      const boss = id === 'cleaver', len = boss ? 0.52 : 0.42, off = boss ? -0.31 : -0.26;
      box(g, boss ? 0x3a3d42 : 0xc9d1db, [boss ? 0.016 : 0.012, boss ? 0.09 : 0.07, len], [0, 0.03, off]);
      if (boss) box(g, 0xc21e2b, [0.004, 0.09, len], [0.012, 0.03, off]);
      box(g, 0x2b2020, [0.03, 0.04, 0.12], [0, 0, 0.02]);
      box(g, GLOVE, [0.05, 0.06, 0.075], [0.005, -0.01, 0.02]);
      limb(g, SLEEVE, [0.01, -0.03, 0.06], [0.14, -0.3, 0.34], 0.07);
      g.userData.muzzle = new THREE.Vector3(0, 0, boss ? -0.36 : -0.3);
      return g;
    }
    case 'katana': return buildKatana(g); // the Ronin's Zinkonium Katana (katana.js): its own blade, glow and moves
    case 'minigun': { // six spinning barrels
      box(g, 0x2e3238, [0.14, 0.14, 0.34], [0, -0.02, 0.05]);
      const barrels = new THREE.Group();
      barrels.position.set(0, -0.02, -0.34);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; cyl(barrels, 0x1b1d21, 0.014, 0.5, [Math.cos(a) * 0.04, Math.sin(a) * 0.04, 0]); }
      g.add(barrels);
      g.userData.barrels = barrels;
      box(g, 0x30343a, [0.04, 0.14, 0.05], [0, -0.13, 0.05], [-0.3, 0, 0]);
      muzzle = -0.62;
      break;
    }
  }
  if (model !== 'knife') applySkin(g, id);
  // arms: right hand on the grip, left hand on the front (or supporting the grip for pistols)
  const pistol = model === 'pistol' || model === 'deagle' || model === 'pistolS';
  if (model === 'knife') { // fist wrapped around the karambit handle
    box(g, GLOVE, [0.05, 0.06, 0.075], [0.005, 0.0, 0.015]);
    limb(g, SLEEVE, [0.01, -0.02, 0.05], [0.14, -0.3, 0.34], 0.07);
    g.userData.muzzle = new THREE.Vector3(0, 0, -0.2);
    return g;
  }
  box(g, GLOVE, [0.05, 0.07, 0.07], [0, -0.06, 0.05]);
  limb(g, SLEEVE, [0.01, -0.08, 0.08], [0.14, -0.3, 0.34], 0.07);
  if (pistol) {
    box(g, GLOVE, [0.045, 0.06, 0.06], [-0.035, -0.07, 0.05]);
    limb(g, SLEEVE, [-0.04, -0.09, 0.07], [-0.22, -0.3, 0.3], 0.065);
  } else if (model !== 'knife') {
    const front = model === 'smg' ? -0.12 : model === 'p90' ? -0.14 : -0.26;
    box(g, GLOVE, [0.05, 0.05, 0.07], [-0.02, -0.05, front]);
    limb(g, SLEEVE, [-0.03, -0.07, front], [-0.28, -0.32, 0.0], 0.065);
  }
  g.userData.muzzle = new THREE.Vector3(0, 0.015, muzzle);
  return g;
}

const flashTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.3, 'rgba(255,200,90,0.9)');
  grd.addColorStop(1, 'rgba(255,120,0,0)');
  c.fillStyle = grd;
  c.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, r = i % 2 ? 12 : 32;
    c.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  c.fill();
  return new THREE.CanvasTexture(cv);
})();

export class ViewModel {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.guns = {};
    this.current = null;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.flashT = 0;
    this.bob = 0;
    this.sway = new THREE.Vector2();
    this.kick = 0;
    this.swing = 0;
  }

  // rarity: Holdout item rarity index -> a colored accent stripe on the gun (null = none).
  // item: the Holdout inventory item in hand (held grenades / adrenaline shots / traps take its look).
  set(weaponId, rarity = null, item = null) {
    const model = WEAPONS[weaponId].model;
    if (this.current) this.current.visible = false;
    this.current = this.guns[weaponId] ??= buildGun(model, weaponId);
    this.root.add(this.current);
    this.current.visible = true;
    this.current.add(this.flash);
    this.flash.position.copy(this.current.userData.muzzle);
    this.silenced = WEAPONS[weaponId].silenced;
    this.melee = WEAPONS[weaponId].cat === 'melee';
    const g = this.current;
    g.userData.tint?.(item); // the katana's edge glows in its element's color
    if (g.userData.itemMesh) {
      const look = ITEM_LOOK[item?.kind] ?? ITEM_LOOK.trap, id = item?.id;
      const color = ITEM_COLOR[id] ?? look[1];
      g.userData.itemMesh.scale.set(...look[0]);
      g.userData.itemMesh.material.color.setHex(color);
      return;
    }
    if (item?.el && !this.melee) { // elemental guns get a glowing strip in the element's color
      if (!g.userData.elMark) {
        g.userData.elMark = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial());
        g.userData.elMark.scale.set(0.064, 0.012, 0.08);
        g.userData.elMark.position.set(0, 0.03, -0.2);
        g.add(g.userData.elMark);
      }
      g.userData.elMark.material.color.setHex(ELEMENTS[item.el].hex);
      g.userData.elMark.visible = true;
    } else if (g.userData.elMark) g.userData.elMark.visible = false;
    if (rarity !== null && rarity !== undefined && !this.melee) {
      if (!g.userData.accent) {
        g.userData.accent = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial());
        g.userData.accent.scale.set(0.062, 0.018, 0.16);
        g.userData.accent.position.set(0, 0.052, -0.06);
        g.add(g.userData.accent);
      }
      g.userData.accent.material.color.set(RARITY_COLORS[rarity] ?? '#b7bec7');
      g.userData.accent.visible = true;
    } else if (g.userData.accent) g.userData.accent.visible = false;
  }

  fire(strength = 1) {
    this.kick = strength;
    if (this.current?.userData.barrels) this.current.userData.barrels.rotation.z += 0.9;
    if (!this.silenced) {
      this.flash.visible = true;
      this.flashT = 0.045;
      this.flash.material.rotation = Math.random() * 6.28;
      this.flash.scale.setScalar(0.12 + Math.random() * 0.08);
    }
  }

  knife(alt) { this.swing = alt ? -1 : 1; }

  addSway(dx, dy) {
    this.sway.x = Math.max(-0.03, Math.min(0.03, this.sway.x - dx * 0.00012));
    this.sway.y = Math.max(-0.03, Math.min(0.03, this.sway.y + dy * 0.00012));
  }

  // s: { speed01, grounded, reload (0..1 or -1), deploy (0..1), crouch }
  update(dt, s) {
    if (!this.current) return;
    this.bob += dt * (6 + s.speed01 * 5) * (s.grounded ? 1 : 0.2);
    const amp = s.grounded ? s.speed01 : 0;
    this.sway.multiplyScalar(Math.exp(-dt * 8));
    this.kick = Math.max(0, this.kick - dt * 9);
    this.swing *= Math.exp(-dt * 7);
    const r = this.root;
    r.position.set(0.19 + Math.sin(this.bob) * 0.012 * amp + this.sway.x, -0.19 - Math.abs(Math.cos(this.bob)) * 0.01 * amp + this.sway.y, -0.46 + this.kick * 0.04);
    r.rotation.set(this.kick * 0.1, this.sway.x * 1.5 + this.swing * 0.8, this.swing * -0.6);
    if (s.reload >= 0) {
      const k = Math.sin(Math.PI * s.reload);
      r.position.y -= k * 0.1;
      r.rotation.x -= k * 0.5;
      r.rotation.z += k * 0.4;
    }
    if (s.deploy < 1) {
      const k = (1 - s.deploy) ** 2;
      r.position.y -= k * 0.3;
      r.rotation.x -= k * 0.9;
    }
    this.applyInspect(s.inspect ?? -1);
    this.current.userData.pose?.(dt); // the katana's slashes and guard
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.flash.visible = false;
  }

  // Inspect (t = 0..1): guns turn to show their side then tilt to the top; the karambit spins twice
  // around its finger ring, then shows off the blade.
  applyInspect(t) {
    const g = this.current, sp = g.userData.spinner;
    if (t < 0) {
      g.rotation.set(0, 0, 0);
      g.position.set(0, 0, 0);
      if (sp) sp.rotation.x = 0;
      return;
    }
    const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const hold = (a, b, f = 0.15) => ease((t - a) / f) * (1 - ease((t - b) / f));
    const env = hold(0, 0.82, 0.18);
    if (this.melee) {
      if (sp) sp.rotation.x = -ease((t - 0.1) / 0.42) * Math.PI * 4;
      const show = hold(0.52, 0.84);
      g.rotation.set(0.2 * env, 0.95 * show, -0.55 * show);
      g.position.set(-0.08 * env, 0.05 * env, 0.05 * env);
    } else {
      const tilt = hold(0.4, 0.7);
      g.rotation.set(0.15 * env + 0.35 * tilt, 0.95 * env, -0.45 * env + 0.55 * tilt);
      g.position.set(-0.1 * env, 0.06 * env, 0.06 * env);
    }
  }

  // world-ish muzzle for tracers: returns offset in camera space
  muzzleOffset() {
    const v = this.current.userData.muzzle.clone();
    this.current.localToWorld(v);
    return v; // vm camera space (the vm camera sits at the origin)
  }
}
