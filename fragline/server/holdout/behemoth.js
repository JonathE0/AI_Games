// The Behemoth (wave 25, 50…): a walking fortress. Announced at the wave start, it arrives once the horde is
// cleared and marches down a lane at the Core, crushing whatever stands in its footprint (every build it flattens
// costs it ~1.2 s). Every ~20 s it braces and shells the Core. Its body is a moving static box (room.grid for
// collision, room.statics so nothing is built into it); players ramp up onto the deck and ride it (their clients
// carry them, see public/js/boss_behemoth.js). Only its three reactor hearts can be hurt, each under a hatch whose
// three bolts the harvest tool breaks; a dead heart makes it rear up and throw everyone off the deck, the last one
// kills it. At the Core it slams it for 15 % of the Core's max HP every 6 s. Geometry: shared/behemoth.js.
import { BEHEMOTH as B, HATCHES, BOLTS, bhmBox, bhmPoint, heartPos, boltPos, onDeck } from '../../shared/behemoth.js';
import { bossCycle, CORE_ARMOR } from '../../shared/zombies.js';
import { rollLoot, MONEY_CAP } from '../../shared/holdout.js';
import { raySphere } from '../../shared/skyboss.js';
import { overlaps, distToBox, boxCenter } from '../../shared/build.js';

const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a) => Math.max(-a, Math.min(a, v));
const CREW = ['runner', 'stalker', 'spitter'];
const tmp = [];
// [side, forward] offset of a world point from its center
const local = (b, p) => [(p[0] - b.x) * b.fz - (p[2] - b.z) * b.fx, (p[0] - b.x) * b.fx + (p[2] - b.z) * b.fz];

export class Behemoth {
  constructor(room) { this.room = room; this.reset(); }

  reset() {
    if (this.b?.box) this.remove();
    this.b = null;        // { mode: 'waiting' | 'coming' | 'march' | 'brace' | 'siege' | 'dead', x, z, fx, fz, box, hearts … }
    this.shells = [];     // [{ id, o, v, T, t0, last }] siege shells in the air
    this.shellId = 0;
  }

  busy() { return !!this.b && this.b.mode !== 'dead'; }

  onWave(w) {
    this.b = { mode: 'waiting', w };
    this.room.broadcast({ t: 'task', text: 'THE BEHEMOTH marches once this wave is cleared — stair up onto its deck and break the hatch bolts with your harvest tool' });
  }

  update(dt, now) {
    const room = this.room, b = this.b;
    this.updateShells(now);
    if (!b || b.mode === 'dead') return;
    if (b.mode === 'waiting') {
      if (room.director.remaining + [...room.zombies.values()].filter(z => !z.t.boss).length === 0) {
        b.mode = 'coming'; b.at = now + 5000;
        room.broadcast({ t: 'bhm', ev: 'warn', ms: 5000 });
      }
      return;
    }
    if (b.mode === 'coming') { if (now >= b.at) this.spawn(now); return; }
    if (b.mode === 'march' && now >= b.nextBrace) {
      b.mode = 'brace'; b.braceEnd = now + B.braceFor; b.nextBrace = now + B.braceEvery; b.shots = B.shellAt.map(t => now + t);
      room.broadcast({ t: 'bhm', ev: 'brace', ms: B.braceFor });
    }
    if (b.mode === 'brace') {
      while (b.shots.length && now >= b.shots[0]) { b.shots.shift(); this.fire(now); }
      if (now >= b.braceEnd) b.mode = 'march';
    }
    const moving = b.mode === 'march' && now >= b.stall && now >= b.rearUntil;
    if (moving) {
      const c = room.map.core, left = Math.hypot(b.x - c.x, b.z - c.z) - B.stop, step = Math.min(Math.max(0, left), B.speed * dt);
      this.move(b.fx * step, b.fz * step);
      if (left - step <= 1e-3) { b.mode = 'siege'; b.nextSlam = now + B.slamEvery; room.broadcast({ t: 'bhm', ev: 'siege', ms: B.slamEvery }); }
    }
    if (moving !== b.moving || (moving && now - b.netAt > 1000)) {
      b.moving = moving; b.netAt = now;
      room.broadcast({ t: 'bhm', ev: 'mv', x: r2(b.x), z: r2(b.z), on: moving ? 1 : 0 });
    }
    this.crush(dt, now, moving);
    if (now >= b.nextCrew) this.boardCrew(now);
    if (b.mode === 'siege' && now >= b.nextSlam) {
      b.nextSlam = now + B.slamEvery;
      room.damageCore((room.core.max * B.slamFrac) / CORE_ARMOR, this.standIn()); // damageCore applies CORE_ARMOR
      room.broadcast({ t: 'bhm', ev: 'slam', ms: B.slamEvery });
    }
  }

  spawn(now) {
    const room = this.room, b = this.b, c = room.map.core, n = room.activeCount();
    const ids = room.director.lanes.length ? room.director.lanes : ['N'], id = ids[Math.floor(room.rng() * ids.length)];
    const lane = room.map.lanes.find(l => l.id === id) ?? room.map.lanes[0], [x0, z0, x1, z1] = lane.zone;
    const dx = c.x - (x0 + x1) / 2, dz = c.z - (z0 + z1) / 2, l = Math.hypot(dx, dz);
    const hp = Math.round(B.heartHp * (1 + 0.6 * (n - 1)) * (1 + 0.5 * bossCycle(b.w)));
    Object.assign(b, {
      mode: 'march', lane: lane.id, fx: Math.round(dx / l), fz: Math.round(dz / l), stall: 0, rearUntil: 0, moving: false, netAt: 0,
      nextBrace: now + B.braceEvery, nextCrew: now + 4000, hearts: HATCHES.map(() => ({ bolts: BOLTS.map(() => B.boltHits), open: false, hp, max: hp })),
    });
    b.x = c.x - b.fx * B.start; b.z = c.z - b.fz * B.start;
    b.box = bhmBox(b);
    room.grid.add(b.box);
    room.statics.push(b.box);
    room.broadcast({ t: 'bhm', ev: 'enter', ...this.state() });
  }

  // Moves it (and the crew standing on its deck; players ride on their own clients).
  move(dx, dz) {
    const room = this.room, b = this.b, box = b.box;
    for (const z of room.zombies.values()) if (!z.dead && onDeck(z.pos, box)) { z.pos[0] += dx; z.pos[2] += dz; }
    b.x += dx; b.z += dz;
    room.grid.remove(box);
    bhmBox(b, box);
    room.grid.add(box);
  }

  // Builds and props in its footprint (plus a hand's width ahead) take heavy damage; each build flattened stalls it.
  // While it walks, players in its way are knocked aside, zombies and survivors on the ground slide out of it.
  crush(dt, now, moving) {
    const room = this.room, b = this.b, box = b.box, zone = { min: [...box.min], max: [...box.max] };
    if (b.fx) zone[b.fx > 0 ? 'max' : 'min'][0] += 0.6 * b.fx; else zone[b.fz > 0 ? 'max' : 'min'][2] += 0.6 * b.fz;
    const hit = new Set();
    for (const q of room.grid.query(zone.min[0], zone.min[2], zone.max[0], zone.max[2], tmp)) if (q.sid !== undefined && overlaps(q, zone, 0.02)) hit.add(room.pieces.get(q.sid));
    for (const s of hit) {
      if (!s) continue;
      room.damagePiece(s, B.crushDps * dt);
      if (room.pieces.get(s.id) === s || s.kind === 'prop') continue;
      b.stall = Math.max(b.stall, now) + B.crushStall;
      room.broadcast({ t: 'bhm', ev: 'crush', p: boxCenter(s.box).map(r2) });
    }
    const S = B.wide / 2, F = B.len / 2, inside = (p, m) => { const [s, f] = local(b, p); return p[1] < B.deck - 0.5 && Math.abs(s) < S + m && Math.abs(f) < F + m; };
    if (moving) for (const p of room.players) {
      if (!p.alive || p.downed || now < (p.bhmKnock || 0) || !inside(p.st.p, 0.45)) continue;
      p.bhmKnock = now + 800;
      room.hurtPlayer(p, B.crushDmg * room.director.dmgMul, this.standIn());
      if (p.cls !== 'tank') this.knock(p, 7, 4.5); // Tanks shrug off knockback (their client still steps out of its body)
    }
    const out = p => { const [s, f] = local(b, p), q = bhmPoint(b, (s >= 0 ? 1 : -1) * (S + 0.5), p[1], f); p[0] = q[0]; p[2] = q[2]; };
    for (const z of room.zombies.values()) {
      if (z.dead) continue;
      if (z.crew && !z.knock && z.pos[1] > B.deck - 0.3) { // crew keep to the deck (unless blasted off it)
        const [s, f] = local(b, z.pos), q = bhmPoint(b, clamp(s, S - 0.45), 0, clamp(f, F - 0.45));
        z.pos[0] = q[0]; z.pos[2] = q[2];
      } else if (inside(z.pos, 0.3)) out(z.pos);
    }
    for (const sv of room.survivors.list.values()) if (sv.state !== 'carried' && inside(sv.pos, 0.3)) out(sv.pos);
  }

  // Sideways (away from its center line) and up: h / up in m/s, applied by that player's client.
  knock(p, h, up) {
    const b = this.b, s = local(b, p.st.p)[0] >= 0 ? 1 : -1;
    this.room.send(p, { t: 'bhm', ev: 'kb', v: [r2(b.fz * s * h), up, r2(-b.fx * s * h)] });
  }

  standIn() { return { id: 0, pos: [this.b.x, 0, this.b.z], t: { name: 'the Behemoth' } }; }

  // 2 fresh crew climb out onto the deck (never more than crewCap aboard)
  boardCrew(now) {
    const room = this.room, b = this.b;
    b.nextCrew = now + B.crewEvery;
    const aboard = [...room.zombies.values()].filter(z => z.crew && !z.dead).length;
    for (let i = 0; i < Math.min(2, B.crewCap - aboard); i++) {
      const z = room.spawnZombie(CREW[Math.floor(room.rng() * CREW.length)], b.lane, '');
      const p = bhmPoint(b, (room.rng() - 0.5) * (B.wide - 2), B.deck + 0.05, (room.rng() - 0.5) * (B.len - 2));
      Object.assign(z, { pos: p, vel: [0, 0, 0], crew: true });
      const e = room.spawnBatch.find(s => s[0] === z.id); // appear on the deck, not at the lane gate
      if (e) { e[3] = r2(p[0]); e[4] = r2(p[2]); }
      room.broadcast({ t: 'bhm', ev: 'crew', p: p.map(r2) });
    }
  }

  // A siege shell from the mortar on its back, on a telegraphed arc into the Core (flies in updateShells).
  fire(now) {
    const room = this.room, b = this.b, c = room.map.core, a = room.rng() * Math.PI * 2, r = room.rng() * 2;
    const o = bhmPoint(b, 0, B.deck + 1.6, B.len / 2 - 1), p = [c.x + Math.cos(a) * r, 1, c.z + Math.sin(a) * r];
    const T = Math.min(3.5, Math.max(2.2, Math.hypot(p[0] - o[0], p[2] - o[2]) / 11));
    const v = [(p[0] - o[0]) / T, (p[1] - o[1]) / T + 0.5 * B.shellG * T, (p[2] - o[2]) / T], id = ++this.shellId;
    this.shells.push({ id, o, v, T, t0: now, last: o });
    room.broadcast({ t: 'bhm', ev: 'shell', id, o: o.map(r2), v: v.map(r2), ms: Math.round(T * 1000) });
  }

  // Shells follow the arc the clients draw; a Tank's barrier across it takes the shell, else it lands at the Core.
  updateShells(now) {
    const room = this.room;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i], t = Math.min(s.T, (now - s.t0) / 1000), mul = room.director.dmgMul;
      const p = [s.o[0] + s.v[0] * t, s.o[1] + s.v[1] * t - 0.5 * B.shellG * t * t, s.o[2] + s.v[2] * t];
      const wall = room.barriers.stop(s.last, p, B.shellDmg * mul);
      s.last = p;
      if (!wall && t < s.T) continue;
      this.shells.splice(i, 1);
      if (wall) { room.broadcast({ t: 'bhm', ev: 'shellhit', id: s.id, p: wall.map(r2) }); continue; }
      const by = { id: 0, pos: p, t: { name: 'the Behemoth' } };
      if (distToBox(p, room.coreBase) <= B.shellR) room.damageCore(B.shellCore / CORE_ARMOR, by);
      for (const q of room.targets()) if (q.alive && !q.downed && Math.hypot(q.st.p[0] - p[0], q.st.p[1] + 0.9 - p[1], q.st.p[2] - p[2]) <= B.shellR) room.hurtPlayer(q, B.shellDmg * mul, by);
    }
  }

  // ---------- weak points ----------
  // Harvest-tool hit on bolt m.bolt = [hatch, bolt] (the knife-hit path, room.js onHarvest). Two hits break a bolt;
  // with all three gone the hatch opens and its heart is exposed.
  onBolt(p, m) {
    const b = this.b, now = Date.now(), [i, j] = Array.isArray(m.bolt) ? m.bolt.map(v => v | 0) : [], h = b?.box && b.hearts[i];
    if (!h || h.open || !(h.bolts[j] > 0) || !p.alive || p.downed || p.st.w !== 'knife' || now - p.lastHarvest < 280) return;
    const e = this.room.eye(p), q = boltPos(b, i, j);
    if (Math.hypot(e[0] - q[0], e[1] - q[1], e[2] - q[2]) > B.reach) return;
    p.lastHarvest = now;
    h.bolts[j]--;
    this.room.broadcast({ t: 'bhm', ev: 'bolt', h: i, j, n: h.bolts[j] });
    if (h.bolts.some(n => n > 0)) return;
    h.open = true;
    this.room.broadcast({ t: 'bhm', ev: 'open', h: i, by: p.id });
  }

  // Gun claim on heart i: only an open heart, only along a ray that passes it, only with a clear line to it (so it
  // can't be shot through the deck from below). Returns damage dealt.
  hitHeart(p, i, o, d, dmg) {
    const b = this.b, h = b?.box && b.hearts[i];
    if (!h || !h.open || h.hp <= 0 || !Array.isArray(d) || !d.every(Number.isFinite)) return 0;
    const l = Math.hypot(...d), c = heartPos(b, i);
    if (!l || raySphere(o, d.map(v => v / l), c, B.heartR + 0.6) < 0 || !this.room.lineOfSight(o, c)) return 0;
    return this.damageHeart(i, dmg, p);
  }

  // explosions (combat.js) next to an open heart
  blast(at, radius, dmg, by) {
    const b = this.b;
    if (!b?.box) return;
    b.hearts.forEach((h, i) => {
      const d = Math.hypot(...heartPos(b, i).map((v, k) => v - at[k]));
      if (h.open && h.hp > 0 && d <= radius + B.heartR) this.damageHeart(i, dmg * (1 - (0.5 * d) / (radius + B.heartR)), by);
    });
  }

  damageHeart(i, dmg, by) {
    const b = this.b, h = b.hearts[i], dealt = Math.min(dmg, h.hp), now = Date.now();
    if (!(dealt > 0)) return 0;
    h.hp -= dealt;
    if (by?.stats) by.stats.dmg += Math.round(dealt);
    if (h.hp <= 0) this.killHeart(i, by, now);
    else if (now - (h.netAt || 0) > 120) { h.netAt = now; this.room.broadcast({ t: 'bhm', ev: 'hp', h: i, hp: Math.round(h.hp) }); }
    return dealt;
  }

  // A heart bursts: it rears up (a pause in its march) and throws everyone off the deck. The last one kills it.
  killHeart(i, by, now) {
    const room = this.room, b = this.b;
    b.hearts[i].hp = 0;
    room.broadcast({ t: 'bhm', ev: 'heart', h: i, by: by?.id ?? null });
    if (b.hearts.every(h => h.hp <= 0)) return this.die(by);
    b.rearUntil = now + B.rear;
    for (const p of room.players) {
      if (!p.alive || p.cls === 'tank') continue;
      const [s, f] = local(b, p.st.p);
      if (p.st.p[1] > B.deck - 0.6 && Math.abs(s) < B.wide / 2 + 0.6 && Math.abs(f) < B.len / 2 + 0.6) this.knock(p, 9, 7);
    }
  }

  die(by) {
    const room = this.room, b = this.b;
    b.mode = 'dead';
    this.remove();
    this.shells = [];
    for (const q of room.players) { q.money = Math.min(MONEY_CAP, q.money + B.reward); room.sendInv(q); }
    room.inventory.scatter([{ kind: 'gun', w: 'siegebreaker', r: 4, tier: 3, el: null }, ...rollLoot('boss')], [b.x, 0.05, b.z], 3, true);
    room.broadcast({ t: 'msg', text: 'The Behemoth dropped the Siegebreaker!' });
    room.broadcast({ t: 'bhm', ev: 'die', x: r2(b.x), z: r2(b.z), by: by?.id ?? null });
  }

  // its body leaves the world (death or reset): nothing collides with it or is blocked by it any more
  remove() {
    const room = this.room, box = this.b.box, i = room.statics.indexOf(box);
    room.grid.remove(box);
    if (i >= 0) room.statics.splice(i, 1);
    this.b.box = null;
  }

  state() {
    const b = this.b;
    return { x: r2(b.x), z: r2(b.z), fx: b.fx, fz: b.fz, on: b.moving ? 1 : 0, mode: b.mode, hearts: b.hearts.map(h => [Math.round(h.hp), h.max, h.open ? 1 : 0, ...h.bolts]) };
  }

  syncTo(p) { if (this.b?.box) this.room.send(p, { t: 'bhm', ev: 'sync', ...this.state() }); }
}
