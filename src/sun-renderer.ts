import { Vec2 } from './types';

const ULTRA_SUN_BLOOM_STEPS = 4;
const SHADOW_LENGTH = 3000;
const SUN_RAYS_BASE_RADIUS_MULT = 6;
const SUN_RAYS_NEAR_FADE_RADIUS_MULT = 10;

type ShadowQuad = {
  sv1x: number; sv1y: number;
  sv2x: number; sv2y: number;
  ss1x: number; ss1y: number;
  ss2x: number; ss2y: number;
};

type SunRenderCache = {
    plasmaLayerA: HTMLCanvasElement;
    plasmaLayerB: HTMLCanvasElement;
};

export class SunRenderer {
    private readonly sunRenderCacheByRadiusBucket = new Map<number, SunRenderCache>();

    // ── Shadow / ray data ────────────────────────────────────────────────────
    /** Offscreen canvas for compositing the lighting + shadow layer. */
    private lightingLayerCanvas: HTMLCanvasElement | null = null;
    private lightingLayerCtx:    CanvasRenderingContext2D | null = null;
    /** Offscreen canvas for a single sun's ambient + shadow pass. */
    private lightingSunPassCanvas: HTMLCanvasElement | null = null;
    private lightingSunPassCtx:    CanvasRenderingContext2D | null = null;

    draw(
        ctx: CanvasRenderingContext2D,
        pos: Vec2,
        radius: number,
        gameTimeSec: number,
    ): void {
        this.drawUltraSun(ctx, pos, radius, gameTimeSec);
    }

    private drawUltraSun(
        ctx: CanvasRenderingContext2D,
        pos: Vec2,
        radius: number,
        gameTimeSec: number,
    ): void {
        const cache = this.getOrCreateSunRenderCache(radius);
        const pulseAmount = 1 + Math.sin(gameTimeSec * 1.2) * 0.012;
        const corePulseAmount = 1 + Math.sin(gameTimeSec * (Math.PI * 2 / 5)) * 0.018;
        const microFlicker = 1 + Math.sin(gameTimeSec * 8.0) * 0.015;
        const animatedRadius = radius * pulseAmount;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // Corona
        const corona = ctx.createRadialGradient(
            pos.x, pos.y, animatedRadius * 0.25,
            pos.x, pos.y, animatedRadius * 2.8
        );
        corona.addColorStop(0,    'rgba(255,246,210,0.52)');
        corona.addColorStop(0.28, 'rgba(255,207,116,0.35)');
        corona.addColorStop(1,    'rgba(255,170,90,0)');
        ctx.fillStyle = corona;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, animatedRadius * 2.8, 0, Math.PI * 2);
        ctx.fill();

        // Clip plasma layers to the solar disc
        ctx.save();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, animatedRadius, 0, Math.PI * 2);
        ctx.clip();

        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(gameTimeSec * 0.04);
        ctx.globalAlpha = 0.84 * microFlicker;
        ctx.drawImage(
            cache.plasmaLayerA,
            -animatedRadius, -animatedRadius,
            animatedRadius * 2, animatedRadius * 2
        );
        ctx.restore();

        const driftX = Math.sin(gameTimeSec * 0.09) * animatedRadius * 0.09;
        const driftY = Math.cos(gameTimeSec * 0.07) * animatedRadius * 0.09;
        ctx.save();
        ctx.translate(pos.x + driftX, pos.y + driftY);
        ctx.rotate(-gameTimeSec * 0.032);
        ctx.globalAlpha = 0.66;
        ctx.drawImage(
            cache.plasmaLayerB,
            -animatedRadius, -animatedRadius,
            animatedRadius * 2, animatedRadius * 2
        );
        ctx.restore();

        ctx.restore(); // end disc clip

        // Hard bright core
        const coreRadius = animatedRadius * 0.34 * corePulseAmount;
        const hardCore = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, coreRadius);
        hardCore.addColorStop(0,    'rgba(255,255,255,1)');
        hardCore.addColorStop(0.30, 'rgba(255,255,248,0.98)');
        hardCore.addColorStop(0.68, 'rgba(255,246,206,0.9)');
        hardCore.addColorStop(1,    'rgba(255,236,170,0.14)');
        ctx.fillStyle = hardCore;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, coreRadius, 0, Math.PI * 2);
        ctx.fill();

        // White disc at center
        ctx.fillStyle = 'rgba(255,255,255,0.96)';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, animatedRadius * 0.16 * corePulseAmount, 0, Math.PI * 2);
        ctx.fill();

        // Surface gradient overlay
        const surfaceGradient = ctx.createRadialGradient(
            pos.x, pos.y, animatedRadius * 0.15,
            pos.x, pos.y, animatedRadius
        );
        surfaceGradient.addColorStop(0,    'rgba(255,247,190,0.6)');
        surfaceGradient.addColorStop(0.65, 'rgba(255,180,75,0.42)');
        surfaceGradient.addColorStop(1,    'rgba(255,124,45,0.2)');
        ctx.fillStyle = surfaceGradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, animatedRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        this.drawUltraSunBloom(ctx, pos, animatedRadius);
    }

    private drawUltraSunBloom(
        ctx: CanvasRenderingContext2D,
        pos: Vec2,
        screenRadius: number,
    ): void {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';

        for (let i = 0; i < ULTRA_SUN_BLOOM_STEPS; i++) {
            const t = i / Math.max(1, ULTRA_SUN_BLOOM_STEPS - 1);
            const radius = screenRadius * (1.15 + t * 2.65);
            const alpha = 0.2 * (1 - t);
            const radiusBucket = Math.round(radius / 16) * 16;
            const innerRadius = radiusBucket * 0.22;

            const bloom = ctx.createRadialGradient(
                pos.x, pos.y, innerRadius,
                pos.x, pos.y, radiusBucket
            );
            bloom.addColorStop(0,    `rgba(255,250,225,${Math.min(0.5, alpha * 2.2).toFixed(4)})`);
            bloom.addColorStop(0.45, `rgba(255,200,115,${alpha.toFixed(4)})`);
            bloom.addColorStop(1,    'rgba(255,140,70,0)');

            ctx.save();
            ctx.fillStyle = bloom;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radiusBucket, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Cinematic anamorphic horizontal stretch
        ctx.globalAlpha = 0.23;
        const stretchR = Math.round(screenRadius * 2.9 / 16) * 16;
        const stretchMinorAxis = Math.round(screenRadius * 1.85 / 16) * 16;
        const hStretch = ctx.createRadialGradient(
            pos.x, pos.y, stretchR * (0.3 / 2.9),
            pos.x, pos.y, stretchR
        );
        hStretch.addColorStop(0,   'rgba(255,242,186,0.42)');
        hStretch.addColorStop(0.4, 'rgba(255,212,120,0.18)');
        hStretch.addColorStop(1,   'rgba(255,170,95,0)');
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.beginPath();
        ctx.ellipse(0, 0, stretchR, stretchMinorAxis, 0, 0, Math.PI * 2);
        ctx.fillStyle = hStretch;
        ctx.fill();
        ctx.restore();

        ctx.restore();
    }

    private getOrCreateSunRenderCache(radius: number): SunRenderCache {
        const radiusBucket = Math.max(48, Math.round(radius / 16) * 16);
        const existing = this.sunRenderCacheByRadiusBucket.get(radiusBucket);
        if (existing) return existing;

        const hashNorm = (v: number): number =>
            (Math.abs(Math.sin(v * 12.9898 + 78.233) * 43758.5453) % 1);

        const textureSize = Math.max(128, radiusBucket * 2);

        const buildPlasmaLayer = (seedOffset: number): HTMLCanvasElement => {
            const canvas = document.createElement('canvas');
            canvas.width  = textureSize;
            canvas.height = textureSize;
            const ctx = canvas.getContext('2d');
            if (!ctx) return canvas;

            const imageData = ctx.createImageData(textureSize, textureSize);
            const data = imageData.data;
            const center = textureSize * 0.5;
            const invSize = 1 / textureSize;

            for (let py = 0; py < textureSize; py++) {
                for (let px = 0; px < textureSize; px++) {
                    const dx = (px - center) * invSize;
                    const dy = (py - center) * invSize;
                    const radialDist = Math.sqrt(dx * dx + dy * dy);
                    const falloff = Math.max(0, 1 - radialDist * 2.0);
                    const n1 = hashNorm((px + seedOffset * 17) * 0.093 + (py + seedOffset * 13) * 0.061);
                    const n2 = hashNorm((px - seedOffset * 19) * 0.143 + (py - seedOffset * 11) * 0.109);
                    const plasma = Math.max(0, Math.min(1, n1 * 0.6 + n2 * 0.4));
                    const brightness = Math.pow(falloff, 0.72) * (0.62 + plasma * 0.68);
                    const idx = (py * textureSize + px) * 4;
                    data[idx]     = Math.min(255, Math.round(255 * (0.96 + brightness * 0.04)));
                    data[idx + 1] = Math.min(255, Math.round(145 + brightness * 110));
                    data[idx + 2] = Math.min(255, Math.round(38  + brightness * 70));
                    data[idx + 3] = Math.floor(255 * Math.max(0, falloff));
                }
            }

            ctx.putImageData(imageData, 0, 0);

            ctx.globalCompositeOperation = 'lighter';
            const whiteCore = ctx.createRadialGradient(
                center, center, 0,
                center, center, textureSize * 0.24
            );
            whiteCore.addColorStop(0, 'rgba(255,255,255,0.95)');
            whiteCore.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = whiteCore;
            ctx.beginPath();
            ctx.arc(center, center, textureSize * 0.24, 0, Math.PI * 2);
            ctx.fill();

            return canvas;
        };

        const cache: SunRenderCache = {
            plasmaLayerA: buildPlasmaLayer(1),
            plasmaLayerB: buildPlasmaLayer(2),
        };
        this.sunRenderCacheByRadiusBucket.set(radiusBucket, cache);
        return cache;
    }

    private ensureLightingLayer(w: number, h: number): CanvasRenderingContext2D {
        if (!this.lightingLayerCanvas || this.lightingLayerCanvas.width !== w || this.lightingLayerCanvas.height !== h) {
            this.lightingLayerCanvas = document.createElement('canvas');
            this.lightingLayerCanvas.width  = w;
            this.lightingLayerCanvas.height = h;
            this.lightingLayerCtx = this.lightingLayerCanvas.getContext('2d');
            if (!this.lightingLayerCtx) throw new Error('Failed to get 2D context for lightingLayerCanvas');
        }
        const ctx = this.lightingLayerCtx!;
        ctx.clearRect(0, 0, w, h);
        return ctx;
    }

    private ensureSunPassLayer(w: number, h: number): CanvasRenderingContext2D {
        if (!this.lightingSunPassCanvas || this.lightingSunPassCanvas.width !== w || this.lightingSunPassCanvas.height !== h) {
            this.lightingSunPassCanvas = document.createElement('canvas');
            this.lightingSunPassCanvas.width  = w;
            this.lightingSunPassCanvas.height = h;
            this.lightingSunPassCtx = this.lightingSunPassCanvas.getContext('2d');
            if (!this.lightingSunPassCtx) throw new Error('Failed to get 2D context for lightingSunPassCanvas');
        }
        const ctx = this.lightingSunPassCtx!;
        ctx.clearRect(0, 0, w, h);
        return ctx;
    }

    private appendShadowQuadsFromVertices(
        sunPos: Vec2,
        worldVerts: Vec2[],
        quads: ShadowQuad[],
        worldToScreen: (p: Vec2) => Vec2,
    ): void {
        const n = worldVerts.length;
        for (let i = 0; i < n; i++) {
            const v1 = worldVerts[i];
            const v2 = worldVerts[(i + 1) % n];

            // Edge centre and vector to sun
            const ecx = (v1.x + v2.x) * 0.5;
            const ecy = (v1.y + v2.y) * 0.5;
            const toSunX = sunPos.x - ecx;
            const toSunY = sunPos.y - ecy;

            // Outward edge normal (perpendicular to v1→v2, pointing right)
            const edgeDx = v2.x - v1.x;
            const edgeDy = v2.y - v1.y;
            const normalX =  edgeDy;
            const normalY = -edgeDx;

            // Skip front-facing edges (facing toward the sun)
            if (toSunX * normalX + toSunY * normalY >= 0) continue;

            // Compute shadow tip points
            const d1x = v1.x - sunPos.x;
            const d1y = v1.y - sunPos.y;
            const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
            const d2x = v2.x - sunPos.x;
            const d2y = v2.y - sunPos.y;
            const len2 = Math.sqrt(d2x * d2x + d2y * d2y);
            if (len1 < 0.001 || len2 < 0.001) continue;

            const shadow1: Vec2 = {
                x: v1.x + d1x * (SHADOW_LENGTH / len1),
                y: v1.y + d1y * (SHADOW_LENGTH / len1),
            };
            const shadow2: Vec2 = {
                x: v2.x + d2x * (SHADOW_LENGTH / len2),
                y: v2.y + d2y * (SHADOW_LENGTH / len2),
            };

            const sv1 = worldToScreen(v1);
            const sv2 = worldToScreen(v2);
            const ss1 = worldToScreen(shadow1);
            const ss2 = worldToScreen(shadow2);

            quads.push({
                sv1x: sv1.x, sv1y: sv1.y,
                sv2x: sv2.x, sv2y: sv2.y,
                ss1x: ss1.x, ss1y: ss1.y,
                ss2x: ss2.x, ss2y: ss2.y,
            });
        }
    }

    private buildShadowQuads(
        sunPos: Vec2,
        occluders: { verts: Vec2[] }[],
        worldToScreen: (p: Vec2) => Vec2,
    ): ShadowQuad[] {
        const quads: ShadowQuad[] = [];
        for (const occ of occluders) {
            this.appendShadowQuadsFromVertices(sunPos, occ.verts, quads, worldToScreen);
        }
        return quads;
    }

    private aabbVerts(left: number, top: number, right: number, bottom: number): Vec2[] {
        return [
            { x: left,  y: top    },
            { x: right, y: top    },
            { x: right, y: bottom },
            { x: left,  y: bottom },
        ];
    }

    public drawSunRays(
        ctx:           CanvasRenderingContext2D,
        sunPos:        Vec2,
        sunRadius:     number,
        playerPos:     Vec2,
        canvasWidth:   number,
        canvasHeight:  number,
        worldToScreen: (p: Vec2) => Vec2,
        occluders:     { verts: Vec2[] }[],
    ): void {
        const sunScreen = worldToScreen(sunPos);
        const maxRadius = Math.max(canvasWidth, canvasHeight) * 6;

        const sunPassCtx = this.ensureSunPassLayer(canvasWidth, canvasHeight);

        const dxToPlayer = playerPos.x - sunPos.x;
        const dyToPlayer = playerPos.y - sunPos.y;
        const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer);
        const fullyTransparentDistWorld = sunRadius * SUN_RAYS_BASE_RADIUS_MULT;
        const fullyOpaqueDistWorld = sunRadius * SUN_RAYS_NEAR_FADE_RADIUS_MULT;
        const nearSunFadeT = Math.max(0, Math.min(1, (distToPlayer - fullyTransparentDistWorld) / (fullyOpaqueDistWorld - fullyTransparentDistWorld)));

        // Ambient radial gradient centred on the sun
        const ambient = sunPassCtx.createRadialGradient(
            sunScreen.x, sunScreen.y, 0,
            sunScreen.x, sunScreen.y, maxRadius,
        );
        ambient.addColorStop(0,    `rgba(255,192,96,${(0.42 * nearSunFadeT).toFixed(4)})`);
        ambient.addColorStop(0.18, `rgba(255,166,70,${(0.28 * nearSunFadeT).toFixed(4)})`);
        ambient.addColorStop(0.42, `rgba(255,140,56,${(0.16 * nearSunFadeT).toFixed(4)})`);
        ambient.addColorStop(1,    'rgba(255,140,56,0)');
        sunPassCtx.fillStyle = ambient;
        sunPassCtx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Bloom (screen blend)
        sunPassCtx.save();
        sunPassCtx.globalCompositeOperation = 'screen';
        const bloomRadius = maxRadius * 1.15;
        const bloom = sunPassCtx.createRadialGradient(
            sunScreen.x, sunScreen.y, 0,
            sunScreen.x, sunScreen.y, bloomRadius,
        );
        bloom.addColorStop(0,    `rgba(255,220,140,${(0.18 * nearSunFadeT).toFixed(4)})`);
        bloom.addColorStop(0.25, `rgba(255,190,100,${(0.10 * nearSunFadeT).toFixed(4)})`);
        bloom.addColorStop(1,    'rgba(255,140,56,0)');
        sunPassCtx.fillStyle = bloom;
        sunPassCtx.fillRect(0, 0, canvasWidth, canvasHeight);
        sunPassCtx.restore();

        // Build and cut out shadow quads
        const quads = this.buildShadowQuads(sunPos, occluders, worldToScreen);
        if (quads.length > 0) {
            sunPassCtx.save();
            sunPassCtx.globalCompositeOperation = 'destination-out';
            sunPassCtx.fillStyle = 'rgba(0,0,0,1)';
            for (const q of quads) {
                sunPassCtx.beginPath();
                sunPassCtx.moveTo(q.sv1x, q.sv1y);
                sunPassCtx.lineTo(q.sv2x, q.sv2y);
                sunPassCtx.lineTo(q.ss2x, q.ss2y);
                sunPassCtx.lineTo(q.ss1x, q.ss1y);
                sunPassCtx.closePath();
                sunPassCtx.fill();
            }
            sunPassCtx.restore();
        }

        // Blit sun pass onto lighting layer with lighter blend
        const lightingCtx = this.ensureLightingLayer(canvasWidth, canvasHeight);
        lightingCtx.save();
        lightingCtx.globalCompositeOperation = 'lighter';
        lightingCtx.drawImage(sunPassCtx.canvas, 0, 0);
        lightingCtx.restore();

        // Blit lighting layer onto main canvas
        ctx.drawImage(lightingCtx.canvas, 0, 0);
    }
}
