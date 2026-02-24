import { Vec2 } from './types';
import { Asteroid } from './asteroid';

// ── Physics helpers ──────────────────────────────────────────────────────────

/**
 * Returns true when a circle (cx, cy, r) overlaps an axis-aligned rectangle
 * (rx, ry, rw, rh).  Uses the nearest-point-on-rect method.
 */
export function circleVsRect(
  cx: number, cy: number, r: number,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  const nearX = Math.max(rx, Math.min(cx, rx + rw));
  const nearY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearX;
  const dy = cy - nearY;
  return dx * dx + dy * dy <= r * r;
}


export function segmentIntersectsRect(
  x1: number, y1: number,
  x2: number, y2: number,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  const left = rx;
  const right = rx + rw;
  const top = ry;
  const bottom = ry + rh;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tMin = 0;
  let tMax = 1;

  if (Math.abs(dx) < 1e-8) {
    if (x1 < left || x1 > right) return false;
  } else {
    const invDx = 1 / dx;
    let t1 = (left - x1) * invDx;
    let t2 = (right - x1) * invDx;
    if (t1 > t2) {
      const temp = t1;
      t1 = t2;
      t2 = temp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  if (Math.abs(dy) < 1e-8) {
    if (y1 < top || y1 > bottom) return false;
  } else {
    const invDy = 1 / dy;
    let t1 = (top - y1) * invDy;
    let t2 = (bottom - y1) * invDy;
    if (t1 > t2) {
      const temp = t1;
      t1 = t2;
      t2 = temp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  return true;
}

export function segmentCircleClosestT(
  x1: number, y1: number,
  x2: number, y2: number,
  cx: number, cy: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-8) return 0;
  const t = ((cx - x1) * dx + (cy - y1) * dy) / lenSq;
  return Math.max(0, Math.min(1, t));
}


export function segmentRectEntryTime(
  x1: number, y1: number,
  x2: number, y2: number,
  rx: number, ry: number, rw: number, rh: number,
): number | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tMin = 0;
  let tMax = 1;

  const axisCheck = (p: number, qMin: number, qMax: number): boolean => {
    if (Math.abs(p) < 1e-8) {
      if (qMin > 0 || qMax < 0) return false;
      return true;
    }
    const inv = 1 / p;
    let t1 = qMin * inv;
    let t2 = qMax * inv;
    if (t1 > t2) {
      const temp = t1;
      t1 = t2;
      t2 = temp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    return tMin <= tMax;
  };

  if (!axisCheck(dx, rx - x1, (rx + rw) - x1)) return null;
  if (!axisCheck(dy, ry - y1, (ry + rh) - y1)) return null;
  return tMin;
}

export function steerShipAroundAsteroids(
  shipPos: Vec2,
  shipVel: Vec2,
  shipRadius: number,
  asteroids: Asteroid[],
  dtSec: number,
): void {
  const speed = Math.sqrt(shipVel.x * shipVel.x + shipVel.y * shipVel.y);
  if (speed < 1) return;

  const lookAheadSec = Math.min(0.55, Math.max(0.2, speed * 0.0018));
  const forwardX = shipVel.x / speed;
  const forwardY = shipVel.y / speed;
  let avoidX = 0;
  let avoidY = 0;

  for (const asteroid of asteroids) {
    if (!asteroid.alive) continue;
    const combinedRadius = asteroid.radius + shipRadius;
    const toAsteroidX = asteroid.centre.x - shipPos.x;
    const toAsteroidY = asteroid.centre.y - shipPos.y;
    const forwardDist = toAsteroidX * forwardX + toAsteroidY * forwardY;
    if (forwardDist < -combinedRadius || forwardDist > speed * lookAheadSec + combinedRadius) continue;

    const closestX = shipPos.x + forwardX * Math.max(0, Math.min(speed * lookAheadSec, forwardDist));
    const closestY = shipPos.y + forwardY * Math.max(0, Math.min(speed * lookAheadSec, forwardDist));
    const offX = closestX - asteroid.centre.x;
    const offY = closestY - asteroid.centre.y;
    const offDistSq = offX * offX + offY * offY;
    if (offDistSq >= combinedRadius * combinedRadius) continue;

    const offDist = Math.sqrt(Math.max(1e-8, offDistSq));
    const penetration = 1 - offDist / Math.max(1, combinedRadius);
    avoidX += (offX / offDist) * penetration;
    avoidY += (offY / offDist) * penetration;
  }

  const avoidMag = Math.sqrt(avoidX * avoidX + avoidY * avoidY);
  if (avoidMag < 1e-5) return;

  const blend = Math.min(1, dtSec * 6);
  const tangentX = -avoidY / avoidMag;
  const tangentY = avoidX / avoidMag;
  const tangentDir = (tangentX * forwardX + tangentY * forwardY) >= 0 ? 1 : -1;
  const desiredX = (avoidX / avoidMag) * 0.35 + tangentX * tangentDir;
  const desiredY = (avoidY / avoidMag) * 0.35 + tangentY * tangentDir;
  const desiredMag = Math.sqrt(desiredX * desiredX + desiredY * desiredY) || 1;

  const steerX = (desiredX / desiredMag) * speed;
  const steerY = (desiredY / desiredMag) * speed;
  shipVel.x = shipVel.x * (1 - blend) + steerX * blend;
  shipVel.y = shipVel.y * (1 - blend) + steerY * blend;
}

/**
 * Resolve a ship vs asteroid circle collision using impulse physics.
 * Mutates ship pos/vel and asteroid pos/vel in place.
 */
export function resolveShipAsteroidCollision(
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
