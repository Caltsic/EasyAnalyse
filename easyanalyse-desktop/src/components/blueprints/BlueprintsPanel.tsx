import { useEffect, useMemo, useRef, useState } from 'react'
import { hashDocument } from '../../lib/documentHash'
import { useBlueprintStore } from '../../store/blueprintStore'
import { useEditorStore } from '../../store/editorStore'
import type { BlueprintRecord } from '../../types/blueprint'
import { ApplyBlueprintDialog } from './ApplyBlueprintDialog'
import { BlueprintCard } from './BlueprintCard'
import { BlueprintPreviewCanvas } from './BlueprintPreviewCanvas'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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
    await runTopAction('Creating snapshot', async () => {
      await createSnapshotFromDocument(document, {
        title: document.document.title,
        description: editorDirty ? 'Snapshot from unsaved main document state' : undefined,
      })
    })
  }

  const handleSave = async () => {
    await runTopAction('Saving workspace', async () => {
      await saveWorkspace()
    })
  }

  const handleReload = async () => {
    await runTopAction('Reloading workspace', async () => {
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
    <section className="blueprints-panel" aria-label="Blueprints">
      <div className="blueprints-panel__header">
        <div>
          <h2>Blueprints</h2>
          <p>{dirty ? 'Workspace dirty' : 'Workspace clean'}</p>
        </div>
        <div className="blueprints-panel__actions">
          <button type="button" onClick={() => void handleCreateSnapshot()} disabled={topActionBusy}>
            Create snapshot
          </button>
          <button className="ghost-button" type="button" onClick={() => void handleSave()} disabled={topActionBusy}>
            Save workspace
          </button>
          <button className="ghost-button" type="button" onClick={() => void handleReload()} disabled={topActionBusy}>
            Reload
          </button>
        </div>
      </div>

      <div className="blueprints-panel__status" aria-label="Blueprint workspace status">
        <span>{sidecarPath ? `Sidecar: ${sidecarPath}` : 'Sidecar: not available until the main document is saved'}</span>
        <span>{sidecarPath ? 'Persistent sidecar workspace' : 'In-memory workspace'}</span>
        {editorDirty && <span>Main document has unsaved changes. Snapshots capture the current unsaved editor state.</span>}
        {!sidecarPath && <span>Save the main document to enable a persistent sidecar path.</span>}
        {busyMessage && <span>{busyMessage}</span>}
        {loadError && <span>Load error: {loadError}</span>}
        {saveError && <span>Save error: {saveError}</span>}
        {validationError && <span>Validation error: {validationError}</span>}
        {actionError && <span>Action error: {actionError}</span>}
      </div>

      {blueprints.length === 0 ? (
        <div className="blueprints-panel__empty">
          <h3>No blueprints yet</h3>
          <p>Create a snapshot to keep a sidecar blueprint for this main document.</p>
        </div>
      ) : (
        <div className="blueprints-panel__list" aria-label="Blueprint list">
          {blueprints.map((record) => (
            <BlueprintCard
              key={record.id}
              record={record}
              currentMainHash={currentMainHash}
              selected={record.id === selectedBlueprintId}
              actionsDisabled={blueprintActionsDisabled}
              validating={validatingBlueprintIds.has(record.id)}
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
        <section className="blueprints-panel__preview" aria-label="Selected blueprint preview">
          <div className="blueprints-panel__preview-header">
            <h3>Preview: {selectedBlueprint.title}</h3>
            <p>Read-only blueprint preview. It does not mutate the main document.</p>
          </div>
          <BlueprintPreviewCanvas
            document={selectedBlueprint.document}
            locale={locale}
            className="blueprints-panel__preview-canvas"
          />
        </section>
      )}
      {pendingApplyRecord && (
        <ApplyBlueprintDialog
          record={pendingApplyRecord}
          mainDocument={document}
          currentMainHash={currentMainHash}
          applying={applyBusy}
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
