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
shared/              weapons, map, physics/hitboxes — used by both server and browser
public/js/           client: game loop, movement, weapons, HUD, audio, models, networking
```
