import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { deriveCircuitInsights } from '../lib/circuitDescription'
import { deriveFocusLayout } from '../lib/focusLayout'
import {
  clamp,
  fitZoomToBounds,
  getShapePathPoints,
  getSignalPoint,
  getViewportPanForCenter,
  lerpPoint,
} from '../lib/geometry'
import { translate } from '../lib/i18n'
import { useEditorStore } from '../store/editorStore'
import type { Point, TerminalSide } from '../types/document'

const INITIAL_OFFSET = 96
const MIN_ZOOM = 0.32
const MAX_ZOOM = 2.4
const FOCUS_MIN_ZOOM = 0.42
const FOCUS_MAX_ZOOM = 1.52

Konva.dragButtons = [0]

interface DeviceDisplayState {
  center: Point
  opacity: number
  rotationDeg: number
}

function buildTerminalSideBuckets(
  terminals: Array<{
    id: string
    side: TerminalSide
    order?: number
    name: string
  }>,
) {
  const buckets = new Map<TerminalSide, string[]>()
  const grouped = new Map<TerminalSide, typeof terminals>()

  for (const terminal of terminals) {
    const bucket = grouped.get(terminal.side) ?? []
    bucket.push(terminal)
    grouped.set(terminal.side, bucket)
  }

  for (const [side, bucket] of grouped.entries()) {
    bucket.sort((left, right) => {
      const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER
      const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    })
    buckets.set(side, bucket.map((terminal) => terminal.id))
  }

  return buckets
}

function terminalLabelProps(point: Point, side: TerminalSide) {
  switch (side) {
    case 'left':
      return {
        x: point.x - 154,
        y: point.y - 9,
        width: 144,
        align: 'right' as const,
      }
    case 'right':
      return {
        x: point.x + 12,
        y: point.y - 9,
        width: 144,
        align: 'left' as const,
      }
    case 'top':
      return {
        x: point.x - 64,
        y: point.y - 28,
        width: 128,
        align: 'center' as const,
      }
    case 'bottom':
    case 'auto':
    default:
      return {
        x: point.x - 64,
        y: point.y + 12,
        width: 128,
        align: 'center' as const,
      }
  }
}

function getTerminalRoleStroke(direction: string) {
  switch (direction) {
    case 'output':
    case 'power-out':
    case 'ground':
      return {
        baseStroke: '#111827',
        baseStrokeWidth: 2.3,
        outerStroke: null as { color: string; width: number; radiusOffset: number } | null,
      }
    case 'power-in':
      return {
        baseStroke: '#dc2626',
        baseStrokeWidth: 2.3,
        outerStroke: null as { color: string; width: number; radiusOffset: number } | null,
      }
    case 'bidirectional':
      return {
        baseStroke: '#111827',
        baseStrokeWidth: 1.15,
        outerStroke: {
          color: '#ffffff',
          width: 1.15,
          radiusOffset: 0.7,
        },
      }
    case 'passive':
      return {
        baseStroke: '#94a3b8',
        baseStrokeWidth: 2.1,
        outerStroke: null as { color: string; width: number; radiusOffset: number } | null,
      }
    default:
      return {
        baseStroke: '#ffffff',
        baseStrokeWidth: 2,
        outerStroke: null as { color: string; width: number; radiusOffset: number } | null,
      }
  }
}

function interpolateRotationDeg(from: number, to: number, progress: number) {
  const delta = ((to - from + 540) % 360) - 180
  const value = from + delta * progress
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function buildDisplayState(
  insights: ReturnType<typeof deriveCircuitInsights>,
  selectedDeviceId: string | null,
  selectedConnectionKey: string | null,
  focusedDeviceId: string | null,
  focusedLabelKey: string | null,
  focusProgress: number,
  focusLayout: ReturnType<typeof deriveFocusLayout>,
) {
  const relatedByConnection = selectedConnectionKey
    ? new Set(insights.connectionHighlightsByKey[selectedConnectionKey]?.deviceIds ?? [])
    : null
  const relation = selectedDeviceId ? insights.deviceRelationsById[selectedDeviceId] : null
  const relatedByRelation = relation
    ? new Set([
        selectedDeviceId,
        ...relation.upstreamDeviceIds,
        ...relation.downstreamDeviceIds,
        ...relation.peerDeviceIds,
      ])
    : null
  const focusTargets = focusLayout?.states ?? null

  const states = new Map<string, DeviceDisplayState>()
  for (const device of insights.devices) {
    const relationActive = relatedByRelation?.has(device.id) ?? false
    const connectionActive = relatedByConnection?.has(device.id) ?? false
    const focusTarget = focusTargets?.get(device.id) ?? null
    const focused = Boolean(focusTarget)
    const center = focusTarget
      ? lerpPoint(device.center, focusTarget.center, focusProgress)
      : device.center
    const rotationDeg = focusTarget
      ? interpolateRotationDeg(device.rotationDeg, focusTarget.rotationDeg, focusProgress)
      : device.rotationDeg
    const opacity = focusTargets
      ? focused
        ? 1
        : 1 - focusProgress * 0.9
      : relatedByConnection
        ? connectionActive
          ? 1
          : 0.18
        : relatedByRelation
          ? relationActive
            ? 1
            : 0.26
          : 1

    states.set(device.id, {
      center,
      opacity,
      rotationDeg,
    })
  }

  return {
    states,
    relatedByRelation,
    relatedByConnection,
    relation,
    focusTargets,
    focusAnchorId: focusedDeviceId,
    focusedLabelKey,
  }
}

function getVisibleWorldBounds(
  viewport: { width: number; height: number },
  pan: Point,
  zoom: number,
) {
  return {
    left: (-pan.x) / zoom,
    top: (-pan.y) / zoom,
    right: (viewport.width - pan.x) / zoom,
    bottom: (viewport.height - pan.y) / zoom,
  }
}

function buildInfiniteGrid(
  viewport: { width: number; height: number },
  pan: Point,
  zoom: number,
  size: number,
  majorEvery: number,
) {
  const world = getVisibleWorldBounds(viewport, pan, zoom)
  const safeMajorEvery = Math.max(2, majorEvery)
  const minor: number[][] = []
  const major: number[][] = []

  const startX = Math.floor(world.left / size) * size
  const endX = Math.ceil(world.right / size) * size
  const startY = Math.floor(world.top / size) * size
  const endY = Math.ceil(world.bottom / size) * size

  for (let x = startX; x <= endX; x += size) {
    const isAxis = Math.abs(x) < size / 2
    const isMajor = Math.round(x / size) % safeMajorEvery === 0
    const target = isAxis || isMajor ? major : minor
    target.push([x, startY, x, endY])
  }

  for (let y = startY; y <= endY; y += size) {
    const isAxis = Math.abs(y) < size / 2
    const isMajor = Math.round(y / size) % safeMajorEvery === 0
    const target = isAxis || isMajor ? major : minor
    target.push([startX, y, endX, y])
  }

  return {
    minor,
    major,
    world,
  }
}

export function CanvasView() {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef({ x: INITIAL_OFFSET, y: INITIAL_OFFSET })
  const zoomRef = useRef(0.84)
  const focusProgressRef = useRef(0)
  const [viewport, setViewport] = useState({ width: 1200, height: 760 })
  const [zoom, setZoom] = useState(0.84)
  const [pan, setPan] = useState({ x: INITIAL_OFFSET, y: INITIAL_OFFSET })
  const [focusProgress, setFocusProgress] = useState(0)
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef<{ pointer: Point; pan: Point } | null>(null)
  const suppressClickRef = useRef(false)

  const document = useEditorStore((state) => state.document)
  const selection = useEditorStore((state) => state.selection)
  const locale = useEditorStore((state) => state.locale)
  const focusedDeviceId = useEditorStore((state) => state.focusedDeviceId)
  const focusedLabelKey = useEditorStore((state) => state.focusedLabelKey)
  const focusedNetworkLineId = useEditorStore((state) => state.focusedNetworkLineId)
  const viewportAnimationTarget = useEditorStore((state) => state.viewportAnimationTarget)
  const moveDevice = useEditorStore((state) => state.moveDevice)
  const updateNetworkLine = useEditorStore((state) => state.updateNetworkLine)
  const setSelection = useEditorStore((state) => state.setSelection)
  const focusDevice = useEditorStore((state) => state.focusDevice)
  const focusNetworkLine = useEditorStore((state) => state.focusNetworkLine)
  const clearFocus = useEditorStore((state) => state.clearFocus)
  const resetViewportToOrigin = useEditorStore((state) => state.resetViewportToOrigin)

  const animateViewportTo = useCallback(
    (
    targetCenter: Point,
    targetZoom: number,
    duration = 340,
    ) => {
      const targetPan = getViewportPanForCenter(targetCenter, viewport, targetZoom)
      const startPan = panRef.current
      const startZoom = zoomRef.current
      const startAt = performance.now()
      let frame = 0

      const tick = (timestamp: number) => {
        const progress = Math.min((timestamp - startAt) / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        const nextZoom = startZoom + (targetZoom - startZoom) * eased
        const nextPan = {
          x: startPan.x + (targetPan.x - startPan.x) * eased,
          y: startPan.y + (targetPan.y - startPan.y) * eased,
        }
        zoomRef.current = nextZoom
        panRef.current = nextPan
        setZoom(nextZoom)
        setPan(nextPan)

        if (progress < 1) {
          frame = window.requestAnimationFrame(tick)
        }
      }

      frame = window.requestAnimationFrame(tick)
      return () => window.cancelAnimationFrame(frame)
    },
    [viewport, setPan, setZoom],
  )

  useEffect(() => {
    panRef.current = pan
  }, [pan])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

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

  useEffect(() => {
    focusProgressRef.current = focusProgress
  }, [focusProgress])

  useEffect(() => {
    let frame = 0
    const start = performance.now()
    const from = focusProgressRef.current
    const to = focusedDeviceId || focusedLabelKey || focusedNetworkLineId ? 1 : 0
    const duration = 320

    const tick = (timestamp: number) => {
      const progress = Math.min((timestamp - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setFocusProgress(from + (to - from) * eased)
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [focusedDeviceId, focusedLabelKey, focusedNetworkLineId])

  useEffect(() => {
    if (!viewportAnimationTarget) {
      return
    }

    return animateViewportTo(
      viewportAnimationTarget.center,
      clamp(viewportAnimationTarget.zoom, MIN_ZOOM, MAX_ZOOM),
    )
  }, [
    animateViewportTo,
    viewportAnimationTarget,
    viewportAnimationTarget?.center.x,
    viewportAnimationTarget?.center.y,
    viewportAnimationTarget?.zoom,
  ])

  const t = useMemo(
    () => (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  )
  const insights = useMemo(() => deriveCircuitInsights(document, locale), [document, locale])
  const selectedDeviceId =
    selection?.entityType === 'device'
      ? selection.id ?? null
      : selection?.entityType === 'terminal'
        ? insights.terminalById[selection.id ?? '']?.deviceId ?? null
        : null
  const selectedConnectionKey =
    selection?.entityType === 'terminal'
      ? insights.terminalById[selection.id ?? '']?.connectionLabel ?? null
      : null
  const selectedNetworkLineId =
    selection?.entityType === 'networkLine'
      ? selection.id ?? null
      : null
  const focusLayout = useMemo(() => {
    if (focusedNetworkLineId) {
      return deriveFocusLayout(insights, { type: 'networkLine', id: focusedNetworkLineId })
    }

    if (focusedLabelKey) {
      return deriveFocusLayout(insights, { type: 'label', key: focusedLabelKey })
    }

    if (focusedDeviceId) {
      return deriveFocusLayout(insights, { type: 'device', id: focusedDeviceId })
    }

    return null
  }, [focusedDeviceId, focusedLabelKey, focusedNetworkLineId, insights])
  const focusTargetKey = focusedNetworkLineId
    ? `networkLine:${focusedNetworkLineId}`
    : focusedLabelKey
      ? `label:${focusedLabelKey}`
    : focusedDeviceId
      ? `device:${focusedDeviceId}`
      : null

  useEffect(() => {
    if (!focusLayout || !focusTargetKey) {
      return
    }
    const viewportSize = { width: viewport.width, height: viewport.height }

    const center = {
      x: focusLayout.bounds.x + focusLayout.bounds.width / 2,
      y: focusLayout.bounds.y + focusLayout.bounds.height / 2,
    }
    const zoomValue = clamp(
      fitZoomToBounds(focusLayout.bounds, viewportSize, 110),
      FOCUS_MIN_ZOOM,
      FOCUS_MAX_ZOOM,
    )

    return animateViewportTo(center, zoomValue, 380)
  }, [
    animateViewportTo,
    focusLayout,
    focusLayout?.bounds.height,
    focusLayout?.bounds.width,
    focusLayout?.bounds.x,
    focusLayout?.bounds.y,
    focusTargetKey,
    viewport.height,
    viewport.width,
  ])

  const display = useMemo(
    () =>
      buildDisplayState(
        insights,
        selectedDeviceId,
        selectedConnectionKey,
        focusedDeviceId,
        focusedLabelKey,
        focusProgress,
        focusLayout,
      ),
    [
      focusLayout,
      focusProgress,
      focusedDeviceId,
      focusedLabelKey,
      insights,
      selectedConnectionKey,
      selectedDeviceId,
    ],
  )

  const gridSize = document.view.canvas.grid?.size ?? 36
  const majorEvery = document.view.canvas.grid?.majorEvery ?? 5
  const gridPrimitives = useMemo(
    () =>
      document.view.canvas.grid?.enabled
        ? buildInfiniteGrid(viewport, pan, zoom, Math.max(8, gridSize), Math.max(2, majorEvery))
        : { minor: [], major: [], world: getVisibleWorldBounds(viewport, pan, zoom) },
    [document.view.canvas.grid?.enabled, gridSize, majorEvery, pan, viewport, zoom],
  )

  const handleWheel = (event: { evt: WheelEvent }) => {
    event.evt.preventDefault()
    const delta = event.evt.deltaY
    const stage = event.evt.currentTarget as HTMLCanvasElement | null
    if (!stage) {
      return
    }

    const rect = stage.getBoundingClientRect()
    const pointer = {
      x: event.evt.clientX - rect.left,
      y: event.evt.clientY - rect.top,
    }

    const nextZoom = clamp(zoom * (delta > 0 ? 0.92 : 1.08), MIN_ZOOM, MAX_ZOOM)
    const worldPoint = {
      x: (pointer.x - pan.x) / zoom,
      y: (pointer.y - pan.y) / zoom,
    }

    const nextPan = {
      x: pointer.x - worldPoint.x * nextZoom,
      y: pointer.y - worldPoint.y * nextZoom,
    }
    zoomRef.current = nextZoom
    panRef.current = nextPan
    setZoom(nextZoom)
    setPan(nextPan)
  }

  const handleBackgroundMouseDown = (event: { evt: MouseEvent }) => {
    if (event.evt.button !== 1) {
      return
    }

    panStartRef.current = {
      pointer: { x: event.evt.clientX, y: event.evt.clientY },
      pan,
    }
    setIsPanning(true)
  }

  const handleBackgroundMouseMove = (event: { evt: MouseEvent }) => {
    if (!panStartRef.current) {
      return
    }

    const deltaX = event.evt.clientX - panStartRef.current.pointer.x
    const deltaY = event.evt.clientY - panStartRef.current.pointer.y
    const nextPan = {
      x: panStartRef.current.pan.x + deltaX,
      y: panStartRef.current.pan.y + deltaY,
    }
    panRef.current = nextPan
    setPan(nextPan)
  }

  const stopPan = () => {
    panStartRef.current = null
    setIsPanning(false)
  }

  const suppressClicksAfterDrag = useCallback(() => {
    suppressClickRef.current = true
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }, [])

  const activeRelation = selectedDeviceId
    ? insights.deviceRelationsById[selectedDeviceId]
    : null
  const activeFocusSummary = focusedDeviceId
    ? insights.focusSummariesByDeviceId[focusedDeviceId] ?? null
    : null
  const networkFocusSummary = focusedLabelKey
    ? t('networkFocusSummary', {
        label: focusedLabelKey,
        count: focusLayout?.deviceIds.length ?? 0,
      })
    : null
  const footerMessage = networkFocusSummary ?? activeFocusSummary?.summaryText ?? activeRelation?.connectionLabels.join(' / ') ?? null
  const gridOpacity = 1 - focusProgress * 0.78
  const focusRailTerminal = focusedLabelKey
    ? insights.connectionHighlightsByKey[focusedLabelKey]?.terminalIds[0]
      ? insights.terminalColorsById[
          insights.connectionHighlightsByKey[focusedLabelKey]!.terminalIds[0]!
        ]
      : null
    : null

  return (
    <section className="canvas-shell">
      <div className="canvas-header">
        <div>
          <strong>{t('canvasTitle')}</strong>
        </div>
        <div className="canvas-header__meta">
          <span>{t('devicesCount', { count: document.devices.length })}</span>
          <span>{t('labelsCount', { count: insights.connectionGroups.length })}</span>
          <button className="ghost-button" onClick={resetViewportToOrigin}>
            {t('goOrigin')}
          </button>
        </div>
      </div>

      <div className={`canvas-stage ${isPanning ? 'is-panning' : ''}`} ref={wrapperRef}>
        <Stage
          width={viewport.width}
          height={viewport.height}
          onWheel={handleWheel}
          onMouseDown={handleBackgroundMouseDown}
          onMouseMove={handleBackgroundMouseMove}
          onMouseUp={stopPan}
          onMouseLeave={stopPan}
          onClick={() => {
            setSelection({ entityType: 'document' })
            clearFocus()
          }}
        >
          <Layer listening={false}>
            <Rect x={0} y={0} width={viewport.width} height={viewport.height} fill="#ffffff" />
          </Layer>

          <Layer x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom}>
            {gridPrimitives.minor.map((points, index) => (
              <Line
                key={`grid-minor-${index}`}
                points={points}
                stroke={`rgba(203, 213, 225, ${0.34 * gridOpacity})`}
                strokeWidth={1}
              />
            ))}

            {gridPrimitives.major.map((points, index) => {
              const isVerticalAxis = Math.abs(points[0]) < gridSize / 2 && points[0] === points[2]
              const isHorizontalAxis = Math.abs(points[1]) < gridSize / 2 && points[1] === points[3]
              return (
                <Line
                  key={`grid-major-${index}`}
                  points={points}
                  stroke={
                    isVerticalAxis || isHorizontalAxis
                      ? `rgba(148, 163, 184, ${0.96 * gridOpacity})`
                      : `rgba(148, 163, 184, ${0.5 * gridOpacity})`
                  }
                  strokeWidth={isVerticalAxis || isHorizontalAxis ? 1.8 : 1.1}
                />
              )
            })}

            <Rect
              x={gridPrimitives.world.left}
              y={gridPrimitives.world.top}
              width={gridPrimitives.world.right - gridPrimitives.world.left}
              height={gridPrimitives.world.bottom - gridPrimitives.world.top}
              fill="#ffffff"
              opacity={focusProgress * 0.52}
            />

            <Circle x={0} y={0} radius={7} fill="#0f172a" opacity={0.08 * gridOpacity} />
            <Circle x={0} y={0} radius={3.4} fill="#0f172a" opacity={gridOpacity} />
            <Text x={10} y={10} text="0,0" fill={`rgba(100, 116, 139, ${gridOpacity})`} fontSize={12} />

            {insights.networkLines.map((networkLine) => {
              const firstTerminalId =
                insights.connectionHighlightsByKey[networkLine.labelKey]?.terminalIds[0] ?? null
              const color = firstTerminalId
                ? insights.terminalColorsById[firstTerminalId]
                : null
              const selected = selectedNetworkLineId === networkLine.id
              const focused = focusedNetworkLineId === networkLine.id

              return (
                <Group
                  key={networkLine.id}
                  x={0}
                  y={0}
                  draggable={focusProgress < 0.05}
                  onClick={(evt) => {
                    if (suppressClickRef.current) {
                      evt.cancelBubble = true
                      return
                    }
                    evt.cancelBubble = true
                    setSelection({ entityType: 'networkLine', id: networkLine.id })
                    if ((focusedDeviceId || focusedLabelKey || focusedNetworkLineId) && !focused) {
                      clearFocus()
                    }
                  }}
                  onDblClick={(evt) => {
                    if (suppressClickRef.current) {
                      evt.cancelBubble = true
                      return
                    }
                    evt.cancelBubble = true
                    setSelection({ entityType: 'networkLine', id: networkLine.id })
                    focusNetworkLine(networkLine.id)
                  }}
                  onDragStart={() => {
                    suppressClickRef.current = true
                  }}
                  onDragEnd={(evt) => {
                    const delta = {
                      x: evt.target.x(),
                      y: evt.target.y(),
                    }
                    if (!delta.x && !delta.y) {
                      return
                    }

                    updateNetworkLine(networkLine.id, {
                      position: {
                        x: networkLine.position.x + delta.x,
                        y: networkLine.position.y + delta.y,
                      },
                    })
                    suppressClicksAfterDrag()
                  }}
                >
                  <Line
                    points={[
                      networkLine.start.x,
                      networkLine.start.y,
                      networkLine.end.x,
                      networkLine.end.y,
                    ]}
                    stroke={focused ? color?.stroke ?? '#1d4ed8' : color?.fill ?? '#60a5fa'}
                    strokeWidth={focused ? 7 : selected ? 6 : 4}
                    lineCap="round"
                    opacity={0.92}
                  />
                  <Text
                    x={
                      networkLine.orientation === 'horizontal'
                        ? networkLine.position.x - 80
                        : networkLine.position.x + 12
                    }
                    y={
                      networkLine.orientation === 'horizontal'
                        ? networkLine.position.y - 32
                        : networkLine.position.y - 12
                    }
                    width={160}
                    text={networkLine.label}
                    fill={focused ? color?.text ?? '#1d4ed8' : color?.text ?? '#2563eb'}
                    fontSize={16}
                    fontStyle={focused || selected ? 'bold' : 'normal'}
                    align={networkLine.orientation === 'horizontal' ? 'center' : 'left'}
                    rotation={networkLine.orientation === 'vertical' ? 90 : 0}
                    offsetX={networkLine.orientation === 'vertical' ? 80 : 0}
                    offsetY={networkLine.orientation === 'vertical' ? 10 : 0}
                  />
                </Group>
              )
            })}

            {focusLayout?.rail && (
              <Group listening={false} opacity={focusProgress}>
                <Line
                  points={[
                    focusLayout.rail.start.x,
                    focusLayout.rail.start.y,
                    focusLayout.rail.end.x,
                    focusLayout.rail.end.y,
                  ]}
                  stroke={focusRailTerminal?.fill ?? '#2563eb'}
                  strokeWidth={4}
                  lineCap="round"
                  dash={[18, 12]}
                />
                <Text
                  x={focusLayout.rail.textPoint.x}
                  y={focusLayout.rail.textPoint.y}
                  width={144}
                  text={focusLayout.rail.label}
                  fill={focusRailTerminal?.text ?? '#1d4ed8'}
                  fontSize={18}
                  fontStyle="bold"
                  align="center"
                />
              </Group>
            )}

            {insights.devices.map((device) => {
              const state = display.states.get(device.id)!
              const selected = selection?.entityType === 'device' && selection.id === device.id
              const relationRole =
                activeRelation?.deviceId === device.id
                  ? 'anchor'
                  : activeRelation?.upstreamDeviceIds.includes(device.id)
                    ? 'upstream'
                    : activeRelation?.downstreamDeviceIds.includes(device.id)
                      ? 'downstream'
                      : activeRelation?.peerDeviceIds.includes(device.id)
                        ? 'peer'
                        : null
              const connectionActive = display.relatedByConnection?.has(device.id) ?? false
              const focusActive = display.focusTargets?.has(device.id) ?? false
              const focusAnchor = focusedDeviceId === device.id
              const localBounds = {
                x: 0,
                y: 0,
                width: device.bounds.width,
                height: device.bounds.height,
              }
              const strokeColor = focusAnchor
                ? '#111827'
                : focusedLabelKey && focusActive
                  ? '#2563eb'
                  : relationRole === 'upstream'
                    ? '#dc2626'
                    : relationRole === 'downstream'
                      ? '#16a34a'
                      : selected || connectionActive
                        ? '#2563eb'
                        : '#d0d5dd'
              const fillColor = focusActive
                ? '#ffffff'
                : relationRole === 'upstream'
                  ? '#fff5f5'
                  : relationRole === 'downstream'
                    ? '#f2fff5'
                    : connectionActive
                      ? '#f5f9ff'
                      : '#ffffff'

              const sideBuckets = buildTerminalSideBuckets(
                device.terminals.map((terminal) => ({
                  id: terminal.id,
                  side: terminal.side,
                  order: terminal.source.order,
                  name: terminal.name,
                })),
              )

              return (
                <Group
                  key={device.id}
                  opacity={state.opacity}
                  draggable={focusProgress < 0.05}
                  onClick={(evt) => {
                    if (suppressClickRef.current) {
                      evt.cancelBubble = true
                      return
                    }
                    evt.cancelBubble = true
                    setSelection({ entityType: 'device', id: device.id })
                    if ((focusedDeviceId || focusedLabelKey || focusedNetworkLineId) && !focusAnchor) {
                      clearFocus()
                    }
                  }}
                  onDblClick={(evt) => {
                    if (suppressClickRef.current) {
                      evt.cancelBubble = true
                      return
                    }
                    evt.cancelBubble = true
                    setSelection({ entityType: 'device', id: device.id })
                    focusDevice(device.id)
                  }}
                  onDragStart={() => {
                    suppressClickRef.current = true
                  }}
                  onDragEnd={(evt) => {
                    moveDevice(device.id, {
                      x: evt.target.x() - localBounds.width / 2,
                      y: evt.target.y() - localBounds.height / 2,
                    })
                    suppressClicksAfterDrag()
                  }}
                  x={state.center.x}
                  y={state.center.y}
                  offsetX={localBounds.width / 2}
                  offsetY={localBounds.height / 2}
                  rotation={state.rotationDeg}
                >
                  {device.shape === 'rectangle' && (
                    <Rect
                      width={localBounds.width}
                      height={localBounds.height}
                      cornerRadius={8}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={focusActive ? 4 : selected || relationRole || connectionActive ? 3 : 2}
                      shadowBlur={focusActive ? 22 : 8}
                      shadowColor="rgba(15, 23, 42, 0.08)"
                    />
                  )}
                  {device.shape === 'circle' && (
                    <Circle
                      x={localBounds.width / 2}
                      y={localBounds.height / 2}
                      radius={Math.min(localBounds.width, localBounds.height) / 2}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={focusActive ? 4 : selected || relationRole || connectionActive ? 3 : 2}
                    />
                  )}
                  {device.shape === 'triangle' && (
                    <Line
                      points={getShapePathPoints(localBounds, device.shape)}
                      closed
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={focusActive ? 4 : selected || relationRole || connectionActive ? 3 : 2}
                      lineJoin="round"
                    />
                  )}

                  <Text
                    x={18}
                    y={16}
                    width={localBounds.width - 36}
                    text={device.reference}
                    fill="rgba(71, 85, 105, 0.92)"
                    fontSize={12}
                    fontStyle="bold"
                  />
                  <Text
                    x={18}
                    y={localBounds.height / 2 - 14}
                    width={localBounds.width - 36}
                    height={28}
                    text={device.source.name}
                    fill="#0f172a"
                    fontSize={18}
                    fontStyle="bold"
                    align="center"
                    verticalAlign="middle"
                    wrap="none"
                    ellipsis
                  />

                  {device.terminals.map((terminal) => {
                    const bucket = sideBuckets.get(terminal.side) ?? [terminal.id]
                    const order = Math.max(0, bucket.indexOf(terminal.id))
                    const point = getSignalPoint(
                      localBounds,
                      device.shape,
                      terminal.side,
                      order,
                      bucket.length,
                    )
                    const color = insights.terminalColorsById[terminal.id]
                    const selectedTerminal =
                      selection?.entityType === 'terminal' && selection.id === terminal.id
                    const sameConnection =
                      selectedConnectionKey &&
                      terminal.connectionLabel &&
                      selectedConnectionKey === terminal.connectionLabel
                    const sameFocusedLabel =
                      focusedLabelKey &&
                      terminal.connectionLabel &&
                      focusedLabelKey === terminal.connectionLabel
                    const emphasisStroke = selectedTerminal
                      ? '#111827'
                      : sameConnection || sameFocusedLabel
                        ? '#2563eb'
                        : null
                    const roleStroke = getTerminalRoleStroke(terminal.direction)
                    const props = terminalLabelProps(point, terminal.side)
                    const baseRadius = selectedTerminal || sameConnection || sameFocusedLabel ? 8 : 6

                    return (
                      <Group
                        key={terminal.id}
                        onClick={(evt) => {
                          evt.cancelBubble = true
                          setSelection({ entityType: 'terminal', id: terminal.id })
                        }}
                      >
                        {emphasisStroke && (
                          <Circle
                            x={point.x}
                            y={point.y}
                            radius={baseRadius + 2}
                            fillEnabled={false}
                            stroke={emphasisStroke}
                            strokeWidth={2.2}
                            opacity={0.96}
                          />
                        )}
                        {roleStroke.outerStroke && (
                          <Circle
                            x={point.x}
                            y={point.y}
                            radius={baseRadius + roleStroke.outerStroke.radiusOffset}
                            fillEnabled={false}
                            stroke={roleStroke.outerStroke.color}
                            strokeWidth={roleStroke.outerStroke.width}
                            opacity={1}
                          />
                        )}
                        <Circle
                          x={point.x}
                          y={point.y}
                          radius={baseRadius}
                          fill={color.fill}
                          stroke={roleStroke.baseStroke}
                          strokeWidth={roleStroke.baseStrokeWidth}
                          shadowBlur={12}
                          shadowColor={color.glow}
                        />
                        <Text
                          x={props.x}
                          y={props.y}
                          width={props.width}
                          text={terminal.displayLabel}
                          fill={color.text}
                          fontSize={11}
                          fontStyle={selectedTerminal || sameConnection || sameFocusedLabel ? 'bold' : 'normal'}
                          align={props.align}
                          wrap="none"
                          ellipsis
                        />
                      </Group>
                    )
                  })}
                </Group>
              )
            })}
          </Layer>
        </Stage>
      </div>

      {(footerMessage || focusedDeviceId || focusedLabelKey || focusedNetworkLineId) && (
        <div className="canvas-footer">
          <span>{footerMessage ?? ''}</span>
          <div className="canvas-footer__actions">
            {(focusedDeviceId || focusedLabelKey || focusedNetworkLineId) && (
              <button className="ghost-button" onClick={() => clearFocus()}>
                {t('exitFocus')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
