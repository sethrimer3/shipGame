# DECISIONS

## 2026-03-02 — Visual polish pass (Build 49)

### Floating module ember glow (`src/world.ts`)
- Freshly detached enemy ship modules now glow orange (additive `#ff7700` with `shadowBlur = 8`) when `hpRatio > 0.35`. The glow fades linearly as the fragment cools/dies, giving a visceral sense of hot wreckage spinning through space.

### Gunship engine exhaust (`src/gunship.ts`)
- Gunships now emit a per-frame cyan engine exhaust trail from the rear engine module position (col=-1), matching the aesthetic already established for drones and interceptors in Build 48. Trail particles are `glow: true` for additive blending.

### Enemy base-class engine exhaust (`src/enemy.ts`)
- All base `Enemy` ships (Scout → Capital Ship) now emit a glowing cyan exhaust trail while in `chase` or `attack` state. Particles spawn from 2 block-lengths behind the nose, giving each pursuing enemy a visible engine wake that makes combat more dynamic.

### Mothership weapon module pulsing glow (`src/mothership.ts`)
- Laser modules (`#ff2222`), rocket modules (`#ff8800`), and drone bay modules (`#22dd44`) now render a per-module pulsing `lighter`-composite glow each frame. The pulse frequency and phase offset varies per module column/row, giving motherships a menacing armed appearance with visible weapon "heartbeats".

### Minimap tactical corner ticks (`src/game.ts`)
- The minimap border now has L-shaped corner tick marks (6px, `rgba(120,220,255,0.7)`, 1.5px line) at all four corners, styled as a tactical HUD display. The main border opacity was also raised slightly (0.35→0.45) for better visibility.

## 2026-03-02 — Visual polish pass (Build 48)

### Interceptor engine trail glow + charging aura (`src/interceptor.ts`)
- Exhaust trail particles now carry `glow: true` for vivid additive blending (consistent with Build 47 particle glow system).
- When `_isTargetingPlayer` is true, a semi-transparent `lighter`-blended radial fill at radius 14 is drawn around the interceptor in its tier colour before the body, giving a threatening red charging-up effect. The body shape itself also gets `shadowBlur = 10` while charging.

### Drone engine exhaust (`src/drone.ts`)
- Added a per-frame engine exhaust trail to the drone (cyan `#7fd9ff`, mirroring its engine module colour, `glow: true`). Previously drones had no engine FX; they now leave a glowing blue wake consistent with other ships.

### Player low-HP critical aura (`src/player.ts`)
- When `coreHp / maxCoreHp < 0.45`, a pulsing radial red glow is drawn around the player ship using `globalCompositeOperation = 'lighter'`.
- Pulse frequency increases as HP approaches zero (1.5 → 5.5 Hz). Gradient fades from red centre out to transparent at 2.8× ship radius.
- Gives the player a visceral "danger" feel when their core is about to fail, distinct from the edge-vignette danger indicator (which is enemy proximity, not ship HP).

### Placed block bevel highlight (`src/world.ts`)
- Placed blocks in the world now draw the same top-left L-stroke bevel (`rgba(255,255,255,0.22)`) that asteroid blocks received in Build 47. This makes player-constructed structures visually consistent with the environment.

### Zone transition banner glow (`src/game.ts`)
- Replaced the 2-pass drop-shadow zone name with a two-pass glow: first pass draws the zone name with `shadowColor = bannerColor; shadowBlur = 24`, second pass draws a bright white overlay at `shadowBlur = 8` for a neon bloom. Gives the zone name a vivid cinematic pop.

### Asteroid turret muzzle glow (`src/asteroid.ts`)
- The turret barrel tip (rightmost 3px rect) is now tinted `#ff8800` with `shadowColor = #ff6600; shadowBlur = 8`, giving each mounted turret a visible hot-muzzle orange glow that makes them easier to spot before they fire.

## 2026-03-02 — Visual polish pass (Build 47)

### Richer nebula palette (`src/world.ts`)
- Expanded nebula colour palette from 6 to 8 distinct hues (deep violet, cobalt blue, rose, teal, purple, amber-orange, bright blue, alien green).
- Raised inner-cloud opacity from 0.14–0.18 to 0.22–0.30 so nebulas are clearly visible as atmospheric space colour against the dark background.
- Slightly enlarged nebula blobs: `radiusA` range increased from 280–700 to 320–800, `radiusB` from 180–500 to 200–560. Both changes make the colourful space atmosphere more pronounced without adding runtime cost.

### Glowing explosion particles (`src/particle.ts`)
- Added optional `glow?: boolean` field to the `Particle` interface.
- When `glow` is `true`, `drawParticle()` draws the particle using `globalCompositeOperation = 'lighter'` inside a save/restore block, making overlapping explosion sparks additively brighten (natural glow without `shadowBlur`).
- `makeExplosion()` now sets `glow: true` on all generated particles, giving every explosion a vivid luminous burst effect. Cost is bounded to explosion events (22 particles maximum per large detonation).

### Floating damage text glow (`src/particle.ts`)
- `drawFloatingText()` now sets `ctx.shadowColor = f.color` and `ctx.shadowBlur = 7` before rendering each floating number, replacing the old 1-pixel drop-shadow trick.
- The glow colour matches the text colour (yellow for XP, orange for crits, etc.) so combat feedback is immediately readable. Shadow is reset to 0 after each draw to avoid state leakage.

### Block top-left bevel highlight (`src/block.ts`)
- Each block now draws a two-segment white stroke (top edge + left edge) at `rgba(255,255,255,0.22)` after the damage overlay, giving asteroid and placed blocks a subtle bevelled 3D appearance.
- The grid outline stroke still draws on top to preserve the dark grid seam. Total extra cost: 2 line draws per visible block per frame.

### Enemy core module glow (`src/enemy.ts`)
- The core module of each enemy ship is now rendered with `ctx.shadowColor = m.baseColor; ctx.shadowBlur = 10`, giving it a coloured glow that matches the enemy tier colour.
- This makes the core (the kill target) visually distinct from non-core modules, improving target readability without altering gameplay.

### Background gradient enhancement (`src/game.ts`)
- Shifted the radial centre stop from `#0b0e1a` to `#0d1022` (slightly more blue-purple) and mid stop from `#070b14` to `#080c18`, giving the deep space background a richer feel.

## 2026-03-02 — Visual polish pass (Build 46)

### Space background radial gradient (`src/game.ts`)
- Replaced the flat `#06080f` fill with a `createRadialGradient` centred on the viewport, going from `#0b0e1a` (centre) to `#03050d` (edges).
- Creates a subtle sense of depth and focal pull toward the screen centre without adding extra geometry.

### Enhanced engine exhaust (`src/player.ts`)
- Replaced the single cyan `fillRect` with a three-layer `lighter`-blended flame:
  - **Wide cone** (blue-30% alpha) — outer glow body that scales with engine count.
  - **Mid flame** (cyan-72% alpha) — main visible exhaust.
  - **White-hot inner core** (95% alpha) — bright hotspot tip closest to the engine nozzle.
- Uses `globalCompositeOperation = 'lighter'` so the layers add colour instead of painting over each other.

### Enhanced shield bubble (`src/player.ts`)
- Replaced the single thin stroke with a two-layer bubble: a wide soft `lighter`-blended glow ring + a sharper inner stroke with `shadowBlur` proportional to shield ratio.
- Gives the shield a physical "energy field" appearance that dims naturally as HP drops.

### Projectile velocity streak trail (`src/projectile.ts`)
- `Projectile.draw()` now draws a semi-transparent lineTo stroke from `prevPos` to `pos` before the solid core (lineWidth = radius × 1.4, alpha 0.5, `shadowBlur` 6).
- The bright core renders on top with `shadowBlur = 12`, and a soft outer halo at `globalAlpha = 0.28` replaces the old manual radius-2.5 circle hack.

### Level-up expanding rings (`src/game.ts`)
- On level-up, three cascading golden rings (`_levelUpRings` array) are spawned with staggered `maxLife` values.
- Each ring expands from radius 30 to 230 px (screen-space) over its lifetime, fading out with a `lighter`-blended gold stroke and `shadowBlur = 18`.
- A light camera shake (1.5 units) accompanies the ring burst.

### Station core pulsing glow (`src/station.ts`)
- Infinity-pattern center modules now emit a per-module radial gradient glow blended with `lighter`, pulsing at ~1.8 Hz (using `performance.now()`).
- The modules themselves shimmer slightly (brightness varies ±7% per-module using position-based phase offset).
- Station turrets now draw with `shadowBlur = 8` for a subtle defensive aura.

### Mothership ominous glow (`src/mothership.ts`)
- Before rendering modules, a large `lighter`-blended radial gradient glow is drawn centred on the mothership position, tinted with the tier's color.
- Radius scales to `gridRadius × MODULE_SIZE + 20` so larger motherships have proportionally bigger halos.

### Enhanced resource & health pickups (`src/world.ts`)
- **Resource pickups** now render as a spinning diamond shape (rotates at 1.8 rad/s with per-pickup phase offset) with an outer soft halo ring and a bright inner diamond highlight.
- **Health pickups** now have an outer glow ring pulse alongside the cross symbol; the cross center has a pale inner highlight for contrast.
- Both use `nowSec` (computed once per `draw()`) for consistent per-second animation.

### CSS HUD polish (`style.css`)
- HUD bars now have `box-shadow` glows matching their color (health red, shield blue, XP yellow, overheat orange).
- `#hud-top` gains a subtle blue-tinted bottom border and `backdrop-filter: blur(4px)`.
- Level display has a golden text-shadow glow.
- Notification element styled with a blue border, `text-shadow`, and `box-shadow` for a premium feel.
- Toolbar gets a blue-tinted border glow and `inset` highlight.



### Planetary atmospheric glow (`src/planet.ts`)
- Each planet now renders a soft radial gradient halo in the `draw()` call using its cached `_minimapColor` as the tint.
- The atmosphere extends from 88% to 128% of the planet radius with a three-stop gradient (transparent inner → tinted middle → transparent outer) blended with `lighter` composite operation.
- The halo color naturally reflects the dominant surface material (sandy orange for dune worlds, blue-green for water worlds, red for lava-heavy planets).

### Procedural nebula patches in world chunks (`src/world.ts`)
- Each world chunk may generate 0–2 elliptical nebula blobs from a fixed six-color palette.
- Nebula blobs are stored as `NebulaPatch` data (position, semi-axes, rotation, inner/outer RGBA) in the `Chunk` interface so they are deterministic per seed and never reallocated.
- Drawn at the start of `World.draw()` using `globalCompositeOperation = 'lighter'` so they add color to the background without obscuring geometry.
- Ellipses use `ctx.scale(radiusA, radiusB)` to avoid creating path objects per frame.

### Planet size reduction (`src/world.ts`)
- `PLANET_MIN_RADIUS` reduced from 240 to 190 world units (~21%).
- `PLANET_MAX_RADIUS` reduced from 480 to 380 world units (~21%).
- Directly reduces molecule count per planet (scales quadratically with radius), cutting per-frame simulation and draw cost for planet-heavy views.

### Graviton Pulse ability — G key (`src/player.ts`, `src/game.ts`, `src/world.ts`)
- Press **G** to fire a Graviton Pulse: a radial shockwave (320 wu radius) that pushes all nearby enemies outward.
- Costs 45 overheat units; has a 12-second cooldown tracked in `player.gravitonPulseCooldownSec`.
- `Player.tryGravitonPulse(overheatCost)` returns `true` on success and starts the cooldown.
- `World.applyGravitonPulse(pos, radiusWorld, pushForce)` iterates cached active chunks and applies an inverse-distance impulse to all alive enemy `vel` vectors; returns the count of enemies pushed.
- Visual: an expanding double-ring stroke drawn in world-space (`_shockwaveRings` array in `Game`), blended with `lighter`, fading over 0.7 s.
- HUD: a small text + progress bar in the bottom-right shows `⚛ [G] READY` or `⚛ [G] Ns` for remaining cooldown.



### Organic dunes, trough water, and mountain peaks (`src/planet.ts`)
- Planet terrain now uses deterministic angular terrain samples (`TERRAIN_SAMPLE_COUNT = 192`) generated from the planet RNG seed to build dune-like sand height variation.
- Water is no longer a full outer shell: shallow water pockets are placed only in local terrain troughs, while mountain bands remain dry.
- Stone mountains are generated as angular ridge bands that start near the inner strata (`MOUNTAIN_ROOT_RATIO`) and extend toward/above the sand surface into peaks.

### Plants only on exposed sand + square organic growth (`src/planet.ts`)
- Plants are now seeded only from exposed surface sand molecules (not water, stone, or buried sand).
- Plant rendering changed from single lines to small square cells with lateral drift and occasional side cells so growth reads as organic vegetation clusters.

### Smaller molecules + event-driven updates (`src/planet.ts`)
- Reduced `POWDER_SIZE` from 15 to 5 (one-third), increasing visual terrain fidelity.
- Added active-molecule tracking (`_activeMoleculeIndices` + `_isMoleculeActive`) so only disturbed/impacted molecules are integrated each frame; settled molecules are removed from the active list and skipped entirely until reactivated.
- Disturbance and impact paths now explicitly reactivate affected molecules.

## 2026-02-26 — Non-invasive hot-path allocation elimination

### Per-chunk and top-level array compaction (`src/world.ts`)
- Replaced all 12 `.filter()` calls in `World.update()` with the same in-place compaction pattern already used for `projectiles`, `particles`, and `floatingTexts` in `game.ts` (decision from 2026-02-25).
- Per-chunk entity arrays (`enemies`, `asteroids`, `motherships`, `turrets`, `interceptors`, `gunships`, `bombers`) and top-level arrays (`drones`, `pickups`, `healthPickups`, `placedBlocks`, `floatingModules`) now use `let j=0; for ... arr[j++]=arr[i]; arr.length=j`.
- With 49 active chunks and 7 filtered entity types per chunk, this eliminates up to ~340 temporary array allocations per frame in steady-state gameplay.

### Interceptor ram-collision particle spawn (`src/world.ts`)
- Replaced `particles.push(...Array.from({ length: 14 }, ...))` with an explicit `for` loop of 14 `particles.push(...)` calls. This avoids creating a temporary array and then spread-copying it into `particles`.

### Single `getMinimapData()` call per frame (`src/game.ts`)
- `_drawMinimap()` and `_drawEnemyIndicators()` each previously called `world.getMinimapData(camPos)` independently. Since both methods are called back-to-back inside `if (this.player.alive)` in `draw()`, the call site now fetches the data once and passes it to both methods as a parameter, halving the minimap-related array allocations per frame.

## 2026-02-25 — Continued performance optimization

### `_activeChunks()` per-frame caching (`src/world.ts`)
- `_activeChunks(camPos)` is called up to 4× per frame (`update`, `draw`, `getShadowOccluders`, `getMinimapData`) and previously allocated a new 49-element array on every call.
- A `_cachedChunkKey` string (formed from `cx0,cy0`) and `_cachedChunks` array are now maintained. The cached array is returned as-is when the key matches, rebuilding only when the camera crosses a chunk boundary (every 1200 world units). This eliminates three unnecessary array allocations per frame under normal gameplay.
- `resetForLoop()` clears both fields so the cache does not survive across runs.

### Planet molecule simulation at-rest skipping (`src/planet.ts`)
- `Planet.update()` now skips the spring-physics integration for any molecule whose squared displacement from rest is < 0.01 **and** whose squared velocity is < 0.25. These molecules have already settled; re-integrating them produces no visible movement.
- At steady state (no recent impacts or disturbances) almost all molecules qualify, cutting the per-frame planet update from O(molecule_count) arithmetic to just threshold comparisons.

### Planet molecule render batching (`src/planet.ts`)
- Molecules are sorted by color string once at the end of `_generateMolecules()`. Because molecule colors never change, this order is stable for the lifetime of the planet.
- `draw()` now uses a running `batchColor` string; when the color changes it closes the previous `beginPath()` batch with a single `fill()` call and opens a new one. This groups ~1–15 unique colors per planet into batched `ctx.rect()` calls rather than one `ctx.fillRect()` call per molecule, significantly reducing 2D context state changes.

### In-place array compaction (`src/game.ts`)
- The `splice(0, length, ...filter(...))` pattern for `projectiles`, `particles`, and `floatingTexts` was replaced with explicit in-place compaction loops (`let j=0; for ... if(alive) arr[j++] = arr[i]; arr.length = j`). This eliminates one intermediate array allocation and one spread-copy per array per frame.

### Quality-gated planet molecule simulation (`src/graphics-settings.ts`, `src/world.ts`)
- Added `planetMoleculeSimulation: boolean` to `GraphicsConfig`. Set to `false` at **Low** quality, `true` at **Medium** and **High**.
- When `false`, `Planet.update()` skips the entire molecule physics loop (only plants are updated). This is the single biggest CPU savings at Low quality when planets are in view.
- `World.update()` accepts `config: GraphicsConfig` and passes `!config.planetMoleculeSimulation` to `planet.update()`.

## 2026-02-25 — Graphics quality settings and post-process shaders

- Added three quality presets (Low / Medium / High) selectable from the Settings panel (Tab).
- **Low**: 35% of stars rendered, no star halos, no chromatic aberration, no particle trails, no sun bloom, no shadow rays, no post-process effects. Best for weaker hardware.
- **Medium**: 65% of stars, halos enabled, no chromatic aberration, 2 sun bloom passes, shadow rays enabled, vignette shader only.
- **High** (default): 100% stars, all effects on, 4 bloom passes, vignette + bloom post-process shaders.
- Created `src/graphics-settings.ts` for the `GraphicsQuality` type, `GraphicsConfig` interface, and `QUALITY_PRESETS` record.
- Created `src/post-process.ts` (`PostProcessRenderer`): vignette draws a radial gradient over screen edges; bloom copies the rendered frame to an offscreen canvas, blurs it with `ctx.filter='blur(6px)'`, then blits it back with `screen` blending at α=0.22.
- `StarfieldRenderer.draw()` now accepts `GraphicsConfig` and limits `drawCount` per layer via `starCountMultiplier`; skips halo and chromatic-aberration draw-calls based on flags.
- `SunRenderer.draw()` / `drawSunRays()` now accept `GraphicsConfig`; bloom-step count is a parameter (0 = skip bloom); shadow-ray pass is skipped when `sunShadowRays` is false.
- `drawParticle()` accepts an optional `skipTrails` flag; when true the motion-blur stroke is not drawn.

## 2026-02-25 — Per-module shadow occluders for ships

- Each ship class (`Player`, `Enemy`, `Mothership`) now exposes a `getModuleShadowOccluders()` method returning one rotated quad per alive module instead of a single bounding-box AABB.
- `Player` and `Enemy` compute rotated quads using `cos(angle)`/`sin(angle)` with precomputed half-extents (`hc = half * cosA`, `hs = half * sinA`) to minimize per-module arithmetic.
- `Mothership` does not rotate, so its occluders are simple axis-aligned AABBs per module, which is cheapest to compute.
- `game.ts` replaced the single player AABB with `player.getModuleShadowOccluders()`.
- `world.ts` `getShadowOccluders` replaced single enemy/mothership AABBs with `getModuleShadowOccluders()`.
- Result: shadows now visually follow the ship outline (module-shaped silhouettes) rather than a large uniform square.

## 2026-02-25 — Refactoring: extract SpaceStation from world.ts

- Extracted the space station subsystem from `world.ts` into a dedicated `src/station.ts` module, continuing the refactoring plan started in the "split monolithic files" PR.
- `SpaceStation` class owns all station state: ring modules, infinity center modules, and defensive turrets. It exposes `reset()`, `update(dt, targets, projectiles)`, `draw(ctx)`, `consumeBeamShots()`, and `getSpawnPosition()`.
- `STATION_RESET_RADIUS_WORLD` and `STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD` are exported from `station.ts` and re-imported by `world.ts` for chunk-generation safe-zone and sapphire-armor checks respectively.
- `world.ts` shrank from 1417 → 1288 lines. The station-specific constants and interfaces are no longer duplicated in the world file.



- **3× planet size**: `PLANET_MIN_RADIUS` raised from 80 to 240, `PLANET_MAX_RADIUS` from 160 to 480 (world units). `POWDER_SIZE` increased from 10 to 15 to keep molecule count manageable (~4× instead of ~9×).
- **Natural impact physics**: Projectiles now stop on the first frame they enter a planet's radius (instead of passing through). A localized `impactAt(hitPos, force)` method kills molecules within `IMPACT_CRATER_RADIUS` (22 wu), giving them outward velocity as ejected splash particles, and pushes nearby molecules outward within `IMPACT_SPLASH_RADIUS` (55 wu). Material type scales the response: water splashes 1.6× faster than rock (1.0×), lava barely moves (0.25×).
- **Plants**: Each planet grows 24–64 plants (radial line segments, 8–30 wu long) from its surface outward, using seeded RNG for position and color. Plants grow at 14 wu/s. When an impact occurs within `PLANT_BURN_RADIUS` (90 wu), nearby plants ignite and burn over ~2.6 s (orange → dark red → gone).
- **Particle motion-blur trails**: `Particle` interface gains optional `trail` and `prevPos` fields. When `trail = true`, `updateParticle` records the previous position each frame. `drawParticle` draws a semi-transparent stroke from `prevPos` to `pos` (lineWidth = radius × 1.5, alpha 0.35) when the particle speed exceeds 15 wu/s, simulating motion blur. Planet splash particles are created with `trail = true`.
- **Minimap planet circles**: `getMinimapData()` now returns a `planets` array with `{ pos, radius, color }`. The minimap draws each planet as a large filled circle whose color reflects the actual visual surface state (sampled from ~40 surface-layer molecules, averaged to a hex color, refreshed every 2.5 s).



- **Water surface**: Outer molecules (d/radius > 0.78) on every planet are now colored with water blues (`#1e90ff`, `#00bfff`, etc.) to represent a surface ocean layer.
- **Molten lava core**: Inner molecules (d/radius < 0.38) are colored with lava tones (`#ff4500`, `#ff6600`, `#ffaa00`, etc.). A radial gradient glow (yellow → orange → transparent) is rendered beneath those molecules each frame for a magma-heat visual effect.
- **Planetary gravity**: Planets now exert gravitational attraction on the player ship and all enemy ships (enemies, gunships, bombers, interceptors, drones). Formula: `accel = PLANET_GRAVITY_STRENGTH * planet.radius / max(d², 400)` applied within `planet.radius + PLANET_GRAVITY_RANGE` (600 wu). Larger planets attract more strongly; closer proximity increases acceleration (inverse-square falloff). Gravity is skipped when the ship is already inside the planet body (d < planet.radius) to avoid runaway acceleration.

## 2026-02-25 — Per-item module categories

- Crafting recipes now grant per-item module types (for example `basic_cannon`, `laser_beam`, `shield_gen`) instead of only broad shared module categories.
- Gameplay stat scaling remains family-based (`hull`, `engine`, `shield`, `coolant`, `weapon`, `miningLaser`) via a type→family mapping so balance remains predictable.
- Upgrade tiers are now tracked per-item module type while family stats aggregate the connected modules' tier weight.
- Ship editor palette now exposes per-item module entries so crafted modules can be placed, recycled, and upgraded directly.

## 2026-02-25 — Planets with powder-molecule gravity

- Added `Planet` class (`src/planet.ts`): large bodies composed of small powder squares (10 px, half of the player's 20 px module blocks).
- Each planet is a grid of `PowderMolecule` objects placed in a circular arrangement (radius 80–160 world units). Molecules use a spring-toward-rest-position force (GRAVITY_K = 60 units/s² per unit displacement) with per-tick velocity damping to simulate gravitational attraction back to the planet center.
- Planets can be disturbed: projectiles passing within `PLANET_DISTURB_RADIUS` (70 wu) of the planet center push nearby molecules outward proportional to proximity and projectile damage; molecules then drift back under gravity.
- Planets are generated per-chunk (one per chunk, 25% chance, minimum 500 wu from origin) using the deterministic seeded RNG so the world remains reproducible.
- Planet color is chosen from one of six palettes (sandy, rocky, alien-green, purple, ice-blue, ochre) seeded by the same RNG.
- Rendering uses per-molecule `fillRect` (POWDER_SIZE × POWDER_SIZE) with frustum culling at both the planet and molecule level to keep performance within budget.

- Added `Gunship` enemy (`src/gunship.ts`): a heavy twin-cannon flanker with weapon modules on both wings. Fires dual simultaneous shots. Three tiers (0–2) scaling with world distance (appears from 1 200 units out).
- Added `Bomber` enemy (`src/bomber.ts`): an armored long-range ship with a forward torpedo launcher. Kites the player at optimal range and fires slow, high-damage bomb projectiles. Three tiers, appearing from 2 500 units out.
## 2026-02-25 — Mobile controls

- Added responsive mobile controls that activate automatically on touch-capable devices (`'ontouchstart' in window || navigator.maxTouchPoints > 0`).
- On load, the game attempts to lock the screen to landscape orientation via `screen.orientation.lock('landscape')` (silently ignored when the browser does not permit it).
- Two floating virtual joysticks are rendered in the bottom-left (movement) and bottom-right (aim/fire) corners.
  - **Left joystick**: thumb displacement maps to virtual WASD keys (simple world-axis movement).
  - **Right joystick**: thumb displacement sets a virtual mouse-aim position at 800 px from the canvas centre in the stick direction; a push magnitude > 0.4 (normalised) also sets `mouseDown = true` to fire weapons.
- A **"⚙ Ship"** button (top-left below HUD) and a **"☰"** button (top-right below HUD) open/close the Ship Builder and Settings panels respectively.
- Any finger drag directly on the game canvas (outside the joystick elements) acts as a right-click drag for block placement.
- The desktop toolbar hint bar is hidden via `body.is-mobile #toolbar-hint { display: none }` to save screen space.


## 2026-02-25 — Time-loop station + run reset economy

- Added a persistent **time-loop run model**: when the ship is destroyed and the player restarts, all non-gem materials are wiped while gems are retained.
- Added a destructible circular **space station ring** around origin with built-in defensive turrets.
- Added non-destructible white center modules in an infinity pattern to visually mark the time-loop theme.
- Added an **auto-crafting / auto-build** pipeline that preserves the saved ship design blueprint across runs and rebuilds missing modules from the center outward when recipe resources become available.
- Design choice for consistency/performance: station geometry is deterministic and generated from fixed ring/loop points at reset.


## 2026-02-26 — Auto-build now restores destroyed modules from live ship state

- Auto-crafting now computes missing blueprint slots from **alive runtime modules** instead of the static saved layout, so destroyed modules are rebuilt automatically once resources are available.
- Build priority remains inside-out by orthogonal Manhattan distance from the core, but crafting only occurs on slots that are currently craftable and orthogonally connected to already-built modules.
- Implementation uses key-set neighbor checks for 4-direction adjacency to keep the per-frame auto-build pass predictable and allocation-light.

## 2026-02-26 — Rebirth flow + procedural rebuild animation

- The death-screen restart prompt now uses an explicit rebirth button label: desktop shows `[Rebirth (R)]`, mobile shows `[Rebirth]`.
- On rebirth, the ship now respawns as core-only and plays a short flash, then runs accelerated auto-build for a brief window to visibly reconstruct the saved blueprint.
- Rebirth starts with a deterministic per-module resource pool sized to always rebuild the default starter ship (`11 hull`, `2 engine`, `1 miningLaser`), while preserving room for future permanent starting-resource upgrades.
- Gems still carry over between loops; non-gem inventory still resets.


## 2026-02-28 — Planet impact collapse detaches unsupported crust

- Planet impacts now run a local support scan around the blast and detach non-lava molecules that no longer have inward support toward the core.
- Detached molecules are emitted through the existing `SplashParticleData` path as loose world particles, so mountain overhangs collapse instead of floating after their base is removed.
- This keeps the collapse behaviour predictable and localized (bounded by impact radius scaling) while preserving performance by avoiding per-frame global terrain connectivity checks.

## 2026-03-02 — Kill combo system + new gem shop upgrades + enemy gem drops

### Kill combo system (`src/game.ts`)
- Consecutive kills within a 4-second window build a combo streak tracked in `_killComboCount`.
- Starting at 2× combo, each kill awards bonus XP (`comboCount × 5`) and shows a `N× COMBO! +XP` floating text above the player.
- At 5× or higher combos, a light camera shake fires to reinforce the feel.
- Combo resets automatically when the 4-second window expires between kills.

### Two new gem shop upgrades (`src/types.ts`, `src/player.ts`, `src/game.ts`)
- **Hull Regen** (Sapphire, up to Lv 4): +1 HP/s passive hull repair per level. Applied via `player.passiveHpRegenPerSec` each frame in `player.update()`.
- **Engine Overdrive** (Diamond, up to Lv 3): +10% top speed per level. Applied via `player.permanentSpeedBonus` folded into `topSpeedMultiplier`.

### Enemy gem drops (`src/world.ts`)
- Enemies killed at distance ≥ 2000 wu have a small chance of dropping a gem pickup in addition to normal material loot.
- Drop rate scales with zone depth: 3% at 2000 wu, 6% at 5000 wu, 12% at 10 000 wu.
- Gem type is drawn from `pickGem(dropDist)` so rarity scales naturally with world distance.

## 2026-03-02 — Critical hits + Cluster Bomb weapon + Emergency Shield Boost

### Critical hit system (`src/world.ts`)
- Player projectiles have a 15% (`PLAYER_CRIT_CHANCE`) chance to deal 2× damage on hit.
- Critical hits show an orange `-N CRIT!` floating text instead of the normal yellow `-N` text, giving clear feedback.
- Crits do not apply to `StationBeam` projectiles (which have separate sapphire-armour logic).

### New craftable weapon: Cluster Bomb (`src/types.ts`, `src/game.ts`)
- New `ShipModuleType` `'cluster_bomb'` added, in the `'weapon'` family.
- Recipe: 4× Iron + 2× Gold + 3× Rock. Fires **5 projectiles in a 120° arc** (`spreadArcRad: Math.PI * 2 / 3`).
- `spreadArcRad` optional field added to `ToolbarItemDef` so each weapon can declare its own spread angle (default 20° if omitted).
- Player firing code in `player.ts` reads `weapon.spreadArcRad ?? (Math.PI / 9)` instead of the old hard-coded constant.

### Emergency Shield Boost – E key (`src/player.ts`, `src/game.ts`)
- Press **E** to instantly convert 35 units of overheat energy into up to 40 shield points.
- Implemented via `player.tryEmergencyShieldBoost(shieldAmt, overheatCost)` – returns 0 if shield is full or overheat is insufficient.
- Shows HUD feedback message and a small camera shake on activation.
- `_shieldBoostKeyHeld` flag prevents repeat-fire from a held key.

## 2026-03-02 — Gem Shop upgrades + Personal-best stats + Danger proximity indicator

### Two new Gem Shop upgrades (`src/types.ts`, `src/player.ts`, `src/game.ts`)
- **Crit Mastery** (Ruby, Lv 3): +5% critical hit chance per level. Applied via `player.critChanceBonus`; world.ts reads `PLAYER_CRIT_CHANCE + player.critChanceBonus` for each hit roll. Crit is now consistent across all enemy types (ships, drones, interceptors, gunships, bombers).
- **Rapid Reload** (Quartz, Lv 3): +8% weapon fire rate per level. Applied via `player.permanentFireRateBonus` folded into `weaponFireRateMultiplier`.

### Personal-best run stats (`src/game.ts`)
- Tracks best kills, best level, best survival time, and best max distance across all runs.
- Stats are persisted to `localStorage` under key `shipGame_personalBest` and loaded at startup.
- On the death screen, a yellow "Best — ..." summary row is drawn when any records exist.
- `_savePersonalBest()` is called on the frame the player transitions from alive → dead.

### Danger proximity indicator (`src/game.ts`, `src/world.ts`)
- A pulsing red screen-edge radial gradient appears when any enemy is within 200 world units.
- Intensity scales from 0 at 200 wu to full at 120 wu; pulses at ~2 Hz using `gameTime`.
- `world.nearestEnemyDistSq(fromPos)` reuses `_cachedChunks` (no extra chunk lookups per frame).
