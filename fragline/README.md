# Zombie Holdout

A co-op browser survival shooter for 1–4 players: build, harvest and defend the Core against endless,
ever-harder zombie waves (see below). It plays like a Source-engine CS2/Valorant shooter under the hood —
movement, per-weapon spray patterns, hitbox damage, wallbangs — repurposed for horde defense instead of
round-based duels. Runs in the browser; a tiny Node server hosts the page and the multiplayer rooms.

**Play solo in your browser, no install:** https://zombie-holdout.netlify.app — the whole game, server
included, runs on your own machine (the game server runs in a Web Worker), and the site rebuilds from this
repo on every push, so it's always the latest version. Co-op needs the Node server below.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000, type a name, then:

- **Play** — starts a new room; you get a 4-letter code.
- **Join** — enter a friend's 4-letter code to drop into their game (`http://<your-ip>:3000/#CODE` also
  fills the code in automatically).

Up to 4 players share a room. Joining a match plays a short flyover of the Outpost before dropping into
your eyes.

Playing with a friend:

- **Same Wi-Fi/LAN:** the server prints your LAN address (e.g. `http://10.0.0.190:3000`). Allow Node.js through
  Windows Firewall the first time it asks.
- **Over the internet:** with the server running, double-click **`share-online.bat`** (uses Cloudflare's free
  `cloudflared`, installed with `winget install --id Cloudflare.cloudflared`). It prints an
  `https://….trycloudflare.com` link — send it to your friend (the pause menu shows the full invite link).
  No router setup; the link changes each run and works while your PC, server and tunnel are running.
  Prefer private rooms: anyone with the link can open the game. (Alternatives: port-forward TCP 3000, or
  deploy to Render/Railway/Fly.io for an always-on URL — the server honors `PORT`.)

## The browser (solo) version

`npm run build:static` writes a static site to `dist/`: the client, the shared code and the room logic,
which the page starts in a Web Worker instead of connecting to a server. `netlify.toml` has Netlify run that
build and publish `dist/` on every push, with caching off so players always get the newest build. The build
fails if any module the page or the worker imports is missing from `dist/`.

To give the hosted page co-op, run the Node server somewhere always on (Render, Fly.io, a VPS — it honors
`PORT`) and set `HOLDOUT_SERVER_URL` (e.g. `wss://your-server.example.com`) in Netlify's environment
variables. Play and Join then use that server instead of solo mode.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move (release/tap the opposite key to counter-strafe) |
| Ctrl | Crouch (crouch in the air to crouch-jump) |
| Space | Jump |
| Left click | Fire / knife slash |
| Right click | Scope (AWP/SSG, 2 zoom levels) / knife stab / Tank: hold to raise your barrier (any other gun) / Ronin: **Fire Strike** with the katana |
| R | Reload · Ronin with the katana in hand: **Deflect** |
| 1–6, mouse wheel | Hotbar slots (guns or items), cycle — the Ronin has only 1–3 |
| 4 | Ronin: **katana dash** (it shares hotbar slot 4's key — **8** left-handed; the dash may share a key only with slots 4–6, which the Ronin doesn't have) |
| X | Harvest tool (the harvesting knife) · press again to inspect it (the karambit twirls around its ring) |
| Q · F · C · Shift | Build a wall · floor · stair · cone — from anywhere, no build mode (**Z** trap, **V** turret / Rally Fire, **G** edit) |
| B | Shop — inside the ring around the Core |
| U | Upgrade the turret you're standing by (within 3 m) — anywhere, anytime, no Blacksmith needed |
| Tab | Scoreboard |
| Enter | Chat |
| Esc | Pause + settings (sensitivity, FOV, crosshair, volume) |

Every action (including fire/scope) can be rebound in **Settings → Key bindings**: two slots per action,
keyboard keys, mouse buttons (incl. side buttons) or the scroll wheel — e.g. bind jump to *Wheel down* for
scroll-bhopping. **Right handed** (the defaults above) and **Left handed** load a full preset — left-handed puts
the mouse in your left hand and moves on **O K L ;** with the hotbar on **- 0 9 8 7 6** and the inventory on
**Enter**. Sensitivity uses the CS2 scale (`0.022°` per mouse count). From Valorant, multiply your sens by 3.18.

**Esc works like CS** in Chrome/Edge: matches run fullscreen with Keyboard Lock, so Esc closes the shop
(which uses an in-game cursor — your mouse never unlocks) or opens/closes the pause menu. Hold Esc to leave
fullscreen. This needs `localhost` or an `https://` address (a tunnel URL works; plain `http://<LAN-IP>` doesn't),
and can be turned off in Settings → Video. In other browsers Esc still releases the mouse; click to resume.

**Bunny hopping** (Settings → Movement, on by default): hold jump to hop the instant you land with no landing
slowdown; strafe with A/D while turning the mouse the same way to build speed (capped at ~2× run speed).
Turn it off for strict CS2-style movement (tap-timed jumps, landing penalty).
The page asks before closing mid-match, so an accidental Ctrl+W (crouch + forward) won't drop you.

## Gameplay

Save-the-World-style tower defense on the **Outpost** map: the Core sits in the middle, the horde pours out
of purple storm gates on the north/east/south/west edges, and you build, harvest and fight to keep it alive.

- **Flow:** lobby (pick a class, look around; nothing can be built or broken yet) → everyone presses **Y** →
  5 s countdown → the squad is teleported around the Core → a prep break to build and shop (Y skips) →
  **endless waves**. Breaks grow with the wave number (2 min max, all ready = skip). Each cleared wave pays money
  and materials, heals the Core 10 % and brings back everyone who died.
- **Losing:** the Core hits 0 HP, or every real player is down or dead at the same time (solo: dying ends the
  run). Nobody respawns mid-wave — the dead spectate a teammate (click to switch) until the wave is cleared.
  Downed players crawl (faster than before) and bleed out in 30 s; a teammate holds **E** for 3 s to revive.
  Game over: a short beat, then the whole map resets (builds, traps, props, trees, loot) and the match stats
  stay on screen until you ready up again. Your best run (most waves survived) is kept in this browser.
- **Difficulty** is automatic: zombie count, HP (+10 %/wave) and damage (+5 %/wave) keep climbing, more
  lanes open, special types and class variants get more common. More players → more zombies, more HP, more lanes.
- **Classes** (B at the Core; only in the lobby/prep, or during the break after a wave that's a multiple of 5):

  | Class | Effect |
  | --- | --- |
  | Tank | 300 HP, a bit slower, takes 15 % less damage, immune to knockback/stuns from zombies, builds & repairs 25 % faster, **barrier**: hold right-click with any gun but a sniper to raise a 4 × 2.6 m energy wall 1.2 m ahead (1200 HP; soaks swings, globs, sniper shots and boss projectiles from the front for anyone behind it; no firing and 60 % speed while it's up; regrows 150 HP/s 2 s after lowering, 4 s down when broken) |
  | Assault | 200 HP, +20 % damage, 50 % bigger magazines, carries 50 % more ammo, 10 % faster, +15 % fire rate for 3 s after a kill |
  | Ronin (Melee) | Replaced the Medic (an old Medic pick becomes the Ronin). 200 HP, 20 % faster, heals 3 HP/s anywhere after 3 s without damage, grows an Adrenaline Shot every 5 s up to **30** (into the sack or a free slot, like a pickup). Only **3 hotbar slots**: slot 1 is the **Zinkonium Katana**, locked there (it can't be moved, dropped, sold, stashed or unlocked), slots 2–3 are free; taking the kit empties hotbar slots 1 and 4–6 into the backpack (at your feet when it's full), leaving it takes the katana away — its kills and upgrades stay with you. **The katana:** LMB is a 3-hit combo (95 / 95 / 150, 3 m reach, 110° arcs, the third a 150° arc that shoves; a swing every 0.35 s, the chain resets after a 0.9 s pause). RMB **Fire Strike**: a flaming crescent (25 m/s, 30 m) that passes through every zombie it touches for 120 + burn, and through your builds and the map's props without hurting them (only the ground, the map's edge and the Core stop it), 6 s cooldown. **R: Deflect** — a 1.2 s stance (3 s cooldown) that blocks zombie swings, globs, sniper shots and boss projectiles from the front and sends projectiles back at their shooter for 2× their damage (a sniper shoots itself); a block in the first 0.25 s is a **perfect parry**: +15 HP and +1 Adrenaline Shot (once a stance), and a parried swing staggers the zombie. **Dash key: dash** 7 m along your aim in 0.2 s, cutting every zombie you pass through for 80, stopped by walls, 5 s cooldown. Every hit adds a **bleed** stack (3 dps for 4 s, up to 5 — red drips) and hits from behind (more than 110° off a zombie's facing) crit ×1.5. Cooldown pips sit under the crosshair. Upgrades: the Blacksmith's Katana tree (below) |

- **Zombies:** Shambler, Runner, Spitter (lobs acid over walls), Brute (armored wall-breaker), plus:
  Stalker (small, fast, rapid swings — from wave 4), Sniper (camps near its gate, laser telegraph, hits
  survivors and turrets twice as hard — 6), Bloater (bursts into an acid pool that burns you, barely your builds — 6), Hexer (throws blinding
  ink — 7), Burrower (tunnels once under a build and
  pops up a tile past it — 9), Shieldbearer (front shield stops bullets; flank it or use explosives,
  elements and knockback — 9), Pyro (fire, immune to fire — 11), Frost Walker (slowing aura, immune to ice — 12),
  **Core Seeker** (ignores you completely and runs at the Core, red marker — 5), **Iron Golem** (a slow armored
  wall breaker that walks straight through your fort and smashes Zinkonium in a hit or two, tagged WALL BREAKER — 7;
  it hits hard but it is no longer a tank — 650 HP, so focused fire drops it before it reaches the Core),
  and on night waves the **Shade** (from wave 6): weak, but invisible through night vision and only visible
  without it up close — you'll hear it before you see it.
  **Loot carriers** turn up all match: the **Scavenger** (small and quick, common from wave 2 — nearly always
  drops ammo, materials or a cheap trap), the **Warden** (armored, slow — 6, usually an armor piece and
  sometimes a turret) and the rare **Relic Bearer** (7, always a high-rarity gun or attachment — an SSG, or an
  AWP from wave 15). Each is rarer than the last, so good loot keeps coming without being guaranteed.
  The **Hoarder** (from wave 3) hauls a sack of cash and ignores you completely: it sprints for the middle of the
  map and escapes down a hole if you let it. Drop it and the whole squad splits a big payout ($1,200 + $120 per
  wave). One is guaranteed every 4th wave and has a 12 % chance on the others.
  From wave 6 some zombies come as **Tank** (2× HP, bigger), **Assault** (faster, harder hits) or **Medic**
  (heals zombies around it) variants. The Alpha Brute returns as an elite every 4th wave from wave 12.
- **Bosses** every 5 waves, each repeat 50 % tougher:
  - **The Colossus (5, 30, 55…):** circles overhead bombing the fort; only snipers hurt it, only through its
    small glowing weak points — when only the one on its back is left, the game says so and marks it. Drops the
    **Skybreaker**.
  - **The Brood Titan (10, 35…):** announced at the start of the wave, stomps in once the horde is dead. Its
    riders throw acid and can't be hurt while mounted: two leap off the moment it arrives and more every 12 s, it
    drops fresh minions off its back every 8 s, and two Sniper Riders stay up there picking you off the whole
    fight. Kill the Titan and the rest fall off. It drops the **Brood Launcher**.
  - **The Maw (15, 40…):** a giant worm hunting underground and bursting up under builds and players. Hold **E**
    on the **seismic thumpers** (in the two houses and a corner shack, shown on the map) to lure it up stunned —
    shoot the glowing throat for triple damage. Below 25 % it tunnels toward the Core to devour it: arm two
    thumpers or blast its mouth to stop it. Drops the **Maw Fang**. It leaves the fort in pieces, so the break
    after a Maw wave runs **4 minutes** instead of the usual timer — enough to rebuild the Core area properly.
  - **The Gravekeeper (20, 45…):** a 4.5 m undertaker with a bronze bell on his back walks for the Core, smashing
    builds and sweeping his scythe (it knocks you back — not Tanks). He opens **grave pits** 12–24 m out (4, +1 per
    extra player, max 7; violet cracks, marked on the map) and every **bell toll** (~10 s) each open pit raises two
    zombies. While any pit is open a **spectral ward** makes him immune: build a **cone** on a pit's tile to seal
    it. With every pit sealed the ward drops and hits on his **bell** (from behind) deal double — but his lantern
    (every ~15 s) and the pit zombies go for the lids, and a broken lid brings the ward back. His whole wave
    arrives by **lightning**: a bolt strikes, the zombie rises out of the ground over 2.5 s (shoot it — it can't
    fight yet) and the spot stays electrified for 4 s (hurts players only). At 60 % two more pits open; at 30 %
    the **Death Knell** rains bolts around everyone for 10 s. Drops the **Knell**.
  - **The Behemoth (25, 50…):** a walking fortress (11 × 7 m, a flat deck 6.4 m up), announced at the wave start,
    marches in once the horde is dead: straight down one lane at ~1.1 m/s, crushing every build and prop in its
    path (each build it flattens holds it up ~1.2 s, so barricades buy time) and shoving players aside. Every
    ~20 s it **braces** for 7 s and lobs 3 siege shells at the Core (their arcs and landing rings show; ~150
    each). Only its 3 **reactor hearts** can be hurt, each under a hatch on the deck: **stair up** onto it (a
    level-1 stair on the tile beside its flank steps right onto the deck — it can't be built into, and pieces
    don't attach to it; braced is the easy moment), ride the moving deck, break the hatch's 3 bolts with the
    **harvest tool** (2 hits each) and shoot the heart (explosives work too); anything else answers IMMUNE. A
    zombie crew climbs aboard every 12 s. Each heart that bursts makes it rear up and throw everyone off the
    deck (not Tanks); the last one brings it down. If it reaches the Core it slams it for 15 % of the Core's
    max HP every 6 s. Drops the **Siegebreaker**.
  - **Boss weapons** (always Legendary, tier III): **Skybreaker** — sniper whose shots pierce every zombie in
    a line and mark them (+25 % damage from everyone for 5 s); **Brood Launcher** — grenades split into acid
    bomblets that leave zombie-melting pools; **Maw Fang** — shotgun that heals you for 10 % of its damage, and
    every 5th shot yanks nearby zombies together; **Alpha Cleaver** (the elite Alpha Brute) — huge 150° cleave
    that knocks zombies down, and you run faster holding it; **Knell** — lightning rifle whose hits chain to the 2
    nearest zombies, and every 4th hit leaves a 2 s shock pool that only hurts zombies; **Siegebreaker** —
    rocket launcher whose rockets split into 3 cluster bomblets on impact.
- **Night waves** (a quarter of the time from wave 4, never with a boss; announced a break ahead): nearly black,
  short view distance. Find zombies by their eyes, muzzle flashes and sound — or fit a **flashlight** (it comes
  on by itself in the dark, works on any wave; **L** toggles it). Zombies drop flashlights on night waves.
  **Night Vision Goggles** (head armor) switch the view to a bright green night-vision image when it gets dark
  (**L** flips them up when your gun has no flashlight).
- **Inventory (I):** Minecraft-style — 6 hotbar slots (**1–6**, **X** = harvesting knife; the Ronin gets 3, his katana in the first) + 18 backpack slots
  + 4 armor slots (head / chest / legs / feet). Drag and drop to rearrange, shift-click to quick-move, drag an
  item outside the panel to drop it, or hover an item and press **1–6** to swap it into that hotbar slot.
  A separate 4-slot **sack** always rides along for **Adrenaline Shots** (**H**, or **7 8 9 0** per sack slot), the
  only carried heal: +25 HP and +25 shield at once, then +4 HP/s for 5 s (stacks of 10, carry up to 20 — the Ronin 30, 1.5 s cooldown). About one
  kill in eight drops one, Brutes, Wardens and Golems always drop 1-3, and chests, supply drops and bosses carry
  stacks. Otherwise you heal at Rally Fires, near a Medic survivor, anywhere as a Ronin, or by resting inside the Core ring (+2 HP/s once you've
  gone 4 s without being hit). Ammo and materials are counters. Next to the team chest the chest opens
  beside it. Anything in the hotbar is usable: guns shoot, throwables throw on click (**T** quick-throws, **N**
  picks which), Adrenaline Shots are used on click, traps and turrets start placing them. **E** picks things up; the
  inventory key opens and closes the inventory — bind both to one key (smart E) and it uses whatever is in range,
  otherwise it opens or closes the inventory. There's no drop key: drag an item out of the window to throw it away, or
  sell it to the Banker. Every gun shows its own icon in the tiles and its own silhouette when it's on the ground,
  with a name label as you get close.
- **Guns:** Fortnite-style pistols, SMGs, ARs, shotguns, a Hand Cannon, rockets, the SSG 08 and AWP, plus the
  **grenade launcher** (impact grenades, explosive ammo), the **Shockwave Blaster** (crowd control: shoves
  zombies until they slam into a wall, build or prop — up to 20 m for light ones, less for heavy ones, bosses
  don't move — and the slam hurts and stuns) and the **Slasher Blade** (Stalker
  drop: wide slash, run 15 % faster). Snipers drop SSGs (AWPs from wave 15), Bloaters drop grenade launchers.
  Every gun has a rarity (Common → Legendary) and on top of that a **tier** (I → V, ×1 / 1.25 / 1.55 / 1.85 / 2.2
  damage; tier II at the Core, tier III at the Blacksmith, IV and V are Blacksmith milestones) and maybe an **element** (buy an elemental version of
  any shop gun at the Core, find one, or infuse at the Blacksmith; rarity can be upgraded at the Core up to
  Legendary): fire (burns), water (soaks
  and slows; soaked zombies freeze instantly from ice and take double shock), ice (chills → freezes), shock
  (chains to 2 more zombies) — plus **toxic** (a Blacksmith milestone only: poisons for 4 s, and a zombie that dies
  poisoned leaves a 3 m cloud for 3 s that poisons the ones around it).
- **Weapon mastery:** every gun counts the kills made with it (shown as **M1–M8** on its tile and in the
  inventory info: level 2 at 25 kills, then 60, 110, 180, 270, 380 and 520). The Blacksmith's milestones need it.
- **Armor** (shop, chests, bosses; upgrade to tier III): Combat Helmet, Hex Goggles (resist blindness), Kevlar
  Vest, Fireproof Vest (resist burning), Padded Pants, Insulated Pants (resist slows), Combat Boots, Swift Step
  Boots (run faster), Night Vision Goggles.
- **The Blacksmith** (after wave 7 clears, anvil beside the Core, **E**): tier III forging for guns and
  armor, element infusion, attachments (Extended Mag, Compensator, Flashlight, Laser Sight) and turret upgrades
  (per level +40 % damage, +25 % range, +30 % fire rate, +100 % ammo capacity, +50 % HP plating; ammo refill and
  incendiary / frost rounds too). Every upgrade shows on the turret: extra barrels, a scope dish, spinning motor
  rings, ammo boxes, armour plates and an orange / blue glow. **U** upgrades the turret you're standing by without him.
  Forging tier III and infusing an element cost money plus **Zinkonium**.
  **Milestones** open every 5 waves reached and each needs the gun's mastery level + money + Zinkonium:
  wave 5 **Multishot** (one extra round per shot at 50 % damage) and the **Toxic** element (M2, $2500 + 120),
  wave 10 **Tier IV** (M4, $4000 + 200), wave 15 **Piercing** (rounds go on through one more zombie at 70 %) and
  **Explosive tips** (1.5 m splash at 30 %, zombies only) (M3, $3500 + 160), wave 20 **Tier V** (M6, $8000 + 400)
  and wave 25 a **second mod slot** (M7, $6000 + 300). One mod slot until then — a new mod replaces the old one.
  **The Ronin's katana** has its own tree in the panel's Katana section (no tiers, infusions or attachments on it);
  each upgrade needs the katana's mastery (its kills — bleed and reflected kills count) + money + Zinkonium + the wave
  reached: **Edge I–V** (+20 % damage each, in order: I M1 $1000 + 60, II M2 $2000 + 100, III wave 10 M3 $3500 + 160,
  IV wave 15 M5 $5500 + 240, V wave 20 M7 $8000 + 360), wave 5 **Twin Fire Strike** (two crescents in a V, M3 $3000 + 150)
  and **Mirror Deflect** (reflections hit twice as hard again, a 0.35 s perfect window, M3 $2500 + 120), wave 10 **Ember
  Trail** (Fire Strike leaves burning ground for 3 s that only hurts zombies, M4 $4000 + 200) and **Chain Dash** (two
  dashes per cooldown, M4 $4000 + 180), wave 15 **Hemorrhage** (bleed stacks to 10 and bleeds 50 % harder, M5 $4500 +
  200) and **Execution** (the combo's third hit kills a non-boss zombie left under 15 %, M6 $6000 + 260), wave 20
  **Elemental Edge** (shock, cryo, toxic or fire on the blade and Fire Strike, M5 $5000 + 220 — switching costs it again).
- **Building (Fortnite Builder Pro — no build mode):** walls, floors, stairs and cones on a 4 m grid, each on
  its own key that starts building it from anywhere — **Q** wall · **F** floor · **C** stair · **Shift** cone ·
  **Z** trap · **V** turret / Rally Fire · **R** rotate the stair while building (it always rises away from you)
  · wheel cycles the selected trap/turret. LMB place (hold to turbo-build), hold **E** to repair; a hotbar key
  (**1–6**, **X**) goes back to your weapons. No key does two things except rotate, which shares **R** with
  reload. Rebind them in Settings → Key bindings → *Building*; older saved binds reset once to the right-handed preset.
  **Cones** are Fortnite roofs: a 1.2 m pyramid over a tile, on the same plane as a floor (look up to roof your
  cell, down to cone your feet) — walkable, and they can cover a turret or Rally Fire, but not a floor trap.
  Everything is built from **Zinkonium** — one tough material, no upgrading a piece to something better.
  Pieces grow to full HP over 4 s; guns and your explosives don't hurt them. Break down a piece you built
  with the knife (3 hits on a full Zinkonium piece, 5 Zinkonium back when it falls); a teammate's pieces
  are theirs to break unless they've left.
  Stairs are Fortnite-style ramps: a thin sloped slab you can run up, walk and shoot underneath, and see from
  below. Floors sit flush with each level, so stairs run straight onto the floor above and doors on a floor
  are tall enough to walk through. **Structural integrity:** anything that loses its connection to the ground collapses.
- **Zombies chew through walls more slowly now**, and a crowd attacking the same piece splits its damage —
  except the Iron Golem, which hits at full force.
- **The map is a ruin:** collapsed apartment blocks, a burnt-out gas station, a crashed bus and a leaning
  watchtower sit in the four quarters, wrapped in vines, rubble, dead scrub and scattered wreckage. They are
  cover, harvestable material and landmarks — and there are chests and survivor shelters tucked inside them.
- **Everything breaks except the Core:** houses, walls, roofs, crates, shacks and ruins have HP; zombies
  wear them down (guns and your explosives don't), and your knife harvests them for materials.
- **Funnels:** zombies weigh a detour against smashing through. Leave one opening and make it a killbox.
- **Harvesting:** your knife chops trees, rocks, wrecked cars and map props for **Zinkonium** — the one
  building material. Hit the glowing weak point for 2.5× materials.
- **Edits (G), Fortnite-style:** hold the fire button and drag over the tiles you want gone — **letting go of the
  mouse applies the edit straight away**, no second key press. Walls are a 3×3 grid and only Fortnite's shapes
  count: **windows** (a middle-row tile, or both sides), **doors** (middle + bottom tile of a column — zombies still
  have to break them), a door with a window on the far side, the curved **arch** (bottom row + centre), **half
  arches** (a bottom corner 2×2 — open, rounded toward the middle), **triangles** (a corner tile and its two
  neighbours) and medium / low walls (top row / top two rows, a door fits under a medium wall). Anything else
  flashes red and resets. Floors and cones are 2×2 (take out 1–3 quarters). Stairs: drag across all four tiles
  to turn them, or over two side by side for a half stair rising that way. **Ladders** on every face of the Core
  lead to its roof.
- **Shop (B, inside the ring around the Core — the ring is wide now):** one page with everything to buy —
  guns (each also as a fire / water / ice / shock version), ammo (rockets come 5 a pack, 50 carried), grenades /
  molotovs / freeze grenades (a **Blizzard**: a 6 m icy field for 6 s — zombies in it slow to half speed, freeze solid
  for 3 s after 1.5 s inside and take +25 % damage while frozen), **Adrenaline Shots**, floor spikes, wall darts, flame grills,
  auto turret $1800, rocket turret $3000, **Rally Fire** (heals health and recharges shields) and armor.
  Duplicates are fine — buy a second SMG whenever you like. Three more tabs:
  **Upgrades** (your guns: rarity up to Legendary, tier II), **Team** (timed powerups plus permanent 5-level team
  upgrades — **Vitality** +10 % max health, **Firepower** +8 % damage, **Engineering** faster building/repairs and
  +10 % build health, **Gunnery** +10 % reload speed and +6 % fire rate) and **Core** (the Core cannon, below).
  The mouse wheel scrolls whatever panel is under the cursor, and anything can be paid from the team bank.
- **The Banker** (by the Core, **E**): sells your gear. Your whole inventory, sack included, is laid out as item
  tiles in their rarity colors — click one to see what it's worth and sell it for 50 % of its value, and buy back
  the last thing you sold for the same price.
- **Turrets:** Auto, Gatling (fast, ammo-hungry), Frost (slows), Flame (short cone, sets them burning),
  Tesla Coil (arcs between zombies), Rocket and Mortar (long range splash, useless up close). Chests, supply
  drops, bosses and the big zombies can drop traps and turrets too — cheap traps often, the heavy turrets rarely.
- **The Core cannon:** an indestructible auto-turret on the Core's roof. Upgrading it levels the Core up —
  damage, fire rate, range, incendiary / cryo / shock rounds (they stack), extra barrels and plating (+15 % Core
  health). It's expensive and you can only buy one upgrade every five waves.
- **Everything stacks:** a gun can carry several elements (each infusion at the Blacksmith costs more), turret
  upgrades have no cap (each level costs more), and a flashlight and a laser sight fit on the same gun.
- **Team chest** (next to the Core): share money, materials, ammo and items; pooled money is the team bank.
  Hold **E** at the Core to repair it between waves (one player at a time; not during a wave). The Core also
  mends itself: 1 % of its health per second during breaks, 0.2 %/s in a wave once it has gone 8 s unhit (its bar
  glows while it heals).
- **Map:** a minimap top-left (north up, follows you) shows houses, trees, builds, the Core, lanes, teammates,
  survivors, zombies (at night only close ones, the ones in your flashlight or ones lit up by gunfire), loot,
  chests, drops, thumpers and the Blacksmith. **M** opens the full map: wheel to zoom, drag to pan, click to
  **ping** a spot — the squad sees it on the map, on the compass and as a beam in the world for 8 s.
- **Supply drops and chests:** balloons float crates down during waves (shoot the balloons to drop them fast);
  chests around the map restock every 3 waves. Zombies, chests and drops hand out plenty of ammo and materials.
  Loot left on the ground disappears after 4 minutes (8 for boss loot). Anything dropped **falls**: loot that
  lands on a roof, a ramp or a crate drops to the surface below instead of hanging in the air.
- **Survivors (rescue waves 3, 7, 11…):** carry the wounded from the corner shelters into the Core ring (+$500).
  Each one is a **Guardian** (heavy armor and a shotgun, holds the front and draws zombies), a **Medic** (heals
  people around it, light gun) or a **Ranger** (rifle, best damage, stays back), and their tier — Recruit, Guard,
  Soldier, Marksman — sets how good their gun is. They look after themselves: they keep firing while backing away
  from anything that gets close, never stray far from the Core, and fall back when hurt. They heal very slowly on
  their own (a Medic survivor or a Rally Fire patches them faster) and die for good.

Tuning lives in `shared/zombies.js` (types, bosses, scaling, night, drops), `shared/holdout.js` (items,
armor, attachments, classes, the Blacksmith, loot, survivors, breaks), `shared/items.js` (inventory, tiers),
`shared/elements.js`, `shared/skyboss.js` (the Colossus), `shared/build.js` (grid, materials, edits, integrity),
`shared/outpost.js` (map, props, thumpers), `server/holdout/room.js` (`HOLDOUT` timers/economy),
`server/holdout/bosses.js` (Titan and Maw), `server/holdout/gravekeeper.js` (the Gravekeeper),
`shared/behemoth.js` + `server/holdout/behemoth.js` (the Behemoth) and
`server/holdout/flowfield.js` (how hard zombies avoid walls).

## What's modeled

- **Movement** — Source engine ground friction/acceleration and air strafing at 128 tick, weapon-based run
  speeds (knife fastest, AWP slowest, scoped AWP slower still), walk/crouch speed, crouch-jump, stairs,
  *tagging* (getting shot slows you) and a landing penalty.
- **Accuracy** — first-shot accuracy when standing still, big penalties for moving above ~34% speed or being
  airborne, crouch bonus, per-shot bloom that recovers when you stop firing. Unscoped snipers are wildly
  inaccurate and have no crosshair.
- **Recoil** — each automatic weapon has its own spray pattern (AK's "7", M4, Galil, MP9, MAC-10, P90 …).
  Bullets follow the full pattern while the camera only kicks ~45% of it (CS view punch), so you pull down to
  control. Every shot kicks the view; tapping/bursting resets recoil, and pistols recover quickly between taps.
  Recoil strength per gun is the last number in its `pattern(...)` call in `shared/weapons.js`.
- **Hitboxes** — head, chest, arms, stomach, legs; the character model *is* the hitboxes. Crouching shrinks
  them; zombies are hit exactly as drawn that frame (hunched, nodding, arms raised, flyers' wings), and the
  server accepts hit claims on where a zombie was up to 1 s ago (lag). Multipliers: head ×4, stomach ×1.25,
  chest/arms ×1, legs ×0.75.
- **Damage** — CS2 base damage, range falloff, armor penetration per weapon, helmet protects the head,
  legs are never armored. Distinct hit sounds: a crunchy *ding* for headshots, a special sound for headshot
  kills, and a metallic *dink* when your bullet glances off a helmet. Bullets penetrate wood crates and thin
  metal (wallbangs deal reduced damage). Knife backstabs.
- **Wallbangs** — damage left after a wall = 1 − thickness × material resistance ÷ weapon penetration, so it
  depends on how much material the bullet actually crosses: clipping a concrete corner or edge still gets
  through (rifle ≈ 70%, pistol ≈ 35%), a full 1 m wall doesn't. Materials, most to least bangable:
  plywood panels, wooden crates, drywall, sheet metal, container steel, concrete; the floor and outer walls
  always stop bullets. Resistances are in `MAT_RESIST` (`shared/physics.js`).
- **Audio** — 3D positional (HRTF) gunshots, footsteps and reloads; sounds behind walls are muffled; bullets
  snapping past your head; kill/headshot confirmation sounds.

### Weapons

Fortnite-style arsenal (pistols, SMGs, rifles, shotguns, a Hand Cannon, rockets) plus two carryovers from
Fragline's CS-style weapon set, the SSG 08 and AWP — both still wearing their original procedural finishes
(Dragonfire and Dragon Lore, drawn in `public/js/skins.js`) and CS-caliber damage/spray. Every gun's name
appears in the HUD, shop and inventory in its rarity color; reloads play staged mechanical sounds (mag
release, mag out, mag in, then the charging handle/slide/bolt) that teammates hear positionally.

## Performance

The static map is merged into one mesh per material, bullet holes/particles/tracers are instanced (a few
draw calls total), shadows are rendered once, there are no dynamic lights, your camera is interpolated
between 128 Hz physics steps, other players are played back on the sender's clock (no network-jitter stutter),
and the HUD only touches the page when a value changes. A frame costs well under 1 ms even on integrated
graphics, so the frame rate is normally limited by the browser, not the game:

- **Browsers never render faster than your monitor's refresh rate.** For uncapped FPS (lower input lag, like
  Krunker's unlimited-FPS mode) start the server and double-click **`play-unlimited-fps.bat`** — it opens
  Chrome/Edge with `--disable-frame-rate-limit --disable-gpu-vsync` in its own profile (so your settings there
  are separate).
- **Chrome Energy Saver caps pages at 30 FPS** on battery — turn it off at `chrome://settings/performance`
  or plug in.
- Settings → Video shows which **GPU** the browser is using. If you have a gaming GPU but it lists Intel,
  set the browser to "High performance" in Windows Settings → Display → Graphics.
- Still slow? Lower **Render scale**, turn off **Shadows**, or turn off **Anti-aliasing** (reload).

## Sounds

The real CS2/Valorant sound files are copyrighted, so every effect is synthesized in the browser to sound
similar. To use your own, drop `.wav`, `.mp3` or `.ogg` files into `public/sounds/` named after the effect
(for example `shot_ak47.wav`, `shot_awp.mp3`, `headshot_kill.wav`, `dink.wav`) — see `public/sounds/README.txt`.

## Tweaking

- Weapon stats, prices, spray patterns: `shared/weapons.js`
- Zombie Holdout tuning: see the pointers at the end of the Gameplay section above
- Regression tests: `npm test`
- Movement constants: `P` in `shared/physics.js`
- Change the port: `PORT=8080 npm start`

## Layout

```
server.js            HTTP + WebSocket server, room registry (create room / join by code / quick match)
server/baseRoom.js   shared room plumbing (messaging, weapon item ids)
server/holdout/      Zombie Holdout: room (waves, building, props, integrity, revives), director, zombie AI,
                     behaviors (specialist zombies), bosses (Titan, Maw), gravekeeper, blacksmith, flow field,
                     inventory (grid/armor/shop/team chest/pickups), combat (throwables/rockets/elements),
                     defenses (traps/turrets), survivors, skyboss (the Colossus), events (chests/supply drops),
                     barrier (the Tank's shield)
shared/              weapons, outpost map, physics/hitboxes, building grid, zombie types, holdout gear, items
                     (inventory rules, tiers), elements, Colossus path
public/js/           client: game loop, movement, weapons, HUD, audio, models, networking
public/js/holdout.js Zombie Holdout client (+ zombies.js horde, build.js pieces/build+edit mode, props.js map
                     props, holdout_ents.js loot/traps/survivors/bosses, holdout_ui.js hotbar/shop/Blacksmith,
                     inventory_ui.js inventory, minimap.js minimap + full map, night.js night lighting,
                     boss_gravekeeper.js the Gravekeeper's gear, graves and lightning)
.claude/agents/      fragline-builder: the Sonnet implementation agent (see CLAUDE.md for the Opus/Sonnet split)
```
