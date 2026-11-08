import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../index.js'

assert.equal(plugin.name, 'dsh-cait')
assert.deepEqual(plugin.inject, ['tools', 'webServer', 'connection'])
assert.deepEqual(plugin.Config({}), { dataDir: '' })
assert.deepEqual(plugin.Config({ dataDir: '' }), { dataDir: '' })

const dataDir = mkdtempSync(join(tmpdir(), 'cait-plugin-'))
const previousHome = process.env.DSH_HOME
try {
  process.env.DSH_HOME = dataDir
  assert.equal(plugin.resolveDataDir(''), join(dataDir, 'cait'))
  assert.equal(plugin.resolveDataDir(dataDir), dataDir)
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
}

const tools = new Map()
let route = null
const disposers = []
const ctx = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  },
  webServer: {
    register(value) {
      route = value
      return () => { route = null }
    },
  },
  connection: {
    requestRejection() {
      return undefined
    },
  },
  effect(factory) {
    const dispose = factory()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
}

plugin.apply(ctx, { dataDir })
assert.equal(tools.size, 20)
assert.deepEqual([...tools.keys()], [
  'cat_get_segment',
  'cat_submit_translation',
  'cat_lookup_tm',
  'cat_lookup_glossary',
  'cat_list_documents',
  'cat_switch_document',
  'cat_suggest_mt',
  'cat_pre_translate',
  'cat_get_segments',
  'cat_confirm_segments',
  'cat_propose_translation',
  'cat_align',
  'cat_consistency_report',
  'cat_term_candidates',
  'cat_get_brief',
  'cat_set_brief',
  'cat_get_context',
  'cat_unconfirm_segment',
  'cat_concordance',
  'cat_add_terms',
])
assert.equal(route.path, '/cait/api')

const get = tools.get('cat_get_segment')
const submit = tools.get('cat_submit_translation')
const lookup = tools.get('cat_lookup_tm')
const glossaryLookup = tools.get('cat_lookup_glossary')
const listDocuments = tools.get('cat_list_documents')
const switchDocument = tools.get('cat_switch_document')
const suggestMt = tools.get('cat_suggest_mt')

const empty = await get.execute({})
console.log(empty)
assert.equal(empty.ok, false)
assert.equal(empty.error, 'NO_DOCUMENT')
assert.ok(get.output.render({}, empty)[0].text.includes('没有活动文档'))

const emptyDocuments = await listDocuments.execute({})
assert.equal(emptyDocuments.ok, true)
assert.deepEqual(emptyDocuments.documents, [])
assert.equal(emptyDocuments.activeDocumentId, null)
assert.equal(emptyDocuments.stats.documents, 0)

const server = http.createServer((req, res) => route.handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

async function rpc(method, params = {}) {
  const response = await fetch(`${origin}/cait/api/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const payload = await response.json()
  if (!payload.ok) {
    const error = new Error(payload.error?.message || `RPC ${method} failed`)
    error.code = payload.error?.code
    throw error
  }
  return payload.data
}

try {
  const created = await rpc('createDocument', {
    name: 'Tool test',
    text: 'Hello world.\n\nSecond sentence.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const firstId = created.document.id
  assert.equal(created.state.activeDocument.id, firstId)

  const segment = await get.execute({})
  assert.equal(segment.ok, true)
  assert.equal(segment.segment.source, 'Hello world.')
  assert.ok(get.output.render({}, segment)[0].text.includes('SOURCE:'))

  const confirmed = await submit.execute({ target: '你好，世界。' })
  console.log(confirmed)
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.confirmed.target, '你好，世界。')
  assert.equal(confirmed.tm.added, 1)
  assert.equal(confirmed.tm.count, 1)
  assert.equal(confirmed.tm.total, 1)

  const match = await lookup.execute({ query: 'Hello world.' })
  assert.equal(match.ok, true)
  assert.deepEqual(Object.keys(match).sort(), ['count', 'matches', 'ok', 'query'])
  assert.equal(match.matches[0].percent, 100)
  assert.equal(match.matches[0].exact, true)
  assert.equal(match.matches[0].matchType, 'exact')

  const near = await lookup.execute({ query: 'Hello world' })
  assert.equal(near.ok, true)
  assert.equal(near.matches[0].exact, false)
  assert.equal(near.matches[0].matchType, 'near_exact')
  assert.ok(lookup.output.render({}, near)[0].text.includes('near-exact'))

  await rpc('addGlossary', {
    source: 'translation memory',
    target: '翻译记忆库',
    note: 'TM',
    sourceLang: 'en',
  })
  await rpc('addGlossary', { source: 'segment', target: '句段', sourceLang: 'en' })

  const terms = await glossaryLookup.execute({ sourceLang: 'en' })
  assert.equal(terms.ok, true)
  assert.equal(terms.count, 2)
  assert.equal(terms.total, 2)
  assert.equal(terms.sourceLang, 'en')
  assert.deepEqual(Object.keys(terms.entries[0]).sort(), [
    'caseSensitive',
    'createdAt',
    'forbidden',
    'glossaryId',
    'id',
    'note',
    'preferred',
    'source',
    'sourceLang',
    'target',
    'updatedAt',
  ])
  assert.equal(terms.entries[0].glossaryId, 'glossary_default')
  assert.ok(glossaryLookup.output.render({}, terms)[0].text.includes('translation memory'))

  const filteredTerms = await glossaryLookup.execute({ query: 'translation', sourceLang: 'en' })
  assert.equal(filteredTerms.count, 1)
  assert.equal(filteredTerms.entries[0].source, 'translation memory')

  assert.equal((await glossaryLookup.execute({ sourceLang: 'zh-CN' })).count, 0)
  const limitedTerms = await glossaryLookup.execute({ sourceLang: 'en', limit: 1 })
  assert.equal(limitedTerms.count, 1)
  assert.equal(limitedTerms.total, 2)

  await rpc('addGlossary', { source: 'API', target: '接口', sourceLang: 'EN', caseSensitive: true })
  await rpc('addGlossary', { source: 'Term', target: '术语', sourceLang: 'en', caseSensitive: false })
  const caseSensitiveMiss = await glossaryLookup.execute({ query: 'api', sourceLang: 'EN' })
  assert.equal(caseSensitiveMiss.count, 0)
  const caseSensitiveHit = await glossaryLookup.execute({ query: 'API', sourceLang: 'en' })
  assert.equal(caseSensitiveHit.count, 1)
  assert.equal(caseSensitiveHit.entries[0].source, 'API')
  assert.equal(caseSensitiveHit.sourceLang, 'en')
  const foldedHit = await glossaryLookup.execute({ query: 'term', sourceLang: 'EN' })
  assert.equal(foldedHit.count, 1)
  assert.equal(foldedHit.entries[0].source, 'Term')

  const second = await rpc('createDocument', {
    name: 'Second document',
    text: 'Another document.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const secondId = second.document.id

  const documents = await listDocuments.execute({})
  assert.equal(documents.ok, true)
  assert.equal(documents.activeDocumentId, secondId)
  assert.equal(documents.documents.length, 2)
  assert.equal(documents.stats.documents, 2)
  assert.deepEqual(Object.keys(documents.stats).sort(), [
    'confirmed',
    'documents',
    'glossary',
    'segments',
    'tm',
    'translated',
  ])
  const firstSummary = documents.documents.find((doc) => doc.id === firstId)
  assert.equal(firstSummary.progress.confirmed, 1)
  assert.equal(firstSummary.progress.total, 2)
  assert.deepEqual(Object.keys(firstSummary).sort(), [
    'brief',
    'createdAt',
    'cursor',
    'id',
    'name',
    'progress',
    'resources',
    'sourceLang',
    'targetLang',
    'updatedAt',
  ])
  assert.ok(listDocuments.output.render({}, documents)[0].text.includes('[active]'))

  const revisionBeforeSwitch = (await rpc('bootstrap')).revision
  const switched = await switchDocument.execute({ documentId: firstId })
  const revisionAfterSwitch = (await rpc('bootstrap')).revision
  assert.ok(revisionAfterSwitch > revisionBeforeSwitch, 'cat_switch_document must bump the polled revision')
  assert.equal(switched.ok, true)
  assert.equal(switched.activeDocumentId, firstId)
  assert.equal(switched.document.progress.confirmed, 1)
  assert.ok(switchDocument.output.render({}, switched)[0].text.includes('switched'))
  assert.equal((await get.execute({})).document.id, firstId)

  const missingDocument = await switchDocument.execute({ documentId: 'missing' })
  assert.equal(missingDocument.ok, false)
  assert.equal(missingDocument.error, 'NO_DOCUMENT')

  const noDocumentId = await switchDocument.execute({})
  assert.equal(noDocumentId.ok, false)
  assert.equal(noDocumentId.error, 'MISSING_DOCUMENT_ID')

  const mockMt = await suggestMt.execute({ text: 'translation memory' })
  assert.equal(mockMt.ok, true)
  assert.equal(mockMt.provider, 'mock')
  assert.equal(mockMt.model, 'cait-mock')
  assert.ok(mockMt.text.includes('翻译记忆库'))
  assert.ok(mockMt.note.includes('未配置 DSH 模型路由'))
  assert.ok(Number.isFinite(mockMt.latencyMs))
  assert.ok(suggestMt.output.render({}, mockMt)[0].text.includes('CAIT MT'))

  const currentMt = await suggestMt.execute({})
  assert.equal(currentMt.ok, true)
  assert.equal(currentMt.provider, 'mock')

  const missingMtDocument = await suggestMt.execute({ documentId: 'missing', text: 'Hello' })
  assert.equal(missingMtDocument.ok, false)
  assert.equal(missingMtDocument.error, 'DOCUMENT_NOT_FOUND')
  const outOfRangeMt = await suggestMt.execute({ index: 99 })
  assert.equal(outOfRangeMt.ok, false)
  assert.equal(outOfRangeMt.error, 'SEGMENT_OUT_OF_RANGE')
  const fractionalMtIndex = await suggestMt.execute({ index: 1.5 })
  assert.equal(fractionalMtIndex.ok, false)
  assert.equal(fractionalMtIndex.error, 'SEGMENT_OUT_OF_RANGE')

  await rpc('saveSettings', {
    mt: { provider: 'openai', model: 'gpt-4o', temperature: 0.2 },
  })
  const noRoute = await suggestMt.execute({ text: 'Hello' })
  assert.equal(noRoute.ok, true)
  assert.equal(noRoute.provider, 'mock')
  assert.ok(noRoute.note.includes('未配置 DSH 模型路由'))

  // Multi-library mounts: lookup is mounted-only and submit can target a TM.
  const library = await rpc('createLibrary', { kind: 'tm', name: 'Tool extra TM' })
  const extraTmId = library.state.libraries.tm.find((item) => item.name === 'Tool extra TM').tmId
  await rpc('addTM', {
    source: 'Mounted extra only.',
    target: '仅额外库。',
    sourceLang: 'en',
    targetLang: 'zh-CN',
    tmId: extraTmId,
  })
  const mounted = await lookup.execute({ query: 'Mounted extra only.' })
  assert.equal(mounted.matches[0].tmId, extraTmId)

  await rpc('setMounts', { tmIds: ['tm_default'], glossaryIds: ['glossary_default'] })
  const hidden = await lookup.execute({ query: 'Mounted extra only.' })
  assert.equal(hidden.matches.some((item) => item.tmId === extraTmId), false)

  const rejectedTarget = await submit.execute({
    target: '不应写入未挂载库。',
    targetTmId: extraTmId,
  })
  assert.equal(rejectedTarget.ok, false)
  assert.equal(rejectedTarget.error, 'TM_NOT_MOUNTED')

  const countDocument = await rpc('createDocument', {
    name: 'Mounted count document',
    text: 'A count check segment.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  assert.equal(countDocument.state.activeDocument.name, 'Mounted count document')
  const countResult = await submit.execute({ target: '一个计数检查句段。' })
  assert.equal(countResult.ok, true)
  assert.equal(countResult.tm.count, 2, 'count must only include mounted TMs')
  assert.equal(countResult.tm.total, 3, 'total must include every TM library')

  await rpc('setMounts', {
    tmIds: ['tm_default', extraTmId],
    glossaryIds: ['glossary_default'],
    defaultTmId: extraTmId,
  })
  const targeted = await rpc('createDocument', {
    name: 'Targeted TM document',
    text: 'A targeted segment.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  assert.equal(targeted.state.mounts.defaultTmId, extraTmId)
  const revisionBeforeSubmit = (await rpc('bootstrap')).revision
  const targetedResult = await submit.execute({
    target: '一个定向句段。',
    targetTmId: extraTmId,
  })
  const revisionAfterSubmit = (await rpc('bootstrap')).revision
  assert.ok(revisionAfterSubmit > revisionBeforeSubmit, 'cat_submit_translation must bump the polled revision')
  assert.equal(targetedResult.ok, true)
  assert.equal(targetedResult.tm.tmId, extraTmId)

  // The three batch tools share the workbench state; tm-only mode keeps them
  // free of any LLM route so this suite stays offline.
  const preTool = tools.get('cat_pre_translate')
  const listSegments = tools.get('cat_get_segments')
  const confirmSegments = tools.get('cat_confirm_segments')

  const listed = await listSegments.execute({})
  assert.equal(listed.ok, true)
  assert.equal(listed.document.name, 'Targeted TM document')
  assert.equal(listed.segments[0].status, 'confirmed')
  assert.ok(listSegments.output.render({}, listed)[0].text.includes('[1] confirmed'))

  const pre = await preTool.execute({ mode: 'tm', count: 4 })
  assert.equal(pre.ok, true)
  assert.equal(pre.filled, 0)
  assert.deepEqual(pre.noMatch, [])
  assert.deepEqual(pre.skipped, [{ index: 0, reason: 'confirmed' }])
  assert.ok(preTool.output.render({}, pre)[0].text.includes('End of document reached.'))

  const batch = await confirmSegments.execute({ indices: [0] })
  assert.equal(batch.ok, true)
  assert.deepEqual(batch.confirmed, [])
  assert.deepEqual(batch.skipped, [{ index: 0, reason: 'confirmed' }])
  assert.equal(batch.done, true)

  console.log('ALL PLUGIN TESTS PASSED')
} finally {
  await new Promise((resolve) => server.close(resolve))
  for (const dispose of disposers) dispose()
  rmSync(dataDir, { recursive: true, force: true })
}
