import type { DeviceDefinition, DocumentFile, TerminalDefinition } from '../types/document'

export interface BlueprintDiffSummary {
  hasChanges: boolean
  devices: {
    added: string[]
    removed: string[]
    changed: string[]
  }
  terminals: {
    added: string[]
    removed: string[]
    changed: string[]
    labelChanged: string[]
  }
  labels: {
    changed: string[]
  }
  viewChanged: boolean
  documentMetaChanged: boolean
  rawJsonChanged: boolean
  summaryLines: string[]
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function byId<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
  return new Map((items ?? []).map((item) => [item.id, item]))
}

function deviceLabel(device: DeviceDefinition | undefined, fallbackId: string): string {
  return device?.name || device?.reference || fallbackId
}

function terminalLabel(device: DeviceDefinition | undefined, terminal: TerminalDefinition | undefined, terminalId: string) {
  return `${deviceLabel(device, 'unknown device')} / ${terminal?.name || terminal?.label || terminalId}`
}

function withoutTerminals(device: DeviceDefinition): Omit<DeviceDefinition, 'terminals'> {
  const copy: Partial<DeviceDefinition> = { ...device }
  delete copy.terminals
  return copy as Omit<DeviceDefinition, 'terminals'>
}

function diffDevices(before: DocumentFile, after: DocumentFile) {
  const beforeById = byId(before.devices)
  const afterById = byId(after.devices)
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []

  for (const [id, device] of Array.from(afterById)) {
    const previous = beforeById.get(id)
    if (!previous) {
      added.push(deviceLabel(device, id))
    } else if (stableStringify(withoutTerminals(previous)) !== stableStringify(withoutTerminals(device))) {
      changed.push(deviceLabel(previous, id))
    }
  }

  for (const [id, device] of Array.from(beforeById)) {
    if (!afterById.has(id)) {
      removed.push(deviceLabel(device, id))
    }
  }

  return { added, removed, changed }
}

function diffTerminals(before: DocumentFile, after: DocumentFile) {
  const beforeDevices = byId(before.devices)
  const afterDevices = byId(after.devices)
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  const labelChanged: string[] = []

  for (const [deviceId, nextDevice] of Array.from(afterDevices)) {
    const previousDevice = beforeDevices.get(deviceId)
    const beforeTerminals = byId(previousDevice?.terminals)
    const afterTerminals = byId(nextDevice.terminals)

    for (const [terminalId, terminal] of Array.from(afterTerminals)) {
      const previous = beforeTerminals.get(terminalId)
      if (!previous) {
        added.push(terminalLabel(nextDevice, terminal, terminalId))
      } else {
        if ((previous.label ?? '') !== (terminal.label ?? '')) {
          labelChanged.push(`${terminalLabel(previousDevice, previous, terminalId)}: ${previous.label ?? '(none)'} → ${terminal.label ?? '(none)'}`)
        }
        if (stableStringify(previous) !== stableStringify(terminal)) {
          changed.push(terminalLabel(previousDevice, previous, terminalId))
        }
      }
    }

    for (const [terminalId, terminal] of Array.from(beforeTerminals)) {
      if (!afterTerminals.has(terminalId)) {
        removed.push(terminalLabel(previousDevice, terminal, terminalId))
      }
    }
  }

  for (const [deviceId, previousDevice] of Array.from(beforeDevices)) {
    if (!afterDevices.has(deviceId)) {
      for (const terminal of previousDevice.terminals) {
        removed.push(terminalLabel(previousDevice, terminal, terminal.id))
      }
    }
  }

  return { added, removed, changed, labelChanged }
}

function diffNetworkLabels(before: DocumentFile, after: DocumentFile): string[] {
  const beforeLines = before.view.networkLines ?? {}
  const afterLines = after.view.networkLines ?? {}
  const changed: string[] = []
  for (const id of Object.keys(afterLines).sort()) {
    if (beforeLines[id] && beforeLines[id].label !== afterLines[id].label) {
      changed.push(`${id}: ${beforeLines[id].label} → ${afterLines[id].label}`)
    }
  }
  return changed
}

export function diffBlueprintDocument(before: DocumentFile, after: DocumentFile): BlueprintDiffSummary {
  const devices = diffDevices(before, after)
  const terminals = diffTerminals(before, after)
  const labels = { changed: diffNetworkLabels(before, after) }
  const viewChanged = stableStringify(before.view) !== stableStringify(after.view)
  const documentMetaChanged = stableStringify(before.document) !== stableStringify(after.document)
  const rawJsonChanged = stableStringify(before) !== stableStringify(after)

  const summaryLines = [
    `Devices: +${devices.added.length} / -${devices.removed.length} / ~${devices.changed.length}`,
    `Terminals: +${terminals.added.length} / -${terminals.removed.length} / ~${terminals.changed.length} / label changes ${terminals.labelChanged.length}`,
    `Labels: network label changes ${labels.changed.length}`,
  ]
  if (viewChanged) summaryLines.push('View/layout changed')
  if (documentMetaChanged) summaryLines.push('Document metadata changed')
  if (rawJsonChanged) summaryLines.push('Raw JSON changed')
  if (!rawJsonChanged) summaryLines.push('No document changes detected')

  return {
    hasChanges: rawJsonChanged,
    devices,
    terminals,
    labels,
    viewChanged,
    documentMetaChanged,
    rawJsonChanged,
    summaryLines,
  }
}
