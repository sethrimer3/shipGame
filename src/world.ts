import { Vec2, len, dist, Material, MATERIAL_PROPS, pickMaterial, pickGem } from './types';
import { Asteroid, AsteroidTurret }  from './asteroid';
import { Planet, SplashParticleData, POWDER_SIZE } from './planet';
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
  segmentCircleClosestT,
  segmentCircleEntryTime,
  segmentRectEntryTime,
  steerShipAroundAsteroids,
  resolveShipAsteroidCollision,
  resolveShipPlanetCollision,
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
const PLANET_MIN_RADIUS   = 190;   // minimum planet radius (world units)
const PLANET_MAX_RADIUS   = 380;   // maximum planet radius (world units)

/** Gravitational acceleration constant for planet attraction: accel = K * radius / d² */
const PLANET_GRAVITY_STRENGTH = 2000;
/** Maximum distance (beyond planet surface) within which planetary gravity acts. */
const PLANET_GRAVITY_RANGE    = 600;

// ── Loose planet particles (water/sand ejected from a planet surface) ─────────
/** Minimum clearance (world units) added on top of both radii for overlap rejection. */
const ASTEROID_PLANET_CLEARANCE = 80;
/** Drag multiplier per frame for loose particles – nearly frictionless in space. */
const LOOSE_PARTICLE_DRAG = 0.9998;
/** Minimum squared distance from a planet centre used in surface-collision to avoid divide-by-zero. */
const LOOSE_PARTICLE_MIN_PLANET_DIST_SQ = 0.01;
/** Minimum squared separation between two loose particles to attempt collision resolution (avoids divide-by-zero). */
const LOOSE_PARTICLE_MIN_SEP_SQ = 0.0001;
/** Max lifetime (seconds) for a loose particle far from all planet cores. */
const LOOSE_PARTICLE_MAX_LIFE = 25;
/** Gravitational strength used specifically for loose planet particles – stronger than ship gravity so ejected molecules are pulled back. */
const LOOSE_PARTICLE_GRAVITY_STRENGTH = 8000;
/** Restitution coefficient when a loose particle bounces off a planet surface (0 = fully inelastic). */
const LOOSE_PARTICLE_RESTITUTION = 0.2;
/** Distance beyond the viewport edge beyond which loose particles without nearby planet gravity are despawned immediately. */
const LOOSE_PARTICLE_OFFSCREEN_MARGIN = 1200;
/** Speed (world units/s) imparted to a loose particle struck by a projectile. */
const LOOSE_PARTICLE_HIT_SPEED = 180;
/** Generous half-viewport size estimate in world units for off-screen culling. */
const HALF_VIEWPORT_EST_WORLD = 960;

const PICKUP_COLLECT_RADIUS = 40;   // world units for auto-collect
const PICKUP_SUCTION_RADIUS = 200;  // world units where pickups accelerate toward player
const PICKUP_LIFETIME       = 20;   // seconds before despawn
const PICKUP_HALF_SIZE      = 5;    // half-side of pickup draw rect (world units)

const HEALTH_DROP_CHANCE        = 0.15; // probability of a health pack dropping on enemy kill
const HEALTH_DROP_XP_MULTIPLIER = 0.3;  // heal amount = 10 + xpValue * this
/** Probability that a player projectile deals a critical hit (2× damage). */
const PLAYER_CRIT_CHANCE = 0.15;

// ── Loose planet particle (water/sand ejected from a planet surface) ──────────
interface LoosePlanetParticle {
  pos:      Vec2;
  vel:      Vec2;
  color:    string;
  /** Half the render size (= POWDER_SIZE * 0.5). */
  halfSize: number;
  /** Remaining lifetime; decrements only when far from all alive planet cores. */
  lifetime: number;
}

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

/** A large diffuse cloud of colour rendered before other world geometry. */
interface NebulaPatch {
  x:       number;
  y:       number;
  radiusA: number;  // semi-axis along X
  radiusB: number;  // semi-axis along Y
  angle:   number;  // rotation angle (radians)
  colorA:  string;  // inner rgba string
  colorB:  string;  // outer rgba string
}

interface Chunk {
  cx:            number;
  cy:            number;
  asteroids:     Asteroid[];
  enemies:       Enemy[];
  stars:         Star[];
  motherships:   Mothership[];
  turrets:       AsteroidTurret[];
  interceptors:  Interceptor[];
  gunships:      Gunship[];
  bombers:       Bomber[];
  planets:       Planet[];
  nebulaPatches: NebulaPatch[];
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

  /** Loose planet particles (water/sand) ejected from planet impacts. */
  looseParticles: LoosePlanetParticle[] = [];

  /** Accumulated enemy kills – could be used for score */
  kills = 0;

  /** Kill events generated this frame: position + color, consumed by Game for shockwave rings. */
  killEvents: Array<{ pos: Vec2; color: string }> = [];

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
    this.looseParticles = [];
    this.kills = 0;
    this.killEvents = [];
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
    const nebulaPatches: NebulaPatch[]  = [];

    // ── Stars ──────────────────────────────────────────────────────
    for (let i = 0; i < STAR_DENSITY; i++) {
      stars.push({
        x:          baseX + rng() * CHUNK_SIZE,
        y:          baseY + rng() * CHUNK_SIZE,
        r:          0.4 + rng() * 1.4,
        brightness: 0.3 + rng() * 0.7,
      });
    }

    // ── Nebula patches ─────────────────────────────────────────────
    // Sparse coloured clouds; 0–2 per chunk based on RNG
    const nebulaPaletteInner = [
      'rgba(110,30,220,0.52)',  'rgba(15,110,240,0.48)',  'rgba(220,30,80,0.46)',
      'rgba(20,170,130,0.44)', 'rgba(150,30,240,0.52)', 'rgba(240,80,15,0.44)',
      'rgba(15,100,240,0.48)',  'rgba(100,200,50,0.40)',
      'rgba(255,140,30,0.42)', 'rgba(60,200,220,0.44)',
    ];
    const nebulaPaletteOuter = [
      'rgba(70,15,160,0)',  'rgba(8,80,190,0)',   'rgba(160,15,60,0)',
      'rgba(12,120,95,0)', 'rgba(110,12,180,0)',  'rgba(200,50,8,0)',
      'rgba(8,72,190,0)',  'rgba(75,160,35,0)',
      'rgba(200,100,10,0)', 'rgba(30,160,180,0)',
    ];
    const shouldSpawnNebula = rng() < 0.72;
    const nebulaCount = shouldSpawnNebula ? (rng() < 0.50 ? 2 : 1) : 0;
    for (let i = 0; i < nebulaCount; i++) {
      const pi = Math.floor(rng() * nebulaPaletteInner.length);
      nebulaPatches.push({
        x:       baseX + rng() * CHUNK_SIZE,
        y:       baseY + rng() * CHUNK_SIZE,
        radiusA: 380 + rng() * 560,
        radiusB: 240 + rng() * 420,
        angle:   rng() * Math.PI,
        colorA:  nebulaPaletteInner[pi],
        colorB:  nebulaPaletteOuter[pi],
      });
    }

    // Skip chunks very close to spawn (safe zone around station)
    if (distFromOrigin < STATION_RESET_RADIUS_WORLD + CHUNK_SIZE * 0.25) return { cx, cy, asteroids, enemies, stars, motherships, turrets, interceptors, gunships, bombers, planets, nebulaPatches };

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

    // ── Remove asteroids that overlap with any planet ──────────────
    if (planets.length > 0) {
      let j = 0;
      for (let i = 0; i < asteroids.length; i++) {
        const ast = asteroids[i];
        let overlaps = false;
        for (let pi = 0; pi < planets.length; pi++) {
          const pl = planets[pi];
          const ddx = ast.centre.x - pl.pos.x;
          const ddy = ast.centre.y - pl.pos.y;
          const minSep = ast.radius + pl.radius + ASTEROID_PLANET_CLEARANCE;
          if (ddx * ddx + ddy * ddy < minSep * minSep) { overlaps = true; break; }
        }
        if (!overlaps) asteroids[j++] = ast;
      }
      asteroids.length = j;
    }

    return { cx, cy, asteroids, enemies, stars, motherships, turrets, interceptors, gunships, bombers, planets, nebulaPatches };
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

  private _stopProjectileAtTime(proj: Projectile, hitT: number): void {
    const clampedT = Math.max(0, Math.min(1, hitT));
    proj.pos.x = proj.prevPos.x + (proj.pos.x - proj.prevPos.x) * clampedT;
    proj.pos.y = proj.prevPos.y + (proj.pos.y - proj.prevPos.y) * clampedT;
    proj.alive = false;
  }

  private _hitProjectileVsCircle(proj: Projectile, center: Vec2, radius: number): boolean {
    const hitT = segmentCircleEntryTime(
      proj.prevPos.x,
      proj.prevPos.y,
      proj.pos.x,
      proj.pos.y,
      center.x,
      center.y,
      radius + proj.radius,
    );
    if (hitT === null) return false;
    this._stopProjectileAtTime(proj, hitT);
    return true;
  }

  private _hitProjectileVsAsteroid(proj: Projectile, asteroid: Asteroid): Block | null {
    const lx = proj.pos.x - asteroid.pos.x;
    const ly = proj.pos.y - asteroid.pos.y;
    const prevLx = proj.prevPos.x - asteroid.pos.x;
    const prevLy = proj.prevPos.y - asteroid.pos.y;

    let nearestBlock: Block | null = null;
    let nearestHitTime = Number.POSITIVE_INFINITY;

    for (const block of asteroid.blocks) {
      if (!block.alive) continue;
      const blockX = block.col * BLOCK_SIZE;
      const blockY = block.row * BLOCK_SIZE;
      const expandedX = blockX - proj.radius;
      const expandedY = blockY - proj.radius;
      const expandedSize = BLOCK_SIZE + proj.radius * 2;
      const startedInside =
        prevLx >= expandedX && prevLx <= expandedX + expandedSize
        && prevLy >= expandedY && prevLy <= expandedY + expandedSize;
      const hitTime = startedInside
        ? 0
        : segmentRectEntryTime(
          prevLx,
          prevLy,
          lx,
          ly,
          expandedX,
          expandedY,
          expandedSize,
          expandedSize,
        );
      if (hitTime === null || hitTime >= nearestHitTime) continue;
      nearestHitTime = hitTime;
      nearestBlock = block;
    }

    if (!nearestBlock) return null;
    this._stopProjectileAtTime(proj, nearestHitTime);
    return nearestBlock;
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
    this.killEvents.length = 0;
    const chunks = this._activeChunks(camPos);
    const skipPlanetMolecules = !config.planetMoleculeSimulation;

    for (const chunk of chunks) {
      // ── Enemy AI ──────────────────────────────────────────────────
      for (const enemy of chunk.enemies) {
        if (!enemy.alive) continue;
        steerShipAroundAsteroids(enemy.pos, enemy.vel, enemy.radius, chunk.asteroids, dt);
        enemy.update(dt, player, projectiles, particles);
      }
      { let j = 0; for (let i = 0; i < chunk.enemies.length; i++) { if (chunk.enemies[i].alive) chunk.enemies[j++] = chunk.enemies[i]; } chunk.enemies.length = j; }

      // ── Asteroid-projectile collisions ────────────────────────────
      for (const asteroid of chunk.asteroids) {
        if (!asteroid.alive) continue;
        for (const proj of projectiles) {
          if (!proj.alive) continue;
          const block = this._hitProjectileVsAsteroid(proj, asteroid);
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
      { let j = 0; for (let i = 0; i < chunk.asteroids.length; i++) { if (chunk.asteroids[i].alive) chunk.asteroids[j++] = chunk.asteroids[i]; } chunk.asteroids.length = j; }

      // ── Placed-block projectile collisions (occludes all targets) ─
      for (const block of this.placedBlocks) {
        if (!block.alive) continue;
        for (const proj of projectiles) {
          if (!proj.alive) continue;
          const hitT = segmentRectEntryTime(
            proj.prevPos.x,
            proj.prevPos.y,
            proj.pos.x,
            proj.pos.y,
            block.pos.x - proj.radius,
            block.pos.y - proj.radius,
            BLOCK_SIZE + proj.radius * 2,
            BLOCK_SIZE + proj.radius * 2,
          );
          if (hitT === null) continue;
          this._stopProjectileAtTime(proj, hitT);
          block.hp -= proj.damage;
          if (block.hp <= 0) block.alive = false;
        }
      }
      { let j = 0; for (let i = 0; i < this.placedBlocks.length; i++) { if (this.placedBlocks[i].alive) this.placedBlocks[j++] = this.placedBlocks[i]; } this.placedBlocks.length = j; }

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
          if (this._hitProjectileVsCircle(proj, enemy.pos, enemy.radius)) {
            proj.alive = false;
            const isSapphireArmoredTarget = enemy.tier.minDist >= STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD;
            const isCrit = !proj.isStationBeam && Math.random() < (PLAYER_CRIT_CHANCE + player.critChanceBonus);
            const baseDamage = proj.isStationBeam && isSapphireArmoredTarget ? 0 : proj.damage;
            const appliedDamage = isCrit ? baseDamage * 2 : baseDamage;
            const result = enemy.damageAt(proj.pos, appliedDamage, particles, Math.random);
            // Alert the enemy: player hit it, so it should start chasing
            if (!result.killed) enemy.alertedByPlayer();
            // Spawn floating modules for any detached fragments
            for (const frag of result.fragments) {
              this._spawnFloatingModule(frag);
            }
            floatingTexts.push(makeFloatingText(
              { x: enemy.pos.x, y: enemy.pos.y - enemy.radius },
              isCrit ? `-${appliedDamage} CRIT!` : `-${appliedDamage}`,
              isCrit ? '#ff6600' : '#ffcc44',
            ));
            if (result.killed) {
              this.kills++;
              this.killEvents.push({ pos: { x: enemy.pos.x, y: enemy.pos.y }, color: enemy.tier.color });
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
              // ── Gem drop (deep-zone enemies) ───────────────────────
              const dropDist = len(enemy.pos);
              const gemDropChance = dropDist >= 10000 ? 0.12 : dropDist >= 5000 ? 0.06 : dropDist >= 2000 ? 0.03 : 0;
              if (gemDropChance > 0 && Math.random() < gemDropChance) {
                const gem = pickGem(dropDist, Math.random);
                if (gem !== null) {
                  const ang = Math.random() * Math.PI * 2;
                  this.pickups.push({
                    pos:      { x: enemy.pos.x, y: enemy.pos.y },
                    vel:      { x: Math.cos(ang) * 60, y: Math.sin(ang) * 60 },
                    material: gem,
                    qty:      1,
                    lifetime: PICKUP_LIFETIME,
                    maxLife:  PICKUP_LIFETIME,
                  });
                }
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
        if (this._hitProjectileVsCircle(proj, player.pos, player.radius)) {
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
              this.killEvents.push({ pos: { x: ms.pos.x, y: ms.pos.y }, color: ms.tier.color });
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
      { let j = 0; for (let i = 0; i < chunk.motherships.length; i++) { if (chunk.motherships[i].alive) chunk.motherships[j++] = chunk.motherships[i]; } chunk.motherships.length = j; }

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
          if (this._hitProjectileVsCircle(proj, turret.pos, turret.radius)) {
            proj.alive = false;
            const killed = turret.damage(proj.damage, particles, Math.random);
            if (killed) {
              this.kills++;
              this.killEvents.push({ pos: { x: turret.pos.x, y: turret.pos.y }, color: '#c0392b' });
              player.gainXP(12);
            }
          }
        }
      }
      { let j = 0; for (let i = 0; i < chunk.turrets.length; i++) { if (chunk.turrets[i].alive) chunk.turrets[j++] = chunk.turrets[i]; } chunk.turrets.length = j; }

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
          for (let i = 0; i < 14; i++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = 60 + Math.random() * 100;
            particles.push({
              pos:      { x: ic.pos.x, y: ic.pos.y },
              vel:      { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd },
              color:    '#ff4444',
              radius:   2 + Math.random() * 2,
              lifetime: 0.4 + Math.random() * 0.5,
              maxLife:  0.9,
              alpha:    1,
            });
          }
          floatingTexts.push(makeFloatingText(
            { x: player.pos.x + (Math.random() - 0.5) * 24, y: player.pos.y - player.radius - 10 },
            `-${ic.ramDamage} RAM`,
            '#ff4444',
          ));
          this.kills++;
          this.killEvents.push({ pos: { x: ic.pos.x, y: ic.pos.y }, color: '#ff4444' });
          player.gainXP(ic.xpValue);
        }
      }

      // ── Interceptor-projectile collisions (player hits interceptor)
      for (const ic of chunk.interceptors) {
        if (!ic.alive) continue;
        for (const proj of projectiles) {
          if (!proj.alive || proj.owner !== 'player') continue;
          if (this._hitProjectileVsCircle(proj, ic.pos, ic.radius)) {
            proj.alive = false;
            const isSapphireArmoredTarget = len(ic.pos) >= STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD;
            const isCrit = !proj.isStationBeam && Math.random() < (PLAYER_CRIT_CHANCE + player.critChanceBonus);
            const baseDamage = proj.isStationBeam && isSapphireArmoredTarget ? 0 : proj.damage;
            const appliedDamage = isCrit ? baseDamage * 2 : baseDamage;
            const killed = ic.damage(appliedDamage, particles, Math.random);
            floatingTexts.push(makeFloatingText(
              { x: ic.pos.x, y: ic.pos.y - ic.radius },
              isCrit ? `-${appliedDamage} CRIT!` : `-${appliedDamage}`,
              isCrit ? '#ff6600' : '#ffcc44',
            ));
            if (killed) {
              this.kills++;
              this.killEvents.push({ pos: { x: ic.pos.x, y: ic.pos.y }, color: '#ff4444' });
              player.gainXP(ic.xpValue);
            }
          }
        }
      }
      { let j = 0; for (let i = 0; i < chunk.interceptors.length; i++) { if (chunk.interceptors[i].alive) chunk.interceptors[j++] = chunk.interceptors[i]; } chunk.interceptors.length = j; }

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
          if (this._hitProjectileVsCircle(proj, gs.pos, gs.radius)) {
            proj.alive = false;
            const isSapphireArmoredTarget = len(gs.pos) >= STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD;
            const isCrit = !proj.isStationBeam && Math.random() < (PLAYER_CRIT_CHANCE + player.critChanceBonus);
            const baseDamage = proj.isStationBeam && isSapphireArmoredTarget ? 0 : proj.damage;
            const appliedDamage = isCrit ? baseDamage * 2 : baseDamage;
            const killed = gs.damage(appliedDamage, particles, Math.random);
            floatingTexts.push(makeFloatingText(
              { x: gs.pos.x, y: gs.pos.y - gs.radius },
              isCrit ? `-${appliedDamage} CRIT!` : `-${appliedDamage}`,
              isCrit ? '#ff6600' : '#ffcc44',
            ));
            if (killed) {
              this.kills++;
              this.killEvents.push({ pos: { x: gs.pos.x, y: gs.pos.y }, color: '#cc8833' });
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
      { let j = 0; for (let i = 0; i < chunk.gunships.length; i++) { if (chunk.gunships[i].alive) chunk.gunships[j++] = chunk.gunships[i]; } chunk.gunships.length = j; }

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
          if (this._hitProjectileVsCircle(proj, bm.pos, bm.radius)) {
            proj.alive = false;
            const isSapphireArmoredTarget = len(bm.pos) >= STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD;
            const isCrit = !proj.isStationBeam && Math.random() < (PLAYER_CRIT_CHANCE + player.critChanceBonus);
            const baseDamage = proj.isStationBeam && isSapphireArmoredTarget ? 0 : proj.damage;
            const appliedDamage = isCrit ? baseDamage * 2 : baseDamage;
            const killed = bm.damage(appliedDamage, particles, Math.random);
            floatingTexts.push(makeFloatingText(
              { x: bm.pos.x, y: bm.pos.y - bm.radius },
              isCrit ? `-${appliedDamage} CRIT!` : `-${appliedDamage}`,
              isCrit ? '#ff6600' : '#ffcc44',
            ));
            if (killed) {
              this.kills++;
              this.killEvents.push({ pos: { x: bm.pos.x, y: bm.pos.y }, color: '#9b59b6' });
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
      { let j = 0; for (let i = 0; i < chunk.bombers.length; i++) { if (chunk.bombers[i].alive) chunk.bombers[j++] = chunk.bombers[i]; } chunk.bombers.length = j; }
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
    { let j = 0; for (let i = 0; i < this.pickups.length; i++) { if (this.pickups[i].lifetime > 0) this.pickups[j++] = this.pickups[i]; } this.pickups.length = j; }

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
    { let j = 0; for (let i = 0; i < this.healthPickups.length; i++) { if (this.healthPickups[i].lifetime > 0) this.healthPickups[j++] = this.healthPickups[i]; } this.healthPickups.length = j; }

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
        if (this._hitProjectileVsCircle(proj, drone.pos, drone.radius)) {
          proj.alive = false;
          const isSapphireArmoredTarget = len(drone.pos) >= STATION_TURRET_SAPPHIRE_ARMOR_DIST_WORLD;
          const isCrit = !proj.isStationBeam && Math.random() < (PLAYER_CRIT_CHANCE + player.critChanceBonus);
          const baseDamage = proj.isStationBeam && isSapphireArmoredTarget ? 0 : proj.damage;
          const appliedDamage = isCrit ? baseDamage * 2 : baseDamage;
          const killed = drone.damage(appliedDamage, particles, Math.random);
          floatingTexts.push(makeFloatingText(
            { x: drone.pos.x, y: drone.pos.y - drone.radius },
            isCrit ? `-${appliedDamage} CRIT!` : `-${appliedDamage}`,
            isCrit ? '#ff6600' : '#ffcc44',
          ));
          if (killed) {
            this.kills++;
            this.killEvents.push({ pos: { x: drone.pos.x, y: drone.pos.y }, color: '#ff6060' });
            player.gainXP(drone.xpValue);
          }
        }
      }
    }
    { let j = 0; for (let i = 0; i < this.drones.length; i++) { if (this.drones[i].alive) this.drones[j++] = this.drones[i]; } this.drones.length = j; }

    // ── Planet molecule simulation + projectile impact ─────────────
    for (const chunk of chunks) {
      for (const planet of chunk.planets) {
        planet.update(dt, skipPlanetMolecules);
        // Stop projectiles at first planet impact; create localized impact
        for (const proj of projectiles) {
          if (!proj.alive) continue;
          const hitT = segmentCircleEntryTime(
            proj.prevPos.x,
            proj.prevPos.y,
            proj.pos.x,
            proj.pos.y,
            planet.pos.x,
            planet.pos.y,
            planet.collisionRadius,
          );
          if (hitT === null) continue;
          this._stopProjectileAtTime(proj, hitT);
          const splashData: SplashParticleData[] = planet.impactAt(proj.pos, proj.damage * 3);
          // Loose molecules (water/sand) become gravitationally tracked particles;
          // non-loose molecules (lava/stone) spawn short-lived visual-only particles.
          for (const sd of splashData) {
            if (sd.isLoose) {
              this.looseParticles.push({
                pos:      { x: sd.pos.x, y: sd.pos.y },
                vel:      { x: sd.vel.x, y: sd.vel.y },
                color:    sd.color,
                halfSize: POWDER_SIZE * 0.5,
                lifetime: LOOSE_PARTICLE_MAX_LIFE,
              });
            } else {
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
        if (!planet.coreAlive) continue;
        const gravRange = planet.radius + PLANET_GRAVITY_RANGE;
        const applyGravity = (pos: Vec2, vel: Vec2): void => {
          const dx = planet.pos.x - pos.x;
          const dy = planet.pos.y - pos.y;
          const d2 = dx * dx + dy * dy;
          const d  = Math.sqrt(d2);
          if (d > gravRange || d < planet.collisionRadius) return;
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

    // ── Ship-planet collision resolution ──────────────────────────
    for (const chunk of chunks) {
      for (const planet of chunk.planets) {
        const resolveEntityVsPlanet = (entityPos: Vec2, entityVel: Vec2, entityRadius: number): void => {
          const dx = entityPos.x - planet.pos.x;
          const dy = entityPos.y - planet.pos.y;
          const angleRad = Math.atan2(dy, dx);
          const outerRadius = planet.getOuterRadiusAtAngle(angleRad);
          resolveShipPlanetCollision(entityPos, entityVel, entityRadius, planet.pos, outerRadius);
        };

        resolveEntityVsPlanet(player.pos, player.vel, player.radius);
        for (const e  of chunk.enemies)      { if (e.alive)  resolveEntityVsPlanet(e.pos,  e.vel,  e.radius); }
        for (const gs of chunk.gunships)     { if (gs.alive) resolveEntityVsPlanet(gs.pos, gs.vel, gs.radius); }
        for (const bm of chunk.bombers)      { if (bm.alive) resolveEntityVsPlanet(bm.pos, bm.vel, bm.radius); }
        for (const ic of chunk.interceptors) { if (ic.alive) resolveEntityVsPlanet(ic.pos, ic.vel, ic.radius); }
        for (const drone of this.drones)     { if (drone.alive) resolveEntityVsPlanet(drone.pos, drone.vel, drone.radius); }
      }
    }

    // ── Loose planet particle update ──────────────────────────────
    {
      // Cache alive-core planets once to avoid repeated chunk iteration per particle
      const alivePlanets: Planet[] = [];
      for (const c of chunks) {
        for (const planet of c.planets) {
          if (planet.coreAlive) alivePlanets.push(planet);
        }
      }

      const offscreenLimitSq = (HALF_VIEWPORT_EST_WORLD + LOOSE_PARTICLE_OFFSCREEN_MARGIN) * (HALF_VIEWPORT_EST_WORLD + LOOSE_PARTICLE_OFFSCREEN_MARGIN);
      let j = 0;
      for (let i = 0; i < this.looseParticles.length; i++) {
        const lp = this.looseParticles[i];

        // Apply tiny drag (almost frictionless in space)
        lp.vel.x *= LOOSE_PARTICLE_DRAG;
        lp.vel.y *= LOOSE_PARTICLE_DRAG;

        // Apply gravity from every alive-core planet in active chunks
        let nearPlanet = false;
        for (let pi = 0; pi < alivePlanets.length; pi++) {
          const planet = alivePlanets[pi];
          const ddx = planet.pos.x - lp.pos.x;
          const ddy = planet.pos.y - lp.pos.y;
          const d2  = ddx * ddx + ddy * ddy;
          const d   = Math.sqrt(d2);
          const gravRange = planet.radius + PLANET_GRAVITY_RANGE;
          if (d > gravRange) continue;
          nearPlanet = true;
          if (d >= lp.halfSize * 2) {
            const accel = LOOSE_PARTICLE_GRAVITY_STRENGTH * planet.radius / Math.max(d2, 400);
            const invD  = 1 / d;
            lp.vel.x += ddx * invD * accel * dt;
            lp.vel.y += ddy * invD * accel * dt;
          }
        }

        // Move
        lp.pos.x += lp.vel.x * dt;
        lp.pos.y += lp.vel.y * dt;

        // Resolve surface collision with planets to prevent particles from passing through
        for (let pi = 0; pi < alivePlanets.length; pi++) {
          const planet = alivePlanets[pi];
          const sdx = lp.pos.x - planet.pos.x;
          const sdy = lp.pos.y - planet.pos.y;
          const sd2 = sdx * sdx + sdy * sdy;
          const minDist = planet.collisionRadius + lp.halfSize;
          if (sd2 >= minDist * minDist || sd2 < LOOSE_PARTICLE_MIN_PLANET_DIST_SQ) continue;
          const sd = Math.sqrt(sd2);
          const invSd = 1 / sd;
          lp.pos.x = planet.pos.x + sdx * invSd * minDist;
          lp.pos.y = planet.pos.y + sdy * invSd * minDist;
          const nx = sdx * invSd;
          const ny = sdy * invSd;
          const radVel = lp.vel.x * nx + lp.vel.y * ny;
          if (radVel < 0) {
            lp.vel.x -= radVel * nx * (1 + LOOSE_PARTICLE_RESTITUTION);
            lp.vel.y -= radVel * ny * (1 + LOOSE_PARTICLE_RESTITUTION);
          }
          nearPlanet = true;
        }

        // Refresh lifetime when near a planet; decrement when in open space
        if (nearPlanet) {
          lp.lifetime = LOOSE_PARTICLE_MAX_LIFE;
        } else {
          lp.lifetime -= dt;
          // Immediate despawn if far off-screen and no planet gravity
          const ox = lp.pos.x - camPos.x;
          const oy = lp.pos.y - camPos.y;
          if (ox * ox + oy * oy > offscreenLimitSq) {
            continue; // skip = despawn
          }
        }

        if (lp.lifetime > 0) {
          this.looseParticles[j++] = lp;
        }
      }
      this.looseParticles.length = j;
    }

    // ── Loose particle inter-collision (prevent particles from passing through each other) ──
    {
      const lpCount = this.looseParticles.length;
      for (let pi = 0; pi < lpCount - 1; pi++) {
        const a = this.looseParticles[pi];
        for (let pj = pi + 1; pj < lpCount; pj++) {
          const b = this.looseParticles[pj];
          const cdx = b.pos.x - a.pos.x;
          const cdy = b.pos.y - a.pos.y;
          const minSep = a.halfSize + b.halfSize;
          const cd2 = cdx * cdx + cdy * cdy;
          if (cd2 >= minSep * minSep || cd2 < LOOSE_PARTICLE_MIN_SEP_SQ) continue;
          const cd = Math.sqrt(cd2);
          const nx = cdx / cd;
          const ny = cdy / cd;
          const overlap = (minSep - cd) * 0.5;
          a.pos.x -= nx * overlap;
          a.pos.y -= ny * overlap;
          b.pos.x += nx * overlap;
          b.pos.y += ny * overlap;
          const relVel = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny;
          if (relVel < 0) {
            a.vel.x += relVel * nx;
            a.vel.y += relVel * ny;
            b.vel.x -= relVel * nx;
            b.vel.y -= relVel * ny;
          }
        }
      }
    }

    // ── Projectile collisions with loose planet particles ─────────
    for (const proj of projectiles) {
      if (!proj.alive) continue;
      for (let i = 0; i < this.looseParticles.length; i++) {
        const lp = this.looseParticles[i];
        const dx = lp.pos.x - proj.pos.x;
        const dy = lp.pos.y - proj.pos.y;
        const r  = lp.halfSize + proj.radius;
        if (dx * dx + dy * dy < r * r) {
          proj.alive = false;
          // Kick the loose particle away from the projectile impact direction
          const ang = Math.atan2(dy, dx);
          lp.vel.x += Math.cos(ang) * LOOSE_PARTICLE_HIT_SPEED;
          lp.vel.y += Math.sin(ang) * LOOSE_PARTICLE_HIT_SPEED;
          lp.lifetime = LOOSE_PARTICLE_MAX_LIFE; // reset so it doesn't immediately despawn
          break;
        }
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
    { let j = 0; for (let i = 0; i < this.floatingModules.length; i++) { if (this.floatingModules[i].hp > 0) this.floatingModules[j++] = this.floatingModules[i]; } this.floatingModules.length = j; }
  }

  draw(ctx: CanvasRenderingContext2D, camPos: Vec2, viewportWidthPx: number, viewportHeightPx: number, gameTimeSec = 0): void {
    const chunks = this._activeChunks(camPos);
    const halfW = viewportWidthPx * 0.5;
    const halfH = viewportHeightPx * 0.5;
    const cullMargin = 60;
    const minX = camPos.x - halfW - cullMargin;
    const maxX = camPos.x + halfW + cullMargin;
    const minY = camPos.y - halfH - cullMargin;
    const maxY = camPos.y + halfH + cullMargin;

    // ── Nebula patches (drawn before all other world geometry) ─────
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const chunk of chunks) {
      for (const nb of chunk.nebulaPatches) {
        if (nb.x + nb.radiusA < minX || nb.x - nb.radiusA > maxX ||
            nb.y + nb.radiusB < minY || nb.y - nb.radiusB > maxY) continue;
        ctx.save();
        // Subtle breathing animation: each nebula pulses at its own phase
        const nebulaPhase = (nb.x * 0.0017 + nb.y * 0.0013) % (Math.PI * 2);
        const nebulaPulse = 0.78 + 0.22 * Math.sin(gameTimeSec * 0.22 + nebulaPhase);
        ctx.globalAlpha = nebulaPulse;
        ctx.translate(nb.x, nb.y);
        ctx.rotate(nb.angle);
        ctx.scale(nb.radiusA, nb.radiusB);
        // Outer diffuse halo
        const outerGrad = ctx.createRadialGradient(0, 0, 0.3, 0, 0, 1);
        outerGrad.addColorStop(0,    nb.colorA);
        outerGrad.addColorStop(0.42, nb.colorA);
        outerGrad.addColorStop(0.72, nb.colorB.replace(/,[\d.]+\)$/, ',0.18)'));
        outerGrad.addColorStop(1,    nb.colorB);
        ctx.fillStyle = outerGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        // Bright inner core filament
        ctx.globalAlpha = nebulaPulse * 0.55;
        const innerGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.38);
        innerGrad.addColorStop(0,   nb.colorA.replace(/[\d.]+\)$/, '0.9)'));
        innerGrad.addColorStop(1,   nb.colorA.replace(/[\d.]+\)$/, '0)'));
        ctx.fillStyle = innerGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 0.38, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();

    // ── Planets ────────────────────────────────────────────────────
    for (const chunk of chunks) {
      for (const planet of chunk.planets) {
        planet.draw(ctx, minX, minY, maxX, maxY);
      }
    }

    // ── Loose planet particles ─────────────────────────────────────
    {
      let batchColor = '';
      for (let i = 0; i < this.looseParticles.length; i++) {
        const lp = this.looseParticles[i];
        if (lp.pos.x + lp.halfSize < minX || lp.pos.x - lp.halfSize > maxX ||
            lp.pos.y + lp.halfSize < minY || lp.pos.y - lp.halfSize > maxY) continue;
        if (lp.color !== batchColor) {
          if (batchColor !== '') ctx.fill();
          batchColor = lp.color;
          ctx.fillStyle = batchColor;
          ctx.beginPath();
        }
        const sz = lp.halfSize * 2;
        ctx.rect(lp.pos.x - lp.halfSize, lp.pos.y - lp.halfSize, sz, sz);
      }
      if (batchColor !== '') ctx.fill();
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
      // Hot ember glow while freshly detached (hpRatio > 0.6) → fades as fragment cools
      if (hpRatio > 0.35) {
        const emberAlpha = (hpRatio - 0.35) / 0.65;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowColor = '#ff7700';
        ctx.shadowBlur  = 8;
        ctx.fillStyle   = `rgba(255,140,0,${(emberAlpha * 0.45).toFixed(3)})`;
        ctx.fillRect(fm.pos.x - half - 2, fm.pos.y - half - 2, fm.size + 4, fm.size + 4);
        ctx.shadowBlur  = 0;
        ctx.restore();
      }
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
    const now     = Date.now();
    const nowSec  = now * 0.001;
    for (const p of this.pickups) {
      const fade     = Math.min(1, p.lifetime / 3); // fade out last 3 s
      const spin     = nowSec * 1.8 + (p.pos.x + p.pos.y) * 0.02; // per-pickup phase offset
      const pulse    = 0.72 + Math.sin(nowSec * 3.0 + p.pos.x * 0.01) * 0.18;
      const twinkle  = 0.5 + Math.sin(nowSec * 9.0 + p.pos.y * 0.03) * 0.5;
      const props    = MATERIAL_PROPS[p.material];
      const rarity01 = Math.min(1, Math.max(0, props.rarity));
      const S        = 5.5; // half-size of the diamond
      const haloR    = S * (1.8 + rarity01 * 0.9);
      const orbitR   = S * (2.2 + rarity01 * 0.6);
      ctx.save();
      ctx.globalAlpha = fade * pulse;
      ctx.globalCompositeOperation = 'lighter';
      // Soft outer halo
      ctx.shadowColor = props.color;
      ctx.shadowBlur  = 16 + rarity01 * 10;
      ctx.strokeStyle = props.color;
      ctx.lineWidth   = 1.3 + rarity01 * 0.9;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, haloR, 0, Math.PI * 2);
      ctx.stroke();
      // Secondary orbit ring for richer space-readability
      ctx.globalAlpha *= 0.6;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, haloR + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = fade * pulse;
      // Orbiting sparkles
      const orbitA = spin * 1.35;
      const sx1 = p.pos.x + Math.cos(orbitA) * orbitR;
      const sy1 = p.pos.y + Math.sin(orbitA) * orbitR;
      const sx2 = p.pos.x + Math.cos(orbitA + Math.PI) * orbitR;
      const sy2 = p.pos.y + Math.sin(orbitA + Math.PI) * orbitR;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(sx1, sy1, 1.1 + twinkle * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fade * (0.45 + twinkle * 0.35);
      ctx.beginPath();
      ctx.arc(sx2, sy2, 0.9 + twinkle * 0.5, 0, Math.PI * 2);
      ctx.fill();
      // Rotating crystal core
      ctx.globalAlpha = fade * pulse;
      ctx.translate(p.pos.x, p.pos.y);
      ctx.rotate(spin);
      ctx.fillStyle   = props.color;
      ctx.shadowBlur  = 9 + rarity01 * 5;
      ctx.beginPath();
      ctx.moveTo(0,  -S);
      ctx.lineTo(S,   0);
      ctx.lineTo(0,   S);
      ctx.lineTo(-S,  0);
      ctx.closePath();
      ctx.fill();
      // Counter-rotating inner crystal
      ctx.rotate(-spin * 1.9);
      const innerS = S * (0.58 + rarity01 * 0.18);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(0,      -innerS);
      ctx.lineTo(innerS,  0);
      ctx.lineTo(0,       innerS);
      ctx.lineTo(-innerS, 0);
      ctx.closePath();
      ctx.fill();
      // Bright center highlight
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = 'rgba(255,255,255,0.62)';
      const h = S * 0.35;
      ctx.beginPath();
      ctx.moveTo(0, -h);
      ctx.lineTo(h,  0);
      ctx.lineTo(0,  h);
      ctx.lineTo(-h, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // Label
      ctx.save();
      ctx.globalAlpha = fade * 0.9;
      ctx.fillStyle   = props.color;
      ctx.font        = '9px Courier New';
      ctx.textAlign   = 'center';
      ctx.fillText(`${p.material} ×${p.qty}`, p.pos.x, p.pos.y - 13);
      ctx.restore();
    }

    // ── Health pickups ─────────────────────────────────────────────
    for (const h of this.healthPickups) {
      const fade  = Math.min(1, h.lifetime / 3);
      const pulse = 0.72 + Math.sin(nowSec * 4.0 + h.pos.x * 0.01) * 0.22;
      ctx.save();
      ctx.globalAlpha = fade * pulse;
      // Outer glow ring
      ctx.shadowColor = '#ff5566';
      ctx.shadowBlur  = 16;
      ctx.strokeStyle = '#ff5566';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.arc(h.pos.x, h.pos.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      // Cross symbol
      ctx.fillStyle  = '#ff4455';
      ctx.shadowBlur = 10;
      ctx.fillRect(h.pos.x - 6, h.pos.y - 2, 12, 4); // horizontal bar
      ctx.fillRect(h.pos.x - 2, h.pos.y - 6, 4, 12); // vertical bar
      // Bright cross center
      ctx.shadowBlur = 0;
      ctx.fillStyle  = 'rgba(255,200,200,0.7)';
      ctx.fillRect(h.pos.x - 2, h.pos.y - 2, 4, 4);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = fade * 0.85;
      ctx.fillStyle   = '#ffaaaa';
      ctx.font        = '9px Courier New';
      ctx.textAlign   = 'center';
      ctx.fillText(`+${h.amount} HP`, h.pos.x, h.pos.y - 14);
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
      // Top-left bevel highlight (consistent with asteroid blocks)
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(block.pos.x + BLOCK_SIZE, block.pos.y);
      ctx.lineTo(block.pos.x, block.pos.y);
      ctx.lineTo(block.pos.x, block.pos.y + BLOCK_SIZE);
      ctx.stroke();
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

  /**
   * Returns the squared world-distance to the nearest alive enemy (any type)
   * from a given world position.  Returns Infinity when no enemies exist.
   */
  nearestEnemyDistSq(fromPos: Vec2): number {
    let best = Infinity;
    const check = (pos: Vec2): void => {
      const dx = pos.x - fromPos.x;
      const dy = pos.y - fromPos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    };
    const chunks = this._cachedChunks;
    for (const chunk of chunks) {
      for (const e  of chunk.enemies)      if (e.alive)  check(e.pos);
      for (const ms of chunk.motherships)  if (ms.alive) check(ms.pos);
      for (const ic of chunk.interceptors) if (ic.alive) check(ic.pos);
      for (const gs of chunk.gunships)     if (gs.alive) check(gs.pos);
      for (const bm of chunk.bombers)      if (bm.alive) check(bm.pos);
    }
    for (const d of this.drones) if (d.alive) check(d.pos);
    return best;
  }

  /**
   * Apply a graviton shockwave centred at `pos`, repelling all enemies within
   * `radiusWorld` with impulse proportional to proximity.
   * Returns the number of enemies affected.
   */
  applyGravitonPulse(pos: Vec2, radiusWorld: number, pushForce: number): number {
    let affected = 0;
    const r2 = radiusWorld * radiusWorld;
    const applyImpulse = (ePos: Vec2, eVel: Vec2): void => {
      const dx = ePos.x - pos.x;
      const dy = ePos.y - pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r2 || d2 < 0.01) return;
      const d   = Math.sqrt(d2);
      const str = pushForce * (1 - d / radiusWorld) / d;
      eVel.x += dx * str;
      eVel.y += dy * str;
      affected++;
    };
    const chunks = this._cachedChunks;
    for (const chunk of chunks) {
      for (const e  of chunk.enemies)      if (e.alive)  { applyImpulse(e.pos,  e.vel);  }
      for (const ic of chunk.interceptors) if (ic.alive) { applyImpulse(ic.pos, ic.vel); }
      for (const gs of chunk.gunships)     if (gs.alive) { applyImpulse(gs.pos, gs.vel); }
      for (const bm of chunk.bombers)      if (bm.alive) { applyImpulse(bm.pos, bm.vel); }
    }
    for (const d of this.drones) if (d.alive) { applyImpulse(d.pos, d.vel); }
    return affected;
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
