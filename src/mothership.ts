import { Vec2, sub, scale, normalize, len, dist } from './types';
import { Player }            from './player';
import { Projectile, HomingRocket } from './projectile';
import { Particle, makeExplosion }  from './particle';
import { Drone }             from './enemy';

// ── Module constants ────────────────────────────────────────────────────────
const MODULE_SIZE = 8; // pixels per module square

type ModuleType = 'hull' | 'weapon_laser' | 'weapon_rocket' | 'weapon_drone';

interface MsModule {
  col:           number;
  row:           number;
  type:          ModuleType;
  hp:            number;
  maxHp:         number;
  alive:         boolean;
  fireCooldown:  number;
}

// ── Tier definitions (scale with world distance from origin) ──────────────
export interface MothershipTier {
  minDist:       number;
  gridRadius:    number; // half-size; full circle has ~π*R² modules
  laserWeapons:  number;
  rocketWeapons: number;
  droneBays:     number;
  hullHp:        number; // HP per hull module
  weaponHp:      number; // HP per weapon module
  xpValue:       number;
  color:         string;
  speed:         number;
  sightRange:    number;
  orbitRadius:   number;
  laserDamage:   number;
  laserRate:     number;  // shots/s per laser module
  rocketDamage:  number;
  rocketRate:    number;
  droneRate:     number;
  droneTier:     0 | 1 | 2;
}

const MOTHERSHIP_TIERS: MothershipTier[] = [
  {
    minDist: 3000,  gridRadius: 5,  laserWeapons: 2,  rocketWeapons: 0, droneBays: 0,
    hullHp: 40,  weaponHp: 60,  xpValue: 400,  color: '#c0392b',
    speed: 35,  sightRange: 900,  orbitRadius: 340,
    laserDamage: 12, laserRate: 1.0, rocketDamage: 0,  rocketRate: 0,  droneRate: 0, droneTier: 0,
  },
  {
    minDist: 7000,  gridRadius: 9,  laserWeapons: 3,  rocketWeapons: 2, droneBays: 0,
    hullHp: 55,  weaponHp: 80,  xpValue: 900,  color: '#8e44ad',
    speed: 28,  sightRange: 1100, orbitRadius: 420,
    laserDamage: 18, laserRate: 1.4, rocketDamage: 35, rocketRate: 0.4, droneRate: 0, droneTier: 0,
  },
  {
    minDist: 12000, gridRadius: 13, laserWeapons: 4,  rocketWeapons: 3, droneBays: 2,
    hullHp: 70,  weaponHp: 100, xpValue: 2000, color: '#2c3e50',
    speed: 22,  sightRange: 1300, orbitRadius: 500,
    laserDamage: 26, laserRate: 1.8, rocketDamage: 50, rocketRate: 0.5, droneRate: 0.25, droneTier: 1,
  },
  {
    minDist: 20000, gridRadius: 18, laserWeapons: 6,  rocketWeapons: 4, droneBays: 3,
    hullHp: 90,  weaponHp: 130, xpValue: 4000, color: '#1a1a2e',
    speed: 16,  sightRange: 1600, orbitRadius: 600,
    laserDamage: 38, laserRate: 2.2, rocketDamage: 70, rocketRate: 0.6, droneRate: 0.35, droneTier: 2,
  },
];

export function mothershipTierForDist(d: number): MothershipTier {
  for (let i = MOTHERSHIP_TIERS.length - 1; i >= 0; i--) {
    if (d >= MOTHERSHIP_TIERS[i].minDist) return MOTHERSHIP_TIERS[i];
  }
  return MOTHERSHIP_TIERS[0];
}

// ── Mothership ────────────────────────────────────────────────────────────────
export class Mothership {
  vel:   Vec2  = { x: 0, y: 0 };
  alive  = true;

  readonly tier: MothershipTier;
  readonly modules: MsModule[];

  private _orbitAngle = 0;

  constructor(
    public pos: Vec2,
    distFromOrigin: number,
    rng: () => number,
  ) {
    this.tier    = mothershipTierForDist(distFromOrigin);
    this.modules = this._buildModules(rng);
  }

  get isDead(): boolean { return this.modules.every(m => !m.alive); }

  /** Rough bounding radius (for shadow occluder and minimap) */
  get radius(): number { return this.tier.gridRadius * MODULE_SIZE * 1.2; }

  // ── Module grid generation ─────────────────────────────────────────────
  private _buildModules(rng: () => number): MsModule[] {
    const R       = this.tier.gridRadius;
    const modules: MsModule[] = [];

    for (let col = -R; col <= R; col++) {
      for (let row = -R; row <= R; row++) {
        if (col * col + row * row > R * R) continue;
        modules.push({
          col, row,
          type:         'hull',
          hp:           this.tier.hullHp,
          maxHp:        this.tier.hullHp,
          alive:        true,
          fireCooldown: 0,
        });
      }
    }

    // Perimeter modules are candidates for weapon slots
    const perimeter = modules.filter(m => {
      const d = Math.sqrt(m.col * m.col + m.row * m.row);
      return d >= R - 1.5;
    });

    // Deterministic shuffle via rng
    for (let i = perimeter.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [perimeter[i], perimeter[j]] = [perimeter[j], perimeter[i]];
    }

    let idx = 0;
    const assignWeapon = (type: ModuleType, count: number): void => {
      for (let i = 0; i < count && idx < perimeter.length; i++, idx++) {
        perimeter[idx].type   = type;
        perimeter[idx].hp     = this.tier.weaponHp;
        perimeter[idx].maxHp  = this.tier.weaponHp;
      }
    };
    assignWeapon('weapon_laser',  this.tier.laserWeapons);
    assignWeapon('weapon_rocket', this.tier.rocketWeapons);
    assignWeapon('weapon_drone',  this.tier.droneBays);

    return modules;
  }

  // ── World-space position of a module ─────────────────────────────────
  private _moduleWorldPos(m: MsModule): Vec2 {
    return {
      x: this.pos.x + m.col * MODULE_SIZE,
      y: this.pos.y + m.row * MODULE_SIZE,
    };
  }

  // ── Hit test – returns the module at a world point (or null) ─────────
  moduleAt(worldPt: Vec2): MsModule | null {
    const lx = worldPt.x - this.pos.x;
    const ly = worldPt.y - this.pos.y;
    const half = MODULE_SIZE / 2;
    for (const m of this.modules) {
      if (!m.alive) continue;
      const mx = m.col * MODULE_SIZE - half;
      const my = m.row * MODULE_SIZE - half;
      if (lx >= mx && lx < mx + MODULE_SIZE && ly >= my && ly < my + MODULE_SIZE) {
        return m;
      }
    }
    return null;
  }

  /** Damage a specific module; causes particle sparks. */
  damageModule(
    module: MsModule,
    amount: number,
    particles: Particle[],
    rng: () => number,
  ): void {
    module.hp -= amount;
    const wp = this._moduleWorldPos(module);
    particles.push(...makeExplosion(wp, 3, this.tier.color, rng));
    if (module.hp <= 0) {
      module.alive = false;
      particles.push(...makeExplosion(
        wp, module.type === 'hull' ? 6 : 12,
        module.type === 'hull' ? '#888888' : '#ff8844', rng,
      ));
    }
    if (this.isDead) this.alive = false;
  }

  // ── AI update ─────────────────────────────────────────────────────────
  update(
    dt: number,
    player: Player,
    projectiles: Projectile[],
    particles: Particle[],
    drones: Drone[],
  ): void {
    if (!this.alive) return;

    const toPlayer = sub(player.pos, this.pos);
    const d        = len(toPlayer);

    // ── Movement ────────────────────────────────────────────────────
    if (d > this.tier.sightRange) {
      // Idle drift – stay put
    } else if (d > this.tier.orbitRadius) {
      // Approach player
      const n = { x: toPlayer.x / d, y: toPlayer.y / d };
      this.vel.x += n.x * this.tier.speed * 2 * dt;
      this.vel.y += n.y * this.tier.speed * 2 * dt;
    } else {
      // Orbit: circle around player at orbitRadius
      this._orbitAngle += 0.35 * dt;
      const target = {
        x: player.pos.x + Math.cos(this._orbitAngle) * this.tier.orbitRadius,
        y: player.pos.y + Math.sin(this._orbitAngle) * this.tier.orbitRadius,
      };
      const toT = sub(target, this.pos);
      const tLen = len(toT);
      if (tLen > 1) {
        const nT = { x: toT.x / tLen, y: toT.y / tLen };
        this.vel.x += nT.x * this.tier.speed * 3 * dt;
        this.vel.y += nT.y * this.tier.speed * 3 * dt;
      }
    }

    // Speed cap + drag
    const spd = len(this.vel);
    if (spd > this.tier.speed) {
      const f = this.tier.speed / spd;
      this.vel.x *= f;
      this.vel.y *= f;
    }
    const drag = Math.pow(0.92, dt * 60);
    this.vel.x *= drag;
    this.vel.y *= drag;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // ── Weapon fire ─────────────────────────────────────────────────
    if (d > this.tier.sightRange) return; // don't fire if player out of range

    for (const m of this.modules) {
      if (!m.alive) continue;
      m.fireCooldown -= dt;
      if (m.fireCooldown > 0) continue;

      const wp = this._moduleWorldPos(m);

      if (m.type === 'weapon_laser' && this.tier.laserRate > 0) {
        m.fireCooldown = 1 / this.tier.laserRate;
        const toP = sub(player.pos, wp);
        const dP  = len(toP);
        if (dP > 0) {
          const dir = { x: toP.x / dP, y: toP.y / dP };
          projectiles.push(new Projectile(
            wp, dir, 520, this.tier.laserDamage, 4, '#ff2222', 'enemy', 3,
          ));
        }
      } else if (m.type === 'weapon_rocket' && this.tier.rocketRate > 0) {
        m.fireCooldown = 1 / this.tier.rocketRate;
        const toP = sub(player.pos, wp);
        const dP  = len(toP);
        if (dP > 0) {
          const dir = { x: toP.x / dP, y: toP.y / dP };
          const playerRef = player; // capture for closure
          projectiles.push(new HomingRocket(
            wp, dir, 260, this.tier.rocketDamage, 6, '#ff8800', 'enemy', 8,
            () => playerRef.pos,
            1.8,
          ));
        }
      } else if (m.type === 'weapon_drone' && this.tier.droneRate > 0) {
        m.fireCooldown = 1 / this.tier.droneRate;
        const ang    = Math.random() * Math.PI * 2;
        const offset = 30 + Math.random() * 40;
        drones.push(new Drone(
          { x: wp.x + Math.cos(ang) * offset, y: wp.y + Math.sin(ang) * offset },
          this.tier.droneTier,
        ));
      }
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.alive) return;
    const half = MODULE_SIZE / 2;

    for (const m of this.modules) {
      if (!m.alive) continue;
      const wx = this.pos.x + m.col * MODULE_SIZE - half;
      const wy = this.pos.y + m.row * MODULE_SIZE - half;

      // Module colour by type
      let fill: string;
      if (m.type === 'hull') {
        // Shade hull modules slightly by HP
        const r = m.hp / m.maxHp;
        fill = r > 0.5 ? this.tier.color : '#555555';
      } else if (m.type === 'weapon_laser') {
        fill = '#ff2222';
      } else if (m.type === 'weapon_rocket') {
        fill = '#ff8800';
      } else {
        fill = '#22dd44'; // drone bay
      }

      ctx.fillStyle   = fill;
      ctx.fillRect(wx, wy, MODULE_SIZE, MODULE_SIZE);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(wx, wy, MODULE_SIZE, MODULE_SIZE);
    }

    // Name label above
    const alive = this.modules.filter(m => m.alive).length;
    const total = this.modules.length;
    const R     = this.tier.gridRadius * MODULE_SIZE;
    const barW  = R * 2.2;
    const barX  = this.pos.x - barW / 2;
    const barY  = this.pos.y - R - 16;
    const ratio = alive / total;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(barX, barY, barW, 5);
    ctx.fillStyle = ratio > 0.5 ? '#e74c3c' : ratio > 0.2 ? '#e67e22' : '#999999';
    ctx.fillRect(barX, barY, barW * ratio, 5);

    ctx.fillStyle  = 'rgba(255,80,80,0.85)';
    ctx.font       = 'bold 11px Courier New';
    ctx.textAlign  = 'center';
    ctx.fillText('MOTHERSHIP', this.pos.x, barY - 4);
  }
}
