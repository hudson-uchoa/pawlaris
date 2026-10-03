import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
];
