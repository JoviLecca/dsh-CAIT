import { homedir } from 'node:os'
import path from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { CatStore } from './lib/store.js'
import { registerCatTools } from './lib/tools.js'
import { registerCatApi } from './lib/api.js'
import { createMtRuntime } from './lib/mt.js'

export const name = 'dsh-cait'

// Cordis has no optional injection: every entry in this array is a required
// service. CAIT targets the Web/Desktop composition, where all three exist.
export const inject = ['tools', 'webServer', 'connection']

export const Config = Schema.object({
  dataDir: Schema.string()
    .default('')
    .description(
      'CAIT 数据目录。留空时使用 DSH 用户数据目录下的 cait 子目录（$DSH_HOME/cait）。支持绝对路径、相对路径和 ~。',
    ),
})

function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homedir(), value.slice(2))
  return value
}

export function resolveDataDir(configured) {
  const custom = String(configured ?? '').trim()
  if (custom) return path.resolve(expandHome(custom))

  const dshHome = String(process.env.DSH_HOME ?? '').trim()
  return path.join(path.resolve(dshHome || path.join(homedir(), '.dsh')), 'cait')
}

export function apply(ctx, config = {}) {
  const store = new CatStore({
    dataDir: resolveDataDir(config?.dataDir),
    mtRuntime: createMtRuntime(ctx),
  })

  ctx.effect(() => registerCatTools(ctx, store))
  ctx.effect(() => registerCatApi(ctx, store))
}
