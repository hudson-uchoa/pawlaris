export const spring = {
  gentle: { damping: 20, stiffness: 180, mass: 1 },
  snappy: { damping: 18, stiffness: 320, mass: 0.8 },
  bouncy: { damping: 11, stiffness: 260, mass: 0.9 },
  stiff: { damping: 26, stiffness: 420, mass: 0.7 },
} as const;

// Spec 06 section 4.7, Q-32. Both sheet dismissal bounds are exclusive.
export const pressScale = 0.97;
export const sheetDismissFraction = 0.3;
export const sheetFlingVelocity = 1000;
// Spec 06 section 4.7: the toast rises and sinks by this distance.
export const toastTravel = 16;

export const duration = {
  micro: 120,
  quick: 200,
  base: 280,
  hero: 320,
  sheet: 380,
  burst: 520,
  // Spec 06 sections 4.8 and 5.
  skeletonSweep: 1400,
  reducedFade: 150,
  walkRoute: 900,
  // Q-62: preserve section 4/6 timings and instantaneous cuts.
  meteor: 700,
  starBurst: 700,
  shockwave: 420,
  celebration: 1600,
  weightChart: 600,
  instant: 0,
} as const;

export const ambient = {
  orbit: 24000,
  syncOrbit: 1200,
  breath: 4000,
  nebula: 20000,
} as const;

export const hold = { toast: 4000, completion: 400 } as const;
