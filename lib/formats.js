/**
 * Dependency-free parsers/builders for the first-tier CAT exchange formats:
 * CSV, SRT, WebVTT, PO and a basic XLIFF 1.2 subset.
 *
 * These formats are intentionally shallow: inline markup is flattened to text,
 * complex subtitle styling and XLIFF extensions are not round-tripped. The
 * original source text is kept so the normal CAT/TM/glossary flow applies.
 */
import { CatError } from './errors.js'
import { decodeXml, escapeXml } from './xml.js'
import { parseHtmlBlocks, renderHtmlTokens } from './html.js'

const SRT_TIME = /^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/
const VTT_TIME = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})\.(\d{1,3})$/
const INLINE_XML = /<\/?(?:bpt|ept|ph|g|x|bx|ex|mrk|sub|hi|span)\b[^>]*>/gi
const INLINE_TOKEN = /\{(\d+)\}/g

function readXmlAttr(source, name) {
  const match = String(source ?? '').match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return match ? decodeXml(match[1]) : ''
}

/**
 * Convert XLIFF inline markup to stable {n} tokens while keeping the original
 * XML for export. This prevents <ph>, <bpt>/<ept> and <g> placeholders from
 * being silently dropped when a translation is written back.
 */
function extractInline(raw) {
  const tokens = []
  const text = String(raw ?? '').replace(INLINE_XML, (xml) => {
    const token = `{${tokens.length + 1}}`
    tokens.push({ token, xml })
    return token
  })
  return { text: decodeXml(text).trim(), tokens }
}

/** Render a tokenised string back to XML, escaping only the text portions. */
function renderInline(value, tokens) {
  const text = String(value ?? '')
  const map = new Map((Array.isArray(tokens) ? tokens : []).map((item) => [item.token, item.xml]))
  let output = ''
  let last = 0
  for (const match of text.matchAll(INLINE_TOKEN)) {
    output += escapeXml(text.slice(last, match.index))
    output += map.get(match[0]) ?? escapeXml(match[0])
    last = match.index + match[0].length
  }
  output += escapeXml(text.slice(last))
  return output
}

/** Tokens present in the source but missing from the target. */
export function missingInlineTokens(tokens, target) {
  if (!Array.isArray(tokens) || !tokens.length) return []
  const value = String(target ?? '')
  return tokens.map((item) => item.token).filter((token) => !value.includes(token))
}

/** Append placeholders the translator omitted, so export never silently loses them. */
function completeInline(value, tokens) {
  let output = String(value ?? '')
  for (const item of Array.isArray(tokens) ? tokens : []) {
    if (!output.includes(item.token))
      output += `${output && !/\s$/.test(output) ? ' ' : ''}${item.token}`
  }
  return output
}

export function detectCsvDelimiter(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '')
  const candidates = [',', ';', '\t', '|']
  const counts = new Map(candidates.map((candidate) => [candidate, 0]))
  let quoted = false
  let lines = 0

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        index += 1
        continue
      }
      quoted = !quoted
      continue
    }
    if (quoted) continue
    if (char === '\n') {
      lines += 1
      if (lines >= 5) break
      continue
    }
    if (counts.has(char)) counts.set(char, counts.get(char) + 1)
  }

  let best = ','
  let bestCount = 0
  for (const candidate of candidates) {
    if (counts.get(candidate) > bestCount) {
      best = candidate
      bestCount = counts.get(candidate)
    }
  }
  return best
}

export function parseCsvRows(text, delimiter = ',') {
  const input = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (quoted) throw new CatError('CSV_PARSE', 'CSV 引号未闭合。')
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export function parseCsv(text, { sourceColumn, targetColumn } = {}) {
  const delimiter = detectCsvDelimiter(text)
  const rows = parseCsvRows(text, delimiter)
  if (!rows.length) throw new CatError('CSV_PARSE', 'CSV 中没有可用的行。')

  const normalize = (value) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
  const sourceAliases = new Set(['source', 'src', 'original', '原文', '源文', '源文本'])
  const targetAliases = new Set([
    'target',
    'tgt',
    'translation',
    '译文',
    '目標',
    '目标',
    '目标文本',
  ])
  const first = rows[0].map(normalize)
  const hasHeader = first.some((value) => sourceAliases.has(value) || targetAliases.has(value))
  const resolveColumn = (rawValue, aliases, fallback) => {
    const value = String(rawValue ?? '').trim()
    if (!value) return fallback
    if (/^\d+$/.test(value)) {
      const index = Number(value) - 1
      if (index < 0) throw new CatError('CSV_PARSE', 'CSV 列号从 1 开始。')
      return index
    }
    const index = first.findIndex((item) => item === value.toLowerCase())
    if (index < 0) throw new CatError('CSV_PARSE', `CSV 中找不到列“${value}”。`)
    return index
  }

  let sourceIndex = first.findIndex((value) => sourceAliases.has(value))
  let targetIndex = first.findIndex((value) => targetAliases.has(value))
  let start = 0

  if (sourceColumn !== undefined || targetColumn !== undefined) {
    sourceIndex = resolveColumn(sourceColumn, sourceAliases, sourceIndex >= 0 ? sourceIndex : 0)
    targetIndex = resolveColumn(targetColumn, targetAliases, targetIndex)
    start = hasHeader ? 1 : 0
  } else if (sourceIndex >= 0 && targetIndex >= 0) {
    start = 1
  } else {
    sourceIndex = 0
    targetIndex = rows[0].length > 1 ? 1 : -1
  }

  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0)
  if (sourceIndex < 0 || sourceIndex >= maxColumns) {
    throw new CatError('CSV_PARSE', 'CSV 源文列不存在。')
  }
  if (targetIndex >= maxColumns) {
    throw new CatError('CSV_PARSE', 'CSV 译文列不存在。')
  }

  const segments = []
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index]
    const source = String(row[sourceIndex] ?? '').trim()
    if (!source) continue
    const target = targetIndex >= 0 ? String(row[targetIndex] ?? '').trim() : ''
    segments.push({
      source,
      target,
      paragraph: segments.length,
      meta: { format: 'csv' },
    })
  }

  if (!segments.length) throw new CatError('CSV_NO_UNITS', 'CSV 中没有可用的源文行。')
  return { format: 'csv', segments, warnings: [] }
}

function parseSrtTime(value) {
  const match = String(value).trim().match(SRT_TIME)
  if (!match) return null
  const [, hours, minutes, seconds, millis] = match
  return (
    Number(hours) * 3600000 +
    Number(minutes) * 60000 +
    Number(seconds) * 1000 +
    Number(millis.padEnd(3, '0'))
  )
}

export function formatSrtTime(milliseconds) {
  const total = Math.max(0, Math.round(Number(milliseconds) || 0))
  const hours = Math.floor(total / 3600000)
  const minutes = Math.floor((total % 3600000) / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const millis = total % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

function stripSubtitleMarkup(value) {
  const assOverrides = String(value).match(/\{\\[^}]+\}/g) ?? []
  return {
    // Semantic tags such as <i>, <b>, <font> and WebVTT <c>/<v>/<ruby> are
    // meaningful translation content and stay in the string verbatim.
    text: decodeXml(
      String(value)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/\{\\[^}]+\}/g, ''),
    ),
    count: assOverrides.length,
  }
}

function parseSubtitleBlocks(text, kind) {
  const input = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim()
  if (!input)
    throw new CatError(`${kind.toUpperCase()}_PARSE`, `${kind.toUpperCase()} 文件内容为空。`)

  const blocks = input.split(/\n{2,}/)
  const segments = []
  const warnings = []
  let markupCount = 0

  for (const block of blocks) {
    const lines = block.split('\n')
    if (!lines.length) continue
    let cursor = 0
    if (lines[0].trim().toUpperCase().startsWith('WEBVTT')) {
      lines.shift()
      while (lines.length && !lines[0].trim()) lines.shift()
      if (!lines.length) continue
    }
    if (
      lines[0].trim().startsWith('NOTE') ||
      lines[0].trim().startsWith('STYLE') ||
      lines[0].trim().startsWith('REGION')
    )
      continue

    let identifier = ''
    if (!lines[cursor].includes('-->')) {
      identifier = lines[cursor].trim()
      cursor += 1
    }
    if (!lines[cursor]?.includes('-->')) continue
    const timing = lines[cursor].trim()
    cursor += 1

    const timingMatch = timing.match(/^(\S+)\s*-->\s*(\S+)(.*)$/)
    if (!timingMatch) {
      throw new CatError(`${kind.toUpperCase()}_PARSE`, `字幕时间轴无效: ${timing}`)
    }
    const start = kind === 'srt' ? parseSrtTime(timingMatch[1]) : parseVttTime(timingMatch[1])
    const end = kind === 'srt' ? parseSrtTime(timingMatch[2]) : parseVttTime(timingMatch[2])
    if (start === null || end === null) {
      throw new CatError(`${kind.toUpperCase()}_PARSE`, `字幕时间轴无效: ${timing}`)
    }
    if (end <= start) {
      throw new CatError(`${kind.toUpperCase()}_PARSE`, `字幕结束时间必须晚于开始时间: ${timing}`)
    }

    const rawText = lines.slice(cursor).join('\n').trim()
    if (!rawText) continue
    const stripped = stripSubtitleMarkup(rawText)
    markupCount += stripped.count
    const text = stripped.text.trim()
    if (!text) continue
    segments.push({
      source: text,
      target: '',
      paragraph: segments.length,
      meta: {
        format: kind,
        start,
        end,
        settings: timingMatch[3].trim(),
        identifier,
      },
    })
  }

  if (!segments.length)
    throw new CatError(`${kind.toUpperCase()}_NO_UNITS`, `${kind.toUpperCase()} 中没有可用的字幕。`)
  if (markupCount) {
    warnings.push({
      code: `${kind.toUpperCase()}_INLINE_MARKUP_LOST`,
      count: markupCount,
      message: `${kind.toUpperCase()} 含 ${markupCount} 个 ASS 样式覆盖标记（{\\...}），导入时已移除；语义标签已保留。`,
    })
  }
  return { format: kind, segments, warnings }
}

export function parseSrt(text) {
  return parseSubtitleBlocks(text, 'srt')
}

function parseVttTime(value) {
  const match = String(value).trim().match(VTT_TIME)
  if (!match) return null
  const [, hours, minutes, seconds, millis] = match
  return (
    Number(hours || 0) * 3600000 +
    Number(minutes) * 60000 +
    Number(seconds) * 1000 +
    Number(millis.padEnd(3, '0'))
  )
}

export function formatVttTime(milliseconds) {
  const total = Math.max(0, Math.round(Number(milliseconds) || 0))
  const hours = Math.floor(total / 3600000)
  const minutes = Math.floor((total % 3600000) / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const millis = total % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

export function parseVtt(text) {
  return parseSubtitleBlocks(text, 'vtt')
}

function subtitleText(segment) {
  return String(segment.target || segment.source || '').trim()
}

function cueTimes(segment, fallbackStart) {
  const start = Number(segment.meta?.start)
  const end = Number(segment.meta?.end)
  if (Number.isFinite(start) && start >= 0 && Number.isFinite(end) && end > start) {
    return { start, end }
  }
  // Text-only documents (and any cue without usable timing metadata) start
  // where the previous cue ended. This avoids the old index * 2000 fallback
  // overlapping an explicitly timed cue that sits earlier in the document.
  const safeStart = Number.isFinite(start) && start >= 0 ? start : fallbackStart
  return { start: safeStart, end: safeStart + 2000 }
}

function buildCues(segments) {
  let cursor = 0
  return segments.map((segment) => {
    const times = cueTimes(segment, cursor)
    cursor = Math.max(cursor, times.end)
    return { segment, times }
  })
}

export function buildSrt(doc) {
  return buildCues(doc.segments)
    .map(({ segment, times }, index) =>
      [
        String(index + 1),
        `${formatSrtTime(times.start)} --> ${formatSrtTime(times.end)}`,
        subtitleText(segment),
        '',
      ].join('\n'),
    )
    .join('\n')
}

export function buildVtt(doc) {
  const cues = buildCues(doc.segments).map(({ segment, times }) => {
    const identifier = segment.meta?.identifier ? `${segment.meta.identifier}\n` : ''
    const settings = segment.meta?.settings ? ` ${segment.meta.settings}` : ''
    return `${identifier}${formatVttTime(times.start)} --> ${formatVttTime(times.end)}${settings}\n${subtitleText(segment)}\n`
  })
  return `WEBVTT\n\n${cues.join('\n')}`
}

function parsePoQuoted(raw) {
  const match = String(raw)
    .trim()
    .match(/^"((?:\\.|[^"\\])*)"$/)
  if (!match) return null
  return match[1].replace(/\\(n|t|r|"|\\)/g, (all, char) => {
    if (char === 'n') return '\n'
    if (char === 't') return '\t'
    if (char === 'r') return '\r'
    return char
  })
}

function poField(line) {
  const match = line.match(/^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(.*)$/)
  if (!match) return null
  const value = parsePoQuoted(match[2])
  if (value === null) return null
  return { name: match[1], value }
}

export function parsePo(text) {
  const input = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
  if (!input.trim()) throw new CatError('PO_PARSE', 'PO 文件内容为空。')

  const segments = []
  const obsolete = []
  let entry = null
  let current = null
  let pendingComments = []
  let obsoleteBlock = null

  const flushObsolete = () => {
    if (!obsoleteBlock?.length) return
    const block = obsoleteBlock.join('\n').trimEnd()
    if (block) obsolete.push(block)
    obsoleteBlock = null
  }

  const flush = () => {
    if (!entry) return
    const source = String(entry.msgid ?? '').trim()
    if (source) {
      const msgidPlural = String(entry.msgid_plural ?? '').trim()
      const pluralKeys = Object.keys(entry.msgstr ?? {})
        .filter((key) => /^\d+$/.test(key))
        .sort((left, right) => Number(left) - Number(right))
      const plurals = pluralKeys
        .map((key) => String(entry.msgstr[key] ?? '').trim())
        .filter(Boolean)
      const target = String(entry.msgstr?.[''] ?? plurals[0] ?? '').trim()
      const comments = entry.comments.filter(Boolean)
      segments.push({
        source,
        target,
        paragraph: segments.length,
        meta: {
          format: 'po',
          context: String(entry.msgctxt ?? '').trim(),
          msgidPlural,
          plural: Boolean(msgidPlural),
          ...(comments.length ? { comments } : {}),
          ...(plurals.length ? { plurals } : {}),
        },
      })
    }
    entry = null
    current = null
  }

  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flush()
      flushObsolete()
      continue
    }
    if (line.startsWith('#~')) {
      if (!obsoleteBlock) {
        flush()
        obsoleteBlock = []
      }
      obsoleteBlock.push(rawLine.replace(/^#~\s?/, ''))
      continue
    }
    if (obsoleteBlock) {
      obsoleteBlock.push(rawLine)
      continue
    }
    if (line.startsWith('#')) {
      const comment = line.replace(/^#[.,:|\s]*/, '').trim()
      if (comment) {
        if (entry) entry.comments.push(comment)
        else pendingComments.push(comment)
      }
      continue
    }

    const field = poField(line)
    if (field) {
      entry ??= { msgstr: {}, comments: pendingComments.splice(0) }
      current = field.name
      if (current.startsWith('msgstr')) {
        entry.msgstr[current === 'msgstr' ? '' : (current.match(/\[(\d+)\]/)?.[1] ?? '0')] =
          field.value
      } else {
        entry[current] = field.value
      }
      continue
    }
    if (line.startsWith('"') && current) {
      const value = parsePoQuoted(line)
      if (value === null) continue
      if (current.startsWith('msgstr')) {
        const key = current === 'msgstr' ? '' : (current.match(/\[(\d+)\]/)?.[1] ?? '0')
        entry.msgstr[key] = `${entry.msgstr[key] ?? ''}${value}`
      } else {
        entry[current] = `${entry[current] ?? ''}${value}`
      }
    }
  }
  flush()
  flushObsolete()

  if (!segments.length) throw new CatError('PO_NO_UNITS', 'PO 中没有可用的 msgid/msgstr 条目。')
  return { format: 'po', segments, obsolete, warnings: [] }
}

function poEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
}

function poLine(field, value) {
  return `${field} "${poEscape(value)}"`
}

export function buildPo(doc) {
  const header = [
    'msgid ""',
    'msgstr ""',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    `"Language: ${doc.targetLang}\\n"`,
    '',
  ].join('\n')

  const entries = doc.segments.map((segment) => {
    const context = String(segment.meta?.context ?? '').trim()
    const plural = String(segment.meta?.msgidPlural ?? '').trim()
    const target = String(segment.target || segment.source || '').trim()
    const comments = Array.isArray(segment.meta?.comments) ? segment.meta.comments : []
    const lines = comments.filter(Boolean).map((comment) => `#. ${comment}`)
    if (context) lines.push(poLine('msgctxt', context))
    lines.push(poLine('msgid', segment.source))
    if (plural) {
      const forms = Array.isArray(segment.meta?.plurals) ? segment.meta.plurals : []
      lines.push(poLine('msgid_plural', plural))
      lines.push(poLine('msgstr[0]', target))
      for (let index = 1; index < Math.max(forms.length, 2); index += 1) {
        lines.push(poLine(`msgstr[${index}]`, forms[index] || target))
      }
    } else {
      lines.push(poLine('msgstr', target))
    }
    return lines.join('\n')
  })

  const obsolete = Array.isArray(doc.formatMeta?.poObsolete)
    ? doc.formatMeta.poObsolete
        .filter((block) => typeof block === 'string' && block.trim())
        .map((block) =>
          block
            .split('\n')
            .map((line) => `#~ ${line}`)
            .join('\n'),
        )
    : []

  const blocks = [...entries, ...obsolete].filter(Boolean)
  return `${header}\n${blocks.join('\n\n')}\n`
}

function parseXliffUnit(body, attrs, format, tokens) {
  const sourceMatch =
    body.match(/<(?:[\w.-]+:)?source\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?source>/i) ??
    body.match(/<(?:[\w.-]+:)?source\b[^>]*\/>/i)
  if (!sourceMatch) return null
  const sourceRaw = sourceMatch[1] ?? ''
  const source = extractInline(sourceRaw)
  if (!source.text) return null
  const targetMatch =
    body.match(/<(?:[\w.-]+:)?target\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?target>/i) ??
    body.match(/<(?:[\w.-]+:)?target\b[^>]*\/>/i)
  const target = targetMatch ? extractInline(targetMatch[1] ?? '').text : ''
  const targetTag = body.match(/<(?:[\w.-]+:)?target\b([^>]*)>/i)
  const targetState = targetTag?.[1] ? readXmlAttr(targetTag[1], 'state') : ''
  const caitUid = readXmlAttr(attrs, 'x-cait-uid')
  tokens.push(...source.tokens)
  return {
    source: source.text,
    target,
    paragraph: 0,
    meta: {
      format,
      xliffId: readXmlAttr(attrs, 'id'),
      ...(caitUid ? { caitUid } : {}),
      ...(targetState ? { targetState } : {}),
      ...(source.tokens.length ? { inline: source.tokens } : {}),
    },
  }
}

function parseXliff2(input, rootAttrs) {
  const sourceLang = readXmlAttr(rootAttrs, 'srcLang') || readXmlAttr(rootAttrs, 'source-language')
  const targetLang = readXmlAttr(rootAttrs, 'trgLang') || readXmlAttr(rootAttrs, 'target-language')
  const units = []
  const inlineTokens = []
  const unitRe = /<(?:[\w.-]+:)?unit\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?unit>/gi
  let match
  while ((match = unitRe.exec(input))) {
    const unit = parseXliffUnit(match[2], match[1], 'xliff2', inlineTokens)
    if (!unit) continue
    unit.paragraph = units.length
    units.push(unit)
  }
  if (!units.length) throw new CatError('XLIFF_NO_UNITS', 'XLIFF 中没有可用的 unit/segment。')
  return { format: 'xliff2', sourceLang, targetLang, segments: units, warnings: [] }
}

export function parseXliff(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '')
  if (!input.trim()) throw new CatError('XLIFF_PARSE', 'XLIFF 文件内容为空。')

  const rootTag = input.match(/<((?:[\w.-]+:)?xliff)\b([^>]*)>/i)
  const rootAttrs = rootTag?.[2] ?? ''
  const version = readXmlAttr(rootAttrs, 'version')
  const looksLikeXliff2 =
    /^2\./i.test(version) ||
    (!/<(?:[\w.-]+:)?trans-unit\b/i.test(input) && /<(?:[\w.-]+:)?unit\b/i.test(input))
  if (looksLikeXliff2) return parseXliff2(input, rootAttrs)

  const fileTag = input.match(/<((?:[\w.-]+:)?file)\b([^>]*)>/i)
  const sourceLang = readXmlAttr(fileTag?.[2], 'source-language')
  const targetLang = readXmlAttr(fileTag?.[2], 'target-language')

  const units = []
  const unitRe = /<(?:[\w.-]+:)?trans-unit\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?trans-unit>/gi
  let match
  while ((match = unitRe.exec(input))) {
    const unit = parseXliffUnit(match[2], match[1], 'xliff', [])
    if (!unit) continue
    unit.paragraph = units.length
    units.push(unit)
  }

  if (!units.length) throw new CatError('XLIFF_NO_UNITS', 'XLIFF 中没有可用的 trans-unit。')
  return { format: 'xliff', sourceLang, targetLang, segments: units, warnings: [] }
}

export function buildXliff(doc) {
  const units = doc.segments.map((segment, index) => {
    const id = String(segment.meta?.xliffId || index + 1)
    const tokens = Array.isArray(segment.meta?.inline) ? segment.meta.inline : []
    const target = completeInline(segment.target || segment.source, tokens)
    return [
      `      <trans-unit id="${escapeXml(id)}">`,
      `        <source xml:lang="${escapeXml(doc.sourceLang)}">${renderInline(segment.source, tokens)}</source>`,
      `        <target xml:lang="${escapeXml(doc.targetLang)}">${renderInline(target, tokens)}</target>`,
      '      </trans-unit>',
    ].join('\n')
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xliff version="1.2">',
    `  <file source-language="${escapeXml(doc.sourceLang)}" target-language="${escapeXml(doc.targetLang)}" datatype="plaintext" original="${escapeXml(doc.name)}">`,
    '    <body>',
    ...units,
    '    </body>',
    '  </file>',
    '</xliff>',
    '',
  ].join('\n')
}

export function buildXliffReview(doc) {
  const units = doc.segments.map((segment, index) => {
    const id = String(segment.uid || segment.meta?.xliffId || index + 1)
    const tokens = Array.isArray(segment.meta?.inline) ? segment.meta.inline : []
    const target = completeInline(segment.target || '', tokens)
    const state = segment.confirmedAt ? 'final' : segment.target ? 'translated' : 'new'
    const note = segment.confirmedAt
      ? 'confirmed'
      : segment.origin
        ? `origin: ${segment.origin}`
        : ''
    return [
      `      <trans-unit id="${escapeXml(id)}" x-cait-uid="${escapeXml(segment.uid || id)}">`,
      `        <source xml:lang="${escapeXml(doc.sourceLang)}">${renderInline(segment.source, tokens)}</source>`,
      `        <target xml:lang="${escapeXml(doc.targetLang)}" state="${state}">${renderInline(target, tokens)}</target>`,
      ...(note ? [`        <note from="cait">${escapeXml(note)}</note>`] : []),
      '      </trans-unit>',
    ].join('\n')
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xliff version="1.2">',
    `  <file source-language="${escapeXml(doc.sourceLang)}" target-language="${escapeXml(doc.targetLang)}" datatype="plaintext" original="${escapeXml(doc.name)}">`,
    '    <body>',
    ...units,
    '    </body>',
    '  </file>',
    '</xliff>',
    '',
  ].join('\n')
}

export function buildXliff2(doc) {
  const units = doc.segments.map((segment, index) => {
    const id = String(segment.meta?.xliffId || index + 1)
    const tokens = Array.isArray(segment.meta?.inline) ? segment.meta.inline : []
    const target = completeInline(segment.target || segment.source, tokens)
    return [
      `    <unit id="${escapeXml(id)}">`,
      '      <segment>',
      `        <source>${renderInline(segment.source, tokens)}</source>`,
      `        <target>${renderInline(target, tokens)}</target>`,
      '      </segment>',
      '    </unit>',
    ].join('\n')
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0"',
    `  srcLang="${escapeXml(doc.sourceLang)}" trgLang="${escapeXml(doc.targetLang)}">`,
    '  <file id="f1">',
    ...units,
    '  </file>',
    '</xliff>',
    '',
  ].join('\n')
}

export function parseHtml(text) {
  const input = String(text ?? '')
  if (!input.trim()) throw new CatError('HTML_PARSE', 'HTML 文件内容为空。')
  const { runs } = parseHtmlBlocks(input)
  if (!runs.length) throw new CatError('HTML_NO_UNITS', 'HTML 中没有可用的正文。')
  const segments = runs.map((run, index) => ({
    source: run.text,
    target: '',
    paragraph: index,
    meta: {
      format: 'html',
      ...(run.tokens.length ? { inline: run.tokens } : {}),
    },
  }))
  return { format: 'html', segments, warnings: [] }
}

function renderHtmlSegment(segment) {
  const tokens = Array.isArray(segment?.meta?.inline) ? segment.meta.inline : []
  let value = String(segment?.target || segment?.source || '')
  if (tokens.length && tokens.some((item) => !value.includes(item.token))) {
    value = String(segment?.source ?? '')
  }
  return tokens.length ? renderHtmlTokens(value, tokens) : escapeXml(value)
}

export function buildHtml(doc) {
  const groups = new Map()
  for (const segment of doc.segments) {
    const key = segment.paragraph ?? 0
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(segment)
  }
  const paragraphs = [...groups.values()]
    .map((parts) =>
      parts
        .map((segment) => renderHtmlSegment(segment).trim())
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
    .map((text) => `  <p>${text}</p>`)
    .join('\n')
  return [
    '<!doctype html>',
    '<html lang="' + escapeXml(doc.targetLang || 'en') + '">',
    '<head><meta charset="utf-8"><title>' +
      escapeXml(doc.name || 'CAIT export') +
      '</title></head>',
    '<body>',
    paragraphs,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function escapeJsonPointer(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1')
}

function unescapeJsonPointer(value) {
  return String(value).replace(/~1/g, '/').replace(/~0/g, '~')
}

function walkJsonStrings(value, pointer, visit) {
  if (typeof value === 'string') {
    visit(value, pointer)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJsonStrings(item, `${pointer}/${index}`, visit))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      walkJsonStrings(item, `${pointer}/${escapeJsonPointer(key)}`, visit)
    }
  }
}

function setJsonPointer(root, pointer, value) {
  const parts = String(pointer).split('/').slice(1).map(unescapeJsonPointer)
  if (!parts.length) return value
  let current = root
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (current == null) throw new Error('JSON path does not exist')
    current = current[parts[index]]
  }
  if (current == null) throw new Error('JSON path does not exist')
  current[parts[parts.length - 1]] = value
  return root
}

export function parseJson(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '')
  if (!input.trim()) throw new CatError('JSON_PARSE', 'JSON 文件内容为空。')
  let root
  try {
    root = JSON.parse(input)
  } catch (error) {
    throw new CatError('JSON_PARSE', `JSON 解析失败: ${error.message}`)
  }
  const segments = []
  walkJsonStrings(root, '', (source, pointer) => {
    if (!source.trim()) return
    segments.push({
      source,
      target: '',
      paragraph: segments.length,
      meta: { format: 'json', jsonPath: pointer },
    })
  })
  if (!segments.length) throw new CatError('JSON_NO_UNITS', 'JSON 中没有可翻译的字符串。')
  return {
    format: 'json',
    segments,
    formatMeta: { jsonTemplate: JSON.stringify(root) },
    warnings: [],
  }
}

export function buildJson(doc) {
  let root
  try {
    root = doc.formatMeta?.jsonTemplate ? JSON.parse(doc.formatMeta.jsonTemplate) : {}
  } catch {
    root = {}
  }
  for (const segment of doc.segments) {
    const pointer = segment.meta?.jsonPath
    if (!pointer) continue
    const text = String(segment.target || segment.source || '')
    setJsonPointer(root, pointer, text)
  }
  return `${JSON.stringify(root, null, 2)}\n`
}

const RTF_DESTINATION_GROUP =
  /\{\\\*?\\?(?:fonttbl|colortbl|stylesheet|info|pict|header|footer|object|themedata|colorschememapping|datastore|latentstyles|rsidtbl|generator|xmlnstbl)\b[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi

function rtfUnicode(code) {
  const value = Number(code)
  return String.fromCharCode(value < 0 ? value + 65536 : value)
}

export function parseRtf(text) {
  let input = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
  if (!input.trim()) throw new CatError('RTF_PARSE', 'RTF 文件内容为空。')
  if (!input.trimStart().startsWith('{\\rtf')) {
    throw new CatError('RTF_PARSE', 'RTF 文件缺少 {\\rtf 头。')
  }
  let previous
  do {
    previous = input
    input = input.replace(RTF_DESTINATION_GROUP, '')
  } while (previous !== input)

  let output = ''
  let index = 0
  let unicodeSkip = 1
  while (index < input.length) {
    const char = input[index]
    if (char === '{' || char === '}') {
      index += 1
      continue
    }
    if (char !== '\\') {
      output += char
      index += 1
      continue
    }
    const next = input[index + 1]
    if (next === '\\' || next === '{' || next === '}') {
      output += next
      index += 2
      continue
    }
    if (next === "'") {
      const hex = input.slice(index + 2, index + 4)
      if (!/^[0-9a-f]{2}$/i.test(hex)) throw new CatError('RTF_PARSE', 'RTF 十六进制转义无效。')
      output += Buffer.from([Number.parseInt(hex, 16)]).toString('latin1')
      index += 4
      continue
    }
    if (next === '*') {
      index += 2
      continue
    }
    if (next === '~') {
      output += ' '
      index += 2
      continue
    }
    if (next === '_') {
      output += '-'
      index += 2
      continue
    }
    let cursor = index + 1
    let sign = 1
    if (input[cursor] === '-') {
      sign = -1
      cursor += 1
    }
    const wordStart = cursor
    while (/[a-z]/i.test(input[cursor] ?? '')) cursor += 1
    const word = input.slice(wordStart, cursor).toLowerCase()
    const numberStart = cursor
    while (/\d/.test(input[cursor] ?? '')) cursor += 1
    const number = input.slice(numberStart, cursor)
    if (input[cursor] === ' ') cursor += 1
    index = cursor
    if (!word) continue
    const value = number ? sign * Number(number) : null
    if (word === 'par') output += '\n\n'
    else if (word === 'line') output += '\n'
    else if (word === 'tab') output += '\t'
    else if (word === 'cell') output += '\t'
    else if (word === 'row') output += '\n'
    else if (word === 'page' || word === 'sect') output += '\n\n'
    else if (word === 'emdash') output += '—'
    else if (word === 'endash') output += '–'
    else if (word === 'bullet') output += '•'
    else if (word === 'lquote' || word === 'rquote') output += "'"
    else if (word === 'ldblquote' || word === 'rdblquote') output += '"'
    else if (word === 'uc' && value !== null) unicodeSkip = Math.max(0, value)
    else if (word === 'u' && value !== null) {
      output += rtfUnicode(value)
      let skip = unicodeSkip
      while (skip > 0 && index < input.length) {
        index += 1
        skip -= 1
      }
    } else if (word === 'bin' && value !== null && value > 0) {
      index += value
    }
  }

  const segments = output
    .split(/\n{2,}/)
    .map((part) => part.replace(/^\n+|\n+$/g, '').trim())
    .filter(Boolean)
    .map((source, paragraph) => ({
      source,
      target: '',
      paragraph,
      meta: { format: 'rtf' },
    }))
  if (!segments.length) throw new CatError('RTF_NO_UNITS', 'RTF 中没有可用的正文。')
  return { format: 'rtf', segments, warnings: [] }
}

function escapeRtf(value) {
  let output = ''
  for (const char of String(value)) {
    const code = char.codePointAt(0)
    if (char === '\\' || char === '{' || char === '}') output += `\\${char}`
    else if (char === '\n') output += '\\line '
    else if (char === '\t') output += '\\tab '
    else if (code >= 0x20 && code < 0x7f) output += char
    else if (code <= 0xffff) output += `\\u${code}?`
    else {
      const high = Math.floor((code - 0x10000) / 0x400) + 0xd800
      const low = ((code - 0x10000) % 0x400) + 0xdc00
      output += `\\u${high}?\\u${low}?`
    }
  }
  return output
}

export function buildRtf(doc) {
  const groups = new Map()
  for (const segment of doc.segments) {
    const key = segment.paragraph ?? 0
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(String(segment.target || segment.source || '').trim())
  }
  const body = [...groups.values()]
    .map((parts) => parts.filter(Boolean).join(' '))
    .filter(Boolean)
    .map((text) => `\\pard\\f0\\fs22 ${escapeRtf(text)}\\par`)
    .join('\n')
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\viewkind4\\uc1\n${body}\n}\n`
}
