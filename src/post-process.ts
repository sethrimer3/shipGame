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
    gameTimeSec = 0,
  ): void {
    const w = source.width;
    const h = source.height;

    if (config.postProcessBloom) {
      this._drawBloom(ctx, source, w, h);
    }

    if (config.postProcessBloom || config.postProcessVignette) {
      this._drawCinematicColorWash(ctx, w, h, gameTimeSec);
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

    const grad = ctx.createRadialGradient(cx, cy, r * 0.28, cx, cy, r);
    grad.addColorStop(0,   'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(0.78, 'rgba(0,0,0,0.22)');
    grad.addColorStop(1,   'rgba(0,0,0,0.84)');

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
    bCtx.filter = 'blur(8px)';
    bCtx.drawImage(source, 0, 0);
    bCtx.filter = 'none';

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.30;
    ctx.drawImage(this.bloomCanvas, 0, 0);
    ctx.restore();
  }

  // ── Cinematic color wash ──────────────────────────────────────────────────
  // Adds subtle warm/cool drifting glows to increase depth and contrast.
  private _drawCinematicColorWash(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    gameTimeSec: number,
  ): void {
    const driftX = Math.sin(gameTimeSec * 0.07);
    const driftY = Math.cos(gameTimeSec * 0.05);
    const warmX = w * (0.18 + 0.04 * driftX);
    const warmY = h * (0.76 + 0.03 * driftY);
    const coolX = w * (0.82 - 0.04 * driftY);
    const coolY = h * (0.22 + 0.03 * driftX);
    const radius = Math.max(w, h) * 0.85;

    const warm = ctx.createRadialGradient(warmX, warmY, 0, warmX, warmY, radius);
    warm.addColorStop(0, 'rgba(255,140,80,0.08)');
    warm.addColorStop(1, 'rgba(255,140,80,0)');

    const cool = ctx.createRadialGradient(coolX, coolY, 0, coolX, coolY, radius);
    cool.addColorStop(0, 'rgba(90,170,255,0.07)');
    cool.addColorStop(1, 'rgba(90,170,255,0)');

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
