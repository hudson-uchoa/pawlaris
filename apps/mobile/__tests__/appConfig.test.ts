import config from '../app.config';

declare const __dirname: string;

const { existsSync } = jest.requireActual<{
  existsSync(path: string): boolean;
}>('node:fs');
const { resolve } = jest.requireActual<{
  resolve(...paths: string[]): string;
}>('node:path');

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
        backgroundColor: '#090B1A',
        dark: {
          image: './assets/splash-icon.png',
          backgroundColor: '#090B1A',
        },
      }),
    ]);
  });
});
