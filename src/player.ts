import {
  Vec2, add, scale, normalize, sub, len, fromAngle, perpCW,
  InventoryItem, createMaterialItem, Material, TOOLBAR_ITEM_DEFS, ToolbarItemDef,
} from './types';
import { InputManager }  from './input';
import { Camera }        from './camera';
import { Projectile }    from './projectile';
import { Particle, makeExplosion } from './particle';

const THRUST_FORCE  = 320;  // px/s²
const MAX_SPEED     = 420;  // px/s
const DRAG          = 0.92; // velocity multiplier per frame (applied per-second in dt)
const SHIP_RADIUS   = 16;

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

  /** Raw material ore counts. */
  readonly inventory: Map<Material, InventoryItem> = new Map(
    (Object.values(Material) as Material[]).map(m => [m, createMaterialItem(m, 0)])
  );

  /** Crafted / equipped items stored here (parallel to toolbar). */
  equippedItems: (ToolbarItemDef | null)[] = Array(8).fill(null);

  private fireCooldown = 0;

  constructor(
    private readonly input:    InputManager,
    private readonly camera:   Camera,
    /** Engine speed multiplier (1 = normal; Dark Engine doubles it). */
    public thrustMultiplier    = 1,
    /** Whether the Shield Generator upgrade is active. */
    public hasShieldGen        = false,
    /** Whether Heavy Armor upgrade is active. */
    public hasHeavyArmor       = false,
  ) {}

  get alive(): boolean { return this.hp > 0; }

  /** XP required to reach the next level. */
  xpToNextLevel(): number { return this.level * 100; }

  /** Award XP; triggers level-up logic and sets `leveledUp` flag. */
  gainXP(amount: number): void {
    this.xp += amount;
    while (this.xp >= this.xpToNextLevel()) {
      const threshold = this.xpToNextLevel(); // capture before level increment
      this.xp -= threshold;
      this.level++;
      this.maxHp    += 10;
      this.hp        = Math.min(this.hp + 10, this.maxHp);
      this.maxShield += 5;
      this.shield    = Math.min(this.shield + 5, this.maxShield);
      this.leveledUp = true;
    }
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
    if (this.hasHeavyArmor) this.maxHp = 200; else this.maxHp = 100;
  }

  update(
    dt:           number,
    selectedSlot: number,
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

    const thrust = THRUST_FORCE * this.thrustMultiplier;
    let ax = 0, ay = 0;

    if (this.input.isDown('w')) { ax += forward.x  * thrust; ay += forward.y  * thrust; }
    if (this.input.isDown('s')) { ax -= forward.x  * thrust; ay -= forward.y  * thrust; }
    if (this.input.isDown('d')) { ax += rightVec.x * thrust; ay += rightVec.y * thrust; }
    if (this.input.isDown('a')) { ax -= rightVec.x * thrust; ay -= rightVec.y * thrust; }

    // ── Physics ───────────────────────────────────────────────────
    this.vel.x += ax * dt;
    this.vel.y += ay * dt;

    const spd = len(this.vel);
    if (spd > MAX_SPEED * this.thrustMultiplier) {
      const n   = normalize(this.vel);
      this.vel  = scale(n, MAX_SPEED * this.thrustMultiplier);
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
    if (weapon && (weapon.type === 'weapon' || weapon.type === 'tool') &&
        this.input.mouseDown && this.fireCooldown <= 0) {
      this.fireCooldown = 1 / weapon.fireRate;
      projectiles.push(new Projectile(
        this.pos, forward, weapon.projectileSpeed,
        weapon.damage, weapon.projectileRadius, weapon.projectileColor, 'player',
      ));
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
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);

    // Engine glow when thrusting
    const thrusting = this.input.isDown('w') || this.input.isDown('s') ||
                      this.input.isDown('a') || this.input.isDown('d');
    if (thrusting) {
      ctx.shadowColor = '#4af';
      ctx.shadowBlur  = 18;
    }

    // Ship body – arrow / delta wing shape
    ctx.beginPath();
    ctx.moveTo( 18,  0);  // nose
    ctx.lineTo(-14, -11); // left wing tip
    ctx.lineTo( -8,   0); // rear centre notch
    ctx.lineTo(-14,  11); // right wing tip
    ctx.closePath();
    ctx.fillStyle   = '#2ecc71';
    ctx.strokeStyle = '#1abc9c';
    ctx.lineWidth   = 1.5;
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Engine exhaust flame
    if (thrusting) {
      ctx.beginPath();
      ctx.moveTo(-8,  0);
      ctx.lineTo(-20, -5);
      ctx.lineTo(-28,  0);
      ctx.lineTo(-20,  5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(100, 200, 255, 0.6)';
      ctx.fill();
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
}
