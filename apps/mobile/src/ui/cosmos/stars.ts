export type StarLayer = 0 | 1 | 2;
export type Star = {
  x: number;
  y: number;
  r: number;
  opacity: number;
  layer: StarLayer;
};

// Spec 06 section 4.1, Q-35. The final layer receives the remainder.
export const starLayers = [
  { layer: 0, share: 0.5, radius: 0.6, opacity: 0.35, parallax: 0.04 },
  { layer: 1, share: 0.3, radius: 1.2, opacity: 0.55, parallax: 0.08 },
  { layer: 2, share: 0.2, radius: 1.8, opacity: 0.8, parallax: 0.16 },
] as const;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let sample = Math.imul(state ^ (state >>> 15), state | 1);
    sample ^= sample + Math.imul(sample ^ (sample >>> 7), sample | 61);
    return ((sample ^ (sample >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateStars(seed: number, count: number, width: number, height: number): Star[] {
  const next = mulberry32(seed);
  const farCount = Math.floor(count * starLayers[0].share);
  const middleCount = Math.floor(count * starLayers[1].share);
  const counts = [farCount, middleCount, count - farCount - middleCount] as const;
  return starLayers.flatMap(({ layer, radius, opacity }) =>
    Array.from({ length: counts[layer] }, () => ({
      x: next() * width,
      y: next() * height,
      r: radius,
      opacity,
      layer,
    })));
}
