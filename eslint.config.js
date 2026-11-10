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
  // 依赖方向守卫（docs/REFACTOR-PLAN.md §4.1）：状态层不得依赖视图层，
  // 反过来只有 workbench.js 这个装配文件能同时看到两边。
  {
    files: ['client/workbench/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/components/**'] }],
    },
  },
  {
    files: ['client/components/**/*.js'],
    ignores: ['client/components/workbench.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/workbench/**'] }],
    },
  },
  // 叶子模块：不依赖任何同项目模块，保证 core/transport/i18n 可被单独测试与复用。
  {
    files: ['client/helpers.js', 'client/rpc.js', 'client/locales.js', 'client/react.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['./*', '../*'] }],
    },
  },
]
