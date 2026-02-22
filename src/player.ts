import {
  Vec2, add, scale, normalize, sub, len, fromAngle, perpCW,
  InventoryItem, createMaterialItem, Material, TOOLBAR_ITEM_DEFS, ToolbarItemDef,
} from './types';
import { InputManager }  from './input';
import { Camera }        from './camera';
import { Projectile }    from './projectile';
import { Particle, makeExplosion } from './particle';

const THRUST_FORCE  = 700;  // px/s²
const MAX_SPEED     = 900;  // px/s
const DRAG          = 0.92; // velocity multiplier per frame (applied per-second in dt)
const SHIP_RADIUS   = 16;
const BOOST_MULTIPLIER = 2;
const OVERHEAT_MAX = 100;
const OVERHEAT_DRAIN_RATE = 25;
const OVERHEAT_RECHARGE_RATE = 18;

export type ShipModuleType = 'hull' | 'engine' | 'shield' | 'coolant';

interface ShipModules {
  hull: number;
  engine: number;
  shield: number;
  coolant: number;
}

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
  private modules: ShipModules = {
    hull: 12,
    engine: 2,
    shield: 2,
    coolant: 1,
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
    this._recalculateShipStats();
  }

  get alive(): boolean { return this.hp > 0; }
  get overheatRatio(): number { return this.overheatMeter / OVERHEAT_MAX; }
  get moduleCounts(): Readonly<ShipModules> { return this.modules; }

  get accelerationMultiplier(): number {
    return 1 + this.modules.engine * 0.14;
  }

  get topSpeedMultiplier(): number {
    return 1 + this.modules.engine * 0.12;
  }

  get overheatDrainMultiplier(): number {
    return Math.max(0.35, 1 - this.modules.coolant * 0.12);
  }

  get overheatRechargeMultiplier(): number {
    return 1 + this.modules.coolant * 0.3;
  }

  getMuzzleWorldPos(): Vec2 {
    const forward = fromAngle(this.angle);
    return {
      x: this.pos.x + forward.x * 18,
      y: this.pos.y + forward.y * 18,
    };
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
    this._recalculateShipStats();
  }

  removeModule(type: ShipModuleType): boolean {
    const minForType = type === 'hull' ? 4 : 0;
    if (this.modules[type] <= minForType) return false;
    this.modules[type] -= 1;
    this._recalculateShipStats();
    return true;
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
    const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    const shieldRatio = this.maxShield > 0 ? this.shield / this.maxShield : 1;

    const hullHp = 40 + this.modules.hull * 18;
    this.maxHp = hullHp + this.levelHpBonus;
    if (this.hasHeavyArmor) this.maxHp += 100;

    this.maxShield = 10 + this.modules.shield * 20 + this.levelShieldBonus;
    this.shieldRegen = 2 + this.modules.shield * 1.8;

    this.hp = Math.max(1, Math.min(this.maxHp, this.maxHp * hpRatio));
    this.shield = Math.max(0, Math.min(this.maxShield, this.maxShield * shieldRatio));
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

    const accelerating = ax !== 0 || ay !== 0;

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
    const regenRate = this.hasShieldGen ? this.shieldRegen * 3 : this.shieldRegen;
    this.shield = Math.min(this.maxShield, this.shield + regenRate * dt);

    // ── Firing ────────────────────────────────────────────────────
    this.fireCooldown -= dt;
    const weapon = this.equippedItems[selectedSlot];
    const boostedFireRate = boostActive ? BOOST_MULTIPLIER : 1;
    if (weapon && (weapon.type === 'weapon' || weapon.type === 'tool') &&
        this.input.mouseDown && this.fireCooldown <= 0) {
      this.fireCooldown = 1 / (weapon.fireRate * boostedFireRate);
      projectiles.push(new Projectile(
        this.pos, forward, weapon.projectileSpeed,
        weapon.damage, weapon.projectileRadius, weapon.projectileColor, 'player',
      ));
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
  }

  /** Take damage (shield absorbs first). */
  damage(amount: number): void {
    this.recentDamage += amount;
    let remaining = amount;
    const shieldAbsorb = Math.min(this.shield, remaining);
    this.shield   -= shieldAbsorb;
    remaining     -= shieldAbsorb;
    this.hp        = Math.max(0, this.hp - remaining);
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

    for (const block of blocks) {
      const { col, row, color } = block;
      const x = col * B - B / 2;
      const y = row * B - B / 2;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, B, B);
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

  private _buildShipBlocks(): Array<{ col: number; row: number; color: string }> {
    const hullSlots: Array<[number, number]> = [
      [0, 0], [1, 0], [0, -1], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, -1], [-1, 1],
      [2, 0], [-2, 0], [0, -2], [0, 2], [2, -1], [2, 1], [-2, -1], [-2, 1],
      [1, -2], [1, 2], [-1, -2], [-1, 2], [3, 0], [-3, 0],
    ];
    const blocks: Array<{ col: number; row: number; color: string }> = [];
    const hullCount = Math.min(this.modules.hull, hullSlots.length);
    for (let i = 0; i < hullCount; i++) {
      const [col, row] = hullSlots[i];
      const color = col >= 2 ? '#5df093' : col >= 0 ? '#2ecc71' : '#1a9957';
      blocks.push({ col, row, color });
    }

    const addSpecial = (count: number, slots: Array<[number, number]>, color: string) => {
      for (let i = 0; i < count; i++) {
        const slot = slots[i % slots.length];
        blocks.push({ col: slot[0], row: slot[1], color });
      }
    };

    addSpecial(this.modules.engine, [[-3, -1], [-3, 1], [-4, 0], [-4, -1], [-4, 1]], '#7fd9ff');
    addSpecial(this.modules.shield, [[0, -3], [0, 3], [1, -3], [1, 3], [-1, -3], [-1, 3]], '#9f8cff');
    addSpecial(this.modules.coolant, [[-2, -2], [-2, 2], [-3, -2], [-3, 2]], '#7fffd2');
    return blocks;
  }
}
