import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * 客户端产物的唯一构建入口。
 *
 * `client.js` 不是手写文件，而是 esbuild 把 `client/` 这组 ES 模块打成一份
 * CommonJS 包、再套上 DSH 的 `__ModuleLoader__.load` 外框后生成的分发产物。
 * 构建脚本和一致性校验都必须走这里，避免「谁构建的」和「谁校验的」两份实现漂移。
 */
export const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const clientEntry = join(projectRoot, 'client', 'index.js')
export const clientBundlePath = join(projectRoot, 'client.js')

// 外框保持 DSH 侧契约不变：factory 收到 require，返回 entry 的默认导出。
const HEADER = `// 由 scripts/build-client.mjs 从 client/ 构建生成，请勿手工修改。
window.__ModuleLoader__.load({
  id: 'dsh-cait',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
    ;(function (module, exports, require) {
`

const FOOTER = `    })(module, exports, require)
    return module.exports.default || module.exports
  },
})
`

export async function buildClientSource() {
  const result = await build({
    entryPoints: [clientEntry],
    absWorkingDir: projectRoot,
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    // React 由 DSH 客户端运行时通过 require 注入，不进产物。
    external: ['react'],
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
  })
  return `${HEADER}${result.outputFiles[0].text}${FOOTER}`
}
