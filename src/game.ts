import { InputManager }  from './input';
import { Camera }        from './camera';
import { Player }        from './player';
import { World }         from './world';
import { Toolbar }       from './toolbar';
import { CraftingSystem } from './crafting';
import { HUD }           from './hud';
import { Projectile }    from './projectile';
import { Particle, updateParticle, drawParticle } from './particle';

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

  private readonly projectiles: Projectile[] = [];
  private readonly particles:   Particle[]   = [];

  private lastTime = 0;

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

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  private update(dt: number): void {
    if (!this.player.alive) return;

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

    // World-space rendering
    this.camera.begin(ctx);

    this.world.draw(ctx, this.camera.position);

    // Projectiles
    for (const p of this.projectiles) p.draw(ctx);

    // Particles
    for (const p of this.particles) drawParticle(ctx, p);

    // Player
    if (this.player.alive) this.player.draw(ctx);

    this.camera.end(ctx);

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
      ctx.fillText('Refresh to restart', canvas.width / 2, canvas.height / 2 + 56);
    }
  }
}

// Start the game when the DOM is ready
window.addEventListener('DOMContentLoaded', () => new Game());
