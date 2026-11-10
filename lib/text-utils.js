import { createHash, randomUUID } from 'node:crypto'
import { CatError } from './errors.js'
import { MAX_SEGMENT_CHARS } from './limits.js'

export function now() {
  return new Date().toISOString()
}

export function makeId(prefix) {
  return `${prefix}_${randomUUID().slice(0, 8)}`
}

export function documentFingerprint(sourceLang, targetLang, segments, format = '') {
  const hash = createHash('sha256')
  hash.update(String(sourceLang))
  hash.update('\u0000')
  hash.update(String(targetLang))
  hash.update('\u0000')
  hash.update(String(format ?? ''))
  hash.update('\u0000')
  for (const segment of segments) {
    hash.update(String(segment?.source ?? ''))
    hash.update('\u0000')
    hash.update(JSON.stringify(segment?.meta ?? null))
    hash.update('\u0000')
  }
  return hash.digest('hex')
}

export function cleanName(value, fallback = '未命名文档') {
  const name = String(value ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .trim()
  return name.slice(0, 120) || fallback
}

export function cleanText(value, field = '文本') {
  const text = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
  if (text.length > MAX_SEGMENT_CHARS) {
    throw new CatError('TEXT_TOO_LONG', `${field}超过 ${MAX_SEGMENT_CHARS} 字符上限`)
  }
  return text
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function countWords(value) {
  const text = String(value ?? '')
  const cjk = text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0
  return cjk + latin
}

export function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

export function cleanLibraryName(value, fallback = 'Untitled library') {
  const name = String(value ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .trim()
  if (name.length > 80) throw new CatError('INVALID_LIBRARY_NAME', '库名称不能超过 80 字符')
  return name || fallback
}

export function mdCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, '<br>')
    .trim()
}

export function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function safeBaseName(value) {
  const base = String(value ?? 'cait-export')
    .replace(/\.(txt|md|markdown|docx|tmx|csv|tsv|json|srt|vtt|po|pot|xliff|xlf)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '-')
    .trim()
  return (base || 'cait-export').slice(0, 80)
}

export function parseGlossaryCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const input = String(text ?? '').replace(/\r\n?/g, '\n')

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',' || char === '\t') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  row.push(field)
  if (row.some((cell) => cell.trim())) rows.push(row)

  const entries = []
  for (const cells of rows) {
    const [source, target, note, lang, caseFlag, forbiddenFlag, preferredFlag] = cells.map((cell) =>
      cell.trim(),
    )
    if (!source || !target) continue
    if (/^(source|term|原文|术语)$/i.test(source) && /^(target|translation|译文)$/i.test(target))
      continue
    const forbidden = /^(true|1|yes|y)$/i.test(forbiddenFlag || '')
    entries.push({
      source,
      target,
      note: note || '',
      sourceLang: lang || '',
      caseSensitive: /^(true|1|yes|y)$/i.test(caseFlag || ''),
      forbidden,
      preferred: !forbidden && /^(true|1|yes|y)$/i.test(preferredFlag || ''),
    })
  }
  return entries
}
