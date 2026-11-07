import assert from 'node:assert/strict'
import { CatStore } from '../lib/store.js'

const silent = { log() {}, warn() {}, error() {} }

function section(name) {
  console.log(`\n# ${name}`)
}

function storeWith(text, extra = {}) {
  const store = new CatStore({ logger: silent })
  const { document } = store.createDocument({
    name: 'QA',
    text,
    sourceLang: extra.sourceLang || 'en',
    targetLang: extra.targetLang || 'zh-CN',
  })
  return { store, doc: store.docs.get(document.id) }
}

try {
  section('clean text produces no issues')
  {
    const { store, doc } = storeWith('Hello world.')
    store.saveDraft({ documentId: doc.id, index: 0, target: '你好，世界。' })
    const report = store.getQaReport({ documentId: doc.id })
    assert.equal(report.issueCount, 0)
    assert.deepEqual(report.counts, {
      PLACEHOLDER_MISSING: 0,
      NUMBER_MISMATCH: 0,
      TERM_NOT_USED: 0,
      EMPTY_TARGET: 0,
    })
  }

  section('placeholder tokens must survive into the target')
  {
    const { store, doc } = storeWith('Hello {0} world.')
    store.saveDraft({ documentId: doc.id, index: 0, target: '你好，世界。' })
    const report = store.getQaReport({ documentId: doc.id })
    assert.equal(report.counts.PLACEHOLDER_MISSING, 1)
    assert.match(report.issues[0].message, /\{0\}/)

    store.saveDraft({ documentId: doc.id, index: 0, target: '你好，{0} 世界。' })
    assert.equal(store.getQaReport({ documentId: doc.id }).issueCount, 0)
  }

  section('inline meta tags are checked even without a literal token in the source')
  {
    const { store, doc } = storeWith('Bold words.')
    doc.segments[0].meta = { inline: [{ token: '{0}', xml: '<b>' }, { token: '{1}', xml: '</b>' }] }
    store.saveDraft({ documentId: doc.id, index: 0, target: '加粗{0}的{1}字。' })
    assert.equal(store.getQaReport({ documentId: doc.id }).issueCount, 0)

    store.saveDraft({ documentId: doc.id, index: 0, target: '加粗的字。' })
    const report = store.getQaReport({ documentId: doc.id })
    assert.equal(report.counts.PLACEHOLDER_MISSING, 2)
  }

  section('numbers are compared as a multiset, thousands separators tolerated')
  {
    const { store, doc } = storeWith('It costs 1,200 dollars and 3 items.')
    store.saveDraft({ documentId: doc.id, index: 0, target: '共 1200 美元，3 件。' })
    assert.equal(store.getQaReport({ documentId: doc.id }).issueCount, 0)

    store.saveDraft({ documentId: doc.id, index: 0, target: '共 1200 美元，4 件。' })
    const report = store.getQaReport({ documentId: doc.id })
    assert.equal(report.counts.NUMBER_MISMATCH, 1)

    store.saveDraft({ documentId: doc.id, index: 0, target: '共 1200 美元。' })
    assert.equal(store.getQaReport({ documentId: doc.id }).counts.NUMBER_MISMATCH, 1)
  }

  section('glossary terms must show up in the target')
  {
    const { store, doc } = storeWith('Open the settings panel.')
    store.addGlossary({ source: 'settings panel', target: '设置面板' })
    store.saveDraft({ documentId: doc.id, index: 0, target: '打开设置面板。' })
    assert.equal(store.getQaReport({ documentId: doc.id }).issueCount, 0)

    store.saveDraft({ documentId: doc.id, index: 0, target: '打开设置页。' })
    const report = store.getQaReport({ documentId: doc.id })
    assert.equal(report.counts.TERM_NOT_USED, 1)
    assert.match(report.issues[0].message, /设置面板/)
  }

  section('a segment claimed as translated but empty is reported')
  {
    const { store, doc } = storeWith('Something.')
    doc.segments[0].confirmedAt = new Date().toISOString()
    doc.segments[0].status = 'translated'
    const report = store.getQaReport({ documentId: doc.id })
    assert.equal(report.counts.EMPTY_TARGET, 1)
    assert.equal(report.issues[0].code, 'EMPTY_TARGET')
  }

  section('report is derived, not stored')
  {
    const { store, doc } = storeWith('Alpha beta.')
    store.saveDraft({ documentId: doc.id, index: 0, target: '阿尔法。' })
    store.getQaReport({ documentId: doc.id })
    assert.equal(Object.hasOwn(doc, 'qa'), false)
    const raw = JSON.stringify(store.bootstrap())
    assert.equal(raw.includes('issueCount'), false)
  }

  console.log('\nALL QA TESTS PASSED')
} catch (error) {
  console.error(error)
  process.exit(1)
}
