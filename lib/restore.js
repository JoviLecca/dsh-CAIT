import { MAX_SEGMENT_CHARS } from './limits.js'
import { cleanLibraryName, isIsoDate, now } from './text-utils.js'
import { normalizeReviewStatus } from './review-status.js'

const MAX_REVIEW_ROWS = 500
const SEVERITIES = ['high', 'medium', 'low']

export function restoredDate(value, fallback = now()) {
  return isIsoDate(value) ? new Date(value).toISOString() : fallback
}

/**
 * The stored AI review report. A damaged row is dropped rather than failing the
 * load: the report is advisory and can always be produced again.
 */
export function restoreReview(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.issues)) return null
  const issues = []
  for (const item of raw.issues) {
    if (!item || typeof item !== 'object') continue
    const index = Number(item.index)
    if (!Number.isInteger(index) || index < 0) continue
    const message = String(item.message ?? '')
      .replace(/\r\n?/g, '\n')
      .trim()
    if (!message) continue
    issues.push({
      index,
      severity: SEVERITIES.includes(item.severity) ? item.severity : 'medium',
      code: typeof item.code === 'string' ? item.code.slice(0, 40) : '',
      message: message.slice(0, 2000),
      suggestion: String(item.suggestion ?? '')
        .replace(/\r\n?/g, '\n')
        .slice(0, 4000),
      status: normalizeReviewStatus(item.status),
      at: restoredDate(item.at),
    })
    if (issues.length >= MAX_REVIEW_ROWS) break
  }
  if (!issues.length) return null
  // Stored rows are written sorted, but a hand-edited file must not change the
  // panel order after a reload.
  issues.sort(
    (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.index - b.index,
  )
  return { updatedAt: restoredDate(raw.updatedAt), issues }
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
  for (const key of [
    'start',
    'end',
    'xlsxRow',
    'pptxParagraph',
    'epubBlock',
    'docxParagraph',
    'table',
    'row',
    'cell',
    'sheet',
  ]) {
    const number = Number(value[key])
    if (Number.isFinite(number) && number >= 0) meta[key] = Math.round(number)
  }
  for (const key of [
    'settings',
    'identifier',
    'context',
    'msgidPlural',
    'xliffId',
    'format',
    'jsonPath',
    'pptxSlide',
    'epubHref',
    'docxPart',
    'keyPath',
    'icuType',
    'sheetName',
    'cell',
    'targetCell',
  ]) {
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
  const docxParts = cleanStringList(value.docxParts, 50, 200)
  if (docxParts) meta.docxParts = docxParts
  if (typeof value.jsonTemplate === 'string' && value.jsonTemplate.length <= 8 * 1024 * 1024) {
    meta.jsonTemplate = value.jsonTemplate
  }
  if (
    typeof value.localizationTemplate === 'string' &&
    value.localizationTemplate.length <= 8 * 1024 * 1024
  ) {
    meta.localizationTemplate = value.localizationTemplate
  }
  return Object.keys(meta).length ? meta : null
}

export function restoreLibraries(raw, idKey, defaultId, defaultName, entries) {
  const libraries = new Map()
  const add = (id, name, createdAt, updatedAt) => {
    if (typeof id !== 'string' || !id || libraries.has(id)) return
    libraries.set(id, {
      [idKey]: id,
      name: cleanLibraryName(
        name,
        id === defaultId ? defaultName : `${idKey === 'tmId' ? 'TM' : 'Glossary'} ${id}`,
      ),
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
