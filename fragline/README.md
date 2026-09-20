# Fragline — Zombie Holdout

A co-op browser survival shooter for 1–4 players: build, harvest and defend the Core against endless,
ever-harder zombie waves (see below). It plays like a Source-engine CS2/Valorant shooter under the hood —
movement, per-weapon spray patterns, hitbox damage, wallbangs — repurposed for horde defense instead of
round-based duels. Runs in the browser; a tiny Node server hosts the page and the multiplayer rooms.

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

## Controls

| Key | Action |
| --- | --- |
| WASD | Move (release/tap the opposite key to counter-strafe) |
| Shift | Walk — silent footsteps, better accuracy |
| Ctrl or C | Crouch (crouch in the air to crouch-jump) |
| Space | Jump |
| Left click | Fire / knife slash |
| Right click | Scope (AWP/SSG, 2 zoom levels) / knife stab |
| R | Reload |
| 1–6, mouse wheel | Hotbar slots (guns or items), cycle |
| F | Harvesting knife · press again to inspect it (the karambit twirls around its ring) |
| B | Shop — inside the ring around the Core |
| Tab | Scoreboard |
| Enter | Chat |
| Esc | Pause + settings (sensitivity, FOV, crosshair, volume) |

Every action (including fire/scope) can be rebound in **Settings → Key bindings**: two slots per action,
keyboard keys, mouse buttons (incl. side buttons) or the scroll wheel — e.g. bind jump to *Wheel down* for
scroll-bhopping. Sensitivity uses the CS2 scale (`0.022°` per mouse count). From Valorant, multiply your sens by 3.18.

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
  | Tank | 300 HP, a bit slower, takes 15 % less damage, immune to knockback/stuns from zombies, builds & repairs 25 % faster |
  | Assault | 200 HP, +20 % damage, 50 % bigger magazines, carries 50 % more ammo, 10 % faster, +15 % fire rate for 3 s after a kill |
  | Medic | 200 HP, regenerates, heals teammates and survivors within 5 m, revives twice as fast, healing items 25 % stronger, a free medkit every 2 waves, regens shield near the Core |

- **Zombies:** Shambler, Runner, Spitter (lobs acid over walls), Brute (armored wall-breaker), plus:
  Stalker (small, fast, rapid swings — from wave 4), Sniper (camps near its gate, laser telegraph, hits
  survivors and turrets twice as hard — 6), Bloater (bursts into an acid pool — 6), Hexer (throws blinding
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
  - **The Colossus (5, 20, 35…):** circles overhead bombing the fort; only snipers hurt it, only through its
    small glowing weak points — when only the one on its back is left, the game says so and marks it. Drops the
    **Skybreaker**.
  - **The Brood Titan (10, 25…):** announced at the start of the wave, stomps in once the horde is dead. Its
    riders throw acid and can't be hurt while mounted: two leap off the moment it arrives and more every 12 s, it
    drops fresh minions off its back every 8 s, and two Sniper Riders stay up there picking you off the whole
    fight. Kill the Titan and the rest fall off. It drops the **Brood Launcher**.
  - **The Maw (15, 30…):** a giant worm hunting underground and bursting up under builds and players. Hold **E**
    on the **seismic thumpers** (in the two houses and a corner shack, shown on the map) to lure it up stunned —
    shoot the glowing throat for triple damage. Below 25 % it tunnels toward the Core to devour it: arm two
    thumpers or blast its mouth to stop it. Drops the **Maw Fang**. It leaves the fort in pieces, so the break
    after a Maw wave runs **4 minutes** instead of the usual timer — enough to rebuild the Core area properly.
  - **Boss weapons** (always Legendary, tier III): **Skybreaker** — sniper whose shots pierce every zombie in
    a line and mark them (+25 % damage from everyone for 5 s); **Brood Launcher** — grenades split into acid
    bomblets that leave zombie-melting pools; **Maw Fang** — shotgun that heals you for 10 % of its damage, and
    every 5th shot yanks nearby zombies together; **Alpha Cleaver** (the elite Alpha Brute) — huge 150° cleave
    that knocks zombies down, and you run faster holding it.
- **Night waves** (a quarter of the time from wave 4, never with a boss; announced a break ahead): nearly black,
  short view distance. Find zombies by their eyes, muzzle flashes and sound — or fit a **flashlight** (it comes
  on by itself in the dark, works on any wave; **L** toggles it). Zombies drop flashlights on night waves.
  **Night Vision Goggles** (head armor) switch the view to a bright green night-vision image when it gets dark
  (**L** flips them up when your gun has no flashlight).
- **Inventory (I):** Minecraft-style — 6 hotbar slots (**1–6**, **F** = harvesting knife) + 18 backpack slots
  + 4 armor slots (head / chest / legs / feet). Drag and drop to rearrange, shift-click to quick-move, drag an
  item outside the panel to drop it, or hover an item and press **1–6** to swap it into that hotbar slot.
  A separate 4-slot **sack** always rides along for consumables (**7 8 9 0** use them): bandages, medkits, shields
  and **Adrenaline Shots** (**J**) — an adrenaline shot heals instantly (overflow becomes shield) and gives you
  8 s of regeneration plus a damage and speed boost. Ammo and materials are counters. Next to the team chest the chest opens
  beside it. Anything in the hotbar is usable: guns shoot, throwables throw on click (**T** quick-throws, **N**
  picks which), heals are held, traps and turrets open build mode. **E** picks things up, and opens the inventory
  when there's nothing to interact with. There's no drop key: drag an item out of the window to throw it away, or
  sell it to the Banker. Every gun shows its own icon in the tiles and its own silhouette when it's on the ground,
  with a name label as you get close.
- **Guns:** Fortnite-style pistols, SMGs, ARs, shotguns, a Hand Cannon, rockets, the SSG 08 and AWP, plus the
  **grenade launcher** (impact grenades, explosive ammo), the **Shockwave Blaster** (crowd control: shoves
  zombies until they slam into a wall, build or prop — up to 20 m for light ones, less for heavy ones, bosses
  don't move — and the slam hurts and stuns) and the **Slasher Blade** (Stalker
  drop: wide slash, run 15 % faster). Snipers drop SSGs (AWPs from wave 15), Bloaters drop grenade launchers.
  Every gun has a rarity (Common → Legendary) and on top of that a **tier** (I → III, ×1 / 1.25 / 1.55
  damage; tier II at the Core, tier III at the Blacksmith) and maybe an **element** (buy an elemental version of
  any shop gun at the Core, find one, or infuse at the Blacksmith; rarity can be upgraded at the Core up to
  Legendary): fire (burns), water (soaks
  and slows; soaked zombies freeze instantly from ice and take double shock), ice (chills → freezes), shock
  (chains to 2 more zombies).
- **Armor** (shop, chests, bosses; upgrade to tier III): Combat Helmet, Hex Goggles (resist blindness), Kevlar
  Vest, Fireproof Vest (resist burning), Padded Pants, Insulated Pants (resist slows), Combat Boots, Swift Step
  Boots (run faster), Night Vision Goggles.
- **The Blacksmith** (after wave 7 clears, anvil beside the Core, **E**): tier III forging for guns and
  armor, element infusion, attachments (Extended Mag, Compensator, Flashlight, Laser Sight) and turret upgrades
  (damage, range, fire rate, ammo refill, incendiary / frost rounds, armor plate — stand near the turret).
  Forging tier III and infusing an element cost money plus **Zinkonium**.
- **Building (G):** walls, floors and stairs on a 4 m grid with their own keys while build mode is on —
  **Q** wall · **E** stair · **F** floor · **T** trap · **Z** turret / Rally Fire · **R** rotate the stair (it
  always rises away from you) · wheel cycles the selected trap/turret. LMB place (hold to turbo-build),
  **X** demolish your own piece, hold **E** to repair. Rebind them in Settings → Key bindings → *Building*.
  Everything is built from **Zinkonium** — one tough material, no upgrading a piece to something better.
  Pieces grow to full HP over 4 s and shrug off most rifle fire.
  Stairs are Fortnite-style ramps: a thin sloped slab you can run up, walk and shoot underneath, and see from
  below. Floors sit flush with each level, so stairs run straight onto the floor above and doors on a floor
  are tall enough to walk through. **Structural integrity:** anything that loses its connection to the ground collapses.
- **Zombies chew through walls more slowly now**, and a crowd attacking the same piece splits its damage —
  except the Iron Golem, which hits at full force.
- **The map is a ruin:** collapsed apartment blocks, a burnt-out gas station, a crashed bus and a leaning
  watchtower sit in the four quarters, wrapped in vines, rubble, dead scrub and scattered wreckage. They are
  cover, harvestable material and landmarks — and there are chests and survivor shelters tucked inside them.
- **Everything breaks except the Core:** houses, walls, roofs, crates, shacks and ruins have HP; zombies,
  explosives and bullets wear them down, and your knife harvests them for materials.
- **Funnels:** zombies weigh a detour against smashing through. Leave one opening and make it a killbox.
- **Harvesting:** your knife chops trees, rocks, wrecked cars and map props for **Zinkonium** — the one
  building material. Hit the glowing weak point for 2.5× materials.
- **Edits (V):** hold the fire button and drag over the tiles you want gone — **letting go of the mouse applies
  the edit straight away**, no second key press. Walls are a 3×3 grid (bottom middle two = a **door**, single tiles = **windows**), floors 2×2,
  stairs split into halves. **Ladders** on every face of the Core lead to its roof.
- **Shop (B, inside the ring around the Core — the ring is wide now):** one page with everything to buy —
  guns (each also as a fire / water / ice / shock version), ammo, grenades / molotovs / freeze grenades,
  bandages / medkits / shield potions, **Adrenaline Shots**, floor spikes, wall darts, flame grills,
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
  mends itself very slowly all match long.
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
  their own (a bandage, medkit, Medic or Rally Fire patches them faster) and die for good.

Tuning lives in `shared/zombies.js` (types, bosses, scaling, night, drops), `shared/holdout.js` (items,
armor, attachments, classes, the Blacksmith, loot, survivors, breaks), `shared/items.js` (inventory, tiers),
`shared/elements.js`, `shared/skyboss.js` (the Colossus), `shared/build.js` (grid, materials, edits, integrity),
`shared/outpost.js` (map, props, thumpers), `server/holdout/room.js` (`HOLDOUT` timers/economy),
`server/holdout/bosses.js` (Titan and Maw) and `server/holdout/flowfield.js` (how hard zombies avoid walls).

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
  them. Multipliers: head ×4, stomach ×1.25, chest/arms ×1, legs ×0.75.
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
                     behaviors (specialist zombies), bosses (Brood Titan, the Maw), blacksmith, flow field,
                     inventory (grid/armor/shop/team chest/pickups), combat (throwables/rockets/elements),
                     defenses (traps/turrets), survivors, skyboss (the Colossus), events (chests/supply drops)
shared/              weapons, outpost map, physics/hitboxes, building grid, zombie types, holdout gear, items
                     (inventory rules, tiers), elements, Colossus path
public/js/           client: game loop, movement, weapons, HUD, audio, models, networking
public/js/holdout.js Zombie Holdout client (+ zombies.js horde, build.js pieces/build+edit mode, props.js map
                     props, holdout_ents.js loot/traps/survivors/bosses, holdout_ui.js hotbar/shop/Blacksmith,
                     inventory_ui.js inventory, minimap.js minimap + full map, night.js night lighting)
.claude/agents/      fragline-builder: the Sonnet implementation agent (see CLAUDE.md for the Opus/Sonnet split)
```
