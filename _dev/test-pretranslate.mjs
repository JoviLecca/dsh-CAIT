import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { PRETRANSLATE_BLOCK_MAX } from '../lib/pre-translate.js'
import { STORE_VERSION } from '../lib/store-utils.js'

const silent = { log() {}, warn() {}, error() {} }
const roots = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cait-pretranslate-'))
  roots.push(dir)
  return dir
}

function section(name) {
  console.log(`\n# ${name}`)
}

function stubMt(store, map = {}) {
  const calls = []
  const translate = (text) => {
    if (map[text] === 'THROW') throw Object.assign(new Error('route exploded'), { code: 'MT_PROVIDER_FAILED' })
    return map[text] ?? `MT(${text})`
  }
  store.mtSuggest = async ({ text }) => {
    calls.push(text)
    return { text: translate(text), provider: 'stub', model: 'stub-model', latencyMs: 1 }
  }
  store.mtSuggestBatch = async ({ items }) => {
    calls.push(...items.map((item) => item.text))
    return {
      items: items.map((item) => ({ index: item.index, text: translate(item.text) })),
      provider: 'stub',
      model: 'stub-model',
      latencyMs: 1,
      partial: false,
    }
  }
  return calls
}

try {
  section('fills pending segments and skips work that is already done')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({
      name: 'Pre',
      text: 'Alpha. Beta. Gamma.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    const calls = stubMt(store)

    store.saveDraft({ documentId: doc.id, index: 0, target: '阿尔法。' })
    store.confirmSegment({ documentId: doc.id, index: 0 })

    const result = await store.preTranslate({ documentId: doc.id, from: 0, count: 3 })
    assert.deepEqual(calls, ['Beta.', 'Gamma.'])
    assert.equal(result.filled, 2)
    assert.deepEqual(result.skipped, [{ index: 0, reason: 'confirmed' }])
    assert.deepEqual(result.segments.map((item) => item.origin), ['mt', 'mt'])
    assert.deepEqual(doc.segments.map((segment) => segment.status), ['confirmed', 'translated', 'translated'])
    assert.deepEqual(store.progress(doc), { total: 3, confirmed: 1, translated: 2, pending: 0, percent: 33 })
    assert.equal(result.next, null)

    const again = await store.preTranslate({ documentId: doc.id, from: 0, count: 3 })
    assert.equal(again.filled, 0)
    assert.deepEqual(again.skipped, [
      { index: 0, reason: 'confirmed' },
      { index: 1, reason: 'translated' },
      { index: 2, reason: 'translated' },
    ])
    assert.equal(calls.length, 2)
  }

  section('exact TM matches are reused without calling the machine translator')
  {
    const store = new CatStore({ logger: silent })
    store.addTM({ source: 'Hello there.', target: '你好。' })
    const { document } = store.createDocument({
      name: 'Pre TM',
      text: 'Hello there. Other line.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    const calls = stubMt(store)

    const result = await store.preTranslate({ documentId: doc.id, from: 0, count: 2 })
    assert.deepEqual(calls, ['Other line.'])
    assert.equal(result.filled, 2)
    assert.equal(doc.segments[0].target, '你好。')
    assert.equal(doc.segments[0].origin, 'tm')
    assert.equal(doc.segments[1].origin, 'mt')
  }

  section('tm-only mode reports misses and leaves them pending')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({
      name: 'Pre TM only',
      text: 'Nothing matches here.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    const calls = stubMt(store)

    const result = await store.preTranslate({ documentId: doc.id, from: 0, count: 1, mode: 'tm' })
    assert.equal(result.filled, 0)
    assert.deepEqual(result.noMatch, [0])
    assert.equal(calls.length, 0)
    assert.equal(doc.segments[0].status, 'pending')
  }

  section('a single failure does not abandon the block')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({
      name: 'Pre fail',
      text: 'One. Two. Three.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    stubMt(store, { 'Two.': 'THROW' })

    const result = await store.preTranslate({ documentId: doc.id, from: 0, count: 3 })
    assert.equal(result.filled, 2)
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].index, 1)
    assert.equal(result.failed[0].code, 'MT_PROVIDER_FAILED')
    assert.deepEqual(doc.segments.map((segment) => segment.status), ['translated', 'pending', 'translated'])
  }

  section('block window is clamped and next points at the following block')
  {
    const store = new CatStore({ logger: silent })
    const text = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}.`).join(' ')
    const { document } = store.createDocument({ name: 'Pre window', text, sourceLang: 'en', targetLang: 'zh-CN' })
    const doc = store.docs.get(document.id)
    stubMt(store)

    const first = await store.preTranslate({ documentId: doc.id, from: 0, count: 999 })
    assert.equal(first.count, PRETRANSLATE_BLOCK_MAX)
    assert.equal(first.filled, PRETRANSLATE_BLOCK_MAX)
    assert.equal(first.next, PRETRANSLATE_BLOCK_MAX)

    const last = await store.preTranslate({ documentId: doc.id, from: doc.segments.length - 3, count: 8 })
    assert.equal(last.to, doc.segments.length)
    assert.equal(last.next, null)
  }

  section('pre-translated text survives a save and reload')
  {
    const dataDir = tempDir()
    const store = new CatStore({ dataDir, logger: silent })
    const { document } = store.createDocument({ name: 'Pre disk', text: 'Disk one. Disk two.', sourceLang: 'en', targetLang: 'zh-CN' })
    stubMt(store)
    await store.preTranslate({ documentId: document.id, from: 0, count: 2 })

    const raw = JSON.parse(readFileSync(join(dataDir, 'store.json'), 'utf8'))
    assert.equal(raw.version, STORE_VERSION)
    const segment = raw.documents.find((item) => item.id === document.id).segments[0]
    assert.equal(segment.target, 'MT(Disk one.)')
    assert.equal(segment.origin, 'mt')
    assert.equal(segment.status, 'translated')

    const reopened = new CatStore({ dataDir, logger: silent })
    const doc = reopened.docs.get(document.id)
    assert.equal(doc.segments[0].target, 'MT(Disk one.)')
    assert.equal(doc.segments[0].status, 'translated')
  }

  section('segmentsForTool filters by status and stays bounded')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({ name: 'List', text: 'A. B. C.', sourceLang: 'en', targetLang: 'zh-CN' })
    const doc = store.docs.get(document.id)
    stubMt(store)
    await store.preTranslate({ documentId: doc.id, from: 0, count: 2 })

    const all = store.segmentsForTool({ documentId: doc.id })
    assert.equal(all.segments.length, 3)
    assert.equal(all.document.total, 3)
    assert.equal(all.next, null)

    const pending = store.segmentsForTool({ documentId: doc.id, status: 'pending' })
    assert.deepEqual(pending.segments.map((segment) => segment.index), [2])

    const bounded = store.segmentsForTool({ documentId: doc.id, from: 0, count: 2 })
    assert.equal(bounded.segments.length, 2)
    assert.equal(bounded.next, 2)
  }

  section('confirmSegmentsForTool confirms only segments that have text')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({ name: 'Batch', text: 'One. Two. Three.', sourceLang: 'en', targetLang: 'zh-CN' })
    const doc = store.docs.get(document.id)
    stubMt(store)
    await store.preTranslate({ documentId: doc.id, from: 0, count: 2 })

    const result = store.confirmSegmentsForTool({ documentId: doc.id, indices: [0, 1, 2, 2, 99] })
    assert.deepEqual(result.confirmed, [0, 1])
    assert.deepEqual(result.skipped, [{ index: 2, reason: 'no-target' }])
    assert.equal(result.progress.confirmed, 2)
    assert.equal(result.done, false)

    doc.segments[2].target = '三。'
    doc.segments[2].status = 'translated'
    const final = store.confirmSegmentsForTool({ documentId: doc.id, from: 0, count: 3 })
    assert.deepEqual(final.confirmed, [2])
    assert.deepEqual(final.skipped, [
      { index: 0, reason: 'confirmed' },
      { index: 1, reason: 'confirmed' },
    ])
    assert.equal(final.done, true)
  }

  section('batch ids survive shuffled output, and renumbered partial output is rejected')
  {
    const store = new CatStore({ logger: silent })
    const text = Array.from({ length: 50 }, (_, i) => `Line ${i}.`).join(' ')
    const { document } = store.createDocument({ name: 'Batch ids', text, sourceLang: 'en', targetLang: 'zh-CN' })
    const doc = store.docs.get(document.id)
    store.resolveMtRoute = async () => ({ provider: 'stub', model: 'stub-model', mock: false })

    const stream = (payload) => (async function* () {
      yield { type: 'text-delta', index: 0, text: payload }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()

    store.mtRuntime = {
      stream: () =>
        stream(
          JSON.stringify(
            Array.from({ length: 8 }, (_, offset) => {
              const index = 47 - offset
              return { id: `S${index}`, text: `T${index}` }
            }),
          ),
        ),
    }
    const items = Array.from({ length: 8 }, (_, offset) => ({ index: 40 + offset, text: `Line ${40 + offset}.` }))
    const result = await store.mtSuggestBatch({ documentId: doc.id, items })
    assert.equal(result.items.length, 8)
    assert.deepEqual(
      result.items.map((item) => [item.index, item.text]),
      Array.from({ length: 8 }, (_, offset) => [40 + offset, `T${40 + offset}`]),
    )

    // Seven objects numbered 1..7 for eight inputs is exactly the malformed
    // shape that used to shift every later translation by one. There is no id
    // to trust, so the batch must be rejected and retried one by one.
    store.mtRuntime = {
      stream: () =>
        stream(
          JSON.stringify(
            Array.from({ length: 7 }, (_, offset) => ({ index: offset + 1, text: `wrong-${offset + 1}` })),
          ),
        ),
    }
    await assert.rejects(
      store.mtSuggestBatch({ documentId: doc.id, items }),
      (error) => error.code === 'MT_BATCH_INVALID',
    )
  }

  console.log('\nALL PRE-TRANSLATE TESTS PASSED')
} finally {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
}
