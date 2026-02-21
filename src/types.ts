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
  Rock     = 'Rock',
  Iron     = 'Iron',
  Gold     = 'Gold',
  Crystal  = 'Crystal',
  Titanium = 'Titanium',
  Darkite  = 'Darkite',
}

export interface MaterialProps {
  color:     string;
  hardness:  number;  // HP of a block made of this material
  rarity:    number;  // 0=common … 1=very rare
  minDist:   number;  // minimum world distance from origin to spawn (px)
  value:     number;  // crafting "weight"
}

export const MATERIAL_PROPS: Record<Material, MaterialProps> = {
  [Material.Rock]:     { color: '#8d8d8d', hardness: 20,  rarity: 0.00, minDist: 0,      value: 1  },
  [Material.Iron]:     { color: '#c07840', hardness: 40,  rarity: 0.20, minDist: 800,    value: 3  },
  [Material.Gold]:     { color: '#f1c40f', hardness: 30,  rarity: 0.45, minDist: 2000,   value: 8  },
  [Material.Crystal]:  { color: '#7ed6f3', hardness: 25,  rarity: 0.65, minDist: 4000,   value: 15 },
  [Material.Titanium]: { color: '#d0e8ff', hardness: 80,  rarity: 0.80, minDist: 7000,   value: 30 },
  [Material.Darkite]:  { color: '#9b59b6', hardness: 100, rarity: 0.93, minDist: 12000,  value: 60 },
};

/** Returns a weighted random material appropriate for a given world distance. */
export function pickMaterial(distFromOrigin: number, rng: () => number): Material {
  const candidates = (Object.values(Material) as Material[]).filter(
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
];

export interface ToolbarItemDef {
  id:          string;
  name:        string;
  icon:        string;
  color:       string;
  /** 'weapon' fires projectiles; 'tool' mines blocks; 'upgrade' is passive */
  type:        'weapon' | 'tool' | 'upgrade';
  damage:      number;
  fireRate:    number; // shots per second
  projectileSpeed: number;
  projectileColor: string;
  projectileRadius: number;
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
    type: 'tool', damage: 50, fireRate: 3, projectileSpeed: 700,
    projectileColor: '#7ed6f3', projectileRadius: 4,
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
};
