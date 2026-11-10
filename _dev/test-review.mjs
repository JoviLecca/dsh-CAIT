import assert from 'node:assert/strict'
import { CatStore } from '../lib/store.js'

function section(title) {
  console.log(`\n== ${title} ==`)
}

function reviewStore(output) {
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Review',
    text: 'Alpha one. Beta two.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  store.saveDraft({ documentId: created.document.id, index: 0, target: 'A1' })
  store.saveDraft({ documentId: created.document.id, index: 1, target: 'B1' })
  store.resolveMtRoute = async () => ({
    mock: false,
    provider: 'test-provider',
    model: 'test-model',
    note: '',
  })
  store.mtRuntime = {
    stream: async function* stream() {
      yield { type: 'text-delta', text: output }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  return { store, id: created.document.id }
}

section('review parses structured issues and drops out-of-range rows')
{
  const { store, id } = reviewStore(
    JSON.stringify([
      {
        index: 0,
        severity: 'high',
        code: 'MISTRANSLATION',
        message: 'Meaning changed.',
        suggestion: 'Better.',
      },
      { index: 99, severity: 'low', code: 'X', message: 'Out of range.' },
      { index: 1, severity: 'weird', code: 'STYLE', message: '' },
    ]),
  )
  const result = await store.reviewDocument({ documentId: id, from: 0, count: 2 })
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0].index, 0)
  assert.equal(result.issues[0].severity, 'high')
  assert.equal(result.issues[0].suggestion, 'Better.')
}

section('review accepts a fenced JSON array')
{
  const { store, id } = reviewStore(
    '```json\n[{"index":1,"severity":"low","code":"STYLE","message":"Tone is off."}]\n```',
  )
  const result = await store.reviewDocument({ documentId: id, from: 0, count: 2 })
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0].index, 1)
  assert.equal(result.issues[0].severity, 'low')
}

section('review can use its own route and model')
{
  const { store, id } = reviewStore(
    JSON.stringify([{ index: 0, severity: 'low', code: 'STYLE', message: 'Tone is off.' }]),
  )
  store.settings.review = { provider: 'review-route', model: 'review-model', temperature: 0 }
  store.mtRuntime.listRoutes = async () => ({
    providers: [
      { id: 'mt-route', models: [{ id: 'mt-model' }] },
      { id: 'review-route', models: [{ id: 'review-model' }] },
    ],
  })
  let seen
  store.mtRuntime.stream = async function* stream(options) {
    seen = options
    yield {
      type: 'text-delta',
      text: JSON.stringify([{ index: 1, severity: 'low', code: 'STYLE', message: 'Tone.' }]),
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const result = await store.reviewDocument({ documentId: id, from: 0, count: 2 })
  assert.equal(seen.provider, 'review-route')
  assert.equal(seen.model, 'review-model')
  assert.equal(result.provider, 'review-route')
  assert.equal(result.inherited, false)
  assert.equal(result.issues.length, 1)
}

section('review inherits the MT route when no override is set')
{
  const { store, id } = reviewStore(JSON.stringify([]))
  store.settings.review = { provider: '', model: '', temperature: 0 }
  let seen
  store.mtRuntime.stream = async function* stream(options) {
    seen = options
    yield { type: 'text-delta', text: '[]' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const result = await store.reviewDocument({ documentId: id, from: 0, count: 2 })
  assert.equal(seen.provider, 'test-provider')
  assert.equal(seen.model, 'test-model')
  assert.equal(result.inherited, true)
}

section('review refuses to run without a model route')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'No route',
    text: 'Alpha.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  await assert.rejects(
    () => store.reviewDocument({ documentId: created.document.id }),
    /AI 审校需要可用的 DSH 模型路由/,
  )
}

section('review route round-trips through settings')
{
  const store = new CatStore()
  const saved = store.saveSettings({
    review: { provider: 'review-route', model: 'review-model', temperature: 0 },
  })
  assert.equal(saved.settings.review.provider, 'review-route')
  assert.equal(saved.settings.review.model, 'review-model')
  store.saveSettings({ review: { provider: '', model: 'stale-model' } })
  assert.equal(store.publicSettings().review.provider, '')
  assert.equal(store.publicSettings().review.model, '')
}

console.log('\nALL REVIEW TESTS PASSED')
