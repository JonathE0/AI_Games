// Zombie Holdout panels: the six-slot hotbar, the Core shop and the per-browser best-wave record. Pure HTML
// builders — holdout.js wires the buttons. (The inventory grid lives in inventory_ui.js.)
import { WEAPONS, BOSS_PERKS } from '/shared/weapons.js';
import { RARITY, AMMO, ITEMS, POWERUPS, SHOP, ARMOR, CLASSES, CLASS_IDS, SMITH, TURRET_TYPES, TURRET_EL, DEFENSES, GUN_MODS, turretMul, turretUpPrice, ATTACH, ATTACH_IDS, TEAM_UPS, TEAM_UP_IDS, CORE_UPS, CORE_UP_IDS, SHOP_RARITY, KATANA, adrenCarry, coreUpPrice, shopEntry, ammoCap, elementPrice, rarityCost, sellPrice } from '/shared/holdout.js';
import { ELEMENTS, ELEMENT_IDS } from '/shared/elements.js';
import { HOTBAR, INV_SIZE, SACK_SIZE, TIERS, TIER_COLORS, ARMOR_SLOTS, MASTERY, magFor, gunMult, itemName, tierCost, masteryLevel, milestoneBlock, hotbarFor } from '/shared/items.js';
import { gunIcon, gunGlyph, gunIconKind, uiIcon } from './icons.js';

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const btn = (label, data, cls = '', disabled = false) => `<button class="mini ${cls}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}${disabled ? ' disabled' : ''}>${label}</button>`;

// short label + border color for an inventory item (hotbar and grid share these)
export function itemLook(it) {
  if (!it) return { label: '', color: 'transparent' };
  if (it.kind === 'gun') return { label: WEAPONS[it.id]?.short || it.id, color: RARITY[it.r ?? 0].color, el: it.el ? ELEMENTS[it.el].color : null, tier: it.id === 'katana' ? 0 : it.tier ?? 1, icon: gunIconKind(it.id), mas: masteryLevel(it) };
  if (it.kind === 'armor') return { label: ARMOR[it.id]?.name ?? it.id, color: TIER_COLORS[it.tier ?? 1], tier: it.tier ?? 1 };
  return { label: itemName(it), color: { throw: '#7fbf5a', adrenaline: '#ff7a5a', trap: '#b8a58a', deploy: '#c9a24a', attach: '#9aa4ad' }[it.kind] ?? '#9aa4ad', n: it.n };
}

// a small lock badge — shared by the inventory grid, the hotbar's HUD row and the Banker panel
const lockBadge = (it, key = 'L') => (it?.locked ? `<i class="lock" title="Locked — press ${key} to unlock"></i>` : '');
// a gun's weapon-mastery level (M1-M8), same places
const masBadge = look => (look.mas ? `<i class="mas" title="Mastery ${look.mas}">M${look.mas}</i>` : '');
// weapon mastery, spelled out: level, kills and the next level's kill count
export function masteryText(it) {
  const lvl = masteryLevel(it), next = MASTERY[lvl];
  return `Mastery ${lvl} · ${it.kills || 0} kills${next === undefined ? ' (max)' : ` (level ${lvl + 1} at ${next})`}`;
}

// a colored item tile — shared by the inventory grid, the hotbar's HUD row and the Banker panel. The icon (if
// any) sits above the name so long names never overlap it — see .hasIcon in style.css. lockKey: the bound
// flashlight/lock key, for the lock badge's tooltip.
export function slotHTML(ref, it, sel = false, extra = '', lockKey = 'L') {
  const look = itemLook(it);
  const tier = look.tier ? `<i class="tier" style="color:${TIER_COLORS[look.tier]}">${TIERS[look.tier].name}</i>` : '';
  const el = look.el ? `<i class="el" style="background:${look.el}"></i>` : '';
  const n = look.n > 1 ? `<i class="n">${look.n}</i>` : '';
  const icon = look.icon ? `<div class="art">${gunGlyph(look.icon, look.color)}</div>` : '';
  const uid = it ? ` data-uid="${it.uid}"` : '';
  return `<div class="slot${it ? '' : ' empty'}${sel ? ' sel' : ''}${icon ? ' hasIcon' : ''}" data-ref="${ref}"${uid} style="--rc:${look.color}">${extra}${tier}${masBadge(look)}${el}${lockBadge(it, lockKey)}${icon}<span>${esc(look.label)}</span>${n}</div>`;
}

// ---------- hotbar ----------
export function hotbarHTML(h) {
  const W = h.g.weapons, slots = [], keys = h.hotkeys();
  for (let s = 1; s <= hotbarFor(h.cls); s++) { // the Ronin only has 3
    const it = h.inv[s - 1], look = itemLook(it), a = it?.kind === 'gun' && W.ammo[it.uid], w = it?.kind === 'gun' && WEAPONS[it.id];
    let sub = '';
    if (w && w.cat !== 'melee') sub = `${a?.mag ?? 0}/${magFor(it, h.cls)} · ${W.reserveOf(w, a)}`;
    else if (it && it.kind !== 'gun' && it.kind !== 'armor') sub = `×${it.n ?? 1}`;
    else if (w) sub = 'melee';
    const tier = look.tier ? `<i class="tier" style="color:${TIER_COLORS[look.tier]}">${TIERS[look.tier].name}</i>` : '';
    const el = look.el ? `<i class="el" style="background:${look.el}"></i>` : '';
    const icon = look.icon ? `<div class="art">${gunGlyph(look.icon, look.color)}</div>` : '';
    slots.push(`<div class="hb${W.slot === s ? ' on' : ''}${it ? '' : ' empty'}" style="--rc:${look.color}"><b>${keys[s - 1]}</b>${tier}${masBadge(look)}${el}${lockBadge(it, h.key('flashlight'))}${icon}<span>${esc(look.label)}</span><em>${sub}</em></div>`);
  }
  slots.push(`<div class="hb knife${W.slot === 0 ? ' on' : ''}"><b>${keys[HOTBAR]}</b><span>Harvest</span><em>knife</em></div>`);
  const th = h.activeThrow;
  slots.push(`<div class="util"><span><b>${h.key('throw')}</b> ${th ? `${esc(ITEMS[th].name)} ×${h.items[th] || 0} <small>${h.key('nextThrow')}: next</small>` : 'no throwables'}</span><span><b>${h.key('backpack')}</b> inventory</span></div>`);
  return slots.join('') + sackHTML(h);
}

// the 4-slot consumables sack, shown beside the hotbar
function sackHTML(h) {
  return `<div class="sack">${Array.from({ length: SACK_SIZE }, (_, i) => {
    const it = h.sack[i], look = itemLook(it);
    return `<div class="hb sk${it ? '' : ' empty'}" style="--rc:${look.color}"><b>${h.key('sack' + (i + 1))}</b>${lockBadge(it, h.key('flashlight'))}<span>${esc(look.label)}</span><em>${it ? `×${it.n ?? 1}` : ''}</em></div>`;
  }).join('')}</div>`;
}

// ---------- shop at the Core ----------
function gunStats(w) {
  const dmg = w.pellets > 1 ? `${w.dmg}×${w.pellets}` : w.dmg;
  const base = `${dmg} dmg · ${w.rpm} rpm · ${w.mag} mag · ${AMMO[w.ammo] ? AMMO[w.ammo].name.replace(' Ammo', '') : 'melee'}`;
  return w.boss ? `${base} · ${BOSS_PERKS[w.id]}` : base;
}
export function itemDesc(id, throwKey = 'T') {
  const it = ITEMS[id];
  if (it.kind === 'adrenaline') return `Instant +${it.hp} HP and +${it.sh} shield · +${it.regen} HP/s for ${it.time}s`;
  if (it.kind === 'throw') return id === 'grenade' ? `Big blast · ${throwKey} to throw` : id === 'molotov' ? `Burning pool · ${throwKey} to throw`
    : `Blizzard: an icy field for ${it.time}s slows zombies ${it.slow * 100}% · ${it.freezeAfter}s inside freezes them ${it.freeze}s (+${Math.round((it.brittle - 1) * 100)}% damage) · ${throwKey} to throw`;
  return `${{
    spikes: 'Floor trap', darts: 'Wall trap', flame: 'Floor trap', campfire: 'Heals and recharges shields nearby',
    turret: 'Auto machine gun', rturret: 'Rocket turret', gturret: 'High fire rate, low damage, chews ammo',
    frturret: 'Chills and slows what it hits', flturret: 'Short-range fire cone', tesla: 'Arcs to nearby zombies',
    mortar: 'Long range splash, can\'t hit anything close',
  }[id]} · place with your ${it.kind === 'trap' ? 'trap' : 'turret'} key`;
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
  ['SUPPLIES', 'supplies', ['Ammo', 'Throwables', 'Adrenaline']],
  ['BUILD', 'build', ['Traps', 'Turrets & Deployables']],
  ['ARMOR', 'armor', ['Armor']],
];

function shopCardHTML(id, h, money) {
  const e = shopEntry(id);
  let sub, disabled = false, cls = '', name = e.name;
  if (e.kind === 'gun') { const w = WEAPONS[id]; sub = gunStats(w); if (w.skin) name = `${w.name} | ${w.skin}`; }
  else if (e.kind === 'ammo') { const n = h.ammo[e.type] || 0, cap = ammoCap(e.type, h.cls); sub = `have ${n} / ${cap}`; disabled = n >= cap; }
  else if (e.kind === 'item') { const n = h.items[id] || 0, it = ITEMS[id], cap = id === 'adrenaline' ? adrenCarry(h.cls) : it.max * 2; sub = `${itemDesc(id, h.key('throw'))} · have ${n}`; disabled = n >= cap; }
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
  const t = it.tier ?? 1, money = h.g.me.money, zink = h.mats.zink || 0;
  if (t >= 3) return btn(`Tier ${TIERS[t].name}`, {}, '', true);
  if (t === 2) return btn('Tier III — at the Blacksmith', {}, '', true);
  const c = tierCost(it, 2);
  return btn(`Tier II $${c.money}`, { tierup: it.uid }, '', money < c.money || zink < c.zink);
}
function upgradeGunRow(it, h, bankMoney) {
  const cost = rarityCost(it);
  const rarityBtn = cost === null ? btn('Max rarity', {}, '', true) : btn(`Rarity → ${RARITY[(it.r ?? 0) + 1].name} $${cost}`, { rarity: it.uid }, '', cost > bankMoney);
  return `<div class="smithItem" style="--rc:${RARITY[it.r ?? 0].color}"><b>${esc(itemName(it))}</b><div>${rarityBtn}${tierBtnFor(it, h)}</div></div>`;
}
function upgradesHTML(h, bankMoney) {
  const guns = h.inv.filter(it => it?.kind === 'gun' && it.id !== 'katana'); // the katana grows at the Blacksmith
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
  return itemDesc(it.id, h.key('throw'));
}
export function bankHTML(h) {
  const keys = h.hotkeys(), money = h.g.me.money, lockKey = h.key('flashlight');
  const hot = Array.from({ length: hotbarFor(h.cls) }, (_, k) => slotHTML('i' + k, h.inv[k], h.bankSel === 'i' + k, `<b class="key">${keys[k]}</b>`, lockKey)).join('');
  const back = Array.from({ length: INV_SIZE - HOTBAR }, (_, k) => slotHTML('i' + (HOTBAR + k), h.inv[HOTBAR + k], h.bankSel === 'i' + (HOTBAR + k), '', lockKey)).join('');
  const sack = Array.from({ length: SACK_SIZE }, (_, k) => slotHTML('k' + k, h.sack[k], h.bankSel === 'k' + k, '', lockKey)).join('');
  const it = h.bankSel && bankItem(h, h.bankSel);
  const sellBtn = it && (it.id === 'katana' ? '<span class="muted">The Ronin\'s katana is bound to him</span>' : it.locked ? `<span class="muted">Locked — press ${lockKey} to unlock</span>` : `<button class="mini sellBtn" data-sell="${it.uid}">Sell for $${sellPrice(it)}</button>`);
  const info = it
    ? `<b style="color:${itemLook(it).color}">${esc(itemName(it))}</b><div class="s">${bankStatLine(it, h)}</div>${sellBtn}`
    : `<span class="muted">Click an item to inspect it · shift-click a tile to sell it instantly · hover a tile and press ${lockKey} to lock/unlock it.</span>`;
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
// one turret's upgrades under its current numbers — the Blacksmith lists every turret, the "Upgrade turret" key just one
function turretHTML(d, label, money) {
  const md = d.mods ?? {}, def = DEFENSES[d.type], rate = (def.rate ?? 1 / def.tick) * turretMul(md, 'rate');
  const stats = `${Math.round(def.dmg * turretMul(md, 'dmg'))} dmg · ${Math.round(def.range * turretMul(md, 'range'))} m · ${rate.toFixed(rate < 1 ? 2 : 1)}/s · ${Math.round(def.ammo * turretMul(md, 'cap'))} ammo · ${Math.round(def.hp * turretMul(md, 'plate'))} HP${md.inc ? ' · incendiary' : md.frost ? ' · frost' : ''}`;
  const ups = Object.entries(SMITH.turret).filter(([up]) => !(TURRET_EL[d.type] && (up === 'inc' || up === 'frost'))).map(([up, u]) => {
    const lvl = md[up] || 0, price = turretUpPrice(up, md), fitted = (up === 'inc' || up === 'frost') && lvl > 0;
    return btn(`${u.name}${u.per && lvl ? ` (Lv ${lvl})` : ''} ${fitted ? '· fitted' : `$${price}`}`, { op: 'turret', def: d.id, up }, fitted ? 'on' : '', fitted || money < price);
  }).join('');
  return `<div class="smithItem"><b>${esc(label)}</b><small>${stats}</small><div>${ups}</div></div>`;
}

// A gun's wave milestones, every one listed with what it needs; a greyed-out one says why right after it.
function milestonesHTML(it, h, money, zink) {
  const w = WEAPONS[it.id], bullets = w.cat !== 'melee' && !w.projectile, mods = it.mods ?? [];
  return Object.entries(SMITH.ups).filter(([id]) => bullets || !(GUN_MODS[id] || id === 'slot2')).map(([id, u]) => {
    const why = milestoneBlock(id, it, h.wave ?? 0, money, zink), on = why === 'Already fitted' || why === 'Already toxic' || why.startsWith('Already tier');
    const swap = GUN_MODS[id] && !why && mods.length >= (it.modSlots ?? 1) ? ` (replaces ${GUN_MODS[mods[0]].name})` : '';
    return btn(`${u.name} · M${u.mastery} · $${u.money} + ${u.zink}z${swap}`, { op: 'mile', uid: it.uid, id }, `mile${on ? ' on' : ''}${id === 'toxic' ? ' el toxic' : ''}`, !!why) + (why ? `<small class="why">${esc(why)}</small>` : '');
  }).join('');
}

// the Zinkonium Katana's numbers and upgrades, spelled out (the inventory and the Blacksmith)
export function katanaText(it) {
  const ku = it.ku ?? {}, e = 1 + KATANA.edge * (ku.edge || 0), dmg = n => Math.round(n * e);
  const got = Object.entries(SMITH.katana).filter(([id, u]) => (u.edge ? ku.edge === u.edge : id === 'elem' ? it.el : ku[id])).map(([, u]) => u.name);
  return `${KATANA.combo.map(s => dmg(s.dmg)).join(' / ')} combo · Fire Strike ${dmg(KATANA.strike.dmg)} · dash ${dmg(KATANA.dash.dmg)} · every hit bleeds, crits ×${KATANA.crit} from behind${got.length ? ` · ${got.join(', ')}` : ''}`;
}

// The katana's own tree (SMITH.katana): every upgrade with what it does and needs; a greyed-out one says why.
// Elemental Edge has a button per element — picking another one later costs again.
function katanaHTML(it, wave, money, zink) {
  const one = (id, u, el) => {
    const why = milestoneBlock(id, it, wave, money, zink, el), on = el ? it.el === el : why === 'Already forged';
    const label = `${u.name}${el ? `: ${ELEMENTS[el].name}` : ''} · M${u.mastery} · $${u.money} + ${u.zink}z`;
    return btn(label, { op: 'mile', uid: it.uid, id, ...(el ? { el } : {}) }, `mile${on ? ' on' : ''}${el ? ` el ${el}` : ''}`, !!why) + (why && !on ? `<small class="why">${esc(why)}</small>` : '');
  };
  const rows = Object.entries(SMITH.katana).map(([id, u]) => `<div>${id === 'elem' ? KATANA.els.map(el => one(id, u, el)).join('') : one(id, u)}<small>${esc(u.desc)}${u.wave ? ` · wave ${u.wave}` : ''}</small></div>`).join('');
  return `<div class="smithCol wide"><h3>KATANA</h3><div class="smithItem" style="--rc:#5ee6d0"><b>${esc(itemName(it))}</b><small>${masteryText(it)} · ${katanaText(it)}</small><small>Each upgrade needs the katana's mastery (M — kills made with it), money, Zinkonium and the wave reached (${wave})</small>${rows}</div></div>`;
}

export function smithHTML(h) {
  const money = h.g.me.money, zink = h.mats.zink || 0, rows = [], wave = h.wave ?? 0;
  if (h.smithTurret) { // opened with the "Upgrade turret" key
    const d = h.ents.defs.get(h.smithTurret);
    return `<div class="smithCol wide"><h3>TURRET</h3>${d ? turretHTML(d, ITEMS[d.type]?.name ?? d.type, money) : '<span class="muted">That turret is gone</span>'}</div>`;
  }
  const act = (label, data, ok = true, cls = '') => btn(label, data, cls, !ok);
  const kat = h.inv.find(it => it?.id === 'katana');
  if (kat) rows.push(katanaHTML(kat, wave, money, zink));
  const guns = h.inv.filter(it => it?.kind === 'gun' && WEAPONS[it.id].cat !== 'melee');
  const byWave = {};
  for (const u of Object.values(SMITH.ups)) (byWave[u.wave] ??= []).push(u.name);
  const sched = Object.entries(byWave).map(([wv, names]) => `<span class="${wave >= wv ? 'on' : ''}">Wave ${wv}: ${names.join(', ')}</span>`).join('');
  rows.push(`<div class="smithCol"><h3>GUNS</h3><div class="miles"><small>Milestones open every 5 waves (you've reached wave ${wave}) and need the gun's mastery (M) — kills made with it:</small>${sched}</div>` + (guns.length ? guns.map(it => {
    const t = it.tier ?? 1, c = t < 3 ? tierCost(it, t + 1) : null;
    const forge = c ? act(`Forge tier ${TIERS[t + 1].name} · $${c.money}${c.zink ? ` + ${c.zink} Zinkonium` : ''}`, { op: 'forge', uid: it.uid }, money >= c.money && zink >= c.zink) : `<span class="muted">tier ${TIERS[t].name}${t < 5 ? ' — the next tier is a milestone' : ''}</span>`;
    const els = it.els ?? (it.el ? [it.el] : []), infuseZink = SMITH.infuse.zink * (1 + els.length);
    const infuse = ELEMENT_IDS.map(el => act(`${ELEMENTS[el].name} $${SMITH.infuse.money}+${infuseZink}z`, { op: 'infuse', uid: it.uid, el }, !els.includes(el) && money >= SMITH.infuse.money && zink >= infuseZink, `el ${el}${els.includes(el) ? ' on' : ''}`)).join('');
    const fit = ATTACH_IDS.map(id => act(`${ATTACH[id].name} $${ATTACH[id].price}`, { op: 'fit', uid: it.uid, id }, it.att?.[ATTACH[id].slot] !== id && money >= ATTACH[id].price, it.att?.[ATTACH[id].slot] === id ? 'on' : '')).join('');
    const mods = it.mods?.length ? it.mods.map(id => GUN_MODS[id].name).join(', ') : 'none';
    return `<div class="smithItem" style="--rc:${RARITY[it.r ?? 0].color}"><b>${esc(itemName(it))}</b><small>${masteryText(it)} · mods: ${mods} (${it.modSlots ?? 1} slot${(it.modSlots ?? 1) > 1 ? 's' : ''})</small><div>${forge}</div><div><small>Infuse — adds an element (money stays $${SMITH.infuse.money}, Zinkonium grows with each one already on it)</small>${infuse}</div><div><small>Attachments</small>${fit}</div><div><small>Milestones</small>${milestonesHTML(it, h, money, zink)}</div></div>`;
  }).join('') : '<span class="muted">No guns in your inventory</span>') + '</div>');
  const armor = [...ARMOR_SLOTS.map(s => h.armor[s]).filter(Boolean), ...h.inv.filter(it => it?.kind === 'armor')];
  const turrets = [...h.ents.defs.values()].filter(d => TURRET_TYPES.includes(d.type));
  rows.push('<div class="smithCol"><h3>ARMOR</h3>' + (armor.length ? armor.map(it => {
    const t = it.tier ?? 1, c = t < 3 ? tierCost(it, t + 1) : null;
    return `<div class="smithItem" style="--rc:${TIER_COLORS[t]}"><b>${esc(itemName(it))}</b><div>${c ? act(`Forge tier ${TIERS[t + 1].name} · $${c.money}${c.zink ? ` + ${c.zink} Zinkonium` : ''}`, { op: 'forge', uid: it.uid }, money >= c.money && zink >= c.zink) : '<span class="muted">tier III</span>'}</div></div>`;
  }).join('') : '<span class="muted">No armor</span>') +
    '<h3>TURRETS</h3>' + (turrets.length ? turrets.map((d, i) => turretHTML(d, `${ITEMS[d.type]?.name ?? d.type} #${i + 1}`, money)).join('') : '<span class="muted">No turrets placed</span>') + '</div>');
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
