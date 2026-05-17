import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { diffBlueprintDocument, type BlueprintDiffSummary } from '../../lib/blueprintDiff'
import type { TranslationKey } from '../../lib/i18n'
import type { BlueprintRecord } from '../../types/blueprint'
import type { DocumentFile, ValidationIssue, ValidationReport } from '../../types/document'

interface ApplyBlueprintDialogProps {
  record: BlueprintRecord
  mainDocument: DocumentFile
  currentMainHash: string | null
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  applying?: boolean
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

function countIssues(report: ValidationReport | undefined, severity: ValidationIssue['severity']): number {
  return report?.issues.filter((issue) => issue.severity === severity).length ?? 0
}

function hasBaseMismatch(record: BlueprintRecord, currentMainHash: string | null): boolean {
  return Boolean(record.baseMainDocumentHash && currentMainHash && record.baseMainDocumentHash !== currentMainHash)
}

function formatValidationBoolean(value: boolean | undefined, t: ApplyBlueprintDialogProps['t']) {
  if (value === undefined) return t('unknown')
  return value ? t('valid') : t('invalid')
}

function formatValidationState(state: BlueprintRecord['validationState'], t: ApplyBlueprintDialogProps['t']) {
  if (state === 'valid') return t('valid')
  if (state === 'invalid') return t('invalid')
  return t('unknown')
}

function ValidationReportView({ record, t }: { record: BlueprintRecord; t: ApplyBlueprintDialogProps['t'] }) {
  const report = record.validationReport
  const errors = countIssues(report, 'error')
  const warnings = countIssues(report, 'warning')
  return (
    <section className="apply-blueprint-dialog__section" aria-label={t('validationReport')}>
      <h4>{t('validationReport')}</h4>
      <p>
        {t('validationReportSummary', {
          state: formatValidationState(record.validationState, t),
          format: report?.detectedFormat ?? t('unknown'),
          schema: formatValidationBoolean(report?.schemaValid, t),
          semantic: formatValidationBoolean(report?.semanticValid, t),
        })}
      </p>
      <p>
        {t('validationIssueSummary', { errors, warnings, issues: report?.issueCount ?? report?.issues.length ?? 0 })}
      </p>
      {report && report.issues.length > 0 && (
        <ul>
          {report.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>
              <strong>{issue.severity}</strong> {issue.code}: {issue.message}
              {issue.path ? ` (${issue.path})` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function DiffList({ title, items, t }: { title: string; items: string[]; t: ApplyBlueprintDialogProps['t'] }) {
  if (items.length === 0) {
    return null
  }
  return (
    <div>
      <strong>{title}</strong>
      <ul>
        {items.slice(0, 8).map((item) => <li key={item}>{item}</li>)}
        {items.length > 8 && <li>{t('moreItems', { count: items.length - 8 })}</li>}
      </ul>
    </div>
  )
}

function buildDiffSummaryLines(diff: BlueprintDiffSummary, t: ApplyBlueprintDialogProps['t']) {
  const lines = [
    t('diffDevicesSummary', {
      added: diff.devices.added.length,
      removed: diff.devices.removed.length,
      changed: diff.devices.changed.length,
    }),
    t('diffTerminalsSummary', {
      added: diff.terminals.added.length,
      removed: diff.terminals.removed.length,
      changed: diff.terminals.changed.length,
      labelChanges: diff.terminals.labelChanged.length,
    }),
    t('diffLabelsSummary', { changed: diff.labels.changed.length }),
  ]
  if (diff.viewChanged) lines.push(t('viewLayoutChanged'))
  if (diff.documentMetaChanged) lines.push(t('documentMetadataChanged'))
  if (diff.rawJsonChanged) lines.push(t('rawJsonChanged'))
  if (!diff.rawJsonChanged) lines.push(t('noDocumentChangesDetected'))
  return lines
}

function DiffSummaryView({ diff, t }: { diff: BlueprintDiffSummary; t: ApplyBlueprintDialogProps['t'] }) {
  return (
    <section className="apply-blueprint-dialog__section" aria-label={t('blueprintDiffSummary')}>
      <h4>{t('blueprintDiffSummary')}</h4>
      <ul>
        {buildDiffSummaryLines(diff, t).map((line) => <li key={line}>{line}</li>)}
      </ul>
      <DiffList title={t('addedDevices')} items={diff.devices.added} t={t} />
      <DiffList title={t('removedDevices')} items={diff.devices.removed} t={t} />
      <DiffList title={t('changedDevices')} items={diff.devices.changed} t={t} />
      <DiffList title={t('addedTerminals')} items={diff.terminals.added} t={t} />
      <DiffList title={t('removedTerminals')} items={diff.terminals.removed} t={t} />
      <DiffList title={t('changedTerminals')} items={diff.terminals.changed} t={t} />
      <DiffList title={t('terminalLabelChanges')} items={diff.terminals.labelChanged} t={t} />
      <DiffList title={t('networkLabelChanges')} items={diff.labels.changed} t={t} />
    </section>
  )
}

export function ApplyBlueprintDialog({
  record,
  mainDocument,
  currentMainHash,
  onCancel,
  onConfirm,
  applying = false,
  t,
}: ApplyBlueprintDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const diff = useMemo(() => diffBlueprintDocument(mainDocument, record.document), [mainDocument, record.document])
  const riskyValidation = record.validationState !== 'valid'
  const baseMismatch = hasBaseMismatch(record, currentMainHash)
  const hasErrors = countIssues(record.validationReport, 'error') > 0 || record.validationState === 'invalid'

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>('button[data-modal-initial-focus]')?.focus()
  }, [])

  const handleCancel = () => {
    if (!applying) {
      onCancel()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
      return
    }
    if (event.key !== 'Tab') {
      return
    }
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )
    if (focusable.length === 0) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!event.shiftKey && window.document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && window.document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  }

  return (
    <div className="apply-blueprint-dialog__backdrop" onClick={handleCancel} onKeyDownCapture={handleKeyDown}>
      <div
        ref={dialogRef}
        className="apply-blueprint-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-blueprint-dialog-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="apply-blueprint-dialog__header">
          <h3 id="apply-blueprint-dialog-title">{t('applyBlueprint')}</h3>
          <button type="button" className="ghost-button" onClick={handleCancel} disabled={applying} aria-label={t('closeApplyBlueprintDialog')}>
            ×
          </button>
        </div>
        <p>{t('applyBlueprintIntro', { title: record.title })}</p>
        {riskyValidation && (
          <div className="apply-blueprint-dialog__risk" role="alert">
            <strong>{t('strongRiskWarning')}</strong> {t('strongRiskWarningDetail', { state: formatValidationState(record.validationState, t) })}
          </div>
        )}
        {hasErrors && (
          <div className="apply-blueprint-dialog__risk" role="alert">
            {t('validationErrorsPresent')}
          </div>
        )}
        {baseMismatch && (
          <div className="apply-blueprint-dialog__risk" role="alert">
            {t('baseHashMismatchWarning')}
          </div>
        )}
        <ValidationReportView record={record} t={t} />
        <DiffSummaryView diff={diff} t={t} />
        <details className="apply-blueprint-dialog__section">
          <summary>{t('rawJsonPreview')}</summary>
          <pre>{JSON.stringify(record.document, null, 2)}</pre>
        </details>
        <div className="apply-blueprint-dialog__actions">
          <button type="button" className="ghost-button" onClick={handleCancel} disabled={applying} data-modal-initial-focus>{t('cancel')}</button>
          <button type="button" onClick={() => void onConfirm()} disabled={applying}>
            {applying ? t('applying') : t('confirmApply')}
          </button>
        </div>
      </div>
    </div>
  )
}
