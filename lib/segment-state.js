/**
 * The three-state segment model: text presence plus a confirmation timestamp
 * decides status, and `origin` records where the text came from.
 */

// Segment lifecycle: nothing translated yet → a draft or a proposal exists →
// a human confirmed it. `origin` records where the current target/suggestion
// came from, which is what makes "MT filled it, I only reviewed" auditable.
export const SEGMENT_STATUSES = ['pending', 'translated', 'confirmed']
export const SEGMENT_ORIGINS = ['tm', 'mt', 'agent', 'manual', 'auto']

export function segmentStatus(segment) {
  const target = String(segment?.target ?? '')
  const suggestion = String(segment?.suggestion ?? '')
  if (target && segment?.confirmedAt) return 'confirmed'
  if (target || suggestion) return 'translated'
  return 'pending'
}

/**
 * Re-derive the stored fields from the facts (target/suggestion/confirmedAt)
 * so the three-state model cannot drift out of sync with the text.
 */
export function normalizeSegmentState(segment) {
  if (!String(segment.target ?? '')) segment.confirmedAt = null
  if (!String(segment.suggestion ?? '')) {
    segment.suggestion = ''
    segment.suggestionReason = ''
  }
  segment.status = segmentStatus(segment)
  if (segment.status === 'pending') {
    segment.origin = null
  } else if (!SEGMENT_ORIGINS.includes(segment.origin)) {
    segment.origin = 'manual'
  }
  return segment
}
