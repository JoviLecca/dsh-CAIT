/**
 * Context fingerprints for translation-memory entries.
 *
 * A translation unit is often ambiguous without its neighbours: "Close" is a
 * button in one document and a menu entry in another. Mainstream CAT tools solve
 * this by storing the surrounding segments with every unit and giving an exact
 * context match a score above 100% (ICE).
 *
 * CAIT keeps the two neighbouring *source* segments, normalises them, and
 * reduces them to a short FNV-1a hash used for indexing. The plain text is kept
 * next to the hash so the review pane can show what the context was.
 */

import { normalizeText } from './similarity.js'

export const CONTEXT_SEPARATOR = '\u0001'

/** 32-bit FNV-1a, hex. Not a security primitive — only an index key. */
export function fnv1a(value) {
  let hash = 0x811c9dc5
  const text = String(value ?? '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Normalise a `{prev, next}` pair; an empty pair is not a context at all. */
export function normalizeContext(context) {
  if (!context || typeof context !== 'object') return null
  const prev = normalizeText(context.prev)
  const next = normalizeText(context.next)
  if (!prev && !next) return null
  return { prev, next }
}

export function contextHashOf(context) {
  const normalized = normalizeContext(context)
  if (!normalized) return null
  return fnv1a(`${normalized.prev}${CONTEXT_SEPARATOR}${normalized.next}`)
}

/**
 * Context of one segment: adjacent source text only. Translations are
 * deliberately ignored — editing a neighbour must not invalidate a match.
 * A single-segment document has no context (`null`), so it can never score 101%.
 */
export function contextOf(doc, index) {
  const segments = doc?.segments ?? []
  const position = Math.trunc(Number(index))
  if (!Number.isInteger(position) || position < 0 || position >= segments.length) return null
  const prev = position > 0 ? segments[position - 1]?.source ?? '' : ''
  const next = position < segments.length - 1 ? segments[position + 1]?.source ?? '' : ''
  return normalizeContext({ prev, next })
}

/** `<prop type="x-context">` payload: prev, separator, next. */
export function contextToProp(context) {
  const normalized = normalizeContext(context)
  if (!normalized) return ''
  return `${normalized.prev}${CONTEXT_SEPARATOR}${normalized.next}`
}

export function contextFromProp(value) {
  const text = String(value ?? '')
  if (!text.trim()) return null
  const cut = text.indexOf(CONTEXT_SEPARATOR)
  if (cut < 0) return normalizeContext({ prev: text, next: '' })
  return normalizeContext({ prev: text.slice(0, cut), next: text.slice(cut + CONTEXT_SEPARATOR.length) })
}
