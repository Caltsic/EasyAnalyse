export type EntityType = 'document' | 'device' | 'deviceGroup' | 'terminal' | 'networkLine'

export type DocumentFormat = 'semantic-v4' | 'unknown'

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export type ExtensionsMap = Record<string, unknown>

export interface DocumentMeta {
  id: string
  title: string
  description?: string
  createdAt?: string
  updatedAt?: string
  source?: 'human' | 'ai' | 'mixed' | 'imported'
  language?: string
  tags?: string[]
  extensions?: ExtensionsMap
}

export interface CanvasGrid {
  enabled: boolean
  size: number
  majorEvery?: number
}

export interface CanvasViewDefinition {
  units: 'px'
  grid?: CanvasGrid
  background?: 'grid'
  extensions?: ExtensionsMap
}

export type DeviceShape = 'rectangle' | 'circle' | 'triangle'

export type TerminalDirection = 'input' | 'output'

export type TerminalSide = 'left' | 'right' | 'top' | 'bottom' | 'auto'

export interface TerminalPin {
  number?: string
  name?: string
  bank?: string
  extensions?: ExtensionsMap
}

export interface TerminalDefinition {
  id: string
  name: string
  label?: string
  direction: TerminalDirection
  role?: string
  description?: string
  pin?: TerminalPin
  required?: boolean
  side?: TerminalSide
  order?: number
  extensions?: ExtensionsMap
}

export interface DeviceProperties extends ExtensionsMap {
  value?: string
  voltage?: string
  outputVoltage?: string
  nominalVoltage?: string
  frequency?: string
  partNumber?: string
  package?: string
  topology?: string
}

export interface DeviceDefinition {
  id: string
  name: string
  kind: string
  category?: string
  description?: string
  reference?: string
  tags?: string[]
  properties?: DeviceProperties
  terminals: TerminalDefinition[]
  extensions?: ExtensionsMap
}

export interface DeviceViewDefinition {
  position?: Point
  size?: Size
  rotationDeg?: number
  shape?: DeviceShape
  locked?: boolean
  collapsed?: boolean
  groupId?: string
  extensions?: ExtensionsMap
}

export type NetworkLineOrientation = 'horizontal' | 'vertical'

export interface NetworkLineViewDefinition {
  label: string
  position: Point
  length?: number
  orientation?: NetworkLineOrientation
  extensions?: ExtensionsMap
}

export interface FocusViewDefinition {
  defaultDeviceId?: string
  preferredDirection?: 'left-to-right' | 'top-to-bottom' | 'auto'
  extensions?: ExtensionsMap
}

export interface ViewDefinition {
  canvas: CanvasViewDefinition
  devices?: Record<string, DeviceViewDefinition>
  networkLines?: Record<string, NetworkLineViewDefinition>
  focus?: FocusViewDefinition
  extensions?: ExtensionsMap
}

export interface DocumentFile {
  schemaVersion: '4.0.0'
  document: DocumentMeta
  devices: DeviceDefinition[]
  view: ViewDefinition
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
  detectedFormat: DocumentFormat
  schemaValid: boolean
  semanticValid: boolean
  issueCount: number
  issues: ValidationIssue[]
  normalizedDocument?: DocumentFile | null
}

export interface OpenDocumentResult {
  document: DocumentFile | null
  report: ValidationReport
  path: string | null
}

export interface SaveDocumentResult {
  path: string
  report: ValidationReport
}

export interface MobileShareSession {
  url: string
  appUrl: string
  snapshotUrl: string
  host: string
  port: number
  alternateUrls: string[]
  expiresAt: string
  createdAt: string
  title: string
  issueCount: number
  schemaValid: boolean
  semanticValid: boolean
  qrSvg: string
}

export interface MobileSharePayload {
  document: DocumentFile
  report: ValidationReport
  snapshot?: MobileRenderSnapshot
  createdAt: string
  expiresAt: string
}

export interface MobileRenderSnapshot {
  schemaVersion: 'mobile-render-v1'
  generatedAt: string
  orientation: 'landscape'
  sourceSchemaVersion: DocumentFile['schemaVersion']
  document: Pick<DocumentMeta, 'id' | 'title' | 'description' | 'createdAt' | 'updatedAt'>
  canvas: {
    units: CanvasViewDefinition['units']
    background?: CanvasViewDefinition['background']
    grid?: CanvasGrid
    worldBounds: { x: number; y: number; width: number; height: number }
  }
  devices: MobileSnapshotDevice[]
  networkLines: MobileSnapshotNetworkLine[]
  connectionGroups: MobileSnapshotConnectionGroup[]
  relations: MobileSnapshotRelation[]
  searchIndex: MobileSnapshotSearchItem[]
  validation: {
    schemaValid: boolean
    semanticValid: boolean
    issueCount: number
    issues: ValidationIssue[]
  }
}

export interface MobileSnapshotDevice {
  id: string
  reference: string
  title: string
  name: string
  kind: string
  visualKind: string
  shape: DeviceShape
  rotationDeg: number
  bounds: { x: number; y: number; width: number; height: number }
  center: Point
  description?: string
  properties?: DeviceProperties
  symbolAccent?: string
  symbolPrimitives?: MobileSymbolPrimitive[]
  terminals: MobileSnapshotTerminal[]
}

export type MobileSymbolPrimitive =
  | {
      type: 'line'
      points: number[]
      stroke: 'stroke' | 'accent'
      strokeWidth: number
      closed?: boolean
      fill?: 'stroke' | 'accent' | string
      dash?: number[]
      tension?: number
    }
  | {
      type: 'rect'
      x: number
      y: number
      width: number
      height: number
      radius?: number
      stroke?: 'stroke' | 'accent'
      strokeWidth?: number
      fill?: 'stroke' | 'accent' | string
    }
  | {
      type: 'circle'
      x: number
      y: number
      radius: number
      stroke?: 'stroke' | 'accent'
      strokeWidth?: number
      fill?: 'stroke' | 'accent' | string
    }
  | {
      type: 'text'
      x: number
      y: number
      text: string
      fill: 'stroke' | 'accent'
      fontSize: number
      bold?: boolean
    }

export interface MobileSnapshotTerminal {
  id: string
  deviceId: string
  name: string
  displayLabel: string
  connectionLabel?: string
  direction: TerminalDirection
  flowDirection: TerminalDirection
  side: TerminalSide
  point: Point
  role?: string
  description?: string
  pin?: TerminalPin
  color: {
    fill: string
    stroke: string
    text: string
  }
}

export interface MobileSnapshotNetworkLine {
  id: string
  label: string
  labelKey: string
  position: Point
  start: Point
  end: Point
  length: number
  orientation: NetworkLineOrientation
}

export interface MobileSnapshotConnectionGroup {
  key: string
  label: string
  terminalIds: string[]
  deviceIds: string[]
  point: Point
}

export interface MobileSnapshotRelation {
  deviceId: string
  title: string
  upstreamDeviceIds: string[]
  downstreamDeviceIds: string[]
  relatedTerminalIds: string[]
  connectionKeys: string[]
  connectionLabels: string[]
  upstreamLabels: string[]
  downstreamLabels: string[]
}

export interface MobileSnapshotSearchItem {
  id: string
  type: 'device' | 'networkLine' | 'connectionGroup' | 'terminal'
  label: string
  subtitle?: string
  targetId: string
}

export type EditorSelection =
  | {
      entityType: 'document'
    }
  | {
      entityType: 'device'
      id: string
    }
  | {
      entityType: 'deviceGroup'
      ids: string[]
    }
  | {
      entityType: 'terminal'
      id: string
    }
  | {
      entityType: 'networkLine'
      id: string
    }

export type Locale = 'zh-CN' | 'en-US'
