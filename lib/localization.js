/**
 * Key/value localization formats: Apple .strings/.stringsdict, Android
 * strings.xml, .resx, ARB, flat YAML and Java .properties.
 *
 * The parser keeps an AST in formatMeta.localizationTemplate and puts the
 * stable key on every segment. Export walks the AST again so comments, key
 * order and plural quantities survive a round trip. Inline XML markup is
 * tokenised into {n} placeholders and restored from segment.meta.inline.
 */
import { CatError } from './errors.js'
import { decodeXml, escapeXml } from './xml.js'

const KINDS = new Set([
  'apple-strings',
  'apple-stringsdict',
  'android',
  'resx',
  'arb',
  'yaml',
  'properties',
])

function normalizeKind(kind) {
  const value = String(kind ?? '')
    .trim()
    .toLowerCase()
  if (!KINDS.has(value))
    throw new CatError('LOCALIZATION_KIND_UNSUPPORTED', `不支持的本地化格式: ${kind}`)
  return value
}

function cdata(value) {
  return String(value ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

const INLINE_TAG = /<\/?(?:b|i|u|em|strong|font|a|br|span|xliff:g)\b[^>]*\/?>/gi

function extractInline(raw) {
  const tokens = []
  const text = String(raw ?? '').replace(INLINE_TAG, (xml) => {
    const token = `{${tokens.length + 1}}`
    tokens.push({ token, xml })
    return token
  })
  return { text: decodeXml(cdata(text)).trim(), tokens }
}

function renderInline(value, tokens) {
  const text = String(value ?? '')
  if (!Array.isArray(tokens) || !tokens.length) return escapeXml(cdata(text))
  const map = new Map(tokens.map((item) => [item.token, item.xml]))
  let output = ''
  let last = 0
  for (const match of text.matchAll(/\{(\d+)\}/g)) {
    output += escapeXml(text.slice(last, match.index))
    output += map.get(match[0]) ?? escapeXml(match[0])
    last = match.index + match[0].length
  }
  output += escapeXml(text.slice(last))
  return output
}

function pushSegment(segments, kind, key, value, extra = {}, comment = '') {
  const parsed = extractInline(value)
  if (!parsed.text) return
  const meta = {
    format: kind,
    identifier: key,
    keyPath: extra.keyPath || key,
    ...extra,
  }
  if (parsed.tokens.length) meta.inline = parsed.tokens
  if (comment) meta.comments = [String(comment).slice(0, 500)]
  segments.push({
    source: parsed.text,
    target: '',
    paragraph: segments.length,
    meta,
  })
}

function decodeEscape(value, kind) {
  if (kind === 'properties') {
    return String(value ?? '').replace(/\\(u[0-9a-fA-F]{4}|.)/g, (all, body) => {
      if (body[0] === 'u') return String.fromCharCode(Number.parseInt(body.slice(1), 16))
      if (body === 'n') return '\n'
      if (body === 't') return '\t'
      if (body === 'r') return '\r'
      return body
    })
  }
  return String(value ?? '')
}

function escapeProperties(value, isKey = false) {
  const escaped = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
  return isKey ? escaped.replace(/([=:])/g, '\\$1') : escaped
}

function escapeApple(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
}

function decodeApple(value) {
  return String(value ?? '').replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{4}|.)/g, (all, body) => {
    if (body[0] === 'u' || body[0] === 'U')
      return String.fromCharCode(Number.parseInt(body.slice(1), 16))
    if (body === 'n') return '\n'
    if (body === 't') return '\t'
    if (body === 'r') return '\r'
    return body
  })
}

function parseAppleStrings(text, kind = 'apple-strings') {
  const input = String(text ?? '').replace(/^\uFEFF/, '')
  if (!input.trim()) throw new CatError('LOCALIZATION_EMPTY', '文件内容为空。')
  const entries = []
  const segments = []
  let index = 0
  let pendingComment = ''

  const skipSpace = () => {
    while (index < input.length && /\s/.test(input[index])) index += 1
  }
  const readQuoted = () => {
    const quote = input[index]
    index += 1
    let value = ''
    while (index < input.length) {
      const char = input[index]
      if (char === '\\') {
        value += char
        index += 1
        if (index < input.length) value += input[index]
        index += 1
        continue
      }
      if (char === quote) {
        index += 1
        return value
      }
      value += char
      index += 1
    }
    throw new CatError('LOCALIZATION_PARSE', '字符串没有闭合引号。')
  }

  while (index < input.length) {
    skipSpace()
    if (index >= input.length) break
    if (input.startsWith('/*', index)) {
      const end = input.indexOf('*/', index + 2)
      if (end < 0) break
      pendingComment = input.slice(index + 2, end).trim()
      index = end + 2
      continue
    }
    if (input.startsWith('//', index)) {
      const end = input.indexOf('\n', index + 2)
      pendingComment = input.slice(index + 2, end < 0 ? input.length : end).trim()
      index = end < 0 ? input.length : end + 1
      continue
    }
    let key
    if (input[index] === '"') key = decodeApple(readQuoted())
    else {
      const start = index
      while (index < input.length && input[index] !== '=' && !/\s/.test(input[index])) index += 1
      key = input.slice(start, index).trim()
    }
    skipSpace()
    if (input[index] !== '=') {
      index += 1
      continue
    }
    index += 1
    skipSpace()
    let value
    if (input[index] === '"') value = decodeApple(readQuoted())
    else {
      const start = index
      while (index < input.length && input[index] !== ';') index += 1
      value = input.slice(start, index).trim()
    }
    skipSpace()
    if (input[index] === ';') index += 1
    if (!key) continue
    entries.push({ type: 'string', key, value, comment: pendingComment })
    pushSegment(segments, kind, key, value, {}, pendingComment)
    pendingComment = ''
  }
  if (!segments.length) throw new CatError('LOCALIZATION_NO_UNITS', '文件中没有可翻译的字符串。')
  return {
    format: kind,
    segments,
    formatMeta: { localizationTemplate: JSON.stringify({ kind, entries }) },
    warnings: [],
  }
}

function readAttr(source, name) {
  const match = String(source ?? '').match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return match ? decodeXml(match[1]) : ''
}

function parseAndroid(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '')
  if (!/<resources\b/i.test(input))
    throw new CatError('LOCALIZATION_PARSE', 'Android 字符串缺少 <resources> 根节点。')
  const entries = []
  const segments = []
  let pendingComment = ''
  const token = /<!--([\s\S]*?)-->|<\s*(string|plurals)\b([^>]*)>([\s\S]*?)<\/\s*\2\s*>/gi
  let match
  while ((match = token.exec(input))) {
    if (match[1] != null) {
      pendingComment = match[1].trim()
      continue
    }
    const type = match[2].toLowerCase()
    const attrs = match[3]
    const body = match[4]
    const key = readAttr(attrs, 'name')
    if (!key) continue
    const translatable = !/\btranslatable\s*=\s*["']false["']/i.test(attrs)
    if (type === 'string') {
      entries.push({
        type: 'string',
        key,
        value: body,
        comment: pendingComment,
        translatable,
      })
      if (translatable) pushSegment(segments, 'android', key, body, {}, pendingComment)
    } else {
      const items = []
      const itemPattern = /<\s*item\b([^>]*)>([\s\S]*?)<\/\s*item\s*>/gi
      let item
      while ((item = itemPattern.exec(body))) {
        const quantity = readAttr(item[1], 'quantity') || 'other'
        items.push({ quantity, value: item[2] })
        if (translatable) {
          pushSegment(
            segments,
            'android',
            key,
            item[2],
            {
              keyPath: `${key}#${quantity}`,
              context: quantity,
              plural: true,
              msgidPlural: key,
              icuType: 'quantity',
            },
            pendingComment,
          )
        }
      }
      entries.push({ type: 'plural', key, items, comment: pendingComment, translatable })
    }
    pendingComment = ''
  }
  if (!segments.length)
    throw new CatError('LOCALIZATION_NO_UNITS', 'Android 字符串中没有可翻译的文本。')
  return {
    format: 'android',
    segments,
    formatMeta: { localizationTemplate: JSON.stringify({ kind: 'android', entries }) },
    warnings: [],
  }
}

function parseResx(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '')
  const entries = []
  const segments = []
  const pattern = /<!--([\s\S]*?)-->|<data\b([^>]*)>([\s\S]*?)<\/data>/gi
  let pendingComment = ''
  let match
  while ((match = pattern.exec(input))) {
    if (match[1] != null) {
      pendingComment = match[1].trim()
      continue
    }
    const attrs = match[2]
    const body = match[3]
    const key = readAttr(attrs, 'name')
    if (!key) continue
    if (/\btype\s*=/.test(attrs)) continue
    const valueMatch = body.match(/<value>([\s\S]*?)<\/value>/i)
    if (!valueMatch) continue
    const commentMatch = body.match(/<comment>([\s\S]*?)<\/comment>/i)
    const comment = commentMatch ? decodeXml(cdata(commentMatch[1])).trim() : pendingComment
    entries.push({ type: 'string', key, value: valueMatch[1], comment })
    pushSegment(segments, 'resx', key, valueMatch[1], {}, comment)
    pendingComment = ''
  }
  if (!segments.length) throw new CatError('LOCALIZATION_NO_UNITS', '.resx 中没有可翻译的字符串。')
  return {
    format: 'resx',
    segments,
    formatMeta: { localizationTemplate: JSON.stringify({ kind: 'resx', entries }) },
    warnings: [],
  }
}

function parseArb(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '')
  let root
  try {
    root = JSON.parse(input)
  } catch (error) {
    throw new CatError('LOCALIZATION_PARSE', `ARB 解析失败: ${error.message}`)
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new CatError('LOCALIZATION_PARSE', 'ARB 根节点必须是对象。')
  }
  const segments = []
  const warnings = []
  for (const [key, value] of Object.entries(root)) {
    if (key.startsWith('@')) continue
    if (typeof value !== 'string') {
      warnings.push(`ARB 键 ${key} 不是字符串，已跳过。`)
      continue
    }
    pushSegment(segments, 'arb', key, value)
  }
  if (!segments.length) throw new CatError('LOCALIZATION_NO_UNITS', 'ARB 中没有可翻译的字符串。')
  return {
    format: 'arb',
    segments,
    formatMeta: { localizationTemplate: JSON.stringify({ kind: 'arb', data: root }) },
    warnings,
  }
}

function stripYamlQuote(value) {
  const text = String(value ?? '').trim()
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }
  if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") {
    return text.slice(1, -1).replace(/''/g, "'")
  }
  return text
}

function yamlValue(value) {
  const text = String(value ?? '')
  if (!text || /^[\s:#,[\]{}&*!|>'"%@`]/.test(text) || /:\s|#\s|\n/.test(text)) {
    return JSON.stringify(text)
  }
  return text
}

function yamlScalarText(raw) {
  let text = String(raw ?? '').trim()
  if (!text) return ''
  let quote = ''
  let escaped = false
  let cut = -1
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quote === '"') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' && (index === 0 || /\s/.test(text[index - 1]))) {
      cut = index
      break
    }
  }
  if (cut >= 0) text = text.slice(0, cut).trim()
  if (text.startsWith('&') || text.startsWith('*') || text === '<<') {
    throw new CatError('LOCALIZATION_YAML_UNSUPPORTED', '暂不支持 YAML 锚点、别名或 merge key。')
  }
  if (text.startsWith('{') || text.startsWith('[')) {
    throw new CatError('LOCALIZATION_YAML_UNSUPPORTED', '暂不支持 YAML flow 集合，请使用缩进块。')
  }
  return stripYamlQuote(text)
}

function yamlColon(text) {
  let quote = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ':' && (index === text.length - 1 || /\s/.test(text[index + 1]))) {
      return index
    }
  }
  return -1
}

function yamlIndent(line) {
  const spaces = String(line).match(/^ */)?.[0]?.length ?? 0
  if (String(line)[spaces] === '\t') {
    throw new CatError('LOCALIZATION_YAML_UNSUPPORTED', 'YAML 缩进不能使用 Tab。')
  }
  return spaces
}

function parseYamlBlock(text) {
  const input = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
  if (!input.trim()) throw new CatError('LOCALIZATION_EMPTY', '文件内容为空。')
  const lines = input.split('\n')
  let index = 0
  let pendingComments = []

  const skip = () => {
    while (index < lines.length) {
      const line = lines[index]
      if (!line.trim()) {
        index += 1
        continue
      }
      if (/^\s*#/.test(line)) {
        pendingComments.push(line.replace(/^\s*#\s?/, '').trim())
        index += 1
        continue
      }
      break
    }
  }

  const takeComment = () => {
    const comment = pendingComments.join('\n').trim()
    pendingComments = []
    return comment
  }

  const parseScalar = (raw, style = 'plain') => ({
    type: 'scalar',
    value: yamlScalarText(raw),
    style,
  })

  const parseBlockScalar = (parentIndent, header) => {
    const literal = header.startsWith('|')
    const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip'
    const collected = []
    let minIndent = Infinity
    while (index < lines.length) {
      const line = lines[index]
      if (!line.trim()) {
        collected.push('')
        index += 1
        continue
      }
      const indent = yamlIndent(line)
      if (indent <= parentIndent) break
      minIndent = Math.min(minIndent, indent)
      collected.push(line)
      index += 1
    }
    if (!collected.length) return parseScalar('', literal ? 'literal' : 'folded')
    const dedented = collected.map((line) => (line ? line.slice(minIndent) : '')).join('\n')
    let value = literal ? dedented : dedented.replace(/\n(?!\n)/g, ' ')
    if (chomp === 'strip') value = value.replace(/\n+$/, '')
    else if (chomp === 'clip') value = `${value.replace(/\n+$/, '')}\n`
    return { type: 'scalar', value, style: literal ? 'literal' : 'folded' }
  }

  const parseNode = (indent) => {
    skip()
    if (index >= lines.length) return parseScalar('')
    const line = lines[index]
    const actual = yamlIndent(line)
    if (actual < indent) return parseScalar('')
    if (actual > indent) {
      throw new CatError('LOCALIZATION_YAML_PARSE', `第 ${index + 1} 行缩进不一致。`)
    }
    const content = line.slice(indent)
    if (/^-(\s|$)/.test(content)) return parseSequence(indent)
    if (yamlColon(content) >= 0) return parseMapping(indent)
    index += 1
    return parseScalar(content)
  }

  const parseMapping = (indent) => {
    const entries = []
    while (index < lines.length) {
      skip()
      if (index >= lines.length) break
      const line = lines[index]
      const actual = yamlIndent(line)
      if (actual < indent) break
      if (actual > indent) {
        throw new CatError('LOCALIZATION_YAML_PARSE', `第 ${index + 1} 行缩进不一致。`)
      }
      const content = line.slice(indent)
      if (/^-(\s|$)/.test(content)) break
      const colon = yamlColon(content)
      if (colon < 0) {
        throw new CatError('LOCALIZATION_YAML_PARSE', `第 ${index + 1} 行缺少键值分隔符。`)
      }
      const key = stripYamlQuote(content.slice(0, colon).trim())
      const rest = content.slice(colon + 1).trim()
      const comment = takeComment()
      index += 1
      let value
      if (!rest) {
        skip()
        value =
          index < lines.length && yamlIndent(lines[index]) > indent
            ? parseNode(yamlIndent(lines[index]))
            : parseScalar('')
      } else if (rest.startsWith('|') || rest.startsWith('>')) {
        value = parseBlockScalar(indent, rest)
      } else {
        value = parseScalar(rest)
      }
      entries.push({ key, value, ...(comment ? { comment } : {}) })
    }
    return { type: 'map', entries }
  }

  const parseSequence = (indent) => {
    const items = []
    while (index < lines.length) {
      skip()
      if (index >= lines.length) break
      const line = lines[index]
      const actual = yamlIndent(line)
      if (actual < indent) break
      if (actual > indent) {
        throw new CatError('LOCALIZATION_YAML_PARSE', `第 ${index + 1} 行缩进不一致。`)
      }
      const content = line.slice(indent)
      const match = content.match(/^-(\s|$)([\s\S]*)$/)
      if (!match) break
      const rest = match[2].trim()
      index += 1
      const comment = takeComment()
      let value
      if (!rest) {
        skip()
        value =
          index < lines.length && yamlIndent(lines[index]) > indent
            ? parseNode(yamlIndent(lines[index]))
            : parseScalar('')
      } else if (yamlColon(rest) >= 0) {
        const colon = yamlColon(rest)
        const key = stripYamlQuote(rest.slice(0, colon).trim())
        const tail = rest.slice(colon + 1).trim()
        const map = {
          type: 'map',
          entries: [{ key, value: tail ? parseScalar(tail) : parseScalar('') }],
        }
        skip()
        if (index < lines.length && yamlIndent(lines[index]) > indent) {
          const child = parseNode(yamlIndent(lines[index]))
          if (child.type === 'map') map.entries.push(...child.entries)
        }
        value = map
      } else {
        value = parseScalar(rest)
      }
      items.push({ value, ...(comment ? { comment } : {}) })
    }
    return { type: 'seq', items }
  }

  skip()
  if (index >= lines.length)
    throw new CatError('LOCALIZATION_NO_UNITS', 'YAML 中没有可翻译的字符串。')
  const root = parseNode(yamlIndent(lines[index]))
  const trailing = takeComment()
  return { root, ...(trailing ? { comment: trailing } : {}) }
}

function walkYaml(node, path, segments, comment = '') {
  if (!node || typeof node !== 'object') return
  if (node.type === 'map') {
    for (const entry of node.entries || []) {
      const next = path ? `${path}.${entry.key}` : entry.key
      walkYaml(entry.value, next, segments, entry.comment || comment)
    }
    return
  }
  if (node.type === 'seq') {
    for (const [itemIndex, item] of (node.items || []).entries()) {
      walkYaml(item.value, `${path}[${itemIndex}]`, segments, item.comment || comment)
    }
    return
  }
  if (node.type !== 'scalar') return
  const text = String(node.value ?? '').trim()
  if (!text) return
  if (/^(true|false|null|~)$/i.test(text)) return
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return
  pushSegment(segments, 'yaml', path, node.value, { keyPath: path }, comment)
}

function parseYaml(text) {
  const root = parseYamlBlock(text)
  const segments = []
  walkYaml(root.root, '', segments)
  const rootComment = root.comment || ''
  if (!segments.length) throw new CatError('LOCALIZATION_NO_UNITS', 'YAML 中没有可翻译的字符串。')
  return {
    format: 'yaml',
    segments,
    formatMeta: {
      localizationTemplate: JSON.stringify({
        kind: 'yaml',
        root: root.root,
        ...(rootComment ? { comment: rootComment } : {}),
      }),
    },
    warnings: [],
  }
}

function yamlOut(value) {
  return yamlValue(String(value ?? ''))
}

function buildYamlNode(node, indent, values, path) {
  const pad = ' '.repeat(indent)
  const lines = []
  if (!node) return lines
  if (node.type === 'scalar') {
    return [`${pad}${yamlOut(values.get(path) ?? node.value)}`]
  }
  if (node.type === 'map') {
    for (const entry of node.entries || []) {
      const next = path ? `${path}.${entry.key}` : entry.key
      if (entry.comment) {
        for (const line of String(entry.comment).split('\n')) lines.push(`${pad}# ${line}`)
      }
      const child = entry.value
      if (child?.type === 'scalar') {
        const value = values.get(next) ?? child.value
        if (child.style === 'literal' || child.style === 'folded') {
          lines.push(`${pad}${entry.key}: ${child.style === 'literal' ? '|' : '>'}`)
          for (const line of String(value).replace(/\n$/, '').split('\n')) {
            lines.push(`${pad}  ${line}`)
          }
        } else {
          lines.push(`${pad}${entry.key}: ${yamlOut(value)}`)
        }
      } else {
        lines.push(`${pad}${entry.key}:`)
        lines.push(...buildYamlNode(child, indent + 2, values, next))
      }
    }
    return lines
  }
  if (node.type === 'seq') {
    for (const [itemIndex, item] of (node.items || []).entries()) {
      const next = `${path}[${itemIndex}]`
      if (item.comment) {
        for (const line of String(item.comment).split('\n')) lines.push(`${pad}# ${line}`)
      }
      if (item.value?.type === 'scalar') {
        lines.push(`${pad}- ${yamlOut(values.get(next) ?? item.value.value)}`)
      } else {
        lines.push(`${pad}-`)
        lines.push(...buildYamlNode(item.value, indent + 2, values, next))
      }
    }
    return lines
  }
  return lines
}

function buildYaml(doc, ast) {
  const values = targetLookup(doc)
  const lines = []
  if (ast.comment) {
    for (const line of String(ast.comment).split('\n')) lines.push(`# ${line}`)
  }
  lines.push(...buildYamlNode(ast.root, 0, values, ''))
  return `${lines.join('\n')}\n`
}

function parseKeyValueLines(text, kind) {
  const input = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
  const entries = []
  const segments = []
  const warnings = []
  let pendingComment = ''
  const lines = input.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) continue
    if (/^\s*[#!]/.test(line)) {
      pendingComment = line.replace(/^\s*[#!]\s?/, '').trim()
      continue
    }
    if (/^\s/.test(line) && kind === 'yaml') {
      throw new CatError('LOCALIZATION_YAML_NESTED', '当前只支持扁平 YAML（键值不缩进）。')
    }
    let body = line
    if (kind === 'properties') {
      while (body.endsWith('\\') && index + 1 < lines.length) {
        body = `${body.slice(0, -1)}${lines[index + 1]}`
        index += 1
      }
    }
    let separatorIndex = -1
    let separator = kind === 'yaml' ? ':' : '='
    if (kind === 'yaml') {
      separatorIndex = body.indexOf(':')
      if (separatorIndex < 0) continue
    } else {
      let escaped = false
      for (let cursor = 0; cursor < body.length; cursor += 1) {
        const char = body[cursor]
        if (escaped) {
          escaped = false
          continue
        }
        if (char === '\\') {
          escaped = true
          continue
        }
        if (char === '=' || char === ':') {
          separatorIndex = cursor
          separator = char
          break
        }
      }
      if (separatorIndex < 0) {
        const match = body.match(/^(\S+)\s+(.*)$/)
        if (!match) continue
        separatorIndex = match[1].length
        separator = ' '
      }
    }
    const key = body.slice(0, separatorIndex).trim()
    let value = body.slice(separatorIndex + (separator === ' ' ? 0 : 1)).trim()
    if (!key) continue
    if (kind === 'properties') value = decodeEscape(value, 'properties')
    else value = stripYamlQuote(value)
    entries.push({ type: 'string', key, value, comment: pendingComment, separator })
    pushSegment(segments, kind, key, value, {}, pendingComment)
    pendingComment = ''
  }
  if (!segments.length) throw new CatError('LOCALIZATION_NO_UNITS', '文件中没有可翻译的键值对。')
  return {
    format: kind,
    segments,
    formatMeta: { localizationTemplate: JSON.stringify({ kind, entries }) },
    warnings,
  }
}

function parsePlist(xml) {
  const tokens =
    String(xml ?? '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .match(/<[^>]+>|[^<]+/g) ?? []
  let index = 0

  const skipNoise = () => {
    while (index < tokens.length) {
      const token = tokens[index]
      if (/^\s*$/.test(token) || token.startsWith('<?') || token.startsWith('<!')) index += 1
      else break
    }
  }
  const parseText = (tag) => {
    let output = ''
    while (index < tokens.length && tokens[index] !== `</${tag}>`) {
      output += tokens[index]
      index += 1
    }
    if (tokens[index] === `</${tag}>`) index += 1
    return decodeXml(cdata(output)).trim()
  }
  const parseValue = () => {
    skipNoise()
    const token = tokens[index]
    if (!token) throw new CatError('LOCALIZATION_PARSE', 'plist 结构不完整。')
    if (token.startsWith('<plist')) {
      index += 1
      return parseValue()
    }
    if (token === '<dict>') {
      index += 1
      const result = {}
      while (index < tokens.length && tokens[index] !== '</dict>') {
        skipNoise()
        if (tokens[index] !== '<key>') {
          index += 1
          continue
        }
        index += 1
        const key = parseText('key')
        skipNoise()
        result[key] = parseValue()
      }
      index += 1
      return result
    }
    if (token === '<array>') {
      index += 1
      const result = []
      while (index < tokens.length && tokens[index] !== '</array>') {
        result.push(parseValue())
      }
      index += 1
      return result
    }
    if (token.startsWith('<string>')) {
      index += 1
      return parseText('string')
    }
    if (token.startsWith('<integer>') || token.startsWith('<real>')) {
      index += 1
      const value = Number(parseText(token.startsWith('<integer>') ? 'integer' : 'real'))
      return Number.isFinite(value) ? value : 0
    }
    if (token === '<true/>' || token === '<false/>') {
      index += 1
      return token === '<true/>'
    }
    index += 1
    return ''
  }
  const value = parseValue()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatError('LOCALIZATION_PARSE', 'stringsdict 根节点必须是字典。')
  }
  return value
}

function parseStringsdict(text) {
  const root = parsePlist(text)
  const entries = []
  const segments = []
  for (const [key, config] of Object.entries(root)) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue
    const formatKey = String(config.NSStringLocalizedFormatKey ?? '')
    const variable = formatKey.match(/%#@([A-Za-z0-9_]+)@/)?.[1] ?? 'count'
    const quantitySource =
      config[variable] && typeof config[variable] === 'object' && !Array.isArray(config[variable])
        ? config[variable]
        : config
    const items = []
    for (const [quantity, value] of Object.entries(quantitySource)) {
      if (quantity.startsWith('NSString') || quantity === variable) continue
      if (typeof value !== 'string') continue
      items.push({ quantity, value })
      pushSegment(segments, 'apple-stringsdict', key, value, {
        keyPath: `${key}#${quantity}`,
        context: quantity,
        plural: true,
        msgidPlural: key,
        icuType: 'quantity',
      })
    }
    entries.push({
      type: 'stringsdict',
      key,
      variable,
      formatKey: formatKey || `%#@${variable}@`,
      valueType: String(quantitySource.NSStringFormatValueTypeKey ?? 'd'),
      items,
    })
  }
  if (!segments.length)
    throw new CatError('LOCALIZATION_NO_UNITS', 'stringsdict 中没有可翻译的复数文本。')
  return {
    format: 'apple-stringsdict',
    segments,
    formatMeta: { localizationTemplate: JSON.stringify({ kind: 'apple-stringsdict', entries }) },
    warnings: [],
  }
}

export function parseLocalization(text, kind) {
  const normalized = normalizeKind(kind)
  if (normalized === 'apple-strings') return parseAppleStrings(text, normalized)
  if (normalized === 'apple-stringsdict') return parseStringsdict(text)
  if (normalized === 'android') return parseAndroid(text)
  if (normalized === 'resx') return parseResx(text)
  if (normalized === 'arb') return parseArb(text)
  if (normalized === 'yaml') return parseYaml(text)
  return parseKeyValueLines(text, normalized)
}

function targetLookup(doc) {
  const map = new Map()
  for (const segment of doc.segments) {
    const id = segment.meta?.identifier || segment.meta?.keyPath
    if (!id) continue
    const context = segment.meta?.context || ''
    const value = String(segment.target || segment.source || '')
    map.set(`${id}\u0000${context}`, value)
    if (!context) map.set(id, value)
  }
  return map
}

function segmentLookup(doc) {
  const map = new Map()
  for (const segment of doc.segments) {
    const id = segment.meta?.identifier
    if (!id) continue
    const context = segment.meta?.context || ''
    map.set(`${id}\u0000${context}`, segment)
  }
  return map
}

function templateOf(doc, kind) {
  const raw = doc.formatMeta?.localizationTemplate
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.kind === kind) return parsed
    } catch {
      // fall through to a minimal rebuild
    }
  }
  return {
    kind,
    entries: doc.segments.map((segment) => ({
      type: 'string',
      key: segment.meta?.identifier || segment.meta?.keyPath || String(segment.paragraph ?? 0),
      value: segment.source,
    })),
  }
}

function buildAppleStrings(doc, ast) {
  const values = targetLookup(doc)
  const lines = []
  for (const entry of ast.entries || []) {
    if (!entry || entry.type !== 'string') continue
    if (entry.comment) lines.push(`/* ${entry.comment} */`)
    const value = values.get(`${entry.key}\u0000`) ?? entry.value
    lines.push(`"${escapeApple(entry.key)}" = "${escapeApple(value)}";`)
  }
  return `${lines.join('\n')}\n`
}

function buildAndroid(doc, ast) {
  const values = targetLookup(doc)
  const segments = segmentLookup(doc)
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<resources>']
  for (const entry of ast.entries || []) {
    if (!entry || !entry.key) continue
    if (entry.comment) lines.push(`    <!-- ${entry.comment} -->`)
    const translatable = entry.translatable === false ? ' translatable="false"' : ''
    if (entry.type === 'string') {
      const segment = segments.get(`${entry.key}\u0000`)
      const value = values.get(`${entry.key}\u0000`) ?? entry.value
      lines.push(
        `    <string name="${escapeXml(entry.key)}"${translatable}>${segment ? renderInline(value, segment.meta?.inline) : escapeXml(cdata(value))}</string>`,
      )
    } else if (entry.type === 'plural') {
      lines.push(`    <plurals name="${escapeXml(entry.key)}"${translatable}>`)
      for (const item of entry.items || []) {
        const segment = segments.get(`${entry.key}\u0000${item.quantity}`)
        const value = values.get(`${entry.key}\u0000${item.quantity}`) ?? item.value
        lines.push(
          `        <item quantity="${escapeXml(item.quantity)}">${segment ? renderInline(value, segment.meta?.inline) : escapeXml(cdata(value))}</item>`,
        )
      }
      lines.push('    </plurals>')
    }
  }
  lines.push('</resources>')
  return `${lines.join('\n')}\n`
}

function buildResx(doc, ast) {
  const values = targetLookup(doc)
  const segments = segmentLookup(doc)
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<root>',
    '  <resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>',
    '  <resheader name="version"><value>2.0</value></resheader>',
    '  <resheader name="reader"><value>System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>',
    '  <resheader name="writer"><value>System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>',
  ]
  for (const entry of ast.entries || []) {
    if (!entry || entry.type !== 'string' || !entry.key) continue
    const segment = segments.get(`${entry.key}\u0000`)
    const value = values.get(`${entry.key}\u0000`) ?? entry.value
    lines.push(`  <data name="${escapeXml(entry.key)}" xml:space="preserve">`)
    lines.push(
      `    <value>${segment ? renderInline(value, segment.meta?.inline) : escapeXml(cdata(value))}</value>`,
    )
    if (entry.comment) lines.push(`    <comment>${escapeXml(entry.comment)}</comment>`)
    lines.push('  </data>')
  }
  lines.push('</root>')
  return `${lines.join('\n')}\n`
}

function buildArb(doc, ast) {
  const data =
    ast.data && typeof ast.data === 'object' && !Array.isArray(ast.data)
      ? structuredClone(ast.data)
      : {}
  for (const segment of doc.segments) {
    const key = segment.meta?.identifier
    if (!key || !(key in data)) continue
    data[key] = String(segment.target || segment.source || '')
  }
  return `${JSON.stringify(data, null, 2)}\n`
}

function buildKeyValue(doc, ast, kind) {
  const values = targetLookup(doc)
  const lines = []
  for (const entry of ast.entries || []) {
    if (!entry || entry.type !== 'string' || !entry.key) continue
    if (entry.comment) lines.push(`${kind === 'yaml' ? '#' : '#'} ${entry.comment}`)
    const value = values.get(`${entry.key}\u0000`) ?? entry.value
    if (kind === 'yaml') lines.push(`${entry.key}: ${yamlValue(value)}`)
    else lines.push(`${escapeProperties(entry.key, true)}=${escapeProperties(value)}`)
  }
  return `${lines.join('\n')}\n`
}

function buildStringsdict(doc, ast) {
  const values = targetLookup(doc)
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
  ]
  for (const entry of ast.entries || []) {
    if (!entry || entry.type !== 'stringsdict' || !entry.key) continue
    const variable = entry.variable || 'count'
    lines.push(`  <key>${escapeXml(entry.key)}</key>`)
    lines.push('  <dict>')
    lines.push('    <key>NSStringLocalizedFormatKey</key>')
    lines.push(`    <string>${escapeXml(entry.formatKey || `%#@${variable}@`)}</string>`)
    lines.push(`    <key>${escapeXml(variable)}</key>`)
    lines.push('    <dict>')
    lines.push('      <key>NSStringFormatSpecTypeKey</key>')
    lines.push('      <string>NSStringPluralRuleType</string>')
    lines.push('      <key>NSStringFormatValueTypeKey</key>')
    lines.push(`      <string>${escapeXml(entry.valueType || 'd')}</string>`)
    for (const item of entry.items || []) {
      const value = values.get(`${entry.key}\u0000${item.quantity}`) ?? item.value
      lines.push(`      <key>${escapeXml(item.quantity)}</key>`)
      lines.push(`      <string>${escapeXml(value)}</string>`)
    }
    lines.push('    </dict>')
    lines.push('  </dict>')
  }
  lines.push('</dict>', '</plist>')
  return `${lines.join('\n')}\n`
}

export function buildLocalization(doc, kind) {
  const normalized = normalizeKind(kind || doc.format)
  const ast = templateOf(doc, normalized)
  if (normalized === 'apple-strings') return buildAppleStrings(doc, ast)
  if (normalized === 'apple-stringsdict') return buildStringsdict(doc, ast)
  if (normalized === 'android') return buildAndroid(doc, ast)
  if (normalized === 'resx') return buildResx(doc, ast)
  if (normalized === 'arb') return buildArb(doc, ast)
  if (normalized === 'yaml' && ast.root) return buildYaml(doc, ast)
  return buildKeyValue(doc, ast, normalized)
}

export const LOCALIZATION_EXTENSIONS = {
  strings: 'apple-strings',
  stringsdict: 'apple-stringsdict',
  resx: 'resx',
  arb: 'arb',
  yaml: 'yaml',
  yml: 'yaml',
  properties: 'properties',
}

export const LOCALIZATION_EXPORT = {
  'apple-strings': { extension: 'strings', mime: 'text/plain;charset=utf-8' },
  'apple-stringsdict': { extension: 'stringsdict', mime: 'application/xml;charset=utf-8' },
  android: { extension: 'xml', mime: 'application/xml;charset=utf-8' },
  resx: { extension: 'resx', mime: 'application/xml;charset=utf-8' },
  arb: { extension: 'arb', mime: 'application/json;charset=utf-8' },
  yaml: { extension: 'yaml', mime: 'text/yaml;charset=utf-8' },
  properties: { extension: 'properties', mime: 'text/plain;charset=utf-8' },
}
