import { Vec2 } from './types';

/** Half of BLOCK_SIZE (20); powder molecules are smaller than ship modules. */
export const POWDER_SIZE = 10;

/** Spring constant: acceleration (units/s²) per unit displacement from rest. */
const GRAVITY_K = 60;

/** Velocity damping multiplier applied per logical-60-Hz tick. */
const VELOCITY_DAMP = 0.97;

/** How far from a hit point a disturbance reaches (world units). */
const DISTURB_RADIUS = 60;

/** Color palettes for planets. Chosen deterministically per-planet via seeded RNG. */
const PLANET_PALETTES: string[][] = [
  ['#a0855b', '#b5956a', '#8a7248'],  // sandy brown
  ['#7a8fa8', '#8b9eb5', '#6a7f98'],  // gray-blue (rocky)
  ['#7a9e7e', '#8ab58e', '#6a8e6e'],  // muted green (alien)
  ['#9b8caa', '#b5a3c0', '#8a7a9a'],  // dusty purple
  ['#8ec5d6', '#a3d4e6', '#7ab5c6'],  // pale blue (ice)
  ['#c5a07a', '#d6b08a', '#b0906a'],  // ochre
];

interface PowderMolecule {
  pos:     Vec2;
  vel:     Vec2;
  restPos: Vec2;  // equilibrium position (the molecule's home)
  color:   string;
}

export class Planet {
  readonly molecules: PowderMolecule[] = [];
  readonly radius:    number;

  constructor(
    public readonly pos: Vec2,
    radius: number,
    rng: () => number,
  ) {
    this.radius = radius;
    this._generateMolecules(rng);
  }

  private _generateMolecules(rng: () => number): void {
    const palette = PLANET_PALETTES[Math.floor(rng() * PLANET_PALETTES.length)];
    const step    = POWDER_SIZE;
    for (let gy = -this.radius; gy < this.radius; gy += step) {
      for (let gx = -this.radius; gx < this.radius; gx += step) {
        const cx = gx + step * 0.5;
        const cy = gy + step * 0.5;
        const d  = Math.sqrt(cx * cx + cy * cy);
        // Slight noise on the edge to look organic
        const jitter = (rng() - 0.5) * step * 0.8;
        if (d + jitter > this.radius) continue;
        const wx = this.pos.x + cx;
        const wy = this.pos.y + cy;
        const color = palette[Math.floor(rng() * palette.length)];
        this.molecules.push({
          pos:     { x: wx, y: wy },
          vel:     { x: 0,  y: 0  },
          restPos: { x: wx, y: wy },
          color,
        });
      }
    }
  }

  update(dt: number): void {
    const damp = Math.pow(VELOCITY_DAMP, dt * 60);
    for (const m of this.molecules) {
      // Spring force back toward rest position (simulates planetary gravity)
      const dx = m.restPos.x - m.pos.x;
      const dy = m.restPos.y - m.pos.y;
      m.vel.x += dx * GRAVITY_K * dt;
      m.vel.y += dy * GRAVITY_K * dt;
      // Damping so molecules settle rather than oscillating forever
      m.vel.x *= damp;
      m.vel.y *= damp;
      // Integrate
      m.pos.x += m.vel.x * dt;
      m.pos.y += m.vel.y * dt;
    }
  }

  /**
   * Scatter molecules near hitPos outward from the hit point.
   * force  – base impulse magnitude
   * radius – disturbance radius (defaults to DISTURB_RADIUS)
   */
  disturb(hitPos: Vec2, force: number, radius = DISTURB_RADIUS): void {
    for (const m of this.molecules) {
      const dx = m.pos.x - hitPos.x;
      const dy = m.pos.y - hitPos.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d >= radius || d < 0.01) continue;
      const strength = force * (1 - d / radius) / Math.max(d, 1);
      m.vel.x += dx * strength;
      m.vel.y += dy * strength;
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    minX: number, minY: number, maxX: number, maxY: number,
  ): void {
    // Coarse cull: skip entirely if planet AABB is fully outside viewport
    if (
      this.pos.x + this.radius < minX || this.pos.x - this.radius > maxX ||
      this.pos.y + this.radius < minY || this.pos.y - this.radius > maxY
    ) return;

    const half = POWDER_SIZE * 0.5;
    for (const m of this.molecules) {
      // Fine-grained cull
      if (
        m.pos.x + half < minX || m.pos.x - half > maxX ||
        m.pos.y + half < minY || m.pos.y - half > maxY
      ) continue;
      ctx.fillStyle = m.color;
      ctx.fillRect(m.pos.x - half, m.pos.y - half, POWDER_SIZE, POWDER_SIZE);
    }
  }
}
