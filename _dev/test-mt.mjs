import assert from 'node:assert/strict'
import { CatStore, CatError } from '../lib/store.js'
import {
  MOCK_PROVIDER,
  NO_ROUTE_MESSAGE,
  collectStreamText,
  createMtRuntime,
} from '../lib/mt.js'

function section(name) {
  console.log(`\n# ${name}`)
}

async function* textStream(text) {
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

async function* failedStream() {
  yield { type: 'text-delta', index: 0, text: 'partial' }
  yield {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: { code: 'REMOTE_500', status: 500, message: 'secret remote body' },
    },
  }
}

section('stream collection')
{
  assert.equal(await collectStreamText(textStream('你好世界')), '你好世界')
  await assert.rejects(
    collectStreamText(failedStream()),
    (error) => error.code === 'REMOTE_500' && error.status === 500,
  )
  await assert.rejects(
    collectStreamText((async function* () {})()),
    (error) => error.code === 'MT_STREAM_INCOMPLETE',
  )
}

section('route discovery and provider call')
{
  const seen = []
  const llm = {
    listProviders: () => [
      { id: 'route-a', name: 'Route A' },
      { id: 'mock', name: 'Mock adapter' },
    ],
    listModels: async (provider) =>
      provider === 'route-a'
        ? [
            { id: 'model-a', name: 'Model A' },
            { id: 'model-b', name: 'Model B' },
          ]
        : [],
    stream: async function* (options) {
      seen.push(options)
      yield* textStream('这是真实路由译文')
    },
  }
  const loader = {
    entries: () => [{ options: { config: { providers: { 'route-a': {} } } } }],
  }
  const runtime = createMtRuntime({
    get: (name) => (name === 'llm' ? llm : name === 'loader' ? loader : undefined),
  })
  const routes = await runtime.listRoutes({ refresh: true })
  assert.equal(routes.fallback, false)
  assert.deepEqual(
    routes.providers.map((provider) => provider.id),
    ['route-a'],
  )
  assert.deepEqual(
    routes.providers[0].models.map((model) => model.id),
    ['model-a', 'model-b'],
  )

  const store = new CatStore({ mtRuntime: runtime })
  assert.equal(Object.hasOwn(store.publicSettings().mt, 'hasApiKey'), false)
  store.saveSettings({ mt: { provider: 'route-a', model: 'model-b', temperature: 0.3 } })
  const result = await store.mtSuggest({ text: 'Hello world', sourceLang: 'en', targetLang: 'zh-CN' })
  assert.equal(result.provider, 'route-a')
  assert.equal(result.model, 'model-b')
  assert.equal(result.text, '这是真实路由译文')
  assert.equal(Object.hasOwn(result, 'apiKey'), false)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].provider, 'route-a')
  assert.equal(seen[0].model, 'model-b')
  assert.equal(seen[0].purpose, 'cait-mt')
  assert.equal(seen[0].temperature, 0.3)
  assert.match(seen[0].system, /professional translator/)
  assert.ok(seen[0].messages.every((message) => message.role === 'user'))
  assert.ok(seen[0].messages.some((message) => message.role === 'user'))
}

section('no-route mock fallback')
{
  const store = new CatStore({
    mtRuntime: {
      listRoutes: async () => ({ providers: [], fallback: true, message: NO_ROUTE_MESSAGE }),
      stream: async function* () {
        throw new Error('stream must not be called')
      },
    },
  })
  store.addGlossary({ source: 'translation memory', target: '翻译记忆库', sourceLang: 'en' })
  const result = await store.mtSuggest({ text: 'translation memory' })
  assert.equal(result.provider, MOCK_PROVIDER)
  assert.equal(result.text, '翻译记忆库')
  assert.ok(result.note.includes('未配置 DSH 模型路由'))
}

section('generic error and Host-only detail')
{
  const logs = []
  const store = new CatStore({
    logger: { warn: (...args) => logs.push(args.join(' ')), error() {} },
    mtRuntime: {
      listRoutes: async () => ({
        providers: [{ id: 'route-a', name: 'Route A', models: [{ id: 'model-a', name: 'Model A' }] }],
        fallback: false,
        message: '',
      }),
      stream: () => failedStream(),
    },
  })
  store.saveSettings({ mt: { provider: 'route-a', model: 'model-a' } })
  await assert.rejects(
    store.mtSuggest({ text: 'Hello' }),
    (error) =>
      error instanceof CatError &&
      error.code === 'MT_PROVIDER_FAILED' &&
      error.status === 502 &&
      !error.message.includes('secret remote body'),
  )
  assert.ok(logs.some((line) => line.includes('REMOTE_500') && line.includes('secret remote body')))
}

console.log('\nALL MT TESTS PASSED')
