// Client weapon handling: fire rate, movement/jump/crouch spread, CS-style spray patterns with
// view punch, reloads (magazine + shell-by-shell), sniper zoom with bolt re-zoom, and the knife.
// Zombie Holdout adds a six-slot hotbar (knife = slot 0; non-gun items are held as 'hold_item'), backpack ammo
// (reloads ask the server for rounds), per-gun magazines (attachments, class), burst rifles, a spinning
// minigun, the rocket launcher, and sniper shots at the Colossus' weak points.
import { WEAPONS, maxSpeed } from '../../shared/weapons.js';
import { magFor, HOTBAR } from '../../shared/items.js';
import { traceBullet, dirFromAngles, rayPlayer } from '../../shared/physics.js';
import { raySphere } from '../../shared/skyboss.js';
import { ELEMENTS } from '../../shared/elements.js';

const DEG = Math.PI / 180;
const r3 = v => Math.round(v * 1000) / 1000;
const KNIFE = { w: 'knife', uid: 'knife' };

export class Weapons {
  constructor(game) {
    this.g = game;
    this.configure(false);
    this.reset();
  }

  // holdout = true: slots 1–6 are the hotbar, 0 is the knife (harvest tool), reserve ammo lives in `pool`
  configure(holdout) {
    this.pooled = holdout;
    this.slots = holdout ? Object.fromEntries([[0, KNIFE], ...Array.from({ length: HOTBAR }, (_, i) => [i + 1, null])]) : { 1: null, 2: null, 3: KNIFE };
    this.order = holdout ? [...Array.from({ length: HOTBAR }, (_, i) => i + 1), 0] : [1, 2, 3];
    this.knifeSlot = holdout ? 0 : 3;
    this.slot = this.knifeSlot;
    this.lastSlot = holdout ? 1 : 2;
    this.ammo = {};
    this.pool = {};
  }

  reset() {
    Object.assign(this, {
      punch: [0, 0], sprayIdx: 0, bloom: 0, nextFire: 0, lastShot: -1, deployEnd: 0, deployDur: 1,
      reloadEnd: 0, reloadStart: 0, reloadSrcs: [], shellNext: 0, scope: 0, rezoom: 0, rezoomAt: 0, triggerDown: false,
      inspectStart: -1, inspectDur: 1, burstLeft: 0, spin: 0,
    });
  }

  // CS-style weapon inspect (default key F). Firing, reloading, scoping or switching cancels it.
  inspect() {
    if (this.g.now < this.deployEnd || this.reloadEnd || this.scope || !this.g.player.alive) return;
    this.inspectStart = this.g.now;
    this.inspectDur = this.w.cat === 'melee' ? 3.2 : 2.6;
  }

  inspectProgress() {
    if (this.inspectStart < 0) return -1;
    const t = (this.g.now - this.inspectStart) / this.inspectDur;
    if (t >= 1) { this.inspectStart = -1; return -1; }
    return t;
  }

  get cur() { return this.slots[this.slot] || this.slots[this.knifeSlot]; }
  get id() { return this.cur.w; }
  get w() { return WEAPONS[this.id]; }
  get clip() { return this.ammo[this.cur.uid]; }
  get zoom() { return this.scope ? this.w.scope[this.scope - 1] : 1; }
  // magazine of the gun in hand: Holdout guns grow with an extended mag and the Assault class
  get mag() { return this.pooled && this.cur.item ? magFor(this.cur.item, this.g.holdout?.cls) : this.w.mag; }
  speedLimit() { return maxSpeed(this.w, this.scope > 0); }
  reserveOf(w, a) { return this.pooled ? (this.pool[w.ammo] || 0) + (a?.granted || 0) : a?.reserve ?? 0; }
  // what the HUD shows: magazine / reserve (backpack ammo in Holdout)
  hudClip() { const a = this.clip; return a ? { mag: a.mag, reserve: this.reserveOf(this.w, a) } : { mag: 0, reserve: 0 }; }

  // Server inventory update: { slot: { w, uid, …, item } | null }. New uids = freshly bought/looted guns (full or given mag).
  setInventory(items) {
    let fresh = 0;
    for (const [k, it] of Object.entries(items)) {
      const slot = +k, prev = this.slots[slot];
      this.slots[slot] = it || null;
      if (it && !(it.uid in this.ammo)) this.ammo[it.uid] = { mag: it.mag ?? (it.item ? magFor(it.item, this.g.holdout?.cls) : WEAPONS[it.w].mag), reserve: WEAPONS[it.w].reserve, granted: 0 };
      if (it && it.w !== 'hold_item' && prev?.uid !== it.uid && !fresh) fresh = slot;
    }
    const auto = !this.pooled || this.slot === fresh || this.slot === this.knifeSlot || !this.slots[this.slot];
    if (fresh && auto && this.g.player.alive) this.equip(fresh, true);
    else if (!this.slots[this.slot]) this.equip(this.order.find(s => this.slots[s] && this.slots[s].w !== 'hold_item') ?? this.knifeSlot, true);
    else if (this.slots[this.slot].uid !== this.equipped) this.equip(this.slot, true); // something else landed in the slot in hand
  }

  // The server granted n rounds from the backpack for a reload.
  onGrant(uid, n) {
    const a = this.ammo[uid];
    if (!a) return;
    a.granted += n;
    a.pending = false;
  }

  // afterDeath: respawning after dying gives every weapon a full magazine and reserve
  onSpawn(afterDeath) {
    this.cancelReload();
    this.reset();
    if (afterDeath) this.refill(); // the server also re-issues brand-new guns, equipped when they arrive
    else this.equip(this.order.find(s => this.slots[s] && s !== this.knifeSlot) ?? this.knifeSlot, true);
  }

  refill() {
    if (this.pooled) return;
    for (const s of [1, 2]) {
      const it = this.slots[s];
      if (it) this.ammo[it.uid] = { mag: WEAPONS[it.w].mag, reserve: WEAPONS[it.w].reserve, granted: 0 };
    }
  }

  equip(slot, force = false) {
    if (!this.slots[slot] || (slot === this.slot && !force)) return;
    if (slot !== this.slot) this.lastSlot = this.slot;
    this.slot = slot;
    this.cancelReload();
    this.inspectStart = -1;
    this.scope = this.rezoom = 0;
    this.sprayIdx = 0;
    this.bloom = 0;
    this.burstLeft = 0;
    this.spin = 0;
    const w = this.w, now = this.g.now;
    this.deployDur = w.deploy;
    this.deployEnd = now + w.deploy;
    this.nextFire = now + w.deploy;
    this.equipped = this.cur.uid;
    this.g.vm.set(w.id, this.cur.r, this.cur.item);
    this.g.sound.play('deploy', { vol: 0.45 });
    this.g.net.send({ t: 'snd', s: 'deploy', w: w.id });
  }

  cycle(dir) {
    const order = this.order.filter(s => this.slots[s]);
    const i = order.indexOf(this.slot);
    this.equip(order[(i + dir + order.length) % order.length]);
  }

  reload() {
    const w = this.w, a = this.clip, now = this.g.now;
    if (!a || w.cat === 'melee' || w.cat === 'item' || this.reloadEnd || a.mag >= this.mag || now < this.deployEnd) return;
    if (this.pooled) {
      if (a.granted <= 0 && !(this.pool[w.ammo] > 0)) { this.g.holdout?.noAmmo(w); return; }
      const need = this.mag - a.mag - a.granted;
      if (need > 0 && this.pool[w.ammo] > 0) { this.g.net.send({ t: 'reload', uid: this.cur.uid, need }); a.pending = true; }
    } else if (a.reserve <= 0) return;
    this.scope = this.rezoom = 0;
    this.inspectStart = -1;
    this.reloadStart = now;
    const rm = this.g.holdout?.reloadMult ?? 1; // Gunnery team upgrade: reloads faster
    if (w.shellReload) {
      this.reloadEnd = Infinity;
      this.shellNext = now + w.reloadStart + w.reload / rm;
    } else {
      this.reloadEnd = now + w.reload / rm;
      this.reloadSrcs = this.g.sound.reloadSeq(w, { vol: 1 });
    }
    this.g.net.send({ t: 'snd', s: 'reload', w: w.id });
  }

  cancelReload() {
    this.reloadEnd = 0;
    for (const s of this.reloadSrcs) { try { s.stop(); } catch { /* already done */ } }
    this.reloadSrcs = [];
  }

  reloadProgress() {
    if (!this.reloadEnd) return -1;
    if (this.w.shellReload) return 0.35;
    const rm = this.g.holdout?.reloadMult ?? 1;
    return Math.min(1, (this.g.now - this.reloadStart) / (this.w.reload / rm));
  }

  deployProgress() { return Math.min(1, 1 - (this.deployEnd - this.g.now) / this.deployDur); }

  // Spread radius in degrees for the next shot.
  inaccuracy() {
    const w = this.w, a = w.acc, pl = this.g.player;
    if (!a) return 0;
    const crouched = pl.crouch > 0.5;
    let base = crouched ? a.crouch : a.stand;
    if (w.scope && !this.scope) base = a.unscoped;
    if (!this.scope && this.cur.item?.att?.rail === 'laser') base *= 0.7; // laser sight
    const mf = Math.min(1, Math.max(0, (pl.speed - w.speed * 0.34) / (w.speed * 0.66)));
    return base + a.move * mf + (pl.grounded ? 0 : a.air) + this.bloom;
  }

  altPressed() {
    const w = this.w;
    if (!w.scope || this.g.now < this.deployEnd || this.reloadEnd || !this.g.player.alive) return;
    this.scope = (this.scope + 1) % (w.scope.length + 1);
    this.rezoom = 0;
    this.inspectStart = -1;
    this.g.sound.play('scope', { vol: 0.6 });
    this.g.net.send({ t: 'snd', s: 'scope', w: w.id });
  }

  update(dt, input) {
    const g = this.g, now = g.now, w = this.w, a = this.clip;
    const interval = 60 / w.rpm / (g.holdout?.rateMult ?? 1);

    // Recoil recovery once the gun stops firing: view punch eases back, spray index resets.
    // Semi-autos start recovering shortly after each shot, so tapping stays controllable.
    if (now - this.lastShot > (w.auto ? interval * 1.1 : Math.min(interval * 0.7, 0.12))) {
      const k = Math.exp(-dt * 10);
      this.punch[0] *= k;
      this.punch[1] *= k;
      this.sprayIdx = Math.max(0, this.sprayIdx - dt * w.idxRecover);
    }
    if (w.acc?.fireMax) this.bloom = Math.max(0, this.bloom - dt * (w.acc.fireMax / w.acc.recover));

    if (this.reloadEnd && !w.shellReload && now >= this.reloadEnd) {
      if (this.pooled && a.pending && now < this.reloadEnd + 1.5) { /* waiting for the backpack */ }
      else {
        const take = Math.min(this.mag - a.mag, this.pooled ? a.granted : a.reserve);
        a.mag += take;
        if (this.pooled) a.granted -= take; else a.reserve -= take;
        this.reloadEnd = 0;
        this.reloadSrcs = [];
      }
    }
    if (w.shellReload && this.reloadEnd && now >= this.shellNext) {
      const have = this.pooled ? a.granted : a.reserve;
      if (a.mag < this.mag && have > 0) {
        a.mag++;
        if (this.pooled) a.granted--; else a.reserve--;
        g.sound.play('shell', { vol: 0.9 });
        g.net.send({ t: 'snd', s: 'shell', w: w.id });
        this.shellNext = now + w.reload / (g.holdout?.reloadMult ?? 1);
      } else if (this.pooled && a.pending && a.mag < this.mag) this.shellNext = now + 0.1;
      const left = this.pooled ? a.granted + (a.pending ? 1 : 0) : a.reserve;
      if (a.mag >= this.mag || left <= 0) { this.reloadEnd = 0; g.sound.play('rl_pump', { vol: 0.9, delay: 0.05 }); }
    }
    if (this.rezoom && now >= this.rezoomAt && !this.reloadEnd) { this.scope = this.rezoom; this.rezoom = 0; }
    if (w.spin) this.spin = input.fire && g.canShoot() ? Math.min(w.spin, this.spin + dt) : Math.max(0, this.spin - dt * 2);

    if (!input.fire) this.triggerDown = false;
    if (!g.player.alive || !g.canShoot() || now < this.deployEnd) { this.burstLeft = 0; return; }

    if (w.cat === 'item') return; // held grenades / adrenaline shots / traps are used by the Holdout controller
    if (w.cat === 'melee') {
      if (w.id === 'katana') { if (input.fire && now >= this.nextFire) g.holdout?.kat.swing(); return; } // the Ronin's combo (katana.js); RMB is Fire Strike
      if (now >= this.nextFire && (input.fire || input.alt)) this.knife(!input.fire);
      return;
    }
    if (now - this.nextFire > dt + 0.01) this.nextFire = now;
    if (w.burst) { // three-round burst per click
      if (input.fire && !this.triggerDown && !this.burstLeft && now >= this.nextFire) {
        this.triggerDown = true;
        if (a.mag <= 0) { g.sound.play('dry', { vol: 0.7 }); this.reload(); return; }
        if (this.reloadEnd) return;
        this.burstLeft = w.burst;
      }
      while (this.burstLeft > 0 && now >= this.nextFire && a.mag > 0) {
        this.burstLeft--;
        this.nextFire += this.burstLeft ? interval : w.burstDelay;
        this.fire();
      }
      if (a.mag <= 0) this.burstLeft = 0;
      return;
    }
    if (!input.fire || now < this.nextFire) return;
    if (w.spin && this.spin < w.spin) return; // minigun spinning up
    if (a.mag <= 0) {
      if (!this.triggerDown) { g.sound.play('dry', { vol: 0.7 }); this.reload(); }
      this.triggerDown = true;
      return;
    }
    if (this.reloadEnd && !w.shellReload) return;
    if (!w.auto && this.triggerDown) return;
    if (this.reloadEnd) this.reloadEnd = 0; // firing interrupts a shotgun reload
    while (now >= this.nextFire && a.mag > 0 && (w.auto || !this.triggerDown)) {
      this.triggerDown = true; // latch before firing so a semi-auto can never fire twice per click
      this.nextFire += interval;
      this.fire();
    }
  }

  fire() {
    const g = this.g, w = this.w, pl = g.player, now = g.now, a = this.clip;
    a.mag--;
    this.inspectStart = -1;

    // Spray pattern: this bullet flies along the current punch, then the view kicks toward where the
    // next bullet will go (so even a single tap kicks, like CS). Continuous fire traces the pattern exactly.
    const i = Math.min(Math.floor(this.sprayIdx), w.recoil.length - 1);
    const cur = w.recoil[i], next = w.recoil[Math.min(i + 1, w.recoil.length - 1)];
    const jit = i >= 2 ? w.jitter : 0, comp = this.cur.item?.att?.muzzle === 'comp' ? 0.65 : 1; // compensator
    const kick = [(next[0] - cur[0] + (Math.random() - 0.5) * jit) * comp, (next[1] - cur[1] + (Math.random() - 0.5) * jit * 0.5) * comp];
    this.sprayIdx = i + 1;

    const inacc = this.inaccuracy();
    const baseYaw = pl.yaw - this.punch[0] * DEG, basePitch = pl.pitch + this.punch[1] * DEG;
    const eye = pl.eye;
    g.sound.play('shot_' + (w.snd || w.id), { vol: 0.85 });
    g.vm.fire(w.cat === 'pistol' ? (w.id === 'deagle' || w.id === 'hand_cannon' ? 0.8 : 0.45) : w.cat === 'sniper' || w.cat === 'shotgun' || w.cat === 'launcher' ? 1.3 : 1);
    this.lastShot = now;
    if (w.projectile) { // rockets, launcher grenades, shockwaves: the server simulates them and tells everyone
      g.net.send({ t: 'rocket', uid: this.cur.uid, o: eye.map(r3), d: dirFromAngles(baseYaw, basePitch).map(r3) });
      this.punch[1] += kick[1];
      return;
    }
    const target = g.shotTargets(), sky = w.cat === 'sniper' ? g.holdout?.skyTargets() : null, balloons = g.holdout?.balloonTargets(), maw = g.holdout?.mawTargets();
    const dirs = [], ends = [], hits = [], skyHits = [], bal = [], mawHits = [];
    const bhm = g.holdout?.bhm, bhmHits = []; // the Behemoth: its open reactor hearts take rounds, the rest of it is IMMUNE
    // Blacksmith gun mods: Multishot fires one more round (k = pellets) a little off the aim; Piercing rounds go on into
    // the next zombie behind (the server scales both down, see room.js onShot)
    const mods = this.cur.item?.mods ?? [], shots = w.pellets + (mods.includes('multi') ? 1 : 0), pierceMod = !w.pierce && mods.includes('pierce');
    let heard = false;
    for (let k = 0; k < shots; k++) {
      let yaw = baseYaw, pitch = basePitch;
      const r = Math.random() * inacc * DEG, th = Math.random() * 6.2832;
      yaw += Math.cos(th) * r;
      pitch += Math.sin(th) * r;
      if (w.pellets > 1 || k >= w.pellets) {
        const r2 = Math.sqrt(Math.random()) * (w.pelletSpread ?? 1.2) * DEG, th2 = Math.random() * 6.2832;
        yaw += Math.cos(th2) * r2;
        pitch += Math.sin(th2) * r2;
      }
      const d = dirFromAngles(yaw, pitch);
      const tr = traceBullet(eye, d, 400, g.boxes, target, w.wallPen);
      const at = t => eye.map((v, j) => v + d[j] * t);
      let endT = tr.endT;
      for (const s of sky || []) { // the Colossus' weak points (snipers only)
        const t = raySphere(eye, d, s.c, s.r);
        if (t >= 0 && t < endT && !skyHits.length) { skyHits.push([s.i, k]); endT = t; g.holdout.skyFlash(s.i, at(t)); }
      }
      for (const b of balloons || []) { const t = raySphere(eye, d, b.c, b.r); if (t >= 0 && t < endT) bal.push(b.id); }
      if (maw) { // the Maw's throat (or its body) while its head is up
        const tg = raySphere(eye, d, maw.g, maw.gr), tb = raySphere(eye, d, maw.b, maw.br);
        if (tg >= 0 && tg < endT) { mawHits.push([k, 'g']); endT = tg; g.world.burst(at(tg), [0, 1, 0], 0xff5a8a, 6, 3); }
        else if (tb >= 0 && tb < endT) { mawHits.push([k, 'b']); endT = tb; }
      }
      if (bhm) endT = bhm.trace(eye, d, endT, k, bhmHits);
      const end = at(endT);
      if (endT === tr.endT) {
        for (const im of tr.impacts) {
          g.world.impact(at(im.t), im.n, im.mat);
          const snd = im.mat === 'w' || im.mat === 'W' ? '_w' : im.mat === 'm' || im.mat === 'M' ? '_m' : '';
          if (!heard && !im.exit) { g.sound.play('impact' + snd, { pos: at(im.t), vol: 0.35, ref: 2 }); heard = true; }
        }
        if (tr.player) {
          hits.push({ part: tr.player.part, pen: r3(tr.player.pen), id: tr.player.id, k }); // k: pellet (its direction is d[k])
          g.world.blood(end, d, tr.player.part === 'head');
          if (pierceMod && Array.isArray(target)) { // the nearest zombie behind this one, short of a wall
            const wallEnd = traceBullet(eye, d, 400, g.boxes, null, w.wallPen).endT;
            let next = null;
            for (const tg of target) {
              const r = tg.id !== tr.player.id && rayPlayer(eye, d, wallEnd, tg);
              if (r && r.t > tr.endT && (!next || r.t < next.t)) next = r;
            }
            if (next) { hits.push({ part: next.part, pen: r3(tr.player.pen), id: next.id, k }); g.world.blood(at(next.t), d, next.part === 'head'); }
          }
        }
      }
      if (w.pierce && Array.isArray(target) && target.length) { // Skybreaker: every zombie along the line, up to where a wall stops it
        const wallEnd = traceBullet(eye, d, 400, g.boxes, null, w.wallPen).endT;
        const already = new Set(tr.player ? [tr.player.id] : []);
        const found = [];
        for (const tg of target) {
          if (already.has(tg.id)) continue;
          const r = rayPlayer(eye, d, wallEnd, tg);
          if (r) found.push(r);
        }
        found.sort((a, b) => a.t - b.t);
        for (const r of found.slice(0, Math.max(0, w.pierce - hits.length))) {
          hits.push({ part: r.part, pen: 1, id: r.id, k });
          g.world.blood(at(r.t), d, r.part === 'head');
        }
      }
      dirs.push(d.map(r3));
      ends.push(end.map(r3));
    }
    if (w.acc) this.bloom = Math.min(w.acc.fireMax, this.bloom + w.acc.fire * comp);
    this.punch[0] += kick[0];
    this.punch[1] += kick[1];

    const muzzle = g.muzzleWorld();
    g.holdout?.nightFx.flash(muzzle);
    const el = this.cur.item?.el, tint = el ? ELEMENTS[el].hex : 0xfff0b8;
    ends.forEach((e, k) => { if (k < 3) g.world.tracer(muzzle, e, tint); });
    const msg = { t: 'shot', w: w.id, uid: this.cur.uid, o: eye.map(r3), d: dirs, e: ends, h: hits };
    if (skyHits.length) msg.sky = skyHits;
    if (bal.length) msg.bal = bal;
    if (mawHits.length) msg.maw = mawHits;
    if (bhmHits.length) msg.bhm = bhmHits;
    g.net.send(msg);

    if (w.bolt) { // bolt-action: drop out of scope, re-zoom when the bolt is cycled
      this.rezoom = this.scope;
      this.scope = 0;
      this.rezoomAt = now + (60 / w.rpm) * 0.85;
      g.sound.boltCycle({ vol: 0.85 });
    }
    if (a.mag === 0 && this.reserveOf(w, a) > 0) setTimeout(() => { if (this.clip === a && a.mag === 0) this.reload(); }, 250);
  }

  knife(alt) {
    const g = this.g, pl = g.player, w = this.w;
    this.nextFire = g.now + (w.arc ? 60 / w.rpm * (alt ? 1.5 : 1) : alt ? 1.0 : 0.4);
    this.inspectStart = -1;
    g.vm.knife(alt);
    const eye = pl.eye, target = g.shotTargets();
    if (w.arc) { // Slasher Blade: everything in the arc in front of you
      const f = [-Math.sin(pl.yaw), -Math.cos(pl.yaw)], cos = Math.cos(((w.arc / 2) * Math.PI) / 180), hits = [];
      for (const t of target) {
        const dx = t.x - eye[0], dz = t.z - eye[2], d = Math.hypot(dx, dz);
        if (d > w.reach + 0.6 * (t.s || 1) || t.y > eye[1] + 0.5 || t.y + 1.8 * (t.s || 1) < eye[1] - 1.8) continue;
        if (d > 0.4 && (dx * f[0] + dz * f[1]) / d < cos) continue;
        hits.push({ part: 'chest', pen: 1, id: t.id });
        g.world.blood([t.x, t.y + 1.1 * (t.s || 1), t.z], [dx / Math.max(d, 0.01), 0, dz / Math.max(d, 0.01)], false);
      }
      g.sound.play(hits.length ? 'knife_hit' : 'knife_swing', { vol: 0.9, rate: 0.8 });
      g.net.send({ t: 'shot', w: w.id, uid: this.cur.uid, alt, o: eye.map(r3), d: [], e: [], h: hits.slice(0, w.pellets) });
      return;
    }
    let hit = null;
    for (const [dy, dp] of [[0, 0], [0.09, 0], [-0.09, 0], [0, 0.09], [0, -0.12]]) {
      const d = dirFromAngles(pl.yaw + dy, pl.pitch + dp);
      const tr = traceBullet(eye, d, w.reach, g.boxes, target, 0);
      if (tr.player) { hit = { part: tr.player.part, pen: 1, id: tr.player.id }; g.world.blood(eye.map((v, j) => v + d[j] * tr.endT), d, false); break; }
    }
    // Holdout: the knife is also your harvesting tool (trees, rocks, wrecked cars, crates)
    const chopped = !hit && g.holdout?.harvestSwing(eye, dirFromAngles(pl.yaw, pl.pitch), w.reach + 0.6);
    if (!chopped) g.sound.play(hit ? 'knife_hit' : 'knife_swing', { vol: 0.8 });
    g.net.send({ t: 'shot', w: 'knife', alt, o: eye.map(r3), d: [], e: [], h: hit ? [hit] : [] });
  }
}
