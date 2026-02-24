import { Vec2 } from './types';

// ── Floating damage / text numbers ───────────────────────────────────────────
export interface FloatingText {
  pos:      Vec2;
  vel:      Vec2;
  text:     string;
  color:    string;
  lifetime: number;
  maxLife:  number;
}

export function makeFloatingText(pos: Vec2, text: string, color: string): FloatingText {
  return {
    pos:      { x: pos.x, y: pos.y },
    vel:      { x: (Math.random() - 0.5) * 20, y: -55 },
    text,
    color,
    lifetime: 1.0,
    maxLife:  1.0,
  };
}

export function updateFloatingText(f: FloatingText, dt: number): void {
  f.pos.x   += f.vel.x * dt;
  f.pos.y   += f.vel.y * dt;
  f.vel.y   *= 0.92;
  f.lifetime -= dt;
}

export function drawFloatingText(ctx: CanvasRenderingContext2D, f: FloatingText): void {
  const alpha = Math.max(0, f.lifetime / f.maxLife);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font        = 'bold 13px Courier New';
  ctx.textAlign   = 'center';
  ctx.fillStyle   = '#000';
  ctx.fillText(f.text, f.pos.x + 1, f.pos.y + 1);
  ctx.fillStyle   = f.color;
  ctx.fillText(f.text, f.pos.x, f.pos.y);
  ctx.restore();
}

export interface Particle {
  pos:      Vec2;
  vel:      Vec2;
  color:    string;
  radius:   number;
  lifetime: number;
  maxLife:  number;
  alpha:    number;
  shape?:   'circle' | 'square';
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
  ctx.fillStyle = p.color;
  if (p.shape === 'square') {
    const s = p.radius * 2;
    ctx.fillRect(p.pos.x - p.radius, p.pos.y - p.radius, s, s);
  } else {
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }
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
