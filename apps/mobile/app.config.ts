import type { ExpoConfig } from 'expo/config';

const permissions: { camera: string; photos: string } = require('./src/i18n/permissions.json');

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
    permissions: ['POST_NOTIFICATIONS', 'USE_EXACT_ALARM',
      'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION'],
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-foreground.png',
      backgroundImage: './assets/adaptive-background.png',
      monochromeImage: './assets/adaptive-monochrome.png',
    },
  },
  plugins: [
    'expo-router',
    'expo-notifications',
    ['expo-location', { isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: true }],
    './plugins/withExactAlarms.cjs',
    ['expo-camera', { cameraPermission: permissions.camera, microphonePermission: false,
      recordAudioAndroid: false, barcodeScannerEnabled: false }],
    ['expo-image-picker', { photosPermission: permissions.photos,
      cameraPermission: permissions.camera, microphonePermission: false }],
    './plugins/withShortNativePaths.cjs',
    [
      'expo-font',
      {
        android: {
          fonts: [
            {
              fontFamily: 'Space Grotesk',
              fontDefinitions: [
                { path: './assets/fonts/SpaceGrotesk-Medium.ttf', weight: 500 },
                { path: './assets/fonts/SpaceGrotesk-Bold.ttf', weight: 700 },
              ],
            },
          ],
        },
      },
    ],
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
