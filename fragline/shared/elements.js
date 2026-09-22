// Elemental guns (Holdout): any gun type can carry an element on top of its rarity and tier.
// fire  - sets zombies burning (damage over time)
// water - soaks them: slower, no longer burning, and primed for ice (instant freeze) and shock (double)
// ice   - chills; enough chill (or any hit on a soaked zombie) freezes it solid for a moment
// shock - arcs to the two nearest zombies around the one you hit
// toxic - poisons (damage over time); a zombie that dies poisoned leaves a cloud that poisons the ones around it.
//         A Blacksmith milestone only — never sold, looted or infused like the other four (ELEMENT_IDS).
export const ELEMENTS = {
  fire: { name: 'Fire', color: '#ff7a2a', hex: 0xff7a2a },
  water: { name: 'Water', color: '#3fa7ff', hex: 0x3fa7ff },
  ice: { name: 'Ice', color: '#9ff2ff', hex: 0x9ff2ff },
  shock: { name: 'Shock', color: '#ffe14d', hex: 0xffe14d },
  toxic: { name: 'Toxic', color: '#7dff4a', hex: 0x7dff4a },
};
export const ELEMENT_IDS = ['fire', 'water', 'ice', 'shock'];

export const EL = {
  burnTime: 4, burnFrac: 0.5,      // fire: 50 % of the hit again as burn over 4 s
  soakTime: 5, soakSlow: 0.2,      // water
  chillPer: 0.34, chillTime: 3, freeze: 1.5, // ice: three chilled hits in a row freeze
  arcs: 2, arcRange: 6, arcFrac: 0.6, // shock: 60 % of the hit to 2 more zombies (x2 on soaked ones)
  poisonTime: 4, poisonFrac: 0.6, cloudR: 3, cloudTime: 3, // toxic: 60 % of the hit as poison over 4 s; death cloud 3 m for 3 s
};
