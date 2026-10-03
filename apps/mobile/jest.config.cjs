module.exports = {
  preset: 'jest-expo',
  testMatch: [
    '<rootDir>/__tests__/**/*.test.[jt]s?(x)',
    '<rootDir>/src/**/__tests__/**/*.test.[jt]s?(x)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/app/'],
  collectCoverageFrom: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}', '!**/__tests__/**'],
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|.pacquet|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*))',
  ],
};
