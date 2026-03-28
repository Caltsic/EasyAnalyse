import type { ReactNode } from 'react'
import { getComponentRotation, getEntityTitle } from '../lib/document'
import { getComponentBounds } from '../lib/geometry'
import { translate } from '../lib/i18n'
import { useEditorStore } from '../store/editorStore'
import type {
  AnnotationEntity,
  ComponentEntity,
  PortEntity,
  Route,
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

function parsePointsInput(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [x, y] = line.split(',').map((part) => Number(part.trim()))
      return { x, y }
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
}

export function Inspector() {
  const document = useEditorStore((state) => state.document)
  const selection = useEditorStore((state) => state.selection)
  const locale = useEditorStore((state) => state.locale)
  const updateDocumentMeta = useEditorStore((state) => state.updateDocumentMeta)
  const updateCanvas = useEditorStore((state) => state.updateCanvas)
  const updateComponent = useEditorStore((state) => state.updateComponent)
  const updateComponentGeometry = useEditorStore(
    (state) => state.updateComponentGeometry,
  )
  const updateComponentRotation = useEditorStore(
    (state) => state.updateComponentRotation,
  )
  const addPort = useEditorStore((state) => state.addPort)
  const updatePort = useEditorStore((state) => state.updatePort)
  const updateNode = useEditorStore((state) => state.updateNode)
  const updateWire = useEditorStore((state) => state.updateWire)
  const addWireBendPoint = useEditorStore((state) => state.addWireBendPoint)
  const addAnnotation = useEditorStore((state) => state.addAnnotation)
  const updateAnnotation = useEditorStore((state) => state.updateAnnotation)
  const deleteSelection = useEditorStore((state) => state.deleteSelection)

  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params)

  const selectedComponent =
    selection?.entityType === 'component' && selection.id
      ? document.components.find((item) => item.id === selection.id)
      : undefined
  const selectedPort =
    selection?.entityType === 'port' && selection.id
      ? document.ports.find((item) => item.id === selection.id)
      : undefined
  const selectedNode =
    selection?.entityType === 'node' && selection.id
      ? document.nodes.find((item) => item.id === selection.id)
      : undefined
  const selectedWire =
    selection?.entityType === 'wire' && selection.id
      ? document.wires.find((item) => item.id === selection.id)
      : undefined
  const selectedAnnotation =
    selection?.entityType === 'annotation' && selection.id
      ? document.annotations.find((item) => item.id === selection.id)
      : undefined

  const componentPorts = selectedComponent
    ? document.ports.filter((port) => port.componentId === selectedComponent.id)
    : []

  const updateGeometryBounds = (
    component: ComponentEntity,
    patch: Partial<{
      x: number
      y: number
      width: number
      height: number
      radius: number
    }>,
  ) => {
    if (component.geometry.type === 'rectangle') {
      updateComponentGeometry(component.id, {
        ...component.geometry,
        x: patch.x ?? component.geometry.x,
        y: patch.y ?? component.geometry.y,
        width: patch.width ?? component.geometry.width,
        height: patch.height ?? component.geometry.height,
      })
      return
    }

    if (component.geometry.type === 'circle') {
      const radius = patch.radius ?? component.geometry.radius
      const x = patch.x ?? component.geometry.cx - component.geometry.radius
      const y = patch.y ?? component.geometry.cy - component.geometry.radius

      updateComponentGeometry(component.id, {
        ...component.geometry,
        cx: x + radius,
        cy: y + radius,
        radius,
      })
      return
    }

    const bounds = getComponentBounds(component.geometry)
    const next = {
      x: patch.x ?? bounds.x,
      y: patch.y ?? bounds.y,
      width: patch.width ?? bounds.width,
      height: patch.height ?? bounds.height,
    }

    updateComponentGeometry(component.id, {
      type: 'triangle',
      vertices: [
        { x: next.x + next.width / 2, y: next.y },
        { x: next.x + next.width, y: next.y + next.height },
        { x: next.x, y: next.y + next.height },
      ],
    })
  }

  const title =
    selection?.entityType === 'document'
      ? document.document.title
      : getEntityTitle(selection?.entityType ?? 'document', selection?.id, document)

  return (
    <aside className="panel inspector">
      <div className="panel__header">
        <div className="panel__heading">
          <span className="eyebrow">{t('inspector')}</span>
          <h2>{title || t('noSelection')}</h2>
          {selection?.id && selection.entityType !== 'document' && (
            <small className="inspector__meta">{selection.id}</small>
          )}
        </div>
        {selection?.entityType !== 'document' && selection?.id && (
          <button className="ghost-button danger" onClick={deleteSelection}>
            {t('delete')}
          </button>
        )}
      </div>

      {(!selection || selection.entityType === 'document') && (
        <div className="panel__body">
          <div className="form-grid">
            <Field label={t('title')}>
              <input
                value={document.document.title}
                onChange={(event) =>
                  updateDocumentMeta({ title: event.target.value })
                }
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
            <Field label={t('canvasWidth')}>
              <input
                type="number"
                value={document.canvas.width}
                onChange={(event) =>
                  updateCanvas({ width: parseNumber(event.target.value, 2400) })
                }
              />
            </Field>
            <Field label={t('canvasHeight')}>
              <input
                type="number"
                value={document.canvas.height}
                onChange={(event) =>
                  updateCanvas({ height: parseNumber(event.target.value, 1600) })
                }
              />
            </Field>
            <Field label={t('gridEnabled')}>
              <select
                value={document.canvas.grid?.enabled ? 'yes' : 'no'}
                onChange={(event) =>
                  updateCanvas({
                    grid: {
                      enabled: event.target.value === 'yes',
                      size: document.canvas.grid?.size ?? 40,
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
                value={document.canvas.grid?.size ?? 40}
                onChange={(event) =>
                  updateCanvas({
                    grid: {
                      enabled: document.canvas.grid?.enabled ?? true,
                      size: parseNumber(event.target.value, 40),
                    },
                  })
                }
              />
            </Field>
          </div>

          <div className="inspector-card">
            <span className="eyebrow">{t('aiWorkflow')}</span>
            <p>{t('aiWorkflowHint')}</p>
          </div>
        </div>
      )}

      {selectedComponent && (
        <ComponentInspector
          component={selectedComponent}
          ports={componentPorts}
          locale={locale}
          onComponentChange={updateComponent}
          onBoundsChange={updateGeometryBounds}
          onRotationChange={updateComponentRotation}
          onAddPort={addPort}
          onAnnotation={() =>
            addAnnotation('note', {
              entityType: 'component',
              refId: selectedComponent.id,
            })
          }
        />
      )}

      {selectedPort && (
        <PortInspector
          port={selectedPort}
          locale={locale}
          onPortChange={updatePort}
          onAnnotation={() =>
            addAnnotation('signal', { entityType: 'port', refId: selectedPort.id })
          }
        />
      )}

      {selectedNode && (
        <div className="panel__body">
          <div className="form-grid">
            <Field label={t('nodeId')}>
              <input disabled value={selectedNode.id} />
            </Field>
            <Field label={t('role')}>
              <select
                value={selectedNode.role ?? 'generic'}
                onChange={(event) =>
                  updateNode(selectedNode.id, {
                    role: event.target.value as NonNullable<typeof selectedNode.role>,
                  })
                }
              >
                <option value="generic">{t('generic')}</option>
                <option value="junction">{t('junction')}</option>
                <option value="branch">{t('branch')}</option>
              </select>
            </Field>
            <Field label={t('x')}>
              <input
                type="number"
                value={selectedNode.position.x}
                onChange={(event) =>
                  updateNode(selectedNode.id, {
                    position: {
                      ...selectedNode.position,
                      x: parseNumber(event.target.value),
                    },
                  })
                }
              />
            </Field>
            <Field label={t('y')}>
              <input
                type="number"
                value={selectedNode.position.y}
                onChange={(event) =>
                  updateNode(selectedNode.id, {
                    position: {
                      ...selectedNode.position,
                      y: parseNumber(event.target.value),
                    },
                  })
                }
              />
            </Field>
            <Field label={t('description')}>
              <textarea
                rows={4}
                value={selectedNode.description ?? ''}
                onChange={(event) =>
                  updateNode(selectedNode.id, { description: event.target.value })
                }
              />
            </Field>
          </div>
          <div className="inspector-card">
            <button
              className="ghost-button"
              onClick={() =>
                addAnnotation('label', { entityType: 'node', refId: selectedNode.id })
              }
            >
              {t('addNodeLabel')}
            </button>
          </div>
        </div>
      )}

      {selectedWire && (
        <div className="panel__body">
          <div className="form-grid">
            <Field label={t('wireId')}>
              <input disabled value={selectedWire.id} />
            </Field>
            <Field label={t('serialNumber')}>
              <input
                value={selectedWire.serialNumber}
                onChange={(event) =>
                  updateWire(selectedWire.id, { serialNumber: event.target.value })
                }
              />
            </Field>
            <Field label={t('route')}>
              <select
                value={selectedWire.route.kind}
                onChange={(event) => {
                  const kind = event.target.value as Route['kind']
                  const route: Route =
                    kind === 'straight'
                      ? { kind }
                      : {
                          kind,
                          bendPoints:
                            selectedWire.route.kind === 'polyline'
                              ? selectedWire.route.bendPoints
                              : [{ x: 0, y: 0 }],
                        }

                  updateWire(selectedWire.id, { route })
                }}
              >
                <option value="straight">{t('straight')}</option>
                <option value="polyline">{t('polyline')}</option>
              </select>
            </Field>
            <Field label={t('description')}>
              <textarea
                rows={4}
                value={selectedWire.description ?? ''}
                onChange={(event) =>
                  updateWire(selectedWire.id, { description: event.target.value })
                }
              />
            </Field>
            {selectedWire.route.kind === 'polyline' && (
              <Field label={t('bendPoints')}>
                <textarea
                  rows={5}
                  value={selectedWire.route.bendPoints
                    .map((point) => `${point.x}, ${point.y}`)
                    .join('\n')}
                  onChange={(event) =>
                    updateWire(selectedWire.id, {
                      route: {
                        kind: 'polyline',
                        bendPoints: parsePointsInput(event.target.value),
                      },
                    })
                  }
                />
              </Field>
            )}
          </div>

          <div className="inspector-card">
            <div className="card-actions">
              {selectedWire.route.kind === 'polyline' && (
                <button
                  className="ghost-button"
                  onClick={() => addWireBendPoint(selectedWire.id)}
                >
                  {t('addBendPoint')}
                </button>
              )}
              <button
                className="ghost-button"
                onClick={() =>
                  addAnnotation('label', { entityType: 'wire', refId: selectedWire.id })
                }
              >
                {t('addWireLabel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedAnnotation && (
        <div className="panel__body">
          <div className="form-grid">
            <Field label={t('annotationId')}>
              <input disabled value={selectedAnnotation.id} />
            </Field>
            <Field label={t('kind')}>
              <select
                value={selectedAnnotation.kind}
                onChange={(event) =>
                  updateAnnotation(selectedAnnotation.id, {
                    kind: event.target.value as AnnotationEntity['kind'],
                  })
                }
              >
                <option value="signal">{t('signal')}</option>
                <option value="note">{t('note')}</option>
                <option value="label">{t('label')}</option>
              </select>
            </Field>
            <Field label={t('text')}>
              <textarea
                rows={4}
                value={selectedAnnotation.text}
                onChange={(event) =>
                  updateAnnotation(selectedAnnotation.id, {
                    text: event.target.value,
                  })
                }
              />
            </Field>
            <Field label={t('target')}>
              <input
                disabled
                value={`${selectedAnnotation.target.entityType}:${selectedAnnotation.target.refId}`}
              />
            </Field>
          </div>
        </div>
      )}
    </aside>
  )
}

function ComponentInspector({
  component,
  ports,
  locale,
  onComponentChange,
  onBoundsChange,
  onRotationChange,
  onAddPort,
  onAnnotation,
}: {
  component: ComponentEntity
  ports: PortEntity[]
  locale: 'zh-CN' | 'en-US'
  onComponentChange: (id: string, patch: Partial<ComponentEntity>) => void
  onBoundsChange: (
    component: ComponentEntity,
    patch: Partial<{
      x: number
      y: number
      width: number
      height: number
      radius: number
    }>,
  ) => void
  onRotationChange: (id: string, rotationDeg: number) => void
  onAddPort: (direction: PortEntity['direction'], componentId?: string) => void
  onAnnotation: () => void
}) {
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params)
  const bounds = getComponentBounds(component.geometry)
  const circleRadius = component.geometry.type === 'circle' ? component.geometry.radius : 0
  const rotation = getComponentRotation(component)

  return (
    <div className="panel__body">
      <div className="form-grid">
        <Field label={t('name')}>
          <input
            value={component.name}
            onChange={(event) =>
              onComponentChange(component.id, { name: event.target.value })
            }
          />
        </Field>
        <Field label={t('description')}>
          <textarea
            rows={3}
            value={component.description ?? ''}
            onChange={(event) =>
              onComponentChange(component.id, { description: event.target.value })
            }
          />
        </Field>
        <Field label={t('tags')}>
          <input
            value={(component.tags ?? []).join(', ')}
            onChange={(event) =>
              onComponentChange(component.id, { tags: parseTags(event.target.value) })
            }
          />
        </Field>
        <Field label={t('shape')}>
          <input disabled value={component.geometry.type} />
        </Field>
        <Field label={t('x')}>
          <input
            type="number"
            value={bounds.x}
            onChange={(event) =>
              onBoundsChange(component, { x: parseNumber(event.target.value) })
            }
          />
        </Field>
        <Field label={t('y')}>
          <input
            type="number"
            value={bounds.y}
            onChange={(event) =>
              onBoundsChange(component, { y: parseNumber(event.target.value) })
            }
          />
        </Field>
        {component.geometry.type === 'circle' ? (
          <Field label={t('radius')}>
            <input
              type="number"
              value={circleRadius}
              onChange={(event) =>
                onBoundsChange(component, {
                  radius: parseNumber(event.target.value, circleRadius),
                })
              }
            />
          </Field>
        ) : (
          <>
            <Field label={t('width')}>
              <input
                type="number"
                value={bounds.width}
                onChange={(event) =>
                  onBoundsChange(component, {
                    width: parseNumber(event.target.value, bounds.width),
                  })
                }
              />
            </Field>
            <Field label={t('height')}>
              <input
                type="number"
                value={bounds.height}
                onChange={(event) =>
                  onBoundsChange(component, {
                    height: parseNumber(event.target.value, bounds.height),
                  })
                }
              />
            </Field>
          </>
        )}
        <Field label={t('rotation')}>
          <input
            type="number"
            value={rotation}
            onChange={(event) =>
              onRotationChange(component.id, parseNumber(event.target.value, rotation))
            }
          />
        </Field>
      </div>

      <div className="inspector-card">
        <div className="card-actions">
          <button className="ghost-button" onClick={() => onRotationChange(component.id, rotation - 90)}>
            -90°
          </button>
          <button className="ghost-button" onClick={() => onRotationChange(component.id, rotation + 90)}>
            +90°
          </button>
          <button className="ghost-button" onClick={() => onAddPort('input', component.id)}>
            {t('addInputPort')}
          </button>
          <button className="ghost-button" onClick={() => onAddPort('output', component.id)}>
            {t('addOutputPort')}
          </button>
          <button className="ghost-button" onClick={onAnnotation}>
            {t('addNote')}
          </button>
        </div>
        <div className="list">
          {ports.map((port) => (
            <div className="list-item" key={port.id}>
              <strong>{port.name}</strong>
              <span>{port.direction === 'input' ? t('input') : t('output')}</span>
            </div>
          ))}
          {!ports.length && <p className="muted-copy">{t('noPortsYet')}</p>}
        </div>
      </div>
    </div>
  )
}

function PortInspector({
  port,
  locale,
  onPortChange,
  onAnnotation,
}: {
  port: PortEntity
  locale: 'zh-CN' | 'en-US'
  onPortChange: (id: string, patch: Partial<PortEntity>) => void
  onAnnotation: () => void
}) {
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params)
  const rectangleAnchor =
    port.anchor.kind === 'rectangle-side' ? port.anchor : null
  const circleAnchor = port.anchor.kind === 'circle-angle' ? port.anchor : null
  const triangleAnchor =
    port.anchor.kind === 'triangle-edge' ? port.anchor : null

  return (
    <div className="panel__body">
      <div className="form-grid">
        <Field label={t('name')}>
          <input
            value={port.name}
            onChange={(event) => onPortChange(port.id, { name: event.target.value })}
          />
        </Field>
        <Field label={t('portDirection')}>
          <select
            value={port.direction}
            onChange={(event) =>
              onPortChange(port.id, {
                direction: event.target.value as PortEntity['direction'],
              })
            }
          >
            <option value="input">{t('input')}</option>
            <option value="output">{t('output')}</option>
          </select>
        </Field>
        <Field label={t('pinNumber')}>
          <input
            value={port.pinInfo?.number ?? ''}
            onChange={(event) =>
              onPortChange(port.id, {
                pinInfo: {
                  ...port.pinInfo,
                  number: event.target.value,
                },
              })
            }
          />
        </Field>
        <Field label={t('pinLabel')}>
          <input
            value={port.pinInfo?.label ?? ''}
            onChange={(event) =>
              onPortChange(port.id, {
                pinInfo: {
                  ...port.pinInfo,
                  label: event.target.value,
                },
              })
            }
          />
        </Field>
        <Field label={t('description')}>
          <textarea
            rows={3}
            value={port.description ?? ''}
            onChange={(event) =>
              onPortChange(port.id, { description: event.target.value })
            }
          />
        </Field>

        {rectangleAnchor && (
          <>
            <Field label={t('side')}>
              <select
                value={rectangleAnchor.side}
                onChange={(event) =>
                  onPortChange(port.id, {
                    anchor: {
                      kind: 'rectangle-side',
                      side: event.target.value as typeof rectangleAnchor.side,
                      offset: rectangleAnchor.offset,
                    },
                  })
                }
              >
                <option value="top">{t('top')}</option>
                <option value="right">{t('right')}</option>
                <option value="bottom">{t('bottom')}</option>
                <option value="left">{t('left')}</option>
              </select>
            </Field>
            <Field label={t('offset')}>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={rectangleAnchor.offset}
                onChange={(event) =>
                  onPortChange(port.id, {
                    anchor: {
                      kind: 'rectangle-side',
                      side: rectangleAnchor.side,
                      offset: parseNumber(event.target.value, rectangleAnchor.offset),
                    },
                  })
                }
              />
            </Field>
          </>
        )}

        {circleAnchor && (
          <Field label={t('angle')}>
            <input
              type="number"
              value={circleAnchor.angleDeg}
              onChange={(event) =>
                onPortChange(port.id, {
                  anchor: {
                    kind: 'circle-angle',
                    angleDeg: parseNumber(event.target.value, circleAnchor.angleDeg),
                  },
                })
              }
            />
          </Field>
        )}

        {triangleAnchor && (
          <>
            <Field label={t('edge')}>
              <select
                value={String(triangleAnchor.edgeIndex)}
                onChange={(event) =>
                  onPortChange(port.id, {
                    anchor: {
                      kind: 'triangle-edge',
                      edgeIndex: Number(event.target.value) as 0 | 1 | 2,
                      offset: triangleAnchor.offset,
                    },
                  })
                }
              >
                <option value="0">0</option>
                <option value="1">1</option>
                <option value="2">2</option>
              </select>
            </Field>
            <Field label={t('offset')}>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={triangleAnchor.offset}
                onChange={(event) =>
                  onPortChange(port.id, {
                    anchor: {
                      kind: 'triangle-edge',
                      edgeIndex: triangleAnchor.edgeIndex,
                      offset: parseNumber(event.target.value, triangleAnchor.offset),
                    },
                  })
                }
              />
            </Field>
          </>
        )}
      </div>

      <div className="inspector-card">
        <button className="ghost-button" onClick={onAnnotation}>
          {t('addSignalAnnotation')}
        </button>
      </div>
    </div>
  )
}
