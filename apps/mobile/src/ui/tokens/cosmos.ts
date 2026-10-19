import { icon } from './icon';
import { spacing } from './spacing';

// Spec 06 section 4.1: colour temperatures and muted planet colours.
export const starTints = ['#CFE0FF', '#FFFFFF', '#FFF1D6', '#FFD0A0', '#FFB4A0'] as const;
export const planetTints = ['#C8A27A', '#9DB8B2', '#B9A5C9'] as const;
export const morningStarTint = '#FFF6E0';

// Spec 06 section 4.1, Q-36 and Q-52. Times are milliseconds, lengths dp.
export const starfield = {
  count: { header: 70, band: 70, full: 160 },
  magnitudeWeights: [1, 3, 8, 18, 30, 40],
  tintWeights: [15, 45, 25, 10, 5],
  period: [1800, 6000],
  radius: { minimum: 0.5, step: 0.35 },
  alpha: { minimum: 0.25, step: 0.14 },
  amplitude: [0.15, 0.35, 0.5],
  parallax: [0.16, 0.08, 0.04],
  halo: { radius: 4, alpha: 0.25 },
  spikes: { radius: 6 },
  sprite: { size: 32, radius: 8 },
  lightOpacity: 0.4,
  planet: { radius: [1.6, 2.4], alpha: [0.45, 0.6] },
  morning: { radius: 2.4, alpha: 0.9, y: 0.8, x: 0.65 },
  band: { angle: [20, 35], width: 0.25, alpha: 0.1, blur: 0.08,
    dustCount: 300, dustRadius: 0.4, dustAlpha: [0.06, 0.15] },
  meteor: { interval: [18000, 45000], length: [80, 140], angle: [20, 35],
    duration: 700, strokeWidth: 1.75, headRadius: 1.5 },
  satellite: { interval: [60000, 120000], duration: [25000, 40000], radius: 1, alpha: 0.5 },
  scheduleCount: 128,
  nebula: {
    opacity: 0.18,
    minimum: 0.14,
    maximum: 0.22,
    blurSigma: 0.08,
    clouds: [
      { color: 'nebulaA', x: 0.25, y: 0.25, radius: 0.6 },
      { color: 'nebulaB', x: 0.75, y: 0.65, radius: 0.5 },
    ],
  },
} as const;

// Spec 06 section 4.2. Drag is exponential; gravity is dp/s².
export const burst = {
  count: 14, sparkles: 8, jitter: 12, speed: [40, 110], size: [1.5, 4],
  gravity: 30, drag: 2, duration: 700, canvasSize: 192,
  halo: { peak: 1, settled: 0.4, radius: 20 },
  ring: { fromRadius: 14, toRadius: 40, strokeWidth: 1.5, alpha: 0.6, duration: 420 },
} as const;

// Spec 06 section 4.2. Interior glyph size and ring stroke follow the icons.
export const starCheck = {
  size: 28,
  strokeWidth: icon.strokeWidth,
  // Q-37: the light-theme starText outline.
  outlineWidth: icon.strokeWidth,
  starRadius: icon.small / 2,
  pressScale: 0.92,
  ignitionScale: 1.15,
  badgeScale: 0.65,
} as const;

// Spec 06 sections 4.3 and 4.4. Visual choices for P4-2 review.
export const constellation = {
  strokeWidth: icon.strokeWidth,
  color: 'star',
} as const;

export const orbit = {
  strokeWidth: 1.5,
  // Keep the ring's outer edge at the supplied size.
  ringInset: 1.5 / 2,
  satelliteSize: spacing.xxs,
  firstAngle: -Math.PI / 2,
} as const;

// Spec 06 section 4.5, Q-38. Meteor geometry is a visual choice.
export const shootingStars = {
  duration: 1600,
  stagger: 160,
  crossing: 960,
  tailLength: 60,
  headRadius: spacing.xxs / 2,
  tailWidth: icon.strokeWidth,
  startY: [0.05, 0.15, 0.25, 0.35, 0.45],
  verticalTravel: 0.5,
} as const;

// Spec 06 section 4.10. Authored scene layout, delegated for P4-2 review.
// Coordinates and strokes share this box and scale uniformly to fit.
export const illustrations = {
  width: 240,
  height: 160,
  seed: 42,
  strokeWidth: icon.strokeWidth,
  clearSky: {
    crescent: { x: 112, y: 76, radius: 28 },
    stars: [
      { x: 64, y: 44, radius: 4 },
      { x: 168, y: 52, radius: 6 },
      { x: 156, y: 110, radius: 4 },
    ],
  },
  emptyPets: {
    pad: 'M90 100 Q104 78 120 88 Q136 78 150 100 L162 120'
      + ' Q156 138 140 132 Q120 124 100 132 Q84 138 78 120 Z',
    toes: [
      { x: 70, y: 80, radius: 10 },
      { x: 100, y: 50, radius: 12 },
      { x: 140, y: 50, radius: 12 },
      { x: 170, y: 80, radius: 10 },
    ],
    dots: [1, 6],
  },
  emptyWalks: {
    planet: { x: 120, y: 80, radius: 24 },
    orbit: { x: 44, y: 24, width: 152, height: 112 },
    rotation: -Math.PI / 8,
    back: 'M78 80 A42 12 0 0 1 162 80',
    front: 'M78 80 A42 12 0 0 0 162 80',
    dashes: [spacing.xxs, spacing.xs],
  },
  emptyHealth: {
    star: { x: 120, y: 64, radius: 14 },
    horizon: { from: { x: 48, y: 112 }, to: { x: 192, y: 112 } },
  },
} as const;

// Spec 06 section 4.12. Mark geometry remains in glyphs.ts.
export const signature = {
  markSize: 18,
  gap: spacing.xs,
  ringMinOpacity: 0.7,
} as const;
