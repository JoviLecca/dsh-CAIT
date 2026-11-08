import assert from 'node:assert/strict'
import { CatStore } from '../lib/store.js'

function section(title) {
  console.log(`\n== ${title} ==`)
}

section('clear unconfirmed pretranslated targets')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Cleanup',
    text: 'One. Two. Three. Four.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const id = created.document.id

  // A human draft must survive the cleanup even though it is unconfirmed.
  store.saveDraft({ documentId: id, index: 0, target: '人工草稿' })
  store.mtSuggestBatch = async ({ items }) => ({
    items: items.map(({ index, text }) => ({ index, text: `MT:${text}` })),
    provider: 'stub',
    model: 'stub',
    latencyMs: 0,
  })
  await store.preTranslate({ documentId: id, from: 0, count: 4 })

  const doc = store.docs.get(id)
  assert.equal(doc.segments[0].origin, 'manual')
  assert.equal(doc.segments[0].target, '人工草稿')
  assert.deepEqual(doc.segments.slice(1).map((segment) => segment.origin), ['mt', 'mt', 'mt'])

  // Confirmed work is never part of the cleanup.
  store.confirmSegment({ documentId: id, index: 1 })
  assert.equal(doc.segments[1].status, 'confirmed')

  const preview = store.clearUnconfirmedTranslations({ documentId: id })
  assert.equal(preview.requiresConfirmation, true)
  assert.deepEqual(preview.counts, { total: 2, mt: 2, tm: 0, auto: 0 })
  assert.equal(doc.segments[2].target, 'MT:Three.')
  assert.equal(doc.segments[3].target, 'MT:Four.')

  const result = store.clearUnconfirmedTranslations({ documentId: id, confirm: true })
  assert.equal(result.cleared, 2)
  assert.equal(result.requiresConfirmation, false)
  assert.equal(result.cursor, 2)
  assert.equal(doc.segments[0].target, '人工草稿')
  assert.equal(doc.segments[1].target, 'MT:Two.')
  assert.equal(doc.segments[1].status, 'confirmed')
  assert.equal(doc.segments[2].target, '')
  assert.equal(doc.segments[2].suggestion, '')
  assert.equal(doc.segments[2].origin, null)
  assert.equal(doc.segments[2].status, 'pending')
  assert.equal(doc.segments[3].target, '')
  assert.equal(doc.segments[3].status, 'pending')

  // Repeating the cleanup is idempotent: nothing is eligible any more.
  const again = store.clearUnconfirmedTranslations({ documentId: id, confirm: true })
  assert.equal(again.cleared, 0)
  assert.equal(doc.segments[1].target, 'MT:Two.')
}

section('preview does not mutate')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Preview',
    text: 'Alpha. Beta.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const id = created.document.id
  store.mtSuggestBatch = async ({ items }) => ({
    items: items.map(({ index, text }) => ({ index, text: `MT:${text}` })),
  })
  await store.preTranslate({ documentId: id, from: 0, count: 2 })
  const before = store.docs.get(id).segments.map((segment) => segment.target)
  const preview = store.clearUnconfirmedTranslations({ documentId: id })
  assert.equal(preview.counts.total, 2)
  assert.deepEqual(store.docs.get(id).segments.map((segment) => segment.target), before)
}

console.log('\nALL CLEAR-PRETRANSLATED TESTS PASSED')
