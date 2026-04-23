import { useMemo, useState } from 'react'
import { translate } from '../../lib/i18n'
import type { Locale, MobileShareSession } from '../../types/document'

interface MobileSharePanelProps {
  open: boolean
  locale: Locale
  loading: boolean
  error: string | null
  session: MobileShareSession | null
  onRefresh: () => void
  onStop: () => void
  onClose: () => void
}

export function MobileSharePanel({
  open,
  locale,
  loading,
  error,
  session,
  onRefresh,
  onStop,
  onClose,
}: MobileSharePanelProps) {
  const [copied, setCopied] = useState(false)

  const t = useMemo(
    () => (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  )

  if (!open) {
    return null
  }

  const issueSummary = session
    ? session.issueCount > 0
      ? t('shareIssueSummary', { count: session.issueCount })
      : t('shareIssueHealthy')
    : null

  const copyLink = async () => {
    if (!session?.url || !navigator.clipboard) {
      return
    }

    await navigator.clipboard.writeText(session.url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="share-overlay" role="presentation" onClick={onClose}>
      <div
        className="share-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-share-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="share-panel__header">
          <div>
            <span className="eyebrow">{t('shareToPhone')}</span>
            <h2 id="mobile-share-title">{t('sharePanelTitle')}</h2>
          </div>
          <button className="ghost-button" onClick={onClose}>
            {t('close')}
          </button>
        </div>

        <div className="share-panel__body">
          <p className="share-panel__hint">{t('sharePanelHint')}</p>
          <p className="share-panel__hint">{t('shareSnapshotHint')}</p>

          {loading && <div className="share-panel__status">{t('shareLoading')}</div>}
          {error && !loading && <div className="share-panel__status share-panel__status--error">{error}</div>}

          {session && !loading && (
            <>
              <div className="share-panel__qr" dangerouslySetInnerHTML={{ __html: session.qrSvg }} />

              <div className="share-panel__meta">
                <div className="share-panel__meta-row">
                  <span>{t('title')}</span>
                  <strong>{session.title}</strong>
                </div>
                <div className="share-panel__meta-row">
                  <span>{t('shareSnapshotTime')}</span>
                  <strong>{new Date(session.createdAt).toLocaleString()}</strong>
                </div>
                <div className="share-panel__meta-row">
                  <span>{t('shareExpiresAt')}</span>
                  <strong>{new Date(session.expiresAt).toLocaleString()}</strong>
                </div>
                <div className="share-panel__meta-row">
                  <span>{t('viewerValidation')}</span>
                  <strong>{issueSummary}</strong>
                </div>
              </div>

              <label className="field">
                <span>{t('shareLink')}</span>
                <input readOnly value={session.url} />
              </label>

              {session.alternateUrls.map((url, index) => (
                <label className="field" key={url}>
                  <span>{`${t('shareLink')} ${index + 2}`}</span>
                  <input readOnly value={url} />
                </label>
              ))}

              <div className="share-panel__actions">
                <button onClick={() => void copyLink()}>
                  {copied ? `${t('shareCopyLink')} OK` : t('shareCopyLink')}
                </button>
                <button className="ghost-button" onClick={onRefresh}>
                  {t('shareRefresh')}
                </button>
                <button className="ghost-button danger" onClick={onStop}>
                  {t('shareStop')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
