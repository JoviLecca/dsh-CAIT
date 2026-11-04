import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { buildXlsx, parseXlsx } from '../lib/xlsx.js'
import { buildPptx, parsePptxDetailed } from '../lib/pptx.js'
import { readZipEntries, writeZip } from '../lib/docx.js'

const dir = mkdtempSync(join(tmpdir(), 'cait-second-tier-'))
try {
  const store = new CatStore({ dataDir: dir })
  const html = '<h1>Title</h1><p>Hello <b>world</b></p>'
  const importedHtml = store.importFile({ name: 'page.html', text: html, sourceLang: 'en', targetLang: 'zh-CN' })
  assert.equal(importedHtml.document.name, 'page.html')
  assert.equal(store.activeDocument().format, 'html')
  assert.equal(store.activeDocument().segments[0].source, 'Title')
  assert.match(store.exportDocument({ format: 'html' }).content, /<p>/)

  const importedJson = store.importFile({
    name: 'strings.json',
    text: JSON.stringify({ title: 'Hello', nested: { body: 'World' } }),
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  assert.equal(importedJson.document.name, 'strings.json')
  const jsonDoc = store.activeDocument()
  assert.equal(jsonDoc.format, 'json')
  assert.equal(jsonDoc.formatMeta.jsonTemplate.includes('nested'), true)
  jsonDoc.segments[0].target = '你好'
  jsonDoc.segments[1].target = '世界'
  const exportedJson = JSON.parse(store.exportDocument({ format: 'json-tree' }).content)
  assert.equal(exportedJson.title, '你好')
  assert.equal(exportedJson.nested.body, '世界')

  const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}Hello \b world\b0\par Second paragraph\par}`
  const importedRtf = store.importFile({ name: 'notes.rtf', text: rtf, sourceLang: 'en', targetLang: 'zh-CN' })
  assert.equal(importedRtf.document.name, 'notes.rtf')
  assert.deepEqual(store.activeDocument().segments.map((s) => s.source), ['Hello world', 'Second paragraph'])
  assert.match(store.exportDocument({ format: 'rtf' }).content, /\\rtf1/)

  const xlsxSource = buildXlsx({
    segments: [
      { source: 'Alpha', target: '阿尔法' },
      { source: 'Beta', target: '' },
    ],
  })
  assert.equal(parseXlsx(xlsxSource).segments.length, 2)
  const importedXlsx = store.importFile({
    name: 'terms.xlsx',
    base64: xlsxSource.toString('base64'),
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  assert.equal(importedXlsx.document.name, 'terms.xlsx')
  assert.equal(store.activeDocument().format, 'xlsx')
  assert.equal(store.activeDocument().segments[0].target, '阿尔法')
  const exportedXlsx = store.exportDocument({ format: 'xlsx' })
  assert.equal(Buffer.isBuffer(exportedXlsx.content), true)
  assert.equal(exportedXlsx.filename.endsWith('.xlsx'), true)
  assert.equal(parseXlsx(exportedXlsx.content).segments.length, 2)

  const slideXml = `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:rPr b="1"/><a:t>Hello slide</a:t></a:r></a:p>
    <a:p><a:r><a:t>Second line</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
  const pptx = writeZip([
    { name: 'ppt/slides/slide1.xml', data: Buffer.from(slideXml, 'utf8') },
  ])
  const parsedPptx = parsePptxDetailed(pptx)
  assert.equal(parsedPptx.segments.length, 2)
  assert.equal(parsedPptx.segments[0].source, 'Hello slide')
  assert.deepEqual(parsedPptx.segments[0].meta, {
    format: 'pptx',
    pptxSlide: 'ppt/slides/slide1.xml',
    pptxParagraph: 0,
  })
  const importedPptx = store.importFile({
    name: 'deck.pptx',
    base64: pptx.toString('base64'),
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  assert.equal(importedPptx.document.name, 'deck.pptx')
  assert.equal(store.activeDocument().format, 'pptx')
  assert.equal(existsSync(join(dir, 'sources', `${store.activeDocument().id}.pptx`)), true)
  store.confirmSegment({ index: 0, target: '幻灯片你好' })
  const exportedPptx = store.exportDocument({ format: 'pptx' })
  assert.equal(Buffer.isBuffer(exportedPptx.content), true)
  const pptxEntries = readZipEntries(exportedPptx.content)
  const patchedSlide = pptxEntries.find((entry) => entry.name === 'ppt/slides/slide1.xml').data.toString('utf8')
  assert.match(patchedSlide, /幻灯片你好/)
  assert.match(patchedSlide, /<a:rPr b="1"\/>/)

  const xlsxDoc = store.docs.get(importedXlsx.document.id)
  const pptxDoc = store.docs.get(importedPptx.document.id)
  const jsonDocId = jsonDoc.id
  const reload = new CatStore({ dataDir: dir })
  assert.equal(reload.bootstrap().documents.length, 5)
  const reloadedPptx = reload.docs.get(pptxDoc.id)
  assert.equal(reloadedPptx.format, 'pptx')
  assert.equal(reloadedPptx.sourcePptx.kind, 'file')
  assert.match(reload.openDocument({ documentId: pptxDoc.id }).document.name, /deck/)
  const reloadedPptxZip = readZipEntries(reload.exportDocument({ documentId: pptxDoc.id, format: 'pptx' }).content)
  assert.match(
    reloadedPptxZip.find((entry) => entry.name === 'ppt/slides/slide1.xml').data.toString('utf8'),
    /幻灯片你好/,
  )
  assert.equal(reload.docs.get(jsonDocId).formatMeta.jsonTemplate.includes('nested'), true)

  reload.deleteDocument({ documentId: pptxDoc.id })
  assert.equal(existsSync(join(dir, 'sources', `${pptxDoc.id}.pptx`)), false)
  assert.equal(reload.docs.has(xlsxDoc.id), true)

  console.log('ALL SECOND-TIER TESTS PASSED')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
