import { icon } from './icon';
import { spacing } from './spacing';

// Spec 06 section 4.1, Q-36. Layer paints and parallax factors are in stars.ts.
export const starfield = {
  count: { header: 60, full: 120 },
  twinkleMin: 0.55,
  lightOpacity: 0.28,
  nebula: {
    opacity: 0.18,
    blurSigma: 0.08,
    clouds: [
      { color: 'nebulaA', x: 0.25, y: 0.25, radius: 0.6 },
      { color: 'nebulaB', x: 0.75, y: 0.65, radius: 0.5 },
    ],
  },
} as const;

// Spec 06 section 4.2. Interior glyph size and ring stroke follow the icons;
// spark size follows the spacing scale (visual choices for P4-2 review).
export const starCheck = {
  size: 28,
  strokeWidth: icon.strokeWidth,
  // Q-37: the light-theme starText outline.
  outlineWidth: icon.strokeWidth,
  starRadius: icon.small / 2,
  pressScale: 0.92,
  ignitionScale: 1.15,
} as const;

export const sparks = {
  count: 6,
  distance: spacing.md,
  size: spacing.xxs,
  firstAngle: -Math.PI / 2,
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
