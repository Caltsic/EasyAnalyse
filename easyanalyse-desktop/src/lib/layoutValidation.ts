import { deriveCircuitInsights } from './circuitDescription'
import type { DocumentFile, ValidationIssue } from '../types/document'

export interface LayoutOverlapCheckOptions {
  padding?: number
  includeTouching?: boolean
  maxPairs?: number
}

export interface LayoutOverlapIssue {
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

export interface LayoutOverlapReport {
  ok: boolean
  issueCount: number
  checkedDeviceCount: number
  checkedPairCount: number
  truncated: boolean
  issues: LayoutOverlapIssue[]
}

type Bounds = { x: number; y: number; width: number; height: number }

export function checkLayoutOverlaps(
  document: DocumentFile,
  options: LayoutOverlapCheckOptions = {},
): LayoutOverlapReport {
  const padding = Math.max(0, finiteOr(options.padding, 0))
  const includeTouching = options.includeTouching === true
  const maxPairs = options.maxPairs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(options.maxPairs))
  const devices = deriveCircuitInsights(document).devices
    .map((device) => ({ id: device.id, bounds: expandBounds(device.bounds, padding) }))
    .sort((left, right) => left.id.localeCompare(right.id))

  let checkedPairCount = 0
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
  const issues = allIssues.slice(0, maxPairs)
  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    checkedDeviceCount: devices.length,
    checkedPairCount,
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
