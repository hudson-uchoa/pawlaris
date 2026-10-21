import { burst as tokens, starTints } from '../../tokens/cosmos';
import { generateStarBurst } from '../starBurst';

test('06 §4.2 a seeded burst emits eight sparkles, six motes and a shockwave ring', () => {
  const occurrenceKey = 'care|2026-10-19|08:00';
  const burst = generateStarBurst(occurrenceKey);
  expect(generateStarBurst(occurrenceKey)).toEqual(burst);
  expect(generateStarBurst('care|2026-10-19|20:00')).not.toEqual(burst);
  expect(burst.particles).toHaveLength(14);
  expect(burst.particles.filter((particle) => particle.kind === 'sparkle')).toHaveLength(8);
  expect(burst.particles.filter((particle) => particle.kind === 'mote')).toHaveLength(6);
  for (const particle of burst.particles) {
    expect(particle.speed).toBeGreaterThanOrEqual(40);
    expect(particle.speed).toBeLessThanOrEqual(110);
    expect(particle.size).toBeGreaterThanOrEqual(1.5);
    expect(particle.size).toBeLessThanOrEqual(4);
    expect([...starTints, 'star']).toContain(particle.tint);
    expect(Number.isFinite(particle.angle)).toBe(true);
  }
  expect(burst.ring).toEqual({ fromRadius: 14, toRadius: 40, strokeWidth: 1.5, alpha: 0.6, duration: tokens.ring.duration });
});
