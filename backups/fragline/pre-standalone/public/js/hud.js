// DOM HUD: vitals, ammo, clock, kill feed, banners, buy menu, scoreboard, settings + crosshair.
import { WEAPONS, GEAR, BUY_MENU } from '/shared/weapons.js';

const RARITY = { covert: '#eb4b4b', contraband: '#e4ae39', restricted: '#a77bff', knife: '#ffd700' };
const LOOT_COLORS = ['#b7bec7', '#5fd35a', '#4aa8ff', '#c07bff', '#ffb43c']; // Holdout rarities (shared/holdout.js)
const elCache = {};
const $ = id => (elCache[id] ??= document.getElementById(id));
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// The HUD refreshes 20×/s; only touch the DOM when a value actually changed (avoids layout work).
const last = {};
export const setText = (id, v) => { v = String(v); if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
export const setHTML = (id, v) => { const k = id + '#html'; if (last[k] !== v) { last[k] = v; $(id).innerHTML = v; } };
export const setClass = (id, cls, on) => { const k = id + '.' + cls; if (last[k] !== on) { last[k] = on; $(id).classList.toggle(cls, on); } };
export const setStyle = (id, prop, v) => { const k = id + ':' + prop; if (last[k] !== v) { last[k] = v; $(id).style[prop] = v; } };
export const setHidden = (id, h) => { const k = id + '!hidden'; if (last[k] !== h) { last[k] = h; $(id).hidden = h; } };
// Forget cached values (after other code changed those elements directly).
export const hudReset = () => { for (const k in last) delete last[k]; };

// [action, label, default binding, default alternate binding]
export const ACTIONS = [
  ['forward', 'Forward', 'KeyW'], ['back', 'Back', 'KeyS'], ['left', 'Strafe left', 'KeyA'], ['right', 'Strafe right', 'KeyD'],
  ['jump', 'Jump', 'Space'], ['crouch', 'Crouch', 'ControlLeft', 'KeyC'], ['walk', 'Walk', 'ShiftLeft'],
  ['fire', 'Fire', 'Mouse0'], ['alt', 'Scope / knife stab', 'Mouse2'], ['reload', 'Reload', 'KeyR'], ['inspect', 'Inspect weapon', 'KeyF'],
  ['primary', 'Primary weapon', 'Digit1'], ['secondary', 'Pistol', 'Digit2'], ['knife', 'Knife', 'Digit3'],
  ['lastWeapon', 'Last weapon', 'KeyQ'], ['nextWeapon', 'Next weapon', 'WheelDown'], ['prevWeapon', 'Previous weapon', 'WheelUp'],
  ['buy', 'Buy menu', 'KeyB'], ['scoreboard', 'Scoreboard', 'Tab'], ['chat', 'Chat', 'Enter'],
  ['build', 'Build mode (Holdout)', 'KeyG'], ['edit', 'Edit build (Holdout)', 'KeyV'], ['interact', 'Use / pick up / repair / revive (Holdout)', 'KeyE'],
  ['demolish', 'Demolish piece (Holdout)', 'KeyX'], ['ready', 'Ready up (Holdout)', 'KeyY'],
  ['slot4', 'Hotbar slot 4 (Holdout)', 'Digit4'], ['slot5', 'Hotbar slot 5 (Holdout)', 'Digit5'], ['slot6', 'Hotbar slot 6 (Holdout)', 'Digit6'],
  ['throw', 'Throw grenade (Holdout)', 'KeyT'], ['nextThrow', 'Next throwable (Holdout)', 'KeyN'], ['heal', 'Heal / shield (Holdout)', 'KeyH'],
  ['adrenaline', 'Adrenaline shot (Holdout)', 'KeyJ'],
  ['sack1', 'Use sack item 1 (Holdout)', 'Digit7'], ['sack2', 'Use sack item 2 (Holdout)', 'Digit8'],
  ['sack3', 'Use sack item 3 (Holdout)', 'Digit9'], ['sack4', 'Use sack item 4 (Holdout)', 'Digit0'],
  ['flashlight', 'Flashlight (Holdout)', 'KeyL'],
  ['command', 'Send survivors here (Holdout)', 'Mouse1'],
  ['backpack', 'Inventory (Holdout)', 'KeyI'], ['dropgun', 'Drop item in hand (Holdout)', 'KeyZ'], ['map', 'Full map · click to ping (Holdout)', 'KeyM'],
  // Building: only while build mode is on, so these may share keys with the ones above
  ['bWall', 'Wall', 'KeyQ'], ['bStair', 'Stair / ramp', 'KeyE'], ['bFloor', 'Floor', 'KeyF'],
  ['bTrap', 'Trap (spikes, darts, flames)', 'KeyT'], ['bDeploy', 'Turret / Rally Fire', 'KeyZ'], ['bRotate', 'Rotate stair', 'KeyR'],
];
export const BUILD_ACTIONS = new Set(['bWall', 'bStair', 'bFloor', 'bTrap', 'bDeploy', 'bRotate']);
const BIND_SECTIONS = [
  ['General', id => !BUILD_ACTIONS.has(id) && !/\(Holdout\)/.test(ACTIONS.find(a => a[0] === id)[1])],
  ['Zombie Holdout', id => /\(Holdout\)/.test(ACTIONS.find(a => a[0] === id)[1])],
  ['Building — while build mode (G) is on', id => BUILD_ACTIONS.has(id)],
];
export const defaultBinds = () => Object.fromEntries(ACTIONS.map(([id, , a = '', b = '']) => [id, [a, b]]));

const KEY_NAMES = {
  Mouse0: 'Mouse 1', Mouse2: 'Mouse 2', Mouse1: 'Mouse 3', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  WheelUp: 'Wheel up', WheelDown: 'Wheel down', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', AltLeft: 'L-Alt', AltRight: 'R-Alt', CapsLock: 'Caps Lock',
  Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};
export const keyName = code => !code ? '—' : KEY_NAMES[code] || code.replace(/^(Key|Digit)/, '').replace(/^Numpad/, 'Num ');

export const DEFAULTS = {
  name: '', sens: 1.6, zoomSens: 1, fov: 106, volume: 0.7, viewmodel: true, showFps: true, bhop: true, fullscreen: true,
  renderScale: 1, shadows: true, antialias: true,
  chColor: '#4dff88', chLen: 6, chGap: 3, chThick: 2, chDot: false, chOutline: true, chDynamic: false,
};

const SPEC = [
  ['h', 'Movement'],
  ['bhop', 'Bunny hop (hold jump, no landing slowdown)', 'check'],
  ['h', 'Mouse'],
  ['sens', 'Sensitivity (CS2 scale)', 'number', 0.05, 10, 0.01, 'Coming from Valorant? multiply your sens by 3.18'],
  ['zoomSens', 'Zoom sensitivity ratio', 'number', 0.1, 3, 0.05],
  ['h', 'Video'],
  ['fullscreen', 'Fullscreen + Esc lock', 'check', undefined, undefined, undefined,
    'Chrome/Edge: Esc closes menus without releasing your mouse (like CS). Hold Esc to leave fullscreen.'],
  ['fov', 'Horizontal FOV', 'range', 80, 120, 1],
  ['renderScale', 'Render scale', 'range', 0.5, 1.5, 0.05, 'Lower = more FPS. 100% = one pixel per screen pixel at normal Windows scaling.'],
  ['shadows', 'Shadows', 'check'],
  ['antialias', 'Anti-aliasing (applies after reload)', 'check'],
  ['viewmodel', 'Show weapon', 'check'],
  ['showFps', 'Show FPS / ping', 'check'],
  ['h', 'Audio'],
  ['volume', 'Master volume', 'range', 0, 1, 0.01],
  ['h', 'Crosshair'],
  ['chColor', 'Color', 'color'],
  ['chLen', 'Length', 'range', 0, 20, 1],
  ['chGap', 'Gap', 'range', -2, 20, 1],
  ['chThick', 'Thickness', 'range', 1, 6, 1],
  ['chDot', 'Center dot', 'check'],
  ['chOutline', 'Outline', 'check'],
  ['chDynamic', 'Dynamic (shows spread)', 'check'],
];

export class Hud {
  // requestKey(cb): ask the input layer to hand the next pressed key/button/wheel code to cb
  constructor(onSettings, requestKey) {
    this.onSettings = onSettings;
    this.requestKey = requestKey;
    this.settings = { ...DEFAULTS };
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('fragline.settings') || '{}'); } catch { /* storage blocked */ }
    Object.assign(this.settings, stored);
    this.settings.binds = defaultBinds();
    for (const [id, codes] of Object.entries(stored.binds || {})) {
      if (this.settings.binds[id] && Array.isArray(codes)) this.settings.binds[id] = [codes[0] || '', codes[1] || ''];
    }
    this.buildSettings();
    this.applyCrosshair();
    this.bannerTimer = 0;
  }

  save() {
    try { localStorage.setItem('fragline.settings', JSON.stringify(this.settings)); } catch { /* storage blocked */ }
  }

  buildSettings() {
    const root = $('settings');
    root.innerHTML = '<h2>SETTINGS</h2>';
    for (const [key, label, type, min, max, step, help] of SPEC) {
      if (key === 'h') { root.insertAdjacentHTML('beforeend', `<h3>${label.toUpperCase()}</h3>`); continue; }
      const l = document.createElement('label');
      const input = document.createElement('input');
      input.type = type === 'check' ? 'checkbox' : type;
      if (min !== undefined) Object.assign(input, { min, max, step });
      const v = this.settings[key];
      if (type === 'check') input.checked = !!v; else input.value = v;
      const val = document.createElement('span');
      val.style.minWidth = '38px';
      val.style.textAlign = 'right';
      const show = () => { val.textContent = type === 'range' ? (step < 1 ? Math.round(input.value * 100) + '%' : input.value) : ''; };
      show();
      input.addEventListener('input', () => {
        this.settings[key] = type === 'check' ? input.checked : type === 'color' ? input.value : parseFloat(input.value) || 0;
        show();
        this.save();
        this.applyCrosshair();
        this.onSettings(this.settings);
      });
      l.append(label, input, val);
      root.append(l);
      if (help) root.insertAdjacentHTML('beforeend', `<small>${help}</small>`);
      if (key === 'antialias') root.insertAdjacentHTML('beforeend', '<small id="gpuInfo"></small>');
    }
    root.insertAdjacentHTML('beforeend', `<h3>KEY BINDINGS</h3>
      <small>Click a slot, then press a key, mouse button or scroll the wheel. Esc cancels, Backspace clears.</small>
      <div id="bindList"></div><button id="bindReset" class="bindReset">Reset keys to default</button>`);
    $('bindReset').onclick = () => {
      this.settings.binds = defaultBinds();
      this.save();
      this.onSettings(this.settings);
      this.renderBinds();
    };
    this.renderBinds();
  }

  setGpu(name) {
    const software = /swiftshader|llvmpipe|software|basic render/i.test(name);
    $('gpuInfo').textContent = `GPU: ${name}` + (software ? ' — hardware acceleration looks OFF; turn it on in your browser settings for full FPS.' : '');
    $('gpuInfo').style.color = software ? 'var(--accent)' : '';
  }

  renderBinds() {
    const list = $('bindList');
    list.innerHTML = '';
    for (const [title, has] of BIND_SECTIONS) {
      list.insertAdjacentHTML('beforeend', `<h4 class="bindHead">${title}</h4>`);
      for (const [id, label] of ACTIONS) {
        if (!has(id)) continue;
        const row = document.createElement('div');
        row.className = 'bindRow';
        row.innerHTML = `<span>${label.replace(' (Holdout)', '')}</span>`;
        for (const i of [0, 1]) {
          const b = document.createElement('button');
          b.className = 'bindBtn';
          b.textContent = keyName(this.settings.binds[id][i]);
          b.onclick = () => this.listen(id, i, b);
          row.append(b);
        }
        list.append(row);
      }
    }
  }

  listen(id, i, btn) {
    btn.textContent = 'Press a key…';
    btn.classList.add('listening');
    this.requestKey(code => {
      if (code !== 'Escape') {
        const val = code === 'Backspace' || code === 'Delete' ? '' : code;
        const binds = this.settings.binds;
        const ctx = a => BUILD_ACTIONS.has(a); // build keys only clash with other build keys
        if (val) for (const a in binds) if (ctx(a) === ctx(id)) binds[a] = binds[a].map(c => (c === val ? '' : c)); // one key, one action
        binds[id][i] = val;
        this.save();
        this.onSettings(this.settings);
      }
      this.renderBinds();
    });
  }

  applyCrosshair(dynGap = 0) {
    const s = this.settings, st = $('crosshair').style;
    st.setProperty('--cc', s.chColor);
    st.setProperty('--cl', s.chLen + 'px');
    st.setProperty('--ct', s.chThick + 'px');
    st.setProperty('--cg', (s.chGap + (s.chDynamic ? dynGap : 0)) + 'px');
    st.setProperty('--co', s.chOutline ? '0.85' : '0');
    st.setProperty('--cdot', s.chDot ? 'block' : 'none');
  }

  crosshair(visible, dynGap) {
    setStyle('crosshair', 'display', visible ? '' : 'none');
    if (visible && this.settings.chDynamic) {
      const g = Math.round(dynGap);
      if (g !== this.lastGap) { this.lastGap = g; this.applyCrosshair(g); }
    }
  }

  vitals(hp, armor, helmet, label = null) {
    setText('hp', hp);
    setClass('hp', 'low', hp <= 25);
    setText('armor', armor);
    setText('armorLabel', label ?? (helmet ? 'ARMOR + HELMET' : 'ARMOR'));
    setStyle('vignette', 'opacity', String(hp > 0 && hp <= 30 ? (1 - hp / 30) * 0.8 + 0.2 : 0));
  }

  money(m, sub = '') {
    const v = '$' + m;
    if (last.money !== v) { last.money = v; $('money').firstChild.nodeValue = v; }
    setText('moneySub', sub);
  }

  // rarity: Holdout item rarity index (colors the name like the loot tiers)
  ammo(w, clip, slots, activeSlot, rarity = null) {
    setText('weaponName', (w.skin ? `${w.name} | ${w.skin}` : w.name).toUpperCase());
    setStyle('weaponName', 'color', rarity !== null && rarity !== undefined && w.mode === 'holdout' ? LOOT_COLORS[rarity] : RARITY[w.rarity] || '');
    const melee = w.cat === 'melee';
    setText('mag', melee ? '—' : clip.mag);
    setClass('mag', 'low', !melee && clip.mag <= Math.ceil(w.mag * 0.2));
    setText('reserve', melee ? '' : '/ ' + clip.reserve);
    setHTML('slots', [1, 2, 3].filter(s => slots[s])
      .map(s => `<span class="${s === activeSlot ? 'on' : ''}">${s} ${esc(WEAPONS[slots[s].w].name)}</span>`).join(''));
  }

  clock(text, low, label) {
    setText('timer', text);
    setClass('timer', 'low', low);
    setText('roundNo', label);
  }

  score(me, them, meName, themName) {
    setText('scoreMe', me);
    setText('scoreThem', them);
    setText('nameMe', meName);
    setText('nameThem', themName);
  }

  kill(killer, victim, weapon, hs, wb, mine) {
    const d = document.createElement('div');
    if (mine) d.className = 'mine';
    d.innerHTML = `${esc(killer)}<span class="w">${esc(WEAPONS[weapon]?.name || weapon)}</span>${wb ? '<span class="hs">⟂</span>' : ''}${hs ? '<span class="hs">◎</span>' : ''}${esc(victim)}`;
    $('killfeed').prepend(d);
    setTimeout(() => d.remove(), 7000);
    while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  }

  banner(title, sub = '', cls = '', ms = 2200) {
    const b = $('banner');
    $('bannerTitle').textContent = title;
    $('bannerSub').textContent = sub;
    b.className = 'show ' + cls;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { b.className = cls; }, ms);
  }

  hint(text) { setText('hint', text); }

  roundEnd(data) {
    const el = $('roundEnd');
    if (!data) { el.hidden = true; return; }
    el.hidden = false;
    el.className = data.win ? 'win' : 'lose';
    $('reTitle').textContent = data.title;
    $('reReason').textContent = data.reason;
    $('reGiven').textContent = data.given;
    $('reTaken').textContent = data.taken;
  }

  hitDir(angleDeg) {
    const d = document.createElement('div');
    d.className = 'hd';
    d.style.transform = `rotate(${angleDeg}deg)`;
    $('hitDirs').append(d);
    setTimeout(() => d.remove(), 1300);
    const f = $('flash');
    f.style.transition = 'none';
    f.style.opacity = 1;
    requestAnimationFrame(() => { f.style.transition = ''; f.style.opacity = 0; });
  }

  scope(on) { setHidden('scope', !on); }

  renderBuy(st) {
    $('buyMoney').textContent = '$' + st.money;
    $('buyTimer').textContent = st.canBuy ? st.timeText : 'Buy time over';
    $('buyGrid').innerHTML = [...BUY_MENU, ...(st.extra || [])].map(([cat, ids]) => `<div class="buyCol"><h3>${cat.toUpperCase()}</h3>${ids.map(id => {
      const w = WEAPONS[id], g = GEAR[id];
      let price = w ? w.price : g.price, stats, owned;
      if (w) {
        stats = w.pellets > 1 ? `${w.dmg}×${w.pellets} dmg · ${w.rpm} rpm · ${w.mag}/${w.reserve}` : `${w.dmg} dmg · ${w.rpm} rpm · ${w.mag}/${w.reserve}`;
        owned = st.owned.has(id);
      } else if (id === 'ammo') { stats = 'Refill every magazine + reserve'; owned = false; }
      else if (id === 'kevlar') { stats = '100 armor, body only'; owned = st.armor >= 100; }
      else {
        stats = 'Armor + headshot protection';
        owned = st.armor >= 100 && st.helmet;
        if (st.armor >= 100 && !st.helmet) price = g.upgrade;
      }
      const poor = !st.free && price > st.money;
      return `<button class="buyItem ${owned ? 'owned' : ''} ${poor ? 'poor' : ''}" data-id="${id}" ${!st.canBuy || owned || poor ? 'disabled' : ''}>
        <div class="n"><span>${esc(w ? w.name : g.name)}</span><em>$${price}</em></div>${w?.skin ? `<div class="skin" style="color:${RARITY[w.rarity]}">${esc(w.skin)}</div>` : ''}<div class="s">${owned ? 'OWNED' : stats}</div></button>`;
    }).join('')}</div>`).join('');
    for (const b of $('buyGrid').querySelectorAll('button')) b.onclick = () => st.onBuy(b.dataset.id);
  }

  scoreboard(show, roster, myId, meta) {
    setHidden('scoreboard', !show);
    if (!show) return;
    setHTML('sbBody', [...roster].sort((a, b) => (b.id === myId) - (a.id === myId)).map(p =>
      `<tr class="${p.id === myId ? 'me' : ''} ${p.alive ? '' : 'dead'}"><td>${esc(p.name)} <small>${p.side}</small></td><td>${p.score}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.dmg}</td><td>${p.bot ? 'BOT' : p.ping}</td></tr>`).join(''));
    $('sbMeta').textContent = meta;
  }

  chat(name, text) {
    const d = document.createElement('div');
    d.innerHTML = name ? `<b>${esc(name)}:</b> ${esc(text)}` : `<i>${esc(text)}</i>`;
    $('chatlog').append(d);
    setTimeout(() => d.remove(), 9000);
    while ($('chatlog').children.length > 6) $('chatlog').firstChild.remove();
  }

  net(text) { setText('netinfo', this.settings.showFps ? text : ''); }
}
