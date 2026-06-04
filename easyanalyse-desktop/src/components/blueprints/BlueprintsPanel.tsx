import { useEffect, useMemo, useRef, useState } from 'react'
import { hashDocument } from '../../lib/documentHash'
import { getErrorMessage } from '../../lib/errors'
import { translate } from '../../lib/i18n'
import { deleteLiveBlueprintDraftPartialCommand } from '../../lib/tauri'
import { useBlueprintStore, type BlueprintLiveDraftState } from '../../store/blueprintStore'
import { useEditorStore } from '../../store/editorStore'
import type { BlueprintRecord } from '../../types/blueprint'
import { AppErrorBoundary } from '../AppErrorBoundary'
import { Button, EmptyState } from '../ui'
import { ApplyBlueprintDialog } from './ApplyBlueprintDialog'
import { BlueprintCard } from './BlueprintCard'
import { BlueprintPreviewCanvas } from './BlueprintPreviewCanvas'

type BlueprintTranslate = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => string

function describeLiveDraftStatus(status: BlueprintLiveDraftState['status'], t: BlueprintTranslate): string {
  if (status === 'ready') return t('liveBlueprintStatusReady')
  if (status === 'partial-json' || status === 'waiting-for-json') return t('liveBlueprintStatusParsing')
  if (status === 'invalid-json' || status === 'invalid-document') return t('liveBlueprintStatusKeepingLastGood')
  if (status === 'marker-missing') return t('liveBlueprintStatusWaitingForMarker')
  return t('liveBlueprintStatusIdle')
}

function liveDraftDiagnosticLines(liveDraft: BlueprintLiveDraftState, t: BlueprintTranslate): string[] {
  const error = liveDraft.error
  if (!error) return []

  const lines = [
    error.message,
    t('liveBlueprintDiagnosticCode', { code: error.code }),
  ]
  if (typeof error.line === 'number' && typeof error.column === 'number') {
    lines.push(t('liveBlueprintDiagnosticLocation', { line: error.line, column: error.column }))
  }
  if (error.excerpt) {
    lines.push(t('liveBlueprintDiagnosticExcerpt', { excerpt: error.excerpt }))
  }
  for (const issue of error.issues ?? []) {
    lines.push(issue.path
      ? t('liveBlueprintDiagnosticIssueWithPath', { path: issue.path, code: issue.code, message: issue.message })
      : t('liveBlueprintDiagnosticIssue', { code: issue.code, message: issue.message }))
  }

  return lines
}

export function BlueprintsPanel() {
  const document = useEditorStore((state) => state.document)
  const filePath = useEditorStore((state) => state.filePath)
  const editorDirty = useEditorStore((state) => state.dirty)
  const locale = useEditorStore((state) => state.locale)
  const workspace = useBlueprintStore((state) => state.workspace)
  const sidecarPath = useBlueprintStore((state) => state.sidecarPath)
  const dirty = useBlueprintStore((state) => state.dirty)
  const selectedBlueprintId = useBlueprintStore((state) => state.selectedBlueprintId)
  const loadError = useBlueprintStore((state) => state.loadError)
  const saveError = useBlueprintStore((state) => state.saveError)
  const validationError = useBlueprintStore((state) => state.validationError)
  const liveDraft = useBlueprintStore((state) => state.liveDraft)
  const loadForMainDocument = useBlueprintStore((state) => state.loadForMainDocument)
  const saveWorkspace = useBlueprintStore((state) => state.saveWorkspace)
  const createSnapshotFromDocument = useBlueprintStore((state) => state.createSnapshotFromDocument)
  const acceptLiveBlueprintDraft = useBlueprintStore((state) => state.acceptLiveBlueprintDraft)
  const clearLiveBlueprintDraft = useBlueprintStore((state) => state.clearLiveBlueprintDraft)
  const validateBlueprint = useBlueprintStore((state) => state.validateBlueprint)
  const archiveBlueprint = useBlueprintStore((state) => state.archiveBlueprint)
  const deleteBlueprint = useBlueprintStore((state) => state.deleteBlueprint)
  const selectBlueprint = useBlueprintStore((state) => state.selectBlueprint)
  const markApplied = useBlueprintStore((state) => state.markApplied)
  const applyBlueprintDocument = useEditorStore((state) => state.applyBlueprintDocument)
  const [busyMessage, setBusyMessage] = useState<string | null>(null)
  const [topActionBusy, setTopActionBusy] = useState(false)
  const activeTopActionTokenRef = useRef<number | null>(null)
  const nextTopActionTokenRef = useRef(0)
  const validatingBlueprintIdsRef = useRef(new Set<string>())
  const [validatingBlueprintIds, setValidatingBlueprintIds] = useState<Set<string>>(() => new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [currentMainHash, setCurrentMainHash] = useState<string | null>(workspace?.mainDocument?.hash ?? null)
  const [pendingApplyRecord, setPendingApplyRecord] = useState<BlueprintRecord | null>(null)
  const [applyBusy, setApplyBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    hashDocument(document)
      .then((hash) => {
        if (!cancelled) {
          setCurrentMainHash(hash)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setActionError(getErrorMessage(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [document])

  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params)
  const blueprints = useMemo(() => workspace?.blueprints ?? [], [workspace])
  const selectedBlueprint = useMemo(
    () => blueprints.find((record) => record.id === selectedBlueprintId) ?? null,
    [blueprints, selectedBlueprintId],
  )
  const livePreviewDocument = liveDraft.displayDocument
  const livePreviewVisible = livePreviewDocument !== null && liveDraft.status !== 'idle'
  const previewDocument = livePreviewDocument ?? selectedBlueprint?.document ?? null
  const previewResetKey = livePreviewVisible
    ? `live:${liveDraft.updatedAt ?? 'draft'}`
    : selectedBlueprint
      ? `${selectedBlueprint.id}:${selectedBlueprint.documentHash}`
      : ''
  const previewTitle = livePreviewVisible
    ? t('liveBlueprintPreviewTitle')
    : selectedBlueprint
      ? t('previewTitle', { title: selectedBlueprint.title })
      : ''
  const previewDescription = livePreviewVisible
    ? t('liveBlueprintPreviewStatus', { status: describeLiveDraftStatus(liveDraft.status, t) })
    : t('previewHint')
  const liveDiagnostics = livePreviewVisible ? liveDraftDiagnosticLines(liveDraft, t) : []
  const applyModalOpen = pendingApplyRecord !== null
  const blueprintActionsDisabled = topActionBusy || applyModalOpen || applyBusy

  const runTopAction = async (message: string, action: () => Promise<void>) => {
    if (activeTopActionTokenRef.current !== null) {
      return
    }
    const token = ++nextTopActionTokenRef.current
    activeTopActionTokenRef.current = token
    setTopActionBusy(true)
    try {
      setBusyMessage(message)
      setActionError(null)
      await action()
    } catch (error) {
      setActionError(getErrorMessage(error))
    } finally {
      if (activeTopActionTokenRef.current === token) {
        activeTopActionTokenRef.current = null
        setTopActionBusy(false)
        setBusyMessage(null)
      }
    }
  }

  const handleCreateSnapshot = async () => {
    await runTopAction(t('creatingSnapshot'), async () => {
      await createSnapshotFromDocument(document, {
        title: document.document.title,
        description: editorDirty ? t('snapshotFromUnsavedMain') : undefined,
      })
    })
  }

  const handleSave = async () => {
    await runTopAction(t('savingWorkspace'), async () => {
      await saveWorkspace()
    })
  }

  const handleReload = async () => {
    await runTopAction(t('reloadingWorkspace'), async () => {
      await loadForMainDocument(filePath, document)
    })
  }

  const clearProjectLiveDraftPartial = async () => {
    if (filePath !== null) {
      await deleteLiveBlueprintDraftPartialCommand(filePath)
    }
  }

  const handleAcceptLiveDraft = async () => {
    if (!livePreviewDocument) return
    await runTopAction(t('acceptingLiveDraft'), async () => {
      const accepted = await acceptLiveBlueprintDraft({
        mainDocument: document,
        filePath,
        title: livePreviewDocument.document.title,
        description: t('acceptedLiveDraftDescription'),
      })
      if (accepted !== null) {
        await clearProjectLiveDraftPartial()
      }
    })
  }

  const handleDiscardLiveDraft = async () => {
    await runTopAction(t('discardingLiveDraft'), async () => {
      clearLiveBlueprintDraft({ suppressCurrentSession: true })
      await clearProjectLiveDraftPartial()
    })
  }

  const handleValidate = async (id: string) => {
    if (applyModalOpen || applyBusy) {
      return
    }
    if (validatingBlueprintIdsRef.current.has(id)) {
      return
    }
    validatingBlueprintIdsRef.current = new Set(validatingBlueprintIdsRef.current).add(id)
    setValidatingBlueprintIds(validatingBlueprintIdsRef.current)
    try {
      setActionError(null)
      await validateBlueprint(id)
    } catch (error) {
      setActionError(getErrorMessage(error))
    } finally {
      if (validatingBlueprintIdsRef.current.has(id)) {
        const next = new Set(validatingBlueprintIdsRef.current)
        next.delete(id)
        validatingBlueprintIdsRef.current = next
        setValidatingBlueprintIds(next)
      }
    }
  }

  const handleConfirmApply = async () => {
    if (pendingApplyRecord === null || applyBusy) {
      return
    }
    setApplyBusy(true)
    try {
      setActionError(null)
      applyBlueprintDocument(pendingApplyRecord.document)
      const appliedToMainDocumentHash = await hashDocument(useEditorStore.getState().document)
      markApplied(pendingApplyRecord.id, {
        appliedAt: new Date().toISOString(),
        sourceBlueprintDocumentHash: pendingApplyRecord.documentHash,
        appliedToMainDocumentHash,
      })
      setCurrentMainHash(appliedToMainDocumentHash)
      setPendingApplyRecord(null)
    } catch (error) {
      setActionError(getErrorMessage(error))
    } finally {
      setApplyBusy(false)
    }
  }

  return (
    <section className="blueprints-panel" aria-label={t('blueprints')}>
      <div className="blueprints-panel__header">
        <div>
          <h2>{t('blueprints')}</h2>
          <p>{dirty ? t('workspaceDirty') : t('workspaceClean')}</p>
        </div>
        <div className="blueprints-panel__actions">
          <Button type="button" onClick={() => void handleCreateSnapshot()} disabled={topActionBusy}>
            {t('createSnapshot')}
          </Button>
          <Button
            className="ghost-button"
            variant="ghost"
            type="button"
            onClick={() => void handleSave()}
            disabled={topActionBusy}
          >
            {t('saveWorkspace')}
          </Button>
          <Button
            className="ghost-button"
            variant="ghost"
            type="button"
            onClick={() => void handleReload()}
            disabled={topActionBusy}
          >
            {t('reload')}
          </Button>
        </div>
      </div>

      <div className="blueprints-panel__status" aria-label={t('blueprintWorkspaceStatus')}>
        <span>{sidecarPath ? t('sidecarPath', { path: sidecarPath }) : t('sidecarUnavailable')}</span>
        <span>{sidecarPath ? t('persistentSidecarWorkspace') : t('inMemoryWorkspace')}</span>
        {editorDirty && <span>{t('mainDocumentUnsaved')}</span>}
        {!sidecarPath && <span>{t('saveMainForSidecar')}</span>}
        {busyMessage && <span>{busyMessage}</span>}
        {loadError && <span>{t('loadError', { message: loadError })}</span>}
        {saveError && <span>{t('saveError', { message: saveError })}</span>}
        {validationError && <span>{t('validationError', { message: validationError })}</span>}
        {actionError && <span>{t('actionError', { message: actionError })}</span>}
      </div>

      {blueprints.length === 0 ? (
        <EmptyState className="blueprints-panel__empty" title={t('noBlueprintsYet')}>
          {t('noBlueprintsHint')}
        </EmptyState>
      ) : (
        <div className="blueprints-panel__list" aria-label={t('blueprintList')}>
          {blueprints.map((record) => (
            <BlueprintCard
              key={record.id}
              record={record}
              currentMainHash={currentMainHash}
              selected={record.id === selectedBlueprintId}
              actionsDisabled={blueprintActionsDisabled}
              validating={validatingBlueprintIds.has(record.id)}
              t={t}
              onSelect={() => {
                if (!blueprintActionsDisabled) {
                  selectBlueprint(record.id)
                }
              }}
              onValidate={() => void handleValidate(record.id)}
              onApply={() => {
                if (!blueprintActionsDisabled) {
                  setPendingApplyRecord(record)
                }
              }}
              onArchive={() => {
                if (!blueprintActionsDisabled) {
                  archiveBlueprint(record.id)
                }
              }}
              onDelete={() => {
                if (!blueprintActionsDisabled) {
                  deleteBlueprint(record.id)
                }
              }}
            />
          ))}
        </div>
      )}
      {previewDocument && (livePreviewVisible || (selectedBlueprint && selectedBlueprint.lifecycleStatus !== 'deleted')) && (
        <section className="blueprints-panel__preview" aria-label={t('selectedBlueprintPreview')}>
          <div className="blueprints-panel__preview-header">
            <div>
              <h3>{previewTitle}</h3>
              <p>{previewDescription}</p>
            </div>
            {livePreviewVisible ? (
              <div className="blueprints-panel__preview-actions">
                <Button
                  type="button"
                  onClick={() => void handleAcceptLiveDraft()}
                  disabled={topActionBusy || livePreviewDocument === null}
                >
                  {t('acceptLiveDraft')}
                </Button>
                <Button
                  className="ghost-button"
                  variant="ghost"
                  type="button"
                  onClick={() => void handleDiscardLiveDraft()}
                  disabled={topActionBusy}
                >
                  {t('discardLiveDraft')}
                </Button>
              </div>
            ) : null}
          </div>
          {liveDiagnostics.length > 0 ? (
            <div className="blueprints-panel__live-diagnostics" role="status" aria-live="polite">
              <strong>{t('liveBlueprintDiagnosticsTitle')}</strong>
              <ul>
                {liveDiagnostics.map((line, index) => (
                  <li key={`${index}:${line}`}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <AppErrorBoundary
            compact
            resetKey={previewResetKey}
            title={t('blueprintPreviewFailed')}
            description={t('blueprintPreviewFailedDescription')}
            detailsLabel={t('errorDetails')}
            tryAgainLabel={t('tryAgain')}
            reloadLabel={t('reload')}
          >
            <BlueprintPreviewCanvas
              document={previewDocument}
              locale={locale}
              className="blueprints-panel__preview-canvas"
            />
          </AppErrorBoundary>
        </section>
      )}
      {pendingApplyRecord && (
        <ApplyBlueprintDialog
          record={pendingApplyRecord}
          mainDocument={document}
          currentMainHash={currentMainHash}
          applying={applyBusy}
          t={t}
          onCancel={() => {
            if (!applyBusy) {
              setPendingApplyRecord(null)
            }
          }}
          onConfirm={() => void handleConfirmApply()}
        />
      )}
    </section>
  )
}
