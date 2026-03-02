import { Vec2 } from './types';
import { GraphicsConfig } from './graphics-settings';

const STAR_WRAP_SIZE = 4000;
/** Wrap size for Milky Way dust particles (much larger field, very slow parallax). */
const MILKY_WAY_WRAP_SIZE = 8000;

type ReworkedStarData = {
    x: number;
    y: number;
    sizePx: number;
    haloScale: number;
    brightness: number;
    colorRgb: [number, number, number];
    colorIndex: number;
    flickerHz: number;
    phase: number;
    hasChromaticAberration: boolean;
};

type ReworkedStarLayer = {
    stars: ReworkedStarData[];
    parallaxFactor: number;
};

export class StarfieldRenderer {
    private readonly cinematicOrangePaletteRgb: Array<[number, number, number]> = [
        [255, 178, 26],
        [255, 191, 104],
        [249, 216, 162],
        [255, 235, 198],
        [255, 246, 228],
        [241, 245, 251],
        [232, 239, 255],
    ];

    private readonly reworkedParallaxStarLayers: ReworkedStarLayer[] = [];
    private readonly reworkedStarCoreCacheByPalette: HTMLCanvasElement[];
    private readonly reworkedStarHaloCacheByPalette: HTMLCanvasElement[];

    // ── Milky Way band data ────────────────────────────────────────────────
    private readonly _milkyWayDust: Array<{ x: number; y: number; r: number; alpha: number }> = [];
    /** Pre-rendered soft-glow blob for Milky Way dust. */
    private readonly _milkyWayBlob: HTMLCanvasElement;

    constructor() {
        this.reworkedStarCoreCacheByPalette = this.cinematicOrangePaletteRgb.map(
            (c) => this.createStarCoreCacheCanvas(c)
        );
        this.reworkedStarHaloCacheByPalette = this.cinematicOrangePaletteRgb.map(
            (c) => this.createStarHaloCacheCanvas(c)
        );
        this._milkyWayBlob = this._createMilkyWayBlob();
        this.initializeReworkedParallaxStarLayers();
        this._initMilkyWayDust();
    }

    private initializeReworkedParallaxStarLayers(): void {
        let seed = 7331;
        const seededRandom = (): number => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };

        const layerConfigs = [
            { count: 2400, parallaxFactor: 0.22, sizeMinPx: 0.8, sizeMaxPx: 2.1 },
            { count: 1700, parallaxFactor: 0.30, sizeMinPx: 1.0, sizeMaxPx: 2.5 },
            { count: 1100, parallaxFactor: 0.38, sizeMinPx: 1.2, sizeMaxPx: 2.9 },
        ];

        for (const layerConfig of layerConfigs) {
            const stars: ReworkedStarData[] = [];
            for (let i = 0; i < layerConfig.count; i++) {
                const sizePx = layerConfig.sizeMinPx +
                    seededRandom() * (layerConfig.sizeMaxPx - layerConfig.sizeMinPx);
                const brightness = 0.48 + seededRandom() * 0.5;
                const colorIndex = this.samplePaletteIndex(seededRandom());
                stars.push({
                    x: seededRandom() * STAR_WRAP_SIZE - STAR_WRAP_SIZE / 2,
                    y: seededRandom() * STAR_WRAP_SIZE - STAR_WRAP_SIZE / 2,
                    sizePx,
                    haloScale: 3.6 + seededRandom() * 2.4,
                    brightness,
                    colorRgb: this.cinematicOrangePaletteRgb[colorIndex],
                    colorIndex,
                    flickerHz: 0.08 + seededRandom() * 0.1,
                    phase: seededRandom() * Math.PI * 2,
                    hasChromaticAberration: sizePx > 2.05 && brightness > 0.8 && seededRandom() > 0.45,
                });
            }
            this.reworkedParallaxStarLayers.push({
                stars,
                parallaxFactor: layerConfig.parallaxFactor,
            });
        }
    }

    private samplePaletteIndex(r: number): number {
        if (r < 0.20) return 0;
        if (r < 0.36) return 1;
        if (r < 0.52) return 2;
        if (r < 0.68) return 3;
        if (r < 0.82) return 4;
        if (r < 0.92) return 5;
        return 6;
    }

    // ── Milky Way helpers ──────────────────────────────────────────────────
    private _createMilkyWayBlob(): HTMLCanvasElement {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width  = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;
        const c = size * 0.5;
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        g.addColorStop(0,   'rgba(200,210,255,1)');
        g.addColorStop(0.4, 'rgba(180,190,240,0.55)');
        g.addColorStop(1,   'rgba(160,170,220,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c, c, c, 0, Math.PI * 2);
        ctx.fill();
        return canvas;
    }

    private _initMilkyWayDust(): void {
        let seed = 9173;
        const rng = (): number => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };
        // Band runs at ~35° angle; dust particles cluster near the centreline
        // using rng()*rng() for a peaked (non-uniform) cross-band distribution.
        const bandCount = 3800;
        /** Half-width of the Milky Way band in world units — particles spread up to ±620wu from the centreline. */
        const BAND_HALF_WIDTH = 620;
        for (let i = 0; i < bandCount; i++) {
            const along = (rng() - 0.5) * MILKY_WAY_WRAP_SIZE;
            const across = (rng() < 0.5 ? -1 : 1) * rng() * rng() * BAND_HALF_WIDTH;
            const cosA = Math.cos(0.61); // ~35°
            const sinA = Math.sin(0.61);
            this._milkyWayDust.push({
                x: along * cosA - across * sinA,
                y: along * sinA + across * cosA,
                r: 1.8 + rng() * 5.5,
                alpha: 0.04 + rng() * 0.10,
            });
        }
    }

    private createStarCoreCacheCanvas(colorRgb: [number, number, number]): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;
        const c = canvas.width * 0.5;
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        g.addColorStop(0,    'rgba(255,255,255,1)');
        g.addColorStop(0.18, `rgba(${colorRgb[0]},${colorRgb[1]},${colorRgb[2]},0.95)`);
        g.addColorStop(0.5,  `rgba(${colorRgb[0]},${colorRgb[1]},${colorRgb[2]},0.44)`);
        g.addColorStop(1,    `rgba(${colorRgb[0]},${colorRgb[1]},${colorRgb[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c, c, c, 0, Math.PI * 2);
        ctx.fill();
        return canvas;
    }

    private createStarHaloCacheCanvas(colorRgb: [number, number, number]): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;
        const c = canvas.width * 0.5;
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        g.addColorStop(0,    `rgba(${colorRgb[0]},${colorRgb[1]},${colorRgb[2]},0.36)`);
        g.addColorStop(0.30, `rgba(${colorRgb[0]},${colorRgb[1]},${colorRgb[2]},0.18)`);
        g.addColorStop(0.75, `rgba(${colorRgb[0]},${colorRgb[1]},${colorRgb[2]},0.05)`);
        g.addColorStop(1,    `rgba(${colorRgb[0]},${colorRgb[1]},${colorRgb[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c, c, c, 0, Math.PI * 2);
        ctx.fill();
        return canvas;
    }

    draw(
        ctx: CanvasRenderingContext2D,
        cameraPos: Vec2,
        screenWidth: number,
        screenHeight: number,
        config: GraphicsConfig,
    ): void {
        const centerX = screenWidth * 0.5;
        const centerY = screenHeight * 0.5;
        const wrapSpanX = centerX * 2 + STAR_WRAP_SIZE;
        const wrapSpanY = centerY * 2 + STAR_WRAP_SIZE;
        const milkyWrapSpanX = centerX * 2 + MILKY_WAY_WRAP_SIZE;
        const milkyWrapSpanY = centerY * 2 + MILKY_WAY_WRAP_SIZE;
        const cameraX = cameraPos.x;
        const cameraY = cameraPos.y;
        const nowSeconds = performance.now() * 0.001;

        // ── Milky Way dust band (drawn first, deepest background) ──────────
        if (config.starHalos) {
            const milkyParallaxX = cameraX * 0.08;
            const milkyParallaxY = cameraY * 0.08;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const drawCount = Math.ceil(this._milkyWayDust.length * config.starCountMultiplier);
            for (let i = 0; i < drawCount; i++) {
                const d = this._milkyWayDust[i];
                const screenX = centerX + (d.x - milkyParallaxX);
                const screenY = centerY + (d.y - milkyParallaxY);
                const wrappedX = ((screenX + centerX) % milkyWrapSpanX) - centerX;
                const wrappedY = ((screenY + centerY) % milkyWrapSpanY) - centerY;
                if (wrappedX < -d.r - 8 || wrappedX > screenWidth + d.r + 8 ||
                    wrappedY < -d.r - 8 || wrappedY > screenHeight + d.r + 8) continue;
                ctx.globalAlpha = d.alpha;
                ctx.drawImage(
                    this._milkyWayBlob,
                    wrappedX - d.r, wrappedY - d.r,
                    d.r * 2, d.r * 2,
                );
            }
            ctx.globalAlpha = 1;
            ctx.restore();
        }

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        for (const layer of this.reworkedParallaxStarLayers) {
            const parallaxX = cameraX * layer.parallaxFactor;
            const parallaxY = cameraY * layer.parallaxFactor;
            const depthScale = Math.min(1, 0.48 + layer.parallaxFactor * 1.08);
            const depthAlpha = 0.5 + depthScale * 0.5;
            const depthSizeMultiplier = 0.84 + depthScale * 0.62;
            const haloAlphaMultiplier = 0.56 + depthScale * 0.44;

            const drawCount = Math.ceil(layer.stars.length * config.starCountMultiplier);
            for (let si = 0; si < drawCount; si++) {
                const star = layer.stars[si];
                const screenX = centerX + (star.x - parallaxX);
                const screenY = centerY + (star.y - parallaxY);
                const wrappedX = ((screenX + centerX) % wrapSpanX) - centerX;
                const wrappedY = ((screenY + centerY) % wrapSpanY) - centerY;

                if (wrappedX < -140 || wrappedX > screenWidth + 140 ||
                    wrappedY < -140 || wrappedY > screenHeight + 140) {
                    continue;
                }

                const flicker = 1 + 0.03 * Math.sin(
                    star.phase + nowSeconds * Math.PI * 2 * star.flickerHz
                );
                const alpha = star.brightness * flicker * depthAlpha;
                const renderedSizePx = star.sizePx * depthSizeMultiplier;
                const cacheIndex = star.colorIndex;

                const haloRadiusPx = renderedSizePx * star.haloScale;
                if (config.starHalos) {
                    ctx.globalAlpha = alpha * haloAlphaMultiplier;
                    ctx.drawImage(
                        this.reworkedStarHaloCacheByPalette[cacheIndex],
                        wrappedX - haloRadiusPx,
                        wrappedY - haloRadiusPx,
                        haloRadiusPx * 2,
                        haloRadiusPx * 2
                    );
                }

                const coreRadiusPx = renderedSizePx * 0.95;
                ctx.globalAlpha = alpha;
                ctx.drawImage(
                    this.reworkedStarCoreCacheByPalette[cacheIndex],
                    wrappedX - coreRadiusPx,
                    wrappedY - coreRadiusPx,
                    coreRadiusPx * 2,
                    coreRadiusPx * 2
                );

                if (star.hasChromaticAberration && config.starChromaticAberration) {
                    this.renderChromaticAberration(
                        ctx, wrappedX, wrappedY, renderedSizePx, alpha * 0.17, star.colorRgb
                    );
                    this.renderDiffractionSpikes(
                        ctx, wrappedX, wrappedY, renderedSizePx, alpha, star.colorRgb, nowSeconds, star.phase
                    );
                }
            }
        }

        ctx.restore();
        ctx.globalAlpha = 1;
    }

    private renderChromaticAberration(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        sizePx: number,
        alpha: number,
        colorRgb: [number, number, number],
    ): void {
        const offsetPx = Math.min(0.45, sizePx * 0.1);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgba(${Math.min(255, colorRgb[0] + 20)},92,92,0.65)`;
        ctx.beginPath();
        ctx.arc(x - offsetPx, y, sizePx * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(118,${Math.min(255, colorRgb[1] + 16)},255,0.62)`;
        ctx.beginPath();
        ctx.arc(x + offsetPx, y, sizePx * 0.34, 0, Math.PI * 2);
        ctx.fill();
    }

    private renderDiffractionSpikes(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        sizePx: number,
        alpha: number,
        colorRgb: [number, number, number],
        nowSeconds: number,
        phase: number,
    ): void {
        const spikeLenPx = sizePx * 7.5;
        const shimmer    = 0.72 + 0.28 * Math.sin(phase + nowSeconds * 0.9);
        const baseAlpha  = alpha * 0.28 * shimmer;
        const edgeAlpha  = (baseAlpha * 0.55).toFixed(4);
        const coreAlpha  = baseAlpha.toFixed(4);
        const r = colorRgb[0];
        const g = colorRgb[1];
        const b = colorRgb[2];
        const colorStr = `${r},${g},${b}`;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // Four spike directions: horizontal, vertical, diagonal ×2
        const angles = [0, Math.PI * 0.5, Math.PI * 0.25, Math.PI * 0.75];
        for (const angle of angles) {
            const dx = Math.cos(angle);
            const dy = Math.sin(angle);
            const grad = ctx.createLinearGradient(
                x - dx * spikeLenPx, y - dy * spikeLenPx,
                x + dx * spikeLenPx, y + dy * spikeLenPx,
            );
            grad.addColorStop(0,    `rgba(${colorStr},0)`);
            grad.addColorStop(0.42, `rgba(${colorStr},${edgeAlpha})`);
            grad.addColorStop(0.5,  `rgba(255,255,255,${coreAlpha})`);
            grad.addColorStop(0.58, `rgba(${colorStr},${edgeAlpha})`);
            grad.addColorStop(1,    `rgba(${colorStr},0)`);
            ctx.strokeStyle = grad;
            ctx.lineWidth   = Math.max(0.4, sizePx * 0.22);
            ctx.lineCap     = 'round';
            ctx.beginPath();
            ctx.moveTo(x - dx * spikeLenPx, y - dy * spikeLenPx);
            ctx.lineTo(x + dx * spikeLenPx, y + dy * spikeLenPx);
            ctx.stroke();
        }

        ctx.restore();
    }
}
