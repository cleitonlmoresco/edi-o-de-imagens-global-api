// Configuração flat do ESLint recomendada para Expo SDK 58.
// https://docs.expo.dev/guides/using-eslint/
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  globalIgnores(['dist/*', 'server/node_modules/*']),
  expoConfig,
]);
