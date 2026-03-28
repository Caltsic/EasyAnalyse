import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import './App.css'
import { CanvasView } from './components/CanvasView'
import { Inspector } from './components/Inspector'
import { IssuesPanel } from './components/IssuesPanel'
import { getShapeLabel, translate } from './lib/i18n'
import { useEditorStore } from './store/editorStore'

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  )
}

function App() {
  const document = useEditorStore((state) => state.document)
  const filePath = useEditorStore((state) => state.filePath)
  const dirty = useEditorStore((state) => state.dirty)
  const validationReport = useEditorStore((state) => state.validationReport)
  const connectMode = useEditorStore((state) => state.connectMode)
  const connectionSource = useEditorStore((state) => state.connectionSource)
  const draftRouteKind = useEditorStore((state) => state.draftRouteKind)
  const recentFiles = useEditorStore((state) => state.recentFiles)
  const diffSummary = useEditorStore((state) => state.diffSummary)
  const statusMessage = useEditorStore((state) => state.statusMessage)
  const placementMode = useEditorStore((state) => state.placementMode)
  const locale = useEditorStore((state) => state.locale)
  const initialize = useEditorStore((state) => state.initialize)
  const newDocument = useEditorStore((state) => state.newDocument)
  const openDocument = useEditorStore((state) => state.openDocument)
  const reopenRecent = useEditorStore((state) => state.reopenRecent)
  const saveDocument = useEditorStore((state) => state.saveDocument)
  const saveDocumentAs = useEditorStore((state) => state.saveDocumentAs)
  const addComponent = useEditorStore((state) => state.addComponent)
  const addNode = useEditorStore((state) => state.addNode)
  const addAnnotation = useEditorStore((state) => state.addAnnotation)
  const beginConnection = useEditorStore((state) => state.beginConnection)
  const cancelConnection = useEditorStore((state) => state.cancelConnection)
  const cancelPlacement = useEditorStore((state) => state.cancelPlacement)
  const setDraftRouteKind = useEditorStore((state) => state.setDraftRouteKind)
  const revalidate = useEditorStore((state) => state.revalidate)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const setLocale = useEditorStore((state) => state.setLocale)
  const deleteSelection = useEditorStore((state) => state.deleteSelection)
  const rotateSelectionClockwise = useEditorStore(
    (state) => state.rotateSelectionClockwise,
  )

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    if (copyState === 'idle') {
      return
    }

    const timer = window.setTimeout(() => setCopyState('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [copyState])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const modifier = event.ctrlKey || event.metaKey

      if (modifier && key === 's') {
        event.preventDefault()
        if (event.shiftKey) {
          void saveDocumentAs()
        } else {
          void saveDocument()
        }
        return
      }

      if (modifier && key === 'o') {
        event.preventDefault()
        void openDocument()
        return
      }

      if (modifier && key === 'n') {
        event.preventDefault()
        void newDocument()
        return
      }

      if (modifier && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
        return
      }

      if (modifier && key === 'y') {
        event.preventDefault()
        redo()
        return
      }

      if (isEditableTarget(event.target)) {
        return
      }

      if (event.key === 'Delete') {
        event.preventDefault()
        deleteSelection()
        return
      }

      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault()
        rotateSelectionClockwise()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    deleteSelection,
    newDocument,
    openDocument,
    redo,
    rotateSelectionClockwise,
    saveDocument,
    saveDocumentAs,
    undo,
  ])

  const t = useMemo(
    () => (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  )

  const deferredIssues = useDeferredValue(validationReport?.issues ?? [])
  const jsonPreview = useMemo(() => JSON.stringify(document, null, 2), [document])

  const issueCount = validationReport?.issueCount ?? 0
  const healthy = validationReport
    ? validationReport.schemaValid && validationReport.semanticValid
    : true

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonPreview)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const placementLabel =
    placementMode?.kind === 'component'
      ? t('clickToPlaceComponent', {
          shape: getShapeLabel(locale, placementMode.shape),
        })
      : placementMode?.kind === 'node'
        ? t('clickToPlaceNode')
        : null

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead__branding">
          <span className="eyebrow">{t('appEyebrow')}</span>
          <h1>{t('appTitle')}</h1>
          <p>{t('appDescription')}</p>
        </div>

        <div className="masthead__meta">
          <div className="stats-row">
            <article className="stat-card">
              <span>{t('statDocument')}</span>
              <strong>{document.document.title}</strong>
              <small>{filePath ?? t('unsavedWorkspace')}</small>
            </article>
            <article className="stat-card">
              <span>{t('statValidation')}</span>
              <strong className={healthy ? 'tone-mint' : 'tone-amber'}>
                {healthy ? t('healthy') : t('findings', { count: issueCount })}
              </strong>
              <small>{dirty ? t('unsavedChanges') : t('savedSnapshot')}</small>
            </article>
            <article className="stat-card">
              <span>{t('statConnection')}</span>
              <strong>{connectMode ? t('armed') : t('idle')}</strong>
              <small>
                {placementLabel
                  ? placementLabel
                  : connectMode
                    ? connectionSource
                      ? t('sourceLabel', { id: connectionSource.refId })
                      : t('pickSource')
                    : t('selectAndEdit')}
              </small>
            </article>
          </div>

          <div className="action-row">
            <button onClick={() => void newDocument()}>{t('newDocument')}</button>
            <button className="ghost-button" onClick={() => void openDocument()}>
              {t('openJson')}
            </button>
            <button className="ghost-button" onClick={() => void saveDocument()}>
              {t('save')}
            </button>
            <button className="ghost-button" onClick={() => void saveDocumentAs()}>
              {t('saveAs')}
            </button>
            <button className="ghost-button" onClick={() => void revalidate()}>
              {t('revalidate')}
            </button>
            <button className="ghost-button" onClick={copyJson}>
              {copyState === 'copied'
                ? t('copied')
                : copyState === 'failed'
                  ? t('copyFailed')
                  : t('copyJson')}
            </button>
            <div className="locale-toggle">
              <span>{t('language')}</span>
              <div className="segmented">
                <button
                  className={locale === 'zh-CN' ? 'is-active' : ''}
                  onClick={() => setLocale('zh-CN')}
                >
                  中文
                </button>
                <button
                  className={locale === 'en-US' ? 'is-active' : ''}
                  onClick={() => setLocale('en-US')}
                >
                  EN
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="workbench">
        <aside className="panel toolrail">
          <div className="panel__header">
            <div className="panel__heading">
              <span className="eyebrow">{t('tools')}</span>
              <h2>{t('build')}</h2>
            </div>
          </div>

          <div className="panel__body">
            <div className="stack">
              <button
                className={
                  placementMode?.kind === 'component' && placementMode.shape === 'rectangle'
                    ? 'is-active'
                    : ''
                }
                onClick={() => addComponent('rectangle')}
              >
                {t('addRectangle')}
              </button>
              <button
                className={
                  placementMode?.kind === 'component' && placementMode.shape === 'circle'
                    ? 'is-active'
                    : ''
                }
                onClick={() => addComponent('circle')}
              >
                {t('addCircle')}
              </button>
              <button
                className={
                  placementMode?.kind === 'component' && placementMode.shape === 'triangle'
                    ? 'is-active'
                    : ''
                }
                onClick={() => addComponent('triangle')}
              >
                {t('addTriangle')}
              </button>
              <button
                className={
                  placementMode?.kind === 'node'
                    ? 'ghost-button is-active'
                    : 'ghost-button'
                }
                onClick={() => addNode()}
              >
                {t('addNode')}
              </button>
              {placementMode && (
                <button className="ghost-button" onClick={cancelPlacement}>
                  {t('cancelPlacement')}
                </button>
              )}
              <button
                className={connectMode ? 'ghost-button is-active' : 'ghost-button'}
                onClick={connectMode ? cancelConnection : beginConnection}
              >
                {connectMode ? t('cancelLinkMode') : t('linkEndpoints')}
              </button>
              <div className="segmented">
                <button
                  className={draftRouteKind === 'straight' ? 'is-active' : ''}
                  onClick={() => setDraftRouteKind('straight')}
                >
                  {t('straight')}
                </button>
                <button
                  className={draftRouteKind === 'polyline' ? 'is-active' : ''}
                  onClick={() => setDraftRouteKind('polyline')}
                >
                  {t('polyline')}
                </button>
              </div>
              <button className="ghost-button" onClick={() => addAnnotation('note')}>
                {t('addNoteToSelection')}
              </button>
            </div>

            <div className="inspector-card">
              <span className="eyebrow">{t('history')}</span>
              <div className="card-actions">
                <button className="ghost-button" onClick={() => undo()}>
                  {t('undo')}
                </button>
                <button className="ghost-button" onClick={() => redo()}>
                  {t('redo')}
                </button>
              </div>
            </div>

            <div className="inspector-card">
              <span className="eyebrow">{t('shortcuts')}</span>
              <div className="list shortcut-list">
                <div className="list-item">
                  <strong>{t('shortcutZoom')}</strong>
                  <span>Ctrl + Wheel</span>
                </div>
                <div className="list-item">
                  <strong>{t('shortcutPan')}</strong>
                  <span>MMB Drag</span>
                </div>
                <div className="list-item">
                  <strong>{t('shortcutMarquee')}</strong>
                  <span>LMB Drag</span>
                </div>
                <div className="list-item">
                  <strong>{t('shortcutRotate')}</strong>
                  <span>Space</span>
                </div>
                <div className="list-item">
                  <strong>{t('shortcutDelete')}</strong>
                  <span>Delete</span>
                </div>
              </div>
            </div>

            <div className="inspector-card">
              <span className="eyebrow">{t('recentFiles')}</span>
              <div className="list">
                {recentFiles.length ? (
                  recentFiles.map((path) => (
                    <button
                      className="list-button"
                      key={path}
                      onClick={() => void reopenRecent(path)}
                    >
                      {path}
                    </button>
                  ))
                ) : (
                  <p className="muted-copy">{t('noRecentFiles')}</p>
                )}
              </div>
            </div>
          </div>
        </aside>

        <CanvasView />
        <Inspector />
      </main>

      <IssuesPanel
        issues={deferredIssues}
        diffSummary={diffSummary}
        statusMessage={statusMessage}
      />
    </div>
  )
}

export default App
