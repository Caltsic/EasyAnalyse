import { useMemo } from 'react'
import { getBlueprintRuntimeState } from '../../lib/blueprintWorkspace'
import type { BlueprintRecord } from '../../types/blueprint'

interface BlueprintCardProps {
  record: BlueprintRecord
  currentMainHash: string | null
  selected: boolean
  actionsDisabled?: boolean
  validating?: boolean
  onSelect: () => void
  onValidate: () => void
  onArchive: () => void
  onDelete: () => void
}

function countWarnings(record: BlueprintRecord) {
  return record.validationReport?.issues.filter((issue) => issue.severity === 'warning').length ?? 0
}

function formatAppliedAt(value: string) {
  return value.slice(0, 10)
}

export function BlueprintCard({
  record,
  currentMainHash,
  selected,
  actionsDisabled = false,
  validating = false,
  onSelect,
  onValidate,
  onArchive,
  onDelete,
}: BlueprintCardProps) {
  const runtime = useMemo(
    () => (currentMainHash ? getBlueprintRuntimeState(record, currentMainHash) : null),
    [currentMainHash, record],
  )
  const issueCount = record.validationReport?.issueCount ?? record.validationReport?.issues.length ?? 0
  const warningCount = countWarnings(record)
  const isDeleted = record.lifecycleStatus === 'deleted'
  const canArchive = record.lifecycleStatus === 'active'
  const canDelete = record.lifecycleStatus !== 'deleted'

  return (
    <article
      className={selected ? 'blueprint-card is-selected' : 'blueprint-card'}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="blueprint-card__header">
        <div>
          <h3>{record.title}</h3>
          {record.description && <p>{record.description}</p>}
        </div>
        <span className={`blueprint-badge blueprint-badge--${record.lifecycleStatus}`}>
          {record.lifecycleStatus}
        </span>
      </div>

      <div className="blueprint-card__meta" aria-label="Blueprint status">
        <span>Validation: {record.validationState}</span>
        <span>Source: {record.source}</span>
        <span>Issues: {issueCount}</span>
        <span>Warnings: {warningCount}</span>
      </div>

      <div className="blueprint-card__runtime">
        {runtime?.isCurrentMainDocument && <span>Current main document</span>}
        {runtime?.hasBaseHashMismatch && <span>Base hash differs</span>}
        {!currentMainHash && <span>Current main hash pending</span>}
        {record.appliedInfo && <span>Applied {formatAppliedAt(record.appliedInfo.appliedAt)}</span>}
      </div>

      <div className="blueprint-card__hashes">
        <span title={record.documentHash}>Document hash: {record.documentHash.slice(0, 12)}</span>
        {record.baseMainDocumentHash && (
          <span title={record.baseMainDocumentHash}>Base hash: {record.baseMainDocumentHash.slice(0, 12)}</span>
        )}
      </div>

      <div className="blueprint-card__actions">
        <button className="ghost-button" type="button" onClick={onSelect} disabled={actionsDisabled || isDeleted}>
          Select
        </button>
        <button className="ghost-button" type="button" onClick={onValidate} disabled={actionsDisabled || validating || isDeleted}>
          {validating ? 'Validating' : 'Validate'}
        </button>
        <button className="ghost-button" type="button" onClick={onArchive} disabled={actionsDisabled || !canArchive}>
          Archive
        </button>
        <button className="ghost-button" type="button" onClick={onDelete} disabled={actionsDisabled || !canDelete}>
          Delete
        </button>
      </div>
    </article>
  )
}
