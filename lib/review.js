import { CatError } from './errors.js'
import { briefPromptBlock, neighborContext } from './brief.js'
import { canonicalLanguage } from './lang.js'
import { cleanText, csvCell, mdCell, now, safeBaseName } from './text-utils.js'
import { collectStreamText } from './mt.js'
import { REVIEW_STATUSES, normalizeReviewStatus } from './review-status.js'

const MAX_REVIEW_SEGMENTS = 20
const MAX_REVIEW_ISSUES = 120
// One row per segment, so the cap only matters for pathological documents.
const MAX_REVIEW_ISSUES_PER_DOC = 500
const REVIEW_EXPORT_FORMATS = ['csv', 'markdown']
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }

function compareIssues(a, b) {
  return (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) || a.index - b.index
}

function docReview(doc) {
  if (!doc.review || !Array.isArray(doc.review.issues)) {
    doc.review = { updatedAt: '', issues: [] }
  }
  return doc.review
}

/**
 * Fold a review run into the document's stored report. Re-running the same
 * finding keeps whatever the translator already decided about it; a different
 * finding at the same segment is a new problem and starts as open.
 */
function mergeIssues(doc, incoming, stamp) {
  const review = docReview(doc)
  const byIndex = new Map(review.issues.map((issue) => [issue.index, issue]))
  for (const issue of incoming) {
    const previous = byIndex.get(issue.index)
    const sameFinding =
      previous && previous.code === issue.code && previous.message === issue.message
    byIndex.set(issue.index, {
      ...issue,
      status: sameFinding ? normalizeReviewStatus(previous.status) : 'open',
      at: stamp,
    })
  }
  review.issues = [...byIndex.values()].sort(compareIssues).slice(0, MAX_REVIEW_ISSUES_PER_DOC)
  review.updatedAt = stamp
  return review
}

/**
 * Which segments this call reviews. An explicit `indexes` list wins over the
 * legacy `from`/`count` range so a caller can review the high-risk segments
 * the rule-based check already found, which are rarely contiguous.
 */
function reviewTargets({ indexes, from, count, total }) {
  if (Array.isArray(indexes) && indexes.length) {
    const wanted = indexes
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value < total)
    return [...new Set(wanted)].sort((a, b) => a - b).slice(0, MAX_REVIEW_SEGMENTS)
  }
  const start = Math.max(0, Number.isInteger(from) ? from : 0)
  const size = Math.max(1, Math.min(MAX_REVIEW_SEGMENTS, Number(count) || MAX_REVIEW_SEGMENTS))
  const end = Math.min(total, start + size)
  if (start >= total) return []
  return Array.from({ length: end - start }, (_, offset) => start + offset)
}

function parseIssues(output, allowed) {
  const text = String(output ?? '').trim()
  if (!text) throw new CatError('REVIEW_EMPTY', '模型没有返回审校结果。', 502)
  let parsed
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  } catch {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) {
      throw new CatError('REVIEW_INVALID', '模型返回的审校结果不是有效 JSON。', 502)
    }
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      throw new CatError('REVIEW_INVALID', '模型返回的审校结果不是有效 JSON。', 502)
    }
  }
  if (!Array.isArray(parsed))
    throw new CatError('REVIEW_INVALID', '模型返回的审校结果必须是数组。', 502)
  const issues = []
  for (const raw of parsed) {
    const index = Number(raw?.index)
    if (!Number.isInteger(index) || !allowed.has(index)) continue
    const severity = ['high', 'medium', 'low'].includes(raw?.severity) ? raw.severity : 'medium'
    const message = String(raw?.message ?? '').trim()
    if (!message) continue
    issues.push({
      index,
      severity,
      code:
        String(raw?.code ?? 'REVIEW')
          .trim()
          .slice(0, 40) || 'REVIEW',
      message: message.slice(0, 1000),
      suggestion: String(raw?.suggestion ?? '')
        .trim()
        .slice(0, 2000),
    })
    if (issues.length >= MAX_REVIEW_ISSUES) break
  }
  return issues
}

export const reviewMethods = {
  async reviewDocument({ documentId, from = 0, count = MAX_REVIEW_SEGMENTS, indexes = null } = {}) {
    const doc = this.requireDocument(documentId)
    const targets = reviewTargets({ indexes, from, count, total: doc.segments.length })
    if (!targets.length) {
      throw new CatError('REVIEW_RANGE_INVALID', '审校范围超出文档。', 400)
    }
    const route = await this.resolveReviewRoute()
    if (route.mock) {
      throw new CatError(
        'REVIEW_UNAVAILABLE',
        'AI 审校需要可用的 DSH 模型路由；当前只有离线术语替换。',
        409,
      )
    }
    const items = targets.map((index) => ({ index, segment: doc.segments[index] }))
    const src = canonicalLanguage(doc.sourceLang)
    const tgt = canonicalLanguage(doc.targetLang)
    const sections = items
      .map(({ index, segment }) => {
        const before = neighborContext(doc, index, { before: 1, after: 0 }).before
        const after = neighborContext(doc, index, { before: 0, after: 1 }).after
        const context = [
          ...before.map((item) => `previous: ${String(item.source).slice(0, 400)}`),
          ...after.map((item) => `next: ${String(item.source).slice(0, 400)}`),
        ]
        return [
          `[S${index}]`,
          ...context,
          `source: ${cleanText(segment.source, '原文').slice(0, 4000)}`,
          `target: ${cleanText(segment.target, '译文').slice(0, 4000) || '(empty)'}`,
        ].join('\n')
      })
      .join('\n\n')
    const prompt = [
      `Review ${items.length} translated segment(s) from ${src} to ${tgt}.`,
      'Return a JSON array only, one object per real issue: [{"index":12,"severity":"high|medium|low","code":"MISTRANSLATION|TERM|OMISSION|ADDITION|FLUENCY|STYLE","message":"...","suggestion":"..."}].',
      'Only report actual problems. Empty target is an issue. Do not rewrite correct segments; return [] when nothing is wrong.',
      briefPromptBlock(doc.brief),
      `Segments:\n${sections}`,
    ]
      .filter((part) => String(part ?? '').trim())
      .join('\n\n')
    const systemText =
      'You are a bilingual translation reviewer. Judge meaning, terminology, omissions, additions and fluency against the source and the document brief. Return only the requested JSON array.'
    const started = Date.now()
    let output
    try {
      const stream = await this.mtRuntime.stream({
        provider: route.provider,
        model: route.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        system: systemText,
        temperature: 0,
        purpose: 'cait-review',
        signal: AbortSignal.timeout(60000),
      })
      output = await collectStreamText(stream)
    } catch (error) {
      this.logger?.warn?.(
        `CAIT: AI review failed provider=${route.provider} model=${route.model} code=${
          error?.code || 'UNKNOWN'
        }: ${error?.message || error}`,
      )
      throw new CatError(
        'REVIEW_PROVIDER_FAILED',
        'AI 审校调用失败，请检查 DSH 模型路由配置。',
        502,
      )
    }
    const issues = parseIssues(output, new Set(targets))
    const review = mergeIssues(doc, issues, now())
    this.touch()
    this.persist({ strict: true })
    return {
      documentId: doc.id,
      documentName: doc.name,
      indexes: targets,
      from: targets[0],
      to: targets[targets.length - 1] + 1,
      issues,
      review,
      provider: route.provider,
      model: route.model,
      inherited: Boolean(route.inherited),
      latencyMs: Date.now() - started,
    }
  },

  setReviewIssueState({ documentId, index, status } = {}) {
    const doc = this.requireDocument(documentId)
    const segmentIndex = Number(index)
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
      throw new CatError('REVIEW_RANGE_INVALID', '审校范围超出文档。', 400)
    }
    if (!REVIEW_STATUSES.includes(status)) {
      throw new CatError('REVIEW_STATUS_INVALID', '未知的审校状态。', 400)
    }
    const review = docReview(doc)
    const issue = review.issues.find((item) => item.index === segmentIndex)
    if (!issue) throw new CatError('REVIEW_ISSUE_NOT_FOUND', '这条审校建议不存在。', 404)
    if (issue.status !== status) {
      issue.status = status
      review.updatedAt = now()
      this.touch()
      this.persist({ strict: true })
    }
    return { issue: { ...issue } }
  },

  clearReview({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const cleared = doc.review?.issues?.length || 0
    if (cleared) {
      doc.review = { updatedAt: now(), issues: [] }
      this.touch()
      this.persist({ strict: true })
    }
    return { cleared }
  },

  exportReview({ documentId, format = 'csv' } = {}) {
    const doc = this.requireDocument(documentId)
    if (!REVIEW_EXPORT_FORMATS.includes(format)) {
      throw new CatError('REVIEW_FORMAT_INVALID', '不支持的审校报告格式。', 400)
    }
    const issues = doc.review?.issues || []
    if (!issues.length) throw new CatError('REVIEW_NOT_FOUND', '还没有审校结果。', 404)
    const rows = issues.map((issue) => {
      const segment = doc.segments[issue.index]
      return {
        index: issue.index + 1,
        severity: issue.severity,
        status: issue.status,
        code: issue.code,
        message: issue.message,
        suggestion: issue.suggestion,
        source: segment?.source || '',
        target: segment?.target || '',
      }
    })
    const base = `${safeBaseName(doc.name)}.${doc.targetLang}.review`
    if (format === 'markdown') {
      const header =
        '| # | Severity | Status | Code | Message | Suggestion | Source | Target |\n| --- | --- | --- | --- | --- | --- | --- | --- |'
      const body = rows
        .map(
          (row) =>
            `| ${row.index} | ${row.severity} | ${row.status} | ${mdCell(row.code)} | ${mdCell(
              row.message,
            )} | ${mdCell(row.suggestion)} | ${mdCell(row.source)} | ${mdCell(row.target)} |`,
        )
        .join('\n')
      return {
        filename: `${base}.md`,
        mime: 'text/markdown;charset=utf-8',
        content: `# ${doc.name} — AI review\n\n${header}\n${body}\n`,
        count: rows.length,
      }
    }
    const header = [
      'index',
      'severity',
      'status',
      'code',
      'message',
      'suggestion',
      'source',
      'target',
    ]
    const lines = [
      header.join(','),
      ...rows.map((row) => header.map((key) => csvCell(row[key])).join(',')),
    ]
    return {
      filename: `${base}.csv`,
      mime: 'text/csv;charset=utf-8',
      content: `${lines.join('\n')}\n`,
      count: rows.length,
    }
  },
}
