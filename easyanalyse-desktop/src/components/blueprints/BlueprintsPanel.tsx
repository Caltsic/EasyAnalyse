import { useEffect, useMemo, useRef, useState } from 'react'
import { hashDocument } from '../../lib/documentHash'
import { getErrorMessage } from '../../lib/errors'
import { translate } from '../../lib/i18n'
import { useBlueprintStore } from '../../store/blueprintStore'
import { useEditorStore } from '../../store/editorStore'
import type { BlueprintRecord } from '../../types/blueprint'
import { AppErrorBoundary } from '../AppErrorBoundary'
import { Button, EmptyState } from '../ui'
import { ApplyBlueprintDialog } from './ApplyBlueprintDialog'
import { BlueprintCard } from './BlueprintCard'
import { BlueprintPreviewCanvas } from './BlueprintPreviewCanvas'

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
  const loadForMainDocument = useBlueprintStore((state) => state.loadForMainDocument)
  const saveWorkspace = useBlueprintStore((state) => state.saveWorkspace)
  const createSnapshotFromDocument = useBlueprintStore((state) => state.createSnapshotFromDocument)
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

  const blueprints = useMemo(() => workspace?.blueprints ?? [], [workspace])
  const selectedBlueprint = useMemo(
    () => blueprints.find((record) => record.id === selectedBlueprintId) ?? null,
    [blueprints, selectedBlueprintId],
  )
  const applyModalOpen = pendingApplyRecord !== null
  const blueprintActionsDisabled = topActionBusy || applyModalOpen || applyBusy
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params)

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
      {selectedBlueprint && selectedBlueprint.lifecycleStatus !== 'deleted' && (
        <section className="blueprints-panel__preview" aria-label={t('selectedBlueprintPreview')}>
          <div className="blueprints-panel__preview-header">
            <h3>{t('previewTitle', { title: selectedBlueprint.title })}</h3>
            <p>{t('previewHint')}</p>
          </div>
          <AppErrorBoundary
            compact
            resetKey={`${selectedBlueprint.id}:${selectedBlueprint.documentHash}`}
            title={t('blueprintPreviewFailed')}
            description={t('blueprintPreviewFailedDescription')}
            detailsLabel={t('errorDetails')}
            tryAgainLabel={t('tryAgain')}
            reloadLabel={t('reload')}
          >
            <BlueprintPreviewCanvas
              document={selectedBlueprint.document}
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
