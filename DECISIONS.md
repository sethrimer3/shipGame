# DECISIONS

## 2026-02-25 — Per-item module categories

- Crafting recipes now grant per-item module types (for example `basic_cannon`, `laser_beam`, `shield_gen`) instead of only broad shared module categories.
- Gameplay stat scaling remains family-based (`hull`, `engine`, `shield`, `coolant`, `weapon`, `miningLaser`) via a type→family mapping so balance remains predictable.
- Upgrade tiers are now tracked per-item module type while family stats aggregate the connected modules' tier weight.
- Ship editor palette now exposes per-item module entries so crafted modules can be placed, recycled, and upgraded directly.

## 2026-02-25 — New enemy types: Gunship and Bomber

- Added `Gunship` enemy (`src/gunship.ts`): a heavy twin-cannon flanker with weapon modules on both wings. Fires dual simultaneous shots. Three tiers (0–2) scaling with world distance (appears from 1 200 units out).
- Added `Bomber` enemy (`src/bomber.ts`): an armored long-range ship with a forward torpedo launcher. Kites the player at optimal range and fires slow, high-damage bomb projectiles. Three tiers, appearing from 2 500 units out.
- Both enemy types use the same module-block visual convention (hull / red weapon / cyan engine) as existing enemies and integrate with the existing projectile, collision, minimap, and XP systems.
