// Game client: ties together rendering, input, movement, weapons, audio, HUD and networking.
import * as THREE from 'three';
import { OUTPOST_STATIC } from '/shared/outpost.js';
import { WEAPONS } from '/shared/weapons.js';
import { rayWorld, dirFromAngles, eyeHeight } from '/shared/physics.js';
import { World } from './world.js';
import { Sound } from './audio.js';
import { Hud, smartKey, keyAction } from './hud.js';
import { Input } from './input.js';
import { Net, SOLO } from './net.js';
import { LocalPlayer } from './player.js';
import { Weapons } from './weapons.js';
import { ViewModel } from './models.js';
import { RemotePlayer } from './remote.js';
import { Holdout } from './holdout.js';

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const TICK = 1 / 128;      // movement tick rate (CS "128 tick")
const VIEW_KICK = 0.45;    // share of recoil the camera shows; bullets land at the full amount
const r3 = v => Math.round(v * 1000) / 1000;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const INTRO_Q = new THREE.Quaternion(), INTRO_Q2 = new THREE.Quaternion(), INTRO_E = new THREE.Euler(), INTRO_V = new THREE.Vector3();
const HOTBAR_KEYS = { primary: 0, secondary: 1, knife: 2, slot4: 3, slot5: 4, slot6: 5 }; // Minecraft-style: swap a hovered inventory item into this hotbar slot

export class Game {
  constructor(canvas) {
    this.now = performance.now() / 1000;
    this.hud = new Hud(s => this.applySettings(s), cb => { this.input.capture = cb; });
    const gs = this.hud.settings;
    this.world = new World(canvas, { antialias: gs.antialias, renderScale: gs.renderScale, shadows: gs.shadows });
    this.hud.setGpu(this.world.gpu);
    this.sound = new Sound();
    this.input = new Input(canvas);
    this.player = new LocalPlayer();
    this.vm = new ViewModel(this.world.vmScene);
    this.net = new Net(m => this.onMsg(m), () => this.exitToMenu('Disconnected from the server'), buf => this.holdout?.onBin(buf));
    this.weapons = new Weapons(this);
    this.boxes = OUTPOST_STATIC;
    this.moveBoxes = OUTPOST_STATIC;
    this.prevPos = [0, 0, 0];
    this.prevCrouch = 0;
    this.remotes = new Map(); // teammates by id (up to three others in Holdout)
    this.holdout = null;      // Zombie Holdout controller once connected
    this.me = { id: null, money: 0, armor: 0, helmet: false, hp: 100 };
    this.roster = [];
    this.inGame = false;
    this.ui = null; // null | 'buy' | 'pause' | 'chat'
    Object.assign(this, { acc: 0, sendAcc: 0, hudAcc: 0, stepIdx: 0, jumpAt: -1, frames: 0, fpsT: 0, fps: 0,
      hintMsg: '', hintUntil: 0, deathMsg: '', showVM: false, menuT: 0, buyTick: 0 });
    this.input.onLockChange = locked => this.onLockChange(locked);
    this.applySettings(this.hud.settings);
    addEventListener('beforeunload', e => { if (this.inGame) { e.preventDefault(); e.returnValue = ''; } });
  }

  applySettings(s) {
    this.sound.setVolume(s.volume);
    this.world.setFov(s.fov, this.world.zoom);
    this.world.setQuality({ renderScale: s.renderScale, shadows: s.shadows });
    this.codeMap = {}; // key/button code -> action
    this.buildMap = {}; // wins while building in Holdout: only Rotate, which may share a key (R with Reload)
    for (const [act, codes] of Object.entries(s.binds)) for (const c of codes) if (c) (act === 'bRotate' ? this.buildMap : this.codeMap)[c] = act;
    if (this.input) this.input.captured = new Set([...Object.keys(this.codeMap), ...Object.keys(this.buildMap)]);
    if (this.inGame) { if (s.fullscreen) this.enterFullscreen(); else this.exitFullscreen(); }
  }

  held(act) { return this.hud.settings.binds[act]?.some(c => c && this.input.keys.has(c)) ?? false; }

  // ---------- session ----------
  async start(mode, extra = {}) {
    this.sound.init();
    const name = $('nameInput').value.trim() || 'Player' + ((Math.random() * 900 + 100) | 0);
    this.hud.settings.name = name;
    this.hud.save();
    $('menuMsg').textContent = 'Connecting…';
    this.enterFullscreen(); // must start inside the click gesture
    this.input.lock();
    try { await this.net.connect(); } catch (e) {
      $('menuMsg').textContent = e.message;
      this.input.unlock();
      return;
    }
    this.net.send({ t: 'hello', name, mode, ...extra });
  }

  enterGame(m) {
    Object.assign(this.me, { id: m.id });
    this.code = m.code;
    this.boxes = OUTPOST_STATIC;
    this.moveBoxes = this.boxes;
    this.world.setMap('outpost', this.boxes);
    this.holdout?.dispose();
    this.weapons.configure(true); // Holdout: 5 gun slots + backpack ammo
    this.holdout = new Holdout(this, m);
    this.inGame = true;
    this.input.active = true;
    this.ui = null;
    $('menu').hidden = true;
    $('hud').hidden = false;
    $('menuMsg').textContent = '';
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname); // on a tunnel/public URL, share that URL
    $('roomInfo').innerHTML = SOLO ? 'Zombie Holdout · endless waves · solo in your browser' // no code to share: the room lives in this tab
      : `Zombie Holdout · endless waves · up to ${m.maxPlayers} players<br>Room code <b>${this.code}</b><br>Invite link: <b>${local ? `http://&lt;your-ip&gt;:${location.port || 80}` : location.origin}/#${this.code}</b>`;
    if (!document.pointerLockElement) this.input.lock();
    if (!SOLO) this.hud.chat(null, `Joined room ${this.code} — friends join with this code`);
    // scenic entry: orbit high above the map, then swoop into your eyes (first join only)
    this.intro = { start: this.now, dur: 4.2, a0: null };
    $('hud').classList.add('intro');
  }

  // Intro camera: returns true while the flyover is playing.
  introCamera() {
    const it = this.intro;
    if (!it) return false;
    const k = (this.now - it.start) / it.dur;
    if (k >= 1) { this.intro = null; $('hud').classList.remove('intro'); return false; }
    const pl = this.player;
    if (it.a0 === null) it.a0 = pl.alive ? Math.atan2(pl.pos[2], pl.pos[0]) - 2.2 : 0;
    const cam = this.world.camera, e = k * k * (3 - 2 * k);
    const ang = it.a0 + 2.2 * e, radius = 34 - 8 * e, height = 26 - 10 * e;
    cam.position.set(Math.cos(ang) * radius, height, Math.sin(ang) * radius * 0.8);
    cam.lookAt(0, 1, 0);
    const s = Math.min(1, Math.max(0, (k - 0.72) / 0.28)), sw = s * s * (3 - 2 * s);
    if (pl.alive && sw > 0) { // blend into the first-person view
      INTRO_Q.copy(cam.quaternion);
      INTRO_E.set(pl.pitch, pl.yaw, 0, 'YXZ');
      cam.quaternion.slerpQuaternions(INTRO_Q, INTRO_Q2.setFromEuler(INTRO_E), sw);
      const eye = pl.eye;
      cam.position.lerp(INTRO_V.set(eye[0], eye[1], eye[2]), sw);
    }
    return true;
  }

  leave() {
    this.net.close();
    this.exitToMenu('');
  }

  exitToMenu(msg) {
    this.inGame = false;
    this.input.active = false;
    this.ui = null;
    this.intro = null;
    $('hud').classList.remove('intro');
    this.setVCursor(null);
    this.input.unlock();
    this.exitFullscreen();
    for (const id of ['hud', 'pause', 'buyMenu', 'scoreboard', 'deathCam']) $(id).hidden = true;
    $('chatInput').hidden = true;
    this.hud.scope(false);
    $('menu').hidden = false;
    $('menu').append($('settings'));
    $('menuMsg').textContent = msg;
    for (const r of this.remotes.values()) r.dispose(this.world.scene);
    this.remotes.clear();
    this.holdout?.dispose();
    this.holdout = null;
    this.weapons.configure(false);
    this.player.alive = false;
    this.world.clearDecals();
  }

  // Browsers release the mouse on Esc. In fullscreen with Keyboard Lock (Chrome/Edge) Esc reaches the
  // game instead, so it can close menus like CS; holding Esc still leaves fullscreen.
  enterFullscreen() {
    const el = document.documentElement;
    if (!this.hud.settings.fullscreen || document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => navigator.keyboard?.lock?.().catch(() => {}))
      .catch(() => { /* needs a click; retried on the next one */ });
  }

  exitFullscreen() {
    navigator.keyboard?.unlock?.();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  onLockChange(locked) {
    if (!this.inGame) return;
    if (locked) { if (this.ui === 'pause') this.setPause(false); return; }
    if (this.ui === 'buy') this.closeBuy(false); // Esc without Keyboard Lock (e.g. Firefox): fall back to the pause menu
    if (this.ui === 'bag') this.holdout?.closeBag();
    if (this.ui === 'map') this.holdout?.minimap.toggle(false);
    if (!this.ui) this.setPause(true);
  }

  setPause(on) {
    this.ui = on ? 'pause' : null;
    $('pause').hidden = !on;
    if (on) $('pause').append($('settings'));
  }

  openPause() {
    this.setPause(true);
    this.input.unlock(); // the settings need a real cursor
  }

  // The pause menu closes itself once the mouse is locked again (see onLockChange).
  resume() {
    this.enterFullscreen();
    this.input.lock();
  }

  openChat() {
    this.ui = 'chat';
    const c = $('chatInput');
    c.hidden = false;
    c.value = '';
    c.focus();
  }

  closeChat() {
    const c = $('chatInput');
    c.blur();
    c.hidden = true;
    this.ui = null;
    if (!this.input.locked) this.setPause(true);
  }

  // ---------- helpers used by Weapons ----------
  // What your bullets can hit: the horde (teammates are never hit).
  shotTargets() { return this.holdout.targets(); }
  canShoot() { return !this.ui && !this.holdout?.blocksShooting(); }
  muzzleWorld() {
    const cam = this.world.camera;
    const v = new THREE.Vector3(0.1, -0.09, -0.55).applyQuaternion(cam.quaternion).add(cam.position);
    return [v.x, v.y, v.z];
  }

  occluded(pos) {
    const e = this.player.eye, d = [pos[0] - e[0], pos[1] - e[1], pos[2] - e[2]], len = Math.hypot(...d);
    if (len < 0.5) return false;
    const hit = rayWorld(e, d.map(v => v / len), len, this.boxes);
    return !!hit && hit.t < len - 0.3;
  }

  getRemote(id) {
    let r = this.remotes.get(id);
    if (!r) {
      r = new RemotePlayer(this.world.scene, id, this.boxes, 0x2f8fd8);
      this.remotes.set(id, r);
    }
    return r;
  }

  canBuyNow() { return this.holdout.canBuy(); }

  // The buy menu keeps the mouse locked and draws its own cursor, so opening/closing it (B or Esc)
  // never flashes the system cursor or needs a click to get back into the game.
  toggleBuy(open = this.ui !== 'buy') {
    if (!open) return this.closeBuy();
    if (!this.player.alive || this.ui) return;
    if (!this.holdout.canBuy()) { this.hintMsg = 'The shop is at the Core'; this.hintUntil = this.now + 2; return; }
    this.ui = 'buy';
    $('buyMenu').hidden = false;
    $('buyKey').textContent = this.holdout.key('buy');
    this.renderBuy();
    if (this.input.locked) this.setVCursor(innerWidth / 2, innerHeight / 2);
  }

  closeBuy(relock = true) {
    if (this.ui !== 'buy') return;
    this.ui = null;
    $('buyMenu').hidden = true;
    this.setVCursor(null);
    if (relock && !this.input.locked) { this.setPause(true); this.resume(); }
  }

  setVCursor(x, y) {
    this.hoverEl?.classList.remove('hover');
    this.hoverEl = null;
    if (x === null) { $('vcursor').hidden = true; this.vcur = null; return; }
    this.vcur = [Math.max(0, Math.min(innerWidth - 2, x)), Math.max(0, Math.min(innerHeight - 2, y))];
    $('vcursor').hidden = false;
    $('vcursor').style.transform = `translate(${this.vcur[0]}px, ${this.vcur[1]}px)`;
    const b = document.elementFromPoint(...this.vcur)?.closest('#buyMenu button, #bagMenu button, #smithMenu button, #bankMenu button, #bankMenu .slot');
    if (b && !b.disabled) { b.classList.add('hover'); this.hoverEl = b; }
  }

  vClick() {
    const b = this.vcur && document.elementFromPoint(...this.vcur)?.closest('#buyMenu button, #bagMenu button, #smithMenu button, #bankMenu button, #bankMenu .slot');
    if (!b || b.disabled) return;
    // a real .click() drops modifier keys, so the Banker's shift-click-to-sell still needs a shiftKey MouseEvent
    const shiftKey = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey }));
  }

  // Mouse wheel while a menu owns the (possibly locked) cursor: scroll whatever panel is under it.
  vScroll(code) {
    if (!this.vcur) return;
    let el = document.elementFromPoint(...this.vcur);
    while (el && el.scrollHeight <= el.clientHeight + 1 && el.parentElement) el = el.parentElement;
    el?.scrollBy(0, code === 'WheelDown' ? 90 : -90);
  }

  renderBuy() { this.holdout.renderBuy(); }

  // ---------- network messages ----------
  onMsg(m) {
    switch (m.t) {
      case 'welcome': return this.enterGame(m);
      case 'err':
        $('menuMsg').textContent = m.text;
        this.net.close();
        this.input.unlock();
        return;
      case 'roster': return this.onRoster(m.players);
      case 'spawn': return this.onSpawn(m);
      case 'inv': return this.onInv(m);
      case 'st': if (m.id !== this.me.id) this.getRemote(m.id).push(m, performance.now() / 1000); return;
      case 'shot': return this.onRemoteShot(m);
      case 'snd': return this.onRemoteSound(m);
      case 'dmg': return this.onDamage(m);
      case 'msg': return this.hud.chat(null, m.text);
      case 'chat': return this.hud.chat(m.name, m.text);
      case 'deny':
        this.hintMsg = m.text;
        this.hintUntil = this.now + 2;
        this.sound.play('dry', { vol: 0.6 });
        return;
      default: this.holdout?.onMsg(m);
    }
  }

  name(id) { return this.roster.find(p => p.id === id)?.name ?? '?'; }

  onRoster(players) {
    this.roster = players;
    for (const [id, r] of this.remotes) if (!players.some(p => p.id === id)) { r.dispose(this.world.scene); this.remotes.delete(id); }
    for (const p of players) if (p.id !== this.me.id) this.getRemote(p.id);
    this.holdout.onRoster(players);
  }

  onSpawn(m) {
    if (m.id === this.me.id) {
      this.player.spawn(m.pos, m.yaw);
      this.prevPos = [...m.pos];
      this.prevCrouch = 0;
      this.weapons.onSpawn(false); // Holdout keeps your ammo through a death
      this.world.clearDecals();
      this.deathMsg = '';
      $('deathCam').hidden = true;
      this.holdout?.onSelfSpawn();
    } else this.getRemote(m.id).spawn(m.pos, m.yaw, this.now);
  }

  onInv(m) {
    Object.assign(this.me, { money: m.money, armor: m.armor, helmet: m.helmet, hp: m.hp });
    this.player.alive = m.alive;
    this.holdout.onInv(m);
    this.weapons.setInventory(this.holdout.hotbarSlots());
    if (this.ui === 'buy') this.renderBuy();
  }

  onRemoteShot(m) {
    const w = WEAPONS[m.w];
    if (!w || !Array.isArray(m.o)) return;
    const r = this.remotes.get(m.id);
    const muffle = this.occluded(m.o) ? 1100 : 0;
    if (m.w === 'katana') return this.holdout?.kat.remoteSwing(m, r); // the Ronin's slash: its trail, sound and swing
    if (w.cat === 'melee') { this.sound.play('knife_swing', { pos: m.o, vol: 0.9, ref: 2, muffle }); return; }
    this.sound.play('shot_' + (w.snd || w.id), {
      pos: m.o, vol: w.silenced ? 0.8 : 1.3, ref: w.silenced ? 2.5 : 6, roll: w.silenced ? 1.6 : 0.7, muffle,
    });
    const muzzle = r?.alive ? r.model.muzzle() : m.o;
    if (!w.silenced) { this.world.flash(muzzle); this.holdout.nightFx.flash(muzzle); }
    (m.e || []).forEach((e, i) => {
      const d = m.d?.[i];
      if (!d) return;
      if (i < 3) this.world.tracer(muzzle, e, 0xffd9a0);
      const len = Math.hypot(e[0] - m.o[0], e[1] - m.o[1], e[2] - m.o[2]);
      const hit = rayWorld(m.o, d, len + 0.05, this.boxes);
      if (hit && Math.abs(hit.t - len) < 0.1) this.world.impact(e, hit.n, hit.box.mat);
    });
  }

  onRemoteSound(m) {
    const r = this.remotes.get(m.id), w = WEAPONS[m.w];
    if (!r || !w) return;
    const pos = [r.pos[0], r.pos[1] + 1.2, r.pos[2]];
    const o = { pos, ref: 2, roll: 1.4, muffle: this.occluded(pos) ? 1000 : 0 };
    if (m.s === 'reload') this.sound.reloadSeq(w, { ...o, vol: 0.9 });
    else if (m.s === 'shell' || m.s === 'scope') this.sound.play(m.s, { ...o, vol: 0.8 });
    else if (m.s === 'deploy') this.sound.play('deploy', { ...o, vol: 0.5 });
  }

  onDamage(m) {
    if (m.vic === this.me.id) {
      this.me.hp = m.hp;
      this.me.armor = m.armor;
      this.sound.play('hurt', { vol: 0.7 });
      if (m.part === 'head' && m.w !== 'knife') this.sound.play(m.helm ? 'dink' : 'headshot', { vol: 0.6 });
      const dx = m.from[0] - this.player.pos[0], dz = m.from[2] - this.player.pos[2];
      this.hud.hitDir(-wrap(Math.atan2(-dx, -dz) - this.player.yaw) / DEG);
      this.player.tag = 0.4;
      this.weapons.punch[1] += m.armor > 0 && m.part !== 'head' ? 0.6 : 2.2; // aim punch; armor softens it
    } else if (m.att === this.me.id) {
      if (m.immune && this.now > (this.immuneHint || 0)) { this.immuneHint = this.now + 3; this.hintMsg = m.immune === 'ward' ? 'IMMUNE — the Gravekeeper\'s ward holds while any grave is open: seal them with CONES' : 'IMMUNE — Brood riders can\'t be hurt while they ride the Titan'; this.hintUntil = this.now + 2; }
      // your hits: special sound for headshot kills, a "dink" off a helmet, a ding for other headshots
      if (m.part === 'head' && m.w !== 'knife') {
        this.sound.play(m.hp <= 0 ? 'headshot_kill' : m.helm ? 'dink' : 'headshot', { vol: 1 });
      } else this.sound.play('hit_body', { vol: 0.5 });
    }
  }

  // ---------- per-frame ----------
  onAction(act, code) {
    if (code === 'Escape') { // arrives while the mouse is locked only under fullscreen Keyboard Lock
      if (this.ui === 'buy') this.closeBuy();
      else if (this.ui === 'bag') this.holdout?.closeBag();
      else if (this.ui === 'smith') this.holdout?.closeSmith();
      else if (this.ui === 'bank') this.holdout?.closeBank();
      else if (this.ui === 'map') this.holdout?.minimap.toggle(false);
      else if (this.ui === 'pause') this.resume();
      else if (this.holdout?.edit.active) this.holdout.edit.stop();
      else if (!this.ui) this.openPause();
      return;
    }
    if (this.ui === 'buy') {
      if (act === 'buy') this.closeBuy();
      else if (code === 'Mouse0') this.vClick();
      else if (code === 'WheelUp' || code === 'WheelDown') this.vScroll(code);
      return;
    }
    if (this.ui === 'smith') {
      if (act === 'backpack' || act === 'interact' || act === 'turretUp') this.holdout.closeSmith();
      else if (code === 'Mouse0') this.vClick();
      else if (code === 'WheelUp' || code === 'WheelDown') this.vScroll(code);
      return;
    }
    if (this.ui === 'bank') {
      if (act === 'backpack' || act === 'interact') this.holdout.closeBank();
      else if (act === 'flashlight') this.holdout.invUI.toggleLock(this.vcur);
      else if (code === 'Mouse0') this.vClick();
      else if (code === 'WheelUp' || code === 'WheelDown') this.vScroll(code);
      return;
    }
    if (this.ui === 'map') {
      const mm = this.holdout.minimap;
      if (act === 'map' || act === 'interact' || smartKey(this.hud.settings.binds, code)) mm.toggle(false);
      else if (code === 'Mouse0' && this.vcur) mm.press(...this.vcur);
      else if ((code === 'WheelUp' || code === 'WheelDown') && this.vcur) mm.zoom(code === 'WheelDown' ? 1 : -1, ...this.vcur);
      return;
    }
    if (this.ui === 'bag') {
      if (act === 'backpack' || (act === 'interact' && (this.holdout.bagAtChest || smartKey(this.hud.settings.binds, code)))) this.holdout.closeBag();
      else if (act === 'flashlight') this.holdout.invUI.toggleLock(this.vcur);
      else if (code === 'Mouse0' && this.vcur) this.holdout.invUI.down(...this.vcur, this.input.down('ShiftLeft') || this.input.down('ShiftRight'));
      else if (code === 'WheelUp' || code === 'WheelDown') this.vScroll(code);
      else if (HOTBAR_KEYS[act] !== undefined) this.holdout.invUI.hotkeySwap(HOTBAR_KEYS[act], this.vcur);
      return;
    }
    if (this.ui) return;
    if (act === 'chat') return this.openChat();
    if (act === 'buy') return this.toggleBuy(true);
    if (this.holdout?.onAction(act, code)) return;
    if (!this.player.alive) return;
    const W = this.weapons;
    switch (act) {
      case 'primary': return W.equip(1);
      case 'secondary': return W.equip(2);
      case 'knife': return W.equip(3);
      case 'lastWeapon': return W.equip(W.lastSlot);
      case 'prevWeapon': return W.cycle(-1);
      case 'nextWeapon': return W.cycle(1);
      case 'reload': return W.reload();
      case 'inspect': return W.inspect();
      case 'alt': return W.altPressed();
      case 'jump': this.jumpAt = this.now; return;
    }
  }

  frame(dt) {
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
    if (this.inGame) this.update(dt); else this.menuCam(dt);
    this.world.update(dt);
    this.world.render(this.inGame && this.showVM);
  }

  menuCam(dt) {
    this.menuT += dt * 0.05;
    const cam = this.world.camera;
    cam.position.set(Math.cos(this.menuT) * 34, 17, Math.sin(this.menuT) * 26);
    cam.lookAt(0, 0, 0);
  }

  update(dt) {
    const pl = this.player, inp = this.input, now = this.now;
    const ronin = this.holdout?.cls === 'ronin'; // the dash may share hotbar slot 4-6's key (hud.js keyAction)
    for (const code of inp.takePressed()) this.onAction((this.holdout?.build.active && this.buildMap[code]) || keyAction(this.codeMap, this.hud.settings.binds, code, ronin), code);

    const [mx, my] = inp.takeMouse();
    const free = !this.ui && inp.locked && !this.intro; // inactive during the intro flyover
    if (free) {
      const zoom = this.weapons.zoom;
      const k = this.hud.settings.sens * 0.022 * DEG * (zoom > 1 ? this.hud.settings.zoomSens / zoom : 1);
      pl.yaw = wrap(pl.yaw - mx * k);
      pl.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, pl.pitch - my * k));
      this.vm.addSway(mx, my);
    } else if ((this.ui === 'buy' || this.ui === 'bag' || this.ui === 'smith' || this.ui === 'bank' || this.ui === 'map') && this.vcur && (mx || my)) {
      this.setVCursor(this.vcur[0] + mx, this.vcur[1] + my);
    }

    // movement at a fixed 128 Hz (you can keep moving with the buy menu open, like CS)
    const key = act => (free && this.held(act) ? 1 : 0);
    const moveFree = inp.locked && !this.intro && (!this.ui || this.ui === 'buy' || this.ui === 'bag' || this.ui === 'smith' || this.ui === 'bank' || this.ui === 'map');
    const mkey = act => (moveFree && this.held(act) ? 1 : 0);
    const bhop = this.hud.settings.bhop;
    this.moveBoxes = this.holdout.moveBoxes();
    const downed = !!this.holdout?.downed; // Holdout: knocked down players crawl
    const input = {
      f: mkey('forward'), b: mkey('back'), l: mkey('left'), r: mkey('right'),
      crouch: downed ? 1 : mkey('crouch'), jump: 0,
    };
    const holdJump = bhop && key('jump') && !downed; // bhop mode: holding jump re-jumps the instant you land
    const maxSp = downed ? 9 : this.weapons.speedLimit() * (this.holdout?.carrying ? 0.75 : 1) * (this.holdout?.speedMult ?? 1); // downed: a faster crawl
    const phys = this.holdout.phys;
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.prevPos[0] = pl.pos[0]; this.prevPos[1] = pl.pos[1]; this.prevPos[2] = pl.pos[2];
      this.prevCrouch = pl.crouch;
      input.jump = !downed && (now - this.jumpAt < 0.12 || holdJump) ? 1 : 0;
      const ev = pl.tick(TICK, input, maxSp, this.moveBoxes, false, bhop, phys);
      if (ev.jumped) { this.jumpAt = -1; this.sound.play('jump', { vol: 0.25 }); }
      if (ev.step) this.sound.play('step' + (this.stepIdx++ % 4), { vol: 0.28, rate: 0.9 + Math.random() * 0.2 });
      if (ev.landed > 3.5) this.sound.play('land', { vol: Math.min(0.45, ev.landed / 15) });
    }

    const building = !!this.holdout?.building;
    this.weapons.update(dt, { fire: !!key('fire') && !building, alt: !!key('alt') && !building });
    const step = p => this.sound.play('step' + ((Math.random() * 4) | 0), {
      pos: [p[0], p[1] + 0.1, p[2]], vol: 1.4, ref: 2.5, roll: 1.2, rate: 0.9 + Math.random() * 0.2,
      muffle: this.occluded([p[0], p[1] + 1, p[2]]) ? 900 : 0,
    });
    for (const r of this.remotes.values()) r.update(dt, now, step);
    this.holdout?.update(dt);

    // camera: eye angles + part of the recoil punch (CS-style view kick). The position is interpolated
    // between the last two 128 Hz physics states so movement looks smooth at any frame rate.
    const cam = this.world.camera, p = this.weapons.punch, a = this.acc / TICK, pp = this.prevPos;
    const eye = [pp[0] + (pl.pos[0] - pp[0]) * a, 0, pp[2] + (pl.pos[2] - pp[2]) * a];
    eye[1] = pp[1] + (pl.pos[1] - pp[1]) * a + eyeHeight(this.prevCrouch + (pl.crouch - this.prevCrouch) * a);
    if (this.introCamera()) { /* scenic flyover owns the camera */ }
    else if (pl.alive) {
      cam.position.set(...eye);
      cam.rotation.set(pl.pitch + p[1] * DEG * VIEW_KICK, pl.yaw - p[0] * DEG * VIEW_KICK, 0);
    } else if (!this.deathMsg) {
      this.menuCam(dt); // not spawned yet: keep circling the map
    } else if (this.holdout?.spectateCam(cam)) { /* Holdout: watching a teammate until the wave is cleared */
    } else {
      cam.position.set(pl.pos[0], pl.pos[1] + 0.35, pl.pos[2]);
      cam.rotation.set(pl.pitch * 0.3, pl.yaw, 0.35);
    }
    const zoom = pl.alive ? this.weapons.zoom : 1;
    if (zoom !== this.world.zoom || this.hud.settings.fov !== this.world.hfov) this.world.setFov(this.hud.settings.fov, zoom);
    this.sound.setListener(eye, dirFromAngles(pl.yaw, pl.pitch));

    this.vm.update(dt, {
      speed01: Math.min(1, pl.speed / 6.35), grounded: pl.grounded,
      reload: this.weapons.reloadProgress(), deploy: this.weapons.deployProgress(),
      inspect: this.weapons.inspectProgress(),
    });
    this.showVM = pl.alive && this.hud.settings.viewmodel && !this.weapons.scope && !this.intro && !building && !downed &&
      !this.holdout?.edit.active && !this.holdout?.carrying;

    this.sendAcc += dt;
    if (this.sendAcc >= 1 / 32 && pl.alive) {
      this.sendAcc = 0;
      this.net.send({
        t: 'st', p: pl.pos.map(r3), v: pl.vel.map(r3), y: r3(pl.yaw), pi: r3(pl.pitch), c: r3(pl.crouch), fl: this.holdout?.flashOn ? 1 : undefined,
        w: this.weapons.id, g: pl.grounded, ts: Math.round(this.now * 1000), // sender clock for smooth playback
      });
    }

    this.hudAcc += dt;
    if (this.hudAcc >= 0.05) { this.hudAcc = 0; this.refreshHud(); }
  }

  refreshHud() {
    const W = this.weapons, w = W.w, pl = this.player, hud = this.hud;
    hud.vitals(pl.alive ? this.me.hp : 0, this.me.armor, this.me.helmet, 'SHIELD');
    hud.money(this.me.money, '');
    hud.ammo(w, W.hudClip(), W.slots, W.slot, W.cur.r);
    const vf = (this.world.camera.fov * DEG) / 2;
    const gap = ((innerHeight / 2) * Math.tan(W.inaccuracy() * DEG)) / Math.tan(vf);
    hud.crosshair(pl.alive && !this.ui && (w.cat !== 'sniper' || !!this.holdout?.building) && !this.holdout?.downed, Math.min(60, gap * 0.6));
    hud.scope(pl.alive && W.scope > 0);
    hud.net(`${this.fps} FPS · ${Math.round(this.net.ping)} ms`);
    if (this.ui === 'buy' && ++this.buyTick % 10 === 0) this.renderBuy();
    this.holdout.refreshHud();
  }
}
