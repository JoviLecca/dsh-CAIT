import js from '@eslint/js'
import globals from 'globals'

/**
 * 分阶段接入：
 * - 现在覆盖 node 侧（lib / scripts / _dev / index.js）。
 * - client/ 仍是共享作用域的拼接片段，不是独立模块，Batch 1 改成 ESM 后再纳入。
 */
export default [
  {
    ignores: ['client.js', 'client/**', 'node_modules/**', '.npm-cache/**', '_dev/fixtures/**'],
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
]
