import { Vec2 } from './types';
import { Player } from './player';
import { Projectile, LaserBeam } from './projectile';
import { Particle, makeExplosion } from './particle';

// ── Drone enemy (spawned by motherships and trap asteroids) ──────────────────
/**
 * A tiny autonomous ship composed of just a few hull modules, an engine, and a
 * laser module. No retreat – it rushes the player and fires rapidly.
 */
export class Drone {
  vel:   Vec2  = { x: 0, y: 0 };
  angle: number = 0;
  hp:    number;
  alive  = true;

  readonly radius = 7;
  readonly mass   = 80;

  private fireCooldown  = 0;
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
    this._maxHp    = [20, 35, 55][tier];
    this.hp        = this._maxHp;
    this._speed    = [190, 210, 230][tier];
    this._damage   = [6, 10, 16][tier];
    this._fireRate = [1.5, 2.0, 2.8][tier];
    this._color    = ['#ff6060', '#ff8844', '#ffbb22'][tier];
    this._xpValue  = [5, 10, 18][tier];
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

    // Fire at player when close enough
    this.fireCooldown -= dt;
    if (d < 520 && this.fireCooldown <= 0) {
      this.fireCooldown = 1 / this._fireRate;
      const dir = d > 0 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
      // Fire from the weapon module (nose block, col=1, row=0, B=5)
      const B = 5;
      const muzzle = {
        x: this.pos.x + B * Math.cos(this.angle),
        y: this.pos.y + B * Math.sin(this.angle),
      };
      projectiles.push(new LaserBeam(
        muzzle, dir, this._damage, '#ff4444', 'enemy',
      ));
    }
  }

  /** Deal damage; returns true if killed. */
  damage(amount: number, particles: Particle[], rng: () => number): boolean {
    this.hp -= amount;
    particles.push(...makeExplosion(this.pos, 3, this._color, rng));
    if (this.hp <= 0) {
      this.alive = false;
      particles.push(...makeExplosion(this.pos, 8, this._color, rng));
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);
    const B = 5;
    // Tiny ship silhouette: nose (weapon) + body (hull) + engine at rear
    // col+ = forward; col 1=nose/weapon, 0=hull body, -1=engine
    const blockDefs: [number, number, string][] = [
      [1,  0, '#ff4444'],  // weapon module (nose) – laser
      [0, -1, this._color], [0, 0, this._color], [0, 1, this._color], // hull
      [-1, 0, '#7fd9ff'],  // engine module (rear)
    ];
    for (const [col, row, fill] of blockDefs) {
      ctx.fillStyle   = fill;
      ctx.fillRect(col * B - B / 2, row * B - B / 2, B, B);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(col * B - B / 2, row * B - B / 2, B, B);
    }
    ctx.restore();

    // HP bar
    const barW    = this.radius * 2;
    const hpRatio = this.hp / this._maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(this.pos.x - barW / 2, this.pos.y - this.radius - 7, barW, 3);
    ctx.fillStyle = hpRatio > 0.5 ? '#2ecc71' : '#e74c3c';
    ctx.fillRect(this.pos.x - barW / 2, this.pos.y - this.radius - 7, barW * hpRatio, 3);
  }
}
