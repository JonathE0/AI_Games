// Map registry: collision/bullet boxes and spawns per map id (used by modes.js `map`).
import { MAP_BOXES, SPAWNS } from './map.js';
import { LAKE_BOXES, LAKE_SPAWNS } from './lake.js';
import { OUTPOST_STATIC, OUTPOST } from './outpost.js';

export const MAPS = {
  duel: { boxes: MAP_BOXES, spawns: SPAWNS },
  lake: { boxes: LAKE_BOXES, spawns: LAKE_SPAWNS },
  outpost: { boxes: OUTPOST_STATIC, spawns: OUTPOST.spawns }, // breakable props are drawn by public/js/props.js
};

export const mapOf = id => MAPS[id] || MAPS.duel;
