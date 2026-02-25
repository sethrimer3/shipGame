import {
  Vec2, add, sub, scale, normalize, len, dist,
} from './types';
import { Player }     from './player';
import { Projectile } from './projectile';
import { Particle, makeExplosion } from './particle';

export { Drone } from './drone';
export { Interceptor } from './interceptor';
export { Gunship } from './gunship';
export { Bomber } from './bomber';

export interface EnemyTier {
  minDist:       number;
  name:          string;
  radius:        number;
  maxHp:         number;
  speed:         number;
  damage:        number;       // per shot
  fireRate:      number;       // shots/s
  projectileSpeed: number;
  sightRange:    number;
  color:         string;
  xpValue:       number;
  dropChance:    number;       // 0–1, chance to drop a resource lump
}

const TIERS: EnemyTier[] = [
  {
    minDist: 0,      name: 'Scout',         radius: 10, maxHp: 30,  speed: 140,
    damage: 8,  fireRate: 1.0, projectileSpeed: 380, sightRange: 480,
    color: '#e74c3c', xpValue: 10, dropChance: 0.3,
  },
  {
    minDist: 2000,  name: 'Fighter',       radius: 14, maxHp: 70,  speed: 120,
    damage: 15, fireRate: 1.5, projectileSpeed: 450, sightRange: 560,
    color: '#e67e22', xpValue: 25, dropChance: 0.5,
  },
  {
    minDist: 5000,  name: 'Cruiser',       radius: 20, maxHp: 160, speed: 90,
    damage: 28, fireRate: 2.0, projectileSpeed: 500, sightRange: 640,
    color: '#f1c40f', xpValue: 60, dropChance: 0.7,
  },
  {
    minDist: 10000, name: 'Capital Ship',  radius: 30, maxHp: 400, speed: 60,
    damage: 50, fireRate: 2.5, projectileSpeed: 550, sightRange: 800,
    color: '#3498db', xpValue: 150, dropChance: 0.9,
  },
];

export function tierForDist(d: number): EnemyTier {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (d >= TIERS[i].minDist) return TIERS[i];
  }
  return TIERS[0];
}

// ── Enemy module (one structural square on a ship) ────────────────────────────
export interface EnemyModule {
  col:       number;
  row:       number;
  hp:        number;
  maxHp:     number;
  alive:     boolean;
  baseColor: string;
  /** The CORE module; destroying it kills the whole ship. */
  isCore:    boolean;
}

/** Data needed to spawn a floating debris fragment in the World. */
export interface EnemyModuleFragment {
  pos:   Vec2;
  vel:   Vec2;
  color: string;
  size:  number;
}

// ── State machine ─────────────────────────────────────────────────────────────
type EnemyState = 'patrol' | 'chase' | 'attack' | 'retreat';

const RETREAT_HP_THRESHOLD    = 0.25; // module ratio below which an enemy retreats
const RETREAT_DISTANCE_MULT   = 2.0;  // multiples of sightRange before retreat ends
const RETREAT_RECOVERY_CAP    = 0.5;  // max module-HP fraction an enemy recovers to
const RETREAT_RECOVERY_AMOUNT = 0.2;  // fraction of max module HP restored on retreat

/** Sight circle radius for patrol→chase detection (~half screen height at 600px). */
const PATROL_SIGHT_RADIUS = 300;
/** Duration the '!' alert indicator is shown when first spotting the player. */
const EXCLAIM_DURATION = 0.5;
/** Duration the '?' indicator is shown when the enemy gives up chasing. */
const QUESTION_DURATION = 1.0;
/** Minimum seconds before giving up the chase when the player stays out of sight. */
const SIGHT_LOST_MIN_SEC = 5;
/** Random additional range (seconds) added to SIGHT_LOST_MIN_SEC for the lost-timer threshold. */
const SIGHT_LOST_RANGE_SEC = 5;

export class Enemy {
  vel:   Vec2  = { x: 0, y: 0 };
  angle: number = 0;
  alive  = true;

  private state:        EnemyState = 'patrol';
  private patrolTarget: Vec2;
  private fireCooldown  = 0;
  private stateTimer    = 0;

  /** Timer counting down while the '!' alert is visible above the enemy. */
  private _exclamTimer  = 0;
  /** Timer counting down while the '?' indicator is visible above the enemy. */
  private _questionTimer = 0;
  /** Counts up while the player is outside sight range during chase/attack. */
  private _sightLostTimer = 0;
  /** Random 5–10 s threshold before giving up the chase (set when chase starts). */
  private _sightLostThreshold = 0;

  readonly tier: EnemyTier;
  readonly modules: EnemyModule[];

  constructor(
    public pos: Vec2,
    distFromOrigin: number,
    private rng: () => number,
  ) {
    this.tier         = tierForDist(distFromOrigin);
    this.modules      = this._buildModules();
    this.patrolTarget = this._randomPatrolPoint();
  }

  get radius(): number { return this.tier.radius; }
  /** Physics mass used for ship–asteroid impulse resolution. */
  get mass():   number { return this.tier.radius * 20; }

  /** Block size for this enemy's tier. */
  private get _blockSize(): number {
    return Math.max(5, Math.round(this.tier.radius * 0.55));
  }

  /** Sum of HP across all alive modules. */
  private get _totalHp(): number {
    return this.modules.filter(m => m.alive).reduce((s, m) => s + m.hp, 0);
  }

  /** Sum of maxHp across all modules (constant; used for retreat threshold). */
  private get _totalMaxHp(): number {
    return this.modules.reduce((s, m) => s + m.maxHp, 0);
  }

  private static readonly _LARGE_MODULE_COUNT = 10;
  private static readonly _SMALL_MODULE_COUNT = 5;

  /** Build the initial module grid for this enemy's tier. */
  private _buildModules(): EnemyModule[] {
    const r = this.tier.radius;
    const isLarge = r > 14;
    const moduleCount = isLarge ? Enemy._LARGE_MODULE_COUNT : Enemy._SMALL_MODULE_COUNT;
    const hpPerModule = this.tier.maxHp / moduleCount;
    // [col, row, baseColor, isCore]
    const defs: [number, number, string, boolean][] = isLarge
      ? [
          [ 1,  0, '#ff4444', false],
          [ 0, -1, this.tier.color, false],
          [ 0,  0, this.tier.color, true],   // CORE
          [ 0,  1, this.tier.color, false],
          [-1, -2, this.tier.color, false], [-1, -1, this.tier.color, false],
          [-1,  0, this.tier.color, false],
          [-1,  1, this.tier.color, false], [-1,  2, this.tier.color, false],
          [-2,  0, '#7fd9ff', false],
        ]
      : [
          [ 1,  0, '#ff4444', false],
          [ 0, -1, this.tier.color, false],
          [ 0,  0, this.tier.color, true],   // CORE
          [ 0,  1, this.tier.color, false],
          [-1,  0, '#7fd9ff', false],
        ];
    return defs.map(([col, row, baseColor, isCore]) => ({
      col, row,
      hp: hpPerModule, maxHp: hpPerModule,
      alive: true, baseColor, isCore,
    }));
  }

  /** World-space centre of a module, accounting for ship rotation. */
  private _moduleWorldPos(m: EnemyModule): Vec2 {
    const B = this._blockSize;
    const lx = m.col * B;
    const ly = m.row * B;
    const cosA = Math.cos(this.angle);
    const sinA = Math.sin(this.angle);
    return {
      x: this.pos.x + lx * cosA - ly * sinA,
      y: this.pos.y + lx * sinA + ly * cosA,
    };
  }

  /**
   * BFS from CORE to find alive modules not connected to it.
   * 4-connectivity: neighbours differ by 1 in exactly one axis.
   */
  private _findDisconnectedModules(): EnemyModule[] {
    const core = this.modules.find(m => m.isCore && m.alive);
    if (!core) return [];
    const alive = this.modules.filter(m => m.alive);
    const connected = new Set<EnemyModule>([core]);
    const queue: EnemyModule[] = [core];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const m of alive) {
        if (connected.has(m)) continue;
        if ((Math.abs(m.col - cur.col) === 1 && m.row === cur.row) ||
            (Math.abs(m.row - cur.row) === 1 && m.col === cur.col)) {
          connected.add(m);
          queue.push(m);
        }
      }
    }
    return alive.filter(m => !connected.has(m));
  }

  /** Build a fragment descriptor for a module, using rng for velocity randomness. */
  private _makeFragment(m: EnemyModule, rng: () => number): EnemyModuleFragment {
    const B = this._blockSize;
    const wp = this._moduleWorldPos(m);
    const ang = rng() * Math.PI * 2;
    const speed = 20 + rng() * 80;
    return {
      pos:   { x: wp.x, y: wp.y },
      vel:   { x: this.vel.x + Math.cos(ang) * speed, y: this.vel.y + Math.sin(ang) * speed },
      color: m.baseColor,
      size:  B,
    };
  }

  private _randomPatrolPoint(): Vec2 {
    const range = 300;
    return {
      x: this.pos.x + (this.rng() - 0.5) * range * 2,
      y: this.pos.y + (this.rng() - 0.5) * range * 2,
    };
  }

  /** Returns a fresh random 5–10 s lost-chase threshold. */
  private _newSightLostThreshold(): number {
    return SIGHT_LOST_MIN_SEC + this.rng() * SIGHT_LOST_RANGE_SEC;
  }

  /**
   * Alert this enemy that the player has attacked it. Transitions from patrol
   * to chase even if the player is outside the normal sight radius, and resets
   * the sight-lost timer so the enemy keeps chasing after taking a hit.
   */
  alertedByPlayer(): void {
    if (this.state === 'patrol') {
      this.state               = 'chase';
      this.stateTimer          = 0;
      this._exclamTimer        = EXCLAIM_DURATION;
      this._sightLostTimer     = 0;
      this._sightLostThreshold = this._newSightLostThreshold();
    } else {
      // Reset the lost timer so the enemy keeps tracking after a hit
      this._sightLostTimer = 0;
    }
  }

  update(dt: number, player: Player, projectiles: Projectile[], particles: Particle[]): void {
    const distToPlayer = dist(this.pos, player.pos);

    // ── Alert-indicator timers ────────────────────────────────────
    if (this._exclamTimer  > 0) this._exclamTimer  -= dt;
    if (this._questionTimer > 0) this._questionTimer -= dt;

    // ── State transitions ──────────────────────────────────────────
    this.stateTimer += dt;

    // Retreat when critically wounded (< 25% of total module HP)
    if (this._totalHp < this._totalMaxHp * RETREAT_HP_THRESHOLD && this.state !== 'retreat') {
      this.state      = 'retreat';
      this.stateTimer = 0;
    }

    const inSight = distToPlayer < PATROL_SIGHT_RADIUS;

    if (this.state === 'patrol') {
      if (inSight) {
        this.state               = 'chase';
        this.stateTimer          = 0;
        this._exclamTimer        = EXCLAIM_DURATION;
        this._sightLostTimer     = 0;
        this._sightLostThreshold = this._newSightLostThreshold();
      }
      if (this.stateTimer > 4) {
        this.patrolTarget = this._randomPatrolPoint();
        this.stateTimer   = 0;
      }
    } else if (this.state === 'chase') {
      if (distToPlayer < this.tier.sightRange * 0.7) {
        this.state      = 'attack';
        this.stateTimer = 0;
      }
      // Track how long the player has been out of sight
      if (inSight) {
        this._sightLostTimer = 0;
      } else {
        this._sightLostTimer += dt;
        if (this._sightLostTimer >= this._sightLostThreshold) {
          this.state           = 'patrol';
          this.stateTimer      = 0;
          this.patrolTarget    = this._randomPatrolPoint();
          this._questionTimer  = QUESTION_DURATION;
          this._sightLostTimer = 0;
        }
      }
    } else if (this.state === 'attack') {
      if (distToPlayer > this.tier.sightRange * 1.3) {
        this.state      = 'chase';
        this.stateTimer = 0;
      }
      // Track how long the player has been out of sight
      if (inSight) {
        this._sightLostTimer = 0;
      } else {
        this._sightLostTimer += dt;
        if (this._sightLostTimer >= this._sightLostThreshold) {
          this.state           = 'patrol';
          this.stateTimer      = 0;
          this.patrolTarget    = this._randomPatrolPoint();
          this._questionTimer  = QUESTION_DURATION;
          this._sightLostTimer = 0;
        }
      }
    } else if (this.state === 'retreat') {
      // Partially recover and re-enter patrol once far enough away
      if (distToPlayer > PATROL_SIGHT_RADIUS * RETREAT_DISTANCE_MULT) {
        // Restore module HP up to RETREAT_RECOVERY_CAP fraction of max
        const cap    = this._totalMaxHp * RETREAT_RECOVERY_CAP;
        const toHeal = Math.min(cap - this._totalHp, this._totalMaxHp * RETREAT_RECOVERY_AMOUNT);
        if (toHeal > 0) {
          const aliveModules = this.modules.filter(m => m.alive);
          const healEach = toHeal / Math.max(1, aliveModules.length);
          for (const m of aliveModules) m.hp = Math.min(m.maxHp, m.hp + healEach);
        }
        this.state = 'patrol';
        this.stateTimer = 0;
        this.patrolTarget = this._randomPatrolPoint();
      }
    }

    // ── Movement ───────────────────────────────────────────────────
    let targetPos: Vec2;
    const ATTACK_RANGE = PATROL_SIGHT_RADIUS * 0.4;

    if (this.state === 'patrol') {
      targetPos = this.patrolTarget;
    } else if (this.state === 'chase') {
      targetPos = player.pos;
    } else if (this.state === 'retreat') {
      // Move directly away from the player
      const awayDir = sub(this.pos, player.pos);
      const awayLen = len(awayDir);
      const n = awayLen > 0.1 ? { x: awayDir.x / awayLen, y: awayDir.y / awayLen } : { x: 1, y: 0 };
      targetPos = add(this.pos, scale(n, 200));
    } else {
      // attack: orbit at ~ATTACK_RANGE
      if (distToPlayer > ATTACK_RANGE) {
        targetPos = player.pos;
      } else {
        // Circle around player
        const perpDir = { x: -(player.pos.y - this.pos.y), y: player.pos.x - this.pos.x };
        const n       = normalize(perpDir);
        targetPos     = add(this.pos, scale(n, this.tier.speed * dt * 60));
      }
    }

    const toTarget = sub(targetPos, this.pos);
    if (len(toTarget) > 1) {
      this.angle = Math.atan2(toTarget.y, toTarget.x);
      const n    = normalize(toTarget);
      this.vel.x += n.x * this.tier.speed * 4 * dt;
      this.vel.y += n.y * this.tier.speed * 4 * dt;
    }

    // Speed cap (retreat at 1.5× normal speed)
    const speedCap = this.state === 'retreat' ? this.tier.speed * 1.5 : this.tier.speed;
    const spd = len(this.vel);
    if (spd > speedCap) {
      const n  = normalize(this.vel);
      this.vel = scale(n, speedCap);
    }

    // Drag
    const drag = Math.pow(0.90, dt * 60);
    this.vel.x *= drag;
    this.vel.y *= drag;

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // ── Shooting ───────────────────────────────────────────────────
    this.fireCooldown -= dt;
    if (this.state === 'attack' && this.fireCooldown <= 0) {
      this.fireCooldown = 1 / this.tier.fireRate;
      const dir = normalize(sub(player.pos, this.pos));
      // Fire from the weapon module world position (col=1, row=0)
      const weaponModule = this.modules.find(m => m.col === 1 && m.row === 0 && m.alive);
      const firePos = weaponModule ? this._moduleWorldPos(weaponModule) : this.pos;
      projectiles.push(new Projectile(
        firePos, dir, this.tier.projectileSpeed, this.tier.damage,
        4, '#ff6060', 'enemy', 3,
      ));
    }
  }

  /**
   * Deal damage to the module nearest to `worldPos`.
   * Returns whether the CORE was destroyed (ship killed) and any fragments
   * that were disconnected.
   */
  damageAt(
    worldPos:  Vec2,
    amount:    number,
    particles: Particle[],
    rng:       () => number,
  ): { killed: boolean; fragments: EnemyModuleFragment[] } {
    const B = this._blockSize;

    // Transform worldPos into ship-local space (rotate by -angle)
    const dx   = worldPos.x - this.pos.x;
    const dy   = worldPos.y - this.pos.y;
    const cosA = Math.cos(-this.angle);
    const sinA = Math.sin(-this.angle);
    const lx   = dx * cosA - dy * sinA;
    const ly   = dx * sinA + dy * cosA;

    // Find the closest alive module to the transformed hit point
    let closest: EnemyModule | null = null;
    let minDist = Infinity;
    for (const m of this.modules) {
      if (!m.alive) continue;
      const d = Math.hypot(lx - m.col * B, ly - m.row * B);
      if (d < minDist) { minDist = d; closest = m; }
    }

    if (!closest) return { killed: false, fragments: [] };

    // Damage the module; show hit spark
    closest.hp -= amount;
    const wp = this._moduleWorldPos(closest);
    particles.push(...makeExplosion(wp, 3, closest.baseColor, rng));

    if (closest.hp > 0) return { killed: false, fragments: [] };

    // Module destroyed
    closest.alive = false;
    const fragments: EnemyModuleFragment[] = [];

    if (closest.isCore) {
      // Core destroyed – violent explosion; all remaining modules fly off
      this.alive = false;
      particles.push(...makeExplosion(wp, 22, this.tier.color, rng));
      for (const m of this.modules) {
        if (!m.alive) continue;
        m.alive = false;
        fragments.push(this._makeFragment(m, rng));
      }
      return { killed: true, fragments };
    }

    // Non-core module: small explosion
    particles.push(...makeExplosion(wp, 7, '#888888', rng));

    // Check for disconnected groups and detach them
    const disconnected = this._findDisconnectedModules();
    for (const m of disconnected) {
      m.alive = false;
      fragments.push(this._makeFragment(m, rng));
    }

    return { killed: false, fragments };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);

    const B = this._blockSize;

    for (const m of this.modules) {
      if (!m.alive) continue;
      const x = m.col * B - B / 2;
      const y = m.row * B - B / 2;

      ctx.fillStyle = m.baseColor;
      ctx.fillRect(x, y, B, B);

      // Darken the module as HP drains (like asteroid blocks)
      if (m.hp < m.maxHp) {
        const damageRatio = 1 - m.hp / m.maxHp;
        ctx.fillStyle = `rgba(0,0,0,${damageRatio * 0.7})`;
        ctx.fillRect(x, y, B, B);
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(x, y, B, B);
    }

    ctx.restore();

    // Module integrity bar (alive modules / total)
    const aliveCount = this.modules.filter(m => m.alive).length;
    const integrityRatio = aliveCount / this.modules.length;
    const r    = this.tier.radius;
    const barW = r * 2.5;
    const barH = 4;
    const barX = this.pos.x - barW / 2;
    const barY = this.pos.y - r - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = integrityRatio > 0.5 ? '#2ecc71' : integrityRatio > 0.25 ? '#e67e22' : '#e74c3c';
    ctx.fillRect(barX, barY, barW * integrityRatio, barH);

    // Name label when attacking or retreating
    if (this.state === 'attack' || this.state === 'chase') {
      ctx.fillStyle  = 'rgba(255,255,255,0.6)';
      ctx.font       = '9px Courier New';
      ctx.textAlign  = 'center';
      ctx.fillText(this.tier.name, this.pos.x, barY - 3);
    } else if (this.state === 'retreat') {
      ctx.fillStyle  = 'rgba(255,180,0,0.8)';
      ctx.font       = '9px Courier New';
      ctx.textAlign  = 'center';
      ctx.fillText('RETREATING', this.pos.x, barY - 3);
    }

    // ── Alert indicators ('!' and '?') ──────────────────────────────
    if (this._exclamTimer > 0) {
      const t       = this._exclamTimer / EXCLAIM_DURATION; // 1 → 0
      const floatUp = (1 - t) * 18;
      const alpha   = t < 0.4 ? t / 0.4 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = '#ffdd00';
      ctx.font        = 'bold 15px Courier New';
      ctx.textAlign   = 'center';
      ctx.fillText('!', this.pos.x, barY - 8 - floatUp);
      ctx.restore();
    }

    if (this._questionTimer > 0) {
      const t       = this._questionTimer / QUESTION_DURATION; // 1 → 0
      const floatUp = (1 - t) * 18;
      const alpha   = t < 0.4 ? t / 0.4 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = '#aaaaff';
      ctx.font        = 'bold 15px Courier New';
      ctx.textAlign   = 'center';
      ctx.fillText('?', this.pos.x, barY - 8 - floatUp);
      ctx.restore();
    }
  }
}
