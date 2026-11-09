import assert from 'node:assert/strict'
import { CatStore } from '../lib/store.js'

function section(title) {
  console.log(`\n== ${title} ==`)
}

section('merge keeps text, notes and paragraph boundaries')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Merge',
    text: 'Alpha. Beta. Gamma.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const id = created.document.id
  store.saveDraft({ documentId: id, index: 0, target: 'A1' })
  store.saveDraft({ documentId: id, index: 1, target: 'B1' })
  store.addSegmentNote({ documentId: id, index: 0, text: 'first note' })
  store.addSegmentNote({ documentId: id, index: 1, text: 'second note' })

  const merged = store.mergeSegments({ documentId: id, index: 0, count: 2 })
  assert.equal(merged.index, 0)
  assert.equal(merged.segment.source, 'Alpha. Beta.')
  assert.equal(merged.segment.target, 'A1 B1')
  assert.equal(merged.segment.status, 'translated')
  assert.equal(merged.segment.notes.length, 2)
  assert.equal(merged.mergedFrom.length, 2)
  assert.equal(store.docs.get(id).segments.length, 2)
  assert.equal(store.docs.get(id).segments[0].id, 's1')
  assert.equal(store.docs.get(id).segments[1].id, 's2')
}

section('merge refuses cross-paragraph, locked and office formats')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Guards',
    text: 'One.\n\nTwo.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const id = created.document.id
  assert.throws(() => store.mergeSegments({ documentId: id, index: 0, count: 2 }), /跨段落/)
  store.setSegmentLocked({ documentId: id, index: 0, locked: true })
  assert.throws(() => store.mergeSegments({ documentId: id, index: 0, count: 2 }), /锁定/)

  const office = store.createDocument({
    name: 'Office',
    text: 'One. Two.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
    format: 'docx',
  })
  assert.throws(
    () => store.mergeSegments({ documentId: office.document.id, index: 0, count: 2 }),
    /当前格式不支持/,
  )
}

section('split creates two independent segments')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Split',
    text: 'One long sentence.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const id = created.document.id
  store.saveDraft({ documentId: id, index: 0, target: 'A long target.' })
  const parentUid = store.docs.get(id).segments[0].uid
  const result = store.splitSegment({ documentId: id, index: 0, at: 4 })
  assert.equal(result.segments.length, 2)
  assert.equal(result.segments[0].source, 'One')
  assert.equal(result.segments[1].source, 'long sentence.')
  assert.notEqual(result.segments[0].uid, result.segments[1].uid)
  assert.equal(result.splitFrom, parentUid)
  assert.equal(store.docs.get(id).segments[0].meta.splitFrom, parentUid)
  assert.equal(store.docs.get(id).segments[0].confirmedAt, null)
  assert.equal(store.docs.get(id).segments[1].confirmedAt, null)
}

section('split refuses invalid offsets and locked segments')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Split guards',
    text: 'Only one.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const id = created.document.id
  assert.throws(() => store.splitSegment({ documentId: id, index: 0, at: 0 }), /中间/)
  assert.throws(() => store.splitSegment({ documentId: id, index: 0, at: 99 }), /中间/)
  store.setSegmentLocked({ documentId: id, index: 0, locked: true })
  assert.throws(() => store.splitSegment({ documentId: id, index: 0, at: 4 }), /锁定/)
}

console.log('\nALL SEGMENT EDIT TESTS PASSED')
