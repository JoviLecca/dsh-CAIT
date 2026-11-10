import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectRoot } from '../scripts/lib/client-source.mjs'
import { collectErrorCodes } from '../scripts/lib/error-codes.mjs'
import { CLIENT_ERROR_CODES, ERROR_FAMILIES, describeError, errorKeys } from '../client/errors.js'

// The server reports a stable code and a Chinese message. The UI has to show
// localized copy instead, so these checks pin both ends: exact codes win over
// their family, families win over the generic message, and a genuinely unknown
// code still shows something readable rather than a bare `error.NOPE`.

function section(name) {
  console.log(`\n# ${name}`)
}

const { ZH, EN, JA, makeTranslator } = await import(
  pathToFileURL(join(projectRoot, 'client', 'locales.js')).href
)
const DICTS = { zh: ZH, en: EN, ja: JA }
// A DSH translator that knows nothing: unknown keys come back as the key, which
// is exactly what describeError has to detect and skip.
const translate = (key) => key
const tFor = (lang) => makeTranslator(lang, translate)

section('exact code beats family')
assert.equal(
  describeError({ code: 'NO_DOCUMENT' }, tFor('en')),
  EN['error.NO_DOCUMENT'],
  'an exact entry should win',
)
assert.equal(describeError({ code: 'NO_DOCUMENT' }, tFor('zh')), ZH['error.NO_DOCUMENT'])
assert.equal(describeError({ code: 'NO_DOCUMENT' }, tFor('ja')), JA['error.NO_DOCUMENT'])

section('family rules cover the long tail')
assert.equal(describeError({ code: 'XLSX_PARSE' }, tFor('en')), EN['error.parse'])
assert.equal(describeError({ code: 'PPTX_NO_UNITS' }, tFor('en')), EN['error.noUnits'])
assert.equal(describeError({ code: 'INVALID_FORMAT' }, tFor('en')), EN['error.invalid'])
assert.equal(describeError({ code: 'MERGE_RANGE_INVALID' }, tFor('zh')), ZH['error.invalid'])
assert.equal(describeError({ code: 'SUBTITLE_SHIFT_INVALID' }, tFor('ja')), JA['error.invalid'])
assert.deepEqual(errorKeys('XLSX_PARSE'), ['error.XLSX_PARSE', 'error.parse'])
assert.deepEqual(errorKeys('NO_DOCUMENT'), ['error.NO_DOCUMENT'])
assert.deepEqual(errorKeys('SOMETHING_NEW'), ['error.SOMETHING_NEW'])

section('unknown codes still show the server message')
assert.equal(
  describeError({ code: 'SOMETHING_NEW', message: '服务端说明' }, tFor('en')),
  '服务端说明',
)
assert.equal(describeError({ message: '只有消息' }, tFor('en')), '只有消息')
assert.equal(describeError({}, tFor('en'), '兜底'), '兜底')

section('placeholders are filled, never left as tokens')
assert.equal(
  describeError({ code: 'HTTP', vars: { status: 502 } }, tFor('en')),
  'The service returned HTTP 502.',
)

section('every server code has copy in every language')
const codes = collectErrorCodes()
assert.ok(codes.length > 100, `expected the full code inventory, got ${codes.length}`)
for (const code of codes) {
  for (const [lang, dict] of Object.entries(DICTS)) {
    const text = describeError({ code, vars: { status: 500 } }, tFor(lang))
    assert.ok(text && text.length > 0, `${code} resolved to nothing in ${lang}`)
    assert.notEqual(text, `error.${code}`, `${code} fell through to its key in ${lang}`)
    assert.notEqual(text, dict['error.generic'], `${code} fell back to the generic copy in ${lang}`)
    assert.ok(!text.includes('{'), `${code} left a placeholder in ${lang}: ${text}`)
  }
}

section('client-only codes are translated')
for (const code of CLIENT_ERROR_CODES) {
  for (const [lang, dict] of Object.entries(DICTS)) {
    const expected = dict[`error.${code}`].replace('{status}', '500')
    assert.equal(describeError({ code, vars: { status: 500 } }, tFor(lang)), expected)
  }
}

section('every family key exists in every dictionary')
for (const rule of ERROR_FAMILIES) {
  for (const [lang, dict] of Object.entries(DICTS)) {
    assert.ok(dict[rule.key], `${lang} is missing ${rule.key}`)
  }
}

console.log(`\n错误文案 ${codes.length} 个码 × ${Object.keys(DICTS).length} 种语言全部通过`)
