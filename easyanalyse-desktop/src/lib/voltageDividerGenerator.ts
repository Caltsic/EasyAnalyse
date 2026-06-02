import type { AgentBlueprintCandidate } from '../types/agent'
import type { DeviceDefinition, DocumentFile, ValidationIssue } from '../types/document'

export interface GenerateVoltageDividerInput {
  vin: number
  vout?: number
  r1Ohms?: number
  r2Ohms?: number
  title?: string
  vinLabel?: string
  voutLabel?: string
  groundLabel?: string
}

export interface GenerateVoltageDividerOutput {
  candidate: AgentBlueprintCandidate
  assumptions: string[]
  calculatedValues: Record<string, number | string>
  warnings: string[]
}

const DEFAULT_GRID_SIZE = 24
const DEFAULT_DEVICE_SIZE = { width: 180, height: 96 }
const E24_BASE = [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91]

export function generateVoltageDivider(input: GenerateVoltageDividerInput): GenerateVoltageDividerOutput {
  const vinLabel = input.vinLabel?.trim() || 'VIN'
  const voutLabel = input.voutLabel?.trim() || 'VOUT'
  const groundLabel = input.groundLabel?.trim() || 'GND'

  const hasBothResistors = input.r1Ohms !== undefined && input.r2Ohms !== undefined
  const hasVout = input.vout !== undefined

  let r1Ohms: number
  let r2Ohms: number
  let actualVout: number
  const warnings: string[] = []

  if (hasBothResistors) {
    r1Ohms = roundToE24(input.r1Ohms!)
    r2Ohms = roundToE24(input.r2Ohms!)
    actualVout = input.vin * (r2Ohms / (r1Ohms + r2Ohms))
  } else if (hasVout) {
    const targetRatio = input.vout! / input.vin
    if (input.r1Ohms !== undefined && input.r2Ohms === undefined) {
      r1Ohms = roundToE24(input.r1Ohms)
      r2Ohms = roundToE24(r1Ohms * targetRatio / (1 - targetRatio))
    } else if (input.r2Ohms !== undefined && input.r1Ohms === undefined) {
      r2Ohms = roundToE24(input.r2Ohms)
      r1Ohms = roundToE24(r2Ohms * (1 - targetRatio) / targetRatio)
    } else {
      // Neither resistor provided — anchor R2 at a practical value
      r2Ohms = chooseR2ForRatio(targetRatio)
      r1Ohms = roundToE24(r2Ohms * (1 - targetRatio) / targetRatio)
    }
    actualVout = input.vin * (r2Ohms / (r1Ohms + r2Ohms))
  } else {
    // Should not reach here — validated by caller
    r1Ohms = 10_000
    r2Ohms = 10_000
    actualVout = input.vin / 2
  }

  // Validate extreme values
  if (r1Ohms < 100 || r2Ohms < 100) {
    warnings.push('One or both resistor values are below 100 ohms. Check power dissipation and source loading.')
  }
  if (r1Ohms > 1_000_000 || r2Ohms > 1_000_000) {
    warnings.push('One or both resistor values exceed 1 Mohm. The divider may be sensitive to noise and PCB leakage.')
  }
  if (hasVout && input.vout! / input.vin < 0.01) {
    warnings.push('Output voltage is less than 1% of input. This divider ratio is impractical — consider a regulator instead.')
  }
  if (hasVout && input.vout! / input.vin > 0.99) {
    warnings.push('Output voltage is over 99% of input. The divider ratio is near unity — verify this is intentional.')
  }

  const title = input.title?.trim() || `Voltage divider ${formatVoltage(input.vin)} to ${formatVoltage(actualVout)}`
  const documentId = stableId(`vdivider-${Math.round(input.vin)}v-${Math.round(actualVout * 100) / 100}v`)

  const devices: DeviceDefinition[] = [
    connector('j1', 'Input', 'J1', vinLabel, 'input signal'),
    {
      id: 'r1',
      name: 'Top resistor',
      kind: 'resistor',
      category: 'passive',
      reference: 'R1',
      properties: { value: formatResistance(r1Ohms), topology: 'voltage divider top resistor' },
      terminals: [
        terminal('r1-a', 'A', 'input', vinLabel, 'left', 0),
        terminal('r1-b', 'B', 'output', voutLabel, 'right', 0),
      ],
    },
    {
      id: 'r2',
      name: 'Bottom resistor',
      kind: 'resistor',
      category: 'passive',
      reference: 'R2',
      properties: { value: formatResistance(r2Ohms), topology: 'voltage divider bottom resistor' },
      terminals: [
        terminal('r2-a', 'A', 'input', voutLabel, 'top', 0),
        terminal('r2-b', 'B', 'output', groundLabel, 'bottom', 0),
      ],
    },
    connector('tp1', 'Output', 'TP1', voutLabel, 'divided output'),
    groundDevice('gnd1', groundLabel),
  ]

  const document = documentFile({
    id: documentId,
    title,
    description: `Resistive voltage divider, Vin ${formatVoltage(input.vin)}, Vout ${formatVoltage(actualVout)}, R1 ${formatResistance(r1Ohms)}, R2 ${formatResistance(r2Ohms)}.`,
    devices,
    viewDevices: {
      j1: view(80, 220, 160, 88),
      r1: view(360, 220),
      r2: view(560, 360),
      tp1: view(820, 220, 160, 88),
      gnd1: view(560, 560, 160, 88),
    },
  })

  const assumptions = [
    'Used resistive voltage divider topology.',
    hasBothResistors
      ? 'Used user-provided R1 and R2 values and calculated the resulting Vout.'
      : 'Selected a practical R2 value and rounded R1 to E24 from the voltage ratio.',
    'Assumes negligible load current — output voltage will sag under any load.',
  ]

  warnings.push('Voltage dividers are load-sensitive and provide no regulation. Output impedance is the parallel combination of R1 and R2.')

  return {
    candidate: candidate(title, document, assumptions, warnings, [
      'Voltage dividers are simple but unregulated. For power rails, consider using a regulator.',
    ]),
    assumptions,
    warnings,
    calculatedValues: {
      topology: 'resistive-voltage-divider',
      vin: input.vin,
      targetVout: input.vout ?? actualVout,
      actualVout: Number.parseFloat(actualVout.toPrecision(4)),
      r1Ohms,
      r2Ohms,
      outputImpedanceOhms: Number.parseFloat(((r1Ohms * r2Ohms) / (r1Ohms + r2Ohms)).toPrecision(4)),
    },
  }
}

function chooseR2ForRatio(targetRatio: number): number {
  // Pick a practical R2 that keeps R1 in a reasonable range (100 ohm – 10 Mohm)
  const candidates = [1_000, 4_700, 10_000, 22_000, 47_000, 100_000]
  let best = candidates[2]! // default 10k
  let bestScore = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const r1 = candidate * (1 - targetRatio) / targetRatio
    if (r1 < 1 || r1 > 50_000_000) continue
    const score = Math.abs(Math.log10(r1 / 10_000))
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

function roundToE24(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return value
  const decade = 10 ** Math.floor(Math.log10(value / 10))
  const normalized = value / decade
  let best = E24_BASE[0]!
  let bestDistance = Math.abs(normalized - best)
  for (const candidate of E24_BASE) {
    const distance = Math.abs(normalized - candidate)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best * decade
}

function documentFile(input: {
  id: string
  title: string
  description: string
  devices: DeviceDefinition[]
  viewDevices: NonNullable<DocumentFile['view']['devices']>
}): DocumentFile {
  const now = new Date().toISOString()
  return {
    schemaVersion: '4.0.0',
    document: {
      id: input.id,
      title: input.title,
      description: input.description,
      createdAt: now,
      updatedAt: now,
      source: 'ai',
      tags: ['agent', 'voltage-divider', 'quick-build'],
    },
    devices: input.devices,
    view: {
      canvas: { units: 'px', grid: { enabled: true, size: DEFAULT_GRID_SIZE, majorEvery: 4 }, background: 'grid' },
      devices: input.viewDevices,
      networkLines: {},
      focus: { preferredDirection: 'left-to-right' },
    },
  }
}

function candidate(
  title: string,
  document: DocumentFile,
  assumptions: string[],
  warnings: string[],
  tradeoffs: string[],
): AgentBlueprintCandidate {
  return {
    title,
    summary: document.document.description ?? title,
    rationale: `Generated by the deterministic voltage divider blueprint tool. Assumptions: ${assumptions.join(' ')}`,
    tradeoffs,
    document,
    highlightedLabels: ['VIN', 'VOUT', 'GND'].filter((label) => documentUsesLabel(document, label)),
    notes: assumptions,
    issues: warnings.map((message, index) => warningIssue(`vdivider.warning.${index + 1}`, message)),
  }
}

function documentUsesLabel(document: DocumentFile, label: string): boolean {
  return document.devices.some((device) => device.terminals.some((terminal) => terminal.label === label))
}

function connector(id: string, name: string, reference: string, label: string, role: string): DeviceDefinition {
  return {
    id,
    name,
    kind: 'connector',
    category: 'interface',
    reference,
    properties: { topology: role },
    terminals: [terminal(`${id}-pin`, label, 'output', label, 'right', 0)],
  }
}

function groundDevice(id: string, label: string): DeviceDefinition {
  return {
    id,
    name: label,
    kind: 'ground',
    category: 'power',
    reference: label,
    terminals: [terminal(`${id}-pin`, label, 'input', label, 'top', 0)],
  }
}

function terminal(
  id: string,
  name: string,
  direction: 'input' | 'output',
  label: string,
  side: 'left' | 'right' | 'top' | 'bottom',
  order: number,
) {
  return { id, name, direction, label, side, order }
}

function view(x: number, y: number, width = DEFAULT_DEVICE_SIZE.width, height = DEFAULT_DEVICE_SIZE.height) {
  return { position: { x, y }, size: { width, height }, shape: 'rectangle' as const }
}

function warningIssue(code: string, message: string): ValidationIssue {
  return { severity: 'warning', code, message, entityId: null, path: null }
}

function stableId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function formatResistance(value: number): string {
  if (value >= 1_000_000) return `${formatNumber(value / 1_000_000)} Mohm`
  if (value >= 1_000) return `${formatNumber(value / 1_000)} kohm`
  return `${formatNumber(value)} ohm`
}

function formatVoltage(value: number): string {
  return `${formatNumber(value)} V`
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return Number.parseFloat(value.toPrecision(4)).toString()
}
