import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readZipEntries, writeZip } from '../lib/docx.js'
import { buildEpub, buildEpubFromText, parseEpub } from '../lib/epub.js'
import { CatStore } from '../lib/store.js'

console.log('CAIT EPUB test')

const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body>
<h1>Title</h1>
<p>Alpha <em>beta</em> gamma.</p>
<p>Delta.</p>
</body></html>`

const nav = `<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><ol><li><a href="chapter%20one.xhtml">Chapter</a></li></ol></nav></body></html>`
const container = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="Chapter%20One.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="ch1"/></spine></package>`

const fixture = writeZip([
  { name: 'mimetype', data: Buffer.from('application/epub+zip', 'utf8'), store: true },
  { name: 'META-INF/container.xml', data: Buffer.from(container, 'utf8') },
  { name: 'OEBPS/content.opf', data: Buffer.from(opf, 'utf8') },
  { name: 'OEBPS/nav.xhtml', data: Buffer.from(nav, 'utf8') },
  { name: 'OEBPS/chapter one.xhtml', data: Buffer.from(chapter, 'utf8') },
])

// Parsing follows the spine, skips the nav item, and keeps inline tags as tokens.
const parsed = parseEpub(fixture)
assert.equal(parsed.title, 'Book')
assert.equal(parsed.language, 'en')
assert.equal(parsed.segments.length, 3)
assert.equal(parsed.segments[0].source, 'Title')
assert.equal(parsed.segments[1].source, 'Alpha {1}beta{2} gamma.')
assert.equal(parsed.segments[2].source, 'Delta.')
assert.equal(parsed.segments[1].meta.epubHref, 'OEBPS/Chapter One.xhtml')
assert.equal(parsed.segments[1].meta.epubBlock, 1)
assert.equal(parsed.segments[1].meta.inline.length, 2)

// Export patches translated text back into the retained XHTML.
const translated = {
  id: 'doc_epub',
  name: 'book',
  sourceLang: 'en',
  targetLang: 'fr',
  segments: parsed.segments.map((segment, index) => ({
    ...segment,
    target: index === 0 ? 'Titre' : index === 1 ? 'Un {1}deux{2} trois.' : 'Quatre.',
  })),
}
const patched = buildEpub(translated, fixture)
const reparsed = parseEpub(patched)
assert.equal(reparsed.segments[0].source, 'Titre')
assert.equal(reparsed.segments[1].source, 'Un {1}deux{2} trois.')
assert.equal(reparsed.segments[2].source, 'Quatre.')
const entries = readZipEntries(patched)
assert.equal(entries[0].name, 'mimetype')
assert.equal(entries[0].method, 0)
assert.equal(entries[0].data.toString('utf8'), 'application/epub+zip')
const xhtml = entries.find((entry) => entry.name === 'OEBPS/chapter one.xhtml').data.toString('utf8')
assert.match(xhtml, /<h1>Titre<\/h1>/)
assert.match(xhtml, /Un <em>deux<\/em> trois\./)

// Missing tokens fall back to the source segment instead of corrupting markup.
const partial = buildEpub({
  ...translated,
  segments: [{ ...translated.segments[0], target: '' }, { ...translated.segments[1], target: 'Sans balises.' }],
}, fixture)
const partialParsed = parseEpub(partial)
assert.equal(partialParsed.segments[1].source, 'Alpha {1}beta{2} gamma.')

// A new EPUB is valid: mimetype is stored first, then container/OPF/nav/chapter.
const fresh = buildEpubFromText({
  id: 'doc_new',
  name: 'fresh',
  sourceLang: 'en',
  targetLang: 'zh-CN',
  segments: [
    { source: 'One.', target: '一。', paragraph: 0 },
    { source: 'Two.', target: '二。', paragraph: 1 },
  ],
})
const freshEntries = readZipEntries(fresh)
assert.deepEqual(
  freshEntries.map((entry) => entry.name),
  ['mimetype', 'META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/chapter.xhtml'],
)
assert.equal(freshEntries[0].method, 0)
assert.equal(parseEpub(fresh).segments.length, 2)

// Store integration: sidecar source, patch export, reload, and delete cleanup.
const dir = mkdtempSync(join(tmpdir(), 'cait-epub-'))
try {
  const store = new CatStore({ dataDir: dir })
  const imported = store.importFile({
    name: 'book.epub',
    base64: fixture.toString('base64'),
    sourceLang: 'en',
    targetLang: 'fr',
  })
  assert.equal(imported.units, 3)
  const doc = store.requireDocument(imported.document.id)
  assert.equal(doc.format, 'epub')
  assert.equal(doc.sourceEpub.kind, 'file')
  assert.equal(existsSync(join(dir, doc.sourceEpub.asset)), true)

  store.saveDraft({ documentId: doc.id, index: 0, target: 'Titre' })
  store.saveDraft({ documentId: doc.id, index: 1, target: 'Un {1}deux{2} trois.' })
  store.saveDraft({ documentId: doc.id, index: 2, target: 'Quatre.' })
  store.persist()
  const exported = store.exportDocument({ documentId: doc.id, format: 'epub' })
  assert.match(exported.filename, /\.epub$/)
  assert.equal(exported.mime, 'application/epub+zip')

  const reloaded = new CatStore({ dataDir: dir })
  const reopened = reloaded.requireDocument(doc.id)
  assert.equal(reopened.sourceEpub.kind, 'file')
  const roundTrip = reloaded.exportDocument({ documentId: reopened.id, format: 'epub' })
  assert.equal(parseEpub(roundTrip.content).segments[1].source, 'Un {1}deux{2} trois.')

  const assetPath = join(dir, reopened.sourceEpub.asset)
  reloaded.deleteDocument({ documentId: reopened.id })
  assert.equal(existsSync(assetPath), false)

  const generated = reloaded.createDocument({
    name: 'generated',
    text: 'Plain source.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  reloaded.saveDraft({ documentId: generated.document.id, target: '纯文本。' })
  const plain = reloaded.exportDocument({ documentId: generated.document.id, format: 'epub' })
  assert.equal(parseEpub(plain.content).segments.length, 1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('ALL EPUB TESTS PASSED')
