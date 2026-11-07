// End-to-end smoke test for the 1.1 workflow, exercised through the same store
// methods the RPC layer calls: import -> pre-translate -> QA -> confirm -> export
// -> reload. It deliberately bypasses the UI.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'

const silent = { log() {}, warn() {}, error() {} }
const dir = mkdtempSync(join(tmpdir(), 'cait-e2e-'))
const section = (name) => console.log(`\n# ${name}`)
const open = (dataDir) => new CatStore({ logger: silent, dataDir })
const settle = (store) => store.flushPersist?.()

try {
  section('import, pre-translate the whole document, review, confirm, export')
  const store = open(dir)
  const imported = store.importFile({
    name: 'notes.md',
    text: 'Nova is a tool.\nIt has 12 modes.\nUse it daily.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const docId = imported.document.id
  const doc = store.docs.get(docId)
  assert.equal(doc.segments.length, 3, 'three segments imported')
  assert.deepEqual(
    doc.segments.map((s) => s.status),
    ['pending', 'pending', 'pending'],
  )

  store.mtSuggest = async ({ text }) => ({ text: `译(${text})`, provider: 'stub', model: 'stub', latencyMs: 1 })

  const blocks = []
  let from = 0
  while (from !== null) {
    const block = await store.preTranslate({ documentId: docId, from, count: 8 })
    blocks.push(block)
    from = block.next
    assert.ok(blocks.length < 10, 'pre-translate terminates')
  }
  assert.equal(blocks.length, 1, 'three segments fit one block')
  assert.equal(blocks[0].filled, 3)
  assert.equal(blocks[0].next, null)
  assert.deepEqual(
    doc.segments.map((s) => s.status),
    ['translated', 'translated', 'translated'],
  )
  assert.deepEqual(
    doc.segments.map((s) => s.origin),
    ['mt', 'mt', 'mt'],
  )

  section('the middle column keeps the machine baseline while the target is edited')
  store.saveDraft({ documentId: docId, index: 1, target: '它有很多模式。' })
  assert.ok(doc.segments[1].suggestion.startsWith('译('), 'baseline survives the edit')
  assert.equal(doc.segments[1].origin, 'manual')

  section('QA flags the dropped number without blocking anything')
  const qa = store.getQaReport({ documentId: docId })
  assert.equal(qa.counts.NUMBER_MISMATCH, 1)
  assert.equal(qa.issueCount, 1)
  assert.equal(qa.issues[0].index, 1)

  section('batch confirm accepts everything awaiting review')
  const confirmed = store.confirmSegmentsForTool({ documentId: docId, status: 'translated' })
  assert.equal(confirmed.confirmed.length, 3)
  assert.equal(confirmed.skipped.length, 0)
  assert.equal(confirmed.done, true)
  assert.deepEqual(
    doc.segments.map((s) => s.status),
    ['confirmed', 'confirmed', 'confirmed'],
  )
  assert.equal(store.progress(doc).percent, 100)

  section('export still works with reminders present')
  store.saveDraft({ documentId: docId, index: 2, target: '每天使用{0}' })
  const out = store.exportDocument({ format: 'bilingual-md', documentId: docId })
  assert.match(out.content, /Nova is a tool/)
  assert.match(out.content, /confirmed/)

  section('everything survives a reload, including the store version')
  settle(store)
  const raw = JSON.parse(readFileSync(join(dir, 'store.json'), 'utf8'))
  assert.equal(raw.version, 3)
  const reopened = open(dir)
  const again = reopened.docs.get(docId)
  assert.equal(again.segments.length, 3)
  assert.deepEqual(
    again.segments.map((s) => s.status),
    ['confirmed', 'confirmed', 'confirmed'],
  )
  assert.ok(again.segments[1].suggestion.startsWith('译('), 'suggestion persisted')

  console.log('\nALL E2E TESTS PASSED')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
