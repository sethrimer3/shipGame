import { Vec2 } from './types';

/** One third of the previous powder size; planets are now finer-grained. */
export const POWDER_SIZE = 5;

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

/** Maximum plant growth distance from the planet surface outward. */
const PLANT_MAX_LENGTH_MAX = 30;
const PLANT_MAX_LENGTH_MIN = 8;

/** Plant growth speed in world units per second. */
const PLANT_GROW_RATE = 14;

/** Burn progress per second (1 / PLANT_BURN_RATE = burn duration in seconds). */
const PLANT_BURN_RATE = 0.38;

/** How often (seconds) the minimap color cache is refreshed. */
const MINIMAP_COLOR_UPDATE_INTERVAL_SEC = 2.5;

/** Organic terrain samples around the planet circumference. */
const TERRAIN_SAMPLE_COUNT = 192;
const MOUNTAIN_PEAK_COUNT_MIN = 5;
const MOUNTAIN_PEAK_COUNT_MAX = 10;

/** Surface / strata ratios. */
const LAVA_CORE_RATIO = 0.38;
const DUNE_BASE_RATIO = 0.86;
const DUNE_AMPLITUDE_RATIO = 0.12;
const MOUNTAIN_ROOT_RATIO = 0.50;
const MOUNTAIN_PEAK_RATIO_MIN = 0.96;
const MOUNTAIN_PEAK_RATIO_MAX = 1.16;

const STAGNANT_DISPLACEMENT_SQ = 0.01;
const STAGNANT_VELOCITY_SQ = 0.25;

const SAND_COLORS: string[] = ['#a0855b', '#b5956a', '#8a7248', '#c9aa79', '#9f8459'];
const STONE_COLORS: string[] = ['#676d75', '#7a828c', '#555b62', '#8f99a3'];
const LAVA_COLORS: string[] = ['#ff4500', '#ff6600', '#ffaa00', '#ff3300', '#cc2200', '#ff8800'];
const WATER_COLORS: string[] = ['#1e90ff', '#00bfff', '#4fc3f7', '#29b6f6', '#0277bd', '#0288d1'];
const PLANT_COLORS: string[] = ['#2d6a2d', '#3a8c3a', '#228b22', '#1e7a1e', '#4caf50', '#33aa33'];

type MoleculeType = 'lava' | 'sand' | 'stone' | 'water';

interface PowderMolecule {
  pos: Vec2;
  vel: Vec2;
  restPos: Vec2;
  color: string;
  alive: boolean;
  type: MoleculeType;
}

interface PlantCell {
  /** Distance from the root along the growth axis. */
  distanceWorld: number;
  /** Signed lateral offset from the growth axis. */
  lateralWorld: number;
  /** Cell half-size rendered as a square. */
  halfSizeWorld: number;
}

/** A plant made of small squares rooted at an exposed sand patch. */
interface Plant {
  angle: number;
  length: number;
  maxLength: number;
  growing: boolean;
  burning: boolean;
  burnProgress: number;
  baseColor: string;
  cells: PlantCell[];
}

export interface SplashParticleData {
  pos: Vec2;
  vel: Vec2;
  color: string;
}

export class Planet {
  readonly molecules: PowderMolecule[] = [];
  readonly radius: number;

  private readonly _plants: Plant[] = [];
  private readonly _surfaceRadiusBySample: number[] = new Array<number>(TERRAIN_SAMPLE_COUNT);
  private readonly _waterDepthBySample: number[] = new Array<number>(TERRAIN_SAMPLE_COUNT);
  private readonly _mountainRootRadiusBySample: number[] = new Array<number>(TERRAIN_SAMPLE_COUNT);
  private readonly _mountainPeakRadiusBySample: number[] = new Array<number>(TERRAIN_SAMPLE_COUNT);

  private readonly _isMoleculeActive: boolean[] = [];
  private readonly _activeMoleculeIndices: number[] = [];

  private _minimapColor = '#7a9e7e';
  private _minimapColorTimerSec = 0;

  constructor(
    public readonly pos: Vec2,
    radius: number,
    rng: () => number,
  ) {
    this.radius = radius;
    this._generateTerrainProfile(rng);
    this._generateMolecules(rng);
    this._generatePlants(rng);
    this._updateMinimapColor();
  }

  private _generateTerrainProfile(rng: () => number): void {
    for (let i = 0; i < TERRAIN_SAMPLE_COUNT; i++) {
      const t = i / TERRAIN_SAMPLE_COUNT;
      const duneWaveA = Math.sin(t * Math.PI * 2 * 3 + rng() * Math.PI * 2);
      const duneWaveB = Math.sin(t * Math.PI * 2 * 7 + rng() * Math.PI * 2) * 0.6;
      const duneWaveC = Math.sin(t * Math.PI * 2 * 13 + rng() * Math.PI * 2) * 0.3;
      const duneNoise = (rng() - 0.5) * 0.8;
      const duneRatio = DUNE_BASE_RATIO + (duneWaveA + duneWaveB + duneWaveC + duneNoise) * (DUNE_AMPLITUDE_RATIO / 2.7);
      this._surfaceRadiusBySample[i] = this.radius * Math.max(0.72, Math.min(1.08, duneRatio));
      this._waterDepthBySample[i] = 0;
      this._mountainRootRadiusBySample[i] = 0;
      this._mountainPeakRadiusBySample[i] = 0;
    }

    const mountainPeakCount = MOUNTAIN_PEAK_COUNT_MIN + Math.floor(rng() * (MOUNTAIN_PEAK_COUNT_MAX - MOUNTAIN_PEAK_COUNT_MIN + 1));
    for (let peakIndex = 0; peakIndex < mountainPeakCount; peakIndex++) {
      const centerIndex = Math.floor(rng() * TERRAIN_SAMPLE_COUNT);
      const spread = 5 + Math.floor(rng() * 12);
      const peakRadius = this.radius * (MOUNTAIN_PEAK_RATIO_MIN + rng() * (MOUNTAIN_PEAK_RATIO_MAX - MOUNTAIN_PEAK_RATIO_MIN));
      const rootRadius = this.radius * (MOUNTAIN_ROOT_RATIO + rng() * 0.1);
      for (let offset = -spread; offset <= spread; offset++) {
        const sampleIndex = (centerIndex + offset + TERRAIN_SAMPLE_COUNT) % TERRAIN_SAMPLE_COUNT;
        const falloff = 1 - Math.abs(offset) / (spread + 1);
        const blendedPeak = this._surfaceRadiusBySample[sampleIndex] + (peakRadius - this._surfaceRadiusBySample[sampleIndex]) * falloff;
        if (blendedPeak > this._mountainPeakRadiusBySample[sampleIndex]) {
          this._mountainPeakRadiusBySample[sampleIndex] = blendedPeak;
          this._mountainRootRadiusBySample[sampleIndex] = rootRadius;
        }
      }
    }

    for (let i = 0; i < TERRAIN_SAMPLE_COUNT; i++) {
      const prevIndex = (i - 1 + TERRAIN_SAMPLE_COUNT) % TERRAIN_SAMPLE_COUNT;
      const nextIndex = (i + 1) % TERRAIN_SAMPLE_COUNT;
      const troughDepth = ((this._surfaceRadiusBySample[prevIndex] + this._surfaceRadiusBySample[nextIndex]) * 0.5) - this._surfaceRadiusBySample[i];
      if (troughDepth > POWDER_SIZE * 0.8 && this._mountainPeakRadiusBySample[i] <= 0) {
        this._waterDepthBySample[i] = Math.min(troughDepth * 0.75, this.radius * 0.07);
      }
    }
  }

  private _angleToSampleIndex(angleRad: number): number {
    let normalized = angleRad;
    if (normalized < 0) normalized += Math.PI * 2;
    const t = normalized / (Math.PI * 2);
    let sampleIndex = Math.floor(t * TERRAIN_SAMPLE_COUNT);
    if (sampleIndex >= TERRAIN_SAMPLE_COUNT) sampleIndex = TERRAIN_SAMPLE_COUNT - 1;
    return sampleIndex;
  }

  private _generateMolecules(rng: () => number): void {
    const step = POWDER_SIZE;
    for (let gy = -this.radius; gy < this.radius; gy += step) {
      for (let gx = -this.radius; gx < this.radius; gx += step) {
        const cx = gx + step * 0.5;
        const cy = gy + step * 0.5;
        const d = Math.sqrt(cx * cx + cy * cy);
        const sampleIndex = this._angleToSampleIndex(Math.atan2(cy, cx));
        const surfaceRadius = this._surfaceRadiusBySample[sampleIndex];
        const mountainPeakRadius = this._mountainPeakRadiusBySample[sampleIndex];
        const outerRadius = Math.max(surfaceRadius, mountainPeakRadius);
        const jitter = (rng() - 0.5) * step * 0.7;
        if (d + jitter > outerRadius) continue;

        const wx = this.pos.x + cx;
        const wy = this.pos.y + cy;

        let type: MoleculeType;
        let color: string;
        const relD = d / this.radius;
        const mountainRootRadius = this._mountainRootRadiusBySample[sampleIndex];
        const waterDepth = this._waterDepthBySample[sampleIndex];

        if (relD < LAVA_CORE_RATIO) {
          type = 'lava';
          color = LAVA_COLORS[Math.floor(rng() * LAVA_COLORS.length)];
        } else if (
          mountainPeakRadius > 0 &&
          d >= mountainRootRadius &&
          d <= mountainPeakRadius
        ) {
          type = 'stone';
          color = STONE_COLORS[Math.floor(rng() * STONE_COLORS.length)];
        } else if (
          waterDepth > 0 &&
          d <= surfaceRadius &&
          d >= surfaceRadius - waterDepth
        ) {
          type = 'water';
          color = WATER_COLORS[Math.floor(rng() * WATER_COLORS.length)];
        } else {
          type = 'sand';
          color = SAND_COLORS[Math.floor(rng() * SAND_COLORS.length)];
        }

        const moleculeIndex = this.molecules.length;
        this.molecules.push({
          pos: { x: wx, y: wy },
          vel: { x: 0, y: 0 },
          restPos: { x: wx, y: wy },
          color,
          alive: true,
          type,
        });
        this._isMoleculeActive[moleculeIndex] = false;
      }
    }

    this.molecules.sort((a, b) => (a.color < b.color ? -1 : a.color > b.color ? 1 : 0));
    for (let i = 0; i < this.molecules.length; i++) this._isMoleculeActive[i] = false;
  }

  private _isExposedSandSpot(molecule: PowderMolecule): boolean {
    if (!molecule.alive || molecule.type !== 'sand') return false;
    const dx = molecule.restPos.x - this.pos.x;
    const dy = molecule.restPos.y - this.pos.y;
    const angle = Math.atan2(dy, dx);
    const radialDistance = Math.sqrt(dx * dx + dy * dy);
    const sampleIndex = this._angleToSampleIndex(angle);
    const surfaceRadius = this._surfaceRadiusBySample[sampleIndex];
    const mountainPeakRadius = this._mountainPeakRadiusBySample[sampleIndex];
    const waterDepth = this._waterDepthBySample[sampleIndex];
    const isNearSurface = radialDistance >= surfaceRadius - POWDER_SIZE * 1.5;
    const isUnderMountain = mountainPeakRadius > 0 && radialDistance <= mountainPeakRadius;
    const isInWaterBelt = waterDepth > 0 && radialDistance >= surfaceRadius - waterDepth - POWDER_SIZE;
    return isNearSurface && !isUnderMountain && !isInWaterBelt;
  }

  private _buildPlantCells(maxLength: number, rng: () => number): PlantCell[] {
    const cells: PlantCell[] = [];
    const segmentCount = Math.max(4, Math.floor(maxLength / 2));
    let lateralDrift = 0;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const progress = segmentIndex / Math.max(1, segmentCount - 1);
      const distanceWorld = 1 + progress * maxLength;
      lateralDrift += (rng() - 0.5) * 0.9;
      lateralDrift = Math.max(-2.2, Math.min(2.2, lateralDrift));
      const branchChance = 0.25 + progress * 0.35;
      cells.push({
        distanceWorld,
        lateralWorld: lateralDrift,
        halfSizeWorld: 0.65 + rng() * 0.9,
      });
      if (rng() < branchChance) {
        const branchOffset = (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 1.8);
        cells.push({
          distanceWorld: distanceWorld + rng() * 1.4,
          lateralWorld: lateralDrift + branchOffset,
          halfSizeWorld: 0.55 + rng() * 0.6,
        });
      }
    }
    return cells;
  }

  private _generatePlants(rng: () => number): void {
    const candidateIndices: number[] = [];
    for (let i = 0; i < this.molecules.length; i++) {
      if (this._isExposedSandSpot(this.molecules[i])) candidateIndices.push(i);
    }
    if (candidateIndices.length === 0) return;

    const desiredCount = PLANT_COUNT_MIN + Math.floor(rng() * (PLANT_COUNT_MAX - PLANT_COUNT_MIN));
    const plantCount = Math.min(desiredCount, candidateIndices.length);
    const minAngleSpacing = (Math.PI * 2) / Math.max(plantCount, 1) * 0.55;

    for (let attemptIndex = 0; attemptIndex < candidateIndices.length * 2 && this._plants.length < plantCount; attemptIndex++) {
      const moleculeIndex = candidateIndices[Math.floor(rng() * candidateIndices.length)];
      const molecule = this.molecules[moleculeIndex];
      const angle = Math.atan2(molecule.restPos.y - this.pos.y, molecule.restPos.x - this.pos.x);

      let isTooClose = false;
      for (let i = 0; i < this._plants.length; i++) {
        const diff = Math.abs(Math.atan2(Math.sin(this._plants[i].angle - angle), Math.cos(this._plants[i].angle - angle)));
        if (diff < minAngleSpacing) {
          isTooClose = true;
          break;
        }
      }
      if (isTooClose) continue;

      const maxLength = PLANT_MAX_LENGTH_MIN + rng() * (PLANT_MAX_LENGTH_MAX - PLANT_MAX_LENGTH_MIN);
      const colorIndex = Math.floor(rng() * PLANT_COLORS.length);
      this._plants.push({
        angle,
        length: 0,
        maxLength,
        growing: true,
        burning: false,
        burnProgress: 0,
        baseColor: PLANT_COLORS[colorIndex],
        cells: this._buildPlantCells(maxLength, rng),
      });
    }
  }

  private _updateMinimapColor(): void {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;
    const step = Math.max(1, Math.floor(this.molecules.length / 60));
    for (let i = 0; i < this.molecules.length; i += step) {
      const m = this.molecules[i];
      if (!m.alive) continue;
      const dx = m.restPos.x - this.pos.x;
      const dy = m.restPos.y - this.pos.y;
      const relD = Math.sqrt(dx * dx + dy * dy) / this.radius;
      if (relD < 0.55) continue;
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

  get minimapColor(): string { return this._minimapColor; }

  private _activateMolecule(moleculeIndex: number): void {
    if (moleculeIndex < 0 || moleculeIndex >= this.molecules.length) return;
    if (this._isMoleculeActive[moleculeIndex]) return;
    this._isMoleculeActive[moleculeIndex] = true;
    this._activeMoleculeIndices.push(moleculeIndex);
  }

  update(dt: number, skipMolecules = false): void {
    if (!skipMolecules) {
      const damp = Math.pow(VELOCITY_DAMP, dt * 60);
      let writeIndex = 0;
      for (let activeIndex = 0; activeIndex < this._activeMoleculeIndices.length; activeIndex++) {
        const moleculeIndex = this._activeMoleculeIndices[activeIndex];
        const molecule = this.molecules[moleculeIndex];
        if (!molecule || !molecule.alive) {
          this._isMoleculeActive[moleculeIndex] = false;
          continue;
        }

        const dx = molecule.restPos.x - molecule.pos.x;
        const dy = molecule.restPos.y - molecule.pos.y;
        molecule.vel.x += dx * GRAVITY_K * dt;
        molecule.vel.y += dy * GRAVITY_K * dt;
        molecule.vel.x *= damp;
        molecule.vel.y *= damp;
        molecule.pos.x += molecule.vel.x * dt;
        molecule.pos.y += molecule.vel.y * dt;

        const displacementSq = dx * dx + dy * dy;
        const velocitySq = molecule.vel.x * molecule.vel.x + molecule.vel.y * molecule.vel.y;
        if (displacementSq < STAGNANT_DISPLACEMENT_SQ && velocitySq < STAGNANT_VELOCITY_SQ) {
          molecule.pos.x = molecule.restPos.x;
          molecule.pos.y = molecule.restPos.y;
          molecule.vel.x = 0;
          molecule.vel.y = 0;
          this._isMoleculeActive[moleculeIndex] = false;
          continue;
        }

        this._activeMoleculeIndices[writeIndex++] = moleculeIndex;
      }
      this._activeMoleculeIndices.length = writeIndex;
    }

    for (let plantIndex = 0; plantIndex < this._plants.length; plantIndex++) {
      const plant = this._plants[plantIndex];
      if (plant.burning) {
        plant.burnProgress += PLANT_BURN_RATE * dt;
        if (plant.burnProgress >= 1) {
          plant.length = 0;
          plant.burning = false;
          plant.burnProgress = 0;
          plant.growing = false;
        }
      } else if (plant.growing) {
        plant.length += PLANT_GROW_RATE * dt;
        if (plant.length >= plant.maxLength) {
          plant.length = plant.maxLength;
          plant.growing = false;
        }
      }
    }

    this._minimapColorTimerSec += dt;
    if (this._minimapColorTimerSec >= MINIMAP_COLOR_UPDATE_INTERVAL_SEC) {
      this._minimapColorTimerSec = 0;
      this._updateMinimapColor();
    }
  }

  disturb(hitPos: Vec2, force: number, radius = DISTURB_RADIUS): void {
    for (let i = 0; i < this.molecules.length; i++) {
      const m = this.molecules[i];
      if (!m.alive) continue;
      const dx = m.pos.x - hitPos.x;
      const dy = m.pos.y - hitPos.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= radius || d < 0.01) continue;
      const strength = force * (1 - d / radius) / Math.max(d, 1);
      m.vel.x += dx * strength;
      m.vel.y += dy * strength;
      this._activateMolecule(i);
    }
  }

  impactAt(hitPos: Vec2, force: number): SplashParticleData[] {
    const splashData: SplashParticleData[] = [];
    for (let i = 0; i < this.molecules.length; i++) {
      const m = this.molecules[i];
      if (!m.alive) continue;
      const dx = m.pos.x - hitPos.x;
      const dy = m.pos.y - hitPos.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < IMPACT_CRATER_RADIUS) {
        m.alive = false;
        this._isMoleculeActive[i] = false;
        const ang = Math.atan2(dy, dx);
        const typeSpeed = m.type === 'water' ? 1.6 : m.type === 'sand' ? 0.9 : m.type === 'stone' ? 0.75 : 0.25;
        const speed = (45 + Math.random() * 90) * typeSpeed;
        splashData.push({
          pos: { x: m.pos.x, y: m.pos.y },
          vel: { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
          color: m.color,
        });
      } else if (d < IMPACT_SPLASH_RADIUS) {
        const typeScale = m.type === 'water' ? 1.4 : m.type === 'sand' ? 1.0 : m.type === 'stone' ? 0.55 : 0.3;
        const strength = force * typeScale * (1 - d / IMPACT_SPLASH_RADIUS) / Math.max(d, 1);
        m.vel.x += dx * strength;
        m.vel.y += dy * strength;
        this._activateMolecule(i);
      }
    }

    for (let plantIndex = 0; plantIndex < this._plants.length; plantIndex++) {
      const plant = this._plants[plantIndex];
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
    if (
      this.pos.x + this.radius < minX || this.pos.x - this.radius > maxX ||
      this.pos.y + this.radius < minY || this.pos.y - this.radius > maxY
    ) return;

    const coreRadius = this.radius * LAVA_CORE_RATIO;
    if (
      this.pos.x + coreRadius >= minX && this.pos.x - coreRadius <= maxX &&
      this.pos.y + coreRadius >= minY && this.pos.y - coreRadius <= maxY
    ) {
      const grad = ctx.createRadialGradient(
        this.pos.x, this.pos.y, 0,
        this.pos.x, this.pos.y, coreRadius,
      );
      grad.addColorStop(0, 'rgba(255, 220, 60, 0.75)');
      grad.addColorStop(0.5, 'rgba(255, 100, 0, 0.45)');
      grad.addColorStop(1, 'rgba(200, 30, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(this.pos.x, this.pos.y, coreRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    const half = POWDER_SIZE * 0.5;
    let batchColor = '';
    for (let i = 0; i < this.molecules.length; i++) {
      const m = this.molecules[i];
      if (!m.alive) continue;
      if (
        m.pos.x + half < minX || m.pos.x - half > maxX ||
        m.pos.y + half < minY || m.pos.y - half > maxY
      ) continue;
      if (m.color !== batchColor) {
        if (batchColor !== '') ctx.fill();
        batchColor = m.color;
        ctx.fillStyle = batchColor;
        ctx.beginPath();
      }
      ctx.rect(m.pos.x - half, m.pos.y - half, POWDER_SIZE, POWDER_SIZE);
    }
    if (batchColor !== '') ctx.fill();

    ctx.save();
    for (let plantIndex = 0; plantIndex < this._plants.length; plantIndex++) {
      const plant = this._plants[plantIndex];
      if (plant.length <= 0) continue;
      const cosA = Math.cos(plant.angle);
      const sinA = Math.sin(plant.angle);
      const tangentX = -sinA;
      const tangentY = cosA;
      const baseX = this.pos.x + cosA * this.radius;
      const baseY = this.pos.y + sinA * this.radius;

      let fillColor = plant.baseColor;
      if (plant.burning) {
        fillColor = plant.burnProgress < 0.5 ? '#ff7700' : '#882200';
      }
      ctx.fillStyle = fillColor;
      ctx.globalAlpha = plant.burning ? Math.max(0.2, 1 - plant.burnProgress) : 1;

      for (let cellIndex = 0; cellIndex < plant.cells.length; cellIndex++) {
        const cell = plant.cells[cellIndex];
        if (cell.distanceWorld > plant.length) continue;
        const px = baseX + cosA * cell.distanceWorld + tangentX * cell.lateralWorld;
        const py = baseY + sinA * cell.distanceWorld + tangentY * cell.lateralWorld;
        const size = cell.halfSizeWorld * 2;
        if (px + size < minX || px - size > maxX || py + size < minY || py - size > maxY) continue;
        ctx.fillRect(px - cell.halfSizeWorld, py - cell.halfSizeWorld, size, size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
