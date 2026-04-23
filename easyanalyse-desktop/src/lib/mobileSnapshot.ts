import { deriveCircuitInsights } from './circuitDescription'
import { buildDeviceSymbolPrimitives, getDeviceSymbolAccent } from './deviceSymbolPrimitives'
import type {
  DocumentFile,
  Locale,
  MobileRenderSnapshot,
  Point,
  ValidationReport,
} from '../types/document'

interface MutableBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const WORLD_PADDING = 240

function createBounds(): MutableBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  }
}

function includePoint(bounds: MutableBounds, point: Point) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return
  }

  bounds.minX = Math.min(bounds.minX, point.x)
  bounds.minY = Math.min(bounds.minY, point.y)
  bounds.maxX = Math.max(bounds.maxX, point.x)
  bounds.maxY = Math.max(bounds.maxY, point.y)
}

function includeRect(
  bounds: MutableBounds,
  rect: { x: number; y: number; width: number; height: number },
) {
  includePoint(bounds, { x: rect.x, y: rect.y })
  includePoint(bounds, { x: rect.x + rect.width, y: rect.y + rect.height })
}

function finalizeBounds(bounds: MutableBounds) {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return {
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    }
  }

  const x = bounds.minX - WORLD_PADDING
  const y = bounds.minY - WORLD_PADDING
  const width = Math.max(1280, bounds.maxX - bounds.minX + WORLD_PADDING * 2)
  const height = Math.max(720, bounds.maxY - bounds.minY + WORLD_PADDING * 2)

  return { x, y, width, height }
}

export function deriveMobileRenderSnapshot(
  document: DocumentFile,
  report: ValidationReport,
  locale: Locale,
): MobileRenderSnapshot {
  const insights = deriveCircuitInsights(document, locale)
  const bounds = createBounds()

  for (const device of insights.devices) {
    includeRect(bounds, device.bounds)
    for (const terminal of device.terminals) {
      includePoint(bounds, terminal.point)
    }
  }

  for (const networkLine of insights.networkLines) {
    includePoint(bounds, networkLine.start)
    includePoint(bounds, networkLine.end)
    includePoint(bounds, networkLine.position)
  }

  const devices = insights.devices.map((device) => ({
    id: device.id,
    reference: device.reference,
    title: device.title,
    name: device.source.name,
    kind: device.kind,
    visualKind: device.visualKind,
    shape: device.shape,
    rotationDeg: device.rotationDeg,
    bounds: device.bounds,
    center: device.center,
    description: device.source.description,
    properties: device.source.properties,
    symbolAccent: getDeviceSymbolAccent(device.visualKind),
    symbolPrimitives: buildDeviceSymbolPrimitives(device.visualKind, device.bounds.width, device.bounds.height),
    terminals: device.terminals.map((terminal) => {
      const color = insights.terminalColorsById[terminal.id] ?? {
        fill: '#2563EB',
        stroke: '#1D4ED8',
        text: '#1D4ED8',
      }

      return {
        id: terminal.id,
        deviceId: terminal.deviceId,
        name: terminal.name,
        displayLabel: terminal.displayLabel,
        connectionLabel: terminal.connectionLabel ?? undefined,
        direction: terminal.direction,
        flowDirection: terminal.flowDirection,
        side: terminal.side,
        point: terminal.point,
        role: terminal.source.role,
        description: terminal.description ?? undefined,
        pin: terminal.source.pin,
        color: {
          fill: color.fill,
          stroke: color.stroke,
          text: color.text,
        },
      }
    }),
  }))

  const networkLines = insights.networkLines.map((networkLine) => ({
    id: networkLine.id,
    label: networkLine.label,
    labelKey: networkLine.labelKey,
    position: networkLine.position,
    start: networkLine.start,
    end: networkLine.end,
    length: networkLine.length,
    orientation: networkLine.orientation,
  }))

  const connectionGroups = insights.connectionGroups.map((group) => ({
    key: group.key,
    label: group.label,
    terminalIds: group.terminalIds,
    deviceIds: group.deviceIds,
    point: group.point,
  }))

  const relations = Object.values(insights.deviceRelationsById)
    .map((relation) => ({
      deviceId: relation.deviceId,
      title: relation.title,
      upstreamDeviceIds: relation.upstreamDeviceIds,
      downstreamDeviceIds: relation.downstreamDeviceIds,
      relatedTerminalIds: relation.relatedTerminalIds,
      connectionKeys: relation.connectionKeys,
      connectionLabels: relation.connectionLabels,
      upstreamLabels: relation.upstreamLabels,
      downstreamLabels: relation.downstreamLabels,
    }))
    .sort((left, right) => left.title.localeCompare(right.title) || left.deviceId.localeCompare(right.deviceId))

  const terminalSearchItems = devices.flatMap((device) =>
    device.terminals.map((terminal) => ({
      id: terminal.id,
      type: 'terminal' as const,
      label: terminal.displayLabel,
      subtitle: device.title,
      targetId: terminal.id,
    })),
  )

  return {
    schemaVersion: 'mobile-render-v1',
    generatedAt: new Date().toISOString(),
    orientation: 'landscape',
    sourceSchemaVersion: document.schemaVersion,
    document: {
      id: document.document.id,
      title: document.document.title,
      description: document.document.description,
      createdAt: document.document.createdAt,
      updatedAt: document.document.updatedAt,
    },
    canvas: {
      units: document.view.canvas.units,
      background: document.view.canvas.background,
      grid: document.view.canvas.grid,
      worldBounds: finalizeBounds(bounds),
    },
    devices,
    networkLines,
    connectionGroups,
    relations,
    searchIndex: [
      ...devices.map((device) => ({
        id: device.id,
        type: 'device' as const,
        label: device.title,
        subtitle: device.kind,
        targetId: device.id,
      })),
      ...networkLines.map((networkLine) => ({
        id: networkLine.id,
        type: 'networkLine' as const,
        label: networkLine.label,
        subtitle: networkLine.orientation,
        targetId: networkLine.id,
      })),
      ...connectionGroups.map((group) => ({
        id: group.key,
        type: 'connectionGroup' as const,
        label: group.label,
        subtitle: `${group.deviceIds.length} devices`,
        targetId: group.key,
      })),
      ...terminalSearchItems,
    ],
    validation: {
      schemaValid: report.schemaValid,
      semanticValid: report.semanticValid,
      issueCount: report.issueCount,
      issues: report.issues,
    },
  }
}
