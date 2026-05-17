import { deriveCircuitInsights } from './circuitDescription'
import type { DocumentFile, ValidationIssue } from '../types/document'

export interface LayoutOverlapCheckOptions {
  padding?: number
  networkLinePadding?: number
  includeTouching?: boolean
  maxPairs?: number
}

export interface LayoutDeviceOverlapIssue {
  severity: 'warning'
  code: 'layout.device.overlap'
  message: string
  entityId: string
  path: string
  details: {
    leftDeviceId: string
    rightDeviceId: string
    leftBounds: Bounds
    rightBounds: Bounds
    overlapWidth: number
    overlapHeight: number
    overlapArea: number
    padding: number
  }
}

export interface LayoutNetworkLineDeviceOverlapIssue {
  severity: 'warning'
  code: 'layout.network-line.device-overlap'
  message: string
  entityId: string
  path: string
  details: {
    networkLineId: string
    networkLineLabel: string
    deviceId: string
    lineStart: Point
    lineEnd: Point
    deviceBounds: Bounds
    overlapLength: number
    padding: number
  }
}

export type LayoutOverlapIssue = LayoutDeviceOverlapIssue | LayoutNetworkLineDeviceOverlapIssue

export interface LayoutOverlapReport {
  ok: boolean
  issueCount: number
  checkedDeviceCount: number
  checkedNetworkLineCount: number
  checkedPairCount: number
  checkedNetworkLineDevicePairCount: number
  truncated: boolean
  issues: LayoutOverlapIssue[]
}

type Bounds = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }

export function checkLayoutOverlaps(
  document: DocumentFile,
  options: LayoutOverlapCheckOptions = {},
): LayoutOverlapReport {
  const padding = Math.max(0, finiteOr(options.padding, 0))
  const networkLinePadding = Math.max(0, finiteOr(options.networkLinePadding, 0))
  const includeTouching = options.includeTouching === true
  const maxPairs = options.maxPairs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(options.maxPairs))
  const insights = deriveCircuitInsights(document)
  const devices = insights.devices
    .map((device) => ({ id: device.id, bounds: expandBounds(device.bounds, padding) }))
    .sort((left, right) => compareText(left.id, right.id))
  const networkLines = insights.networkLines
    .map((networkLine) => ({
      id: networkLine.id,
      label: networkLine.label,
      start: networkLine.start,
      end: networkLine.end,
    }))
    .sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id))

  let checkedPairCount = 0
  let checkedNetworkLineDevicePairCount = 0
  const allIssues: LayoutOverlapIssue[] = []
  for (let leftIndex = 0; leftIndex < devices.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < devices.length; rightIndex += 1) {
      checkedPairCount += 1
      const left = devices[leftIndex]!
      const right = devices[rightIndex]!
      const overlapWidth = Math.min(left.bounds.x + left.bounds.width, right.bounds.x + right.bounds.width) - Math.max(left.bounds.x, right.bounds.x)
      const overlapHeight = Math.min(left.bounds.y + left.bounds.height, right.bounds.y + right.bounds.height) - Math.max(left.bounds.y, right.bounds.y)
      const overlaps = includeTouching ? overlapWidth >= 0 && overlapHeight >= 0 : overlapWidth > 0 && overlapHeight > 0
      if (!overlaps) continue
      allIssues.push({
        severity: 'warning',
        code: 'layout.device.overlap',
        message: `Devices ${left.id} and ${right.id} overlap on the canvas.`,
        entityId: left.id,
        path: `view.devices.${left.id}`,
        details: {
          leftDeviceId: left.id,
          rightDeviceId: right.id,
          leftBounds: left.bounds,
          rightBounds: right.bounds,
          overlapWidth: Math.max(0, overlapWidth),
          overlapHeight: Math.max(0, overlapHeight),
          overlapArea: Math.max(0, overlapWidth) * Math.max(0, overlapHeight),
          padding,
        },
      })
    }
  }

  for (const networkLine of networkLines) {
    for (const device of devices) {
      checkedNetworkLineDevicePairCount += 1
      const deviceBounds = expandBounds(device.bounds, networkLinePadding)
      const overlapLength = lineBoundsOverlapLength(networkLine.start, networkLine.end, deviceBounds, includeTouching)
      if (overlapLength <= 0) {
        continue
      }

      allIssues.push({
        severity: 'warning',
        code: 'layout.network-line.device-overlap',
        message: `Network line ${networkLine.id} (${networkLine.label}) crosses device ${device.id}.`,
        entityId: networkLine.id,
        path: `view.networkLines.${networkLine.id}`,
        details: {
          networkLineId: networkLine.id,
          networkLineLabel: networkLine.label,
          deviceId: device.id,
          lineStart: networkLine.start,
          lineEnd: networkLine.end,
          deviceBounds,
          overlapLength,
          padding: networkLinePadding,
        },
      })
    }
  }

  const issues = allIssues.slice(0, maxPairs)
  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    checkedDeviceCount: devices.length,
    checkedNetworkLineCount: networkLines.length,
    checkedPairCount,
    checkedNetworkLineDevicePairCount,
    truncated: allIssues.length > issues.length,
    issues,
  }
}

export function layoutIssuesAsValidationIssues(issues: LayoutOverlapIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    entityId: issue.entityId,
    path: issue.path,
    details: issue.details,
  }))
}

function expandBounds(bounds: Bounds, padding: number): Bounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function lineBoundsOverlapLength(start: Point, end: Point, bounds: Bounds, includeTouching: boolean): number {
  const epsilon = 1e-6
  if (Math.abs(start.y - end.y) < epsilon) {
    return horizontalLineBoundsOverlapLength(start, end, bounds, includeTouching)
  }
  if (Math.abs(start.x - end.x) < epsilon) {
    return verticalLineBoundsOverlapLength(start, end, bounds, includeTouching)
  }
  return diagonalLineIntersectsBounds(start, end, bounds, includeTouching) ? 1 : 0
}

function horizontalLineBoundsOverlapLength(start: Point, end: Point, bounds: Bounds, includeTouching: boolean): number {
  const lineMinX = Math.min(start.x, end.x)
  const lineMaxX = Math.max(start.x, end.x)
  const boundsMinX = bounds.x
  const boundsMaxX = bounds.x + bounds.width
  const boundsMinY = bounds.y
  const boundsMaxY = bounds.y + bounds.height
  const yOverlaps = includeTouching
    ? start.y >= boundsMinY && start.y <= boundsMaxY
    : start.y > boundsMinY && start.y < boundsMaxY
  if (!yOverlaps) return 0
  const overlap = Math.min(lineMaxX, boundsMaxX) - Math.max(lineMinX, boundsMinX)
  return includeTouching ? Math.max(overlap, 0) : Math.max(overlap, 0)
}

function verticalLineBoundsOverlapLength(start: Point, end: Point, bounds: Bounds, includeTouching: boolean): number {
  const lineMinY = Math.min(start.y, end.y)
  const lineMaxY = Math.max(start.y, end.y)
  const boundsMinY = bounds.y
  const boundsMaxY = bounds.y + bounds.height
  const boundsMinX = bounds.x
  const boundsMaxX = bounds.x + bounds.width
  const xOverlaps = includeTouching
    ? start.x >= boundsMinX && start.x <= boundsMaxX
    : start.x > boundsMinX && start.x < boundsMaxX
  if (!xOverlaps) return 0
  const overlap = Math.min(lineMaxY, boundsMaxY) - Math.max(lineMinY, boundsMinY)
  return includeTouching ? Math.max(overlap, 0) : Math.max(overlap, 0)
}

function diagonalLineIntersectsBounds(start: Point, end: Point, bounds: Bounds, includeTouching: boolean): boolean {
  return (
    pointInBounds(start, bounds, includeTouching) ||
    pointInBounds(end, bounds, includeTouching) ||
    segmentsIntersect(start, end, { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y }, includeTouching) ||
    segmentsIntersect(start, end, { x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, includeTouching) ||
    segmentsIntersect(start, end, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }, includeTouching) ||
    segmentsIntersect(start, end, { x: bounds.x, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y }, includeTouching)
  )
}

function pointInBounds(point: Point, bounds: Bounds, includeTouching: boolean): boolean {
  const right = bounds.x + bounds.width
  const bottom = bounds.y + bounds.height
  return includeTouching
    ? point.x >= bounds.x && point.x <= right && point.y >= bounds.y && point.y <= bottom
    : point.x > bounds.x && point.x < right && point.y > bounds.y && point.y < bottom
}

function segmentsIntersect(leftStart: Point, leftEnd: Point, rightStart: Point, rightEnd: Point, includeTouching: boolean): boolean {
  const d1 = direction(rightStart, rightEnd, leftStart)
  const d2 = direction(rightStart, rightEnd, leftEnd)
  const d3 = direction(leftStart, leftEnd, rightStart)
  const d4 = direction(leftStart, leftEnd, rightEnd)
  if (includeTouching) {
    if (d1 === 0 && onSegment(rightStart, rightEnd, leftStart)) return true
    if (d2 === 0 && onSegment(rightStart, rightEnd, leftEnd)) return true
    if (d3 === 0 && onSegment(leftStart, leftEnd, rightStart)) return true
    if (d4 === 0 && onSegment(leftStart, leftEnd, rightEnd)) return true
  }
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function direction(start: Point, end: Point, point: Point): number {
  const value = (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x)
  if (Math.abs(value) < 1e-6) return 0
  return value
}

function onSegment(start: Point, end: Point, point: Point): boolean {
  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  )
}

function safeText(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  if (value === null || value === undefined) {
    return ''
  }
  return String(value)
}

function compareText(left: unknown, right: unknown) {
  return safeText(left).localeCompare(safeText(right))
}
