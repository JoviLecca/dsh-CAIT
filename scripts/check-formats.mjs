/**
 * Format registry guard.
 *
 * The UI advertises what it can export and which file types it accepts; the
 * server implements the adapters. Both lists drifted apart silently before
 * (a new export option rendered fine and then threw on click), so this check
 * compares them in both directions.
 */
import { EXPORTERS } from '../lib/export-document.js'
import { SUPPORTED_IMPORT_EXTENSIONS } from '../lib/import-file.js'
import { readAuthoredClient } from './lib/client-source.mjs'

/** Aliases the API accepts but the export dialog does not list separately. */
const HIDDEN_EXPORT_ALIASES = new Set(['xlf', 'json', 'json-export', 'document-json', 'source-txt'])

/** Accept lists that belong to non-document pickers (TM, glossary, review). */
const IGNORED_EXTENSIONS = new Set(['tbx', 'tsv'])

const client = readAuthoredClient()
const problems = []
const info = []

const offered = new Set(
  [...client.matchAll(/'([a-z0-9-]+)',\s*\r?\n?\s*t\('modal\.export\./g)].map((match) => match[1]),
)

const accepted = new Set()
for (const match of client.matchAll(/accept:\s*\r?\n?\s*'([^']+)'/g)) {
  for (const part of match[1].split(',')) {
    const value = part.trim()
    if (value.startsWith('.') && value.length > 1) accepted.add(value.slice(1).toLowerCase())
  }
}

for (const format of offered) {
  if (!EXPORTERS[format]) problems.push(`导出对话框提供了 ${format}，但没有对应的适配器`)
}
for (const format of Object.keys(EXPORTERS)) {
  if (!offered.has(format) && !HIDDEN_EXPORT_ALIASES.has(format)) {
    info.push(`适配器 ${format} 没有出现在导出对话框里`)
  }
}

for (const extension of accepted) {
  if (IGNORED_EXTENSIONS.has(extension)) continue
  if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
    problems.push(`导入框接受 .${extension}，但没有对应的读取器`)
  }
}
for (const extension of SUPPORTED_IMPORT_EXTENSIONS) {
  if (!accepted.has(extension)) info.push(`读取器支持 .${extension}，但没有导入框提示它`)
}

for (const line of info) console.log(`info: ${line}`)

if (problems.length) {
  for (const line of problems) console.error(`error: ${line}`)
  process.exit(1)
}

console.log(
  `格式一致：导出 ${offered.size} 项全部实现，导入 ${accepted.size - IGNORED_EXTENSIONS.size} 种扩展名全部可读`,
)
