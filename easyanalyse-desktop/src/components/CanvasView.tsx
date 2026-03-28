import { useEffect, useMemo, useRef, useState } from 'react'
import { Arrow, Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { getComponentRotation } from '../lib/document'
import {
  clamp,
  getComponentBounds,
  getEndpointPosition,
  getGeometryCenter,
  getPortPosition,
  getTargetPosition,
  getWirePoints,
  rotatePoint,
} from '../lib/geometry'
import { getShapeLabel, translate } from '../lib/i18n'
import { useEditorStore } from '../store/editorStore'
import type {
  AnnotationEntity,
  ComponentEntity,
  DocumentFile,
  EditorSelection,
  EndpointRef,
  Point,
  WireEntity,
} from '../types/document'

const INITIAL_OFFSET = 80
const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.4
const SELECTION_DRAG_THRESHOLD = 6

interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface DragRect {
  start: Point
  current: Point
}

function renderTrianglePoints(component: ComponentEntity, center: Point) {
  if (component.geometry.type !== 'triangle') {
    return []
  }

  return component.geometry.vertices.flatMap((vertex) => [
    vertex.x - center.x,
    vertex.y - center.y,
  ])
}

function normalizeBox(from: Point, to: Point): Box {
  const x = Math.min(from.x, to.x)
  const y = Math.min(from.y, to.y)
  const width = Math.abs(to.x - from.x)
  const height = Math.abs(to.y - from.y)

  return { x, y, width, height }
}

function pointInBox(point: Point, box: Box) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  )
}

function boxesIntersect(left: Box, right: Box) {
  return !(
    left.x + left.width < right.x ||
    right.x + right.width < left.x ||
    left.y + left.height < right.y ||
    right.y + right.height < left.y
  )
}

function componentSelectionBox(component: ComponentEntity): Box {
  const rotation = getComponentRotation(component)
  if (!rotation && component.geometry.type !== 'triangle') {
    return getComponentBounds(component.geometry)
  }

  const center = getGeometryCenter(component.geometry)
  const points =
    component.geometry.type === 'rectangle'
      ? [
          { x: component.geometry.x, y: component.geometry.y },
          {
            x: component.geometry.x + component.geometry.width,
            y: component.geometry.y,
          },
          {
            x: component.geometry.x + component.geometry.width,
            y: component.geometry.y + component.geometry.height,
          },
          {
            x: component.geometry.x,
            y: component.geometry.y + component.geometry.height,
          },
        ]
      : component.geometry.type === 'circle'
        ? [
            {
              x: component.geometry.cx - component.geometry.radius,
              y: component.geometry.cy - component.geometry.radius,
            },
            {
              x: component.geometry.cx + component.geometry.radius,
              y: component.geometry.cy + component.geometry.radius,
            },
          ]
        : component.geometry.vertices

  const transformed = points.map((point) =>
    component.geometry.type === 'circle' ? point : rotatePoint(point, center, rotation),
  )
  const xs = transformed.map((point) => point.x)
  const ys = transformed.map((point) => point.y)

  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

function annotationSelectionBox(annotation: AnnotationEntity, documentTitlePoint: Point): Box {
  return {
    x: documentTitlePoint.x,
    y: documentTitlePoint.y,
    width: Math.max(annotation.text.length * 7.8, 86),
    height: 30,
  }
}

function wireSelectionBox(document: DocumentFile, wire: WireEntity) {
  const points = getWirePoints(document, wire)
  if (!points || points.length < 4) {
    return null
  }

  const xs: number[] = []
  const ys: number[] = []

  for (let index = 0; index < points.length; index += 2) {
    xs.push(points[index]!)
    ys.push(points[index + 1]!)
  }

  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

export function CanvasView() {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const panStartRef = useRef<{ pointer: Point; pan: Point } | null>(null)
  const [viewport, setViewport] = useState({ width: 1200, height: 720 })
  const [zoom, setZoom] = useState(0.8)
  const [pan, setPan] = useState({ x: INITIAL_OFFSET, y: INITIAL_OFFSET })
  const [pointerCanvasPoint, setPointerCanvasPoint] = useState<Point | null>(null)
  const [selectionRect, setSelectionRect] = useState<DragRect | null>(null)
  const [isPanning, setIsPanning] = useState(false)

  const document = useEditorStore((state) => state.document)
  const selectedEntities = useEditorStore((state) => state.selectedEntities)
  const connectMode = useEditorStore((state) => state.connectMode)
  const connectionSource = useEditorStore((state) => state.connectionSource)
  const connectionDraftPoints = useEditorStore((state) => state.connectionDraftPoints)
  const draftRouteKind = useEditorStore((state) => state.draftRouteKind)
  const placementMode = useEditorStore((state) => state.placementMode)
  const locale = useEditorStore((state) => state.locale)
  const moveComponentCenter = useEditorStore((state) => state.moveComponentCenter)
  const moveNode = useEditorStore((state) => state.moveNode)
  const movePort = useEditorStore((state) => state.movePort)
  const moveWireBendPoint = useEditorStore((state) => state.moveWireBendPoint)
  const addConnectionBendPoint = useEditorStore((state) => state.addConnectionBendPoint)
  const placePendingAt = useEditorStore((state) => state.placePendingAt)
  const setSelection = useEditorStore((state) => state.setSelection)
  const setSelectedEntities = useEditorStore((state) => state.setSelectedEntities)
  const applyConnectionEndpoint = useEditorStore((state) => state.useConnectionEndpoint)

  useEffect(() => {
    const element = wrapperRef.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const t = useMemo(
    () => (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  )

  const selectedKeys = useMemo(
    () =>
      new Set(selectedEntities.map((item) => `${item.entityType}:${item.id ?? 'document'}`)),
    [selectedEntities],
  )

  const isSelected = (entityType: EditorSelection['entityType'], id: string) =>
    selectedKeys.has(`${entityType}:${id}`)

  const gridLines = useMemo(() => {
    const size = document.canvas.grid?.size ?? 40
    const lines: number[][] = []

    if (!document.canvas.grid?.enabled || size < 8) {
      return lines
    }

    for (let x = 0; x <= document.canvas.width; x += size) {
      lines.push([x, 0, x, document.canvas.height])
    }

    for (let y = 0; y <= document.canvas.height; y += size) {
      lines.push([0, y, document.canvas.width, y])
    }

    return lines
  }, [
    document.canvas.grid?.enabled,
    document.canvas.grid?.size,
    document.canvas.height,
    document.canvas.width,
  ])

  const sourcePoint = connectionSource
    ? getEndpointPosition(document, connectionSource)
    : null

  const draftWirePoints = useMemo(() => {
    if (!sourcePoint || !pointerCanvasPoint) {
      return null
    }

    const points = [sourcePoint, ...connectionDraftPoints, pointerCanvasPoint]
    return points.flatMap((point) => [point.x, point.y])
  }, [connectionDraftPoints, pointerCanvasPoint, sourcePoint])

  const footerMessage = placementMode
    ? placementMode.kind === 'component'
      ? t('clickToPlaceComponent', {
          shape: getShapeLabel(locale, placementMode.shape),
        })
      : t('clickToPlaceNode')
    : connectMode
      ? connectionSource
        ? draftRouteKind === 'polyline'
          ? t('clickCanvasForBend')
          : t('linkingFrom', { id: connectionSource.refId })
        : t('connectModeActive')
      : t('selectModeActive')

  const previewGeometry =
    placementMode?.kind === 'component' && pointerCanvasPoint
      ? (() => {
          switch (placementMode.shape) {
            case 'rectangle':
              return {
                type: 'rectangle' as const,
                x: pointerCanvasPoint.x - 110,
                y: pointerCanvasPoint.y - 68,
                width: 220,
                height: 136,
              }
            case 'circle':
              return {
                type: 'circle' as const,
                cx: pointerCanvasPoint.x,
                cy: pointerCanvasPoint.y,
                radius: 72,
              }
            case 'triangle':
              return {
                type: 'triangle' as const,
                vertices: [
                  { x: pointerCanvasPoint.x, y: pointerCanvasPoint.y - 88 },
                  { x: pointerCanvasPoint.x + 96, y: pointerCanvasPoint.y + 72 },
                  { x: pointerCanvasPoint.x - 96, y: pointerCanvasPoint.y + 72 },
                ] as [Point, Point, Point],
              }
          }
        })()
      : null

  const selectionOverlay = selectionRect
    ? normalizeBox(selectionRect.start, selectionRect.current)
    : null

  const screenToCanvas = (point: Point): Point => ({
    x: (point.x - pan.x) / zoom,
    y: (point.y - pan.y) / zoom,
  })

  const updatePointer = (
    stage: {
      getPointerPosition: () => { x: number; y: number } | null
    } | null,
  ) => {
    const pointer = stage?.getPointerPosition()
    if (!pointer) {
      setPointerCanvasPoint(null)
      return null
    }

    const screenPoint = { x: pointer.x, y: pointer.y }
    const canvasPoint = screenToCanvas(screenPoint)
    const insideCanvas =
      canvasPoint.x >= 0 &&
      canvasPoint.y >= 0 &&
      canvasPoint.x <= document.canvas.width &&
      canvasPoint.y <= document.canvas.height

    setPointerCanvasPoint(insideCanvas ? canvasPoint : null)

    return {
      screenPoint,
      canvasPoint,
      insideCanvas,
    }
  }

  const collectSelections = (box: Box) => {
    const next: EditorSelection[] = []

    for (const component of document.components) {
      if (boxesIntersect(componentSelectionBox(component), box)) {
        next.push({ entityType: 'component', id: component.id })
      }
    }

    for (const port of document.ports) {
      const component = document.components.find((item) => item.id === port.componentId)
      if (!component) {
        continue
      }

      if (pointInBox(getPortPosition(component, port.anchor), box)) {
        next.push({ entityType: 'port', id: port.id })
      }
    }

    for (const node of document.nodes) {
      if (pointInBox(node.position, box)) {
        next.push({ entityType: 'node', id: node.id })
      }
    }

    for (const wire of document.wires) {
      const wireBox = wireSelectionBox(document, wire)
      if (wireBox && boxesIntersect(wireBox, box)) {
        next.push({ entityType: 'wire', id: wire.id })
      }
    }

    for (const annotation of document.annotations) {
      const base = getTargetPosition(document, annotation.target)
      const point = annotation.position ?? {
        x: base.x + 24,
        y: base.y - 26,
      }

      if (boxesIntersect(annotationSelectionBox(annotation, point), box)) {
        next.push({ entityType: 'annotation', id: annotation.id })
      }
    }

    return next
  }

  const finishSelectionRect = () => {
    if (!selectionRect) {
      return
    }

    const screenBox = normalizeBox(selectionRect.start, selectionRect.current)
    setSelectionRect(null)

    if (
      screenBox.width < SELECTION_DRAG_THRESHOLD &&
      screenBox.height < SELECTION_DRAG_THRESHOLD
    ) {
      setSelection({ entityType: 'document' })
      return
    }

    const canvasBox = normalizeBox(
      screenToCanvas(selectionRect.start),
      screenToCanvas(selectionRect.current),
    )
    const nextSelection = collectSelections(canvasBox)

    if (nextSelection.length) {
      setSelectedEntities(nextSelection)
    } else {
      setSelection({ entityType: 'document' })
    }
  }

  const handleStageMouseDown = (event: {
    target: {
      getAttr: (name: string) => unknown
      getStage: () => {
        getPointerPosition: () => { x: number; y: number } | null
      } | null
    }
    cancelBubble?: boolean
    evt: MouseEvent
  }) => {
    const pointer = updatePointer(event.target.getStage())
    if (!pointer) {
      return
    }

    if (event.evt.button === 1) {
      event.evt.preventDefault()
      panStartRef.current = {
        pointer: pointer.screenPoint,
        pan,
      }
      setIsPanning(true)
      setSelectionRect(null)
      return
    }

    if (event.evt.button !== 0) {
      return
    }

    if (placementMode && pointer.insideCanvas) {
      event.cancelBubble = true
      event.evt.preventDefault()
      placePendingAt(pointer.canvasPoint)
      return
    }

    const isEndpoint = Boolean(event.target.getAttr('data-endpoint'))
    if (
      connectMode &&
      connectionSource &&
      draftRouteKind === 'polyline' &&
      !isEndpoint &&
      pointer.insideCanvas
    ) {
      event.cancelBubble = true
      event.evt.preventDefault()
      addConnectionBendPoint(pointer.canvasPoint)
      return
    }

    const isCanvasSurface = Boolean(event.target.getAttr('data-canvas-surface'))
    if (isCanvasSurface) {
      setSelectionRect({
        start: pointer.screenPoint,
        current: pointer.screenPoint,
      })
    }
  }

  const handleStageMouseMove = (event: {
    target: {
      getStage: () => {
        getPointerPosition: () => { x: number; y: number } | null
      } | null
    }
  }) => {
    const pointer = updatePointer(event.target.getStage())
    if (!pointer) {
      return
    }

    if (isPanning && panStartRef.current) {
      setPan({
        x: panStartRef.current.pan.x + (pointer.screenPoint.x - panStartRef.current.pointer.x),
        y: panStartRef.current.pan.y + (pointer.screenPoint.y - panStartRef.current.pointer.y),
      })
      return
    }

    if (selectionRect) {
      setSelectionRect((current) =>
        current
          ? {
              ...current,
              current: pointer.screenPoint,
            }
          : current,
      )
    }
  }

  const handleStageMouseUp = () => {
    if (isPanning) {
      panStartRef.current = null
      setIsPanning(false)
    }

    if (selectionRect) {
      finishSelectionRect()
    }
  }

  const handleWheel = (event: {
    evt: WheelEvent
    target: {
      getStage: () => {
        getPointerPosition: () => { x: number; y: number } | null
      } | null
    }
  }) => {
    if (!(event.evt.ctrlKey || event.evt.metaKey)) {
      return
    }

    const pointer = event.target.getStage()?.getPointerPosition()
    if (!pointer) {
      return
    }

    event.evt.preventDefault()

    const direction = event.evt.deltaY < 0 ? 1 : -1
    const nextZoom = clamp(zoom * (direction > 0 ? 1.1 : 0.9), MIN_ZOOM, MAX_ZOOM)
    const focusPoint = screenToCanvas(pointer)

    setZoom(nextZoom)
    setPan({
      x: pointer.x - focusPoint.x * nextZoom,
      y: pointer.y - focusPoint.y * nextZoom,
    })
  }

  const selectEndpoint = (endpoint: EndpointRef) => {
    applyConnectionEndpoint(endpoint)
  }

  return (
    <div className="canvas-shell">
      <div className="canvas-toolbar">
        <div className="canvas-toolbar__meta">
          <span className="eyebrow">{t('canvas')}</span>
          <strong>
            {document.canvas.width} x {document.canvas.height} px
          </strong>
        </div>
        <label className="zoom-control">
          <span>{t('zoom')}</span>
          <input
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            type="range"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <strong>{Math.round(zoom * 100)}%</strong>
        </label>
      </div>

      <div
        className={`canvas-stage${isPanning ? ' is-panning' : ''}`}
        ref={wrapperRef}
      >
        <Stage
          width={viewport.width}
          height={viewport.height}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onMouseLeave={() => {
            setPointerCanvasPoint(null)
            handleStageMouseUp()
          }}
          onWheel={handleWheel}
          style={{
            cursor: isPanning
              ? 'grabbing'
              : placementMode || connectMode || selectionRect
                ? 'crosshair'
                : 'default',
          }}
        >
          <Layer>
            <Group x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom}>
              <Rect
                data-canvas-surface
                width={document.canvas.width}
                height={document.canvas.height}
                cornerRadius={18}
                fill="rgba(12, 18, 28, 0.94)"
                stroke="rgba(109, 137, 165, 0.3)"
                strokeWidth={1}
              />

              {gridLines.map((points, index) => (
                <Line
                  key={`grid-${index}`}
                  points={points}
                  stroke="rgba(68, 96, 122, 0.16)"
                  strokeWidth={1}
                />
              ))}

              {document.wires.map((wire) => {
                const points = getWirePoints(document, wire)
                if (!points) {
                  return null
                }

                const wireSelected = isSelected('wire', wire.id)

                return (
                  <Group key={wire.id}>
                    <Arrow
                      points={points}
                      fill={wireSelected ? '#e7fff4' : '#9ad4c6'}
                      stroke={wireSelected ? '#e7fff4' : '#6bc2ae'}
                      strokeWidth={wireSelected ? 3.6 : 2.2}
                      pointerLength={10}
                      pointerWidth={10}
                      lineJoin="round"
                      onClick={() => setSelection({ entityType: 'wire', id: wire.id })}
                    />
                    {wireSelected &&
                      wire.route.kind === 'polyline' &&
                      wire.route.bendPoints.map((point, index) => (
                        <Group key={`${wire.id}-bend-${index}`}>
                          <Circle
                            x={point.x}
                            y={point.y}
                            radius={8}
                            fill="#102436"
                            stroke="#f8f2da"
                            strokeWidth={2}
                            draggable
                            onDragEnd={(dragEvent) =>
                              moveWireBendPoint(wire.id, index, {
                                x: dragEvent.target.x(),
                                y: dragEvent.target.y(),
                              })
                            }
                          />
                          <Text
                            x={point.x - 4}
                            y={point.y - 24}
                            text={String(index + 1)}
                            fill="#f8f2da"
                            fontSize={11}
                          />
                        </Group>
                      ))}
                  </Group>
                )
              })}

              {draftWirePoints && (
                <Line
                  points={draftWirePoints}
                  stroke="rgba(248, 242, 218, 0.82)"
                  strokeWidth={2}
                  dash={[12, 8]}
                  lineJoin="round"
                />
              )}

              {document.components.map((component) => {
                const bounds = getComponentBounds(component.geometry)
                const center = getGeometryCenter(component.geometry)
                const rotation = getComponentRotation(component)
                const componentSelected = isSelected('component', component.id)

                return (
                  <Group
                    key={component.id}
                    draggable
                    x={center.x}
                    y={center.y}
                    rotation={rotation}
                    onClick={() =>
                      setSelection({ entityType: 'component', id: component.id })
                    }
                    onDragEnd={(dragEvent) =>
                      moveComponentCenter(component.id, dragEvent.target.x(), dragEvent.target.y())
                    }
                  >
                    {component.geometry.type === 'rectangle' && (
                      <Rect
                        x={bounds.x - center.x}
                        y={bounds.y - center.y}
                        width={bounds.width}
                        height={bounds.height}
                        cornerRadius={18}
                        fill="rgba(19, 31, 46, 0.96)"
                        stroke={componentSelected ? '#f2f4dd' : '#c86b35'}
                        strokeWidth={componentSelected ? 3 : 2}
                        shadowBlur={componentSelected ? 14 : 6}
                        shadowColor="rgba(210, 122, 60, 0.25)"
                      />
                    )}
                    {component.geometry.type === 'circle' && (
                      <Circle
                        x={0}
                        y={0}
                        radius={component.geometry.radius}
                        fill="rgba(17, 25, 38, 0.96)"
                        stroke={componentSelected ? '#f2f4dd' : '#88d2c5'}
                        strokeWidth={componentSelected ? 3 : 2}
                      />
                    )}
                    {component.geometry.type === 'triangle' && (
                      <Line
                        points={renderTrianglePoints(component, center)}
                        closed
                        fill="rgba(18, 28, 40, 0.96)"
                        stroke={componentSelected ? '#f2f4dd' : '#88d2c5'}
                        strokeWidth={componentSelected ? 3 : 2}
                        lineJoin="round"
                      />
                    )}
                    <Text
                      x={bounds.x - center.x + 18}
                      y={bounds.y - center.y + 18}
                      width={Math.max(bounds.width - 36, 80)}
                      text={component.name}
                      fill="#f4f1df"
                      fontSize={18}
                      fontStyle="bold"
                    />
                    <Text
                      x={bounds.x - center.x + 18}
                      y={bounds.y - center.y + 44}
                      width={Math.max(bounds.width - 36, 80)}
                      text={`${component.id}  ${Math.round(rotation)}°`}
                      fill="rgba(174, 188, 202, 0.68)"
                      fontSize={12}
                    />
                  </Group>
                )
              })}

              {previewGeometry && (
                <Group listening={false}>
                  {previewGeometry.type === 'rectangle' && (
                    <Rect
                      x={previewGeometry.x}
                      y={previewGeometry.y}
                      width={previewGeometry.width}
                      height={previewGeometry.height}
                      cornerRadius={18}
                      fill="rgba(107, 194, 174, 0.08)"
                      stroke="rgba(248, 242, 218, 0.8)"
                      strokeWidth={2}
                      dash={[12, 8]}
                    />
                  )}
                  {previewGeometry.type === 'circle' && (
                    <Circle
                      x={previewGeometry.cx}
                      y={previewGeometry.cy}
                      radius={previewGeometry.radius}
                      fill="rgba(107, 194, 174, 0.08)"
                      stroke="rgba(248, 242, 218, 0.8)"
                      strokeWidth={2}
                      dash={[12, 8]}
                    />
                  )}
                  {previewGeometry.type === 'triangle' && (
                    <Line
                      points={previewGeometry.vertices.flatMap((vertex) => [vertex.x, vertex.y])}
                      closed
                      fill="rgba(107, 194, 174, 0.08)"
                      stroke="rgba(248, 242, 218, 0.8)"
                      strokeWidth={2}
                      dash={[12, 8]}
                    />
                  )}
                </Group>
              )}

              {document.ports.map((port) => {
                const component = document.components.find(
                  (item) => item.id === port.componentId,
                )
                if (!component) {
                  return null
                }

                const position = getPortPosition(component, port.anchor)
                const portSelected = isSelected('port', port.id)

                return (
                  <Group key={port.id}>
                    <Circle
                      data-endpoint
                      x={position.x}
                      y={position.y}
                      radius={portSelected ? 8 : 6}
                      fill={port.direction === 'input' ? '#88d2c5' : '#f2b36f'}
                      stroke={portSelected ? '#f8f2da' : '#0d1017'}
                      strokeWidth={2}
                      draggable
                      onClick={() =>
                        connectMode
                          ? selectEndpoint({ entityType: 'port', refId: port.id })
                          : setSelection({ entityType: 'port', id: port.id })
                      }
                      onDragEnd={(dragEvent) =>
                        movePort(port.id, {
                          x: dragEvent.target.x(),
                          y: dragEvent.target.y(),
                        })
                      }
                    />
                    <Text
                      x={position.x + 10}
                      y={position.y - 16}
                      text={port.name}
                      fill={portSelected ? '#f8f2da' : '#b8c6d4'}
                      fontSize={12}
                    />
                  </Group>
                )
              })}

              {document.nodes.map((node) => {
                const nodeSelected = isSelected('node', node.id)

                return (
                  <Group
                    key={node.id}
                    draggable
                    x={node.position.x}
                    y={node.position.y}
                    onClick={() =>
                      connectMode
                        ? selectEndpoint({ entityType: 'node', refId: node.id })
                        : setSelection({ entityType: 'node', id: node.id })
                    }
                    onDragEnd={(dragEvent) =>
                      moveNode(node.id, dragEvent.target.x(), dragEvent.target.y())
                    }
                  >
                    <Circle
                      data-endpoint
                      radius={nodeSelected ? 8 : 6}
                      fill={nodeSelected ? '#f8f2da' : '#f47f56'}
                      stroke="#0c1118"
                      strokeWidth={2}
                    />
                    <Text
                      x={10}
                      y={-10}
                      text={node.role ?? 'node'}
                      fill="rgba(184, 198, 212, 0.84)"
                      fontSize={11}
                    />
                  </Group>
                )
              })}

              {placementMode?.kind === 'node' && pointerCanvasPoint && (
                <Circle
                  listening={false}
                  x={pointerCanvasPoint.x}
                  y={pointerCanvasPoint.y}
                  radius={7}
                  fill="rgba(244, 127, 86, 0.16)"
                  stroke="#f8f2da"
                  strokeWidth={2}
                  dash={[8, 6]}
                />
              )}

              {document.annotations.map((annotation) => {
                const base = getTargetPosition(document, annotation.target)
                const point = annotation.position ?? {
                  x: base.x + 24,
                  y: base.y - 26,
                }
                const annotationSelected = isSelected('annotation', annotation.id)

                return (
                  <Group
                    key={annotation.id}
                    x={point.x}
                    y={point.y}
                    onClick={() =>
                      setSelection({ entityType: 'annotation', id: annotation.id })
                    }
                  >
                    <Rect
                      width={Math.max(annotation.text.length * 7.8, 86)}
                      height={30}
                      cornerRadius={10}
                      fill={
                        annotation.kind === 'signal'
                          ? 'rgba(116, 190, 167, 0.16)'
                          : 'rgba(201, 111, 53, 0.16)'
                      }
                      stroke={annotationSelected ? '#f8f2da' : 'rgba(201, 111, 53, 0.42)'}
                      strokeWidth={1.6}
                    />
                    <Text
                      x={12}
                      y={8}
                      text={annotation.text}
                      fill="#f8f2da"
                      fontSize={12}
                    />
                  </Group>
                )
              })}
            </Group>
          </Layer>

          {selectionOverlay && (
            <Layer listening={false}>
              <Rect
                x={selectionOverlay.x}
                y={selectionOverlay.y}
                width={selectionOverlay.width}
                height={selectionOverlay.height}
                fill="rgba(248, 242, 218, 0.08)"
                stroke="rgba(248, 242, 218, 0.82)"
                strokeWidth={1}
                dash={[8, 6]}
              />
            </Layer>
          )}
        </Stage>
      </div>

      <div className="canvas-footer">
        <span>
          {t('componentsCount', {
            components: document.components.length,
            ports: document.ports.length,
            wires: document.wires.length,
          })}
        </span>
        <span>{footerMessage}</span>
      </div>
    </div>
  )
}
