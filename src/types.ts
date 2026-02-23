// ── Vector 2D helpers ────────────────────────────────────────────────────────
export interface Vec2 { x: number; y: number }

export function vec2(x = 0, y = 0): Vec2 { return { x, y }; }
export function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
export function scale(v: Vec2, s: number): Vec2 { return { x: v.x * s, y: v.y * s }; }
export function len(v: Vec2): number { return Math.sqrt(v.x * v.x + v.y * v.y); }
export function dist(a: Vec2, b: Vec2): number { return len(sub(b, a)); }
export function normalize(v: Vec2): Vec2 {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}
export function dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
export function angle(v: Vec2): number { return Math.atan2(v.y, v.x); }
export function fromAngle(a: number): Vec2 { return { x: Math.cos(a), y: Math.sin(a) }; }
export function perpCW(v: Vec2): Vec2  { return { x:  v.y, y: -v.x }; }  // 90° clockwise
export function perpCCW(v: Vec2): Vec2 { return { x: -v.y, y:  v.x }; } // 90° counter-clockwise
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
export function cloneVec2(v: Vec2): Vec2 { return { x: v.x, y: v.y }; }

// ── Material system ───────────────────────────────────────────────────────────
export enum Material {
  Dirt      = 'Dirt',
  Rock      = 'Rock',
  Iron      = 'Iron',
  Gold      = 'Gold',
  Crystal   = 'Crystal',
  Titanium  = 'Titanium',
  Darkite   = 'Darkite',
  // Gem minerals (ascending rarity 1–10)
  Quartz    = 'Quartz',
  Ruby      = 'Ruby',
  Sunstone  = 'Sunstone',
  Citrine   = 'Citrine',
  Emerald   = 'Emerald',
  Sapphire  = 'Sapphire',
  Iolite    = 'Iolite',
  Amethyst  = 'Amethyst',
  Diamond   = 'Diamond',
  Voidstone = 'Voidstone',
}

export interface MaterialProps {
  color:     string;
  hardness:  number;  // HP of a block made of this material
  rarity:    number;  // 0=common … 1=very rare
  minDist:   number;  // minimum world distance from origin to spawn (px)
  value:     number;  // crafting "weight"
  sprite?:   string;  // optional icon sprite path (relative to index.html)
}

const GEM_ICON = (name: string) =>
  `ASSETS/SPRITES/RESOURCES/resourceICONS/${name}.png`;

export const MATERIAL_PROPS: Record<Material, MaterialProps> = {
  [Material.Dirt]:      { color: '#966b3e', hardness: 10,  rarity: 0.00, minDist: 0,      value: 1   },
  [Material.Rock]:      { color: '#8d8d8d', hardness: 20,  rarity: 0.00, minDist: 0,      value: 1   },
  [Material.Iron]:      { color: '#c07840', hardness: 40,  rarity: 0.20, minDist: 800,    value: 3   },
  [Material.Gold]:      { color: '#f1c40f', hardness: 30,  rarity: 0.45, minDist: 2000,   value: 8   },
  [Material.Crystal]:   { color: '#7ed6f3', hardness: 25,  rarity: 0.65, minDist: 4000,   value: 15  },
  [Material.Titanium]:  { color: '#d0e8ff', hardness: 80,  rarity: 0.80, minDist: 7000,   value: 30  },
  [Material.Darkite]:   { color: '#9b59b6', hardness: 100, rarity: 0.93, minDist: 12000,  value: 60  },
  // Gems
  [Material.Quartz]:    { color: '#e8e4d0', hardness: 30,  rarity: 0.05, minDist: 300,    value: 5,   sprite: GEM_ICON('quartz')    },
  [Material.Ruby]:      { color: '#c0392b', hardness: 35,  rarity: 0.20, minDist: 800,    value: 10,  sprite: GEM_ICON('ruby')      },
  [Material.Sunstone]:  { color: '#e8891a', hardness: 40,  rarity: 0.33, minDist: 1400,   value: 14,  sprite: GEM_ICON('sunstone')  },
  [Material.Citrine]:   { color: '#f4d03f', hardness: 45,  rarity: 0.45, minDist: 2000,   value: 18,  sprite: GEM_ICON('citrine')   },
  [Material.Emerald]:   { color: '#27ae60', hardness: 50,  rarity: 0.57, minDist: 3000,   value: 25,  sprite: GEM_ICON('emerald')   },
  [Material.Sapphire]:  { color: '#2980b9', hardness: 55,  rarity: 0.67, minDist: 4500,   value: 35,  sprite: GEM_ICON('sapphire')  },
  [Material.Iolite]:    { color: '#5d6dbf', hardness: 60,  rarity: 0.75, minDist: 6000,   value: 48,  sprite: GEM_ICON('iolite')    },
  [Material.Amethyst]:  { color: '#9b59b6', hardness: 65,  rarity: 0.83, minDist: 8000,   value: 65,  sprite: GEM_ICON('amethyst')  },
  [Material.Diamond]:   { color: '#d0eeff', hardness: 90,  rarity: 0.91, minDist: 11000,  value: 90,  sprite: GEM_ICON('diamond')   },
  [Material.Voidstone]: { color: '#6c3483', hardness: 120, rarity: 0.97, minDist: 16000,  value: 130, sprite: GEM_ICON('VoidStone') },
};

/** Returns a weighted random material appropriate for a given world distance. */
export function pickMaterial(distFromOrigin: number, rng: () => number): Material {
  const ORE_MATERIALS: Material[] = [
    Material.Rock, Material.Iron, Material.Gold,
    Material.Crystal, Material.Titanium, Material.Darkite,
  ];
  const candidates = ORE_MATERIALS.filter(
    m => distFromOrigin >= MATERIAL_PROPS[m].minDist
  );
  // Weight by inverse rarity so common materials appear more often
  const weights = candidates.map(m => 1 - MATERIAL_PROPS[m].rarity + 0.05);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** All gem materials in ascending rarity order. */
export const GEM_MATERIALS: Material[] = [
  Material.Quartz, Material.Ruby, Material.Sunstone, Material.Citrine,
  Material.Emerald, Material.Sapphire, Material.Iolite, Material.Amethyst,
  Material.Diamond, Material.Voidstone,
];

/**
 * Returns a random gem material available at the given world distance,
 * weighted so rarer gems become more common deeper into the world.
 * Returns null if no gem is unlocked at this distance.
 */
export function pickGem(distFromOrigin: number, rng: () => number): Material | null {
  const candidates = GEM_MATERIALS.filter(
    m => distFromOrigin >= MATERIAL_PROPS[m].minDist
  );
  if (candidates.length === 0) return null;
  // Weight toward rarer gems deeper in the world; +0.05 floor ensures every
  // eligible gem always has a non-zero chance of being selected.
  const weights = candidates.map(m => 1 - MATERIAL_PROPS[m].rarity + 0.05);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// ── Inventory / item system ───────────────────────────────────────────────────
export interface InventoryItem {
  id:          string;
  name:        string;
  description: string;
  color:       string;
  quantity:    number;
}

export function createMaterialItem(mat: Material, qty = 0): InventoryItem {
  const p = MATERIAL_PROPS[mat];
  return {
    id:          mat,
    name:        mat,
    description: `Raw ${mat.toLowerCase()} ore`,
    color:       p.color,
    quantity:    qty,
  };
}

// ── Crafting recipes ──────────────────────────────────────────────────────────
export interface ResourceStack { material: Material; quantity: number }

export interface CraftingRecipe {
  id:          string;
  name:        string;
  description: string;
  icon:        string;
  inputs:      ResourceStack[];
  outputId:    string;   // toolbar item id
  outputQty:   number;
}

export const CRAFTING_RECIPES: CraftingRecipe[] = [
  {
    id:          'basic_cannon',
    name:        'Basic Cannon',
    description: 'A simple iron cannon. Fires slow heavy shots.',
    icon:        '🔫',
    inputs:      [{ material: Material.Iron, quantity: 5 }],
    outputId:    'basic_cannon',
    outputQty:   1,
  },
  {
    id:          'laser_beam',
    name:        'Laser Beam',
    description: 'Gold-crystal laser. Fast, precise.',
    icon:        '⚡',
    inputs:      [{ material: Material.Gold, quantity: 3 }, { material: Material.Iron, quantity: 2 }],
    outputId:    'laser_beam',
    outputQty:   1,
  },
  {
    id:          'shield_gen',
    name:        'Shield Generator',
    description: 'Regenerates your shield over time.',
    icon:        '🛡',
    inputs:      [{ material: Material.Crystal, quantity: 3 }, { material: Material.Iron, quantity: 5 }],
    outputId:    'shield_gen',
    outputQty:   1,
  },
  {
    id:          'heavy_armor',
    name:        'Heavy Armor',
    description: 'Titanium plating. Greatly increases max HP.',
    icon:        '🔩',
    inputs:      [{ material: Material.Titanium, quantity: 5 }],
    outputId:    'heavy_armor',
    outputQty:   1,
  },
  {
    id:          'dark_engine',
    name:        'Dark Matter Engine',
    description: 'Doubles thrust speed using exotic Darkite fuel.',
    icon:        '🌀',
    inputs:      [{ material: Material.Darkite, quantity: 2 }, { material: Material.Crystal, quantity: 3 }],
    outputId:    'dark_engine',
    outputQty:   1,
  },
  {
    id:          'mining_laser',
    name:        'Mining Laser',
    description: 'Effortlessly extracts resources from asteroids.',
    icon:        '⛏',
    inputs:      [{ material: Material.Iron, quantity: 3 }, { material: Material.Crystal, quantity: 1 }],
    outputId:    'mining_laser',
    outputQty:   1,
  },
  {
    id:          'void_lance',
    name:        'Void Lance',
    description: 'Fires a bolt of void energy. Devastating damage at any range.',
    icon:        '🌑',
    inputs:      [{ material: Material.Voidstone, quantity: 3 }, { material: Material.Darkite, quantity: 2 }],
    outputId:    'void_lance',
    outputQty:   1,
  },
  {
    id:          'resonance_beam',
    name:        'Resonance Beam',
    description: 'Diamond-tuned laser with extreme fire rate.',
    icon:        '💎',
    inputs:      [{ material: Material.Diamond, quantity: 3 }, { material: Material.Crystal, quantity: 2 }],
    outputId:    'resonance_beam',
    outputQty:   1,
  },
  {
    id:          'placer_laser',
    name:        'Placer Laser',
    description: 'Right-click to place blocks from your inventory. Build walls and structures.',
    icon:        '🧱',
    inputs:      [{ material: Material.Iron, quantity: 4 }, { material: Material.Crystal, quantity: 1 }],
    outputId:    'placer_laser',
    outputQty:   1,
  },
  {
    id:          'spread_cannon',
    name:        'Spread Cannon',
    description: 'Fires 3 shots in a wide arc. Devastating up close.',
    icon:        '💥',
    inputs:      [{ material: Material.Iron, quantity: 5 }, { material: Material.Rock, quantity: 3 }],
    outputId:    'spread_cannon',
    outputQty:   1,
  },
  {
    id:          'missile_launcher',
    name:        'Missile Launcher',
    description: 'Fires homing rockets that steer toward your mouse cursor.',
    icon:        '🚀',
    inputs:      [{ material: Material.Gold, quantity: 4 }, { material: Material.Crystal, quantity: 2 }],
    outputId:    'missile_launcher',
    outputQty:   1,
  },
];

export interface ToolbarItemDef {
  id:          string;
  name:        string;
  icon:        string;
  color:       string;
  /** 'weapon' fires projectiles; 'tool' mines blocks; 'upgrade' is passive; 'placer' places blocks */
  type:        'weapon' | 'tool' | 'upgrade' | 'placer';
  damage:      number;
  fireRate:    number; // shots per second
  projectileSpeed: number;
  projectileColor: string;
  projectileRadius: number;
  /** If > 1, fires this many projectiles in a spread arc. */
  spreadShots?: number;
  /** If true, fired projectile homes toward the mouse cursor. */
  isHoming?: boolean;
}

export const TOOLBAR_ITEM_DEFS: Record<string, ToolbarItemDef> = {
  basic_cannon: {
    id: 'basic_cannon', name: 'Basic Cannon', icon: '🔫', color: '#c07840',
    type: 'weapon', damage: 25, fireRate: 1.5, projectileSpeed: 500,
    projectileColor: '#f0a060', projectileRadius: 5,
  },
  laser_beam: {
    id: 'laser_beam', name: 'Laser Beam', icon: '⚡', color: '#f1c40f',
    type: 'weapon', damage: 15, fireRate: 6, projectileSpeed: 900,
    projectileColor: '#ffe044', projectileRadius: 3,
  },
  mining_laser: {
    id: 'mining_laser', name: 'Mining Laser', icon: '⛏', color: '#7ed6f3',
    type: 'tool', damage: 8, fireRate: 2, projectileSpeed: 600,
    projectileColor: '#7ed6f3', projectileRadius: 3,
  },
  shield_gen:  {
    id: 'shield_gen',  name: 'Shield Gen',  icon: '🛡', color: '#3498db',
    type: 'upgrade', damage: 0, fireRate: 0, projectileSpeed: 0,
    projectileColor: '#3498db', projectileRadius: 0,
  },
  heavy_armor: {
    id: 'heavy_armor', name: 'Heavy Armor', icon: '🔩', color: '#d0e8ff',
    type: 'upgrade', damage: 0, fireRate: 0, projectileSpeed: 0,
    projectileColor: '#d0e8ff', projectileRadius: 0,
  },
  dark_engine: {
    id: 'dark_engine', name: 'Dark Engine', icon: '🌀', color: '#9b59b6',
    type: 'upgrade', damage: 0, fireRate: 0, projectileSpeed: 0,
    projectileColor: '#9b59b6', projectileRadius: 0,
  },
  void_lance: {
    id: 'void_lance', name: 'Void Lance', icon: '🌑', color: '#6c3483',
    type: 'weapon', damage: 80, fireRate: 0.8, projectileSpeed: 750,
    projectileColor: '#b044ff', projectileRadius: 7,
  },
  resonance_beam: {
    id: 'resonance_beam', name: 'Resonance Beam', icon: '💎', color: '#d0eeff',
    type: 'weapon', damage: 12, fireRate: 12, projectileSpeed: 1100,
    projectileColor: '#aaddff', projectileRadius: 2,
  },
  placer_laser: {
    id: 'placer_laser', name: 'Placer Laser', icon: '🧱', color: '#2ecc71',
    type: 'placer', damage: 0, fireRate: 3, projectileSpeed: 0,
    projectileColor: '#2ecc71', projectileRadius: 0,
  },
  spread_cannon: {
    id: 'spread_cannon', name: 'Spread Cannon', icon: '💥', color: '#e67e22',
    type: 'weapon', damage: 18, fireRate: 1.3, projectileSpeed: 480,
    projectileColor: '#ff9944', projectileRadius: 5, spreadShots: 3,
  },
  missile_launcher: {
    id: 'missile_launcher', name: 'Missile', icon: '🚀', color: '#ff8800',
    type: 'weapon', damage: 42, fireRate: 0.65, projectileSpeed: 300,
    projectileColor: '#ff8800', projectileRadius: 5, isHoming: true,
  },
};
