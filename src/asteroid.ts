import { Vec2, Material, MATERIAL_PROPS, pickMaterial, len, sub } from './types';
import { Block, BLOCK_SIZE, BlockDebris } from './block';

/** A rock formation made of a grid of breakable blocks. */
export class Asteroid {
  readonly blocks: Block[] = [];
  readonly width:  number;
  readonly height: number;
  alive = true;

  constructor(
    public pos: Vec2,
    cols:  number,
    rows:  number,
    distFromOrigin: number,
    rng:   () => number,
  ) {
    this.width  = cols * BLOCK_SIZE;
    this.height = rows * BLOCK_SIZE;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Carve out a rough elliptical shape by skipping corner blocks
        const cx = (c + 0.5) / cols - 0.5;
        const cy = (r + 0.5) / rows - 0.5;
        const ellipse = (cx * cx) / 0.25 + (cy * cy) / 0.25;
        if (ellipse > 1 + (rng() - 0.5) * 0.6) continue;

        const mat = pickMaterial(distFromOrigin, rng);
        this.blocks.push(new Block(mat, c, r));
      }
    }
  }

  /** Check if a world-space point hits any live block; returns that block or null. */
  blockAt(worldPt: Vec2): Block | null {
    const lx = worldPt.x - this.pos.x;
    const ly = worldPt.y - this.pos.y;
    for (const b of this.blocks) {
      if (!b.alive) continue;
      const bx = b.col * BLOCK_SIZE;
      const by = b.row * BLOCK_SIZE;
      if (lx >= bx && lx < bx + BLOCK_SIZE && ly >= by && ly < by + BLOCK_SIZE) {
        return b;
      }
    }
    return null;
  }

  /** Remove a dead block and return debris particles. */
  removeBlock(block: Block, rng: () => number): BlockDebris[] {
    const debris: BlockDebris[] = [];
    const bx = this.pos.x + block.col * BLOCK_SIZE;
    const by = this.pos.y + block.row * BLOCK_SIZE;
    const color = MATERIAL_PROPS[block.material].color;

    for (let i = 0; i < 6; i++) {
      const speed = 40 + rng() * 80;
      const ang   = rng() * Math.PI * 2;
      debris.push({
        pos:      { x: bx + BLOCK_SIZE / 2, y: by + BLOCK_SIZE / 2 },
        vel:      { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
        color,
        lifetime: 0.5 + rng() * 0.6,
        maxLife:  1.1,
      });
    }

    if (this.blocks.every(b => !b.alive)) this.alive = false;
    return debris;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const b of this.blocks) {
      if (b.alive) b.draw(ctx, this.pos.x, this.pos.y);
    }
  }

  /** Returns the material drop for a destroyed block. */
  static resourceDrop(mat: Material): { material: Material; qty: number } {
    return { material: mat, qty: Math.floor(Math.random() * 2) + 1 };
  }

  /** Rough world-space radius used for collision culling. */
  get radius(): number {
    return Math.max(this.width, this.height) / 2;
  }

  /** Centre of the asteroid in world space. */
  get centre(): Vec2 {
    return { x: this.pos.x + this.width / 2, y: this.pos.y + this.height / 2 };
  }
}
