import { Vec2 } from './types';

/** Tracks keyboard state, mouse canvas position, and scroll wheel. */
export class InputManager {
  private readonly keys = new Set<string>();
  private mouse: Vec2 = { x: 0, y: 0 };
  private _scrollDelta = 0;
  private _mouseDown = false;
  private _mouseRightDown = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', e => {
      this.keys.add(e.key.toLowerCase());
      // Prevent Tab from cycling browser focus
      if (e.key === 'Tab') e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      // Scale for CSS size vs actual canvas resolution
      const scaleX = canvas.width  / r.width;
      const scaleY = canvas.height / r.height;
      this.mouse = { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
    });

    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) this._mouseDown = true;
      if (e.button === 2) this._mouseRightDown = true;
    });
    canvas.addEventListener('mouseup', e => {
      if (e.button === 0) this._mouseDown = false;
      if (e.button === 2) this._mouseRightDown = false;
    });
    // Prevent the context menu from appearing on right-click
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this._scrollDelta += e.deltaY > 0 ? 1 : -1;
    }, { passive: false });
  }

  isDown(key: string): boolean { return this.keys.has(key.toLowerCase()); }
  get mousePos(): Vec2 { return this.mouse; }
  get mouseDown(): boolean { return this._mouseDown; }
  get mouseRightDown(): boolean { return this._mouseRightDown; }

  /** Consume accumulated scroll delta (resets to 0 after reading). */
  consumeScroll(): number {
    const d = this._scrollDelta;
    this._scrollDelta = 0;
    return d;
  }
}
