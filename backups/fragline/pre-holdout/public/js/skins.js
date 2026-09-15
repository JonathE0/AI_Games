// Procedural weapon finishes inspired by famous CS skins (original canvas artwork, not Valve's).
// Each texture is a side view of the gun: left = muzzle, right = stock; models.js projects it along the gun.
import * as THREE from 'three';

const W = 512, H = 128;
const TAU = Math.PI * 2;

function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const lin = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; };
const fill = (c, style) => { c.fillStyle = style; c.fillRect(0, 0, W, H); };

function blobs(c, r, n, rgb, rmin, rmax, a) {
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = r() * H, rad = rmin + r() * (rmax - rmin);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

// flame tongues rising from a baseline (dir = -1 up) or licking sideways from the muzzle (side = true)
function flames(c, r, x0, x1, base, height, colors, n = 14, side = false) {
  colors.forEach((col, k) => {
    c.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const p = x0 + r() * (x1 - x0), w = 12 + r() * 24, h = height * (0.5 + r() * 0.5) * (1 - k * 0.22);
      c.beginPath();
      if (side) {
        c.moveTo(base, p - w / 2);
        c.bezierCurveTo(base + h * 0.5, p - w / 2, base + h * 0.6, p + w * 0.3, base + h, p + (r() - 0.5) * w);
        c.bezierCurveTo(base + h * 0.5, p + w * 0.2, base + h * 0.3, p + w / 2, base, p + w / 2);
      } else {
        c.moveTo(p - w / 2, base);
        c.bezierCurveTo(p - w / 2, base - h * 0.5, p + w * 0.3, base - h * 0.6, p + (r() - 0.5) * w, base - h);
        c.bezierCurveTo(p + w * 0.2, base - h * 0.5, p + w / 2, base - h * 0.3, p + w / 2, base);
      }
      c.fill();
    }
  });
}

function sparkle(c, x, y, s, col) {
  c.fillStyle = col; c.beginPath();
  c.moveTo(x, y - s); c.quadraticCurveTo(x, y, x + s, y); c.quadraticCurveTo(x, y, x, y + s);
  c.quadraticCurveTo(x, y, x - s, y); c.quadraticCurveTo(x, y, x, y - s); c.fill();
}

function wolf(c, x, y, s, body, eye) { // howling wolf head, snout up-left
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = body;
  c.beginPath();
  c.moveTo(-50, 46); c.bezierCurveTo(-45, 16, -38, -4, -30, -16);
  c.lineTo(-64, -42); c.lineTo(-54, -46); c.lineTo(-18, -28); c.lineTo(-50, -56); c.lineTo(-38, -58);
  c.bezierCurveTo(-10, -46, 0, -42, 10, -44);
  c.lineTo(18, -62); c.lineTo(26, -42); c.lineTo(38, -56); c.lineTo(40, -34);
  c.bezierCurveTo(52, -14, 52, 16, 40, 46); c.closePath(); c.fill();
  for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(40 - i * 2, 6 + i * 8); c.lineTo(58, 10 + i * 8); c.lineTo(38 - i * 2, 14 + i * 8); c.fill(); }
  c.fillStyle = eye; c.beginPath(); c.ellipse(0, -34, 6, 2.6, -0.4, 0, TAU); c.fill();
  c.restore();
}

function dragon(c, x, y, s, body, belly, wing, eye) {
  c.save(); c.translate(x, y); c.scale(s, s);
  c.fillStyle = wing; c.beginPath();
  c.moveTo(-20, -6); c.lineTo(10, -58); c.lineTo(18, -30); c.lineTo(34, -54); c.lineTo(36, -24); c.lineTo(54, -42); c.lineTo(44, -2); c.closePath(); c.fill();
  c.lineCap = 'round'; c.beginPath();
  c.moveTo(-240, 22); c.bezierCurveTo(-180, -34, -120, 54, -60, 10); c.bezierCurveTo(-20, -16, 20, 22, 56, 0);
  c.strokeStyle = body; c.lineWidth = 17; c.stroke();
  c.strokeStyle = belly; c.lineWidth = 5; c.stroke();
  c.fillStyle = body; c.beginPath();
  c.moveTo(48, -12); c.lineTo(94, -15); c.lineTo(106, -5); c.lineTo(82, 1); c.lineTo(98, 10); c.lineTo(58, 13); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(60, -11); c.lineTo(54, -34); c.lineTo(72, -13); c.fill();
  c.fillStyle = eye; c.beginPath(); c.arc(82, -7, 2.8, 0, TAU); c.fill();
  c.restore();
}

function skull(c, x, y, s) {
  c.save(); c.translate(x, y); c.scale(s, s);
  c.fillStyle = '#ebe6d8';
  c.beginPath(); c.arc(0, -8, 32, Math.PI * 0.95, Math.PI * 2.05); c.lineTo(22, 20); c.lineTo(-22, 20); c.closePath(); c.fill();
  c.fillRect(-16, 18, 32, 16);
  c.fillStyle = '#16171a';
  for (const ex of [-12, 12]) { c.beginPath(); c.ellipse(ex, -2, 9, 11, 0, 0, TAU); c.fill(); }
  c.beginPath(); c.moveTo(0, 8); c.lineTo(-5, 16); c.lineTo(5, 16); c.closePath(); c.fill();
  for (let i = -12; i <= 12; i += 6) c.fillRect(i - 0.8, 24, 1.6, 10);
  c.restore();
}

function kitty(c, x, y, s) {
  c.save(); c.translate(x, y); c.scale(s, s);
  c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(-20, -8); c.lineTo(-16, -30); c.lineTo(-4, -16); c.lineTo(4, -16); c.lineTo(16, -30); c.lineTo(20, -8);
  c.arc(0, 0, 21, -0.4, Math.PI + 0.4); c.closePath(); c.fill(); c.stroke();
  c.lineWidth = 2.5;
  for (const ex of [-8, 8]) { c.beginPath(); c.moveTo(ex - 4, -4); c.lineTo(ex + 4, 4); c.moveTo(ex + 4, -4); c.lineTo(ex - 4, 4); c.stroke(); }
  c.fillStyle = '#ff5c9d'; c.beginPath(); c.moveTo(-3, 7); c.lineTo(3, 7); c.lineTo(0, 11); c.fill();
  c.lineWidth = 1.2; c.beginPath();
  for (const sgn of [-1, 1]) for (const dy of [8, 12]) { c.moveTo(sgn * 6, dy); c.lineTo(sgn * 24, dy - 2 + (dy - 10)); }
  c.stroke();
  c.restore();
}

function beast(c, x, y, s) { // Hyper Beast-style monster face
  c.save(); c.translate(x, y); c.scale(s, s);
  c.fillStyle = '#1b1030'; c.beginPath(); c.ellipse(0, 0, 58, 44, 0, 0, TAU); c.fill();
  c.fillStyle = '#ff2f6d'; c.beginPath(); c.ellipse(4, 16, 42, 18, 0, 0, TAU); c.fill();
  c.fillStyle = '#fff';
  for (let i = -36; i <= 40; i += 10) {
    c.beginPath(); c.moveTo(i, 4); c.lineTo(i + 5, 16); c.lineTo(i + 10, 4); c.fill();
    c.beginPath(); c.moveTo(i, 30); c.lineTo(i + 5, 18); c.lineTo(i + 10, 30); c.fill();
  }
  for (const ex of [-22, 22]) {
    c.fillStyle = '#ffe23a'; c.beginPath(); c.ellipse(ex, -18, 12, 8, ex < 0 ? 0.3 : -0.3, 0, TAU); c.fill();
    c.fillStyle = '#111'; c.fillRect(ex - 1.5, -26, 3, 16);
  }
  c.restore();
}

function mouth(c, x, y, s) { // Chatterbox teeth
  c.save(); c.translate(x, y); c.scale(s, s);
  c.fillStyle = '#e0302a'; c.beginPath(); c.ellipse(0, 0, 70, 34, 0, 0, TAU); c.fill();
  c.fillStyle = '#1a0606'; c.beginPath(); c.ellipse(0, 0, 56, 22, 0, 0, TAU); c.fill();
  c.fillStyle = '#fbf6e8';
  for (let i = -48; i < 48; i += 12) { c.fillRect(i + 1, -20, 10, 13); c.fillRect(i + 1, 7, 10, 13); }
  c.restore();
}

const SKINS = {
  // M4A4 | Howl — red/orange flames with a howling wolf
  m4a4: [0.2, 0.42, (c, r) => {
    fill(c, lin(c, 0, 0, W, 0, [[0, '#8f1408'], [0.45, '#d8361a'], [0.75, '#f2641c'], [1, '#b8200e']]));
    flames(c, r, 0, W, H + 6, 100, ['rgba(92,10,4,0.55)', 'rgba(255,120,20,0.55)', 'rgba(255,200,40,0.6)'], 16);
    blobs(c, r, 20, '60,5,0', 10, 40, 0.35);
    wolf(c, 318, 64, 1.05, '#1a0906', '#ffd21a');
  }],
  // AWP | Dragon Lore — parchment, a green-and-gold dragon, ornate border
  awp: [0.1, 0.5, (c, r) => {
    fill(c, lin(c, 0, 0, W, H, [[0, '#ecdcaf'], [1, '#c9ad73']]));
    blobs(c, r, 60, '120,90,40', 4, 18, 0.18);
    c.strokeStyle = 'rgba(90,61,28,0.75)'; c.lineWidth = 1.5;
    for (const yy of [16, H - 16]) { // ornamental knotwork bands
      c.beginPath(); c.moveTo(0, yy - 4); c.lineTo(W, yy - 4); c.moveTo(0, yy + 4); c.lineTo(W, yy + 4); c.stroke();
      c.beginPath(); for (let x = 0; x <= W; x += 2) c.lineTo(x, yy + Math.sin(x * 0.35) * 3.5); c.stroke();
    }
    c.fillStyle = 'rgba(217,164,65,0.55)'; c.beginPath(); c.arc(380, 52, 34, 0, TAU); c.fill();
    dragon(c, 330, 70, 0.95, '#3f6b2a', '#d9a441', '#4e7d33', '#c8201e');
  }],
  // Glock-18 | Fade — anodized yellow → pink → purple
  glock: [0.85, 0.22, c => {
    fill(c, lin(c, 0, 0, W, 0, [[0, '#ffe14d'], [0.35, '#ff7ab8'], [0.7, '#8f5cff'], [1, '#3f6dff']]));
    fill(c, lin(c, 0, 0, 0, H, [[0, 'rgba(255,255,255,0.35)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.15)']]));
  }],
  // AK-47 | Fire Serpent — deep green, a golden serpent over flames
  ak47: [0.2, 0.5, (c, r) => {
    fill(c, lin(c, 0, 0, W, H, [[0, '#18301b'], [1, '#2f5230']]));
    flames(c, r, 0, W, H + 4, 60, ['rgba(200,40,20,0.6)', 'rgba(255,140,30,0.55)'], 18);
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 6;
    for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(r() * W, 0); c.quadraticCurveTo(r() * W, H * 0.5, r() * W, H); c.stroke(); }
    c.lineCap = 'round'; c.beginPath();
    for (let x = 30; x <= 380; x += 4) { const y = 58 + Math.sin(x * 0.035) * 22; x === 30 ? c.moveTo(x, y) : c.lineTo(x, y); }
    c.strokeStyle = '#d9a93b'; c.lineWidth = 13; c.stroke();
    c.strokeStyle = 'rgba(90,55,10,0.7)'; c.lineWidth = 2; c.setLineDash([3, 5]); c.stroke(); c.setLineDash([]);
    const hy = 58 + Math.sin(380 * 0.035) * 22;
    c.fillStyle = '#d9a93b'; c.beginPath(); c.ellipse(392, hy, 18, 10, 0.2, 0, TAU); c.fill();
    c.fillStyle = '#c8201e'; c.beginPath(); c.arc(398, hy - 3, 2.5, 0, TAU); c.fill();
    c.strokeStyle = '#c8201e'; c.lineWidth = 2; c.beginPath(); c.moveTo(410, hy + 2); c.lineTo(424, hy + 6); c.stroke();
  }],
  // USP-S | Kill Confirmed — gritty slate, a skull and red splatter
  usp: [0.25, 0.55, (c, r) => {
    fill(c, '#2a2d33'); blobs(c, r, 40, '80,85,95', 6, 30, 0.35); blobs(c, r, 25, '10,10,12', 6, 26, 0.4);
    blobs(c, r, 14, '179,18,27', 3, 14, 0.8);
    skull(c, 330, 58, 1.2);
    c.strokeStyle = '#b3121b'; c.lineWidth = 3; c.beginPath(); c.arc(330, 58, 50, 0, TAU); c.moveTo(270, 58); c.lineTo(390, 58); c.moveTo(330, 2); c.lineTo(330, 114); c.stroke();
    c.fillStyle = '#b3121b'; c.font = 'bold 20px sans-serif'; c.fillText('CONFIRMED', 60, 112);
  }],
  // Desert Eagle | Blaze — dark gunmetal with flames licking back from the muzzle
  deagle: [0.7, 0.3, (c, r) => {
    fill(c, lin(c, 0, 0, 0, H, [[0, '#4a4f57'], [1, '#1d2025']]));
    flames(c, r, 0, H, -10, 330, ['rgba(255,70,20,0.85)', 'rgba(255,150,30,0.9)', 'rgba(255,225,80,0.9)'], 12, true);
  }],
  // P250 | Asiimov — white sci-fi panels, black band, orange accents
  p250: [0.25, 0.4, (c, r) => asiimov(c, r)],
  // MAC-10 | Neon Rider — synthwave sun and neon grid
  mac10: [0.3, 0.4, c => {
    fill(c, lin(c, 0, 0, 0, H, [[0, '#1b0f3a'], [1, '#3a0f55']]));
    const sun = lin(c, 0, 20, 0, 110, [[0, '#ffe24a'], [1, '#ff3fa0']]);
    c.fillStyle = sun; c.beginPath(); c.arc(360, 70, 44, 0, TAU); c.fill();
    c.fillStyle = '#2a0f48'; for (let y = 76; y < 116; y += 8) c.fillRect(300, y, 120, 3);
    c.strokeStyle = '#ff3fd0'; c.lineWidth = 2;
    for (let i = -8; i <= 8; i++) { c.beginPath(); c.moveTo(256 + i * 10, 84); c.lineTo(256 + i * 70, H); c.stroke(); }
    c.strokeStyle = '#3ff5ff'; for (let k = 0; k < 5; k++) { const y = 86 + k * k * 2.2; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  }],
  // MP9 | Starlight Protector — cosmic purple, moon and sparkles
  mp9: [0.3, 0.35, (c, r) => {
    fill(c, lin(c, 0, 0, W, H, [[0, '#1b1450'], [0.55, '#5a2a9c'], [1, '#d06bd6']]));
    blobs(c, r, 18, '255,150,230', 10, 40, 0.25);
    c.fillStyle = '#ffe9a8'; c.beginPath(); c.arc(340, 56, 28, 0, TAU); c.fill();
    c.fillStyle = '#3a1f80'; c.beginPath(); c.arc(354, 48, 26, 0, TAU); c.fill();
    for (let i = 0; i < 40; i++) sparkle(c, r() * W, r() * H, 2 + r() * 5, r() < 0.3 ? '#ffd76a' : '#ffffff');
  }],
  // P90 | Death by Kitty — hot pink, black stripes, knocked-out kitties
  p90: [0.2, 0.45, c => {
    fill(c, '#ff6fb1');
    c.fillStyle = '#16121a';
    for (let x = -40; x < W; x += 58) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 18, 0); c.lineTo(x + 48, H); c.lineTo(x + 30, H); c.fill(); }
    for (const [x, y] of [[120, 62], [280, 50], [420, 70]]) kitty(c, x, y, 1.15);
  }],
  // Nova | Hyper Beast — neon graffiti monster
  nova: [0.25, 0.45, (c, r) => {
    fill(c, lin(c, 0, 0, W, 0, [[0, '#1ed6c9'], [0.5, '#8a3cff'], [1, '#ff3f8e']]));
    blobs(c, r, 20, '255,226,58', 6, 22, 0.7); blobs(c, r, 14, '40,255,120', 6, 20, 0.5);
    beast(c, 330, 64, 1);
  }],
  // Galil AR | Chatterbox — black and orange with a grinning mouth
  galil: [0.2, 0.5, (c, r) => {
    fill(c, '#141414');
    c.fillStyle = '#ff7a1a'; for (let i = 0; i < 9; i++) c.fillRect(r() * W, r() * H, 30 + r() * 80, 4 + r() * 6);
    c.fillStyle = '#f2f2f2'; for (let i = 0; i < 7; i++) c.fillRect(r() * W, r() * H, 20 + r() * 50, 3);
    mouth(c, 330, 64, 1);
  }],
  // M4A1-S | Printstream — pearlescent white with sweeping black ink
  m4a1s: [0.35, 0.28, (c, r) => {
    fill(c, lin(c, 0, 0, W, H, [[0, '#ffffff'], [0.5, '#f2f0ff'], [1, '#e8fbff']]));
    for (let i = 0; i < 7; i++) {
      c.fillStyle = '#0d0d0f'; c.beginPath(); const x = r() * W, w = 20 + r() * 60;
      c.moveTo(x, H); c.bezierCurveTo(x + w, H * 0.6, x - w * 0.5, H * 0.3, x + w * 1.5, 0); c.lineTo(x + w * 1.5 + 14, 0);
      c.bezierCurveTo(x - w * 0.2, H * 0.3, x + w * 1.3, H * 0.6, x + 16, H); c.fill();
    }
    c.strokeStyle = 'rgba(120,220,255,0.35)'; c.lineWidth = 2;
    for (let y = 10; y < H; y += 14) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y + 20); c.stroke(); }
  }],
  // SSG 08 | Dragonfire — black and red flames with a dragon's head
  ssg08: [0.2, 0.45, (c, r) => {
    fill(c, lin(c, 0, 0, W, 0, [[0, '#140606'], [1, '#2a0a08']]));
    flames(c, r, 0, W, H + 6, 110, ['rgba(160,20,10,0.8)', 'rgba(255,90,20,0.7)', 'rgba(255,200,60,0.6)'], 18);
    dragon(c, 300, 60, 0.9, '#0d0605', '#3a0d08', '#1e0a07', '#ffb02e');
  }],
};

function asiimov(c, r) {
  fill(c, '#f4f4f2');
  c.fillStyle = '#16181c'; c.fillRect(230, 0, 130, H);
  c.fillStyle = '#ff7a1a';
  for (const x of [60, 110, 400]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 26, 0); c.lineTo(x + 6, H); c.lineTo(x - 20, H); c.fill(); }
  c.fillRect(230, 52, 130, 10);
  c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1.5;
  for (let i = 0; i < 18; i++) { const x = r() * W, y = r() * H; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 30, y); c.lineTo(x + 38, y + 8); c.stroke(); }
}

const cache = {};
// { tex, metal, rough } for a weapon id, or null (knife has its own model)
export function skinFor(id) {
  if (cache[id] !== undefined) return cache[id];
  const def = SKINS[id];
  if (!def) return (cache[id] = null);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  def[2](cv.getContext('2d'), rng(id.length * 7919 + id.charCodeAt(0)));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return (cache[id] = { tex, metal: def[0], rough: def[1] });
}
