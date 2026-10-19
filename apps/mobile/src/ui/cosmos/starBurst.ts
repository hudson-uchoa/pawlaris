import type { StarTint } from './sky';
import { burst as tokens, starTints } from '../tokens/cosmos';
import { mulberry32 } from './random';

export type BurstParticle = {
  kind: 'sparkle' | 'mote';
  angle: number;
  speed: number;
  size: number;
  tint: StarTint | 'star';
};
export type StarBurst = {
  particles: BurstParticle[];
  ring: { fromRadius: number; toRadius: number; strokeWidth: number; alpha: number; duration: number };
};

export function generateStarBurst(occurrenceKey: string): StarBurst {
  let seed = 2166136261;
  for (const character of occurrenceKey) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  const next = mulberry32(seed);
  const tints = [...starTints, 'star'] as const;
  const particles = Array.from({ length: tokens.count }, (_, index): BurstParticle => ({
    kind: index < tokens.sparkles ? 'sparkle' : 'mote',
    angle: index * 2 * Math.PI / tokens.count + (next() * 2 - 1) * tokens.jitter * Math.PI / 180,
    speed: tokens.speed[0] + next() * (tokens.speed[1] - tokens.speed[0]),
    size: tokens.size[0] + next() * (tokens.size[1] - tokens.size[0]),
    tint: tints[Math.floor(next() * tints.length)] ?? 'star',
  }));
  return { particles, ring: { ...tokens.ring } };
}
