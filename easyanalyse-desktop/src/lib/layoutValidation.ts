import { deriveCircuitInsights } from './circuitDescription'
import { compareCoercedText } from './text'
import type { DocumentFile, ValidationIssue } from '../types/document'

export interface LayoutOverlapCheckOptions {
  padding?: number
  networkLinePadding?: number
  textPadding?: number
  includeTextDeviceOverlaps?: boolean
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

export interface LayoutTextDeviceOverlapIssue {
  severity: 'warning'
  code: 'layout.text.device-overlap'
  message: string
  entityId: string
  path: string
  details: {
    textId: string
    textKind: 'terminal-label' | 'network-line-label'
    text: string
    ownerDeviceId?: string
    deviceId: string
    textBounds: Bounds
    deviceBounds: Bounds
    overlapWidth: number
    overlapHeight: number
    overlapArea: number
    padding: number
  }
}

export type LayoutOverlapIssue = LayoutDeviceOverlapIssue | LayoutNetworkLineDeviceOverlapIssue | LayoutTextDeviceOverlapIssue

export interface LayoutOverlapReport {
  ok: boolean
  issueCount: number
  checkedDeviceCount: number
  checkedNetworkLineCount: number
  checkedTextBoxCount: number
  checkedPairCount: number
  checkedNetworkLineDevicePairCount: number
  checkedTextDevicePairCount: number
  truncated: boolean
  issues: LayoutOverlapIssue[]
}

type Bounds = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type LayoutTextBox = {
  id: string
  kind: 'terminal-label' | 'network-line-label'
  text: string
  ownerDeviceId?: string
  path: string
  bounds: Bounds
}

const TERMINAL_LABEL_WIDTH = 172
const TERMINAL_LABEL_HEIGHT = 18
const NETWORK_LINE_LABEL_WIDTH = 160
const NETWORK_LINE_LABEL_HEIGHT = 22

export function checkLayoutOverlaps(
  document: DocumentFile,
  options: LayoutOverlapCheckOptions = {},
): LayoutOverlapReport {
  const padding = Math.max(0, finiteOr(options.padding, 0))
  const networkLinePadding = Math.max(0, finiteOr(options.networkLinePadding, 0))
  const textPadding = Math.max(0, finiteOr(options.textPadding, 0))
  const includeTextDeviceOverlaps = options.includeTextDeviceOverlaps === true
  const includeTouching = options.includeTouching === true
  const maxPairs = options.maxPairs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(options.maxPairs))
  const insights = deriveCircuitInsights(document)
  const devices = insights.devices
    .map((device) => ({ id: device.id, rawBounds: device.bounds, bounds: expandBounds(device.bounds, padding) }))
    .sort((left, right) => compareText(left.id, right.id))
  const networkLines = insights.networkLines
    .map((networkLine) => ({
      id: networkLine.id,
      label: networkLine.label,
      start: networkLine.start,
      end: networkLine.end,
    }))
    .sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id))
  const textBoxes = includeTextDeviceOverlaps
    ? buildTextBoxes(insights).sort((left, right) => compareText(left.kind, right.kind) || compareText(left.id, right.id))
    : []

  let checkedPairCount = 0
  let checkedNetworkLineDevicePairCount = 0
  let checkedTextDevicePairCount = 0
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
      const deviceBounds = expandBounds(device.rawBounds, networkLinePadding)
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

  for (const textBox of textBoxes) {
    for (const device of devices) {
      if (textBox.ownerDeviceId === device.id) continue
      checkedTextDevicePairCount += 1
      const deviceBounds = expandBounds(device.rawBounds, textPadding)
      const overlap = boundsOverlap(textBox.bounds, deviceBounds, includeTouching)
      if (!overlap) continue
      allIssues.push({
        severity: 'warning',
        code: 'layout.text.device-overlap',
        message: `Text ${textBox.id} overlaps device ${device.id}.`,
        entityId: textBox.id,
        path: textBox.path,
        details: {
          textId: textBox.id,
          textKind: textBox.kind,
          text: textBox.text,
          ...(textBox.ownerDeviceId ? { ownerDeviceId: textBox.ownerDeviceId } : {}),
          deviceId: device.id,
          textBounds: textBox.bounds,
          deviceBounds,
          overlapWidth: overlap.width,
          overlapHeight: overlap.height,
          overlapArea: overlap.area,
          padding: textPadding,
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
    checkedTextBoxCount: textBoxes.length,
    checkedPairCount,
    checkedNetworkLineDevicePairCount,
    checkedTextDevicePairCount,
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

function buildTextBoxes(insights: ReturnType<typeof deriveCircuitInsights>): LayoutTextBox[] {
  const terminalLabels = insights.devices.flatMap((device) =>
    device.terminals
      .filter((terminal) => terminal.displayLabel.trim().length > 0)
      .map((terminal) => ({
        id: `terminal-label:${terminal.id}`,
        kind: 'terminal-label' as const,
        text: terminal.displayLabel,
        ownerDeviceId: device.id,
        path: `devices.${device.id}.terminals.${terminal.id}`,
        bounds: terminalLabelBounds(terminal.point, terminal.side),
      })),
  )
  const networkLineLabels = insights.networkLines
    .filter((networkLine) => networkLine.label.trim().length > 0)
    .map((networkLine) => ({
      id: `network-line-label:${networkLine.id}`,
      kind: 'network-line-label' as const,
      text: networkLine.label,
      path: `view.networkLines.${networkLine.id}`,
      bounds: networkLineLabelBounds(networkLine.position, networkLine.orientation),
    }))
  return [...terminalLabels, ...networkLineLabels]
}

function terminalLabelBounds(point: Point, side: string): Bounds {
  switch (side) {
    case 'left':
      return {
        x: point.x - (TERMINAL_LABEL_WIDTH + 18),
        y: point.y - 9,
        width: TERMINAL_LABEL_WIDTH,
        height: TERMINAL_LABEL_HEIGHT,
      }
    case 'right':
      return {
        x: point.x + 18,
        y: point.y - 9,
        width: TERMINAL_LABEL_WIDTH,
        height: TERMINAL_LABEL_HEIGHT,
      }
    case 'top':
      return {
        x: point.x - TERMINAL_LABEL_WIDTH / 2,
        y: point.y - 34,
        width: TERMINAL_LABEL_WIDTH,
        height: TERMINAL_LABEL_HEIGHT,
      }
    case 'bottom':
    case 'auto':
    default:
      return {
        x: point.x - TERMINAL_LABEL_WIDTH / 2,
        y: point.y + 16,
        width: TERMINAL_LABEL_WIDTH,
        height: TERMINAL_LABEL_HEIGHT,
      }
  }
}

function networkLineLabelBounds(point: Point, orientation: string): Bounds {
  if (orientation === 'vertical') {
    return {
      x: point.x - NETWORK_LINE_LABEL_HEIGHT,
      y: point.y - NETWORK_LINE_LABEL_WIDTH / 2,
      width: NETWORK_LINE_LABEL_HEIGHT,
      height: NETWORK_LINE_LABEL_WIDTH,
    }
  }
  return {
    x: point.x - NETWORK_LINE_LABEL_WIDTH / 2,
    y: point.y - 32,
    width: NETWORK_LINE_LABEL_WIDTH,
    height: NETWORK_LINE_LABEL_HEIGHT,
  }
}

function boundsOverlap(left: Bounds, right: Bounds, includeTouching: boolean): { width: number; height: number; area: number } | null {
  const overlapWidth = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  const overlapHeight = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  const overlaps = includeTouching ? overlapWidth >= 0 && overlapHeight >= 0 : overlapWidth > 0 && overlapHeight > 0
  if (!overlaps) return null
  const width = Math.max(0, overlapWidth)
  const height = Math.max(0, overlapHeight)
  return { width, height, area: width * height }
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

const compareText = compareCoercedText
