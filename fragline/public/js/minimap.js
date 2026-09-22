// Zombie Holdout minimap (top-left) and full map (M). North-up. The minimap follows you (60 m across); the
// full map shows the whole Outpost, zooms with the wheel, pans by dragging and pings a spot on click.
// Drawn: props, trees and rocks, your squad's builds, the Core and its ring, attack lanes, teammates,
// survivors, zombies (at night only the ones close by, in your flashlight or just revealed by gunfire),
// loot, chests, supply drops, the Maw and its thumpers, the Gravekeeper's graves, the Behemoth, the Blacksmith and pings.
import { OUTPOST, OUTPOST_NODES } from '/shared/outpost.js';
import { SMITH } from '/shared/holdout.js';

const $ = id => document.getElementById(id);
const BUILD_FILL = { zink: '#8fc9bf' };
const PROP_FILL = { w: '#8a6a45', d: '#8f8778', h: '#56626b', c: '#7c776c' };
const NODE_FILL = { tree: '#3f7a3a', rock: '#7a7a70', car: '#4a5560', crate: '#8a6a45', barrel: '#6b5a48', rubble: '#6f6a60', pallet: '#8a6a45' };
const LANE_POS = Object.fromEntries(OUTPOST.lanes.map(l => [l.id, [(l.zone[0] + l.zone[2]) / 2, (l.zone[1] + l.zone[3]) / 2]]));
const B = OUTPOST.bounds, FULL = B.maxX - B.minX, SMALL = 60;

export class Minimap {
  constructor(h) {
    this.h = h;
    this.g = h.g;
    this.small = $('minimap');
    this.big = $('bigmap');
    this.pings = [];
    this.at = 0;
    this.revealed = new Map(); // zombie id -> until (lit up by gunfire at night)
    this.view = { cx: 0, cz: 0, span: FULL };
    this.drag = null;
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.small.width = this.small.height = Math.round(170 * dpr);
    // without pointer lock the real mouse drives the full map
    this.mouse = null;
    this.mouseHeld = false;
    this.onWheel = e => { if (this.open && !this.g.input.locked) { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1 : -1, e.clientX, e.clientY); } };
    this.onDown = e => { if (this.open && !this.g.input.locked && e.button === 0) { this.mouse = [e.clientX, e.clientY]; this.mouseHeld = true; this.press(e.clientX, e.clientY); } };
    this.onMove = e => { this.mouse = [e.clientX, e.clientY]; };
    this.onUp = e => { if (e.button === 0) this.mouseHeld = false; };
    this.big.addEventListener('wheel', this.onWheel, { passive: false });
    this.big.addEventListener('mousedown', this.onDown);
    addEventListener('mousemove', this.onMove);
    addEventListener('mouseup', this.onUp);
  }

  get open() { return this.g.ui === 'map'; }

  toggle(on = !this.open) {
    const g = this.g;
    if (on) {
      if (g.ui) return;
      g.ui = 'map';
      $('mapWrap').hidden = false;
      $('mapKey').textContent = this.h.key('map');
      const r = this.big.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      this.big.width = Math.round(r.width * dpr);
      this.big.height = Math.round(r.height * dpr);
      this.view = { cx: 0, cz: 0, span: FULL };
      if (g.input.locked) g.setVCursor(innerWidth / 2, innerHeight / 2);
      this.draw(true);
    } else if (this.open) {
      g.ui = null;
      this.drag = null;
      $('mapWrap').hidden = true;
      g.setVCursor(null);
    }
  }

  // screen point -> world [x, z] on the full map (null when outside it)
  toWorld(x, y) {
    const r = this.big.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const v = this.view;
    return [v.cx + ((x - r.left) / r.width - 0.5) * v.span, v.cz + ((y - r.top) / r.height - 0.5) * v.span];
  }

  zoom(dir, x, y) {
    const v = this.view, at = this.toWorld(x, y) ?? [v.cx, v.cz], span = Math.max(20, Math.min(FULL, v.span * (dir > 0 ? 1.25 : 0.8)));
    const k = span / v.span; // keep the point under the cursor in place
    v.cx = at[0] + (v.cx - at[0]) * k;
    v.cz = at[1] + (v.cz - at[1]) * k;
    v.span = span;
    this.clampView();
    this.draw(true);
  }

  clampView() {
    const v = this.view, half = v.span / 2;
    v.cx = Math.max(B.minX + half, Math.min(B.maxX - half, v.cx));
    v.cz = Math.max(B.minZ + half, Math.min(B.maxZ - half, v.cz));
  }

  // mouse (or virtual cursor) pressed on the map: a drag pans, a click pings
  press(x, y) {
    if (!this.toWorld(x, y)) return;
    this.drag = { x, y, cx: this.view.cx, cz: this.view.cz, moved: false };
  }

  // called every frame while the map is open, with the cursor and whether the button is still held
  tick(cur, held) {
    const d = this.drag;
    if (!d || !cur) return;
    const [x, y] = cur, r = this.big.getBoundingClientRect();
    if (Math.hypot(x - d.x, y - d.y) > 6) d.moved = true;
    if (d.moved) {
      this.view.cx = d.cx - ((x - d.x) / r.width) * this.view.span;
      this.view.cz = d.cz - ((y - d.y) / r.height) * this.view.span;
      this.clampView();
    }
    if (!held) {
      this.drag = null;
      const w = !d.moved && this.toWorld(d.x, d.y);
      if (w) this.g.net.send({ t: 'ping', x: Math.round(w[0] * 10) / 10, z: Math.round(w[1] * 10) / 10 });
    }
  }

  onPing(m) {
    this.pings = this.pings.filter(p => p.by !== m.by);
    this.pings.push({ x: m.x, z: m.z, by: m.by, until: this.g.now + 8, name: this.g.name(m.by) });
    this.h.ents.pingMark(m.by, m.x, m.z, 8);
    this.g.sound.play('tick', { vol: 0.9, rate: 1.8 });
  }

  // gunfire lights up zombies around the shooter for a moment (night minimap)
  revealNear(pos, r = 12) {
    const until = this.g.now + 3;
    for (const zb of this.h.zombies.list.values()) if (!zb.dead && Math.hypot(zb.pos[0] - pos[0], zb.pos[2] - pos[2]) < r) this.revealed.set(zb.id, until);
  }

  reset() {
    this.pings = [];
    this.revealed.clear();
    this.h.ents.clearPings?.();
    this.toggle(false);
  }

  update() {
    const now = this.g.now;
    if (this.open) this.tick(this.g.input.locked ? this.g.vcur : this.mouse, this.g.input.locked ? this.g.input.down('Mouse0') : this.mouseHeld);
    if (now - this.at < (this.open ? 1 / 30 : 1 / 12)) return;
    this.at = now;
    this.pings = this.pings.filter(p => p.until > now);
    for (const [id, t] of this.revealed) if (t < now) this.revealed.delete(id);
    this.draw(this.open);
  }

  // which zombies you can place (night hides the far ones)
  zombieVisible(zb, me, dark, torch, yaw, nvK = 0) {
    if (zb.type === 'shade') return (zb.vis ?? 0) > 0.5; // only shown while you can actually see it in the world
    if (zb.berserk || zb.type === 'hoarder') return true; // time's up stragglers, and the Hoarder, always show
    if (!dark) return true;
    const dx = zb.pos[0] - me[0], dz = zb.pos[2] - me[2], d = Math.hypot(dx, dz);
    if (d < 15 || zb.t.boss || zb.t.flyer || (this.revealed.get(zb.id) ?? 0) > this.g.now) return true;
    if (nvK > 0.5 && d < 35) return true;
    return torch && d < 40 && (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / d > Math.cos(0.45);
  }

  draw(big) {
    const cv = big ? this.big : this.small, c = cv.getContext('2d'), W = cv.width, H = cv.height;
    const h = this.h, g = this.g, pl = g.player, me = pl.pos;
    const v = big ? this.view : { cx: me[0], cz: me[2], span: SMALL }, s = W / v.span, k = W / (big ? 640 : 170); // k: marker scale
    const X = x => W / 2 + (x - v.cx) * s, Z = z => H / 2 + (z - v.cz) * s;
    const rect = (b, fill) => { c.fillStyle = fill; c.fillRect(X(b.min[0]), Z(b.min[2]), Math.max(1.5, (b.max[0] - b.min[0]) * s), Math.max(1.5, (b.max[2] - b.min[2]) * s)); };
    const dot = (x, z, r, fill) => { c.fillStyle = fill; c.beginPath(); c.arc(X(x), Z(z), r * k, 0, Math.PI * 2); c.fill(); };
    c.clearRect(0, 0, W, H);
    c.save();
    if (!big) { c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2); c.clip(); }
    const dark = h.nightK > 0.5;
    c.fillStyle = dark ? `rgba(6, 8, 14, ${big ? 1 : 0.9})` : `rgba(44, 58, 36, ${big ? 1 : 0.86})`;
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(0, 0, 0, 0.5)'; // outside the map
    if (X(B.minX) > 0) c.fillRect(0, 0, X(B.minX), H);
    if (X(B.maxX) < W) c.fillRect(X(B.maxX), 0, W - X(B.maxX), H);
    if (Z(B.minZ) > 0) c.fillRect(0, 0, W, Z(B.minZ));
    if (Z(B.maxZ) < H) c.fillRect(0, Z(B.maxZ), W, H - Z(B.maxZ));
    // the two roads through the Core
    c.fillStyle = 'rgba(150, 132, 100, 0.4)';
    c.fillRect(X(-3), Z(B.minZ), 6 * s, FULL * s);
    c.fillRect(X(B.minX), Z(-3), FULL * s, 6 * s);
    // build zone
    c.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    c.lineWidth = 1;
    c.beginPath(); c.arc(X(0), Z(0), OUTPOST.zone * s, 0, Math.PI * 2); c.stroke();
    for (const n of h.nodes.nodes) if (n.hp > 0) rect(n.box, NODE_FILL[n.type] ?? '#777');
    for (const b of h.props.boxes) if (b.min[1] < 2.5) rect(b, PROP_FILL[b.mat] ?? '#777'); // roofs would hide the rooms
    // builds: floors and stairs under walls; upper floors skipped so they don't cover the rooms
    const pieces = [...h.structs.list.values()];
    for (const p of pieces) if (p.kind !== 'wall' && p.l === 0) rect(p.box, BUILD_FILL[p.mat] + '99');
    for (const p of pieces) if (p.kind === 'wall') rect(p.box, BUILD_FILL[p.mat]);
    for (const d of h.ents.defs.values()) if (d.pos) dot(d.pos[0], d.pos[2], 2.6, d.type === 'turret' || d.type === 'rturret' ? '#9fe3ff' : '#ffb070');
    // the Core and the shop ring
    c.strokeStyle = 'rgba(94, 230, 255, 0.7)';
    c.lineWidth = 1.5 * k;
    c.beginPath(); c.arc(X(0), Z(0), OUTPOST.buyRadius * s, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#5ee6ff';
    const r0 = 5 * k;
    c.beginPath(); c.moveTo(X(0), Z(0) - r0); c.lineTo(X(0) + r0, Z(0)); c.lineTo(X(0), Z(0) + r0); c.lineTo(X(0) - r0, Z(0)); c.fill();
    // lanes: purple = attacking now, amber = next
    for (const id of new Set([...h.lanes, ...h.next])) {
      const [x, z] = LANE_POS[id];
      dot(x, z, 5, h.lanes.includes(id) ? '#c26bff' : '#ffc34d');
    }
    // loot, chests, supply drops, the Blacksmith, thumpers
    for (const pk of h.ents.pickups.values()) dot(pk.pos[0], pk.pos[2], 1.6, '#ffe066');
    for (const ch of h.ents.chests.values()) { c.fillStyle = '#ffb43c'; c.fillRect(X(ch.x) - 3 * k, Z(ch.z) - 2.4 * k, 6 * k, 4.8 * k); }
    for (const d of h.ents.drops.values()) { c.fillStyle = '#6fb8ff'; c.fillRect(X(d.x) - 3.5 * k, Z(d.z) - 3.5 * k, 7 * k, 7 * k); }
    if (h.smithOn) { c.fillStyle = '#ff8a3c'; c.fillRect(X(SMITH.x) - 3 * k, Z(SMITH.z) - 2 * k, 6 * k, 4 * k); }
    for (const t of h.ents.thumpers?.values() ?? []) dot(t.x, t.z, 4.5, t.state === 'pulse' ? '#5dff7a' : t.state === 'spent' ? '#666' : '#ffb43c');
    const mw = h.ents.maw;
    if (mw) { c.strokeStyle = '#ff5a8a'; c.lineWidth = 2 * k; c.beginPath(); c.arc(X(mw.x), Z(mw.z), 7 * k, 0, Math.PI * 2); c.stroke(); }
    h.gk.drawMap(c, X, Z, k); // the Gravekeeper's grave pits
    if (h.bhm.alive) { const b = h.bhm.b.box; rect(b, '#8a3a1f'); c.strokeStyle = '#ff7a2a'; c.lineWidth = 2 * k; c.strokeRect(X(b.min[0]), Z(b.min[2]), (b.max[0] - b.min[0]) * s, (b.max[2] - b.min[2]) * s); } // the Behemoth's footprint
    // zombies (bosses bigger; the Iron Golem an orange square, the Core Seeker a red diamond)
    for (const zb of h.zombies.list.values()) {
      if (zb.dead || !this.zombieVisible(zb, me, dark, h.flashOn, pl.yaw, h.nvK)) continue;
      if (zb.type === 'golem') { c.fillStyle = '#ff8a2a'; c.fillRect(X(zb.pos[0]) - 3.2 * k, Z(zb.pos[2]) - 3.2 * k, 6.4 * k, 6.4 * k); continue; }
      if (zb.type === 'seeker') {
        const dx = X(zb.pos[0]), dz = Z(zb.pos[2]), r = 3.6 * k;
        c.fillStyle = '#ff3030';
        c.beginPath(); c.moveTo(dx, dz - r); c.lineTo(dx + r, dz); c.lineTo(dx, dz + r); c.lineTo(dx - r, dz); c.fill();
        continue;
      }
      if (zb.type === 'hoarder') { // a pulsing gold coin — impossible to miss
        const pulse = 0.75 + 0.25 * Math.sin(g.now * 6);
        c.fillStyle = '#ffd700';
        c.beginPath(); c.arc(X(zb.pos[0]), Z(zb.pos[2]), 4 * k * pulse, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#7a5b00'; c.lineWidth = 1.5 * k; c.stroke();
        continue;
      }
      if (zb.t.flyer) { // a little triangle in the air — the Sky Sniper glows cyan, the Swooper a duller violet
        const dx = X(zb.pos[0]), dz = Z(zb.pos[2]), r = 4 * k;
        c.fillStyle = zb.type === 'skysniper' ? '#5df2ff' : '#a06bff';
        c.beginPath(); c.moveTo(dx, dz - r); c.lineTo(dx + r * 0.85, dz + r * 0.7); c.lineTo(dx - r * 0.85, dz + r * 0.7); c.fill();
        continue;
      }
      const berserkPulse = zb.berserk ? 0.6 + 0.4 * Math.sin(g.now * 8) : 1;
      dot(zb.pos[0], zb.pos[2], (zb.t.boss ? 5 : zb.berserk ? 3 : 2) * berserkPulse, zb.berserk ? '#ff0000' : zb.t.boss ? '#ff2a2a' : '#e04848');
    }
    // survivors, teammates, pings, you
    for (const sv of h.ents.survivors.values()) if (sv.pos[1] > -10) dot(sv.pos[0], sv.pos[2], 2.6, sv.state === 0 ? '#ff9a3c' : '#ffd28a');
    for (const p of h.roster) {
      const r = p.id !== g.me.id && p.alive && g.remotes.get(p.id);
      if (r) this.arrow(c, X(r.pos[0]), Z(r.pos[2]), r.yaw, p.downed ? '#ff6b6b' : '#4db8ff', 5.5 * k);
    }
    for (const p of this.pings) {
      c.strokeStyle = '#ffe14d';
      c.lineWidth = 2 * k;
      c.beginPath(); c.arc(X(p.x), Z(p.z), (6 + Math.sin(g.now * 6) * 1.5) * k, 0, Math.PI * 2); c.stroke();
      if (big) { c.fillStyle = '#ffe14d'; c.font = `${Math.round(12 * k)}px sans-serif`; c.fillText(p.name ?? '', X(p.x) + 9 * k, Z(p.z) - 6 * k); }
    }
    if (pl.alive) this.arrow(c, X(me[0]), Z(me[2]), pl.yaw, '#ffffff', 6.5 * k);
    c.restore();
    if (!big) {
      c.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      c.lineWidth = 2;
      c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2); c.stroke();
      c.fillStyle = 'rgba(255, 255, 255, 0.75)';
      c.font = `bold ${Math.round(11 * k)}px sans-serif`;
      c.textAlign = 'center';
      c.fillText('N', W / 2, 13 * k);
      c.textAlign = 'start';
    }
  }

  arrow(c, x, z, yaw, color, size) {
    c.save();
    c.translate(x, z);
    c.rotate(-yaw); // yaw 0 faces -z (up on the map)
    c.fillStyle = color;
    c.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, -size); c.lineTo(size * 0.65, size * 0.7); c.lineTo(0, size * 0.35); c.lineTo(-size * 0.65, size * 0.7); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }

  dispose() {
    this.big.removeEventListener('wheel', this.onWheel);
    this.big.removeEventListener('mousedown', this.onDown);
    removeEventListener('mousemove', this.onMove);
    removeEventListener('mouseup', this.onUp);
    this.toggle(false);
  }
}
