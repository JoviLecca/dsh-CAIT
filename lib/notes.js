import { CatError } from './errors.js'
import { makeId, now } from './store-utils.js'

const MAX_NOTE_CHARS = 2000
const MAX_NOTES = 50

function cleanNoteAuthor(author) {
  const value = String(author ?? 'user')
    .trim()
    .slice(0, 40)
  return value || 'user'
}

/**
 * Notes are review context, not translation state: they never affect TM,
 * confirmation, QA or export. Keeping them as a small array on the segment
 * lets a reviewer leave more than one comment and lets the agent add one
 * without overwriting the human's note.
 */
export function normalizeNotes(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const notes = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const text = String(item.text ?? '').trim()
    if (!text) continue
    let id =
      typeof item.id === 'string' && /^n_[A-Za-z0-9-]{4,40}$/.test(item.id) ? item.id : makeId('n')
    while (seen.has(id)) id = makeId('n')
    seen.add(id)
    notes.push({
      id,
      text: text.slice(0, MAX_NOTE_CHARS),
      author: cleanNoteAuthor(item.author),
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : now(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now(),
    })
    if (notes.length >= MAX_NOTES) break
  }
  return notes
}

function noteView(note) {
  return { ...note }
}

function notesView(notes) {
  return (Array.isArray(notes) ? notes : []).map(noteView)
}

export const noteMethods = {
  notesForSegment({ documentId, index } = {}) {
    const doc = this.requireDocument(documentId)
    const segment = this.findSegment(doc, index)
    return { documentId: doc.id, index, notes: notesView(segment.notes) }
  },

  addSegmentNote({ documentId, index, text, author = 'user' } = {}) {
    const doc = this.requireDocument(documentId)
    const segment = this.findSegment(doc, index)
    const value = String(text ?? '').trim()
    if (!value) throw new CatError('EMPTY_NOTE', '备注内容不能为空。')
    if (Array.from(value).length > MAX_NOTE_CHARS) {
      throw new CatError('NOTE_TOO_LONG', `备注不能超过 ${MAX_NOTE_CHARS} 个字符。`)
    }
    const notes = Array.isArray(segment.notes) ? segment.notes : []
    if (notes.length >= MAX_NOTES) {
      throw new CatError('TOO_MANY_NOTES', `每个句段最多 ${MAX_NOTES} 条备注。`)
    }
    const stamp = now()
    const note = {
      id: makeId('n'),
      text: value.slice(0, MAX_NOTE_CHARS),
      author: cleanNoteAuthor(author),
      createdAt: stamp,
      updatedAt: stamp,
    }
    const previous = notes.map((item) => ({ ...item }))
    const previousUpdatedAt = segment.updatedAt
    notes.push(note)
    segment.notes = notes
    segment.updatedAt = stamp
    try {
      this.touch()
      this.persist()
    } catch (error) {
      segment.notes = previous
      segment.updatedAt = previousUpdatedAt
      throw error
    }
    return { note: noteView(note), notes: notesView(notes) }
  },

  updateSegmentNote({ documentId, index, noteId, text } = {}) {
    const doc = this.requireDocument(documentId)
    const segment = this.findSegment(doc, index)
    const notes = Array.isArray(segment.notes) ? segment.notes : []
    const note = notes.find((item) => item.id === noteId)
    if (!note) throw new CatError('NOTE_NOT_FOUND', '找不到这条备注。')
    const value = String(text ?? '').trim()
    if (!value) throw new CatError('EMPTY_NOTE', '备注内容不能为空。')
    if (Array.from(value).length > MAX_NOTE_CHARS) {
      throw new CatError('NOTE_TOO_LONG', `备注不能超过 ${MAX_NOTE_CHARS} 个字符。`)
    }
    const previous = { text: note.text, updatedAt: note.updatedAt }
    const previousSegmentUpdatedAt = segment.updatedAt
    const stamp = now()
    note.text = value.slice(0, MAX_NOTE_CHARS)
    note.updatedAt = stamp
    segment.updatedAt = stamp
    try {
      this.touch()
      this.persist()
    } catch (error) {
      note.text = previous.text
      note.updatedAt = previous.updatedAt
      segment.updatedAt = previousSegmentUpdatedAt
      throw error
    }
    return { note: noteView(note), notes: notesView(notes) }
  },

  deleteSegmentNote({ documentId, index, noteId } = {}) {
    const doc = this.requireDocument(documentId)
    const segment = this.findSegment(doc, index)
    const notes = Array.isArray(segment.notes) ? segment.notes : []
    const at = notes.findIndex((item) => item.id === noteId)
    if (at < 0) throw new CatError('NOTE_NOT_FOUND', '找不到这条备注。')
    const previous = notes.slice()
    const previousSegmentUpdatedAt = segment.updatedAt
    notes.splice(at, 1)
    segment.notes = notes
    segment.updatedAt = now()
    try {
      this.touch()
      this.persist()
    } catch (error) {
      segment.notes = previous
      segment.updatedAt = previousSegmentUpdatedAt
      throw error
    }
    return { notes: notesView(notes) }
  },
}

export { MAX_NOTE_CHARS, MAX_NOTES }
