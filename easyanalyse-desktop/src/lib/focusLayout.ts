import type {
  CircuitInsights,
  DerivedDevice,
  DerivedNetworkLine,
  DerivedTerminal,
} from './circuitDescription'
import {
  getTerminalLabelIntent,
  inferPeerLabelIntent,
  isSinkLikeDirection,
  isSourceLikeDirection,
  resolveSharedLabelBucket,
} from './document'
import type { Bounds } from './geometry'
import type {
  NetworkLineOrientation,
  Point,
  TerminalSide,
} from '../types/document'

const FOCUS_COLUMN_GAP = 184
const FOCUS_STACK_GAP = 104
const FOCUS_GRID_GAP_X = 140
const FOCUS_GRID_GAP_Y = 124
const FOCUS_RAIL_GAP_Y = 108
const FOCUS_PADDING = 56

type FocusBucket = 'upstream' | 'downstream'

export type FocusTarget =
  | { type: 'device'; id: string }
  | { type: 'label'; key: string }
  | { type: 'networkLine'; id: string }

export interface FocusPlacement {
  center: Point
  rotationDeg: number
}

export interface FocusRail {
  label: string
  start: Point
  end: Point
  textPoint: Point
}

export interface FocusLayoutResult {
  states: Map<string, FocusPlacement>
  bounds: Bounds
  deviceIds: string[]
  rail: FocusRail | null
  suppressedLabelKeys: string[]
}

interface FocusDeviceRelation {
  upstreamLabelKeys: Set<string>
  downstreamLabelKeys: Set<string>
}

interface DeviceBucketItem {
  deviceId: string
  device: DerivedDevice
  rotationDeg: number
  footprint: { width: number; height: number }
}

const ROTATION_SIDE_ORDER: TerminalSide[] = ['right', 'bottom', 'left', 'top']

export function deriveFocusLayout(
  insights: CircuitInsights,
  target: FocusTarget,
): FocusLayoutResult | null {
  if (target.type === 'device') {
    return deriveDeviceFocusLayout(insights, target.id)
  }

  if (target.type === 'networkLine') {
    const networkLine = insights.networkLineById[target.id]
    if (!networkLine) {
      return null
    }
    return deriveLabelFocusLayout(insights, networkLine.labelKey, networkLine)
  }

  return deriveLabelFocusLayout(insights, target.key)
}

function deriveDeviceFocusLayout(insights: CircuitInsights, focusDeviceId: string) {
  const anchor = insights.deviceById[focusDeviceId]
  if (!anchor) {
    return null
  }

  const suppressedLabelKeys = [...new Set(
    anchor.terminals
      .filter(
        (terminal) =>
          terminal.connectionLabel &&
          (insights.networkLinesByLabel[terminal.connectionLabel]?.length ?? 0) > 0,
      )
      .map((terminal) => terminal.connectionLabel as string),
  )].sort((left, right) => left.localeCompare(right))
  const suppressedSet = new Set(suppressedLabelKeys)
  const relationByDevice = buildDeviceFocusRelations(insights, anchor, suppressedSet)

  const states = new Map<string, FocusPlacement>()
  const anchorRotation = chooseAnchorRotation(anchor, anchor.terminals)
  const anchorFootprint = getFootprint(anchor, anchorRotation)
  states.set(anchor.id, {
    center: anchor.center,
    rotationDeg: anchorRotation,
  })

  const buildBucketItems = (bucket: FocusBucket) =>
    [...relationByDevice.entries()]
      .filter(([, relation]) => relation[`${bucket}LabelKeys`].size > 0)
      .map(([deviceId, relation]) => {
        const device = insights.deviceById[deviceId]!
        const relevantLabels = [...relation[`${bucket}LabelKeys`]]
        const relevantTerminals = device.terminals.filter(
          (terminal) =>
            terminal.connectionLabel && relevantLabels.includes(terminal.connectionLabel),
        )
        const rotationDeg = chooseDeviceRotation(device, relevantTerminals, desiredSideForBucket(bucket))
        return {
          deviceId,
          device,
          rotationDeg,
          footprint: getFootprint(device, rotationDeg),
        } satisfies DeviceBucketItem
      })
      .sort((left, right) => sortDevices(left.device, right.device))

  const upstreamItems = buildBucketItems('upstream')
  const downstreamItems = buildBucketItems('downstream')
  placeVerticalColumn(
    states,
    upstreamItems,
    anchor.center.x - anchorFootprint.width / 2 - FOCUS_COLUMN_GAP,
    anchor.center.y,
    'left',
  )
  placeVerticalColumn(
    states,
    downstreamItems,
    anchor.center.x + anchorFootprint.width / 2 + FOCUS_COLUMN_GAP,
    anchor.center.y,
    'right',
  )

  return {
    states,
    bounds: expandBounds(calculateFocusBounds(insights, states), FOCUS_PADDING),
    deviceIds: [...states.keys()],
    rail: null,
    suppressedLabelKeys,
  } satisfies FocusLayoutResult
}

function deriveLabelFocusLayout(
  insights: CircuitInsights,
  labelKey: string,
  networkLine?: DerivedNetworkLine,
) {
  const normalizedKey = labelKey.trim()
  if (!normalizedKey) {
    return null
  }

  const highlight = insights.connectionHighlightsByKey[normalizedKey]
  if (!highlight?.deviceIds.length) {
    return null
  }

  const devices = highlight.deviceIds
    .map((deviceId) => insights.deviceById[deviceId])
    .filter((device): device is DerivedDevice => Boolean(device))
    .sort(sortDevices)
  if (!devices.length) {
    return null
  }

  const centroid = {
    x: devices.reduce((sum, device) => sum + device.center.x, 0) / devices.length,
    y: devices.reduce((sum, device) => sum + device.center.y, 0) / devices.length,
  }

  const placement = chooseNetworkFocusPlacement(networkLine?.orientation, networkLine, centroid)
  const desiredSide = placementDesiredSide(placement)
  const items = devices.map((device) => {
    const relevantTerminals = device.terminals.filter(
      (terminal) => terminal.connectionLabel === normalizedKey,
    )
    const rotationDeg = chooseDeviceRotation(device, relevantTerminals, desiredSide)
    return {
      deviceId: device.id,
      device,
      rotationDeg,
      footprint: getFootprint(device, rotationDeg),
    } satisfies DeviceBucketItem
  })

  const states = new Map<string, FocusPlacement>()
  const columns = Math.min(4, Math.max(1, devices.length <= 4 ? devices.length : Math.ceil(Math.sqrt(devices.length))))
  if (placement.orientation === 'horizontal') {
    const gridMetrics = measureWrappedRows(items, columns)
    const topY =
      placement.side === 'bottom'
        ? placement.axis + FOCUS_RAIL_GAP_Y
        : placement.axis - FOCUS_RAIL_GAP_Y - gridMetrics.height
    placeWrappedRow(states, items, placement.cross, topY, columns)
  } else {
    const rows = Math.min(4, Math.max(1, columns))
    const gridMetrics = measureWrappedColumns(items, rows)
    const leftX =
      placement.side === 'right'
        ? placement.axis + FOCUS_RAIL_GAP_Y
        : placement.axis - FOCUS_RAIL_GAP_Y - gridMetrics.width
    placeWrappedColumn(states, items, leftX, placement.cross, rows)
  }

  const deviceBounds = calculateFocusBounds(insights, states)
  const rail = networkLine ? null : buildSyntheticRail(normalizedKey, centroid, deviceBounds)
  const railBounds = networkLine
    ? boundsFromNetworkLine(networkLine)
    : rail
      ? boundsFromRail(rail)
      : null

  return {
    states,
    bounds: expandBounds(railBounds ? unionBounds(deviceBounds, railBounds) : deviceBounds, FOCUS_PADDING),
    deviceIds: [...states.keys()],
    rail,
    suppressedLabelKeys: [],
  } satisfies FocusLayoutResult
}

function buildDeviceFocusRelations(
  insights: CircuitInsights,
  anchor: DerivedDevice,
  suppressedLabels: Set<string>,
) {
  const relations = new Map<string, FocusDeviceRelation>()
  const terminalsByLabel = new Map<string, DerivedTerminal[]>()

  for (const terminal of anchor.terminals) {
    if (!terminal.connectionLabel || suppressedLabels.has(terminal.connectionLabel)) {
      continue
    }

    const bucket = terminalsByLabel.get(terminal.connectionLabel) ?? []
    bucket.push(terminal)
    terminalsByLabel.set(terminal.connectionLabel, bucket)
  }

  for (const [labelKey, anchorTerminals] of terminalsByLabel.entries()) {
    const highlight = insights.connectionHighlightsByKey[labelKey]
    if (!highlight) {
      continue
    }

    const groupTerminals = highlight.terminalIds
      .map((terminalId) => insights.terminalById[terminalId])
      .filter((terminal): terminal is DerivedTerminal => Boolean(terminal))
    const otherByDevice = new Map<string, DerivedTerminal[]>()

    for (const terminal of groupTerminals) {
      if (terminal.deviceId === anchor.id) {
        continue
      }

      const bucket = otherByDevice.get(terminal.deviceId) ?? []
      bucket.push(terminal)
      otherByDevice.set(terminal.deviceId, bucket)
    }

    const intent = getTerminalLabelIntent(anchorTerminals) ?? inferPeerLabelIntent(groupTerminals)
    if (!intent) {
      continue
    }

    for (const [deviceId, terminals] of otherByDevice.entries()) {
      const relation = getOrCreateDeviceRelation(relations, deviceId)
      const bucket = resolveSharedLabelBucket(intent, terminals)
      if (bucket) {
        relation[`${bucket}LabelKeys`].add(labelKey)
      }
    }
  }

  for (const relation of relations.values()) {
    if (relation.upstreamLabelKeys.size && relation.downstreamLabelKeys.size) {
      if (relation.upstreamLabelKeys.size > relation.downstreamLabelKeys.size) {
        relation.downstreamLabelKeys.clear()
      } else {
        relation.upstreamLabelKeys.clear()
      }
    }
  }

  return relations
}

function placeVerticalColumn(
  states: Map<string, FocusPlacement>,
  items: DeviceBucketItem[],
  edgeX: number,
  centerY: number,
  side: 'left' | 'right',
) {
  if (!items.length) {
    return
  }

  const totalHeight =
    items.reduce((sum, item) => sum + item.footprint.height, 0) +
    Math.max(0, items.length - 1) * FOCUS_STACK_GAP
  let cursorY = centerY - totalHeight / 2

  for (const item of items) {
    const centerX =
      side === 'left'
        ? edgeX - item.footprint.width / 2
        : edgeX + item.footprint.width / 2
    const center = {
      x: centerX,
      y: cursorY + item.footprint.height / 2,
    }

    states.set(item.deviceId, {
      center,
      rotationDeg: item.rotationDeg,
    })
    cursorY += item.footprint.height + FOCUS_STACK_GAP
  }
}

function placeWrappedRow(
  states: Map<string, FocusPlacement>,
  items: DeviceBucketItem[],
  centerX: number,
  topY: number,
  columns: number,
) {
  if (!items.length) {
    return
  }

  const safeColumns = Math.max(1, columns)
  let cursorY = topY

  for (let rowStart = 0; rowStart < items.length; rowStart += safeColumns) {
    const row = items.slice(rowStart, rowStart + safeColumns)
    const rowHeight = Math.max(...row.map((item) => item.footprint.height))
    const rowWidth =
      row.reduce((sum, item) => sum + item.footprint.width, 0) +
      Math.max(0, row.length - 1) * FOCUS_GRID_GAP_X
    let cursorX = centerX - rowWidth / 2

    for (const item of row) {
      const center = {
        x: cursorX + item.footprint.width / 2,
        y: cursorY + rowHeight / 2,
      }
      states.set(item.deviceId, {
        center,
        rotationDeg: item.rotationDeg,
      })
      cursorX += item.footprint.width + FOCUS_GRID_GAP_X
    }

    cursorY += rowHeight + FOCUS_GRID_GAP_Y
  }
}

function measureWrappedRows(items: DeviceBucketItem[], columns: number) {
  if (!items.length) {
    return { width: 0, height: 0 }
  }

  const safeColumns = Math.max(1, columns)
  let width = 0
  let height = 0

  for (let rowStart = 0; rowStart < items.length; rowStart += safeColumns) {
    const row = items.slice(rowStart, rowStart + safeColumns)
    const rowHeight = Math.max(...row.map((item) => item.footprint.height))
    const rowWidth =
      row.reduce((sum, item) => sum + item.footprint.width, 0) +
      Math.max(0, row.length - 1) * FOCUS_GRID_GAP_X
    width = Math.max(width, rowWidth)
    height += rowHeight
    if (rowStart + safeColumns < items.length) {
      height += FOCUS_GRID_GAP_Y
    }
  }

  return { width, height }
}

function placeWrappedColumn(
  states: Map<string, FocusPlacement>,
  items: DeviceBucketItem[],
  leftX: number,
  centerY: number,
  rows: number,
) {
  if (!items.length) {
    return
  }

  const safeRows = Math.max(1, rows)
  let cursorX = leftX

  for (let columnStart = 0; columnStart < items.length; columnStart += safeRows) {
    const column = items.slice(columnStart, columnStart + safeRows)
    const columnWidth = Math.max(...column.map((item) => item.footprint.width))
    const columnHeight =
      column.reduce((sum, item) => sum + item.footprint.height, 0) +
      Math.max(0, column.length - 1) * FOCUS_GRID_GAP_Y
    let cursorY = centerY - columnHeight / 2

    for (const item of column) {
      const center = {
        x: cursorX + columnWidth / 2,
        y: cursorY + item.footprint.height / 2,
      }
      states.set(item.deviceId, {
        center,
        rotationDeg: item.rotationDeg,
      })
      cursorY += item.footprint.height + FOCUS_GRID_GAP_Y
    }

    cursorX += columnWidth + FOCUS_GRID_GAP_X
  }
}

function measureWrappedColumns(items: DeviceBucketItem[], rows: number) {
  if (!items.length) {
    return { width: 0, height: 0 }
  }

  const safeRows = Math.max(1, rows)
  let width = 0
  let height = 0

  for (let columnStart = 0; columnStart < items.length; columnStart += safeRows) {
    const column = items.slice(columnStart, columnStart + safeRows)
    const columnWidth = Math.max(...column.map((item) => item.footprint.width))
    const columnHeight =
      column.reduce((sum, item) => sum + item.footprint.height, 0) +
      Math.max(0, column.length - 1) * FOCUS_GRID_GAP_Y
    width += columnWidth
    if (columnStart + safeRows < items.length) {
      width += FOCUS_GRID_GAP_X
    }
    height = Math.max(height, columnHeight)
  }

  return { width, height }
}

function chooseAnchorRotation(device: DerivedDevice, terminals: DerivedTerminal[]) {
  if (!terminals.length) {
    return device.rotationDeg
  }

  const candidates = buildRotationCandidates(device.rotationDeg)
  let bestRotation = device.rotationDeg
  let bestScore = -Infinity
  let bestDistance = Infinity

  for (const candidate of candidates) {
    let score = 0
    for (const terminal of terminals) {
      const displayedSide = rotateSide(terminal.side, candidate)
      const desiredSide = desiredSideForDirection(terminal.flowDirection)
      score += 4 - sideDistance(displayedSide, desiredSide)
    }

    const distance = Math.abs(shortestAngleDelta(device.rotationDeg, candidate))
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      bestScore = score
      bestDistance = distance
      bestRotation = candidate
    }
  }

  return bestRotation
}

function chooseDeviceRotation(
  device: DerivedDevice,
  terminals: DerivedTerminal[],
  desiredSide: Exclude<TerminalSide, 'auto'>,
) {
  if (!terminals.length) {
    return device.rotationDeg
  }

  const candidates = buildRotationCandidates(device.rotationDeg)
  let bestRotation = device.rotationDeg
  let bestScore = -Infinity
  let bestDistance = Infinity

  for (const candidate of candidates) {
    let score = 0
    for (const terminal of terminals) {
      const displayedSide = rotateSide(terminal.side, candidate)
      score += 4 - sideDistance(displayedSide, desiredSide)
    }

    const distance = Math.abs(shortestAngleDelta(device.rotationDeg, candidate))
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      bestScore = score
      bestDistance = distance
      bestRotation = candidate
    }
  }

  return bestRotation
}

function buildRotationCandidates(baseRotation: number) {
  return [0, 90, 180, 270].map((delta) => normalizeRotation(baseRotation + delta))
}

function calculateFocusBounds(
  insights: CircuitInsights,
  states: Map<string, FocusPlacement>,
): Bounds {
  let bounds: Bounds | null = null

  for (const [deviceId, placement] of states.entries()) {
    const device = insights.deviceById[deviceId]
    if (!device) {
      continue
    }

    bounds = unionBounds(
      bounds,
      boundsFromCenter(placement.center, getFootprint(device, placement.rotationDeg)),
    )
  }

  return bounds ?? {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  }
}

function boundsFromCenter(
  center: Point,
  size: { width: number; height: number },
): Bounds {
  return {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
  }
}

function boundsFromRail(rail: FocusRail): Bounds {
  return {
    x: rail.start.x,
    y: rail.textPoint.y,
    width: rail.end.x - rail.start.x,
    height: rail.start.y - rail.textPoint.y + 18,
  }
}

function boundsFromNetworkLine(networkLine: DerivedNetworkLine): Bounds {
  if (networkLine.orientation === 'horizontal') {
    return {
      x: networkLine.start.x,
      y: networkLine.start.y - 32,
      width: networkLine.length,
      height: 56,
    }
  }

  return {
    x: networkLine.start.x - 32,
    y: networkLine.start.y,
    width: 56,
    height: networkLine.length,
  }
}

function unionBounds(left: Bounds | null, right: Bounds) {
  if (!left) {
    return right
  }

  const minX = Math.min(left.x, right.x)
  const minY = Math.min(left.y, right.y)
  const maxX = Math.max(left.x + left.width, right.x + right.width)
  const maxY = Math.max(left.y + left.height, right.y + right.height)
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function expandBounds(bounds: Bounds, padding: number): Bounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  }
}

function getFootprint(device: DerivedDevice, rotationDeg: number) {
  const quarterTurns = Math.round(normalizeRotation(rotationDeg) / 90) % 4
  if (device.shape === 'circle' || quarterTurns % 2 === 0) {
    return {
      width: device.bounds.width,
      height: device.bounds.height,
    }
  }

  return {
    width: device.bounds.height,
    height: device.bounds.width,
  }
}

function getOrCreateDeviceRelation(
  relations: Map<string, FocusDeviceRelation>,
  deviceId: string,
) {
  const existing = relations.get(deviceId)
  if (existing) {
    return existing
  }

  const created = {
    upstreamLabelKeys: new Set<string>(),
    downstreamLabelKeys: new Set<string>(),
  } satisfies FocusDeviceRelation
  relations.set(deviceId, created)
  return created
}

function desiredSideForDirection(direction: Parameters<typeof isSourceLikeDirection>[0]): Exclude<TerminalSide, 'auto'> {
  if (isSourceLikeDirection(direction)) {
    return 'right'
  }
  if (isSinkLikeDirection(direction)) {
    return 'left'
  }
  return 'top'
}

function desiredSideForBucket(bucket: FocusBucket): Exclude<TerminalSide, 'auto'> {
  switch (bucket) {
    case 'upstream':
      return 'right'
    case 'downstream':
      return 'left'
    default:
      return 'top'
  }
}

function rotateSide(side: TerminalSide, rotationDeg: number): Exclude<TerminalSide, 'auto'> {
  const normalizedSide = side === 'auto' ? 'bottom' : side
  const baseIndex = ROTATION_SIDE_ORDER.indexOf(normalizedSide)
  const turns = Math.round(normalizeRotation(rotationDeg) / 90) % 4
  return ROTATION_SIDE_ORDER[(baseIndex + turns + 4) % 4] as Exclude<TerminalSide, 'auto'>
}

function sideDistance(
  left: Exclude<TerminalSide, 'auto'>,
  right: Exclude<TerminalSide, 'auto'>,
) {
  const leftIndex = ROTATION_SIDE_ORDER.indexOf(left)
  const rightIndex = ROTATION_SIDE_ORDER.indexOf(right)
  const distance = Math.abs(leftIndex - rightIndex)
  return Math.min(distance, 4 - distance)
}

function normalizeRotation(value: number) {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function shortestAngleDelta(from: number, to: number) {
  const normalized = ((to - from + 540) % 360) - 180
  return normalized
}

function sortDevices(left: DerivedDevice, right: DerivedDevice) {
  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
}

function buildSyntheticRail(label: string, centroid: Point, deviceBounds: Bounds): FocusRail {
  const railWidth = Math.max(220, deviceBounds.width + 120)
  const railY = deviceBounds.y - FOCUS_RAIL_GAP_Y
  return {
    label,
    start: {
      x: centroid.x - railWidth / 2,
      y: railY,
    },
    end: {
      x: centroid.x + railWidth / 2,
      y: railY,
    },
    textPoint: {
      x: centroid.x - 72,
      y: railY - 30,
    },
  }
}

function chooseNetworkFocusPlacement(
  orientation: NetworkLineOrientation | undefined,
  networkLine: DerivedNetworkLine | undefined,
  centroid: Point,
) {
  if (!networkLine || orientation !== 'vertical') {
    const axis = networkLine?.position.y ?? centroid.y - FOCUS_RAIL_GAP_Y
    return {
      orientation: 'horizontal' as const,
      axis,
      cross: networkLine?.position.x ?? centroid.x,
      side:
        networkLine && centroid.y < networkLine.position.y
          ? 'top' as const
          : 'bottom' as const,
    }
  }

  return {
    orientation: 'vertical' as const,
    axis: networkLine.position.x,
    cross: networkLine.position.y,
    side:
      centroid.x < networkLine.position.x
        ? 'left' as const
        : 'right' as const,
  }
}

function placementDesiredSide(
  placement:
    | { orientation: 'horizontal'; side: 'top' | 'bottom'; axis: number; cross: number }
    | { orientation: 'vertical'; side: 'left' | 'right'; axis: number; cross: number },
): Exclude<TerminalSide, 'auto'> {
  if (placement.orientation === 'horizontal') {
    return placement.side === 'bottom' ? 'top' : 'bottom'
  }

  return placement.side === 'right' ? 'left' : 'right'
}
