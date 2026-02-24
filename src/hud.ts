import { Player } from './player';
import { len } from './types';

const ZONE_THRESHOLDS: Array<{ dist: number; name: string; color: string }> = [
  { dist: 0,     name: 'Spawn Zone',  color: '#2ecc71' },
  { dist: 800,   name: 'Near Space',  color: '#3498db' },
  { dist: 2000,  name: 'Mid Space',   color: '#9b59b6' },
  { dist: 5000,  name: 'Deep Space',  color: '#e67e22' },
  { dist: 10000, name: 'Void Fringe', color: '#e74c3c' },
  { dist: 16000, name: 'Dark Void',   color: '#6c3483' },
];

function zoneForDist(d: number): { name: string; color: string } {
  for (let i = ZONE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (d >= ZONE_THRESHOLDS[i].dist) return ZONE_THRESHOLDS[i];
  }
  return ZONE_THRESHOLDS[0];
}

/** Renders health / shield bars and coordinates via the DOM overlay. */
export class HUD {
  private readonly healthBar  = document.getElementById('health-bar')    as HTMLDivElement;
  private readonly shieldBar  = document.getElementById('shield-bar')    as HTMLDivElement;
  private readonly xpBar      = document.getElementById('xp-bar')        as HTMLDivElement;
  private readonly overheatBar = document.getElementById('overheat-bar')  as HTMLDivElement;
  private readonly levelDisp  = document.getElementById('level-display') as HTMLDivElement;
  private readonly coordsDisp = document.getElementById('coords-display') as HTMLDivElement;
  private readonly killsDisp  = document.getElementById('kills-display')  as HTMLDivElement | null;
  private readonly zoneDisp   = document.getElementById('zone-display')   as HTMLDivElement | null;
  private readonly notif      = document.getElementById('notification')  as HTMLDivElement | null;

  private notifTimer = 0;

  update(player: Player, dt: number, kills: number): void {
    // Health bar shows total effective HP: hull + core combined
    const totalHp    = player.hp + player.coreHp;
    const totalMaxHp = player.maxHp + player.maxCoreHp;
    this.healthBar.style.width = `${(totalHp / totalMaxHp) * 100}%`;
    // Tint red when only core HP remains (hull gone)
    this.healthBar.style.background = player.hp <= 0 ? '#ff4444' : '';
    this.shieldBar.style.width = `${(player.shield / player.maxShield) * 100}%`;

    this.xpBar.style.width     = `${(player.xp / player.xpToNextLevel()) * 100}%`;
    this.overheatBar.style.width = `${player.overheatRatio * 100}%`;
    this.levelDisp.textContent = `Lv ${player.level}`;

    const x = Math.round(player.pos.x);
    const y = Math.round(player.pos.y);
    this.coordsDisp.innerHTML  = `X: ${x} &nbsp; Y: ${y}`;

    if (this.killsDisp) this.killsDisp.textContent = `☠ ${kills}`;

    // Zone display
    if (this.zoneDisp) {
      const d = len(player.pos);
      const zone = zoneForDist(d);
      this.zoneDisp.textContent  = `⬡ ${zone.name}`;
      this.zoneDisp.style.color  = zone.color;
    }

    // Notification fade-out
    if (this.notifTimer > 0) {
      this.notifTimer -= dt;
      if (this.notifTimer <= 0 && this.notif) {
        this.notif.classList.remove('visible');
      }
    }
  }

  /** Show a temporary notification message (auto-hides after `duration` seconds). */
  showMessage(msg: string, duration = 2.5): void {
    if (!this.notif) return;
    this.notif.textContent = msg;
    this.notif.classList.add('visible');
    this.notifTimer = duration;
  }
}
