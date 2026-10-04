import type { ExpoConfig } from 'expo/config';

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

const config: ExpoConfig = {
  name: 'Pawlaris',
  slug: 'pawlaris',
  version: '0.0.0',
  scheme: 'pawlaris',
  platforms: ['android'],
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  android: {
    package: 'app.pawlaris',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-foreground.png',
      backgroundImage: './assets/adaptive-background.png',
      monochromeImage: './assets/adaptive-monochrome.png',
    },
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        backgroundColor: '#090B1A',
        dark: {
          image: './assets/splash-icon.png',
          backgroundColor: '#090B1A',
        },
      },
    ],
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
