import { Player } from './player';

/** Renders health / shield bars and coordinates via the DOM overlay. */
export class HUD {
  private readonly healthBar  = document.getElementById('health-bar')   as HTMLDivElement;
  private readonly shieldBar  = document.getElementById('shield-bar')   as HTMLDivElement;
  private readonly coordsDisp = document.getElementById('coords-display') as HTMLDivElement;
  private readonly killsDisp  = document.getElementById('kills-display')  as HTMLDivElement | null;
  private readonly notif      = document.getElementById('notification')  as HTMLDivElement | null;

  private notifTimer = 0;

  update(player: Player, dt: number, kills: number): void {
    this.healthBar.style.width = `${(player.hp    / player.maxHp)    * 100}%`;
    this.shieldBar.style.width = `${(player.shield / player.maxShield) * 100}%`;

    const x = Math.round(player.pos.x);
    const y = Math.round(player.pos.y);
    this.coordsDisp.innerHTML  = `X: ${x} &nbsp; Y: ${y}`;

    if (this.killsDisp) this.killsDisp.textContent = `☠ ${kills}`;

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
