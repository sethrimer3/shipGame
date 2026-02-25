import { Vec2 } from './types';
import { Player } from './player';
import { Projectile } from './projectile';
import { Particle, makeExplosion } from './particle';

// ── Gunship enemy (heavy twin-cannon flanker) ────────────────────────────────
/**
 * A mid-weight warship with weapon modules on both flanks. Fires a dual burst
 * of cannon shots simultaneously from its wing hardpoints. Slower than a Drone
 * but significantly tankier, making it a sustained threat.
 */
export class Gunship {
  vel:   Vec2  = { x: 0, y: 0 };
  angle: number = 0;
  hp:    number;
  alive  = true;

  readonly radius = 12;
  readonly mass   = 150;

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
    this._maxHp    = [60,  110, 180][tier];
    this.hp        = this._maxHp;
    this._speed    = [75,   65,  55][tier];
    this._damage   = [18,   28,  44][tier];
    this._fireRate = [0.7, 0.9, 1.1][tier];
    this._color    = ['#cc8833', '#aa6611', '#883300'][tier];
    this._xpValue  = [20,   40,  70][tier];
  }

  get xpValue(): number { return this._xpValue; }

  update(dt: number, player: Player, projectiles: Projectile[], particles: Particle[]): void {
    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const d  = Math.sqrt(dx * dx + dy * dy);

    if (d > 1) {
      this.angle = Math.atan2(dy, dx);
      const nx   = dx / d;
      const ny   = dy / d;
      this.vel.x += nx * this._speed * 4 * dt;
      this.vel.y += ny * this._speed * 4 * dt;
    }

    const spd = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
    if (spd > this._speed) {
      const f = this._speed / spd;
      this.vel.x *= f;
      this.vel.y *= f;
    }

    const drag = Math.pow(0.88, dt * 60);
    this.vel.x *= drag;
    this.vel.y *= drag;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Dual-wing cannon burst when close enough
    this.fireCooldown -= dt;
    if (d < 480 && this.fireCooldown <= 0) {
      this.fireCooldown = 1 / this._fireRate;
      if (d > 0) {
        const dir  = { x: dx / d, y: dy / d };
        const B    = 7;
        const cosA = Math.cos(this.angle);
        const sinA = Math.sin(this.angle);
        // Perpendicular offset for wing weapons at [0, -1] and [0, 1]
        const perpX = -sinA;
        const perpY =  cosA;
        for (const side of [-1, 1] as const) {
          const muzzle = {
            x: this.pos.x + perpX * side * B,
            y: this.pos.y + perpY * side * B,
          };
          projectiles.push(new Projectile(
            muzzle, dir, 320, this._damage, 5, '#ffaa44', 'enemy', 3,
          ));
        }
      }
    }
  }

  /** Deal damage; returns true if killed. */
  damage(amount: number, particles: Particle[], rng: () => number): boolean {
    this.hp -= amount;
    particles.push(...makeExplosion(this.pos, 3, this._color, rng));
    if (this.hp <= 0) {
      this.alive = false;
      particles.push(...makeExplosion(this.pos, 12, this._color, rng));
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
    //   [ 1,  0] nose hull
    //   [ 0, -1] left wing weapon (red)   [ 0, 0] core hull   [ 0, 1] right wing weapon (red)
    //   [-1, -1] rear-left hull           [-1, 0] engine       [-1, 1] rear-right hull
    const blockDefs: [number, number, string][] = [
      [ 1,  0, this._color],  // nose hull
      [ 0, -1, '#ff4444'],    // left wing weapon
      [ 0,  1, '#ff4444'],    // right wing weapon
      [ 0,  0, this._color],  // core hull
      [-1, -1, this._color],  // rear-left hull
      [-1,  1, this._color],  // rear-right hull
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
