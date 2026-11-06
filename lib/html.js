/**
 * Dependency-free HTML/XHTML block scanner shared by the HTML and EPUB
 * adapters.
 *
 * A real DOM is unnecessary for CAT import: what matters is a stable mapping
 * between translatable inline runs and exact byte ranges of the source file.
 * The scanner records contiguous runs between block-level elements, so export
 * can replace exactly those ranges while leaving structure, attributes,
 * scripts and styles untouched.
 */
import { decodeXml, escapeXml } from './xml.js'

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
])

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'dd', 'details',
  'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html',
  'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

const SKIP_TAGS = new Set([
  'canvas', 'head', 'iframe', 'math', 'noscript', 'object', 'rp', 'rt',
  'script', 'style', 'svg', 'template',
])

const TAG_PATTERN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g

function parseAttributes(source) {
  const attrs = {}
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let match
  while ((match = pattern.exec(String(source ?? '')))) {
    const name = match[1].toLowerCase()
    attrs[name] = decodeXml(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attrs
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findClosingTag(html, tag, from) {
  const pattern = new RegExp(`</${escapeRegExp(tag)}\\s*>`, 'ig')
  pattern.lastIndex = from
  const match = pattern.exec(html)
  return match ? { start: match.index, end: match.index + match[0].length } : null
}

function isHidden(node) {
  const attrs = node.attrs || {}
  if (Object.prototype.hasOwnProperty.call(attrs, 'hidden')) return true
  if (String(attrs['aria-hidden'] || '').toLowerCase() === 'true') return true
  if (/\bdisplay\s*:\s*none\b/i.test(attrs.style || '')) return true
  return false
}

/**
 * Tokenise inline markup into stable {n} placeholders so tags survive
 * translation and export can restore them verbatim.
 */
export function tokenizeHtml(raw, { preformatted = false } = {}) {
  const tokens = []
  const stripped = String(raw ?? '').replace(
    /<!--[\s\S]*?-->|<\/?[A-Za-z][\w:.-]*(?:"[^"]*"|'[^']*'|[^>"'])*?\/?>/g,
    (xml) => {
      if (xml.startsWith('<!--')) return ''
      const token = `{${tokens.length + 1}}`
      tokens.push({ token, xml })
      return token
    },
  )
  let text = decodeXml(stripped).replace(/\r\n?/g, '\n')
  if (preformatted) {
    text = text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/^\n+|\n+$/g, '')
  } else {
    text = text.replace(/\s+/g, ' ')
  }
  return { text: text.trim(), tokens }
}

/** Render a tokenised string back to HTML, escaping only text portions. */
export function renderHtmlTokens(value, tokens) {
  const text = String(value ?? '')
  const map = new Map((Array.isArray(tokens) ? tokens : []).map((item) => [item.token, item.xml]))
  const tokenPattern = /\{(\d+)\}/g
  let output = ''
  let last = 0
  for (const match of text.matchAll(tokenPattern)) {
    output += escapeXml(text.slice(last, match.index))
    output += map.get(match[0]) ?? escapeXml(match[0])
    last = match.index + match[0].length
  }
  output += escapeXml(text.slice(last))
  return output
}

/** Plain-text view of an HTML fragment (used for metadata and fallbacks). */
export function htmlFragmentToText(raw) {
  return decodeXml(
    String(raw ?? '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|noscript|head)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6]|section|article|blockquote|pre|tr)>/gi, '\n\n')
      .replace(/<\/(?:td|th)>/gi, '\t')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseTree(html) {
  const root = { type: 'element', tag: '#document', attrs: {}, children: [] }
  const stack = [root]
  let cursor = 0

  const closeTo = (depth, closeStart, end) => {
    while (stack.length > depth) {
      const node = stack.pop()
      node.closeStart = closeStart
      node.end = end
    }
  }

  TAG_PATTERN.lastIndex = 0
  let match
  while ((match = TAG_PATTERN.exec(html))) {
    if (match.index > cursor) {
      stack[stack.length - 1].children.push({
        type: 'text',
        start: cursor,
        end: match.index,
      })
    }
    cursor = match.index + match[0].length
    if (!match[2]) continue

    const rawTag = match[2]
    const tag = rawTag.toLowerCase()
    if (match[1] === '/') {
      let depth = stack.length - 1
      while (depth > 0 && stack[depth].tag !== tag) depth -= 1
      if (depth > 0) closeTo(depth, match.index, cursor)
      continue
    }

    const node = {
      type: 'element',
      tag,
      attrs: parseAttributes(match[3]),
      children: [],
      start: match.index,
      openEnd: cursor,
      closeStart: null,
      end: null,
    }
    stack[stack.length - 1].children.push(node)

    if (match[4] === '/' || VOID_TAGS.has(tag)) {
      node.closeStart = cursor
      node.end = cursor
      continue
    }

    if (SKIP_TAGS.has(tag)) {
      const close = findClosingTag(html, rawTag, cursor)
      node.closeStart = close ? close.start : html.length
      node.end = close ? close.end : html.length
      cursor = node.end
      TAG_PATTERN.lastIndex = cursor
      continue
    }

    stack.push(node)
  }

  if (cursor < html.length) {
    stack[stack.length - 1].children.push({ type: 'text', start: cursor, end: html.length })
  }
  closeTo(1, html.length, html.length)
  return root
}

function collectRuns(html, root) {
  const runs = []

  const walk = (node) => {
    let runStart = null
    let runEnd = null
    const preformatted = node.tag === 'pre'

    const flush = () => {
      if (runStart === null) return
      const { text, tokens } = tokenizeHtml(html.slice(runStart, runEnd), { preformatted })
      if (text) {
        runs.push({ index: runs.length, start: runStart, end: runEnd, text, tokens })
      }
      runStart = null
      runEnd = null
    }

    for (const child of node.children) {
      if (child.type === 'text') {
        if (runStart !== null && child.start > runEnd) flush()
        if (runStart === null) runStart = child.start
        runEnd = child.end
        continue
      }
      if (SKIP_TAGS.has(child.tag) || isHidden(child)) {
        // Do not let a run span across skipped markup: patching the range
        // would otherwise delete the skipped element.
        flush()
        continue
      }
      if (BLOCK_TAGS.has(child.tag)) {
        flush()
        walk(child)
        continue
      }
      if (runStart !== null && child.start > runEnd) flush()
      if (runStart === null) runStart = child.start
      runEnd = child.end
    }
    flush()
  }

  walk(root)
  return runs
}

/**
 * Parse an HTML/XHTML document into ordered inline runs. `runs[n].start` and
 * `runs[n].end` index into the original string, which is what EPUB export
 * needs to patch translated text back without reserialising the document.
 */
export function parseHtmlBlocks(input) {
  // Keep the original string untouched: run offsets must index into the exact
  // bytes that EPUB export will patch later.
  const html = String(input ?? '')
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const root = parseTree(html)
  const runs = collectRuns(html, root)
  return {
    runs,
    title: titleMatch ? htmlFragmentToText(titleMatch[1]) : '',
    warnings: [],
  }
}

/** Replace run ranges with already-rendered HTML. */
export function patchHtmlRuns(html, replacements) {
  const source = String(html ?? '')
  const { runs } = parseHtmlBlocks(source)
  let output = ''
  let last = 0
  for (const run of runs) {
    if (!replacements.has(run.index)) continue
    if (run.start < last) continue
    output += source.slice(last, run.start)
    output += replacements.get(run.index)
    last = run.end
  }
  return output + source.slice(last)
}
