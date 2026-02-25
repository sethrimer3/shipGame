# ARCHITECTURE

## Module model

- `src/types.ts`
  - Defines `ShipModuleType` (per-item module types + legacy structural categories).
  - Defines `ShipModuleFamily` and `SHIP_MODULE_FAMILY_BY_TYPE` for family aggregation.
- `src/crafting.ts`
  - Crafting adds equipment and inserts a module palette entry using recipe `moduleType`.
- `src/player.ts`
  - Stores placed module slots as `ShipModuleType`.
  - Recalculates connected-module family counts and family tier weight for runtime stats.
  - Keeps upgrade tiers per module type.
- `src/game.ts`
  - Ship editor palette is driven by `MODULE_EDITOR_CONFIG` (now includes per-item module types).
  - Preview stats aggregate pending slot module types into family counts.

## Space station

- `src/station.ts`
  - Self-contained `SpaceStation` class: ring modules, infinity center modules, defensive turrets.
  - `update(dt, targets, projectiles)` handles incoming enemy projectile hits and turret firing.
  - `draw(ctx)` renders all station geometry.
  - `reset()` rebuilds station state on loop restart.
  - Exports `STATION_RESET_RADIUS_WORLD` (chunk safe zone) and `STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD` (armor immunity threshold) for use in `world.ts`.

## Data flow

1. Recipe crafted -> per-item `moduleType` added to palette.
2. Player places that module type in ship editor.
3. On save, module slots are applied to player layout.
4. Runtime stat recomputation maps each module type to its family and accumulates family stats.

## Time-loop and station systems

- `src/world.ts`
  - Owns a resettable station model (`stationModules`, `stationTurrets`) separate from chunk content.
  - Provides `resetForLoop()` to restore world chunks + station to pristine state.
  - Station turrets scan nearby hostile entities and fire player-owned projectiles.
- `src/game.ts`
  - Handles run reset without page reload (`_resetRunAfterDeath`).
  - Preserves only gem inventory on reset and re-initializes starter ship/toolbar state.
  - Stores a persistent ship blueprint (`_autoBuildBlueprintSlots`) and auto-crafts missing modules in orthogonally connected, inside-out order.

## Updated run flow

1. Player dies -> death overlay appears.
2. Press `R` -> game performs in-memory loop reset (no hard reload).
3. World/station are rebuilt; player respawns at station center.
4. Gems persist; other resources are cleared.
5. As resources are re-collected, auto-crafting rebuilds saved design from the center outward.
