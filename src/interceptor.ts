import { Vec2 } from './types';
import { Player } from './player';
import { Particle, makeExplosion } from './particle';

// ── Interceptor enemy (fast kamikaze that rams the player) ───────────────────
/**
 * A sleek missile-ship that beelines straight for the player and deals damage
 * on contact, then explodes. No ranged attack – pure ramming threat.
 */
export class Interceptor {
  vel:   Vec2  = { x: 0, y: 0 };
  angle: number = 0;
  hp:    number;
  alive  = true;

  readonly radius = 8;
  readonly mass   = 60;

  private readonly _maxHp:     number;
  private readonly _speed:     number;
  private readonly _ramDamage: number;
  private readonly _color:     string;
  private readonly _xpValue:   number;
  private readonly _engageDistanceWorld: number;
  private readonly _disengageDistanceWorld: number;
  private _isTargetingPlayer = false;

  constructor(
    public pos: Vec2,
    tier: 0 | 1 | 2 = 0,
  ) {
    this._maxHp     = [25, 42, 68][tier];
    this.hp         = this._maxHp;
    this._speed     = [280, 330, 390][tier];
    this._ramDamage = [18, 28, 44][tier];
    this._color     = ['#ff4444', '#ff6622', '#ff2200'][tier];
    this._xpValue   = [8, 16, 28][tier];
    this._engageDistanceWorld    = [320, 380, 460][tier];
    this._disengageDistanceWorld = this._engageDistanceWorld * 1.35;
  }

  get xpValue():   number { return this._xpValue;  }
  get ramDamage(): number { return this._ramDamage; }
  get maxSpeed():  number { return this._speed; }
  get isTargetingPlayer(): boolean { return this._isTargetingPlayer; }

  update(dt: number, player: Player, particles: Particle[]): void {
    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const d  = Math.sqrt(dx * dx + dy * dy);

    if (this._isTargetingPlayer) {
      if (d > this._disengageDistanceWorld) this._isTargetingPlayer = false;
    } else if (d <= this._engageDistanceWorld) {
      this._isTargetingPlayer = true;
    }

    if (this._isTargetingPlayer && d > 0.1) {
      this.angle = Math.atan2(dy, dx);
      const nx   = dx / d;
      const ny   = dy / d;
      this.vel.x += nx * this._speed * 5 * dt;
      this.vel.y += ny * this._speed * 5 * dt;
    }

    const spd = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
    if (spd > this._speed) {
      const f    = this._speed / spd;
      this.vel.x *= f;
      this.vel.y *= f;
    }

    const drag = Math.pow(0.92, dt * 60);
    this.vel.x *= drag;
    this.vel.y *= drag;
    if (!this._isTargetingPlayer) {
      const spd = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
      if (spd > 4) this.angle = Math.atan2(this.vel.y, this.vel.x);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Exhaust trail
    if (d > 50 && Math.random() < 40 * dt) {
      particles.push({
        pos:      { x: this.pos.x, y: this.pos.y },
        vel:      {
          x: -Math.cos(this.angle) * (50 + Math.random() * 40) + (Math.random() - 0.5) * 20,
          y: -Math.sin(this.angle) * (50 + Math.random() * 40) + (Math.random() - 0.5) * 20,
        },
        color:    this._color,
        radius:   2 + Math.random() * 1.5,
        lifetime: 0.22,
        maxLife:  0.22,
        alpha:    1,
      });
    }
  }

  /** Deal damage; returns true if killed. */
  damage(amount: number, particles: Particle[], rng: () => number): boolean {
    this.hp -= amount;
    particles.push(...makeExplosion(this.pos, 3, this._color, rng));
    if (this.hp <= 0) {
      this.alive = false;
      particles.push(...makeExplosion(this.pos, 14, this._color, rng));
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);

    // Sleek pointed diamond shape
    ctx.fillStyle   = this._color;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth   = 0.7;
    ctx.beginPath();
    ctx.moveTo( 11,  0);   // nose
    ctx.lineTo(  0, -5);   // top-wing
    ctx.lineTo( -6,  0);   // tail
    ctx.lineTo(  0,  5);   // bottom-wing
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // HP bar (compact)
    const barW    = this.radius * 2;
    const hpRatio = this.hp / this._maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(this.pos.x - barW / 2, this.pos.y - this.radius - 7, barW, 3);
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(this.pos.x - barW / 2, this.pos.y - this.radius - 7, barW * hpRatio, 3);
  }
}
