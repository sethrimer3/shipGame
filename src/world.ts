import { Vec2, len, dist, Material, MATERIAL_PROPS, pickMaterial, pickGem } from './types';
import { Asteroid, AsteroidTurret }  from './asteroid';
import { Planet, SplashParticleData } from './planet';
import { Enemy, EnemyModuleFragment } from './enemy';
import { Drone } from './drone';
import { Interceptor } from './interceptor';
import { Gunship } from './gunship';
import { Bomber } from './bomber';
import { Particle, FloatingText, makeFloatingText }  from './particle';
import { Projectile } from './projectile';
import { Player }    from './player';
import { BLOCK_SIZE, Block } from './block';
import { Mothership, mothershipTierForDist } from './mothership';
import {
  circleVsRect,
  segmentIntersectsRect,
  segmentCircleClosestT,
  segmentRectEntryTime,
  steerShipAroundAsteroids,
  resolveShipAsteroidCollision,
} from './physics';
import { SpaceStation, STATION_RESET_RADIUS_WORLD, STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD } from './station';
import { GraphicsConfig } from './graphics-settings';

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

// Mothership spawning
const MOTHERSHIP_MIN_DIST      = 3000;  // world-unit distance before motherships appear
const MOTHERSHIP_SPAWN_CHANCE  = 0.22; // probability per chunk (in eligible area)
// Trap asteroid probability (per asteroid)
const TRAP_ASTEROID_CHANCE     = 0.18;
const TRAP_ASTEROID_MIN_DIST   = 1000; // minimum world-unit distance for trap asteroids
// Min turrets per asteroid (if chosen), max
const TURRET_ASTEROID_CHANCE   = 0.30; // chance an asteroid gets turrets
// Interceptor spawning
const INTERCEPTOR_MIN_DIST     = 1500; // minimum world distance for interceptors
const INTERCEPTOR_SPAWN_CHANCE = 0.40; // probability per chunk attempt
// Gunship spawning
const GUNSHIP_MIN_DIST         = 1200; // minimum world distance for gunships
const GUNSHIP_SPAWN_CHANCE     = 0.35; // probability per chunk attempt
// Bomber spawning
const BOMBER_MIN_DIST          = 2500; // minimum world distance for bombers
const BOMBER_SPAWN_CHANCE      = 0.28; // probability per chunk attempt

// Planet spawning
const PLANET_MIN_DIST     = 500;   // minimum world distance for planets
const PLANET_SPAWN_CHANCE = 0.25;  // probability per chunk attempt
const PLANET_MIN_RADIUS   = 240;   // minimum planet radius (world units) – 3× original
const PLANET_MAX_RADIUS   = 480;   // maximum planet radius (world units) – 3× original

/** Gravitational acceleration constant for planet attraction: accel = K * radius / d² */
const PLANET_GRAVITY_STRENGTH = 2000;
/** Maximum distance (beyond planet surface) within which planetary gravity acts. */
const PLANET_GRAVITY_RANGE    = 600;


const PICKUP_COLLECT_RADIUS = 40;   // world units for auto-collect
const PICKUP_SUCTION_RADIUS = 200;  // world units where pickups accelerate toward player
const PICKUP_LIFETIME       = 20;   // seconds before despawn
const PICKUP_HALF_SIZE      = 5;    // half-side of pickup draw rect (world units)

const HEALTH_DROP_CHANCE        = 0.15; // probability of a health pack dropping on enemy kill
const HEALTH_DROP_XP_MULTIPLIER = 0.3;  // heal amount = 10 + xpValue * this

// ── Floating module fragment (detached from a destroyed enemy ship) ──────────
const FLOATING_MODULE_START_HP    = 40;  // initial HP of a floating module
const FLOATING_MODULE_DAMAGE_RATE = 5;   // HP/s passive damage when unattached

interface FloatingModule {
  pos:    Vec2;
  vel:    Vec2;
  color:  string;
  hp:     number;
  maxHp:  number;
  size:   number;  // block size in pixels
}

// ── Floating resource pickup ──────────────────────────────────────────────────
interface ResourcePickup {
  pos:      Vec2;
  vel:      Vec2;
  material: Material;
  qty:      number;
  lifetime: number;
  maxLife:  number;
}

// ── Health pickup dropped by enemies ─────────────────────────────────────────
interface HealthPickup {
  pos:      Vec2;
  vel:      Vec2;
  amount:   number; // HP restored on collection
  lifetime: number;
  maxLife:  number;
}

// ── Player-placed block ───────────────────────────────────────────────────────
interface PlacedBlock {
  pos:      Vec2;   // world-space top-left corner (snapped to BLOCK_SIZE grid)
  material: Material;
  hp:       number;
  maxHp:    number;
  alive:    boolean;
}

interface GridPos { x: number; y: number }

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
  cx:           number;
  cy:           number;
  asteroids:    Asteroid[];
  enemies:      Enemy[];
  stars:        Star[];
  motherships:  Mothership[];
  turrets:      AsteroidTurret[];
  interceptors: Interceptor[];
  gunships:     Gunship[];
  bombers:      Bomber[];
  planets:      Planet[];
}

export class World {
  private readonly chunks = new Map<string, Chunk>();
  private readonly debris: Particle[] = [];   // block destruction particles

  private readonly station = new SpaceStation();

  /** Cache: last computed active-chunk list, keyed by chunk-grid coords string. */
  private _cachedChunkKey = '';
  private _cachedChunks:   Chunk[] = [];

  /** Floating resource pickups dropped by enemies and asteroid debris. */
  pickups: ResourcePickup[] = [];

  /** Health pickups dropped by enemies. */
  healthPickups: HealthPickup[] = [];

  /** Blocks placed by the player. */
  placedBlocks: PlacedBlock[] = [];

  /** Active drones spawned by motherships and trap asteroids. */
  drones: Drone[] = [];

  /** Detached enemy ship modules drifting in space. */
  floatingModules: FloatingModule[] = [];

  /** Accumulated enemy kills – could be used for score */
  kills = 0;

  constructor() {}

  resetForLoop(): void {
    this.chunks.clear();
    this._cachedChunkKey = '';  // invalidate chunk cache
    this._cachedChunks   = [];
    this.debris.length = 0;
    this.pickups = [];
    this.healthPickups = [];
    this.placedBlocks = [];
    this.drones = [];
    this.floatingModules = [];
    this.kills = 0;
    this.station.reset();
  }

  snapToBlockGrid(worldPos: Vec2): GridPos {
    const snap = (coord: number) => Math.floor(coord / BLOCK_SIZE) * BLOCK_SIZE;
    return { x: snap(worldPos.x), y: snap(worldPos.y) };
  }

  hasPlacedBlockAt(worldPos: Vec2): boolean {
    const snap = this.snapToBlockGrid(worldPos);
    return this.placedBlocks.some(b => b.alive && b.pos.x === snap.x && b.pos.y === snap.y);
  }

  /** Place a block at a world position (snapped to grid) using the given material. */
  placeBlock(worldPos: Vec2, material: Material): PlacedBlock | null {
    const snapped = this.snapToBlockGrid(worldPos);
    if (this.hasPlacedBlockAt(snapped)) return null;
    const maxHp = MATERIAL_PROPS[material].hardness;
    const block: PlacedBlock = {
      pos:      { x: snapped.x, y: snapped.y },
      material,
      hp:       maxHp,
      maxHp,
      alive:    true,
    };
    this.placedBlocks.push(block);
    return block;
  }

  /** Spawn a FloatingModule from an EnemyModuleFragment. */
  private _spawnFloatingModule(frag: EnemyModuleFragment): void {
    this.floatingModules.push({
      pos:   { x: frag.pos.x, y: frag.pos.y },
      vel:   { x: frag.vel.x, y: frag.vel.y },
      color: frag.color,
      hp:    FLOATING_MODULE_START_HP,
      maxHp: FLOATING_MODULE_START_HP,
      size:  frag.size,
    });
  }

  private _generateChunk(cx: number, cy: number): Chunk {
    const rng    = mulberry32(chunkSeed(cx, cy));
    const baseX  = cx * CHUNK_SIZE;
    const baseY  = cy * CHUNK_SIZE;
    const origin = { x: 0, y: 0 };
    const chunkCentre: Vec2 = { x: baseX + CHUNK_SIZE / 2, y: baseY + CHUNK_SIZE / 2 };
    const distFromOrigin    = len({ x: chunkCentre.x, y: chunkCentre.y });

    const asteroids:    Asteroid[]       = [];
    const enemies:      Enemy[]          = [];
    const stars:        Star[]           = [];
    const motherships:  Mothership[]     = [];
    const turrets:      AsteroidTurret[] = [];
    const interceptors: Interceptor[]    = [];
    const gunships:     Gunship[]        = [];
    const bombers:      Bomber[]         = [];
    const planets:      Planet[]         = [];

    // ── Stars ──────────────────────────────────────────────────────
    for (let i = 0; i < STAR_DENSITY; i++) {
      stars.push({
        x:          baseX + rng() * CHUNK_SIZE,
        y:          baseY + rng() * CHUNK_SIZE,
        r:          0.4 + rng() * 1.4,
        brightness: 0.3 + rng() * 0.7,
      });
    }

    // Skip chunks very close to spawn (safe zone around station)
    if (distFromOrigin < STATION_RESET_RADIUS_WORLD + CHUNK_SIZE * 0.25) return { cx, cy, asteroids, enemies, stars, motherships, turrets, interceptors, gunships, bombers, planets };

    // ── Asteroids ──────────────────────────────────────────────────
    for (let i = 0; i < ASTEROIDS_PER_CHUNK; i++) {
      const cols = 3 + Math.floor(rng() * 5);
      const rows = 3 + Math.floor(rng() * 5);
      const ax   = baseX + 60 + rng() * (CHUNK_SIZE - 120);
      const ay   = baseY + 60 + rng() * (CHUNK_SIZE - 120);
      const ast  = new Asteroid({ x: ax, y: ay }, cols, rows, distFromOrigin, rng);

      // Mark some asteroids as traps (only outside safe zone)
      if (distFromOrigin >= TRAP_ASTEROID_MIN_DIST && rng() < TRAP_ASTEROID_CHANCE) {
        ast.isTrap = true;
      }

      // Add turrets to some asteroids
      if (rng() < TURRET_ASTEROID_CHANCE) {
        this._spawnTurretsOnAsteroid(ast, distFromOrigin, rng, turrets);
      }

      asteroids.push(ast);
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

    // ── Motherships (spawn at sufficient distance) ─────────────────
    if (distFromOrigin >= MOTHERSHIP_MIN_DIST && rng() < MOTHERSHIP_SPAWN_CHANCE) {
      const mx = baseX + CHUNK_SIZE / 2 + (rng() - 0.5) * CHUNK_SIZE * 0.4;
      const my = baseY + CHUNK_SIZE / 2 + (rng() - 0.5) * CHUNK_SIZE * 0.4;
      motherships.push(new Mothership({ x: mx, y: my }, distFromOrigin, rng));
    }

    // ── Interceptors (spawn in small groups beyond safe zone) ──────
    if (distFromOrigin >= INTERCEPTOR_MIN_DIST && rng() < INTERCEPTOR_SPAWN_CHANCE) {
      const groupSize = 2 + Math.floor(rng() * 3); // 2–4 per group
      const gx = baseX + 100 + rng() * (CHUNK_SIZE - 200);
      const gy = baseY + 100 + rng() * (CHUNK_SIZE - 200);
      let iTier: 0 | 1 | 2;
      if (distFromOrigin >= 10000)      iTier = 2;
      else if (distFromOrigin >= 4000)  iTier = 1;
      else                              iTier = 0;
      for (let i = 0; i < groupSize; i++) {
        const ang    = (i / groupSize) * Math.PI * 2;
        const spread = 60 + rng() * 60;
        interceptors.push(new Interceptor(
          { x: gx + Math.cos(ang) * spread, y: gy + Math.sin(ang) * spread },
          iTier,
        ));
      }
    }

    // ── Gunships (spawn in pairs beyond 1200 world units) ─────────
    if (distFromOrigin >= GUNSHIP_MIN_DIST && rng() < GUNSHIP_SPAWN_CHANCE) {
      const groupSize = 1 + Math.floor(rng() * 2); // 1–2 per group
      const gx = baseX + 100 + rng() * (CHUNK_SIZE - 200);
      const gy = baseY + 100 + rng() * (CHUNK_SIZE - 200);
      let gTier: 0 | 1 | 2;
      if (distFromOrigin >= 10000)     gTier = 2;
      else if (distFromOrigin >= 4000) gTier = 1;
      else                             gTier = 0;
      for (let i = 0; i < groupSize; i++) {
        const ang    = (i / groupSize) * Math.PI * 2;
        const spread = 50 + rng() * 50;
        gunships.push(new Gunship(
          { x: gx + Math.cos(ang) * spread, y: gy + Math.sin(ang) * spread },
          gTier,
        ));
      }
    }

    // ── Bombers (spawn solo beyond 2500 world units) ───────────────
    if (distFromOrigin >= BOMBER_MIN_DIST && rng() < BOMBER_SPAWN_CHANCE) {
      const bx = baseX + 100 + rng() * (CHUNK_SIZE - 200);
      const by = baseY + 100 + rng() * (CHUNK_SIZE - 200);
      let bTier: 0 | 1 | 2;
      if (distFromOrigin >= 12000)     bTier = 2;
      else if (distFromOrigin >= 6000) bTier = 1;
      else                             bTier = 0;
      bombers.push(new Bomber({ x: bx, y: by }, bTier));
    }

    // ── Planets (spawn beyond 500 world units, one per chunk) ─────
    if (distFromOrigin >= PLANET_MIN_DIST && rng() < PLANET_SPAWN_CHANCE) {
      const px     = baseX + 200 + rng() * (CHUNK_SIZE - 400);
      const py     = baseY + 200 + rng() * (CHUNK_SIZE - 400);
      const radius = PLANET_MIN_RADIUS + Math.floor(rng() * (PLANET_MAX_RADIUS - PLANET_MIN_RADIUS));
      planets.push(new Planet({ x: px, y: py }, radius, rng));
    }

    return { cx, cy, asteroids, enemies, stars, motherships, turrets, interceptors, gunships, bombers, planets };
  }

  /** Helper: place 1–2 turrets on perimeter blocks of an asteroid. */
  private _spawnTurretsOnAsteroid(
    asteroid: Asteroid,
    distFromOrigin: number,
    rng: () => number,
    turrets: AsteroidTurret[],
  ): void {
    const aliveSet = new Set(asteroid.blocks.map(b => `${b.col},${b.row}`));
    const perimeter = asteroid.blocks.filter(b =>
      !aliveSet.has(`${b.col + 1},${b.row}`) ||
      !aliveSet.has(`${b.col - 1},${b.row}`) ||
      !aliveSet.has(`${b.col},${b.row + 1}`) ||
      !aliveSet.has(`${b.col},${b.row - 1}`)
    );
    if (perimeter.length === 0) return;

    // Shuffle perimeter deterministically
    const shuffled = [...perimeter];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const count = 1 + Math.floor(rng() * 2); // 1 or 2 turrets
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
      turrets.push(new AsteroidTurret(asteroid, shuffled[i], distFromOrigin));
    }
  }

  private _getChunk(cx: number, cy: number): Chunk {
    const key = `${cx},${cy}`;
    if (!this.chunks.has(key)) {
      this.chunks.set(key, this._generateChunk(cx, cy));
    }
    return this.chunks.get(key)!;
  }

  /** Returns all chunks within ACTIVE_RADIUS of the camera position.
   *  Result is cached by chunk-grid key — no reallocation when the camera hasn't
   *  crossed a chunk boundary since the last call.
   */
  private _activeChunks(camPos: Vec2): Chunk[] {
    const cx0 = Math.floor(camPos.x / CHUNK_SIZE);
    const cy0 = Math.floor(camPos.y / CHUNK_SIZE);
    const key = `${cx0},${cy0}`;
    if (key === this._cachedChunkKey) return this._cachedChunks;
    this._cachedChunkKey = key;
    const result: Chunk[] = [];
    for (let dx = -ACTIVE_RADIUS; dx <= ACTIVE_RADIUS; dx++) {
      for (let dy = -ACTIVE_RADIUS; dy <= ACTIVE_RADIUS; dy++) {
        result.push(this._getChunk(cx0 + dx, cy0 + dy));
      }
    }
    this._cachedChunks = result;
    return result;
  }

  consumeStationBeamShotsThisFrame(): number {
    return this.station.consumeBeamShots();
  }

  update(
    dt:           number,
    player:       Player,
    projectiles:  Projectile[],
    particles:    Particle[],
    floatingTexts: FloatingText[],
    camPos:       Vec2,
    config:       GraphicsConfig,
  ): void {
    const chunks = this._activeChunks(camPos);
    const skipPlanetMolecules = !config.planetMoleculeSimulation;

    for (const chunk of chunks) {
      // ── Enemy AI ──────────────────────────────────────────────────
      for (const enemy of chunk.enemies) {
        if (!enemy.alive) continue;
        steerShipAroundAsteroids(enemy.pos, enemy.vel, enemy.radius, chunk.asteroids, dt);
        enemy.update(dt, player, projectiles, particles);
      }
      chunk.enemies = chunk.enemies.filter(e => e.alive);

      // ── Asteroid-projectile collisions ────────────────────────────
      for (const asteroid of chunk.asteroids) {
        if (!asteroid.alive) continue;
        for (const proj of projectiles) {
          if (!proj.alive) continue;
          const lx = proj.pos.x - asteroid.pos.x;
          const ly = proj.pos.y - asteroid.pos.y;
          const prevLx = proj.prevPos.x - asteroid.pos.x;
          const prevLy = proj.prevPos.y - asteroid.pos.y;
          let block = asteroid.blockAt(proj.pos);
          if (!block) {
            let bestHitT = Number.POSITIVE_INFINITY;
            for (const b of asteroid.blocks) {
              if (!b.alive) continue;
              const blockX = b.col * BLOCK_SIZE;
              const blockY = b.row * BLOCK_SIZE;
              const intersects =
                circleVsRect(lx, ly, proj.radius, blockX, blockY, BLOCK_SIZE, BLOCK_SIZE)
                || circleVsRect(prevLx, prevLy, proj.radius, blockX, blockY, BLOCK_SIZE, BLOCK_SIZE)
                || segmentIntersectsRect(prevLx, prevLy, lx, ly, blockX, blockY, BLOCK_SIZE, BLOCK_SIZE);
              if (!intersects) continue;
              const hitT = segmentRectEntryTime(
                prevLx, prevLy,
                lx, ly,
                blockX - proj.radius,
                blockY - proj.radius,
                BLOCK_SIZE + proj.radius * 2,
                BLOCK_SIZE + proj.radius * 2,
              );
              const sortT = hitT ?? 0;
              if (sortT >= bestHitT) continue;
              bestHitT = sortT;
              block = b;
            }
          }
          if (block) {
            // Trap asteroid: trigger drone swarm on first hit
            if (asteroid.isTrap && !asteroid.trapTriggered) {
              asteroid.trapTriggered = true;
              const numDrones = 5 + Math.floor(Math.random() * 5);
              // Drone tier scales with how far the asteroid is from the origin
              const asteroidDist = len(asteroid.centre);
              const droneTier: 0 | 1 | 2 = asteroidDist >= 12000 ? 2 : asteroidDist >= 5000 ? 1 : 0;
              for (let di = 0; di < numDrones; di++) {
                const ang = (di / numDrones) * Math.PI * 2 + Math.random() * 0.4;
                const r   = asteroid.radius + 25;
                const dPos = {
                  x: asteroid.centre.x + Math.cos(ang) * r,
                  y: asteroid.centre.y + Math.sin(ang) * r,
                };
                this.drones.push(new Drone(dPos, droneTier));
              }
            }

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
              // Resource drop: spawn a floating pickup that flies off
              if (proj.owner === 'player') {
                const drop = Asteroid.resourceDrop(block.material);
                const ang   = Math.random() * Math.PI * 2;
                const speed = 80 + Math.random() * 150;
                const blockCx = asteroid.pos.x + block.col * BLOCK_SIZE + BLOCK_SIZE / 2;
                const blockCy = asteroid.pos.y + block.row * BLOCK_SIZE + BLOCK_SIZE / 2;
                this.pickups.push({
                  pos:      { x: blockCx, y: blockCy },
                  vel:      { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
                  material: drop.material,
                  qty:      drop.qty,
                  lifetime: PICKUP_LIFETIME,
                  maxLife:  PICKUP_LIFETIME,
                });
              }
            }
          }
        }
      }
      chunk.asteroids = chunk.asteroids.filter(a => a.alive);

      // ── Asteroid physics update ───────────────────────────────────
      for (const asteroid of chunk.asteroids) {
        asteroid.update(dt);
      }

      // ── Ship-asteroid collisions ──────────────────────────────────
      for (const asteroid of chunk.asteroids) {
        resolveShipAsteroidCollision(
          player.pos, player.vel, player.radius, player.mass, asteroid,
        );
        for (const enemy of chunk.enemies) {
          if (!enemy.alive) continue;
          resolveShipAsteroidCollision(
            enemy.pos, enemy.vel, enemy.radius, enemy.mass, asteroid,
          );
        }
      }

      // ── Enemy-projectile collisions ────────────────────────────────
      for (const enemy of chunk.enemies) {
        for (const proj of projectiles) {
          if (!proj.alive || proj.owner !== 'player') continue;
          if (dist(proj.pos, enemy.pos) < enemy.radius + proj.radius) {
            proj.alive = false;
            const isSapphireArmoredTarget = enemy.tier.minDist >= STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD;
            const appliedDamage = proj.isStationBeam && isSapphireArmoredTarget ? 0 : proj.damage;
            const result = enemy.damageAt(proj.pos, appliedDamage, particles, Math.random);
            // Alert the enemy: player hit it, so it should start chasing
            if (!result.killed) enemy.alertedByPlayer();
            // Spawn floating modules for any detached fragments
            for (const frag of result.fragments) {
              this._spawnFloatingModule(frag);
            }
            floatingTexts.push(makeFloatingText(
              { x: enemy.pos.x, y: enemy.pos.y - enemy.radius },
              `-${appliedDamage}`,
              '#ffcc44',
            ));
            if (result.killed) {
              this.kills++;
              player.gainXP(enemy.tier.xpValue);
              floatingTexts.push(makeFloatingText(
                { x: enemy.pos.x, y: enemy.pos.y - enemy.radius - 18 },
                `+${enemy.tier.xpValue} XP`,
                '#2ecc71',
              ));
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
              // ── Health pack drop (15% chance) ──────────────────────
              if (Math.random() < HEALTH_DROP_CHANCE) {
                const healAmount = 10 + Math.floor(enemy.tier.xpValue * HEALTH_DROP_XP_MULTIPLIER);
                const ang = Math.random() * Math.PI * 2;
                this.healthPickups.push({
                  pos:      { x: enemy.pos.x, y: enemy.pos.y },
                  vel:      { x: Math.cos(ang) * 60, y: Math.sin(ang) * 60 },
                  amount:   healAmount,
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
          player.damageModule(proj.pos, proj.damage, particles);
          floatingTexts.push(makeFloatingText(
            { x: player.pos.x + (Math.random() - 0.5) * 24, y: player.pos.y - player.radius - 8 },
            `-${proj.damage}`,
            '#e74c3c',
          ));
        }
      }

      // ── Mothership AI update ──────────────────────────────────────
      for (const ms of chunk.motherships) {
        if (!ms.alive) continue;
        ms.update(dt, player, projectiles, particles, this.drones);
      }

      // ── Mothership-projectile collisions (player hits mothership) ─
      for (const ms of chunk.motherships) {
        if (!ms.alive) continue;
        for (const proj of projectiles) {
          if (!proj.alive || proj.owner !== 'player') continue;
          const mod = ms.moduleAt(proj.pos);
          if (mod) {
            proj.alive = false;
            const isSapphireArmoredTarget = ms.tier.minDist >= STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD;
            const appliedDamage = proj.isStationBeam && isSapphireArmoredTarget ? 0 : proj.damage;
            ms.damageModule(mod, appliedDamage, particles, Math.random);
            floatingTexts.push(makeFloatingText(
              { x: proj.pos.x, y: proj.pos.y - 10 },
              `-${appliedDamage}`,
              '#ffcc44',
            ));
            if (ms.isDead) {
              this.kills++;
              player.gainXP(ms.tier.xpValue);
              floatingTexts.push(makeFloatingText(
                { x: ms.pos.x, y: ms.pos.y - 40 },
                `+${ms.tier.xpValue} XP`,
                '#2ecc71',
              ));
              // Generous loot drop
              for (let li = 0; li < 6; li++) {
                const ang = Math.random() * Math.PI * 2;
                const mat = pickMaterial(len(ms.pos), Math.random);
                const qty = 2 + Math.floor(Math.random() * 4);
                this.pickups.push({
                  pos:      { x: ms.pos.x, y: ms.pos.y },
                  vel:      { x: Math.cos(ang) * 120, y: Math.sin(ang) * 120 },
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
      chunk.motherships = chunk.motherships.filter(ms => ms.alive);

      // ── Turret AI update ──────────────────────────────────────────
      for (const turret of chunk.turrets) {
        if (!turret.alive) continue;
        turret.update(dt, player, projectiles, particles);
      }

      // ── Turret-projectile collisions (player hits turret) ─────────
      for (const turret of chunk.turrets) {
        if (!turret.alive) continue;
        for (const proj of projectiles) {
          if (!proj.alive || proj.owner !== 'player') continue;
          if (dist(proj.pos, turret.pos) < turret.radius + proj.radius) {
            proj.alive = false;
            const killed = turret.damage(proj.damage, particles, Math.random);
            if (killed) {
              this.kills++;
              player.gainXP(12);
            }
          }
        }
      }
      chunk.turrets = chunk.turrets.filter(t => t.alive);

      // ── Interceptor AI update + asteroid collisions ──────────────
      for (const ic of chunk.interceptors) {
        if (!ic.alive) continue;
        const prevX = ic.pos.x;
        const prevY = ic.pos.y;
        ic.update(dt, player, particles);
        for (const asteroid of chunk.asteroids) {
          // Swept check to prevent tunnelling through asteroids at high speed.
          const dx = ic.pos.x - prevX;
          const dy = ic.pos.y - prevY;
          const movedDistSq = dx * dx + dy * dy;
          if (movedDistSq > 1e-6) {
            const tClosest = segmentCircleClosestT(
              prevX, prevY,
              ic.pos.x, ic.pos.y,
              asteroid.centre.x, asteroid.centre.y,
            );
            const nearX = prevX + dx * tClosest;
            const nearY = prevY + dy * tClosest;
            const rad = ic.radius + asteroid.radius;
            const ox = nearX - asteroid.centre.x;
            const oy = nearY - asteroid.centre.y;
            if (ox * ox + oy * oy <= rad * rad) {
              const rewindDistance = Math.min(Math.sqrt(movedDistSq), ic.maxSpeed * dt);
              const moveLen = Math.sqrt(movedDistSq);
              if (moveLen > 1e-6) {
                const invMove = 1 / moveLen;
                ic.pos.x = nearX - dx * invMove * rewindDistance * 0.1;
                ic.pos.y = nearY - dy * invMove * rewindDistance * 0.1;
              }
            }
          }
          resolveShipAsteroidCollision(ic.pos, ic.vel, ic.radius, ic.mass, asteroid);
        }
      }

      // ── Interceptor ram collision (contact with player) ───────────
      for (const ic of chunk.interceptors) {
        if (!ic.alive) continue;
        if (dist(ic.pos, player.pos) < ic.radius + player.radius) {
          player.damageModule(ic.pos, ic.ramDamage, particles);
          ic.alive = false;
          particles.push(...Array.from({ length: 14 }, () => {
            const ang = Math.random() * Math.PI * 2;
            const spd = 60 + Math.random() * 100;
            return {
              pos:      { x: ic.pos.x, y: ic.pos.y },
              vel:      { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd },
              color:    '#ff4444',
              radius:   2 + Math.random() * 2,
              lifetime: 0.4 + Math.random() * 0.5,
              maxLife:  0.9,
              alpha:    1,
            };
          }));
          floatingTexts.push(makeFloatingText(
            { x: player.pos.x + (Math.random() - 0.5) * 24, y: player.pos.y - player.radius - 10 },
            `-${ic.ramDamage} RAM`,
            '#ff4444',
          ));
          this.kills++;
          player.gainXP(ic.xpValue);
        }
      }

      // ── Interceptor-projectile collisions (player hits interceptor)
      for (const ic of chunk.interceptors) {
        if (!ic.alive) continue;
        for (const proj of projectiles) {
          if (!proj.alive || proj.owner !== 'player') continue;
          if (dist(proj.pos, ic.pos) < ic.radius + proj.radius) {
            proj.alive = false;
            const isSapphireArmoredTarget = len(ic.pos) >= STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD;
            const appliedDamage = proj.isStationBeam && isSapphireArmoredTarget ? 0 : proj.damage;
            const killed = ic.damage(appliedDamage, particles, Math.random);
            floatingTexts.push(makeFloatingText(
              { x: ic.pos.x, y: ic.pos.y - ic.radius },
              `-${appliedDamage}`,
              '#ffcc44',
            ));
            if (killed) {
              this.kills++;
              player.gainXP(ic.xpValue);
            }
          }
        }
      }
      chunk.interceptors = chunk.interceptors.filter(ic => ic.alive);

      // ── Gunship AI update ──────────────────────────────────────────
      for (const gs of chunk.gunships) {
        if (!gs.alive) continue;
        steerShipAroundAsteroids(gs.pos, gs.vel, gs.radius, chunk.asteroids, dt);
        gs.update(dt, player, projectiles, particles);
        for (const asteroid of chunk.asteroids) {
          resolveShipAsteroidCollision(gs.pos, gs.vel, gs.radius, gs.mass, asteroid);
        }
      }

      // ── Gunship-projectile collisions (player hits gunship) ───────
      for (const gs of chunk.gunships) {
        if (!gs.alive) continue;
        for (const proj of projectiles) {
          if (!proj.alive || proj.owner !== 'player') continue;
          if (dist(proj.pos, gs.pos) < gs.radius + proj.radius) {
            proj.alive = false;
            const isSapphireArmoredTarget = len(gs.pos) >= STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD;
            const appliedDamage = proj.isStationBeam && isSapphireArmoredTarget ? 0 : proj.damage;
            const killed = gs.damage(appliedDamage, particles, Math.random);
            floatingTexts.push(makeFloatingText(
              { x: gs.pos.x, y: gs.pos.y - gs.radius },
              `-${appliedDamage}`,
              '#ffcc44',
            ));
            if (killed) {
              this.kills++;
              player.gainXP(gs.xpValue);
              floatingTexts.push(makeFloatingText(
                { x: gs.pos.x, y: gs.pos.y - gs.radius - 18 },
                `+${gs.xpValue} XP`,
                '#2ecc71',
              ));
            }
          }
        }
      }
      chunk.gunships = chunk.gunships.filter(gs => gs.alive);

      // ── Bomber AI update ───────────────────────────────────────────
      for (const bm of chunk.bombers) {
        if (!bm.alive) continue;
        steerShipAroundAsteroids(bm.pos, bm.vel, bm.radius, chunk.asteroids, dt);
        bm.update(dt, player, projectiles, particles);
        for (const asteroid of chunk.asteroids) {
          resolveShipAsteroidCollision(bm.pos, bm.vel, bm.radius, bm.mass, asteroid);
        }
      }

      // ── Bomber-projectile collisions (player hits bomber) ─────────
      for (const bm of chunk.bombers) {
        if (!bm.alive) continue;
        for (const proj of projectiles) {
          if (!proj.alive || proj.owner !== 'player') continue;
          if (dist(proj.pos, bm.pos) < bm.radius + proj.radius) {
            proj.alive = false;
            const isSapphireArmoredTarget = len(bm.pos) >= STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD;
            const appliedDamage = proj.isStationBeam && isSapphireArmoredTarget ? 0 : proj.damage;
            const killed = bm.damage(appliedDamage, particles, Math.random);
            floatingTexts.push(makeFloatingText(
              { x: bm.pos.x, y: bm.pos.y - bm.radius },
              `-${appliedDamage}`,
              '#ffcc44',
            ));
            if (killed) {
              this.kills++;
              player.gainXP(bm.xpValue);
              floatingTexts.push(makeFloatingText(
                { x: bm.pos.x, y: bm.pos.y - bm.radius - 18 },
                `+${bm.xpValue} XP`,
                '#2ecc71',
              ));
            }
          }
        }
      }
      chunk.bombers = chunk.bombers.filter(bm => bm.alive);
    }


    // ── Space station defenses ─────────────────────────────────
    const stationTargets: Vec2[] = [];
    for (const chunk of chunks) {
      for (const enemy of chunk.enemies) if (enemy.alive) stationTargets.push(enemy.pos);
      for (const ic of chunk.interceptors) if (ic.alive) stationTargets.push(ic.pos);
      for (const gs of chunk.gunships) if (gs.alive) stationTargets.push(gs.pos);
      for (const bm of chunk.bombers) if (bm.alive) stationTargets.push(bm.pos);
      for (const ms of chunk.motherships) if (ms.alive) stationTargets.push(ms.pos);
    }
    for (const drone of this.drones) if (drone.alive) stationTargets.push(drone.pos);
    this.station.update(dt, stationTargets, projectiles);

    // ── Pickup update & collection ────────────────────────────────
    for (const p of this.pickups) {
      p.lifetime -= dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      // Slow drag
      p.vel.x *= 0.98;
      p.vel.y *= 0.98;
      // Suction: attract toward player within suction radius
      const dToPlayer = dist(p.pos, player.pos);
      if (dToPlayer < PICKUP_SUCTION_RADIUS && dToPlayer > 0.1) {
        const dx = player.pos.x - p.pos.x;
        const dy = player.pos.y - p.pos.y;
        const strength = (1 - dToPlayer / PICKUP_SUCTION_RADIUS) * 500;
        p.vel.x += (dx / dToPlayer) * strength * dt;
        p.vel.y += (dy / dToPlayer) * strength * dt;
      }
      if (dToPlayer < PICKUP_COLLECT_RADIUS) {
        player.addResource(p.material, p.qty);
        p.lifetime = 0; // mark collected
      }
    }
    this.pickups = this.pickups.filter(p => p.lifetime > 0);

    // ── Health pickup update & collection ─────────────────────────
    for (const h of this.healthPickups) {
      h.lifetime -= dt;
      h.pos.x += h.vel.x * dt;
      h.pos.y += h.vel.y * dt;
      h.vel.x *= 0.98;
      h.vel.y *= 0.98;
      // Suction toward player
      const dh = dist(h.pos, player.pos);
      if (dh < PICKUP_SUCTION_RADIUS && dh > 0.1) {
        const dx = player.pos.x - h.pos.x;
        const dy = player.pos.y - h.pos.y;
        const strength = (1 - dh / PICKUP_SUCTION_RADIUS) * 500;
        h.vel.x += (dx / dh) * strength * dt;
        h.vel.y += (dy / dh) * strength * dt;
      }
      if (dh < PICKUP_COLLECT_RADIUS) {
        player.heal(h.amount);
        floatingTexts.push(makeFloatingText(
          { x: player.pos.x, y: player.pos.y - player.radius - 14 },
          `+${h.amount} HP`,
          '#44ff88',
        ));
        h.lifetime = 0;
      }
    }
    this.healthPickups = this.healthPickups.filter(h => h.lifetime > 0);

    // ── Placed-block projectile collisions ───────────────────────
    for (const block of this.placedBlocks) {
      if (!block.alive) continue;
      for (const proj of projectiles) {
        if (!proj.alive) continue;
        if (circleVsRect(proj.pos.x, proj.pos.y, proj.radius, block.pos.x, block.pos.y, BLOCK_SIZE, BLOCK_SIZE)) {
          proj.alive = false;
          block.hp  -= proj.damage;
          if (block.hp <= 0) block.alive = false;
        }
      }
    }
    this.placedBlocks = this.placedBlocks.filter(b => b.alive);

    // ── Drone update ──────────────────────────────────────────────
    for (const drone of this.drones) {
      if (!drone.alive) continue;
      const nearbyAsteroids: Asteroid[] = [];
      for (const chunk of chunks) {
        for (const asteroid of chunk.asteroids) {
          if (!asteroid.alive) continue;
          const reach = drone.radius + asteroid.radius + 260;
          if (dist(drone.pos, asteroid.centre) <= reach) nearbyAsteroids.push(asteroid);
        }
      }
      steerShipAroundAsteroids(drone.pos, drone.vel, drone.radius, nearbyAsteroids, dt);
      drone.update(dt, player, projectiles, particles);
      for (const asteroid of nearbyAsteroids) {
        resolveShipAsteroidCollision(drone.pos, drone.vel, drone.radius, drone.mass, asteroid);
      }
    }

    // ── Drone-projectile collisions (player hits drone) ───────────
    for (const drone of this.drones) {
      if (!drone.alive) continue;
      for (const proj of projectiles) {
        if (!proj.alive || proj.owner !== 'player') continue;
        if (dist(proj.pos, drone.pos) < drone.radius + proj.radius) {
          proj.alive = false;
          const isSapphireArmoredTarget = len(drone.pos) >= STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD;
          const appliedDamage = proj.isStationBeam && isSapphireArmoredTarget ? 0 : proj.damage;
          const killed = drone.damage(appliedDamage, particles, Math.random);
          floatingTexts.push(makeFloatingText(
            { x: drone.pos.x, y: drone.pos.y - drone.radius },
            `-${appliedDamage}`,
            '#ffcc44',
          ));
          if (killed) {
            this.kills++;
            player.gainXP(drone.xpValue);
          }
        }
      }
    }
    this.drones = this.drones.filter(d => d.alive);

    // ── Planet molecule simulation + projectile impact ─────────────
    for (const chunk of chunks) {
      for (const planet of chunk.planets) {
        planet.update(dt, skipPlanetMolecules);
        // Stop projectiles that enter the planet surface; create localized impact
        for (const proj of projectiles) {
          if (!proj.alive) continue;
          const d = dist(proj.pos, planet.pos);
          if (d < planet.radius) {
            // Compute surface entry point in the projectile's direction from center
            const dx    = proj.pos.x - planet.pos.x;
            const dy    = proj.pos.y - planet.pos.y;
            const invD  = d > 0.01 ? 1 / d : 0;
            const hitPos: Vec2 = {
              x: planet.pos.x + dx * invD * planet.radius,
              y: planet.pos.y + dy * invD * planet.radius,
            };
            const splashData: SplashParticleData[] = planet.impactAt(hitPos, proj.damage * 3);
            proj.alive = false;
            // Spawn splash particles with motion-blur trails
            for (const sd of splashData) {
              particles.push({
                pos:      { x: sd.pos.x, y: sd.pos.y },
                vel:      { x: sd.vel.x, y: sd.vel.y },
                color:    sd.color,
                radius:   1.5 + Math.random() * 2.5,
                lifetime: 0.7 + Math.random() * 1.1,
                maxLife:  1.8,
                alpha:    1,
                trail:    true,
              });
            }
          }
        }
      }
    }

    // ── Planetary gravitational attraction ────────────────────────
    for (const chunk of chunks) {
      for (const planet of chunk.planets) {
        const gravRange = planet.radius + PLANET_GRAVITY_RANGE;
        const applyGravity = (pos: Vec2, vel: Vec2): void => {
          const dx = planet.pos.x - pos.x;
          const dy = planet.pos.y - pos.y;
          const d2 = dx * dx + dy * dy;
          const d  = Math.sqrt(d2);
          if (d > gravRange || d < planet.radius) return;
          const accel = PLANET_GRAVITY_STRENGTH * planet.radius / Math.max(d2, 400);
          const invD  = 1 / d;
          vel.x += dx * invD * accel * dt;
          vel.y += dy * invD * accel * dt;
        };
        applyGravity(player.pos, player.vel);
        for (const c of chunks) {
          for (const e  of c.enemies)       { if (e.alive)  applyGravity(e.pos,  e.vel);  }
          for (const gs of c.gunships)      { if (gs.alive) applyGravity(gs.pos, gs.vel); }
          for (const bm of c.bombers)       { if (bm.alive) applyGravity(bm.pos, bm.vel); }
          for (const ic of c.interceptors)  { if (ic.alive) applyGravity(ic.pos, ic.vel); }
        }
        for (const drone of this.drones) { if (drone.alive) applyGravity(drone.pos, drone.vel); }
      }
    }

    // ── Floating module update (passive damage + drift) ──────────
    for (const fm of this.floatingModules) {
      fm.pos.x += fm.vel.x * dt;
      fm.pos.y += fm.vel.y * dt;
      // Gentle drag
      const fmDrag = Math.pow(0.97, dt * 60);
      fm.vel.x *= fmDrag;
      fm.vel.y *= fmDrag;
      // Passive damage – unattached modules degrade over time
      fm.hp -= FLOATING_MODULE_DAMAGE_RATE * dt;
    }
    this.floatingModules = this.floatingModules.filter(fm => fm.hp > 0);
  }

  draw(ctx: CanvasRenderingContext2D, camPos: Vec2, viewportWidthPx: number, viewportHeightPx: number): void {
    const chunks = this._activeChunks(camPos);
    const halfW = viewportWidthPx * 0.5;
    const halfH = viewportHeightPx * 0.5;
    const cullMargin = 60;
    const minX = camPos.x - halfW - cullMargin;
    const maxX = camPos.x + halfW + cullMargin;
    const minY = camPos.y - halfH - cullMargin;
    const maxY = camPos.y + halfH + cullMargin;

    // ── Planets ────────────────────────────────────────────────────
    for (const chunk of chunks) {
      for (const planet of chunk.planets) {
        planet.draw(ctx, minX, minY, maxX, maxY);
      }
    }

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

    // ── Motherships ────────────────────────────────────────────────
    for (const chunk of chunks) {
      for (const ms of chunk.motherships) {
        if (ms.alive) ms.draw(ctx);
      }
    }

    // ── Turrets ────────────────────────────────────────────────────
    for (const chunk of chunks) {
      for (const turret of chunk.turrets) {
        if (turret.alive) turret.draw(ctx);
      }
    }

    // ── Drones ─────────────────────────────────────────────────────
    for (const drone of this.drones) {
      if (drone.alive) drone.draw(ctx);
    }

    // ── Floating modules (detached enemy ship pieces) ──────────────
    for (const fm of this.floatingModules) {
      const hpRatio = fm.hp / fm.maxHp;
      const half = fm.size / 2;
      ctx.fillStyle = fm.color;
      ctx.fillRect(fm.pos.x - half, fm.pos.y - half, fm.size, fm.size);
      // Darken progressively as HP drains
      const darkOverlay = 1 - hpRatio;
      if (darkOverlay > 0) {
        ctx.fillStyle = `rgba(0,0,0,${darkOverlay * 0.85})`;
        ctx.fillRect(fm.pos.x - half, fm.pos.y - half, fm.size, fm.size);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(fm.pos.x - half, fm.pos.y - half, fm.size, fm.size);
    }

    // ── Interceptors ───────────────────────────────────────────────
    for (const chunk of chunks) {
      for (const ic of chunk.interceptors) {
        if (!ic.alive) continue;
        const isVisible =
          ic.pos.x + ic.radius >= minX &&
          ic.pos.x - ic.radius <= maxX &&
          ic.pos.y + ic.radius >= minY &&
          ic.pos.y - ic.radius <= maxY;
        if (!isVisible && !ic.isTargetingPlayer) continue;
        ic.draw(ctx);
      }
    }

    // ── Gunships ───────────────────────────────────────────────────
    for (const chunk of chunks) {
      for (const gs of chunk.gunships) {
        if (gs.alive) gs.draw(ctx);
      }
    }

    // ── Bombers ────────────────────────────────────────────────────
    for (const chunk of chunks) {
      for (const bm of chunk.bombers) {
        if (bm.alive) bm.draw(ctx);
      }
    }


    // ── Space station ─────────────────────────────────────────────
    this.station.draw(ctx);

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
      ctx.fillStyle = props.color;
      ctx.fillRect(p.pos.x - 5, p.pos.y - 5, 10, 10);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = fade * 0.85;
      ctx.fillStyle = props.color;
      ctx.font = '9px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText(`${p.material} ×${p.qty}`, p.pos.x, p.pos.y - 9);
      ctx.restore();
    }

    // ── Health pickups ─────────────────────────────────────────────
    for (const h of this.healthPickups) {
      const fade  = Math.min(1, h.lifetime / 3);
      const pulse = 0.7 + Math.sin(now / 250) * 0.3;
      ctx.save();
      ctx.globalAlpha = fade * pulse;
      ctx.shadowColor = '#ff4455';
      ctx.shadowBlur  = 10;
      ctx.fillStyle   = '#ff4455';
      // Draw a red cross / plus symbol
      ctx.fillRect(h.pos.x - 6, h.pos.y - 2, 12, 4); // horizontal bar
      ctx.fillRect(h.pos.x - 2, h.pos.y - 6, 4, 12); // vertical bar
      ctx.shadowBlur  = 0;
      ctx.globalAlpha = fade * 0.85;
      ctx.fillStyle   = '#ffaaaa';
      ctx.font        = '9px Courier New';
      ctx.textAlign   = 'center';
      ctx.fillText(`+${h.amount} HP`, h.pos.x, h.pos.y - 11);
      ctx.restore();
    }

    // ── Placed blocks ──────────────────────────────────────────────
    for (const block of this.placedBlocks) {
      if (!block.alive) continue;
      const props = MATERIAL_PROPS[block.material];
      ctx.fillStyle = props.color;
      ctx.fillRect(block.pos.x, block.pos.y, BLOCK_SIZE, BLOCK_SIZE);
      if (block.hp < block.maxHp) {
        const ratio = 1 - block.hp / block.maxHp;
        ctx.fillStyle = `rgba(0,0,0,${ratio * 0.6})`;
        ctx.fillRect(block.pos.x, block.pos.y, BLOCK_SIZE, BLOCK_SIZE);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(block.pos.x, block.pos.y, BLOCK_SIZE, BLOCK_SIZE);
    }
  }

  /** Returns entity positions for the minimap. */

  getPlayerSpawnPosition(): Vec2 {
    return this.station.getSpawnPosition();
  }

  getMinimapData(camPos: Vec2): { enemies: Vec2[]; asteroids: Vec2[]; pickups: Vec2[]; planets: { pos: Vec2; radius: number; color: string }[] } {
    const chunks    = this._activeChunks(camPos);
    const enemies:   Vec2[] = [];
    const asteroids: Vec2[] = [];
    const pickupPos: Vec2[] = [];
    const planets:   { pos: Vec2; radius: number; color: string }[] = [];
    for (const chunk of chunks) {
      for (const e  of chunk.enemies)     if (e.alive)    enemies.push({ ...e.pos });
      for (const ms of chunk.motherships) if (ms.alive)   enemies.push({ ...ms.pos });
      for (const ic of chunk.interceptors) if (ic.alive)  enemies.push({ ...ic.pos });
      for (const gs of chunk.gunships)    if (gs.alive)   enemies.push({ ...gs.pos });
      for (const bm of chunk.bombers)     if (bm.alive)   enemies.push({ ...bm.pos });
      for (const a  of chunk.asteroids)   if (a.alive)    asteroids.push({ ...a.centre });
      for (const p  of chunk.planets) planets.push({ pos: { ...p.pos }, radius: p.radius, color: p.minimapColor });
    }
    for (const d of this.drones) if (d.alive) enemies.push({ ...d.pos });
    for (const p of this.pickups) pickupPos.push({ ...p.pos });
    return { enemies, asteroids, pickups: pickupPos, planets };
  }

  /** Returns per-module occluder quads for all active shadow-casting entities. */
  getShadowOccluders(camPos: Vec2): { verts: Vec2[] }[] {
    const aabb = (l: number, t: number, r: number, b: number) => ({
      verts: [
        { x: l, y: t }, { x: r, y: t },
        { x: r, y: b }, { x: l, y: b },
      ] as Vec2[],
    });
    const result: { verts: Vec2[] }[] = [];
    const chunks = this._activeChunks(camPos);
    for (const chunk of chunks) {
      for (const asteroid of chunk.asteroids) {
        if (!asteroid.alive) continue;
        for (const block of asteroid.blocks as Block[]) {
          if (!block.alive) continue;
          const bx = asteroid.pos.x + block.col * BLOCK_SIZE;
          const by = asteroid.pos.y + block.row * BLOCK_SIZE;
          result.push(aabb(bx, by, bx + BLOCK_SIZE, by + BLOCK_SIZE));
        }
      }
      for (const enemy of chunk.enemies) {
        if (!enemy.alive) continue;
        for (const occ of enemy.getModuleShadowOccluders()) result.push(occ);
      }
      for (const ms of chunk.motherships) {
        if (!ms.alive) continue;
        for (const occ of ms.getModuleShadowOccluders()) result.push(occ);
      }
    }
    for (const p of this.pickups) {
      result.push(aabb(p.pos.x - PICKUP_HALF_SIZE, p.pos.y - PICKUP_HALF_SIZE, p.pos.x + PICKUP_HALF_SIZE, p.pos.y + PICKUP_HALF_SIZE));
    }
    for (const b of this.placedBlocks) {
      if (!b.alive) continue;
      result.push(aabb(b.pos.x, b.pos.y, b.pos.x + BLOCK_SIZE, b.pos.y + BLOCK_SIZE));
    }
    return result;
  }
}
