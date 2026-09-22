// DOM HUD: vitals, ammo, kill feed, banners, settings + crosshair (Holdout draws its own wave clock, shop,
// scoreboard and end-of-match report directly).
import { WEAPONS } from '/shared/weapons.js';

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

// [action, label, default binding, default alternate binding] in Settings order; the defaults are the right-handed preset
export const ACTIONS = [
  ['forward', 'Forward', 'KeyW'], ['back', 'Back', 'KeyS'], ['left', 'Strafe left', 'KeyA'], ['right', 'Strafe right', 'KeyD'],
  ['jump', 'Jump', 'Space'], ['crouch', 'Crouch', 'ControlLeft'],
  ['fire', 'Fire', 'Mouse0'], ['alt', 'Scope / knife stab / Tank barrier / Fire Strike', 'Mouse2'], ['reload', 'Reload / katana Deflect', 'KeyR'],
  ['inspect', 'Harvest tool', 'KeyX'], // again while holding it: inspect
  ['primary', 'Hotbar slot 1', 'Digit1'], ['secondary', 'Hotbar slot 2', 'Digit2'], ['knife', 'Hotbar slot 3', 'Digit3'],
  ['slot4', 'Hotbar slot 4', 'Digit4'], ['slot5', 'Hotbar slot 5', 'Digit5'], ['slot6', 'Hotbar slot 6', 'Digit6'],
  ['dash', 'Katana dash', 'Digit4'], // the Ronin's: shares hotbar slot 4's key by default (see setBind / keyAction)
  ['lastWeapon', 'Last weapon'], ['nextWeapon', 'Next weapon', 'WheelDown'], ['prevWeapon', 'Previous weapon', 'WheelUp'],
  ['buy', 'Buy menu', 'KeyB'], ['scoreboard', 'Scoreboard', 'Tab'], ['chat', 'Chat', 'Enter'],
  ['interact', 'Use / pick up / repair / revive', 'KeyE'], ['ready', 'Ready up', 'KeyY'],
  ['throw', 'Throw grenade', 'KeyT'], ['nextThrow', 'Next throwable', 'KeyN'], ['adrenaline', 'Adrenaline shot', 'KeyH'],
  ['sack1', 'Use sack item 1', 'Digit7'], ['sack2', 'Use sack item 2', 'Digit8'], ['sack3', 'Use sack item 3', 'Digit9'], ['sack4', 'Use sack item 4', 'Digit0'],
  ['flashlight', 'Flashlight / lock item in inventory', 'KeyL'], ['backpack', 'Inventory', 'KeyI'], ['map', 'Full map · click to ping', 'KeyM'],
  ['turretUp', 'Upgrade turret', 'KeyU'],
  // Building (no build mode, like Fortnite's Builder Pro): a piece key starts building that piece from anywhere
  ['bWall', 'Wall', 'KeyQ'], ['bFloor', 'Floor', 'KeyF'], ['bStair', 'Stair / ramp', 'KeyC'], ['bCone', 'Cone (roof)', 'ShiftLeft'],
  ['bTrap', 'Trap (spikes, darts, flames)', 'KeyZ'], ['bDeploy', 'Turret / Rally Fire', 'KeyV'], ['bRotate', 'Rotate stair (while building)', 'KeyR'],
  ['edit', 'Edit build', 'KeyG'],
];
// Left-handed preset: mouse in the left hand, keys on the right of the keyboard ('' = unbound)
const LEFT_HANDED = {
  forward: 'KeyO', back: 'KeyL', left: 'KeyK', right: 'Semicolon', jump: 'Space', crouch: ['ControlLeft', 'KeyC'],
  fire: 'Mouse0', alt: 'Mouse2', reload: 'KeyU', inspect: 'KeyA',
  primary: 'Minus', secondary: 'Digit0', knife: 'Digit9', slot4: 'Digit8', slot5: 'Digit7', slot6: 'Digit6', dash: 'Digit8',
  lastWeapon: 'KeyQ', nextWeapon: 'WheelDown', prevWeapon: 'WheelUp', buy: 'BracketRight', scoreboard: 'Backslash', chat: '',
  interact: 'KeyI', ready: 'KeyR', throw: 'KeyY', nextThrow: 'KeyN', adrenaline: 'KeyF',
  sack1: 'Digit5', sack2: 'Digit4', sack3: 'Digit3', sack4: 'Digit2', flashlight: 'Equal', backpack: 'Enter', map: 'KeyZ', turretUp: 'Quote',
  bWall: 'KeyP', bFloor: 'KeyM', bStair: 'Comma', bCone: 'Period', bTrap: 'KeyT', bDeploy: 'KeyH', bRotate: 'KeyR', edit: 'KeyJ',
};
export const BUILD_ACTIONS = new Set(['bWall', 'bFloor', 'bStair', 'bCone', 'bTrap', 'bDeploy', 'bRotate']);
const BIND_SECTIONS = [
  ['Keybinds', id => !BUILD_ACTIONS.has(id) && id !== 'edit'],
  ['Building', id => BUILD_ACTIONS.has(id) || id === 'edit'],
];
export const defaultBinds = () => Object.fromEntries(ACTIONS.map(([id, , a = '', b = '']) => [id, [a, b]]));
export const leftHandedBinds = () => Object.fromEntries(Object.entries(LEFT_HANDED).map(([id, c]) => [id, Array.isArray(c) ? [...c] : [c, '']]));
// 2: building keys work anytime, so they share one context with everything else — older saves would clash
export const BINDS_VERSION = 3;
const REDERIVE = { 2: ['dash', 'turretUp'] }; // v2 saves may hold these blank from a mid-update build: re-pick them
// Saved binds over the defaults: actions that no longer exist are dropped, new ones keep their default keys.
// Binds saved under an older BINDS_VERSION reset to the right-handed preset.
export function loadBinds(saved, version) {
  const binds = defaultBinds();
  if (version !== BINDS_VERSION && !REDERIVE[version]) return binds;
  if (REDERIVE[version]) saved = Object.fromEntries(Object.entries(saved || {}).filter(([id]) => !REDERIVE[version].includes(id)));
  const mine = Object.keys(saved || {}).filter(id => Object.hasOwn(binds, id) && Array.isArray(saved[id]));
  for (const id of mine) binds[id] = [saved[id][0] || '', saved[id][1] || ''];
  // an action newer than the save gets the first free default: the right-handed key, else the left-handed one (a
  // left-handed save), else nothing — the dash defaults to whatever key the save uses for Hotbar slot 4
  const left = leftHandedBinds(), taken = (id, c) => Object.keys(binds).some(a => a !== id && bindCtx(a) & bindCtx(id) && binds[a].includes(c) && !shares(a, id));
  for (const id in binds) {
    if (mine.includes(id) || !binds[id].some(c => c && taken(id, c))) continue; // default free (or unbound): keep it
    const alt = id === 'dash' ? [binds.slot4[0], ''] : left[id] ?? ['', ''];
    binds[id] = alt.some(c => c && taken(id, c)) ? ['', ''] : alt;
  }
  return binds;
}

// Bind code to binds[id][i], clearing it from every other action (one key, one action). Rotate only acts while
// building, so it may share a key (R with Reload, like Fortnite); Use and Inventory may share one too (smart E), and so
// may the Ronin's dash and hotbar slots 4-6 (he only has 3 hotbar slots — see keyAction).
const bindCtx = id => (id === 'bRotate' ? 2 : 1);
const SMART = ['interact', 'backpack'];
export const DASH_SHARE = ['slot4', 'slot5', 'slot6'];
const shares = (a, b) => a !== b && ((SMART.includes(a) && SMART.includes(b)) || (a === 'dash' && DASH_SHARE.includes(b)) || (b === 'dash' && DASH_SHARE.includes(a)));
export function setBind(binds, id, i, code) {
  if (code) for (const a in binds) if (bindCtx(a) & bindCtx(id) && !shares(a, id)) binds[a] = binds[a].map(c => (c === code ? '' : c));
  binds[id][i] = code;
}
// The action a key press means (map: code -> action, whichever of a shared pair it kept): a key the dash shares with
// hotbar slot 4-6 dashes for a Ronin and picks the slot for everyone else.
export function keyAction(map, binds, code, ronin) {
  const a = map[code];
  if (a !== 'dash' && !DASH_SHARE.includes(a)) return a;
  return ronin && binds.dash?.includes(code) ? 'dash' : DASH_SHARE.find(s => binds[s]?.includes(code)) ?? a;
}
// Smart E: a key bound to both Use and Inventory closes an open inventory, else uses whatever is in range (a target
// that does something when pressed or held), else opens the inventory.
export const smartKey = (binds, code) => !!code && !!binds.interact?.includes(code) && !!binds.backpack?.includes(code);
export const smartRoute = (bagOpen, target) => (bagOpen ? 'close' : target && (target.press || target.cont || target.hold) ? 'use' : 'open');

const KEY_NAMES = {
  Mouse0: 'Mouse 1', Mouse2: 'Mouse 2', Mouse1: 'Mouse 3', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  WheelUp: 'Wheel up', WheelDown: 'Wheel down', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', AltLeft: 'L-Alt', AltRight: 'R-Alt', CapsLock: 'Caps Lock',
  Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/',
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
    this.settings.binds = loadBinds(stored.binds, stored.bindsV);
    this.settings.bindsV = BINDS_VERSION;
    if (stored.binds && stored.bindsV !== BINDS_VERSION) this.save(); // keep the migrated binds
    if (stored.binds && stored.bindsV !== BINDS_VERSION && !REDERIVE[stored.bindsV]) { // once: the old binds clash with the anytime building keys
      $('menuMsg').textContent = 'Keybinds were reset for the new building keys — pick Left or Right handed in Settings → Key bindings';
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
      <small>Click a slot, then press a key, mouse button or scroll the wheel. Esc cancels, Backspace clears.
      Use and Inventory may share one key: it uses whatever is in range, otherwise it opens or closes the inventory.
      Katana dash may share a key with hotbar slots 4-6: the Ronin (3 hotbar slots) dashes, everyone else picks the slot.</small>
      <div id="bindList"></div>
      <div class="row"><button id="bindRight" class="bindReset">Right handed</button><button id="bindLeft" class="bindReset">Left handed</button></div>`);
    const preset = binds => () => {
      this.settings.binds = binds();
      this.save();
      this.onSettings(this.settings);
      this.renderBinds();
    };
    $('bindRight').onclick = preset(defaultBinds);
    $('bindLeft').onclick = preset(leftHandedBinds);
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
      list.insertAdjacentHTML('beforeend', `<h4 class="bindHead">${esc(title)}</h4>`);
      for (const [id, label] of ACTIONS) {
        if (!has(id)) continue;
        const row = document.createElement('div');
        row.className = 'bindRow';
        row.innerHTML = `<span>${label}</span>`;
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
        setBind(this.settings.binds, id, i, code === 'Backspace' || code === 'Delete' ? '' : code);
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

  chat(name, text) {
    const d = document.createElement('div');
    d.innerHTML = name ? `<b>${esc(name)}:</b> ${esc(text)}` : `<i>${esc(text)}</i>`;
    $('chatlog').append(d);
    setTimeout(() => d.remove(), 9000);
    while ($('chatlog').children.length > 6) $('chatlog').firstChild.remove();
  }

  net(text) { setText('netinfo', this.settings.showFps ? text : ''); }
}
