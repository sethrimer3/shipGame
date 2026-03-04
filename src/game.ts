import { InputManager }  from './input';
import { Camera }        from './camera';
import { Player, ModuleInfo, tierToRoman, RECYCLE_REFUND_RATE }        from './player';
import { World }         from './world';
import { Toolbar }       from './toolbar';
import { CraftingSystem } from './crafting';
import { HUD }           from './hud';
import { Projectile }    from './projectile';
import { Particle, updateParticle, drawParticle, FloatingText, updateFloatingText, drawFloatingText } from './particle';
import { StarfieldRenderer } from './starfield';
import { SunRenderer }       from './sun-renderer';
import { PostProcessRenderer } from './post-process';
import { GraphicsConfig, GraphicsQuality, QUALITY_PRESETS } from './graphics-settings';
import { len, Material, MATERIAL_PROPS, TOOLBAR_ITEM_DEFS, Vec2, ShipModuleType, ShipModules, CRAFTING_RECIPES, ResourceStack, UPGRADE_TIER_GEMS, MODULE_UPGRADE_BASE_COST, EMPTY_SHIP_MODULES, SHIP_MODULE_FAMILY_BY_TYPE, GEM_MATERIALS, GemBonusId, GEM_BONUS_DEFS, GEM_BONUS_IRON_PER_LEVEL, GEM_BONUS_GOLD_PER_LEVEL, GEM_BONUS_CRYSTAL_PER_LEVEL, GEM_BONUS_HP_PER_LEVEL, GEM_BONUS_SHIELD_PER_LEVEL, GEM_BONUS_WEAPON_PER_LEVEL, GEM_BONUS_MINING_PER_LEVEL, GEM_BONUS_XP_PER_LEVEL, GEM_BONUS_HP_REGEN_PER_LEVEL, GEM_BONUS_ENGINE_SPEED_PER_LEVEL, GEM_BONUS_CRIT_CHANCE_PER_LEVEL, GEM_BONUS_FIRE_RATE_PER_LEVEL } from './types';

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

interface ModuleEditorConfig {
  type: ShipModuleType;
  name: string;
  desc: string;
  color: string;
}

const MODULE_EDITOR_CONFIG: ModuleEditorConfig[] = [
  { type: 'hull',             name: 'Hull',             desc: 'Main structure. Raises maximum HP.', color: '#2ecc71' },
  { type: 'engine',           name: 'Engine',           desc: 'Boosts acceleration and top speed.', color: '#7fd9ff' },
  { type: 'shield',           name: 'Shield',           desc: 'Increases max shield and regen.', color: '#9f8cff' },
  { type: 'coolant',          name: 'Coolant',          desc: 'Reduces overheat drain and speeds recovery.', color: '#7fffd2' },
  { type: 'basic_cannon',     name: 'Basic Cannon',     desc: 'Weapon module: +damage/+fire rate.', color: '#ff4444' },
  { type: 'laser_beam',       name: 'Laser Beam',       desc: 'Weapon module: +damage/+fire rate.', color: '#ff4444' },
  { type: 'void_lance',       name: 'Void Lance',       desc: 'Weapon module: +damage/+fire rate.', color: '#ff4444' },
  { type: 'resonance_beam',   name: 'Resonance Beam',   desc: 'Weapon module: +damage/+fire rate.', color: '#ff4444' },
  { type: 'spread_cannon',    name: 'Spread Cannon',    desc: 'Weapon module: +damage/+fire rate.', color: '#ff4444' },
  { type: 'missile_launcher', name: 'Missile Launcher', desc: 'Weapon module: +damage/+fire rate.', color: '#ff4444' },
  { type: 'cluster_bomb',     name: 'Cluster Bomb',     desc: 'Weapon module: +damage/+fire rate.', color: '#ff4444' },
  { type: 'mining_laser',     name: 'Mining Laser',     desc: 'Adds a front-facing mining laser beam.', color: '#7ed6f3' },
  { type: 'shield_gen',       name: 'Shield Generator', desc: 'Shield-family module.', color: '#9f8cff' },
  { type: 'heavy_armor',      name: 'Heavy Armor',      desc: 'Hull-family module.', color: '#2ecc71' },
  { type: 'dark_engine',      name: 'Dark Engine',      desc: 'Engine-family module.', color: '#7fd9ff' },
  { type: 'placer_laser',     name: 'Placer Laser',     desc: 'Coolant-family module.', color: '#7fffd2' },
];

const EDITOR_GRID_SIZE = 11;
const EDITOR_CENTER = Math.floor(EDITOR_GRID_SIZE / 2);

type EditorSlot = { row: number; col: number };

const toEditorSlot = (shipCol: number, shipRow: number): EditorSlot => ({
  row: EDITOR_CENTER - shipCol,
  col: EDITOR_CENTER + shipRow,
});

// Keep this aligned with Player._buildShipBlocks so the editor layout matches the rendered ship silhouette.
const HULL_EDITOR_SLOTS: EditorSlot[] = [
  [0, 0], [1, 0], [0, -1], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, -1], [-1, 1],
  [2, 0], [-2, 0], [0, -2], [0, 2], [2, -1], [2, 1], [-2, -1], [-2, 1],
  [1, -2], [1, 2], [-1, -2], [-1, 2], [3, 0], [-3, 0],
].map(([col, row]) => toEditorSlot(col, row));

const ENGINE_EDITOR_SLOTS: EditorSlot[] = [
  [-3, -1], [-3, 1], [-4, 0], [-4, -1], [-4, 1],
].map(([col, row]) => toEditorSlot(col, row));

const SHIELD_EDITOR_SLOTS: EditorSlot[] = [
  [0, -3], [0, 3], [1, -3], [1, 3], [-1, -3], [-1, 3],
].map(([col, row]) => toEditorSlot(col, row));

const COOLANT_EDITOR_SLOTS: EditorSlot[] = [
  [-2, -2], [-2, 2], [-3, -2], [-3, 2],
].map(([col, row]) => toEditorSlot(col, row));

const WEAPON_EDITOR_SLOTS: EditorSlot[] = [
  [2, -3], [2, 3], [3, -1], [3, 1],
].map(([col, row]) => toEditorSlot(col, row));

const MINING_LASER_EDITOR_SLOTS: EditorSlot[] = [
  [4, 0], [4, -1], [4, 1], [5, 0],
].map(([col, row]) => toEditorSlot(col, row));

const EDITOR_SLOT_ORDER: EditorSlot[] = [
  ...HULL_EDITOR_SLOTS,
  ...ENGINE_EDITOR_SLOTS,
  ...SHIELD_EDITOR_SLOTS,
  ...COOLANT_EDITOR_SLOTS,
  ...WEAPON_EDITOR_SLOTS,
  ...MINING_LASER_EDITOR_SLOTS,
];


const MODULE_TOOLTIP_DESCS: Record<ShipModuleType, string> = {
  hull: 'Structure: raises max HP by 34.',
  engine: 'Boosts acceleration (+14%) and top speed (+12%).',
  shield: 'Increases max shield (+20) and regen (+1.8/s).',
  coolant: 'Reduces overheat drain; speeds heat recovery (+30%).',
  weapon: 'Boosts weapon damage (+8%) and fire rate (+6%).',
  miningLaser: 'Adds a forward-facing mining laser beam.',
  basic_cannon: 'Weapon-family module from Basic Cannon.',
  laser_beam: 'Weapon-family module from Laser Beam.',
  shield_gen: 'Shield-family module from Shield Generator.',
  heavy_armor: 'Hull-family module from Heavy Armor.',
  dark_engine: 'Engine-family module from Dark Engine.',
  mining_laser: 'Mining-laser-family module from Mining Laser.',
  void_lance: 'Weapon-family module from Void Lance.',
  resonance_beam: 'Weapon-family module from Resonance Beam.',
  placer_laser: 'Coolant-family module from Placer Laser.',
  spread_cannon: 'Weapon-family module from Spread Cannon.',
  missile_launcher: 'Weapon-family module from Missile Launcher.',
  cluster_bomb: 'Weapon-family module from Cluster Bomb.',
};
const MODULE_CORE_DESC = 'Ship core. Nanobots: heals nearest modules at 10 HP/s outward.';
const TOOLTIP_CURSOR_OFFSET = 14; // pixels from cursor to tooltip edge
const MIN_TOOLTIP_WIDTH     = 130; // minimum tooltip box width in pixels
/** Seconds within which a second U press counts as a double-press for module upgrade. */
const UPGRADE_KEY_DOUBLE_PRESS_WINDOW = 0.8;

const BUILD_NUMBER = 54;

const REBIRTH_FLASH_DURATION_SEC = 0.28;
const REBIRTH_BUILD_DURATION_SEC = 1.4;
const REBIRTH_TOTAL_DURATION_SEC = REBIRTH_FLASH_DURATION_SEC + REBIRTH_BUILD_DURATION_SEC;

const STARTER_MODULE_LAYOUT: Array<{ type: ShipModuleType; col: number; row: number }> = [
  { type: 'miningLaser', col:  2, row:  0 },
  { type: 'hull',        col:  1, row: -1 },
  { type: 'hull',        col:  1, row:  0 },
  { type: 'hull',        col:  1, row:  1 },
  { type: 'hull',        col:  0, row: -1 },
  { type: 'hull',        col:  0, row:  0 },
  { type: 'hull',        col:  0, row:  1 },
  { type: 'hull',        col: -1, row: -1 },
  { type: 'hull',        col: -1, row:  0 },
  { type: 'hull',        col: -1, row:  1 },
  { type: 'engine',      col: -2, row: -1 },
  { type: 'engine',      col: -2, row:  1 },
];

const CORE_ONLY_LAYOUT: Array<{ type: ShipModuleType; col: number; row: number }> = [
  { type: 'hull', col: 0, row: 0 },
];

const STARTING_MODULE_RESOURCE_COUNTS: Record<ShipModuleType, number> = {
  hull: 11,
  engine: 2,
  shield: 0,
  coolant: 0,
  weapon: 0,
  miningLaser: 1,
  basic_cannon: 0,
  laser_beam: 0,
  shield_gen: 0,
  heavy_armor: 0,
  dark_engine: 0,
  mining_laser: 0,
  void_lance: 0,
  resonance_beam: 0,
  placer_laser: 0,
  spread_cannon: 0,
  missile_launcher: 0,
  cluster_bomb: 0,
};

/**
 * Material costs to fully rebuild starter module types (those without a crafting recipe).
 * Used by the repair-materials HUD display.
 */
const MODULE_REBUILD_COSTS: Partial<Record<ShipModuleType, ResourceStack[]>> = {
  hull:        [{ material: Material.Iron, quantity: 2 }],
  engine:      [{ material: Material.Iron, quantity: 3 }],
  shield:      [{ material: Material.Iron, quantity: 2 }, { material: Material.Crystal, quantity: 1 }],
  coolant:     [{ material: Material.Iron, quantity: 2 }],
  weapon:      [{ material: Material.Iron, quantity: 3 }],
  miningLaser: [{ material: Material.Iron, quantity: 2 }, { material: Material.Crystal, quantity: 1 }],
};

// Covers two full rebuilds of the starter layout (9 hull, 2 engine, 1 miningLaser).
const BASE_STARTING_IRON = 52;
const BASE_STARTING_CRYSTAL = 2;

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
  private readonly postProcess: PostProcessRenderer;

  private _graphicsConfig: GraphicsConfig = QUALITY_PRESETS['high'];

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
  private _shipEditorOpen = false;
  private _settingsKeyHeld = false;
  private _shipEditorKeyHeld = false;
  /** When true (default), WASD moves relative to ship facing. When false, WASD = world axes. */
  private advancedMovement = false;
  /** Cooldown for the placer laser. */
  private _placerCooldown = 0;
  private _lastPlacedWorldPos: Vec2 | null = null;
  private readonly _placementBeams: PlacementBeamEffect[] = [];
  private readonly _launchEffects: BlockLaunchEffect[] = [];

  /** Explicit per-cell layout being edited.  Each entry is in editor grid coords (row, col 0-10). */
  private _pendingModuleSlots: Array<{ row: number; col: number; type: ShipModuleType }> | null = null;
  private _savedModuleSlots: Array<{ row: number; col: number; type: ShipModuleType }> = [];
  private _autoBuildBlueprintSlots: Array<{ row: number; col: number; type: ShipModuleType }> = [];
  private _draggingModuleType: ShipModuleType | null = null;
  private _draggingFromCell: { row: number; col: number } | null = null;
  private _isCraftingPanelOpenFromEditor = false;
  private _isSaveConfirmOpen = false;
  private _isShipStatsOpen = false;

  /** Currently hovered palette module type (for U-key upgrades). */
  private _hoveredPaletteType: ShipModuleType | null = null;
  /** Upgrade key double-press tracking. */
  private _upgradeKeyHeld = false;
  private _upgradeKeyCount = 0;
  private _upgradeKeyTimer = 0;

  /** Zone transition banner state */
  private _lastZoneName    = '';
  private _zoneBannerTimer = 0;
  private _zoneBannerText  = '';
  private _zoneBannerColor = '#fff';
  private _rebirthTimerSec = 0;
  private _isRebirthAnimating = false;
  private _rebirthModuleResources: Record<ShipModuleType, number> = { ...STARTING_MODULE_RESOURCE_COUNTS };

  // ── Incremental loop / gem shop ─────────────────────────────────────────────
  /** Number of completed loops (increments on each rebirth). */
  private _loopCount = 0;
  /** Purchased gem bonus levels (0 = not bought). */
  private _gemBonusLevels: Partial<Record<GemBonusId, number>> = {};
  /** Whether the gem shop overlay is visible on the death screen. */
  private _gemShopOpen = false;
  /** Buy button rects rebuilt each render frame; used for hit-testing in update. */
  private _gemShopBuyRects: Array<{ id: GemBonusId; x: number; y: number; w: number; h: number }> = [];
  /** Close button rect for the gem shop overlay. */
  private _gemShopCloseRect: { x: number; y: number; w: number; h: number } | null = null;
  /** Gem Shop button rect on the death screen. */
  private _deathGemShopRect: { x: number; y: number; w: number; h: number } | null = null;
  /** Rebirth button rect on the death screen. */
  private _deathRebirthRect: { x: number; y: number; w: number; h: number } | null = null;

  // ── Kill combo system ────────────────────────────────────────────────────────
  /** Number of kills since the last combo reset. */
  private _killComboCount = 0;
  /** Seconds until the combo resets if no new kill occurs. */
  private _killComboTimer = 0;
  /** Kill count from last frame; used to detect new kills each update. */
  private _killComboPrevKills = 0;
  /** Maximum seconds between kills to continue a combo streak. */
  private static readonly _COMBO_WINDOW_SEC = 4.0;

  // ── Emergency shield boost (E key) ──────────────────────────────────────────
  private _shieldBoostKeyHeld = false;
  /** Overheat units consumed per shield boost activation. */
  private static readonly _SHIELD_BOOST_OVERHEAT_COST = 35;
  /** Shield points restored per boost activation. */
  private static readonly _SHIELD_BOOST_RESTORE_AMT   = 40;

  // ── Graviton Pulse (G key) ────────────────────────────────────────────────
  private _gravitonKeyHeld = false;
  /** Overheat units consumed per Graviton Pulse activation. */
  private static readonly _GRAVITON_OVERHEAT_COST  = 45;
  /** Radius (world units) of the Graviton Pulse shockwave. */
  private static readonly _GRAVITON_RADIUS_WORLD   = 320;
  /** Outward push impulse (world units / s) at the epicentre. */
  private static readonly _GRAVITON_PUSH_FORCE     = 18000;
  /** Engine exhaust particle colors (outer, mid, hot-core). */
  private static readonly _EXHAUST_COLOR_OUTER = '#44aaff';
  private static readonly _EXHAUST_COLOR_MID   = '#88ddff';
  private static readonly _EXHAUST_COLOR_HOT   = '#cceeff';
  private _shockwaveRings: Array<{ pos: Vec2; currentRadius: number; maxRadius: number; life: number; maxLife: number; color?: string }> = [];
  /** Level-up expanding golden rings (screen-space). */
  private _levelUpRings: Array<{ life: number; maxLife: number }> = [];

  // ── Personal best stats (persisted via localStorage) ─────────────────────────
  private _pbKills    = 0;
  private _pbLevel    = 1;
  private _pbTimeSec  = 0;
  private _pbMaxDist  = 0;
  private static readonly _PB_STORAGE_KEY = 'shipGame_personalBest';
  /** Tracks whether the player was alive last frame (for death-transition detection). */
  private _wasAlive   = true;

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
    // Set the initial ship structure and spawn in the station core.
    this.player.setModuleLayout(STARTER_MODULE_LAYOUT);
    // Populate the module palette with the starter ship's modules
    this.player.initStarterPalette();
    this.world   = new World();
    this.player.pos = this.world.getPlayerSpawnPosition();
    this.toolbar = new Toolbar();
    this.hud     = new HUD();
    this.starfield   = new StarfieldRenderer();
    this.sunRenderer = new SunRenderer();
    this.postProcess = new PostProcessRenderer();

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

    // Create palette context menu element
    if (!document.getElementById('palette-context-menu')) {
      const menu = document.createElement('div');
      menu.id        = 'palette-context-menu';
      menu.className = 'palette-context-menu hidden';
      menu.innerHTML = `
        <div class="pcm-title" id="pcm-title"></div>
        <button class="pcm-btn" id="pcm-recycle-btn">♻ Recycle (×1)</button>
        <button class="pcm-btn pcm-upgrade-btn" id="pcm-upgrade-btn"></button>
      `;
      document.getElementById('ui-overlay')?.appendChild(menu);
      // Close on click outside
      document.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('#palette-context-menu')) {
          this._hidePaletteContextMenu();
        }
      });
    }

    // ── Load personal-best stats from localStorage ───────────────
    try {
      const pbRaw = localStorage.getItem(Game._PB_STORAGE_KEY);
      if (pbRaw) {
        const pb = JSON.parse(pbRaw) as { kills?: number; level?: number; timeSec?: number; maxDist?: number };
        this._pbKills   = pb.kills   ?? 0;
        this._pbLevel   = pb.level   ?? 1;
        this._pbTimeSec = pb.timeSec ?? 0;
        this._pbMaxDist = pb.maxDist ?? 0;
      }
    } catch { /* ignore corrupt localStorage */ }

    // Initial toolbar render
    this.toolbar.renderDOM();

    // Give player a starting mining laser in slot 0
    const miningLaser = TOOLBAR_ITEM_DEFS['mining_laser'];
    this.toolbar.addItem(miningLaser);
    this.player.equipItem(0, miningLaser);
    this._addStartingResourceBonuses();
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

    // Wire up graphics quality buttons
    this._applyGraphicsQuality(this._graphicsConfig.quality);
    for (const q of ['low', 'medium', 'high'] as GraphicsQuality[]) {
      const btn = document.getElementById(`setting-quality-${q}`);
      if (btn) {
        btn.addEventListener('click', () => this._applyGraphicsQuality(q));
      }
    }

    this._initShipEditor();
    this._autoBuildBlueprintSlots = this._slotsFromPlayer();

    // ── Mobile setup ───────────────────────────────────────────────────────
    if (this.input.isMobile) {
      document.body.classList.add('is-mobile');
      document.getElementById('mobile-controls')?.classList.remove('hidden');

      // Request landscape orientation when supported
      try {
        const orientation = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
        if (orientation?.lock) {
          orientation.lock('landscape').catch(() => { /* silently ignore if not allowed */ });
        }
      } catch (_) { /* ignore */ }

      // Mobile ship-builder button (top-left)
      document.getElementById('mobile-ship-builder-btn')?.addEventListener('click', () => {
        if (this._shipEditorOpen) {
          this._requestCloseShipEditor();
        } else {
          this._shipEditorOpen = true;
          this._setShipEditorVisible(true);
        }
      });

      // Mobile settings button (top-right)
      document.getElementById('mobile-settings-btn')?.addEventListener('click', () => {
        this._settingsOpen = !this._settingsOpen;
        const panel = document.getElementById('settings-panel');
        if (panel) {
          if (this._settingsOpen) panel.classList.remove('hidden');
          else panel.classList.add('hidden');
        }
      });
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  private resize(): void {
    this.canvas.width  = this.canvas.clientWidth  || window.innerWidth;
    this.canvas.height = this.canvas.clientHeight || window.innerHeight;
    this.camera.resize(this.canvas.width, this.canvas.height);
    this._updateUiPanelScaling();
  }

  private _applyGraphicsQuality(quality: GraphicsQuality): void {
    this._graphicsConfig = QUALITY_PRESETS[quality];
    for (const q of ['low', 'medium', 'high'] as GraphicsQuality[]) {
      const btn = document.getElementById(`setting-quality-${q}`);
      if (btn) {
        if (q === quality) btn.classList.add('quality-btn-active');
        else btn.classList.remove('quality-btn-active');
      }
    }
  }

  private _updateUiPanelScaling(): void {
    const setPanelScale = (panelId: string, marginPx: number): void => {
      const panel = document.getElementById(panelId) as HTMLDivElement | null;
      if (!panel) return;
      const priorScale = panel.style.getPropertyValue('--panel-scale');
      panel.style.setProperty('--panel-scale', '1');
      const rect = panel.getBoundingClientRect();
      const maxWidth = Math.max(120, window.innerWidth - marginPx * 2);
      const maxHeight = Math.max(120, window.innerHeight - marginPx * 2);
      const fitScale = Math.min(maxWidth / Math.max(1, rect.width), maxHeight / Math.max(1, rect.height), 1);
      const nextScale = Number.isFinite(fitScale) ? fitScale : 1;
      const roundedScale = Math.max(0.55, Math.min(1, Math.round(nextScale * 1000) / 1000));
      if (priorScale !== String(roundedScale)) {
        panel.style.setProperty('--panel-scale', String(roundedScale));
      }
    };

    setPanelScale('crafting-panel', 24);
    setPanelScale('ship-editor-panel', 24);
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
      this.camera.updateShake(dt); // let shake decay on the death screen

      // Gem shop / death-screen click handling
      const clicked = this.input.consumeClick();
      const mx = this.input.mousePos.x;
      const my = this.input.mousePos.y;
      const inRect = (r: { x: number; y: number; w: number; h: number }): boolean =>
        mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h;

      if (this._gemShopOpen) {
        if (clicked) {
          if (this._gemShopCloseRect && inRect(this._gemShopCloseRect)) {
            this._gemShopOpen = false;
          } else {
            for (const btn of this._gemShopBuyRects) {
              if (inRect(btn)) { this._tryBuyGemBonus(btn.id); break; }
            }
          }
        }
        if (this.input.isDown('r')) this._resetRunAfterDeath();
        return;
      }

      // Death screen: open gem shop button
      if (clicked && this._deathGemShopRect && inRect(this._deathGemShopRect)) {
        this._gemShopOpen = true;
        return;
      }

      // Death screen: rebirth button click
      if (clicked && this._deathRebirthRect && inRect(this._deathRebirthRect)) {
        this._resetRunAfterDeath();
        return;
      }

      if (this.input.isDown('r')) this._resetRunAfterDeath();
      return;
    }

    if (this._isRebirthAnimating) {
      this._updateRebirthAnimation(dt);
      this.camera.position = { x: this.player.pos.x, y: this.player.pos.y };
      this.camera.updateShake(dt);
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

    if (this.input.isDown('c') && !this._shipEditorKeyHeld) {
      this._shipEditorKeyHeld = true;
      if (this._shipEditorOpen) {
        if (this._isSaveConfirmOpen) this._saveShipEditorAndClose();
        else this._requestCloseShipEditor();
      } else {
        this._shipEditorOpen = true;
        this._setShipEditorVisible(true);
      }
    }
    if (this.input.isDown('x') && this._isSaveConfirmOpen) {
      this._discardShipEditorAndClose();
    }
    if (!this.input.isDown('c')) this._shipEditorKeyHeld = false;

    // ── U-key: upgrade hovered palette module (double press) ────────
    if (this._upgradeKeyTimer > 0) this._upgradeKeyTimer -= dt;
    else this._upgradeKeyCount = 0;

    if (this._shipEditorOpen && this.input.isDown('u') && !this._upgradeKeyHeld) {
      this._upgradeKeyHeld = true;
      this._upgradeKeyCount++;
      this._upgradeKeyTimer = UPGRADE_KEY_DOUBLE_PRESS_WINDOW;
      if (this._upgradeKeyCount >= 2 && this._hoveredPaletteType) {
        this._executeUpgradeForType(this._hoveredPaletteType);
        this._upgradeKeyCount = 0;
      }
    }
    if (!this.input.isDown('u')) this._upgradeKeyHeld = false;

    if (this._settingsOpen || this._shipEditorOpen || this.crafting.isOpen()) return;

    // ── Emergency shield boost (E key) ─────────────────────────────
    if (this.input.isDown('e') && !this._shieldBoostKeyHeld) {
      this._shieldBoostKeyHeld = true;
      const healed = this.player.tryEmergencyShieldBoost(
        Game._SHIELD_BOOST_RESTORE_AMT,
        Game._SHIELD_BOOST_OVERHEAT_COST,
      );
      if (healed > 0) {
        this.hud.showMessage(`⚡ Emergency Shield +${healed}!`, 1.5);
        this.camera.shake(1.2);
      } else if (this.player.shield >= this.player.maxShield) {
        this.hud.showMessage('Shield already full', 1);
      } else {
        this.hud.showMessage('Not enough energy — charge overheat first', 1.5);
      }
    }
    if (!this.input.isDown('e')) this._shieldBoostKeyHeld = false;

    // ── Graviton Pulse (G key) ──────────────────────────────────────
    if (this.input.isDown('g') && !this._gravitonKeyHeld) {
      this._gravitonKeyHeld = true;
      if (this.player.gravitonPulseCooldownSec > 0) {
        const remainingCooldownSec = Math.ceil(this.player.gravitonPulseCooldownSec);
        this.hud.showMessage(`Graviton Pulse — cooldown ${remainingCooldownSec}s`, 1.2);
      } else {
        const fired = this.player.tryGravitonPulse(Game._GRAVITON_OVERHEAT_COST);
        if (fired) {
          this.world.applyGravitonPulse(
            this.player.pos,
            Game._GRAVITON_RADIUS_WORLD,
            Game._GRAVITON_PUSH_FORCE,
          );
          this._shockwaveRings.push({
            pos:           { x: this.player.pos.x, y: this.player.pos.y },
            currentRadius: 0,
            maxRadius:     Game._GRAVITON_RADIUS_WORLD,
            life:          0.7,
            maxLife:       0.7,
          });
          this.camera.shake(2.5);
          this.hud.showMessage('⚛ Graviton Pulse!', 1.5);
        } else {
          this.hud.showMessage('Not enough energy — charge overheat first', 1.5);
        }
      }
    }
    if (!this.input.isDown('g')) this._gravitonKeyHeld = false;

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


    // ── Player ─────────────────────────────────────────────────────
    this.player.update(dt, this.toolbar.selected, this.advancedMovement, this.particles, this.projectiles);

    // ── Engine exhaust particle stream ────────────────────────────────────
    if (this.player.alive && (this.input.isDown('w') || this.input.isDown('s') || this.input.isDown('a') || this.input.isDown('d'))) {
      const exhaustAngle    = this.player.angle + Math.PI;
      const exhaustDistWorld = 22;
      for (let i = 0; i < 3; i++) {
        const spread   = (Math.random() - 0.5) * 8;
        const perpX    = Math.cos(exhaustAngle + Math.PI * 0.5) * spread;
        const perpY    = Math.sin(exhaustAngle + Math.PI * 0.5) * spread;
        const ex       = this.player.pos.x + Math.cos(exhaustAngle) * exhaustDistWorld + perpX;
        const ey       = this.player.pos.y + Math.sin(exhaustAngle) * exhaustDistWorld + perpY;
        const speed    = 55 + Math.random() * 90;
        const velAngle = exhaustAngle + (Math.random() - 0.5) * 0.55;
        const life     = 0.22 + Math.random() * 0.32;
        const roll     = Math.random();
        const exhaustColor = roll < 0.35 ? Game._EXHAUST_COLOR_OUTER : roll < 0.68 ? Game._EXHAUST_COLOR_MID : Game._EXHAUST_COLOR_HOT;
        this.particles.push({
          pos:      { x: ex, y: ey },
          vel:      { x: Math.cos(velAngle) * speed, y: Math.sin(velAngle) * speed },
          color:    exhaustColor,
          radius:   0.8 + Math.random() * 1.4,
          lifetime: life,
          maxLife:  life,
          alpha:    1,
          glow:     true,
          trail:    true,
          prevPos:  { x: ex, y: ey },
        });
      }
    }

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

    // ── Zone transition detection ───────────────────────────────────
    const ZONES = [
      { dist: 0,     name: 'Spawn Zone',  color: '#2ecc71' },
      { dist: 800,   name: 'Near Space',  color: '#3498db' },
      { dist: 2000,  name: 'Mid Space',   color: '#9b59b6' },
      { dist: 5000,  name: 'Deep Space',  color: '#e67e22' },
      { dist: 10000, name: 'Void Fringe', color: '#e74c3c' },
      { dist: 16000, name: 'Dark Void',   color: '#6c3483' },
    ];
    let currentZone = ZONES[0];
    for (let i = ZONES.length - 1; i >= 0; i--) {
      if (distFromOrigin >= ZONES[i].dist) { currentZone = ZONES[i]; break; }
    }
    if (this._lastZoneName !== '' && currentZone.name !== this._lastZoneName) {
      this._zoneBannerTimer = 3.5;
      this._zoneBannerText  = currentZone.name.toUpperCase();
      this._zoneBannerColor = currentZone.color;
    }
    this._lastZoneName = currentZone.name;
    if (this._zoneBannerTimer > 0) this._zoneBannerTimer -= dt;

    // ── World / enemies / collisions ────────────────────────────────
    this.world.update(dt, this.player, this.projectiles, this.particles, this.floatingTexts, this.camera.position, this._graphicsConfig);
    this._runAutoCrafting();

    // ── Kill shockwave rings ────────────────────────────────────────
    for (const ke of this.world.killEvents) {
      this._shockwaveRings.push({
        pos:           { x: ke.pos.x, y: ke.pos.y },
        currentRadius: 0,
        maxRadius:     80,
        life:          0.55,
        maxLife:       0.55,
        color:         ke.color,
      });
    }

    // ── Personal-best update (on death transition) ──────────────────
    if (this._wasAlive && !this.player.alive) {
      this._savePersonalBest();
    }
    this._wasAlive = this.player.alive;

    // ── Kill combo tracking ─────────────────────────────────────────
    const newKills = this.world.kills - this._killComboPrevKills;
    if (newKills > 0) {
      this._killComboPrevKills = this.world.kills;
      this._killComboCount += newKills;
      this._killComboTimer = Game._COMBO_WINDOW_SEC;
      // Award bonus XP and show combo text once per frame (avoids per-kill allocations)
      if (this._killComboCount >= 2) {
        const bonusXp = this._killComboCount * 5;
        this.player.gainXP(bonusXp);
        const comboLabel = `${this._killComboCount}× COMBO! +${bonusXp} XP`;
        this.floatingTexts.push({
          pos:      { x: this.player.pos.x, y: this.player.pos.y - 30 },
          vel:      { x: 0, y: -28 },
          text:     comboLabel,
          color:    this._killComboCount >= 5 ? '#ff9900' : '#ffdd44',
          lifetime: 1.6,
          maxLife:  1.6,
        });
        if (this._killComboCount >= 5) this.camera.shake(2.5);
      }
    } else if (this._killComboTimer > 0) {
      this._killComboTimer -= dt;
      if (this._killComboTimer <= 0) this._killComboCount = 0;
    }

    const stationBeamShotCount = this.world.consumeStationBeamShotsThisFrame();
    if (stationBeamShotCount > 0) {
      this.camera.shake(Math.min(stationBeamShotCount * 1.2, 3.2));
    }

    // ── Level-up notification ────────────────────────────────────
    if (this.player.leveledUp) {
      this.player.leveledUp = false;
      this.hud.showMessage(`⬆ Level ${this.player.level}! HP +10  Shield +5`, 3);
      // Spawn three cascading level-up rings
      for (let i = 0; i < 3; i++) {
        this._levelUpRings.push({ life: 0.85 + i * 0.12, maxLife: 0.85 + i * 0.12 });
      }
      this.camera.shake(1.5);
    }

    // ── Level-up rings update ────────────────────────────────────
    {
      let lr = 0;
      for (let i = 0; i < this._levelUpRings.length; i++) {
        this._levelUpRings[i].life -= dt;
        if (this._levelUpRings[i].life > 0) this._levelUpRings[lr++] = this._levelUpRings[i];
      }
      this._levelUpRings.length = lr;
    }

    // ── Camera shake on damage ───────────────────────────────────
    if (this.player.recentDamage > 0) {
      this.camera.shake(Math.min(this.player.recentDamage * 0.4, 12));
      this.player.recentDamage = 0;
    }
    this.camera.updateShake(dt);

    // ── Projectiles (in-place compaction avoids per-frame array allocation) ──
    for (const p of this.projectiles) p.update(dt);
    let pj = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      if (this.projectiles[i].alive) this.projectiles[pj++] = this.projectiles[i];
    }
    this.projectiles.length = pj;

    // ── Particles (in-place compaction) ────────────────────────────
    for (const p of this.particles) updateParticle(p, dt);
    let pa = 0;
    for (let i = 0; i < this.particles.length; i++) {
      if (this.particles[i].lifetime > 0) this.particles[pa++] = this.particles[i];
    }
    this.particles.length = pa;

    // ── Floating texts (in-place compaction) ────────────────────────
    for (const f of this.floatingTexts) updateFloatingText(f, dt);
    let ft = 0;
    for (let i = 0; i < this.floatingTexts.length; i++) {
      if (this.floatingTexts[i].lifetime > 0) this.floatingTexts[ft++] = this.floatingTexts[i];
    }
    this.floatingTexts.length = ft;

    // ── Shockwave rings (Graviton Pulse visual) ─────────────────────
    let sr = 0;
    for (let i = 0; i < this._shockwaveRings.length; i++) {
      const ring = this._shockwaveRings[i];
      ring.life -= dt;
      ring.currentRadius = ring.maxRadius * (1 - ring.life / ring.maxLife);
      if (ring.life > 0) this._shockwaveRings[sr++] = ring;
    }
    this._shockwaveRings.length = sr;

    // ── Camera ─────────────────────────────────────────────────────
    this.camera.follow(this.player.pos, dt);

    // ── HUD ────────────────────────────────────────────────────────
    this.hud.update(this.player, dt, this.world.kills);
    this.crafting.refresh();
  }


  private _getCurrentShipSlots(): Array<{ row: number; col: number; type: ShipModuleType }> {
    return this._slotsFromPlayer();
  }

  private _slotsEqual(
    a: Array<{ row: number; col: number; type: ShipModuleType }>,
    b: Array<{ row: number; col: number; type: ShipModuleType }>,
  ): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort((left, right) => (left.row - right.row) || (left.col - right.col) || left.type.localeCompare(right.type));
    const sortedB = [...b].sort((left, right) => (left.row - right.row) || (left.col - right.col) || left.type.localeCompare(right.type));
    for (let i = 0; i < sortedA.length; i++) {
      const left = sortedA[i];
      const right = sortedB[i];
      if (left.row !== right.row || left.col !== right.col || left.type !== right.type) return false;
    }
    return true;
  }

  private _isShipEditorDirty(): boolean {
    if (!this._pendingModuleSlots) return false;
    return !this._slotsEqual(this._pendingModuleSlots, this._savedModuleSlots);
  }

  private _applyPendingShipLayout(): void {
    if (!this._pendingModuleSlots) return;
    const shipSlots = this._pendingModuleSlots.map(s => ({
      type: s.type,
      col: EDITOR_CENTER - s.row,
      row: s.col - EDITOR_CENTER,
    }));
    this.player.setModuleLayout(shipSlots);
    this._savedModuleSlots = this._getCurrentShipSlots();
    this._autoBuildBlueprintSlots = [...this._savedModuleSlots];
    this._pendingModuleSlots = [...this._savedModuleSlots];
  }

  private _requestCloseShipEditor(): void {
    if (this._isShipEditorDirty()) {
      this._setSaveConfirmVisible(true);
      return;
    }
    this._shipEditorOpen = false;
    this._setShipEditorVisible(false);
  }

  private _saveShipEditorAndClose(): void {
    this._applyPendingShipLayout();
    this.hud.showMessage('Ship layout saved');
    this._shipEditorOpen = false;
    this._setShipEditorVisible(false);
  }

  private _discardShipEditorAndClose(): void {
    this._pendingModuleSlots = [...this._savedModuleSlots];
    this._shipEditorOpen = false;
    this._setShipEditorVisible(false);
  }

  private _setSaveConfirmVisible(visible: boolean): void {
    this._isSaveConfirmOpen = visible;
    const confirm = document.getElementById('ship-editor-save-confirm');
    if (!confirm) return;
    if (visible) confirm.classList.remove('hidden');
    else confirm.classList.add('hidden');
  }

  private _setShipStatsVisible(visible: boolean): void {
    this._isShipStatsOpen = visible;
    const overlay = document.getElementById('ship-editor-stats-overlay');
    const toggle = document.getElementById('ship-stats-toggle');
    if (overlay) {
      if (visible) overlay.classList.remove('hidden');
      else overlay.classList.add('hidden');
    }
    if (toggle) {
      toggle.textContent = visible ? 'Ship Stats ▲' : 'Ship Stats ▼';
    }
    this._updateUiPanelScaling();
  }

  private _setCraftingPanelVisibleFromEditor(visible: boolean): void {
    this._isCraftingPanelOpenFromEditor = visible;
    if (visible) {
      this.crafting.show();
      document.body.classList.add('ship-editor-layout-open');
    } else {
      this.crafting.hide();
      document.body.classList.remove('ship-editor-layout-open');
    }
    this._updateUiPanelScaling();
  }


  private _initShipEditor(): void {
    const closeCraftingBtn = document.getElementById('close-crafting');
    if (closeCraftingBtn) {
      closeCraftingBtn.addEventListener('click', () => this._setCraftingPanelVisibleFromEditor(false));
    }

    const closeBtn = document.getElementById('close-ship-editor');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this._requestCloseShipEditor());
    }

    const confirmBtn = document.getElementById('confirm-ship-editor');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        this._applyPendingShipLayout();
        this._refreshShipEditorPanel();
        this.hud.showMessage('Ship layout saved');
      });
    }

    const openCraftingBtn = document.getElementById('open-crafting-from-editor');
    if (openCraftingBtn) {
      openCraftingBtn.addEventListener('click', () => this._setCraftingPanelVisibleFromEditor(!this._isCraftingPanelOpenFromEditor));
    }

    const statsToggleBtn = document.getElementById('ship-stats-toggle');
    if (statsToggleBtn) {
      statsToggleBtn.addEventListener('click', () => this._setShipStatsVisible(!this._isShipStatsOpen));
    }

    const saveBtn = document.getElementById('ship-editor-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this._saveShipEditorAndClose());
    }

    const discardBtn = document.getElementById('ship-editor-discard-btn');
    if (discardBtn) {
      discardBtn.addEventListener('click', () => this._discardShipEditorAndClose());
    }

    const paletteRoot = document.getElementById('ship-editor-palette');
    if (paletteRoot) {
      paletteRoot.innerHTML = '';
      for (const mod of MODULE_EDITOR_CONFIG) {
        const item = document.createElement('button');
        item.className = 'editor-palette-item';
        item.draggable = true;
        item.dataset.module = mod.type;
        item.style.borderColor = mod.color;
        item.innerHTML = `
          <div class="editor-palette-header">
            <span class="editor-palette-name" style="color:${mod.color}">${mod.name}</span>
            <span class="palette-count-badge" id="palette-count-${mod.type}">×0</span>
            <span class="palette-tier-badge" id="palette-tier-${mod.type}" style="display:none"></span>
          </div>
          <span class="editor-palette-desc">${mod.desc}</span>
          <span class="palette-upgrade-hint" id="palette-upgrade-hint-${mod.type}"></span>
        `;

        item.addEventListener('dragstart', (event) => {
          // Don't allow drag if no unplaced modules available
          if (!this._pendingModuleSlots) return;
          const owned = this.player.getModuleCount(mod.type);
          const placed = this._pendingModuleSlots.filter(s => s.type === mod.type).length;
          if (placed >= owned) { event.preventDefault(); return; }
          this._draggingModuleType = mod.type;
          event.dataTransfer?.setData('text/plain', mod.type);
          event.dataTransfer?.setDragImage(item, item.clientWidth / 2, item.clientHeight / 2);
        });
        item.addEventListener('dragend', () => {
          this._draggingModuleType = null;
          this._clearEditorGridHighlights();
        });
        item.addEventListener('mouseenter', () => { this._hoveredPaletteType = mod.type; });
        item.addEventListener('mouseleave', () => {
          if (this._hoveredPaletteType === mod.type) this._hoveredPaletteType = null;
        });
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this._showPaletteContextMenu(mod.type, e.clientX, e.clientY);
        });

        paletteRoot.appendChild(item);
      }
    }

    const gridRoot = document.getElementById('ship-editor-grid');
    if (gridRoot) {
      gridRoot.innerHTML = '';
      for (let row = 0; row < EDITOR_GRID_SIZE; row++) {
        for (let col = 0; col < EDITOR_GRID_SIZE; col++) {
          const cell = document.createElement('div');
          cell.className = 'editor-grid-cell';
          cell.dataset.row = String(row);
          cell.dataset.col = String(col);
          if (row === EDITOR_CENTER && col === EDITOR_CENTER) {
            cell.dataset.locked = 'true';
            cell.classList.add('core');
          }

          cell.addEventListener('dragstart', (event) => {
            const mtype = cell.dataset.moduleType as ShipModuleType | undefined;
            if (!mtype) { event.preventDefault(); return; }
            this._draggingModuleType = mtype;
            this._draggingFromCell = { row, col };
            event.dataTransfer?.setData('text/plain', mtype);
          });
          cell.addEventListener('dragend', () => {
            this._draggingModuleType = null;
            this._draggingFromCell = null;
            this._clearEditorGridHighlights();
          });

          cell.addEventListener('dragover', (event) => {
            if (cell.dataset.locked === 'true') return;
            // Allow dropping on any valid slot position (filled or empty)
            if (!Game._VALID_SLOT_KEYS.has(`${row},${col}`)) return;
            event.preventDefault();
            cell.classList.add('drop-target');
          });
          cell.addEventListener('dragleave', () => {
            cell.classList.remove('drop-target');
          });
          cell.addEventListener('drop', (event) => {
            event.preventDefault();
            cell.classList.remove('drop-target');
            if (cell.dataset.locked === 'true') return;
            const moduleType = (event.dataTransfer?.getData('text/plain') || this._draggingModuleType) as ShipModuleType | '';
            if (!moduleType) return;
            if (this._draggingFromCell) {
              // Moving from one grid cell to another – no palette count check needed
              this._swapPendingModuleCells(this._draggingFromCell.row, this._draggingFromCell.col, row, col);
            } else {
              // Dragging from palette – enforce owned count
              const slots = this._pendingModuleSlots ?? [];
              const placed = slots.filter(s => s.type === moduleType).length;
              const owned  = this.player.getModuleCount(moduleType);
              if (placed >= owned) {
                this.hud.showMessage(`No more ${moduleType} modules – craft more first.`, 2);
                return;
              }
              this._setPendingModuleAtCell(row, col, moduleType);
            }
          });

          gridRoot.appendChild(cell);
        }
      }
    }

    this._refreshShipEditorPanel();
  }

  private _setShipEditorVisible(visible: boolean): void {
    const panel = document.getElementById('ship-editor-panel');
    if (panel) {
      if (visible) panel.classList.remove('hidden');
      else panel.classList.add('hidden');
    }
    if (visible) {
      this._savedModuleSlots = this._getCurrentShipSlots();
      this._pendingModuleSlots = [...this._savedModuleSlots];
      this._refreshShipEditorPanel();
      this._setShipStatsVisible(false);
      this._setSaveConfirmVisible(false);
      this._setCraftingPanelVisibleFromEditor(false);
    } else {
      this._setSaveConfirmVisible(false);
      this._setShipStatsVisible(false);
      this._setCraftingPanelVisibleFromEditor(false);
    }
    this._updateUiPanelScaling();
  }

  /** Build a Set of "row,col" strings for quick lookup of valid slot positions. */
  private static readonly _VALID_SLOT_KEYS: Set<string> = new Set(
    EDITOR_SLOT_ORDER.map(s => `${s.row},${s.col}`),
  );

  /** Convert the player's current module layout into editor-grid slot entries. */
  private _slotsFromPlayer(): Array<{ row: number; col: number; type: ShipModuleType }> {
    return this.player.getModuleSlots().map(s => ({
      row:  EDITOR_CENTER - s.col,
      col:  s.row + EDITOR_CENTER,
      type: s.type,
    }));
  }

  /** Derive ShipModules counts from the pending slot array. */
  private _countsFromSlots(
    slots: Array<{ row: number; col: number; type: ShipModuleType }>,
  ): ShipModules {
    const out: ShipModules = { ...EMPTY_SHIP_MODULES };
    for (const s of slots) out[SHIP_MODULE_FAMILY_BY_TYPE[s.type]] += 1;
    if (out.hull < 1) out.hull = 1;
    return out;
  }

  private _refreshShipEditorPanel(): void {
    if (!this._pendingModuleSlots) this._pendingModuleSlots = this._slotsFromPlayer();

    const counts = this._countsFromSlots(this._pendingModuleSlots);

    // Update palette items: count badge, tier badge, upgrade hint, greyed-out state
    for (const mod of MODULE_EDITOR_CONFIG) {
      const owned  = this.player.getModuleCount(mod.type);
      const placed = (this._pendingModuleSlots ?? []).filter(s => s.type === mod.type).length;
      const tier   = this.player.getModuleTier(mod.type);
      const upgradeCost = this.player.getUpgradeCost(mod.type);

      const countEl = document.getElementById(`palette-count-${mod.type}`);
      if (countEl) countEl.textContent = `×${owned}`;

      const tierEl = document.getElementById(`palette-tier-${mod.type}`);
      if (tierEl) {
        if (tier > 1) {
          tierEl.textContent = `T${tierToRoman(tier)}`;
          tierEl.style.display = '';
        } else {
          tierEl.style.display = 'none';
        }
      }

      const hintEl = document.getElementById(`palette-upgrade-hint-${mod.type}`);
      if (hintEl) {
        if (upgradeCost) {
          hintEl.textContent = `Upgrade → T${tierToRoman(tier + 1)}: ${upgradeCost.count}× ${upgradeCost.gem}`;
        } else {
          hintEl.textContent = 'Max tier reached';
        }
      }

      const paletteItem = document.querySelector<HTMLElement>(`.editor-palette-item[data-module="${mod.type}"]`);
      if (paletteItem) {
        if (placed >= owned) paletteItem.classList.add('depleted');
        else paletteItem.classList.remove('depleted');
      }

      // Legacy count display (may not exist)
      const legacyCountEl = document.getElementById(`module-count-${mod.type}`);
      if (legacyCountEl) legacyCountEl.textContent = String((this._pendingModuleSlots ?? []).filter(s => s.type === mod.type).length);
    }

    this._renderPendingShipGrid();

    const tierMult = (t: ShipModuleType) => Math.pow(2, this.player.getModuleTier(t) - 1);
    const hp      = this.player.maxHp + (counts.hull - this.player.moduleCounts.hull) * 34 * tierMult('hull');
    const shield  = this.player.maxShield + (counts.shield - this.player.moduleCounts.shield) * 20 * tierMult('shield');
    const regen   = this.player.shieldRegen + (counts.shield - this.player.moduleCounts.shield) * 1.8 * tierMult('shield');
    const accel   = Math.max(0.1, 1 + counts.engine * 0.14 * tierMult('engine'));
    const speed   = Math.max(0.1, 1 + counts.engine * 0.12 * tierMult('engine'));
    const coolant = Math.max(0.1, 1 + counts.coolant * 0.3 * tierMult('coolant'));
    const wDmg    = 1 + counts.weapon * 0.08 * tierMult('weapon');
    const wRate   = 1 + counts.weapon * 0.06 * tierMult('weapon');

    const stats = document.getElementById('ship-editor-stats');
    if (stats) {
      stats.innerHTML = `
        <div class="editor-stat">HP ${Math.round(hp)}</div>
        <div class="editor-stat">Shield ${Math.round(shield)}</div>
        <div class="editor-stat">Regen ${regen.toFixed(1)}/s</div>
        <div class="editor-stat">Accel x${accel.toFixed(2)}</div>
        <div class="editor-stat">Top Speed x${speed.toFixed(2)}</div>
        <div class="editor-stat">Coolant x${coolant.toFixed(2)}</div>
        <div class="editor-stat">Dmg x${wDmg.toFixed(2)}</div>
        <div class="editor-stat">Fire Rate x${wRate.toFixed(2)}</div>
        <div class="editor-stat">Mining Lasers ${counts.miningLaser}</div>
      `;
    }
  }

  private _clearEditorGridHighlights(): void {
    const cells = document.querySelectorAll('.editor-grid-cell.drop-target');
    cells.forEach(c => c.classList.remove('drop-target'));
  }

  private _setPendingModuleAtCell(row: number, col: number, moduleType: ShipModuleType): void {
    if (!this._pendingModuleSlots) this._pendingModuleSlots = this._slotsFromPlayer();
    const existing = this._pendingModuleSlots.find(s => s.row === row && s.col === col);
    if (existing) {
      existing.type = moduleType;
    } else if (Game._VALID_SLOT_KEYS.has(`${row},${col}`)) {
      this._pendingModuleSlots.push({ row, col, type: moduleType });
    } else {
      return;
    }
    this._refreshShipEditorPanel();
  }

  private _swapPendingModuleCells(fromRow: number, fromCol: number, toRow: number, toCol: number): void {
    if (!this._pendingModuleSlots) return;
    const fromSlot = this._pendingModuleSlots.find(s => s.row === fromRow && s.col === fromCol);
    if (!fromSlot) return;

    const toSlot = this._pendingModuleSlots.find(s => s.row === toRow && s.col === toCol);
    if (toSlot) {
      // Swap the two filled cells
      const tmp    = fromSlot.type;
      fromSlot.type = toSlot.type;
      toSlot.type   = tmp;
    } else if (Game._VALID_SLOT_KEYS.has(`${toRow},${toCol}`)) {
      // Move to an empty valid slot: update fromSlot position in-place
      fromSlot.row = toRow;
      fromSlot.col = toCol;
    } else {
      return;
    }
    this._refreshShipEditorPanel();
  }

  // ── Palette context menu (recycle / upgrade) ────────────────────────────────

  private _showPaletteContextMenu(type: ShipModuleType, x: number, y: number): void {
    const menu = document.getElementById('palette-context-menu');
    if (!menu) return;

    const config = MODULE_EDITOR_CONFIG.find(c => c.type === type);
    const owned  = this.player.getModuleCount(type);
    const placed = (this._pendingModuleSlots ?? []).filter(s => s.type === type).length;
    const unplaced = owned - placed;

    const titleEl = document.getElementById('pcm-title');
    if (titleEl) titleEl.textContent = config?.name ?? type;

    const recycleBtn = document.getElementById('pcm-recycle-btn') as HTMLButtonElement | null;
    if (recycleBtn) {
      recycleBtn.disabled = owned <= 0;
      // Preview recycle yield
      const entry = this.player.modulePalette.find(e => e.type === type);
      const recipe = entry ? CRAFTING_RECIPES.find(r => r.id === entry.recipeId) : null;
      let yieldText = '';
      if (recipe && recipe.inputs.length > 0) {
        const parts = recipe.inputs
          .map(i => ({ mat: i.material, qty: Math.floor(i.quantity * RECYCLE_REFUND_RATE) }))
          .filter(p => p.qty > 0)
          .map(p => `${p.qty}× ${p.mat}`);
        yieldText = parts.length > 0 ? ` → ${parts.join(', ')}` : ' → nothing';
      }
      recycleBtn.textContent = `♻ Recycle ×1${yieldText}`;
      recycleBtn.onclick = () => {
        const refund = this.player.recycleModuleFromPalette(type, CRAFTING_RECIPES);
        if (refund !== null) {
          // If more placed than now owned, remove one from the pending layout
          const newOwned = this.player.getModuleCount(type);
          if (this._pendingModuleSlots) {
            const placedCount = this._pendingModuleSlots.filter(s => s.type === type).length;
            if (placedCount > newOwned) {
              // Remove the last placed module of this type
              const lastIdx = this._pendingModuleSlots.map((s, i) => s.type === type ? i : -1)
                .filter(i => i !== -1).pop() ?? -1;
              if (lastIdx !== -1) this._pendingModuleSlots.splice(lastIdx, 1);
            }
          }
          const msg = refund.length > 0
            ? `Recycled ${config?.name ?? type}. Refunded: ${refund.map(r => `${r.quantity}× ${r.material}`).join(', ')}`
            : `Recycled ${config?.name ?? type}.`;
          this.hud.showMessage(msg, 3);
          this._refreshShipEditorPanel();
          this.crafting.refresh();
        }
        this._hidePaletteContextMenu();
      };
    }

    const upgradeBtn = document.getElementById('pcm-upgrade-btn') as HTMLButtonElement | null;
    if (upgradeBtn) {
      const cost = this.player.getUpgradeCost(type);
      if (cost) {
        const tier    = this.player.getModuleTier(type);
        const has     = this.player.getResource(cost.gem);
        upgradeBtn.textContent = `⬆ Upgrade to T${tierToRoman(tier + 1)}: ${cost.count}× ${cost.gem} (have ${has})`;
        upgradeBtn.disabled    = has < cost.count;
        upgradeBtn.style.display = '';
        upgradeBtn.onclick = () => {
          const ok = this.player.upgradeModule(type);
          if (ok) this.hud.showMessage(`${config?.name ?? type} upgraded to T${tierToRoman(this.player.getModuleTier(type))}!`, 3);
          else    this.hud.showMessage('Not enough gems to upgrade.', 2);
          this._refreshShipEditorPanel();
          this.crafting.refresh();
          this._hidePaletteContextMenu();
        };
      } else {
        upgradeBtn.textContent   = 'Max tier reached';
        upgradeBtn.disabled      = true;
        upgradeBtn.style.display = '';
        upgradeBtn.onclick       = null;
      }
    }

    menu.style.left = `${x}px`;
    menu.style.top  = `${y}px`;
    menu.classList.remove('hidden');
    this._updateUiPanelScaling();
  }

  private _hidePaletteContextMenu(): void {
    document.getElementById('palette-context-menu')?.classList.add('hidden');
  }

  private _executeUpgradeForType(type: ShipModuleType): void {
    const config = MODULE_EDITOR_CONFIG.find(c => c.type === type);
    const ok = this.player.upgradeModule(type);
    if (ok) {
      this.hud.showMessage(`${config?.name ?? type} upgraded to T${tierToRoman(this.player.getModuleTier(type))}!`, 3);
    } else {
      const cost = this.player.getUpgradeCost(type);
      if (!cost) this.hud.showMessage(`${config?.name ?? type} is already at max tier.`, 2);
      else this.hud.showMessage(`Need ${cost.count}× ${cost.gem} to upgrade ${config?.name ?? type}.`, 2);
    }
    this._refreshShipEditorPanel();
    this.crafting.refresh();
  }

  private _renderPendingShipGrid(): void {
    if (!this._pendingModuleSlots) return;
    const slotByPos = new Map<string, ShipModuleType>();
    for (const slot of this._pendingModuleSlots) {
      slotByPos.set(`${slot.row},${slot.col}`, slot.type);
    }

    const cells = document.querySelectorAll('.editor-grid-cell');
    for (const cell of cells) {
      const htmlCell = cell as HTMLDivElement;
      const row = Number(htmlCell.dataset.row);
      const col = Number(htmlCell.dataset.col);
      const moduleType = slotByPos.get(`${row},${col}`);
      htmlCell.classList.remove('filled', 'hull', 'engine', 'shield', 'coolant', 'weapon', 'miningLaser');
      htmlCell.textContent = '';
      if (!moduleType) {
        htmlCell.draggable = false;
        delete htmlCell.dataset.moduleType;
        if (htmlCell.dataset.locked === 'true') htmlCell.textContent = 'CORE';
        continue;
      }
      htmlCell.classList.add('filled', SHIP_MODULE_FAMILY_BY_TYPE[moduleType]);
      const MODULE_LABELS: Record<ShipModuleType, string> = {
        hull: 'H', engine: 'E', shield: 'S', coolant: 'C', weapon: 'W', miningLaser: 'ML',
        basic_cannon: 'BC', laser_beam: 'LB', shield_gen: 'SG', heavy_armor: 'HA', dark_engine: 'DE',
        mining_laser: 'ML', void_lance: 'VL', resonance_beam: 'RB', placer_laser: 'PL',
        spread_cannon: 'SC', missile_launcher: 'MS', cluster_bomb: 'CB',
      };
      htmlCell.textContent = MODULE_LABELS[moduleType] ?? moduleType[0].toUpperCase();
      htmlCell.draggable = true;
      htmlCell.dataset.moduleType = moduleType;
    }
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


  private _canAutoCraftModuleType(type: ShipModuleType): boolean {
    if (this._rebirthModuleResources[type] > 0) {
      this._rebirthModuleResources[type] -= 1;
      return true;
    }

    const recipe = CRAFTING_RECIPES.find(r => r.moduleType === type);
    if (!recipe) return false;
    for (const input of recipe.inputs) {
      if (this.player.getResource(input.material) < input.quantity) return false;
    }
    for (const input of recipe.inputs) this.player.addResource(input.material, -input.quantity);
    return true;
  }

  private _runAutoCrafting(): void {
    if (this._autoBuildBlueprintSlots.length === 0) return;

    const aliveShipSlots = this.player.getAliveModuleSlots();
    const current: Array<{ row: number; col: number; type: ShipModuleType }> = [];
    const currentKeySet = new Set<string>();
    for (let i = 0; i < aliveShipSlots.length; i++) {
      const slot = aliveShipSlots[i];
      const mapped = {
        row: EDITOR_CENTER - slot.col,
        col: slot.row + EDITOR_CENTER,
        type: slot.type,
      };
      current.push(mapped);
      currentKeySet.add(`${mapped.row},${mapped.col}`);
    }

    const missing: Array<{ row: number; col: number; type: ShipModuleType; distance: number }> = [];
    for (let i = 0; i < this._autoBuildBlueprintSlots.length; i++) {
      const slot = this._autoBuildBlueprintSlots[i];
      const key = `${slot.row},${slot.col}`;
      if (currentKeySet.has(key)) continue;
      missing.push({
        row: slot.row,
        col: slot.col,
        type: slot.type,
        distance: Math.abs(slot.row - EDITOR_CENTER) + Math.abs(slot.col - EDITOR_CENTER),
      });
    }

    missing.sort((a, b) => a.distance - b.distance);

    let changed = false;
    while (true) {
      let craftedCount = 0;
      for (let i = 0; i < missing.length; i++) {
        const slot = missing[i];
        if (slot.distance < 0) continue;

        const hasNeighbor =
          currentKeySet.has(`${slot.row - 1},${slot.col}`)
          || currentKeySet.has(`${slot.row + 1},${slot.col}`)
          || currentKeySet.has(`${slot.row},${slot.col - 1}`)
          || currentKeySet.has(`${slot.row},${slot.col + 1}`);
        if (!hasNeighbor) continue;
        if (!this._canAutoCraftModuleType(slot.type)) continue;

        current.push({ row: slot.row, col: slot.col, type: slot.type });
        currentKeySet.add(`${slot.row},${slot.col}`);
        slot.distance = -1;
        craftedCount += 1;
        changed = true;
      }
      if (craftedCount === 0) break;
    }

    if (!changed) return;

    const shipSlots = current.map((slot) => ({
      type: slot.type,
      col: EDITOR_CENTER - slot.row,
      row: slot.col - EDITOR_CENTER,
    }));
    this.player.setModuleLayout(shipSlots);
    this._savedModuleSlots = this._getCurrentShipSlots();
    if (!this._shipEditorOpen) this._pendingModuleSlots = [...this._savedModuleSlots];
  }

  private _resetRunAfterDeath(): void {
    this._loopCount++;
    this._gemShopOpen = false;

    const gemCarry = new Map<Material, number>();
    for (const gem of GEM_MATERIALS) {
      gemCarry.set(gem, this.player.getResource(gem));
    }

    // Apply permanent stat bonuses BEFORE rebuilding modules so core HP is correct
    this._applyGemBonuses();

    this.player.setModuleLayout(CORE_ONLY_LAYOUT);
    this.player.initStarterPalette();
    this.player.pos = this.world.getPlayerSpawnPosition();
    this.player.vel = { x: 0, y: 0 };

    for (const [mat, item] of this.player.inventory.entries()) {
      item.quantity = gemCarry.get(mat) ?? 0;
    }

    // Add starting resource bonuses after inventory is restored to gems-only
    this._addStartingResourceBonuses();

    this.toolbar.reset();
    const miningLaser = TOOLBAR_ITEM_DEFS['mining_laser'];
    this.toolbar.addItem(miningLaser);
    this.player.equipItem(0, miningLaser);
    this.toolbar.renderDOM();

    this.projectiles.length = 0;
    this.particles.length = 0;
    this.floatingTexts.length = 0;
    this.world.resetForLoop();
    this.player.pos = this.world.getPlayerSpawnPosition();

    this._savedModuleSlots = [...this._autoBuildBlueprintSlots];
    this._pendingModuleSlots = [...this._autoBuildBlueprintSlots];
    this._rebirthModuleResources = { ...STARTING_MODULE_RESOURCE_COUNTS };
    this._rebirthTimerSec = 0;
    this._isRebirthAnimating = true;

    this._timeSurvived = 0;
    this._maxDistFromOrigin = 0;
    this.gameTime = 0;
    this._killComboCount = 0;
    this._killComboTimer = 0;
    this._killComboPrevKills = 0;
    this.camera.position = { x: this.player.pos.x, y: this.player.pos.y };
    this.hud.showMessage(`Loop ${this._loopCount}: gems carried over. Ship reconstruction in progress.`, 3);
  }

  private _updateRebirthAnimation(dt: number): void {
    this._rebirthTimerSec += dt;
    if (this._rebirthTimerSec >= REBIRTH_FLASH_DURATION_SEC) {
      this._runAutoCrafting();
    }
    if (this._rebirthTimerSec >= REBIRTH_TOTAL_DURATION_SEC) {
      this._isRebirthAnimating = false;
      this._rebirthTimerSec = 0;
    }
  }

  /** Apply all purchased gem bonuses to the player (permanent stats + starting resources). */
  private _applyGemBonuses(): void {
    const level = (id: GemBonusId): number => this._gemBonusLevels[id] ?? 0;

    // Permanent stat bonuses
    this.player.permanentHpBonus             = level('reinforced_hull') * GEM_BONUS_HP_PER_LEVEL;
    this.player.permanentShieldBonus         = level('power_shields')   * GEM_BONUS_SHIELD_PER_LEVEL;
    this.player.permanentWeaponDamageBonus   = level('combat_training') * GEM_BONUS_WEAPON_PER_LEVEL / 100;
    this.player.permanentMiningBonus         = level('mining_expertise') * GEM_BONUS_MINING_PER_LEVEL / 100;
    this.player.permanentXpMultiplier        = 1 + level('void_resonance') * GEM_BONUS_XP_PER_LEVEL / 100;
    this.player.passiveHpRegenPerSec         = level('hull_regen') * GEM_BONUS_HP_REGEN_PER_LEVEL;
    this.player.permanentSpeedBonus          = level('engine_overdrive') * GEM_BONUS_ENGINE_SPEED_PER_LEVEL / 100;
    this.player.critChanceBonus              = level('crit_mastery') * GEM_BONUS_CRIT_CHANCE_PER_LEVEL / 100;
    this.player.permanentFireRateBonus       = level('rapid_reload') * GEM_BONUS_FIRE_RATE_PER_LEVEL / 100;
  }

  /** Add starting resource bonuses to inventory (called after inventory reset). */
  private _addStartingResourceBonuses(): void {
    const level = (id: GemBonusId): number => this._gemBonusLevels[id] ?? 0;
    this.player.addResource(Material.Iron,    BASE_STARTING_IRON + level('iron_cache')        * GEM_BONUS_IRON_PER_LEVEL);
    this.player.addResource(Material.Gold,    level('gold_reserve')      * GEM_BONUS_GOLD_PER_LEVEL);
    this.player.addResource(Material.Crystal, BASE_STARTING_CRYSTAL + level('crystal_stockpile') * GEM_BONUS_CRYSTAL_PER_LEVEL);
  }

  /** Save personal-best stats to localStorage when the current run beats any record. */
  private _savePersonalBest(): void {
    let changed = false;
    if (this.world.kills   > this._pbKills)           { this._pbKills   = this.world.kills;          changed = true; }
    if (this.player.level  > this._pbLevel)           { this._pbLevel   = this.player.level;          changed = true; }
    if (this._timeSurvived > this._pbTimeSec)         { this._pbTimeSec = this._timeSurvived;         changed = true; }
    if (this._maxDistFromOrigin > this._pbMaxDist)    { this._pbMaxDist = this._maxDistFromOrigin;    changed = true; }
    if (changed) {
      try {
        localStorage.setItem(Game._PB_STORAGE_KEY, JSON.stringify({
          kills:   this._pbKills,
          level:   this._pbLevel,
          timeSec: this._pbTimeSec,
          maxDist: this._pbMaxDist,
        }));
      } catch { /* ignore write errors */ }
    }
  }

  /** Attempt to buy one level of a gem bonus. Returns true on success. */
  private _tryBuyGemBonus(id: GemBonusId): boolean {
    const def = GEM_BONUS_DEFS.find(d => d.id === id);
    if (!def) return false;
    const currentLevel = this._gemBonusLevels[id] ?? 0;
    if (currentLevel >= def.maxLevel) {
      this.hud.showMessage(`${def.name} is already at maximum level.`, 2);
      return false;
    }
    if (this.player.getResource(def.gem) < def.gemCost) {
      this.hud.showMessage(`Not enough ${def.gem}. Need ${def.gemCost}×.`, 2);
      return false;
    }
    this.player.addResource(def.gem, -def.gemCost);
    this._gemBonusLevels[id] = currentLevel + 1;
    this.hud.showMessage(`${def.name} upgraded to level ${currentLevel + 1}!`, 2);
    return true;
  }

  /** Render the gem shop overlay (shown on death screen). */
  private _renderGemShop(ctx: CanvasRenderingContext2D): void {
    const { canvas } = this;
    const W = canvas.width;
    const H = canvas.height;

    // Darken background
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, W, H);

    const ROW_H    = 52;
    const HEADER_H = 80;
    const GEM_ROW_H = 40;
    const FOOTER_H  = 42;
    const panelW = Math.min(640, W - 32);
    const panelH = Math.min(H - 32, HEADER_H + GEM_ROW_H + GEM_BONUS_DEFS.length * ROW_H + FOOTER_H);
    const px = Math.round((W - panelW) / 2);
    const py = Math.round((H - panelH) / 2);

    // Panel background
    ctx.fillStyle   = '#070c1a';
    ctx.strokeStyle = 'rgba(100,160,255,0.5)';
    ctx.lineWidth   = 1.5;
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeRect(px, py, panelW, panelH);

    // Title
    ctx.save();
    ctx.font      = 'bold 20px Courier New';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7ecfff';
    ctx.fillText('💎 GEM SHOP', W / 2, py + 28);
    ctx.font      = '11px Courier New';
    ctx.fillStyle = 'rgba(180,210,255,0.5)';
    ctx.fillText('Spend gems on permanent bonuses that persist across every loop', W / 2, py + 48);
    ctx.restore();

    // Close button (top-right)
    const CLOSE_W = 76; const CLOSE_H = 22;
    const closeX = px + panelW - CLOSE_W - 8;
    const closeY = py + 6;
    ctx.fillStyle   = 'rgba(50,70,110,0.6)';
    ctx.strokeStyle = 'rgba(100,150,255,0.5)';
    ctx.lineWidth   = 1;
    ctx.fillRect(closeX, closeY, CLOSE_W, CLOSE_H);
    ctx.strokeRect(closeX, closeY, CLOSE_W, CLOSE_H);
    ctx.font      = '11px Courier New';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#99bbdd';
    ctx.fillText('✕ BACK', closeX + CLOSE_W / 2, closeY + 14);
    this._gemShopCloseRect = { x: closeX, y: closeY, w: CLOSE_W, h: CLOSE_H };

    // Gem inventory row
    const gemRowY = py + HEADER_H;
    ctx.font      = '11px Courier New';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(180,210,255,0.5)';
    ctx.fillText('Gems:', px + 10, gemRowY + 13);
    let gemCurX = px + 60;
    for (const gem of GEM_MATERIALS) {
      const qty = this.player.getResource(gem);
      if (qty <= 0) continue;
      const color = MATERIAL_PROPS[gem].color;
      const label = `${qty}× ${gem}`;
      ctx.fillStyle = color;
      ctx.fillText(label, gemCurX, gemRowY + 13);
      gemCurX += ctx.measureText(label).width + 12;
      if (gemCurX > px + panelW - 10) break;
    }

    // Separator
    ctx.strokeStyle = 'rgba(100,150,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 6, gemRowY + GEM_ROW_H - 4);
    ctx.lineTo(px + panelW - 6, gemRowY + GEM_ROW_H - 4);
    ctx.stroke();

    // Bonus rows
    const listY = py + HEADER_H + GEM_ROW_H;
    this._gemShopBuyRects.length = 0;

    for (let i = 0; i < GEM_BONUS_DEFS.length; i++) {
      const def      = GEM_BONUS_DEFS[i];
      const curLevel = this._gemBonusLevels[def.id] ?? 0;
      const isMax    = curLevel >= def.maxLevel;
      const canAfford = this.player.getResource(def.gem) >= def.gemCost;
      const rowY     = listY + i * ROW_H;

      // Alternating row tint
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(15,30,60,0.35)';
        ctx.fillRect(px + 4, rowY + 2, panelW - 8, ROW_H - 4);
      }

      // Name
      ctx.font      = 'bold 12px Courier New';
      ctx.textAlign = 'left';
      ctx.fillStyle = isMax ? '#88aabb' : '#d0eaff';
      ctx.fillText(def.name, px + 12, rowY + 17);

      // Description
      ctx.font      = '10px Courier New';
      ctx.fillStyle = 'rgba(180,210,255,0.6)';
      ctx.fillText(def.description, px + 12, rowY + 34);

      // Level pip bar
      const barX = px + Math.round(panelW * 0.5);
      let pips = '';
      for (let j = 0; j < def.maxLevel; j++) pips += j < curLevel ? '●' : '○';
      ctx.font      = '11px Courier New';
      ctx.fillStyle = isMax ? '#88cc88' : 'rgba(180,210,255,0.55)';
      ctx.textAlign = 'left';
      ctx.fillText(pips, barX, rowY + 17);
      ctx.fillStyle = isMax ? '#66cc66' : 'rgba(160,190,255,0.55)';
      ctx.fillText(`Lv ${curLevel}/${def.maxLevel}`, barX, rowY + 34);

      // BUY button
      const BTN_W = 108; const BTN_H = 34;
      const btnX = px + panelW - BTN_W - 8;
      const btnY = rowY + Math.round((ROW_H - BTN_H) / 2);

      if (isMax) {
        ctx.fillStyle   = 'rgba(20,60,20,0.5)';
        ctx.strokeStyle = 'rgba(60,160,60,0.4)';
      } else if (canAfford) {
        ctx.fillStyle   = 'rgba(15,50,110,0.7)';
        ctx.strokeStyle = 'rgba(80,150,255,0.75)';
      } else {
        ctx.fillStyle   = 'rgba(30,30,30,0.4)';
        ctx.strokeStyle = 'rgba(80,80,80,0.3)';
      }
      ctx.lineWidth = 1;
      ctx.fillRect(btnX, btnY, BTN_W, BTN_H);
      ctx.strokeRect(btnX, btnY, BTN_W, BTN_H);

      ctx.textAlign = 'center';
      if (isMax) {
        ctx.font      = 'bold 12px Courier New';
        ctx.fillStyle = '#66cc66';
        ctx.fillText('✓ MAX', btnX + BTN_W / 2, btnY + 21);
      } else {
        const gemColor = MATERIAL_PROPS[def.gem].color;
        ctx.font      = '10px Courier New';
        ctx.fillStyle = canAfford ? gemColor : '#556677';
        ctx.fillText(`${def.gemCost}× ${def.gem}`, btnX + BTN_W / 2, btnY + 13);
        ctx.font      = 'bold 11px Courier New';
        ctx.fillStyle = canAfford ? '#d0eaff' : '#445566';
        ctx.fillText('BUY →', btnX + BTN_W / 2, btnY + 27);
        this._gemShopBuyRects.push({ id: def.id, x: btnX, y: btnY, w: BTN_W, h: BTN_H });
      }
    }

    // Footer
    const footerY = py + panelH - FOOTER_H + 8;
    ctx.font      = '11px Courier New';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200,220,255,0.35)';
    ctx.fillText('Bonuses apply starting next loop and are permanent.', W / 2, footerY);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const rLabel = this.input.isMobile ? '[Rebirth]' : '[R] Rebirth now';
    ctx.fillText(rLabel, W / 2, footerY + 18);
  }

  private _pauseKeyHeld    = false;

  // ── Render ─────────────────────────────────────────────────────────────────
  private render(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background — deep space radial gradient for depth
    const bgGrad = ctx.createRadialGradient(
      canvas.width * 0.5, canvas.height * 0.5, 0,
      canvas.width * 0.5, canvas.height * 0.5, Math.max(canvas.width, canvas.height) * 0.75,
    );
    bgGrad.addColorStop(0,   '#0e1228');
    bgGrad.addColorStop(0.4, '#07091a');
    bgGrad.addColorStop(1,   '#020408');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Parallax starfield (screen-space, before camera transform)
    this.starfield.draw(ctx, this.camera.position, canvas.width, canvas.height, this._graphicsConfig);

    // World-space rendering
    this.camera.begin(ctx);

    // Sun at world origin
    this.sunRenderer.draw(ctx, { x: 0, y: 0 }, 150, this.gameTime, this._graphicsConfig);

    this.world.draw(ctx, this.camera.position, canvas.width, canvas.height, this.gameTime);

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
    const skipTrails = !this._graphicsConfig.particleTrails;
    for (const p of this.particles) drawParticle(ctx, p, skipTrails);

    // Floating damage / XP texts (world-space)
    for (const f of this.floatingTexts) drawFloatingText(ctx, f);

    // ── Shockwave rings (Graviton Pulse + enemy kill rings) ──────────────────────
    for (const ring of this._shockwaveRings) {
      const progress = 1 - ring.life / ring.maxLife; // 0→1
      const alpha = (1 - progress) * 0.90;
      const ringColor = ring.color ?? '#80c0ff';
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // Outer diffuse glow band
      ctx.globalAlpha = alpha * 0.38;
      ctx.strokeStyle = ringColor;
      ctx.lineWidth   = 14 + (1 - progress) * 22;
      ctx.shadowColor = ringColor;
      ctx.shadowBlur  = 28;
      ctx.beginPath();
      ctx.arc(ring.pos.x, ring.pos.y, ring.currentRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Main bright ring
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ring.color ?? 'rgb(140,200,255)';
      ctx.lineWidth   = 2.5 + (1 - progress) * 6;
      ctx.shadowBlur  = 16;
      ctx.beginPath();
      ctx.arc(ring.pos.x, ring.pos.y, ring.currentRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Inner ring (narrower, brighter)
      ctx.lineWidth   = 1.2;
      ctx.globalAlpha = alpha * 0.75;
      ctx.strokeStyle = ring.color ?? 'rgb(220,240,255)';
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.arc(ring.pos.x, ring.pos.y, ring.currentRadius * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Player
    if (this.player.alive) this.player.draw(ctx);

    this.camera.end(ctx);

    // ── Sun ray-tracing / shadow overlay (screen-space, after camera) ─────
    if (this.player.alive) {
      const occluders = this.world.getShadowOccluders(this.camera.position);
      // Add player ship modules as occluders
      for (const occ of this.player.getModuleShadowOccluders()) occluders.push(occ);
      this.sunRenderer.drawSunRays(
        ctx,
        { x: 0, y: 0 },
        150,
        this.player.pos,
        canvas.width,
        canvas.height,
        (p: Vec2) => this.camera.worldToScreen(p),
        occluders,
        this._graphicsConfig,
      );
    }

    // ── Post-process shaders (vignette, bloom) ─────────────────────
    this.postProcess.draw(ctx, canvas, this._graphicsConfig, this.gameTime);

    // ── Level-up rings (screen-space, centred on player screen pos) ──
    if (this._levelUpRings.length > 0 && this.player.alive) {
      const playerScreen = this.camera.worldToScreen(this.player.pos);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const ring of this._levelUpRings) {
        const progress = 1 - ring.life / ring.maxLife; // 0→1 as ring expands
        const radius   = 30 + progress * 200;
        const alpha    = (1 - progress) * 0.9;
        ctx.strokeStyle = `rgba(255,220,60,${alpha.toFixed(3)})`;
        ctx.lineWidth   = 3 * (1 - progress) + 1;
        ctx.shadowColor = '#ffe060';
        ctx.shadowBlur  = 18;
        ctx.beginPath();
        ctx.arc(playerScreen.x, playerScreen.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ── Minimap ────────────────────────────────────────────────────
    if (this.player.alive) {
      const minimapData = this.world.getMinimapData(this.camera.position);
      this._drawMinimap(ctx, minimapData);

      // ── Off-screen enemy indicators ──────────────────────────────
      this._drawEnemyIndicators(ctx, minimapData.enemies);

      // ── Repair materials list (below minimap) ─────────────────────
      this._drawRepairMaterials(ctx);
    }

    // ── Danger proximity indicator (red edge glow when an enemy is very close) ──
    if (this.player.alive && !this._paused) {
      /** World units within which the danger glow starts fading in. */
      const DANGER_INNER_DIST_WORLD    = 200;
      /** World units at which the danger glow is at maximum intensity. */
      const DANGER_OUTER_DIST_WORLD    = 120;
      /** Minimum pulse brightness (glow never drops below 55% of max intensity). */
      const DANGER_PULSE_MIN           = 0.55;
      /** Amplitude of pulse oscillation on top of DANGER_PULSE_MIN. */
      const DANGER_PULSE_AMPLITUDE     = 0.45;
      /** Pulse frequency in Hz. */
      const DANGER_PULSE_FREQUENCY_HZ  = 2;
      /** Maximum alpha opacity of the danger overlay at full intensity. */
      const DANGER_MAX_ALPHA           = 0.5;
      /** Inner radius of the radial gradient (as fraction of canvas height). */
      const DANGER_GRADIENT_INNER_RAD  = 0.35;
      /** Outer radius of the radial gradient (as fraction of max canvas dimension). */
      const DANGER_GRADIENT_OUTER_RAD  = 0.75;

      const nearestSq = this.world.nearestEnemyDistSq(this.player.pos);
      if (nearestSq < DANGER_INNER_DIST_WORLD * DANGER_INNER_DIST_WORLD) {
        const nearestDist = Math.sqrt(nearestSq);
        const intensity = Math.max(0, Math.min(1, 1 - (nearestDist - DANGER_OUTER_DIST_WORLD) / (DANGER_INNER_DIST_WORLD - DANGER_OUTER_DIST_WORLD)));
        const pulse = DANGER_PULSE_MIN + Math.abs(Math.sin(this.gameTime * Math.PI * DANGER_PULSE_FREQUENCY_HZ * 2)) * DANGER_PULSE_AMPLITUDE;
        const alpha = intensity * pulse * DANGER_MAX_ALPHA;
        const grad = ctx.createRadialGradient(
          canvas.width / 2, canvas.height / 2, canvas.height * DANGER_GRADIENT_INNER_RAD,
          canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * DANGER_GRADIENT_OUTER_RAD,
        );
        grad.addColorStop(0, 'rgba(255,0,0,0)');
        grad.addColorStop(1, `rgba(220,0,0,${alpha.toFixed(3)})`);
        ctx.save();
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }


    if (this.player.alive && !this._paused && !this._shipEditorOpen && !this._settingsOpen) {
      const mw = this.camera.screenToWorld(this.input.mousePos);
      const info = this.player.getModuleInfoAtWorldPos(mw);
      if (info) this._drawModuleTooltip(ctx, info, this.input.mousePos);
    }

    // ── Speed indicator ────────────────────────────────────────────
    if (this.player.alive) {
      const spd = Math.round(len(this.player.vel));
      ctx.save();
      ctx.font      = '11px Courier New';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      // Position to the left of the minimap (SIZE=150 + MARGIN=14 + small gap)
      ctx.fillText(`SPD ${spd}`, canvas.width - 170, canvas.height - 14);

      // ── Graviton Pulse cooldown indicator ─────────────────────────
      const pcd = this.player.gravitonPulseCooldownSec;
      const pcdMax = this.player.gravitonPulseMaxCooldownSec;
      if (pcd > 0) {
        ctx.fillStyle = 'rgba(120,180,255,0.65)';
        ctx.fillText(`⚛ [G] ${Math.ceil(pcd)}s`, canvas.width - 170, canvas.height - 28);
      } else {
        ctx.fillStyle = 'rgba(120,200,255,0.85)';
        ctx.fillText('⚛ [G] READY', canvas.width - 170, canvas.height - 28);
      }
      // Small progress bar
      const barW = 100;
      const barX = canvas.width - 170 - barW;
      const barY = canvas.height - 36;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(barX, barY, barW, 3);
      const readyRatio = 1 - pcd / pcdMax;
      ctx.fillStyle = readyRatio >= 1 ? 'rgba(100,200,255,0.9)' : 'rgba(80,140,220,0.7)';
      ctx.fillRect(barX, barY, barW * readyRatio, 3);

      ctx.restore();
    }

    // ── Build number + loop counter (bottom-left) ─────────────────
    ctx.save();
    ctx.font      = '10px Courier New';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText(`Build ${BUILD_NUMBER}`, 8, canvas.height - 8);
    if (this._loopCount > 0) {
      ctx.fillStyle = 'rgba(180,200,255,0.35)';
      ctx.fillText(`Loop ${this._loopCount}`, 8, canvas.height - 22);
    }
    ctx.restore();

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

    // ── Zone transition banner ─────────────────────────────────────
    if (this._zoneBannerTimer > 0 && this.player.alive && !this._paused) {
      // Fade in first 0.5 s, hold, fade out last 0.5 s
      let alpha: number;
      if (this._zoneBannerTimer > 3.0)       alpha = (3.5 - this._zoneBannerTimer) / 0.5;
      else if (this._zoneBannerTimer < 0.5)  alpha = this._zoneBannerTimer / 0.5;
      else                                   alpha = 1.0;

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      // Subtle backdrop
      const grad = ctx.createLinearGradient(0, cy - 70, 0, cy + 40);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.3, 'rgba(0,0,0,0.55)');
      grad.addColorStop(0.7, 'rgba(0,0,0,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, cy - 70, canvas.width, 110);
      // Sub-label
      ctx.font      = '16px Courier New';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText('— ENTERING NEW ZONE —', cx, cy - 30);
      // Zone name — glowing text
      ctx.font        = 'bold 42px Courier New';
      ctx.shadowColor = this._zoneBannerColor;
      ctx.shadowBlur  = 24;
      ctx.fillStyle   = this._zoneBannerColor;
      ctx.fillText(this._zoneBannerText, cx, cy + 16);
      // Second pass for brightness
      ctx.shadowBlur  = 8;
      ctx.fillStyle   = 'rgba(255,255,255,0.55)';
      ctx.fillText(this._zoneBannerText, cx, cy + 16);
      ctx.shadowBlur  = 0;
      ctx.restore();
    }

    // ── Game-over overlay ──────────────────────────────────────────
    if (!this.player.alive) {
      if (this._gemShopOpen) {
        this._renderGemShop(ctx);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.70)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const cx = canvas.width / 2;
        const cy = canvas.height / 2;

        ctx.fillStyle   = '#e74c3c';
        ctx.font        = 'bold 48px Courier New';
        ctx.textAlign   = 'center';
        ctx.fillText('SHIP DESTROYED', cx, cy - 75);

        // Loop counter
        if (this._loopCount > 0) {
          ctx.font      = '15px Courier New';
          ctx.fillStyle = '#7ecfff';
          ctx.fillText(`Loop ${this._loopCount}`, cx, cy - 44);
        }

        ctx.fillStyle = '#fff';
        ctx.font      = '18px Courier New';
        const mins = Math.floor(this._timeSurvived / 60);
        const secs = Math.floor(this._timeSurvived % 60);
        const timeStr = `${mins}:${String(secs).padStart(2, '0')}`;
        ctx.fillText(`Kills: ${this.world.kills}   Level: ${this.player.level}`, cx, cy - 10);
        ctx.fillText(`Time: ${timeStr}   Max Dist: ${Math.round(this._maxDistFromOrigin)}`, cx, cy + 22);

        // Personal best row
        if (this._pbKills > 0 || this._pbTimeSec > 0) {
          const pbMins = Math.floor(this._pbTimeSec / 60);
          const pbSecs = Math.floor(this._pbTimeSec % 60);
          const pbTimeStr = `${pbMins}:${String(pbSecs).padStart(2, '0')}`;
          ctx.font      = '11px Courier New';
          ctx.fillStyle = 'rgba(255,220,80,0.65)';
          ctx.fillText(`Best — Kills: ${this._pbKills}  Lv: ${this._pbLevel}  Time: ${pbTimeStr}  Dist: ${Math.round(this._pbMaxDist)}`, cx, cy + 40);
        }

        // Gem totals row
        const heldGems = GEM_MATERIALS.filter(g => this.player.getResource(g) > 0);
        if (heldGems.length > 0) {
          ctx.font = '12px Courier New';
          let gemStr = 'Gems: ';
          for (const g of heldGems) gemStr += `${this.player.getResource(g)}× ${g}  `;
          ctx.fillStyle = 'rgba(200,230,255,0.7)';
          ctx.fillText(gemStr.trim(), cx, cy + 58);
        }

        // Buttons row
        const BTN_H = 28;
        const BTN_Y = cy + (heldGems.length > 0 ? 82 : 66);

        // Gem Shop button
        ctx.font = '13px Courier New';
        const shopLabel = '💎 Gem Shop';
        const shopLabelW = ctx.measureText(shopLabel).width;
        const shopBtnW = shopLabelW + 28;
        const shopBtnX = cx - shopBtnW - 8;
        ctx.fillStyle   = 'rgba(50,40,100,0.70)';
        ctx.strokeStyle = 'rgba(160,120,255,0.8)';
        ctx.lineWidth   = 1.5;
        ctx.fillRect(shopBtnX, BTN_Y, shopBtnW, BTN_H);
        ctx.strokeRect(shopBtnX, BTN_Y, shopBtnW, BTN_H);
        ctx.fillStyle = 'rgba(210,180,255,0.9)';
        ctx.fillText(shopLabel, shopBtnX + shopBtnW / 2, BTN_Y + 18);
        this._deathGemShopRect = { x: shopBtnX, y: BTN_Y, w: shopBtnW, h: BTN_H };

        // Rebirth button
        const rebirthLabel = this.input.isMobile ? '[Rebirth]' : '[Rebirth (R)]';
        const rebirthLabelW = ctx.measureText(rebirthLabel).width;
        const rebirthBtnW = rebirthLabelW + 28;
        const rebirthBtnX = cx + 8;
        ctx.fillStyle   = 'rgba(70,160,255,0.20)';
        ctx.strokeStyle = 'rgba(170,220,255,0.7)';
        ctx.lineWidth   = 1.5;
        ctx.fillRect(rebirthBtnX, BTN_Y, rebirthBtnW, BTN_H);
        ctx.strokeRect(rebirthBtnX, BTN_Y, rebirthBtnW, BTN_H);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(rebirthLabel, rebirthBtnX + rebirthBtnW / 2, BTN_Y + 18);
        this._deathRebirthRect = { x: rebirthBtnX, y: BTN_Y, w: rebirthBtnW, h: BTN_H };
      }
    }

    if (this._isRebirthAnimating) {
      const t = this._rebirthTimerSec;
      const flashRatio = Math.max(0, 1 - (t / REBIRTH_FLASH_DURATION_SEC));
      const pulseRatio = Math.max(0, Math.min(1, (t - REBIRTH_FLASH_DURATION_SEC) / REBIRTH_BUILD_DURATION_SEC));
      const flashRadius = 12 + flashRatio * 85;
      const pulseRadius = 18 + pulseRatio * 32;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(canvas.width / 2, canvas.height / 2);

      if (flashRatio > 0) {
        const flashGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, flashRadius);
        flashGradient.addColorStop(0, `rgba(255,255,255,${0.9 * flashRatio})`);
        flashGradient.addColorStop(0.45, `rgba(170,220,255,${0.55 * flashRatio})`);
        flashGradient.addColorStop(1, 'rgba(120,180,255,0)');
        ctx.fillStyle = flashGradient;
        ctx.beginPath();
        ctx.arc(0, 0, flashRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = `rgba(170,220,255,${0.5 * (1 - pulseRatio)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, pulseRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Minimap ────────────────────────────────────────────────────────────────
  private _drawMinimap(ctx: CanvasRenderingContext2D, minimapData: ReturnType<World['getMinimapData']>): void {
    const SIZE   = 150;
    const RANGE  = 2000; // world-unit radius visible on map
    const MARGIN = 14;
    const mx = this.canvas.width - SIZE - MARGIN;
    const my = MARGIN;

    ctx.save();

    // Background + border with subtle inner glow
    ctx.fillStyle   = 'rgba(0, 5, 12, 0.70)';
    ctx.fillRect(mx, my, SIZE, SIZE);
    // Outer border
    ctx.strokeStyle = 'rgba(80, 200, 255, 0.45)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(mx, my, SIZE, SIZE);
    // Corner tick marks for a tactical HUD feel
    const tickLen = 6;
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.7)';
    ctx.lineWidth   = 1.5;
    for (const [cx2, cy2, signX, signY] of [
      [mx,        my,        1,  1],
      [mx + SIZE, my,       -1,  1],
      [mx,        my + SIZE, 1, -1],
      [mx + SIZE, my + SIZE,-1, -1],
    ] as [number, number, number, number][]) {
      ctx.beginPath();
      ctx.moveTo(cx2 + signX * tickLen, cy2);
      ctx.lineTo(cx2, cy2);
      ctx.lineTo(cx2, cy2 + signY * tickLen);
      ctx.stroke();
    }

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

    const { enemies, asteroids, pickups, planets } = minimapData;

    // Planets (large circles with cached surface color, drawn first so entities overlay them)
    for (const planet of planets) {
      const p         = toMap(planet.pos);
      const mapRadius = Math.max(4, planet.radius * scale);
      ctx.fillStyle   = planet.color + '99'; // semi-transparent fill
      ctx.beginPath();
      ctx.arc(p.x, p.y, mapRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = planet.color;
      ctx.lineWidth   = 0.5;
      ctx.stroke();
    }

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

  // ── Repair materials list (top-right, below minimap) ───────────────────────
  private _drawRepairMaterials(ctx: CanvasRenderingContext2D): void {
    const needed = this.player.getRepairMaterialsNeeded(MODULE_REBUILD_COSTS, CRAFTING_RECIPES);
    if (needed.size === 0) return;

    const minimapSizePx   = 150;
    const minimapMarginPx = 14;
    const my = minimapMarginPx + minimapSizePx + 6; // just below the minimap

    ctx.save();
    ctx.font      = '10px Courier New';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 180, 100, 0.85)';

    let row = 0;
    const lineHeightPx = 13;
    ctx.fillText('⚠ Repairs needed:', this.canvas.width - minimapMarginPx, my + row * lineHeightPx);
    row++;

    ctx.fillStyle = 'rgba(255, 220, 160, 0.80)';
    for (const [mat, qty] of needed) {
      ctx.fillText(`${qty}× ${mat}`, this.canvas.width - minimapMarginPx, my + row * lineHeightPx);
      row++;
    }
    ctx.restore();
  }

  // ── Off-screen enemy indicators ────────────────────────────────────────────
  private _drawEnemyIndicators(ctx: CanvasRenderingContext2D, enemies: Vec2[]): void {
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

  // ── Module hover tooltip ────────────────────────────────────────────────────
  private _drawModuleTooltip(ctx: CanvasRenderingContext2D, info: ModuleInfo, mouseScreen: { x: number; y: number }): void {
    const config = MODULE_EDITOR_CONFIG.find(c => c.type === info.type);
    const color  = config?.color ?? '#ffffff';
    const name   = info.isCore ? 'Core Module' : (config?.name ?? info.type);
    const desc   = info.isCore ? MODULE_CORE_DESC : (MODULE_TOOLTIP_DESCS[info.type] ?? '');
    const hpText = `HP: ${Math.ceil(info.hp)} / ${info.maxHp}`;

    const FONT_SMALL  = '11px Courier New';
    const FONT_HEADER = 'bold 12px Courier New';
    const PAD   = 8;
    const LINE  = 15;
    const MAX_W = 210;

    ctx.save();
    ctx.font = FONT_HEADER;
    const nameW = ctx.measureText(name).width;
    ctx.font = FONT_SMALL;
    // Wrap desc into lines
    const words = desc.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > MAX_W - PAD * 2) {
        if (cur) lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);

    const totalLines = 1 + 1 + lines.length; // name + hp + desc lines
    const boxW = Math.min(MAX_W, Math.max(nameW + PAD * 2, MIN_TOOLTIP_WIDTH));
    const boxH = totalLines * LINE + PAD * 2;

    let tx = mouseScreen.x + TOOLTIP_CURSOR_OFFSET;
    let ty = mouseScreen.y - boxH / 2;
    if (tx + boxW > this.canvas.width - 8) tx = mouseScreen.x - TOOLTIP_CURSOR_OFFSET - boxW;
    if (ty < 8) ty = 8;
    if (ty + boxH > this.canvas.height - 8) ty = this.canvas.height - 8 - boxH;

    // Background
    ctx.fillStyle   = 'rgba(6, 12, 24, 0.92)';
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.fillRect(tx, ty, boxW, boxH);
    ctx.strokeRect(tx, ty, boxW, boxH);

    let lineY = ty + PAD + LINE - 3;

    // Module name
    ctx.font      = FONT_HEADER;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(name, tx + PAD, lineY);
    lineY += LINE;

    // HP
    const hpRatio = info.maxHp > 0 ? info.hp / info.maxHp : 1;
    const hpColor = hpRatio > 0.5 ? '#2ecc71' : hpRatio > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.font      = FONT_SMALL;
    ctx.fillStyle = hpColor;
    ctx.fillText(hpText, tx + PAD, lineY);
    lineY += LINE;

    // Description lines
    ctx.fillStyle = 'rgba(200, 220, 255, 0.8)';
    for (const line of lines) {
      ctx.fillText(line, tx + PAD, lineY);
      lineY += LINE;
    }

    ctx.restore();
  }
}
// Start the game when the DOM is ready
window.addEventListener('DOMContentLoaded', () => new Game());
