const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['dist/**', '.expo/**', 'node_modules/**']
  },
  {
    files: ['App.tsx'],
    rules: {
      // The smoke build deliberately chooses an entry module before rendering.
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    files: [
      'src/screens/CharactersScreen.tsx',
      'src/screens/PagesScreen.tsx',
      'src/screens/StoryScreen.tsx'
    ],
    rules: {
      // These editors synchronize server-selected records into local draft fields.
      'react-hooks/set-state-in-effect': 'off'
    }
  }
]);
