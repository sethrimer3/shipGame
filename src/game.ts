import { InputManager }  from './input';
import { Camera }        from './camera';
import { Player }        from './player';
import { World }         from './world';
import { Toolbar }       from './toolbar';
import { CraftingSystem } from './crafting';
import { HUD }           from './hud';
import { Projectile }    from './projectile';
import { Particle, updateParticle, drawParticle, FloatingText, updateFloatingText, drawFloatingText } from './particle';
import { StarfieldRenderer } from './starfield';
import { SunRenderer }       from './sun-renderer';
import { len, Material, TOOLBAR_ITEM_DEFS, Vec2 } from './types';

/** All material types in priority order for the placer laser. */
const ALL_MATERIALS = Object.values(Material) as Material[];
/** Default placer cooldown (seconds) when fireRate is 0. */
const DEFAULT_PLACER_COOLDOWN = 0.33;
const MAX_PLACER_RANGE = 320;
const DRAW_PLACE_INTERVAL = 0.045;

interface PlacementBeamEffect {
  from: Vec2;
  to: Vec2;
  life: number;
  maxLife: number;
}

interface BlockLaunchEffect {
  from: Vec2;
  to: Vec2;
  life: number;
  maxLife: number;
}

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
  private readonly floatingTexts: FloatingText[] = [];

  private lastTime  = 0;
  private gameTime  = 0;
  private _paused   = false;
  private _timeSurvived  = 0;
  private _maxDistFromOrigin = 0;

  /** Whether the settings panel is open. */
  private _settingsOpen   = false;
  private _settingsKeyHeld = false;
  /** When true (default), WASD moves relative to ship facing. When false, WASD = world axes. */
  private advancedMovement = false;
  /** Cooldown for the placer laser. */
  private _placerCooldown = 0;
  private _lastPlacedWorldPos: Vec2 | null = null;
  private readonly _placementBeams: PlacementBeamEffect[] = [];
  private readonly _launchEffects: BlockLaunchEffect[] = [];

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const ctx   = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context');
    this.ctx = ctx;

    this.camera  = new Camera();

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.input   = new InputManager(this.canvas);
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

    // Give player a starting mining laser in slot 0
    const miningLaser = TOOLBAR_ITEM_DEFS['mining_laser'];
    this.toolbar.addItem(miningLaser);
    this.player.equipItem(0, miningLaser);
    this.toolbar.renderDOM();

    // Wire up settings panel controls
    const advMovCheckbox = document.getElementById('setting-adv-movement') as HTMLInputElement | null;
    if (advMovCheckbox) {
      advMovCheckbox.checked = this.advancedMovement;
      advMovCheckbox.addEventListener('change', () => {
        this.advancedMovement = advMovCheckbox.checked;
      });
    }
    const closeSettingsBtn = document.getElementById('close-settings');
    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => {
        this._settingsOpen = false;
        document.getElementById('settings-panel')?.classList.add('hidden');
      });
    }

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
    if (!this._paused) this.gameTime += dt;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  private update(dt: number): void {
    // ── Escape: pause toggle ─────────────────────────────────────────
    if (this.input.isDown('escape') && !this._pauseKeyHeld) {
      this._paused = !this._paused;
      this._pauseKeyHeld = true;
    }
    if (!this.input.isDown('escape')) this._pauseKeyHeld = false;

    if (!this.player.alive) {
      if (this.input.isDown('r')) window.location.reload();
      return;
    }

    if (this._paused) return;

    // ── Settings toggle (Tab) ────────────────────────────────────────
    if (this.input.isDown('tab') && !this._settingsKeyHeld) {
      this._settingsOpen = !this._settingsOpen;
      this._settingsKeyHeld = true;
      const panel = document.getElementById('settings-panel');
      if (panel) {
        if (this._settingsOpen) panel.classList.remove('hidden');
        else panel.classList.add('hidden');
      }
    }
    if (!this.input.isDown('tab')) this._settingsKeyHeld = false;

    if (this._settingsOpen) return; // pause game while settings open

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
    this.player.update(dt, this.toolbar.selected, this.advancedMovement, this.particles, this.projectiles);

    // ── Placer laser (right-click) ──────────────────────────────────
    this._placerCooldown -= dt;
    if (!this.input.mouseRightDown) this._lastPlacedWorldPos = null;
    if (this.input.mouseRightDown && this._placerCooldown <= 0) {
      const available = ALL_MATERIALS.find(m => this.player.getResource(m) > 0);
      if (available !== undefined) {
        const worldPos = this.camera.screenToWorld(this.input.mousePos);
        const offset = { x: worldPos.x - this.player.pos.x, y: worldPos.y - this.player.pos.y };
        const d = len(offset);
        if (d <= MAX_PLACER_RANGE) {
          const snappedPos = this.world.snapToBlockGrid(worldPos);
          if (!this._lastPlacedWorldPos) {
            this._tryPlaceAt(snappedPos, available);
            this._lastPlacedWorldPos = { ...snappedPos };
          } else {
            const path = this._lineGridPath(this._lastPlacedWorldPos, snappedPos);
            let lastPlaced = this._lastPlacedWorldPos;
            for (const pos of path) {
              const distToShip = len({ x: pos.x - this.player.pos.x, y: pos.y - this.player.pos.y });
              if (distToShip > MAX_PLACER_RANGE) break;
              const placed = this._tryPlaceAt(pos, available);
              if (!placed) continue;
              lastPlaced = { ...pos };
              if (this.player.getResource(available) <= 0) break;
            }
            this._lastPlacedWorldPos = { ...lastPlaced };
          }
        }
        const selectedItem = this.player.equippedItems[this.toolbar.selected];
        this._placerCooldown = selectedItem?.type === 'placer' && selectedItem.fireRate > 0
          ? Math.min(1 / selectedItem.fireRate, DRAW_PLACE_INTERVAL)
          : DEFAULT_PLACER_COOLDOWN;
      } else {
        this.hud.showMessage('No materials – mine asteroids to collect resources', 2);
        this._placerCooldown = 1.5; // throttle message spam
        this._lastPlacedWorldPos = null;
      }
    }

    for (const beam of this._placementBeams) beam.life -= dt;
    this._placementBeams.splice(0, this._placementBeams.length,
      ...this._placementBeams.filter(beam => beam.life > 0));
    for (const launch of this._launchEffects) launch.life -= dt;
    this._launchEffects.splice(0, this._launchEffects.length,
      ...this._launchEffects.filter(launch => launch.life > 0));

    // ── Track survival stats ────────────────────────────────────────
    this._timeSurvived += dt;
    const distFromOrigin = len(this.player.pos);
    if (distFromOrigin > this._maxDistFromOrigin) this._maxDistFromOrigin = distFromOrigin;

    // ── World / enemies / collisions ────────────────────────────────
    this.world.update(dt, this.player, this.projectiles, this.particles, this.floatingTexts, this.camera.position);

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

    // ── Floating texts ──────────────────────────────────────────────
    for (const f of this.floatingTexts) updateFloatingText(f, dt);
    this.floatingTexts.splice(0, this.floatingTexts.length,
      ...this.floatingTexts.filter(f => f.lifetime > 0));

    // ── Camera ─────────────────────────────────────────────────────
    this.camera.follow(this.player.pos, dt);

    // ── HUD ────────────────────────────────────────────────────────
    this.hud.update(this.player, dt, this.world.kills);
    this.crafting.refresh();
  }

  private _lineGridPath(from: Vec2, to: Vec2): Vec2[] {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy)) / 20;
    const count = Math.max(1, Math.ceil(steps));
    const result: Vec2[] = [];
    const seen = new Set<string>();
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      const x = Math.floor((from.x + dx * t) / 20) * 20;
      const y = Math.floor((from.y + dy * t) / 20) * 20;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ x, y });
    }
    return result;
  }

  private _tryPlaceAt(gridPos: Vec2, material: Material): boolean {
    if (this.player.getResource(material) <= 0) return false;
    const placed = this.world.placeBlock(gridPos, material);
    if (!placed) return false;
    this.player.addResource(material, -1);
    const muzzle = this.player.getMuzzleWorldPos();
    this._placementBeams.push({ from: muzzle, to: { x: gridPos.x + 10, y: gridPos.y + 10 }, life: 0.09, maxLife: 0.09 });
    this._launchEffects.push({ from: muzzle, to: { x: gridPos.x, y: gridPos.y }, life: 0.12, maxLife: 0.12 });
    return true;
  }

  private _craftingKeyHeld = false;
  private _pauseKeyHeld    = false;

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

    for (const beam of this._placementBeams) {
      const ratio = Math.max(0, beam.life / beam.maxLife);
      ctx.save();
      ctx.globalAlpha = 0.2 + ratio * 0.4;
      ctx.strokeStyle = '#99ddff';
      ctx.lineWidth = 2 + ratio * 4;
      ctx.beginPath();
      ctx.moveTo(beam.from.x, beam.from.y);
      ctx.lineTo(beam.to.x, beam.to.y);
      ctx.stroke();
      ctx.restore();
    }

    for (const launch of this._launchEffects) {
      const ratio = Math.max(0, launch.life / launch.maxLife);
      const progress = 1 - ratio;
      const x = launch.from.x + (launch.to.x - launch.from.x) * progress;
      const y = launch.from.y + (launch.to.y - launch.from.y) * progress;
      const size = 4 + progress * 16;
      ctx.save();
      ctx.globalAlpha = 0.3 + ratio * 0.5;
      ctx.fillStyle = '#8fd3ff';
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.restore();
    }

    // Projectiles
    for (const p of this.projectiles) p.draw(ctx);

    // Particles
    for (const p of this.particles) drawParticle(ctx, p);

    // Floating damage / XP texts (world-space)
    for (const f of this.floatingTexts) drawFloatingText(ctx, f);

    // Player
    if (this.player.alive) this.player.draw(ctx);

    this.camera.end(ctx);

    // ── Sun ray-tracing / shadow overlay (screen-space, after camera) ─────
    if (this.player.alive) {
      const occluders = this.world.getShadowOccluders(this.camera.position);
      // Add player as occluder
      const pr = this.player.radius;
      occluders.push({ verts: [
        { x: this.player.pos.x - pr, y: this.player.pos.y - pr },
        { x: this.player.pos.x + pr, y: this.player.pos.y - pr },
        { x: this.player.pos.x + pr, y: this.player.pos.y + pr },
        { x: this.player.pos.x - pr, y: this.player.pos.y + pr },
      ] as Vec2[] });
      this.sunRenderer.drawSunRays(
        ctx,
        { x: 0, y: 0 },
        canvas.width,
        canvas.height,
        (p: Vec2) => this.camera.worldToScreen(p),
        occluders,
      );
    }

    // ── Minimap ────────────────────────────────────────────────────
    if (this.player.alive) this._drawMinimap(ctx);

    // ── Off-screen enemy indicators ────────────────────────────────
    if (this.player.alive) this._drawEnemyIndicators(ctx);

    // ── Speed indicator ────────────────────────────────────────────
    if (this.player.alive) {
      const spd = Math.round(len(this.player.vel));
      ctx.save();
      ctx.font      = '11px Courier New';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      // Position to the left of the minimap (SIZE=150 + MARGIN=14 + small gap)
      ctx.fillText(`SPD ${spd}`, canvas.width - 170, canvas.height - 14);
      ctx.restore();
    }

    // ── Pause overlay ──────────────────────────────────────────────
    if (this._paused && this.player.alive) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle   = '#7ecfff';
      ctx.font        = 'bold 40px Courier New';
      ctx.textAlign   = 'center';
      ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2 - 10);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font      = '16px Courier New';
      ctx.fillText('Press ESC to resume', canvas.width / 2, canvas.height / 2 + 30);
    }

    // ── Game-over overlay ──────────────────────────────────────────
    if (!this.player.alive) {
      ctx.fillStyle = 'rgba(0,0,0,0.70)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      ctx.fillStyle   = '#e74c3c';
      ctx.font        = 'bold 48px Courier New';
      ctx.textAlign   = 'center';
      ctx.fillText('SHIP DESTROYED', cx, cy - 60);

      ctx.fillStyle = '#fff';
      ctx.font      = '18px Courier New';
      const mins = Math.floor(this._timeSurvived / 60);
      const secs = Math.floor(this._timeSurvived % 60);
      const timeStr = `${mins}:${String(secs).padStart(2, '0')}`;
      ctx.fillText(`Kills: ${this.world.kills}   Level: ${this.player.level}`, cx, cy - 10);
      ctx.fillText(`Time: ${timeStr}   Max Dist: ${Math.round(this._maxDistFromOrigin)}`, cx, cy + 22);

      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font      = '14px Courier New';
      ctx.fillText('Press R to restart', cx, cy + 66);
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

  // ── Off-screen enemy indicators ────────────────────────────────────────────
  private _drawEnemyIndicators(ctx: CanvasRenderingContext2D): void {
    const { enemies } = this.world.getMinimapData(this.camera.position);
    const W = this.canvas.width;
    const H = this.canvas.height;
    const MARGIN = 24;
    const INDICATOR_RANGE = 1600; // only show if within this world-unit range

    ctx.save();
    ctx.fillStyle   = 'rgba(231, 76, 60, 0.85)';
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.5)';
    ctx.lineWidth   = 1;

    for (const e of enemies) {
      const dx = e.x - this.player.pos.x;
      const dy = e.y - this.player.pos.y;
      const worldDist = Math.sqrt(dx * dx + dy * dy);
      if (worldDist > INDICATOR_RANGE) continue;

      // Convert to screen space
      const screen = this.camera.worldToScreen(e);
      if (screen.x >= 0 && screen.x <= W && screen.y >= 0 && screen.y <= H) continue;

      // Clamp to screen edge
      const ang = Math.atan2(dy, dx);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const cx  = W / 2;
      const cy  = H / 2;

      // Find intersection with screen boundary; guard against near-zero divisor
      const EPS = 1e-9;
      const dxBound = Math.abs(cos) > EPS
        ? (cos >= 0 ? (W - MARGIN - cx) : (MARGIN - cx)) / cos
        : Infinity;
      const dyBound = Math.abs(sin) > EPS
        ? (sin >= 0 ? (H - MARGIN - cy) : (MARGIN - cy)) / sin
        : Infinity;
      const t = Math.min(dxBound, dyBound);
      if (!isFinite(t)) continue;
      const tx = cx + cos * t;
      const ty = cy + sin * t;

      // Draw arrow triangle
      const SIZE = 8;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(SIZE,       0);
      ctx.lineTo(-SIZE * 0.6,  SIZE * 0.6);
      ctx.lineTo(-SIZE * 0.6, -SIZE * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }
}
// Start the game when the DOM is ready
window.addEventListener('DOMContentLoaded', () => new Game());
