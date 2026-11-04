export const MOCK_PROVIDER = 'mock'
export const MOCK_MODEL = 'cait-mock'
export const NO_ROUTE_MESSAGE = '未配置 DSH 模型路由，当前使用术语替换（离线）。'
export const NO_MODEL_MESSAGE = '所选 DSH 模型路由没有可用模型，当前使用术语替换（离线）。'

function service(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : ctx?.[name]
  } catch {
    return undefined
  }
}

function configuredProviderIds(loader) {
  const ids = new Set()
  try {
    for (const entry of loader?.entries?.() ?? []) {
      const providers = entry?.options?.config?.providers
      if (!providers || typeof providers !== 'object' || Array.isArray(providers)) continue
      for (const id of Object.keys(providers)) ids.add(id)
    }
  } catch {
    // Loader discovery is best-effort; the llm adapter catalog remains usable.
  }
  return ids
}

function normalizeModels(catalog) {
  if (!Array.isArray(catalog)) return []
  const seen = new Set()
  const models = []
  for (const item of catalog) {
    const id = String(item?.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({ id, name: String(item?.name ?? id).trim() || id })
  }
  return models
}

async function discoverRoutes(llm, loader) {
  if (!llm || typeof llm.listProviders !== 'function') {
    return { providers: [], fallback: true, message: NO_ROUTE_MESSAGE }
  }

  let adapters
  try {
    adapters = await llm.listProviders()
  } catch {
    adapters = []
  }
  if (!Array.isArray(adapters)) adapters = []

  const configured = configuredProviderIds(loader)
  const hasLoaderRoutes = adapters.some((adapter) => configured.has(String(adapter?.id ?? '')))
  const providers = []
  const seen = new Set()

  for (const adapter of adapters) {
    const id = String(adapter?.id ?? '').trim()
    if (!id || id === MOCK_PROVIDER || seen.has(id)) continue
    // When the loader exposes provider configs, use it to avoid listing adapters
    // that have no configured route. If loader discovery found nothing, trust the
    // adapter catalog (some providers are registered outside loader entries).
    if (hasLoaderRoutes && !configured.has(id)) continue
    seen.add(id)

    let models = []
    if (typeof llm.listModels === 'function') {
      try {
        models = normalizeModels(await llm.listModels(id))
      } catch {
        models = []
      }
    }
    providers.push({
      id,
      name: String(adapter?.name ?? id).trim() || id,
      models,
    })
  }

  return {
    providers,
    fallback: providers.length === 0,
    message: providers.length ? '' : NO_ROUTE_MESSAGE,
  }
}

export function createMtRuntime(ctx) {
  const llm = service(ctx, 'llm')
  const loader = service(ctx, 'loader')
  let cached = null
  let cachedAt = 0

  async function listRoutes({ refresh = false } = {}) {
    if (!refresh && cached && Date.now() - cachedAt < 30_000) return cached
    cached = await discoverRoutes(llm, loader)
    cachedAt = Date.now()
    return cached
  }

  return {
    available: Boolean(llm && typeof llm.stream === 'function'),
    listRoutes,
    async stream(options) {
      if (!llm || typeof llm.stream !== 'function') {
        const error = new Error('DSH llm service is not available')
        error.code = 'LLM_UNAVAILABLE'
        throw error
      }
      return llm.stream(options)
    },
  }
}

export async function collectStreamText(chunks) {
  if (!chunks || typeof chunks[Symbol.asyncIterator] !== 'function') {
    const error = new Error('DSH 模型路由没有返回可迭代的流')
    error.code = 'MT_STREAM_INVALID'
    throw error
  }

  let text = ''
  let finish = null
  for await (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta') {
      text += String(chunk.text ?? '')
    } else if (chunk.type === 'finish') {
      finish = chunk
      break
    }
  }

  if (!finish) {
    const error = new Error('DSH 模型路由未返回完成事件')
    error.code = 'MT_STREAM_INCOMPLETE'
    throw error
  }

  const reason = finish.reason || {}
  if (reason.kind !== 'stop') {
    const failure = reason.failure || {}
    const error = new Error(failure.message || 'DSH 模型路由调用失败')
    error.code = failure.code || (reason.kind === 'aborted' ? 'MT_ABORTED' : 'MT_STREAM_FAILED')
    error.status = failure.status
    throw error
  }

  return text.trim()
}
