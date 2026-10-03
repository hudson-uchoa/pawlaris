import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/api-types.ts', 'src/**/*.contract.ts'],
      thresholds: { lines: 95, branches: 95 },
    },
  },
});
