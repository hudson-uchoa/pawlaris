const { withAppBuildGradle } = require('expo/config-plugins');

const signingEnvironment = [
  'PAWLARIS_ANDROID_KEYSTORE_PATH',
  'PAWLARIS_ANDROID_KEY_ALIAS',
  'PAWLARIS_ANDROID_STORE_PASSWORD',
  'PAWLARIS_ANDROID_KEY_PASSWORD',
];

function getReleaseSigningGradle() {
  const values = signingEnvironment.map((name) => process.env[name]);
  const present = values.filter((value) => value !== undefined);
  if (present.length === 0) return null;

  const missing = signingEnvironment.filter((name) => process.env[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing release signing environment variable(s): ${missing.join(', ')}`);
  }

  return `
android {
  signingConfigs {
    release {
      storeFile file(System.getenv('PAWLARIS_ANDROID_KEYSTORE_PATH'))
      storePassword System.getenv('PAWLARIS_ANDROID_STORE_PASSWORD')
      keyAlias System.getenv('PAWLARIS_ANDROID_KEY_ALIAS')
      keyPassword System.getenv('PAWLARIS_ANDROID_KEY_PASSWORD')
    }
  }
  buildTypes {
    release {
      signingConfig signingConfigs.release
    }
  }
}
`;
}

function withReleaseSigning(config) {
  const gradle = getReleaseSigningGradle();
  if (gradle === null) return config;
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('Release signing requires the Expo Groovy build template.');
    }
    if (!mod.modResults.contents.includes(gradle)) {
      mod.modResults.contents += gradle;
    }
    return mod;
  });
}

module.exports = withReleaseSigning;
module.exports.getReleaseSigningGradle = getReleaseSigningGradle;
