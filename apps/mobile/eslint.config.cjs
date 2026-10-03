const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');

const motionImports = {
  paths: [
    {
      name: 'react-native',
      importNames: ['Animated', 'LayoutAnimation'],
      message: 'Use UI-thread Reanimated worklets (MO-2).',
    },
    {
      name: 'lottie-react-native',
      message: 'Draw motion in code on the UI thread (MO-2).',
    },
  ],
};

module.exports = defineConfig([
  expo,
  { ignores: ['.expo/**', 'coverage/**'] },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { __dirname: 'readonly' } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-restricted-imports': ['error', motionImports],
    },
  },
  {
    files: ['app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...motionImports,
          patterns: [{
            group: [
              '@/db', '@/db/**', '**/db', '**/db/**',
              '@/api', '@/api/**', '**/api', '**/api/**',
              '@/sync/outbox', '@/sync/outbox/**',
              '**/sync/outbox', '**/sync/outbox/**',
            ],
            message: 'Read selectors and write mutations (05 §3, 10 §9).',
          }],
        },
      ],
    },
  },
]);
