import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'

const silent = { log() {}, warn() {}, error() {} }
const roots = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cait-propose-'))
  roots.push(dir)
  return dir
}

function section(name) {
  console.log(`\n# ${name}`)
}

try {
  section('a proposal never touches the target')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({
      name: 'Propose',
      text: 'Nova is a tool. It has 12 modes.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    store.saveDraft({ documentId: doc.id, index: 0, target: 'Nova 是工具。' })

    const result = store.proposeTranslation({
      documentId: doc.id,
      index: 0,
      target: 'Nova 是一款工具。',
      reason: '术语统一：tool → 工具',
    })
    assert.equal(doc.segments[0].target, 'Nova 是工具。')
    assert.equal(doc.segments[0].suggestion, 'Nova 是一款工具。')
    assert.equal(doc.segments[0].suggestionReason, '术语统一：tool → 工具')
    assert.equal(doc.segments[0].status, 'translated')
    assert.equal(doc.segments[0].origin, 'manual')
    assert.equal(result.segment.suggestionReason, '术语统一：tool → 工具')

    const adopted = store.adoptSuggestion({ documentId: doc.id, index: 0 })
    assert.equal(adopted.segment.target, 'Nova 是一款工具。')
    // Adopting keeps the provenance of who wrote the text.
    assert.equal(doc.segments[0].origin, 'manual')
    assert.equal(doc.segments[0].suggestion, 'Nova 是一款工具。')
  }

  section('a proposal can be the first text a segment receives')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({
      name: 'Fresh',
      text: 'Alpha beta gamma.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    store.proposeTranslation({ documentId: doc.id, index: 0, target: '阿尔法贝塔伽马。' })
    assert.equal(doc.segments[0].target, '')
    assert.equal(doc.segments[0].status, 'translated')
    assert.equal(doc.segments[0].origin, 'agent')
    assert.equal(doc.segments[0].suggestionReason, '')
  }

  section('confirmed segments refuse proposals')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({
      name: 'Locked',
      text: 'Beta gamma. Delta epsilon.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    store.saveDraft({ documentId: doc.id, index: 0, target: '贝塔伽马德尔塔。' })
    store.confirmSegment({ documentId: doc.id, index: 0 })
    assert.throws(
      () => store.proposeTranslation({ documentId: doc.id, index: 0, target: '改一下。' }),
      /已确认的句段不能提建议/,
    )
    assert.throws(
      () => store.proposeTranslation({ documentId: doc.id, index: 1, target: '   ' }),
      /建议译文为空/,
    )
  }

  section('proposal and reason survive a round-trip')
  {
    const dir = tempDir()
    const store = new CatStore({ dataDir: dir, logger: silent })
    const { document } = store.createDocument({
      name: 'Persist',
      text: 'Gamma delta epsilon.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    store.proposeTranslation({
      documentId: doc.id,
      index: 0,
      target: '伽马德尔塔艾普西龙。',
      reason: '风格统一',
    })

    const reopened = new CatStore({ dataDir: dir, logger: silent })
    const reloaded = reopened.docs.get(doc.id)
    assert.equal(reloaded.segments[0].suggestion, '伽马德尔塔艾普西龙。')
    assert.equal(reloaded.segments[0].suggestionReason, '风格统一')
    assert.equal(reloaded.segments[0].origin, 'agent')
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}

console.log('\nALL PROPOSE TESTS PASSED')
