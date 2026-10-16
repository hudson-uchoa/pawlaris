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
