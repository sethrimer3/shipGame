import { Vec2 } from './types';

const STAR_WRAP_SIZE = 4000;

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

    constructor() {
        this.reworkedStarCoreCacheByPalette = this.cinematicOrangePaletteRgb.map(
            (c) => this.createStarCoreCacheCanvas(c)
        );
        this.reworkedStarHaloCacheByPalette = this.cinematicOrangePaletteRgb.map(
            (c) => this.createStarHaloCacheCanvas(c)
        );
        this.initializeReworkedParallaxStarLayers();
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
    ): void {
        const centerX = screenWidth * 0.5;
        const centerY = screenHeight * 0.5;
        const wrapSpanX = centerX * 2 + STAR_WRAP_SIZE;
        const wrapSpanY = centerY * 2 + STAR_WRAP_SIZE;
        const cameraX = cameraPos.x;
        const cameraY = cameraPos.y;
        const nowSeconds = performance.now() * 0.001;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        for (const layer of this.reworkedParallaxStarLayers) {
            const parallaxX = cameraX * layer.parallaxFactor;
            const parallaxY = cameraY * layer.parallaxFactor;
            const depthScale = Math.min(1, 0.48 + layer.parallaxFactor * 1.08);
            const depthAlpha = 0.5 + depthScale * 0.5;
            const depthSizeMultiplier = 0.84 + depthScale * 0.62;
            const haloAlphaMultiplier = 0.56 + depthScale * 0.44;

            for (const star of layer.stars) {
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
                ctx.globalAlpha = alpha * haloAlphaMultiplier;
                ctx.drawImage(
                    this.reworkedStarHaloCacheByPalette[cacheIndex],
                    wrappedX - haloRadiusPx,
                    wrappedY - haloRadiusPx,
                    haloRadiusPx * 2,
                    haloRadiusPx * 2
                );

                const coreRadiusPx = renderedSizePx * 0.95;
                ctx.globalAlpha = alpha;
                ctx.drawImage(
                    this.reworkedStarCoreCacheByPalette[cacheIndex],
                    wrappedX - coreRadiusPx,
                    wrappedY - coreRadiusPx,
                    coreRadiusPx * 2,
                    coreRadiusPx * 2
                );

                if (star.hasChromaticAberration) {
                    this.renderChromaticAberration(
                        ctx, wrappedX, wrappedY, renderedSizePx, alpha * 0.17, star.colorRgb
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
}
