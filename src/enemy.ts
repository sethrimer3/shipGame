import {
  Vec2, add, sub, scale, normalize, len, dist, fromAngle,
} from './types';
import { Player }     from './player';
import { Projectile } from './projectile';
import { Particle, makeExplosion } from './particle';

// ── Drone enemy (spawned by motherships and trap asteroids) ──────────────────
/**
 * A tiny autonomous ship composed of just a few hull modules, an engine, and a
 * laser module. No retreat – it rushes the player and fires rapidly.
 */
export class Drone {
  vel:   Vec2  = { x: 0, y: 0 };
  angle: number = 0;
  hp:    number;
  alive  = true;

  readonly radius = 7;
  readonly mass   = 80;

  private fireCooldown  = 0;
  private readonly _maxHp:    number;
  private readonly _speed:    number;
  private readonly _damage:   number;
  private readonly _fireRate: number;
  private readonly _color:    string;
  private readonly _xpValue:  number;

  constructor(
    public pos: Vec2,
    /** 0 = weak (near spawn), 1 = normal, 2 = strong (far out) */
    tier: 0 | 1 | 2 = 0,
  ) {
    this._maxHp    = [20, 35, 55][tier];
    this.hp        = this._maxHp;
    this._speed    = [190, 210, 230][tier];
    this._damage   = [6, 10, 16][tier];
    this._fireRate = [1.5, 2.0, 2.8][tier];
    this._color    = ['#ff6060', '#ff8844', '#ffbb22'][tier];
    this._xpValue  = [5, 10, 18][tier];
  }

  get xpValue(): number { return this._xpValue; }

  update(dt: number, player: Player, projectiles: Projectile[], particles: Particle[]): void {
    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const d  = Math.sqrt(dx * dx + dy * dy);

    if (d > 1) {
      this.angle = Math.atan2(dy, dx);
      const nx   = dx / d;
      const ny   = dy / d;
      this.vel.x += nx * this._speed * 4 * dt;
      this.vel.y += ny * this._speed * 4 * dt;
    }

    const spd = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
    if (spd > this._speed) {
      const f = this._speed / spd;
      this.vel.x *= f;
      this.vel.y *= f;
    }

    const drag = Math.pow(0.88, dt * 60);
    this.vel.x *= drag;
    this.vel.y *= drag;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Fire at player when close enough
    this.fireCooldown -= dt;
    if (d < 520 && this.fireCooldown <= 0) {
      this.fireCooldown = 1 / this._fireRate;
      const dir = d > 0 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
      projectiles.push(new Projectile(
        this.pos, dir, 420, this._damage, 3, '#ff6060', 'enemy', 2.5,
      ));
    }
  }

  /** Deal damage; returns true if killed. */
  damage(amount: number, particles: Particle[], rng: () => number): boolean {
    this.hp -= amount;
    particles.push(...makeExplosion(this.pos, 3, this._color, rng));
    if (this.hp <= 0) {
      this.alive = false;
      particles.push(...makeExplosion(this.pos, 8, this._color, rng));
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);
    const B = 5;
    // Tiny ship silhouette: nose + body + wings
    const blocks: [number, number][] = [
      [1, 0], [0, -1], [0, 0], [0, 1],
    ];
    for (const [col, row] of blocks) {
      ctx.fillStyle   = this._color;
      ctx.fillRect(col * B - B / 2, row * B - B / 2, B, B);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(col * B - B / 2, row * B - B / 2, B, B);
    }
    ctx.restore();

    // HP bar
    const barW    = this.radius * 2;
    const hpRatio = this.hp / this._maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(this.pos.x - barW / 2, this.pos.y - this.radius - 7, barW, 3);
    ctx.fillStyle = hpRatio > 0.5 ? '#2ecc71' : '#e74c3c';
    ctx.fillRect(this.pos.x - barW / 2, this.pos.y - this.radius - 7, barW * hpRatio, 3);
  }
}

// ── Interceptor enemy (fast kamikaze that rams the player) ───────────────────
/**
 * A sleek missile-ship that beelines straight for the player and deals damage
 * on contact, then explodes. No ranged attack – pure ramming threat.
 */
export class Interceptor {
  vel:   Vec2  = { x: 0, y: 0 };
  angle: number = 0;
  hp:    number;
  alive  = true;

  readonly radius = 8;
  readonly mass   = 60;

  private readonly _maxHp:     number;
  private readonly _speed:     number;
  private readonly _ramDamage: number;
  private readonly _color:     string;
  private readonly _xpValue:   number;

  constructor(
    public pos: Vec2,
    tier: 0 | 1 | 2 = 0,
  ) {
    this._maxHp     = [25, 42, 68][tier];
    this.hp         = this._maxHp;
    this._speed     = [280, 330, 390][tier];
    this._ramDamage = [18, 28, 44][tier];
    this._color     = ['#ff4444', '#ff6622', '#ff2200'][tier];
    this._xpValue   = [8, 16, 28][tier];
  }

  get xpValue():   number { return this._xpValue;   }
  get ramDamage(): number { return this._ramDamage;  }

  update(dt: number, player: Player, particles: Particle[]): void {
    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const d  = Math.sqrt(dx * dx + dy * dy);

    if (d > 0.1) {
      this.angle = Math.atan2(dy, dx);
      const nx   = dx / d;
      const ny   = dy / d;
      this.vel.x += nx * this._speed * 5 * dt;
      this.vel.y += ny * this._speed * 5 * dt;
    }

    const spd = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
    if (spd > this._speed) {
      const f    = this._speed / spd;
      this.vel.x *= f;
      this.vel.y *= f;
    }

    const drag = Math.pow(0.92, dt * 60);
    this.vel.x *= drag;
    this.vel.y *= drag;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Exhaust trail
    if (d > 50 && Math.random() < 40 * dt) {
      particles.push({
        pos:      { x: this.pos.x, y: this.pos.y },
        vel:      {
          x: -Math.cos(this.angle) * (50 + Math.random() * 40) + (Math.random() - 0.5) * 20,
          y: -Math.sin(this.angle) * (50 + Math.random() * 40) + (Math.random() - 0.5) * 20,
        },
        color:    this._color,
        radius:   2 + Math.random() * 1.5,
        lifetime: 0.22,
        maxLife:  0.22,
        alpha:    1,
      });
    }
  }

  /** Deal damage; returns true if killed. */
  damage(amount: number, particles: Particle[], rng: () => number): boolean {
    this.hp -= amount;
    particles.push(...makeExplosion(this.pos, 3, this._color, rng));
    if (this.hp <= 0) {
      this.alive = false;
      particles.push(...makeExplosion(this.pos, 14, this._color, rng));
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);

    // Sleek pointed diamond shape
    ctx.fillStyle   = this._color;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth   = 0.7;
    ctx.beginPath();
    ctx.moveTo( 11,  0);   // nose
    ctx.lineTo(  0, -5);   // top-wing
    ctx.lineTo( -6,  0);   // tail
    ctx.lineTo(  0,  5);   // bottom-wing
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // HP bar (compact)
    const barW    = this.radius * 2;
    const hpRatio = this.hp / this._maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(this.pos.x - barW / 2, this.pos.y - this.radius - 7, barW, 3);
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(this.pos.x - barW / 2, this.pos.y - this.radius - 7, barW * hpRatio, 3);
  }
}


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
    color: '#8e44ad', xpValue: 60, dropChance: 0.7,
  },
  {
    minDist: 10000, name: 'Capital Ship',  radius: 30, maxHp: 400, speed: 60,
    damage: 50, fireRate: 2.5, projectileSpeed: 550, sightRange: 800,
    color: '#2c3e50', xpValue: 150, dropChance: 0.9,
  },
];

export function tierForDist(d: number): EnemyTier {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (d >= TIERS[i].minDist) return TIERS[i];
  }
  return TIERS[0];
}

// ── State machine ─────────────────────────────────────────────────────────────
type EnemyState = 'patrol' | 'chase' | 'attack' | 'retreat';

const RETREAT_HP_THRESHOLD    = 0.25; // fraction of maxHp below which an enemy retreats
const RETREAT_DISTANCE_MULT   = 2.0;  // multiples of sightRange before retreat ends
const RETREAT_RECOVERY_CAP    = 0.5;  // max HP fraction an enemy recovers to after retreating
const RETREAT_RECOVERY_AMOUNT = 0.2;  // fraction of maxHp restored on successful retreat

export class Enemy {
  vel:   Vec2  = { x: 0, y: 0 };
  angle: number = 0;
  hp:    number;
  alive  = true;

  private state:        EnemyState = 'patrol';
  private patrolTarget: Vec2;
  private fireCooldown  = 0;
  private stateTimer    = 0;

  readonly tier: EnemyTier;

  constructor(
    public pos: Vec2,
    distFromOrigin: number,
    private rng: () => number,
  ) {
    this.tier         = tierForDist(distFromOrigin);
    this.hp           = this.tier.maxHp;
    this.patrolTarget = this._randomPatrolPoint();
  }

  get radius(): number { return this.tier.radius; }
  /** Physics mass used for ship–asteroid impulse resolution. */
  get mass():   number { return this.tier.radius * 20; }

  private _randomPatrolPoint(): Vec2 {
    const range = 300;
    return {
      x: this.pos.x + (this.rng() - 0.5) * range * 2,
      y: this.pos.y + (this.rng() - 0.5) * range * 2,
    };
  }

  update(dt: number, player: Player, projectiles: Projectile[], particles: Particle[]): void {
    const distToPlayer = dist(this.pos, player.pos);

    // ── State transitions ──────────────────────────────────────────
    this.stateTimer += dt;

    // Retreat when critically wounded (< 25% HP)
    if (this.hp < this.tier.maxHp * RETREAT_HP_THRESHOLD && this.state !== 'retreat') {
      this.state      = 'retreat';
      this.stateTimer = 0;
    }

    if (this.state === 'patrol') {
      if (distToPlayer < this.tier.sightRange) {
        this.state      = 'chase';
        this.stateTimer = 0;
      }
      if (this.stateTimer > 4) {
        this.patrolTarget = this._randomPatrolPoint();
        this.stateTimer   = 0;
      }
    } else if (this.state === 'chase') {
      if (distToPlayer < this.tier.sightRange * 0.7) {
        this.state      = 'attack';
        this.stateTimer = 0;
      } else if (distToPlayer > this.tier.sightRange * 1.5) {
        this.state      = 'patrol';
        this.stateTimer = 0;
      }
    } else if (this.state === 'attack') {
      if (distToPlayer > this.tier.sightRange * 1.3) {
        this.state      = 'chase';
        this.stateTimer = 0;
      }
    } else if (this.state === 'retreat') {
      // Partially recover and re-enter patrol once far enough away
      if (distToPlayer > this.tier.sightRange * RETREAT_DISTANCE_MULT) {
        this.hp    = Math.min(this.tier.maxHp * RETREAT_RECOVERY_CAP, this.hp + this.tier.maxHp * RETREAT_RECOVERY_AMOUNT);
        this.state = 'patrol';
        this.stateTimer = 0;
        this.patrolTarget = this._randomPatrolPoint();
      }
    }

    // ── Movement ───────────────────────────────────────────────────
    let targetPos: Vec2;
    const ATTACK_RANGE = this.tier.sightRange * 0.4;

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
      projectiles.push(new Projectile(
        this.pos, dir, this.tier.projectileSpeed, this.tier.damage,
        4, '#ff6060', 'enemy', 3,
      ));
    }
  }

  /** Deal damage; returns true if killed. */
  damage(amount: number, particles: Particle[], rng: () => number): boolean {
    this.hp -= amount;
    // Hit spark
    particles.push(...makeExplosion(this.pos, 4, '#ff8844', rng));
    if (this.hp <= 0) {
      this.alive = false;
      particles.push(...makeExplosion(this.pos, 18, this.tier.color, rng));
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);

    const r = this.tier.radius;
    // Block size scales with tier radius; each ship is a small grid of squares
    const B = Math.max(5, Math.round(r * 0.55));
    // [col, row] — col+ = forward (nose), row+ = down in local space
    const blocks: [number, number][] = r > 14
      ? [ // larger ships: wider wing arrangement
          [ 1,  0],
          [ 0, -1], [ 0,  0], [ 0,  1],
          [-1, -2], [-1, -1], [-1,  0], [-1,  1], [-1,  2],
          [-2,  0],
        ]
      : [ // small ships: compact cross
          [ 1,  0],
          [ 0, -1], [ 0,  0], [ 0,  1],
          [-1,  0],
        ];

    for (const [col, row] of blocks) {
      const x = col * B - B / 2;
      const y = row * B - B / 2;
      ctx.fillStyle   = this.tier.color;
      ctx.fillRect(x, y, B, B);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(x, y, B, B);
    }

    ctx.restore();

    // Health bar
    const barW   = r * 2.5;
    const barH   = 4;
    const barX   = this.pos.x - barW / 2;
    const barY   = this.pos.y - r - 10;
    const hpRatio = this.hp / this.tier.maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpRatio > 0.5 ? '#2ecc71' : hpRatio > 0.25 ? '#e67e22' : '#e74c3c';
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

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
  }
}
