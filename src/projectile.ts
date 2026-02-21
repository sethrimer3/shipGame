import { Vec2, add, scale, normalize } from './types';

export type ProjectileOwner = 'player' | 'enemy';

export class Projectile {
  pos:     Vec2;
  vel:     Vec2;
  alive    = true;
  lifetime = 0;

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
    const n  = normalize(dir);
    this.vel = scale(n, speed);
  }

  update(dt: number): void {
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
