type ReleaseSigningPlugin = {
  getReleaseSigningGradle: () => string | null;
};

// The plugin is CommonJS to match Expo's config-plugin loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../plugins/withReleaseSigning.cjs') as ReleaseSigningPlugin;

const signingVariables = [
  'PAWLARIS_ANDROID_KEYSTORE_PATH',
  'PAWLARIS_ANDROID_KEY_ALIAS',
  'PAWLARIS_ANDROID_STORE_PASSWORD',
  'PAWLARIS_ANDROID_KEY_PASSWORD',
] as const;

const originalEnvironment = new Map<string, string | undefined>();

function setSigningEnvironment(values: Partial<Record<(typeof signingVariables)[number], string>>): void {
  for (const name of signingVariables) {
    originalEnvironment.set(name, process.env[name]);
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function restoreSigningEnvironment(): void {
  for (const name of signingVariables) {
    const value = originalEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  originalEnvironment.clear();
}

afterEach(restoreSigningEnvironment);

test('P8-5 leaves local previews on the default debug signing when unset', () => {
  setSigningEnvironment({});
  expect(plugin.getReleaseSigningGradle()).toBeNull();
});

test('P8-5 reads all release signing values from the build environment', () => {
  setSigningEnvironment({
    PAWLARIS_ANDROID_KEYSTORE_PATH: 'C:\\outside\\pawlaris.keystore',
    PAWLARIS_ANDROID_KEY_ALIAS: 'pawlaris-release',
    PAWLARIS_ANDROID_STORE_PASSWORD: 'store-secret',
    PAWLARIS_ANDROID_KEY_PASSWORD: 'key-secret',
  });

  const gradle = plugin.getReleaseSigningGradle();
  expect(gradle).toContain('System.getenv');
  expect(gradle).toContain('PAWLARIS_ANDROID_KEYSTORE_PATH');
  expect(gradle).toContain('PAWLARIS_ANDROID_KEY_ALIAS');
  expect(gradle).toContain('PAWLARIS_ANDROID_STORE_PASSWORD');
  expect(gradle).toContain('PAWLARIS_ANDROID_KEY_PASSWORD');
  expect(gradle).not.toContain('store-secret');
  expect(gradle).not.toContain('key-secret');
});

test('P8-5 names every missing signing variable without exposing values', () => {
  setSigningEnvironment({
    PAWLARIS_ANDROID_KEYSTORE_PATH: 'C:\\outside\\pawlaris.keystore',
    PAWLARIS_ANDROID_KEY_ALIAS: 'pawlaris-release',
  });

  expect(() => plugin.getReleaseSigningGradle()).toThrow(
    'PAWLARIS_ANDROID_STORE_PASSWORD, PAWLARIS_ANDROID_KEY_PASSWORD',
  );
  let message = '';
  try {
    plugin.getReleaseSigningGradle();
  } catch (error: unknown) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).not.toContain('pawlaris-release');
});
