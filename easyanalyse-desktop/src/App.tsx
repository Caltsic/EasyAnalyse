import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { CanvasView } from './components/CanvasView'
import { Inspector } from './components/Inspector'
import { CloudBackground } from './components/layout/CloudBackground'
import { getDeviceTemplateOptions, type DeviceVisualKind } from './lib/deviceSymbols'
import { translate } from './lib/i18n'
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
  const [deviceTemplateKey, setDeviceTemplateKey] = useState<DeviceVisualKind>('module')
  const document = useEditorStore((state) => state.document)
  const filePath = useEditorStore((state) => state.filePath)
  const dirty = useEditorStore((state) => state.dirty)
  const locale = useEditorStore((state) => state.locale)
  const validationReport = useEditorStore((state) => state.validationReport)
  const statusMessage = useEditorStore((state) => state.statusMessage)
  const pendingDeviceShape = useEditorStore((state) => state.pendingDeviceShape)
  const initialize = useEditorStore((state) => state.initialize)
  const newDocument = useEditorStore((state) => state.newDocument)
  const openDocument = useEditorStore((state) => state.openDocument)
  const saveDocument = useEditorStore((state) => state.saveDocument)
  const saveDocumentAs = useEditorStore((state) => state.saveDocumentAs)
  const revalidate = useEditorStore((state) => state.revalidate)
  const addDevice = useEditorStore((state) => state.addDevice)
  const deleteSelection = useEditorStore((state) => state.deleteSelection)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const clearFocus = useEditorStore((state) => state.clearFocus)
  const cancelPendingDevicePlacement = useEditorStore((state) => state.cancelPendingDevicePlacement)
  const resetViewportToOrigin = useEditorStore((state) => state.resetViewportToOrigin)
  const rotateSelection = useEditorStore((state) => state.rotateSelection)

  useEffect(() => {
    void initialize()
  }, [initialize])

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

      if (modifier && key === '0') {
        event.preventDefault()
        resetViewportToOrigin()
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        resetViewportToOrigin()
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        rotateSelection()
        return
      }

      if (event.key === 'Delete') {
        event.preventDefault()
        deleteSelection()
        return
      }

      if (event.key === 'Escape') {
        if (pendingDeviceShape) {
          cancelPendingDevicePlacement()
          return
        }
        clearFocus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    cancelPendingDevicePlacement,
    clearFocus,
    deleteSelection,
    newDocument,
    openDocument,
    pendingDeviceShape,
    redo,
    resetViewportToOrigin,
    rotateSelection,
    saveDocument,
    saveDocumentAs,
    undo,
  ])

  const t = useMemo(
    () => (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  )

  const issueCount = validationReport?.issueCount ?? 0
  const healthy = validationReport
    ? validationReport.schemaValid && validationReport.semanticValid
    : true
  const deviceTemplateOptions = useMemo(() => getDeviceTemplateOptions(), [])

  return (
    <div className="shell">
      <CloudBackground />
      <div className="shell__content">
        <header className="topbar">
          <div className="topbar__title">
            <div>
              <h1>{document.document.title}</h1>
            </div>
            <div className="topbar__meta">
              <span>{filePath ?? t('untitledCircuit')}</span>
              <span className={healthy ? 'status-chip' : 'status-chip status-chip--warning'}>
                {healthy ? t('validationHealthy') : t('validationIssues', { count: issueCount })}
              </span>
              <span>{dirty ? t('unsavedChanges') : t('savedSnapshot')}</span>
            </div>
          </div>

          <div className="topbar__actions">
            <button onClick={() => void newDocument()}>{t('newDocument')}</button>
            <button className="ghost-button" onClick={() => void openDocument()}>
              {t('openFile')}
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
            <select
              className="topbar__template-select"
              aria-label="Device template"
              value={deviceTemplateKey}
              onChange={(event) => setDeviceTemplateKey(event.target.value as DeviceVisualKind)}
            >
              {deviceTemplateOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <button className="ghost-button" onClick={() => addDevice(deviceTemplateKey)}>
              {t('addDevice')}
            </button>
          </div>
        </header>

        <main className="workspace">
          <section className="workspace__canvas">
            <CanvasView />
            {statusMessage && <div className="status-bar">{statusMessage}</div>}
          </section>
          <Inspector />
        </main>
      </div>
    </div>
  )
}

export default App
