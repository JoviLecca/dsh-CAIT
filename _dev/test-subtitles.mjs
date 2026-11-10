import assert from 'node:assert/strict'
import { CatStore } from '../lib/store.js'
import { buildSrt } from '../lib/formats.js'

const SRT = `1
00:00:01,000 --> 00:00:03,000
Hello world.

2
00:00:03,000 --> 00:00:05,000
Second line.
`

function importedStore(text = SRT) {
  const store = new CatStore()
  const result = store.importFile({ name: 'sample.srt', kind: 'srt', text, sourceLang: 'en', targetLang: 'zh-CN' })
  return { store, result }
}

{
  const { store, result } = importedStore()
  const id = result.document.id
  assert.equal(store.docs.get(id).format, 'srt')
  store.saveDraft({ documentId: id, index: 0, target: '你好世界。' })
  store.saveDraft({ documentId: id, index: 1, target: '第二行。' })

  const shifted = store.shiftSubtitles({ documentId: id, offsetMs: 500 })
  assert.equal(shifted.shifted, 2)
  assert.equal(store.docs.get(id).segments[0].meta.start, 1500)
  assert.equal(store.docs.get(id).segments[1].meta.end, 5500)

  const merged = store.mergeCues({ documentId: id, index: 0, count: 2 })
  assert.equal(merged.segment.source, 'Hello world.\nSecond line.')
  assert.equal(merged.segment.target, '你好世界。\n第二行。')
  const mergedSegment = store.docs.get(id).segments[0]
  assert.equal(mergedSegment.meta.start, 1500)
  assert.equal(mergedSegment.meta.end, 5500)
  assert.equal(mergedSegment.meta.mergedFrom.length, 2)

  const split = store.splitCue({ documentId: id, index: 0, at: 3000 })
  assert.equal(split.segments.length, 2)
  assert.equal(store.docs.get(id).segments[0].meta.end, 3000)
  assert.equal(store.docs.get(id).segments[1].meta.start, 3000)
  assert.equal(split.segments[0].target + split.segments[1].target, '你好世界。\n第二行。')
  assert.equal(store.docs.get(id).segments.length, 2)
  const exported = buildSrt(store.docs.get(id))
  assert.match(exported, /00:00:01,500 --> 00:00:03,000/)
  assert.match(exported, /00:00:03,000 --> 00:00:05,500/)
}

{
  const { store, result } = importedStore()
  const id = result.document.id
  store.setSegmentLocked({ documentId: id, index: 0, locked: true })
  assert.throws(() => store.shiftSubtitles({ documentId: id, offsetMs: 100 }), /锁定/)
  assert.throws(() => store.mergeCues({ documentId: id, index: 0, count: 2 }), /锁定/)
  assert.throws(() => store.splitCue({ documentId: id, index: 0, at: 2000 }), /锁定/)
}

{
  const overlapping = `1
00:00:01,000 --> 00:00:03,000
One.

2
00:00:02,500 --> 00:00:04,000
Two.
`
  const { store, result } = importedStore(overlapping)
  const report = store.getQaReport({ documentId: result.document.id })
  const issue = report.issues.find((item) => item.code === 'SUBTITLE_OVERLAP')
  assert.ok(issue, 'overlap is reported')
  assert.equal(issue.risk, 'high')
  assert.equal(report.counts.SUBTITLE_OVERLAP, 1)
}

{
  const { store, result } = importedStore()
  const id = result.document.id
  assert.throws(() => store.shiftSubtitles({ documentId: id, offsetMs: -2000 }), /负时间码/)
  assert.equal(store.docs.get(id).segments[0].meta.start, 1000)
}

console.log('ALL SUBTITLE TESTS PASSED')
