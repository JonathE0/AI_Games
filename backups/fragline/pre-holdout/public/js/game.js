// Game client: ties together rendering, input, movement, weapons, audio, HUD and networking.
import * as THREE from 'three';
import { MAP_BOXES, BUY_RADIUS } from '/shared/map.js';
import { modeOf } from '/shared/modes.js';
import { LAKE_BOXES } from '/shared/lake.js';
import { WEAPONS } from '/shared/weapons.js';
import { rayWorld, dirFromAngles, eyeHeight } from '/shared/physics.js';
import { World } from './world.js';
import { Sound } from './audio.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { LocalPlayer } from './player.js';
import { Weapons } from './weapons.js';
import { ViewModel } from './models.js';
import { RemotePlayer } from './remote.js';

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const TICK = 1 / 128;      // movement tick rate (CS "128 tick")
const VIEW_KICK = 0.45;    // share of recoil the camera shows; bullets land at the full amount
const r3 = v => Math.round(v * 1000) / 1000;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const INTRO_Q = new THREE.Quaternion(), INTRO_Q2 = new THREE.Quaternion(), INTRO_E = new THREE.Euler(), INTRO_V = new THREE.Vector3();

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
    this.net = new Net(m => this.onMsg(m), () => this.exitToMenu('Disconnected from the server'));
    this.weapons = new Weapons(this);
    this.mode = modeOf('classic');
    this.boxes = MAP_BOXES;
    this.moveBoxes = MAP_BOXES;
    this.oppBox = { min: [0, 0, 0], max: [0, 0, 0], mat: 'p' }; // opponent's body, for player-player collision
    this.withOpp = [...MAP_BOXES, this.oppBox];
    this.prevPos = [0, 0, 0];
    this.prevCrouch = 0;
    this.remote = null;
    this.me = { id: null, money: 0, armor: 0, helmet: false, hp: 100, side: 'T' };
    this.roster = [];
    this.state = { phase: 'menu', end: 0, round: 0, winTo: 7, buyGrace: 15000, liveStart: 0 };
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
    for (const [act, codes] of Object.entries(s.binds)) for (const c of codes) if (c) this.codeMap[c] = act;
    if (this.input) this.input.captured = new Set(Object.keys(this.codeMap));
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
    this.mode = modeOf(m.gameMode);
    this.boxes = this.mode.map === 'lake' ? LAKE_BOXES : MAP_BOXES;
    this.moveBoxes = this.boxes;
    this.withOpp = [...this.boxes, this.oppBox];
    this.world.setMap(this.mode.map, this.boxes);
    this.vsBot = m.bot;
    this.state.winTo = m.rules.winRounds;
    this.state.buyGrace = m.rules.buyGrace;
    this.inGame = true;
    this.input.active = true;
    this.ui = null;
    $('menu').hidden = true;
    $('hud').hidden = false;
    $('menuMsg').textContent = '';
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname); // on a tunnel/public URL, share that URL
    $('roomInfo').innerHTML = this.vsBot ? 'Practice match vs bot'
      : `${this.mode.name}<br>Room code <b>${this.code}</b><br>Invite link: <b>${local ? `http://&lt;your-ip&gt;:${location.port || 80}` : location.origin}/#${this.code}</b>`;
    if (!document.pointerLockElement) this.input.lock();
    this.hud.chat(null, this.vsBot ? 'Practice match vs bot — good luck' : `Joined room ${this.code}`);
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
    for (const id of ['hud', 'pause', 'buyMenu', 'scoreboard', 'roundEnd', 'deathCam']) $(id).hidden = true;
    $('chatInput').hidden = true;
    this.hud.scope(false);
    $('menu').hidden = false;
    $('menu').append($('settings'));
    $('menuMsg').textContent = msg;
    this.remote?.dispose(this.world.scene);
    this.remote = null;
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
  remoteTarget() { return this.remote?.target() ?? null; }
  canShoot() { return this.state.phase !== 'freeze' && this.state.phase !== 'starting' && !this.ui; }
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
    if (this.remote?.id !== id) {
      this.remote?.dispose(this.world.scene);
      this.remote = new RemotePlayer(this.world.scene, id, this.boxes);
    }
    return this.remote;
  }

  canBuyNow() {
    const s = this.state, pl = this.player;
    if (!pl.alive || !this.mode.buy) return false;
    if (s.phase === 'warmup' || s.phase === 'freeze') return true;
    const sp = this.spawnPos || pl.pos;
    return s.phase === 'live' && (this.now - s.liveStart) * 1000 < s.buyGrace &&
      Math.hypot(pl.pos[0] - sp[0], pl.pos[2] - sp[2]) < BUY_RADIUS;
  }

  // The buy menu keeps the mouse locked and draws its own cursor, so opening/closing it (B or Esc)
  // never flashes the system cursor or needs a click to get back into the game.
  toggleBuy(open = this.ui !== 'buy') {
    if (!open) return this.closeBuy();
    if (!this.player.alive || this.ui || !this.mode.buy) return;
    this.ui = 'buy';
    $('buyMenu').hidden = false;
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
    const b = document.elementFromPoint(...this.vcur)?.closest('#buyMenu button');
    if (b && !b.disabled) { b.classList.add('hover'); this.hoverEl = b; }
  }

  vClick() {
    const b = this.vcur && document.elementFromPoint(...this.vcur)?.closest('#buyMenu button');
    if (b && !b.disabled) b.click();
  }

  renderBuy() {
    const s = this.state, W = this.weapons;
    let timeText = '';
    if (s.phase === 'warmup') timeText = 'Warmup — everything is free';
    else if (s.phase === 'freeze') timeText = `Buy time ${Math.ceil(s.end - this.now + s.buyGrace / 1000)}s`;
    else if (s.phase === 'live') timeText = `Buy time ${Math.max(0, Math.ceil(s.buyGrace / 1000 - (this.now - s.liveStart)))}s · stay in spawn`;
    this.hud.renderBuy({
      money: this.me.money, armor: this.me.armor, helmet: this.me.helmet, canBuy: this.canBuyNow(),
      free: s.phase === 'warmup', timeText, owned: new Set([W.slots[1]?.w, W.slots[2]?.w].filter(Boolean)),
      onBuy: id => this.net.send({ t: 'buy', item: id }),
    });
    if (this.vcur) this.setVCursor(...this.vcur); // re-apply hover after the re-render
  }

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
      case 'phase': return this.onPhase(m);
      case 'spawn': return this.onSpawn(m);
      case 'inv': return this.onInv(m);
      case 'st': if (m.id !== this.me.id) this.getRemote(m.id).push(m, performance.now() / 1000); return;
      case 'shot': return this.onRemoteShot(m);
      case 'snd': return this.onRemoteSound(m);
      case 'dmg': return this.onDamage(m);
      case 'kill': return this.onKill(m);
      case 'roundEnd': return this.onRoundEnd(m);
      case 'matchEnd': return this.onMatchEnd(m);
      case 'msg': return this.hud.chat(null, m.text);
      case 'chat': return this.hud.chat(m.name, m.text);
      case 'deny':
        this.hintMsg = m.text;
        this.hintUntil = this.now + 2;
        this.sound.play('dry', { vol: 0.6 });
        return;
      case 'bought': return this.sound.play('buy', { vol: 0.6 });
    }
  }

  name(id) { return this.roster.find(p => p.id === id)?.name ?? '?'; }

  onRoster(players) {
    this.roster = players;
    const opp = players.find(p => p.id !== this.me.id);
    if (!opp && this.remote) { this.remote.dispose(this.world.scene); this.remote = null; }
    if (opp) this.getRemote(opp.id);
    const me = players.find(p => p.id === this.me.id);
    this.hud.score(me?.score ?? 0, opp?.score ?? 0, me?.name ?? 'YOU', opp ? opp.name : 'WAITING…');
  }

  onPhase(m) {
    const s = this.state, prev = s.phase;
    Object.assign(s, { phase: m.phase, end: this.now + m.endsIn / 1000, round: m.round, winTo: m.winTo });
    if (m.phase === 'live') {
      s.liveStart = this.now;
      if (prev === 'freeze') this.sound.play('round_start', { vol: 0.5 });
    } else if (m.phase === 'warmup') {
      this.hud.banner('WARMUP', this.vsBot ? '' : `Waiting for an opponent · room ${this.code}`, '', 4000);
    } else if (m.phase === 'starting') {
      this.hud.banner('MATCH STARTING', `First to ${m.winTo} rounds`, '', 3000);
    } else if (m.phase === 'freeze') {
      this.hud.roundEnd(null);
      const matchPoint = this.roster.some(p => p.score === s.winTo - 1);
      this.hud.banner(`ROUND ${m.round}`, (matchPoint ? 'MATCH POINT · ' : '') + (this.mode.buy ? 'Buy phase — press B' : 'SSG 08 ready · low gravity'), '', 3000);
    }
  }

  onSpawn(m) {
    if (m.id === this.me.id) {
      const afterDeath = !this.player.alive;
      this.player.spawn(m.pos, m.yaw);
      this.prevPos = [...m.pos];
      this.prevCrouch = 0;
      this.spawnPos = m.pos;
      this.weapons.onSpawn(afterDeath);
      this.world.clearDecals();
      this.deathMsg = '';
      $('deathCam').hidden = true;
    } else this.getRemote(m.id).spawn(m.pos, m.yaw, this.now);
  }

  onInv(m) {
    Object.assign(this.me, { money: m.money, armor: m.armor, helmet: m.helmet, hp: m.hp, side: m.side });
    this.player.alive = m.alive;
    this.weapons.setInventory(m.s1, m.s2);
    if (this.ui === 'buy') this.renderBuy();
  }

  onRemoteShot(m) {
    const w = WEAPONS[m.w];
    if (!w || !Array.isArray(m.o)) return;
    const r = this.remote;
    const muffle = this.occluded(m.o) ? 1100 : 0;
    if (w.cat === 'melee') { this.sound.play('knife_swing', { pos: m.o, vol: 0.9, ref: 2, muffle }); return; }
    this.sound.play('shot_' + w.id, {
      pos: m.o, vol: w.silenced ? 0.8 : 1.3, ref: w.silenced ? 2.5 : 6, roll: w.silenced ? 1.6 : 0.7, muffle,
    });
    const muzzle = r?.alive ? r.model.muzzle() : m.o;
    if (!w.silenced) this.world.flash(muzzle);
    const eye = this.player.eye;
    (m.e || []).forEach((e, i) => {
      const d = m.d?.[i];
      if (!d) return;
      if (i < 3) this.world.tracer(muzzle, e, 0xffd9a0);
      const len = Math.hypot(e[0] - m.o[0], e[1] - m.o[1], e[2] - m.o[2]);
      const hit = rayWorld(m.o, d, len + 0.05, this.boxes);
      if (hit && Math.abs(hit.t - len) < 0.1) this.world.impact(e, hit.n, hit.box.mat);
      if (i === 0 && this.player.alive) { // bullet cracking past your head
        const v = [eye[0] - m.o[0], eye[1] - m.o[1], eye[2] - m.o[2]];
        const t = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
        if (t > 0 && t < len) {
          const cl = Math.hypot(v[0] - d[0] * t, v[1] - d[1] * t, v[2] - d[2] * t);
          if (cl < 1.6 && cl > 0.3) this.sound.play('whiz', { pos: m.o.map((o, j) => o + d[j] * t), vol: 0.8, ref: 1 });
        }
      }
    });
  }

  onRemoteSound(m) {
    const r = this.remote, w = WEAPONS[m.w];
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
      // your hits: special sound for headshot kills, a "dink" off a helmet, a ding for other headshots
      if (m.part === 'head' && m.w !== 'knife') {
        this.sound.play(m.hp <= 0 ? 'headshot_kill' : m.helm ? 'dink' : 'headshot', { vol: 1 });
      } else this.sound.play('hit_body', { vol: 0.5 });
    }
  }

  onKill(m) {
    const mine = m.killer === this.me.id || m.victim === this.me.id;
    this.hud.kill(this.name(m.killer), this.name(m.victim), m.w, m.hs, m.wb, mine);
    if (m.victim === this.me.id) {
      this.player.alive = false;
      this.me.hp = 0;
      this.weapons.cancelReload();
      this.weapons.scope = 0;
      $('deathCam').hidden = false;
      this.sound.play('death', { vol: 0.7 });
      this.deathMsg = `Killed by ${this.name(m.killer)} — ${WEAPONS[m.w]?.name ?? m.w}${m.hs ? ' (headshot)' : ''}${m.wb ? ' through a wall' : ''}`;
      if (this.ui === 'buy') this.toggleBuy(false);
    } else if (this.remote?.id === m.victim) {
      this.remote.kill();
      if (m.killer === this.me.id && !m.hs) this.sound.play('kill', { vol: 0.6 }); // headshot kills have their own sound
    }
  }

  onRoundEnd(m) {
    const win = m.winner === this.me.id;
    const r = m.report || { given: { dmg: 0, hits: 0 }, taken: { dmg: 0, hits: 0 } };
    const hits = n => `${n} hit${n === 1 ? '' : 's'}`;
    this.hud.roundEnd({
      win, title: win ? 'ROUND WON' : 'ROUND LOST',
      reason: m.reason === 'time' ? (win ? 'Time ran out — you had more HP' : 'Time ran out') : (win ? 'Enemy eliminated' : 'You were eliminated'),
      given: `Damage given: ${r.given.dmg} in ${hits(r.given.hits)}`,
      taken: `Damage taken: ${r.taken.dmg} in ${hits(r.taken.hits)}` + (m.oppHp ? ` · enemy had ${m.oppHp} HP left` : ''),
    });
    this.sound.play(win ? 'win' : 'lose', { vol: 0.5 });
  }

  onMatchEnd(m) {
    const win = m.winner === this.me.id;
    const me = this.roster.find(p => p.id === this.me.id), opp = this.roster.find(p => p.id !== this.me.id);
    this.hud.roundEnd(null);
    this.hud.banner(win ? 'VICTORY' : 'DEFEAT', `${me?.score ?? 0} : ${opp?.score ?? 0} · new match starts shortly`, win ? 'win' : 'lose', 9000);
    this.sound.play(win ? 'win' : 'lose', { vol: 0.7 });
  }

  // ---------- per-frame ----------
  onAction(act, code) {
    if (code === 'Escape') { // arrives while the mouse is locked only under fullscreen Keyboard Lock
      if (this.ui === 'buy') this.closeBuy();
      else if (this.ui === 'pause') this.resume();
      else if (!this.ui) this.openPause();
      return;
    }
    if (this.ui === 'buy') {
      if (act === 'buy') this.closeBuy();
      else if (code === 'Mouse0') this.vClick();
      return;
    }
    if (this.ui) return;
    if (act === 'chat') return this.openChat();
    if (act === 'buy') return this.toggleBuy(true);
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
    const pl = this.player, inp = this.input, st = this.state, now = this.now;
    for (const code of inp.takePressed()) this.onAction(this.codeMap[code], code);

    const [mx, my] = inp.takeMouse();
    const free = !this.ui && inp.locked && !this.intro; // inactive during the intro flyover
    if (free) {
      const zoom = this.weapons.zoom;
      const k = this.hud.settings.sens * 0.022 * DEG * (zoom > 1 ? this.hud.settings.zoomSens / zoom : 1);
      pl.yaw = wrap(pl.yaw - mx * k);
      pl.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, pl.pitch - my * k));
      this.vm.addSway(mx, my);
    } else if (this.ui === 'buy' && this.vcur && (mx || my)) {
      this.setVCursor(this.vcur[0] + mx, this.vcur[1] + my);
    }

    // movement at a fixed 128 Hz (you can keep moving with the buy menu open, like CS)
    const key = act => (free && this.held(act) ? 1 : 0);
    const moveFree = inp.locked && !this.intro && (!this.ui || this.ui === 'buy');
    const mkey = act => (moveFree && this.held(act) ? 1 : 0);
    const frozen = st.phase === 'freeze' || st.phase === 'starting';
    const bhop = this.hud.settings.bhop;
    const rt = this.remote?.target();
    if (rt) {
      const o = this.oppBox;
      o.min[0] = rt.x - 0.3; o.min[1] = rt.y; o.min[2] = rt.z - 0.3;
      o.max[0] = rt.x + 0.3; o.max[1] = rt.y + 1.7; o.max[2] = rt.z + 0.3;
    }
    this.moveBoxes = rt ? this.withOpp : this.boxes;
    const input = {
      f: mkey('forward'), b: mkey('back'), l: mkey('left'), r: mkey('right'),
      walk: mkey('walk'), crouch: mkey('crouch'), jump: 0,
    };
    const holdJump = bhop && key('jump'); // bhop mode: holding jump re-jumps the instant you land
    const maxSp = this.weapons.speedLimit();
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.prevPos[0] = pl.pos[0]; this.prevPos[1] = pl.pos[1]; this.prevPos[2] = pl.pos[2];
      this.prevCrouch = pl.crouch;
      input.jump = now - this.jumpAt < 0.12 || holdJump ? 1 : 0;
      const ev = pl.tick(TICK, input, maxSp, this.moveBoxes, frozen, bhop, this.mode.phys);
      if (ev.jumped) { this.jumpAt = -1; this.sound.play('jump', { vol: 0.25 }); }
      if (ev.step) this.sound.play('step' + (this.stepIdx++ % 4), { vol: 0.28, rate: 0.9 + Math.random() * 0.2 });
      if (ev.landed > 3.5) this.sound.play('land', { vol: Math.min(0.45, ev.landed / 15) });
    }

    this.weapons.update(dt, { fire: !!key('fire'), alt: !!key('alt') });
    this.remote?.update(dt, now, p => this.sound.play('step' + ((Math.random() * 4) | 0), {
      pos: [p[0], p[1] + 0.1, p[2]], vol: 1.4, ref: 2.5, roll: 1.2, rate: 0.9 + Math.random() * 0.2,
      muffle: this.occluded([p[0], p[1] + 1, p[2]]) ? 900 : 0,
    }));

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
    this.showVM = pl.alive && this.hud.settings.viewmodel && !this.weapons.scope && !this.intro;

    this.sendAcc += dt;
    if (this.sendAcc >= 1 / 32 && pl.alive) {
      this.sendAcc = 0;
      this.net.send({
        t: 'st', p: pl.pos.map(r3), v: pl.vel.map(r3), y: r3(pl.yaw), pi: r3(pl.pitch), c: r3(pl.crouch),
        w: this.weapons.id, g: pl.grounded, ts: Math.round(this.now * 1000), // sender clock for smooth playback
      });
    }

    this.hudAcc += dt;
    if (this.hudAcc >= 0.05) { this.hudAcc = 0; this.refreshHud(); }
  }

  refreshHud() {
    const s = this.state, W = this.weapons, w = W.w, pl = this.player, hud = this.hud;
    hud.vitals(pl.alive ? this.me.hp : 0, this.me.armor, this.me.helmet);
    hud.money(this.me.money, s.phase === 'warmup' ? 'WARMUP' : '');
    $('money').hidden = !this.mode.buy;
    hud.ammo(w, W.clip || { mag: 0, reserve: 0 }, W.slots, W.slot);
    const left = Math.max(0, s.end - this.now);
    const label = { warmup: 'WARMUP', starting: 'GET READY', freeze: `ROUND ${s.round} · ${this.mode.buy ? 'BUY' : 'GET READY'}`, live: `ROUND ${s.round}`, roundEnd: `ROUND ${s.round} OVER`, matchEnd: 'MATCH OVER' }[s.phase] ?? '';
    hud.clock(s.phase === 'warmup' ? '∞' : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`, s.phase === 'live' && left < 10, label);
    const vf = (this.world.camera.fov * DEG) / 2;
    const gap = ((innerHeight / 2) * Math.tan(W.inaccuracy() * DEG)) / Math.tan(vf);
    hud.crosshair(pl.alive && !this.ui && w.cat !== 'sniper', Math.min(60, gap * 0.6));
    hud.scope(pl.alive && W.scope > 0);
    hud.hint(this.now < this.hintUntil ? this.hintMsg : !pl.alive ? this.deathMsg
      : this.canBuyNow() && s.phase !== 'live' && this.ui !== 'buy' ? 'Press B to buy' : '');
    hud.scoreboard(this.held('scoreboard') && !this.ui, this.roster, this.me.id,
      `Round ${s.round} · first to ${s.winTo}${this.vsBot ? ' · vs bot' : ` · room ${this.code}`}`);
    hud.net(`${this.fps} FPS · ${Math.round(this.net.ping)} ms`);
    if (this.ui === 'buy' && ++this.buyTick % 10 === 0) this.renderBuy();
  }
}
