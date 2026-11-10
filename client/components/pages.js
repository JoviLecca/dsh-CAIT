import { h, useState, useEffect, useRef } from '../react.js'
import { PAGE_SIZE_OPTIONS, readPageSize, writePageSize, pageBounds } from '../helpers.js'
import { rpc, downloadFile } from '../rpc.js'
import { Spinner, Icon } from './base.js'

function AlignPage({ t, data, notify, report, onConfirm }) {
  const [sourceFile, setSourceFile] = useState(null)
  const [targetFile, setTargetFile] = useState(null)
  const [sourceLang, setSourceLang] = useState('')
  const [targetLang, setTargetLang] = useState('')
  const [result, setResult] = useState(null)
  const [rows, setRows] = useState([])
  const [working, setWorking] = useState(false)
  const [tmId, setTmId] = useState('')
  const sourceRef = useRef(null)
  const targetRef = useRef(null)
  const libraries = data?.tmLibraries || []
  const languageOptions = [
    'zh-CN',
    'zh-TW',
    'en',
    'ja',
    'ko',
    'fr',
    'de',
    'es',
    'pt-BR',
    'ru',
    'it',
    'ar',
  ]

  useEffect(() => {
    if (!tmId && libraries.length) setTmId(libraries[0].id)
  }, [libraries.length])

  const readBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error(t('align.readError')))
      reader.onload = () => {
        const value = String(reader.result || '')
        const comma = value.indexOf(',')
        resolve(comma >= 0 ? value.slice(comma + 1) : '')
      }
      reader.readAsDataURL(file)
    })

  const pick = async (which, file) => {
    if (!file) return
    setWorking(true)
    try {
      const uploaded = await rpc('readUploadText', {
        name: file.name,
        base64: await readBase64(file),
      })
      const picked = { name: uploaded.name, text: uploaded.text, chars: uploaded.chars }
      if (which === 'source') setSourceFile(picked)
      else setTargetFile(picked)
    } catch (error) {
      report(error)
    } finally {
      setWorking(false)
    }
  }

  const run = async () => {
    if (!sourceFile || !targetFile) {
      notify(t('align.needFiles'), true)
      return
    }
    setWorking(true)
    try {
      const aligned = await rpc('alignUploads', {
        sourceFile: { name: sourceFile.name, text: sourceFile.text },
        targetFile: { name: targetFile.name, text: targetFile.text },
        sourceLang,
        targetLang,
      })
      setResult(aligned)
      setRows(aligned.rows.map((row) => ({ ...row, include: row.confidence === 'high' })))
    } catch (error) {
      report(error)
    } finally {
      setWorking(false)
    }
  }

  const updateRow = (at, patch) =>
    setRows((current) =>
      current.map((row, position) => (position === at ? { ...row, ...patch } : row)),
    )

  const removeRow = (at) =>
    setRows((current) => current.filter((_row, position) => position !== at))

  const mergeRow = (at) =>
    setRows((current) => {
      const head = current[at]
      const next = current[at + 1]
      if (!head || !next) return current
      const merged = {
        ...head,
        target: [head.target, next.target].filter(Boolean).join(' '),
        include: head.include,
        merged: true,
      }
      return [...current.slice(0, at), merged, ...current.slice(at + 2)]
    })

  const splitRow = (at) =>
    setRows((current) => {
      const row = current[at]
      if (!row || !row.target) return current
      const parts = String(row.target).split(/\n+/).filter(Boolean)
      if (parts.length < 2) return current
      const replacement = parts.map((part) => ({ ...row, target: part }))
      return [...current.slice(0, at), ...replacement, ...current.slice(at + 1)]
    })

  const write = async () => {
    const pairs = rows
      .filter((row) => row.include && row.source && row.target)
      .map((row) => ({ source: row.source, target: row.target, sourceLang, targetLang }))
    if (!pairs.length) {
      notify(t('align.nothing'), true)
      return
    }
    onConfirm({
      title: t('align.write'),
      message: t('align.writeMessage', { count: pairs.length }),
      action: async () => {
        setWorking(true)
        try {
          const written = await rpc('writeAlignment', {
            pairs,
            tmId: tmId || undefined,
            sourceLang: sourceLang || undefined,
            targetLang: targetLang || undefined,
          })
          notify(t('align.written', { written: written.written, skipped: written.skipped }))
        } catch (error) {
          report(error)
        } finally {
          setWorking(false)
        }
      },
    })
  }

  const included = rows.filter((row) => row.include && row.source && row.target).length
  const fileCard = (which, file, ref) =>
    h(
      'div',
      { className: 'cait-alignfile' },
      h(
        'span',
        { className: 'cait-alignlabel' },
        t(which === 'source' ? 'align.sourceFile' : 'align.targetFile'),
      ),
      h(
        'span',
        { className: `cait-alignname${file ? '' : ' empty'}` },
        file ? file.name : t('align.pick'),
      ),
      h(
        'span',
        { className: 'cait-alignmeta' },
        file ? t('align.chars', { count: file.chars }) : '',
      ),
      h('input', {
        ref,
        type: 'file',
        accept: '.txt,.md,.docx,.epub,.html,.htm,.xlsx,.pptx,.csv,.srt,.vtt,.po,.json,.rtf,.xliff',
        style: { display: 'none' },
        onChange: (event) => {
          const chosen = event.target.files && event.target.files[0]
          pick(which, chosen)
          event.target.value = ''
        },
      }),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn',
          onClick: () => ref.current && ref.current.click(),
          disabled: working,
        },
        h(Icon, { name: 'folder', size: 13 }),
        h('span', { className: 'cait-btn-label' }, t('align.choose')),
      ),
    )

  return h(
    'div',
    { className: 'cait-alignpage' },
    h(
      'div',
      { className: 'cait-alignhead' },
      h(
        'div',
        null,
        h('h2', null, t('align.title')),
        h('p', { className: 'cait-mt-hint' }, t('align.hint')),
      ),
      h(
        'div',
        { className: 'cait-alignactions' },
        h(
          'datalist',
          { id: 'cait-align-languages' },
          languageOptions.map((code) => h('option', { key: code, value: code })),
        ),
        h('input', {
          className: 'cait-libinput',
          placeholder: t('align.sourceLang'),
          title: t('align.langHint'),
          list: 'cait-align-languages',
          value: sourceLang,
          onChange: (event) => setSourceLang(event.target.value),
        }),
        h('input', {
          className: 'cait-libinput',
          placeholder: t('align.targetLang'),
          title: t('align.langHint'),
          list: 'cait-align-languages',
          value: targetLang,
          onChange: (event) => setTargetLang(event.target.value),
        }),
        h(
          'select',
          {
            className: 'cait-select cait-liblang',
            value: tmId,
            onChange: (event) => setTmId(event.target.value),
            title: t('align.tmHint'),
            'aria-label': t('align.tm'),
            disabled: !libraries.length,
          },
          libraries.length
            ? libraries.map((library) =>
                h(
                  'option',
                  { key: library.id, value: library.id },
                  t('align.tmOption', { name: library.name }),
                ),
              )
            : h('option', { value: '' }, t('align.noTm')),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'cait-btn cait-btn-primary',
            onClick: run,
            disabled: working || !sourceFile || !targetFile,
          },
          h(Icon, { name: 'align', size: 13 }),
          h('span', { className: 'cait-btn-label' }, working ? t('align.running') : t('align.run')),
        ),
      ),
    ),
    h(
      'div',
      { className: 'cait-alignfiles' },
      fileCard('source', sourceFile, sourceRef),
      fileCard('target', targetFile, targetRef),
    ),
    result
      ? h(
          'div',
          { className: 'cait-alignstats' },
          h(
            'span',
            null,
            t('align.stats', {
              high: result.high,
              medium: result.medium,
              low: result.low,
            }),
          ),
          h('span', null, `${t('align.unpairedSource')}: ${result.unpairedSource}`),
          h('span', null, `${t('align.unpairedTarget')}: ${result.unpairedTarget}`),
          result.blocked ? h('span', { className: 'cait-alignwarn' }, t('align.blocked')) : null,
          h(
            'button',
            {
              type: 'button',
              className: 'cait-btn',
              onClick: write,
              disabled: working || !included,
            },
            h(Icon, { name: 'check', size: 13 }),
            h('span', { className: 'cait-btn-label' }, t('align.writeCount', { count: included })),
          ),
        )
      : null,
    rows.length
      ? h(
          'div',
          { className: 'cait-libtable-wrap cait-aligntable-wrap' },
          h(
            'table',
            { className: 'cait-libtable cait-aligntable' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', null, ''),
                h('th', null, t('align.sourceFile')),
                h('th', null, t('align.targetFile')),
                h('th', null, t('align.confidence')),
                h('th', null, ''),
              ),
            ),
            h(
              'tbody',
              null,
              rows.map((row, at) =>
                h(
                  'tr',
                  {
                    key: `${row.sourceIndex}-${row.targetIndex}-${at}`,
                    className: row.include ? 'included' : '',
                  },
                  h(
                    'td',
                    null,
                    h('input', {
                      type: 'checkbox',
                      checked: Boolean(row.include),
                      onChange: (event) => updateRow(at, { include: event.target.checked }),
                    }),
                  ),
                  h('td', null, row.source),
                  h('td', null, row.target || h('span', { className: 'cait-alignmissing' }, '—')),
                  h(
                    'td',
                    null,
                    h(
                      'span',
                      { className: `cait-confidence ${row.confidence}` },
                      `${Math.round(row.score * 100)}%`,
                    ),
                  ),
                  h(
                    'td',
                    { className: 'cait-alignrow-actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-minibtn',
                        title: t('align.merge'),
                        onClick: () => mergeRow(at),
                      },
                      h(Icon, { name: 'chevronDown', size: 12 }),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-minibtn',
                        title: t('align.split'),
                        onClick: () => splitRow(at),
                      },
                      h(Icon, { name: 'chevronRight', size: 12 }),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-minibtn cait-deletebtn',
                        title: t('align.remove'),
                        onClick: () => removeRow(at),
                      },
                      h(Icon, { name: 'trash', size: 12 }),
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,
  )
}

function LibraryPage({
  t,
  data,
  settings,
  busy,
  notify,
  report,
  seed,
  onApplyState,
  onConfirm,
  onCreateLibrary,
  onRenameLibrary,
  onDeleteLibrary,
  onSetMounts,
}) {
  const storage = typeof localStorage !== 'undefined' ? localStorage : null
  const [kind, setKind] = useState(seed?.kind === 'glossary' ? 'glossary' : 'tm')
  const [scopeIds, setScopeIds] = useState([])
  const [query, setQuery] = useState(seed?.query || '')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [lang, setLang] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => readPageSize(storage))
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState(null)
  const [renamingId, setRenamingId] = useState('')
  const [renameText, setRenameText] = useState('')
  const [newLibraryName, setNewLibraryName] = useState('')
  const [adding, setAdding] = useState(false)
  const [exportFormat, setExportFormat] = useState('tbx')
  const [terms, setTerms] = useState(null)
  const fileRef = useRef(null)
  const importMode = useRef('')

  const libraries = (kind === 'tm' ? data?.libraries?.tm : data?.libraries?.glossary) || []
  const idKey = kind === 'tm' ? 'tmId' : 'glossaryId'
  const labelKey = 'name'
  const scopeKey = scopeIds.join(',')
  const defaultWriteId = kind === 'tm' ? data?.mounts?.defaultTmId : data?.mounts?.defaultGlossaryId
  const targetLibraryId = libraries.some((library) => library[idKey] === defaultWriteId)
    ? defaultWriteId
    : libraries[0]?.[idKey] || ''

  const changeWriteLibrary = async (value) => {
    if (!value || value === targetLibraryId) return
    // A default must also be mounted; adding it here keeps the selector
    // from failing when the chosen library was only in the list view.
    if (kind === 'tm') {
      const tmIds = Array.from(new Set([...(data?.mounts?.tmIds || []), value]))
      await onSetMounts?.({ tmIds, defaultTmId: value })
    } else {
      const glossaryIds = Array.from(new Set([...(data?.mounts?.glossaryIds || []), value]))
      await onSetMounts?.({ glossaryIds, defaultGlossaryId: value })
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  // The panel can jump into the library with its current search text; a
  // fresh nonce means "apply this seed now" even when the values repeat.
  useEffect(() => {
    if (!seed) return
    setKind(seed.kind === 'glossary' ? 'glossary' : 'tm')
    setQuery(seed.query || '')
    setPage(1)
  }, [seed?.nonce])

  // Switching kind resets the scope: library ids are not interchangeable.
  useEffect(() => {
    setScopeIds([])
    setPage(1)
    setSelectedId('')
    setLang('')
  }, [kind])

  const loadRows = async () => {
    setLoading(true)
    try {
      const params =
        kind === 'tm'
          ? { tmIds: scopeIds, query: debouncedQuery, page, pageSize }
          : { glossaryIds: scopeIds, query: debouncedQuery, page, pageSize }
      if (lang) params.sourceLang = lang
      const result = await rpc(kind === 'tm' ? 'listTmEntries' : 'listGlossaryEntries', params)
      setRows(result)
      if (result.page !== page) setPage(result.page)
    } catch (error) {
      report(error)
      setRows(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    const run = async () => {
      if (!alive) return
      await loadRows()
    }
    run()
    return () => {
      alive = false
    }
  }, [kind, scopeKey, debouncedQuery, lang, page, pageSize, data?.revision])

  useEffect(() => {
    const entry = (rows?.entries || []).find((item) => item.id === selectedId)
    setDraft(entry ? { ...entry } : null)
  }, [selectedId, rows])

  const dirty =
    draft &&
    rows?.entries?.some(
      (item) =>
        item.id === draft.id &&
        (item.source !== draft.source ||
          item.target !== draft.target ||
          (item.note || '') !== (draft.note || '') ||
          Boolean(item.caseSensitive) !== Boolean(draft.caseSensitive)),
    )

  const selectKind = (next) => setKind(next)

  const mineTerms = async () => {
    const active = data?.activeDocument
    if (!active) {
      notify(t('term.noDoc'), true)
      return
    }
    setWorking('terms')
    try {
      const mined = await rpc('termCandidates', { documentId: active.id, limit: 60 })
      setTerms(
        mined.candidates.map((candidate) => ({
          ...candidate,
          picked: false,
          target: candidate.evidence[0] || '',
        })),
      )
    } catch (error) {
      report(error)
    } finally {
      setWorking('')
    }
  }

  const toggleTerm = (index) =>
    setTerms((current) =>
      current.map((item, position) =>
        position === index ? { ...item, picked: !item.picked } : item,
      ),
    )

  const setTermTarget = (index, value) =>
    setTerms((current) =>
      current.map((item, position) =>
        position === index ? { ...item, target: value, picked: true } : item,
      ),
    )

  const addMinedTerms = async () => {
    const picked = (terms || []).filter((item) => item.picked && item.target.trim())
    if (!picked.length) return
    setWorking('terms')
    try {
      const result = await rpc('addGlossaryEntries', {
        glossaryId: targetLibraryId || undefined,
        entries: picked.map((item) => ({
          source: item.term,
          target: item.target.trim(),
          sourceLang: settings.sourceLang,
        })),
      })
      if (result?.state) onApplyState(result.state)
      notify(t('term.added', { added: result.added }))
      setTerms(null)
      await loadRows()
    } catch (error) {
      report(error)
    } finally {
      setWorking('')
    }
  }

  const toggleScope = (id) => {
    setPage(1)
    setScopeIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const allLanguages = rows?.languages
    ? [...new Set([...(rows.languages.source || []), ...(rows.languages.target || [])])].filter(
        Boolean,
      )
    : []

  const changePageSize = (value) => {
    const size = writePageSize(storage, value)
    setPageSize(size)
    setPage(1)
  }

  const saveEntry = async () => {
    if (!draft) return
    setWorking('save')
    try {
      const result =
        kind === 'tm'
          ? await rpc('updateTM', {
              id: draft.id,
              source: draft.source,
              target: draft.target,
              note: draft.note,
            })
          : await rpc('updateGlossary', {
              id: draft.id,
              source: draft.source,
              target: draft.target,
              note: draft.note,
              sourceLang: draft.sourceLang,
              caseSensitive: Boolean(draft.caseSensitive),
            })
      if (result?.state) onApplyState(result.state)
      notify(t('library.entrySaved'))
      setAdding(false)
      await loadRows()
    } catch (error) {
      report(error)
    } finally {
      setWorking('')
    }
  }

  const addEntry = async () => {
    if (!draft) return
    setWorking('add')
    try {
      const result =
        kind === 'tm'
          ? await rpc('addTM', {
              source: draft.source,
              target: draft.target,
              tmId: targetLibraryId,
              sourceLang: draft.sourceLang || settings.sourceLang,
              targetLang: draft.targetLang || settings.targetLang,
            })
          : await rpc('addGlossary', {
              source: draft.source,
              target: draft.target,
              note: draft.note,
              glossaryId: targetLibraryId,
              sourceLang: draft.sourceLang || '',
              caseSensitive: Boolean(draft.caseSensitive),
            })
      if (result?.state) onApplyState(result.state)
      notify(t('library.entryCreated'))
      setAdding(false)
      setSelectedId('')
      await loadRows()
    } catch (error) {
      report(error)
    } finally {
      setWorking('')
    }
  }

  const deleteEntry = () => {
    if (!draft || adding) return
    onConfirm({
      title: t('library.deleteEntry'),
      message: kind === 'tm' ? t('modal.confirm.deleteTm') : t('library.deleteEntry'),
      confirmLabel: t('library.deleteEntry'),
      action: async () => {
        const result = await rpc(kind === 'tm' ? 'deleteTM' : 'deleteGlossary', { id: draft.id })
        if (result?.state) onApplyState(result.state)
        setSelectedId('')
        notify(t('library.entryDeleted'))
        await loadRows()
      },
    })
  }

  const clearLibrary = () => {
    if (!targetLibraryId) return
    onConfirm({
      title: t('library.clear'),
      message: t('modal.confirm.clearTm'),
      confirmLabel: t('library.clear'),
      action: async () => {
        const result =
          kind === 'tm'
            ? await rpc('clearTM', { tmIds: [targetLibraryId], confirm: true })
            : await rpc('clearGlossary', { glossaryIds: [targetLibraryId], confirm: true })
        if (result?.state) onApplyState(result.state)
        setSelectedId('')
        await loadRows()
      },
    })
  }

  const maintainTm = async (action) => {
    if (!targetLibraryId) return
    try {
      const preview = await rpc('tmMaintenancePreview', {
        action,
        tmId: targetLibraryId,
        emptyTarget: true,
      })
      const count = action === 'dedupe' ? preview.duplicates : preview.matched
      onConfirm({
        title: t(`tm.maintain.${action}`),
        message: t(`tm.maintain.${action}Hint`, { count }),
        confirmLabel: t(`tm.maintain.${action}`),
        action: async () => {
          const result = await rpc(action === 'dedupe' ? 'dedupeTmLibrary' : 'pruneTmLibrary', {
            tmId: targetLibraryId,
            emptyTarget: true,
            confirm: true,
          })
          if (result?.state) onApplyState(result.state)
          await loadRows()
          notify(t('tm.maintain.done', { count: count }))
        },
      })
    } catch (error) {
      report(error)
    }
  }

  const exportLibrary = async () => {
    if (!targetLibraryId) return
    setWorking('export')
    try {
      const result =
        kind === 'tm'
          ? await rpc('exportTM', { tmId: targetLibraryId, format: 'tmx' })
          : await rpc('exportGlossary', { glossaryId: targetLibraryId, format: exportFormat })
      downloadFile(result.filename, result.content, result.mime)
      notify(t('library.exported'))
    } catch (error) {
      report(error)
    } finally {
      setWorking('')
    }
  }

  const pickImport = (mode) => {
    importMode.current = mode
    if (fileRef.current) {
      fileRef.current.value = ''
      fileRef.current.click()
    }
  }

  const runImport = async (file) => {
    if (!file || !targetLibraryId) return
    setWorking('import')
    try {
      const text = await file.text()
      if (importMode.current === 'glossary') {
        const result = await rpc('importGlossary', { text, glossaryId: targetLibraryId })
        if (result?.state) onApplyState(result.state)
        notify(`${t('toast.glossaryImported')} · +${result.added} / ~${result.updated}`)
      } else {
        const result = await rpc('importTmx', {
          text,
          importAs: 'tm',
          tmId: targetLibraryId,
          sourceLang: kind === 'tm' ? undefined : settings.sourceLang,
          targetLang: settings.targetLang,
        })
        if (result?.state) onApplyState(result.state)
        notify(`${t('toast.tmImported')} · +${result.added} / ~${result.updated}`)
      }
      await loadRows()
    } catch (error) {
      report(error)
    } finally {
      setWorking('')
    }
  }

  const submitRename = async (library) => {
    const name = renameText.trim()
    setRenamingId('')
    if (!name || name === library[labelKey]) return
    await onRenameLibrary({ kind, id: library[idKey], name })
  }

  const submitNewLibrary = async () => {
    const name = newLibraryName.trim()
    if (!name) return
    const ok = await onCreateLibrary({ kind, name })
    if (ok) setNewLibraryName('')
  }

  const confirmDeleteLibrary = (library) => {
    if (libraries.length <= 1) return
    onConfirm({
      title: t('library.deleteLibrary'),
      message: t('library.deleteLibraryMessage', { name: library[labelKey] }),
      confirmLabel: t('library.deleteLibrary'),
      action: async () => {
        await onDeleteLibrary({ kind, id: library[idKey], name: library[labelKey] })
        if (scopeIds.includes(library[idKey])) {
          setScopeIds((current) => current.filter((item) => item !== library[idKey]))
        }
      },
    })
  }

  const startAdding = () => {
    setAdding(true)
    setSelectedId('')
    setDraft(
      kind === 'tm'
        ? {
            id: '',
            source: '',
            target: '',
            note: '',
            sourceLang: settings.sourceLang,
            targetLang: settings.targetLang,
          }
        : {
            id: '',
            source: '',
            target: '',
            note: '',
            sourceLang: settings.sourceLang,
            caseSensitive: false,
          },
    )
  }

  const bounds = pageBounds(rows?.page || 1, rows?.total || 0, rows?.pageSize || pageSize)
  const contextLabel = (entry) =>
    entry.context ? `${entry.context.prev || '—'} · ${entry.context.next || '—'}` : '—'
  const columns =
    kind === 'tm'
      ? [
          t('library.colSource'),
          t('library.colTarget'),
          t('library.colNote'),
          t('library.colContext'),
          t('library.colLang'),
          t('library.colUpdated'),
        ]
      : [
          t('library.colSource'),
          t('library.colTarget'),
          t('library.colNote'),
          t('library.colLang'),
          t('library.colCase'),
          t('library.colUpdated'),
        ]

  return h(
    'div',
    { className: 'cait-libpage' },
    h(
      'div',
      { className: 'cait-libpage-head' },
      h(
        'div',
        { className: 'cait-libtabs' },
        h(
          'button',
          {
            className: `cait-libtabs-item${kind === 'tm' ? ' active' : ''}`,
            onClick: () => selectKind('tm'),
          },
          t('library.tmTab'),
          h('span', { className: 'cait-libtabs-count' }, data?.libraries?.tm?.length || 0),
        ),
        h(
          'button',
          {
            className: `cait-libtabs-item${kind === 'glossary' ? ' active' : ''}`,
            onClick: () => selectKind('glossary'),
          },
          t('library.glossaryTab'),
          h('span', { className: 'cait-libtabs-count' }, data?.libraries?.glossary?.length || 0),
        ),
      ),
      h('span', { className: 'cait-libhint' }, t('library.noDocHint')),
    ),
    h(
      'div',
      { className: 'cait-libpage-body' },
      h(
        'div',
        { className: 'cait-liblist' },
        h('div', { className: 'cait-liblist-head' }, t('library.title')),
        libraries.map((library) =>
          h(
            'div',
            {
              key: library[idKey],
              className: `cait-librow${scopeIds.includes(library[idKey]) ? ' scoped' : ''}`,
            },
            h('input', {
              type: 'checkbox',
              checked: scopeIds.includes(library[idKey]),
              onChange: () => toggleScope(library[idKey]),
              title: t('library.scope'),
              'aria-label': t('library.scope'),
            }),
            renamingId === library[idKey]
              ? h('input', {
                  className: 'cait-librename',
                  value: renameText,
                  autoFocus: true,
                  onChange: (event) => setRenameText(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') submitRename(library)
                    if (event.key === 'Escape') setRenamingId('')
                  },
                  onBlur: () => submitRename(library),
                })
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'cait-libname',
                    onClick: () => toggleScope(library[idKey]),
                    title: library[labelKey],
                  },
                  h('span', { className: 'cait-libname-text' }, library[labelKey]),
                  h('span', { className: 'cait-libcount' }, library.entryCount),
                  library.mounted ? h('span', { className: 'cait-libmounted' }, '●') : null,
                ),
            h(
              'span',
              { className: 'cait-libactions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-minibtn',
                  title: t('library.rename'),
                  onClick: () => {
                    setRenamingId(library[idKey])
                    setRenameText(library[labelKey])
                  },
                },
                h(Icon, { name: 'pencil', size: 12 }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-deletebtn',
                  title: t('library.deleteLibrary'),
                  disabled: libraries.length <= 1,
                  onClick: () => confirmDeleteLibrary(library),
                },
                h(Icon, { name: 'trash', size: 12 }),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'cait-libnew' },
          h('input', {
            value: newLibraryName,
            placeholder: t('library.newLibrary'),
            onChange: (event) => setNewLibraryName(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') submitNewLibrary()
            },
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'cait-minibtn',
              onClick: submitNewLibrary,
              disabled: !newLibraryName.trim(),
            },
            h(Icon, { name: 'plus', size: 12 }),
          ),
        ),
      ),
      h(
        'div',
        { className: 'cait-libmain' },
        h(
          'div',
          { className: 'cait-libtoolbar' },
          h(
            'div',
            { className: 'cait-libsearch' },
            h(Icon, { name: 'search', size: 13 }),
            h('input', {
              value: query,
              onChange: (event) => {
                setQuery(event.target.value)
                setPage(1)
              },
              placeholder: t('library.search'),
              'aria-label': t('library.search'),
            }),
          ),
          h(
            'select',
            {
              className: 'cait-liblang',
              value: lang,
              onChange: (event) => {
                setLang(event.target.value)
                setPage(1)
              },
              title: t('library.language'),
              'aria-label': t('library.language'),
            },
            h('option', { value: '' }, t('library.language')),
            allLanguages.map((code) => h('option', { key: code, value: code }, code)),
          ),
          kind === 'glossary'
            ? h(
                'select',
                {
                  className: 'cait-liblang',
                  value: exportFormat,
                  onChange: (event) => setExportFormat(event.target.value),
                  title: t('library.exportFormat'),
                  'aria-label': t('library.exportFormat'),
                },
                ['tbx', 'csv', 'json'].map((format) =>
                  h('option', { key: format, value: format }, format.toUpperCase()),
                ),
              )
            : null,
          h(
            'label',
            {
              className: 'cait-libwrite',
              title: t(kind === 'tm' ? 'libraries.defaultTm' : 'libraries.defaultGlossary'),
            },
            h(
              'span',
              { className: 'cait-libwritelabel' },
              t(kind === 'tm' ? 'libraries.defaultTm' : 'libraries.defaultGlossary'),
            ),
            h(
              'select',
              {
                className: 'cait-liblang',
                value: targetLibraryId,
                onChange: (event) => changeWriteLibrary(event.target.value),
                disabled: Boolean(busy) || !libraries.length,
                'aria-label': t(
                  kind === 'tm' ? 'libraries.defaultTm' : 'libraries.defaultGlossary',
                ),
              },
              libraries.map((library) =>
                h('option', { key: library[idKey], value: library[idKey] }, library[labelKey]),
              ),
            ),
          ),
          kind === 'glossary'
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn',
                  onClick: mineTerms,
                  disabled: Boolean(busy) || working === 'terms' || !data?.activeDocument,
                  title: t('term.extract'),
                },
                h(Icon, { name: 'sparkles', size: 13 }),
                h('span', { className: 'cait-btn-label' }, t('term.extract')),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'cait-btn',
              onClick: startAdding,
              disabled: Boolean(busy),
            },
            h(Icon, { name: 'plus', size: 13 }),
            h('span', { className: 'cait-btn-label' }, t('library.add')),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'cait-btn',
              onClick: () => pickImport(kind),
              disabled: Boolean(busy) || !targetLibraryId,
              title: t('library.import'),
            },
            h(Icon, { name: 'download', size: 13 }),
            h('span', { className: 'cait-btn-label' }, t('library.import')),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'cait-btn',
              onClick: exportLibrary,
              disabled: Boolean(busy) || working === 'export' || !targetLibraryId,
              title: t('library.export'),
            },
            h(Icon, { name: 'upload', size: 13 }),
            h(
              'span',
              { className: 'cait-btn-label' },
              kind === 'tm' ? 'TMX' : exportFormat.toUpperCase(),
            ),
          ),
          kind === 'tm'
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn',
                  onClick: () => maintainTm('dedupe'),
                  disabled: Boolean(busy) || !targetLibraryId,
                  title: t('tm.maintain.dedupe'),
                },
                h(Icon, { name: 'database', size: 13 }),
                h('span', { className: 'cait-btn-label' }, t('tm.maintain.dedupe')),
              )
            : null,
          kind === 'tm'
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn',
                  onClick: () => maintainTm('prune'),
                  disabled: Boolean(busy) || !targetLibraryId,
                  title: t('tm.maintain.prune'),
                },
                h(Icon, { name: 'trash', size: 13 }),
                h('span', { className: 'cait-btn-label' }, t('tm.maintain.prune')),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'cait-btn',
              onClick: clearLibrary,
              disabled: Boolean(busy) || !targetLibraryId,
              title: t('library.clear'),
            },
            h(Icon, { name: 'trash', size: 13 }),
            h('span', { className: 'cait-btn-label' }, t('library.clear')),
          ),
          h('input', {
            ref: fileRef,
            type: 'file',
            accept: kind === 'tm' ? '.tmx' : '.tbx,.csv,.json',
            style: { display: 'none' },
            onChange: (event) => {
              const file = event.target.files && event.target.files[0]
              if (file) runImport(file)
            },
          }),
        ),
        h(
          'div',
          { className: 'cait-libscope' },
          h(
            'button',
            {
              type: 'button',
              className: `cait-filterchip${scopeIds.length === 0 ? ' active' : ''}`,
              onClick: () => {
                setScopeIds([])
                setPage(1)
              },
            },
            t('library.scopeAll'),
          ),
          libraries.map((library) =>
            h(
              'button',
              {
                key: library[idKey],
                type: 'button',
                className: `cait-filterchip${scopeIds.includes(library[idKey]) ? ' active' : ''}`,
                onClick: () => toggleScope(library[idKey]),
              },
              library[labelKey],
            ),
          ),
        ),
        h(
          'div',
          { className: 'cait-libtable-wrap' },
          loading && !rows?.entries?.length
            ? h('div', { className: 'cait-center' }, h(Spinner), t('common.loading'))
            : rows?.entries?.length
              ? h(
                  'table',
                  { className: 'cait-libtable' },
                  h(
                    'thead',
                    null,
                    h(
                      'tr',
                      null,
                      columns.map((column) => h('th', { key: column }, column)),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    rows.entries.map((entry) =>
                      h(
                        'tr',
                        {
                          key: entry.id,
                          className: entry.id === selectedId ? 'active' : '',
                          onClick: () => {
                            setAdding(false)
                            setSelectedId(entry.id)
                          },
                        },
                        h('td', { className: 'src', title: entry.source }, entry.source),
                        h('td', { className: 'tgt', title: entry.target }, entry.target),
                        h('td', { className: 'note' }, entry.note || ''),
                        kind === 'tm'
                          ? h(
                              'td',
                              { className: 'ctx', title: contextLabel(entry) },
                              contextLabel(entry),
                            )
                          : null,
                        h(
                          'td',
                          { className: 'lang' },
                          kind === 'tm'
                            ? `${entry.sourceLang} → ${entry.targetLang}`
                            : entry.sourceLang || '—',
                        ),
                        kind === 'glossary'
                          ? h('td', { className: 'case' }, entry.caseSensitive ? '✓' : '')
                          : null,
                        h('td', { className: 'upd' }, String(entry.updatedAt || '').slice(0, 10)),
                      ),
                    ),
                  ),
                )
              : h(
                  'div',
                  { className: 'cait-empty-note' },
                  query || lang ? t('library.noMatch') : t('library.empty'),
                ),
        ),
        h(
          'div',
          { className: 'cait-rail-page cait-libpage-bar' },
          h(
            'button',
            {
              type: 'button',
              className: 'cait-pagebtn',
              onClick: () => setPage(Math.max(1, (rows?.page || 1) - 1)),
              disabled: (rows?.page || 1) <= 1,
              title: t('library.prev'),
              'aria-label': t('library.prev'),
            },
            h(Icon, { name: 'chevronLeft', size: 12 }),
          ),
          h(
            'span',
            { className: 'cait-pageinfo' },
            t('library.pageInfo', { start: bounds.start, end: bounds.end, total: bounds.total }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'cait-pagebtn',
              onClick: () => setPage((rows?.page || 1) + 1),
              disabled: (rows?.page || 1) >= (rows?.totalPages || 1),
              title: t('library.next'),
              'aria-label': t('library.next'),
            },
            h(Icon, { name: 'chevronRight', size: 12 }),
          ),
          h(
            'select',
            {
              className: 'cait-pagesize',
              value: String(pageSize),
              onChange: (event) => changePageSize(Number(event.target.value)),
              title: t('library.pageSize'),
              'aria-label': t('library.pageSize'),
            },
            PAGE_SIZE_OPTIONS.map((size) =>
              h('option', { key: size, value: String(size) }, String(size)),
            ),
          ),
        ),
      ),
      h(
        'aside',
        { className: 'cait-libdetail' },
        h('div', { className: 'cait-libdetail-title' }, t('library.detail')),
        draft
          ? h(
              'div',
              { className: 'cait-libform' },
              h('label', null, t('library.colSource')),
              h('textarea', {
                className: 'cait-libinput',
                value: draft.source,
                onChange: (event) => setDraft({ ...draft, source: event.target.value }),
              }),
              h('label', null, t('library.colTarget')),
              h('textarea', {
                className: 'cait-libinput',
                value: draft.target,
                onChange: (event) => setDraft({ ...draft, target: event.target.value }),
              }),
              h('label', null, t('library.colNote')),
              h('input', {
                className: 'cait-libinput',
                value: draft.note || '',
                onChange: (event) => setDraft({ ...draft, note: event.target.value }),
              }),
              h('label', null, t('library.colLang')),
              h('input', {
                className: 'cait-libinput',
                value: draft.sourceLang || '',
                disabled: adding,
                onChange: (event) => setDraft({ ...draft, sourceLang: event.target.value }),
              }),
              kind === 'glossary'
                ? h(
                    'label',
                    { className: 'cait-libcheck' },
                    h('input', {
                      type: 'checkbox',
                      checked: Boolean(draft.caseSensitive),
                      onChange: (event) =>
                        setDraft({ ...draft, caseSensitive: event.target.checked }),
                    }),
                    h('span', null, t('library.colCase')),
                  )
                : null,
              kind === 'glossary'
                ? h('p', { className: 'cait-libnote' }, t('library.caseSensitiveHint'))
                : null,
              h(
                'div',
                { className: 'cait-libform-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cait-btn cait-btn-primary',
                    onClick: adding ? addEntry : saveEntry,
                    disabled:
                      Boolean(busy) ||
                      working !== '' ||
                      !draft.source.trim() ||
                      !draft.target.trim(),
                  },
                  adding ? t('library.add') : t('library.save'),
                ),
                adding
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-btn',
                        onClick: () => {
                          setAdding(false)
                          setDraft(null)
                        },
                      },
                      t('panel.cancel'),
                    )
                  : h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-btn',
                        onClick: deleteEntry,
                        disabled: Boolean(busy) || working !== '',
                      },
                      h(Icon, { name: 'trash', size: 13 }),
                      t('library.deleteEntry'),
                    ),
              ),
              dirty ? h('p', { className: 'cait-libnote' }, t('editor.unsaved')) : null,
            )
          : h('div', { className: 'cait-empty-note' }, t('library.detailEmpty')),
      ),
    ),
    terms
      ? h(
          'div',
          { className: 'cait-termpanel' },
          h(
            'div',
            { className: 'cait-termpanel-head' },
            h('strong', null, t('term.title')),
            h('span', { className: 'cait-mt-hint' }, t('term.hint')),
            h(
              'span',
              { className: 'cait-termpanel-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn cait-btn-primary',
                  onClick: addMinedTerms,
                  disabled: working === 'terms',
                },
                h(Icon, { name: 'check', size: 13 }),
                t('term.add'),
              ),
              h(
                'button',
                { type: 'button', className: 'cait-btn', onClick: () => setTerms(null) },
                t('panel.cancel'),
              ),
            ),
          ),
          terms.length
            ? h(
                'div',
                { className: 'cait-termlist' },
                terms.map((candidate, at) =>
                  h(
                    'div',
                    {
                      key: `${candidate.term}-${at}`,
                      className: `cait-termrow${candidate.picked ? ' picked' : ''}`,
                    },
                    h('input', {
                      type: 'checkbox',
                      checked: Boolean(candidate.picked),
                      onChange: () => toggleTerm(at),
                    }),
                    h('span', { className: 'cait-termname' }, candidate.term),
                    candidate.proper
                      ? h('span', { className: 'cait-originchip' }, t('term.proper'))
                      : null,
                    h('span', { className: 'cait-termcount' }, `×${candidate.count}`),
                    candidate.inLibrary
                      ? h('span', { className: 'cait-originchip' }, t('term.inLibrary'))
                      : null,
                    h('input', {
                      className: 'cait-libinput cait-termtarget',
                      placeholder: t('library.colTarget'),
                      value: candidate.target,
                      onChange: (event) => setTermTarget(at, event.target.value),
                    }),
                  ),
                ),
              )
            : h('div', { className: 'cait-empty-note' }, t('term.empty')),
        )
      : null,
  )
}

export { AlignPage, LibraryPage }
