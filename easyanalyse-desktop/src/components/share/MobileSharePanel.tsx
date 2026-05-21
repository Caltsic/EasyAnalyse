import { useMemo, useState } from 'react'
import { translate } from '../../lib/i18n'
import type { Locale, MobileShareSession } from '../../types/document'
import { Button, ModalShell } from '../ui'

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
    <ModalShell
      rootClassName="share-overlay"
      panelClassName="share-panel"
      ariaLabelledBy="mobile-share-title"
      onClose={onClose}
    >
      <div className="share-panel__header">
        <div>
          <span className="eyebrow">{t('shareToPhone')}</span>
          <h2 id="mobile-share-title">{t('sharePanelTitle')}</h2>
        </div>
        <Button className="ghost-button" variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
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
              <Button onClick={() => void copyLink()}>
                {copied ? `${t('shareCopyLink')} OK` : t('shareCopyLink')}
              </Button>
              <Button className="ghost-button" variant="ghost" onClick={onRefresh}>
                {t('shareRefresh')}
              </Button>
              <Button className="ghost-button danger" variant="danger" onClick={onStop}>
                {t('shareStop')}
              </Button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  )
}
