import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type Konva from 'konva'
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { DeviceSymbolGlyph } from '../DeviceSymbolGlyph'
import type { CircuitInsights, DerivedDevice } from '../../lib/circuitDescription'
import { getTerminalFlowDirection, isFlexibleDirection, isSinkLikeDirection, isSourceLikeDirection } from '../../lib/document'
import { hasDedicatedDeviceSymbol } from '../../lib/deviceSymbols'
import { deriveFocusLayout } from '../../lib/focusLayout'
import {
  clamp,
  fitZoomToBounds,
  getShapePathPoints,
  getSignalPoint,
  getStoredTerminalAnchor,
  getViewportPanForCenter,
  lerpPoint,
  projectPointToShapeEdge,
} from '../../lib/geometry'
import { translate } from '../../lib/i18n'
import { getCanvasTheme } from '../../lib/canvasTheme'
import type { DocumentFile, Locale, Point, TerminalDirection, TerminalSide } from '../../types/document'
import type { ThemeMode } from '../../lib/theme'

const INITIAL_OFFSET = 96
const MIN_ZOOM = 0.22
const MAX_ZOOM = 2.4
const FOCUS_MIN_ZOOM = 0.34
const FOCUS_MAX_ZOOM = 1.5
const TERMINAL_LABEL_WIDTH = 172
const TERMINAL_LABEL_HEIGHT = 18

interface MobileViewerCanvasProps {
  document: DocumentFile
  insights: CircuitInsights
  theme: ThemeMode
  locale: Locale
  selectedDeviceId: string | null
  selectedLabelKey: string | null
  selectedNetworkLineId: string | null
  onSelectDevice: (id: string) => void
  onSelectNetworkLine: (id: string) => void
  onSelectLabel: (key: string) => void
  onClearSelection: () => void
}

interface DeviceDisplayState {
  center: Point
  opacity: number
  rotationDeg: number
}

interface BoundsLike {
  x: number
  y: number
  width: number
  height: number
}

interface ViewportTransform {
  zoom: number
  pan: Point
}

interface TerminalLayoutEntry {
  point: Point
  side: TerminalSide
}

interface TerminalLabelCandidate {
  id: string
  anchor: Point
  side: TerminalSide
  text: string
  fill: string
  fontStyle: 'bold' | 'normal'
  opacity: number
  priority: number
}

interface TerminalLabelPlacement extends TerminalLabelCandidate {
  x: number
  y: number
  width: number
  height: number
  align: 'left' | 'right' | 'center'
  leaderPoints: number[]
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
      return (
        leftOrder - rightOrder ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id)
      )
    })
    buckets.set(side, bucket.map((terminal) => terminal.id))
  }

  return buckets
}

function terminalLabelProps(
  point: Point,
  side: TerminalSide,
  depthOffset = 0,
  tangentOffset = 0,
  labelWidth = TERMINAL_LABEL_WIDTH,
  labelHeight = TERMINAL_LABEL_HEIGHT,
) {
  switch (side) {
    case 'left':
      return {
        x: point.x - (labelWidth + 18 + depthOffset),
        y: point.y - labelHeight / 2 + tangentOffset,
        width: labelWidth,
        height: labelHeight,
        align: 'right' as const,
      }
    case 'right':
      return {
        x: point.x + 18 + depthOffset,
        y: point.y - labelHeight / 2 + tangentOffset,
        width: labelWidth,
        height: labelHeight,
        align: 'left' as const,
      }
    case 'top':
      return {
        x: point.x - labelWidth / 2 + tangentOffset,
        y: point.y - (labelHeight + 16 + depthOffset),
        width: labelWidth,
        height: labelHeight,
        align: 'center' as const,
      }
    case 'bottom':
    case 'auto':
    default:
      return {
        x: point.x - labelWidth / 2 + tangentOffset,
        y: point.y + 16 + depthOffset,
        width: labelWidth,
        height: labelHeight,
        align: 'center' as const,
      }
  }
}

function boundsOverlap(left: BoundsLike, right: BoundsLike, padding = 0) {
  return !(
    left.x + left.width + padding <= right.x ||
    right.x + right.width + padding <= left.x ||
    left.y + left.height + padding <= right.y ||
    right.y + right.height + padding <= left.y
  )
}

function clampToRange(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getDeviceSymbolAccent(visualKind: string) {
  if (visualKind === 'led') return '#EA580C'
  if (visualKind === 'diode' || visualKind === 'flyback-diode' || visualKind === 'rectifier-diode' || visualKind === 'zener-diode' || visualKind === 'tvs-diode') {
    return '#475569'
  }
  if (visualKind === 'npn-transistor' || visualKind === 'pnp-transistor' || visualKind === 'nmos' || visualKind === 'pmos') {
    return '#0F766E'
  }
  if (visualKind === 'crystal') return '#4F46E5'
  if (visualKind === 'op-amp') return '#2563EB'
  return '#64748B'
}

function buildLabelLeaderPoints(anchor: Point, rect: BoundsLike, side: TerminalSide) {
  switch (side) {
    case 'left': {
      const targetY = clampToRange(anchor.y, rect.y + 3, rect.y + rect.height - 3)
      return [anchor.x, anchor.y, rect.x + rect.width, targetY]
    }
    case 'right': {
      const targetY = clampToRange(anchor.y, rect.y + 3, rect.y + rect.height - 3)
      return [anchor.x, anchor.y, rect.x, targetY]
    }
    case 'top': {
      const targetX = clampToRange(anchor.x, rect.x + 8, rect.x + rect.width - 8)
      return [anchor.x, anchor.y, targetX, rect.y + rect.height]
    }
    case 'bottom':
    case 'auto':
    default: {
      const targetX = clampToRange(anchor.x, rect.x + 8, rect.x + rect.width - 8)
      return [anchor.x, anchor.y, targetX, rect.y]
    }
  }
}

function getLabelPlacementBounds(
  placement: Pick<TerminalLabelPlacement, 'x' | 'y' | 'width' | 'height'>,
): BoundsLike {
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
  }
}

function buildLabelSortKey(
  label: TerminalLabelCandidate,
  previousPlacement?: Pick<TerminalLabelPlacement, 'x' | 'y' | 'width' | 'height'>,
) {
  const previousCenter = previousPlacement
    ? {
        x: previousPlacement.x + previousPlacement.width / 2,
        y: previousPlacement.y + previousPlacement.height / 2,
      }
    : null

  switch (label.side) {
    case 'left':
    case 'right':
      return previousCenter?.y ?? label.anchor.y
    default:
      return previousCenter?.x ?? label.anchor.x
  }
}

function getLabelPlacementDistance(
  candidate: Pick<TerminalLabelPlacement, 'x' | 'y' | 'width' | 'height'>,
  previousPlacement?: Pick<TerminalLabelPlacement, 'x' | 'y' | 'width' | 'height'>,
) {
  if (!previousPlacement) {
    return 0
  }

  const candidateCenter = {
    x: candidate.x + candidate.width / 2,
    y: candidate.y + candidate.height / 2,
  }
  const previousCenter = {
    x: previousPlacement.x + previousPlacement.width / 2,
    y: previousPlacement.y + previousPlacement.height / 2,
  }

  return Math.hypot(candidateCenter.x - previousCenter.x, candidateCenter.y - previousCenter.y)
}

function rotateVector(point: Point, rotationDeg: number): Point {
  const radians = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

function getWorldPointForDeviceLocalPoint(
  center: Point,
  size: { width: number; height: number },
  rotationDeg: number,
  localPoint: Point,
) {
  const rotated = rotateVector(
    {
      x: localPoint.x - size.width / 2,
      y: localPoint.y - size.height / 2,
    },
    rotationDeg,
  )

  return {
    x: center.x + rotated.x,
    y: center.y + rotated.y,
  }
}

function rotateTerminalSide(side: TerminalSide, rotationDeg: number): TerminalSide {
  const normal =
    side === 'left'
      ? { x: -1, y: 0 }
      : side === 'right'
        ? { x: 1, y: 0 }
        : side === 'top'
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 }
  const rotated = rotateVector(normal, rotationDeg)

  if (Math.abs(rotated.x) >= Math.abs(rotated.y)) {
    return rotated.x < 0 ? 'left' : 'right'
  }

  return rotated.y < 0 ? 'top' : 'bottom'
}

function buildDeviceTerminalLayout(device: DerivedDevice) {
  const sideBuckets = buildTerminalSideBuckets(
    device.terminals.map((terminal) => ({
      id: terminal.id,
      side: terminal.side,
      order: terminal.source.order,
      name: terminal.name,
    })),
  )
  const localBounds = {
    x: 0,
    y: 0,
    width: device.bounds.width,
    height: device.bounds.height,
  }

  return new Map<string, TerminalLayoutEntry>(
    device.terminals.map((terminal) => {
      const bucket = sideBuckets.get(terminal.side) ?? [terminal.id]
      const order = Math.max(0, bucket.indexOf(terminal.id))
      return [
        terminal.id,
        (() => {
          const storedAnchor = getStoredTerminalAnchor(terminal.source)
          if (storedAnchor) {
            return projectPointToShapeEdge(
              {
                x: localBounds.x + storedAnchor.x * localBounds.width,
                y: localBounds.y + storedAnchor.y * localBounds.height,
              },
              localBounds,
              device.shape,
              device.visualKind,
            )
          }

          return {
            side: terminal.side === 'auto' ? ('bottom' as const) : terminal.side,
            point: getSignalPoint(
              localBounds,
              device.shape,
              terminal.side,
              order,
              bucket.length,
              device.visualKind,
            ),
          }
        })(),
      ] as const
    }),
  )
}

function layoutTerminalLabels(
  labels: TerminalLabelCandidate[],
  deviceBounds: BoundsLike[],
  previousPlacements: ReadonlyMap<string, BoundsLike> = new Map(),
  labelWidth = TERMINAL_LABEL_WIDTH,
  labelHeight = TERMINAL_LABEL_HEIGHT,
) {
  const occupied: BoundsLike[] = []
  const depthOffsets = [0, 18, 36, 54, 72]
  const tangentOffsets = [0, -18, 18, -36, 36, -54, 54]

  return [...labels]
    .sort((left, right) => {
      const leftPrevious = previousPlacements.get(left.id)
      const rightPrevious = previousPlacements.get(right.id)
      return (
        right.priority - left.priority ||
        left.side.localeCompare(right.side) ||
        buildLabelSortKey(left, leftPrevious) - buildLabelSortKey(right, rightPrevious) ||
        left.id.localeCompare(right.id)
      )
    })
    .map((label) => {
      const previousPlacement = previousPlacements.get(label.id)
      const candidates = depthOffsets.flatMap((depthOffset) =>
        tangentOffsets.map((tangentOffset, candidateIndex) => ({
          rank: depthOffset * 100 + candidateIndex,
          placement: {
            ...terminalLabelProps(label.anchor, label.side, depthOffset, tangentOffset, labelWidth, labelHeight),
          },
        })),
      )

      const choosePlacement = (allowDeviceOverlap: boolean) => {
        const validCandidates = candidates
          .filter((candidate) => {
            const box = getLabelPlacementBounds(candidate.placement)
            if (occupied.some((item) => boundsOverlap(box, item, 6))) return false
            if (!allowDeviceOverlap && deviceBounds.some((item) => boundsOverlap(box, item, 10))) return false
            return true
          })
          .sort((left, right) => {
            const distance =
              getLabelPlacementDistance(left.placement, previousPlacement) -
              getLabelPlacementDistance(right.placement, previousPlacement)
            return distance || left.rank - right.rank
          })

        return validCandidates[0]?.placement
      }

      const chosen =
        choosePlacement(false) ??
        choosePlacement(true) ??
        candidates[candidates.length - 1]?.placement ??
        terminalLabelProps(label.anchor, label.side, 0, 0, labelWidth, labelHeight)

      const placement = {
        ...label,
        ...chosen,
        leaderPoints: buildLabelLeaderPoints(
          label.anchor,
          {
            x: chosen.x,
            y: chosen.y,
            width: chosen.width,
            height: chosen.height,
          },
          label.side,
        ),
      } satisfies TerminalLabelPlacement

      occupied.push(getLabelPlacementBounds(placement))
      return placement
    })
}

function getTerminalRoleStroke(direction: TerminalDirection, sourceStroke = '#111827') {
  if (isSourceLikeDirection(direction)) {
    return {
      baseStroke: sourceStroke,
      baseStrokeWidth: 2.3,
      outerStroke: null as { color: string; width: number; radiusOffset: number } | null,
    }
  }

  if (isSinkLikeDirection(direction)) {
    return {
      baseStroke: '#ffffff',
      baseStrokeWidth: 2.3,
      outerStroke: null as { color: string; width: number; radiusOffset: number } | null,
    }
  }

  if (isFlexibleDirection(direction)) {
    return {
      baseStroke: '#ffffff',
      baseStrokeWidth: 2.1,
      outerStroke: { color: '#64748b', width: 1.8, radiusOffset: 2.4 },
    }
  }

  return {
    baseStroke: '#ffffff',
    baseStrokeWidth: 2.3,
    outerStroke: null as { color: string; width: number; radiusOffset: number } | null,
  }
}

function interpolateRotationDeg(from: number, to: number, progress: number) {
  const delta = ((to - from + 540) % 360) - 180
  const value = from + delta * progress
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function buildDisplayState(
  insights: CircuitInsights,
  selectedDeviceId: string | null,
  focusedDeviceId: string | null,
  focusedLabelKey: string | null,
  focusProgress: number,
  focusLayout: ReturnType<typeof deriveFocusLayout>,
) {
  const relation = selectedDeviceId ? insights.deviceRelationsById[selectedDeviceId] : null
  const relatedByRelation = relation
    ? new Set([selectedDeviceId, ...relation.upstreamDeviceIds, ...relation.downstreamDeviceIds])
    : null
  const focusTargets = focusLayout?.states ?? null

  const states = new Map<string, DeviceDisplayState>()
  for (const device of insights.devices) {
    const relationActive = relatedByRelation?.has(device.id) ?? false
    const focusTarget = focusTargets?.get(device.id) ?? null
    const focused = Boolean(focusTarget)
    const center = focusTarget ? lerpPoint(device.center, focusTarget.center, focusProgress) : device.center
    const rotationDeg = focusTarget
      ? interpolateRotationDeg(device.rotationDeg, focusTarget.rotationDeg, focusProgress)
      : device.rotationDeg
    const opacity = focusTargets
      ? focused
        ? 1
        : Math.max(0.12, 1 - focusProgress * 1.2)
      : relatedByRelation
        ? relationActive
          ? 1
          : 0.28
        : 1

    states.set(device.id, {
      center,
      opacity,
      rotationDeg,
    })
  }

  return {
    states,
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
    left: -pan.x / zoom,
    top: -pan.y / zoom,
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
    ;(isAxis || isMajor ? major : minor).push([x, startY, x, endY])
  }
  for (let y = startY; y <= endY; y += size) {
    const isAxis = Math.abs(y) < size / 2
    const isMajor = Math.round(y / size) % safeMajorEvery === 0
    ;(isAxis || isMajor ? major : minor).push([startX, y, endX, y])
  }

  return { minor, major, world }
}

function getCircuitBounds(insights: CircuitInsights) {
  const deviceBounds = insights.devices.map((device) => device.bounds)
  const networkPoints = insights.networkLines.flatMap((networkLine) => [networkLine.start, networkLine.end])
  const xs = [...deviceBounds.flatMap((bounds) => [bounds.x, bounds.x + bounds.width]), ...networkPoints.map((point) => point.x)]
  const ys = [...deviceBounds.flatMap((bounds) => [bounds.y, bounds.y + bounds.height]), ...networkPoints.map((point) => point.y)]

  if (!xs.length || !ys.length) {
    return { x: -240, y: -180, width: 480, height: 360 }
  }

  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  return {
    x: minX - 120,
    y: minY - 120,
    width: maxX - minX + 240,
    height: maxY - minY + 240,
  }
}

function isCanvasBackgroundTarget(targetType: string) {
  return targetType === 'Stage' || targetType === 'Layer'
}

export function MobileViewerCanvas({
  document,
  insights,
  theme,
  locale,
  selectedDeviceId,
  selectedLabelKey,
  selectedNetworkLineId,
  onSelectDevice,
  onSelectNetworkLine,
  onSelectLabel,
  onClearSelection,
}: MobileViewerCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const worldLayerRef = useRef<Konva.Layer | null>(null)
  const labelLayerRef = useRef<Konva.Layer | null>(null)
  const panRef = useRef({ x: INITIAL_OFFSET, y: INITIAL_OFFSET })
  const zoomRef = useRef(0.84)
  const focusProgressRef = useRef(0)
  const transformFrameRef = useRef(0)
  const pendingTransformRef = useRef<ViewportTransform | null>(null)
  const viewportCommitTimerRef = useRef(0)
  const panStartRef = useRef<{ pointer: Point; pan: Point } | null>(null)
  const touchPinchRef = useRef<{
    distance: number
    zoom: number
    midpointWorld: Point
  } | null>(null)
  const suppressClickRef = useRef(false)

  const [viewport, setViewport] = useState({ width: 1200, height: 760 })
  const [zoom, setZoom] = useState(0.84)
  const [pan, setPan] = useState({ x: INITIAL_OFFSET, y: INITIAL_OFFSET })
  const [focusProgress, setFocusProgress] = useState(0)
  const [isPanning, setIsPanning] = useState(false)
  const canvasTheme = useMemo(() => getCanvasTheme(theme), [theme])
  const darkCanvas = theme === 'dark'

  const t = useMemo(
    () => (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  )
  const focusLayout = useMemo(() => {
    if (selectedNetworkLineId) {
      return deriveFocusLayout(insights, { type: 'networkLine', id: selectedNetworkLineId })
    }
    if (selectedLabelKey) {
      return deriveFocusLayout(insights, { type: 'label', key: selectedLabelKey })
    }
    if (selectedDeviceId) {
      return deriveFocusLayout(insights, { type: 'device', id: selectedDeviceId })
    }
    return null
  }, [insights, selectedDeviceId, selectedLabelKey, selectedNetworkLineId])

  const commitViewportTransform = useCallback(() => {
    setZoom(zoomRef.current)
    setPan(panRef.current)
  }, [])

  const scheduleViewportCommit = useCallback(() => {
    if (viewportCommitTimerRef.current) {
      window.clearTimeout(viewportCommitTimerRef.current)
    }
    viewportCommitTimerRef.current = window.setTimeout(() => {
      viewportCommitTimerRef.current = 0
      commitViewportTransform()
    }, 90)
  }, [commitViewportTransform])

  const setViewportTransform = useCallback((nextZoom: number, nextPan: Point, commit = false) => {
    zoomRef.current = nextZoom
    panRef.current = nextPan
    pendingTransformRef.current = { zoom: nextZoom, pan: nextPan }

    if (transformFrameRef.current) {
      if (commit) {
        commitViewportTransform()
      }
      return
    }

    transformFrameRef.current = window.requestAnimationFrame(() => {
      transformFrameRef.current = 0
      const pending = pendingTransformRef.current
      pendingTransformRef.current = null
      if (!pending) {
        return
      }
      for (const layer of [worldLayerRef.current, labelLayerRef.current]) {
        layer?.position(pending.pan)
        layer?.scale({ x: pending.zoom, y: pending.zoom })
        layer?.batchDraw()
      }
      if (commit) {
        setZoom(pending.zoom)
        setPan(pending.pan)
      }
    })
  }, [commitViewportTransform])

  const animateViewportTo = useCallback(
    (targetCenter: Point, targetZoom: number, duration = 320) => {
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
        setViewportTransform(nextZoom, nextPan, progress >= 1)

        if (progress < 1) {
          frame = window.requestAnimationFrame(tick)
        }
      }

      frame = window.requestAnimationFrame(tick)
      return () => window.cancelAnimationFrame(frame)
    },
    [setViewportTransform, viewport],
  )

  useEffect(() => {
    return () => {
      if (transformFrameRef.current) {
        window.cancelAnimationFrame(transformFrameRef.current)
      }
      if (viewportCommitTimerRef.current) {
        window.clearTimeout(viewportCommitTimerRef.current)
      }
      pendingTransformRef.current = null
    }
  }, [])

  useEffect(() => {
    panRef.current = pan
  }, [pan])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    focusProgressRef.current = focusProgress
  }, [focusProgress])

  useEffect(() => {
    const element = wrapperRef.current
    if (!element) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let frame = 0
    const start = performance.now()
    const from = focusProgressRef.current
    const to = selectedDeviceId || selectedLabelKey || selectedNetworkLineId ? 1 : 0
    const duration = 280

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
  }, [selectedDeviceId, selectedLabelKey, selectedNetworkLineId])

  const fitOverview = useCallback(() => {
    const bounds = getCircuitBounds(insights)
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    }
    const zoomValue = clamp(fitZoomToBounds(bounds, viewport, 80), MIN_ZOOM, 1.02)
    return animateViewportTo(center, zoomValue, 280)
  }, [animateViewportTo, insights, viewport])

  useEffect(() => {
    if (!viewport.width || !viewport.height) {
      return
    }

    if (!focusLayout) {
      return fitOverview()
    }

    const center = {
      x: focusLayout.bounds.x + focusLayout.bounds.width / 2,
      y: focusLayout.bounds.y + focusLayout.bounds.height / 2,
    }
    const zoomValue = clamp(
      fitZoomToBounds(focusLayout.bounds, viewport, 92),
      FOCUS_MIN_ZOOM,
      FOCUS_MAX_ZOOM,
    )
    return animateViewportTo(center, zoomValue, 360)
  }, [animateViewportTo, fitOverview, focusLayout, viewport])

  const display = useMemo(
    () =>
      buildDisplayState(
        insights,
        selectedDeviceId,
        selectedDeviceId,
        selectedLabelKey,
        focusProgress,
        focusLayout,
      ),
    [focusLayout, focusProgress, insights, selectedDeviceId, selectedLabelKey],
  )

  const terminalLayoutByDeviceId = useMemo(
    () => new Map(insights.devices.map((device) => [device.id, buildDeviceTerminalLayout(device)] as const)),
    [insights.devices],
  )

  const previewDeviceBounds = useMemo(
    () =>
      insights.devices.map((device) => {
        const state = display.states.get(device.id)!
        return {
          id: device.id,
          x: state.center.x - device.bounds.width / 2,
          y: state.center.y - device.bounds.height / 2,
          width: device.bounds.width,
          height: device.bounds.height,
        }
      }),
    [display.states, insights.devices],
  )

  const terminalLabels = useMemo(() => {
    const labelScale = zoom < 1 ? 1 / zoom : 1
    const labelWidth = clampToRange(TERMINAL_LABEL_WIDTH * labelScale, TERMINAL_LABEL_WIDTH, 560)
    const labelHeight = clampToRange(TERMINAL_LABEL_HEIGHT * labelScale, TERMINAL_LABEL_HEIGHT, 58)

    return layoutTerminalLabels(
      insights.devices.flatMap((device) => {
        const state = display.states.get(device.id)
        const layout = terminalLayoutByDeviceId.get(device.id)
        if (!state || !layout) return []

        return device.terminals.flatMap((terminal) => {
          const layoutEntry = layout.get(terminal.id)
          if (!layoutEntry) return []
          const point = getWorldPointForDeviceLocalPoint(
            state.center,
            {
              width: device.bounds.width,
              height: device.bounds.height,
            },
            state.rotationDeg,
            layoutEntry.point,
          )
          const color = insights.terminalColorsById[terminal.id]
          const sameFocusedLabel =
            selectedLabelKey && terminal.connectionLabel && selectedLabelKey === terminal.connectionLabel
          const selectedTerminalDevice = selectedDeviceId === terminal.deviceId

          return [
            {
              id: terminal.id,
              anchor: point,
              side: rotateTerminalSide(layoutEntry.side, state.rotationDeg),
              text: terminal.displayLabel,
              fill: darkCanvas ? color.fill : color.text,
              fontStyle: sameFocusedLabel || selectedTerminalDevice ? 'bold' : 'normal',
              opacity: state.opacity,
              priority: sameFocusedLabel ? 2 : selectedTerminalDevice ? 1 : 0,
            } satisfies TerminalLabelCandidate,
          ]
        })
      }),
      previewDeviceBounds,
      new Map(),
      labelWidth,
      labelHeight,
    )
  }, [
    display.states,
    darkCanvas,
    insights.devices,
    insights.terminalColorsById,
    previewDeviceBounds,
    selectedDeviceId,
    selectedLabelKey,
    terminalLayoutByDeviceId,
    zoom,
  ])

  const gridSize = document.view.canvas.grid?.size ?? 36
  const majorEvery = document.view.canvas.grid?.majorEvery ?? 5
  const gridOpacity = 1 - focusProgress * 0.78
  const gridEnabled = document.view.canvas.grid?.enabled ?? true
  const showGrid = gridEnabled && !isPanning && zoom >= 0.32
  const gridPrimitives = useMemo(
    () =>
      showGrid
        ? buildInfiniteGrid(viewport, pan, zoom, Math.max(8, gridSize), Math.max(2, majorEvery))
        : { minor: [], major: [], world: getVisibleWorldBounds(viewport, pan, zoom) },
    [gridSize, majorEvery, pan, showGrid, viewport, zoom],
  )
  const reducedCanvasEffects = isPanning || viewport.width < 720 || zoom < 0.4

  const activeRelation = selectedDeviceId ? insights.deviceRelationsById[selectedDeviceId] : null
  const focusedDeviceConnectionKeys = selectedDeviceId
    ? new Set(insights.deviceById[selectedDeviceId]?.connectionLabels ?? [])
    : null
  const focusRailTerminal = selectedLabelKey
    ? insights.connectionHighlightsByKey[selectedLabelKey]?.terminalIds[0]
      ? insights.terminalColorsById[insights.connectionHighlightsByKey[selectedLabelKey]!.terminalIds[0]!]
      : null
    : null
  const networkLineLabels = useMemo(() => {
    const labelScale = zoom < 1 ? 1 / zoom : 1
    const labelWidth = clampToRange(160 * labelScale, 160, 520)
    const labelFontSize = clampToRange(16 * labelScale, 16, 52)
    return insights.networkLines.flatMap((networkLine) => {
      const firstTerminalId =
        insights.connectionHighlightsByKey[networkLine.labelKey]?.terminalIds[0] ?? null
      const color = firstTerminalId ? insights.terminalColorsById[firstTerminalId] : null
      const selected = selectedNetworkLineId === networkLine.id
      const isHorizontal = networkLine.orientation === 'horizontal'

      return [
        {
          id: networkLine.id,
          text: networkLine.label,
          x: isHorizontal ? networkLine.position.x - labelWidth / 2 : networkLine.position.x + 12,
          y: isHorizontal ? networkLine.position.y - labelFontSize * 2 : networkLine.position.y - 12,
          width: labelWidth,
          fontSize: labelFontSize,
          fill: selected ? (darkCanvas ? color?.fill : color?.text) ?? canvasTheme.labelFocused : (darkCanvas ? color?.fill : color?.text) ?? canvasTheme.labelFallback,
          fontStyle: selected ? 'bold' : 'normal',
          align: isHorizontal ? ('center' as const) : ('left' as const),
          rotation: isHorizontal ? 0 : 90,
          offsetX: isHorizontal ? 0 : labelWidth / 2,
          offsetY: isHorizontal ? 0 : 10,
        },
      ]
    })
  }, [
    insights.connectionHighlightsByKey,
    insights.networkLines,
    insights.terminalColorsById,
    canvasTheme.labelFallback,
    canvasTheme.labelFocused,
    darkCanvas,
    selectedNetworkLineId,
    zoom,
  ])

  const getPointerFromClient = useCallback((clientX: number, clientY: number) => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) {
      return null
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    }
  }, [])

  const handleWheel = (event: { evt: WheelEvent }) => {
    event.evt.preventDefault()
    const pointer = getPointerFromClient(event.evt.clientX, event.evt.clientY)
    if (!pointer) {
      return
    }

    const currentZoom = zoomRef.current
    const currentPan = panRef.current
    const nextZoom = clamp(currentZoom * (event.evt.deltaY > 0 ? 0.92 : 1.08), MIN_ZOOM, MAX_ZOOM)
    const worldPoint = {
      x: (pointer.x - currentPan.x) / currentZoom,
      y: (pointer.y - currentPan.y) / currentZoom,
    }
    const nextPan = {
      x: pointer.x - worldPoint.x * nextZoom,
      y: pointer.y - worldPoint.y * nextZoom,
    }
    setViewportTransform(nextZoom, nextPan)
    scheduleViewportCommit()
  }

  const handleStageMouseDown = (event: { evt: MouseEvent; target: { getType: () => string } }) => {
    if (event.evt.button !== 0 || !isCanvasBackgroundTarget(event.target.getType())) {
      return
    }
    panStartRef.current = {
      pointer: { x: event.evt.clientX, y: event.evt.clientY },
      pan: panRef.current,
    }
    setIsPanning(true)
  }

  const handleStageMouseMove = (event: { evt: MouseEvent }) => {
    if (!panStartRef.current) {
      return
    }
    const deltaX = event.evt.clientX - panStartRef.current.pointer.x
    const deltaY = event.evt.clientY - panStartRef.current.pointer.y
    const nextPan = {
      x: panStartRef.current.pan.x + deltaX,
      y: panStartRef.current.pan.y + deltaY,
    }
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      suppressClickRef.current = true
    }
    setViewportTransform(zoomRef.current, nextPan)
  }

  const stopPan = () => {
    panStartRef.current = null
    commitViewportTransform()
    setIsPanning(false)
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  const handleTouchStart = (event: { evt: TouchEvent; target: { getType: () => string } }) => {
    event.evt.preventDefault()
    const touches = event.evt.touches
    if (touches.length === 2) {
      const first = getPointerFromClient(touches[0]!.clientX, touches[0]!.clientY)
      const second = getPointerFromClient(touches[1]!.clientX, touches[1]!.clientY)
      if (!first || !second) {
        return
      }

      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      }
      touchPinchRef.current = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        zoom: zoomRef.current,
        midpointWorld: {
          x: (midpoint.x - panRef.current.x) / zoomRef.current,
          y: (midpoint.y - panRef.current.y) / zoomRef.current,
        },
      }
      suppressClickRef.current = true
      setIsPanning(true)
      return
    }

    if (touches.length === 1 && isCanvasBackgroundTarget(event.target.getType())) {
      panStartRef.current = {
        pointer: { x: touches[0]!.clientX, y: touches[0]!.clientY },
        pan: panRef.current,
      }
      setIsPanning(true)
    }
  }

  const handleTouchMove = (event: { evt: TouchEvent }) => {
    event.evt.preventDefault()
    const touches = event.evt.touches
    if (touches.length === 2 && touchPinchRef.current) {
      const first = getPointerFromClient(touches[0]!.clientX, touches[0]!.clientY)
      const second = getPointerFromClient(touches[1]!.clientX, touches[1]!.clientY)
      if (!first || !second) {
        return
      }

      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      }
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      const nextZoom = clamp(
        touchPinchRef.current.zoom * (distance / Math.max(touchPinchRef.current.distance, 1)),
        MIN_ZOOM,
        MAX_ZOOM,
      )
      const nextPan = {
        x: midpoint.x - touchPinchRef.current.midpointWorld.x * nextZoom,
        y: midpoint.y - touchPinchRef.current.midpointWorld.y * nextZoom,
      }
      setViewportTransform(nextZoom, nextPan)
      return
    }

    if (touches.length === 1 && panStartRef.current) {
      const deltaX = touches[0]!.clientX - panStartRef.current.pointer.x
      const deltaY = touches[0]!.clientY - panStartRef.current.pointer.y
      const nextPan = {
        x: panStartRef.current.pan.x + deltaX,
        y: panStartRef.current.pan.y + deltaY,
      }
      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        suppressClickRef.current = true
      }
      setViewportTransform(zoomRef.current, nextPan)
    }
  }

  const handleTouchEnd = () => {
    touchPinchRef.current = null
    commitViewportTransform()
    stopPan()
  }

  const handleBackgroundClick = (event: { target: { getType: () => string } }) => {
    if (suppressClickRef.current || !isCanvasBackgroundTarget(event.target.getType())) {
      return
    }
    onClearSelection()
  }

  return (
    <section className="mobile-viewer-canvas-shell">
      <div className="mobile-viewer-canvas__toolbar">
        <button className="ghost-button" onClick={() => void fitOverview()}>
          {t('viewerFit')}
        </button>
        <button className="ghost-button" onClick={() => {
          setViewportTransform(1, { x: INITIAL_OFFSET, y: INITIAL_OFFSET }, true)
        }}>
          {t('viewerReset')}
        </button>
        {(selectedDeviceId || selectedLabelKey || selectedNetworkLineId) && (
          <button className="ghost-button" onClick={onClearSelection}>
            {t('viewerBackToOverview')}
          </button>
        )}
      </div>

      <div className={`canvas-stage ${isPanning ? 'is-panning' : ''}`} ref={wrapperRef}>
        <Stage
          width={viewport.width}
          height={viewport.height}
          onWheel={handleWheel}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={stopPan}
          onMouseLeave={stopPan}
          onClick={handleBackgroundClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <Layer listening={false}>
            <Rect x={0} y={0} width={viewport.width} height={viewport.height} fill={canvasTheme.background} />
          </Layer>

          <Layer ref={worldLayerRef} x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom}>
            {gridPrimitives.minor.map((points, index) => (
              <Line
                key={`grid-minor-${index}`}
                points={points}
                stroke={`${canvasTheme.gridMinor}${0.34 * gridOpacity})`}
                strokeWidth={1}
                listening={false}
              />
            ))}
            {gridPrimitives.major.map((points, index) => (
              <Line
                key={`grid-major-${index}`}
                points={points}
                stroke={`${points[0] === points[2] && Math.abs(points[0]) < gridSize / 2 || points[1] === points[3] && Math.abs(points[1]) < gridSize / 2 ? canvasTheme.gridAxis : canvasTheme.gridMajor}${points[0] === points[2] && Math.abs(points[0]) < gridSize / 2 || points[1] === points[3] && Math.abs(points[1]) < gridSize / 2 ? 0.96 * gridOpacity : 0.5 * gridOpacity})`}
                strokeWidth={points[0] === points[2] && Math.abs(points[0]) < gridSize / 2 || points[1] === points[3] && Math.abs(points[1]) < gridSize / 2 ? 1.8 : 1.1}
                listening={false}
              />
            ))}

            <Rect
              x={gridPrimitives.world.left}
              y={gridPrimitives.world.top}
              width={gridPrimitives.world.right - gridPrimitives.world.left}
              height={gridPrimitives.world.bottom - gridPrimitives.world.top}
              fill={canvasTheme.focusOverlay}
              opacity={focusProgress * canvasTheme.focusOverlayOpacity}
              listening={false}
            />

            {insights.networkLines.map((networkLine) => {
              const firstTerminalId =
                insights.connectionHighlightsByKey[networkLine.labelKey]?.terminalIds[0] ?? null
              const color = firstTerminalId ? insights.terminalColorsById[firstTerminalId] : null
              const selected = selectedNetworkLineId === networkLine.id
              const relatedToFocusedDevice =
                focusedDeviceConnectionKeys?.has(networkLine.labelKey) ?? false
              const fadedOpacity =
                focusedDeviceConnectionKeys && !selectedLabelKey && !selectedNetworkLineId
                  ? relatedToFocusedDevice
                    ? 1 - focusProgress * 0.66
                    : 1 - focusProgress * 0.9
                  : 1
              const visibleLineWidth = Math.max(selected ? 6 : 4, (selected ? 3.2 : 2.4) / zoom)

              return (
                <Group
                  key={networkLine.id}
                  opacity={fadedOpacity}
                  onClick={(evt) => {
                    evt.cancelBubble = true
                    if (!suppressClickRef.current) {
                      onSelectNetworkLine(networkLine.id)
                    }
                  }}
                >
                  <Line
                    points={[networkLine.start.x, networkLine.start.y, networkLine.end.x, networkLine.end.y]}
                    stroke={selected ? color?.stroke ?? canvasTheme.labelFocused : color?.fill ?? canvasTheme.labelFallback}
                    strokeWidth={visibleLineWidth}
                    lineCap="round"
                    opacity={0.92}
                  />
                </Group>
              )
            })}

            {focusLayout?.rail && (
              <Group listening={false} opacity={focusProgress}>
                <Line
                  points={[focusLayout.rail.start.x, focusLayout.rail.start.y, focusLayout.rail.end.x, focusLayout.rail.end.y]}
                  stroke={focusRailTerminal?.fill ?? canvasTheme.labelFallback}
                  strokeWidth={Math.max(4, 2.4 / zoom)}
                  lineCap="round"
                  dash={[18, 12]}
                />
                <Text
                  x={focusLayout.rail.textPoint.x}
                  y={focusLayout.rail.textPoint.y}
                  width={144}
                  text={focusLayout.rail.label}
                  fill={(darkCanvas ? focusRailTerminal?.fill : focusRailTerminal?.text) ?? canvasTheme.labelFocused}
                  fontSize={Math.max(18, Math.min(56, 12 / zoom))}
                  fontStyle="bold"
                  align="center"
                />
              </Group>
            )}

            {insights.devices.map((device) => {
              const state = display.states.get(device.id)!
              const selected = selectedDeviceId === device.id
              const relationRole =
                activeRelation?.deviceId === device.id
                  ? 'anchor'
                  : activeRelation?.upstreamDeviceIds.includes(device.id)
                    ? 'upstream'
                    : activeRelation?.downstreamDeviceIds.includes(device.id)
                      ? 'downstream'
                      : null
              const focusActive = display.focusTargets?.has(device.id) ?? false
              const hasDedicatedSymbol = hasDedicatedDeviceSymbol(device.visualKind)
              const localBounds = {
                x: 0,
                y: 0,
                width: device.bounds.width,
                height: device.bounds.height,
              }
              const strokeColor = selected
                ? canvasTheme.terminalEmphasis
                : selectedLabelKey && focusActive
                  ? canvasTheme.labelFallback
                  : relationRole === 'upstream'
                    ? '#dc2626'
                    : relationRole === 'downstream'
                      ? '#16a34a'
                      : canvasTheme.deviceStroke
              const fillColor = focusActive
                ? canvasTheme.deviceSurface.focusFill
                : relationRole === 'upstream'
                  ? canvasTheme.deviceSurface.upstreamFill
                  : relationRole === 'downstream'
                    ? canvasTheme.deviceSurface.downstreamFill
                    : canvasTheme.deviceSurface.normalFill
              const surfaceTop = focusActive ? canvasTheme.deviceSurface.focusTop : canvasTheme.deviceSurface.normalTop
              const surfaceBottom = focusActive ? canvasTheme.deviceSurface.focusBottom : canvasTheme.deviceSurface.normalBottom
              const shadowColor = selected
                ? canvasTheme.shadowNeutral
                : relationRole === 'upstream'
                  ? canvasTheme.shadowUpstream
                  : relationRole === 'downstream'
                    ? canvasTheme.shadowDownstream
                    : canvasTheme.shadowNeutral
              const terminalLayout = terminalLayoutByDeviceId.get(device.id) ?? new Map()
              const symbolAccent = getDeviceSymbolAccent(device.visualKind)

              return (
                <Group
                  key={device.id}
                  opacity={state.opacity}
                  x={state.center.x}
                  y={state.center.y}
                  offsetX={localBounds.width / 2}
                  offsetY={localBounds.height / 2}
                  rotation={state.rotationDeg}
                  onClick={(evt) => {
                    evt.cancelBubble = true
                    if (!suppressClickRef.current) {
                      onSelectDevice(device.id)
                    }
                  }}
                >
                  {!hasDedicatedSymbol && device.shape === 'rectangle' && (
                    <Rect
                      width={localBounds.width}
                      height={localBounds.height}
                      cornerRadius={8}
                      fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                      fillLinearGradientEndPoint={{ x: 0, y: localBounds.height }}
                      fillLinearGradientColorStops={[0, surfaceTop, 0.55, fillColor, 1, surfaceBottom]}
                        stroke={strokeColor}
                      strokeWidth={selected || focusActive ? 3.2 : 2}
                      shadowBlur={reducedCanvasEffects ? 0 : selected || focusActive ? 24 : 14}
                      shadowOffsetX={0}
                      shadowOffsetY={reducedCanvasEffects ? 0 : selected || focusActive ? 12 : 8}
                      shadowColor={shadowColor}
                      shadowOpacity={reducedCanvasEffects ? 0 : 0.95}
                    />
                  )}
                  {!hasDedicatedSymbol && device.shape === 'circle' && (
                    <Circle
                      x={localBounds.width / 2}
                      y={localBounds.height / 2}
                      radius={Math.min(localBounds.width, localBounds.height) / 2}
                      fillLinearGradientStartPoint={{ x: localBounds.width / 2, y: 0 }}
                      fillLinearGradientEndPoint={{ x: localBounds.width / 2, y: localBounds.height }}
                      fillLinearGradientColorStops={[0, surfaceTop, 0.55, fillColor, 1, surfaceBottom]}
                        stroke={strokeColor}
                      strokeWidth={selected || focusActive ? 3.2 : 2}
                      shadowBlur={reducedCanvasEffects ? 0 : selected || focusActive ? 24 : 14}
                      shadowOffsetY={reducedCanvasEffects ? 0 : selected || focusActive ? 12 : 8}
                      shadowColor={shadowColor}
                    />
                  )}
                  {!hasDedicatedSymbol && device.shape === 'triangle' && (
                    <Line
                      points={getShapePathPoints(localBounds, device.shape)}
                      closed
                      fillLinearGradientStartPoint={{ x: localBounds.width / 2, y: 0 }}
                      fillLinearGradientEndPoint={{ x: localBounds.width / 2, y: localBounds.height }}
                      fillLinearGradientColorStops={[0, surfaceTop, 0.55, fillColor, 1, surfaceBottom]}
                        stroke={strokeColor}
                      strokeWidth={selected || focusActive ? 3.2 : 2}
                      lineJoin="round"
                      shadowBlur={reducedCanvasEffects ? 0 : selected || focusActive ? 24 : 14}
                      shadowOffsetY={reducedCanvasEffects ? 0 : selected || focusActive ? 12 : 8}
                      shadowColor={shadowColor}
                    />
                  )}

                  {hasDedicatedSymbol && (
                    <>
                      {(selected || focusActive || relationRole) && (
                        <Rect
                          x={10}
                          y={8}
                          width={localBounds.width - 20}
                          height={localBounds.height - 16}
                          cornerRadius={18}
                        stroke={strokeColor}
                          strokeWidth={selected ? 2.2 : 1.6}
                          dash={selected ? undefined : [16, 12]}
                          fillEnabled={false}
                          shadowBlur={reducedCanvasEffects ? 0 : 18}
                          shadowOffsetY={reducedCanvasEffects ? 0 : 8}
                          shadowColor={shadowColor}
                          shadowOpacity={reducedCanvasEffects ? 0 : 0.46}
                          listening={false}
                        />
                      )}
                      <DeviceSymbolGlyph
                        visualKind={device.visualKind}
                        width={localBounds.width}
                        height={localBounds.height}
                        stroke={canvasTheme.symbolStroke}
                        accent={symbolAccent}
                      />
                    </>
                  )}

                  <Text
                    x={hasDedicatedSymbol ? 14 : 18}
                    y={hasDedicatedSymbol ? 10 : 16}
                    width={localBounds.width - (hasDedicatedSymbol ? 28 : 36)}
                    text={device.reference}
                    fill={canvasTheme.referenceText}
                    fontSize={hasDedicatedSymbol ? 13 : 12}
                    fontStyle="bold"
                    align={hasDedicatedSymbol ? 'center' : 'left'}
                  />
                  <Text
                    x={hasDedicatedSymbol ? 20 : 18}
                    y={hasDedicatedSymbol ? localBounds.height - (device.parameterSummary ? 40 : 28) : device.parameterSummary ? localBounds.height / 2 - 28 : localBounds.height / 2 - 14}
                    width={localBounds.width - (hasDedicatedSymbol ? 40 : 36)}
                    height={hasDedicatedSymbol ? 20 : 28}
                    text={device.source.name}
                    fill={canvasTheme.deviceText}
                    fontSize={hasDedicatedSymbol ? 13 : 18}
                    fontStyle="bold"
                    align="center"
                    verticalAlign="middle"
                    wrap="none"
                    ellipsis
                  />
                  {device.parameterSummary && (
                    <Text
                      x={hasDedicatedSymbol ? 20 : 18}
                      y={hasDedicatedSymbol ? localBounds.height - 21 : localBounds.height / 2 + 2}
                      width={localBounds.width - (hasDedicatedSymbol ? 40 : 36)}
                      height={hasDedicatedSymbol ? 16 : 24}
                      text={device.parameterSummary}
                      fill={canvasTheme.deviceMutedText}
                      fontSize={hasDedicatedSymbol ? 12 : 14}
                      fontStyle="bold"
                      align="center"
                      verticalAlign="middle"
                      wrap="none"
                      ellipsis
                    />
                  )}

                  {device.terminals.map((terminal) => {
                    const layoutEntry = terminalLayout.get(terminal.id)
                    if (!layoutEntry) {
                      return null
                    }

                    const color = insights.terminalColorsById[terminal.id]
                    const sameFocusedLabel =
                      selectedLabelKey && terminal.connectionLabel && selectedLabelKey === terminal.connectionLabel
                    const roleStroke = getTerminalRoleStroke(getTerminalFlowDirection(terminal.source), canvasTheme.terminalEmphasis)
                    const baseRadius = sameFocusedLabel ? 8 : 6
                    const terminalRadius = Math.max(baseRadius, Math.min(15, 3.6 / zoom))

                    return (
                      <Group
                        key={terminal.id}
                        x={layoutEntry.point.x}
                        y={layoutEntry.point.y}
                        onClick={(evt) => {
                          evt.cancelBubble = true
                          if (terminal.connectionLabel && !suppressClickRef.current) {
                            onSelectLabel(terminal.connectionLabel)
                          }
                        }}
                      >
                        {sameFocusedLabel && (
                          <Circle
                            x={0}
                            y={0}
                            radius={terminalRadius + 2}
                            fillEnabled={false}
                            stroke={canvasTheme.labelFallback}
                            strokeWidth={2.2}
                          />
                        )}
                        {roleStroke.outerStroke && (
                          <Circle
                            x={0}
                            y={0}
                            radius={terminalRadius + roleStroke.outerStroke.radiusOffset}
                            fillEnabled={false}
                            stroke={roleStroke.outerStroke.color}
                            strokeWidth={roleStroke.outerStroke.width}
                          />
                        )}
                        <Circle
                          x={0}
                          y={0}
                          radius={terminalRadius}
                          fill={color.fill}
                          stroke={roleStroke.baseStroke}
                          strokeWidth={roleStroke.baseStrokeWidth}
                          shadowBlur={reducedCanvasEffects ? 0 : 12}
                          shadowColor={color.glow}
                        />
                      </Group>
                    )
                  })}
                </Group>
              )
            })}
          </Layer>

          <Layer ref={labelLayerRef} x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom} listening={false}>
            {networkLineLabels.map((label) => (
              <Text
                key={`network-line-label-${label.id}`}
                x={label.x}
                y={label.y}
                width={label.width}
                text={label.text}
                fill={label.fill}
                fontSize={label.fontSize}
                fontStyle={label.fontStyle}
                align={label.align}
                rotation={label.rotation}
                offsetX={label.offsetX}
                offsetY={label.offsetY}
              />
            ))}
            {terminalLabels.map((label) => (
              <Group key={`terminal-label-${label.id}`} opacity={label.opacity}>
                <Line
                  points={label.leaderPoints}
                  stroke={label.fill}
                  strokeWidth={Math.max(1, 0.8 / zoom)}
                  lineCap="round"
                  opacity={0.42}
                />
                <Text
                  x={label.x}
                  y={label.y}
                  width={label.width}
                  height={label.height}
                  text={label.text}
                  fill={label.fill}
                  fontSize={clampToRange(12 / zoom, 12, 52)}
                  fontStyle={label.fontStyle}
                  align={label.align}
                  wrap="none"
                  ellipsis
                />
              </Group>
            ))}
          </Layer>
        </Stage>
      </div>
    </section>
  )
}
