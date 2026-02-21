import { Vec2 } from './types';

export interface Particle {
  pos:      Vec2;
  vel:      Vec2;
  color:    string;
  radius:   number;
  lifetime: number;
  maxLife:  number;
  alpha:    number;
}

export function updateParticle(p: Particle, dt: number): void {
  p.pos.x   += p.vel.x * dt;
  p.pos.y   += p.vel.y * dt;
  // Slow down
  p.vel.x   *= 0.97;
  p.vel.y   *= 0.97;
  p.lifetime -= dt;
  p.alpha    = Math.max(0, p.lifetime / p.maxLife);
}

export function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  ctx.globalAlpha = p.alpha;
  ctx.beginPath();
  ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2);
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function makeExplosion(
  pos: Vec2, count: number, baseColor: string, rng: () => number
): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const speed = 30 + rng() * 120;
    const ang   = rng() * Math.PI * 2;
    const life  = 0.3 + rng() * 0.7;
    particles.push({
      pos:      { x: pos.x, y: pos.y },
      vel:      { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
      color:    baseColor,
      radius:   1 + rng() * 3,
      lifetime: life,
      maxLife:  life,
      alpha:    1,
    });
  }
  return particles;
}
