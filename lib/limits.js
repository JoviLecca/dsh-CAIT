/**
 * Numeric and identity limits shared by the store, persistence, the API and
 * every importer. Keeping them in one place is what makes "raise the segment
 * cap" a single edit.
 */

export const MAX_SEGMENTS = 20000
export const CAIT_VERSION = '1.1.7'
export const MAX_SEGMENT_CHARS = 20000
export const MAX_IMPORT_CHARS = 8_000_000
export const MAX_DOCX_BASE64 = 28_000_000
export const MAX_STORE_BYTES = 64 * 1024 * 1024
export const STORE_VERSION = 7
export const MT_BATCH_MAX = 8
export const STORE_FILENAME = 'store.json'
export const DEFAULT_TM_ID = 'tm_default'
export const DEFAULT_GLOSSARY_ID = 'glossary_default'
export const DEFAULT_TM_NAME = 'Default TM'
export const DEFAULT_GLOSSARY_NAME = 'Default glossary'
