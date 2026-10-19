import type { StarTint } from './sky';

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

export function generateStarBurst(_occurrenceKey: string): StarBurst {
  throw new Error('not implemented');
}
