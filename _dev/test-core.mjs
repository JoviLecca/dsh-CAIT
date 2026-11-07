import assert from 'node:assert/strict'
import { CatStore } from '../lib/store.js'
import { splitIntoSegments } from '../lib/segmenter.js'
import { similarity, classifyMatchType } from '../lib/similarity.js'
import { parseTmx, buildTmx } from '../lib/tmx.js'

function section(title) {
  console.log(`\n== ${title} ==`)
}

section('segmenter')
{
  const segments = splitIntoSegments(
    'First sentence. Second sentence!\n\nA new paragraph with 3.14 and e.g. an abbreviation. Final line?',
  )
  console.log(segments)
  assert.ok(segments.length >= 4)
  assert.ok(segments.some((segment) => segment.source.includes('3.14')))
  assert.ok(segments.some((segment) => segment.source.includes('e.g.')))
}

section('similarity')
{
  assert.equal(similarity('Hello world.', 'hello world.'), 1)
  const score = similarity('The quick brown fox jumps over the lazy dog.', 'The quick brown fox jumped over a lazy dog.')
  console.log('fuzzy score', score)
  assert.ok(score > 0.7 && score < 1)
}

section('document + TM + glossary')
{
  const store = new CatStore()
  // The 70% floor is what the settings dialog offers to reset to.
  assert.equal(store.settings.fuzzyThreshold, 0.7)
  const source = 'Computer-aided translation tools help translators work faster.\n\nA translation memory stores previously translated sentences.'
  const created = store.createDocument({ name: 'Demo', text: source, sourceLang: 'en', targetLang: 'zh-CN' })
  console.log(created)
  assert.equal(store.bootstrap().activeDocument.segments.length, 2)

  const state = store.bootstrap()
  assert.equal(state.settings.mt.provider, 'mock')
  assert.equal(state.settings.mt.model, 'cait-mock')
  assert.equal(state.settings.uiLang, 'auto')
  assert.equal(Object.hasOwn(state.settings.mt, 'hasApiKey'), false)

  const current = store.getSegmentForTool()
  console.log(current)
  assert.equal(current.segment.index, 0)
  assert.equal(current.segment.status, 'pending')

  store.addGlossary({ source: 'translation memory', target: '翻译记忆库', note: 'TM', sourceLang: 'en' })
  store.selectSegment({ index: 1 })
  const withTerms = store.getSegmentForTool()
  console.log(withTerms.glossaryHits)
  assert.ok(withTerms.glossaryHits.some((hit) => hit.term === 'translation memory'))
  store.selectSegment({ index: 0 })

  const submitted = store.submitTranslationForTool({ target: '计算机辅助翻译工具帮助译者更快地工作。' })
  console.log(submitted)
  assert.equal(submitted.confirmed.status, 'confirmed')
  assert.equal(submitted.progress.confirmed, 1)
  assert.equal(submitted.tm.count, 1)
  assert.equal(submitted.next.index, 1)

  const exact = store.lookupTM({ query: 'Computer-aided translation tools help translators work faster.' })
  console.log(exact)
  assert.equal(exact.matches[0].exact, true)
  assert.equal(exact.matches[0].percent, 100)
  assert.equal(Object.hasOwn(exact.matches[0], 'usageCount'), false)

  const fuzzy = store.lookupTM({ query: 'Computer aided translation tools help translators work faster' })
  console.log(fuzzy)
  assert.ok(fuzzy.matches.length >= 1)
  assert.ok(fuzzy.matches[0].percent >= 55)

  const second = store.submitTranslationForTool({ index: 1, target: '翻译记忆库存储以前翻译过的句子。' })
  console.log(second)
  assert.equal(second.done, true)
  assert.equal(store.bootstrap().tm.count, 2)
}

section('TM match types')
{
  const base = 'The quick brown fox jumps over the lazy dog.'

  function tmMatch(source, query) {
    const store = new CatStore()
    store.addTM({ source, target: '译文', sourceLang: 'en', targetLang: 'zh-CN' })
    const result = store.lookupTM({ query, threshold: 0, limit: 10, sourceLang: 'en', targetLang: 'zh-CN' })
    const match = result.matches.find((item) => item.source === source)
    assert.ok(match, `expected a TM match for ${source}`)
    return match
  }

  const exact = tmMatch(base, base)
  console.log('exact:', exact.matchType, exact.percent)
  assert.equal(exact.matchType, 'exact')
  assert.equal(exact.exact, true)

  // Punctuation-only differences score 1.0, but are not exact by key equality.
  const punctuation = tmMatch('Hello, world!', 'Hello world')
  console.log('punctuation:', punctuation.matchType, punctuation.score, punctuation.exact)
  assert.equal(punctuation.matchType, 'near_exact')
  assert.equal(punctuation.exact, false)
  assert.equal(punctuation.percent, 100)

  // Digit-only differences score below the medium band, so this proves the
  // near_exact check is independent of any score threshold.
  const digits = tmMatch('Version 2.0 released on 2024-05-01.', 'Version 3.0 released on 2025-06-02.')
  console.log('digits:', digits.matchType, digits.score, digits.exact)
  assert.equal(digits.matchType, 'near_exact')
  assert.equal(digits.exact, false)
  assert.ok(digits.score < 0.75)

  const high = tmMatch(base, 'A quick brown fox jumps over the lazy dog.')
  console.log('high:', high.matchType, high.score)
  assert.equal(high.matchType, 'high_fuzzy')
  assert.ok(high.score >= 0.85 && high.score < 1)

  const medium = tmMatch(base, 'The quick brown fox jumped over a lazy dog.')
  console.log('medium:', medium.matchType, medium.score)
  assert.equal(medium.matchType, 'medium_fuzzy')
  assert.ok(medium.score >= 0.75 && medium.score < 0.85)

  const low = tmMatch(base, 'The quick brown fox runs across the lazy dog.')
  console.log('low:', low.matchType, low.score)
  assert.equal(low.matchType, 'low_fuzzy')
  assert.ok(low.score < 0.75)

  assert.equal(classifyMatchType({ score: 0.85 }), 'high_fuzzy')
  assert.equal(classifyMatchType({ score: 0.8499 }), 'medium_fuzzy')
  assert.equal(classifyMatchType({ score: 0.75 }), 'medium_fuzzy')
  assert.equal(classifyMatchType({ score: 0.7499 }), 'low_fuzzy')
  assert.equal(classifyMatchType({ exact: true, score: 0.1 }), 'exact')
}

section('TMX roundtrip')
{
  const store = new CatStore()
  store.createDocument({ name: 'TMX source', text: 'Hello world.\n\nSecond sentence.', sourceLang: 'en', targetLang: 'zh-CN' })
  store.confirmSegment({ index: 0, target: '你好，世界。' })
  const doc = store.bootstrap().activeDocument
  const tmx = buildTmx({ ...doc, segments: doc.segments })
  console.log(tmx.slice(0, 500))
  const parsed = parseTmx(tmx)
  console.log(parsed)
  assert.equal(parsed.units.length, 2)
  assert.equal(parsed.sourceLang, 'en')
  assert.equal(parsed.targetLang, 'zh-CN')

  const imported = store.importTM({ pairs: [{ source: 'Hello world.', target: '你好，世界。' }], sourceLang: 'en', targetLang: 'zh-CN' })
  // The confirmed entry carries context now, so a context-free import is a
  // separate generic entry instead of an overwrite.
  assert.equal(imported.added, 1)
  assert.equal(imported.updated, 0)
  const again = store.importTM({ pairs: [{ source: 'Hello world.', target: '你好，世界。' }], sourceLang: 'en', targetLang: 'zh-CN' })
  assert.equal(again.added, 0)
  assert.equal(again.updated, 1)

  const withPlaceholder = parseTmx(
    '<?xml version="1.0"?><tmx version="1.4"><header srclang="en"/><body><tu><tuv xml:lang="en"><seg>Hello <ph>{1}</ph>world</seg></tuv><tuv xml:lang="zh-CN"><seg>你好<ph>{1}</ph>世界</seg></tuv></tu></body></tmx>',
  )
  assert.equal(withPlaceholder.warnings.length, 1)
  assert.equal(withPlaceholder.warnings[0].code, 'TMX_INLINE_MARKUP_LOST')
  assert.equal(withPlaceholder.warnings[0].count, 2)
  assert.match(withPlaceholder.warnings[0].message, /bpt\/ept\/ph/)
}

section('language and glossary case')
{
  const store = new CatStore()
  store.createDocument({ name: 'F8', text: 'Use the API and api here.', sourceLang: 'EN', targetLang: 'ZH_cn' })
  assert.equal(store.activeDocument().sourceLang, 'en')
  assert.equal(store.activeDocument().targetLang, 'zh-CN')

  store.addGlossary({ source: 'API', target: '接口', sourceLang: 'EN', caseSensitive: true })
  store.addGlossary({ source: 'Term', target: '术语', sourceLang: 'en', caseSensitive: false })
  const hits = store.findGlossaryHits('Use the API and api and term here.', 'en')
  const api = hits.find((hit) => hit.term === 'API')
  const term = hits.find((hit) => hit.term === 'Term')
  assert.equal(api.count, 1, 'case-sensitive term must not match lowercase api')
  assert.equal(term.count, 1, 'case-insensitive term must match lowercase term')
  assert.equal(api.glossaryId, 'glossary_default')

  store.addTM({ source: 'Hello', target: '你好', sourceLang: 'EN', targetLang: 'ZH_cn' })
  const match = store.lookupTM({ query: 'Hello', sourceLang: 'en', targetLang: 'zh-CN' })
  assert.equal(match.matches[0].exact, true)
  assert.equal(match.matches[0].sourceLang, 'en')
  assert.equal(match.matches[0].targetLang, 'zh-CN')
}

section('exports')
{
  const store = new CatStore()
  store.createDocument({ name: 'Export Test', text: 'First sentence.\n\nSecond sentence.', sourceLang: 'en', targetLang: 'zh-CN' })
  store.confirmSegment({ index: 0, target: '第一句。' })
  for (const format of ['target-txt', 'target-md', 'bilingual-md', 'bilingual-csv', 'tmx', 'document-json']) {
    const out = store.exportDocument({ format })
    console.log(format, out.filename, out.content.length)
    assert.ok(out.content.length > 0)
    assert.ok(out.filename.length > 0)
    if (format === 'document-json') {
      assert.match(out.filename, /\.document\.json$/)
      const payload = JSON.parse(out.content)
      assert.equal(payload.format, 'cait-document')
      assert.equal(payload.document.name, 'Export Test')
      assert.equal(payload.document.segments.length, 2)
      assert.equal(JSON.stringify(payload).includes('"tm"'), false)
    }
  }
}

section('settings + MT mock')
{
  const store = new CatStore()
  store.createDocument({ name: 'MT', text: 'The translation memory is useful.', sourceLang: 'en', targetLang: 'zh-CN' })
  store.addGlossary({ source: 'translation memory', target: '翻译记忆库', sourceLang: 'en' })
  const result = await store.mtSuggest({ text: 'The translation memory is useful.' })
  console.log(result)
  assert.ok(result.text.includes('翻译记忆库'))
  assert.equal(result.provider, 'mock')
  assert.ok(result.note.includes('未配置 DSH 模型路由'))
  const saved = store.saveSettings({
    fuzzyThreshold: 0.75,
    mt: { provider: 'mock', model: 'cait-mock', temperature: 0.3 },
  })
  assert.equal(saved.settings.fuzzyThreshold, 0.75)
  assert.equal(saved.settings.mt.provider, 'mock')
  assert.equal(saved.settings.mt.model, 'cait-mock')
  assert.equal(Object.hasOwn(saved.settings.mt, 'hasApiKey'), false)
  assert.equal(JSON.stringify(saved.settings).includes('apiKey'), false)
  assert.equal(JSON.stringify(saved.settings).includes('secret'), false)

  // Interface language: explicit choices persist, unsupported values are rejected.
  assert.equal(store.saveSettings({ uiLang: 'ja' }).settings.uiLang, 'ja')
  assert.equal(store.saveSettings({ uiLang: 'AUTO' }).settings.uiLang, 'auto')
  assert.throws(() => store.saveSettings({ uiLang: 'fr' }), (error) => error.code === 'INVALID_UI_LANG')
}

console.log('\nALL CORE TESTS PASSED')
