// The Ronin (shared/holdout.js CLASSES.ronin + KATANA): the melee kit. Runs 20% faster, heals anywhere once a few
// seconds unhurt, grows an Adrenaline Shot every 5 s (carries 30) and fights with the Zinkonium Katana, locked in
// hotbar slot 1 (slots 4-6 close: shared/items.js hotbarFor). The katana item lives on the player (p.katana: its
// kills, upgrades ku and element el), so leaving the kit and coming back keeps it; a new match forges a fresh one.
// Every move is checked here: the LMB combo (room.onShot hands 'katana' shots over), Fire Strike, Deflect (hooked into
// barrier.js stop(), which every zombie swing, glob and sniper shot already runs through) and the dash. Every katana
// hit bleeds and crits from behind.
import { KATANA as K, CLASSES, adrenCarry } from '../../shared/holdout.js';
import { HOTBAR } from '../../shared/items.js';
import { rayWorld } from '../../shared/physics.js';
import { addHazard } from './behaviors.js';
import { countOf, giveItem, makeItem } from './inventory.js';
import { nextUid } from '../baseRoom.js';

const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const DEG = Math.PI / 180;
const LAG = 250; // ms of cooldown slack for a message that arrives a little early
const vec3 = v => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v : null);
const tmp = [];
// the point of segment a -> b nearest p, on the ground plane: t (0..1 along it) and the distance d
function seg2(a, b, p) {
  const dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / l2)) : 0;
  return { t, d: Math.hypot(a[0] + dx * t - p[0], a[2] + dz * t - p[2]) };
}

export const makeKatana = () => ({ uid: nextUid(), id: 'katana', kind: 'gun', r: 4, tier: 1, el: null, att: {}, locked: true, kills: 0, ku: {} });

export class Ronin {
  constructor(room) { this.room = room; this.reset(); }

  reset() { this.strikes = []; this.perkAt = 0; }

  state(p) { return (p.kat ??= { combo: 0, swingAt: 0, strikeAt: 0, defAt: 0, defUntil: 0, defReady: 0, perfect: false, dashN: 0, dashReady: 0, dashAt: 0, adrenAt: 0 }); }
  katana(p) { return (p.katana ??= makeKatana()); }
  // on your feet, hands free and the katana on you
  armed(p) { return p.cls === 'ronin' && p.alive && !p.downed && !p.carrying && this.room.hasWeapon(p, 'katana'); }

  // p.cls just changed (or the backpack was reset). Into the kit: hotbar slots 1 and 4-6 empty into the backpack (at
  // your feet when it's full) and the katana takes slot 1. Out of it: the katana leaves the inventory (it keeps on p).
  onKit(p) {
    const inv = p.inv;
    if (p.cls !== 'ronin') {
      const at = p.katana ? inv.indexOf(p.katana) : -1;
      if (at >= 0) inv[at] = null;
      if (p.kat) p.kat.defUntil = 0;
      return;
    }
    const k = this.katana(p), at = inv.indexOf(k);
    if (at === 0) return;
    if (at > 0) inv[at] = null;
    for (const i of [0, 3, 4, 5]) {
      const it = inv[i];
      if (!it) continue;
      inv[i] = null;
      const j = inv.findIndex((x, n) => !x && n >= HOTBAR);
      if (j >= 0) inv[j] = it; else this.room.inventory.dropNear(p, it);
    }
    inv[0] = k;
  }

  // 4×/s: the heal once unhurt a while, and an Adrenaline Shot every few seconds while under the carry cap once the
  // match is on (into the sack or a free slot like a pickup — no room, none)
  perks(now) {
    const room = this.room, C = CLASSES.ronin;
    for (const p of room.players) {
      if (p.cls !== 'ronin' || !p.alive || p.downed) continue;
      const k = this.state(p);
      if (now - (p.hurtAt || 0) >= C.healAfter) room.healPlayer(p, C.heal * 0.25);
      if (!room.started()) continue;
      k.adrenAt ||= now + C.adrenEvery;
      if (now < k.adrenAt) continue;
      k.adrenAt = now + C.adrenEvery;
      if (countOf(p, 'adrenaline') < adrenCarry(p.cls) && !giveItem(p, makeItem('adrenaline', 1))) room.sendInv(p);
    }
  }

  // the AI step (20 Hz): the perks 4×/s, crescents fly, bleeds tick
  update(dt, now) {
    const room = this.room;
    if (now - this.perkAt >= 250) { this.perkAt = now; this.perks(now); }
    for (let i = this.strikes.length - 1; i >= 0; i--) if (this.fly(this.strikes[i], dt)) this.strikes.splice(i, 1);
    if (room.phase !== 'wave') return;
    for (const z of [...room.zombies.values()]) {
      if (z.dead || !(z.bleedUntil > now)) continue;
      const p = z.bleedBy;
      p.shotItem = p.katana; // its own bleed counts toward the katana's mastery
      room.damageZombie(z, z.bleedN * z.bleedDps * dt, p, 'bleed');
      p.shotItem = null;
    }
  }

  // One katana hit (swing, Fire Strike, dash): base × Edge × team buffs, ×crit from behind, the blade's element, a bleed
  // stack. o: { fire (Fire Strike: burns), knock (m shoved away from `from`), exec (the combo's third hit) }
  hit(p, z, base, from, o = {}) {
    const room = this.room, it = this.katana(p), ku = it.ku;
    if (z.dead || z.under || z.escaping) return;
    const dx = from[0] - z.pos[0], dz = from[2] - z.pos[2], l = Math.hypot(dx, dz);
    const facing = l > 0.1 ? (dx * -Math.sin(z.yaw) + dz * -Math.cos(z.yaw)) / l : 1; // cos of the angle off its facing
    const back = facing < Math.cos(K.back * DEG);
    let dmg = base * (1 + K.edge * (ku.edge || 0)) * room.dmgMultFor(p) * (back ? K.crit : 1);
    if (it.el && z.t.weak?.includes(it.el)) dmg *= 1.5; // pyros hate the cold, frost walkers fire
    if (z.type === 'titan' && facing < -0.3) dmg *= 2; // its egg sac
    if (z.type === 'gravekeeper') dmg *= room.bosses.grave.bellMult(z, from); // his bell
    dmg = Math.round(dmg);
    const immune = room.bosses.immune(z);
    p.shotItem = it; // kills count toward the katana's mastery
    let dealt = room.damageZombie(z, dmg, p, 'katana');
    if (dealt > 0 && !z.dead) {
      this.bleed(z, p);
      if (it.el) room.applyElement(z, it.el, dmg, p);
      if (o.fire) room.applyElement(z, 'fire', dmg, p);
      if (o.exec && ku.exec && !z.t.boss && z.hp < z.maxHp * K.exec) { // Execution
        dealt += room.damageZombie(z, z.hp, p, 'katana');
        room.broadcast({ t: 'kat', ev: 'exec', p: [r2(z.pos[0]), r2(z.pos[1] + 1.2 * z.s), r2(z.pos[2])] });
      }
      if (o.knock && !z.dead && !z.t.boss && !z.t.flyer) room.knockZombie(z, l > 0.1 ? -dx / l : 0, l > 0.1 ? -dz / l : 1, o.knock, 10, { noSlam: true });
    }
    p.shotItem = null;
    room.send(p, { t: 'dmg', att: p.id, vic: 'z' + z.id, dmg: Math.round(dealt), hp: Math.max(0, Math.round(z.hp)), part: back ? 'head' : 'chest', w: 'katana', helm: !!immune, immune, from: p.st.p });
  }

  bleed(z, p) {
    const B = K.bleed, hemo = this.katana(p).ku.hemo, now = Date.now();
    z.bleedN = Math.min(hemo ? B.hemoMax : B.max, (z.bleedUntil > now ? z.bleedN : 0) + 1);
    z.bleedUntil = now + B.time * 1000;
    z.bleedDps = B.dps * (hemo ? B.hemoMul : 1);
    z.bleedBy = p;
  }

  // LMB (room.onShot): m: { o: eye, h: [{ id }] — the zombies the client saw in the swing }. The server keeps the
  // combo: a swing within KATANA.window ms of the last one's end continues it (the third is wider and shoves).
  onSwing(p, m) {
    const room = this.room, now = Date.now(), k = this.state(p);
    if (!this.armed(p) || now - k.swingAt < K.swingMs * 0.7) return;
    k.combo = now - k.swingAt <= K.swingMs + K.window ? (k.combo + 1) % 3 : 0;
    k.swingAt = now;
    k.defUntil = 0; // swinging drops the guard
    const o = vec3(m.o), eye = room.eye(p);
    room.broadcast({ t: 'shot', id: p.id, w: 'katana', o: eye.map(r2), n: k.combo }, p);
    if (!o || Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) > 2.5 || !Array.isArray(m.h)) return;
    const step = K.combo[k.combo], f = [-Math.sin(p.st.y), -Math.cos(p.st.y)], cos = Math.cos((step.arc / 2 + 15) * DEG), seen = new Set();
    for (const h of m.h.slice(0, K.maxHits)) {
      const z = room.zombies.get(h?.id);
      if (!z || z.dead || seen.has(z)) continue;
      const dx = z.pos[0] - eye[0], dz = z.pos[2] - eye[2], d = Math.hypot(dx, dz);
      if (d > K.reach + 1.2 * z.s || z.pos[1] > eye[1] + 1 || z.pos[1] + 1.9 * z.s < eye[1] - 2.3) continue; // out of reach
      if (d > 0.4 && (dx * f[0] + dz * f[1]) / d < cos) continue; // outside the arc (+15° for lag)
      seen.add(z);
      this.hit(p, z, step.dmg, eye, { knock: step.knock, exec: k.combo === 2 });
    }
  }

  // m: { op: 'strike', o, d } | { op: 'deflect' } | { op: 'dash', o, d } — a refused one answers 'no' with the cooldowns
  onMsg(p, m) {
    if (m.op === 'strike') this.strike(p, m);
    else if (m.op === 'deflect') this.guard(p);
    else if (m.op === 'dash') this.dash(p, m);
  }

  // ms left [Fire Strike, Deflect, dash refill] and dash charges, for the HUD
  cds(p, now = Date.now()) {
    const k = this.state(p), max = this.katana(p).ku.chain ? 2 : 1;
    return [Math.max(0, k.strikeAt - now), Math.max(0, k.defReady - now), Math.max(0, k.dashReady - now), now >= k.dashReady ? max : k.dashN];
  }

  no(p, what, extra = {}) { this.room.send(p, { t: 'kat', ev: 'no', what, cd: this.cds(p), ...extra }); }

  // Fire Strike: m: { o: eye, d: aim }. Twin Fire Strike: two crescents in a V.
  strike(p, m) {
    const room = this.room, now = Date.now(), k = this.state(p), o = vec3(m.o), d = vec3(m.d), eye = room.eye(p);
    if (!this.armed(p) || now < k.strikeAt - LAG) return this.no(p, 'strike');
    const l = d ? Math.hypot(...d) : 0;
    if (!o || l < 1e-6 || Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) > 2.5) return;
    Object.assign(k, { strikeAt: now + K.strike.cd, defUntil: 0 });
    p.st.w = 'katana';
    const it = this.katana(p), u = d.map(v => v / l), list = [];
    for (const a of it.ku.twin ? [-K.strike.twin, K.strike.twin] : [0]) {
      const c = Math.cos(a * DEG), s = Math.sin(a * DEG), v = [u[0] * c + u[2] * s, u[1], u[2] * c - u[0] * s];
      this.strikes.push({ by: p, o: [...o], pos: [...o], u: v, went: 0, hit: new Set(), ember: !!it.ku.ember, emberAt: -Infinity });
      list.push(v.map(r3));
    }
    room.broadcast({ t: 'kat', ev: 'strike', id: p.id, o: o.map(r2), l: list, el: it.el }, p);
  }

  // One crescent's step: through every zombie it touches (each once) and through builds and props; the ground, the
  // map's edge and the Core stop it. Ember Trail drops burning ground under it. Returns true once it's done.
  fly(c, dt) {
    const room = this.room, S = K.strike, a = c.pos, step = Math.min(S.speed * dt, S.range - c.went);
    let b = a.map((v, j) => v + c.u[j] * step), done = c.went + step >= S.range - 1e-6;
    const boxes = room.grid.query(Math.min(a[0], b[0]) - 0.5, Math.min(a[2], b[2]) - 0.5, Math.max(a[0], b[0]) + 0.5, Math.max(a[2], b[2]) + 0.5, tmp)
      .filter(x => x.sid === undefined && x.node === undefined);
    const wall = rayWorld(a, c.u, step, boxes);
    if (wall) { b = a.map((v, j) => v + c.u[j] * wall.t); done = true; }
    for (const z of [...room.zombies.values()]) {
      if (z.dead || c.hit.has(z.id)) continue;
      const q = seg2(a, b, z.pos), y = a[1] + (b[1] - a[1]) * q.t;
      if (q.d > S.r + 0.35 * z.s || y < z.pos[1] - 0.8 || y > z.pos[1] + 1.9 * z.s + 0.6) continue;
      c.hit.add(z.id);
      this.hit(c.by, z, S.dmg, c.o, { fire: true });
    }
    c.went += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    c.pos = b;
    if (c.ember && c.went - c.emberAt >= K.ember.every) {
      c.emberAt = c.went;
      const gy = room.inventory.surfaceBelow(b[0], b[2], b[1]);
      if (b[1] - gy < 3.5) addHazard(room, 'ember', [b[0], gy, b[2]], K.ember.r, K.ember.time, 0, 0, K.ember.dps, c.by).w = 'ember'; // zombies only
    }
    return done;
  }

  // Deflect (the reload key with the katana in hand): a stance of KATANA.deflect.ms — deflect() does the blocking.
  guard(p) {
    const now = Date.now(), k = this.state(p), D = K.deflect;
    if (!this.armed(p) || now < k.defReady - LAG) return this.no(p, 'deflect');
    p.st.w = 'katana'; // like the barrier: the client's 'st' may still be on its way after a swap
    Object.assign(k, { defAt: now, defUntil: now + D.ms, defReady: now + D.cd, perfect: false });
    this.room.broadcast({ t: 'kat', ev: 'def', id: p.id }, p);
  }

  // barrier.js stop(): the first Ronin in his stance that segment a -> b passes before `before` (the Tank barrier's
  // crossing, a fraction of a -> b), coming from within KATANA.deflect.arc° in front, blocks it. src: the zombie behind
  // it; ranged: a glob or sniper shot — reflected at src — else a swing (a perfect parry staggers it). The first
  // block of a stance inside the perfect window heals and grants a shot. Returns where it was blocked, else null.
  deflect(a, b, dmg, src, ranged, before = Infinity) {
    const room = this.room, now = Date.now(), D = K.deflect;
    let best = null, bt = before;
    for (const p of room.players) {
      if (!(now < p.kat?.defUntil) || p.st.w !== 'katana' || !this.armed(p)) continue;
      const q = p.st.p, s = seg2(a, b, q), y = a[1] + (b[1] - a[1]) * s.t;
      if (s.t >= bt || s.d > 1.1 || y < q[1] - 0.4 || y > q[1] + 2.3) continue; // doesn't come near him
      const ix = a[0] - b[0], iz = a[2] - b[2], il = Math.hypot(ix, iz);
      if (il < 1e-3 || (ix * -Math.sin(p.st.y) + iz * -Math.cos(p.st.y)) / il < Math.cos((D.arc / 2) * DEG)) continue; // behind or beside him
      best = p;
      bt = s.t;
    }
    if (!best) return null;
    const p = best, k = p.kat, it = this.katana(p), at = a.map((v, i) => v + (b[i] - v) * bt);
    const perfect = !k.perfect && now - k.defAt <= (it.ku.mirror ? D.mirrorPerfect : D.perfect);
    const live = !!src && !src.dead && room.zombies.get(src.id) === src;
    let back = null;
    if (ranged && live) { // straight back at whoever threw or shot it
      back = [src.pos[0], src.pos[1] + 1.2 * src.s, src.pos[2]];
      p.shotItem = it;
      room.damageZombie(src, dmg * D.reflect * (it.ku.mirror ? D.mirror : 1), p, 'katana');
      p.shotItem = null;
    } else if (!ranged && live && perfect && !src.t.boss) src.stunUntil = now + 800; // a parried swing staggers it
    if (perfect) {
      k.perfect = true;
      room.healPlayer(p, D.heal);
      if (countOf(p, 'adrenaline') < adrenCarry(p.cls) && !giveItem(p, makeItem('adrenaline', 1))) room.sendInv(p);
    }
    room.broadcast({ t: 'kat', ev: 'block', id: p.id, p: at.map(r2), pf: perfect ? 1 : 0, ...(back ? { r: back.map(r2) } : {}) });
    return at;
  }

  // The dash: m: { o: feet, d: [x, z] aim }. One charge (two with Chain Dash) per KATANA.dash.cd. The server walks the
  // path itself — the first solid thing stops it — and cuts every zombie on it once. Refused: 'no' with where you are.
  dash(p, m) {
    const room = this.room, now = Date.now(), k = this.state(p), D = K.dash, o = vec3(m.o), d = m.d, max = this.katana(p).ku.chain ? 2 : 1;
    if (now >= k.dashReady - LAG) k.dashN = max; // the cooldown ran out: charges back
    const l = Array.isArray(d) && d.length === 2 && d.every(Number.isFinite) ? Math.hypot(d[0], d[1]) : 0;
    if (!this.armed(p) || k.dashN <= 0 || now - k.dashAt < D.ms * 0.75 || !o || l < 1e-6
      || Math.hypot(o[0] - p.st.p[0], o[2] - p.st.p[2]) > 2 || Math.abs(o[1] - p.st.p[1]) > 2) return this.no(p, 'dash', { p: p.st.p.map(r2) });
    if (k.dashN === max) k.dashReady = now + D.cd;
    k.dashN--;
    Object.assign(k, { dashAt: now, defUntil: 0 });
    const u = [d[0] / l, 0, d[1] / l], e = [o[0] + u[0] * D.dist, o[2] + u[2] * D.dist];
    const boxes = room.grid.query(Math.min(o[0], e[0]) - 1, Math.min(o[2], e[1]) - 1, Math.max(o[0], e[0]) + 1, Math.max(o[2], e[1]) + 1, tmp);
    let len = D.dist;
    for (const h of [0.5, 1.2]) { // waist and chest height: walls, builds, props, trees
      const hit = rayWorld([o[0], o[1] + h, o[2]], u, D.dist + 0.4, boxes);
      if (hit) len = Math.min(len, Math.max(0, hit.t - 0.4));
    }
    const to = [o[0] + u[0] * len, o[1], o[2] + u[2] * len];
    for (const z of [...room.zombies.values()]) {
      if (z.dead || z.pos[1] > o[1] + 2 || z.pos[1] + 1.9 * z.s < o[1] - 0.5 || seg2(o, to, z.pos).d > D.r + 0.35 * z.s) continue;
      this.hit(p, z, D.dmg, o);
    }
    room.broadcast({ t: 'kat', ev: 'dash', id: p.id, a: o.map(r2), b: to.map(r2) }, p);
  }
}
