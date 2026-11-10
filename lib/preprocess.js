/**
 * Import-time preprocessing stage.
 *
 * Parsers keep the source roughly as authored: pasted documents often contain
 * non-breaking spaces, zero-width characters, CRLF line endings and stray
 * indentation. None of that is meaningful for translation memory or MT, but it
 * does leak into segments and makes matches fail. The stage is deliberately
 * conservative: it only touches characters that carry no linguistic meaning and
 * never rewrites punctuation, casing or inline placeholder tokens.
 */
export const DEFAULT_PREPROCESS = {
  normalizeWhitespace: true,
  stripInvisible: true,
  collapseBlankLines: true,
}

/* eslint-disable no-control-regex -- 这些控制字符正是要被清掉的目标 */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g
/* eslint-enable no-control-regex */

export function normalizePreprocessOptions(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    normalizeWhitespace:
      typeof source.normalizeWhitespace === 'boolean'
        ? source.normalizeWhitespace
        : DEFAULT_PREPROCESS.normalizeWhitespace,
    stripInvisible:
      typeof source.stripInvisible === 'boolean'
        ? source.stripInvisible
        : DEFAULT_PREPROCESS.stripInvisible,
    collapseBlankLines:
      typeof source.collapseBlankLines === 'boolean'
        ? source.collapseBlankLines
        : DEFAULT_PREPROCESS.collapseBlankLines,
  }
}

export function preprocessText(value, options = DEFAULT_PREPROCESS) {
  const config = normalizePreprocessOptions(options)
  let text = String(value ?? '')
  // Line endings carry no linguistic meaning and would otherwise split CRLF
  // imports into different segment fingerprints than the same text pasted in.
  text = text.replace(/\r\n?/g, '\n')
  if (config.stripInvisible) text = text.replace(INVISIBLE, '')
  if (config.normalizeWhitespace) {
    text = text
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
  }
  if (config.collapseBlankLines) text = text.replace(/\n{3,}/g, '\n\n')
  return config.normalizeWhitespace || config.collapseBlankLines ? text.trim() : text
}

/**
 * Apply the configured stage to parsed import segments. Inline tokens such as
 * `{1}` are untouched because they contain no whitespace or control characters.
 */
export function preprocessSegments(segments, options) {
  const config = normalizePreprocessOptions(options)
  return segments.map((segment) => {
    if (!segment || typeof segment !== 'object') return segment
    const source = preprocessText(segment.source, config)
    if (source === segment.source) return segment
    return { ...segment, source }
  })
}
