import assert from 'node:assert/strict'
import http from 'node:http'
import { CatStore } from '../lib/store.js'
import { registerCatApi } from '../lib/api.js'

let route = null
let reject = undefined
const ctx = {
  webServer: {
    register(value) {
      route = value
      return () => { route = null }
    },
  },
  connection: {
    requestRejection(req) {
      if (reject !== undefined) return reject
      return req.headers.origin === 'https://evil.example' ? 403 : undefined
    },
  },
}

const store = new CatStore()
registerCatApi(ctx, store)
assert.equal(route.kind, 'prefix')
assert.equal(route.path, '/cait/api')

const server = http.createServer((req, res) => route.handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

async function call(method, params, options = {}) {
  const response = await fetch(`${origin}/cait/api/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: JSON.stringify({ method, params }),
  })
  const body = await response.json()
  return { status: response.status, body }
}

try {
  const health = await fetch(`${origin}/cait/api/health`)
  assert.equal(health.status, 200)
  console.log('health', await health.json())

  reject = 401
  const denied = await call('bootstrap')
  assert.equal(denied.status, 401)
  assert.equal(denied.body.ok, false)
  reject = undefined

  // The Host's requestRejection contract is the origin gate; assert CAIT does
  // not bypass it for a hostile Origin header. Real DSH admission is exercised
  // by the installed plugin (the test harness only has this contract mock).
  const crossOrigin = await call('bootstrap', {}, { headers: { origin: 'https://evil.example' } })
  assert.equal(crossOrigin.status, 403)
  assert.equal(crossOrigin.body.ok, false)

  const created = await call('createDocument', {
    name: 'API Test',
    text: 'Hello world.\n\nSecond sentence.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  console.log('create', created.status, created.body.data.document)
  assert.equal(created.status, 200)
  assert.equal(created.body.data.state.activeDocument.segments.length, 2)
  const documentId = created.body.data.document.id

  const duplicate = await call('createDocument', {
    name: 'API Test copy',
    text: 'Hello world.\n\nSecond sentence.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  assert.equal(duplicate.body.data.reused, true)
  assert.equal(duplicate.body.data.document.id, documentId)
  assert.equal(duplicate.body.data.state.documents.length, 1)
  assert.deepEqual(duplicate.body.data.state.openDocuments.map((doc) => doc.id), [documentId])

  const closed = await call('closeDocument', { documentId })
  assert.equal(closed.body.data.state.activeDocument, null)
  assert.deepEqual(closed.body.data.state.openDocuments, [])
  assert.equal(closed.body.data.state.documents.length, 1)

  const reopened = await call('openDocument', { documentId })
  assert.equal(reopened.body.data.state.activeDocument.id, documentId)
  assert.deepEqual(reopened.body.data.state.openDocuments.map((doc) => doc.id), [documentId])

  const selected = await call('selectSegment', { index: 0 })
  assert.equal(selected.body.data.state.activeDocument.current.index, 0)

  const lookup = await call('lookupTM', { query: 'Hello world.' })
  assert.equal(lookup.body.data.count, 0)

  const glossary = await call('addGlossary', { source: 'world', target: '世界', sourceLang: 'en' })
  assert.equal(glossary.body.data.state.glossary.length, 1)

  const submitted = await call('cat_submit_translation', { index: 0, target: '你好，世界。' })
  assert.equal(submitted.status, 404)
  assert.equal(submitted.body.ok, false)

  const confirmed = await call('confirmSegment', { index: 0, target: '你好，世界。' })
  console.log('confirm', confirmed.body.data.confirmed, confirmed.body.data.tm)
  assert.equal(confirmed.body.data.confirmed.status, 'confirmed')
  assert.equal(confirmed.body.data.state.tm.count, 1)

  const exact = await call('lookupTM', { query: 'Hello world.' })
  assert.equal(exact.body.data.matches[0].exact, true)
  assert.equal(exact.body.data.matches[0].percent, 100)

  const library = await call('createLibrary', { kind: 'tm', name: 'API extra TM' })
  const extraTmId = library.body.data.state.libraries.tm.find(
    (item) => item.name === 'API extra TM',
  ).tmId
  assert.ok(extraTmId)
  assert.equal(library.body.data.state.mounts.tmIds.includes(extraTmId), true)

  const extraEntry = await call('addTM', {
    source: 'API extra only.',
    target: '仅 API 额外库。',
    tmId: extraTmId,
  })
  assert.equal(extraEntry.body.data.entry.tmId, extraTmId)

  const unmounted = await call('setMounts', {
    tmIds: ['tm_default'],
    glossaryIds: ['glossary_default'],
  })
  assert.equal(unmounted.body.data.state.mounts.tmIds.includes(extraTmId), false)
  const hidden = await call('lookupTM', { query: 'API extra only.', threshold: 0.99 })
  assert.equal(hidden.body.data.count, 0)

  const remounted = await call('setMounts', {
    tmIds: ['tm_default', extraTmId],
    glossaryIds: ['glossary_default'],
    defaultTmId: extraTmId,
  })
  assert.equal(remounted.body.data.state.mounts.defaultTmId, extraTmId)

  const exported = await call('exportDocument', { format: 'bilingual-md' })
  assert.ok(exported.body.data.content.includes('Hello world.'))
  assert.ok(exported.body.data.content.includes('你好，世界。'))

  const docxExport = await call('exportDocument', { format: 'docx' })
  assert.equal(docxExport.status, 200)
  assert.equal(docxExport.body.data.encoding, 'base64')
  assert.equal(
    Buffer.from(docxExport.body.data.content, 'base64').subarray(0, 2).toString('latin1'),
    'PK',
  )
  assert.match(docxExport.body.data.mime, /wordprocessingml/)

  const routes = await call('listMtRoutes')
  assert.equal(routes.status, 200)
  assert.deepEqual(routes.body.data.providers, [])
  assert.equal(routes.body.data.fallback, true)

  const settings = await call('saveSettings', {
    mt: { provider: 'mock', model: 'cait-mock', temperature: 0.2 },
  })
  assert.equal(settings.body.data.state.settings.mt.provider, 'mock')
  assert.equal(settings.body.data.state.settings.mt.model, 'cait-mock')
  assert.equal(Object.hasOwn(settings.body.data.state.settings.mt, 'hasApiKey'), false)
  assert.equal(JSON.stringify(settings.body.data.state).includes('apiKey'), false)

  const mt = await call('mtSuggest', { index: 0, text: 'Hello world.' })
  assert.equal(mt.body.data.provider, 'mock')
  assert.ok(mt.body.data.text.length > 0)
  assert.ok(mt.body.data.note.includes('未配置 DSH 模型路由'))

  const blockedClear = await call('clearTM', { tmIds: ['tm_default'] })
  assert.equal(blockedClear.status, 409)
  assert.equal(blockedClear.body.error.code, 'CONFIRMATION_REQUIRED')

  const confirmedClear = await call('clearTM', {
    tmIds: ['tm_default', extraTmId],
    confirm: true,
  })
  assert.equal(confirmedClear.status, 200)
  assert.equal(confirmedClear.body.data.state.tm.count, 0)

  const badJson = await fetch(`${origin}/cait/api/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  })
  assert.equal(badJson.status, 400)

  const badType = await fetch(`${origin}/cait/api/rpc`, { method: 'POST', body: '{}' })
  assert.equal(badType.status, 415)

  const tooLarge = await fetch(`${origin}/cait/api/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'x'.repeat(33 * 1024 * 1024),
  })
  assert.equal(tooLarge.status, 413)
  assert.equal((await tooLarge.json()).error.code, 'BODY_TOO_LARGE')

  const cleanupDoc = store.docs.get(documentId)
  cleanupDoc.segments[0].target = 'machine draft'
  cleanupDoc.segments[0].origin = 'mt'
  cleanupDoc.segments[0].status = 'translated'
  cleanupDoc.segments[0].confirmedAt = null
  const cleanupPreview = await call('getClearUnconfirmedPreview', { documentId })
  assert.equal(cleanupPreview.status, 200)
  assert.equal(cleanupPreview.body.data.counts.total, 1)
  const blockedCleanup = await call('clearUnconfirmedTranslations', { documentId })
  assert.equal(blockedCleanup.status, 409)
  assert.equal(blockedCleanup.body.error.code, 'CONFIRMATION_REQUIRED')
  const clearedCleanup = await call('clearUnconfirmedTranslations', { documentId, confirm: true })
  assert.equal(clearedCleanup.status, 200)
  assert.equal(clearedCleanup.body.data.cleared, 1)
  assert.equal(clearedCleanup.body.data.state.activeDocument.segments[0].target, '')

  const disposable = await call('createDocument', {
    name: 'Disposable document',
    text: 'This document is closed and then deleted.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const disposableId = disposable.body.data.document.id
  await call('closeDocument', { documentId: disposableId })
  const deleted = await call('deleteDocument', { documentId: disposableId })
  assert.equal(deleted.status, 200)
  assert.equal(deleted.body.data.deleted, disposableId)
  assert.equal(
    deleted.body.data.state.documents.some((doc) => doc.id === disposableId),
    false,
  )

  const missing = await fetch(`${origin}/cait/api/nope`)
  assert.equal(missing.status, 404)

  console.log('ALL API TESTS PASSED')
} finally {
  await new Promise((resolve) => server.close(resolve))
}
