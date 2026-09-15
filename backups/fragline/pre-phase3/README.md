# Fragline — 1v1 browser FPS

A small, clean-looking 1v1 tactical shooter that plays like CS2/Valorant: Source-style movement,
per-weapon spray patterns, CS hitbox damage, armor, wallbangs, economy, buy phase and rounds.
Runs in the browser; a tiny Node server hosts the page and the multiplayer rooms.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000, type a name, then:

- **Play vs Bot** — practice against an easy/medium/hard bot (no second person needed).
- **Private Room** — you get a 4-letter code; your friend opens `http://<your-ip>:3000/#CODE` and clicks *Join Room*.
- **Flying Huntsman · Private Room** — a separate 1v1 Lake-inspired arena with a two-story house,
  roof access, deck, dock and wooded shoreline. Everyone gets an SSG 08, knife and full armor on every
  spawn. Jumps reach about 5.2 m and stay airborne for 2.8 seconds. Scoped airborne shots stay accurate;
  unscoped shots retain sniper spread. Buying is disabled. Share the room code/invite link normally;
  joining friends automatically load this mode. This is an original interpretation, not an exact Lake replica.
- **Zombie Holdout · Co-op Room** — 1–4 players defend the Core against 10 waves of zombies (see below).
  Pick Casual / Normal / Hard next to the button; friends join with the room code like any private room.
- **Quick Match** — joins any open public room, or opens one and waits.

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
| F | Inspect weapon (the karambit twirls around its ring) |
| 1 / 2 / 3, Q, mouse wheel | Primary / pistol / knife, last weapon, cycle |
| B | Buy menu (buy phase, or first 15 s of a round while in spawn) |
| Tab | Scoreboard |
| Enter | Chat |
| Esc | Pause + settings (sensitivity, FOV, crosshair, volume) |

Every action (including fire/scope) can be rebound in **Settings → Key bindings**: two slots per action,
keyboard keys, mouse buttons (incl. side buttons) or the scroll wheel — e.g. bind jump to *Wheel down* for
scroll-bhopping. Sensitivity uses the CS2 scale (`0.022°` per mouse count). From Valorant, multiply your sens by 3.18.

**Esc works like CS** in Chrome/Edge: matches run fullscreen with Keyboard Lock, so Esc closes the buy menu
(which uses an in-game cursor — your mouse never unlocks) or opens/closes the pause menu. Hold Esc to leave
fullscreen. This needs `localhost` or an `https://` address (a tunnel URL works; plain `http://<LAN-IP>` doesn't),
and can be turned off in Settings → Video. In other browsers Esc still releases the mouse; click to resume.

**Bunny hopping** (Settings → Movement, on by default): hold jump to hop the instant you land with no landing
slowdown; strafe with A/D while turning the mouse the same way to build speed (capped at ~2× run speed).
Turn it off for strict CS2-style movement (tap-timed jumps, landing penalty).
The page asks before closing mid-match, so an accidental Ctrl+W (crouch + forward) won't drop you.

## Zombie Holdout (co-op)

Save-the-World-style tower defense on the **Outpost** map: the Core sits in the middle, the horde pours out
of purple storm gates on the north/east/south/west edges, and you build, harvest and fight to keep it alive.

- **Flow:** lobby (build and harvest freely, no timer) → everyone presses **Y** → 10 waves; the break between
  waves grows from 42 s to 98 s as the waves get harder (all ready = skip) → wave 5 brings **the Colossus**,
  wave 10 the **Alpha Brute**. Lose when the Core's HP hits 0. Each cleared wave pays money + materials, heals the
  Core 10 % and revives/respawns the fallen. Your best run (most waves survived, per difficulty) is kept in
  this browser and shown on the menu.
- **Directions:** each wave attacks from 1–4 lanes, announced ahead (compass markers + glowing gates) and
  shifting between waves. More players and later waves open more lanes at once.
- **Scaling with player count (n):** zombies ×(1 + 0.75(n−1)), zombie HP ×(1 + 0.2(n−1)), lanes, alive cap
  (30 + 15n) and Core HP all grow; recomputed every wave, and joins/leaves mid-wave resize what's left to spawn.
- **Zombies:** Shambler, Runner (fast), Spitter (lobs acid over walls from ~18 m — go out and kill them),
  Brute (armored wall-breaker, headshots *dink*), Alpha Brute (boss). Every swing is telegraphed — step back.
- **Building (G):** 1 wall · 2 floor · 3 ramp on a 4 m grid, wheel = wood/stone/metal, R = rotate ramp,
  LMB place (hold to turbo-build), RMB upgrade, X demolish (your own pieces), hold **E** to repair. Pieces grow to
  full HP over 2/4/7 s. Wood is shoot-through, stone lets rifles through at half damage, metal stops bullets.
  Building under yourself lifts you (ramp rushing).
- **Funnels:** zombies weigh a detour against smashing through. Wood walls get smashed; stone and metal
  forts make them walk around to your gaps — leave one opening and make it a killbox.
- **Harvesting:** your knife chops trees (wood), rocks (stone) and wrecked cars (metal). Hit the glowing
  weak point for 2.5× materials.
- **Edits (V):** aim at a wall, floor or ramp, click/drag tiles, then **V** again to confirm (RMB resets the
  piece). Walls are a 3×3 grid — take out the bottom middle two for a **door** (it swings open for players and
  survivors but zombies have to smash it), knock single tiles out for **windows**. Floors are 2×2 (holes),
  ramps split into **half ramps**. Zombies path straight through open gaps, so edits make killboxes.
- **Ladders on the Core:** climb any face to its roof (look down to climb down, jump to let go) — you can
  never wall yourself in.
- **Guns & backpack:** five gun slots on the hotbar (**1–5**, **F** = harvesting knife), Fortnite-style
  pistols, SMGs, ARs, shotguns, a Hand Cannon, rocket launcher, the SSG 08 and AWP — all with double-size
  magazines and a rarity (Common → Legendary, more damage the rarer it is). Ammo is **not** refilled: it's typed
  (light / medium / heavy / shells / rockets), capped per type and bought at the Core; zombies sometimes drop
  some. **I** opens the backpack (ammo per type, select throwables, use heals; at the team chest it also shares),
  **Z** drops the gun in your hand, **E** picks up loot (a full hotbar swaps out the gun you're holding).
- **Shop (B, inside the glowing ring around the Core):** guns, ammo, grenades / molotovs / freeze grenades
  (**T** to throw), bandages / medkits / shield potions (**H** to use, 3–6 s), floor spikes, wall darts, flame
  grills, auto turrets, rocket turrets and campfires (build mode slot **4**, wheel picks which). Team
  powerups (overshield, +30 % damage, +30 % fire rate, fortify every build, Core barrier) are pricey but anyone
  can buy one for the whole squad — or pay from the team bank.
- **Team chest** (next to the Core): deposit/withdraw money, materials, ammo and items to share them; pooled
  money is the team bank.
- **Healing the Core:** hold **E** at it to heal 60 HP/s — only one player at a time.
- **The Colossus (wave 5):** a giant zombie circles overhead bombing the fort and dropping runners. Only
  sniper rifles hurt it, and only through its six glowing weak points — buy an SSG 08 or AWP before wave 5.
  The wave doesn't end until it falls; it drops a pile of loot (incl. survivor supplies).
- **Supply drops:** balloons float a crate down now and then during waves (shoot the balloons to drop it fast);
  hold **E** to open — rare guns, ammo, items, materials. **Chests** hidden around the map (and in the houses and
  ruins) hold random loot and restock every 3 waves. Crates, barrels, rubble and pallets break for materials.
- **Rescue (waves 3 and 7):** wounded survivors appear in two corner shelters. Hold **E** to pick one up, carry
  them into the Core ring (+$500 each). They then defend the Core with weak SMGs, take posts on your floors and
  ramps, walk through your doors — but they have limited health and die if you don't protect them. Bosses drop
  survivor supplies (ammo, better SMGs, heal).
- **Teamwork:** knocked-down players crawl and bleed out in 30 s; a teammate holds **E** next to them for
  3 s to revive. Solo players respawn at the Core instead. Tab shows team stats; the end screen hands out
  Exterminator / Architect / Medic / Harvester / Rescuer awards.

Tuning lives in `shared/zombies.js` (types, scaling, wave budget), `shared/holdout.js` (ammo, items, traps,
powerups, loot, survivors, break length), `shared/skyboss.js` (the Colossus), `shared/build.js` (grid,
materials, edits), `server/holdout/room.js` (`HOLDOUT` timers/economy) and `server/holdout/flowfield.js`
(`HP_COST`, how hard zombies avoid walls).

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
- **Map** — corner platforms reachable by stairs or a wide side ramp from spawn, a sheet-metal ramp onto each
  container roof, thin plywood/sheet-metal/drywall cover to shoot through.
- **Economy/rounds** — CS2 prices, $800 start, $3250 per round win, loss bonus $1400 → $3400, per-weapon kill
  rewards (knife $1500, SMG $600, shotgun $900, AWP $100), $16000 cap. Dying loses your gear; surviving keeps it
  (with its current ammo). Respawning after a death always gives brand-new guns with full ammo.
  First to 7 rounds; sides and economy reset at halftime (after round 6). If time runs out, the player with more
  HP wins (tie → CT). Warmup (while waiting for an opponent) gives free money and instant respawns.
- **Audio** — 3D positional (HRTF) gunshots, footsteps and reloads; sounds behind walls are muffled; bullets
  snapping past your head; kill/headshot confirmation sounds.

### Weapons

★ Karambit | Case Hardened (Blue Gem, Factory New — everyone's knife) · Glock-18 · USP-S · P250 ·
Desert Eagle · MAC-10 · MP9 · P90 · Nova · Galil AR · AK-47 · M4A4 · M4A1-S · SSG 08 · AWP · Kevlar ·
Kevlar + Helmet

Every gun wears a top-tier finish (original procedural artwork in the style of the famous skins, drawn
in `public/js/skins.js`): Glock-18 | Fade · USP-S | Kill Confirmed · P250 | Asiimov · Desert Eagle | Blaze ·
MAC-10 | Neon Rider · MP9 | Starlight Protector · P90 | Death by Kitty · Nova | Hyper Beast ·
Galil AR | Chatterbox · AK-47 | Fire Serpent · M4A4 | Howl · M4A1-S | Printstream · SSG 08 | Dragonfire ·
AWP | Dragon Lore. The art runs along the whole gun, shows on your opponent's model too, and the names appear
in the HUD and buy menu in their CS rarity colors. Press F to admire them.

Reloads are tuned to Valorant/CS2 "ready to fire" times (e.g. Glock 1.8 s, USP-S 1.7 s, AK-47 2.2 s,
M4 2.5 s, AWP 3.2 s) and play staged mechanical sounds — mag release, mag out, mag in, then the charging
handle / slide / bolt — which your opponent hears positionally.

Joining a match plays a short flyover of the map before dropping into your eyes.

## Performance

The static map is merged into one mesh per material, bullet holes/particles/tracers are instanced (a few
draw calls total), shadows are rendered once, there are no dynamic lights, your camera is interpolated
between 128 Hz physics steps, the opponent is played back on the sender's clock (no network-jitter stutter),
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

- Round rules (rounds to win, timers): `RULES` in `server/room.js`
- Weapon stats, prices, spray patterns: `shared/weapons.js`
- Map layout (boxes): `shared/map.js` (Classic), `shared/lake.js` (Flying Huntsman)
- Custom mode physics/loadout: `shared/modes.js`
- Regression tests: `npm test`
- Movement constants: `P` in `shared/physics.js`
- Change the port: `PORT=8080 npm start`

## Layout

```
server.js            HTTP + WebSocket server, room registry
server/room.js       round flow, economy, damage + buy validation (server-authoritative)
server/bot.js        practice bot (A* navigation, reaction time, aim error)
server/holdout/      Zombie Holdout: room (waves, building, edits, revives), director, zombie AI, flow field,
                     inventory (backpack/shop/team chest/pickups), combat (throwables/rockets), defenses
                     (traps/turrets), survivors, skyboss (the Colossus), events (chests/supply drops)
shared/              weapons, maps, physics/hitboxes, building grid, zombie types, holdout gear, Colossus path
public/js/           client: game loop, movement, weapons, HUD, audio, models, networking
public/js/holdout.js Zombie Holdout client (+ zombies.js horde, build.js pieces/build+edit mode,
                     holdout_ents.js loot/traps/survivors/Colossus, holdout_ui.js hotbar/shop/backpack/records)
```
