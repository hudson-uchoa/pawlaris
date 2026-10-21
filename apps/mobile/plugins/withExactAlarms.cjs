const { withAndroidManifest } = require('expo/config-plugins');

// Android 12 uses the older exact-alarm permission; 13+ uses USE_EXACT_ALARM.
module.exports = function withExactAlarms(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const permissions = manifest['uses-permission'] ?? [];
    manifest['uses-permission'] = permissions.filter((permission) =>
      permission.$['android:name'] !== 'android.permission.SCHEDULE_EXACT_ALARM');
    manifest['uses-permission'].push({ $: {
      'android:name': 'android.permission.SCHEDULE_EXACT_ALARM',
      'android:maxSdkVersion': '32',
    } });
    return mod;
  });
};
