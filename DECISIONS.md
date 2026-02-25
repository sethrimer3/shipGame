# DECISIONS

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

