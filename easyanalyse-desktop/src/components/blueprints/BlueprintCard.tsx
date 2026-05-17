import { useMemo } from 'react'
import { getBlueprintRuntimeState } from '../../lib/blueprintWorkspace'
import type { TranslationKey } from '../../lib/i18n'
import type { BlueprintRecord } from '../../types/blueprint'

interface BlueprintCardProps {
  record: BlueprintRecord
  currentMainHash: string | null
  selected: boolean
  actionsDisabled?: boolean
  validating?: boolean
  onSelect: () => void
  onValidate: () => void
  onApply: () => void
  onArchive: () => void
  onDelete: () => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

function countWarnings(record: BlueprintRecord) {
  return record.validationReport?.issues.filter((issue) => issue.severity === 'warning').length ?? 0
}

function formatAppliedAt(value: string) {
  return value.slice(0, 10)
}

function formatLifecycleStatus(status: BlueprintRecord['lifecycleStatus'], t: BlueprintCardProps['t']) {
  if (status === 'active') return t('active')
  if (status === 'archived') return t('archived')
  return t('deleted')
}

function formatValidationState(state: BlueprintRecord['validationState'], t: BlueprintCardProps['t']) {
  if (state === 'valid') return t('valid')
  if (state === 'invalid') return t('invalid')
  return t('unknown')
}

function formatSource(source: BlueprintRecord['source'], t: BlueprintCardProps['t']) {
  if (source === 'agent') return t('agentSource')
  if (source === 'manual_snapshot') return t('manualSnapshot')
  return source
}

export function BlueprintCard({
  record,
  currentMainHash,
  selected,
  actionsDisabled = false,
  validating = false,
  onSelect,
  onValidate,
  onApply,
  onArchive,
  onDelete,
  t,
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
          {formatLifecycleStatus(record.lifecycleStatus, t)}
        </span>
      </div>

      <div className="blueprint-card__meta" aria-label={t('blueprintStatus')}>
        <span>{t('validationStateLabel')}: {formatValidationState(record.validationState, t)}</span>
        <span>{t('sourceLabel')}: {formatSource(record.source, t)}</span>
        <span>{t('issuesLabel')}: {issueCount}</span>
        <span>{t('warningsLabel')}: {warningCount}</span>
      </div>

      <div className="blueprint-card__runtime">
        {runtime?.isCurrentMainDocument && <span>{t('currentMainDocument')}</span>}
        {runtime?.hasBaseHashMismatch && <span>{t('baseHashDiffers')}</span>}
        {!currentMainHash && <span>{t('currentMainHashPending')}</span>}
        {record.appliedInfo && <span>{t('appliedAt', { date: formatAppliedAt(record.appliedInfo.appliedAt) })}</span>}
      </div>

      <div className="blueprint-card__hashes">
        <span title={record.documentHash}>{t('documentHash', { hash: record.documentHash.slice(0, 12) })}</span>
        {record.baseMainDocumentHash && (
          <span title={record.baseMainDocumentHash}>{t('baseHash', { hash: record.baseMainDocumentHash.slice(0, 12) })}</span>
        )}
      </div>

      <div className="blueprint-card__actions">
        <button className="ghost-button" type="button" onClick={onSelect} disabled={actionsDisabled || isDeleted}>
          {t('select')}
        </button>
        <button className="ghost-button" type="button" onClick={onValidate} disabled={actionsDisabled || validating || isDeleted}>
          {validating ? t('validating') : t('validate')}
        </button>
        <button className="ghost-button" type="button" onClick={onApply} disabled={actionsDisabled || isDeleted}>
          {t('apply')}
        </button>
        <button className="ghost-button" type="button" onClick={onArchive} disabled={actionsDisabled || !canArchive}>
          {t('archive')}
        </button>
        <button className="ghost-button" type="button" onClick={onDelete} disabled={actionsDisabled || !canDelete}>
          {t('delete')}
        </button>
      </div>
    </article>
  )
}
