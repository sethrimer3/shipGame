import { Vec2 } from './types';

/** Half of BLOCK_SIZE (20); powder molecules are smaller than ship modules. */
export const POWDER_SIZE = 15;

/** Spring constant: acceleration (units/s²) per unit displacement from rest. */
const GRAVITY_K = 60;

/** Velocity damping multiplier applied per logical-60-Hz tick. */
const VELOCITY_DAMP = 0.97;

/** How far from a hit point a disturbance reaches (world units). */
const DISTURB_RADIUS = 60;

/** Radius within which molecules are destroyed on a direct impact (crater). */
const IMPACT_CRATER_RADIUS = 22;

/** Radius within which molecules get outward velocity on a direct impact (splash). */
const IMPACT_SPLASH_RADIUS = 55;

/** Distance from a plant base within which an impact ignites the plant. */
const PLANT_BURN_RADIUS = 90;

/** Number of plants generated per planet. */
const PLANT_COUNT_MIN = 24;
const PLANT_COUNT_MAX = 64;

/** Maximum plant length (world units) from planet surface outward. */
const PLANT_MAX_LENGTH_MAX = 30;
const PLANT_MAX_LENGTH_MIN = 8;

/** Plant growth speed in world units per second. */
const PLANT_GROW_RATE = 14;

/** Burn progress per second (1 / PLANT_BURN_RATE = burn duration in seconds). */
const PLANT_BURN_RATE = 0.38;

/** How often (seconds) the minimap color cache is refreshed. */
const MINIMAP_COLOR_UPDATE_INTERVAL_SEC = 2.5;

/** Color palettes for planets. Chosen deterministically per-planet via seeded RNG. */
const PLANET_PALETTES: string[][] = [
  ['#a0855b', '#b5956a', '#8a7248'],  // sandy brown
  ['#7a8fa8', '#8b9eb5', '#6a7f98'],  // gray-blue (rocky)
  ['#7a9e7e', '#8ab58e', '#6a8e6e'],  // muted green (alien)
  ['#9b8caa', '#b5a3c0', '#8a7a9a'],  // dusty purple
  ['#8ec5d6', '#a3d4e6', '#7ab5c6'],  // pale blue (ice)
  ['#c5a07a', '#d6b08a', '#b0906a'],  // ochre
];

/** Lava/magma colors for the molten planet core. */
const LAVA_COLORS: string[] = ['#ff4500', '#ff6600', '#ffaa00', '#ff3300', '#cc2200', '#ff8800'];

/** Water colors for the planetary surface ocean. */
const WATER_COLORS: string[] = ['#1e90ff', '#00bfff', '#4fc3f7', '#29b6f6', '#0277bd', '#0288d1'];

/** Plant colors (various greens). */
const PLANT_COLORS: string[] = ['#2d6a2d', '#3a8c3a', '#228b22', '#1e7a1e', '#4caf50', '#33aa33'];

/** Fraction of planet radius below which molecules are lava. */
const LAVA_CORE_RATIO  = 0.38;

/** Fraction of planet radius above which molecules are water. */
const WATER_SURF_RATIO = 0.78;

type MoleculeType = 'lava' | 'rock' | 'water';

interface PowderMolecule {
  pos:     Vec2;
  vel:     Vec2;
  restPos: Vec2;  // equilibrium position (the molecule's home)
  color:   string;
  alive:   boolean;
  type:    MoleculeType;
}

/** A plant growing radially outward from the planet surface. */
interface Plant {
  /** Angle (radians) from planet center marking where this plant is rooted. */
  angle:        number;
  /** Current grown length in world units (0 → maxLength). */
  length:       number;
  /** Target length when fully grown. */
  maxLength:    number;
  /** Whether the plant is still growing. */
  growing:      boolean;
  /** Whether the plant is on fire. */
  burning:      boolean;
  /** Burn progress 0..1; when ≥ 1 the plant is destroyed. */
  burnProgress: number;
  /** Base green color. */
  baseColor:    string;
}

/** Data returned by impactAt for the caller to spawn world-space particles. */
export interface SplashParticleData {
  pos:   Vec2;
  vel:   Vec2;
  color: string;
}

export class Planet {
  readonly molecules: PowderMolecule[] = [];
  readonly radius:    number;

  private readonly _plants: Plant[] = [];

  /** Cached color representing the visible surface, refreshed periodically. */
  private _minimapColor             = '#7a9e7e';
  private _minimapColorTimerSec     = 0;

  constructor(
    public readonly pos: Vec2,
    radius: number,
    rng: () => number,
  ) {
    this.radius = radius;
    this._generateMolecules(rng);
    this._generatePlants(rng);
    this._updateMinimapColor();
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
        const wx   = this.pos.x + cx;
        const wy   = this.pos.y + cy;
        const relD = d / this.radius;
        let color: string;
        let type:  MoleculeType;
        if (relD < LAVA_CORE_RATIO) {
          color = LAVA_COLORS[Math.floor(rng() * LAVA_COLORS.length)];
          type  = 'lava';
        } else if (relD > WATER_SURF_RATIO) {
          color = WATER_COLORS[Math.floor(rng() * WATER_COLORS.length)];
          type  = 'water';
        } else {
          color = palette[Math.floor(rng() * palette.length)];
          type  = 'rock';
        }
        this.molecules.push({
          pos:     { x: wx, y: wy },
          vel:     { x: 0,  y: 0  },
          restPos: { x: wx, y: wy },
          color,
          alive: true,
          type,
        });
      }
    }
  }

  private _generatePlants(rng: () => number): void {
    const count = PLANT_COUNT_MIN + Math.floor(rng() * (PLANT_COUNT_MAX - PLANT_COUNT_MIN));
    for (let i = 0; i < count; i++) {
      const angle     = rng() * Math.PI * 2;
      const maxLength = PLANT_MAX_LENGTH_MIN + rng() * (PLANT_MAX_LENGTH_MAX - PLANT_MAX_LENGTH_MIN);
      const colorIdx  = Math.floor(rng() * PLANT_COLORS.length);
      this._plants.push({
        angle,
        length:       0,
        maxLength,
        growing:      true,
        burning:      false,
        burnProgress: 0,
        baseColor:    PLANT_COLORS[colorIdx],
      });
    }
  }

  /** Sample surface molecules to compute a representative planet color for the minimap. */
  private _updateMinimapColor(): void {
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    const step = Math.max(1, Math.floor(this.molecules.length / 40));
    for (let i = 0; i < this.molecules.length; i += step) {
      const m = this.molecules[i];
      if (!m.alive) continue;
      const dx   = m.restPos.x - this.pos.x;
      const dy   = m.restPos.y - this.pos.y;
      const relD = Math.sqrt(dx * dx + dy * dy) / this.radius;
      if (relD < 0.6) continue; // skip deep core
      const c = m.color;
      if (c.startsWith('#') && c.length === 7) {
        rSum += parseInt(c.slice(1, 3), 16);
        gSum += parseInt(c.slice(3, 5), 16);
        bSum += parseInt(c.slice(5, 7), 16);
        count++;
      }
    }
    if (count > 0) {
      const r = Math.round(rSum / count).toString(16).padStart(2, '0');
      const g = Math.round(gSum / count).toString(16).padStart(2, '0');
      const b = Math.round(bSum / count).toString(16).padStart(2, '0');
      this._minimapColor = `#${r}${g}${b}`;
    }
  }

  /** Cached color representing the planet's current visual surface state. */
  get minimapColor(): string { return this._minimapColor; }

  update(dt: number): void {
    const damp = Math.pow(VELOCITY_DAMP, dt * 60);
    for (const m of this.molecules) {
      if (!m.alive) continue;
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

    // Update plants (growth and burning)
    for (const plant of this._plants) {
      if (plant.burning) {
        plant.burnProgress += PLANT_BURN_RATE * dt;
        if (plant.burnProgress >= 1) {
          plant.length       = 0;
          plant.burning      = false;
          plant.burnProgress = 0;
          plant.growing      = false; // fully consumed; stays dead
        }
      } else if (plant.growing) {
        plant.length += PLANT_GROW_RATE * dt;
        if (plant.length >= plant.maxLength) {
          plant.length  = plant.maxLength;
          plant.growing = false;
        }
      }
    }

    // Refresh minimap color cache periodically
    this._minimapColorTimerSec += dt;
    if (this._minimapColorTimerSec >= MINIMAP_COLOR_UPDATE_INTERVAL_SEC) {
      this._minimapColorTimerSec = 0;
      this._updateMinimapColor();
    }
  }

  /**
   * Scatter molecules near hitPos outward from the hit point.
   * force  – base impulse magnitude
   * radius – disturbance radius (defaults to DISTURB_RADIUS)
   */
  disturb(hitPos: Vec2, force: number, radius = DISTURB_RADIUS): void {
    for (const m of this.molecules) {
      if (!m.alive) continue;
      const dx = m.pos.x - hitPos.x;
      const dy = m.pos.y - hitPos.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d >= radius || d < 0.01) continue;
      const strength = force * (1 - d / radius) / Math.max(d, 1);
      m.vel.x += dx * strength;
      m.vel.y += dy * strength;
    }
  }

  /**
   * Localized surface impact: kills molecules in the crater zone (emitting them as
   * splash data), gives outward velocity to nearby molecules, and ignites plants.
   * Returns splash particle data for the caller to spawn as world particles.
   */
  impactAt(hitPos: Vec2, force: number): SplashParticleData[] {
    const splashData: SplashParticleData[] = [];
    for (const m of this.molecules) {
      if (!m.alive) continue;
      const dx = m.pos.x - hitPos.x;
      const dy = m.pos.y - hitPos.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < IMPACT_CRATER_RADIUS) {
        // Destroy molecule – eject as a splash particle
        m.alive = false;
        const ang   = Math.atan2(dy, dx);
        // Water splashes faster; rock/sand slower; lava barely moves
        const typeSpeed = m.type === 'water' ? 1.6 : m.type === 'rock' ? 1.0 : 0.25;
        const speed = (45 + Math.random() * 90) * typeSpeed;
        splashData.push({
          pos:   { x: m.pos.x, y: m.pos.y },
          vel:   { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
          color: m.color,
        });
      } else if (d < IMPACT_SPLASH_RADIUS) {
        // Push outward with type-appropriate force
        const typeScale = m.type === 'water' ? 1.4 : m.type === 'rock' ? 0.9 : 0.3;
        const strength  = force * typeScale * (1 - d / IMPACT_SPLASH_RADIUS) / Math.max(d, 1);
        m.vel.x += dx * strength;
        m.vel.y += dy * strength;
      }
    }

    // Ignite plants within burn radius of the impact
    for (const plant of this._plants) {
      if (plant.length <= 0 || plant.burning) continue;
      const baseX = this.pos.x + Math.cos(plant.angle) * this.radius;
      const baseY = this.pos.y + Math.sin(plant.angle) * this.radius;
      const dx = baseX - hitPos.x;
      const dy = baseY - hitPos.y;
      if (dx * dx + dy * dy < PLANT_BURN_RADIUS * PLANT_BURN_RADIUS) {
        plant.burning = true;
      }
    }

    return splashData;
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

    // Draw glowing molten core beneath the molecules
    const coreRadius = this.radius * LAVA_CORE_RATIO;
    if (
      this.pos.x + coreRadius >= minX && this.pos.x - coreRadius <= maxX &&
      this.pos.y + coreRadius >= minY && this.pos.y - coreRadius <= maxY
    ) {
      const grad = ctx.createRadialGradient(
        this.pos.x, this.pos.y, 0,
        this.pos.x, this.pos.y, coreRadius,
      );
      grad.addColorStop(0,   'rgba(255, 220, 60,  0.75)');
      grad.addColorStop(0.5, 'rgba(255, 100, 0,   0.45)');
      grad.addColorStop(1,   'rgba(200, 30,  0,   0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(this.pos.x, this.pos.y, coreRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    const half = POWDER_SIZE * 0.5;
    for (const m of this.molecules) {
      if (!m.alive) continue;
      // Fine-grained cull
      if (
        m.pos.x + half < minX || m.pos.x - half > maxX ||
        m.pos.y + half < minY || m.pos.y - half > maxY
      ) continue;
      ctx.fillStyle = m.color;
      ctx.fillRect(m.pos.x - half, m.pos.y - half, POWDER_SIZE, POWDER_SIZE);
    }

    // Draw plants growing radially outward from the planet surface
    ctx.save();
    ctx.lineCap = 'round';
    for (const plant of this._plants) {
      if (plant.length <= 0) continue;
      const baseX = this.pos.x + Math.cos(plant.angle) * this.radius;
      const baseY = this.pos.y + Math.sin(plant.angle) * this.radius;
      const tipX  = baseX + Math.cos(plant.angle) * plant.length;
      const tipY  = baseY + Math.sin(plant.angle) * plant.length;
      // Coarse cull
      if (
        Math.max(baseX, tipX) < minX || Math.min(baseX, tipX) > maxX ||
        Math.max(baseY, tipY) < minY || Math.min(baseY, tipY) > maxY
      ) continue;

      let strokeColor: string;
      if (plant.burning) {
        // Transition from orange to dark red as the plant burns
        strokeColor = plant.burnProgress < 0.5 ? '#ff7700' : '#882200';
      } else {
        strokeColor = plant.baseColor;
      }
      // Thicker at base, thinner toward tip (two passes: wide base + thin inner)
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth   = 2.5;
      ctx.globalAlpha = plant.burning ? Math.max(0.2, 1 - plant.burnProgress) : 1;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
