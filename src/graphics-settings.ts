// ── Graphics Quality Settings ──────────────────────────────────────────────

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface GraphicsConfig {
  quality:                    GraphicsQuality;
  /** Fraction of total stars to render (0–1). */
  starCountMultiplier:        number;
  /** Whether to draw the halo glow around each star. */
  starHalos:                  boolean;
  /** Whether to draw chromatic aberration on bright stars. */
  starChromaticAberration:    boolean;
  /** Whether particle motion-blur trails are rendered. */
  particleTrails:             boolean;
  /** Number of bloom passes for the sun (0 = no bloom). */
  sunBloomSteps:              number;
  /** Whether to draw the sun ray / shadow pass. */
  sunShadowRays:              boolean;
  /** Whether to draw a screen-space vignette overlay. */
  postProcessVignette:        boolean;
  /** Whether to draw a screen-space bloom overlay. */
  postProcessBloom:           boolean;
  /** Whether to run planet molecule spring-physics simulation (expensive on large planets). */
  planetMoleculeSimulation:   boolean;
}

export const QUALITY_PRESETS: Record<GraphicsQuality, GraphicsConfig> = {
  low: {
    quality:                 'low',
    starCountMultiplier:     0.35,
    starHalos:               false,
    starChromaticAberration: false,
    particleTrails:          false,
    sunBloomSteps:           0,
    sunShadowRays:           false,
    postProcessVignette:     false,
    postProcessBloom:        false,
    planetMoleculeSimulation: false,
  },
  medium: {
    quality:                 'medium',
    starCountMultiplier:     0.65,
    starHalos:               true,
    starChromaticAberration: false,
    particleTrails:          true,
    sunBloomSteps:           2,
    sunShadowRays:           true,
    postProcessVignette:     true,
    postProcessBloom:        false,
    planetMoleculeSimulation: true,
  },
  high: {
    quality:                 'high',
    starCountMultiplier:     1.0,
    starHalos:               true,
    starChromaticAberration: true,
    particleTrails:          true,
    sunBloomSteps:           4,
    sunShadowRays:           true,
    postProcessVignette:     true,
    postProcessBloom:        true,
    planetMoleculeSimulation: true,
  },
};
