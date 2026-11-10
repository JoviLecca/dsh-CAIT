import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { STORE_VERSION } from '../lib/store-utils.js'

const silent = { warn() {}, error() {} }

function libraries(store) {
  const a = store.createLibrary({ kind: 'tm', name: 'Client A TM' }).library.tmId
  const b = store.createLibrary({ kind: 'tm', name: 'Client B TM' }).library.tmId
  const ga = store.createLibrary({ kind: 'glossary', name: 'Client A terms' }).library.glossaryId
  const gb = store.createLibrary({ kind: 'glossary', name: 'Client B terms' }).library.glossaryId
  return { a, b, ga, gb }
}

{
  const store = new CatStore()
  const { a, b, ga, gb } = libraries(store)
  store.addTM({ source: 'Alpha source.', target: '阿尔法。', tmId: a })
  store.addTM({ source: 'Beta source.', target: '贝塔。', tmId: b })
  store.addGlossary({ source: 'alpha_term', target: '阿尔法术语', glossaryId: ga })
  store.addGlossary({ source: 'beta_term', target: '贝塔术语', glossaryId: gb })

  const docA = store.createDocument({
    name: 'Client A',
    text: 'Alpha source.\n\nAlpha second.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
    tmIds: [a],
    glossaryIds: [ga],
    defaultWriteTmId: a,
  }).document
  const docB = store.createDocument({
    name: 'Client B',
    text: 'Beta source.\n\nBeta second.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
    tmIds: [b],
    glossaryIds: [gb],
    defaultWriteTmId: b,
  }).document

  assert.deepEqual(docA.resources.tmIds, [a])
  assert.equal(docA.resources.inheritsTm, false)
  assert.equal(
    store.lookupTM({ documentId: docA.id, query: 'Alpha source.', threshold: 0 }).matches[0].tmId,
    a,
  )
  assert.equal(
    store.lookupTM({ documentId: docA.id, query: 'Beta source.', threshold: 1 }).matches.length,
    0,
  )
  assert.equal(store.findGlossaryHits('alpha_term', 'en', docA.id).length, 1)
  assert.equal(store.findGlossaryHits('beta_term', 'en', docA.id).length, 0)

  store.confirmSegment({ documentId: docA.id, index: 0, target: '阿尔法译文。' })
  store.confirmSegment({ documentId: docB.id, index: 0, target: '贝塔译文。' })
  const alphaEntries = store.tm.filter((entry) => entry.source === 'Alpha source.')
  const betaEntries = store.tm.filter((entry) => entry.source === 'Beta source.')
  assert.ok(alphaEntries.length >= 1)
  assert.ok(betaEntries.length >= 1)
  assert.ok(alphaEntries.every((entry) => entry.tmId === a))
  assert.ok(betaEntries.every((entry) => entry.tmId === b))

  store.openDocument({ documentId: docA.id })
  const boot = store.bootstrap()
  assert.equal(boot.documentResources.effectiveDefaultTmId, a)
  assert.equal(
    boot.tm.entries.some((entry) => entry.source === 'Beta source.'),
    false,
  )
  assert.equal(
    boot.glossary.some((entry) => entry.source === 'beta_term'),
    false,
  )

  // Explicit empty binding means "do not read or write this kind at all".
  const none = store.createDocument({
    name: 'No resources',
    text: 'No resource source.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
    tmIds: [],
    glossaryIds: [],
  }).document
  assert.equal(
    store.lookupTM({ documentId: none.id, query: 'Alpha source.', threshold: 1 }).matches.length,
    0,
  )
  assert.throws(
    () => store.confirmSegment({ documentId: none.id, index: 0, target: '不应写入。' }),
    (error) => error.code === 'NO_TM_BOUND',
  )

  // Inheritance keeps the global write default.
  const inherited = store.createDocument({
    name: 'Inherited',
    text: 'Inherited source.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  }).document
  assert.equal(inherited.resources.inheritsTm, true)
  store.setMounts({ tmIds: ['tm_default', a, b], defaultTmId: a })
  store.confirmSegment({ documentId: inherited.id, index: 0, target: '继承译文。' })
  assert.equal(
    store.tm.filter((entry) => entry.source === 'Inherited source.' && entry.tmId === a).length,
    1,
  )

  // Invalid default is rejected without partially changing the doc binding.
  assert.throws(
    () => store.setDocumentResources({ documentId: docA.id, defaultWriteTmId: b }),
    /未绑定/,
  )
  assert.deepEqual(store.docs.get(docA.id).tmIds, [a])

  const dir = mkdtempSync(join(tmpdir(), 'cait-doc-resources-'))
  const file = join(dir, 'store.json')
  const persisted = new CatStore({ dataDir: dir, logger: silent })
  const p = libraries(persisted)
  const pd = persisted.createDocument({
    name: 'Persisted',
    text: 'Persisted source.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
    tmIds: [p.a],
    glossaryIds: [p.ga],
    defaultWriteTmId: p.a,
  }).document
  persisted.saveDraft({ documentId: pd.id, index: 0, target: '持久化草稿。' })
  const snapshot = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(snapshot.version, STORE_VERSION)
  assert.deepEqual(snapshot.documents[0].tmIds, [p.a])
  const reopened = new CatStore({ dataDir: dir, logger: silent })
  assert.deepEqual(reopened.docs.get(pd.id).tmIds, [p.a])
  assert.deepEqual(reopened.docs.get(pd.id).glossaryIds, [p.ga])
  assert.equal(reopened.docs.get(pd.id).defaultWriteTmId, p.a)

  // A v5 snapshot has no resource fields and must inherit the global mounts.
  const legacy = JSON.parse(JSON.stringify(snapshot))
  legacy.version = 5
  delete legacy.documents[0].tmIds
  delete legacy.documents[0].glossaryIds
  delete legacy.documents[0].defaultWriteTmId
  writeFileSync(file, JSON.stringify(legacy), 'utf8')
  const migrated = new CatStore({ dataDir: dir, logger: silent })
  const migratedDoc = migrated.docs.get(pd.id)
  assert.equal(migratedDoc.tmIds, null)
  assert.equal(migratedDoc.glossaryIds, null)
  assert.equal(migratedDoc.defaultWriteTmId, null)

  console.log('test-document-resources: all assertions passed')
}
