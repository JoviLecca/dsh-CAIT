import { createHash, randomUUID } from 'node:crypto'
import { CatError } from './errors.js'
import { clamp, clampInt } from './similarity.js'
import { DEFAULT_PREPROCESS, normalizePreprocessOptions } from './preprocess.js'

export { clamp, clampInt }

export const MAX_SEGMENTS = 20000
export const CAIT_VERSION = '1.1.6'
export const MAX_SEGMENT_CHARS = 20000
export const MAX_IMPORT_CHARS = 8_000_000
export const MAX_DOCX_BASE64 = 28_000_000
export const MAX_STORE_BYTES = 64 * 1024 * 1024
export const STORE_VERSION = 7
export const MT_BATCH_MAX = 8
export const STORE_FILENAME = 'store.json'
export const DEFAULT_TM_ID = 'tm_default'
export const DEFAULT_GLOSSARY_ID = 'glossary_default'
export const DEFAULT_TM_NAME = 'Default TM'
export const DEFAULT_GLOSSARY_NAME = 'Default glossary'

// Segment lifecycle: nothing translated yet → a draft or a proposal exists →
// a human confirmed it. `origin` records where the current target/suggestion
// came from, which is what makes "MT filled it, I only reviewed" auditable.
export const SEGMENT_STATUSES = ['pending', 'translated', 'confirmed']
export const SEGMENT_ORIGINS = ['tm', 'mt', 'agent', 'manual', 'auto']

export function segmentStatus(segment) {
  const target = String(segment?.target ?? '')
  const suggestion = String(segment?.suggestion ?? '')
  if (target && segment?.confirmedAt) return 'confirmed'
  if (target || suggestion) return 'translated'
  return 'pending'
}

/**
 * Re-derive the stored fields from the facts (target/suggestion/confirmedAt)
 * so the three-state model cannot drift out of sync with the text.
 */
export function normalizeSegmentState(segment) {
  if (!String(segment.target ?? '')) segment.confirmedAt = null
  if (!String(segment.suggestion ?? '')) {
    segment.suggestion = ''
    segment.suggestionReason = ''
  }
  segment.status = segmentStatus(segment)
  if (segment.status === 'pending') {
    segment.origin = null
  } else if (!SEGMENT_ORIGINS.includes(segment.origin)) {
    segment.origin = 'manual'
  }
  return segment
}

// UI languages the workbench can switch between; 'auto' follows the DSH locale.
export const UI_LANG_CODES = ['auto', 'zh', 'en', 'ja']

// Below ~70% a fuzzy match usually shares little more than function words, so
// showing it costs review time without saving any. Mainstream CAT tools sit in
// the 70–75% range for the same reason.
export const DEFAULT_FUZZY_THRESHOLD = 0.7

export const DEFAULT_SETTINGS = {
  sourceLang: 'en',
  targetLang: 'zh-CN',
  fuzzyThreshold: DEFAULT_FUZZY_THRESHOLD,
  tmLimit: 5,
  uiLang: 'auto',
  preprocess: { ...DEFAULT_PREPROCESS },
  mt: {
    provider: 'mock',
    model: 'cait-mock',
    temperature: 0.2,
  },
  // Empty provider/model means "inherit the MT route". A separate route lets
  // review use a stronger model without slowing down bulk pre-translation.
  review: {
    provider: '',
    model: '',
    temperature: 0,
  },
}

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
  const name = String(value ?? '').replace(/[\r\n\t]/g, ' ').trim()
  return name.slice(0, 120) || fallback
}

export function canonicalLanguage(value) {
  const lang = String(value ?? '').trim()
  if (!lang) return ''
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,34}$/.test(lang)) {
    throw new CatError('INVALID_LANGUAGE', `语言代码不合法: ${lang}`)
  }
  try {
    return Intl.getCanonicalLocales(lang.replace(/_/g, '-'))[0]
  } catch {
    throw new CatError('INVALID_LANGUAGE', `语言代码不合法: ${lang}`)
  }
}

export function cleanLang(value, fallback) {
  const lang = String(value ?? '').trim()
  if (!lang) return fallback
  return canonicalLanguage(lang)
}

export function cleanText(value, field = '文本') {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim()
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

export function restoredDate(value, fallback = now()) {
  return isIsoDate(value) ? new Date(value).toISOString() : fallback
}

export function restoredLang(value, fallback) {
  const lang = String(value ?? '').trim()
  if (!lang) return fallback
  try {
    return canonicalLanguage(lang)
  } catch {
    throw new Error(`数据文件中的语言代码不合法: ${lang}`)
  }
}

export function restoredText(value, field, { required = false } = {}) {
  if (typeof value !== 'string') throw new Error(`数据文件中的${field}必须是字符串`)
  const text = value.replace(/\r\n?/g, '\n').trim()
  if (required && !text) throw new Error(`数据文件中的${field}不能为空`)
  if (text.length > MAX_SEGMENT_CHARS) throw new Error(`数据文件中的${field}超过长度上限`)
  return text
}

function cleanStringList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return null
  const list = value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems)
  return list.length ? list : null
}

function cleanInlineTokens(value) {
  if (!Array.isArray(value)) return null
  const tokens = []
  const seen = new Set()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const token = typeof item.token === 'string' ? item.token.trim() : ''
    const xml = typeof item.xml === 'string' ? item.xml.trim() : ''
    if (!/^\{\d+\}$/.test(token) || !xml || xml.length > 2000 || seen.has(token)) continue
    seen.add(token)
    tokens.push({ token, xml })
    if (tokens.length >= 50) break
  }
  return tokens.length ? tokens : null
}

/**
 * Persisted per-segment metadata for exchange formats (cue timing, PO context,
 * XLIFF unit id and inline placeholders). Only JSON primitives are kept;
 * unknown keys are discarded.
 */
export function cleanSegmentMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const meta = {}
  for (const key of ['start', 'end', 'xlsxRow', 'pptxParagraph', 'epubBlock']) {
    const number = Number(value[key])
    if (Number.isFinite(number) && number >= 0) meta[key] = Math.round(number)
  }
  for (const key of ['settings', 'identifier', 'context', 'msgidPlural', 'xliffId', 'format', 'jsonPath', 'pptxSlide', 'epubHref']) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      meta[key] = value[key].slice(0, 500)
    }
  }
  if (typeof value.plural === 'boolean') meta.plural = value.plural
  const comments = cleanStringList(value.comments, 20, 500)
  if (comments) meta.comments = comments
  const plurals = cleanStringList(value.plurals, 6, 5000)
  if (plurals) meta.plurals = plurals
  const inline = cleanInlineTokens(value.inline)
  if (inline) meta.inline = inline
  return Object.keys(meta).length ? meta : null
}

/**
 * Document-level exchange metadata. Currently only PO obsolete entries are
 * preserved as raw blocks so export can round-trip them without treating them
 * as active translation segments.
 */
export function cleanFormatMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const meta = {}
  const obsolete = cleanStringList(value.poObsolete, 200, 5000)
  if (obsolete) meta.poObsolete = obsolete
  if (typeof value.jsonTemplate === 'string' && value.jsonTemplate.length <= 8 * 1024 * 1024) {
    meta.jsonTemplate = value.jsonTemplate
  }
  return Object.keys(meta).length ? meta : null
}

export function restoreSettings(raw) {
  const settings = structuredClone(DEFAULT_SETTINGS)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return settings
  try {
    if (String(raw.sourceLang ?? '').trim()) {
      settings.sourceLang = restoredLang(raw.sourceLang, settings.sourceLang)
    }
    if (String(raw.targetLang ?? '').trim()) {
      settings.targetLang = restoredLang(raw.targetLang, settings.targetLang)
    }
    const threshold = Number(raw.fuzzyThreshold)
    if (Number.isFinite(threshold)) settings.fuzzyThreshold = clamp(threshold, 0, 1)
    const limit = Number(raw.tmLimit)
    if (Number.isFinite(limit)) settings.tmLimit = clampInt(limit, 1, 20, settings.tmLimit)
    const uiLang = String(raw.uiLang ?? '').trim().toLowerCase()
    if (UI_LANG_CODES.includes(uiLang)) settings.uiLang = uiLang
    settings.preprocess = normalizePreprocessOptions(raw.preprocess)

    if (raw.mt && typeof raw.mt === 'object' && !Array.isArray(raw.mt)) {
      const provider = String(raw.mt.provider ?? '').trim()
      if (provider) settings.mt.provider = provider.slice(0, 120)
      if (raw.mt.model !== undefined) settings.mt.model = String(raw.mt.model ?? '').trim().slice(0, 200)
      const temperature = Number(raw.mt.temperature)
      if (Number.isFinite(temperature)) settings.mt.temperature = clamp(temperature, 0, 2)
    }
    if (raw.review && typeof raw.review === 'object' && !Array.isArray(raw.review)) {
      settings.review.provider = String(raw.review.provider ?? '').trim().slice(0, 120)
      settings.review.model = String(raw.review.model ?? '').trim().slice(0, 200)
      const temperature = Number(raw.review.temperature)
      if (Number.isFinite(temperature)) settings.review.temperature = clamp(temperature, 0, 2)
    }
    return settings
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export function cleanLibraryName(value, fallback = 'Untitled library') {
  const name = String(value ?? '').replace(/[\r\n\t]/g, ' ').trim()
  if (name.length > 80) throw new CatError('INVALID_LIBRARY_NAME', '库名称不能超过 80 字符')
  return name || fallback
}

export function restoreLibraries(raw, idKey, defaultId, defaultName, entries) {
  const libraries = new Map()
  const add = (id, name, createdAt, updatedAt) => {
    if (typeof id !== 'string' || !id || libraries.has(id)) return
    libraries.set(id, {
      [idKey]: id,
      name: cleanLibraryName(name, id === defaultId ? defaultName : `${idKey === 'tmId' ? 'TM' : 'Glossary'} ${id}`),
      createdAt: restoredDate(createdAt),
      updatedAt: restoredDate(updatedAt),
    })
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      add(item[idKey], item.name, item.createdAt, item.updatedAt)
    }
  }
  if (!libraries.has(defaultId)) add(defaultId, defaultName)
  for (const entry of entries) {
    if (entry[idKey] && !libraries.has(entry[idKey])) add(entry[idKey])
  }

  const result = [...libraries.values()]
  const defaultIndex = result.findIndex((item) => item[idKey] === defaultId)
  if (defaultIndex > 0) result.unshift(result.splice(defaultIndex, 1)[0])
  return result
}

export function restoreMountIds(raw, libraries, idKey, fallbackId) {
  const valid = new Set(libraries.map((item) => item[idKey]))
  const requested = Array.isArray(raw) ? raw : []
  const unique = [...new Set(requested.filter((id) => typeof id === 'string' && valid.has(id)))]
  return unique.length ? unique : [fallbackId]
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
    const [source, target, note, lang, caseFlag, forbiddenFlag, preferredFlag] = cells.map((cell) => cell.trim())
    if (!source || !target) continue
    if (/^(source|term|原文|术语)$/i.test(source) && /^(target|translation|译文)$/i.test(target)) continue
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
