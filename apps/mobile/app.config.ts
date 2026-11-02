import type { ExpoConfig } from 'expo/config';

// The Firebase file is owner-supplied and intentionally optional locally.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync } = require('fs') as { existsSync(path: string): boolean };

const permissions: { camera: string; photos: string } = require('./src/i18n/permissions.json');

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
const expoProjectId = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID;

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
    ...(existsSync('./google-services.json') ? { googleServicesFile: './google-services.json' } : {}),
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
    '@maplibre/maplibre-react-native',
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
  extra: { apiUrl, ...(expoProjectId === undefined ? {} : { eas: { projectId: expoProjectId } }) },
};

// SDK 57 uses Hermes and React Native's mandatory New Architecture.
export default config;
