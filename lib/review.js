import { CatError } from './errors.js'
import { briefPromptBlock, neighborContext } from './brief.js'
import { canonicalLanguage, cleanText } from './store-utils.js'
import { collectStreamText } from './mt.js'

const MAX_REVIEW_SEGMENTS = 20
const MAX_REVIEW_ISSUES = 120

function parseIssues(output, from, to) {
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
    if (!Number.isInteger(index) || index < from || index >= to) continue
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
  async reviewDocument({ documentId, from = 0, count = MAX_REVIEW_SEGMENTS } = {}) {
    const doc = this.requireDocument(documentId)
    const start = Math.max(0, Number.isInteger(from) ? from : 0)
    const size = Math.max(1, Math.min(MAX_REVIEW_SEGMENTS, Number(count) || MAX_REVIEW_SEGMENTS))
    const end = Math.min(doc.segments.length, start + size)
    if (start >= doc.segments.length) {
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
    const items = doc.segments.slice(start, end).map((segment, offset) => ({
      index: start + offset,
      segment,
    }))
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
    const issues = parseIssues(output, start, end)
    return {
      documentId: doc.id,
      documentName: doc.name,
      from: start,
      to: end,
      issues,
      provider: route.provider,
      model: route.model,
      inherited: Boolean(route.inherited),
      latencyMs: Date.now() - started,
    }
  },
}
