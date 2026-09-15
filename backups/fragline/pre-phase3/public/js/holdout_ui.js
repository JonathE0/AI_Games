// Zombie Holdout panels: the five-slot hotbar, the Core shop, the backpack / team chest window and the
// per-browser best-wave record. Pure HTML builders — holdout.js wires the buttons.
import { WEAPONS } from '/shared/weapons.js';
import { RARITY, AMMO, AMMO_IDS, ITEMS, POWERUPS, SHOP, THROWABLES, HEALS, TRAPS, shopEntry } from '/shared/holdout.js';
import { MAT_IDS } from '/shared/build.js';

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const btn = (label, data, cls = '', disabled = false) => `<button class="mini ${cls}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}${disabled ? ' disabled' : ''}>${label}</button>`;

// ---------- hotbar ----------
export function hotbarHTML(h) {
  const W = h.g.weapons, slots = [];
  for (let s = 1; s <= 5; s++) {
    const it = W.slots[s], w = it && WEAPONS[it.w], a = it && W.ammo[it.uid];
    const color = it ? RARITY[it.r ?? 0].color : 'transparent';
    const ammo = !w ? '' : w.cat === 'melee' ? '' : `${a?.mag ?? 0} · ${W.reserveOf(w, a)}`;
    slots.push(`<div class="hb${W.slot === s ? ' on' : ''}${it ? '' : ' empty'}" style="--rc:${color}"><b>${s}</b><span>${w ? esc(w.short || w.name) : ''}</span><em>${ammo}</em></div>`);
  }
  slots.push(`<div class="hb knife${W.slot === 0 ? ' on' : ''}"><b>F</b><span>Harvest</span><em>knife</em></div>`);
  const th = h.activeThrow, heals = HEALS.reduce((n, id) => n + (h.items[id] || 0), 0);
  slots.push(`<div class="util"><span><b>T</b> ${th ? `${esc(ITEMS[th].name)} ×${h.items[th] || 0}` : 'no throwables'}</span><span><b>H</b> heal ×${heals}</span><span><b>I</b> backpack</span></div>`);
  return slots.join('');
}

// ---------- shop at the Core ----------
function gunStats(w) {
  const dmg = w.pellets > 1 ? `${w.dmg}×${w.pellets}` : w.dmg;
  return `${dmg} dmg · ${w.rpm} rpm · ${w.mag} mag · ${AMMO[w.ammo].name.replace(' Ammo', '')}`;
}
function itemDesc(id) {
  const it = ITEMS[id];
  if (it.kind === 'heal') return `+${it.hp} HP (up to ${it.cap}) · ${it.time}s`;
  if (it.kind === 'shield') return `+${it.sh} shield (up to ${it.cap}) · ${it.time}s`;
  if (it.kind === 'throw') return id === 'grenade' ? 'Big blast, press T' : id === 'molotov' ? 'Burning pool, press T' : 'Freezes zombies 4s, press T';
  return { spikes: 'Floor trap · build mode 4', darts: 'Wall trap · build mode 4', flame: 'Floor trap · build mode 4', turret: 'Auto machine gun · build mode 4', rturret: 'Rocket turret · build mode 4', campfire: 'Heals nearby · build mode 4' }[id];
}

export function buyHTML(h) {
  const money = h.payBank ? h.stash.money : h.g.me.money, owned = new Set(Object.values(h.g.weapons.slots).filter(Boolean).map(it => it.w));
  const toolbar = `<div class="buyBar">${btn(h.payBank ? `Paying from TEAM BANK ($${h.stash.money})` : `Paying from YOUR money · team bank $${h.stash.money}`, { bank: 1 }, h.payBank ? 'on' : '')}<span>Guns come Uncommon · chests and supply drops roll better</span></div>`;
  const cols = SHOP.map(([cat, ids]) => `<div class="buyCol"><h3>${cat.toUpperCase()}</h3>${ids.map(id => {
    const e = shopEntry(id);
    let sub, disabled = false, cls = '', name = e.name;
    if (e.kind === 'gun') { const w = WEAPONS[id]; sub = owned.has(id) ? 'OWNED' : gunStats(w); disabled = owned.has(id); cls = disabled ? 'owned' : ''; if (w.skin) name = `${w.name} | ${w.skin}`; }
    else if (e.kind === 'ammo') { const n = h.ammo[e.type] || 0, cap = AMMO[e.type].cap; sub = `have ${n} / ${cap}`; disabled = n >= cap; }
    else if (e.kind === 'item') { const n = h.items[id] || 0, it = ITEMS[id]; sub = `${itemDesc(id)} · have ${n}/${it.max}`; disabled = n >= it.max; }
    else { const on = h.buffLeft(id) > 0; sub = on ? 'ACTIVE' : POWERUPS[id].desc; disabled = on; cls = 'power'; }
    const poor = e.price > money;
    return `<button class="buyItem ${cls} ${poor ? 'poor' : ''}" data-id="${id}" ${disabled || poor ? 'disabled' : ''}><div class="n"><span>${esc(name)}</span><em>$${e.price}</em></div><div class="s">${esc(sub)}</div></button>`;
  }).join('')}</div>`).join('');
  return toolbar + cols;
}

// ---------- backpack + team chest ----------
export function bagHTML(h, atChest) {
  const s = h.stash, mine = [];
  const put = (cat, key, n, label) => atChest ? btn(label, { op: 'put', cat, key, n }) : '';
  const take = (cat, key, n, label, ok) => btn(label, { op: 'take', cat, key, n }, '', !ok);
  mine.push(`<h3>MONEY</h3><div class="bagRow"><span>$${h.g.me.money}</span>${put('money', '', 100, 'Pool $100')}${put('money', '', 500, 'Pool $500')}${put('money', '', h.g.me.money, 'Pool all')}</div>`);
  mine.push('<h3>MATERIALS</h3>' + MAT_IDS.map(m => `<div class="bagRow"><span><i class="sw ${m}"></i>${m} <b>${h.mats[m] || 0}</b></span>${put('mats', m, 10, '+10')}${put('mats', m, h.mats[m] || 0, 'All')}</div>`).join(''));
  mine.push('<h3>AMMO</h3>' + AMMO_IDS.map(t => `<div class="bagRow"><span><i class="sw" style="background:${AMMO[t].color}"></i>${AMMO[t].name} <b>${h.ammo[t] || 0}</b>/${AMMO[t].cap}</span>${put('ammo', t, AMMO[t].pack, `+${AMMO[t].pack}`)}</div>`).join(''));
  const items = Object.keys(ITEMS).filter(id => h.items[id] > 0);
  mine.push('<h3>ITEMS</h3>' + (items.length ? items.map(id => {
    const it = ITEMS[id];
    const use = it.kind === 'heal' || it.kind === 'shield' ? btn('Use', { use: id }) : it.kind === 'throw' ? btn(h.activeThrow === id ? 'Selected' : 'Select', { sel: id }, h.activeThrow === id ? 'on' : '') : '';
    return `<div class="bagRow"><span>${esc(it.name)} <b>×${h.items[id]}</b></span>${use}${put('items', id, 1, 'Share 1')}</div>`;
  }).join('') : '<div class="bagRow"><span class="muted">Nothing yet — shop at the Core, open chests, grab supply drops</span></div>'));
  let chest = '';
  if (atChest) {
    const rows = [`<h3>TEAM BANK</h3><div class="bagRow"><span>$${s.money}</span>${take('money', '', 100, 'Take $100', s.money > 0)}${take('money', '', s.money, 'Take all', s.money > 0)}</div>`];
    rows.push('<h3>MATERIALS</h3>' + MAT_IDS.map(m => `<div class="bagRow"><span><i class="sw ${m}"></i>${m} <b>${s.mats[m]}</b></span>${take('mats', m, 10, '+10', s.mats[m] > 0)}${take('mats', m, s.mats[m], 'All', s.mats[m] > 0)}</div>`).join(''));
    rows.push('<h3>AMMO</h3>' + AMMO_IDS.map(t => `<div class="bagRow"><span>${AMMO[t].name} <b>${s.ammo[t]}</b></span>${take('ammo', t, AMMO[t].pack, `+${AMMO[t].pack}`, s.ammo[t] > 0)}</div>`).join(''));
    const si = Object.keys(ITEMS).filter(id => s.items[id] > 0);
    rows.push('<h3>ITEMS</h3>' + (si.length ? si.map(id => `<div class="bagRow"><span>${esc(ITEMS[id].name)} <b>×${s.items[id]}</b></span>${take('items', id, 1, 'Take 1', true)}</div>`).join('') : '<div class="bagRow"><span class="muted">Empty</span></div>'));
    chest = `<div class="bagCol"><h2>TEAM CHEST</h2>${rows.join('')}</div>`;
  }
  return `<div class="bagCol"><h2>BACKPACK</h2>${mine.join('')}</div>${chest}`;
}

// ---------- most waves survived, per browser and difficulty ----------
const KEY = 'fragline.holdout.best';
export function loadRecords() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
export function saveRecord(diff, survived, win) {
  const all = loadRecords(), cur = all[diff]?.survived >= 0 ? all[diff] : null, score = survived + (win ? 0.5 : 0);
  const isNew = survived > 0 && (!cur || score > cur.survived + (cur.win ? 0.5 : 0));
  if (isNew) { all[diff] = { survived, win, at: Date.now() }; try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked */ } }
  return { isNew, best: isNew ? all[diff] : cur };
}
export function recordText() {
  const all = loadRecords(), parts = ['casual', 'normal', 'hard'].filter(d => all[d]?.survived >= 0).map(d => `${d} ${all[d].win ? 'WON' : `${all[d].survived} wave${all[d].survived === 1 ? '' : 's'}`}`);
  return parts.length ? `Most waves survived: ${parts.join(' · ')}` : 'No record yet — how long can you hold?';
}
