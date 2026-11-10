import fs from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// client.js 是构建产物（esbuild 重新排版、剥注释），源码级断言一律读这个函数
// 返回的作者态模块；行为断言才在 vm 里跑 bundle。
const clientDir = fileURLToPath(new URL('../../client/', import.meta.url))

function collect(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collect(path)
    return entry.name.endsWith('.js') ? [path] : []
  })
}

export function readAuthoredClient({ includeLocales = false } = {}) {
  return collect(clientDir)
    .filter((path) => includeLocales || !path.endsWith('locales.js'))
    .sort()
    .map((path) => fs.readFileSync(path, 'utf8'))
    .join('\n')
}
