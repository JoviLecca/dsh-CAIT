import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { extractTerms } from '../lib/term-extract.js'

const silent = { log() {}, warn() {}, error() {} }

function section(name) {
  console.log(`\n# ${name}`)
}

function freshStore() {
  return new CatStore({ logger: silent })
}

const NOVA = [
  'Nova is a tool.',
  'Nova works with the Design System.',
  'The Design System is fast.',
  'Every Nova build ships the Design System.',
].join(' ')

try {
  section('repeated multi-word names are candidates, fragments are not')
  {
    const candidates = extractTerms(NOVA, { limit: 20 })
    const terms = candidates.map((candidate) => candidate.term.toLowerCase())
    assert.ok(terms.includes('design system'))
    assert.ok(terms.includes('nova'))
    // "design" and "system" only appear inside "Design System".
    assert.ok(!terms.includes('design'))
    assert.ok(!terms.includes('system'))
  }

  section('candidates keep their original casing')
  {
    const candidate = extractTerms(NOVA, { limit: 20 }).find((item) => item.term.toLowerCase() === 'design system')
    assert.equal(candidate.term, 'Design System')
  }

  section('minCount and limit are honoured')
  {
    assert.equal(extractTerms('Nova is here.', { minCount: 2 }).length, 0)
    const many = extractTerms(NOVA, { limit: 1 })
    assert.equal(many.length, 1)
    assert.equal(many[0].term, 'Design System')
  }

  section('terms already in the glossary are marked')
  {
    const candidates = extractTerms(NOVA, { knownTerms: ['design system'], limit: 20 })
    const known = candidates.find((item) => item.term.toLowerCase() === 'design system')
    assert.equal(known.inLibrary, true)
    const other = candidates.find((item) => item.term.toLowerCase() === 'nova')
    assert.equal(other.inLibrary, false)
  }

  section('CJK repeated substrings are found without a tokenizer')
  {
    const text = '术语库是术语库的核心。术语库管理很重要。术语库支持导入导出，术语库可以搜索。'
    const candidates = extractTerms(text, { limit: 10 })
    assert.ok(candidates.length > 0)
    assert.equal(candidates[0].term, '术语库')
    assert.ok(candidates[0].count >= 4)
  }

  section('single-occurrence proper names are candidates')
  {
    const text =
      'Lyra met Pan at the Citadel. Mara said the gate was closed. Vex laughed. Oriel watched from the tower. The system works.'
    const candidates = extractTerms(text, { minCount: 1, limit: 20 })
    const terms = candidates.map((candidate) => candidate.term.toLowerCase())
    for (const name of ['mara', 'vex', 'oriel', 'citadel']) {
      assert.ok(terms.includes(name), `${name} should be a candidate`)
    }
    assert.ok(!terms.includes('the'))
    const mara = candidates.find((candidate) => candidate.term === 'Mara')
    assert.equal(mara.proper, true)
    assert.equal(mara.type, 'person')
    assert.ok(mara.confidence > 0)
    assert.ok(Number.isInteger(mara.evidenceIndex))
  }

  section('single-occurrence CJK names before speech verbs are candidates')
  {
    const text = '李明说，门开了。王五笑了。'
    const candidates = extractTerms(text, { minCount: 1, limit: 20 })
    const terms = candidates.map((candidate) => candidate.term)
    assert.ok(terms.includes('李明'))
    assert.ok(terms.includes('王五'))
  }

  section('single occurrences and stopword phrases are never candidates')
  {
    const candidates = extractTerms('The system works and the system is fast.', { limit: 20 })
    assert.ok(!candidates.some((item) => item.term.toLowerCase() === 'the system'))
  }

  section('the store mines a document and attaches memory evidence')
  {
    const store = freshStore()
    const { document } = store.createDocument({
      name: 'Nova doc',
      text: 'Nova opens fast.\nNova closes fast.\nThe Design System is shared.\nThe Design System is small.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    store.addTM({ source: 'Please open the Design System.', target: '请打开设计系统。' })
    const result = store.termCandidates({ documentId: document.id, limit: 20 })
    assert.equal(result.documentId, document.id)
    assert.ok(result.total > 0)
    const design = result.candidates.find((item) => item.term.toLowerCase() === 'design system')
    assert.ok(design)
    assert.deepEqual(design.evidence, ['请打开设计系统。'])
    const nova = result.candidates.find((item) => item.term.toLowerCase() === 'nova')
    assert.deepEqual(nova.evidence, [])
  }

  section('a batch adds terms once and skips duplicates')
  {
    const store = freshStore()
    const before = store.glossary.length
    const first = store.addGlossaryEntries({
      entries: [
        { source: 'Design System', target: '设计系统', note: 'product' },
        { source: 'Nova', target: 'Nova 工具' },
      ],
    })
    assert.equal(first.added, 2)
    assert.equal(first.skipped, 0)
    assert.equal(store.glossary.length, before + 2)

    const second = store.addGlossaryEntries({
      entries: [
        { source: 'design system', target: '设计体系' },
        { source: '', target: '空' },
      ],
    })
    assert.equal(second.added, 0)
    assert.equal(second.skipped, 2)
    // The existing wording wins; a duplicate add never overwrites it.
    assert.equal(store.glossary.find((entry) => entry.source === 'Design System').target, '设计系统')
  }

  section('bulk terms survive a restart')
  {
    const dataDir = mkdtempSync(join(tmpdir(), 'cait-terms-'))
    try {
      const store = new CatStore({ dataDir, logger: silent })
      store.addGlossaryEntries({ entries: [{ source: 'Release train', target: '发布列车' }] })
      store.flushPersist()
      const reopened = new CatStore({ dataDir, logger: silent })
      const found = reopened.glossary.find((entry) => entry.source === 'Release train')
      assert.ok(found)
      assert.equal(found.target, '发布列车')
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  }

  console.log('\nALL TERM TESTS PASSED')
} catch (error) {
  console.error(error)
  process.exit(1)
}
