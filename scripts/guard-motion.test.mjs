import assert from 'node:assert/strict';
import { test } from 'node:test';
import { motionProblems } from './guard-motion.mjs';

for (const [key, value] of [['damping', '20'], ['stiffness', '180'],
  ['mass', '0.8'], ['duration', '150']]) {
  test(`P7-1 refuses a numeric ${key} literal outside motion tokens`, () => {
    assert.deepEqual(motionProblems('apps/mobile/src/ui/cosmos/Effect.tsx',
      `const config = {\n  ${key}: ${value},\n};`), [2]);
  });
}

test('P7-1 allows numeric literals in the one motion tokens file', () => {
  assert.deepEqual(motionProblems('apps/mobile/src/ui/motion/tokens.ts',
    'const config = { damping: 20, stiffness: 180, mass: 1, duration: 120 };'), []);
});

test('P7-1 allows named token references for all four keys', () => {
  assert.deepEqual(motionProblems('apps/mobile/src/ui/cosmos/Effect.tsx',
    `const config = {
      damping: spring.gentle.damping,
      stiffness: spring.gentle.stiffness,
      mass: spring.gentle.mass,
      duration: duration.micro,
    };`), []);
});

test('P7-1 scans __tests__ because section 3 gives no test exemption', () => {
  for (const key of ['damping', 'stiffness', 'mass', 'duration']) {
    assert.deepEqual(motionProblems('apps/mobile/src/ui/__tests__/motion.test.tsx',
      `expect(config).toEqual({ ${key}: 1 });`), [1]);
  }
});

test('P7-1 confines the motion guard to apps/mobile', () => {
  assert.deepEqual(motionProblems('packages/shared/src/domain.ts',
    'const config = { duration: 120 };'), []);
});
