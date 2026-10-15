const expoPreset = require('jest-expo/jest-preset');

module.exports = {
  preset: 'jest-expo',
  resolver: 'react-native-worklets/jest/resolver',
  setupFiles: ['react-native-gesture-handler/jestSetup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  // Lucide's React Native entry uses ESM .mjs files.
  transform: { '\\.mjs$': expoPreset.transform['\\.[jt]sx?$'] },
  testMatch: [
    '<rootDir>/__tests__/**/*.test.[jt]s?(x)',
    '<rootDir>/src/**/__tests__/**/*.test.[jt]s?(x)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/app/'],
  collectCoverageFrom: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}', '!**/__tests__/**'],
  coverageThreshold: {
    './src/db/': { statements: 90, branches: 90, functions: 90, lines: 90 },
    './src/replica/': { statements: 90, branches: 90, functions: 90, lines: 90 },
    './src/api/': { statements: 90, branches: 90, functions: 90, lines: 90 },
    './src/auth/': { statements: 90, branches: 90, functions: 90, lines: 90 },
    './src/sync/': { statements: 90, branches: 90, functions: 90, lines: 90 },
    './src/assets/': { statements: 90, branches: 90, functions: 90, lines: 90 },
    './src/walks/': { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|.pacquet|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|lucide-react-native))',
  ],
};
