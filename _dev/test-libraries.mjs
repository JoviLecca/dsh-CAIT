import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { STORE_VERSION } from '../lib/limits.js'

const silent = { warn() {}, error() {} }
const dataDir = mkdtempSync(join(tmpdir(), 'cait-libraries-'))
const file = join(dataDir, 'store.json')

try {
  const store = new CatStore({ dataDir, logger: silent })
  const created = store.createDocument({
    name: 'Library test',
    text: 'Default source.\n\nLegal source.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const documentId = created.document.id

  const legalTm = store.createLibrary({ kind: 'tm', name: 'Legal TM' })
  const legalGlossary = store.createLibrary({ kind: 'glossary', name: 'Legal terms' })
  const legalTmId = legalTm.library.tmId
  const legalGlossaryId = legalGlossary.library.glossaryId
  assert.match(legalTmId, /^tm_/)
  assert.match(legalGlossaryId, /^gl_/)
  assert.deepEqual(store.mounts.tmIds.sort(), ['tm_default', legalTmId].sort())
  assert.deepEqual(store.mounts.glossaryIds.sort(), ['glossary_default', legalGlossaryId].sort())

  store.addTM({ source: 'Default only.', target: '仅默认。', tmId: 'tm_default' })
  store.addTM({ source: 'Legal only.', target: '仅法律。', tmId: legalTmId })
  store.addGlossary({ source: 'defaultterm', target: '默认术语', glossaryId: 'glossary_default' })
  store.addGlossary({ source: 'legalterm', target: '法律术语', glossaryId: legalGlossaryId })

  assert.equal(store.bootstrap().libraries.tm.length, 2)
  assert.equal(store.bootstrap().libraries.glossary.length, 2)
  assert.equal(store.bootstrap().tm.total, 2)
  assert.equal(store.bootstrap().tm.count, 2)
  assert.equal(store.bootstrap().libraries.tm.find((item) => item.tmId === legalTmId).entryCount, 1)

  // Mounted-only lookup: the legal library is mounted, so this is visible.
  assert.equal(store.lookupTM({ query: 'Legal only.', threshold: 0 }).matches[0].tmId, legalTmId)
  assert.equal(store.findGlossaryHits('legalterm').length, 1)

  // Unmount the legal libraries; lookups and glossary hits must hide their content.
  store.setMounts({ tmIds: ['tm_default'], glossaryIds: ['glossary_default'] })
  assert.equal(store.lookupTM({ query: 'Legal only.', threshold: 0.99 }).matches.length, 0)
  assert.equal(store.lookupTM({ query: 'Default only.', threshold: 0 }).matches.length, 1)
  assert.equal(store.findGlossaryHits('legalterm').length, 0)
  assert.equal(store.findGlossaryHits('defaultterm').length, 1)
  assert.equal(store.bootstrap().tm.count, 1)
  assert.equal(store.bootstrap().tm.total, 2)
  assert.equal(
    store.bootstrap().libraries.tm.find((item) => item.tmId === legalTmId).mounted,
    false,
  )

  // Re-mount both, then write a confirmed segment into the legal TM explicitly.
  store.setMounts({
    tmIds: ['tm_default', legalTmId],
    glossaryIds: ['glossary_default', legalGlossaryId],
    defaultTmId: legalTmId,
  })
  const result = store.confirmSegment({
    documentId,
    index: 1,
    target: '法律译文。',
    targetTmId: legalTmId,
  })
  assert.equal(result.tm.tmId, legalTmId)
  assert.equal(result.tm.added, 1)
  assert.equal(
    store.tm.filter((entry) => entry.source === 'Legal source.' && entry.tmId === legalTmId).length,
    1,
  )
  assert.equal(
    store.tm.filter((entry) => entry.source === 'Legal source.' && entry.tmId === 'tm_default')
      .length,
    0,
  )

  // Confirming without targetTmId writes the configured default work library.
  store.setMounts({ defaultTmId: legalTmId })
  const defaultWrite = store.confirmSegment({ documentId, index: 0, target: '默认译文。' })
  assert.equal(defaultWrite.tm.tmId, legalTmId)

  // Removing the current default falls back to the first mounted library.
  store.setMounts({ tmIds: ['tm_default'], glossaryIds: ['glossary_default'] })
  assert.equal(store.mounts.defaultTmId, 'tm_default')

  // Unknown IDs and empty mounts are rejected.
  assert.throws(() => store.setMounts({ tmIds: [] }), /至少挂载一个/)
  assert.throws(() => store.setMounts({ tmIds: ['tm_missing'] }), /不存在/)
  assert.throws(
    () => store.setMounts({ tmIds: ['tm_default'], defaultTmId: legalTmId }),
    /默认翻译记忆库/,
  )

  const snapshot = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(snapshot.version, STORE_VERSION)
  assert.equal(snapshot.tmLibraries.length, 2)
  assert.equal(snapshot.glossaryLibraries.length, 2)
  assert.deepEqual(snapshot.mounts.tmIds, ['tm_default'])
  assert.equal(
    snapshot.tm.some((entry) => entry.tmId === legalTmId),
    true,
  )

  // Libraries, mounts and the per-library TM split survive a restart.
  const reloaded = new CatStore({ dataDir, logger: silent })
  assert.equal(reloaded.tmLibraries.length, 2)
  assert.equal(reloaded.glossaryLibraries.length, 2)
  assert.equal(reloaded.mounts.defaultTmId, 'tm_default')
  assert.deepEqual(reloaded.mounts.tmIds, ['tm_default'])
  assert.equal(reloaded.lookupTM({ query: 'Legal only.', threshold: 0.99 }).matches.length, 0)
  assert.equal(
    reloaded.lookupTM({ query: 'Default only.', threshold: 0 }).matches[0].tmId,
    'tm_default',
  )
  assert.equal(
    reloaded.bootstrap().libraries.tm.find((item) => item.tmId === legalTmId).entryCount,
    3,
  )

  // F2: a known but unmounted target cannot receive a confirmed segment.
  const f2Doc = reloaded.createDocument({
    name: 'F2 target',
    text: 'Unmounted target source.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  assert.throws(
    () =>
      reloaded.confirmSegment({
        documentId: f2Doc.document.id,
        index: 0,
        target: '不应写入。',
        targetTmId: legalTmId,
      }),
    /未挂载/,
  )
  assert.equal(
    reloaded.tm.some((entry) => entry.source === 'Unmounted target source.'),
    false,
  )
  assert.equal(reloaded.docs.get(f2Doc.document.id).segments[0].status, 'pending')

  // D2: clear defaults to mounted-only; explicit unmounted IDs are rejected.
  const defaultTmBefore = reloaded.tm.filter((entry) => entry.tmId === 'tm_default').length
  const legalTmBefore = reloaded.tm.filter((entry) => entry.tmId === legalTmId).length
  assert.ok(defaultTmBefore > 0)
  assert.ok(legalTmBefore > 0)
  const clearedMounted = reloaded.clearTM({})
  assert.equal(clearedMounted.scope, 'mounted')
  assert.equal(reloaded.tm.filter((entry) => entry.tmId === 'tm_default').length, 0)
  assert.equal(reloaded.tm.filter((entry) => entry.tmId === legalTmId).length, legalTmBefore)
  assert.throws(() => reloaded.clearTM({ tmIds: [legalTmId] }), /未挂载/)

  // D2: single-entry edit/delete works on any library, mounted or not (the
  // library page manages unmounted ones too), but never mounts it as a side
  // effect. Bulk clear stays mount-scoped, which is the guard that matters.
  const legalTerm = reloaded.glossary.find((entry) => entry.glossaryId === legalGlossaryId)
  assert.ok(legalTerm)
  const mountsBefore = reloaded.mounts.glossaryIds.slice()
  const editedTerm = reloaded.updateGlossary({ id: legalTerm.id, target: '不应更新的术语。' })
  assert.equal(editedTerm.entry.target, '不应更新的术语。')
  assert.deepEqual(reloaded.mounts.glossaryIds, mountsBefore, 'editing must not mount the library')
  reloaded.deleteGlossary({ id: legalTerm.id })
  assert.equal(
    reloaded.glossary.some((entry) => entry.id === legalTerm.id),
    false,
  )
  assert.deepEqual(reloaded.mounts.glossaryIds, mountsBefore)

  reloaded.addGlossary({
    source: 'Another term',
    target: '另一个术语',
    glossaryId: legalGlossaryId,
  })

  const clearedGlossary = reloaded.clearGlossary({})
  assert.equal(clearedGlossary.scope, 'mounted')
  assert.equal(
    reloaded.glossary.filter((entry) => entry.glossaryId === 'glossary_default').length,
    0,
  )
  assert.equal(reloaded.glossary.filter((entry) => entry.glossaryId === legalGlossaryId).length, 1)
  assert.throws(() => reloaded.clearGlossary({ glossaryIds: [legalGlossaryId] }), /未挂载/)

  // Only an explicit all:true clears the unmounted libraries too.
  const allTm = reloaded.clearTM({ all: true })
  const allGlossary = reloaded.clearGlossary({ all: true })
  assert.equal(allTm.scope, 'all')
  assert.equal(allGlossary.scope, 'all')
  assert.equal(reloaded.tm.length, 0)
  assert.equal(reloaded.glossary.length, 0)

  console.log('test-libraries: all assertions passed')
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
