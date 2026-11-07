import assert from 'node:assert/strict'
import { NO_MODEL_MESSAGE, NO_ROUTE_MESSAGE, createMtRuntime } from '../lib/mt.js'
import { CatStore } from '../lib/store.js'

function section(name) {
  console.log(`\n# ${name}`)
}

function runtimeFor({ adapters = [], models = {}, entries = [], entriesThrow = false } = {}) {
  const llm = {
    listProviders: () => adapters,
    listModels: async (provider) => models[provider] ?? [],
    stream: async function* () {
      yield { type: 'text-delta', index: 0, text: 'ok' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const loader = {
    entries: () => {
      if (entriesThrow) throw new Error('loader explode')
      return entries
    },
  }
  return createMtRuntime({
    get: (name) => (name === 'llm' ? llm : name === 'loader' ? loader : undefined),
  })
}

const ids = (routes) => routes.providers.map((provider) => provider.id)
const providerConfig = (...ids) => [
  { options: { config: { providers: Object.fromEntries(ids.map((id) => [id, {}])) } } },
]

section('a configured custom provider no longer hides the built-in adapter')
{
  // Regression for 1.1/#1.0: the loader only knows the custom provider, the
  // built-in DeepSeek adapter is registered outside loader entries.
  const runtime = runtimeFor({
    adapters: [
      { id: 'custom-x', name: 'Custom X' },
      { id: 'deepseek', name: 'DeepSeek' },
    ],
    models: { 'custom-x': [{ id: 'x-1' }], deepseek: [{ id: 'deepseek-chat' }] },
    entries: providerConfig('custom-x'),
  })
  const routes = await runtime.listRoutes({ refresh: true })
  assert.deepEqual(ids(routes), ['custom-x', 'deepseek'])
  assert.equal(routes.fallback, false)
  assert.equal(routes.message, '')
  const deepseek = routes.providers.find((provider) => provider.id === 'deepseek')
  assert.equal(deepseek.configured, false)
  assert.equal(deepseek.hasModels, true)
  assert.deepEqual(
    routes.providers.find((provider) => provider.id === 'custom-x').models.map((model) => model.id),
    ['x-1'],
  )
}

section('the filter used to drop everything, the full catalog is now kept')
{
  const runtime = runtimeFor({
    adapters: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ],
    models: { a: [{ id: 'a1' }], b: [{ id: 'b1' }], c: [{ id: 'c1' }] },
    entries: providerConfig('b'),
  })
  const routes = await runtime.listRoutes({ refresh: true })
  assert.deepEqual(ids(routes), ['b', 'a', 'c'])
  assert.deepEqual(
    routes.providers.map((provider) => provider.configured),
    [true, false, false],
  )
}

section('configured providers sort first, catalog order is otherwise stable')
{
  const runtime = runtimeFor({
    adapters: [
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
      { id: 'three', name: 'Three' },
    ],
    models: { one: [{ id: 'm1' }], two: [{ id: 'm2' }], three: [{ id: 'm3' }] },
    entries: providerConfig('three', 'one'),
  })
  const routes = await runtime.listRoutes({ refresh: true })
  // The sort is stable, so the two configured routes keep the catalog order.
  assert.deepEqual(ids(routes), ['one', 'three', 'two'])
}

section('a provider without models stays visible but is marked')
{
  const runtime = runtimeFor({
    adapters: [
      { id: 'empty', name: 'Empty' },
      { id: 'ready', name: 'Ready' },
    ],
    models: { empty: [], ready: [{ id: 'r1' }] },
  })
  const routes = await runtime.listRoutes({ refresh: true })
  assert.deepEqual(ids(routes), ['empty', 'ready'])
  assert.equal(routes.fallback, false)
  assert.equal(routes.providers[0].hasModels, false)
  assert.equal(routes.providers[1].hasModels, true)
}

section('no models anywhere still lists the providers and explains why')
{
  const runtime = runtimeFor({
    adapters: [{ id: 'empty', name: 'Empty' }],
    models: { empty: [] },
    entries: providerConfig('empty'),
  })
  const routes = await runtime.listRoutes({ refresh: true })
  assert.deepEqual(ids(routes), ['empty'])
  assert.equal(routes.fallback, true)
  assert.equal(routes.message, NO_MODEL_MESSAGE)
}

section('missing llm service and mock-only catalogs')
{
  const noLlm = createMtRuntime({ get: () => undefined })
  const routes = await noLlm.listRoutes({ refresh: true })
  assert.deepEqual(routes.providers, [])
  assert.equal(routes.fallback, true)
  assert.equal(routes.message, NO_ROUTE_MESSAGE)

  const mockOnly = await runtimeFor({
    adapters: [{ id: 'mock', name: 'Mock' }],
    models: { mock: [{ id: 'cait-mock' }] },
  }).listRoutes({ refresh: true })
  assert.deepEqual(mockOnly.providers, [])
  assert.equal(mockOnly.fallback, true)
  assert.equal(mockOnly.message, NO_ROUTE_MESSAGE)
}

section('loader discovery is best-effort')
{
  const routes = await runtimeFor({
    adapters: [{ id: 'a', name: 'A' }],
    models: { a: [{ id: 'a1' }] },
    entriesThrow: true,
  }).listRoutes({ refresh: true })
  assert.deepEqual(ids(routes), ['a'])
  assert.equal(routes.fallback, false)
  assert.equal(routes.providers[0].configured, false)
}

section('a stored DeepSeek route still translates after a custom model appears')
{
  const runtime = runtimeFor({
    adapters: [
      { id: 'custom-x', name: 'Custom X' },
      { id: 'deepseek', name: 'DeepSeek' },
    ],
    models: { 'custom-x': [{ id: 'x-1' }], deepseek: [{ id: 'deepseek-chat' }] },
    entries: providerConfig('custom-x'),
  })
  const store = new CatStore({ mtRuntime: runtime })
  store.saveSettings({ mt: { provider: 'deepseek', model: 'deepseek-chat' } })
  const result = await store.mtSuggest({ text: 'Hello', sourceLang: 'en', targetLang: 'zh-CN' })
  assert.equal(result.provider, 'deepseek')
  assert.equal(result.model, 'deepseek-chat')
  assert.equal(result.text, 'ok')
}

console.log('\nALL MT ROUTE TESTS PASSED')
