import { useMemo, useState, type ReactNode } from 'react'
import { deriveCircuitInsights } from '../lib/circuitDescription'
import {
  collectTerminalLabels,
  getEntityTitle,
  getTerminalDisplayLabel,
} from '../lib/document'
import { translate } from '../lib/i18n'
import { useEditorStore } from '../store/editorStore'
import type {
  NetworkLineOrientation,
  TerminalDirection,
  TerminalSide,
} from '../types/document'

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function parseNumber(value: string, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseTags(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function TerminalButtons({
  onAddTerminal,
  locale,
}: {
  onAddTerminal: (direction: TerminalDirection) => void
  locale: 'zh-CN' | 'en-US'
}) {
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params)

  return (
    <div className="inspector-actions">
      <button className="ghost-button" onClick={() => onAddTerminal('input')}>
        {t('addInput')}
      </button>
      <button className="ghost-button" onClick={() => onAddTerminal('output')}>
        {t('addOutput')}
      </button>
      <button className="ghost-button" onClick={() => onAddTerminal('bidirectional')}>
        {t('addBidirectional')}
      </button>
      <button className="ghost-button" onClick={() => onAddTerminal('passive')}>
        {t('addPassive')}
      </button>
      <button className="ghost-button" onClick={() => onAddTerminal('power-in')}>
        {t('addPowerIn')}
      </button>
      <button className="ghost-button" onClick={() => onAddTerminal('ground')}>
        {t('addGround')}
      </button>
    </div>
  )
}

function LabelAutocomplete({
  value,
  suggestions,
  onChange,
  hint,
}: {
  value: string
  suggestions: string[]
  onChange: (value: string) => void
  hint: string
}) {
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase()
    return suggestions
      .filter((item) => item.trim())
      .filter((item) => item !== value)
      .filter((item) => !query || item.toLowerCase().startsWith(query))
      .slice(0, 10)
  }, [suggestions, value])

  return (
    <div className="autocomplete">
      <input
        value={value}
        placeholder={hint}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setOpen(true)
          onChange(event.target.value)
        }}
      />
      {open && filtered.length > 0 && (
        <div className="autocomplete__panel">
          {filtered.map((item) => (
            <button
              className="autocomplete__option"
              key={item}
              onMouseDown={(event) => {
                event.preventDefault()
                onChange(item)
                setOpen(false)
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Inspector() {
  const document = useEditorStore((state) => state.document)
  const selection = useEditorStore((state) => state.selection)
  const locale = useEditorStore((state) => state.locale)
  const focusedDeviceId = useEditorStore((state) => state.focusedDeviceId)
  const focusedLabelKey = useEditorStore((state) => state.focusedLabelKey)
  const updateDocumentMeta = useEditorStore((state) => state.updateDocumentMeta)
  const updateCanvas = useEditorStore((state) => state.updateCanvas)
  const updateDevice = useEditorStore((state) => state.updateDevice)
  const updateDeviceView = useEditorStore((state) => state.updateDeviceView)
  const addNetworkLine = useEditorStore((state) => state.addNetworkLine)
  const updateNetworkLine = useEditorStore((state) => state.updateNetworkLine)
  const addTerminal = useEditorStore((state) => state.addTerminal)
  const updateTerminal = useEditorStore((state) => state.updateTerminal)
  const setSelection = useEditorStore((state) => state.setSelection)
  const deleteSelection = useEditorStore((state) => state.deleteSelection)
  const focusDevice = useEditorStore((state) => state.focusDevice)
  const focusLabel = useEditorStore((state) => state.focusLabel)
  const focusNetworkLine = useEditorStore((state) => state.focusNetworkLine)
  const clearFocus = useEditorStore((state) => state.clearFocus)

  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params)

  const insights = useMemo(() => deriveCircuitInsights(document, locale), [document, locale])
  const selectedDevice =
    selection?.entityType === 'device' && selection.id
      ? document.devices.find((device) => device.id === selection.id)
      : undefined
  const selectedTerminalLocation =
    selection?.entityType === 'terminal' && selection.id
      ? document.devices
          .map((device) => ({
            device,
            terminal: device.terminals.find((terminal) => terminal.id === selection.id),
          }))
          .find((entry) => entry.terminal)
      : undefined
  const selectedTerminal = selectedTerminalLocation?.terminal
  const selectedTerminalDevice = selectedTerminalLocation?.device
  const selectedNetworkLine =
    selection?.entityType === 'networkLine' && selection.id
      ? document.view.networkLines?.[selection.id]
        ? {
            id: selection.id,
            source: document.view.networkLines[selection.id]!,
          }
        : undefined
      : undefined
  const activeDevice = selectedTerminalDevice ?? selectedDevice
  const activeTerminal = selectedTerminal
  const title = getEntityTitle(
    document,
    selection?.entityType ?? 'document',
    selection?.id,
    locale,
  )
  const labelSuggestions = useMemo(
    () => collectTerminalLabels(document, { excludeTerminalId: activeTerminal?.id }),
    [activeTerminal?.id, document],
  )
  const connectionMatches =
    activeTerminal?.label?.trim()
      ? insights.connectionHighlightsByKey[activeTerminal.label.trim()]?.terminalIds ?? []
      : []

  return (
    <aside className="inspector-shell">
      <div className="inspector-shell__header">
        <div>
          <span className="eyebrow">{t('properties')}</span>
          <h2>{title}</h2>
        </div>
        {selection?.entityType !== 'document' && selection?.id && (
          <button className="ghost-button danger" onClick={deleteSelection}>
            {t('delete')}
          </button>
        )}
      </div>

      <div className="inspector-shell__body">
        {(!selection || selection.entityType === 'document') && (
          <section className="inspector-section">
            <span className="eyebrow">{t('documentSettings')}</span>
            <div className="form-grid">
              <Field label={t('title')}>
                <input
                  value={document.document.title}
                  onChange={(event) => updateDocumentMeta({ title: event.target.value })}
                />
              </Field>
              <Field label={t('description')}>
                <textarea
                  rows={3}
                  value={document.document.description ?? ''}
                  onChange={(event) =>
                    updateDocumentMeta({ description: event.target.value })
                  }
                />
              </Field>
              <Field label={t('gridEnabled')}>
                <select
                  value={document.view.canvas.grid?.enabled ? 'yes' : 'no'}
                  onChange={(event) =>
                    updateCanvas({
                      grid: {
                        enabled: event.target.value === 'yes',
                        size: document.view.canvas.grid?.size ?? 36,
                        majorEvery: document.view.canvas.grid?.majorEvery ?? 5,
                      },
                    })
                  }
                >
                  <option value="yes">{t('enabled')}</option>
                  <option value="no">{t('hidden')}</option>
                </select>
              </Field>
              <Field label={t('gridSize')}>
                <input
                  type="number"
                  value={document.view.canvas.grid?.size ?? 36}
                  onChange={(event) =>
                    updateCanvas({
                      grid: {
                        enabled: document.view.canvas.grid?.enabled ?? true,
                        size: parseNumber(event.target.value, 36),
                        majorEvery: document.view.canvas.grid?.majorEvery ?? 5,
                      },
                    })
                  }
                />
              </Field>
              <Field label={t('majorEvery')}>
                <input
                  type="number"
                  min={2}
                  value={document.view.canvas.grid?.majorEvery ?? 5}
                  onChange={(event) =>
                    updateCanvas({
                      grid: {
                        enabled: document.view.canvas.grid?.enabled ?? true,
                        size: document.view.canvas.grid?.size ?? 36,
                        majorEvery: Math.max(2, parseNumber(event.target.value, 5)),
                      },
                    })
                  }
                />
              </Field>
            </div>

            <section className="inspector-section">
              <div className="inspector-section__header">
                <span className="eyebrow">{t('networkLines')}</span>
                <button className="ghost-button" onClick={() => addNetworkLine()}>
                  {t('addNetworkLine')}
                </button>
              </div>
              {Object.entries(document.view.networkLines ?? {}).length > 0 ? (
                <div className="entity-list">
                  {Object.entries(document.view.networkLines ?? {}).map(([networkLineId, networkLine]) => (
                    <button
                      className={`entity-list__item${selection?.entityType === 'networkLine' && selection.id === networkLineId ? ' is-active' : ''}`}
                      key={networkLineId}
                      onClick={() => setSelection({ entityType: 'networkLine', id: networkLineId })}
                    >
                      <strong>{networkLine.label}</strong>
                      <span>{t(networkLine.orientation ?? 'horizontal')}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          </section>
        )}

        {selectedNetworkLine && !activeDevice && (
          <section className="inspector-section">
            <div className="inspector-section__header">
              <span className="eyebrow">{t('networkLines')}</span>
              <button
                className="ghost-button"
                onClick={() =>
                  focusedLabelKey === selectedNetworkLine.source.label.trim()
                    ? clearFocus()
                    : focusNetworkLine(selectedNetworkLine.id)
                }
              >
                {focusedLabelKey === selectedNetworkLine.source.label.trim() ? t('exitFocus') : t('focus')}
              </button>
            </div>
            <div className="form-grid">
              <Field label={t('label')}>
                <LabelAutocomplete
                  value={selectedNetworkLine.source.label}
                  suggestions={labelSuggestions}
                  hint={t('labelHint')}
                  onChange={(value) =>
                    updateNetworkLine(selectedNetworkLine.id, {
                      label: value,
                    })
                  }
                />
              </Field>
              <Field label={t('orientation')}>
                <select
                  value={selectedNetworkLine.source.orientation ?? 'horizontal'}
                  onChange={(event) =>
                    updateNetworkLine(selectedNetworkLine.id, {
                      orientation: event.target.value as NetworkLineOrientation,
                    })
                  }
                >
                  {(['horizontal', 'vertical'] as NetworkLineOrientation[]).map((orientation) => (
                    <option key={orientation} value={orientation}>
                      {t(orientation)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('length')}>
                <input
                  type="number"
                  min={120}
                  value={selectedNetworkLine.source.length ?? 720}
                  onChange={(event) =>
                    updateNetworkLine(selectedNetworkLine.id, {
                      length: Math.max(120, parseNumber(event.target.value, 720)),
                    })
                  }
                />
              </Field>
              <Field label={t('positionX')}>
                <input
                  type="number"
                  value={selectedNetworkLine.source.position.x}
                  onChange={(event) =>
                    updateNetworkLine(selectedNetworkLine.id, {
                      position: {
                        x: parseNumber(event.target.value, selectedNetworkLine.source.position.x),
                        y: selectedNetworkLine.source.position.y,
                      },
                    })
                  }
                />
              </Field>
              <Field label={t('positionY')}>
                <input
                  type="number"
                  value={selectedNetworkLine.source.position.y}
                  onChange={(event) =>
                    updateNetworkLine(selectedNetworkLine.id, {
                      position: {
                        x: selectedNetworkLine.source.position.x,
                        y: parseNumber(event.target.value, selectedNetworkLine.source.position.y),
                      },
                    })
                  }
                />
              </Field>
            </div>
          </section>
        )}

        {activeDevice && (
          <>
            <section className="inspector-section">
              <div className="inspector-section__header">
                <span className="eyebrow">{t('terminals')}</span>
                <button
                  className="ghost-button"
                  onClick={() => (focusedDeviceId === activeDevice.id ? clearFocus() : focusDevice(activeDevice.id))}
                >
                  {focusedDeviceId === activeDevice.id ? t('exitFocus') : t('focus')}
                </button>
              </div>

              {activeTerminal ? (
                <div className="inspector-stack">
                  <div className="form-grid">
                    <Field label={t('label')}>
                      <LabelAutocomplete
                        value={activeTerminal.label ?? ''}
                        suggestions={labelSuggestions}
                        hint={t('labelHint')}
                        onChange={(value) =>
                          updateTerminal(activeDevice.id, activeTerminal.id, {
                            label: value,
                          })
                        }
                      />
                    </Field>
                    <Field label={t('focusNetwork')}>
                      <button
                        className="ghost-button"
                        disabled={!activeTerminal.label?.trim()}
                        onClick={() => {
                          const label = activeTerminal.label?.trim()
                          if (!label) {
                            return
                          }
                          if (focusedLabelKey === label) {
                            clearFocus()
                          } else {
                            focusLabel(label)
                          }
                        }}
                      >
                        {focusedLabelKey === activeTerminal.label?.trim() ? t('exitFocus') : t('focusNetwork')}
                      </button>
                    </Field>
                    <Field label={t('direction')}>
                      <select
                        value={activeTerminal.direction}
                        onChange={(event) =>
                          updateTerminal(activeDevice.id, activeTerminal.id, {
                            direction: event.target.value as TerminalDirection,
                          })
                        }
                      >
                        {(
                          [
                            'input',
                            'output',
                            'bidirectional',
                            'passive',
                            'power-in',
                            'power-out',
                            'ground',
                            'shield',
                            'unspecified',
                          ] as TerminalDirection[]
                        ).map((direction) => (
                          <option key={direction} value={direction}>
                            {t(direction)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t('name')}>
                      <input
                        value={activeTerminal.name}
                        onChange={(event) =>
                          updateTerminal(activeDevice.id, activeTerminal.id, {
                            name: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label={t('side')}>
                      <select
                        value={activeTerminal.side ?? 'auto'}
                        onChange={(event) =>
                          updateTerminal(activeDevice.id, activeTerminal.id, {
                            side: event.target.value as TerminalSide,
                          })
                        }
                      >
                        {(['auto', 'left', 'right', 'top', 'bottom'] as TerminalSide[]).map((side) => (
                          <option key={side} value={side}>
                            {t(side)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t('order')}>
                      <input
                        type="number"
                        value={activeTerminal.order ?? 0}
                        onChange={(event) =>
                          updateTerminal(activeDevice.id, activeTerminal.id, {
                            order: parseNumber(event.target.value, 0),
                          })
                        }
                      />
                    </Field>
                    <Field label={t('required')}>
                      <select
                        value={activeTerminal.required ? 'yes' : 'no'}
                        onChange={(event) =>
                          updateTerminal(activeDevice.id, activeTerminal.id, {
                            required: event.target.value === 'yes',
                          })
                        }
                      >
                        <option value="no">{t('hidden')}</option>
                        <option value="yes">{t('enabled')}</option>
                      </select>
                    </Field>
                    <Field label={t('pinNumber')}>
                      <input
                        value={activeTerminal.pin?.number ?? ''}
                        onChange={(event) =>
                          updateTerminal(activeDevice.id, activeTerminal.id, {
                            pin: {
                              ...(activeTerminal.pin ?? {}),
                              number: event.target.value,
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label={t('pinLabel')}>
                      <input
                        value={activeTerminal.pin?.name ?? ''}
                        onChange={(event) =>
                          updateTerminal(activeDevice.id, activeTerminal.id, {
                            pin: {
                              ...(activeTerminal.pin ?? {}),
                              name: event.target.value,
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label={t('description')}>
                      <textarea
                        rows={3}
                        value={activeTerminal.description ?? ''}
                        onChange={(event) =>
                          updateTerminal(activeDevice.id, activeTerminal.id, {
                            description: event.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>

                  <div className="list">
                    <div className="list-item">
                      <strong>{t('usedLabels')}</strong>
                      <span>{labelSuggestions.length}</span>
                    </div>
                    <div className="list-item">
                      <strong>{t('labelMatches')}</strong>
                      <span>{connectionMatches.length}</span>
                    </div>
                  </div>

                  {connectionMatches.length > 0 && (
                    <div className="entity-list">
                      {connectionMatches.map((terminalId) => {
                        const terminal = insights.terminalById[terminalId]
                        const device = insights.deviceById[terminal.deviceId]
                        return (
                          <button
                            className="entity-list__item"
                            key={terminalId}
                            onClick={() => setSelection({ entityType: 'terminal', id: terminalId })}
                          >
                            <strong>{device.reference}.{terminal.displayLabel}</strong>
                            <span>{device.source.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <p className="inspector-hint">{t('selectTerminalHint')}</p>
              )}

              <TerminalButtons
                locale={locale}
                onAddTerminal={(direction) => addTerminal(activeDevice.id, direction)}
              />

              <div className="entity-list">
                {activeDevice.terminals.map((terminal) => (
                  <button
                    className={`entity-list__item${activeTerminal?.id === terminal.id ? ' is-active' : ''}`}
                    key={terminal.id}
                    onClick={() => setSelection({ entityType: 'terminal', id: terminal.id })}
                  >
                    <strong>{getTerminalDisplayLabel(terminal)}</strong>
                    <span>{t(terminal.direction)}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="inspector-section">
              <span className="eyebrow">{t('document')}</span>
              <div className="form-grid">
                <Field label={t('reference')}>
                  <input
                    value={activeDevice.reference ?? ''}
                    onChange={(event) =>
                      updateDevice(activeDevice.id, { reference: event.target.value })
                    }
                  />
                </Field>
                <Field label={t('name')}>
                  <input
                    value={activeDevice.name}
                    onChange={(event) =>
                      updateDevice(activeDevice.id, { name: event.target.value })
                    }
                  />
                </Field>
                <Field label={t('kind')}>
                  <input
                    value={activeDevice.kind}
                    onChange={(event) =>
                      updateDevice(activeDevice.id, { kind: event.target.value })
                    }
                  />
                </Field>
                <Field label={t('category')}>
                  <input
                    value={activeDevice.category ?? ''}
                    onChange={(event) =>
                      updateDevice(activeDevice.id, { category: event.target.value })
                    }
                  />
                </Field>
                <Field label={t('description')}>
                  <textarea
                    rows={3}
                    value={activeDevice.description ?? ''}
                    onChange={(event) =>
                      updateDevice(activeDevice.id, { description: event.target.value })
                    }
                  />
                </Field>
                <Field label={t('tags')}>
                  <input
                    value={(activeDevice.tags ?? []).join(', ')}
                    onChange={(event) =>
                      updateDevice(activeDevice.id, { tags: parseTags(event.target.value) })
                    }
                  />
                </Field>
              </div>
            </section>

            <section className="inspector-section">
              <span className="eyebrow">{t('canvasTitle')}</span>
              <div className="form-grid">
                <Field label={t('shape')}>
                  <select
                    value={document.view.devices?.[activeDevice.id]?.shape ?? 'rectangle'}
                    onChange={(event) =>
                      updateDeviceView(activeDevice.id, {
                        shape: event.target.value as 'rectangle' | 'circle' | 'triangle',
                      })
                    }
                  >
                    <option value="rectangle">{t('rectangle')}</option>
                    <option value="circle">{t('circle')}</option>
                    <option value="triangle">{t('triangle')}</option>
                  </select>
                </Field>
                <Field label={t('rotation')}>
                  <input
                    type="number"
                    value={document.view.devices?.[activeDevice.id]?.rotationDeg ?? 0}
                    onChange={(event) =>
                      updateDeviceView(activeDevice.id, {
                        rotationDeg: parseNumber(event.target.value, 0),
                      })
                    }
                  />
                </Field>
                <Field label={t('positionX')}>
                  <input
                    type="number"
                    value={document.view.devices?.[activeDevice.id]?.position?.x ?? 180}
                    onChange={(event) =>
                      updateDeviceView(activeDevice.id, {
                        position: {
                          x: parseNumber(event.target.value, 180),
                          y: document.view.devices?.[activeDevice.id]?.position?.y ?? 180,
                        },
                      })
                    }
                  />
                </Field>
                <Field label={t('positionY')}>
                  <input
                    type="number"
                    value={document.view.devices?.[activeDevice.id]?.position?.y ?? 180}
                    onChange={(event) =>
                      updateDeviceView(activeDevice.id, {
                        position: {
                          x: document.view.devices?.[activeDevice.id]?.position?.x ?? 180,
                          y: parseNumber(event.target.value, 180),
                        },
                      })
                    }
                  />
                </Field>
                <Field label={t('width')}>
                  <input
                    type="number"
                    value={document.view.devices?.[activeDevice.id]?.size?.width ?? 220}
                    onChange={(event) =>
                      updateDeviceView(activeDevice.id, {
                        size: {
                          width: parseNumber(event.target.value, 220),
                          height: document.view.devices?.[activeDevice.id]?.size?.height ?? 136,
                        },
                      })
                    }
                  />
                </Field>
                <Field label={t('height')}>
                  <input
                    type="number"
                    value={document.view.devices?.[activeDevice.id]?.size?.height ?? 136}
                    onChange={(event) =>
                      updateDeviceView(activeDevice.id, {
                        size: {
                          width: document.view.devices?.[activeDevice.id]?.size?.width ?? 220,
                          height: parseNumber(event.target.value, 136),
                        },
                      })
                    }
                  />
                </Field>
              </div>
              <p className="inspector-hint">{t('rotationHint')}</p>
            </section>
          </>
        )}
      </div>
    </aside>
  )
}
