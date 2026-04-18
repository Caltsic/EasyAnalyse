import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { DeviceSymbolGlyph } from './DeviceSymbolGlyph'
import { deriveCircuitInsights } from '../lib/circuitDescription'
import { hasDedicatedDeviceSymbol, type DeviceVisualKind } from '../lib/deviceSymbols'
import { deriveFocusLayout } from '../lib/focusLayout'
import { isFlexibleDirection, isSinkLikeDirection, isSourceLikeDirection } from '../lib/document'
import {
  clamp,
  fitZoomToBounds,
  getStoredTerminalAnchor,
  getShapePathPoints,
  getSignalPoint,
  projectPointToShapeEdge,
  getViewportPanForCenter,
  lerpPoint,
} from '../lib/geometry'
import { translate } from '../lib/i18n'
import { useEditorStore } from '../store/editorStore'
import type { Point, TerminalDefinition, TerminalDirection, TerminalSide } from '../types/document'

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

interface SelectionBoxState {
  start: Point
  current: Point
}

interface TerminalLayoutEntry {
  point: Point
  side: TerminalSide
}

interface DragSelectionPreview {
  leaderId: string
  delta: Point
}

interface TerminalDragPreview {
  deviceId: string
  terminalId: string
  point: Point
  side: Exclude<TerminalSide, 'auto'>
}

interface BoundsLike {
  x: number
  y: number
  width: number
  height: number
}

interface TerminalLabelCandidate {
  id: string
  deviceId: string
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

const GHOST_DEVICE_SIZE = {
  width: 220,
  height: 136,
}

const TERMINAL_LABEL_WIDTH = 172
const TERMINAL_LABEL_HEIGHT = 18

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

function terminalLabelProps(
  point: Point,
  side: TerminalSide,
  depthOffset = 0,
  tangentOffset = 0,
) {
  switch (side) {
    case 'left':
      return {
        x: point.x - (TERMINAL_LABEL_WIDTH + 18 + depthOffset),
        y: point.y - 9 + tangentOffset,
        width: TERMINAL_LABEL_WIDTH,
        height: TERMINAL_LABEL_HEIGHT,
        align: 'right' as const,
      }
    case 'right':
      return {
        x: point.x + 18 + depthOffset,
        y: point.y - 9 + tangentOffset,
        width: TERMINAL_LABEL_WIDTH,
        height: TERMINAL_LABEL_HEIGHT,
        align: 'left' as const,
      }
    case 'top':
      return {
        x: point.x - TERMINAL_LABEL_WIDTH / 2 + tangentOffset,
        y: point.y - (34 + depthOffset),
        width: TERMINAL_LABEL_WIDTH,
        height: TERMINAL_LABEL_HEIGHT,
        align: 'center' as const,
      }
    case 'bottom':
    case 'auto':
    default:
      return {
        x: point.x - TERMINAL_LABEL_WIDTH / 2 + tangentOffset,
        y: point.y + 16 + depthOffset,
        width: TERMINAL_LABEL_WIDTH,
        height: TERMINAL_LABEL_HEIGHT,
        align: 'center' as const,
      }
  }
}

function normalizeSelectionBox(box: SelectionBoxState) {
  const left = Math.min(box.start.x, box.current.x)
  const top = Math.min(box.start.y, box.current.y)
  const right = Math.max(box.start.x, box.current.x)
  const bottom = Math.max(box.start.y, box.current.y)

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function intersectsBounds(
  bounds: { x: number; y: number; width: number; height: number },
  selectionBounds: { x: number; y: number; width: number; height: number },
) {
  return !(
    bounds.x + bounds.width < selectionBounds.x ||
    selectionBounds.x + selectionBounds.width < bounds.x ||
    bounds.y + bounds.height < selectionBounds.y ||
    selectionBounds.y + selectionBounds.height < bounds.y
  )
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
  if (visualKind === 'led') {
    return '#EA580C'
  }
  if (
    visualKind === 'diode' ||
    visualKind === 'flyback-diode' ||
    visualKind === 'rectifier-diode' ||
    visualKind === 'zener-diode' ||
    visualKind === 'tvs-diode'
  ) {
    return '#475569'
  }
  if (
    visualKind === 'npn-transistor' ||
    visualKind === 'pnp-transistor' ||
    visualKind === 'nmos' ||
    visualKind === 'pmos'
  ) {
    return '#0F766E'
  }
  if (visualKind === 'crystal') {
    return '#4F46E5'
  }
  if (visualKind === 'op-amp') {
    return '#2563EB'
  }
  return '#64748B'
}

function buildLabelLeaderPoints(
  anchor: Point,
  rect: BoundsLike,
  side: TerminalSide,
) {
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
    case 'top':
    case 'bottom':
    case 'auto':
    default:
      return previousCenter?.x ?? label.anchor.x
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

function isCanvasBackgroundTarget(target: Konva.Node) {
  const type = target.getType()
  return type === 'Stage' || type === 'Layer'
}

function buildDeviceTerminalLayout(device: {
  shape: 'rectangle' | 'circle' | 'triangle'
  visualKind: DeviceVisualKind
  bounds: { width: number; height: number }
  terminals: Array<{
    id: string
    side: TerminalSide
    name: string
    source: Pick<TerminalDefinition, 'order' | 'extensions'>
  }>
}) {
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
            point: getSignalPoint(localBounds, device.shape, terminal.side, order, bucket.length, device.visualKind),
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
) {
  const occupied: BoundsLike[] = []
  const depthOffsets = [0, 18, 36, 54, 72, 96]
  const tangentOffsets = [0, -18, 18, -36, 36, -54, 54, -72, 72]

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
            ...terminalLabelProps(label.anchor, label.side, depthOffset, tangentOffset),
          },
        })),
      )

      const choosePlacement = (allowDeviceOverlap: boolean) => {
        const validCandidates = candidates
          .filter((candidate) => {
            const box = getLabelPlacementBounds(candidate.placement)
            if (occupied.some((item) => boundsOverlap(box, item, 6))) {
              return false
            }
            if (!allowDeviceOverlap && deviceBounds.some((item) => boundsOverlap(box, item, 10))) {
              return false
            }
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
        terminalLabelProps(label.anchor, label.side)

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

function getTerminalInsertIndex(
  side: Exclude<TerminalSide, 'auto'>,
  point: Point,
  bounds: { width: number; height: number },
  siblingCount: number,
) {
  if (siblingCount <= 0) {
    return 0
  }

  const ratio =
    side === 'left' || side === 'right'
      ? clamp(point.y / Math.max(bounds.height, 1), 0, 1)
      : clamp(point.x / Math.max(bounds.width, 1), 0, 1)

  return Math.max(0, Math.min(siblingCount, Math.round(ratio * siblingCount)))
}

function getTerminalRoleStroke(direction: TerminalDirection) {
  if (isSourceLikeDirection(direction)) {
    return {
      baseStroke: '#111827',
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
        : Math.max(0, 1 - focusProgress * 1.2)
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
  const [pointerWorld, setPointerWorld] = useState<Point | null>(null)
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null)
  const [dragSelectionPreview, setDragSelectionPreview] = useState<DragSelectionPreview | null>(null)
  const [terminalDragPreview, setTerminalDragPreview] = useState<TerminalDragPreview | null>(null)
  const terminalLabelPlacementRef = useRef<Map<string, BoundsLike>>(new Map())
  const panStartRef = useRef<{ pointer: Point; pan: Point } | null>(null)
  const selectionBoxRef = useRef<SelectionBoxState | null>(null)
  const suppressClickRef = useRef(false)

  const document = useEditorStore((state) => state.document)
  const selection = useEditorStore((state) => state.selection)
  const locale = useEditorStore((state) => state.locale)
  const pendingDeviceShape = useEditorStore((state) => state.pendingDeviceShape)
  const pendingDeviceTemplateKey = useEditorStore((state) => state.pendingDeviceTemplateKey)
  const focusedDeviceId = useEditorStore((state) => state.focusedDeviceId)
  const focusedLabelKey = useEditorStore((state) => state.focusedLabelKey)
  const focusedNetworkLineId = useEditorStore((state) => state.focusedNetworkLineId)
  const viewportAnimationTarget = useEditorStore((state) => state.viewportAnimationTarget)
  const moveDevice = useEditorStore((state) => state.moveDevice)
  const moveDevices = useEditorStore((state) => state.moveDevices)
  const repositionTerminal = useEditorStore((state) => state.repositionTerminal)
  const updateNetworkLine = useEditorStore((state) => state.updateNetworkLine)
  const setSelection = useEditorStore((state) => state.setSelection)
  const setDeviceGroupSelection = useEditorStore((state) => state.setDeviceGroupSelection)
  const placePendingDevice = useEditorStore((state) => state.placePendingDevice)
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
  const selectedDeviceIds = useMemo(() => {
    if (selection?.entityType === 'device') {
      return [selection.id]
    }

    if (selection?.entityType === 'deviceGroup') {
      return selection.ids
    }

    if (selection?.entityType === 'terminal') {
      const deviceId = insights.terminalById[selection.id]?.deviceId
      return deviceId ? [deviceId] : []
    }

    return []
  }, [insights.terminalById, selection])
  const selectedDeviceSet = useMemo(() => new Set(selectedDeviceIds), [selectedDeviceIds])
  const selectedDeviceId = selectedDeviceIds.length === 1 ? selectedDeviceIds[0]! : null
  const selectedConnectionKey =
    selection?.entityType === 'terminal'
      ? insights.terminalById[selection.id]?.connectionLabel ?? null
      : null
  const selectedNetworkLineId =
    selection?.entityType === 'networkLine'
      ? selection.id
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
  const activeDragSelectionPreview =
    selection?.entityType === 'deviceGroup' ? dragSelectionPreview : null

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
  const terminalLayoutByDeviceId = useMemo(
    () =>
      new Map(
        insights.devices.map((device) => [device.id, buildDeviceTerminalLayout(device)] as const),
      ),
    [insights.devices],
  )
  const previewDeviceBounds = useMemo(
    () =>
      insights.devices.map((device) => {
        const state = display.states.get(device.id)
        const previewDelta =
          selection?.entityType === 'deviceGroup' &&
          activeDragSelectionPreview &&
          selectedDeviceSet.has(device.id)
            ? activeDragSelectionPreview.delta
            : null
        const center = state
          ? {
              x: state.center.x + (previewDelta?.x ?? 0),
              y: state.center.y + (previewDelta?.y ?? 0),
            }
          : device.center

        return {
          id: device.id,
          x: center.x - device.bounds.width / 2,
          y: center.y - device.bounds.height / 2,
          width: device.bounds.width,
          height: device.bounds.height,
        }
      }),
    [
      display.states,
      activeDragSelectionPreview,
      insights.devices,
      selectedDeviceSet,
      selection,
    ],
  )
  const terminalLabels = useMemo(
    () => {
      // eslint-disable-next-line react-hooks/refs
      const previousTerminalLabelPlacements = terminalLabelPlacementRef.current
      const candidates = insights.devices.flatMap((device) => {
        const state = display.states.get(device.id)
        const layout = terminalLayoutByDeviceId.get(device.id)
        if (!state || !layout) {
          return []
        }

        return device.terminals.flatMap((terminal) => {
          const layoutEntry = layout.get(terminal.id)
          if (!layoutEntry) {
            return []
          }

          const previewDelta =
            selection?.entityType === 'deviceGroup' &&
            activeDragSelectionPreview &&
            selectedDeviceSet.has(device.id)
              ? activeDragSelectionPreview.delta
              : null
          const previewTerminalPoint =
            terminalDragPreview?.terminalId === terminal.id &&
            terminalDragPreview.deviceId === device.id
              ? terminalDragPreview.point
              : layoutEntry.point
          const previewTerminalSide =
            terminalDragPreview?.terminalId === terminal.id &&
            terminalDragPreview.deviceId === device.id
              ? terminalDragPreview.side
              : layoutEntry.side
          const point = getWorldPointForDeviceLocalPoint(
            {
              x: state.center.x + (previewDelta?.x ?? 0),
              y: state.center.y + (previewDelta?.y ?? 0),
            },
            {
              width: device.bounds.width,
              height: device.bounds.height,
            },
            state.rotationDeg,
            previewTerminalPoint,
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
          const fontStyle: TerminalLabelCandidate['fontStyle'] =
            selectedTerminal || sameConnection || sameFocusedLabel ? 'bold' : 'normal'

          return [
            {
              id: terminal.id,
              deviceId: device.id,
              anchor: point,
              side: rotateTerminalSide(previewTerminalSide, state.rotationDeg),
              text: terminal.displayLabel,
              fill: color.text,
              fontStyle,
              opacity: state.opacity,
              priority: selectedTerminal ? 2 : sameConnection || sameFocusedLabel ? 1 : 0,
            },
          ]
        })
      })

      return layoutTerminalLabels(
        candidates,
        previewDeviceBounds.map((item) => ({
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        })),
        previousTerminalLabelPlacements,
      )
    },
    [
      display.states,
      activeDragSelectionPreview,
      focusedLabelKey,
      insights.devices,
      insights.terminalColorsById,
      previewDeviceBounds,
      selectedConnectionKey,
      selectedDeviceSet,
      selection,
      terminalDragPreview,
      terminalLayoutByDeviceId,
    ],
  )

  useEffect(() => {
    terminalLabelPlacementRef.current = new Map(
      terminalLabels.map((label) => [label.id, getLabelPlacementBounds(label)] as const),
    )
  }, [terminalLabels])

  const gridSize = document.view.canvas.grid?.size ?? 36
  const majorEvery = document.view.canvas.grid?.majorEvery ?? 5
  const gridPrimitives = useMemo(
    () =>
      document.view.canvas.grid?.enabled
        ? buildInfiniteGrid(viewport, pan, zoom, Math.max(8, gridSize), Math.max(2, majorEvery))
        : { minor: [], major: [], world: getVisibleWorldBounds(viewport, pan, zoom) },
    [document.view.canvas.grid?.enabled, gridSize, majorEvery, pan, viewport, zoom],
  )

  const getWorldPointFromMouseEvent = useCallback((event: MouseEvent) => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) {
      return null
    }

    return {
      x: (event.clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (event.clientY - rect.top - panRef.current.y) / zoomRef.current,
    }
  }, [])

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

  const handleStageMouseDown = (event: { evt: MouseEvent; target: Konva.Node }) => {
    const worldPoint = getWorldPointFromMouseEvent(event.evt)
    if (worldPoint) {
      setPointerWorld(worldPoint)
    }

    if (event.evt.button === 1) {
      panStartRef.current = {
        pointer: { x: event.evt.clientX, y: event.evt.clientY },
        pan,
      }
      setIsPanning(true)
      return
    }

    if (event.evt.button !== 0 || pendingDeviceShape || focusProgress >= 0.05) {
      return
    }

    if (!isCanvasBackgroundTarget(event.target) || !worldPoint) {
      return
    }

    const nextSelectionBox = {
      start: worldPoint,
      current: worldPoint,
    }
    selectionBoxRef.current = nextSelectionBox
    setSelectionBox(nextSelectionBox)
  }

  const handleStageMouseMove = (event: { evt: MouseEvent }) => {
    const worldPoint = getWorldPointFromMouseEvent(event.evt)
    if (worldPoint) {
      setPointerWorld(worldPoint)
    }

    if (panStartRef.current) {
      const deltaX = event.evt.clientX - panStartRef.current.pointer.x
      const deltaY = event.evt.clientY - panStartRef.current.pointer.y
      const nextPan = {
        x: panStartRef.current.pan.x + deltaX,
        y: panStartRef.current.pan.y + deltaY,
      }
      panRef.current = nextPan
      setPan(nextPan)
      return
    }

    if (!selectionBoxRef.current || !worldPoint) {
      return
    }

    const nextSelectionBox = {
      start: selectionBoxRef.current.start,
      current: worldPoint,
    }
    selectionBoxRef.current = nextSelectionBox
    setSelectionBox(nextSelectionBox)
  }

  const handleStageMouseUp = () => {
    stopPan()

    const currentSelectionBox = selectionBoxRef.current
    if (!currentSelectionBox) {
      return
    }

    selectionBoxRef.current = null
    setSelectionBox(null)

    const normalized = normalizeSelectionBox(currentSelectionBox)
    const minimumWorldDrag = 10 / Math.max(zoomRef.current, 0.1)
    if (normalized.width < minimumWorldDrag && normalized.height < minimumWorldDrag) {
      return
    }

    const ids = insights.devices
      .filter((device) => intersectsBounds(device.bounds, normalized))
      .map((device) => device.id)
    setDeviceGroupSelection(ids)
    clearFocus()
    suppressClicksAfterDrag()
  }

  const handleStageMouseLeave = () => {
    stopPan()
    selectionBoxRef.current = null
    setSelectionBox(null)
  }

  const handleStageClick = (event: { evt: MouseEvent; target: Konva.Node }) => {
    if (suppressClickRef.current) {
      return
    }

    const worldPoint = getWorldPointFromMouseEvent(event.evt)
    if (worldPoint) {
      setPointerWorld(worldPoint)
    }

    if (!isCanvasBackgroundTarget(event.target)) {
      return
    }

    if (pendingDeviceShape && worldPoint) {
      placePendingDevice({
        x: worldPoint.x - GHOST_DEVICE_SIZE.width / 2,
        y: worldPoint.y - GHOST_DEVICE_SIZE.height / 2,
      })
      clearFocus()
      return
    }

    setSelection({ entityType: 'document' })
    clearFocus()
  }

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
  const focusedDeviceConnectionKeys = focusedDeviceId
    ? new Set(insights.deviceById[focusedDeviceId]?.connectionLabels ?? [])
    : null
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
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onMouseLeave={handleStageMouseLeave}
          onClick={handleStageClick}
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
                listening={false}
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
                  listening={false}
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
              listening={false}
            />

            <Circle x={0} y={0} radius={7} fill="#0f172a" opacity={0.08 * gridOpacity} listening={false} />
            <Circle x={0} y={0} radius={3.4} fill="#0f172a" opacity={gridOpacity} listening={false} />
            <Text
              x={10}
              y={10}
              text="0,0"
              fill={`rgba(100, 116, 139, ${gridOpacity})`}
              fontSize={12}
              listening={false}
            />

            {pendingDeviceShape && pointerWorld && (
              <Group
                listening={false}
                x={pointerWorld.x}
                y={pointerWorld.y}
                offsetX={GHOST_DEVICE_SIZE.width / 2}
                offsetY={GHOST_DEVICE_SIZE.height / 2}
                opacity={0.72}
              >
                {(!pendingDeviceTemplateKey || !hasDedicatedDeviceSymbol(pendingDeviceTemplateKey)) &&
                  pendingDeviceShape === 'rectangle' && (
                  <Rect
                    width={GHOST_DEVICE_SIZE.width}
                    height={GHOST_DEVICE_SIZE.height}
                    cornerRadius={8}
                    fill="rgba(219, 234, 254, 0.46)"
                    stroke="#2563eb"
                    strokeWidth={2.2}
                    dash={[14, 10]}
                    shadowBlur={16}
                    shadowColor="rgba(37, 99, 235, 0.26)"
                  />
                )}
                {(!pendingDeviceTemplateKey || !hasDedicatedDeviceSymbol(pendingDeviceTemplateKey)) &&
                  pendingDeviceShape === 'circle' && (
                  <Circle
                    x={GHOST_DEVICE_SIZE.width / 2}
                    y={GHOST_DEVICE_SIZE.height / 2}
                    radius={Math.min(GHOST_DEVICE_SIZE.width, GHOST_DEVICE_SIZE.height) / 2}
                    fill="rgba(219, 234, 254, 0.46)"
                    stroke="#2563eb"
                    strokeWidth={2.2}
                    dash={[14, 10]}
                    shadowBlur={16}
                    shadowColor="rgba(37, 99, 235, 0.26)"
                  />
                )}
                {(!pendingDeviceTemplateKey || !hasDedicatedDeviceSymbol(pendingDeviceTemplateKey)) &&
                  pendingDeviceShape === 'triangle' && (
                  <Line
                    points={getShapePathPoints(
                      {
                        x: 0,
                        y: 0,
                        width: GHOST_DEVICE_SIZE.width,
                        height: GHOST_DEVICE_SIZE.height,
                      },
                      pendingDeviceShape,
                    )}
                    closed
                    fill="rgba(219, 234, 254, 0.46)"
                    stroke="#2563eb"
                    strokeWidth={2.2}
                    dash={[14, 10]}
                    lineJoin="round"
                    shadowBlur={16}
                    shadowColor="rgba(37, 99, 235, 0.26)"
                  />
                )}
                {pendingDeviceTemplateKey && hasDedicatedDeviceSymbol(pendingDeviceTemplateKey) && (
                  <Group opacity={0.86}>
                    <DeviceSymbolGlyph
                      visualKind={pendingDeviceTemplateKey}
                      width={GHOST_DEVICE_SIZE.width}
                      height={GHOST_DEVICE_SIZE.height}
                      stroke="#1d4ed8"
                      accent={getDeviceSymbolAccent(pendingDeviceTemplateKey)}
                    />
                  </Group>
                )}
              </Group>
            )}

            {insights.networkLines.map((networkLine) => {
              const firstTerminalId =
                insights.connectionHighlightsByKey[networkLine.labelKey]?.terminalIds[0] ?? null
              const color = firstTerminalId
                ? insights.terminalColorsById[firstTerminalId]
                : null
              const selected = selectedNetworkLineId === networkLine.id
              const focused = focusedNetworkLineId === networkLine.id
              const relatedToFocusedDevice =
                focusedDeviceConnectionKeys?.has(networkLine.labelKey) ?? false
              const fadedOpacity =
                focusedDeviceConnectionKeys && !focusedLabelKey && !focusedNetworkLineId
                  ? relatedToFocusedDevice
                    ? 1 - focusProgress * 0.66
                    : 1 - focusProgress * 0.9
                  : 1

              return (
                <Group
                  key={networkLine.id}
                  x={0}
                  y={0}
                  opacity={fadedOpacity}
                  draggable={focusProgress < 0.05 && !pendingDeviceShape}
                  onClick={(evt) => {
                    if (pendingDeviceShape) {
                      return
                    }
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
                    if (pendingDeviceShape) {
                      return
                    }
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
              const selected = selectedDeviceSet.has(device.id)
              const groupedSelection =
                selection?.entityType === 'deviceGroup' && selectedDeviceSet.has(device.id)
              const relationRole =
                activeRelation?.deviceId === device.id
                  ? 'anchor'
                  : activeRelation?.upstreamDeviceIds.includes(device.id)
                    ? 'upstream'
                    : activeRelation?.downstreamDeviceIds.includes(device.id)
                      ? 'downstream'
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
                ? '#eaf2ff'
                : relationRole === 'upstream'
                  ? '#fde8e8'
                  : relationRole === 'downstream'
                    ? '#e4f5e8'
                    : connectionActive
                      ? '#e3eeff'
                      : '#e7edf5'
              const surfaceTop = focusAnchor
                ? '#f8fbff'
                : focusedLabelKey && focusActive
                  ? '#f4f8ff'
                  : relationRole === 'upstream'
                    ? '#fff7f7'
                    : relationRole === 'downstream'
                      ? '#f4fff6'
                      : connectionActive
                        ? '#f3f8ff'
                        : '#f6f9fc'
              const surfaceBottom = focusAnchor
                ? '#d8e5fb'
                : focusedLabelKey && focusActive
                  ? '#dce9ff'
                  : relationRole === 'upstream'
                    ? '#f7cfd1'
                    : relationRole === 'downstream'
                      ? '#cfe6d6'
                      : connectionActive
                        ? '#cfdfff'
                        : '#d6dee9'
              const baseStrokeWidth = focusAnchor
                ? 1.33
                : focusActive
                  ? 4
                  : selected || relationRole || connectionActive
                    ? 3
                    : 2
              const shadowColor = focusAnchor
                ? 'rgba(15, 23, 42, 0.22)'
                : focusedLabelKey && focusActive
                  ? 'rgba(37, 99, 235, 0.24)'
                  : relationRole === 'upstream'
                    ? 'rgba(185, 28, 28, 0.16)'
                    : relationRole === 'downstream'
                      ? 'rgba(21, 128, 61, 0.16)'
                      : connectionActive
                        ? 'rgba(37, 99, 235, 0.18)'
                        : 'rgba(15, 23, 42, 0.16)'
              const shadowBlur = focusActive ? 26 : selected || relationRole || connectionActive ? 20 : 16
              const shadowOffsetY = focusActive ? 15 : selected || relationRole || connectionActive ? 11 : 9
              const hasDedicatedSymbol = hasDedicatedDeviceSymbol(device.visualKind)
              const showStandaloneHalo =
                hasDedicatedSymbol &&
                (focusAnchor || focusActive || selected || Boolean(relationRole) || connectionActive)
              const symbolAccent = getDeviceSymbolAccent(device.visualKind)
              const terminalLayout = terminalLayoutByDeviceId.get(device.id) ?? new Map()
              const previewDelta =
                groupedSelection &&
                activeDragSelectionPreview &&
                activeDragSelectionPreview.leaderId !== device.id
                  ? activeDragSelectionPreview.delta
                  : null

              return (
                <Group
                  key={device.id}
                  opacity={state.opacity}
                  draggable={focusProgress < 0.05 && !pendingDeviceShape}
                  onClick={(evt) => {
                    if (pendingDeviceShape) {
                      return
                    }
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
                    if (pendingDeviceShape || selection?.entityType === 'deviceGroup') {
                      return
                    }
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
                    if (groupedSelection && selectedDeviceSet.size > 1) {
                      setDragSelectionPreview({
                        leaderId: device.id,
                        delta: { x: 0, y: 0 },
                      })
                    }
                    if (!selected) {
                      setSelection({ entityType: 'device', id: device.id })
                    }
                  }}
                  onDragMove={(evt) => {
                    if (groupedSelection && selectedDeviceSet.size > 1) {
                      setDragSelectionPreview({
                        leaderId: device.id,
                        delta: {
                          x: evt.target.x() - state.center.x,
                          y: evt.target.y() - state.center.y,
                        },
                      })
                    }
                  }}
                  onDragEnd={(evt) => {
                    const nextPosition = {
                      x: evt.target.x() - localBounds.width / 2,
                      y: evt.target.y() - localBounds.height / 2,
                    }
                    if (groupedSelection && selectedDeviceSet.size > 1) {
                      moveDevices([...selectedDeviceSet], {
                        x: nextPosition.x - device.bounds.x,
                        y: nextPosition.y - device.bounds.y,
                      })
                    } else {
                      moveDevice(device.id, nextPosition)
                    }
                    setDragSelectionPreview(null)
                    suppressClicksAfterDrag()
                  }}
                  x={state.center.x + (previewDelta?.x ?? 0)}
                  y={state.center.y + (previewDelta?.y ?? 0)}
                  offsetX={localBounds.width / 2}
                  offsetY={localBounds.height / 2}
                  rotation={state.rotationDeg}
                >
                  {hasDedicatedSymbol && (
                    <Rect
                      width={localBounds.width}
                      height={localBounds.height}
                      cornerRadius={16}
                      fill="rgba(15, 23, 42, 0.001)"
                      strokeEnabled={false}
                    />
                  )}

                  {!hasDedicatedSymbol && device.shape === 'rectangle' && (
                    <>
                      <Rect
                        width={localBounds.width}
                        height={localBounds.height}
                        cornerRadius={8}
                        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                        fillLinearGradientEndPoint={{ x: 0, y: localBounds.height }}
                        fillLinearGradientColorStops={[0, surfaceTop, 0.55, fillColor, 1, surfaceBottom]}
                        stroke={strokeColor}
                        strokeWidth={baseStrokeWidth}
                        shadowBlur={shadowBlur}
                        shadowOffsetX={0}
                        shadowOffsetY={shadowOffsetY}
                        shadowColor={shadowColor}
                        shadowOpacity={0.95}
                      />
                      <Rect
                        width={localBounds.width}
                        height={localBounds.height * 0.48}
                        cornerRadius={8}
                        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                        fillLinearGradientEndPoint={{ x: 0, y: localBounds.height * 0.48 }}
                        fillLinearGradientColorStops={[
                          0,
                          'rgba(255,255,255,0.68)',
                          0.42,
                          'rgba(255,255,255,0.18)',
                          1,
                          'rgba(255,255,255,0)',
                        ]}
                        listening={false}
                      />
                      <Line
                        points={[14, 13, localBounds.width - 14, 13]}
                        stroke="rgba(255,255,255,0.62)"
                        strokeWidth={1.4}
                        lineCap="round"
                        listening={false}
                      />
                    </>
                  )}
                  {!hasDedicatedSymbol && device.shape === 'circle' && (
                    <>
                      <Circle
                        x={localBounds.width / 2}
                        y={localBounds.height / 2}
                        radius={Math.min(localBounds.width, localBounds.height) / 2}
                        fillLinearGradientStartPoint={{ x: localBounds.width / 2, y: 0 }}
                        fillLinearGradientEndPoint={{ x: localBounds.width / 2, y: localBounds.height }}
                        fillLinearGradientColorStops={[0, surfaceTop, 0.52, fillColor, 1, surfaceBottom]}
                        stroke={strokeColor}
                        strokeWidth={baseStrokeWidth}
                        shadowBlur={shadowBlur}
                        shadowOffsetX={0}
                        shadowOffsetY={shadowOffsetY}
                        shadowColor={shadowColor}
                        shadowOpacity={0.95}
                      />
                      <Circle
                        x={localBounds.width / 2 - Math.min(localBounds.width, localBounds.height) * 0.16}
                        y={localBounds.height / 2 - Math.min(localBounds.width, localBounds.height) * 0.19}
                        radius={Math.min(localBounds.width, localBounds.height) * 0.2}
                        fill="rgba(255,255,255,0.2)"
                        listening={false}
                      />
                    </>
                  )}
                  {!hasDedicatedSymbol && device.shape === 'triangle' && (
                    <>
                      <Line
                        points={getShapePathPoints(localBounds, device.shape)}
                        closed
                        fillLinearGradientStartPoint={{ x: localBounds.width / 2, y: 0 }}
                        fillLinearGradientEndPoint={{ x: localBounds.width / 2, y: localBounds.height }}
                        fillLinearGradientColorStops={[0, surfaceTop, 0.55, fillColor, 1, surfaceBottom]}
                        stroke={strokeColor}
                        strokeWidth={baseStrokeWidth}
                        lineJoin="round"
                        shadowBlur={shadowBlur}
                        shadowOffsetX={0}
                        shadowOffsetY={shadowOffsetY}
                        shadowColor={shadowColor}
                        shadowOpacity={0.95}
                      />
                      <Line
                        points={[
                          localBounds.width / 2,
                          15,
                          localBounds.width * 0.26,
                          localBounds.height * 0.42,
                          localBounds.width * 0.74,
                          localBounds.height * 0.42,
                        ]}
                        closed
                        fillLinearGradientStartPoint={{ x: localBounds.width / 2, y: 15 }}
                        fillLinearGradientEndPoint={{ x: localBounds.width / 2, y: localBounds.height * 0.42 }}
                        fillLinearGradientColorStops={[
                          0,
                          'rgba(255,255,255,0.56)',
                          0.65,
                          'rgba(255,255,255,0.14)',
                          1,
                          'rgba(255,255,255,0)',
                        ]}
                        listening={false}
                      />
                    </>
                  )}

                  {hasDedicatedSymbol && (
                    <>
                      {showStandaloneHalo && (
                        <Rect
                          x={10}
                          y={8}
                          width={localBounds.width - 20}
                          height={localBounds.height - 16}
                          cornerRadius={18}
                          stroke={strokeColor}
                          strokeWidth={focusAnchor ? 2.2 : 1.6}
                          dash={focusAnchor ? undefined : [16, 12]}
                          fillEnabled={false}
                          shadowBlur={18}
                          shadowOffsetY={8}
                          shadowColor={shadowColor}
                          shadowOpacity={0.46}
                          listening={false}
                        />
                      )}
                      <DeviceSymbolGlyph
                        visualKind={device.visualKind}
                        width={localBounds.width}
                        height={localBounds.height}
                        stroke="#0F172A"
                        accent={symbolAccent}
                      />
                    </>
                  )}

                  <Text
                    x={hasDedicatedSymbol ? 14 : 18}
                    y={hasDedicatedSymbol ? 10 : 16}
                    width={localBounds.width - (hasDedicatedSymbol ? 28 : 36)}
                    text={device.reference}
                    fill="rgba(71, 85, 105, 0.92)"
                    fontSize={hasDedicatedSymbol ? 13 : 12}
                    fontStyle="bold"
                    align={hasDedicatedSymbol ? 'center' : 'left'}
                    shadowColor={hasDedicatedSymbol ? 'rgba(255,255,255,0.96)' : undefined}
                    shadowBlur={hasDedicatedSymbol ? 10 : 0}
                  />
                  <Text
                    x={hasDedicatedSymbol ? 20 : 18}
                    y={
                      hasDedicatedSymbol
                        ? localBounds.height - (device.parameterSummary ? 40 : 28)
                        : device.parameterSummary
                          ? localBounds.height / 2 - 28
                          : localBounds.height / 2 - 14
                    }
                    width={localBounds.width - (hasDedicatedSymbol ? 40 : 36)}
                    height={hasDedicatedSymbol ? 20 : 28}
                    text={device.source.name}
                    fill="#0f172a"
                    fontSize={hasDedicatedSymbol ? 13 : 18}
                    fontStyle="bold"
                    align="center"
                    verticalAlign="middle"
                    wrap="none"
                    ellipsis
                    shadowColor={hasDedicatedSymbol ? 'rgba(255,255,255,0.96)' : undefined}
                    shadowBlur={hasDedicatedSymbol ? 12 : 0}
                  />
                  {device.parameterSummary && (
                    <Text
                      x={hasDedicatedSymbol ? 20 : 18}
                      y={hasDedicatedSymbol ? localBounds.height - 21 : localBounds.height / 2 + 2}
                      width={localBounds.width - (hasDedicatedSymbol ? 40 : 36)}
                      height={hasDedicatedSymbol ? 16 : 24}
                      text={device.parameterSummary}
                      fill="rgba(15, 23, 42, 0.78)"
                      fontSize={hasDedicatedSymbol ? 12 : 14}
                      fontStyle="bold"
                      align="center"
                      verticalAlign="middle"
                      wrap="none"
                      ellipsis
                      shadowColor={hasDedicatedSymbol ? 'rgba(255,255,255,0.96)' : undefined}
                      shadowBlur={hasDedicatedSymbol ? 12 : 0}
                    />
                  )}

                  {device.terminals.map((terminal) => {
                    const layoutEntry = terminalLayout.get(terminal.id)
                    if (!layoutEntry) {
                      return null
                    }

                    const point =
                      terminalDragPreview?.terminalId === terminal.id &&
                      terminalDragPreview.deviceId === device.id
                        ? terminalDragPreview.point
                        : layoutEntry.point
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
                    const roleStroke = getTerminalRoleStroke(terminal.flowDirection)
                    const baseRadius = selectedTerminal || sameConnection || sameFocusedLabel ? 8 : 6

                    return (
                      <Group
                        key={terminal.id}
                        x={point.x}
                        y={point.y}
                        draggable={!pendingDeviceShape && focusProgress < 0.05}
                        onClick={(evt) => {
                          if (pendingDeviceShape) {
                            return
                          }
                          evt.cancelBubble = true
                          setSelection({ entityType: 'terminal', id: terminal.id })
                        }}
                        onDragStart={(evt) => {
                          evt.cancelBubble = true
                          suppressClickRef.current = true
                          setTerminalDragPreview({
                            deviceId: device.id,
                            terminalId: terminal.id,
                            point,
                            side: layoutEntry.side === 'auto' ? 'bottom' : layoutEntry.side,
                          })
                          setSelection({ entityType: 'terminal', id: terminal.id })
                        }}
                        onDragMove={(evt) => {
                          evt.cancelBubble = true
                          const projected = projectPointToShapeEdge(
                            evt.target.position(),
                            localBounds,
                            device.shape,
                            device.visualKind,
                          )
                          evt.target.position(projected.point)
                          setTerminalDragPreview({
                            deviceId: device.id,
                            terminalId: terminal.id,
                            point: projected.point,
                            side: projected.side,
                          })
                        }}
                        onDragEnd={(evt) => {
                          evt.cancelBubble = true
                          const projected = projectPointToShapeEdge(
                            evt.target.position(),
                            localBounds,
                            device.shape,
                            device.visualKind,
                          )
                          evt.target.position(projected.point)
                          const nextSide = projected.side
                          const peerCount = device.terminals.filter(
                            (candidate) =>
                              candidate.id !== terminal.id && candidate.side === nextSide,
                          ).length
                          repositionTerminal(
                            device.id,
                            terminal.id,
                            nextSide,
                            getTerminalInsertIndex(
                              nextSide,
                              projected.point,
                              localBounds,
                              peerCount,
                            ),
                            projected.point,
                            localBounds,
                          )
                          setTerminalDragPreview(null)
                          suppressClicksAfterDrag()
                        }}
                      >
                        {emphasisStroke && (
                          <Circle
                            x={0}
                            y={0}
                            radius={baseRadius + 2}
                            fillEnabled={false}
                            stroke={emphasisStroke}
                            strokeWidth={2.2}
                            opacity={0.96}
                          />
                        )}
                        {roleStroke.outerStroke && (
                          <Circle
                            x={0}
                            y={0}
                            radius={baseRadius + roleStroke.outerStroke.radiusOffset}
                            fillEnabled={false}
                            stroke={roleStroke.outerStroke.color}
                            strokeWidth={roleStroke.outerStroke.width}
                            opacity={1}
                          />
                        )}
                        <Circle
                          x={0}
                          y={0}
                          radius={baseRadius}
                          fill={color.fill}
                          stroke={roleStroke.baseStroke}
                          strokeWidth={roleStroke.baseStrokeWidth}
                          shadowBlur={12}
                          shadowColor={color.glow}
                        />
                      </Group>
                    )
                  })}
                </Group>
              )
            })}

            {selectionBox && (
              <Rect
                {...normalizeSelectionBox(selectionBox)}
                fill="rgba(37, 99, 235, 0.14)"
                stroke="rgba(37, 99, 235, 0.92)"
                strokeWidth={1.4}
                dash={[10, 8]}
                listening={false}
              />
            )}
          </Layer>

          <Layer x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom} listening={false}>
            {terminalLabels.map((label) => (
              <Group key={`terminal-label-${label.id}`} opacity={label.opacity}>
                <Line
                  points={label.leaderPoints}
                  stroke="rgba(71, 85, 105, 0.42)"
                  strokeWidth={1}
                  lineCap="round"
                />
                <Text
                  x={label.x}
                  y={label.y}
                  width={label.width}
                  text={label.text}
                  fill={label.fill}
                  fontSize={11}
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
