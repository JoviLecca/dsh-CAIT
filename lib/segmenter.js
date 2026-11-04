/**
 * Paragraph-aware sentence segmentation.
 *
 * Paragraphs are separated by blank lines. Within a paragraph we split on
 * sentence-final punctuation while protecting decimals and a small set of
 * common abbreviations. CJK text usually has no space after the full stop,
 * so a boundary is also recognised when the next character is CJK.
 */

const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/

function isAbbreviation(text, dotIndex) {
  const before = text.slice(Math.max(0, dotIndex - 12), dotIndex)
  return /(?:^|[\s(])(?:e\.g|i\.e|etc|Mr|Mrs|Ms|Dr|Prof|vs|No)$/i.test(before)
}

function splitSentences(text) {
  const out = []
  let start = 0

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const isCjkStop = char === '。' || char === '！' || char === '？' || char === '…'
    const isLatinStop = char === '.' || char === '!' || char === '?'
    if (!isCjkStop && !isLatinStop) continue

    if (isCjkStop && char === '…' && text[i + 1] === '…') continue
    if (isLatinStop && char === '.') {
      const previous = text[i - 1] || ''
      const next = text[i + 1] || ''
      if (/\d/.test(previous) && /\d/.test(next)) continue
      if (isAbbreviation(text, i)) continue
    }

    let end = i + 1
    while (end < text.length && /["'”’）)\]]/.test(text[end])) end += 1

    if (isLatinStop) {
      const next = text[end] || ''
      if (!/\s/.test(next) && !CJK.test(next)) continue
    }

    const part = text.slice(start, end).trim()
    if (part) out.push(part)
    start = end
    i = end - 1
  }

  const tail = text.slice(start).trim()
  if (tail) out.push(tail)
  return out
}

export function splitIntoSegments(input) {
  const text = String(input ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return []

  const segments = []
  let paragraph = 0

  for (const rawBlock of text.split(/\n{2,}/)) {
    const block = rawBlock.trim()
    if (!block) continue

    if (/^#{1,6}\s+/.test(block)) {
      const heading = block
        .replace(/^#{1,6}\s+/, '')
        .replace(/\s+#+\s*$/, '')
        .replace(/\s*\n\s*/g, ' ')
        .trim()
      if (heading) segments.push({ source: heading, paragraph })
      paragraph += 1
      continue
    }

    const joined = block.replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim()
    for (const sentence of splitSentences(joined)) {
      segments.push({ source: sentence, paragraph })
    }
    paragraph += 1
  }

  return segments
}
