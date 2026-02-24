import {
  Vec2, add, scale, normalize, sub, len, fromAngle, perpCW,
  InventoryItem, createMaterialItem, Material, TOOLBAR_ITEM_DEFS, ToolbarItemDef,
  ShipModuleType, ShipModules, CraftingRecipe, ResourceStack,
  UPGRADE_TIER_GEMS, MODULE_UPGRADE_BASE_COST,
} from './types';
import { InputManager }  from './input';
import { Camera }        from './camera';
import { Projectile, HomingRocket, LaserBeam } from './projectile';
import { Particle, makeExplosion } from './particle';

const THRUST_FORCE  = 700;  // px/s²
const MAX_SPEED     = 900;  // px/s
const DRAG          = 0.92; // velocity multiplier per frame (applied per-second in dt)
const SHIP_RADIUS   = 16;
const BOOST_MULTIPLIER = 2;
const OVERHEAT_MAX = 100;
const OVERHEAT_DRAIN_RATE = 25;
const OVERHEAT_RECHARGE_RATE = 18;
const SHIELD_REGEN_DELAY = 3.0; // seconds after damage before shield starts recharging
const DAMAGE_FLASH_DURATION = 0.15; // seconds the ship flashes red after taking a hit
const MODULE_DAMAGE_OVERLAY_ALPHA = 0.72; // maximum dark overlay alpha at 0 HP

// Re-export for backward-compat with game.ts imports
export type { ShipModuleType, ShipModules } from './types';

export interface ModuleInfo {
  type: ShipModuleType;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  isCore: boolean;
}

interface PlayerModule {
  type: ShipModuleType;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  isCore: boolean;
  isConnected: boolean;
}

/** One entry per owned module in the palette (one entry = one craftable unit). */
export interface ModulePaletteEntry {
  recipeId: string;   // recipe that created it ('starter' for initial modules)
  type:     ShipModuleType;
}

/** Convert tier number to Roman numeral string (supports 1–10). */
export function tierToRoman(tier: number): string {
  if (tier <= 1) return 'I';
  const vals = [10, 9, 5, 4, 1];
  const strs = ['X', 'IX', 'V', 'IV', 'I'];
  let n = tier;
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { result += strs[i]; n -= vals[i]; }
  }
  return result;
}

const CORE_HP_BASE = 30; // Core module HP – last line of defence before ship destruction
const NANOBOT_REPAIR_RATE = 10; // HP per second healed by core nanobots
const NANOBOT_REPAIR_EPSILON = 1e-6; // Floating-point threshold for nanobot repair loop
/** Fraction of crafting recipe inputs refunded when recycling a module (25%, rounded down). */
export const RECYCLE_REFUND_RATE = 0.25;
const MODULE_HP_BY_TYPE: Record<ShipModuleType, number> = {
  hull: 34,
  engine: 24,
  shield: 22,
  coolant: 20,
  weapon: 18,
  miningLaser: 18,
};

/** Ship-local [col, row] positions for each module type, ordered by placement priority. */
const HULL_MODULE_SLOTS: ReadonlyArray<[number, number]> = [
  [0, 0], [1, 0], [0, -1], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, -1], [-1, 1],
  [2, 0], [-2, 0], [0, -2], [0, 2], [2, -1], [2, 1], [-2, -1], [-2, 1],
  [1, -2], [1, 2], [-1, -2], [-1, 2], [3, 0], [-3, 0],
];
const ENGINE_MODULE_SLOTS:  ReadonlyArray<[number, number]> = [[-3, -1], [-3, 1], [-4, 0], [-4, -1], [-4, 1]];
const SHIELD_MODULE_SLOTS:  ReadonlyArray<[number, number]> = [[0, -3], [0, 3], [1, -3], [1, 3], [-1, -3], [-1, 3]];
const COOLANT_MODULE_SLOTS: ReadonlyArray<[number, number]> = [[-2, -2], [-2, 2], [-3, -2], [-3, 2]];
const WEAPON_MODULE_SLOTS:  ReadonlyArray<[number, number]> = [[2, -3], [2, 3], [3, -1], [3, 1]];
/** Ship-local [col, row] positions of mining laser modules, ordered by priority. */
const MINING_LASER_MODULE_SLOTS: ReadonlyArray<[number, number]> = [
  [4, 0], [4, -1], [4, 1], [5, 0],
];

export class Player {
  pos: Vec2  = { x: 0, y: 0 };
  vel: Vec2  = { x: 0, y: 0 };
  /** Angle (radians) the ship is facing – toward the mouse cursor. */
  angle      = 0;

  maxHp      = 100;
  hp         = 100;
  maxShield  = 60;
  shield     = 60;
  shieldRegen = 8; // per second

  /** Core module HP – ship is destroyed only when this reaches 0. */
  maxCoreHp  = CORE_HP_BASE;
  coreHp     = CORE_HP_BASE;

  /** Experience points accumulated this run. */
  xp    = 0;
  /** Current player level (starts at 1). */
  level = 1;
  /** Set to true when a level-up just occurred; game loop reads and clears. */
  leveledUp = false;
  /** Damage absorbed this frame; game loop reads to trigger camera shake. */
  recentDamage = 0;

  readonly radius = SHIP_RADIUS;
  /** Physics mass used for ship–asteroid impulse resolution. */
  readonly mass   = 400;

  /** Raw material ore counts. */
  readonly inventory: Map<Material, InventoryItem> = new Map(
    (Object.values(Material) as Material[]).map(m => [m, createMaterialItem(m, 0)])
  );

  /** Crafted / equipped items stored here (parallel to toolbar). */
  equippedItems: (ToolbarItemDef | null)[] = Array(8).fill(null);

  private fireCooldown = 0;
  private overheatMeter = OVERHEAT_MAX;
  private levelHpBonus = 0;
  private levelShieldBonus = 0;
  private shieldRegenDelay = 0;   // countdown before shield starts recharging after damage
  private damageFlashTimer = 0;   // countdown for the red hit-flash visual
  private modules: ShipModules = {
    hull: 12,
    engine: 2,
    shield: 2,
    coolant: 1,
    weapon: 0,
    miningLaser: 1,
  };
  private playerModules: PlayerModule[] = [];
  /**
   * Explicit per-slot layout set from the ship editor.  Each entry is in
   * ship-local coordinates (col = right/nose, row = down).  When non-null
   * this overrides the count-based slot assignment in _buildShipBlocks and
   * getMiningLaserWorldPositions.
   */
  private _moduleSlots: Array<{ type: ShipModuleType; col: number; row: number }> | null = null;

  /**
   * Module palette: one entry per owned module instance.
   * Populated by initStarterPalette() on game start and addModuleToPalette() on craft.
   */
  readonly modulePalette: ModulePaletteEntry[] = [];

  /**
   * Upgrade tier per module type (1 = base, 2 = Tier II, …, 10 = Tier X).
   * Tier N multiplies each module's stat contribution by 2^(N-1).
   */
  readonly moduleTiers: Record<ShipModuleType, number> = {
    hull: 1, engine: 1, shield: 1, coolant: 1, weapon: 1, miningLaser: 1,
  };

  constructor(
    private readonly input:    InputManager,
    private readonly camera:   Camera,
    /** Engine speed multiplier (1 = normal; Dark Engine doubles it). */
    public thrustMultiplier    = 1,
    /** Whether the Shield Generator upgrade is active. */
    public hasShieldGen        = false,
    /** Whether Heavy Armor upgrade is active. */
    public hasHeavyArmor       = false,
  ) {
    this._rebuildPlayerModules();
    this._recalculateShipStats();
  }

  get alive(): boolean { return this.coreHp > 0; }
  get overheatRatio(): number { return this.overheatMeter / OVERHEAT_MAX; }
  get moduleCounts(): Readonly<ShipModules> { return this.modules; }

  get accelerationMultiplier(): number {
    return 1 + this.modules.engine * 0.14 * this._tierMult('engine');
  }

  get topSpeedMultiplier(): number {
    return 1 + this.modules.engine * 0.12 * this._tierMult('engine');
  }

  get overheatDrainMultiplier(): number {
    return Math.max(0.35, 1 - this.modules.coolant * 0.12 * this._tierMult('coolant'));
  }

  get overheatRechargeMultiplier(): number {
    return 1 + this.modules.coolant * 0.3 * this._tierMult('coolant');
  }

  /** Weapon damage multiplier from weapon modules (+8% per module, scaled by tier). */
  get weaponDamageMultiplier(): number {
    return 1 + this.modules.weapon * 0.08 * this._tierMult('weapon');
  }

  /** Weapon fire rate multiplier from weapon modules (+6% per module, scaled by tier). */
  get weaponFireRateMultiplier(): number {
    return 1 + this.modules.weapon * 0.06 * this._tierMult('weapon');
  }

  /** Mining laser damage multiplier from miningLaser tier. */
  get miningLaserDamageMultiplier(): number {
    return this._tierMult('miningLaser');
  }

  getMuzzleWorldPos(): Vec2 {
    const forward = fromAngle(this.angle);
    return {
      x: this.pos.x + forward.x * 18,
      y: this.pos.y + forward.y * 18,
    };
  }

  /** Returns the world-space positions of each mining laser module (nose-mounted). */
  getMiningLaserWorldPositions(): Vec2[] {
    const B = 7;
    const cosA = Math.cos(this.angle);
    const sinA = Math.sin(this.angle);
    const slots = this.playerModules.filter(m => m.alive && m.isConnected && m.type === 'miningLaser');
    return slots.map(({ col, row }) => {
      const lx = col * B;
      const ly = row * B;
      return {
        x: this.pos.x + lx * cosA - ly * sinA,
        y: this.pos.y + lx * sinA + ly * cosA,
      };
    });
  }

  /** XP required to reach the next level. */
  xpToNextLevel(): number { return this.level * 100; }

  /** Award XP; triggers level-up logic and sets `leveledUp` flag. */
  gainXP(amount: number): void {
    this.xp += amount;
    while (this.xp >= this.xpToNextLevel()) {
      const threshold = this.xpToNextLevel(); // capture before level increment
      this.xp -= threshold;
      this.level++;
      this.levelHpBonus += 10;
      this.levelShieldBonus += 5;
      this._recalculateShipStats();
      this.hp        = Math.min(this.hp + 10, this.maxHp);
      this.shield    = Math.min(this.shield + 5, this.maxShield);
      this.leveledUp = true;
    }
  }

  addModule(type: ShipModuleType): void {
    this.modules[type] += 1;
    this._rebuildPlayerModules();
    this._recalculateShipStats();
  }

  setModules(next: ShipModules): void {
    this.modules = {
      hull:        Math.max(1, Math.floor(next.hull)),
      engine:      Math.max(0, Math.floor(next.engine)),
      shield:      Math.max(0, Math.floor(next.shield)),
      coolant:     Math.max(0, Math.floor(next.coolant)),
      weapon:      Math.max(0, Math.floor(next.weapon)),
      miningLaser: Math.max(0, Math.floor(next.miningLaser)),
    };
    this._rebuildPlayerModules();
    this._recalculateShipStats();
  }

  /**
   * Apply a positional module layout from the ship editor.  `slots` uses
   * ship-local coordinates (col = nose direction, row = starboard direction).
   * The module counts are derived automatically from the slot types.
   */
  setModuleLayout(slots: Array<{ type: ShipModuleType; col: number; row: number }>): void {
    this._moduleSlots = slots.length > 0 ? [...slots] : null;
    const counts: ShipModules = { hull: 0, engine: 0, shield: 0, coolant: 0, weapon: 0, miningLaser: 0 };
    for (const s of slots) counts[s.type] += 1;
    this.setModules(counts);
  }

  /**
   * Returns the current module layout as ship-local slot positions.
   * If no custom layout is stored, returns the default count-based layout
   * using the provided ordered slot lists (same order as EDITOR_SLOT_ORDER).
   */
  getModuleSlots(): Array<{ type: ShipModuleType; col: number; row: number }> {
    if (this._moduleSlots) return [...this._moduleSlots];
    // Build the default layout using the same slot order as _buildShipBlocks
    const result: Array<{ type: ShipModuleType; col: number; row: number }> = [];
    const add = (count: number, slots: ReadonlyArray<[number, number]>, type: ShipModuleType) => {
      for (let i = 0; i < Math.min(count, slots.length); i++) {
        result.push({ type, col: slots[i][0], row: slots[i][1] });
      }
    };
    add(this.modules.hull,        HULL_MODULE_SLOTS,         'hull');
    add(this.modules.engine,      ENGINE_MODULE_SLOTS,       'engine');
    add(this.modules.shield,      SHIELD_MODULE_SLOTS,       'shield');
    add(this.modules.coolant,     COOLANT_MODULE_SLOTS,      'coolant');
    add(this.modules.weapon,      WEAPON_MODULE_SLOTS,       'weapon');
    add(this.modules.miningLaser, MINING_LASER_MODULE_SLOTS, 'miningLaser');
    return result;
  }

  removeModule(type: ShipModuleType): boolean {
    const minForType = type === 'hull' ? 4 : 0;
    if (this.modules[type] <= minForType) return false;
    this.modules[type] -= 1;
    this._rebuildPlayerModules();
    this._recalculateShipStats();
    return true;
  }

  // ── Module palette methods ──────────────────────────────────────────────────

  /**
   * Populate the palette with the modules from the current ship layout.
   * Called once at game start after the initial setModuleLayout.
   */
  initStarterPalette(): void {
    this.modulePalette.length = 0;
    const slots = this.getModuleSlots();
    for (const slot of slots) {
      this.modulePalette.push({ recipeId: 'starter', type: slot.type });
    }
  }

  /** Returns how many modules of the given type are in the palette (total owned). */
  getModuleCount(type: ShipModuleType): number {
    let count = 0;
    for (const e of this.modulePalette) { if (e.type === type) count++; }
    return count;
  }

  /** Add one module of a given type to the palette (called on craft). */
  addModuleToPalette(recipeId: string, type: ShipModuleType): void {
    this.modulePalette.push({ recipeId, type });
  }

  /**
   * Remove one module of the given type from the palette and refund 25% of the
   * crafting recipe's inputs (rounded down). Returns the refunded resources or
   * an empty array if the module was a starter (no recipe) or the palette had
   * none of that type.
   */
  recycleModuleFromPalette(type: ShipModuleType, recipes: CraftingRecipe[]): ResourceStack[] | null {
    const idx = this.modulePalette.findIndex(e => e.type === type);
    if (idx === -1) return null;
    const entry = this.modulePalette.splice(idx, 1)[0];
    const recipe = recipes.find(r => r.id === entry.recipeId);
    const refund: ResourceStack[] = [];
    if (recipe) {
      for (const input of recipe.inputs) {
        const qty = Math.floor(input.quantity * RECYCLE_REFUND_RATE);
        if (qty > 0) {
          refund.push({ material: input.material, quantity: qty });
          this.addResource(input.material, qty);
        }
      }
    }
    return refund;
  }

  // ── Module upgrade methods ──────────────────────────────────────────────────

  /** Current upgrade tier for a module type (1 = base). */
  getModuleTier(type: ShipModuleType): number {
    return this.moduleTiers[type] ?? 1;
  }

  /** Returns the cost (gem type + quantity) for the next tier upgrade, or null if already max tier. */
  getUpgradeCost(type: ShipModuleType): { gem: Material; count: number } | null {
    const tier = this.getModuleTier(type);
    if (tier > UPGRADE_TIER_GEMS.length) return null; // max tier reached
    return {
      gem:   UPGRADE_TIER_GEMS[tier - 1],
      count: MODULE_UPGRADE_BASE_COST[type],
    };
  }

  /**
   * Upgrade a module type to the next tier using gems.
   * Returns true on success, false if not affordable or already max tier.
   */
  upgradeModule(type: ShipModuleType): boolean {
    const cost = this.getUpgradeCost(type);
    if (!cost) return false;
    if (this.getResource(cost.gem) < cost.count) return false;
    this.addResource(cost.gem, -cost.count);
    this.moduleTiers[type] += 1;
    // Rebuild so module HP is recalculated at the new tier
    this._rebuildPlayerModules();
    this._recalculateShipStats();
    return true;
  }

  /** Tier power multiplier: 2^(tier-1). T1=1×, T2=2×, T3=4× … */
  private _tierMult(type: ShipModuleType): number {
    return Math.pow(2, this.moduleTiers[type] - 1);
  }

  /** Add material resources to inventory. */
  addResource(mat: Material, qty: number): void {
    const item = this.inventory.get(mat)!;
    item.quantity += qty;
  }

  getResource(mat: Material): number {
    return this.inventory.get(mat)?.quantity ?? 0;
  }

  equipItem(slotIndex: number, item: ToolbarItemDef): void {
    this.equippedItems[slotIndex] = item;
    // Apply passive upgrades immediately
    this._applyPassives();
  }

  private _applyPassives(): void {
    this.hasShieldGen  = this.equippedItems.some(i => i?.id === 'shield_gen');
    this.hasHeavyArmor = this.equippedItems.some(i => i?.id === 'heavy_armor');
    this.thrustMultiplier = this.equippedItems.some(i => i?.id === 'dark_engine') ? 2 : 1;
    this._recalculateShipStats();
  }

  private _recalculateShipStats(): void {
    const shieldRatio = this.maxShield > 0 ? this.shield / this.maxShield : 1;

    const connected = this.playerModules.filter(m => m.alive && m.isConnected);
    this.modules = { hull: 0, engine: 0, shield: 0, coolant: 0, weapon: 0, miningLaser: 0 };
    this.maxHp = 0;
    this.hp = 0;
    this.maxCoreHp = CORE_HP_BASE;
    this.coreHp = 0;
    for (const module of connected) {
      this.modules[module.type] += 1;
      if (module.isCore) {
        this.maxCoreHp = module.maxHp;
        this.coreHp = Math.min(module.hp, module.maxHp);
      } else {
        this.maxHp += module.maxHp;
        this.hp += module.hp;
      }
    }

    const shieldTierMult = this._tierMult('shield');
    this.maxShield = 10 + this.modules.shield * 20 * shieldTierMult + this.levelShieldBonus;
    this.shieldRegen = 2 + this.modules.shield * 1.8 * shieldTierMult;

    if (this.hasHeavyArmor) this.maxShield += 25;
    this.shield = Math.max(0, Math.min(this.maxShield, this.maxShield * shieldRatio));
  }

  private _rebuildPlayerModules(): void {
    const slots = this.getModuleSlots();
    this.playerModules = slots.map(slot => {
      const isCore = slot.type === 'hull' && slot.col === 0 && slot.row === 0;
      const tierMult = isCore ? 1 : this._tierMult(slot.type);
      const maxHp = isCore ? CORE_HP_BASE : Math.round(MODULE_HP_BY_TYPE[slot.type] * tierMult);
      return {
        type: slot.type,
        col: slot.col,
        row: slot.row,
        hp: maxHp,
        maxHp,
        alive: true,
        isCore,
        isConnected: true,
      };
    });
    this._refreshConnectivity();
  }

  private _refreshConnectivity(): void {
    const core = this.playerModules.find(m => m.isCore && m.alive);
    for (const m of this.playerModules) m.isConnected = false;
    if (!core) return;
    core.isConnected = true;
    const queue: PlayerModule[] = [core];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const module of this.playerModules) {
        if (!module.alive || module.isConnected) continue;
        if ((Math.abs(module.col - cur.col) === 1 && module.row === cur.row) ||
            (Math.abs(module.row - cur.row) === 1 && module.col === cur.col)) {
          module.isConnected = true;
          queue.push(module);
        }
      }
    }
  }

  private _selectDamageTarget(): PlayerModule | null {
    for (const module of this.playerModules) {
      if (!module.alive || !module.isConnected || module.isCore) continue;
      return module;
    }
    return this.playerModules.find(m => m.alive && m.isConnected && m.isCore) ?? null;
  }

  /** Apply nanobot repair: heal modules from core outward at NANOBOT_REPAIR_RATE HP/s. */
  private _applyNanobotRepair(dt: number): void {
    let remaining = NANOBOT_REPAIR_RATE * dt;
    let statsChanged = false;
    while (remaining > NANOBOT_REPAIR_EPSILON) {
      // Collect modules that need healing
      let minDist = Infinity;
      for (const m of this.playerModules) {
        if (!m.alive || !m.isConnected || m.hp >= m.maxHp) continue;
        const d = Math.abs(m.col) + Math.abs(m.row);
        if (d < minDist) minDist = d;
      }
      if (!isFinite(minDist)) break; // nothing needs healing
      const group: PlayerModule[] = [];
      for (const m of this.playerModules) {
        if (!m.alive || !m.isConnected || m.hp >= m.maxHp) continue;
        if (Math.abs(m.col) + Math.abs(m.row) === minDist) group.push(m);
      }
      // Distribute evenly within group, handling overflow when a module fills up
      const active = group.slice();
      while (remaining > NANOBOT_REPAIR_EPSILON && active.length > 0) {
        const perModule = remaining / active.length;
        let filledAny = false;
        for (let i = active.length - 1; i >= 0; i--) {
          const m = active[i];
          const needed = m.maxHp - m.hp;
          if (needed <= perModule) {
            remaining -= needed;
            m.hp = m.maxHp;
            active.splice(i, 1);
            filledAny = true;
            statsChanged = true;
          }
        }
        if (!filledAny) {
          for (let i = 0; i < active.length; i++) {
            active[i].hp = Math.min(active[i].maxHp, active[i].hp + perModule);
          }
          remaining = 0;
          statsChanged = true;
        }
      }
      if (remaining <= NANOBOT_REPAIR_EPSILON) break;
    }
    if (statsChanged) this._recalculateShipStats();
  }

  /** Find the alive+connected module at a given world position (nearest grid cell). */
  private _moduleAtWorldPos(pos: Vec2): PlayerModule | null {
    const B = 7;
    const cosA =  Math.cos(this.angle);
    const sinA =  Math.sin(this.angle);
    const dx = pos.x - this.pos.x;
    const dy = pos.y - this.pos.y;
    // Rotate hit position into ship-local space
    const localX =  dx * cosA + dy * sinA;
    const localY = -dx * sinA + dy * cosA;
    const col = Math.round(localX / B);
    const row = Math.round(localY / B);
    // Exact hit first
    const exact = this.playerModules.find(m => m.alive && m.isConnected && m.col === col && m.row === row);
    if (exact) return exact;
    // Nearest alive+connected module as fallback
    let best: PlayerModule | null = null;
    let bestDist = Infinity;
    for (const m of this.playerModules) {
      if (!m.alive || !m.isConnected) continue;
      const d = (m.col - col) ** 2 + (m.row - row) ** 2;
      if (d < bestDist) { bestDist = d; best = m; }
    }
    return best;
  }

  /** Spawn small square debris particles at a world position using the given colour. */
  private _spawnModuleDebris(pos: Vec2, color: string, particles: Particle[]): void {
    const count = 8 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const ang      = Math.random() * Math.PI * 2;
      const speed    = 20 + Math.random() * 60;
      const lifetime = 5 + Math.random() * 5;
      particles.push({
        pos:      { x: pos.x, y: pos.y },
        vel:      { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
        color,
        radius:   2 + Math.random() * 2,
        lifetime,
        maxLife:  lifetime,
        alpha:    1,
        shape:    'square',
      });
    }
  }

  update(
    dt:           number,
    selectedSlot: number,
    advancedMovement: boolean,
    particles:    Particle[],
    projectiles:  Projectile[],
  ): void {
    // ── Rotation: face mouse ──────────────────────────────────────
    const mouseScreen = this.input.mousePos;
    const mouseWorld  = this.camera.screenToWorld(mouseScreen);
    const dir = sub(mouseWorld, this.pos);
    if (len(dir) > 1) this.angle = Math.atan2(dir.y, dir.x);

    // ── Thrust vectors ────────────────────────────────────────────
    const forward   = fromAngle(this.angle);
    // perpCW: 90° clockwise in screen space → ship's right (D)
    const rightVec  = perpCW(forward);

    const boostActive = this.input.isDown('shift') && this.overheatMeter > 0;
    const speedMultiplier = boostActive ? BOOST_MULTIPLIER : 1;
    const thrust = THRUST_FORCE * this.thrustMultiplier * this.accelerationMultiplier * speedMultiplier;
    let ax = 0, ay = 0;

    if (advancedMovement) {
      // Advanced: movement relative to ship's facing direction
      if (this.input.isDown('w')) { ax += forward.x  * thrust; ay += forward.y  * thrust; }
      if (this.input.isDown('s')) { ax -= forward.x  * thrust; ay -= forward.y  * thrust; }
      if (this.input.isDown('d')) { ax -= rightVec.x * thrust; ay -= rightVec.y * thrust; }
      if (this.input.isDown('a')) { ax += rightVec.x * thrust; ay += rightVec.y * thrust; }
    } else {
      // Simple: movement in world-space axes regardless of ship orientation
      if (this.input.isDown('w')) ay -= thrust;
      if (this.input.isDown('s')) ay += thrust;
      if (this.input.isDown('a')) ax -= thrust;
      if (this.input.isDown('d')) ax += thrust;
    }

    const canAccelerate = this.modules.engine > 0;
    if (!canAccelerate) {
      ax = 0;
      ay = 0;
    }
    const accelerating = canAccelerate && (ax !== 0 || ay !== 0);

    // ── Physics ───────────────────────────────────────────────────
    this.vel.x += ax * dt;
    this.vel.y += ay * dt;

    const spd = len(this.vel);
    const maxSpeed = MAX_SPEED * this.thrustMultiplier * this.topSpeedMultiplier * speedMultiplier;
    if (spd > maxSpeed) {
      const n   = normalize(this.vel);
      this.vel  = scale(n, maxSpeed);
    }

    // Apply drag each second scaled by dt
    const dragFactor = Math.pow(DRAG, dt * 60);
    this.vel.x *= dragFactor;
    this.vel.y *= dragFactor;

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // ── Shield regen ──────────────────────────────────────────────
    if (this.shieldRegenDelay > 0) {
      this.shieldRegenDelay -= dt;
    } else {
      const regenRate = this.hasShieldGen ? this.shieldRegen * 3 : this.shieldRegen;
      this.shield = Math.min(this.maxShield, this.shield + regenRate * dt);
    }

    // ── Damage flash countdown ────────────────────────────────────
    if (this.damageFlashTimer > 0) this.damageFlashTimer -= dt;

    // ── Nanobot repair (core → outward by orthogonal distance) ───────
    this._applyNanobotRepair(dt);

    // ── Firing ────────────────────────────────────────────────────
    this.fireCooldown -= dt;
    const weapon = this.equippedItems[selectedSlot];
    const boostedFireRate = boostActive ? BOOST_MULTIPLIER : 1;
    const hasWeaponModules = this.modules.weapon > 0 || this.modules.miningLaser > 0;
    if (weapon && hasWeaponModules && (weapon.type === 'weapon' || weapon.type === 'tool') &&
        this.input.mouseDown && this.fireCooldown <= 0) {
      const adjustedRate   = weapon.fireRate * boostedFireRate * this.weaponFireRateMultiplier;
      this.fireCooldown    = 1 / adjustedRate;
      const adjustedDamage = Math.round(weapon.damage * this.weaponDamageMultiplier);

      if (weapon.id === 'mining_laser') {
        // Instantaneous laser from each mining laser module; falls back to muzzle if no modules
        const miningDamage = Math.round(weapon.damage * this.weaponDamageMultiplier * this.miningLaserDamageMultiplier);
        const muzzlePositions = this.getMiningLaserWorldPositions();
        if (muzzlePositions.length === 0) muzzlePositions.push(this.getMuzzleWorldPos());
        for (const muzzlePos of muzzlePositions) {
          projectiles.push(new LaserBeam(
            muzzlePos, forward, miningDamage, weapon.projectileColor, 'player',
          ));
        }
      } else if (weapon.isHoming) {
        // Homing rocket – tracks the player's mouse cursor in real time
        const cam = this.camera;
        const inp = this.input;
        projectiles.push(new HomingRocket(
          this.pos, forward, weapon.projectileSpeed, adjustedDamage,
          weapon.projectileRadius, weapon.projectileColor, 'player', 7,
          () => cam.screenToWorld(inp.mousePos),
          2.5,
        ));
      } else {
        const spreadCount = weapon.spreadShots ?? 1;
        const SPREAD_ARC  = Math.PI / 9; // 20° total arc
        for (let si = 0; si < spreadCount; si++) {
          const offset = spreadCount > 1 ? (si / (spreadCount - 1) - 0.5) * SPREAD_ARC : 0;
          const dir = fromAngle(this.angle + offset);
          projectiles.push(new Projectile(
            this.pos, dir, weapon.projectileSpeed, adjustedDamage,
            weapon.projectileRadius, weapon.projectileColor, 'player',
          ));
        }
      }
    }

    const tryingToFire = !!weapon && this.input.mouseDown;

    let drainMultiplier = 0;
    if (boostActive && (accelerating || tryingToFire)) {
      drainMultiplier = accelerating && tryingToFire ? 2 : 1;
      const drainRate = OVERHEAT_DRAIN_RATE * this.overheatDrainMultiplier;
      this.overheatMeter = Math.max(0, this.overheatMeter - drainRate * drainMultiplier * dt);
    } else {
      const rechargeRate = OVERHEAT_RECHARGE_RATE * this.overheatRechargeMultiplier;
      this.overheatMeter = Math.min(OVERHEAT_MAX, this.overheatMeter + rechargeRate * dt);
    }

    const heat = 1 - this.overheatRatio;
    if (heat > 0.05) {
      const spawnRate = 8 + heat * 30;
      const spawnCount = Math.floor(spawnRate * dt);
      const extra = Math.random() < (spawnRate * dt - spawnCount) ? 1 : 0;
      const total = spawnCount + extra;
      for (let i = 0; i < total; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 6 + Math.random() * 12;
        const speed = 10 + Math.random() * 30;
        const shade = 120 + Math.floor(Math.random() * 120);
        const red = 255;
        const green = Math.min(220, shade);
        const blue = Math.floor(Math.random() * 30);
        particles.push({
          pos: { x: this.pos.x + Math.cos(ang) * dist, y: this.pos.y + Math.sin(ang) * dist },
          vel: { x: Math.cos(ang) * speed + this.vel.x * 0.08, y: Math.sin(ang) * speed + this.vel.y * 0.08 },
          color: `rgb(${red},${green},${blue})`,
          radius: 1 + Math.random() * 1.5,
          lifetime: 0.2 + Math.random() * 0.35,
          maxLife: 0.55,
          alpha: 1,
        });
      }
    }

    // ── Engine exhaust trail ──────────────────────────────────────
    if (accelerating) {
      const rear    = { x: this.pos.x - forward.x * 13, y: this.pos.y - forward.y * 13 };
      const rate    = 25;
      const count   = Math.floor(rate * dt) + (Math.random() < (rate * dt % 1) ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const jitter = (Math.random() - 0.5) * 5;
        const speed  = 40 + Math.random() * 50;
        const col    = boostActive
          ? `rgba(180,110,255,0.85)`
          : `rgba(80,190,255,0.75)`;
        particles.push({
          pos:      { x: rear.x + rightVec.x * jitter, y: rear.y + rightVec.y * jitter },
          vel:      { x: -forward.x * speed + this.vel.x * 0.1, y: -forward.y * speed + this.vel.y * 0.1 },
          color:    col,
          radius:   1 + Math.random() * 2,
          lifetime: 0.18 + Math.random() * 0.14,
          maxLife:  0.32,
          alpha:    1,
        });
      }
    }
  }

  /** Take damage (shield absorbs first, then module HP; ship dies when core module is destroyed). */
  damage(amount: number): void {
    this.recentDamage += amount;
    this.shieldRegenDelay = SHIELD_REGEN_DELAY;
    this.damageFlashTimer = DAMAGE_FLASH_DURATION;
    let remaining = amount;
    const shieldAbsorb = Math.min(this.shield, remaining);
    this.shield -= shieldAbsorb;
    remaining -= shieldAbsorb;

    while (remaining > 0) {
      const target = this._selectDamageTarget();
      if (!target) break;
      const absorbed = Math.min(target.hp, remaining);
      target.hp -= absorbed;
      remaining -= absorbed;
      if (target.hp <= 0) {
        target.alive = false;
        target.hp = 0;
        this._refreshConnectivity();
      }
    }

    this._recalculateShipStats();
  }

  /**
   * Positional damage: the projectile hit position is used to determine
   * which specific module absorbs the damage.  Shield absorbs first; once
   * depleted the module nearest the hit position loses HP.  If that module
   * is destroyed it spawns square debris particles coloured like the module.
   */
  damageModule(pos: Vec2, amount: number, particles: Particle[]): void {
    this.recentDamage += amount;
    this.shieldRegenDelay = SHIELD_REGEN_DELAY;
    this.damageFlashTimer = DAMAGE_FLASH_DURATION;

    let remaining = amount;
    const shieldAbsorb = Math.min(this.shield, remaining);
    this.shield -= shieldAbsorb;
    remaining -= shieldAbsorb;

    if (remaining <= 0) {
      this._recalculateShipStats();
      return;
    }

    const target = this._moduleAtWorldPos(pos);
    if (!target) {
      this._recalculateShipStats();
      return;
    }

    const absorbed = Math.min(target.hp, remaining);
    target.hp -= absorbed;

    if (target.hp <= 0) {
      target.alive = false;
      target.hp = 0;
      const B = 7;
      const cosA = Math.cos(this.angle);
      const sinA = Math.sin(this.angle);
      const wx = this.pos.x + target.col * B * cosA - target.row * B * sinA;
      const wy = this.pos.y + target.col * B * sinA + target.row * B * cosA;
      this._spawnModuleDebris(
        { x: wx, y: wy },
        this._moduleColor(target.type, target.col, target.row),
        particles,
      );
      this._refreshConnectivity();
    }

    this._recalculateShipStats();
  }


  heal(amount: number): void {
    let remaining = amount;
    for (const module of this.playerModules) {
      if (!module.alive || !module.isConnected || module.isCore) continue;
      const needed = module.maxHp - module.hp;
      if (needed <= 0) continue;
      const restored = Math.min(needed, remaining);
      module.hp += restored;
      remaining -= restored;
      if (remaining <= 0) break;
    }
    if (remaining > 0) {
      const core = this.playerModules.find(m => m.alive && m.isConnected && m.isCore);
      if (core) core.hp = Math.min(core.maxHp, core.hp + remaining);
    }
    this._recalculateShipStats();
  }

  /** Returns info for the module (alive+connected) whose block area contains worldPos, or null. */
  getModuleInfoAtWorldPos(worldPos: Vec2): ModuleInfo | null {
    const B = 7;
    const cosA =  Math.cos(this.angle);
    const sinA =  Math.sin(this.angle);
    const dx = worldPos.x - this.pos.x;
    const dy = worldPos.y - this.pos.y;
    const localX =  dx * cosA + dy * sinA;
    const localY = -dx * sinA + dy * cosA;
    for (const m of this.playerModules) {
      if (!m.alive || !m.isConnected) continue;
      if (Math.abs(localX - m.col * B) <= B / 2 + 0.5 &&
          Math.abs(localY - m.row * B) <= B / 2 + 0.5) {
        return { type: m.type, col: m.col, row: m.row, hp: m.hp, maxHp: m.maxHp, isCore: m.isCore };
      }
    }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const thrusting = this.input.isDown('w') || this.input.isDown('s') ||
                      this.input.isDown('a') || this.input.isDown('d');

    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);

    // Block-based ship body (col=+x=forward, row=+y=down in local space)
    const B = 7; // block size in pixels
    // [col, row] offsets from ship centre; col+ points toward nose
    const blocks = this._buildShipBlocks();

    if (thrusting) {
      ctx.shadowColor = '#4af';
      ctx.shadowBlur  = 14;
    }

    // Red flash overlay when recently damaged
    const flashing = this.damageFlashTimer > 0;

    for (const block of blocks) {
      const { col, row, color, hpRatio } = block;
      const x = col * B - B / 2;
      const y = row * B - B / 2;
      ctx.fillStyle = flashing ? '#ff4444' : color;
      ctx.fillRect(x, y, B, B);
      // Darken the block proportionally to damage taken
      if (!flashing && hpRatio < 1) {
        ctx.fillStyle = `rgba(0,0,0,${(1 - hpRatio) * MODULE_DAMAGE_OVERLAY_ALPHA})`;
        ctx.fillRect(x, y, B, B);
      }
      ctx.strokeStyle = '#0a4d22';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(x, y, B, B);
    }

    ctx.shadowBlur = 0;

    // Engine exhaust flame
    if (thrusting) {
      ctx.fillStyle = 'rgba(100, 200, 255, 0.75)';
      ctx.fillRect(-2 * B - B / 2, -B / 2, B, B);
    }

    ctx.restore();

    // Shield bubble
    if (this.shield > 0) {
      const ratio = this.shield / this.maxShield;
      ctx.beginPath();
      ctx.arc(this.pos.x, this.pos.y, SHIP_RADIUS + 6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(52, 152, 219, ${ratio * 0.6})`;
      ctx.lineWidth   = 2;
      ctx.stroke();
    }
  }

  private _buildShipBlocks(): Array<{ col: number; row: number; color: string; hpRatio: number }> {
    const blocks: Array<{ col: number; row: number; color: string; hpRatio: number }> = [];
    for (const module of this.playerModules) {
      if (!module.alive || !module.isConnected) continue;
      blocks.push({
        col: module.col,
        row: module.row,
        color: this._moduleColor(module.type, module.col, module.row),
        hpRatio: module.maxHp > 0 ? module.hp / module.maxHp : 1,
      });
    }
    return blocks;
  }

  /** Returns the display color for a module type at a given ship-local position. */
  private _moduleColor(type: ShipModuleType, col: number, row: number): string {
    switch (type) {
      case 'hull':
        if (col === 0 && row === 0) return '#f1c40f'; // CORE
        return col >= 2 ? '#5df093' : col >= 0 ? '#2ecc71' : '#1a9957';
      case 'engine':      return '#7fd9ff';
      case 'shield':      return '#9f8cff';
      case 'coolant':     return '#7fffd2';
      case 'weapon':      return '#ff4444';
      case 'miningLaser': return '#7ed6f3';
    }
  }
}
