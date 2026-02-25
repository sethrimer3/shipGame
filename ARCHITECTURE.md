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

## Data flow

1. Recipe crafted -> per-item `moduleType` added to palette.
2. Player places that module type in ship editor.
3. On save, module slots are applied to player layout.
4. Runtime stat recomputation maps each module type to its family and accumulates family stats.
