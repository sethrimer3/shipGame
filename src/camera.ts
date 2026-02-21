import { Vec2 } from './types';

/** 2-D camera that maps world coordinates → screen coordinates. */
export class Camera {
  /** World-space position the camera is centred on. */
  position: Vec2 = { x: 0, y: 0 };
  zoom = 1;

  private width  = 800;
  private height = 600;

  resize(w: number, h: number): void {
    this.width  = w;
    this.height = h;
  }

  /** Smoothly follow a target world position. */
  follow(target: Vec2, dt: number, speed = 8): void {
    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;
    const t  = Math.min(1, speed * dt);
    this.position = { x: this.position.x + dx * t, y: this.position.y + dy * t };
  }

  /** Convert a world-space point to canvas (screen) coordinates. */
  worldToScreen(world: Vec2): Vec2 {
    return {
      x: (world.x - this.position.x) * this.zoom + this.width  / 2,
      y: (world.y - this.position.y) * this.zoom + this.height / 2,
    };
  }

  /** Convert canvas coordinates back to world-space. */
  screenToWorld(screen: Vec2): Vec2 {
    return {
      x: (screen.x - this.width  / 2) / this.zoom + this.position.x,
      y: (screen.y - this.height / 2) / this.zoom + this.position.y,
    };
  }

  /** Apply camera transform to the canvas context. */
  begin(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.position.x, -this.position.y);
  }

  end(ctx: CanvasRenderingContext2D): void { ctx.restore(); }
}
