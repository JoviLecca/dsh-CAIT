import { CatError } from './errors.js'
import { splitIntoSegments } from './segmenter.js'
import { normalizeText } from './similarity.js'
import { cleanLang, cleanText } from './store-utils.js'

/**
 * Cross-language alignment of two separate files.
 *
 * Literal similarity is useless here: "3 modes" and "3 种模式" share no
 * characters. What survives translation are structural signals — numbers,
 * placeholders, URLs, all-caps names, relative length and paragraph position —
 * so the score is built from those instead.
 */

export const ALIGN_WEIGHTS = { anchor: 0.45, length: 0.35, struct: 0.2 }
export const ALIGN_HIGH = 0.6
export const ALIGN_MEDIUM = 0.35
export const ALIGN_SKIP_COST = 1
export const ALIGN_MERGE_PENALTY = 0.15
// A merge glues two sentences of one side onto one of the other. Without hard
// evidence (a shared number, placeholder or name) that is almost always a
// wrong pairing invented to make the totals look neat, so merges need a real
// score before they are even considered.
export const ALIGN_MERGE_MIN_SCORE = 0.55
export const ALIGN_MAX_CELLS = 4_000_000
export const ALIGN_BLOCK_SIZE = 500

const ANCHOR_PATTERNS = [
  /\{\d+\}/g,
  /https?:\/\/[^\s)]+/gi,
  /\b\d[\d.,]*%?/g,
  /\b[A-Z][A-Z0-9]{1,}\b/g,
  /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g,
]

function anchorsIn(text) {
  const found = []
  const value = String(text ?? '')
  for (const pattern of ANCHOR_PATTERNS) {
    for (const match of value.match(pattern) || []) {
      found.push(match.replace(/[.,]$/, '').toLocaleLowerCase())
    }
  }
  return found
}

/** Multiset Dice over anchors. No anchors at all is neutral, not a failure. */
export function anchorOverlap(left, right) {
  const a = anchorsIn(left)
  const b = anchorsIn(right)
  if (!a.length && !b.length) return 0.5
  if (!a.length || !b.length) return 0
  const counts = new Map()
  for (const item of a) counts.set(item, (counts.get(item) || 0) + 1)
  let shared = 0
  for (const item of b) {
    const remaining = counts.get(item) || 0
    if (remaining > 0) {
      shared += 1
      counts.set(item, remaining - 1)
    }
  }
  return (2 * shared) / (a.length + b.length)
}

function median(values) {
  const clean = values.filter((value) => value > 0).sort((a, b) => a - b)
  if (!clean.length) return 1
  return clean[Math.floor(clean.length / 2)]
}

/**
 * Gale-Church style length hypothesis: compare each length against the median
 * of its own language, so a Chinese sentence can match an English sentence
 * that is 1.8× longer without any language-specific table.
 */
export function lengthFit(leftLength, rightLength, medianLeft, medianRight) {
  const ratioLeft = leftLength / (medianLeft || 1)
  const ratioRight = rightLength / (medianRight || 1)
  if (!ratioLeft && !ratioRight) return 0.5
  if (!ratioLeft || !ratioRight) return 0
  const spread = Math.max(ratioLeft, ratioRight)
  return Math.max(0, 1 - Math.abs(ratioLeft - ratioRight) / (spread || 1))
}

function isHeadingLike(text) {
  const value = String(text ?? '').trim()
  if (!value) return false
  if (value.length > 60) return false
  return !/[.!?。！？:：;；]$/.test(value)
}

/**
 * Structure signal: same paragraph number, both sides headings, or adjacent
 * paragraphs (a merge or split shifts numbers by one).
 */
export function structMatch(left, right) {
  let score = 0
  if (left.paragraph === right.paragraph) score += 0.5
  if (isHeadingLike(left.source) && isHeadingLike(right.source)) score += 0.5
  else if (Math.abs((left.paragraph ?? 0) - (right.paragraph ?? 0)) === 1) score += 0.25
  return Math.min(1, score)
}

export function scorePair(left, right, medians) {
  const anchor = anchorOverlap(left.source, right.source)
  const length = lengthFit(
    Array.from(left.source).length,
    Array.from(right.source).length,
    medians.left,
    medians.right,
  )
  const struct = structMatch(left, right)
  const score =
    ALIGN_WEIGHTS.anchor * anchor + ALIGN_WEIGHTS.length * length + ALIGN_WEIGHTS.struct * struct
  return { score: Math.min(1, Math.max(0, score)), anchor, length, struct }
}

export function confidenceOf(score) {
  if (score >= ALIGN_HIGH) return 'high'
  if (score >= ALIGN_MEDIUM) return 'medium'
  return 'low'
}

function merged(leftSegments, rightSegments) {
  const text = `${leftSegments.map((item) => item.source).join(' ')}`
  const other = `${rightSegments.map((item) => item.source).join(' ')}`
  return {
    left: { source: text, paragraph: leftSegments[0]?.paragraph ?? 0 },
    right: { source: other, paragraph: rightSegments[0]?.paragraph ?? 0 },
  }
}

function pairCost(leftSegment, rightSegment, medians) {
  return 1 - scorePair(leftSegment, rightSegment, medians).score
}

/**
 * Dynamic programming over prefixes. Moves: 1:1, 1:0, 0:1, 2:1 and 1:2. Skips
 * cost a full 1.0 so the algorithm prefers a bad pair over dropping both
 * sides, and merges carry a penalty so it cannot cheat its way to a cheap
 * total by gluing everything together.
 */
export function alignBlock(source, target, medians) {
  const n = source.length
  const m = target.length
  const width = m + 1
  const cost = new Float64Array((n + 1) * width).fill(Number.POSITIVE_INFINITY)
  const move = new Int8Array((n + 1) * width)
  cost[0] = 0
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (!i && !j) continue
      const here = i * width + j
      let best = Number.POSITIVE_INFINITY
      let kind = 0
      if (i && j) {
        const value = cost[(i - 1) * width + (j - 1)] + pairCost(source[i - 1], target[j - 1], medians)
        if (value < best) {
          best = value
          kind = 3
        }
      }
      if (i && j >= 1 && i >= 2) {
        const { left, right } = merged([source[i - 2], source[i - 1]], [target[j - 1]])
        const scored = scorePair(left, right, medians).score
        if (scored >= ALIGN_MERGE_MIN_SCORE) {
          const value =
            cost[(i - 2) * width + (j - 1)] + (1 - scored) + ALIGN_MERGE_PENALTY
          if (value < best) {
            best = value
            kind = 4
          }
        }
      }
      if (i && j >= 2) {
        const { left, right } = merged([source[i - 1]], [target[j - 2], target[j - 1]])
        const scored = scorePair(left, right, medians).score
        if (scored >= ALIGN_MERGE_MIN_SCORE) {
          const value =
            cost[(i - 1) * width + (j - 2)] + (1 - scored) + ALIGN_MERGE_PENALTY
          if (value < best) {
            best = value
            kind = 5
          }
        }
      }
      if (i) {
        const value = cost[(i - 1) * width + j] + ALIGN_SKIP_COST
        if (value < best) {
          best = value
          kind = 1
        }
      }
      if (j) {
        const value = cost[i * width + (j - 1)] + ALIGN_SKIP_COST
        if (value < best) {
          best = value
          kind = 2
        }
      }
      cost[here] = best
      move[here] = kind
    }
  }

  const rows = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const kind = move[i * width + j]
    if (kind === 3) {
      rows.push({ source: source[i - 1], target: target[j - 1], left: 1, right: 1 })
      i -= 1
      j -= 1
    } else if (kind === 4) {
      const { left, right } = merged([source[i - 2], source[i - 1]], [target[j - 1]])
      rows.push({ source: left, target: right, left: 2, right: 1, merged: true })
      i -= 2
      j -= 1
    } else if (kind === 5) {
      const { left, right } = merged([source[i - 1]], [target[j - 2], target[j - 1]])
      rows.push({ source: left, target: right, left: 1, right: 2, merged: true })
      i -= 1
      j -= 2
    } else if (kind === 1) {
      rows.push({ source: source[i - 1], target: null, left: 1, right: 0 })
      i -= 1
    } else {
      rows.push({ source: null, target: target[j - 1], left: 0, right: 1 })
      j -= 1
    }
  }
  rows.reverse()
  return rows
}

function decorate(row, sourceIndex, targetIndex, medians) {
  if (!row.source || !row.target) {
    return {
      sourceIndex,
      targetIndex,
      source: row.source ? row.source.source : '',
      target: row.target ? row.target.source : '',
      sourceParagraph: row.source?.paragraph ?? null,
      targetParagraph: row.target?.paragraph ?? null,
      score: 0,
      confidence: 'missing',
      merged: Boolean(row.merged),
    }
  }
  const { score } = scorePair(row.source, row.target, medians)
  return {
    sourceIndex,
    targetIndex,
    source: row.source.source,
    target: row.target.source,
    sourceParagraph: row.source.paragraph ?? null,
    targetParagraph: row.target.paragraph ?? null,
    score: Math.round(score * 1000) / 1000,
    confidence: confidenceOf(score),
    merged: Boolean(row.merged),
  }
}

/**
 * Align two plain texts. Returns every row (including unpaired ones) so the UI
 * can let a human repair them; `pairs` is only the two-sided rows.
 */
export function alignTexts(sourceText, targetText, options = {}) {
  const source = splitIntoSegments(sourceText)
  const target = splitIntoSegments(targetText)
  if (!source.length || !target.length) {
    throw new CatError('ALIGN_EMPTY', '两侧都需要有文本才能对齐。')
  }
  const medians = {
    left: median(source.map((item) => Array.from(item.source).length)),
    right: median(target.map((item) => Array.from(item.source).length)),
  }

  const blocked = source.length * target.length > ALIGN_MAX_CELLS
  const blocks = []
  if (blocked) {
    for (let start = 0; start < Math.max(source.length, target.length); start += ALIGN_BLOCK_SIZE) {
      blocks.push({
        source: source.slice(start, start + ALIGN_BLOCK_SIZE),
        target: target.slice(start, start + ALIGN_BLOCK_SIZE),
        offset: start,
      })
    }
  } else {
    blocks.push({ source, target, offset: 0 })
  }

  const rows = []
  for (const block of blocks) {
    const aligned = alignBlock(block.source, block.target, medians)
    let cursorSource = block.offset
    let cursorTarget = block.offset
    for (const row of aligned) {
      const hasSource = Boolean(row.source)
      const hasTarget = Boolean(row.target)
      rows.push(
        decorate(
          row,
          hasSource ? cursorSource : null,
          hasTarget ? cursorTarget : null,
          medians,
        ),
      )
      if (hasSource) cursorSource += row.left
      if (hasTarget) cursorTarget += row.right
    }
  }

  const pairs = rows.filter((row) => row.source && row.target)
  const high = pairs.filter((row) => row.confidence === 'high')
  const medium = pairs.filter((row) => row.confidence === 'medium')
  const low = pairs.filter((row) => row.confidence === 'low')
  return {
    sourceName: options.sourceName ?? '',
    targetName: options.targetName ?? '',
    sourceSegments: source.length,
    targetSegments: target.length,
    rows,
    pairs,
    high: high.length,
    medium: medium.length,
    low: low.length,
    unpairedSource: rows.filter((row) => row.source && !row.target).length,
    unpairedTarget: rows.filter((row) => row.target && !row.source).length,
    blocked,
  }
}

export const alignMethods = {
  /** Read two uploads down to segments without creating a document. */
  prepareAlignment({ sourceFile, targetFile } = {}) {
    if (!sourceFile?.name || !targetFile?.name) {
      throw new CatError('ALIGN_INPUT', '需要同时提供源文文件与译文文件。')
    }
    const source = this.readUploadText(sourceFile)
    const target = this.readUploadText(targetFile)
    return { source, target }
  },

  alignUploads({ sourceFile, targetFile, sourceLang, targetLang } = {}) {
    const { source, target } = this.prepareAlignment({ sourceFile, targetFile })
    const result = alignTexts(source.text, target.text, {
      sourceName: source.name,
      targetName: target.name,
    })
    return {
      ...result,
      sourceLang: cleanLang(sourceLang || this.settings.sourceLang, this.settings.sourceLang),
      targetLang: cleanLang(targetLang || this.settings.targetLang, this.settings.targetLang),
    }
  },

  /**
   * Write reviewed pairs into one memory. Pairs identical to what is already
   * stored are skipped, and nothing else in the store is touched: no document,
   * no segment status.
   */
  writeAlignment({ pairs, tmId, sourceLang, targetLang } = {}) {
    const list = Array.isArray(pairs) ? pairs : []
    if (!list.length) throw new CatError('ALIGN_EMPTY', '没有可写入的配对。')
    const writeTmId = this.requireMountedTmLibrary(tmId)
    const writeSourceLang = cleanLang(sourceLang || this.settings.sourceLang, this.settings.sourceLang)
    const writeTargetLang = cleanLang(targetLang || this.settings.targetLang, this.settings.targetLang)
    let written = 0
    let updated = 0
    let skipped = 0
    for (const pair of list) {
      const sourceText = cleanText(pair?.source, '源文')
      const targetText = cleanText(pair?.target, '译文')
      if (!sourceText || !targetText) {
        skipped += 1
        continue
      }
      const key = normalizeText(sourceText)
      const existing = this.tm.find(
        (entry) =>
          entry.tmId === writeTmId &&
          entry.sourceLang === writeSourceLang &&
          entry.targetLang === writeTargetLang &&
          (entry.contextHash ?? null) === null &&
          normalizeText(entry.source) === key,
      )
      if (existing && existing.target === targetText) {
        skipped += 1
        continue
      }
      this.upsertTM(sourceText, targetText, writeSourceLang, writeTargetLang, writeTmId, null)
      if (existing) updated += 1
      else written += 1
    }
    if (written || updated) {
      this.touch()
      this.persist()
    }
    return {
      written,
      updated,
      skipped,
      total: list.length,
      tmId: writeTmId,
      count: this.mountedTmCount(),
    }
  },
}
