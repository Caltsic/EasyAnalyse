import type { DeviceShape, Point, TerminalSide } from '../types/document'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

export function getSignalPoint(
  bounds: Bounds,
  shape: DeviceShape,
  side: TerminalSide,
  order: number,
  total: number,
) {
  const safeTotal = Math.max(1, total)
  const index = clamp(order, 0, safeTotal - 1)
  const ratio = safeTotal === 1 ? 0.5 : (index + 1) / (safeTotal + 1)

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

    if (side === 'top') {
      return {
        x: lerp(top.x, right.x, ratio * 0.5),
        y: lerp(top.y, right.y, ratio * 0.5),
      }
    }

    if (side === 'right') {
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
