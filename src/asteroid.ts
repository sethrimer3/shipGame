import { Vec2, Material, MATERIAL_PROPS, pickMaterial, len, sub } from './types';
import { Block, BLOCK_SIZE, BlockDebris } from './block';
import { Player } from './player';
import { Projectile } from './projectile';
import { Particle, makeExplosion } from './particle';

/** Returns true if the segment (x1,y1)→(x2,y2) intersects the AABB (rx,ry,rw,rh). */
function segmentVsRect(
  x1: number, y1: number, x2: number, y2: number,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tMin = 0;
  let tMax = 1;

  if (Math.abs(dx) < 1e-8) {
    if (x1 < rx || x1 > rx + rw) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (rx - x1) * inv;
    let t2 = (rx + rw - x1) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  if (Math.abs(dy) < 1e-8) {
    if (y1 < ry || y1 > ry + rh) return false;
  } else {
    const inv = 1 / dy;
    let t1 = (ry - y1) * inv;
    let t2 = (ry + rh - y1) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  return true;
}

/** A small gun turret attached to the surface of an asteroid. */
export class AsteroidTurret {
  pos:   Vec2;
  alive  = true;
  hp:    number;

  readonly radius = 9;

  private angle         = 0;
  private fireCooldown  = 0;
  private readonly _maxHp:    number;
  private readonly _range:    number;
  private readonly _fireRate: number;
  private readonly _damage:   number;

  constructor(
    private readonly _asteroid: Asteroid,
    private readonly _block:    Block,
    distFromOrigin: number,
  ) {
    const tier       = distFromOrigin < 3000 ? 0 : distFromOrigin < 8000 ? 1 : 2;
    this._maxHp      = [35, 55, 85][tier];
    this.hp          = this._maxHp;
    this._range      = [380, 480, 600][tier];
    this._fireRate   = [0.6, 1.0, 1.6][tier];
    this._damage     = [9, 15, 24][tier];
    this.pos         = this._worldPos();
  }

  private _worldPos(): Vec2 {
    return {
      x: this._asteroid.pos.x + this._block.col * BLOCK_SIZE + BLOCK_SIZE / 2,
      y: this._asteroid.pos.y + this._block.row * BLOCK_SIZE + BLOCK_SIZE / 2,
    };
  }

  update(dt: number, player: Player, projectiles: Projectile[], particles: Particle[]): void {
    // Follow host asteroid movement
    this.pos = this._worldPos();

    // Die if host block or whole asteroid is gone
    if (!this._asteroid.alive || !this._block.alive) {
      this.alive = false;
      return;
    }

    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d > this._range) return;

    this.angle = Math.atan2(dy, dx);
    this.fireCooldown -= dt;
    if (this.fireCooldown <= 0) {
      this.fireCooldown = 1 / this._fireRate;
      // Only fire when line of sight to player is clear of own asteroid blocks
      if (this._hasLineOfSight(player.pos)) {
        const dir = { x: dx / d, y: dy / d };
        // Spawn from just outside the turret barrel tip
        const spawnX = this.pos.x + Math.cos(this.angle) * (this.radius + 4);
        const spawnY = this.pos.y + Math.sin(this.angle) * (this.radius + 4);
        projectiles.push(new Projectile(
          { x: spawnX, y: spawnY }, dir, 380, this._damage, 3, '#ff4400', 'enemy', 3,
        ));
      }
    }
  }

  /** Returns true when no live asteroid block (other than the turret's own) occludes the path to target. */
  private _hasLineOfSight(target: Vec2): boolean {
    for (const b of this._asteroid.blocks) {
      if (b === this._block || !b.alive) continue;
      const bx = this._asteroid.pos.x + b.col * BLOCK_SIZE;
      const by = this._asteroid.pos.y + b.row * BLOCK_SIZE;
      if (segmentVsRect(this.pos.x, this.pos.y, target.x, target.y, bx, by, BLOCK_SIZE, BLOCK_SIZE)) {
        return false;
      }
    }
    return true;
  }

  /** Deal damage; returns true if destroyed. */
  damage(amount: number, particles: Particle[], rng: () => number): boolean {
    this.hp -= amount;
    particles.push(...makeExplosion(this.pos, 3, '#ff8800', rng));
    if (this.hp <= 0) {
      this.alive = false;
      particles.push(...makeExplosion(this.pos, 12, '#ff4400', rng));
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);

    // Base plate
    ctx.fillStyle   = '#444';
    ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle   = '#666';
    ctx.fillRect(-5, -5, 10, 10);

    // Barrel
    ctx.fillStyle   = '#aaa';
    ctx.fillRect(2, -2, 10, 4);

    ctx.restore();

    // HP bar (only when damaged)
    if (this.hp < this._maxHp) {
      const barW    = 18;
      const hpRatio = this.hp / this._maxHp;
      const bx      = this.pos.x - barW / 2;
      const by      = this.pos.y - this.radius - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, barW, 3);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(bx, by, barW * hpRatio, 3);
    }
  }
}

/** A rock formation made of a grid of breakable blocks. */
export class Asteroid {
  readonly blocks: Block[] = [];
  readonly width:  number;
  readonly height: number;
  alive = true;

  /** True if this is a trap asteroid – fires a drone swarm when first hit. */
  isTrap       = false;
  trapTriggered = false;

  /** Current velocity (world units/s). Starts at rest; set by physics collisions. */
  vel: Vec2 = { x: 0, y: 0 };

  constructor(
    public pos: Vec2,
    cols:  number,
    rows:  number,
    distFromOrigin: number,
    rng:   () => number,
    /** If set, every block in this cluster uses this material (gem node). */
    forcedMaterial?: Material,
  ) {
    this.width  = cols * BLOCK_SIZE;
    this.height = rows * BLOCK_SIZE;

    // First pass: build the set of occupied cells using the ellipse shape
    const occupied = new Set<string>();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = (c + 0.5) / cols - 0.5;
        const cy = (r + 0.5) / rows - 0.5;
        const ellipse = (cx * cx) / 0.25 + (cy * cy) / 0.25;
        if (ellipse > 1 + (rng() - 0.5) * 0.6) continue;
        occupied.add(`${c},${r}`);
      }
    }

    // Second pass: create blocks; outer-perimeter cells become Dirt (unless forced)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!occupied.has(`${c},${r}`)) continue;
        const isOuter = !forcedMaterial && (
          !occupied.has(`${c+1},${r}`) || !occupied.has(`${c-1},${r}`) ||
          !occupied.has(`${c},${r+1}`) || !occupied.has(`${c},${r-1}`)
        );
        const mat = isOuter ? Material.Dirt : (forcedMaterial ?? pickMaterial(distFromOrigin, rng));
        this.blocks.push(new Block(mat, c, r));
      }
    }
  }

  /** Check if a world-space point hits any live block; returns that block or null. */
  blockAt(worldPt: Vec2): Block | null {
    const lx = worldPt.x - this.pos.x;
    const ly = worldPt.y - this.pos.y;
    for (const b of this.blocks) {
      if (!b.alive) continue;
      const bx = b.col * BLOCK_SIZE;
      const by = b.row * BLOCK_SIZE;
      if (lx >= bx && lx < bx + BLOCK_SIZE && ly >= by && ly < by + BLOCK_SIZE) {
        return b;
      }
    }
    return null;
  }

  /** Remove a dead block and return debris particles. */
  removeBlock(block: Block, rng: () => number): BlockDebris[] {
    const debris: BlockDebris[] = [];
    const bx = this.pos.x + block.col * BLOCK_SIZE;
    const by = this.pos.y + block.row * BLOCK_SIZE;
    const color = MATERIAL_PROPS[block.material].color;

    for (let i = 0; i < 6; i++) {
      const speed = 40 + rng() * 80;
      const ang   = rng() * Math.PI * 2;
      debris.push({
        pos:      { x: bx + BLOCK_SIZE / 2, y: by + BLOCK_SIZE / 2 },
        vel:      { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
        color,
        lifetime: 0.5 + rng() * 0.6,
        maxLife:  1.1,
      });
    }

    if (this.blocks.every(b => !b.alive)) this.alive = false;
    return debris;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const b of this.blocks) {
      if (b.alive) b.draw(ctx, this.pos.x, this.pos.y);
    }
    // Warn players with a pulsing hazard icon on trap asteroids that haven't fired yet
    if (this.isTrap && !this.trapTriggered) {
      const c   = this.centre;
      const t   = Date.now() / 500;
      const glow = 0.6 + Math.sin(t) * 0.3;
      ctx.save();
      ctx.globalAlpha = glow;
      ctx.fillStyle   = '#ffcc00';
      ctx.font        = 'bold 14px Courier New';
      ctx.textAlign   = 'center';
      ctx.fillText('⚠', c.x, c.y + 5);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  /** Returns the material drop for a destroyed block. */
  static resourceDrop(mat: Material): { material: Material; qty: number } {
    return { material: mat, qty: Math.floor(Math.random() * 2) + 1 };
  }

  /** Advance asteroid position by its velocity and apply drag. */
  update(dt: number): void {
    const drag = Math.pow(0.80, dt * 60);
    this.vel.x *= drag;
    this.vel.y *= drag;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }

  /** Mass proportional to the number of live blocks (used for impulse physics). */
  get mass(): number {
    const liveBlocks = this.blocks.filter(b => b.alive).length;
    return Math.max(1, liveBlocks) * BLOCK_SIZE * BLOCK_SIZE * 3;
  }

  /** Rough world-space radius used for collision culling. */
  get radius(): number {
    return Math.max(this.width, this.height) / 2;
  }

  /** Centre of the asteroid in world space. */
  get centre(): Vec2 {
    return { x: this.pos.x + this.width / 2, y: this.pos.y + this.height / 2 };
  }
}
