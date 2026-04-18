import type { DeviceVisualKind } from './deviceSymbols'
import type { DeviceShape, Point, TerminalDefinition, TerminalSide } from '../types/document'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

const EASYANALYSE_NAMESPACE = 'easyanalyse'
const TERMINAL_ANCHOR_KEY = 'terminalAnchor'

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNormalizedPoint(point: Point, bounds: Bounds): Point {
  return {
    x: clamp((point.x - bounds.x) / Math.max(bounds.width, 1), 0, 1),
    y: clamp((point.y - bounds.y) / Math.max(bounds.height, 1), 0, 1),
  }
}

function squaredDistance(left: Point, right: Point) {
  const dx = left.x - right.x
  const dy = left.y - right.y
  return dx * dx + dy * dy
}

function closestPointOnSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 1e-6) {
    return start
  }

  const t = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1,
  )
  return {
    x: start.x + dx * t,
    y: start.y + dy * t,
  }
}

function distributeAlongSpan(start: number, end: number, index: number, total: number) {
  if (total <= 1) {
    return (start + end) / 2
  }

  const ratio = clamp(index / (total - 1), 0, 1)
  return lerp(start, end, ratio)
}

function getOpAmpTerminalRails(bounds: Bounds) {
  const triangleTop = bounds.y + 28
  const triangleBottom = bounds.y + bounds.height - 54
  const triangleCenterY = (triangleTop + triangleBottom) / 2
  const leftSpan = Math.max(48, Math.min(72, bounds.height * 0.38))
  const rightSpan = Math.max(28, Math.min(52, bounds.height * 0.26))
  const powerSpan = Math.max(18, Math.min(28, bounds.width * 0.08))
  const leftX = bounds.x + 18
  const rightX = bounds.x + bounds.width - 18
  const centerX = bounds.x + bounds.width / 2
  const topY = triangleTop - 14
  const bottomY = triangleBottom + 14

  return {
    left: {
      start: { x: leftX, y: triangleCenterY - leftSpan / 2 },
      end: { x: leftX, y: triangleCenterY + leftSpan / 2 },
    },
    right: {
      start: { x: rightX, y: triangleCenterY - rightSpan / 2 },
      end: { x: rightX, y: triangleCenterY + rightSpan / 2 },
    },
    top: {
      start: { x: centerX - powerSpan / 2, y: topY },
      end: { x: centerX + powerSpan / 2, y: topY },
    },
    bottom: {
      start: { x: centerX - powerSpan / 2, y: bottomY },
      end: { x: centerX + powerSpan / 2, y: bottomY },
    },
  }
}

export function getStoredTerminalAnchor(
  terminal: Pick<TerminalDefinition, 'extensions'>,
): Point | null {
  if (!isRecord(terminal.extensions)) {
    return null
  }

  const easyanalyse = terminal.extensions[EASYANALYSE_NAMESPACE]
  if (!isRecord(easyanalyse)) {
    return null
  }

  const anchor = easyanalyse[TERMINAL_ANCHOR_KEY]
  if (!isRecord(anchor)) {
    return null
  }

  const x = anchor.x
  const y = anchor.y
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    return null
  }

  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
  }
}

export function setStoredTerminalAnchor(
  terminal: TerminalDefinition,
  point: Point | null,
  bounds?: Bounds,
) {
  const nextExtensions = isRecord(terminal.extensions) ? { ...terminal.extensions } : {}
  const nextEasyanalyse = isRecord(nextExtensions[EASYANALYSE_NAMESPACE])
    ? { ...(nextExtensions[EASYANALYSE_NAMESPACE] as Record<string, unknown>) }
    : {}

  if (point && bounds) {
    nextEasyanalyse[TERMINAL_ANCHOR_KEY] = toNormalizedPoint(point, bounds)
    nextExtensions[EASYANALYSE_NAMESPACE] = nextEasyanalyse
    terminal.extensions = nextExtensions
    return
  }

  delete nextEasyanalyse[TERMINAL_ANCHOR_KEY]
  if (Object.keys(nextEasyanalyse).length > 0) {
    nextExtensions[EASYANALYSE_NAMESPACE] = nextEasyanalyse
  } else {
    delete nextExtensions[EASYANALYSE_NAMESPACE]
  }

  terminal.extensions = Object.keys(nextExtensions).length > 0 ? nextExtensions : undefined
}

export function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress
}

export function lerpPoint(from: Point, to: Point, progress: number): Point {
  return {
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
  }
}

export function getBoundsCenter(bounds: Bounds): Point {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
}

export function fitZoomToBounds(
  bounds: Bounds,
  viewport: { width: number; height: number },
  padding = 160,
) {
  const availableWidth = Math.max(1, viewport.width - padding * 2)
  const availableHeight = Math.max(1, viewport.height - padding * 2)
  const scaleX = availableWidth / Math.max(1, bounds.width)
  const scaleY = availableHeight / Math.max(1, bounds.height)
  return Math.min(scaleX, scaleY)
}

export function getViewportPanForCenter(
  center: Point,
  viewport: { width: number; height: number },
  zoom: number,
) {
  return {
    x: viewport.width / 2 - center.x * zoom,
    y: viewport.height / 2 - center.y * zoom,
  }
}

export function getShapePathPoints(bounds: Bounds, shape: DeviceShape) {
  if (shape !== 'triangle') {
    return []
  }

  return [
    bounds.x + bounds.width / 2,
    bounds.y,
    bounds.x + bounds.width,
    bounds.y + bounds.height,
    bounds.x,
    bounds.y + bounds.height,
  ]
}

export function projectPointToShapeEdge(
  point: Point,
  bounds: Bounds,
  shape: DeviceShape,
  visualKind?: DeviceVisualKind,
): { side: Exclude<TerminalSide, 'auto'>; point: Point } {
  if (visualKind === 'op-amp') {
    const rails = getOpAmpTerminalRails(bounds)
    const candidates = [
      { side: 'left' as const, point: closestPointOnSegment(point, rails.left.start, rails.left.end) },
      { side: 'right' as const, point: closestPointOnSegment(point, rails.right.start, rails.right.end) },
      { side: 'top' as const, point: closestPointOnSegment(point, rails.top.start, rails.top.end) },
      { side: 'bottom' as const, point: closestPointOnSegment(point, rails.bottom.start, rails.bottom.end) },
    ].sort(
      (leftCandidate, rightCandidate) =>
        squaredDistance(point, leftCandidate.point) - squaredDistance(point, rightCandidate.point),
    )

    return candidates[0]!
  }

  if (shape === 'circle') {
    const radius = Math.min(bounds.width, bounds.height) / 2
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    }
    const dx = point.x - center.x
    const dy = point.y - center.y
    const length = Math.hypot(dx, dy) || 1
    const projected = {
      x: center.x + (dx / length) * radius,
      y: center.y + (dy / length) * radius,
    }
    const side =
      Math.abs(projected.x - center.x) >= Math.abs(projected.y - center.y)
        ? projected.x < center.x
          ? ('left' as const)
          : ('right' as const)
        : projected.y < center.y
          ? ('top' as const)
          : ('bottom' as const)

    return {
      side,
      point: projected,
    }
  }

  if (shape === 'triangle') {
    const top = { x: bounds.x + bounds.width / 2, y: bounds.y }
    const left = { x: bounds.x, y: bounds.y + bounds.height }
    const right = { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
    const candidates = [
      {
        side: 'left' as const,
        point: closestPointOnSegment(point, top, left),
      },
      {
        side: 'right' as const,
        point: closestPointOnSegment(point, top, right),
      },
      {
        side: 'bottom' as const,
        point: closestPointOnSegment(point, left, right),
      },
    ].sort(
      (leftCandidate, rightCandidate) =>
        squaredDistance(point, leftCandidate.point) - squaredDistance(point, rightCandidate.point),
    )

    return candidates[0]!
  }

  const clamped = {
    x: clamp(point.x, bounds.x, bounds.x + bounds.width),
    y: clamp(point.y, bounds.y, bounds.y + bounds.height),
  }
  const distances = [
    { side: 'left' as const, value: Math.abs(clamped.x - bounds.x) },
    { side: 'right' as const, value: Math.abs(bounds.x + bounds.width - clamped.x) },
    { side: 'top' as const, value: Math.abs(clamped.y - bounds.y) },
    { side: 'bottom' as const, value: Math.abs(bounds.y + bounds.height - clamped.y) },
  ].sort((leftDistance, rightDistance) => leftDistance.value - rightDistance.value)

  switch (distances[0]!.side) {
    case 'left':
      return {
        side: 'left',
        point: {
          x: bounds.x,
          y: clamped.y,
        },
      }
    case 'right':
      return {
        side: 'right',
        point: {
          x: bounds.x + bounds.width,
          y: clamped.y,
        },
      }
    case 'top':
      return {
        side: 'top',
        point: {
          x: clamped.x,
          y: bounds.y,
        },
      }
    case 'bottom':
    default:
      return {
        side: 'bottom',
        point: {
          x: clamped.x,
          y: bounds.y + bounds.height,
        },
      }
  }
}

export function getSignalPoint(
  bounds: Bounds,
  shape: DeviceShape,
  side: TerminalSide,
  order: number,
  total: number,
  visualKind?: DeviceVisualKind,
) {
  const safeTotal = Math.max(1, total)
  const index = clamp(order, 0, safeTotal - 1)
  const ratio = safeTotal === 1 ? 0.5 : (index + 1) / (safeTotal + 1)

  if (visualKind === 'op-amp') {
    const rails = getOpAmpTerminalRails(bounds)

    switch (side) {
      case 'left':
        return {
          x: rails.left.start.x,
          y: distributeAlongSpan(rails.left.start.y, rails.left.end.y, index, safeTotal),
        }
      case 'right':
        return {
          x: rails.right.start.x,
          y: distributeAlongSpan(rails.right.start.y, rails.right.end.y, index, safeTotal),
        }
      case 'top':
        return {
          x: distributeAlongSpan(rails.top.start.x, rails.top.end.x, index, safeTotal),
          y: rails.top.start.y,
        }
      case 'bottom':
      case 'auto':
      default:
        return {
          x: distributeAlongSpan(rails.bottom.start.x, rails.bottom.end.x, index, safeTotal),
          y: rails.bottom.start.y,
        }
    }
  }

  if (shape === 'circle') {
    const radius = Math.min(bounds.width, bounds.height) / 2
    const center = getBoundsCenter(bounds)
    const angleDeg =
      side === 'left'
        ? 180 + (index - safeTotal / 2) * 14
        : side === 'right'
          ? (index - safeTotal / 2) * 14
          : side === 'top'
            ? 270 + (index - safeTotal / 2) * 14
            : 90 + (index - safeTotal / 2) * 14
    const radians = (angleDeg * Math.PI) / 180
    return {
      x: center.x + Math.cos(radians) * radius,
      y: center.y + Math.sin(radians) * radius,
    }
  }

  if (shape === 'triangle') {
    const top = { x: bounds.x + bounds.width / 2, y: bounds.y }
    const right = { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
    const left = { x: bounds.x, y: bounds.y + bounds.height }

    if (side === 'left') {
      return {
        x: lerp(top.x, left.x, ratio),
        y: lerp(top.y, left.y, ratio),
      }
    }

    if (side === 'right' || side === 'top') {
      return {
        x: lerp(top.x, right.x, ratio),
        y: lerp(top.y, right.y, ratio),
      }
    }

    return {
      x: lerp(left.x, right.x, ratio),
      y: lerp(left.y, right.y, 0),
    }
  }

  switch (side) {
    case 'left':
      return { x: bounds.x, y: bounds.y + bounds.height * ratio }
    case 'right':
      return { x: bounds.x + bounds.width, y: bounds.y + bounds.height * ratio }
    case 'top':
      return { x: bounds.x + bounds.width * ratio, y: bounds.y }
    case 'bottom':
    case 'auto':
    default:
      return { x: bounds.x + bounds.width * ratio, y: bounds.y + bounds.height }
  }
}
