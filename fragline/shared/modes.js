// Game modes, shared by client and server. A room is created with one mode; the mode picks the map,
// movement physics, loadout and round timings.
export const MODES = {
  classic: { id: 'classic', name: 'Classic 1v1', map: 'duel', buy: true },

  // CS "Flying Scoutsman": low gravity (sv_gravity 220 vs 800), huge air control, SSG 08 + knife only,
  // scouts accurate while airborne. Jumps reach ~5 m and hang for almost 3 s.
  scoutsman: {
    id: 'scoutsman', name: 'Flying Huntsman', map: 'lake', buy: false,
    loadout: 'ssg08', armor: true, airAccurate: true,
    phys: { gravity: 5.5, jumpV: 7.6, airAccel: 60, airCap: 1.6, airMax: 14 },
    rules: { freeze: 4000, roundTime: 75000 },
  },

  // Save-the-World-style co-op: 1–4 players build, harvest and defend the Core against zombie waves.
  // Runs in server/holdout/room.js instead of the 1v1 Room.
  zombies: { id: 'zombies', name: 'Zombie Holdout', map: 'outpost', buy: true, coop: true, build: true, maxPlayers: 4 },
};

export const modeOf = id => MODES[id] || MODES.classic;
