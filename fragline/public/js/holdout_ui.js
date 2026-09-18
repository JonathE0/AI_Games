// Zombie Holdout panels: the six-slot hotbar, the Core shop and the per-browser best-wave record. Pure HTML
// builders — holdout.js wires the buttons. (The inventory grid lives in inventory_ui.js.)
import { WEAPONS, BOSS_PERKS } from '/shared/weapons.js';
import { RARITY, AMMO, ITEMS, POWERUPS, SHOP, ARMOR, CLASSES, CLASS_IDS, SMITH, TURRET_TYPES, ATTACH, ATTACH_IDS, TEAM_UPS, TEAM_UP_IDS, CORE_UPS, CORE_UP_IDS, SHOP_RARITY, coreUpPrice, shopEntry, ammoCap, elementPrice, rarityCost, sellPrice } from '/shared/holdout.js';
import { ELEMENTS, ELEMENT_IDS } from '/shared/elements.js';
import { HOTBAR, INV_SIZE, SACK_SIZE, TIERS, TIER_COLORS, ARMOR_SLOTS, magFor, gunMult, itemName, tierCost } from '/shared/items.js';
import { gunIcon, gunGlyph, gunIconKind, uiIcon } from './icons.js';

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const btn = (label, data, cls = '', disabled = false) => `<button class="mini ${cls}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}${disabled ? ' disabled' : ''}>${label}</button>`;

// short label + border color for an inventory item (hotbar and grid share these)
export function itemLook(it) {
  if (!it) return { label: '', color: 'transparent' };
  if (it.kind === 'gun') return { label: WEAPONS[it.id]?.short || it.id, color: RARITY[it.r ?? 0].color, el: it.el ? ELEMENTS[it.el].color : null, tier: it.tier ?? 1, icon: gunIconKind(it.id) };
  if (it.kind === 'armor') return { label: ARMOR[it.id]?.name ?? it.id, color: TIER_COLORS[it.tier ?? 1], tier: it.tier ?? 1 };
  return { label: itemName(it), color: { throw: '#7fbf5a', heal: '#e05a5a', shield: '#5a9cff', adrenaline: '#ff7a5a', trap: '#b8a58a', deploy: '#c9a24a', attach: '#9aa4ad' }[it.kind] ?? '#9aa4ad', n: it.n };
}

// a small lock badge — shared by the inventory grid, the hotbar's HUD row and the Banker panel
const lockBadge = it => (it?.locked ? '<i class="lock" title="Locked — press L to unlock"></i>' : '');

// a colored item tile — shared by the inventory grid, the hotbar's HUD row and the Banker panel. The icon (if
// any) sits above the name so long names never overlap it — see .hasIcon in style.css.
export function slotHTML(ref, it, sel = false, extra = '') {
  const look = itemLook(it);
  const tier = look.tier ? `<i class="tier" style="color:${TIER_COLORS[look.tier]}">${TIERS[look.tier].name}</i>` : '';
  const el = look.el ? `<i class="el" style="background:${look.el}"></i>` : '';
  const n = look.n > 1 ? `<i class="n">${look.n}</i>` : '';
  const icon = look.icon ? `<div class="art">${gunGlyph(look.icon, look.color)}</div>` : '';
  const uid = it ? ` data-uid="${it.uid}"` : '';
  return `<div class="slot${it ? '' : ' empty'}${sel ? ' sel' : ''}${icon ? ' hasIcon' : ''}" data-ref="${ref}"${uid} style="--rc:${look.color}">${extra}${tier}${el}${lockBadge(it)}${icon}<span>${esc(look.label)}</span>${n}</div>`;
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
    const icon = look.icon ? `<div class="art">${gunGlyph(look.icon, look.color)}</div>` : '';
    slots.push(`<div class="hb${W.slot === s ? ' on' : ''}${it ? '' : ' empty'}" style="--rc:${look.color}"><b>${keys[s - 1]}</b>${tier}${el}${lockBadge(it)}${icon}<span>${esc(look.label)}</span><em>${sub}</em></div>`);
  }
  slots.push(`<div class="hb knife${W.slot === 0 ? ' on' : ''}"><b>${keys[HOTBAR]}</b><span>Harvest</span><em>knife</em></div>`);
  const th = h.activeThrow, heals = ['bandage', 'medkit', 'shield_s', 'shield'].reduce((n, id) => n + (h.items[id] || 0), 0);
  slots.push(`<div class="util"><span><b>T</b> ${th ? `${esc(ITEMS[th].name)} ×${h.items[th] || 0} <small>N: next</small>` : 'no throwables'}</span><span><b>H</b> heal ×${heals}</span><span><b>E</b>/<b>I</b> inventory</span></div>`);
  return slots.join('') + sackHTML(h);
}

// the 4-slot consumables sack, shown beside the hotbar
const SACK_KEYS = ['7', '8', '9', '0'];
function sackHTML(h) {
  return `<div class="sack">${Array.from({ length: SACK_SIZE }, (_, i) => {
    const it = h.sack[i], look = itemLook(it);
    return `<div class="hb sk${it ? '' : ' empty'}" style="--rc:${look.color}"><b>${SACK_KEYS[i]}</b>${lockBadge(it)}<span>${esc(look.label)}</span><em>${it ? `×${it.n ?? 1}` : ''}</em></div>`;
  }).join('')}</div>`;
}

// ---------- shop at the Core ----------
function gunStats(w) {
  const dmg = w.pellets > 1 ? `${w.dmg}×${w.pellets}` : w.dmg;
  const base = `${dmg} dmg · ${w.rpm} rpm · ${w.mag} mag · ${AMMO[w.ammo] ? AMMO[w.ammo].name.replace(' Ammo', '') : 'melee'}`;
  return w.boss ? `${base} · ${BOSS_PERKS[w.id]}` : base;
}
function itemDesc(id) {
  const it = ITEMS[id];
  if (it.kind === 'heal') return `+${it.hp}% HP (up to ${it.cap}%) · ${it.time}s · also heals survivors`;
  if (it.kind === 'shield') return `+${it.sh} shield (up to ${it.cap}) · ${it.time}s`;
  if (it.kind === 'adrenaline') return `Instant +${it.hp} HP (overflows to shield) · +${it.regen}/s for ${it.time}s · +${Math.round((it.dmgMult - 1) * 100)}% dmg · +${Math.round((it.speedMult - 1) * 100)}% speed`;
  if (it.kind === 'throw') return id === 'grenade' ? 'Big blast · T to throw' : id === 'molotov' ? 'Burning pool · T to throw' : 'Freezes zombies 4s · T to throw';
  return {
    spikes: 'Floor trap · build mode', darts: 'Wall trap · build mode', flame: 'Floor trap · build mode', campfire: 'Heals and recharges shields nearby · build mode',
    turret: 'Auto machine gun · build mode', rturret: 'Rocket turret · build mode', gturret: 'High fire rate, low damage, chews ammo · build mode',
    frturret: 'Chills and slows what it hits · build mode', flturret: 'Short-range fire cone · build mode', tesla: 'Arcs to nearby zombies · build mode',
    mortar: 'Long range splash, can\'t hit anything close · build mode',
  }[id];
}
function armorDesc(id) {
  const a = ARMOR[id], bits = [`${a.def[1]} armor`];
  if (a.fire) bits.push(`${a.fire[1] * 100}% fire resist`);
  if (a.slow) bits.push(`${a.slow[1] * 100}% slow resist`);
  if (a.blind) bits.push(`${a.blind[1] * 100}% blind resist`);
  if (a.speed) bits.push(`+${a.speed[1] * 100}% speed`);
  return `${a.slot} · ${bits.join(' · ')}`;
}

// Four tabs: the one-page shop, per-item upgrades, team powerups/upgrades, and the Core cannon. Selling
// moved to the Banker.
export const TABS = [['shop', 'SHOP', 'shop'], ['upgrades', 'UPGRADES', 'upgrades'], ['team', 'TEAM', 'team'], ['core', 'CORE', 'core']];
// One flat page: the SHOP categories from shared/holdout.js grouped under four banded section headers.
const SECTIONS = [
  ['GUNS', 'guns', ['Pistols & SMGs', 'Rifles', 'Shotguns & Heavy', 'Snipers']],
  ['SUPPLIES', 'supplies', ['Ammo', 'Throwables', 'Healing', 'Adrenaline']],
  ['BUILD', 'build', ['Traps', 'Turrets & Deployables']],
  ['ARMOR', 'armor', ['Armor']],
];

function shopCardHTML(id, h, money) {
  const e = shopEntry(id);
  let sub, disabled = false, cls = '', name = e.name;
  if (e.kind === 'gun') { const w = WEAPONS[id]; sub = gunStats(w); if (w.skin) name = `${w.name} | ${w.skin}`; }
  else if (e.kind === 'ammo') { const n = h.ammo[e.type] || 0, cap = ammoCap(e.type, h.cls); sub = `have ${n} / ${cap}`; disabled = n >= cap; }
  else if (e.kind === 'item') { const n = h.items[id] || 0, it = ITEMS[id]; sub = `${itemDesc(id)} · have ${n}`; disabled = n >= it.max * 2; }
  else if (e.kind === 'armor') { const on = h.armor[ARMOR[id].slot]?.id === id; sub = (on ? 'WEARING · ' : '') + armorDesc(id); }
  else { const on = h.buffLeft(id) > 0; sub = on ? 'ACTIVE' : POWERUPS[id].desc; disabled = on; cls = 'power'; }
  const poor = e.price > money;
  const icon = e.kind === 'gun' ? gunIcon(id, RARITY[SHOP_RARITY].color) : '';
  const card = `<button class="buyItem ${cls} ${poor ? 'poor' : ''}" data-id="${id}" ${disabled || poor ? 'disabled' : ''}><div class="n"><span>${icon}${esc(name)}</span><em>$${e.price}</em></div><div class="s">${esc(sub)}</div></button>`;
  if (e.kind !== 'gun') return card;
  const elRow = `<div class="elRow">${ELEMENT_IDS.map(el => {
    const total = e.price + elementPrice(id), elDisabled = disabled || total > money;
    return `<button class="elBuy" style="--ec:${ELEMENTS[el].color}" data-id="${id}" data-el="${el}" ${elDisabled ? 'disabled' : ''}>${ELEMENTS[el].name} $${total}</button>`;
  }).join('')}</div>`;
  return `<div class="buyItemWrap">${card}${elRow}</div>`;
}

// ---------- UPGRADES tab: rarity + tier on everything you own ----------
function tierBtnFor(it, h) {
  const t = it.tier ?? 1, money = h.g.me.money, metal = h.mats.metal || 0;
  if (t >= 3) return btn('Tier III', {}, '', true);
  if (t === 2) return btn('Tier III — at the Blacksmith', {}, '', true);
  const c = tierCost(it, 2);
  return btn(`Tier II $${c.money}`, { tierup: it.uid }, '', money < c.money || metal < c.metal);
}
function upgradeGunRow(it, h, bankMoney) {
  const cost = rarityCost(it);
  const rarityBtn = cost === null ? btn('Max rarity', {}, '', true) : btn(`Rarity → ${RARITY[(it.r ?? 0) + 1].name} $${cost}`, { rarity: it.uid }, '', cost > bankMoney);
  return `<div class="smithItem" style="--rc:${RARITY[it.r ?? 0].color}"><b>${esc(itemName(it))}</b><div>${rarityBtn}${tierBtnFor(it, h)}</div></div>`;
}
function upgradesHTML(h, bankMoney) {
  const guns = h.inv.filter(it => it?.kind === 'gun');
  const armor = [...ARMOR_SLOTS.map(s => h.armor[s]).filter(Boolean), ...h.inv.filter(it => it?.kind === 'armor')];
  return `<div class="buyCol wide"><h3>GUNS</h3>${guns.length ? guns.map(it => upgradeGunRow(it, h, bankMoney)).join('') : '<span class="muted">No guns</span>'}</div>
    <div class="buyCol wide"><h3>ARMOR</h3>${armor.length ? armor.map(it => `<div class="smithItem" style="--rc:${TIER_COLORS[it.tier ?? 1]}"><b>${esc(itemName(it))}</b><div>${tierBtnFor(it, h)}</div></div>`).join('') : '<span class="muted">No armor</span>'}</div>`;
}

// ---------- SHOP tab: one big page, section headers spanning the grid ----------
function shopHTML(h, money) {
  return SECTIONS.map(([label, icon, cats]) => {
    const ids = SHOP.filter(([cat]) => cats.includes(cat)).flatMap(([, list]) => list);
    return `<h3 class="sectionHead">${uiIcon(icon)}<span>${label}</span></h3>${ids.map(id => shopCardHTML(id, h, money)).join('')}`;
  }).join('');
}

// ---------- TEAM tab: timed powerups + permanent upgrades ----------
function teamUpCard(id, h, money) {
  const up = TEAM_UPS[id], level = h.teamUps?.[id] ?? 0, maxed = level >= 5, cost = maxed ? null : up.cost[level];
  const pips = Array.from({ length: 5 }, (_, i) => `<i class="pip ${i < level ? 'on' : ''}"></i>`).join('');
  const poor = !maxed && cost > money;
  return `<button class="buyItem ${poor ? 'poor' : ''}" data-teamup="${id}" ${maxed || poor ? 'disabled' : ''}><div class="n"><span>${esc(up.name)} <span class="pips">${pips}</span></span><em>${maxed ? 'MAX' : '$' + cost}</em></div><div class="s">${esc(up.desc)}</div></button>`;
}
function teamHTML(h, money) {
  const powerups = Object.keys(POWERUPS).map(id => shopCardHTML(id, h, money)).join('');
  const ups = TEAM_UP_IDS.map(id => teamUpCard(id, h, money)).join('');
  return `<div class="buyCol wide"><h3>TEAM POWERUPS</h3>${powerups}</div><div class="buyCol wide"><h3>TEAM UPGRADES</h3>${ups}</div>`;
}

// ---------- CORE tab: the Core cannon's upgrades, one purchase every five waves ----------
function coreCardHTML(id, h, money) {
  const u = CORE_UPS[id], level = h.coreUps?.[id] ?? 0, maxed = !!u.max && level >= u.max;
  const gateWave = 5 * (h.coreLevel ?? 0), gated = !maxed && (h.wave ?? 0) < gateWave;
  const price = coreUpPrice(h.coreLevel ?? 0);
  const pips = Array.from({ length: u.max ?? 5 }, (_, i) => `<i class="pip ${i < level ? 'on' : ''}"></i>`).join('');
  const poor = !maxed && !gated && price > money;
  const sub = maxed ? 'Maxed' : gated ? `Unlocks at wave ${gateWave}` : `${u.desc}${level ? ` · level ${level}` : ''}`;
  return `<button class="buyItem ${poor ? 'poor' : ''}" data-coreup="${id}" ${maxed || gated || poor ? 'disabled' : ''}><div class="n"><span>${esc(u.name)} <span class="pips">${pips}</span></span><em>${maxed ? 'MAX' : '$' + price}</em></div><div class="s">${esc(sub)}</div></button>`;
}
function coreHTML(h, money) {
  const ups = CORE_UP_IDS.map(id => coreCardHTML(id, h, money)).join('');
  return `<div class="buyCol wide"><h3>CORE CANNON · LEVEL ${h.coreLevel ?? 0}</h3><span style="color:var(--muted)">An auto-turret on the Core's roof · one upgrade every five waves</span>${ups}</div>`;
}

export function buyHTML(h) {
  const money = h.payBank ? h.stash.money : h.g.me.money;
  const tab = h.shopTab || 'shop';
  // kits can only be changed in the lobby/prep or in the break after a wave that's a multiple of 5
  const classLocked = h.phase === 'wave' || (h.phase === 'intermission' && h.wave % 5 !== 0);
  const classNote = h.phase === 'wave' ? 'Kits unlock between waves' : classLocked ? `Kits unlock after wave ${Math.ceil((h.wave + 1) / 5) * 5}` : '';
  const classes = `<div class="buyBar classBar${classLocked ? ' locked' : ''}"><b>CLASS</b>${CLASS_IDS.map(id => `<button class="mini cls ${h.cls === id ? 'on' : ''}" data-cls="${id}" title="${esc(CLASSES[id].desc)}" ${classLocked ? 'disabled' : ''}>${CLASSES[id].name}<small>${esc(CLASSES[id].desc)}</small></button>`).join('')}${classNote ? `<small class="classNote">${esc(classNote)}</small>` : ''}</div>`;
  const toolbar = classes + `<div class="buyBar">${btn(h.payBank ? `Paying from TEAM BANK ($${h.stash.money})` : `Paying from YOUR money · team bank $${h.stash.money}`, { bank: 1 }, h.payBank ? 'on' : '')}<span>Guns come Uncommon (buying a duplicate is fine) · elemental versions below a gun cost extra · chests and drops roll better · sell gear at the Banker</span></div>`;
  const tabs = `<div class="buyBar shopTabs">${TABS.map(([id, label, icon]) => `<button class="tab ${tab === id ? 'on' : ''}" data-tab="${id}">${uiIcon(icon)}<span>${label}</span></button>`).join('')}</div>`;
  let body;
  if (tab === 'upgrades') body = upgradesHTML(h, money);
  else if (tab === 'team') body = teamHTML(h, money);
  else if (tab === 'core') body = coreHTML(h, money);
  else body = shopHTML(h, money);
  return toolbar + tabs + body;
}

// ---------- the Banker: sell your gear (hotbar, backpack and sack), buy back the last sale ----------
function bankItem(h, ref) {
  const n = +ref.slice(1);
  return ref[0] === 'i' ? h.inv[n] : ref[0] === 'k' ? h.sack[n] : null;
}
function bankStatLine(it, h) {
  if (it.kind === 'gun') {
    const w = WEAPONS[it.id], dmg = Math.round(w.dmg * gunMult(it) * (h.cls === 'assault' ? 1.2 : 1));
    return `${dmg}${w.pellets > 1 ? `×${w.pellets}` : ''} dmg · ${w.rpm} rpm · ${magFor(it, h.cls)} mag`;
  }
  if (it.kind === 'armor') { const a = ARMOR[it.id], t = it.tier ?? 1; return `${a.slot} · ${a.def[t]} armor`; }
  if (it.kind === 'attach') return ATTACH[it.id].desc;
  return itemDesc(it.id);
}
export function bankHTML(h) {
  const keys = h.hotkeys(), money = h.g.me.money;
  const hot = Array.from({ length: HOTBAR }, (_, k) => slotHTML('i' + k, h.inv[k], h.bankSel === 'i' + k, `<b class="key">${keys[k]}</b>`)).join('');
  const back = Array.from({ length: INV_SIZE - HOTBAR }, (_, k) => slotHTML('i' + (HOTBAR + k), h.inv[HOTBAR + k], h.bankSel === 'i' + (HOTBAR + k))).join('');
  const sack = Array.from({ length: SACK_SIZE }, (_, k) => slotHTML('k' + k, h.sack[k], h.bankSel === 'k' + k)).join('');
  const it = h.bankSel && bankItem(h, h.bankSel);
  const sellBtn = it && (it.locked ? '<span class="muted">Locked — press L to unlock</span>' : `<button class="mini sellBtn" data-sell="${it.uid}">Sell for $${sellPrice(it)}</button>`);
  const info = it
    ? `<b style="color:${itemLook(it).color}">${esc(itemName(it))}</b><div class="s">${bankStatLine(it, h)}</div>${sellBtn}`
    : '<span class="muted">Click an item to inspect it · shift-click a tile to sell it instantly · hover a tile and press L to lock/unlock it.</span>';
  const bb = h.buyback ? `<div class="bankBB"><h3>BUY BACK</h3><div class="grid">${slotHTML('bb', h.buyback.item)}</div><button class="mini" data-buyback="1" ${h.buyback.price > money ? 'disabled' : ''}>${esc(itemName(h.buyback.item))} · $${h.buyback.price}</button></div>` : '';
  return `<div class="bank">
    <div class="bankMain">
      <h3>BACKPACK</h3><div class="grid">${back}</div>
      <h3>HOTBAR</h3><div class="grid hot">${hot}</div>
      <h3>SACK</h3><div class="grid sack">${sack}</div>
    </div>
    <div class="bankSide"><div class="invInfo">${info}</div>${bb}</div>
  </div>`;
}

// ---------- the Blacksmith ----------
export function smithHTML(h) {
  const money = h.g.me.money, metal = h.mats.metal || 0, rows = [];
  const act = (label, data, ok = true, cls = '') => btn(label, data, cls, !ok);
  const guns = h.inv.filter(it => it?.kind === 'gun' && WEAPONS[it.id].cat !== 'melee');
  rows.push('<div class="smithCol"><h3>GUNS</h3>' + (guns.length ? guns.map(it => {
    const t = it.tier ?? 1, c = t < 3 ? tierCost(it, t + 1) : null;
    const forge = c ? act(`Forge tier ${TIERS[t + 1].name} · $${c.money}${c.metal ? ` + ${c.metal} metal` : ''}`, { op: 'forge', uid: it.uid }, money >= c.money && metal >= c.metal) : '<span class="muted">tier III</span>';
    const els = it.els ?? (it.el ? [it.el] : []), infuseMetal = SMITH.infuse.metal * (1 + els.length);
    const infuse = ELEMENT_IDS.map(el => act(`${ELEMENTS[el].name} $${SMITH.infuse.money}+${infuseMetal}m`, { op: 'infuse', uid: it.uid, el }, !els.includes(el) && money >= SMITH.infuse.money && metal >= infuseMetal, `el ${el}${els.includes(el) ? ' on' : ''}`)).join('');
    const fit = ATTACH_IDS.map(id => act(`${ATTACH[id].name} $${ATTACH[id].price}`, { op: 'fit', uid: it.uid, id }, it.att?.[ATTACH[id].slot] !== id && money >= ATTACH[id].price, it.att?.[ATTACH[id].slot] === id ? 'on' : '')).join('');
    return `<div class="smithItem" style="--rc:${RARITY[it.r ?? 0].color}"><b>${esc(itemName(it))}</b><div>${forge}</div><div><small>Infuse — adds an element (money stays $${SMITH.infuse.money}, metal grows with each one already on it)</small>${infuse}</div><div><small>Attachments</small>${fit}</div></div>`;
  }).join('') : '<span class="muted">No guns in your inventory</span>') + '</div>');
  const armor = [...ARMOR_SLOTS.map(s => h.armor[s]).filter(Boolean), ...h.inv.filter(it => it?.kind === 'armor')];
  const turrets = [...h.ents.defs.values()].filter(d => TURRET_TYPES.includes(d.type));
  rows.push('<div class="smithCol"><h3>ARMOR</h3>' + (armor.length ? armor.map(it => {
    const t = it.tier ?? 1, c = t < 3 ? tierCost(it, t + 1) : null;
    return `<div class="smithItem" style="--rc:${TIER_COLORS[t]}"><b>${esc(itemName(it))}</b><div>${c ? act(`Forge tier ${TIERS[t + 1].name} · $${c.money}${c.metal ? ` + ${c.metal} metal` : ''}`, { op: 'forge', uid: it.uid }, money >= c.money && metal >= c.metal) : '<span class="muted">tier III</span>'}</div></div>`;
  }).join('') : '<span class="muted">No armor</span>') +
    '<h3>TURRETS</h3>' + (turrets.length ? turrets.map((d, i) => `<div class="smithItem"><b>${ITEMS[d.type]?.name ?? d.type} #${i + 1}</b><div>${Object.entries(SMITH.turret).map(([up, u]) => {
      const lvl = d.mods?.[up] || 0, price = up === 'ammo' ? u.price : Math.round(u.price * 1.5 ** lvl);
      return act(`${u.name}${up !== 'ammo' && lvl ? ` (Lv ${lvl})` : ''} $${price}`, { op: 'turret', def: d.id, up }, money >= price);
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
