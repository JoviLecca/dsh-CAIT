import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CatStore } from '../lib/store.js'

const dir = mkdtempSync(join(tmpdir(), 'cait-localization-'))

function imported(store, name, text) {
  const result = store.importFile({ name, text })
  const doc = store.docs.get(result.document.id)
  assert.ok(doc, `${name} document should exist`)
  return doc
}

function translateAll(store, doc, prefix = '译:') {
  doc.segments.forEach((segment, index) => {
    store.saveDraft({ documentId: doc.id, index, target: `${prefix}${segment.source}` })
  })
}

try {
  const store = new CatStore({ dataDir: dir })

  const apple = imported(
    store,
    'Localizable.strings',
    `/* Greeting */\n"hello" = "Hello";\n"bye" = "Goodbye";\n`,
  )
  assert.equal(apple.segments.length, 2)
  assert.equal(apple.segments[0].meta.identifier, 'hello')
  assert.equal(apple.segments[0].meta.comments[0], 'Greeting')
  translateAll(store, apple)
  const appleOut = store.exportDocument({ format: 'apple-strings', documentId: apple.id })
  assert.match(appleOut.filename, /\.strings$/)
  assert.match(appleOut.content, /\/\* Greeting \*\//)
  assert.match(appleOut.content, /"hello" = "译:Hello";/)
  assert.doesNotMatch(appleOut.content, /"hello" = "Hello";/)

  const android = imported(
    store,
    'strings.xml',
    `<resources>
  <!-- title -->
  <string name="app_name">My App</string>
  <string name="brand" translatable="false">Brand</string>
  <plurals name="count">
    <item quantity="one">%d item</item>
    <item quantity="other">%d items</item>
  </plurals>
</resources>`,
  )
  assert.equal(android.segments.length, 3)
  assert.equal(android.segments[0].meta.identifier, 'app_name')
  assert.equal(android.segments[1].meta.context, 'one')
  assert.equal(android.segments[1].meta.plural, true)
  translateAll(store, android)
  const androidOut = store.exportDocument({ format: 'android', documentId: android.id })
  assert.match(androidOut.filename, /\.xml$/)
  assert.match(androidOut.content, /<string name="app_name">译:My App<\/string>/)
  assert.match(androidOut.content, /translatable="false">Brand<\/string>/)
  assert.match(androidOut.content, /<item quantity="one">译:%d item<\/item>/)
  assert.match(androidOut.content, /<item quantity="other">译:%d items<\/item>/)

  const resx = imported(
    store,
    'Resources.resx',
    `<?xml version="1.0" encoding="utf-8"?>
<root>
  <data name="Greeting" xml:space="preserve"><value>Hello</value><comment>home</comment></data>
  <data name="Blob" type="System.Byte[]"><value>AA==</value></data>
</root>`,
  )
  assert.equal(resx.segments.length, 1)
  assert.equal(resx.segments[0].meta.comments[0], 'home')
  translateAll(store, resx)
  const resxOut = store.exportDocument({ format: 'resx', documentId: resx.id })
  assert.match(resxOut.filename, /\.resx$/)
  assert.match(resxOut.content, /<data name="Greeting" xml:space="preserve">/)
  assert.match(resxOut.content, /<value>译:Hello<\/value>/)
  assert.match(resxOut.content, /<comment>home<\/comment>/)
  assert.doesNotMatch(resxOut.content, /name="Blob"/)

  const arb = imported(
    store,
    'app_en.arb',
    JSON.stringify(
      {
        '@@locale': 'en',
        hello: 'Hello',
        '@hello': { description: 'greeting' },
      },
      null,
      2,
    ),
  )
  assert.equal(arb.segments.length, 1)
  assert.equal(arb.segments[0].meta.identifier, 'hello')
  translateAll(store, arb)
  const arbOut = store.exportDocument({ format: 'arb', documentId: arb.id })
  assert.match(arbOut.filename, /\.arb$/)
  const arbJson = JSON.parse(arbOut.content)
  assert.equal(arbJson.hello, '译:Hello')
  assert.equal(arbJson['@@locale'], 'en')
  assert.equal(arbJson['@hello'].description, 'greeting')

  const props = imported(store, 'messages.properties', `# home\nhello=Hello\nbye:Goodbye\n`)
  assert.equal(props.segments.length, 2)
  translateAll(store, props)
  const propsOut = store.exportDocument({ format: 'properties', documentId: props.id })
  assert.match(propsOut.content, /# home/)
  assert.match(propsOut.content, /hello=译:Hello/)
  assert.match(propsOut.content, /bye=译:Goodbye/)

  const yaml = imported(store, 'en.yaml', `# home\nhello: Hello\nbye: Goodbye\n`)
  assert.equal(yaml.segments.length, 2)
  translateAll(store, yaml)
  const yamlOut = store.exportDocument({ format: 'yaml', documentId: yaml.id })
  assert.match(yamlOut.content, /# home/)
  assert.match(yamlOut.content, /hello: 译:Hello/)
  assert.match(yamlOut.content, /bye: 译:Goodbye/)

  const nestedYaml = imported(
    store,
    'nested.yaml',
    `# app
app:
  title: Hello
  count: 2
  enabled: true
  features:
    - Fast
    - name: Safe
      detail: |
        Multi
        line
`,
  )
  assert.equal(nestedYaml.segments.length, 4)
  assert.equal(nestedYaml.segments[0].meta.keyPath, 'app.title')
  assert.equal(nestedYaml.segments[1].meta.keyPath, 'app.features[0]')
  assert.equal(nestedYaml.segments[2].meta.keyPath, 'app.features[1].name')
  assert.equal(nestedYaml.segments[3].meta.keyPath, 'app.features[1].detail')
  assert.equal(nestedYaml.segments[3].source, 'Multi\nline')
  translateAll(store, nestedYaml)
  const nestedOut = store.exportDocument({ format: 'yaml', documentId: nestedYaml.id })
  assert.match(nestedOut.content, /# app/)
  assert.match(nestedOut.content, /title: 译:Hello/)
  assert.match(nestedOut.content, /- 译:Fast/)
  assert.match(nestedOut.content, /name: 译:Safe/)
  assert.match(nestedOut.content, /detail: \|/)
  assert.match(nestedOut.content, /译:Multi/)
  assert.doesNotMatch(nestedOut.content, /count: 译:2/)
  const reparsed = store.importFile({ name: 'nested-out.yaml', text: nestedOut.content })
  assert.equal(store.docs.get(reparsed.document.id).segments.length, 4)
  assert.throws(
    () => store.importFile({ name: 'anchor.yaml', text: 'base: &x hello\ncopy: *x\n' }),
    /YAML/,
  )
  assert.throws(() => store.importFile({ name: 'flow.yaml', text: 'list: [one, two]\n' }), /YAML/)

  const stringsdict = imported(
    store,
    'Localizable.stringsdict',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <dict>
    <key>NSStringLocalizedFormatKey</key>
    <string>%#@count@</string>
    <key>count</key>
    <dict>
      <key>NSStringFormatSpecTypeKey</key>
      <string>NSStringPluralRuleType</string>
      <key>NSStringFormatValueTypeKey</key>
      <string>d</string>
      <key>one</key>
      <string>%d item</string>
      <key>other</key>
      <string>%d items</string>
    </dict>
  </dict>
</dict>
</plist>`,
  )
  assert.equal(stringsdict.segments.length, 2)
  assert.equal(stringsdict.segments[0].meta.context, 'one')
  translateAll(store, stringsdict)
  const dictOut = store.exportDocument({ format: 'apple-stringsdict', documentId: stringsdict.id })
  assert.match(dictOut.filename, /\.stringsdict$/)
  assert.match(dictOut.content, /<key>one<\/key>\s*<string>译:%d item<\/string>/)
  assert.match(dictOut.content, /<key>other<\/key>\s*<string>译:%d items<\/string>/)

  store.persist()
  const reloaded = new CatStore({ dataDir: dir })
  const reloadedDoc = reloaded.docs.get(android.id)
  assert.ok(reloadedDoc)
  assert.equal(reloadedDoc.segments[0].target, '译:My App')
  const reloadedOut = reloaded.exportDocument({ format: 'android', documentId: android.id })
  assert.match(reloadedOut.content, /译:My App/)

  console.log('ALL LOCALIZATION TESTS PASSED')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
