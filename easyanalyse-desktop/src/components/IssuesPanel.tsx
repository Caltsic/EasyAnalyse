import { translate } from '../lib/i18n'
import { useEditorStore } from '../store/editorStore'
import type { DiffSummary, ValidationIssue } from '../types/document'

export function IssuesPanel({
  issues,
  diffSummary,
  statusMessage,
}: {
  issues: ValidationIssue[]
  diffSummary: DiffSummary | null
  statusMessage: string | null
}) {
  const locale = useEditorStore((state) => state.locale)
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params)

  const diffLabels = {
    components: locale === 'zh-CN' ? '器件' : 'Components',
    ports: locale === 'zh-CN' ? '端点' : 'Ports',
    nodes: locale === 'zh-CN' ? '节点' : 'Nodes',
    wires: locale === 'zh-CN' ? '线' : 'Wires',
    annotations: locale === 'zh-CN' ? '注释' : 'Annotations',
  } as const

  return (
    <section className="panel issues">
      <div className="panel__header">
        <div className="panel__heading">
          <span className="eyebrow">{t('validation')}</span>
          <h2>{t('issuesAndDiff')}</h2>
        </div>
      </div>

      <div className="panel__body issues__body">
        {statusMessage && <div className="status-banner">{statusMessage}</div>}

        {diffSummary && (
          <div className="diff-grid">
            {(
              Object.entries(diffSummary).filter(([key]) => key !== 'totalChanges') as Array<
                [keyof Omit<DiffSummary, 'totalChanges'>, DiffSummary[keyof Omit<DiffSummary, 'totalChanges'>]]
              >
            ).map(([key, bucket]) => (
              <article className="diff-card" key={key}>
                <span>{diffLabels[key]}</span>
                <strong>{bucket.added + bucket.removed + bucket.changed}</strong>
                <small>
                  +{bucket.added} / -{bucket.removed} / ~{bucket.changed}
                </small>
              </article>
            ))}
          </div>
        )}

        <div className="issue-list">
          {issues.length ? (
            issues.map((issue, index) => (
              <article className={`issue issue--${issue.severity}`} key={`${issue.code}-${index}`}>
                <div>
                  <strong>{issue.code}</strong>
                  <p>{issue.message}</p>
                </div>
                <span>{issue.entityId ?? issue.path ?? t('documentLabel')}</span>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <strong>{t('noValidationFindings')}</strong>
              <p>{t('cleanDocumentHint')}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
