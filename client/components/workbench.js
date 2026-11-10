import { h } from '../react.js'
import { CSS_SCALED } from '../styles.js'
import { Spinner, Icon, Toast } from './base.js'
import { SaveBanner, RecentDocsModal, Topbar, EmptyState } from './shell.js'
import { SegmentRail } from './rail.js'
import { EditorPane } from './editor.js'
import { CatPanel } from './panels.js'
import { NewDocModal } from './forms.js'
import { AlignPage, LibraryPage } from './pages.js'
import {
  ExportModal,
  SettingsModal,
  ConfirmModal,
  BriefModal,
  NoteModal,
  ReplaceModal,
  CommandPalette,
  ResourceModal,
  AnalysisModal,
} from './dialogs.js'
import { useWorkbenchController } from '../workbench/controller.js'

function Workbench({ i18n, translate }) {
  const {
    data,
    setData,
    loading,
    loadError,
    busy,
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
    cancelReview,
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
  } = useWorkbenchController({ i18n, translate })

  if (loading) {
    return h(
      'div',
      { className: 'cait-root', ref: rootRef },
      h('style', null, CSS_SCALED),
      h('div', { className: 'cait-center' }, h(Spinner), t('common.loading')),
    )
  }

  if (loadError) {
    return h(
      'div',
      { className: 'cait-root', ref: rootRef },
      h('style', null, CSS_SCALED),
      h(
        'div',
        { className: 'cait-center' },
        h(
          'div',
          { className: 'cait-errorcard' },
          h('p', null, `${t('error.load')}: ${loadError}`),
          h(
            'button',
            { className: 'cait-btn cait-btn-primary', onClick: () => window.location.reload() },
            h(Icon, { name: 'refresh', size: 13 }),
            t('common.retry'),
          ),
        ),
      ),
    )
  }

  const commands = [
    {
      id: 'new',
      title: t('cmd.new'),
      hint: t('cmd.newHint'),
      run: () => setModal({ type: 'new', defaultMode: 'text' }),
    },
    {
      id: 'import',
      title: t('cmd.import'),
      hint: '',
      run: () => setModal({ type: 'new', defaultMode: 'file' }),
    },
    {
      id: 'export',
      title: t('cmd.export'),
      hint: '',
      docOnly: true,
      run: () => setModal({ type: 'export' }),
    },
    {
      id: 'pretranslate',
      title: t('cmd.pretranslate'),
      hint: '',
      docOnly: true,
      run: () => runPreTranslate(),
    },
    {
      id: 'replace',
      title: t('cmd.replace'),
      hint: 'Ctrl+F',
      docOnly: true,
      run: () => openReplace(),
    },
    {
      id: 'brief',
      title: t('cmd.brief'),
      hint: '',
      docOnly: true,
      run: () => setModal({ type: 'brief' }),
    },
    {
      id: 'resources',
      title: t('cmd.resources'),
      hint: '',
      docOnly: true,
      run: () => setModal({ type: 'resources' }),
    },
    {
      id: 'analysis',
      title: t('cmd.analysis'),
      hint: '',
      docOnly: true,
      run: () => openAnalysis(),
    },
    { id: 'notes', title: t('cmd.notes'), hint: '', docOnly: true, run: () => openNotes() },
    {
      id: 'review',
      title: t('cmd.review'),
      hint: t('cmd.reviewHint'),
      docOnly: true,
      run: () => {
        setTab('qa')
        runReview('page')
      },
    },
    {
      id: 'review-risk',
      title: t('cmd.reviewRisk'),
      hint: t('cmd.reviewRiskHint'),
      docOnly: true,
      run: () => {
        setTab('qa')
        runReview('risk')
      },
    },
    {
      id: 'clear-pretranslated',
      title: t('cmd.clearPretranslated'),
      hint: '',
      docOnly: true,
      run: () => clearPretranslated(),
    },
    { id: 'documents', title: t('cmd.documents'), hint: '', run: () => setView('documents') },
    { id: 'libraries', title: t('cmd.libraries'), hint: '', run: () => setView('libraries') },
    { id: 'align', title: t('cmd.align'), hint: '', run: () => setView('align') },
    {
      id: 'settings',
      title: t('cmd.settings'),
      hint: '',
      run: () => setModal({ type: 'settings' }),
    },
  ].filter((item) => !item.docOnly || doc)

  const runCommand = (item) => {
    setModal(null)
    setTimeout(() => item.run(), 0)
  }

  return h(
    'div',
    { className: 'cait-root', ref: rootRef },
    h('style', null, CSS_SCALED),
    h(Topbar, {
      t,
      doc,
      data,
      busy,
      onNew: () => setModal({ type: 'new', defaultMode: 'text' }),
      onImport: () => setModal({ type: 'new', defaultMode: 'file' }),
      onExport: () => setModal({ type: 'export' }),
      onSettings: () => setModal({ type: 'settings' }),
      onOpenDoc: openDocument,
      onCloseDoc: closeDocumentTab,
      onNewTab: () => setModal({ type: 'new', defaultMode: 'file' }),
      onCleanClosed: () => setModal({ type: 'recent' }),
      pre,
      onPreTranslate: runPreTranslate,
      onCancelPreTranslate: cancelPreTranslate,
      onReplace: openReplace,
      view,
      onView: setView,
    }),
    h(SaveBanner, { t, storage: data?.storage, stale, onRefresh: refreshState }),
    view === 'libraries'
      ? h(LibraryPage, {
          t,
          data,
          settings,
          busy,
          notify,
          report,
          seed: libSeed,
          onApplyState: (state) => setData(state),
          onConfirm: openConfirm,
          onCreateLibrary: createLibrary,
          onRenameLibrary: renameLibrary,
          onDeleteLibrary: deleteLibrary,
          onSetMounts: setMounts,
        })
      : null,
    view === 'align'
      ? h(AlignPage, {
          t,
          data,
          busy,
          notify,
          report,
          onApplyState: (state) => setData(state),
          onConfirm: openConfirm,
        })
      : null,
    view === 'documents'
      ? h(
          'div',
          { className: `cait-body${doc ? '' : ' cait-no-doc'}` },
          doc
            ? h(SegmentRail, {
                t,
                doc,
                selected: index,
                query: railQuery,
                setQuery: setRailQuery,
                filter: railFilter,
                setFilter: setRailFilter,
                onSelect: chooseSegment,
                onConfirmAll: confirmAllTranslated,
                onPropagate: propagateRepeats,
                onClearPretranslated: clearPretranslated,
                busy,
                qa,
              })
            : null,
          h(
            'div',
            { className: `cait-main${doc ? '' : ' cait-main-empty'}` },
            doc
              ? h(EditorPane, {
                  t,
                  doc,
                  index,
                  segment,
                  detail,
                  draft,
                  setDraft: changeDraft,
                  dirty,
                  busy,
                  canUndo: draftHistoryRef.current.cursor > 0,
                  canRedo:
                    draftHistoryRef.current.cursor < draftHistoryRef.current.stack.length - 1,
                  onUndo: undoDraft,
                  onRedo: redoDraft,
                  onConfirm: confirmSegment,
                  onUnconfirm: unconfirmCurrent,
                  onToggleLock: toggleLock,
                  onMerge: mergeCurrent,
                  onSplit: splitCurrent,
                  onMergeCue: mergeCue,
                  onSplitCue: splitCueAt,
                  onShiftSubtitles: shiftSubtitles,
                  onNext: () => moveSegment(1),
                  onPrev: () => moveSegment(-1),
                  onSave: () => saveDraft(false),
                  onAdopt: adoptSuggestion,
                  onApplyTerm: applyTerm,
                  onOpenBrief: () => setModal({ type: 'brief' }),
                  onOpenResources: () => setModal({ type: 'resources' }),
                  onOpenAnalysis: openAnalysis,
                  onOpenNotes: openNotes,
                  noteCount: segment?.notes?.length || 0,
                  qaRisk,
                  textareaRef,
                })
              : h(EmptyState, { t, settings, busy, onCreate: createFromForm, onDemo: loadDemo }),
            doc
              ? h(CatPanel, {
                  t,
                  doc,
                  data,
                  settings,
                  mtRoutes,
                  tab,
                  setTab,
                  tmQuery,
                  setTmQuery,
                  tmResults,
                  tmError,
                  onApplyTm: applyTm,
                  onEditTm: editTm,
                  onDeleteTm: deleteTm,
                  onImportTmx: importTmxFile,
                  onClearTm: clearTm,
                  onAddTerm: addTerm,
                  onDeleteTerm: deleteTerm,
                  onApplyTerm: applyTerm,
                  onImportGlossary: importGlossaryFile,
                  onClearGlossary: clearGlossary,
                  mt,
                  mtError,
                  mtBusy,
                  onGenerateMt: generateMt,
                  onApplyMt: () => {
                    if (mt?.text) {
                      setDraft(mt.text)
                      setDirty(true)
                      setTimeout(() => textareaRef.current?.focus(), 0)
                    }
                  },
                  onCopy: copy,
                  onOpenSettings: () => setModal({ type: 'settings' }),
                  onSearchLibrary: openLibrary,
                  qa,
                  onRefreshQa: refreshQa,
                  onJumpQa: jumpQa,
                  onFixQa: applyQaFix,
                  review,
                  reviewBusy,
                  onReview: runReview,
                  onCancelReview: cancelReview,
                  onApplyReview: applyReview,
                  concordance,
                  concordanceQuery,
                  setConcordanceQuery,
                  onConcordance: runConcordance,
                  onApplyConcordance: applyConcordance,
                  busy: busy || (concordanceBusy ? 'concordance' : ''),
                })
              : null,
          ),
        )
      : null,
    modal?.type === 'new'
      ? h(NewDocModal, {
          t,
          settings,
          busy,
          defaultMode: modal.defaultMode,
          onClose: () => setModal(null),
          onCreate: createFromForm,
        })
      : null,
    modal?.type === 'export'
      ? h(ExportModal, {
          t,
          busy,
          qa,
          onClose: () => setModal(null),
          onExport: exportAs,
          onImportReview: importReview,
        })
      : null,
    modal?.type === 'brief'
      ? h(BriefModal, { t, doc, busy, onClose: () => setModal(null), onSave: saveBrief })
      : null,
    modal?.type === 'resources'
      ? h(ResourceModal, {
          t,
          doc,
          libraries: data?.libraries,
          mounts: data?.mounts,
          busy,
          onClose: () => setModal(null),
          onSave: saveResources,
        })
      : null,
    modal?.type === 'analysis'
      ? h(AnalysisModal, {
          t,
          doc,
          analysis,
          busy: analysisBusy,
          onClose: () => setModal(null),
        })
      : null,
    modal?.type === 'replace'
      ? h(ReplaceModal, {
          t,
          doc,
          busy: replaceBusy,
          preview: replacePreview,
          undoCount: replaceUndo ? replaceUndo.length : 0,
          onPreview: previewReplace,
          onApply: applyReplace,
          onUndo: undoReplace,
          onClose: () => setModal(null),
        })
      : null,
    modal?.type === 'notes'
      ? h(NoteModal, {
          t,
          doc,
          index,
          segment,
          notes,
          busy: notesBusy,
          onAdd: addNote,
          onUpdate: updateNote,
          onDelete: deleteNote,
          onClose: () => setModal(null),
        })
      : null,
    modal?.type === 'palette'
      ? h(CommandPalette, { t, items: commands, onClose: () => setModal(null), onRun: runCommand })
      : null,
    modal?.type === 'settings'
      ? h(SettingsModal, {
          t,
          settings,
          mtRoutes,
          busy,
          onClose: () => setModal(null),
          onSave: saveSettings,
        })
      : null,
    modal?.type === 'recent'
      ? h(RecentDocsModal, {
          t,
          documents: closedDocuments,
          busy,
          onClose: () => setModal(null),
          onDelete: deleteClosedDocument,
          onClear: clearClosedDocuments,
        })
      : null,
    modal?.type === 'confirm'
      ? h(ConfirmModal, {
          t,
          state: modal,
          busy,
          onClose: () => setModal(null),
          onConfirm: runConfirm,
        })
      : null,
    toast ? h(Toast, { toast }) : null,
  )
}

export { Workbench }
