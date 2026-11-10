import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'

const silent = { log() {}, warn() {}, error() {} }
const roots = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cait-mt-batch-'))
  roots.push(dir)
  return dir
}

function section(name) {
  console.log(`\n# ${name}`)
}

function makeRuntime(batchReply, singleReply) {
  const prompts = []
  return {
    prompts,
    available: true,
    async listRoutes() {
      return {
        providers: [
          {
            id: 'fake',
            name: 'Fake',
            models: [{ id: 'm1', name: 'M1' }],
            configured: true,
            hasModels: true,
          },
        ],
        fallback: false,
        message: '',
      }
    },
    async stream(options) {
      const prompt = options.messages[0].content[0].text
      prompts.push({ purpose: options.purpose, prompt })
      const text = options.purpose === 'cait-mt-batch' ? batchReply(prompt) : singleReply(prompt)
      return (async function* () {
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

function sourceOf(prompt) {
  const match = prompt.match(/Source segment:\n([\s\S]*)$/)
  return match ? match[1].trim() : '?'
}

try {
  section('batch ids are local, so a batch far into the document maps by position')
  {
    const lines = Array.from({ length: 110 }, (_, i) => `Line ${i} is here.`)
    const runtime = makeRuntime(
      () =>
        JSON.stringify(
          Array.from({ length: 8 }, (_, offset) => ({
            id: `T${offset + 1}`,
            text: `T(${100 + offset})`,
          })),
        ),
      () => 'single',
    )
    const store = new CatStore({ dataDir: tempDir(), logger: silent, mtRuntime: runtime })
    store.settings.mt.provider = 'fake'
    store.settings.mt.model = 'm1'
    const { document } = store.createDocument({
      name: 'Batch',
      text: lines.join('\n'),
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const items = Array.from({ length: 8 }, (_, offset) => ({
      index: 100 + offset,
      text: lines[100 + offset],
    }))
    const result = await store.mtSuggestBatch({ documentId: document.id, items })
    assert.equal(result.items.length, 8)
    assert.deepEqual(
      result.items.map((item) => item.index),
      [100, 101, 102, 103, 104, 105, 106, 107],
    )
    assert.equal(result.items[0].text, 'T(100)')
    assert.equal(result.items[7].text, 'T(107)')
    const prompt = runtime.prompts.at(-1).prompt
    assert.ok(prompt.includes('"id":"T1"'), 'prompt shows the local batch id')
    assert.ok(!prompt.includes('previous:'), 'prompt no longer repeats neighbours')
  }

  section('a model that renumbers from 1 stays aligned instead of shifting')
  {
    const lines = Array.from({ length: 8 }, (_, i) => `Line ${i} is here.`)
    const runtime = makeRuntime(
      () => JSON.stringify(lines.map((_, i) => ({ id: String(i + 1), text: `T(${i})` }))),
      () => 'single',
    )
    const store = new CatStore({ dataDir: tempDir(), logger: silent, mtRuntime: runtime })
    store.settings.mt.provider = 'fake'
    store.settings.mt.model = 'm1'
    const { document } = store.createDocument({
      name: 'Renumber',
      text: lines.join('\n'),
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const items = lines.map((text, index) => ({ index, text }))
    const result = await store.mtSuggestBatch({ documentId: document.id, items })
    assert.deepEqual(
      result.items.map((item) => [item.index, item.text]),
      lines.map((_, i) => [i, `T(${i})`]),
    )
  }

  section('absolute S-ids from the old protocol are refused, not guessed')
  {
    const lines = Array.from({ length: 8 }, (_, i) => `Line ${i} is here.`)
    const runtime = makeRuntime(
      () => JSON.stringify(lines.map((_, i) => ({ id: `S${i}`, text: `T(${i})` }))),
      () => 'single',
    )
    const store = new CatStore({ dataDir: tempDir(), logger: silent, mtRuntime: runtime })
    store.settings.mt.provider = 'fake'
    store.settings.mt.model = 'm1'
    const { document } = store.createDocument({
      name: 'Old ids',
      text: lines.join('\n'),
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const items = lines.map((text, index) => ({ index, text }))
    await assert.rejects(
      () => store.mtSuggestBatch({ documentId: document.id, items }),
      (error) => error.code === 'MT_BATCH_INVALID',
    )
  }

  section('merged neighbours are dropped instead of written into both segments')
  {
    const lines = Array.from({ length: 8 }, (_, i) => `Line ${i} is here.`)
    const runtime = makeRuntime(
      () =>
        JSON.stringify([
          { id: 'T1', text: 'Line zero is here. Line one is here.' },
          { id: 'T2', text: 'Line one is here.' },
          { id: 'T3', text: 'Line two is here.' },
          { id: 'T4', text: 'Line three is here.' },
          { id: 'T5', text: 'Line four is here.' },
          { id: 'T6', text: 'Line five is here.' },
          { id: 'T7', text: 'Line six is here.' },
          { id: 'T8', text: 'Line seven is here.' },
        ]),
      () => 'single',
    )
    const store = new CatStore({ dataDir: tempDir(), logger: silent, mtRuntime: runtime })
    store.settings.mt.provider = 'fake'
    store.settings.mt.model = 'm1'
    const { document } = store.createDocument({
      name: 'Merged',
      text: lines.join('\n'),
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const items = lines.map((text, index) => ({ index, text }))
    const result = await store.mtSuggestBatch({ documentId: document.id, items })
    assert.deepEqual(
      result.items.map((item) => item.index),
      [1, 2, 3, 4, 5, 6, 7],
      'the merged answer for segment 0 is retried individually',
    )
    assert.ok(result.partial)
  }

  section('the same text for two different sources is dropped')
  {
    const lines = Array.from({ length: 3 }, (_, i) => `Line ${i} is here.`)
    const runtime = makeRuntime(
      () =>
        JSON.stringify([
          { id: 'T1', text: '这是第一句话对应的译文内容' },
          { id: 'T2', text: '这是第一句话对应的译文内容' },
          { id: 'T3', text: '这是第三句话对应的译文内容' },
        ]),
      () => 'single',
    )
    const store = new CatStore({ dataDir: tempDir(), logger: silent, mtRuntime: runtime })
    store.settings.mt.provider = 'fake'
    store.settings.mt.model = 'm1'
    const { document } = store.createDocument({
      name: 'Duplicate',
      text: lines.join('\n'),
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const items = lines.map((text, index) => ({ index, text }))
    const result = await store.mtSuggestBatch({ documentId: document.id, items })
    assert.deepEqual(result.items, [{ index: 2, text: '这是第三句话对应的译文内容' }])
  }

  section('pre-translate never writes one segment into another')
  {
    const lines = Array.from({ length: 110 }, (_, i) => `Line ${i} is here.`)
    const runtime = makeRuntime(
      // The model answers with absolute indices from the old protocol and
      // merges neighbours. Every answer must be refused, and the per-segment
      // retry must fill each segment with its own translation.
      () =>
        JSON.stringify(
          lines.slice(100).map((_, i) => ({ id: `S${100 + i}`, text: `BAD-${100 + i}` })),
        ),
      (prompt) => `OK(${sourceOf(prompt)})`,
    )
    const store = new CatStore({ dataDir: tempDir(), logger: silent, mtRuntime: runtime })
    store.settings.mt.provider = 'fake'
    store.settings.mt.model = 'm1'
    const { document } = store.createDocument({
      name: 'Flow',
      text: lines.join('\n'),
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const result = await store.preTranslate({ documentId: document.id, from: 100, count: 8 })
    assert.equal(result.filled, 8)
    assert.equal(result.failed.length, 0)
    const doc = store.docs.get(document.id)
    for (let offset = 0; offset < 8; offset += 1) {
      const segment = doc.segments[100 + offset]
      assert.equal(segment.target, `OK(Line ${100 + offset} is here.)`)
      assert.ok(!segment.target.includes('BAD-'))
      assert.ok(!segment.target.includes(`Line ${100 + offset + 1} `), 'no neighbour text')
    }
  }
} finally {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
}
