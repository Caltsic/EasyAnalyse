export type EntityType = 'document' | 'device' | 'terminal' | 'networkLine'

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

export type TerminalDirection =
  | 'input'
  | 'output'
  | 'bidirectional'
  | 'passive'
  | 'power-in'
  | 'power-out'
  | 'ground'
  | 'shield'
  | 'unspecified'

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

export interface DeviceDefinition {
  id: string
  name: string
  kind: string
  category?: string
  description?: string
  reference?: string
  tags?: string[]
  properties?: ExtensionsMap
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

export interface EditorSelection {
  entityType: EntityType
  id?: string
}

export type Locale = 'zh-CN' | 'en-US'
