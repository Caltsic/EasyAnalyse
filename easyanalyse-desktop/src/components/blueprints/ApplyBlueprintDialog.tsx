import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { diffBlueprintDocument, type BlueprintDiffSummary } from '../../lib/blueprintDiff'
import type { BlueprintRecord } from '../../types/blueprint'
import type { DocumentFile, ValidationIssue, ValidationReport } from '../../types/document'

interface ApplyBlueprintDialogProps {
  record: BlueprintRecord
  mainDocument: DocumentFile
  currentMainHash: string | null
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  applying?: boolean
}

function countIssues(report: ValidationReport | undefined, severity: ValidationIssue['severity']): number {
  return report?.issues.filter((issue) => issue.severity === severity).length ?? 0
}

function hasBaseMismatch(record: BlueprintRecord, currentMainHash: string | null): boolean {
  return Boolean(record.baseMainDocumentHash && currentMainHash && record.baseMainDocumentHash !== currentMainHash)
}

function ValidationReportView({ record }: { record: BlueprintRecord }) {
  const report = record.validationReport
  const errors = countIssues(report, 'error')
  const warnings = countIssues(report, 'warning')
  return (
    <section className="apply-blueprint-dialog__section" aria-label="Validation report">
      <h4>Validation report</h4>
      <p>
        State: {record.validationState}. Format: {report?.detectedFormat ?? 'unknown'}. Schema:{' '}
        {report ? (report.schemaValid ? 'valid' : 'invalid') : 'unknown'}. Semantic:{' '}
        {report ? (report.semanticValid ? 'valid' : 'invalid') : 'unknown'}.
      </p>
      <p>
        Errors: {errors}. Warnings: {warnings}. Issues: {report?.issueCount ?? report?.issues.length ?? 0}.
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

function DiffList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null
  }
  return (
    <div>
      <strong>{title}</strong>
      <ul>
        {items.slice(0, 8).map((item) => <li key={item}>{item}</li>)}
        {items.length > 8 && <li>{items.length - 8} more…</li>}
      </ul>
    </div>
  )
}

function DiffSummaryView({ diff }: { diff: BlueprintDiffSummary }) {
  return (
    <section className="apply-blueprint-dialog__section" aria-label="Blueprint diff summary">
      <h4>Diff summary</h4>
      <ul>
        {diff.summaryLines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <DiffList title="Added devices" items={diff.devices.added} />
      <DiffList title="Removed devices" items={diff.devices.removed} />
      <DiffList title="Changed devices" items={diff.devices.changed} />
      <DiffList title="Added terminals" items={diff.terminals.added} />
      <DiffList title="Removed terminals" items={diff.terminals.removed} />
      <DiffList title="Changed terminals" items={diff.terminals.changed} />
      <DiffList title="Terminal label changes" items={diff.terminals.labelChanged} />
      <DiffList title="Network label changes" items={diff.labels.changed} />
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
          <h3 id="apply-blueprint-dialog-title">Apply blueprint</h3>
          <button type="button" className="ghost-button" onClick={handleCancel} disabled={applying} aria-label="Close apply blueprint dialog">
            ×
          </button>
        </div>
        <p>
          You are about to replace the in-memory main document with blueprint “{record.title}”. This does not save the main
          document or blueprint sidecar to disk.
        </p>
        {riskyValidation && (
          <div className="apply-blueprint-dialog__risk" role="alert">
            <strong>Strong risk warning:</strong> this blueprint is {record.validationState}. Application is allowed, but review the
            validation report before continuing.
          </div>
        )}
        {hasErrors && (
          <div className="apply-blueprint-dialog__risk" role="alert">
            Validation errors are present; applying is allowed, but a later save to disk may fail.
          </div>
        )}
        {baseMismatch && (
          <div className="apply-blueprint-dialog__risk" role="alert">
            Base main document hash differs from the current main document. Treat this as a whole-document replacement risk;
            no merge will be attempted.
          </div>
        )}
        <ValidationReportView record={record} />
        <DiffSummaryView diff={diff} />
        <details className="apply-blueprint-dialog__section">
          <summary>Raw JSON preview</summary>
          <pre>{JSON.stringify(record.document, null, 2)}</pre>
        </details>
        <div className="apply-blueprint-dialog__actions">
          <button type="button" className="ghost-button" onClick={handleCancel} disabled={applying} data-modal-initial-focus>Cancel</button>
          <button type="button" onClick={() => void onConfirm()} disabled={applying}>
            {applying ? 'Applying' : 'Confirm apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
