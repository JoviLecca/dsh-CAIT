import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectRoot, readAuthoredClient } from './lib/client-source.mjs'

const strict = process.argv.includes('--strict')
const { ZH, EN, JA } = await import(pathToFileURL(join(projectRoot, 'client', 'locales.js')).href)
const DICTS = { zh: ZH, en: EN, ja: JA }

let failed = false
const fail = (message) => {
  failed = true
  console.error(`✗ ${message}`)
}

// 1. 三本字典的键必须完全对齐：少一个键，界面就会掉到别的语言或直接显示键名。
const allKeys = new Set([...Object.keys(ZH), ...Object.keys(EN), ...Object.keys(JA)])
for (const [lang, dict] of Object.entries(DICTS)) {
  const missing = [...allKeys].filter((key) => !(key in dict))
  if (missing.length) {
    fail(`${lang} 缺 ${missing.length} 个键：${missing.slice(0, 8).join(', ')}`)
  }
  const empty = Object.entries(dict).filter(
    ([, value]) => typeof value !== 'string' || !value.trim(),
  )
  if (empty.length) {
    fail(
      `${lang} 有 ${empty.length} 个空值：${empty
        .slice(0, 8)
        .map(([key]) => key)
        .join(', ')}`,
    )
  }
}

// 2. 占位符必须跨语言一致：翻译时漏写或改名，运行期就会把 `{count}` 原样显示出来。
const placeholders = (text) => new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
for (const key of allKeys) {
  const shapes = Object.entries(DICTS).map(([lang, dict]) => ({
    lang,
    names: [...placeholders(dict[key])].sort().join(','),
  }))
  const expected = shapes[0].names
  for (const shape of shapes.slice(1)) {
    if (shape.names !== expected) {
      fail(`${key} 的占位符不一致：${shapes.map((s) => `${s.lang}=[${s.names}]`).join(' ')}`)
    }
  }
}

// 3. locale/*.json 是另一条 i18n 通道，重叠的键必须与客户端字典同值。
const localeDir = join(projectRoot, 'locale')
for (const [lang, dict] of Object.entries(DICTS)) {
  const payload = JSON.parse(readFileSync(join(localeDir, `${lang}.json`), 'utf8'))
  for (const [key, value] of Object.entries(payload)) {
    if (key in dict && dict[key] !== value) {
      fail(`locale/${lang}.json 的 ${key} 与 client/locales.js 不一致`)
    }
  }
}

// 4. 疑似死键：定义了但客户端源码里没有任何字面量或模板前缀引用。
const clientText = readAuthoredClient()
const literals = new Set()
for (const match of clientText.matchAll(/['"]([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)['"]/g)) {
  literals.add(match[1])
}
const prefixes = [...clientText.matchAll(/`([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)*)\.\$\{/g)].map(
  (match) => `${match[1]}.`,
)
const unused = [...allKeys].filter(
  (key) => !literals.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)),
)

if (unused.length) {
  const message = `疑似死键 ${unused.length} 个：${unused.slice(0, 10).join(', ')}`
  if (strict) fail(message)
  else console.log(`info: ${message}`)
}

if (failed) process.exit(1)
console.log(`i18n 键齐平：${allKeys.size} 个键 × ${Object.keys(DICTS).length} 种语言`)
