/**
 * Review issue lifecycle: an issue is open until the translator marks it handled
 * or ignored, and confirming the segment marks it handled implicitly.
 */
export const REVIEW_STATUSES = ['open', 'applied', 'ignored']

export function normalizeReviewStatus(value) {
  return REVIEW_STATUSES.includes(value) ? value : 'open'
}
