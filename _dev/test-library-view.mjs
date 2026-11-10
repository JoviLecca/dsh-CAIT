import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { parseGlossaryCsv } from '../lib/text-utils.js'

// The library page needs a catalogue, not a query: every entry of every chosen
// library, paged, filtered by substring. These tests pin that shape plus the
// export round-trips the requirements doc demands (TMX and CSV only; TBX and
// JSON are export-only and are checked for structure).

const silent = { warn() {}, error() {} }
const dataDir = mkdtempSync(join(tmpdir(), 'cait-library-view-'))

try {
  const store = new CatStore({ dataDir, logger: silent })
  const second = store.createLibrary({ kind: 'tm', name: 'Second TM' })
  const secondTmId = second.library.tmId
  const secondGlossary = store.createLibrary({ kind: 'glossary', name: 'Second glossary' })
  const secondGlossaryId = secondGlossary.library.glossaryId

  // 1. Listing is paged and ordered by the most recently edited entry.
  for (let i = 1; i <= 25; i += 1) {
    store.addTM({ source: `Sentence number ${i}.`, target: `第 ${i} 句。` })
  }
  const firstPage = store.listTmEntries({ page: 1, pageSize: 20 })
  assert.equal(firstPage.kind, 'tm')
  assert.equal(firstPage.total, 25)
  assert.equal(firstPage.page, 1)
  assert.equal(firstPage.pageSize, 20)
  assert.equal(firstPage.totalPages, 2)
  assert.equal(firstPage.entries.length, 20)
  assert.equal(firstPage.languages.source[0], 'en')

  const lastPage = store.listTmEntries({ page: 2, pageSize: 20 })
  assert.equal(lastPage.entries.length, 5)

  // Out-of-range pages clamp instead of returning an empty wall.
  assert.equal(store.listTmEntries({ page: 99, pageSize: 20 }).page, 2)
  assert.equal(store.listTmEntries({ page: 0, pageSize: 20 }).page, 1)

  // 2. pageSize is clamped to the four supported sizes.
  assert.equal(store.listTmEntries({ pageSize: 5000 }).pageSize, 200)
  assert.equal(store.listTmEntries({ pageSize: 1 }).pageSize, 20)
  assert.equal(store.listTmEntries({ pageSize: 100 }).pageSize, 100)

  // 3. Substring search covers source and target, case-insensitively.
  assert.equal(store.listTmEntries({ query: 'number 7' }).total, 1)
  assert.equal(store.listTmEntries({ query: '第 7' }).total, 1)
  assert.equal(store.listTmEntries({ query: 'NUMBER' }).total, 25)

  // 4. Scope: one library, or all of them, and unknown ids are refused.
  store.addTM({ source: 'Second only.', target: '只在第二库。', tmId: secondTmId })
  assert.equal(store.listTmEntries({ tmIds: [secondTmId] }).total, 1)
  assert.equal(store.listTmEntries({}).total, 26)
  assert.throws(
    () => store.listTmEntries({ tmIds: ['tm_missing'] }),
    (error) => error?.code === 'TM_NOT_FOUND' && error.status === 404,
  )

  // 5. Language filters use the catalogue facets.
  assert.deepEqual(store.listTmEntries({}).languages, { source: ['en'], target: ['zh-CN'] })
  assert.equal(store.listTmEntries({ sourceLang: 'de' }).total, 0)
  assert.equal(store.listTmEntries({ targetLang: 'zh-CN' }).total, 26)

  // 6. Glossary listing keeps case sensitivity and exposes the language facet.
  store.addGlossary({ source: 'Nova', target: '诺瓦', note: '产品名', caseSensitive: true })
  store.addGlossary({ source: 'mode', target: '模式', glossaryId: secondGlossaryId })
  const glossaryPage = store.listGlossaryEntries({})
  assert.equal(glossaryPage.kind, 'glossary')
  assert.equal(glossaryPage.total, 2)
  const nova = glossaryPage.entries.find((entry) => entry.source === 'Nova')
  assert.equal(nova.caseSensitive, true)
  assert.equal(nova.note, '产品名')
  assert.equal(store.listGlossaryEntries({ glossaryIds: [secondGlossaryId] }).total, 1)
  assert.equal(store.listGlossaryEntries({ query: 'NOV' }).total, 1)

  // 7. TM export -> import round-trip: same count, notes and target text.
  store.updateTM({
    id: store.tm.find((entry) => entry.source === 'Sentence number 1.').id,
    target: '第一句。',
    note: '检查过',
  })
  const exported = store.exportTM({ tmId: store.mounts.defaultTmId })
  assert.match(exported.filename, /^cait-tm-.*-\d{8}\.tmx$/)
  assert.match(exported.content, /<tmx version="1\.4">/)
  assert.equal(exported.count, 25)

  const before = store.listTmEntries({ tmIds: [store.mounts.defaultTmId] }).total
  store.clearTM({ tmIds: [store.mounts.defaultTmId] })
  assert.equal(store.listTmEntries({ tmIds: [store.mounts.defaultTmId] }).total, 0)
  const back = store.importTmx({
    text: exported.content,
    importAs: 'tm',
    tmId: store.mounts.defaultTmId,
  })
  assert.equal(back.added, before)
  assert.equal(store.listTmEntries({ tmIds: [store.mounts.defaultTmId] }).total, before)
  assert.ok(
    store.tm.some((entry) => entry.source === 'Sentence number 1.' && entry.target === '第一句。'),
  )

  // 8. Glossary CSV round-trip keeps the note and the case-sensitivity flag.
  const csv = store.exportGlossary({ glossaryId: store.mounts.defaultGlossaryId, format: 'csv' })
  assert.match(csv.filename, /\.csv$/)
  assert.match(csv.content, /^source,target,note,sourceLang,caseSensitive,forbidden,preferred\n/)
  const parsed = parseGlossaryCsv(csv.content)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].source, 'Nova')
  assert.equal(parsed[0].note, '产品名')
  assert.equal(parsed[0].caseSensitive, true)

  store.clearGlossary({ glossaryIds: [store.mounts.defaultGlossaryId] })
  store.importGlossary({ text: csv.content, glossaryId: store.mounts.defaultGlossaryId })
  const restored = store.listGlossaryEntries({
    glossaryIds: [store.mounts.defaultGlossaryId],
  }).entries
  assert.equal(restored.length, 1)
  assert.equal(restored[0].target, '诺瓦')
  assert.equal(restored[0].caseSensitive, true)
  assert.equal(restored[0].note, '产品名')

  // 9. TBX and JSON are export-only: check structure, term count and note.
  const tbx = store.exportGlossary({ glossaryId: store.mounts.defaultGlossaryId, format: 'tbx' })
  assert.match(tbx.content, /<tbx [^>]*type="TBX-Basic"/)
  assert.equal((tbx.content.match(/<termEntry /g) || []).length, 1)
  assert.equal((tbx.content.match(/<tig>/g) || []).length, 2)
  assert.match(tbx.content, /<descrip type="note">产品名<\/descrip>/)

  const json = store.exportGlossary({ glossaryId: store.mounts.defaultGlossaryId, format: 'json' })
  const parsedJson = JSON.parse(json.content)
  assert.deepEqual(parsedJson, [
    {
      source: 'Nova',
      target: '诺瓦',
      note: '产品名',
      sourceLang: '',
      caseSensitive: true,
      forbidden: false,
      preferred: false,
    },
  ])

  // 10. Unknown formats and libraries fail loudly.
  assert.throws(
    () => store.exportTM({ tmId: store.mounts.defaultTmId, format: 'csv' }),
    (error) => error?.code === 'INVALID_EXPORT_FORMAT',
  )
  assert.throws(
    () => store.exportGlossary({ glossaryId: store.mounts.defaultGlossaryId, format: 'tmx' }),
    (error) => error?.code === 'INVALID_EXPORT_FORMAT',
  )
  assert.throws(
    () => store.exportTM({ tmId: 'tm_missing' }),
    (error) => error?.code === 'TM_NOT_FOUND',
  )

  console.log('ALL LIBRARY VIEW TESTS PASSED')
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
