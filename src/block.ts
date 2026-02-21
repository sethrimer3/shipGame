import { Vec2, Material, MATERIAL_PROPS } from './types';

const BLOCK_SIZE = 20; // pixels per block

export class Block {
  hp:     number;
  maxHp:  number;
  alive   = true;

  constructor(
    public readonly material: Material,
    /** Grid-local column index. */
    public readonly col:      number,
    /** Grid-local row index. */
    public readonly row:      number,
  ) {
    this.maxHp = MATERIAL_PROPS[material].hardness;
    this.hp    = this.maxHp;
  }

  /** Returns true if the block died from this hit. */
  damage(amount: number): boolean {
    this.hp -= amount;
    if (this.hp <= 0) { this.alive = false; return true; }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D, worldX: number, worldY: number): void {
    const props  = MATERIAL_PROPS[this.material];
    const x = worldX + this.col * BLOCK_SIZE;
    const y = worldY + this.row * BLOCK_SIZE;

    ctx.fillStyle = props.color;
    ctx.fillRect(x, y, BLOCK_SIZE, BLOCK_SIZE);

    // Damage overlay
    if (this.hp < this.maxHp) {
      const ratio = 1 - this.hp / this.maxHp;
      ctx.fillStyle = `rgba(0,0,0,${ratio * 0.6})`;
      ctx.fillRect(x, y, BLOCK_SIZE, BLOCK_SIZE);
    }

    // Grid outline
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(x, y, BLOCK_SIZE, BLOCK_SIZE);
  }

  /** World-space bounding box of this block (given the asteroid's world origin). */
  bounds(worldX: number, worldY: number): { x: number; y: number; w: number; h: number } {
    return {
      x: worldX + this.col * BLOCK_SIZE,
      y: worldY + this.row * BLOCK_SIZE,
      w: BLOCK_SIZE,
      h: BLOCK_SIZE,
    };
  }
}

export { BLOCK_SIZE };

/** Particle-style debris created when a block is destroyed. */
export interface BlockDebris {
  pos:      Vec2;
  vel:      Vec2;
  color:    string;
  lifetime: number; // seconds
  maxLife:  number;
}
