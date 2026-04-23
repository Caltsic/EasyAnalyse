import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import '../../App.css'
import { CloudBackground } from '../layout/CloudBackground'
import { collectTerminalLabels, getDeviceReference, getTerminalDisplayLabel } from '../../lib/document'
import { deriveCircuitInsights } from '../../lib/circuitDescription'
import { fetchSharedSession } from '../../lib/tauri'
import { getStoredLocale, translate } from '../../lib/i18n'
import { useTheme } from '../../lib/useTheme'
import type { DeviceProperties, Locale, MobileSharePayload } from '../../types/document'

type ViewerSelection =
  | { entityType: 'device'; id: string }
  | { entityType: 'networkLine'; id: string }
  | { entityType: 'label'; key: string }
  | null

const PROPERTY_ORDER: Array<keyof DeviceProperties> = [
  'value',
  'voltage',
  'outputVoltage',
  'nominalVoltage',
  'frequency',
  'partNumber',
  'package',
]

const MobileViewerCanvas = lazy(() =>
  import('./MobileViewerCanvas').then((module) => ({ default: module.MobileViewerCanvas })),
)

function getLandscapeState() {
  if (typeof window === 'undefined') {
    return true
  }

  const width = window.innerWidth
  const height = window.innerHeight
  const coarsePointer = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false
  const likelyPhone = coarsePointer && Math.min(width, height) < 720
  return !likelyPhone || width >= height
}

function useLandscapeReady() {
  const [ready, setReady] = useState(() => getLandscapeState())

  useEffect(() => {
    const update = () => setReady(getLandscapeState())
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return ready
}

function getPreferredLocale(payload: MobileSharePayload | null): Locale {
  if (payload?.document.document.language === 'en-US') {
    return 'en-US'
  }

  return getStoredLocale()
}

function getOrderedProperties(properties: DeviceProperties | undefined) {
  if (!properties) {
    return []
  }

  const entries = Object.entries(properties).filter(([, value]) => {
    if (typeof value === 'string') {
      return value.trim().length > 0
    }
    return value !== null && value !== undefined
  })

  const order = new Map(PROPERTY_ORDER.map((key, index) => [key, index] as const))
  return entries.sort((left, right) => {
    const leftRank = order.get(left[0] as keyof DeviceProperties) ?? Number.MAX_SAFE_INTEGER
    const rightRank = order.get(right[0] as keyof DeviceProperties) ?? Number.MAX_SAFE_INTEGER
    return leftRank - rightRank || left[0].localeCompare(right[0])
  })
}

export function MobileViewerApp() {
  const { theme, isDarkTheme, toggleTheme } = useTheme()
  const [payload, setPayload] = useState<MobileSharePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<ViewerSelection>(null)
  const [query, setQuery] = useState('')
  const [locale, setLocale] = useState<Locale>('zh-CN')
  const landscapeReady = useLandscapeReady()

  const token = useMemo(() => new URLSearchParams(window.location.search).get('token')?.trim() ?? '', [])
  const t = useMemo(
    () => (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  )

  useEffect(() => {
    let cancelled = false

    if (!token) {
      setError('viewerTokenMissing')
      setLoading(false)
      return
    }

    const load = async () => {
      try {
        setLoading(true)
        const nextPayload = await fetchSharedSession(token)
        if (cancelled) {
          return
        }

        setPayload(nextPayload)
        setLocale(getPreferredLocale(nextPayload))
        setError(null)
      } catch (loadError) {
        if (cancelled) {
          return
        }
        const message = loadError instanceof Error ? loadError.message : String(loadError)
        setError(/expired|unavailable/i.test(message) ? 'viewerExpired' : message)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [token])

  const document = payload?.document ?? null
  const report = payload?.report ?? null
  const insights = useMemo(
    () => (document ? deriveCircuitInsights(document, locale) : null),
    [document, locale],
  )

  const selectedDeviceId = selection?.entityType === 'device' ? selection.id : null
  const selectedNetworkLineId = selection?.entityType === 'networkLine' ? selection.id : null
  const selectedLabelKey =
    selection?.entityType === 'label'
      ? selection.key
      : selection?.entityType === 'networkLine'
        ? document?.view.networkLines?.[selection.id]?.label?.trim() ?? null
        : null

  const selectedDevice =
    selectedDeviceId && document
      ? document.devices.find((device) => device.id === selectedDeviceId) ?? null
      : null
  const selectedNetworkLine =
    selectedNetworkLineId && document?.view.networkLines
      ? { id: selectedNetworkLineId, source: document.view.networkLines[selectedNetworkLineId] ?? null }
      : null
  const selectedLabelDevices =
    selectedLabelKey && insights
      ? insights.connectionHighlightsByKey[selectedLabelKey]?.deviceIds
          .map((deviceId) => insights.deviceById[deviceId])
          .filter(Boolean) ?? []
      : []

  const allLabels = useMemo(() => (document ? collectTerminalLabels(document) : []), [document])
  const searchResults = useMemo(() => {
    if (!document || !insights) {
      return { devices: [], labels: [] }
    }

    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return {
        devices: document.devices.slice(0, 5),
        labels: allLabels.slice(0, 6),
      }
    }

    const devices = document.devices.filter((device) => {
      const reference = getDeviceReference(device, document).toLowerCase()
      const name = device.name.toLowerCase()
      return reference.includes(normalized) || name.includes(normalized)
    })

    const labels = allLabels.filter((label) => label.toLowerCase().includes(normalized))
    return {
      devices: devices.slice(0, 8),
      labels: labels.slice(0, 8),
    }
  }, [allLabels, document, insights, query])

  if (loading) {
    return (
      <div className="viewer-shell">
        <CloudBackground />
        <div className="viewer-shell__content viewer-shell__content--centered">
          <strong>{t('viewerLoading')}</strong>
        </div>
      </div>
    )
  }

  if (!payload || !document || !report || !insights) {
    return (
      <div className="viewer-shell">
        <CloudBackground />
        <div className="viewer-shell__content viewer-shell__content--centered">
          <strong>{error && error in { viewerTokenMissing: 1, viewerExpired: 1 } ? t(error as 'viewerTokenMissing' | 'viewerExpired') : error || t('viewerUnavailable')}</strong>
        </div>
      </div>
    )
  }

  if (!landscapeReady) {
    return (
      <div className="viewer-shell viewer-shell--rotate">
        <CloudBackground />
        <div className="viewer-rotate">
          <span className="eyebrow">{t('viewerViewOnly')}</span>
          <h1>{t('viewerRotateTitle')}</h1>
          <p>{t('viewerRotateHint')}</p>
        </div>
      </div>
    )
  }

  const issueChip = report.issueCount > 0 ? t('validationIssues', { count: report.issueCount }) : t('validationHealthy')
  const activeProperties = getOrderedProperties(selectedDevice?.properties)
  const activeTerminals = selectedDevice?.terminals ?? []
  const activeLabelHighlights = selectedLabelKey ? insights.connectionHighlightsByKey[selectedLabelKey] : null

  return (
    <div className="viewer-shell">
      <CloudBackground />
      <div className="viewer-shell__content">
        <header className="viewer-topbar">
          <div className="viewer-topbar__copy">
            <span className="eyebrow">{t('viewerViewOnly')}</span>
            <h1>{document.document.title}</h1>
            <p>{t('viewerSharedFromDesktop')}</p>
          </div>
          <div className="viewer-topbar__meta">
            <span className={report.issueCount > 0 ? 'status-chip status-chip--warning' : 'status-chip'}>
              {issueChip}
            </span>
            <button className="ghost-button" onClick={toggleTheme}>
              {t(isDarkTheme ? 'themeLight' : 'themeDark')}
            </button>
            <span>{new Date(payload.createdAt).toLocaleString()}</span>
          </div>
        </header>

        <main className="viewer-layout">
          <Suspense fallback={<div className="viewer-canvas-loading">{t('viewerLoading')}</div>}>
            <MobileViewerCanvas
              document={document}
              insights={insights}
              theme={theme}
              locale={locale}
              selectedDeviceId={selectedDeviceId}
              selectedLabelKey={selectedLabelKey}
              selectedNetworkLineId={selectedNetworkLineId}
              onSelectDevice={(id) => setSelection({ entityType: 'device', id })}
              onSelectNetworkLine={(id) => setSelection({ entityType: 'networkLine', id })}
              onSelectLabel={(key) => setSelection({ entityType: 'label', key })}
              onClearSelection={() => setSelection(null)}
            />
          </Suspense>

          <section className="viewer-sheet">
            <div className="viewer-sheet__header">
              <div>
                <span className="eyebrow">{t('viewerDetails')}</span>
                <h2>
                  {selectedDevice
                    ? `${getDeviceReference(selectedDevice, document)} ${selectedDevice.name}`
                    : selectedNetworkLine?.source?.label?.trim() || selectedLabelKey || document.document.title}
                </h2>
              </div>
              {selection && (
                <button className="ghost-button" onClick={() => setSelection(null)}>
                  {t('viewerBackToOverview')}
                </button>
              )}
            </div>

            <div className="viewer-sheet__body">
              <label className="field">
                <span>{t('viewerSearch')}</span>
                <input
                  value={query}
                  placeholder={t('viewerSearch')}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>

              <section className="viewer-section">
                <span className="eyebrow">{t('viewerSearchResults')}</span>
                <div className="viewer-list">
                  {searchResults.devices.map((device) => (
                    <button
                      key={device.id}
                      className="entity-list__item"
                      onClick={() => setSelection({ entityType: 'device', id: device.id })}
                    >
                      <span>{`${getDeviceReference(device, document)} ${device.name}`}</span>
                    </button>
                  ))}
                  {searchResults.labels.map((label) => (
                    <button
                      key={label}
                      className="entity-list__item"
                      onClick={() => setSelection({ entityType: 'label', key: label })}
                    >
                      <span>{label}</span>
                    </button>
                  ))}
                  {!searchResults.devices.length && !searchResults.labels.length && (
                    <div className="viewer-empty">{t('viewerNoResults')}</div>
                  )}
                </div>
              </section>

              {selectedDevice && (
                <>
                  <section className="viewer-section">
                    <span className="eyebrow">{t('viewerProperties')}</span>
                    <div className="viewer-kv">
                      <div className="viewer-kv__row">
                        <span>{t('kind')}</span>
                        <strong>{selectedDevice.kind}</strong>
                      </div>
                      {selectedDevice.category?.trim() && (
                        <div className="viewer-kv__row">
                          <span>{t('category')}</span>
                          <strong>{selectedDevice.category}</strong>
                        </div>
                      )}
                      {activeProperties.map(([key, value]) => (
                        <div className="viewer-kv__row" key={key}>
                          <span>{t((PROPERTY_ORDER.includes(key as keyof DeviceProperties) ? key : 'description') as Parameters<typeof translate>[1])}</span>
                          <strong>{String(value)}</strong>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="viewer-section">
                    <span className="eyebrow">{t('viewerTerminals')}</span>
                    <div className="viewer-list">
                      {activeTerminals.map((terminal) => (
                        <div className="list-item" key={terminal.id}>
                          <div>
                            <strong>{getTerminalDisplayLabel(terminal)}</strong>
                            <div className="viewer-inline-meta">
                              <span>{translate(locale, terminal.direction)}</span>
                              {terminal.label?.trim() && (
                                <button
                                  className="viewer-inline-link"
                                  onClick={() => setSelection({ entityType: 'label', key: terminal.label!.trim() })}
                                >
                                  {terminal.label!.trim()}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {!selectedDevice && (selectedLabelKey || selectedNetworkLine?.source) && (
                <>
                  <section className="viewer-section">
                    <span className="eyebrow">{t('viewerConnections')}</span>
                    <div className="viewer-kv">
                      <div className="viewer-kv__row">
                        <span>{t('viewerSharedLabel')}</span>
                        <strong>{selectedLabelKey ?? selectedNetworkLine?.source?.label?.trim()}</strong>
                      </div>
                      <div className="viewer-kv__row">
                        <span>{t('members')}</span>
                        <strong>{activeLabelHighlights?.terminalIds.length ?? 0}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="viewer-section">
                    <span className="eyebrow">{t('viewerRelatedDevices')}</span>
                    <div className="viewer-list">
                      {selectedLabelDevices.map((device) => (
                        <button
                          key={device.id}
                          className="entity-list__item"
                          onClick={() => setSelection({ entityType: 'device', id: device.id })}
                        >
                          <span>{device.title}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {!selection && (
                <>
                  <section className="viewer-section">
                    <span className="eyebrow">{t('viewerDocumentSummary')}</span>
                    <div className="viewer-kv">
                      <div className="viewer-kv__row">
                        <span>{t('devicesCount', { count: document.devices.length })}</span>
                        <strong>{document.devices.length}</strong>
                      </div>
                      <div className="viewer-kv__row">
                        <span>{t('labelsCount', { count: insights.connectionGroups.length })}</span>
                        <strong>{insights.connectionGroups.length}</strong>
                      </div>
                      <div className="viewer-kv__row">
                        <span>{t('shareExpiresAt')}</span>
                        <strong>{new Date(payload.expiresAt).toLocaleString()}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="viewer-section">
                    <span className="eyebrow">{t('viewerValidation')}</span>
                    <div className="viewer-list">
                      {report.issues.length === 0 ? (
                        <div className="viewer-empty">{t('validationHealthy')}</div>
                      ) : (
                        report.issues.slice(0, 12).map((issue, index) => (
                          <div className="list-item" key={`${issue.code}-${index}`}>
                            <div>
                              <strong>{issue.code}</strong>
                              <div className="viewer-inline-meta">
                                <span>{issue.message}</span>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
