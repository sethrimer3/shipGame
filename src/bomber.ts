import { Vec2 } from './types';
import { Player } from './player';
import { Projectile } from './projectile';
import { Particle, makeExplosion } from './particle';

// ── Bomber enemy (heavy kiting ship with slow devastating torpedoes) ──────────
/**
 * An armored ship that prefers to stay at long range and fire slow-moving but
 * extremely damaging bomb shots. It will strafe sideways when at optimal range
 * and retreat if the player gets too close. Front-facing cannon module is its
 * distinctive visual feature.
 */

const BOMBER_MIN_RANGE_WORLD  = 280;  // backs away when player is closer than this
const BOMBER_FIRE_RANGE_WORLD = 560;  // fires torpedo when player is within this

export class Bomber {
  vel:   Vec2  = { x: 0, y: 0 };
  angle: number = 0;
  hp:    number;
  alive  = true;

  readonly radius = 10;
  readonly mass   = 120;

  private fireCooldown = 0;
  private readonly _maxHp:    number;
  private readonly _speed:    number;
  private readonly _damage:   number;
  private readonly _fireRate: number;
  private readonly _color:    string;
  private readonly _xpValue:  number;

  constructor(
    public pos: Vec2,
    /** 0 = weak (near spawn), 1 = normal, 2 = strong (far out) */
    tier: 0 | 1 | 2 = 0,
  ) {
    this._maxHp    = [45,   80,  130][tier];
    this.hp        = this._maxHp;
    this._speed    = [65,   55,   45][tier];
    this._damage   = [50,   85,  140][tier];
    this._fireRate = [0.35, 0.30, 0.25][tier];
    this._color    = ['#9b59b6', '#7d3c98', '#5b2c6f'][tier];
    this._xpValue  = [30,   55,   95][tier];
  }

  get xpValue(): number { return this._xpValue; }

  update(dt: number, player: Player, projectiles: Projectile[], particles: Particle[]): void {
    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const d  = Math.sqrt(dx * dx + dy * dy);

    if (d > 0.1) {
      const nx = dx / d;
      const ny = dy / d;

      if (d > BOMBER_MIN_RANGE_WORLD + 80) {
        // Too far – move toward player while facing them
        this.angle  = Math.atan2(dy, dx);
        this.vel.x += nx * this._speed * 3 * dt;
        this.vel.y += ny * this._speed * 3 * dt;
      } else if (d < BOMBER_MIN_RANGE_WORLD) {
        // Too close – back away, still facing player
        this.angle  = Math.atan2(dy, dx);
        this.vel.x -= nx * this._speed * 5 * dt;
        this.vel.y -= ny * this._speed * 5 * dt;
      } else {
        // In optimal range – strafe sideways while keeping the cannon on target
        this.angle   = Math.atan2(dy, dx);
        const perpX  = -ny;
        const perpY  =  nx;
        this.vel.x  += perpX * this._speed * 2 * dt;
        this.vel.y  += perpY * this._speed * 2 * dt;
      }
    }

    const spd = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
    if (spd > this._speed) {
      const f = this._speed / spd;
      this.vel.x *= f;
      this.vel.y *= f;
    }

    const drag = Math.pow(0.85, dt * 60);
    this.vel.x *= drag;
    this.vel.y *= drag;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Fire torpedo when player is in range
    this.fireCooldown -= dt;
    if (d < BOMBER_FIRE_RANGE_WORLD && this.fireCooldown <= 0) {
      this.fireCooldown = 1 / this._fireRate;
      if (d > 0) {
        const dir = { x: dx / d, y: dy / d };
        // Fire from the forward cannon module [2, 0] in ship space
        const B = 7;
        const muzzle = {
          x: this.pos.x + Math.cos(this.angle) * B * 2,
          y: this.pos.y + Math.sin(this.angle) * B * 2,
        };
        projectiles.push(new Projectile(
          muzzle, dir, 200, this._damage, 7, '#cc55ff', 'enemy', 4.5,
        ));
      }
    }
  }

  /** Deal damage; returns true if killed. */
  damage(amount: number, particles: Particle[], rng: () => number): boolean {
    this.hp -= amount;
    particles.push(...makeExplosion(this.pos, 3, this._color, rng));
    if (this.hp <= 0) {
      this.alive = false;
      particles.push(...makeExplosion(this.pos, 11, this._color, rng));
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);

    const B = 7;
    // Module layout (col+ = forward, row+ = down in ship space):
    //   [ 2,  0] forward cannon (red)
    //   [ 1, -1] forward-left hull   [ 1, 0] forward hull   [ 1, 1] forward-right hull
    //   [ 0,  0] core hull
    //   [-1,  0] engine (cyan)
    const blockDefs: [number, number, string][] = [
      [ 2,  0, '#ff4444'],    // forward cannon module
      [ 1, -1, this._color],  // forward-left hull
      [ 1,  0, this._color],  // forward hull
      [ 1,  1, this._color],  // forward-right hull
      [ 0,  0, this._color],  // core hull
      [-1,  0, '#7fd9ff'],    // engine
    ];
    for (const [col, row, fill] of blockDefs) {
      ctx.fillStyle   = fill;
      ctx.fillRect(col * B - B / 2, row * B - B / 2, B, B);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(col * B - B / 2, row * B - B / 2, B, B);
    }
    ctx.restore();

    // HP bar
    const barW    = this.radius * 2.5;
    const hpRatio = this.hp / this._maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(this.pos.x - barW / 2, this.pos.y - this.radius - 9, barW, 3);
    ctx.fillStyle = hpRatio > 0.5 ? '#2ecc71' : hpRatio > 0.25 ? '#e67e22' : '#e74c3c';
    ctx.fillRect(this.pos.x - barW / 2, this.pos.y - this.radius - 9, barW * hpRatio, 3);
  }
}
