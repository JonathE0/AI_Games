// Zombie Holdout panels: the six-slot hotbar, the Core shop and the per-browser best-wave record. Pure HTML
// builders — holdout.js wires the buttons. (The inventory grid lives in inventory_ui.js.)
import { WEAPONS } from '/shared/weapons.js';
import { RARITY, AMMO, ITEMS, POWERUPS, SHOP, ARMOR, CLASSES, CLASS_IDS, SMITH, ATTACH, ATTACH_IDS, shopEntry, ammoCap, elementPrice } from '/shared/holdout.js';
import { ELEMENTS, ELEMENT_IDS } from '/shared/elements.js';
import { HOTBAR, TIERS, TIER_COLORS, ARMOR_SLOTS, magFor, itemName, tierCost } from '/shared/items.js';

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const btn = (label, data, cls = '', disabled = false) => `<button class="mini ${cls}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}${disabled ? ' disabled' : ''}>${label}</button>`;

// short label + border color for an inventory item (hotbar and grid share these)
export function itemLook(it) {
  if (!it) return { label: '', color: 'transparent' };
  if (it.kind === 'gun') return { label: WEAPONS[it.id]?.short || it.id, color: RARITY[it.r ?? 0].color, el: it.el ? ELEMENTS[it.el].color : null, tier: it.tier ?? 1 };
  if (it.kind === 'armor') return { label: ARMOR[it.id]?.name ?? it.id, color: TIER_COLORS[it.tier ?? 1], tier: it.tier ?? 1 };
  return { label: itemName(it), color: { throw: '#7fbf5a', heal: '#e05a5a', shield: '#5a9cff', trap: '#b8a58a', deploy: '#c9a24a', attach: '#9aa4ad' }[it.kind] ?? '#9aa4ad', n: it.n };
}

// ---------- hotbar ----------
export function hotbarHTML(h) {
  const W = h.g.weapons, slots = [], keys = h.hotkeys();
  for (let s = 1; s <= HOTBAR; s++) {
    const it = h.inv[s - 1], look = itemLook(it), a = it?.kind === 'gun' && W.ammo[it.uid], w = it?.kind === 'gun' && WEAPONS[it.id];
    let sub = '';
    if (w && w.cat !== 'melee') sub = `${a?.mag ?? 0}/${magFor(it, h.cls)} · ${W.reserveOf(w, a)}`;
    else if (it && it.kind !== 'gun' && it.kind !== 'armor') sub = `×${it.n ?? 1}`;
    else if (w) sub = 'melee';
    const tier = look.tier ? `<i class="tier" style="color:${TIER_COLORS[look.tier]}">${TIERS[look.tier].name}</i>` : '';
    const el = look.el ? `<i class="el" style="background:${look.el}"></i>` : '';
    slots.push(`<div class="hb${W.slot === s ? ' on' : ''}${it ? '' : ' empty'}" style="--rc:${look.color}"><b>${keys[s - 1]}</b>${tier}${el}<span>${esc(look.label)}</span><em>${sub}</em></div>`);
  }
  slots.push(`<div class="hb knife${W.slot === 0 ? ' on' : ''}"><b>${keys[HOTBAR]}</b><span>Harvest</span><em>knife</em></div>`);
  const th = h.activeThrow, heals = ['bandage', 'medkit', 'shield_s', 'shield'].reduce((n, id) => n + (h.items[id] || 0), 0);
  slots.push(`<div class="util"><span><b>T</b> ${th ? `${esc(ITEMS[th].name)} ×${h.items[th] || 0} <small>N: next</small>` : 'no throwables'}</span><span><b>H</b> heal ×${heals}</span><span><b>I</b> inventory</span></div>`);
  return slots.join('');
}

// ---------- shop at the Core ----------
function gunStats(w) {
  const dmg = w.pellets > 1 ? `${w.dmg}×${w.pellets}` : w.dmg;
  return `${dmg} dmg · ${w.rpm} rpm · ${w.mag} mag · ${AMMO[w.ammo].name.replace(' Ammo', '')}`;
}
function itemDesc(id) {
  const it = ITEMS[id];
  if (it.kind === 'heal') return `+${it.hp}% HP (up to ${it.cap}%) · ${it.time}s · also heals survivors`;
  if (it.kind === 'shield') return `+${it.sh} shield (up to ${it.cap}) · ${it.time}s`;
  if (it.kind === 'throw') return id === 'grenade' ? 'Big blast · T to throw' : id === 'molotov' ? 'Burning pool · T to throw' : 'Freezes zombies 4s · T to throw';
  return { spikes: 'Floor trap · build mode', darts: 'Wall trap · build mode', flame: 'Floor trap · build mode', turret: 'Auto machine gun · build mode', rturret: 'Rocket turret · build mode', campfire: 'Heals people nearby · build mode' }[id];
}
function armorDesc(id) {
  const a = ARMOR[id], bits = [`${a.def[1]} armor`];
  if (a.fire) bits.push(`${a.fire[1] * 100}% fire resist`);
  if (a.slow) bits.push(`${a.slow[1] * 100}% slow resist`);
  if (a.blind) bits.push(`${a.blind[1] * 100}% blind resist`);
  if (a.speed) bits.push(`+${a.speed[1] * 100}% speed`);
  return `${a.slot} · ${bits.join(' · ')}`;
}

export function buyHTML(h) {
  const money = h.payBank ? h.stash.money : h.g.me.money;
  const owned = new Set(h.inv.filter(it => it?.kind === 'gun').map(it => it.id));
  const classes = `<div class="buyBar classBar"><b>CLASS</b>${CLASS_IDS.map(id => `<button class="mini cls ${h.cls === id ? 'on' : ''}" data-cls="${id}" title="${esc(CLASSES[id].desc)}">${CLASSES[id].name}<small>${esc(CLASSES[id].desc)}</small></button>`).join('')}</div>`;
  const toolbar = classes + `<div class="buyBar">${btn(h.payBank ? `Paying from TEAM BANK ($${h.stash.money})` : `Paying from YOUR money · team bank $${h.stash.money}`, { bank: 1 }, h.payBank ? 'on' : '')}<span>Guns come Uncommon · elemental versions below a gun cost extra · tier II upgrades in your inventory (I) · chests and drops roll better</span></div>`;
  const cols = SHOP.map(([cat, ids]) => `<div class="buyCol"><h3>${cat.toUpperCase()}</h3>${ids.map(id => {
    const e = shopEntry(id);
    let sub, disabled = false, cls = '', name = e.name;
    if (e.kind === 'gun') { const w = WEAPONS[id]; sub = owned.has(id) ? 'OWNED' : gunStats(w); disabled = owned.has(id); cls = disabled ? 'owned' : ''; if (w.skin) name = `${w.name} | ${w.skin}`; }
    else if (e.kind === 'ammo') { const n = h.ammo[e.type] || 0, cap = ammoCap(e.type, h.cls); sub = `have ${n} / ${cap}`; disabled = n >= cap; }
    else if (e.kind === 'item') { const n = h.items[id] || 0, it = ITEMS[id]; sub = `${itemDesc(id)} · have ${n}`; disabled = n >= it.max * 2; }
    else if (e.kind === 'armor') { const on = h.armor[ARMOR[id].slot]?.id === id; sub = (on ? 'WEARING · ' : '') + armorDesc(id); }
    else { const on = h.buffLeft(id) > 0; sub = on ? 'ACTIVE' : POWERUPS[id].desc; disabled = on; cls = 'power'; }
    const poor = e.price > money;
    const card = `<button class="buyItem ${cls} ${poor ? 'poor' : ''}" data-id="${id}" ${disabled || poor ? 'disabled' : ''}><div class="n"><span>${esc(name)}</span><em>$${e.price}</em></div><div class="s">${esc(sub)}</div></button>`;
    if (e.kind !== 'gun') return card;
    const elRow = `<div class="elRow">${ELEMENT_IDS.map(el => {
      const total = e.price + elementPrice(id), elDisabled = disabled || total > money;
      return `<button class="elBuy" style="--ec:${ELEMENTS[el].color}" data-id="${id}" data-el="${el}" ${elDisabled ? 'disabled' : ''}>${ELEMENTS[el].name} $${total}</button>`;
    }).join('')}</div>`;
    return `<div class="buyItemWrap">${card}${elRow}</div>`;
  }).join('')}</div>`).join('');
  return toolbar + cols;
}

// ---------- the Blacksmith ----------
export function smithHTML(h) {
  const money = h.g.me.money, metal = h.mats.metal || 0, rows = [];
  const act = (label, data, ok = true, cls = '') => btn(label, data, cls, !ok);
  const guns = h.inv.filter(it => it?.kind === 'gun' && WEAPONS[it.id].cat !== 'melee');
  rows.push('<div class="smithCol"><h3>GUNS</h3>' + (guns.length ? guns.map(it => {
    const t = it.tier ?? 1, c = t < 3 ? tierCost(it, t + 1) : null;
    const forge = c ? act(`Forge tier ${TIERS[t + 1].name} · $${c.money}${c.metal ? ` + ${c.metal} metal` : ''}`, { op: 'forge', uid: it.uid }, money >= c.money && metal >= c.metal) : '<span class="muted">tier III</span>';
    const infuse = ELEMENT_IDS.map(el => act(ELEMENTS[el].name, { op: 'infuse', uid: it.uid, el }, it.el !== el && money >= SMITH.infuse.money && metal >= SMITH.infuse.metal, `el ${el}${it.el === el ? ' on' : ''}`)).join('');
    const fit = ATTACH_IDS.map(id => act(`${ATTACH[id].name} $${ATTACH[id].price}`, { op: 'fit', uid: it.uid, id }, it.att?.[ATTACH[id].slot] !== id && money >= ATTACH[id].price, it.att?.[ATTACH[id].slot] === id ? 'on' : '')).join('');
    return `<div class="smithItem" style="--rc:${RARITY[it.r ?? 0].color}"><b>${esc(itemName(it))}</b><div>${forge}</div><div><small>Infuse ($${SMITH.infuse.money} + ${SMITH.infuse.metal} metal)</small>${infuse}</div><div><small>Attachments</small>${fit}</div></div>`;
  }).join('') : '<span class="muted">No guns in your inventory</span>') + '</div>');
  const armor = [...ARMOR_SLOTS.map(s => h.armor[s]).filter(Boolean), ...h.inv.filter(it => it?.kind === 'armor')];
  const turrets = [...h.ents.defs.values()].filter(d => d.type === 'turret' || d.type === 'rturret');
  rows.push('<div class="smithCol"><h3>ARMOR</h3>' + (armor.length ? armor.map(it => {
    const t = it.tier ?? 1, c = t < 3 ? tierCost(it, t + 1) : null;
    return `<div class="smithItem" style="--rc:${TIER_COLORS[t]}"><b>${esc(itemName(it))}</b><div>${c ? act(`Forge tier ${TIERS[t + 1].name} · $${c.money}${c.metal ? ` + ${c.metal} metal` : ''}`, { op: 'forge', uid: it.uid }, money >= c.money && metal >= c.metal) : '<span class="muted">tier III</span>'}</div></div>`;
  }).join('') : '<span class="muted">No armor</span>') +
    '<h3>TURRETS</h3>' + (turrets.length ? turrets.map((d, i) => `<div class="smithItem"><b>${d.type === 'rturret' ? 'Rocket turret' : 'Auto turret'} #${i + 1}</b><div>${Object.entries(SMITH.turret).map(([up, u]) => {
      const lvl = d.mods?.[up] || 0, full = u.max && lvl >= u.max;
      return act(`${u.name}${u.max > 1 ? ` (${lvl}/${u.max})` : ''} $${u.price}`, { op: 'turret', def: d.id, up }, !full && money >= u.price, full ? 'on' : '');
    }).join('')}</div></div>`).join('') : '<span class="muted">No turrets placed</span>') + '</div>');
  return rows.join('');
}

// ---------- most waves survived (endless mode), per browser ----------
const KEY = 'fragline.holdout.best';
export function loadRecords() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
export function saveRecord(survived) {
  const all = loadRecords(), cur = all.endless?.survived >= 0 ? all.endless : null;
  const isNew = survived > 0 && (!cur || survived > cur.survived);
  if (isNew) { all.endless = { survived, at: Date.now() }; try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked */ } }
  return { isNew, best: isNew ? all.endless : cur };
}
export function recordText() {
  const b = loadRecords().endless;
  return b?.survived > 0 ? `Your record: ${b.survived} wave${b.survived === 1 ? '' : 's'} survived` : 'No record yet — how long can you hold?';
}
