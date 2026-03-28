export type EntityType =
  | 'document'
  | 'component'
  | 'port'
  | 'node'
  | 'wire'
  | 'annotation'

export interface Point {
  x: number
  y: number
}

export type ExtensionsMap = Record<string, unknown>

export interface DocumentMeta {
  id: string
  title: string
  description?: string
  createdAt?: string
  updatedAt?: string
  source?: 'human' | 'ai' | 'mixed' | 'imported'
  extensions?: ExtensionsMap
}

export interface CanvasGrid {
  enabled: boolean
  size: number
}

export interface CanvasDefinition {
  origin: Point
  width: number
  height: number
  units: 'px'
  grid?: CanvasGrid
  extensions?: ExtensionsMap
}

export type ComponentGeometry =
  | {
      type: 'rectangle'
      x: number
      y: number
      width: number
      height: number
    }
  | {
      type: 'circle'
      cx: number
      cy: number
      radius: number
    }
  | {
      type: 'triangle'
      vertices: [Point, Point, Point]
    }

export interface ComponentEntity {
  id: string
  name: string
  geometry: ComponentGeometry
  description?: string
  tags?: string[]
  extensions?: ExtensionsMap
}

export type PortAnchor =
  | {
      kind: 'rectangle-side'
      side: 'top' | 'right' | 'bottom' | 'left'
      offset: number
    }
  | {
      kind: 'circle-angle'
      angleDeg: number
    }
  | {
      kind: 'triangle-edge'
      edgeIndex: 0 | 1 | 2
      offset: number
    }

export interface PinInfo {
  number?: string
  label?: string
  description?: string
}

export interface PortEntity {
  id: string
  componentId: string
  name: string
  direction: 'input' | 'output'
  pinInfo?: PinInfo
  anchor: PortAnchor
  description?: string
  extensions?: ExtensionsMap
}

export interface NodeEntity {
  id: string
  position: Point
  connectedWireIds: string[]
  role?: 'generic' | 'junction' | 'branch'
  description?: string
  extensions?: ExtensionsMap
}

export interface EndpointRef {
  entityType: 'port' | 'node'
  refId: string
}

export type Route =
  | {
      kind: 'straight'
    }
  | {
      kind: 'polyline'
      bendPoints: Point[]
    }

export interface WireEntity {
  id: string
  serialNumber: string
  source: EndpointRef
  target: EndpointRef
  route: Route
  description?: string
  extensions?: ExtensionsMap
}

export interface AnnotationTarget {
  entityType: Exclude<EntityType, 'document' | 'annotation'>
  refId: string
}

export interface AnnotationEntity {
  id: string
  kind: 'signal' | 'note' | 'label'
  target: AnnotationTarget
  text: string
  position?: Point
  extensions?: ExtensionsMap
}

export interface DocumentFile {
  schemaVersion: '1.0.0'
  document: DocumentMeta
  canvas: CanvasDefinition
  components: ComponentEntity[]
  ports: PortEntity[]
  nodes: NodeEntity[]
  wires: WireEntity[]
  annotations: AnnotationEntity[]
  extensions?: ExtensionsMap
}

export interface ValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  entityId?: string | null
  path?: string | null
}

export interface ValidationReport {
  schemaValid: boolean
  semanticValid: boolean
  issueCount: number
  issues: ValidationIssue[]
  normalizedDocument?: DocumentFile | null
}

export interface DiffBucket {
  added: number
  removed: number
  changed: number
}

export interface DiffSummary {
  components: DiffBucket
  ports: DiffBucket
  nodes: DiffBucket
  wires: DiffBucket
  annotations: DiffBucket
  totalChanges: number
}

export interface OpenDocumentResult {
  document: DocumentFile
  report: ValidationReport
  path: string | null
}

export interface SaveDocumentResult {
  path: string
  report: ValidationReport
}

export interface EditorSelection {
  entityType: EntityType
  id?: string
}

export type Locale = 'zh-CN' | 'en-US'

export type PlacementMode =
  | {
      kind: 'component'
      shape: ComponentGeometry['type']
    }
  | {
      kind: 'node'
    }
