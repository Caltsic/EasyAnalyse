import {
  getDefaultShape,
  getDeviceReference,
  getDeviceView,
  getNetworkLineView,
  getTerminalLabelIntent,
  getTerminalDisplayLabel,
  getTerminalFlowDirection,
  inferPeerLabelIntent,
  inferSideFromDirection,
  isSourceLikeDirection,
  resolveSharedLabelBucket,
  normalizeRotationDeg,
  normalizeTerminalLabel,
} from './document'
import { getDeviceVisualPreset, type DeviceVisualKind } from './deviceSymbols'
import { getBoundsCenter, getSignalPoint, getStoredTerminalAnchor, projectPointToShapeEdge } from './geometry'
import { translate } from './i18n'
import type {
  DeviceDefinition,
  DeviceShape,
  DocumentFile,
  Locale,
  NetworkLineOrientation,
  NetworkLineViewDefinition,
  Point,
  TerminalDefinition,
  TerminalDirection,
  TerminalSide,
} from '../types/document'

const DEFAULT_WIDTH = 220
const DEFAULT_HEIGHT = 136
const CLUSTER_GAP_X = 360
const CLUSTER_GAP_Y = 280
const COLUMN_GAP_X = 300
const ROW_GAP_Y = 190
const MARGIN_X = 200
const MARGIN_Y = 180

const SPECIAL_LABEL_COLORS: Record<string, string> = {
  VCC: '#2563EB',
  GND: '#0F766E',
  '3V3': '#7C3AED',
  '5V': '#DC2626',
  VIN: '#EA580C',
  SCL: '#F59E0B',
  SDA: '#EC4899',
  TX: '#16A34A',
  RX: '#0EA5E9',
  CS: '#EF4444',
  SCK: '#D97706',
  MOSI: '#14B8A6',
  MISO: '#8B5CF6',
}

const COLOR_BLACK = '#000000'
const COLOR_WHITE = '#FFFFFF'

export interface DerivedTerminalColor {
  key: string
  fill: string
  stroke: string
  glow: string
  text: string
}

export interface DerivedTerminal {
  id: string
  deviceId: string
  direction: TerminalDirection
  flowDirection: TerminalDirection
  side: TerminalSide
  displayLabel: string
  connectionLabel: string | null
  name: string
  description: string | null
  point: Point
  source: TerminalDefinition
}

export interface DerivedNetworkLine {
  id: string
  label: string
  labelKey: string
  position: Point
  length: number
  orientation: NetworkLineOrientation
  start: Point
  end: Point
  source: NetworkLineViewDefinition
}

export interface DerivedConnectionGroup {
  key: string
  label: string
  terminalIds: string[]
  deviceIds: string[]
  point: Point
}

export interface DerivedDevice {
  id: string
  reference: string
  title: string
  parameterSummary: string | null
  kind: string
  visualKind: DeviceVisualKind
  shape: DeviceShape
  rotationDeg: number
  bounds: { x: number; y: number; width: number; height: number }
  center: Point
  terminals: DerivedTerminal[]
  connectionLabels: string[]
  source: DeviceDefinition
}

export interface DeviceRelationSummary {
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

export interface FocusSummary {
  deviceId: string
  title: string
  upstreamCount: number
  downstreamCount: number
  labelCount: number
  summaryText: string
}

export interface ConnectionHighlight {
  key: string
  deviceIds: string[]
  terminalIds: string[]
}

export interface CircuitInsights {
  devices: DerivedDevice[]
  networkLines: DerivedNetworkLine[]
  connectionGroups: DerivedConnectionGroup[]
  deviceById: Record<string, DerivedDevice>
  terminalById: Record<string, DerivedTerminal>
  networkLineById: Record<string, DerivedNetworkLine>
  networkLinesByLabel: Record<string, DerivedNetworkLine[]>
  terminalColorsById: Record<string, DerivedTerminalColor>
  deviceRelationsById: Record<string, DeviceRelationSummary>
  focusSummariesByDeviceId: Record<string, FocusSummary>
  connectionHighlightsByKey: Record<string, ConnectionHighlight>
  labelSuggestions: string[]
}

export function deriveCircuitInsights(
  document: DocumentFile,
  locale: Locale = 'zh-CN',
): CircuitInsights {
  const deviceLayouts = resolveDeviceLayouts(document)
  const devices = document.devices
    .map((device) => buildDerivedDevice(device, document, deviceLayouts))
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
  const deviceById = Object.fromEntries(devices.map((device) => [device.id, device]))
  const terminalById = Object.fromEntries(
    devices.flatMap((device) => device.terminals.map((terminal) => [terminal.id, terminal] as const)),
  )
  const networkLines = deriveNetworkLines(document)
  const networkLineById = Object.fromEntries(
    networkLines.map((networkLine) => [networkLine.id, networkLine] as const),
  )
  const networkLinesByLabel = Object.fromEntries(
    Object.entries(
      networkLines.reduce<Record<string, DerivedNetworkLine[]>>((accumulator, networkLine) => {
        const bucket = accumulator[networkLine.labelKey] ?? []
        bucket.push(networkLine)
        accumulator[networkLine.labelKey] = bucket
        return accumulator
      }, {}),
    ).map(([label, items]) => [
      label,
      items.sort((left, right) => left.id.localeCompare(right.id)),
    ]),
  )
  const connectionGroups = deriveConnectionGroups(devices)
  const connectionGroupByKey = Object.fromEntries(
    connectionGroups.map((group) => [group.key, group] as const),
  )
  const terminalColorByKey = buildTerminalColorMap(devices)
  const terminalColorsById = Object.fromEntries(
    devices.flatMap((device) =>
      device.terminals.map((terminal) => [
        terminal.id,
        terminalColorByKey[terminal.connectionLabel ?? terminal.id]!,
      ] as const),
    ),
  )
  const deviceRelationsById = deriveDeviceRelations(deviceById, connectionGroupByKey, locale)
  const focusSummariesByDeviceId = Object.fromEntries(
    Object.values(deviceRelationsById).map((relation) => [
      relation.deviceId,
      {
        deviceId: relation.deviceId,
        title: relation.title,
        upstreamCount: relation.upstreamDeviceIds.length,
        downstreamCount: relation.downstreamDeviceIds.length,
        labelCount: relation.connectionKeys.length,
        summaryText: translate(locale, 'focusSummary', {
          upstream: relation.upstreamDeviceIds.length,
          downstream: relation.downstreamDeviceIds.length,
          labels: relation.connectionKeys.length,
        }),
      } satisfies FocusSummary,
    ]),
  )
  const connectionHighlightsByKey = Object.fromEntries(
    connectionGroups.map((group) => [
      group.key,
      {
        key: group.key,
        deviceIds: group.deviceIds,
        terminalIds: group.terminalIds,
      } satisfies ConnectionHighlight,
    ]),
  )

  return {
    devices,
    networkLines,
    connectionGroups,
    deviceById,
    terminalById,
    networkLineById,
    networkLinesByLabel,
    terminalColorsById,
    deviceRelationsById,
    focusSummariesByDeviceId,
    connectionHighlightsByKey,
    labelSuggestions: connectionGroups.map((group) => group.label).sort((left, right) => left.localeCompare(right)),
  }
}

function resolveDeviceLayouts(document: DocumentFile) {
  const adjacency = buildAdjacency(document)
  const explicit = new Map<string, Point>()
  const pending = new Set<string>()

  for (const device of document.devices) {
    const view = getDeviceView(document, device.id)
    if (
      view.position &&
      Number.isFinite(view.position.x) &&
      Number.isFinite(view.position.y)
    ) {
      explicit.set(device.id, view.position)
    } else {
      pending.add(device.id)
    }
  }

  const groups = connectedComponents(adjacency).map((group) =>
    group.filter((deviceId) => pending.has(deviceId)),
  )
  const auto = new Map<string, Point>()
  let clusterIndex = 0

  for (const group of groups) {
    if (!group.length) {
      continue
    }

    const baseX = MARGIN_X + (clusterIndex % 3) * (CLUSTER_GAP_X * 2)
    const baseY = MARGIN_Y + Math.floor(clusterIndex / 3) * (CLUSTER_GAP_Y * 2)
    const root = group[0]!
    const queue = [root]
    const visited = new Set<string>([root])
    const layers = new Map<string, number>([[root, 0]])

    while (queue.length) {
      const current = queue.shift()!
      const currentLayer = layers.get(current) ?? 0
      for (const next of adjacency.get(current) ?? []) {
        if (!group.includes(next) || visited.has(next)) {
          continue
        }

        visited.add(next)
        layers.set(next, currentLayer + 1)
        queue.push(next)
      }
    }

    const byLayer = new Map<number, string[]>()
    for (const deviceId of group) {
      const layer = layers.get(deviceId) ?? 0
      const bucket = byLayer.get(layer) ?? []
      bucket.push(deviceId)
      byLayer.set(layer, bucket)
    }

    for (const [layer, deviceIds] of [...byLayer.entries()].sort((left, right) => left[0] - right[0])) {
      deviceIds.sort()
      deviceIds.forEach((deviceId, index) => {
        auto.set(deviceId, {
          x: baseX + layer * COLUMN_GAP_X,
          y: baseY + index * ROW_GAP_Y,
        })
      })
    }

    clusterIndex += 1
  }

  return new Map([...auto.entries(), ...explicit.entries()])
}

function buildAdjacency(document: DocumentFile) {
  const labelMembers = new Map<string, Set<string>>()
  for (const device of document.devices) {
    for (const terminal of device.terminals) {
      const connectionLabel = normalizeTerminalLabel(terminal.label)
      if (!connectionLabel) {
        continue
      }

      const bucket = labelMembers.get(connectionLabel) ?? new Set<string>()
      bucket.add(device.id)
      labelMembers.set(connectionLabel, bucket)
    }
  }

  const adjacency = new Map<string, Set<string>>()
  for (const device of document.devices) {
    adjacency.set(device.id, new Set())
  }

  for (const memberIds of labelMembers.values()) {
    const ids = [...memberIds]
    for (const source of ids) {
      const bucket = adjacency.get(source)
      if (!bucket) {
        continue
      }
      for (const target of ids) {
        if (target !== source) {
          bucket.add(target)
        }
      }
    }
  }

  return adjacency
}

function connectedComponents(adjacency: Map<string, Set<string>>) {
  const remaining = new Set(adjacency.keys())
  const groups: string[][] = []

  while (remaining.size) {
    const start = remaining.values().next().value as string
    remaining.delete(start)
    const queue = [start]
    const group: string[] = []

    while (queue.length) {
      const current = queue.shift()!
      group.push(current)

      for (const next of adjacency.get(current) ?? []) {
        if (!remaining.has(next)) {
          continue
        }

        remaining.delete(next)
        queue.push(next)
      }
    }

    groups.push(group.sort())
  }

  return groups.sort((left, right) => right.length - left.length || left[0]!.localeCompare(right[0]!))
}

function buildDerivedDevice(
  device: DeviceDefinition,
  document: DocumentFile,
  layouts: Map<string, Point>,
): DerivedDevice {
  const view = getDeviceView(document, device.id)
  const visualPreset = getDeviceVisualPreset(device)
  const shape = view.shape ?? getDefaultShape(device.kind)

  const terminalsBySide = new Map<TerminalSide, TerminalDefinition[]>()
  for (const terminal of device.terminals) {
    const side = terminal.side ?? inferSideFromDirection(getTerminalFlowDirection(terminal))
    const bucket = terminalsBySide.get(side) ?? []
    bucket.push({ ...terminal, side })
    terminalsBySide.set(side, bucket)
  }

  for (const bucket of terminalsBySide.values()) {
    bucket.sort((left, right) => {
      const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER
      const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    })
  }

  const leftCount = terminalsBySide.get('left')?.length ?? 0
  const rightCount = terminalsBySide.get('right')?.length ?? 0
  const topCount = terminalsBySide.get('top')?.length ?? 0
  const bottomCount = terminalsBySide.get('bottom')?.length ?? 0
  const maxVerticalCount = Math.max(leftCount, rightCount)
  const maxHorizontalCount = Math.max(topCount, bottomCount)
  const width = Math.max(
    150,
    view.size?.width ?? visualPreset.defaultSize.width ?? DEFAULT_WIDTH,
    maxHorizontalCount > 2 ? 112 + maxHorizontalCount * 64 : 0,
  )
  const height = Math.max(
    96,
    view.size?.height ?? visualPreset.defaultSize.height ?? DEFAULT_HEIGHT,
    maxVerticalCount > 2 ? 88 + maxVerticalCount * 26 : 0,
  )
  const position = layouts.get(device.id) ?? { x: MARGIN_X, y: MARGIN_Y }
  const rotationDeg = normalizeRotationDeg(view.rotationDeg ?? 0)
  const bounds = {
    x: position.x,
    y: position.y,
    width,
    height,
  }

  const terminals = device.terminals.map((terminal) => {
    const flowDirection = getTerminalFlowDirection(terminal)
    const side = terminal.side ?? inferSideFromDirection(flowDirection)
    const bucket = terminalsBySide.get(side) ?? [terminal]
    const index = bucket.findIndex((candidate) => candidate.id === terminal.id)
    const storedAnchor = getStoredTerminalAnchor(terminal)
    const placement = storedAnchor
      ? projectPointToShapeEdge(
          {
            x: bounds.x + storedAnchor.x * bounds.width,
            y: bounds.y + storedAnchor.y * bounds.height,
          },
          bounds,
          shape,
          visualPreset.key,
        )
      : null
    const resolvedSide = placement?.side ?? side
    const point =
      placement?.point ?? getSignalPoint(bounds, shape, side, Math.max(0, index), bucket.length, visualPreset.key)

    return {
      id: terminal.id,
      deviceId: device.id,
      direction: terminal.direction,
      flowDirection,
      side: resolvedSide,
      displayLabel: getTerminalDisplayLabel(terminal),
      connectionLabel: normalizeTerminalLabel(terminal.label),
      name: terminal.name,
      description: terminal.description ?? null,
      point,
      source: terminal,
    } satisfies DerivedTerminal
  })

  const reference = getDeviceReference(device, document)
  const parameterSummary = summarizeDeviceParameter(device, document)
  const connectionLabels = [
    ...new Set(
      terminals
        .map((terminal) => terminal.connectionLabel)
        .filter((label): label is string => Boolean(label)),
    ),
  ].sort((left, right) => left.localeCompare(right))

  return {
    id: device.id,
    reference,
    title: `${reference} ${device.name}`,
    parameterSummary,
    kind: device.kind,
    visualKind: visualPreset.key,
    shape,
    rotationDeg,
    bounds,
    center: getBoundsCenter(bounds),
    terminals,
    connectionLabels,
    source: device,
  }
}

function summarizeDeviceParameter(device: DeviceDefinition, document: DocumentFile) {
  const properties = device.properties
  const direct =
    getPropertyText(properties?.value) ??
    getPropertyText(properties?.frequency) ??
    getPropertyText(properties?.outputVoltage) ??
    getPropertyText(properties?.nominalVoltage) ??
    getPropertyText(properties?.voltage)

  if (direct) {
    return direct
  }

  const powerSummaries = device.terminals
    .filter((terminal) => isPowerLikeLabel(terminal.label))
    .map((terminal) => summarizePowerLabel(terminal.label, document))
    .filter((label): label is string => Boolean(label))

  const uniquePowerSummaries = [...new Set(powerSummaries)]
  if (uniquePowerSummaries.length === 0) {
    return null
  }

  return uniquePowerSummaries.slice(0, 2).join(' / ')
}

function getPropertyText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function summarizePowerLabel(label: string | undefined, document: DocumentFile) {
  const normalized = normalizeTerminalLabel(label)
  if (!normalized) {
    return null
  }

  const explicit = inferVoltageFromText(normalized)
  if (explicit) {
    return explicit
  }

  const sources = document.devices.flatMap((candidate) =>
    candidate.terminals
      .filter(
        (terminal) =>
          normalizeTerminalLabel(terminal.label) === normalized &&
          isSourceLikeDirection(getTerminalFlowDirection(terminal)),
      )
      .map(() => candidate),
  )

  const propertyVoltages = sources
    .map(
      (source) =>
        getPropertyText(source.properties?.outputVoltage) ??
        getPropertyText(source.properties?.nominalVoltage) ??
        getPropertyText(source.properties?.voltage),
    )
    .filter((value): value is string => Boolean(value))

  const uniqueVoltages = [...new Set(propertyVoltages)]
  if (uniqueVoltages.length > 0) {
    return uniqueVoltages.join(' / ')
  }

  return normalized
}

function inferVoltageFromText(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[_\s-]+/g, '')
  if (!normalized) {
    return null
  }

  if (/^[+-]?\d+(\.\d+)?(V|MV)$/.test(normalized)) {
    return normalized
  }

  return null
}

function isPowerLikeLabel(label: string | undefined) {
  const normalized = normalizeTerminalLabel(label)?.toUpperCase()
  if (!normalized) {
    return false
  }

  return (
    normalized === 'GND' ||
    normalized === 'VCC' ||
    normalized === 'VDD' ||
    normalized === 'VIN' ||
    normalized === 'VBAT' ||
    normalized.includes('VREF') ||
    Boolean(inferVoltageFromText(normalized))
  )
}

function deriveNetworkLines(document: DocumentFile) {
  return Object.entries(document.view.networkLines ?? {})
    .map(([id, source]) => buildDerivedNetworkLine(document, id, source))
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
}

function buildDerivedNetworkLine(
  document: DocumentFile,
  id: string,
  source: NetworkLineViewDefinition,
): DerivedNetworkLine {
  const normalized = getNetworkLineView(document, id) ?? source
  const label = normalized.label.trim() || id
  const labelKey = normalizeTerminalLabel(normalized.label) ?? label
  const position = normalized.position
  const length = normalized.length ?? 720
  const orientation = normalized.orientation === 'vertical' ? 'vertical' : 'horizontal'
  const start =
    orientation === 'horizontal'
      ? { x: position.x - length / 2, y: position.y }
      : { x: position.x, y: position.y - length / 2 }
  const end =
    orientation === 'horizontal'
      ? { x: position.x + length / 2, y: position.y }
      : { x: position.x, y: position.y + length / 2 }

  return {
    id,
    label,
    labelKey,
    position,
    length,
    orientation,
    start,
    end,
    source: normalized,
  }
}

function deriveConnectionGroups(devices: DerivedDevice[]) {
  const groups = new Map<string, { terminalIds: string[]; deviceIds: Set<string>; points: Point[] }>()

  for (const device of devices) {
    for (const terminal of device.terminals) {
      if (!terminal.connectionLabel) {
        continue
      }

      const bucket = groups.get(terminal.connectionLabel) ?? {
        terminalIds: [],
        deviceIds: new Set<string>(),
        points: [],
      }
      bucket.terminalIds.push(terminal.id)
      bucket.deviceIds.add(device.id)
      bucket.points.push(terminal.point)
      groups.set(terminal.connectionLabel, bucket)
    }
  }

  return [...groups.entries()]
    .map(([label, bucket]) => ({
      key: label,
      label,
      terminalIds: bucket.terminalIds.sort(),
      deviceIds: [...bucket.deviceIds].sort(),
      point: {
        x: bucket.points.reduce((sum, point) => sum + point.x, 0) / bucket.points.length,
        y: bucket.points.reduce((sum, point) => sum + point.y, 0) / bucket.points.length,
      },
    }) satisfies DerivedConnectionGroup)
    .sort((left, right) => left.label.localeCompare(right.label))
}

function deriveDeviceRelations(
  deviceById: Record<string, DerivedDevice>,
  connectionGroupByKey: Record<string, DerivedConnectionGroup>,
  locale: Locale,
) {
  const relations: Record<string, DeviceRelationSummary> = Object.fromEntries(
    Object.values(deviceById).map((device) => [
      device.id,
      {
        deviceId: device.id,
        title: device.title,
        upstreamDeviceIds: [],
        downstreamDeviceIds: [],
        relatedTerminalIds: [],
        connectionKeys: [],
        connectionLabels: [],
        upstreamLabels: [],
        downstreamLabels: [],
      } satisfies DeviceRelationSummary,
    ]),
  )

  const allTerminals = Object.values(deviceById).flatMap((device) => device.terminals)
  const terminalById = Object.fromEntries(allTerminals.map((terminal) => [terminal.id, terminal] as const))

  for (const group of Object.values(connectionGroupByKey)) {
    const terminals = group.terminalIds
      .map((terminalId) => terminalById[terminalId])
      .filter((terminal): terminal is DerivedTerminal => Boolean(terminal))
    const allDeviceIds = [...new Set(terminals.map((terminal) => terminal.deviceId))].sort()
    const terminalsByDevice = new Map<string, DerivedTerminal[]>()

    for (const terminal of terminals) {
      const bucket = terminalsByDevice.get(terminal.deviceId) ?? []
      bucket.push(terminal)
      terminalsByDevice.set(terminal.deviceId, bucket)
    }

    for (const terminal of terminals) {
      const relation = relations[terminal.deviceId]
      if (!relation) {
        continue
      }

      addUnique(relation.relatedTerminalIds, terminal.id)
      addUnique(relation.connectionKeys, group.key)
      addUnique(relation.connectionLabels, group.label)
    }

    for (const anchorId of allDeviceIds) {
      const anchorTerminals = terminalsByDevice.get(anchorId) ?? []
      const intent = getTerminalLabelIntent(anchorTerminals) ?? inferPeerLabelIntent(terminals)
      if (!intent) {
        continue
      }

      for (const otherId of allDeviceIds) {
        if (otherId === anchorId) {
          continue
        }

        const otherTerminals = terminalsByDevice.get(otherId) ?? []
        const bucket = resolveSharedLabelBucket(intent, otherTerminals)
        if (bucket === 'upstream') {
          addUnique(relations[anchorId]!.upstreamDeviceIds, otherId)
          addUnique(relations[otherId]!.downstreamDeviceIds, anchorId)
        } else if (bucket === 'downstream') {
          addUnique(relations[anchorId]!.downstreamDeviceIds, otherId)
          addUnique(relations[otherId]!.upstreamDeviceIds, anchorId)
        }
      }
    }
  }

  for (const relation of Object.values(relations)) {
    relation.upstreamDeviceIds.sort()
    relation.downstreamDeviceIds.sort()
    relation.upstreamDeviceIds = relation.upstreamDeviceIds.filter(
      (deviceId) => !relation.downstreamDeviceIds.includes(deviceId),
    )
    relation.relatedTerminalIds.sort()
    relation.connectionKeys.sort()
    relation.connectionLabels.sort((left, right) => left.localeCompare(right))
    relation.upstreamLabels = relation.upstreamDeviceIds.map((deviceId) => deviceById[deviceId]?.title ?? deviceId)
    relation.downstreamLabels = relation.downstreamDeviceIds.map((deviceId) => deviceById[deviceId]?.title ?? deviceId)

    if (!relation.connectionLabels.length) {
      relation.connectionLabels = [translate(locale, 'labelNone')]
    }
  }

  return relations
}
function addUnique(values: string[], value: string) {
  if (!values.includes(value)) {
    values.push(value)
  }
}

function buildTerminalColorMap(devices: DerivedDevice[]) {
  const keys = [...new Set(
    devices.flatMap((device) =>
      device.terminals.map((terminal) => terminal.connectionLabel ?? terminal.id),
    ),
  )].sort((left, right) => left.localeCompare(right) || left.length - right.length)

  const assigned = new Map<string, string>()
  const usedColors = new Set<string>()

  for (const key of keys) {
    const special = SPECIAL_LABEL_COLORS[key.trim().toUpperCase()]
    const normalized = special ? normalizeHex(special) : null
    if (normalized && !usedColors.has(normalized)) {
      assigned.set(key, normalized)
      usedColors.add(normalized)
    }
  }

  const candidates = buildDistinctColorCandidates(Math.max(96, keys.length * 6))

  for (const key of keys) {
    if (assigned.has(key)) {
      continue
    }

    const color = pickDistinctColor(
      key,
      candidates,
      [...usedColors],
    )
    assigned.set(key, color)
    usedColors.add(color)
  }

  return Object.fromEntries(
    [...assigned.entries()].map(([key, color]) => [
      key,
      buildDerivedTerminalColor(key, color),
    ]),
  ) satisfies Record<string, DerivedTerminalColor>
}

function buildDerivedTerminalColor(key: string, fill: string): DerivedTerminalColor {
  return {
    key,
    fill,
    stroke: darkenHex(fill, 0.24),
    glow: withAlpha(fill, '44'),
    text: darkenHex(fill, 0.34),
  }
}

function buildDistinctColorCandidates(targetCount: number) {
  const candidates: string[] = []
  let index = 0

  while (candidates.length < targetCount) {
    const hue = (index * 137.508) % 360
    const saturation = [82, 76, 88][index % 3]!
    const lightness = [56, 50, 62, 46][Math.floor(index / 3) % 4]!
    const color = hslToHex(hue, saturation, lightness)
    index += 1

    if (
      color === COLOR_BLACK ||
      color === COLOR_WHITE ||
      candidates.includes(color)
    ) {
      continue
    }

    if (
      colorDistance(color, COLOR_BLACK) < 118 ||
      colorDistance(color, COLOR_WHITE) < 128
    ) {
      continue
    }

    candidates.push(color)
  }

  return candidates
}

function pickDistinctColor(
  key: string,
  candidates: string[],
  usedColors: string[],
) {
  if (!usedColors.length) {
    return candidates[hashString(key) % candidates.length]!
  }

  let bestColor = candidates[0]!
  let bestScore = -Infinity
  const preferredIndex = hashString(key) % candidates.length

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!
    if (usedColors.includes(candidate)) {
      continue
    }

    const minDistance = Math.min(...usedColors.map((used) => colorDistance(candidate, used)))
    const preferenceBias =
      ((candidates.length - Math.min(Math.abs(index - preferredIndex), candidates.length - Math.abs(index - preferredIndex))) /
        candidates.length) *
      0.01
    const score = minDistance + preferenceBias

    if (score > bestScore) {
      bestScore = score
      bestColor = candidate
    }
  }

  return bestColor
}

function withAlpha(color: string, alpha: string) {
  const normalized = normalizeHex(color)
  return `${normalized}${alpha.toUpperCase()}`
}

function normalizeHex(value: string) {
  if (!value.startsWith('#')) {
    return value.toUpperCase()
  }

  if (value.length === 4) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toUpperCase()
  }

  return value.toUpperCase()
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100
  const l = lightness / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const h = ((hue % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((h % 2) - 1))

  const [r1, g1, b1] =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x]

  const m = l - c / 2
  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()

  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`
}

function colorDistance(left: string, right: string) {
  const [lr, lg, lb] = hexToRgb(left)
  const [rr, rg, rb] = hexToRgb(right)
  return Math.sqrt((lr - rr) ** 2 + (lg - rg) ** 2 + (lb - rb) ** 2)
}

function hexToRgb(value: string) {
  const hex = normalizeHex(value)
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [number, number, number]
}

function darkenHex(value: string, factor: number) {
  if (!value.startsWith('#') || (value.length !== 7 && value.length !== 4)) {
    return value
  }

  const hex = value.length === 4
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value
  const channels = [1, 3, 5].map((index) =>
    Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(index, index + 2), 16) * (1 - factor)))),
  )
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function hashString(value: string) {
  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash
}
