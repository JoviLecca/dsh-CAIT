import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'

const silent = { warn() {}, error() {} }
const roots = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cait-persist-'))
  roots.push(dir)
  return dir
}

try {
  // 1. Confirm writes a snapshot that a fresh store can load.
  const dataDir = tempDir()
  const file = join(dataDir, 'store.json')
  const first = new CatStore({ dataDir, logger: silent })
  const created = first.createDocument({
    name: 'Persistence test',
    text: 'Hello world. A second sentence follows.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const documentId = created.document.id
  first.addGlossary({ source: 'Hello', target: '你好', sourceLang: 'en' })
  first.saveDraft({ documentId, index: 0, target: '你好，世界。' })

  const afterDraft = readFileSync(file, 'utf8')
  first.saveDraft({ documentId, index: 0, target: '你好，世界。草稿' })
  assert.equal(readFileSync(file, 'utf8'), afterDraft, 'draft edits must not hit disk')

  const confirmed = first.confirmSegment({ documentId, index: 0 })
  assert.equal(confirmed.confirmed.target, '你好，世界。草稿')
  assert.equal(confirmed.progress.confirmed, 1)

  const snapshot = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(snapshot.version, 2)
  assert.equal(snapshot.activeDocId, documentId)
  assert.deepEqual(snapshot.openDocIds, [documentId])
  assert.equal(snapshot.documents.length, 1)
  assert.equal(snapshot.documents[0].segments[0].target, '你好，世界。草稿')
  assert.ok(snapshot.tm.some((entry) => entry.tmId === 'tm_default'))
  assert.ok(snapshot.glossary.some((entry) => entry.glossaryId === 'glossary_default'))
  assert.equal(JSON.stringify(snapshot).includes('apiKey'), false, 'API key must never be stored')

  const second = new CatStore({ dataDir, logger: silent })
  assert.equal(second.docs.size, 1)
  assert.equal(second.activeDocId, documentId)
  assert.deepEqual(second.openDocIds, [documentId])
  assert.equal(second.docs.get(documentId).segments[0].target, '你好，世界。草稿')
  assert.equal(second.docs.get(documentId).segments[0].status, 'confirmed')
  assert.equal(second.glossary.length, 1)
  assert.equal(second.glossary[0].glossaryId, 'glossary_default')
  assert.equal(second.lookupTM({ query: 'Hello world.' }).matches[0].exact, true)
  assert.equal(second.lookupTM({ query: 'Hello world.' }).matches[0].tmId, 'tm_default')
  assert.equal(second.persistence.loaded, true)
  assert.equal(second.tmLibraries.length, 1)
  assert.equal(second.tmLibraries[0].name, 'Default TM')
  assert.deepEqual(second.mounts.tmIds, ['tm_default'])
  assert.deepEqual(second.mounts.glossaryIds, ['glossary_default'])
  assert.equal(second.mounts.defaultTmId, 'tm_default')
  assert.equal(second.bootstrap().tm.count, 1)
  assert.equal(second.bootstrap().tm.total, 1)
  assert.equal(second.bootstrap().libraries.tm[0].mounted, true)

  first.saveSettings({
    fuzzyThreshold: 0.91,
    mt: { provider: 'route-x', model: 'model-1', temperature: 0.4 },
  })
  const third = new CatStore({ dataDir, logger: silent })
  assert.equal(third.settings.fuzzyThreshold, 0.91)
  assert.equal(third.settings.mt.provider, 'route-x')
  assert.equal(third.settings.mt.model, 'model-1')
  assert.equal(third.settings.mt.temperature, 0.4)
  assert.equal(Object.hasOwn(third.publicSettings().mt, 'hasApiKey'), false)

  const secondDocument = first.createDocument({
    name: 'Persistence second document',
    text: 'A second document for active-document persistence.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  }).document
  assert.notEqual(secondDocument.id, documentId)
  first.openDocument({ documentId })
  const fourth = new CatStore({ dataDir, logger: silent })
  assert.equal(fourth.activeDocId, documentId, 'openDocument must persist activeDocId')
  assert.deepEqual(fourth.openDocIds, [documentId, secondDocument.id])
  assert.deepEqual(
    fourth.bootstrap().openDocuments.map((doc) => doc.id),
    [documentId, secondDocument.id],
  )
  assert.equal(fourth.docs.get(documentId).name, 'Persistence test')

  // 2. A corrupt JSON file must be backed up and fall back to an empty store.
  const corruptDir = tempDir()
  writeFileSync(join(corruptDir, 'store.json'), '{"version":1,"documents":[', 'utf8')
  const warnings = []
  const corrupt = new CatStore({
    dataDir: corruptDir,
    logger: { warn: (...args) => warnings.push(args.join(' ')), error() {} },
  })
  assert.equal(corrupt.docs.size, 0)
  assert.equal(corrupt.tm.length, 0)
  assert.equal(corrupt.glossary.length, 0)
  assert.equal(corrupt.activeDocId, null)
  assert.match(corrupt.persistence.error, /JSON|Unexpected|数据文件/)
  assert.ok(warnings.some((line) => line.includes('无法加载持久化数据')))
  assert.ok(readdirSync(corruptDir).some((name) => name.includes('.corrupt-')))
  assert.equal(corrupt.persist().ok, true, 'a fresh snapshot must be writable after recovery')
  assert.equal(JSON.parse(readFileSync(join(corruptDir, 'store.json'), 'utf8')).documents.length, 0)

  // 3. A version-1 snapshot must migrate into the default libraries and mounts.
  const legacyDir = tempDir()
  writeFileSync(
    join(legacyDir, 'store.json'),
    JSON.stringify({
      version: 1,
      activeDocId: null,
      documents: [],
      tm: [
        {
          id: 'tm_legacy',
          source: 'Legacy source.',
          target: '旧译文。',
          sourceLang: 'en',
          targetLang: 'zh-CN',
        },
      ],
      glossary: [
        {
          id: 'gl_legacy',
          source: 'legacy',
          target: '旧术语',
          sourceLang: 'en',
        },
      ],
    }),
    'utf8',
  )
  const legacy = new CatStore({ dataDir: legacyDir, logger: silent })
  assert.equal(legacy.persistence.loaded, true)
  assert.equal(legacy.tm.length, 1)
  assert.equal(legacy.tm[0].tmId, 'tm_default')
  assert.equal(legacy.glossary[0].glossaryId, 'glossary_default')
  assert.deepEqual(legacy.mounts.tmIds, ['tm_default'])
  assert.deepEqual(legacy.mounts.glossaryIds, ['glossary_default'])
  assert.equal(legacy.lookupTM({ query: 'Legacy source.' }).matches[0].tmId, 'tm_default')
  assert.equal(legacy.bootstrap().libraries.tm.length, 1)
  assert.equal(legacy.bootstrap().libraries.glossary.length, 1)

  // 4. An incompatible version must also fall back instead of throwing.
  const oldDir = tempDir()
  writeFileSync(
    join(oldDir, 'store.json'),
    JSON.stringify({ version: 99, documents: [], tm: [], glossary: [] }),
    'utf8',
  )
  const oldWarnings = []
  const old = new CatStore({
    dataDir: oldDir,
    logger: { warn: (...args) => oldWarnings.push(args.join(' ')), error() {} },
  })
  assert.equal(old.docs.size, 0)
  assert.equal(old.persistence.loaded, false)
  assert.ok(oldWarnings.some((line) => line.includes('不兼容的数据版本')))
  assert.ok(readdirSync(oldDir).some((name) => name.includes('.corrupt-')))

  // 5. loadDemo must persist its TM writes as well as its document/glossary.
  const demoDir = tempDir()
  const demo = new CatStore({ dataDir: demoDir, logger: silent })
  demo.loadDemo()
  assert.equal(demo.tm.length, 3, 'demo must write three TM entries in memory')
  const demoReloaded = new CatStore({ dataDir: demoDir, logger: silent })
  assert.equal(demoReloaded.tm.length, 3, 'demo TM entries must survive a reload')
  assert.equal(demoReloaded.docs.size, 1)
  assert.equal(demoReloaded.glossary.length, 5)

  // 6. A confirm that cannot persist must fail and roll back the in-memory
  // segment/TM mutation instead of reporting a false success.
  const blockedRoot = tempDir()
  const blockedPath = join(blockedRoot, 'not-a-directory')
  writeFileSync(blockedPath, 'blocked', 'utf8')
  const blocked = new CatStore({ dataDir: blockedPath, logger: silent })
  const blockedDoc = blocked.createDocument({
    name: 'Blocked persistence',
    text: 'A sentence that cannot be saved.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const blockedId = blockedDoc.document.id
  assert.throws(
    () =>
      blocked.confirmSegment({
        documentId: blockedId,
        index: 0,
        target: '无法保存的译文。',
      }),
    (error) =>
      error?.code === 'PERSISTENCE_FAILED' &&
      error.status === 503 &&
      /回滚/.test(error.message),
  )
  assert.equal(blocked.docs.get(blockedId).segments[0].status, 'pending')
  assert.equal(blocked.docs.get(blockedId).segments[0].target, '')
  assert.equal(blocked.tm.length, 0)
  assert.ok(blocked.persistence.error)
  assert.ok(blocked.bootstrap().storage.error)

  console.log('test-persistence: all assertions passed')
} finally {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
}
