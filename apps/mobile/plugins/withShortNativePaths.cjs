const { withProjectBuildGradle } = require('expo/config-plugins');

// Keep release CMake/prefab paths below Windows' native tool path limit.
const shortNativePaths = `
if (System.getProperty('os.name').startsWith('Windows')) {
  subprojects { nativeProject ->
    if (nativeProject.name == 'react-native-reanimated') {
      nativeProject.plugins.withId('com.android.library') {
        nativeProject.android.externalNativeBuild.cmake.buildStagingDirectory =
          rootProject.file('.native/reanimated')
      }
    }
  }
}
`;

module.exports = function withShortNativePaths(config) {
  return withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('Short native paths require the Expo Groovy build template.');
    }
    if (!mod.modResults.contents.includes(shortNativePaths)) {
      mod.modResults.contents += shortNativePaths;
    }
    return mod;
  });
};
