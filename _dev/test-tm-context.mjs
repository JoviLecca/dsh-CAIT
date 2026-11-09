import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { contextHashOf, contextOf, fnv1a } from '../lib/context.js'
import { MAX_CONTEXT_VARIANTS } from '../lib/tm.js'
import { STORE_FILENAME, STORE_VERSION } from '../lib/store-utils.js'

const silent = { log() {}, warn() {}, error() {} }
const roots = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cait-tm-context-'))
  roots.push(dir)
  return dir
}

function section(name) {
  console.log(`\n# ${name}`)
}

function makeDoc(store, text, name = 'Doc') {
  const { document } = store.createDocument({ name, text, sourceLang: 'en', targetLang: 'zh-CN' })
  return store.docs.get(document.id)
}

try {
  section('context fingerprints come from the neighbouring source segments')
  {
    const store = new CatStore({ logger: silent })
    const doc = makeDoc(store, 'Alpha. Beta. Gamma.')
    assert.deepEqual(contextOf(doc, 0), { prev: '', next: 'beta.' })
    assert.deepEqual(contextOf(doc, 1), { prev: 'alpha.', next: 'gamma.' })
    assert.equal(contextOf(doc, 2).next, '')

    const solo = makeDoc(store, 'Only one sentence.')
    assert.equal(contextOf(solo, 0), null, 'a one-segment document has no context')
    assert.equal(contextHashOf(null), null)
    assert.match(fnv1a('alpha'), /^[0-9a-f]{8}$/)
    assert.notEqual(
      contextHashOf({ prev: 'Alpha.', next: 'Beta.' }),
      contextHashOf({ prev: 'Alpha.', next: 'Gamma.' }),
      'a different neighbour must produce a different hash',
    )
    assert.equal(
      contextHashOf({ prev: '  Alpha. ', next: 'Beta.' }),
      contextHashOf({ prev: 'Alpha.', next: 'Beta.' }),
      'normalisation makes the fingerprint stable',
    )
  }

  section('the same source text can keep one entry per context')
  {
    const store = new CatStore({ logger: silent })
    const doc = makeDoc(store, 'Close. Beta. Close.')
    store.saveDraft({ documentId: doc.id, index: 0, target: '关闭' })
    store.confirmSegment({ documentId: doc.id, index: 0 })
    store.saveDraft({ documentId: doc.id, index: 2, target: '靠近' })
    store.confirmSegment({ documentId: doc.id, index: 2 })

    assert.equal(store.tm.length, 2, 'two contexts must not overwrite each other')
    const exact = store.lookupTM({
      query: 'Close.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      documentId: doc.id,
      index: 2,
    })
    assert.equal(exact.matches[0].percent, 101)
    assert.equal(exact.matches[0].matchType, 'context')
    assert.equal(exact.matches[0].target, '靠近')
    assert.equal(exact.matches[0].contextMatch, 'ice')
    assert.deepEqual(exact.matches[0].context, { prev: 'beta.', next: '' })
  }

  section('text match with the wrong context stays at 100%')
  {
    const store = new CatStore({ logger: silent })
    const doc = makeDoc(store, 'Close. Beta. Close.')
    store.saveDraft({ documentId: doc.id, index: 0, target: '关闭' })
    store.confirmSegment({ documentId: doc.id, index: 0 })

    const other = makeDoc(store, 'Intro. Close. Outro.')
    const result = store.lookupTM({
      query: 'Close.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      documentId: other.id,
      index: 1,
    })
    assert.equal(result.matches.length, 1)
    assert.equal(result.matches[0].percent, 100)
    assert.equal(result.matches[0].contextMatch, null)
    assert.equal(result.matches[0].matchType, 'exact')
  }

  section('context variants are capped and the generic entry survives')
  {
    const store = new CatStore({ logger: silent })
    store.upsertTM('Repeat.', '泛译', 'en', 'zh-CN')
    for (let step = 0; step < MAX_CONTEXT_VARIANTS + 3; step += 1) {
      store.upsertTM('Repeat.', `译${step}`, 'en', 'zh-CN', undefined, {
        prev: `prev ${step}`,
        next: `next ${step}`,
      })
    }
    const variants = store.tm.filter((entry) => entry.key === 'repeat.' && entry.contextHash)
    assert.equal(variants.length, MAX_CONTEXT_VARIANTS)
    const generic = store.tm.filter((entry) => entry.key === 'repeat.' && !entry.contextHash)
    assert.equal(generic.length, 1, 'the no-context entry is never evicted')
  }

  section('pre-translation resolves ICE first and reports it')
  {
    const store = new CatStore({ logger: silent })
    const source = makeDoc(store, 'Open. File. Close.')
    store.saveDraft({ documentId: source.id, index: 1, target: '文件' })
    store.confirmSegment({ documentId: source.id, index: 1 })

    // The store fingerprints documents and reopens an identical one, so drop the
    // source document to get a genuinely separate document with the same text.
    store.docs.delete(source.id)
    store.openDocIds = []

    const same = makeDoc(store, 'Open. File. Close.')
    const hit = await store.preTranslate({ documentId: same.id, from: 1, count: 1 })
    assert.equal(hit.filled, 1)
    assert.equal(hit.segments[0].origin, 'tm')
    assert.equal(hit.segments[0].ice, true)
    assert.equal(same.segments[1].target, '文件')

    const different = makeDoc(store, 'Save. File. Quit.')
    const plain = await store.preTranslate({ documentId: different.id, from: 1, count: 1 })
    assert.equal(plain.segments[0].origin, 'tm', 'a differing context still gets the 100% match')
    assert.equal(plain.segments[0].ice, false)
  }

  section('editing an entry keeps its context and still guards duplicates')
  {
    const store = new CatStore({ logger: silent })
    const doc = makeDoc(store, 'Open. File. Close.')
    store.saveDraft({ documentId: doc.id, index: 1, target: '文件' })
    store.confirmSegment({ documentId: doc.id, index: 1 })

    const entry = store.tm.find((item) => item.key === 'file.')
    assert.ok(entry?.contextHash)
    const updated = store.updateTM({ id: entry.id, target: '档案' })
    assert.deepEqual(updated.entry.context, entry.context)
    assert.equal(store.tm.find((item) => item.id === entry.id).target, '档案')

    store.upsertTM('File.', '另一种译法', 'en', 'zh-CN', undefined, { prev: 'X.', next: 'Y.' })
    assert.equal(store.tm.filter((item) => item.key === 'file.').length, 2)

    // Renaming an entry onto a key that already exists with the *same* context
    // hash is the one real duplicate; a different context stays legitimate.
    const alpha = store.upsertTM('Alpha.', '甲', 'en', 'zh-CN', undefined, { prev: 'Same.', next: 'Ctx.' })
    const beta = store.upsertTM('Beta.', '乙', 'en', 'zh-CN', undefined, { prev: 'Same.', next: 'Ctx.' })
    assert.throws(() => store.updateTM({ id: beta.entry.id, source: 'Alpha.' }), /同一个记忆库/)
    assert.equal(store.updateTM({ id: alpha.entry.id, target: '甲二' }).entry.context.prev, 'same.')
  }

  section('a version 3 store loads with null contexts and upgrades to 4')
  {
    const dir = tempDir()
    const first = new CatStore({ dataDir: dir, logger: silent })
    const doc = makeDoc(first, 'Alpha. Beta.')
    first.saveDraft({ documentId: doc.id, index: 0, target: '阿尔法' })
    first.confirmSegment({ documentId: doc.id, index: 0 })

    const file = join(dir, STORE_FILENAME)
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    payload.version = 3
    for (const entry of payload.tm) {
      delete entry.context
      delete entry.contextHash
    }
    writeFileSync(file, JSON.stringify(payload))

    const reopened = new CatStore({ dataDir: dir, logger: silent })
    assert.equal(STORE_VERSION, 7)
    assert.equal(reopened.tm.length, payload.tm.length)
    for (const entry of reopened.tm) {
      assert.equal(entry.context, null)
      assert.equal(entry.contextHash, null)
    }
    const next = reopened.docs.get(doc.id)
    reopened.confirmSegment({ documentId: next.id, index: 1, target: '贝塔' })
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 7)
  }

  section('TMX carries x-context through export and import')
  {
    const store = new CatStore({ logger: silent })
    store.upsertTM('Close.', '关闭', 'en', 'zh-CN', undefined, { prev: 'Open.', next: 'File.' })
    store.upsertTM('Close.', '靠近', 'en', 'zh-CN', undefined, { prev: 'Run.', next: 'Far.' })

    const exported = store.exportTM({ format: 'tmx' })
    assert.ok(exported.content.includes('x-context'))
    assert.equal(exported.count, 2)

    const fresh = new CatStore({ logger: silent })
    fresh.clearTM({ all: true })
    fresh.importTmx({ text: exported.content, sourceLang: 'en', targetLang: 'zh-CN' })
    assert.equal(fresh.tm.length, 2, 'two context variants must survive the round-trip')
    const reopened = fresh.tm.find((entry) => entry.target === '靠近')
    assert.deepEqual(reopened.context, { prev: 'run.', next: 'far.' })
    fresh.importTmx({ text: exported.content, sourceLang: 'en', targetLang: 'zh-CN' })
    assert.equal(fresh.tm.length, 2, 're-import must update in place, not duplicate')
  }

  section('document export and library view expose the context')
  {
    const store = new CatStore({ logger: silent })
    const doc = makeDoc(store, 'Alpha. Beta.')
    store.saveDraft({ documentId: doc.id, index: 0, target: '阿尔法' })
    store.confirmSegment({ documentId: doc.id, index: 0 })

    const tmx = store.exportDocument({ documentId: doc.id, format: 'tmx' })
    assert.ok(tmx.content.includes('x-context'))

    const page = store.listTmEntries({ pageSize: 20 })
    const row = page.entries.find((entry) => entry.source === 'Alpha.')
    assert.ok(row, 'the confirmed entry shows up in the library view')
    assert.deepEqual(row.context, { prev: '', next: 'beta.' })
    assert.ok(row.contextHash)
  }

  console.log('\nALL TM CONTEXT TESTS PASSED')
} finally {
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}
