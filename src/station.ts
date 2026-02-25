import { Vec2 } from './types';
import { BLOCK_SIZE } from './block';
import { circleVsRect } from './physics';
import { Projectile, StationBeam } from './projectile';

// ── Space station constants ─────────────────────────────────────────────────

/** Safe-zone radius used by chunk generation to skip the area around origin. */
export const STATION_RESET_RADIUS_WORLD = 340;
/** Distance at which targets are considered "sapphire armored" (immune to station beams). */
export const STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD = 4500;

const STATION_RING_RADIUS_WORLD    = 260;
const STATION_RING_THICKNESS_WORLD = 40;
const STATION_MODULE_HP            = 180;
const STATION_TURRET_RANGE_WORLD   = 560;
const STATION_TURRET_FIRE_RATE     = 0.55;
const STATION_TURRET_DAMAGE        = 260;

// ── Interfaces ──────────────────────────────────────────────────────────────

interface SpaceStationModule {
  pos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
  isInfinityModule: boolean;
}

interface SpaceStationTurret {
  pos: Vec2;
  fireCooldownSec: number;
}

// ── SpaceStation ─────────────────────────────────────────────────────────────

export class SpaceStation {
  private modules: SpaceStationModule[] = [];
  private turrets: SpaceStationTurret[] = [];
  private _beamShotsThisFrame = 0;

  constructor() {
    this._init();
  }

  private _init(): void {
    this.modules = [];
    this.turrets = [];

    const ringModuleCount = 56;
    for (let i = 0; i < ringModuleCount; i++) {
      const angle = (i / ringModuleCount) * Math.PI * 2;
      const radius = STATION_RING_RADIUS_WORLD + (i % 2 === 0 ? 0 : STATION_RING_THICKNESS_WORLD * 0.35);
      this.modules.push({
        pos: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius },
        hp: STATION_MODULE_HP,
        maxHp: STATION_MODULE_HP,
        alive: true,
        isInfinityModule: false,
      });
    }

    const infinityPoints: Vec2[] = [];
    const loops = [-1, 1];
    for (const loopDir of loops) {
      const loopCenterX = loopDir * 55;
      const loopRadius = 46;
      for (let i = 0; i < 18; i++) {
        const angle = (i / 18) * Math.PI * 2;
        infinityPoints.push({
          x: loopCenterX + Math.cos(angle) * loopRadius,
          y: Math.sin(angle) * loopRadius * 0.58,
        });
      }
    }
    for (const point of infinityPoints) {
      this.modules.push({
        pos: point,
        hp: Number.POSITIVE_INFINITY,
        maxHp: Number.POSITIVE_INFINITY,
        alive: true,
        isInfinityModule: true,
      });
    }

    const turretAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (const angle of turretAngles) {
      this.turrets.push({
        pos: {
          x: Math.cos(angle) * (STATION_RING_RADIUS_WORLD - 26),
          y: Math.sin(angle) * (STATION_RING_RADIUS_WORLD - 26),
        },
        fireCooldownSec: Math.random() * 0.2,
      });
    }
  }

  reset(): void {
    this._init();
  }

  consumeBeamShots(): number {
    const count = this._beamShotsThisFrame;
    this._beamShotsThisFrame = 0;
    return count;
  }

  getSpawnPosition(): Vec2 {
    return { x: 0, y: 0 };
  }

  /**
   * Update station logic for one frame.
   * @param dt         Seconds elapsed since last frame.
   * @param targets    World-space positions of all live enemy entities near the station.
   * @param projectiles Shared projectile array (enemy projectiles are checked against modules;
   *                   new StationBeams are pushed here when turrets fire).
   */
  update(dt: number, targets: Vec2[], projectiles: Projectile[]): void {
    this._beamShotsThisFrame = 0;

    // ── Incoming enemy projectiles vs station modules ───────────────
    for (const proj of projectiles) {
      if (!proj.alive || proj.owner !== 'enemy') continue;
      for (const module of this.modules) {
        if (!module.alive || module.isInfinityModule) continue;
        if (circleVsRect(proj.pos.x, proj.pos.y, proj.radius,
          module.pos.x - BLOCK_SIZE / 2, module.pos.y - BLOCK_SIZE / 2,
          BLOCK_SIZE, BLOCK_SIZE)) {
          proj.alive = false;
          module.hp -= proj.damage;
          if (module.hp <= 0) module.alive = false;
          break;
        }
      }
    }

    // ── Turrets fire at nearest target ──────────────────────────────
    for (const turret of this.turrets) {
      turret.fireCooldownSec -= dt;
      if (turret.fireCooldownSec > 0) continue;
      let nearest: Vec2 | null = null;
      let nearestDistSq = STATION_TURRET_RANGE_WORLD * STATION_TURRET_RANGE_WORLD;
      for (const target of targets) {
        const dx = target.x - turret.pos.x;
        const dy = target.y - turret.pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > nearestDistSq) continue;
        nearestDistSq = distSq;
        nearest = target;
      }
      if (!nearest) continue;
      turret.fireCooldownSec = 1 / STATION_TURRET_FIRE_RATE;
      projectiles.push(new StationBeam(
        turret.pos,
        { x: nearest.x - turret.pos.x, y: nearest.y - turret.pos.y },
        STATION_TURRET_DAMAGE,
      ));
      this._beamShotsThisFrame++;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const module of this.modules) {
      if (!module.alive) continue;
      ctx.fillStyle = module.isInfinityModule ? 'rgba(255,255,255,0.92)' : 'rgba(120,180,220,0.65)';
      ctx.fillRect(module.pos.x - BLOCK_SIZE / 2, module.pos.y - BLOCK_SIZE / 2, BLOCK_SIZE, BLOCK_SIZE);
      if (!module.isInfinityModule && Number.isFinite(module.maxHp)) {
        const hpRatio = Math.max(0, module.hp / module.maxHp);
        ctx.fillStyle = hpRatio > 0.45 ? 'rgba(90,255,170,0.75)' : 'rgba(255,120,120,0.82)';
        ctx.fillRect(module.pos.x - BLOCK_SIZE / 2, module.pos.y + BLOCK_SIZE / 2 + 2, BLOCK_SIZE * hpRatio, 2);
      }
    }
    for (const turret of this.turrets) {
      ctx.fillStyle = 'rgba(165,225,255,0.9)';
      ctx.beginPath();
      ctx.arc(turret.pos.x, turret.pos.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
