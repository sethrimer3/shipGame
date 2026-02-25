# DECISIONS

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
