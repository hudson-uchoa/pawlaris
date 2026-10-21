import config from '../app.config';
import { dark } from '../src/ui/tokens/color';

declare const __dirname: string;

const { existsSync } = jest.requireActual<{
  existsSync(path: string): boolean;
}>('node:fs');
const { resolve } = jest.requireActual<{
  resolve(...paths: string[]): string;
}>('node:path');

describe('P6-1 location configuration', () => {
  it('P6-5 includes the MapLibre Expo native configuration plugin', () => {
    expect(config.plugins).toContain('@maplibre/maplibre-react-native');
  });

  it('R4.2 declares the location permissions and foreground service permissions', () => {
    expect(config.android?.permissions).toEqual(expect.arrayContaining([
      'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION',
    ]));
  });

  it('R4.2 enables the location foreground service and declares the fallback permission', () => {
    expect(config.plugins).toContainEqual(['expo-location', {
      isAndroidBackgroundLocationEnabled: true, isAndroidForegroundServiceEnabled: true,
    }]);
  });
});

describe('P0-9 app icon and splash', () => {
  it.each([
    ['icon.png', (): string | undefined => config.icon],
    [
      'adaptive-foreground.png',
      (): string | undefined => config.android?.adaptiveIcon?.foregroundImage,
    ],
    [
      'adaptive-background.png',
      (): string | undefined => config.android?.adaptiveIcon?.backgroundImage,
    ],
    [
      'adaptive-monochrome.png',
      (): string | undefined => config.android?.adaptiveIcon?.monochromeImage,
    ],
    [
      'splash-icon.png',
      (): string => {
        const plugin = config.plugins?.find(
          (entry) => Array.isArray(entry) && entry[0] === 'expo-splash-screen',
        );
        expect(plugin).toEqual([
          'expo-splash-screen',
          expect.objectContaining({ image: './assets/splash-icon.png' }),
        ]);
        return './assets/splash-icon.png';
      },
    ],
  ] as const)('P0-9 names the supplied %s and the file exists', (file, imagePath) => {
    expect(imagePath()).toBe(`./assets/${file}`);
    expect(existsSync(resolve(__dirname, '../assets', file))).toBe(true);
  });

  it('P0-9 shows the same mark on the night sky in both splash themes', () => {
    const plugin = config.plugins?.find(
      (entry) => Array.isArray(entry) && entry[0] === 'expo-splash-screen',
    );

    expect(plugin).toEqual([
      'expo-splash-screen',
      expect.objectContaining({
        image: './assets/splash-icon.png',
        backgroundColor: dark.bg,
        dark: {
          image: './assets/splash-icon.png',
          backgroundColor: dark.bg,
        },
      }),
    ]);
  });
});
