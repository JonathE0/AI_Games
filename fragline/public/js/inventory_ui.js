// Zombie Holdout inventory window (E or I): a Minecraft-style grid — armor slots beside a figure with your stats,
// the 18-slot backpack, the 6-slot hotbar, ammo / material counters and (at the Core's team chest) the
// shared chest grid. Drag items between slots with the in-game cursor (or the real mouse when it is free),
// drop them outside the window to throw them on the ground, shift-click to quick-move. The server checks
// every move; this only draws and asks.
import { WEAPONS, BOSS_PERKS } from '/shared/weapons.js';
import { AMMO, AMMO_IDS, ITEMS, ARMOR, ATTACH, CLASSES, ammoCap } from '/shared/holdout.js';
import { ELEMENTS } from '/shared/elements.js';
import { HOTBAR, INV_SIZE, STASH_SIZE, SACK_SIZE, ARMOR_SLOTS, TIERS, TIER_COLORS, magFor, gunMult, itemName, armorStats, damageReduction, tierCost } from '/shared/items.js';
import { MAT_IDS } from '/shared/build.js';
import { itemLook, slotHTML } from './holdout_ui.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const btn = (label, data, cls = '', disabled = false) => `<button class="mini ${cls}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}${disabled ? ' disabled' : ''}>${label}</button>`;
const SLOT_NAME = { head: 'Head', chest: 'Chest', legs: 'Legs', feet: 'Feet' };
const pct = v => `${Math.round(v * 100)}%`;

export class InventoryUI {
  constructor(h) {
    this.h = h;
    this.g = h.g;
    this.drag = null;     // { ref, it, x0, y0, moved }
    this.sel = null;      // slot ref shown in the info box
    this.atChest = false;
    this.lastMouse = null; // real (unlocked) mouse position, for hotkeySwap when there's no virtual cursor
    this.ghost = document.createElement('div');
    this.ghost.id = 'invGhost';
    this.ghost.hidden = true;
    document.body.append(this.ghost);
    // a free mouse (no pointer lock) drives the same handlers as the in-game cursor
    this.onDown = e => { if (this.open && !this.g.input.locked && e.button === 0) { this.down(e.clientX, e.clientY, e.shiftKey); e.preventDefault(); } };
    // tracked whenever the bag or the Banker is up, so L-to-lock can find a hovered tile even with a free mouse
    this.onMove = e => {
      if (!this.g.input.locked && (this.open || this.g.ui === 'bank')) this.lastMouse = [e.clientX, e.clientY];
      if (this.open && !this.g.input.locked) this.move(e.clientX, e.clientY);
    };
    this.onUp = e => { if (this.open && !this.g.input.locked && e.button === 0) this.up(e.clientX, e.clientY); };
    addEventListener('mousedown', this.onDown, true);
    addEventListener('mousemove', this.onMove);
    addEventListener('mouseup', this.onUp);
  }

  get open() { return this.g.ui === 'bag'; }

  item(ref) {
    const h = this.h;
    if (ref.startsWith('a:')) return h.armor[ref.slice(2)] ?? null;
    const n = +ref.slice(1);
    return ref[0] === 'i' ? h.inv[n] ?? null : ref[0] === 's' ? h.stash.items?.[n] ?? null : ref[0] === 'k' ? h.sack[n] ?? null : null;
  }

  slot(ref, it, extra = '') { return slotHTML(ref, it, this.sel === ref, extra); }

  // ---------- drawing ----------
  render() {
    const h = this.h, g = this.g, st = armorStats(h.armor), cls = CLASSES[h.cls];
    this.atChest = h.bagAtChest && h.nearStash();
    $('bagTitle').textContent = this.atChest ? 'INVENTORY · TEAM CHEST' : 'INVENTORY';
    const armor = ARMOR_SLOTS.map(s => `<div class="aslot"><small>${SLOT_NAME[s]}</small>${this.slot('a:' + s, h.armor[s])}</div>`).join('');
    const stats = [
      `<b>${Math.round(g.me.hp)}</b>/${h.maxHp} HP`, `<b>${pct(damageReduction(st.def))}</b> armor`,
      st.fire ? `<b>${pct(st.fire)}</b> fire resist` : '', st.slow ? `<b>${pct(st.slow)}</b> slow resist` : '',
      st.blind ? `<b>${pct(st.blind)}</b> blind resist` : '', st.speed ? `<b>+${pct(st.speed)}</b> speed` : '',
    ].filter(Boolean).map(x => `<span>${x}</span>`).join('');
    const figure = `<div class="figure${cls ? ' ' + h.cls : ''}"><i class="fh"></i><i class="fb"></i><i class="fl"></i><em>${esc(cls?.name ?? 'No class')}</em></div>`;
    const grid = (from, to, prefix, items) => Array.from({ length: to - from }, (_, k) => this.slot(prefix + (from + k), items[from + k])).join('');
    const keys = h.hotkeys();
    const hot = Array.from({ length: HOTBAR }, (_, k) => this.slot('i' + k, h.inv[k], `<b class="key">${keys[k]}</b>`)).join('');
    const sackKeys = ['7', '8', '9', '0'];
    const sack = Array.from({ length: SACK_SIZE }, (_, k) => this.slot('k' + k, h.sack[k], `<b class="key">${sackKeys[k]}</b>`)).join('');
    const counters = [
      ...AMMO_IDS.map(t => `<span class="chip" style="--c:${AMMO[t].color}">${AMMO[t].name.replace(' Ammo', '')} <b>${h.ammo[t] || 0}</b><small>/${ammoCap(t, h.cls)}</small></span>`),
      ...MAT_IDS.map(m => `<span class="chip mat ${m}">${m} <b>${h.mats[m] || 0}</b></span>`),
      `<span class="chip money">$<b>${g.me.money}</b></span>`,
    ].join('');
    let chest = '';
    if (this.atChest) {
      const s = h.stash, put = (cat, key, n, label, ok = true) => btn(label, { op: 'put', cat, key, n }, '', !ok), take = (cat, key, n, label, ok) => btn(label, { op: 'take', cat, key, n }, '', !ok);
      const rows = [
        `<div class="bagRow"><span>Bank <b>$${s.money}</b></span>${put('money', '', 500, 'Pool $500', g.me.money > 0)}${put('money', '', g.me.money, 'Pool all', g.me.money > 0)}${take('money', '', 500, 'Take $500', s.money > 0)}</div>`,
        ...MAT_IDS.map(m => `<div class="bagRow"><span>${m} <b>${s.mats[m]}</b></span>${put('mats', m, 50, '+50', (h.mats[m] || 0) > 0)}${take('mats', m, 50, 'Take 50', s.mats[m] > 0)}</div>`),
        ...AMMO_IDS.map(t => `<div class="bagRow"><span>${AMMO[t].name.replace(' Ammo', '')} <b>${s.ammo[t]}</b></span>${put('ammo', t, AMMO[t].pack, `+${AMMO[t].pack}`, (h.ammo[t] || 0) > 0)}${take('ammo', t, AMMO[t].pack, 'Take', s.ammo[t] > 0)}</div>`),
      ].join('');
      chest = `<div class="invChest"><h3>TEAM CHEST</h3><div class="grid">${grid(0, STASH_SIZE, 's', s.items || [])}</div><div class="pool">${rows}</div></div>`;
    }
    $('bagGrid').innerHTML = `<div class="inv${this.atChest ? ' wide' : ''}">
      <div class="invSide">${figure}<div class="armor">${armor}</div><div class="stats">${stats}</div></div>
      <div class="invMain"><h3>BACKPACK</h3><div class="grid">${grid(HOTBAR, INV_SIZE, 'i', h.inv)}</div>
        <h3>HOTBAR</h3><div class="grid hot">${hot}</div>
        <h3>SACK</h3><div class="grid sack">${sack}</div><div class="counters">${counters}</div></div>
      ${chest}</div>
      <div class="invInfo" id="invInfo">${this.infoHTML()}</div>
      <small class="invHelp">Drag to move · drop outside the window to throw it away · shift-click to quick-move · drop an attachment on a gun to fit it · hover a tile and press L to lock/unlock it</small>`;
    this.wire();
    if (this.g.vcur) this.g.setVCursor(...this.g.vcur);
  }

  infoHTML() {
    const h = this.h, ref = this.sel, it = ref && this.item(ref);
    if (!it) return '<span class="muted">Click an item to see what it does.</span>';
    const parts = [`<b style="color:${itemLook(it).color}">${esc(itemName(it))}</b>`], acts = [];
    if (it.kind === 'gun') {
      const w = WEAPONS[it.id];
      const dmg = Math.round(w.dmg * gunMult(it) * (h.cls === 'assault' ? 1.2 : 1));
      parts.push(`${dmg}${w.pellets > 1 ? `×${w.pellets}` : ''} dmg · ${w.rpm} rpm · ${magFor(it, h.cls)} mag · ${AMMO[w.ammo]?.name ?? ''}`);
      if (it.el) parts.push(`<span style="color:${ELEMENTS[it.el].color}">${ELEMENTS[it.el].name}</span> rounds`);
      if (w.boss) parts.push(`<span class="muted">${BOSS_PERKS[w.id]}</span>`);
      const att = Object.values(it.att || {}).filter(Boolean).map(a => ATTACH[a]?.name);
      if (att.length) parts.push('Fitted: ' + att.join(', '));
    } else if (it.kind === 'armor') {
      const a = ARMOR[it.id], t = it.tier ?? 1, bits = [`${a.def[t]} armor`];
      for (const k of ['fire', 'slow', 'blind']) if (a[k]) bits.push(`${pct(a[k][t])} ${k} resist`);
      if (a.speed) bits.push(`+${pct(a.speed[t])} speed`);
      parts.push(`${SLOT_NAME[a.slot]} · ${bits.join(' · ')}`);
      if (!ref.startsWith('a:')) acts.push(btn('Wear', { act: 'wear' }, '', it.locked));
      else acts.push(btn('Take off', { act: 'unwear' }, '', it.locked));
    } else if (it.kind === 'attach') {
      parts.push(ATTACH[it.id].desc + ' · drop it on a gun to fit it');
      acts.push(btn('Fit on the gun in hand', { act: 'fit' }));
    } else {
      const d = ITEMS[it.id];
      parts.push(d.kind === 'heal' ? `+${d.hp}% HP up to ${d.cap}% · ${d.time}s` : d.kind === 'shield' ? `+${d.sh} shield up to ${d.cap}` : d.kind === 'throw' ? 'Throw with T (N picks which)' : 'Place it from build mode');
      if (d.kind === 'heal' || d.kind === 'shield') acts.push(btn('Use', { act: 'use' }));
      if (d.kind === 'throw') acts.push(btn(h.activeThrow === it.id ? 'Selected for T' : 'Select for T', { act: 'select' }, h.activeThrow === it.id ? 'on' : ''));
    }
    if ((it.kind === 'gun' || it.kind === 'armor') && (it.tier ?? 1) < 3) {
      const to = (it.tier ?? 1) + 1, c = tierCost(it, to);
      if (to === 2) acts.push(btn(`Upgrade to tier II · $${c.money}`, { act: 'tier' }, '', !h.canBuy() || this.g.me.money < c.money));
      else acts.push(`<span class="muted">Tier III: the Blacksmith</span>`);
    }
    if (!ref.startsWith('s')) acts.push(btn((it.n ?? 1) > 1 ? 'Drop 1' : 'Drop', { act: 'drop1' }, '', it.locked), (it.n ?? 1) > 1 ? btn('Drop all', { act: 'drop' }, '', it.locked) : '');
    if (it.locked) parts.push('<span class="muted">Locked — press L to unlock</span>');
    return `<div>${parts.join('<br>')}</div><div class="acts">${acts.join('')}</div>`;
  }

  wire() {
    for (const b of $('bagGrid').querySelectorAll('button')) {
      b.onclick = () => {
        const d = b.dataset, net = this.g.net, it = this.sel && this.item(this.sel);
        if (d.op) net.send({ t: 'stash', op: d.op, cat: d.cat, key: d.key, n: +d.n });
        else if (d.act === 'use') { this.h.closeBag(); this.h.heal(it.id); }
        else if (d.act === 'select') { this.h.activeThrow = it.id; this.render(); }
        else if (d.act === 'wear') net.send({ t: 'move', from: this.sel, to: 'a:' + ARMOR[it.id].slot });
        else if (d.act === 'unwear') { const free = this.h.inv.findIndex((x, i) => !x && i >= HOTBAR); if (free >= 0) net.send({ t: 'move', from: this.sel, to: 'i' + free }); }
        else if (d.act === 'fit') { const W = this.g.weapons, held = W.slot >= 1 ? 'i' + (W.slot - 1) : null; if (held && this.h.inv[W.slot - 1]?.kind === 'gun') net.send({ t: 'move', from: this.sel, to: held }); else this.h.say('Hold the gun you want to fit it on'); }
        else if (d.act === 'tier') net.send({ t: 'tierup', uid: it.uid });
        else if (d.act === 'drop1') net.send({ t: 'drop', from: this.sel, n: 1 });
        else if (d.act === 'drop') net.send({ t: 'drop', from: this.sel });
        this.g.sound.play('tick', { vol: 0.4 });
      };
    }
  }

  // ---------- pointer (in-game cursor or real mouse) ----------
  // matches tiles in both the inventory and the Banker (they share slotHTML's markup)
  slotAt(x, y) { return document.elementFromPoint(x, y)?.closest('#bagMenu .slot, #bankMenu .slot') ?? null; }

  // Minecraft-style: hovering a slot (any box, including the team chest) and pressing 1-6 swaps it into that hotbar slot.
  hotkeySwap(idx, vcur) {
    if (this.drag) return;
    const ref = this.refUnder(vcur);
    if (!ref || ref === 'i' + idx) return;
    this.g.net.send({ t: 'move', from: ref, to: 'i' + idx });
  }

  // The slot ref under the cursor (virtual or real), used by both the hotbar-swap keys and the lock key.
  refUnder(vcur) {
    const pos = vcur || this.lastMouse;
    return pos && (this.slotAt(...pos)?.dataset.ref ?? null);
  }

  // L while hovering a tile in the inventory or the Banker (including the team chest): toggle its lock.
  toggleLock(vcur) {
    const ref = this.refUnder(vcur);
    if (ref) this.g.net.send({ t: 'lock', ref });
  }

  down(x, y, shift = false) {
    const b = document.elementFromPoint(x, y)?.closest('#bagMenu button');
    if (b) { if (!b.disabled) b.click(); return; }
    const el = this.slotAt(x, y);
    if (!el) return;
    const ref = el.dataset.ref, it = this.item(ref);
    if (shift && it) { this.quickMove(ref, it); return; }
    this.sel = ref;
    this.drag = it ? { ref, it, x0: x, y0: y, moved: false } : null;
    this.render();
  }

  move(x, y) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > 6) {
      d.moved = true;
      const look = itemLook(d.it);
      this.ghost.innerHTML = `<span>${esc(look.label)}</span>`;
      this.ghost.style.setProperty('--rc', look.color);
      this.ghost.hidden = false;
    }
    if (d.moved) this.ghost.style.transform = `translate(${x - 30}px, ${y - 30}px)`;
    for (const el of $('bagGrid').querySelectorAll('.slot.over')) el.classList.remove('over');
    this.slotAt(x, y)?.classList.add('over');
  }

  up(x, y) {
    const d = this.drag;
    this.drag = null;
    this.ghost.hidden = true;
    if (!d?.moved) return;
    const el = this.slotAt(x, y), net = this.g.net;
    if (el && el.dataset.ref !== d.ref) { net.send({ t: 'move', from: d.ref, to: el.dataset.ref }); this.sel = el.dataset.ref; }
    else if (!el && !document.elementFromPoint(x, y)?.closest('#bagMenu .panel') && !d.ref.startsWith('s')) {
      const W = this.g.weapons, held = W.slot >= 1 && 'i' + (W.slot - 1) === d.ref;
      net.send({ t: 'drop', from: d.ref, mag: held ? W.clip?.mag : undefined }); // thrown out of the window: on the ground
      this.sel = null;
      this.g.sound.play('throw', { vol: 0.4 });
    }
    this.render();
  }

  // shift-click: hotbar <-> backpack, or into / out of the team chest when it is open
  quickMove(ref, it) {
    const h = this.h, free = (list, from, to) => { for (let i = from; i < to; i++) if (!list[i]) return i; return -1; };
    let to = null;
    if (ref.startsWith('s')) { const i = free(h.inv, 0, INV_SIZE); if (i >= 0) to = 'i' + i; }
    else if (ref.startsWith('a:')) { const i = free(h.inv, HOTBAR, INV_SIZE); if (i >= 0) to = 'i' + i; }
    else if (this.atChest) { const i = free(h.stash.items || [], 0, STASH_SIZE); if (i >= 0) to = 's' + i; }
    else if (it.kind === 'armor') to = 'a:' + ARMOR[it.id].slot;
    else { const n = +ref.slice(1), i = n < HOTBAR ? free(h.inv, HOTBAR, INV_SIZE) : free(h.inv, 0, HOTBAR); if (i >= 0) to = 'i' + i; }
    if (to) this.g.net.send({ t: 'move', from: ref, to });
  }

  // in-game cursor: called every frame while the window is open
  tick(vcur, held, shift) {
    if (!vcur) return;
    if (this.drag) { this.move(...vcur); if (!held) this.up(...vcur); }
  }

  dispose() {
    removeEventListener('mousedown', this.onDown, true);
    removeEventListener('mousemove', this.onMove);
    removeEventListener('mouseup', this.onUp);
    this.ghost.remove();
  }
}
