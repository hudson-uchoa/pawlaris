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
