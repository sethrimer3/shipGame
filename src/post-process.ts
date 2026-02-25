// ── Post-Process Renderer ─────────────────────────────────────────────────
// Applies screen-space shader effects (vignette, bloom) after world rendering.

import { GraphicsConfig } from './graphics-settings';

export class PostProcessRenderer {
  /** Offscreen canvas used for the bloom blur pass. */
  private bloomCanvas:  HTMLCanvasElement | null = null;
  private bloomCtx:     CanvasRenderingContext2D | null = null;

  /**
   * Apply post-processing effects on top of the already-rendered main canvas.
   * Must be called after all world / HUD rendering is complete.
   */
  draw(
    ctx:    CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    config: GraphicsConfig,
  ): void {
    const w = source.width;
    const h = source.height;

    if (config.postProcessBloom) {
      this._drawBloom(ctx, source, w, h);
    }

    if (config.postProcessVignette) {
      this._drawVignette(ctx, w, h);
    }
  }

  // ── Vignette ─────────────────────────────────────────────────────────────
  private _drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const r  = Math.sqrt(cx * cx + cy * cy) * 1.05;

    const grad = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
    grad.addColorStop(0,   'rgba(0,0,0,0)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0)');
    grad.addColorStop(1,   'rgba(0,0,0,0.72)');

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // ── Bloom ─────────────────────────────────────────────────────────────────
  // Draws a blurred copy of the source canvas back on top with screen blending
  // to simulate HDR bloom on bright pixels.
  private _drawBloom(
    ctx:    CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    w:      number,
    h:      number,
  ): void {
    // Ensure the offscreen bloom canvas matches the current viewport size.
    if (!this.bloomCanvas || this.bloomCanvas.width !== w || this.bloomCanvas.height !== h) {
      this.bloomCanvas = document.createElement('canvas');
      this.bloomCanvas.width  = w;
      this.bloomCanvas.height = h;
      this.bloomCtx = this.bloomCanvas.getContext('2d');
    }
    const bCtx = this.bloomCtx;
    if (!bCtx) return;

    bCtx.clearRect(0, 0, w, h);
    bCtx.filter = 'blur(6px)';
    bCtx.drawImage(source, 0, 0);
    bCtx.filter = 'none';

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.22;
    ctx.drawImage(this.bloomCanvas, 0, 0);
    ctx.restore();
  }
}
