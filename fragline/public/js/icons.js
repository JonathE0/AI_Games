// Small inline-SVG glyphs: one per weapon category (plus a few generic ones for shop UI chrome). Pure
// string builders — callers drop the markup into innerHTML and color it via the `color` arg (currentColor).
import { WEAPONS } from '/shared/weapons.js';

// Which glyph a gun uses. The minigun and the shockwave blaster get their own silhouette even though they
// share a `cat` with rifles/shotguns.
export function weaponIconKind(w) {
  if (!w) return 'pistol';
  if (w.model === 'minigun') return 'minigun';
  if (w.model === 'kinetic') return 'shockwave';
  return w.cat === 'melee' ? 'melee' : (w.cat || 'pistol');
}
export const gunIconKind = id => weaponIconKind(WEAPONS[id]);

// Each glyph is a flat silhouette on a 32x32 grid, built from rects/polygons/circles only (cheap, no path
// arithmetic to get wrong). currentColor lets the caller tint it per-rarity with a `color:` style.
const GUN_GLYPHS = {
  pistol: '<rect x="4" y="11" width="20" height="5"/><rect x="24" y="12" width="4" height="3"/><rect x="9" y="16" width="6" height="10"/>',
  smg: '<rect x="3" y="11" width="22" height="6"/><rect x="25" y="12" width="5" height="3"/><rect x="9" y="17" width="5" height="10"/><rect x="17" y="17" width="4" height="7"/>',
  rifle: '<rect x="2" y="13" width="26" height="3"/><rect x="14" y="10" width="10" height="7"/><rect x="24" y="11" width="6" height="5"/><rect x="16" y="17" width="5" height="11"/><rect x="3" y="9" width="2" height="4"/>',
  shotgun: '<rect x="2" y="13" width="26" height="4"/><rect x="9" y="17" width="8" height="4"/><rect x="24" y="12" width="6" height="6"/><rect x="17" y="17" width="4" height="8"/>',
  sniper: '<rect x="1" y="14" width="28" height="2"/><rect x="18" y="11" width="8" height="6"/><rect x="14" y="6" width="10" height="3"/><rect x="16" y="9" width="2" height="3"/><rect x="21" y="9" width="2" height="3"/><rect x="26" y="12" width="5" height="5"/><rect x="21" y="17" width="3" height="6"/>',
  launcher: '<rect x="2" y="9" width="26" height="10"/><rect x="24" y="19" width="6" height="4"/><rect x="14" y="19" width="4" height="6"/>',
  minigun: '<rect x="2" y="10" width="3" height="10"/><rect x="6" y="10" width="3" height="10"/><rect x="10" y="10" width="3" height="10"/><rect x="12" y="12" width="12" height="7"/><rect x="22" y="18" width="8" height="8"/><rect x="14" y="19" width="4" height="6"/>',
  shockwave: '<circle cx="9" cy="16" r="7"/><rect x="13" y="13" width="14" height="6"/><rect x="21" y="17" width="4" height="8"/>',
  melee: '<rect x="14" y="2" width="4" height="20" transform="rotate(45 16 16)"/><rect x="12" y="21" width="8" height="9" rx="1" transform="rotate(45 16 16)"/>',
};

// Generic UI glyphs for the shop tabs and section banners.
const UI_GLYPHS = {
  shop: '<polygon points="9,11 23,11 26,27 6,27"/><path d="M12 11a4 4 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="2"/>',
  upgrades: '<polygon points="16,3 27,15 20,15 20,29 12,29 12,15 5,15"/>',
  team: '<circle cx="11" cy="10" r="5"/><circle cx="22" cy="12" r="4"/><path d="M2 28c0-7 4-11 9-11s9 4 9 11z"/><path d="M15 28c0-6 3.5-9.5 8-9.5s8 3.5 8 9.5z" opacity="0.8"/>',
  core: '<polygon points="16,3 27,10 27,22 16,29 5,22 5,10"/><circle cx="16" cy="16" r="5" fill="#12171e"/>',
  guns: GUN_GLYPHS.rifle,
  supplies: '<path d="M13 4h6v9h9v6h-9v9h-6v-9H4v-6h9z"/>',
  build: '<rect x="4" y="4" width="14" height="8" rx="1"/><rect x="13" y="10" width="5" height="20" rx="1"/>',
  armor: '<polygon points="16,3 27,7 27,17 16,30 5,17 5,7"/>',
};

const svg = (body, size, view = 32) =>
  `<svg class="gicon" viewBox="0 0 ${view} ${view}" width="${size}" height="${size}" fill="currentColor" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

// A gun icon in a given rarity/tier color — wrap in a colored <i> since currentColor needs an ancestor color.
export function gunIcon(id, color, size = '1.15em') {
  return `<i class="gicon" style="color:${color}">${svg(GUN_GLYPHS[gunIconKind(id)] || GUN_GLYPHS.pistol, size)}</i>`;
}
export function gunGlyph(kind, color, size = '1.15em') {
  return `<i class="gicon" style="color:${color}">${svg(GUN_GLYPHS[kind] || GUN_GLYPHS.pistol, size)}</i>`;
}
export function uiIcon(kind, size = '1.5em') {
  return `<i class="gicon" style="color:inherit">${svg(UI_GLYPHS[kind] || '', size)}</i>`;
}
