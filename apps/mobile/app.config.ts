import type { ExpoConfig } from 'expo/config';

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

const config: ExpoConfig = {
  name: 'Pawlaris',
  slug: 'pawlaris',
  version: '0.0.0',
  scheme: 'pawlaris',
  platforms: ['android'],
  userInterfaceStyle: 'automatic',
  android: { package: 'app.pawlaris' },
  plugins: [
    'expo-router',
    [
      'expo-build-properties',
      { android: { usesCleartextTraffic: apiUrl.startsWith('http://') } },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: { apiUrl },
};

// SDK 57 uses Hermes and React Native's mandatory New Architecture.
export default config;
