import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { CanvasView } from './components/CanvasView'
import { CloudBackground } from './components/layout/CloudBackground'
import { RightSidebar } from './components/layout/RightSidebar'
import { MobileSharePanel } from './components/share/MobileSharePanel'
import { ProviderModelSettings } from './components/settings/ProviderModelSettings'
import { getDeviceTemplateOptions, type DeviceVisualKind } from './lib/deviceSymbols'
import { normalizeDocumentLocal } from './lib/document'
import { translate } from './lib/i18n'
import { deriveMobileRenderSnapshot } from './lib/mobileSnapshot'
import { isTauriRuntime, startMobileShare, stopMobileShare } from './lib/tauri'
import { useTheme } from './lib/useTheme'
import { useEditorStore } from './store/editorStore'
import type { MobileShareSession, ValidationReport } from './types/document'

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  )
}

function buildLocalShareReport(document: ReturnType<typeof normalizeDocumentLocal>): ValidationReport {
  return {
    detectedFormat: 'semantic-v4',
    schemaValid: true,
    semanticValid: true,
    issueCount: 0,
    issues: [],
    normalizedDocument: document,
  }
}

function App() {
  const { theme, isDarkTheme, toggleTheme } = useTheme()
  const [deviceTemplateKey, setDeviceTemplateKey] = useState<DeviceVisualKind>('module')
  const [mobileShareOpen, setMobileShareOpen] = useState(false)
  const [mobileShareBusy, setMobileShareBusy] = useState(false)
  const [mobileShareError, setMobileShareError] = useState<string | null>(null)
  const [mobileShareSession, setMobileShareSession] = useState<MobileShareSession | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const refreshMobileShare = async () => {
    if (!isTauriRuntime()) {
      setMobileShareError(t('shareUnavailable'))
      return
    }

    try {
      setMobileShareBusy(true)
      setMobileShareError(null)
      const normalizedDocument = normalizeDocumentLocal(document)
      const snapshot = deriveMobileRenderSnapshot(
        normalizedDocument,
        validationReport ?? buildLocalShareReport(normalizedDocument),
        locale,
      )
      const session = await startMobileShare(normalizedDocument, snapshot)
      setMobileShareSession(session)
    } catch (error) {
      setMobileShareError(error instanceof Error ? error.message : String(error))
    } finally {
      setMobileShareBusy(false)
    }
  }

  const handleOpenMobileShare = () => {
    setMobileShareOpen(true)
    if (!mobileShareSession && !mobileShareBusy) {
      void refreshMobileShare()
    }
  }

  const handleStopMobileShare = async () => {
    try {
      if (isTauriRuntime()) {
        await stopMobileShare()
      }
      setMobileShareSession(null)
      setMobileShareError(null)
    } catch (error) {
      setMobileShareError(error instanceof Error ? error.message : String(error))
    }
  }

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
            <button className="ghost-button" onClick={toggleTheme}>
              {t(isDarkTheme ? 'themeLight' : 'themeDark')}
            </button>
            <button className="ghost-button" onClick={() => setSettingsOpen(true)}>
              Provider / Model
            </button>
            {isTauriRuntime() && (
              <button className="ghost-button" onClick={handleOpenMobileShare}>
                {t('shareToPhone')}
              </button>
            )}
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
            <CanvasView theme={theme} />
            {statusMessage && <div className="status-bar">{statusMessage}</div>}
          </section>
          <RightSidebar />
        </main>
      </div>
      {settingsOpen && (
        <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Provider and model settings">
          <div className="settings-modal__backdrop" onClick={() => setSettingsOpen(false)} />
          <div className="settings-modal__panel">
            <button className="settings-modal__close ghost-button" type="button" onClick={() => setSettingsOpen(false)}>
              Close
            </button>
            <ProviderModelSettings />
          </div>
        </div>
      )}
      <MobileSharePanel
        open={mobileShareOpen}
        locale={locale}
        loading={mobileShareBusy}
        error={mobileShareError}
        session={mobileShareSession}
        onRefresh={() => void refreshMobileShare()}
        onStop={() => void handleStopMobileShare()}
        onClose={() => setMobileShareOpen(false)}
      />
    </div>
  )
}

export default App
