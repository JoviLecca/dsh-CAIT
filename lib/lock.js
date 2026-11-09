import { now } from './store-utils.js'

/**
 * A locked segment is a review boundary: MT, replacement and editing may not
 * change its target until the user unlocks it. The flag lives on the segment
 * so it survives reload and travels with exports that carry segment metadata.
 */
export const lockMethods = {
  setSegmentLocked({ documentId, index, locked = true } = {}) {
    const doc = this.requireDocument(documentId)
    const segment = this.findSegment(doc, index)
    const next = Boolean(locked)
    if (Boolean(segment.locked) === next) {
      return { documentId: doc.id, index: segment.index, locked: next, unchanged: true }
    }
    const previous = segment.locked
    const previousUpdatedAt = segment.updatedAt
    segment.locked = next
    segment.updatedAt = now()
    this.touch()
    try {
      this.persist()
    } catch (error) {
      segment.locked = previous
      segment.updatedAt = previousUpdatedAt
      throw error
    }
    return { documentId: doc.id, index: segment.index, locked: next }
  },
}
