import { makeId } from './ids'
import { translate } from './i18n'
import { getDefaultShapeForKind, getReferencePrefixForKind } from './deviceSymbols'
import type {
  DeviceDefinition,
  DeviceProperties,
  DeviceShape,
  DeviceViewDefinition,
  DocumentFile,
  EditorSelection,
  EntityType,
  Locale,
  NetworkLineViewDefinition,
  TerminalDefinition,
  TerminalDirection,
} from '../types/document'

const DEFAULT_CANVAS = {
  units: 'px' as const,
  background: 'grid' as const,
  grid: {
    enabled: true,
    size: 36,
    majorEvery: 5,
  },
}

const DESIGNATOR_PATTERN = /^([A-Z]+)(\d+)$/

export function normalizeRotationDeg(value: number) {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function getDefaultDocumentTitle(locale: Locale = 'zh-CN') {
  return translate(locale, 'untitledCircuit')
}

export function buildDefaultDocument(title = getDefaultDocumentTitle()): DocumentFile {
  const timestamp = new Date().toISOString()
  return {
    schemaVersion: '4.0.0',
    document: {
      id: makeId('doc'),
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
      source: 'human',
      language: 'zh-CN',
      tags: [],
    },
    devices: [],
    view: {
      canvas: DEFAULT_CANVAS,
      devices: {},
      networkLines: {},
      focus: {
        preferredDirection: 'left-to-right',
      },
    },
  }
}

export function normalizeDocumentLocal(document: DocumentFile): DocumentFile {
  const next = structuredClone(document)

  next.schemaVersion = '4.0.0'
  next.document.title = ensureRequiredString(
    next.document.title,
    getDefaultDocumentTitle(next.document.language === 'en-US' ? 'en-US' : 'zh-CN'),
  )
  next.document.updatedAt = new Date().toISOString()
  next.document.tags = uniqueNonEmptyStrings(next.document.tags)

  next.devices = next.devices
    .map((device) => ({
      ...device,
      name: ensureRequiredString(device.name, device.id),
      kind: ensureRequiredString(device.kind, 'module'),
      category: cleanOptionalString(device.category),
      description: cleanOptionalString(device.description),
      reference: cleanOptionalString(device.reference),
      tags: uniqueNonEmptyStrings(device.tags),
      properties: normalizeDeviceProperties(device.properties),
      terminals: [...device.terminals]
        .map((terminal) => normalizeTerminal(terminal))
        .sort(compareTerminals),
    }))
    .sort(byId)

  next.view.canvas = {
    ...DEFAULT_CANVAS,
    ...next.view.canvas,
    grid: {
      ...DEFAULT_CANVAS.grid,
      ...(next.view.canvas.grid ?? {}),
    },
  }

  next.view.devices = Object.fromEntries(
    Object.entries(next.view.devices ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([deviceId, view]) => [deviceId, normalizeDeviceView(view)]),
  )
  next.view.networkLines = Object.fromEntries(
    Object.entries(next.view.networkLines ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([networkLineId, view]) => [networkLineId, normalizeNetworkLineView(view)]),
  )

  return next
}

function normalizeTerminal(terminal: TerminalDefinition): TerminalDefinition {
  const flowDirection = getTerminalFlowDirection(terminal)
  return {
    ...terminal,
    name: ensureRequiredString(terminal.name, terminal.id),
    label: cleanOptionalString(terminal.label),
    role: cleanOptionalString(terminal.role),
    description: cleanOptionalString(terminal.description),
    side: terminal.side ?? inferSideFromDirection(flowDirection),
    order:
      typeof terminal.order === 'number' && Number.isFinite(terminal.order)
        ? terminal.order
        : undefined,
  }
}

function normalizeDeviceProperties(properties: DeviceProperties | undefined) {
  if (!properties) {
    return undefined
  }

  const entries = Object.entries(properties).flatMap(([key, value]) => {
    if (typeof value !== 'string') {
      return [[key, value] as const]
    }

    const trimmed = value.trim()
    return trimmed ? [[key, trimmed] as const] : []
  })

  return entries.length ? (Object.fromEntries(entries) as DeviceProperties) : undefined
}

function normalizeDeviceView(view: DeviceViewDefinition): DeviceViewDefinition {
  return {
    ...view,
    shape: view.shape ?? 'rectangle',
    position:
      view.position &&
      Number.isFinite(view.position.x) &&
      Number.isFinite(view.position.y)
        ? view.position
        : undefined,
    size:
      view.size &&
      Number.isFinite(view.size.width) &&
      Number.isFinite(view.size.height)
        ? {
            width: Math.max(140, view.size.width),
            height: Math.max(92, view.size.height),
          }
        : undefined,
    rotationDeg:
      typeof view.rotationDeg === 'number' && Number.isFinite(view.rotationDeg)
        ? normalizeRotationDeg(view.rotationDeg)
        : undefined,
    groupId: cleanOptionalString(view.groupId),
  }
}

function normalizeNetworkLineView(view: NetworkLineViewDefinition): NetworkLineViewDefinition {
  return {
    ...view,
    label: typeof view.label === 'string' ? view.label.trim() : '',
    position:
      view.position &&
      Number.isFinite(view.position.x) &&
      Number.isFinite(view.position.y)
        ? view.position
        : { x: 0, y: 0 },
    length:
      typeof view.length === 'number' && Number.isFinite(view.length) && view.length > 0
        ? Math.min(2400, Math.max(120, view.length))
        : undefined,
    orientation: view.orientation === 'vertical' ? 'vertical' : 'horizontal',
  }
}

function ensureRequiredString(value: string | undefined, fallback: string) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  return fallback
}

function cleanOptionalString(value: string | undefined) {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed || undefined
}

function uniqueNonEmptyStrings(values: string[] | undefined) {
  if (!values?.length) {
    return []
  }

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

function byId<T extends { id: string }>(left: T, right: T) {
  return left.id.localeCompare(right.id)
}

function compareTerminals(left: TerminalDefinition, right: TerminalDefinition) {
  const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER
  const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER
  return (
    leftOrder - rightOrder ||
    inferSideRank(left.side) - inferSideRank(right.side) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  )
}

function inferSideRank(side: TerminalDefinition['side']) {
  switch (side) {
    case 'left':
      return 0
    case 'right':
      return 1
    case 'top':
      return 2
    case 'bottom':
      return 3
    default:
      return 4
  }
}

export function inferSideFromDirection(direction: TerminalDirection) {
  return direction === 'output' ? ('right' as const) : ('left' as const)
}

export function collapseTerminalDirection(direction: TerminalDirection) {
  return direction
}

export function getTerminalFlowDirection(
  terminal: Pick<TerminalDefinition, 'direction'>,
): TerminalDirection {
  return terminal.direction
}

export function isSourceLikeDirection(direction: TerminalDirection) {
  return collapseTerminalDirection(direction) === 'output'
}

export function isSinkLikeDirection(direction: TerminalDirection) {
  return collapseTerminalDirection(direction) === 'input'
}

export function isFlexibleDirection(direction: TerminalDirection) {
  return !isSourceLikeDirection(direction) && !isSinkLikeDirection(direction)
}

export function getTerminalLabelIntent(
  terminals: Array<{ flowDirection: TerminalDirection }>,
): 'upstream' | 'downstream' | null {
  const hasSource = terminals.some((terminal) => isSourceLikeDirection(terminal.flowDirection))
  const hasSink = terminals.some((terminal) => isSinkLikeDirection(terminal.flowDirection))

  if (hasSink && !hasSource) {
    return 'upstream'
  }

  if (hasSource && !hasSink) {
    return 'downstream'
  }

  return null
}

export function inferPeerLabelIntent(
  terminals: Array<{ direction: TerminalDirection }>,
): 'upstream' | 'downstream' | null {
  const hasSource = terminals.some((terminal) => isSourceLikeDirection(terminal.direction))
  const hasSink = terminals.some((terminal) => isSinkLikeDirection(terminal.direction))

  if (hasSource && !hasSink) {
    return 'upstream'
  }

  if (hasSink && !hasSource) {
    return 'downstream'
  }

  return null
}

export function resolveSharedLabelBucket(
  intent: 'upstream' | 'downstream' | null,
  terminals: Array<{ direction: TerminalDirection }>,
): 'upstream' | 'downstream' | null {
  if (!intent) {
    return null
  }

  const hasSource = terminals.some((terminal) => isSourceLikeDirection(terminal.direction))
  const hasSink = terminals.some((terminal) => isSinkLikeDirection(terminal.direction))
  const hasFlexible = terminals.some((terminal) => isFlexibleDirection(terminal.direction))

  if (intent === 'upstream') {
    if (hasSource && !hasSink) {
      return 'upstream'
    }
    if (!hasSource && !hasSink && hasFlexible) {
      return 'upstream'
    }
    return null
  }

  if (hasSink && !hasSource) {
    return 'downstream'
  }
  if (!hasSource && !hasSink && hasFlexible) {
    return 'downstream'
  }
  return null
}

export function normalizeTerminalLabel(label: string | undefined) {
  return cleanOptionalString(label) ?? null
}

function getTerminalPinSummary(terminal: TerminalDefinition) {
  const number = cleanOptionalString(terminal.pin?.number)
  const name = cleanOptionalString(terminal.pin?.name)
  if (!number && !name) {
    return null
  }

  return [number, name].filter((value): value is string => Boolean(value)).join(':')
}

export function getTerminalDisplayLabel(terminal: TerminalDefinition) {
  const base = terminal.label?.trim() || terminal.name
  const pinSummary = getTerminalPinSummary(terminal)
  return pinSummary ? `${base} [${pinSummary}]` : base
}

export function getDeviceReference(device: DeviceDefinition, document: DocumentFile) {
  const explicit = cleanOptionalString(device.reference)
  if (explicit) {
    return explicit
  }

  return buildDeviceReferenceMap(document).get(device.id) ?? device.id
}

export function buildDeviceReferenceMap(document: DocumentFile) {
  const references = new Map<string, string>()
  const usedNumbersByPrefix = new Map<string, Set<number>>()
  const pendingByPrefix = new Map<string, DeviceDefinition[]>()

  for (const device of document.devices) {
    const explicit = cleanOptionalString(device.reference)
    if (explicit) {
      references.set(device.id, explicit)
      const match = explicit.match(DESIGNATOR_PATTERN)
      if (match) {
        const [, prefix, indexText] = match
        const bucket = usedNumbersByPrefix.get(prefix) ?? new Set<number>()
        bucket.add(Number(indexText))
        usedNumbersByPrefix.set(prefix, bucket)
      }
      continue
    }

    const prefix = inferReferencePrefix(device)
    const bucket = pendingByPrefix.get(prefix) ?? []
    bucket.push(device)
    pendingByPrefix.set(prefix, bucket)
  }

  for (const [prefix, devices] of [...pendingByPrefix.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    const used = usedNumbersByPrefix.get(prefix) ?? new Set<number>()
    let nextIndex = 1

    for (const device of [...devices].sort((left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    )) {
      while (used.has(nextIndex)) {
        nextIndex += 1
      }

      const reference = `${prefix}${nextIndex}`
      references.set(device.id, reference)
      used.add(nextIndex)
      nextIndex += 1
    }
  }

  return references
}

export function findNextDeviceReference(document: DocumentFile, prefix: string) {
  const normalizedPrefix = prefix.trim().replace(/[^A-Za-z]/g, '').toUpperCase() || 'U'
  const used = new Set<number>()

  for (const reference of buildDeviceReferenceMap(document).values()) {
    const match = reference.match(DESIGNATOR_PATTERN)
    if (!match || match[1] !== normalizedPrefix) {
      continue
    }

    used.add(Number(match[2]))
  }

  let index = 1
  while (used.has(index)) {
    index += 1
  }

  return `${normalizedPrefix}${index}`
}

export function buildDefaultTerminalIdentity(
  direction: TerminalDirection,
  order: number,
  reference: string,
) {
  const directionToken = direction.toUpperCase().replace(/-/g, '_')
  const suffix = reference.trim().toUpperCase() || 'U'
  const value = `${directionToken}_${order}_${suffix}`
  return {
    name: value,
    label: value,
  }
}

function inferReferencePrefix(device: DeviceDefinition) {
  return getReferencePrefixForKind(device)
}

export function getDeviceView(
  document: DocumentFile,
  deviceId: string,
): Required<Pick<DeviceViewDefinition, 'shape'>> & DeviceViewDefinition {
  const current = document.view.devices?.[deviceId] ?? {}
  return {
    shape: current.shape ?? 'rectangle',
    ...current,
  }
}

export function getNetworkLineView(
  document: DocumentFile,
  networkLineId: string,
): NetworkLineViewDefinition | undefined {
  return document.view.networkLines?.[networkLineId]
}

export function collectTerminalLabels(
  document: DocumentFile,
  options?: { excludeTerminalId?: string },
) {
  return [
    ...new Set(
      document.devices.flatMap((device) =>
        device.terminals
          .filter((terminal) => terminal.id !== options?.excludeTerminalId)
          .map((terminal) => normalizeTerminalLabel(terminal.label))
          .filter((label): label is string => Boolean(label)),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right))
}

export function countDistinctTerminalLabels(document: DocumentFile) {
  return collectTerminalLabels(document).length
}

export function findEntity(
  document: DocumentFile,
  selection: EditorSelection | null,
) {
  if (!selection) {
    return document.document
  }

  switch (selection.entityType) {
    case 'document':
      return document.document
    case 'device':
      return document.devices.find((device) => device.id === selection.id)
    case 'deviceGroup':
      return document.devices.filter((device) => selection.ids.includes(device.id))
    case 'networkLine':
      return document.view.networkLines?.[selection.id]
    case 'terminal':
      return document.devices
        .flatMap((device) => device.terminals)
        .find((terminal) => terminal.id === selection.id)
    default:
      return undefined
  }
}

export function getEntityTitle(
  document: DocumentFile,
  entityType: EntityType,
  id: string | undefined,
  locale: Locale,
) {
  if (entityType === 'document') {
    return document.document.title
  }

  if (!id) {
    return translate(locale, 'noSelection')
  }

  if (entityType === 'device') {
    const device = document.devices.find((item) => item.id === id)
    return device ? `${getDeviceReference(device, document)} ${device.name}` : id
  }

  if (entityType === 'deviceGroup') {
    return locale === 'zh-CN' ? '多器件选择' : 'Multiple devices'
  }

  if (entityType === 'networkLine') {
    const networkLine = document.view.networkLines?.[id]
    return networkLine?.label?.trim() ? networkLine.label.trim() : id
  }

  const terminal = document.devices
    .flatMap((device) => device.terminals.map((item) => ({ device, terminal: item })))
    .find((item) => item.terminal.id === id)
  if (!terminal) {
    return id
  }

  return `${getDeviceReference(terminal.device, document)}.${getTerminalDisplayLabel(terminal.terminal)}`
}

export function getDefaultShape(kind: string): DeviceShape {
  return getDefaultShapeForKind(kind)
}
