import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import {
  buildPo,
  buildSrt,
  buildVtt,
  buildXliff,
  buildXliff2,
  missingInlineTokens,
  parseCsv,
  parsePo,
  parseSrt,
  parseVtt,
  parseXliff,
} from '../lib/formats.js'

const dir = mkdtempSync(join(tmpdir(), 'cait-formats-'))

try {
  const csv = '\uFEFFSource,Target\n"Hello, ""world""","你好，世界"\nSecond,,\n'
  const parsedCsv = parseCsv(csv)
  assert.equal(parsedCsv.format, 'csv')
  assert.equal(parsedCsv.segments.length, 2)
  assert.equal(parsedCsv.segments[0].source, 'Hello, "world"')
  assert.equal(parsedCsv.segments[0].target, '你好，世界')
  assert.equal(parsedCsv.segments[1].target, '')

  const mapped = parseCsv('Source,Target\nHello,你好\n', { sourceColumn: 'Target', targetColumn: 'Source' })
  assert.equal(mapped.segments[0].source, '你好')
  assert.equal(mapped.segments[0].target, 'Hello')
  const numbered = parseCsv('A,B\nC,D\n', { sourceColumn: 2, targetColumn: 1 })
  assert.equal(numbered.segments[0].source, 'B')
  assert.equal(numbered.segments[0].target, 'A')
  assert.equal(numbered.segments[1].source, 'D')

  const srt = '1\n00:00:01,000 --> 00:00:03,500\nHello <i>there</i>\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line\n'
  const parsedSrt = parseSrt(srt)
  assert.equal(parsedSrt.segments.length, 2)
  assert.equal(parsedSrt.segments[0].source, 'Hello <i>there</i>')
  assert.equal(parsedSrt.segments[0].meta.start, 1000)
  assert.equal(parsedSrt.segments[0].meta.end, 3500)
  assert.equal(parsedSrt.warnings.length, 0)

  const assSrt = '1\n00:00:01,000 --> 00:00:02,000\n{\\i1}Hello{\\i0}\n'
  const parsedAss = parseSrt(assSrt)
  assert.equal(parsedAss.segments[0].source, 'Hello')
  assert.equal(parsedAss.warnings[0].code, 'SRT_INLINE_MARKUP_LOST')
  assert.equal(parsedAss.warnings[0].count, 2)

  assert.throws(
    () => parseSrt('1\n00:00:03,000 --> 00:00:02,000\nBackwards\n'),
    /结束时间必须晚于开始时间/,
  )
  assert.throws(
    () => parseVtt('WEBVTT\n\n00:00:03.000 --> 00:00:03.000\nZero\n'),
    /结束时间必须晚于开始时间/,
  )

  const mixedTimeline = buildSrt({
    segments: [
      { source: 'A', target: '甲', meta: { start: 1000, end: 2000 } },
      { source: 'B', target: '乙', meta: {} },
      { source: 'C', target: '丙', meta: { start: 5000, end: 6000 } },
    ],
  })
  assert.match(mixedTimeline, /00:00:01,000 --> 00:00:02,000\n甲/)
  assert.match(mixedTimeline, /00:00:02,000 --> 00:00:04,000\n乙/)
  assert.match(mixedTimeline, /00:00:05,000 --> 00:00:06,000\n丙/)

  const textOnlyTimeline = buildVtt({
    segments: [{ source: 'One' }, { source: 'Two' }],
  })
  assert.match(textOnlyTimeline, /00:00:00\.000 --> 00:00:02\.000\nOne/)
  assert.match(textOnlyTimeline, /00:00:02\.000 --> 00:00:04\.000\nTwo/)

  const vtt = 'WEBVTT\n\nNOTE ignored\n\ncue-1\n00:00:01.000 --> 00:00:02.500 line:90%\nHello <b>there</b>\n\n00:00:03.000 --> 00:00:04.000\nSecond\n'
  const parsedVtt = parseVtt(vtt)
  assert.equal(parsedVtt.segments.length, 2)
  assert.equal(parsedVtt.segments[0].meta.identifier, 'cue-1')
  assert.equal(parsedVtt.segments[0].meta.settings, 'line:90%')
  assert.equal(parsedVtt.segments[0].meta.start, 1000)
  assert.equal(parsedVtt.segments[0].source, 'Hello <b>there</b>')

  const po = [
    'msgid ""',
    'msgstr ""',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '',
    '#. menu label',
    'msgctxt "menu"',
    'msgid "Open"',
    'msgstr "打开"',
    '',
    '#: file',
    'msgid "File"',
    'msgid_plural "Files"',
    'msgstr[0] "文件"',
    'msgstr[1] "文件（复数）"',
    '',
    '#~ msgid "Old"',
    '#~ msgstr "旧"',
    '',
  ].join('\n')
  const parsedPo = parsePo(po)
  assert.equal(parsedPo.segments.length, 2)
  assert.equal(parsedPo.segments[0].meta.context, 'menu')
  assert.deepEqual(parsedPo.segments[0].meta.comments, ['menu label'])
  assert.equal(parsedPo.segments[1].meta.plural, true)
  assert.equal(parsedPo.segments[1].target, '文件')
  assert.deepEqual(parsedPo.segments[1].meta.plurals, ['文件', '文件（复数）'])
  assert.equal(parsedPo.obsolete.length, 1)

  const xliff = '<?xml version="1.0"?><xliff version="1.2"><file source-language="en" target-language="zh-CN"><body><trans-unit id="a"><source>Hello <g id="1">world</g></source><target>你好世界</target></trans-unit></body></file></xliff>'
  const parsedXliff = parseXliff(xliff)
  assert.equal(parsedXliff.sourceLang, 'en')
  assert.equal(parsedXliff.targetLang, 'zh-CN')
  assert.equal(parsedXliff.segments[0].source, 'Hello {1}world{2}')
  assert.equal(parsedXliff.segments[0].meta.xliffId, 'a')
  assert.equal(parsedXliff.segments[0].meta.inline.length, 2)
  assert.deepEqual(missingInlineTokens(parsedXliff.segments[0].meta.inline, '你好世界'), ['{1}', '{2}'])
  assert.equal(parsedXliff.warnings.length, 0)

  const xliff2 = '<?xml version="1.0"?><xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="zh-CN"><file id="f1"><unit id="u1"><segment><source>Hi <ph id="1"/></source><target>嗨</target></segment></unit></file></xliff>'
  const parsedXliff2 = parseXliff(xliff2)
  assert.equal(parsedXliff2.format, 'xliff2')
  assert.equal(parsedXliff2.sourceLang, 'en')
  assert.equal(parsedXliff2.targetLang, 'zh-CN')
  assert.equal(parsedXliff2.segments[0].source, 'Hi {1}')
  assert.equal(parsedXliff2.segments[0].meta.inline.length, 1)

  const sampleDoc = {
    name: 'Sample',
    sourceLang: 'en',
    targetLang: 'zh-CN',
    segments: [
      { source: 'Hello', target: '你好', meta: { start: 1000, end: 2500, identifier: 'cue-1' } },
      { source: 'World', target: '世界', meta: {} },
    ],
  }
  assert.match(buildSrt(sampleDoc), /00:00:01,000 --> 00:00:02,500/)
  assert.match(buildVtt(sampleDoc), /^WEBVTT\n\ncue-1\n00:00:01\.000 --> 00:00:02\.500/m)
  assert.match(buildPo(sampleDoc), /msgid "Hello"\nmsgstr "你好"/)

  const placeholderDoc = {
    name: 'Placeholders',
    sourceLang: 'en',
    targetLang: 'zh-CN',
    segments: [{
      source: 'Hello {1}world{2}',
      target: '{1}你好世界{2}',
      meta: { xliffId: 'a', inline: [{ token: '{1}', xml: '<g id="1">' }, { token: '{2}', xml: '</g>' }] },
    }],
  }
  assert.match(buildXliff(placeholderDoc), /<source xml:lang="en">Hello <g id="1">world<\/g><\/source>/)
  assert.match(buildXliff2(placeholderDoc), /<unit id="a">/)
  assert.match(buildXliff2(placeholderDoc), /<source>Hello <g id="1">world<\/g><\/source>/)

  const store = new CatStore({ dataDir: dir })
  const csvImport = store.importFile({ name: 'strings.csv', text: csv, targetLang: 'zh-CN' })
  assert.equal(csvImport.units, 2)
  const csvDoc = store.activeDocument()
  assert.equal(csvDoc.format, 'csv')
  assert.equal(csvDoc.segments[0].target, '你好，世界')
  assert.match(store.exportDocument({ format: 'bilingual-csv' }).content, /"Hello, ""world"""/)

  const srtImport = store.importFile({ name: 'movie.srt', text: srt })
  assert.equal(srtImport.units, 2)
  const srtDoc = store.activeDocument()
  assert.equal(srtDoc.format, 'srt')
  assert.equal(srtDoc.segments[0].meta.start, 1000)
  assert.equal(srtImport.warnings.length, 0)
  store.confirmSegment({ documentId: srtDoc.id, index: 0, target: '你好 <i>这里</i>' })
  const srtExport = store.exportDocument({ format: 'srt', documentId: srtDoc.id })
  assert.match(srtExport.filename, /\.zh-CN\.srt$/)
  assert.match(srtExport.content, /00:00:01,000 --> 00:00:03,500\n你好 <i>这里<\/i>/)
  assert.match(srtExport.content, /Second line/)

  const vttExport = store.exportDocument({ format: 'vtt', documentId: srtDoc.id })
  assert.match(vttExport.content, /^WEBVTT\n/)
  assert.match(vttExport.content, /00:00:01\.000 --> 00:00:03\.500/)

  const poImport = store.importFile({ name: 'app.po', text: po })
  assert.equal(poImport.units, 2)
  const poDoc = store.activeDocument()
  assert.equal(poDoc.format, 'po')
  assert.equal(poDoc.segments[0].meta.context, 'menu')
  assert.equal(poDoc.formatMeta.poObsolete.length, 1)
  const poExport = store.exportDocument({ format: 'po', documentId: poDoc.id })
  assert.match(poExport.content, /#\. menu label/)
  assert.match(poExport.content, /msgctxt "menu"/)
  assert.match(poExport.content, /msgid_plural "Files"/)
  assert.match(poExport.content, /msgstr\[1\] "文件（复数）"/)
  assert.match(poExport.content, /#~ msgid "Old"/)

  const xliffImport = store.importFile({ name: 'app.xliff', text: xliff })
  assert.equal(xliffImport.units, 1)
  const xliffDoc = store.activeDocument()
  assert.equal(xliffDoc.format, 'xliff')
  assert.equal(xliffDoc.segments[0].meta.xliffId, 'a')
  assert.throws(
    () => store.confirmSegment({ documentId: xliffDoc.id, index: 0, target: '你好世界' }),
    /占位符/,
  )
  store.confirmSegment({ documentId: xliffDoc.id, index: 0, target: '{1}你好世界{2}' })
  const xliffExport = store.exportDocument({ format: 'xliff', documentId: xliffDoc.id })
  assert.match(xliffExport.content, /<trans-unit id="a">/)
  assert.match(xliffExport.content, /<source xml:lang="en">Hello <g id="1">world<\/g><\/source>/)

  const xliff2Import = store.importFile({ name: 'app2.xliff', text: xliff2 })
  assert.equal(xliff2Import.units, 1)
  const xliff2Doc = store.activeDocument()
  assert.equal(xliff2Doc.format, 'xliff2')
  const xliff2Export = store.exportDocument({ format: 'xliff2', documentId: xliff2Doc.id })
  assert.match(xliff2Export.content, /<unit id="u1">/)
  assert.match(xliff2Export.content, /<source>Hi <ph id="1"\/><\/source>/)

  const reused = store.importFile({ name: 'movie-copy.srt', text: srt })
  assert.equal(reused.reused, true)
  assert.equal(store.docs.size, 5)

  const reload = new CatStore({ dataDir: dir })
  assert.equal(reload.bootstrap().documents.length, 5)
  const srtReloaded = reload.openDocument({ documentId: srtDoc.id })
  assert.equal(srtReloaded.document.name, 'movie.srt')
  assert.equal(reload.activeDocument().segments[0].meta.start, 1000)
  assert.match(reload.exportDocument({ format: 'srt' }).content, /00:00:01,000 --> 00:00:03,500/)
  const poReloaded = reload.openDocument({ documentId: poDoc.id })
  assert.equal(poReloaded.document.name, 'app.po')
  assert.equal(reload.activeDocument().format, 'po')
  assert.match(reload.exportDocument({ format: 'po' }).content, /#~ msgid "Old"/)

  assert.throws(() => parseCsv(''), /CSV/)
  assert.throws(() => parseSrt(''), /SRT/)
  assert.throws(() => parsePo(''), /PO/)
  assert.throws(() => parseXliff('<xliff version="1.2"><file><body></body></file></xliff>'), /XLIFF/)

  console.log('ALL FORMAT TESTS PASSED')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
