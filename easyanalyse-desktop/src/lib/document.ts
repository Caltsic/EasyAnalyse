import { makeId } from './ids'
import { getEndpointPosition } from './geometry'
import type {
  AnnotationEntity,
  ComponentEntity,
  DocumentFile,
  EndpointRef,
  EntityType,
  NodeEntity,
  Point,
  PortEntity,
  WireEntity,
} from '../types/document'

const EASYANALYSE_EXTENSION_KEY = 'easyanalyse'
const DEFAULT_DOCUMENT_TITLE = 'Untitled circuit'

export function buildDefaultDocument(title = 'Untitled circuit'): DocumentFile {
  const timestamp = new Date().toISOString()

  return {
    schemaVersion: '1.0.0',
    document: {
      id: makeId('doc'),
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
      source: 'human',
    },
    canvas: {
      origin: { x: 0, y: 0 },
      width: 2400,
      height: 1600,
      units: 'px',
      grid: {
        enabled: true,
        size: 40,
      },
    },
    components: [],
    ports: [],
    nodes: [],
    wires: [],
    annotations: [],
  }
}

export function normalizeDocumentLocal(document: DocumentFile): DocumentFile {
  const next = structuredClone(document)
  const nodeWireMap = new Map<string, string[]>()

  next.document.title = ensureRequiredString(
    next.document.title,
    DEFAULT_DOCUMENT_TITLE,
  )

  next.nodes.forEach((node) => {
    nodeWireMap.set(node.id, [])
  })

  next.components = next.components.map((component) => ({
    ...component,
    name: ensureRequiredString(component.name, component.id),
    tags: component.tags?.map((tag) => tag.trim()).filter(Boolean),
  }))

  next.ports = next.ports.map((port) => ({
    ...port,
    name: ensureRequiredString(port.name, port.id),
  }))

  next.wires.forEach((wire) => {
    if (wire.source.entityType === 'node') {
      nodeWireMap.get(wire.source.refId)?.push(wire.id)
    }
    if (wire.target.entityType === 'node') {
      nodeWireMap.get(wire.target.refId)?.push(wire.id)
    }
  })

  next.wires = next.wires.map((wire) => ({
    ...wire,
    serialNumber: ensureRequiredString(wire.serialNumber, wire.id),
    route:
      wire.route.kind === 'polyline' && wire.route.bendPoints.length === 0
        ? {
            kind: 'polyline',
            bendPoints: buildDefaultPolylineBendPoints(next, wire),
          }
        : wire.route,
  }))

  next.nodes = next.nodes
    .map((node) => ({
      ...node,
      connectedWireIds: [...(nodeWireMap.get(node.id) ?? [])].sort(),
    }))
    .sort(byId)

  next.annotations = next.annotations
    .map((annotation) => ({
      ...annotation,
      text: ensureRequiredString(annotation.text, annotation.id),
    }))
    .sort(byId)

  next.components = [...next.components].sort(byId)
  next.ports = [...next.ports].sort(byId)
  next.wires = [...next.wires].sort(byId)
  next.document.updatedAt = new Date().toISOString()

  return next
}

export function getEntityTitle(
  entityType: EntityType,
  id: string | undefined,
  document: DocumentFile,
): string {
  if (entityType === 'document') {
    return document.document.title
  }

  if (!id) {
    return 'No selection'
  }

  const entity = findEntity(entityType, id, document)
  if (!entity) {
    return id
  }

  if ('name' in entity && typeof entity.name === 'string') {
    return entity.name
  }

  if ('serialNumber' in entity && typeof entity.serialNumber === 'string') {
    return entity.serialNumber
  }

  if ('text' in entity && typeof entity.text === 'string') {
    return entity.text
  }

  return id
}

export function findEntity(
  entityType: EntityType,
  id: string,
  document: DocumentFile,
):
  | DocumentFile['document']
  | ComponentEntity
  | PortEntity
  | NodeEntity
  | WireEntity
  | AnnotationEntity
  | undefined {
  switch (entityType) {
    case 'document':
      return document.document
    case 'component':
      return document.components.find((item) => item.id === id)
    case 'port':
      return document.ports.find((item) => item.id === id)
    case 'node':
      return document.nodes.find((item) => item.id === id)
    case 'wire':
      return document.wires.find((item) => item.id === id)
    case 'annotation':
      return document.annotations.find((item) => item.id === id)
    default:
      return undefined
  }
}

export function countPortsForComponent(
  componentId: string,
  direction: 'input' | 'output',
  document: DocumentFile,
): number {
  return document.ports.filter(
    (port) => port.componentId === componentId && port.direction === direction,
  ).length
}

export function pointToText(point: Point): string {
  return `${Math.round(point.x)}, ${Math.round(point.y)}`
}

export function endpointRefLabel(endpoint: EndpointRef, document: DocumentFile) {
  if (endpoint.entityType === 'port') {
    const port = document.ports.find((item) => item.id === endpoint.refId)
    return port ? `${port.name} (${endpoint.refId})` : endpoint.refId
  }

  const node = document.nodes.find((item) => item.id === endpoint.refId)
  return node ? node.id : endpoint.refId
}

function byId<T extends { id: string }>(left: T, right: T) {
  return left.id.localeCompare(right.id)
}

function ensureRequiredString(value: string | undefined, fallback: string) {
  if (typeof value === 'string' && value.trim()) {
    return value
  }

  return fallback
}

function buildDefaultPolylineBendPoints(document: DocumentFile, wire: WireEntity): Point[] {
  const sourcePoint = getEndpointPosition(document, wire.source)
  const targetPoint = getEndpointPosition(document, wire.target)

  if (!sourcePoint || !targetPoint) {
    return [{ x: 0, y: 0 }]
  }

  return createDefaultPolylineBendPoints(sourcePoint, targetPoint)
}

function createDefaultPolylineBendPoints(source: Point, target: Point): Point[] {
  const horizontalGap = Math.abs(source.x - target.x)
  const verticalGap = Math.abs(source.y - target.y)

  if (horizontalGap > verticalGap) {
    return [{ x: (source.x + target.x) / 2, y: source.y }]
  }

  return [{ x: source.x, y: (source.y + target.y) / 2 }]
}

export function getComponentRotation(component: ComponentEntity) {
  const root = component.extensions?.[EASYANALYSE_EXTENSION_KEY]
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return 0
  }

  const rotationDeg = (root as Record<string, unknown>).rotationDeg
  return typeof rotationDeg === 'number' && Number.isFinite(rotationDeg)
    ? rotationDeg
    : 0
}

export function setComponentRotation(
  component: ComponentEntity,
  rotationDeg: number,
): ComponentEntity {
  const extensions = {
    ...(component.extensions ?? {}),
    [EASYANALYSE_EXTENSION_KEY]: {
      ...readEasyAnalyseExtension(component.extensions),
      rotationDeg,
    },
  }

  return {
    ...component,
    extensions,
  }
}

function readEasyAnalyseExtension(extensions: DocumentFile['extensions']) {
  const value = extensions?.[EASYANALYSE_EXTENSION_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}
