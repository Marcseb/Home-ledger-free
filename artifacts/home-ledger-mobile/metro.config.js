const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, '../..');
config.watchFolders = [...new Set([...config.watchFolders, workspaceRoot])];

module.exports = config;
