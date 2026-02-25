import { Vec2, add, scale, normalize } from './types';

export type ProjectileOwner = 'player' | 'enemy';

export class Projectile {
  pos:     Vec2;
  prevPos: Vec2;
  vel:     Vec2;
  alive    = true;
  lifetime = 0;
  readonly isStationBeam: boolean = false;

  constructor(
    pos:   Vec2,
    dir:   Vec2,
    public readonly speed:   number,
    public readonly damage:  number,
    public readonly radius:  number,
    public readonly color:   string,
    public readonly owner:   ProjectileOwner,
    public readonly maxLife: number = 3,
  ) {
    this.pos = { ...pos };
    this.prevPos = { ...pos };
    const n  = normalize(dir);
    this.vel = scale(n, speed);
  }

  update(dt: number): void {
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
    this.pos.x   += this.vel.x * dt;
    this.pos.y   += this.vel.y * dt;
    this.lifetime += dt;
    if (this.lifetime >= this.maxLife) this.alive = false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();

    // Glow effect
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, this.radius * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = this.color.replace(')', ', 0.3)').replace('rgb(', 'rgba(');
    // Fallback glow using shadow
    ctx.shadowColor = this.color;
    ctx.shadowBlur  = 8;
    ctx.fill();
    ctx.shadowBlur  = 0;
  }
}

/**
 * An instantaneous laser beam.  Travels very fast and renders as a glowing
 * line drawn from the spawn point to the current tip position.
 */
export class LaserBeam extends Projectile {
  protected readonly _origin: Vec2;
  protected readonly beamWidthPx: number;

  constructor(
    pos: Vec2,
    dir: Vec2,
    damage: number,
    color: string,
    owner: ProjectileOwner,
    speed = 8000,
    radius = 3,
    maxLife = 0.3,
    beamWidthPx = 2,
  ) {
    super(pos, dir, speed, damage, radius, color, owner, maxLife);
    this._origin = { ...pos };
    this.beamWidthPx = beamWidthPx;
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    const alpha = Math.max(0, 1 - this.lifetime / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = this.beamWidthPx;
    ctx.shadowColor = this.color;
    ctx.shadowBlur  = 10;
    ctx.beginPath();
    ctx.moveTo(this._origin.x, this._origin.y);
    ctx.lineTo(this.pos.x, this.pos.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

export class StationBeam extends LaserBeam {
  override readonly isStationBeam = true;

  constructor(
    pos: Vec2,
    dir: Vec2,
    damage: number,
  ) {
    super(pos, dir, damage, '#ffffff', 'player', 9000, 9, 0.18, 12);
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    const alpha = Math.max(0, 1 - this.lifetime / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = this.beamWidthPx;
    ctx.lineCap     = 'round';
    ctx.shadowColor = 'rgba(255,255,255,0.95)';
    ctx.shadowBlur  = 18;
    ctx.beginPath();
    ctx.moveTo(this._origin.x, this._origin.y);
    ctx.lineTo(this.pos.x, this.pos.y);
    ctx.stroke();

    ctx.lineWidth = this.beamWidthPx * 0.45;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(220,240,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(this._origin.x, this._origin.y);
    ctx.lineTo(this.pos.x, this.pos.y);
    ctx.stroke();
    ctx.restore();
  }
}

/** A homing missile that steers toward a moving target each frame. */
export class HomingRocket extends Projectile {
  private readonly _target: () => Vec2 | null;
  private readonly _turnRate: number;

  constructor(
    pos: Vec2,
    dir: Vec2,
    speed: number,
    damage: number,
    radius: number,
    color: string,
    owner: ProjectileOwner,
    maxLife: number,
    /** Getter returning the current target world position (or null to fly straight). */
    target: () => Vec2 | null,
    /** Max turn speed in radians per second. */
    turnRate = 2.2,
  ) {
    super(pos, dir, speed, damage, radius, color, owner, maxLife);
    this._target   = target;
    this._turnRate = turnRate;
  }

  override update(dt: number): void {
    const t = this._target();
    if (t) {
      const dx = t.x - this.pos.x;
      const dy = t.y - this.pos.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) { // guard against near-zero distance to avoid atan2 instability
        const desired = Math.atan2(dy, dx);
        const current = Math.atan2(this.vel.y, this.vel.x);
        let diff = desired - current;
        while (diff >  Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const turn     = Math.sign(diff) * Math.min(Math.abs(diff), this._turnRate * dt);
        const newAngle = current + turn;
        const spd      = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
        this.vel.x     = Math.cos(newAngle) * spd;
        this.vel.y     = Math.sin(newAngle) * spd;
      }
    }
    super.update(dt);
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    const ang = Math.atan2(this.vel.y, this.vel.x);
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(ang);
    ctx.shadowColor = this.color;
    ctx.shadowBlur  = 14;
    // Body
    ctx.fillStyle   = this.color;
    ctx.fillRect(-8, -3, 16, 6);
    // Nose cone
    ctx.fillStyle   = '#ffffff';
    ctx.fillRect(7, -2, 4, 4);
    // Exhaust glow
    ctx.fillStyle   = '#ff8800';
    ctx.fillRect(-12, -2, 5, 4);
    ctx.shadowBlur  = 0;
    ctx.restore();
  }
}
