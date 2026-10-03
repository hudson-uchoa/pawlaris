const { getDefaultConfig } = require('expo/metro-config');

// Expo discovers the pnpm workspace and resolves its linked packages.
module.exports = getDefaultConfig(__dirname);
