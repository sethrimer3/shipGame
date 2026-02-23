import { Vec2, len, dist, Material, MATERIAL_PROPS, pickMaterial, pickGem } from './types';
import { Asteroid, AsteroidTurret }  from './asteroid';
import { Enemy, Drone, Interceptor } from './enemy';
import { Particle, FloatingText, makeFloatingText }  from './particle';
import { Projectile } from './projectile';
import { Player }    from './player';
import { BLOCK_SIZE, Block } from './block';
import { Mothership, mothershipTierForDist } from './mothership';

// ── Physics helpers ──────────────────────────────────────────────────────────

/**
 * Resolve a ship vs asteroid circle collision using impulse physics.
 * Mutates ship pos/vel and asteroid pos/vel in place.
 */
function resolveShipAsteroidCollision(
  shipPos: Vec2, shipVel: Vec2, shipRadius: number, shipMass: number,
  asteroid: Asteroid,
): void {
  const c  = asteroid.centre;
  const dx = shipPos.x - c.x;
  const dy = shipPos.y - c.y;
  const d  = Math.sqrt(dx * dx + dy * dy);
  const minDist = shipRadius + asteroid.radius;
  if (d >= minDist || d < 0.001) return; // 0.001 guard prevents divide-by-zero when centres coincide

  // Collision normal: from asteroid centre toward ship
  const nx = dx / d;
  const ny = dy / d;

  // Separate the two bodies proportional to their masses
  const astMass   = asteroid.mass;
  const totalMass = shipMass + astMass;
  const overlap   = minDist - d;
  shipPos.x      += nx * overlap * (astMass   / totalMass);
  shipPos.y      += ny * overlap * (astMass   / totalMass);
  asteroid.pos.x -= nx * overlap * (shipMass  / totalMass);
  asteroid.pos.y -= ny * overlap * (shipMass  / totalMass);

  // Impulse along the normal (coefficient of restitution = 0.5)
  const e    = 0.5;
  const dvx  = shipVel.x - asteroid.vel.x;
  const dvy  = shipVel.y - asteroid.vel.y;
  const vRel = dvx * nx + dvy * ny;
  if (vRel >= 0) return; // already separating – no impulse needed

  const j         = -(1 + e) * vRel / (1 / shipMass + 1 / astMass);
  shipVel.x      += (j / shipMass) * nx;
  shipVel.y      += (j / shipMass) * ny;
  asteroid.vel.x -= (j / astMass)  * nx;
  asteroid.vel.y -= (j / astMass)  * ny;
}

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


const PICKUP_COLLECT_RADIUS = 40;   // world units for auto-collect
const PICKUP_SUCTION_RADIUS = 200;  // world units where pickups accelerate toward player
const PICKUP_LIFETIME       = 20;   // seconds before despawn
const PICKUP_HALF_SIZE      = 5;    // half-side of pickup draw rect (world units)

const HEALTH_DROP_CHANCE        = 0.15; // probability of a health pack dropping on enemy kill
const HEALTH_DROP_XP_MULTIPLIER = 0.3;  // heal amount = 10 + xpValue * this

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
}

export class World {
  private readonly chunks = new Map<string, Chunk>();
  private readonly debris: Particle[] = [];   // block destruction particles

  /** Floating resource pickups dropped by enemies and asteroid debris. */
  pickups: ResourcePickup[] = [];

  /** Health pickups dropped by enemies. */
  healthPickups: HealthPickup[] = [];

  /** Blocks placed by the player. */
  placedBlocks: PlacedBlock[] = [];

  /** Active drones spawned by motherships and trap asteroids. */
  drones: Drone[] = [];

  /** Accumulated enemy kills – could be used for score */
  kills = 0;

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
    if (distFromOrigin < 200) return { cx, cy, asteroids, enemies, stars, motherships, turrets, interceptors };

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

    return { cx, cy, asteroids, enemies, stars, motherships, turrets, interceptors };
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
    floatingTexts: FloatingText[],
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
            const killed = enemy.damage(proj.damage, particles, Math.random);
            floatingTexts.push(makeFloatingText(
              { x: enemy.pos.x, y: enemy.pos.y - enemy.radius },
              `-${proj.damage}`,
              '#ffcc44',
            ));
            if (killed) {
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
          player.damage(proj.damage);
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
            ms.damageModule(mod, proj.damage, particles, Math.random);
            floatingTexts.push(makeFloatingText(
              { x: proj.pos.x, y: proj.pos.y - 10 },
              `-${proj.damage}`,
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

      // ── Interceptor AI update ─────────────────────────────────────
      for (const ic of chunk.interceptors) {
        if (!ic.alive) continue;
        ic.update(dt, player, particles);
      }

      // ── Interceptor ram collision (contact with player) ───────────
      for (const ic of chunk.interceptors) {
        if (!ic.alive) continue;
        if (dist(ic.pos, player.pos) < ic.radius + player.radius) {
          player.damage(ic.ramDamage);
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
            const killed = ic.damage(proj.damage, particles, Math.random);
            floatingTexts.push(makeFloatingText(
              { x: ic.pos.x, y: ic.pos.y - ic.radius },
              `-${proj.damage}`,
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
    }

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
        player.hp = Math.min(player.maxHp, player.hp + h.amount);
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
        if (
          proj.pos.x >= block.pos.x && proj.pos.x < block.pos.x + BLOCK_SIZE &&
          proj.pos.y >= block.pos.y && proj.pos.y < block.pos.y + BLOCK_SIZE
        ) {
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
      drone.update(dt, player, projectiles, particles);
    }

    // ── Drone-projectile collisions (player hits drone) ───────────
    for (const drone of this.drones) {
      if (!drone.alive) continue;
      for (const proj of projectiles) {
        if (!proj.alive || proj.owner !== 'player') continue;
        if (dist(proj.pos, drone.pos) < drone.radius + proj.radius) {
          proj.alive = false;
          const killed = drone.damage(proj.damage, particles, Math.random);
          floatingTexts.push(makeFloatingText(
            { x: drone.pos.x, y: drone.pos.y - drone.radius },
            `-${proj.damage}`,
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

    // ── Interceptors ───────────────────────────────────────────────
    for (const chunk of chunks) {
      for (const ic of chunk.interceptors) {
        if (ic.alive) ic.draw(ctx);
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
  getMinimapData(camPos: Vec2): { enemies: Vec2[]; asteroids: Vec2[]; pickups: Vec2[] } {
    const chunks    = this._activeChunks(camPos);
    const enemies:   Vec2[] = [];
    const asteroids: Vec2[] = [];
    const pickupPos: Vec2[] = [];
    for (const chunk of chunks) {
      for (const e  of chunk.enemies)     if (e.alive)    enemies.push({ ...e.pos });
      for (const ms of chunk.motherships) if (ms.alive)   enemies.push({ ...ms.pos });
      for (const ic of chunk.interceptors) if (ic.alive)  enemies.push({ ...ic.pos });
      for (const a  of chunk.asteroids)   if (a.alive)    asteroids.push({ ...a.centre });
    }
    for (const d of this.drones) if (d.alive) enemies.push({ ...d.pos });
    for (const p of this.pickups) pickupPos.push({ ...p.pos });
    return { enemies, asteroids, pickups: pickupPos };
  }

  /** Returns AABB occluder quads for all active shadow-casting entities. */
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
        const r = enemy.radius;
        result.push(aabb(enemy.pos.x - r, enemy.pos.y - r, enemy.pos.x + r, enemy.pos.y + r));
      }
      for (const ms of chunk.motherships) {
        if (!ms.alive) continue;
        const r = ms.radius;
        result.push(aabb(ms.pos.x - r, ms.pos.y - r, ms.pos.x + r, ms.pos.y + r));
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
