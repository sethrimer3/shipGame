import { InputManager }  from './input';
import { Camera }        from './camera';
import { Player }        from './player';
import { World }         from './world';
import { Toolbar }       from './toolbar';
import { CraftingSystem } from './crafting';
import { HUD }           from './hud';
import { Projectile }    from './projectile';
import { Particle, updateParticle, drawParticle } from './particle';
import { StarfieldRenderer } from './starfield';
import { SunRenderer }       from './sun-renderer';

class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx:    CanvasRenderingContext2D;

  private readonly input:    InputManager;
  private readonly camera:   Camera;
  private readonly player:   Player;
  private readonly world:    World;
  private readonly toolbar:  Toolbar;
  private readonly crafting: CraftingSystem;
  private readonly hud:      HUD;
  private readonly starfield: StarfieldRenderer;
  private readonly sunRenderer: SunRenderer;

  private readonly projectiles: Projectile[] = [];
  private readonly particles:   Particle[]   = [];

  private lastTime = 0;
  private gameTime = 0;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const ctx   = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context');
    this.ctx = ctx;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.input   = new InputManager(this.canvas);
    this.camera  = new Camera();
    this.player  = new Player(this.input, this.camera);
    this.world   = new World();
    this.toolbar = new Toolbar();
    this.hud     = new HUD();
    this.starfield   = new StarfieldRenderer();
    this.sunRenderer = new SunRenderer();

    this.crafting = new CraftingSystem(
      this.player,
      this.toolbar,
      (msg: string) => this.hud.showMessage(msg),
    );

    // Add the notification div to DOM if missing
    if (!document.getElementById('notification')) {
      const n = document.createElement('div');
      n.id    = 'notification';
      document.getElementById('ui-overlay')?.appendChild(n);
    }

    // Initial toolbar render
    this.toolbar.renderDOM();

    requestAnimationFrame((t) => this.loop(t));
  }

  private resize(): void {
    this.canvas.width  = this.canvas.clientWidth  || window.innerWidth;
    this.canvas.height = this.canvas.clientHeight || window.innerHeight;
    this.camera.resize(this.canvas.width, this.canvas.height);
  }

  // ── Main loop ──────────────────────────────────────────────────────────────
  private loop(timestamp: number): void {
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05); // cap at 50 ms
    this.lastTime = timestamp;
    this.gameTime += dt;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  private update(dt: number): void {
    if (!this.player.alive) {
      if (this.input.isDown('r')) window.location.reload();
      return;
    }

    // ── Toolbar navigation ──────────────────────────────────────────
    const scroll = this.input.consumeScroll();
    if (scroll !== 0) {
      this.toolbar.scroll(scroll);
      this.toolbar.renderDOM();
    }

    for (let i = 0; i < 8; i++) {
      if (this.input.isDown(String(i + 1))) {
        this.toolbar.selectSlot(i);
        this.toolbar.renderDOM();
      }
    }

    // ── Crafting toggle ─────────────────────────────────────────────
    if (this.input.isDown('c') && !this._craftingKeyHeld) {
      this.crafting.toggle();
      this._craftingKeyHeld = true;
    }
    if (!this.input.isDown('c')) this._craftingKeyHeld = false;

    if (this.crafting.isOpen()) return; // pause game while crafting

    // ── Player ─────────────────────────────────────────────────────
    this.player.update(dt, this.toolbar.selected, this.particles, this.projectiles);

    // ── World / enemies / collisions ────────────────────────────────
    this.world.update(dt, this.player, this.projectiles, this.particles, this.camera.position);

    // ── Level-up notification ────────────────────────────────────
    if (this.player.leveledUp) {
      this.player.leveledUp = false;
      this.hud.showMessage(`⬆ Level ${this.player.level}! HP +10  Shield +5`, 3);
    }

    // ── Camera shake on damage ───────────────────────────────────
    if (this.player.recentDamage > 0) {
      this.camera.shake(Math.min(this.player.recentDamage * 0.4, 12));
      this.player.recentDamage = 0;
    }
    this.camera.updateShake(dt);

    // ── Projectiles ─────────────────────────────────────────────────
    for (const p of this.projectiles) p.update(dt);
    this.projectiles.splice(0, this.projectiles.length,
      ...this.projectiles.filter(p => p.alive));

    // ── Particles ──────────────────────────────────────────────────
    for (const p of this.particles) updateParticle(p, dt);
    this.particles.splice(0, this.particles.length,
      ...this.particles.filter(p => p.lifetime > 0));

    // ── Camera ─────────────────────────────────────────────────────
    this.camera.follow(this.player.pos, dt);

    // ── HUD ────────────────────────────────────────────────────────
    this.hud.update(this.player, dt, this.world.kills);
    this.crafting.refresh();
  }

  private _craftingKeyHeld = false;

  // ── Render ─────────────────────────────────────────────────────────────────
  private render(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = '#06080f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Parallax starfield (screen-space, before camera transform)
    this.starfield.draw(ctx, this.camera.position, canvas.width, canvas.height);

    // World-space rendering
    this.camera.begin(ctx);

    // Sun at world origin
    this.sunRenderer.draw(ctx, { x: 0, y: 0 }, 150, this.gameTime);

    this.world.draw(ctx, this.camera.position);

    // Projectiles
    for (const p of this.projectiles) p.draw(ctx);

    // Particles
    for (const p of this.particles) drawParticle(ctx, p);

    // Player
    if (this.player.alive) this.player.draw(ctx);

    this.camera.end(ctx);

    // ── Minimap ────────────────────────────────────────────────────
    if (this.player.alive) this._drawMinimap(ctx);

    // ── Game-over overlay ──────────────────────────────────────────
    if (!this.player.alive) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle   = '#e74c3c';
      ctx.font        = 'bold 48px Courier New';
      ctx.textAlign   = 'center';
      ctx.fillText('SHIP DESTROYED', canvas.width / 2, canvas.height / 2 - 20);
      ctx.fillStyle = '#fff';
      ctx.font      = '20px Courier New';
      ctx.fillText(`Kills: ${this.world.kills}`, canvas.width / 2, canvas.height / 2 + 24);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font      = '16px Courier New';
      ctx.fillText('Press R to restart', canvas.width / 2, canvas.height / 2 + 58);
    }
  }

  // ── Minimap ────────────────────────────────────────────────────────────────
  private _drawMinimap(ctx: CanvasRenderingContext2D): void {
    const SIZE   = 150;
    const RANGE  = 2000; // world-unit radius visible on map
    const MARGIN = 14;
    const mx = this.canvas.width - SIZE - MARGIN;
    const my = MARGIN;

    ctx.save();

    // Background + border
    ctx.fillStyle   = 'rgba(0, 5, 12, 0.70)';
    ctx.strokeStyle = 'rgba(80, 200, 255, 0.35)';
    ctx.lineWidth   = 1;
    ctx.fillRect(mx, my, SIZE, SIZE);
    ctx.strokeRect(mx, my, SIZE, SIZE);

    // Clip to minimap bounds
    ctx.beginPath();
    ctx.rect(mx, my, SIZE, SIZE);
    ctx.clip();

    const scale  = SIZE / (RANGE * 2);
    const cx     = mx + SIZE / 2;
    const cy     = my + SIZE / 2;
    const player = this.player;

    const toMap = (wp: { x: number; y: number }): { x: number; y: number } => ({
      x: cx + (wp.x - player.pos.x) * scale,
      y: cy + (wp.y - player.pos.y) * scale,
    });

    const { enemies, asteroids, pickups } = this.world.getMinimapData(this.camera.position);

    // Asteroids (dim gray squares)
    ctx.fillStyle = 'rgba(160, 160, 160, 0.35)';
    for (const a of asteroids) {
      const p = toMap(a);
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }

    // Pickups (yellow dots)
    ctx.fillStyle = '#f1c40f';
    for (const pk of pickups) {
      const p = toMap(pk);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Enemies (red dots)
    ctx.fillStyle = '#e74c3c';
    for (const e of enemies) {
      const p = toMap(e);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player (bright green dot)
    ctx.fillStyle   = '#2ecc71';
    ctx.shadowColor = '#2ecc71';
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Compass label
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font      = '8px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, my + 9);
  }
}

// Start the game when the DOM is ready
window.addEventListener('DOMContentLoaded', () => new Game());
