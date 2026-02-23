# AI Agent Guidelines for shipGame Repository

This document defines expectations for AI agents working on shipGame. The goals are **clarity**, **performance**, and **stable gameplay behavior**.

---

## 1. Determinism & Consistency (Prefer Predictable Results)
While shipGame is not a deterministic multiplayer sim, gameplay should still feel stable and consistent.
- Avoid frame-dependent logic errors (always scale by `deltaTime`).
- Avoid hidden randomness without a clear seed or documented reason.
- If adding procedural generation, document the seed/inputs in `DECISIONS.md`.

---

## 2. Tech Stack Scope
- Core code is **TypeScript**.
- JavaScript should only be used for tooling or external integration.
- Keep strict typing and avoid implicit `any`.

---

## 3. Performance Expectations
ShipGame runs many entities and particles. Aim for smooth 60 FPS.

**Hot-path rules:**
- Avoid creating new objects in per-frame loops.
- Use `for` loops instead of `map/filter/reduce` in hot paths.
- Reuse arrays/objects when possible.

---

## 4. Naming Guidelines (Must Follow)
### General
- **State**: nouns (`position`, `velocity`, `health`)
- **Actions**: verbs (`move`, `fire`, `spawn`)
- **Commands**: imperative verbs (`fireWeapon`, `spawnAsteroid`)

### Booleans
Booleans **must** start with `is`, `has`, `can`, `should`, or `needs`.

### Counts / Indices / IDs
- Counts end with `Count`
- Indices end with `Index`
- IDs end with `Id`

### Units of Measure
Include suffixes:
- `Ms`, `Sec`
- `Px`, `World`
- `Rad`, `Deg`

---

## 5. Input & Game Loop Responsibilities
- Input handling should only capture user intent and emit actions (no game state mutation inside input handlers).
- Game loop (`src/game.ts`) should orchestrate updates; avoid hidden state changes in unrelated modules.
- Keep rendering and simulation logic separate where feasible.

---

## 6. Required Documentation
Maintain:
1. **`DECISIONS.md`** — critical design decisions
2. **`ARCHITECTURE.md`** — system overview & data flow
3. **`manual_test_checklist.md`** — basic playtest checklist

---

## 7. Workflow for AI Agents
### Before changes
1. Read relevant module(s).
2. Verify related docs.
3. Identify where the change belongs.

### While changing
1. Follow naming guidelines.
2. Avoid per-frame allocations.
3. Keep logic testable and localized.

### After changes
1. Update docs if architecture changes.
2. Confirm gameplay still behaves the same.
3. Validate no FPS regressions.

---

## Summary
Prioritize **clarity**, **performance**, and **consistent gameplay**.  
When in doubt:
1. Make it **predictable**
2. Make it **fast**
3. Make it **clear**
