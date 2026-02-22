import { Vec2, len, dist, Material, MATERIAL_PROPS, pickMaterial, pickGem } from './types';
import { Asteroid }  from './asteroid';
import { Enemy }     from './enemy';
import { Particle }  from './particle';
import { Projectile } from './projectile';
import { Player }    from './player';

// ── Constants ──────────────────────────────────────────────────────────────
const CHUNK_SIZE      = 1200;   // world units per chunk
const ASTEROIDS_PER_CHUNK = 4;  // asteroid attempts per chunk
const ENEMIES_PER_CHUNK   = 2;  // enemy attempts per chunk
const STAR_DENSITY        = 80; // stars per chunk

// How many chunks around the camera we keep active
const ACTIVE_RADIUS = 3;

// Gem cluster spawning
const GEM_CLUSTERS_PER_CHUNK = 2;
const GEM_CLUSTER_CHANCE     = 0.35; // probability per attempt

const PICKUP_COLLECT_RADIUS = 40;   // world units for auto-collect
const PICKUP_LIFETIME       = 20;   // seconds before despawn

// ── Floating resource pickup ──────────────────────────────────────────────────
interface ResourcePickup {
  pos:      Vec2;
  vel:      Vec2;
  material: Material;
  qty:      number;
  lifetime: number;
  maxLife:  number;
}

// ── Simple seeded pseudo-random (deterministic per chunk coord) ────────────
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chunkSeed(cx: number, cy: number): number {
  // Combine chunk coords into a single integer seed
  return (((cx & 0xFFFF) << 16) | (cy & 0xFFFF)) >>> 0;
}

// ── Star background (generated once per chunk, never changes) ─────────────
interface Star { x: number; y: number; r: number; brightness: number }

interface Chunk {
  cx:        number;
  cy:        number;
  asteroids: Asteroid[];
  enemies:   Enemy[];
  stars:     Star[];
}

export class World {
  private readonly chunks = new Map<string, Chunk>();
  private readonly debris: Particle[] = [];   // block destruction particles

  /** Floating resource pickups dropped by enemies. */
  pickups: ResourcePickup[] = [];

  /** Accumulated enemy kills – could be used for score */
  kills = 0;

  private _generateChunk(cx: number, cy: number): Chunk {
    const rng    = mulberry32(chunkSeed(cx, cy));
    const baseX  = cx * CHUNK_SIZE;
    const baseY  = cy * CHUNK_SIZE;
    const origin = { x: 0, y: 0 };
    const chunkCentre: Vec2 = { x: baseX + CHUNK_SIZE / 2, y: baseY + CHUNK_SIZE / 2 };
    const distFromOrigin    = len({ x: chunkCentre.x, y: chunkCentre.y });

    const asteroids: Asteroid[] = [];
    const enemies:   Enemy[]    = [];
    const stars:     Star[]     = [];

    // ── Stars ──────────────────────────────────────────────────────
    for (let i = 0; i < STAR_DENSITY; i++) {
      stars.push({
        x:          baseX + rng() * CHUNK_SIZE,
        y:          baseY + rng() * CHUNK_SIZE,
        r:          0.4 + rng() * 1.4,
        brightness: 0.3 + rng() * 0.7,
      });
    }

    // Skip chunks very close to spawn (safe zone)
    if (distFromOrigin < 200) return { cx, cy, asteroids, enemies, stars };

    // ── Asteroids ──────────────────────────────────────────────────
    for (let i = 0; i < ASTEROIDS_PER_CHUNK; i++) {
      const cols = 3 + Math.floor(rng() * 5);
      const rows = 3 + Math.floor(rng() * 5);
      const ax   = baseX + 60 + rng() * (CHUNK_SIZE - 120);
      const ay   = baseY + 60 + rng() * (CHUNK_SIZE - 120);
      asteroids.push(new Asteroid({ x: ax, y: ay }, cols, rows, distFromOrigin, rng));
    }

    // ── Gem clusters (small pure-gem nodes) ───────────────────────
    for (let i = 0; i < GEM_CLUSTERS_PER_CHUNK; i++) {
      if (rng() > GEM_CLUSTER_CHANCE) continue;
      const gemType = pickGem(distFromOrigin, rng);
      if (!gemType) continue;
      const cols = 1 + Math.floor(rng() * 2); // 1–2 cols
      const rows = 1 + Math.floor(rng() * 2); // 1–2 rows
      const gx   = baseX + 60 + rng() * (CHUNK_SIZE - 120);
      const gy   = baseY + 60 + rng() * (CHUNK_SIZE - 120);
      asteroids.push(new Asteroid({ x: gx, y: gy }, cols, rows, distFromOrigin, rng, gemType));
    }

    // ── Enemies ────────────────────────────────────────────────────
    // More enemies further out
    const enemyCount = Math.min(
      ENEMIES_PER_CHUNK + Math.floor(distFromOrigin / 3000),
      6,
    );
    for (let i = 0; i < enemyCount; i++) {
      const ex = baseX + 100 + rng() * (CHUNK_SIZE - 200);
      const ey = baseY + 100 + rng() * (CHUNK_SIZE - 200);
      enemies.push(new Enemy({ x: ex, y: ey }, distFromOrigin, rng));
    }

    return { cx, cy, asteroids, enemies, stars };
  }

  private _getChunk(cx: number, cy: number): Chunk {
    const key = `${cx},${cy}`;
    if (!this.chunks.has(key)) {
      this.chunks.set(key, this._generateChunk(cx, cy));
    }
    return this.chunks.get(key)!;
  }

  /** Returns all chunks within ACTIVE_RADIUS of the camera position. */
  private _activeChunks(camPos: Vec2): Chunk[] {
    const cx0 = Math.floor(camPos.x / CHUNK_SIZE);
    const cy0 = Math.floor(camPos.y / CHUNK_SIZE);
    const result: Chunk[] = [];
    for (let dx = -ACTIVE_RADIUS; dx <= ACTIVE_RADIUS; dx++) {
      for (let dy = -ACTIVE_RADIUS; dy <= ACTIVE_RADIUS; dy++) {
        result.push(this._getChunk(cx0 + dx, cy0 + dy));
      }
    }
    return result;
  }

  update(
    dt:           number,
    player:       Player,
    projectiles:  Projectile[],
    particles:    Particle[],
    camPos:       Vec2,
  ): void {
    const chunks = this._activeChunks(camPos);

    for (const chunk of chunks) {
      // ── Enemy AI ──────────────────────────────────────────────────
      for (const enemy of chunk.enemies) {
        if (!enemy.alive) continue;
        enemy.update(dt, player, projectiles, particles);
      }
      chunk.enemies = chunk.enemies.filter(e => e.alive);

      // ── Asteroid-projectile collisions ────────────────────────────
      for (const asteroid of chunk.asteroids) {
        if (!asteroid.alive) continue;
        for (const proj of projectiles) {
          if (!proj.alive) continue;
          const block = asteroid.blockAt(proj.pos);
          if (block) {
            const killed = block.damage(proj.damage);
            proj.alive   = false;
            if (killed) {
              const debris = asteroid.removeBlock(block, Math.random);
              for (const d of debris) {
                particles.push({
                  pos:      d.pos,
                  vel:      d.vel,
                  color:    d.color,
                  radius:   3,
                  lifetime: d.lifetime,
                  maxLife:  d.maxLife,
                  alpha:    1,
                });
              }
              // Resource drop for player projectiles
              if (proj.owner === 'player') {
                const drop = Asteroid.resourceDrop(block.material);
                player.addResource(drop.material, drop.qty);
              }
            }
          }
        }
      }
      chunk.asteroids = chunk.asteroids.filter(a => a.alive);

      // ── Enemy-projectile collisions ────────────────────────────────
      for (const enemy of chunk.enemies) {
        for (const proj of projectiles) {
          if (!proj.alive || proj.owner !== 'player') continue;
          if (dist(proj.pos, enemy.pos) < enemy.radius + proj.radius) {
            proj.alive = false;
            const killed = enemy.damage(proj.damage, particles, Math.random);
            if (killed) {
              this.kills++;
              // ── Loot drop ──────────────────────────────────────────
              if (Math.random() < enemy.tier.dropChance) {
                const dropDist = len(enemy.pos);
                const mat = pickMaterial(dropDist, Math.random);
                const qty = 1 + Math.floor(Math.random() * 3);
                const ang = Math.random() * Math.PI * 2;
                this.pickups.push({
                  pos:      { x: enemy.pos.x, y: enemy.pos.y },
                  vel:      { x: Math.cos(ang) * 50, y: Math.sin(ang) * 50 },
                  material: mat,
                  qty,
                  lifetime: PICKUP_LIFETIME,
                  maxLife:  PICKUP_LIFETIME,
                });
              }
            }
          }
        }
      }

      // ── Player-projectile collisions ──────────────────────────────
      for (const proj of projectiles) {
        if (!proj.alive || proj.owner !== 'enemy') continue;
        if (dist(proj.pos, player.pos) < player.radius + proj.radius) {
          proj.alive = false;
          player.damage(proj.damage);
        }
      }
    }

    // ── Pickup update & collection ────────────────────────────────
    for (const p of this.pickups) {
      p.lifetime -= dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.vel.x *= 0.98;
      p.vel.y *= 0.98;
      if (dist(p.pos, player.pos) < PICKUP_COLLECT_RADIUS) {
        player.addResource(p.material, p.qty);
        p.lifetime = 0; // mark collected
      }
    }
    this.pickups = this.pickups.filter(p => p.lifetime > 0);
  }

  draw(ctx: CanvasRenderingContext2D, camPos: Vec2): void {
    const chunks = this._activeChunks(camPos);

    // ── Asteroids ──────────────────────────────────────────────────
    for (const chunk of chunks) {
      for (const asteroid of chunk.asteroids) {
        asteroid.draw(ctx);
      }
    }

    // ── Enemies ────────────────────────────────────────────────────
    for (const chunk of chunks) {
      for (const enemy of chunk.enemies) {
        enemy.draw(ctx);
      }
    }

    // ── Resource pickups ───────────────────────────────────────────
    const now = Date.now();
    for (const p of this.pickups) {
      const fade  = Math.min(1, p.lifetime / 3); // fade out last 3 s
      const pulse = 0.65 + Math.sin(now / 300) * 0.25;
      const props = MATERIAL_PROPS[p.material];
      ctx.save();
      ctx.globalAlpha = fade * pulse;
      ctx.shadowColor = props.color;
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = props.color;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = fade * 0.85;
      ctx.fillStyle = props.color;
      ctx.font = '9px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText(`${p.material} ×${p.qty}`, p.pos.x, p.pos.y - 9);
      ctx.restore();
    }
  }

  /** Returns entity positions for the minimap. */
  getMinimapData(camPos: Vec2): { enemies: Vec2[]; asteroids: Vec2[]; pickups: Vec2[] } {
    const chunks    = this._activeChunks(camPos);
    const enemies:   Vec2[] = [];
    const asteroids: Vec2[] = [];
    const pickupPos: Vec2[] = [];
    for (const chunk of chunks) {
      for (const e of chunk.enemies)   if (e.alive) enemies.push({ ...e.pos });
      for (const a of chunk.asteroids) if (a.alive) asteroids.push({ ...a.centre });
    }
    for (const p of this.pickups) pickupPos.push({ ...p.pos });
    return { enemies, asteroids, pickups: pickupPos };
  }
}
