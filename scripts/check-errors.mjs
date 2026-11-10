// Every error the UI can show has to arrive with copy in the user's language.
// The server already carries a stable `CatError.code`; this check makes sure no
// code can fall through to the generic message, which is what would happen if a
// new error were added without a dictionary entry or a matching family rule.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectRoot } from './lib/client-source.mjs'
import { collectErrorCodes } from './lib/error-codes.mjs'
import { CLIENT_ERROR_CODES, ERROR_FAMILIES, errorKeys } from '../client/errors.js'

const { ZH, EN, JA } = await import(pathToFileURL(join(projectRoot, 'client', 'locales.js')).href)
const DICTS = { zh: ZH, en: EN, ja: JA }

let failed = false
const fail = (message) => {
  failed = true
  console.error(`✗ ${message}`)
}

const codes = new Set(collectErrorCodes())

// 1. 每个码都必须能落到「专属文案」或「类别文案」，不能只剩 error.generic。
// 注意只判断「有没有候选键」不够：专属键可能压根没写进字典，所以要看字典里是否真的有。
const hasCopy = (code) => errorKeys(code).some((key) => DICTS.en[key])
const unresolved = [...codes].filter((code) => !hasCopy(code))
if (unresolved.length) {
  fail(`这些错误码没有对应文案，也没有匹配的类别：${unresolved.join(', ')}`)
}

// 2. 类别键与客户端自造的码必须在三本字典里都有值。
const required = new Set(['error.generic', ...ERROR_FAMILIES.map((rule) => rule.key)])
for (const code of CLIENT_ERROR_CODES) required.add(`error.${code}`)
for (const key of required) {
  for (const [lang, dict] of Object.entries(DICTS)) {
    if (!dict[key] || !String(dict[key]).trim()) fail(`${lang} 缺少 ${key}`)
  }
}

// 3. 反向检查：字典里的 error.* 不能是拼错的孤儿键。
const known = new Set(required)
for (const code of codes) {
  known.add(`error.${code}`)
  for (const key of errorKeys(code)) known.add(key)
}
for (const [lang, dict] of Object.entries(DICTS)) {
  const orphans = Object.keys(dict).filter((key) => key.startsWith('error.') && !known.has(key))
  if (orphans.length) fail(`${lang} 有无法对应到错误码的键：${orphans.join(', ')}`)
}

if (failed) process.exit(1)

const specific = [...codes].filter((code) => Boolean(DICTS.en[`error.${code}`])).length
console.log(
  `错误文案齐备：${codes.size} 个错误码（${specific} 个专属、${codes.size - specific} 个按类别），` +
    `${required.size} 个兜底键 × ${Object.keys(DICTS).length} 种语言`,
)
