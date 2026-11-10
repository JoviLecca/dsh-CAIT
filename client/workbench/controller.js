import { useState, useEffect, useMemo, useRef } from '../react.js'
import {
  SYNC_POLL_MS,
  PRETRANSLATE_BLOCK_SIZE,
  shouldAdoptRemote,
  CAIT_UNIT_VAR,
  computeCaitUnit,
  CAIT_THEME_ATTR,
  detectThemeKind,
  DEFAULT_FUZZY_THRESHOLD,
} from '../helpers.js'
import { rpc, filePayload, downloadFile, decodeBase64, copyText } from '../rpc.js'
import { UI_LANG_CODES } from '../locales.js'

// Workbench 的状态与动作。渲染层只从这里取数据，不直接调用 rpc。
export function useWorkbenchController({ i18n, translate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState('')
  const [selected, setSelected] = useState(0)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState('tm')
  const [railQuery, setRailQuery] = useState('')
  const [railFilter, setRailFilter] = useState('all')
  // Two top-level workspaces: the translator's document and the library
  // manager. The latter needs no document, so it must not be a modal.
  const [view, setView] = useState('documents')
  // A seed carries the panel's search text into the library workspace.
  const [libSeed, setLibSeed] = useState(null)

  const openLibrary = (kind, query) => {
    setLibSeed({
      kind: kind === 'glossary' ? 'glossary' : 'tm',
      query: query || '',
      nonce: Date.now(),
    })
    setView('libraries')
  }
  const [pre, setPre] = useState({ running: false, done: 0, total: 0, filled: 0, failed: 0 })
  const [qa, setQa] = useState(null)
  const [review, setReview] = useState(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [replacePreview, setReplacePreview] = useState(null)
  const [replaceUndo, setReplaceUndo] = useState(null)
  const [replaceBusy, setReplaceBusy] = useState(false)
  const [notes, setNotes] = useState(null)
  const [notesBusy, setNotesBusy] = useState(false)
  const [concordance, setConcordance] = useState(null)
  const [concordanceQuery, setConcordanceQuery] = useState('')
  const [concordanceBusy, setConcordanceBusy] = useState(false)
  const [tmQuery, setTmQuery] = useState('')
  const [tmResults, setTmResults] = useState(null)
  const [tmRefresh, setTmRefresh] = useState(0)
  const [tmError, setTmError] = useState('')
  const [mt, setMt] = useState(null)
  const [mtError, setMtError] = useState('')
  const [mtBusy, setMtBusy] = useState(false)
  const [mtRoutes, setMtRoutes] = useState({ providers: [], fallback: true, message: '' })
  const [stale, setStale] = useState(false)
  const [toast, setToast] = useState(null)
  const [modal, setModal] = useState(null)
  const textareaRef = useRef(null)
  const dirtyRef = useRef(false)
  const busyRef = useRef(false)
  const rootRef = useRef(null)
  const unitRef = useRef(0)
  const draftHistoryRef = useRef({ index: -1, stack: [], cursor: 0, lastAt: 0 })

  const doc = data?.activeDocument || null
  const segments = doc?.segments || []
  const index = doc ? Math.min(selected, Math.max(0, segments.length - 1)) : 0
  const segment = segments[index] || null
  const detail = doc?.current?.index === index ? doc.current : null
  useEffect(() => {
    draftHistoryRef.current = { index, stack: [draft], cursor: 0, lastAt: 0 }
  }, [doc?.id, index])
  const settings = data?.settings || {
    sourceLang: 'en',
    targetLang: 'zh-CN',
    fuzzyThreshold: DEFAULT_FUZZY_THRESHOLD,
    tmLimit: 5,
    uiLang: 'auto',
    mt: { provider: 'mock', model: 'cait-mock', temperature: 0.2 },
  }

  // The UI language is a plugin setting; 'auto' follows the DSH locale.
  const uiLang = UI_LANG_CODES.includes(settings.uiLang) ? settings.uiLang : 'auto'
  // A DSH language switch must re-render the workbench while 'auto' is
  // selected, so subscribe to the locale service through the entry seam.
  const [localeRevision, setLocaleRevision] = useState(0)
  useEffect(
    () =>
      i18n.subscribe
        ? i18n.subscribe(() => setLocaleRevision((revision) => revision + 1))
        : undefined,
    [i18n],
  )
  const t = useMemo(
    () => (key, vars) => translate(uiLang, key, vars),
    [translate, uiLang, localeRevision],
  )
  useEffect(() => {
    // Keep the sidebar label in sync with the in-app switch.
    i18n.set(uiLang)
  }, [i18n, uiLang])

  const adoptState = (next, forcedIndex) => {
    setData(next)
    setStale(false)
    const nextDoc = next?.activeDocument
    if (!nextDoc) {
      setSelected(0)
      setDraft('')
      setDirty(false)
      setMt(null)
      setMtError('')
      return
    }
    const nextIndex = Number.isInteger(forcedIndex)
      ? Math.min(Math.max(forcedIndex, 0), nextDoc.segments.length - 1)
      : Math.min(nextDoc.cursor, nextDoc.segments.length - 1)
    setSelected(nextIndex)
    setDraft(nextDoc.segments[nextIndex]?.target || '')
    setDirty(false)
    setMt(null)
    setMtError('')
  }

  const notify = (message, kind = 'success') => setToast({ message, kind, id: Date.now() })
  const report = (error) => notify(error?.message || t('toast.error'), 'error')
  const importNotice = (result, fallback) => {
    const warning = result?.warnings?.[0]
    if (warning) {
      const message =
        warning.code === 'TMX_INLINE_MARKUP_LOST'
          ? t('toast.tmxMarkupLost').replace('{count}', warning.count)
          : warning.message || t('toast.tmxMarkupLost').replace('{count}', warning.count)
      notify(message, 'info')
    } else {
      notify(fallback)
    }
  }

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    busyRef.current = Boolean(busy)
  }, [busy])

  const refreshStorage = async () => {
    try {
      const next = await rpc('bootstrap')
      setData((current) => (current ? { ...current, storage: next.storage } : next))
    } catch {
      // The banner already reports the persistence error; a failed refresh
      // must not replace the editor state or the user's draft.
    }
  }

  const refreshState = async () => {
    try {
      if (dirty) {
        const saved = await saveDraft(true)
        if (!saved) return
      }
      const next = await rpc('bootstrap')
      adoptState(next)
      setStale(false)
    } catch (error) {
      report(error)
    }
  }

  const preCancelRef = useRef(false)

  // The client drives pre-translation block by block instead of asking the
  // host for a background job: a block is one RPC, cancellation is simply
  // "stop looping", and every finished block is already persisted.
  const runPreTranslate = async () => {
    const active = data?.activeDocument
    if (!active || pre.running) return
    preCancelRef.current = false
    const initial = active.progress || { confirmed: 0, translated: 0, total: 0 }
    setPre({
      running: true,
      done: initial.confirmed + initial.translated,
      total: initial.total,
      filled: 0,
      failed: 0,
    })
    let from = 0
    let filled = 0
    let failed = 0
    try {
      while (from !== null) {
        if (preCancelRef.current) break
        const result = await rpc('preTranslate', {
          documentId: active.id,
          from,
          count: PRETRANSLATE_BLOCK_SIZE,
        })
        filled += result.filled
        failed += result.failed.length
        from = result.next
        const progress = result.progress
        setPre((current) => ({
          ...current,
          done: progress.confirmed + progress.translated,
          total: progress.total,
          filled,
          failed,
        }))
        await refreshState()
      }
      if (preCancelRef.current) notify(t('toast.preCancelled'))
      else if (failed) notify(t('toast.preFailed').replace('{count}', String(failed)))
      else notify(t('toast.preDone').replace('{count}', String(filled)))
    } catch (error) {
      report(error)
    } finally {
      setPre((current) => ({ ...current, running: false }))
    }
  }

  const cancelPreTranslate = () => {
    preCancelRef.current = true
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    rpc('bootstrap')
      .then((state) => {
        if (!alive) return
        adoptState(state)
        setLoadError('')
      })
      .catch((error) => {
        if (!alive) return
        setLoadError(error?.message || t('error.load'))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    let inFlight = false
    const tick = async () => {
      if (!alive || inFlight || busyRef.current) return
      inFlight = true
      try {
        const next = await rpc('bootstrap')
        if (!alive) return
        if (Number(next.revision) !== Number(data?.revision)) {
          if (
            shouldAdoptRemote({
              currentRevision: data?.revision,
              nextRevision: next.revision,
              dirty: dirtyRef.current,
            })
          ) {
            adoptState(next)
          } else if (dirtyRef.current) {
            setStale(true)
          }
        }
      } catch {
        // A transient poll failure should not replace the workbench state.
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(tick, SYNC_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [data?.revision])

  useEffect(() => {
    const id = data?.activeDocument?.id
    if (!id) {
      setQa(null)
      return
    }
    let alive = true
    rpc('getQaReport', { documentId: id })
      .then((report) => {
        if (alive) setQa(report)
      })
      .catch(() => {
        // QA is advisory: a failure must never disturb the workbench.
        if (alive) setQa(null)
      })
    return () => {
      alive = false
    }
  }, [data?.activeDocument?.id, data?.revision])

  useEffect(() => {
    setReview(null)
  }, [data?.activeDocument?.id])

  useEffect(() => {
    let alive = true
    rpc('listMtRoutes')
      .then((routes) => {
        if (alive) setMtRoutes(routes || { providers: [], fallback: true, message: '' })
      })
      .catch(() => {
        if (alive) setMtRoutes({ providers: [], fallback: true, message: '' })
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    setRailQuery('')
    setTmQuery('')
    setTmResults(null)
    setTmError('')
    setConcordance(null)
    setConcordanceQuery('')
    setReplacePreview(null)
    setReplaceUndo(null)
    setNotes(null)
  }, [doc?.id])

  useEffect(() => {
    const query = tmQuery.trim()
    if (!query) {
      setTmResults(null)
      setTmError('')
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(() => {
      rpc('lookupTM', {
        query,
        sourceLang: doc?.sourceLang,
        targetLang: doc?.targetLang,
        threshold: settings.fuzzyThreshold,
        limit: settings.tmLimit,
      })
        .then((result) => {
          if (!cancelled) {
            setTmResults(result)
            setTmError('')
          }
        })
        .catch((error) => {
          if (!cancelled) setTmError(error?.message || t('toast.error'))
        })
    }, 260)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    tmQuery,
    tmRefresh,
    doc?.id,
    doc?.sourceLang,
    doc?.targetLang,
    settings.fuzzyThreshold,
    settings.tmLimit,
  ])

  const saveDraft = async (silent = true) => {
    if (!doc || !dirty) return true
    try {
      const result = await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
      if (result.state) adoptState(result.state)
      setDirty(false)
      if (!silent) notify(t('toast.draftSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    }
  }

  const chooseSegment = async (nextIndex) => {
    if (!doc || busy || nextIndex === selected) return
    setBusy('select')
    try {
      if (dirty) {
        await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
        setDirty(false)
      }
      const result = await rpc('selectSegment', { documentId: doc.id, index: nextIndex })
      adoptState(result.state)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const changeDraft = (value) => {
    const history = draftHistoryRef.current
    if (history.index !== index) {
      history.index = index
      history.stack = [draft]
      history.cursor = 0
    }
    if (history.stack[history.cursor] !== value) {
      const now = Date.now()
      if (now - history.lastAt < 650 && history.cursor > 0) {
        history.stack[history.cursor] = value
      } else {
        history.stack = history.stack.slice(0, history.cursor + 1)
        history.stack.push(value)
        if (history.stack.length > 200) history.stack.shift()
        history.cursor = history.stack.length - 1
      }
      history.lastAt = now
    }
    setDraft(value)
    setDirty(true)
  }

  const undoDraft = () => {
    const history = draftHistoryRef.current
    if (history.cursor <= 0) return
    history.cursor -= 1
    history.lastAt = 0
    const value = history.stack[history.cursor]
    setDraft(value)
    setDirty(value !== (segment?.target || ''))
  }

  const redoDraft = () => {
    const history = draftHistoryRef.current
    if (history.cursor >= history.stack.length - 1) return
    history.cursor += 1
    history.lastAt = 0
    const value = history.stack[history.cursor]
    setDraft(value)
    setDirty(value !== (segment?.target || ''))
  }

  const confirmSegment = async () => {
    if (!doc || busy) return
    if (!draft.trim()) {
      notify(t('editor.emptyTarget'), 'error')
      textareaRef.current?.focus()
      return
    }
    setBusy('confirm')
    try {
      const result = await rpc('confirmSegment', {
        documentId: doc.id,
        index: selected,
        target: draft,
        targetTmId: data?.mounts?.defaultTmId,
      })
      adoptState(result.state)
      notify(result.done ? t('editor.done') : t('toast.confirmed'))
    } catch (error) {
      report(error)
      if (error?.code === 'PERSISTENCE_FAILED') await refreshStorage()
    } finally {
      setBusy('')
    }
  }

  const adoptSuggestion = async () => {
    if (!doc || busy || !segment?.suggestion) return
    if (dirty) {
      const saved = await saveDraft(true)
      if (!saved) return
    }
    setBusy('adopt')
    try {
      const result = await rpc('adoptSuggestion', { documentId: doc.id, index: selected })
      adoptState(result.state)
      notify(t('toast.suggestionAdopted'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const moveSegment = async (delta) => {
    if (!doc || busy) return
    setBusy('move')
    try {
      if (dirty) {
        await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
        setDirty(false)
      }
      const result = await rpc('moveSegment', { documentId: doc.id, delta })
      adoptState(result.state)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const openDocument = async (documentId) => {
    if (!documentId || documentId === doc?.id || busy) return
    setBusy('open')
    try {
      if (dirty) {
        await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
        setDirty(false)
      }
      const result = await rpc('openDocument', { documentId })
      adoptState(result.state)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const closeDocumentTab = async (documentId) => {
    if (!documentId || busy) return
    setBusy('close')
    try {
      if (dirty) {
        const saved = await saveDraft(true)
        if (!saved) return
      }
      const result = await rpc('closeDocument', { documentId })
      adoptState(result.state)
      notify(t('toast.docClosed'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const createFromForm = async (form) => {
    if (form.demo) {
      await loadDemo()
      return
    }
    setBusy('create')
    try {
      let result
      if (form.mode === 'file' && form.file) {
        const payload = await filePayload(form.file)
        result = await rpc('importFile', {
          ...payload,
          name: form.name.trim() || form.file.name,
          sourceLang: form.sourceLang,
          targetLang: form.targetLang,
          csvSourceColumn: form.csvSourceColumn,
          csvTargetColumn: form.csvTargetColumn,
        })
      } else {
        result = await rpc('createDocument', {
          name: form.name,
          text: form.text,
          sourceLang: form.sourceLang,
          targetLang: form.targetLang,
        })
      }
      adoptState(result.state)
      setModal(null)
      if (result.reused) notify(t('toast.docAlreadyOpen'))
      else importNotice(result, t('toast.imported'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const loadDemo = async () => {
    setBusy('demo')
    try {
      const result = await rpc('loadDemo')
      adoptState(result.state)
      setModal(null)
      notify(result.reused ? t('toast.docAlreadyOpen') : t('toast.created'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const applyTm = (match) => {
    setDraft(match.target)
    setDirty(true)
    setMt(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const applyTerm = (term) => {
    if (term?.forbidden) {
      notify(t('toast.termForbidden'), 'error')
      return
    }
    const separator = /^(zh|ja|ko)/i.test(doc?.targetLang || '') ? '' : ' '
    setDraft((current) => {
      const value = current.replace(/\s+$/, '')
      return value ? `${value}${separator}${term.target}` : term.target
    })
    setDirty(true)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const unconfirmCurrent = async () => {
    if (!doc || busy) return
    setBusy('unconfirm')
    try {
      if (dirty) {
        const saved = await saveDraft(true)
        if (!saved) return
      }
      const result = await rpc('unconfirmSegment', { documentId: doc.id, index: selected })
      adoptState(result.state)
      notify(t('toast.unconfirmed'))
    } catch (error) {
      // Saving a dirty confirmed segment already revokes the confirmation.
      // Treat the second call as idempotent instead of showing an error.
      if (error?.code === 'NOT_CONFIRMED') notify(t('toast.unconfirmed'))
      else report(error)
    } finally {
      setBusy('')
    }
  }

  const toggleLock = async () => {
    if (!doc || busy || !segment) return
    setBusy('lock')
    try {
      await rpc('setSegmentLocked', {
        documentId: doc.id,
        index: selected,
        locked: !segment.locked,
      })
      const next = await rpc('bootstrap')
      adoptState(next, selected)
      notify(t(segment.locked ? 'toast.unlocked' : 'toast.locked'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const mergeCurrent = () => {
    if (!doc || !segment || busy) return
    openConfirm({
      title: t('modal.confirm.mergeTitle'),
      message: t('modal.confirm.merge'),
      confirmLabel: t('editor.merge'),
      action: async () => {
        const result = await rpc('mergeSegments', { documentId: doc.id, index: selected, count: 2 })
        adoptState(result.state, result.index)
        notify(t('toast.merged'))
      },
    })
  }

  const splitCurrent = (at) => {
    if (!doc || !segment || busy) return
    openConfirm({
      title: t('modal.confirm.splitTitle'),
      message: t('modal.confirm.split'),
      confirmLabel: t('editor.split'),
      action: async () => {
        const result = await rpc('splitSegment', { documentId: doc.id, index: selected, at })
        adoptState(result.state, result.index)
        notify(t('toast.split'))
      },
    })
  }

  const mergeCue = () => {
    if (!doc || !segment || busy) return
    openConfirm({
      title: t('modal.confirm.mergeTitle'),
      message: t('modal.confirm.mergeCue'),
      confirmLabel: t('editor.mergeCue'),
      action: async () => {
        const result = await rpc('mergeCues', { documentId: doc.id, index: selected, count: 2 })
        adoptState(result.state, result.index)
        notify(t('toast.cuesMerged'))
      },
    })
  }

  const splitCueAt = (at) => {
    if (!doc || !segment || busy) return
    openConfirm({
      title: t('modal.confirm.splitTitle'),
      message: t('modal.confirm.splitCue'),
      confirmLabel: t('editor.splitCue'),
      action: async () => {
        const result = await rpc('splitCue', { documentId: doc.id, index: selected, at })
        adoptState(result.state, result.index)
        notify(t('toast.cueSplit'))
      },
    })
  }

  const shiftSubtitles = (offsetMs) => {
    if (!doc || !offsetMs || busy) return
    openConfirm({
      title: t('modal.confirm.shiftTitle'),
      message: t('modal.confirm.shiftCue'),
      confirmLabel: t('editor.shift'),
      action: async () => {
        const result = await rpc('shiftSubtitles', { documentId: doc.id, offsetMs })
        adoptState(result.state)
        notify(t('toast.subtitlesShifted'))
      },
    })
  }

  const saveBrief = async (brief) => {
    if (!doc || busy) return false
    setBusy('brief')
    try {
      const result = await rpc('setBrief', { documentId: doc.id, brief })
      adoptState(result.state)
      setModal(null)
      notify(t('toast.briefSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const saveResources = async (resources) => {
    if (!doc || busy) return false
    setBusy('resources')
    try {
      const result = await rpc('setDocumentResources', { documentId: doc.id, ...resources })
      adoptState(result.state)
      setModal(null)
      notify(t('toast.resourcesSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const openAnalysis = async () => {
    if (!doc) return
    setAnalysis(null)
    setModal({ type: 'analysis' })
    setAnalysisBusy(true)
    try {
      setAnalysis(await rpc('analyzeDocument', { documentId: doc.id }))
    } catch (error) {
      report(error)
    } finally {
      setAnalysisBusy(false)
    }
  }

  const openReplace = () => {
    if (!doc) return
    setReplacePreview(null)
    setModal({ type: 'replace' })
  }

  const previewReplace = async (form) => {
    if (!doc || replaceBusy) return
    setReplaceBusy(true)
    try {
      setReplacePreview(await rpc('replaceInDocument', { documentId: doc.id, ...form }))
    } catch (error) {
      report(error)
    } finally {
      setReplaceBusy(false)
    }
  }

  const applyReplace = async (form) => {
    if (!doc || replaceBusy) return
    setReplaceBusy(true)
    try {
      const result = await rpc('replaceInDocument', { documentId: doc.id, ...form, apply: true })
      setReplaceUndo(Array.isArray(result.undo) && result.undo.length ? result.undo : null)
      setReplacePreview(null)
      adoptState(result.state, result.undo?.[0]?.index)
      notify(t('toast.replaced').replace('{count}', String(result.applied ?? 0)))
    } catch (error) {
      report(error)
    } finally {
      setReplaceBusy(false)
    }
  }

  const undoReplace = async () => {
    if (!doc || !replaceUndo || replaceBusy) return
    setReplaceBusy(true)
    try {
      const result = await rpc('undoReplace', { documentId: doc.id, undo: replaceUndo })
      adoptState(result.state, replaceUndo[0]?.index)
      setReplaceUndo(null)
      setReplacePreview(null)
      notify(t('toast.replaceUndone'))
    } catch (error) {
      report(error)
    } finally {
      setReplaceBusy(false)
    }
  }

  const openNotes = async () => {
    if (!doc) return
    setNotes(null)
    setNotesBusy(true)
    setModal({ type: 'notes' })
    try {
      const result = await rpc('notesForSegment', { documentId: doc.id, index })
      setNotes(result.notes)
    } catch (error) {
      report(error)
    } finally {
      setNotesBusy(false)
    }
  }

  const addNote = async (text) => {
    if (!doc || notesBusy) return
    setNotesBusy(true)
    try {
      const result = await rpc('addSegmentNote', { documentId: doc.id, index, text })
      setNotes(result.notes)
      adoptState(result.state, index)
      notify(t('toast.noteSaved'))
    } catch (error) {
      report(error)
    } finally {
      setNotesBusy(false)
    }
  }

  const updateNote = async (noteId, text) => {
    if (!doc || notesBusy) return
    setNotesBusy(true)
    try {
      const result = await rpc('updateSegmentNote', { documentId: doc.id, index, noteId, text })
      setNotes(result.notes)
      adoptState(result.state, index)
      notify(t('toast.noteSaved'))
    } catch (error) {
      report(error)
    } finally {
      setNotesBusy(false)
    }
  }

  const deleteNote = async (noteId) => {
    if (!doc || notesBusy) return
    setNotesBusy(true)
    try {
      const result = await rpc('deleteSegmentNote', { documentId: doc.id, index, noteId })
      setNotes(result.notes)
      adoptState(result.state, index)
      notify(t('toast.noteDeleted'))
    } catch (error) {
      report(error)
    } finally {
      setNotesBusy(false)
    }
  }

  const refreshQa = async () => {
    if (!doc) return
    setQa(null)
    try {
      setQa(await rpc('getQaReport', { documentId: doc.id }))
    } catch {
      // QA is advisory; a failure must not disturb the editor.
    }
  }

  const jumpQa = (nextIndex) => {
    if (Number.isInteger(nextIndex)) chooseSegment(nextIndex)
  }

  const runReview = async () => {
    if (!doc || reviewBusy) return
    setReviewBusy(true)
    try {
      const result = await rpc('reviewDocument', {
        documentId: doc.id,
        from: 0,
        count: 20,
      })
      setReview(result || { issues: [] })
    } catch (error) {
      setReview(null)
      report(error)
    } finally {
      setReviewBusy(false)
    }
  }

  const applyReview = (issue) => {
    if (!doc || !issue || !Number.isInteger(issue.index)) return
    chooseSegment(issue.index)
    if (issue.suggestion) {
      setDraft(issue.suggestion)
      setDirty(true)
    }
  }

  const applyQaFix = async (item, action) => {
    if (!doc || busy || !item) return
    const segment = doc.segments[item.index]
    if (!segment) return
    let target = segment.target || ''
    if (action === 'copy-source') {
      target = segment.source
    } else if (action === 'clear') {
      target = ''
    } else if (action === 'term') {
      const term = String(item.termTarget || '')
      if (!term || target.includes(term)) return
      const separator = /[A-Za-z0-9]$/.test(target) && /^[A-Za-z0-9]/.test(term) ? ' ' : ''
      target = `${target}${separator}${term}`
    } else {
      return
    }
    setBusy('qa-fix')
    try {
      const result = await rpc('saveDraft', {
        documentId: doc.id,
        index: item.index,
        target,
      })
      if (result.state) adoptState(result.state, item.index)
      setQa(await rpc('getQaReport', { documentId: doc.id }))
      notify(t('toast.qaFixed'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const runConcordance = async () => {
    const query = concordanceQuery.trim()
    if (!doc || !query) {
      setConcordance(null)
      return
    }
    setConcordanceBusy(true)
    try {
      setConcordance(await rpc('concordance', { documentId: doc.id, query, limit: 50 }))
    } catch (error) {
      report(error)
    } finally {
      setConcordanceBusy(false)
    }
  }

  const applyConcordance = (entry) => {
    if (!entry?.target) return
    setDraft(entry.target)
    setDirty(true)
    setMt(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const editTm = async ({ id, target }) => {
    setBusy('tm-edit')
    try {
      const result = await rpc('updateTM', { id, target })
      setData(result.state)
      setTmRefresh((value) => value + 1)
      notify(t('toast.tmUpdated'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const deleteTm = (match) => {
    setModal({
      type: 'confirm',
      title: t('modal.confirm.title'),
      message: `${t('modal.confirm.deleteTm')} “${match.source} → ${match.target}”？`,
      confirmLabel: t('panel.delete'),
      action: async () => {
        const result = await rpc('deleteTM', { id: match.id })
        setData(result.state)
        setTmRefresh((value) => value + 1)
        notify(t('toast.tmDeleted'))
      },
    })
  }

  const confirmAllTranslated = () => {
    const active = data?.activeDocument
    const awaiting = active?.progress?.translated || 0
    if (!active || !awaiting) return
    setModal({
      type: 'confirm',
      title: t('rail.confirmAll'),
      message: t('rail.confirmAllMessage').replace('{count}', String(awaiting)),
      confirmLabel: t('rail.confirmAll'),
      action: async () => {
        const result = await rpc('confirmSegments', { documentId: active.id, status: 'translated' })
        await refreshState()
        setTmRefresh((value) => value + 1)
        notify(t('toast.confirmedMany').replace('{count}', String(result.confirmed.length)))
      },
    })
  }

  const propagateRepeats = () => {
    const active = data?.activeDocument
    if (!active) return
    setModal({
      type: 'confirm',
      title: t('rail.propagate'),
      message: t('rail.propagateMessage'),
      confirmLabel: t('rail.propagate'),
      action: async () => {
        const result = await rpc('propagateDocument', { documentId: active.id })
        await refreshState()
        notify(t('toast.propagated').replace('{count}', String(result.filled)))
      },
    })
  }

  const clearPretranslated = async () => {
    const active = data?.activeDocument
    if (!active) return
    try {
      const preview = await rpc('getClearUnconfirmedPreview', { documentId: active.id })
      const counts = preview?.counts || {}
      const total = counts.total || 0
      if (!total) {
        notify(t('toast.nothingToClear'), 'info')
        return
      }
      setModal({
        type: 'confirm',
        title: t('modal.confirm.clearPretranslatedTitle'),
        message: t('modal.confirm.clearPretranslatedMessage')
          .replace('{count}', String(total))
          .replace('{mt}', String(counts.mt || 0))
          .replace('{tm}', String(counts.tm || 0))
          .replace('{auto}', String(counts.auto || 0)),
        confirmLabel: t('modal.confirm.clearPretranslatedConfirm').replace(
          '{count}',
          String(total),
        ),
        action: async () => {
          const result = await rpc('clearUnconfirmedTranslations', {
            documentId: active.id,
            confirm: true,
          })
          adoptState(result.state, result.cursor)
          notify(t('toast.pretranslatedCleared').replace('{count}', String(result.cleared)))
        },
      })
    } catch (error) {
      report(error)
    }
  }

  const addTerm = async (form) => {
    setBusy('term')
    try {
      const result = await rpc('addGlossary', {
        ...form,
        sourceLang: doc?.sourceLang || settings.sourceLang,
        glossaryId: data?.mounts?.defaultGlossaryId,
      })
      setData(result.state)
      notify(t('toast.termSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const deleteTerm = (term) => {
    setModal({
      type: 'confirm',
      title: t('modal.confirm.title'),
      message: `${t('modal.confirm.deleteTerm')} “${term.source} → ${term.target}”？`,
      confirmLabel: t('panel.delete'),
      action: async () => {
        const result = await rpc('deleteGlossary', { id: term.id })
        setData(result.state)
        notify(t('toast.termDeleted'))
      },
    })
  }

  const importTmxFile = async (file) => {
    setBusy('tm-import')
    try {
      const text = await file.text()
      const result = await rpc('importTmx', {
        text,
        importAs: 'tm',
        sourceLang: doc?.sourceLang || settings.sourceLang,
        targetLang: doc?.targetLang || settings.targetLang,
        tmId: data?.mounts?.defaultTmId,
      })
      setData(result.state)
      importNotice(result, `${t('toast.tmImported')} · +${result.added} / ~${result.updated}`)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const importGlossaryFile = async (file) => {
    setBusy('glossary-import')
    try {
      const text = await file.text()
      const result = await rpc('importGlossary', {
        text,
        glossaryId: data?.mounts?.defaultGlossaryId,
      })
      setData(result.state)
      notify(`${t('toast.glossaryImported')} · +${result.added} / ~${result.updated}`)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const generateMt = async () => {
    if (!doc || !segment || mtBusy) return
    setMtBusy(true)
    setMtError('')
    try {
      const result = await rpc('mtSuggest', {
        text: segment.source,
        documentId: doc.id,
        index: selected,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
      })
      setMt(result)
      notify(t('toast.mtReady'), 'info')
    } catch (error) {
      setMtError(error?.message || t('toast.error'))
    } finally {
      setMtBusy(false)
    }
  }

  const saveSettings = async (patch) => {
    setBusy('settings')
    try {
      const result = await rpc('saveSettings', patch)
      setData(result.state)
      setModal(null)
      notify(t('toast.settingsSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const setMounts = async (patch) => {
    setBusy('mounts')
    try {
      const result = await rpc('setMounts', patch)
      setData(result.state)
      setTmResults(null)
      notify(t('libraries.mountSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const createLibrary = async ({ kind, name }) => {
    setBusy('library')
    try {
      const result = await rpc('createLibrary', { kind, name })
      setData(result.state)
      notify(t('libraries.created'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const renameLibrary = async ({ kind, id, name }) => {
    setBusy('library')
    try {
      const result = await rpc('renameLibrary', { kind, id, name })
      setData(result.state)
      notify(t('libraries.renamed'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const deleteLibrary = ({ kind, id, name }) => {
    const entries = kind === 'tm' ? t('libraries.deleteTmWarn') : t('libraries.deleteGlossaryWarn')
    setModal({
      type: 'confirm',
      title: t('modal.confirm.title'),
      message: `${t('libraries.delete')} “${name}”？${entries}`,
      confirmLabel: t('libraries.delete'),
      action: async () => {
        const result = await rpc('deleteLibrary', { kind, id })
        setData(result.state)
        setTmResults(null)
        notify(t('libraries.deleted'))
      },
    })
  }

  const exportAs = async (format) => {
    if (!doc) return
    setBusy('export')
    try {
      const result = await rpc('exportDocument', { format, documentId: doc.id })
      const content = result.encoding === 'base64' ? decodeBase64(result.content) : result.content
      downloadFile(result.filename, content, result.mime)
      notify(t('toast.exported'))
      setModal(null)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const importReview = (file) => {
    if (!doc || !file) return
    const reader = new FileReader()
    reader.onload = async () => {
      setBusy('review')
      try {
        const result = await rpc('applyXliffReview', {
          documentId: doc.id,
          text: String(reader.result || ''),
        })
        adoptState(result.state)
        notify(
          t('toast.reviewApplied')
            .replace('{applied}', String(result.applied))
            .replace('{unmatched}', String(result.unmatched + result.sourceMismatch)),
        )
        setModal(null)
      } catch (error) {
        report(error)
      } finally {
        setBusy('')
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  const openConfirm = (state) => setModal({ type: 'confirm', ...state })

  const clearTm = () =>
    openConfirm({
      title: t('modal.confirm.title'),
      message: t('modal.confirm.clearTm'),
      confirmLabel: t('panel.clearTm'),
      action: async () => {
        const result = await rpc('clearTM', { tmIds: data?.mounts?.tmIds || [], confirm: true })
        setData(result.state)
        setTmResults(null)
        notify(t('toast.tmCleared'))
      },
    })

  const clearGlossary = () =>
    openConfirm({
      title: t('modal.confirm.title'),
      message: t('modal.confirm.clearGlossary'),
      confirmLabel: t('panel.clearGlossary'),
      action: async () => {
        const result = await rpc('clearGlossary', {
          glossaryIds: data?.mounts?.glossaryIds || [],
          confirm: true,
        })
        setData(result.state)
        notify(t('toast.glossaryCleared'))
      },
    })

  const runConfirm = async () => {
    if (!modal?.action) return
    setBusy('confirm-action')
    try {
      await modal.action()
      setModal(null)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const copy = async (value) => {
    try {
      await copyText(value)
      notify(t('toast.copied'))
    } catch (error) {
      report(error)
    }
  }

  const openIds = new Set((data?.openDocuments || []).map((item) => item.id))
  const closedDocuments = (data?.documents || []).filter((item) => !openIds.has(item.id))
  const qaRisk = (qa?.risks || []).find((item) => item.index === index) || null

  const deleteClosedDocument = (document) =>
    openConfirm({
      title: t('doc.deleteTitle'),
      message: t('doc.deleteMessage').replace('{name}', document.name),
      confirmLabel: t('doc.delete'),
      action: async () => {
        const result = await rpc('deleteDocument', { documentId: document.id })
        adoptState(result.state)
        notify(t('toast.docDeleted'))
      },
    })

  const clearClosedDocuments = () =>
    openConfirm({
      title: t('doc.cleanTitle'),
      message: t('doc.cleanAllMessage').replace('{count}', String(closedDocuments.length)),
      confirmLabel: t('doc.cleanAll'),
      action: async () => {
        let lastState = null
        for (const document of closedDocuments) {
          const result = await rpc('deleteDocument', { documentId: document.id })
          lastState = result.state
        }
        if (lastState) adoptState(lastState)
        notify(t('toast.docsCleared').replace('{count}', String(closedDocuments.length)))
      },
    })

  // Track the size DSH gives the panel and publish it as a CSS unit. The
  // observer watches the stable root element and writes the property
  // directly, so resizing never triggers a React render.
  useEffect(() => {
    const element = rootRef.current
    if (!element) return undefined
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const unit = computeCaitUnit({ width: rect.width, height: rect.height })
      if (Math.abs(unit - unitRef.current) < 0.002) return
      unitRef.current = unit
      element.style.setProperty(CAIT_UNIT_VAR, String(unit))
    }
    measure()

    // Mirror the host theme so native widgets follow `color-scheme`. DSH
    // toggles the marker on <body>, so observe that instead of guessing
    // from colours.
    const syncTheme = () => {
      const kind = detectThemeKind(document)
      if (element.getAttribute(CAIT_THEME_ATTR) !== kind)
        element.setAttribute(CAIT_THEME_ATTR, kind)
    }
    syncTheme()
    let themeObserver = null
    if (typeof MutationObserver !== 'undefined' && document.body) {
      themeObserver = new MutationObserver(syncTheme)
      themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-ds-dark-theme', 'data-theme', 'class'],
      })
    }
    const stopTheme = () => {
      if (themeObserver) themeObserver.disconnect()
    }

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => {
        window.removeEventListener('resize', measure)
        stopTheme()
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      stopTheme()
    }
  }, [])

  useEffect(() => {
    const onKey = (event) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        setModal((current) => (current?.type === 'palette' ? null : { type: 'palette' }))
      } else if (key === 'f' && doc && !modal) {
        event.preventDefault()
        openReplace()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc?.id, modal])

  return {
    data,
    setData,
    loading,
    loadError,
    busy,
    selected,
    draft,
    setDraft,
    dirty,
    setDirty,
    tab,
    setTab,
    railQuery,
    setRailQuery,
    railFilter,
    setRailFilter,
    view,
    setView,
    libSeed,
    openLibrary,
    pre,
    qa,
    review,
    reviewBusy,
    analysis,
    analysisBusy,
    replacePreview,
    replaceUndo,
    replaceBusy,
    notes,
    notesBusy,
    concordance,
    concordanceQuery,
    setConcordanceQuery,
    concordanceBusy,
    tmQuery,
    setTmQuery,
    tmResults,
    tmError,
    mt,
    mtError,
    mtBusy,
    mtRoutes,
    stale,
    toast,
    modal,
    setModal,
    textareaRef,
    rootRef,
    draftHistoryRef,
    doc,
    index,
    segment,
    detail,
    settings,
    t,
    notify,
    report,
    refreshState,
    runPreTranslate,
    cancelPreTranslate,
    saveDraft,
    chooseSegment,
    changeDraft,
    undoDraft,
    redoDraft,
    confirmSegment,
    adoptSuggestion,
    moveSegment,
    openDocument,
    closeDocumentTab,
    createFromForm,
    loadDemo,
    applyTm,
    applyTerm,
    unconfirmCurrent,
    toggleLock,
    mergeCurrent,
    splitCurrent,
    mergeCue,
    splitCueAt,
    shiftSubtitles,
    saveBrief,
    saveResources,
    openAnalysis,
    openReplace,
    previewReplace,
    applyReplace,
    undoReplace,
    openNotes,
    addNote,
    updateNote,
    deleteNote,
    refreshQa,
    jumpQa,
    runReview,
    applyReview,
    applyQaFix,
    runConcordance,
    applyConcordance,
    editTm,
    deleteTm,
    confirmAllTranslated,
    propagateRepeats,
    clearPretranslated,
    addTerm,
    deleteTerm,
    importTmxFile,
    importGlossaryFile,
    generateMt,
    saveSettings,
    setMounts,
    createLibrary,
    renameLibrary,
    deleteLibrary,
    exportAs,
    importReview,
    openConfirm,
    clearTm,
    clearGlossary,
    runConfirm,
    copy,
    closedDocuments,
    qaRisk,
    deleteClosedDocument,
    clearClosedDocuments,
  }
}
