import js from '@eslint/js'
import globals from 'globals'

/**
 * 两套运行环境：
 * - node 侧：lib / scripts / _dev / index.js（ESM + node globals）
 * - 浏览器侧：client/（ESM + browser globals，React 通过 import 引入）
 * client.js 是构建产物，不参与检查。
 */
export default [
  {
    ignores: ['client.js', 'node_modules/**', '.npm-cache/**', '_dev/fixtures/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['client/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
]
