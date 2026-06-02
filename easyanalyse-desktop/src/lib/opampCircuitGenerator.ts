import type { AgentBlueprintCandidate } from '../types/agent'
import type { DeviceDefinition, DocumentFile, ValidationIssue } from '../types/document'

export type OpAmpCircuitType = 'non-inverting-amplifier' | 'inverting-amplifier' | 'voltage-follower'

export interface GenerateOpAmpCircuitInput {
  circuitType: OpAmpCircuitType
  gain?: number
  r1Ohms?: number
  rfOhms?: number
  title?: string
  positiveSupplyLabel?: string
  negativeSupplyLabel?: string
  groundLabel?: string
  vinLabel?: string
  voutLabel?: string
}

export interface GenerateOpAmpCircuitOutput {
  candidate: AgentBlueprintCandidate
  assumptions: string[]
  calculatedValues: Record<string, number | string>
  warnings: string[]
}

const DEFAULT_GRID_SIZE = 24
const DEFAULT_DEVICE_SIZE = { width: 180, height: 96 }
const OP_AMP_SIZE = { width: 220, height: 132 }
const E24_BASE = [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91]
const DEFAULT_R1_OHMS = 10_000

export function generateOpAmpCircuit(input: GenerateOpAmpCircuitInput): GenerateOpAmpCircuitOutput {
  switch (input.circuitType) {
    case 'non-inverting-amplifier':
      return generateNonInvertingAmplifier(input)
    case 'inverting-amplifier':
      return generateInvertingAmplifier(input)
    case 'voltage-follower':
      return generateVoltageFollower(input)
  }
}

function generateNonInvertingAmplifier(input: GenerateOpAmpCircuitInput): GenerateOpAmpCircuitOutput {
  const vinLabel = input.vinLabel?.trim() || 'VIN'
  const voutLabel = input.voutLabel?.trim() || 'VOUT'
  const positiveRail = input.positiveSupplyLabel?.trim() || 'VCC'
  const negativeRail = input.negativeSupplyLabel?.trim() || 'GND'
  const ground = input.groundLabel?.trim() || 'GND'

  const targetGain = input.gain ?? 2
  const { r1Ohms, rfOhms, actualGain } = resolveNonInvertingResistors(input, targetGain)

  const warnings = buildOpAmpWarnings(actualGain, r1Ohms, rfOhms, 'non-inverting')

  const title = input.title?.trim() || `Non-inverting amplifier gain ${formatGain(actualGain)}`
  const documentId = stableId(`opamp-noninv-gain-${Math.round(actualGain * 10)}`)

  const devices: DeviceDefinition[] = [
    connector('j1', 'Input', 'J1', vinLabel, 'input signal'),
    {
      id: 'u1',
      name: 'Non-inverting op amp',
      kind: 'op-amp',
      category: 'analog',
      reference: 'U1',
      properties: {
        gain: formatGain(actualGain),
        topology: 'non-inverting amplifier',
      },
      terminals: [
        terminal('u1-in-plus', 'IN+', 'input', vinLabel, 'left', 0),
        terminal('u1-in-minus', 'IN-', 'input', 'FB', 'left', 1),
        terminal('u1-out', 'OUT', 'output', voutLabel, 'right', 0),
        terminal('u1-v-plus', 'V+', 'input', positiveRail, 'top', 0),
        terminal('u1-v-minus', 'V-', 'input', negativeRail, 'bottom', 0),
      ],
    },
    {
      id: 'r1',
      name: 'Gain resistor to ground',
      kind: 'resistor',
      category: 'passive',
      reference: 'R1',
      properties: { value: formatResistance(r1Ohms), topology: 'gain-setting resistor' },
      terminals: [
        terminal('r1-a', 'A', 'input', 'FB', 'left', 0),
        terminal('r1-b', 'B', 'output', ground, 'right', 0),
      ],
    },
    {
      id: 'rf',
      name: 'Feedback resistor',
      kind: 'resistor',
      category: 'passive',
      reference: 'RF',
      properties: { value: formatResistance(rfOhms), topology: 'feedback resistor' },
      terminals: [
        terminal('rf-a', 'A', 'input', voutLabel, 'left', 0),
        terminal('rf-b', 'B', 'output', 'FB', 'right', 0),
      ],
    },
    connector('tp1', 'Output', 'TP1', voutLabel, 'amplified output'),
    powerSource('vcc1', positiveRail),
    groundDevice('gnd1', ground),
  ]

  const document = documentFile({
    id: documentId,
    title,
    description: `Non-inverting op-amp amplifier, gain ${formatGain(actualGain)}, R1 ${formatResistance(r1Ohms)}, Rf ${formatResistance(rfOhms)}.`,
    devices,
    viewDevices: {
      j1: view(80, 300, 160, 88),
      u1: view(500, 280, OP_AMP_SIZE.width, OP_AMP_SIZE.height),
      r1: view(340, 480),
      rf: view(340, 80),
      tp1: view(820, 300, 160, 88),
      vcc1: view(500, 60, 160, 88),
      gnd1: view(500, 540, 160, 88),
    },
  })

  const assumptions = buildOpAmpAssumptions('non-inverting', r1Ohms, rfOhms, actualGain, targetGain, input)
  const tradeoffs = [
    'Non-inverting amplifiers have high input impedance but the gain cannot be less than 1.',
    'Real op-amp bandwidth and slew rate must be verified for the target signal frequency.',
  ]

  return {
    candidate: candidate(title, document, assumptions, warnings, tradeoffs),
    assumptions,
    warnings,
    calculatedValues: {
      topology: 'non-inverting-amplifier',
      targetGain,
      actualGain: Number.parseFloat(actualGain.toPrecision(4)),
      r1Ohms,
      rfOhms,
    },
  }
}

function generateInvertingAmplifier(input: GenerateOpAmpCircuitInput): GenerateOpAmpCircuitOutput {
  const vinLabel = input.vinLabel?.trim() || 'VIN'
  const voutLabel = input.voutLabel?.trim() || 'VOUT'
  const positiveRail = input.positiveSupplyLabel?.trim() || 'VCC'
  const negativeRail = input.negativeSupplyLabel?.trim() || 'GND'
  const ground = input.groundLabel?.trim() || 'GND'

  const targetGain = input.gain ?? 2
  const { r1Ohms, rfOhms, actualGain } = resolveInvertingResistors(input, targetGain)

  const warnings = buildOpAmpWarnings(actualGain, r1Ohms, rfOhms, 'inverting')

  const title = input.title?.trim() || `Inverting amplifier gain ${formatGain(actualGain)}`
  const documentId = stableId(`opamp-inv-gain-${Math.round(actualGain * 10)}`)

  const devices: DeviceDefinition[] = [
    connector('j1', 'Input', 'J1', vinLabel, 'input signal'),
    {
      id: 'r1',
      name: 'Input resistor',
      kind: 'resistor',
      category: 'passive',
      reference: 'R1',
      properties: { value: formatResistance(r1Ohms), topology: 'inverting input resistor' },
      terminals: [
        terminal('r1-a', 'A', 'input', vinLabel, 'left', 0),
        terminal('r1-b', 'B', 'output', 'SUM', 'right', 0),
      ],
    },
    {
      id: 'u1',
      name: 'Inverting op amp',
      kind: 'op-amp',
      category: 'analog',
      reference: 'U1',
      properties: {
        gain: formatGain(actualGain),
        topology: 'inverting amplifier',
      },
      terminals: [
        terminal('u1-in-plus', 'IN+', 'input', ground, 'left', 0),
        terminal('u1-in-minus', 'IN-', 'input', 'SUM', 'left', 1),
        terminal('u1-out', 'OUT', 'output', voutLabel, 'right', 0),
        terminal('u1-v-plus', 'V+', 'input', positiveRail, 'top', 0),
        terminal('u1-v-minus', 'V-', 'input', negativeRail, 'bottom', 0),
      ],
    },
    {
      id: 'rf',
      name: 'Feedback resistor',
      kind: 'resistor',
      category: 'passive',
      reference: 'RF',
      properties: { value: formatResistance(rfOhms), topology: 'feedback resistor' },
      terminals: [
        terminal('rf-a', 'A', 'input', voutLabel, 'left', 0),
        terminal('rf-b', 'B', 'output', 'SUM', 'right', 0),
      ],
    },
    connector('tp1', 'Output', 'TP1', voutLabel, 'amplified output'),
    powerSource('vcc1', positiveRail),
    groundDevice('gnd1', ground),
  ]

  const document = documentFile({
    id: documentId,
    title,
    description: `Inverting op-amp amplifier, gain ${formatGain(actualGain)}, R1 ${formatResistance(r1Ohms)}, Rf ${formatResistance(rfOhms)}.`,
    devices,
    viewDevices: {
      j1: view(80, 300, 160, 88),
      r1: view(300, 300),
      u1: view(580, 280, OP_AMP_SIZE.width, OP_AMP_SIZE.height),
      rf: view(400, 80),
      tp1: view(900, 300, 160, 88),
      vcc1: view(580, 60, 160, 88),
      gnd1: view(580, 540, 160, 88),
    },
  })

  const assumptions = buildOpAmpAssumptions('inverting', r1Ohms, rfOhms, actualGain, targetGain, input)
  const tradeoffs = [
    'Inverting amplifiers have lower input impedance (set by R1) but the gain can be less than 1.',
    'The virtual ground at the inverting input means the input sees R1 to ground.',
  ]

  return {
    candidate: candidate(title, document, assumptions, warnings, tradeoffs),
    assumptions,
    warnings,
    calculatedValues: {
      topology: 'inverting-amplifier',
      targetGain,
      actualGain: Number.parseFloat(actualGain.toPrecision(4)),
      r1Ohms,
      rfOhms,
      inputImpedanceOhms: r1Ohms,
    },
  }
}

function generateVoltageFollower(input: GenerateOpAmpCircuitInput): GenerateOpAmpCircuitOutput {
  const vinLabel = input.vinLabel?.trim() || 'VIN'
  const voutLabel = input.voutLabel?.trim() || 'VOUT'
  const positiveRail = input.positiveSupplyLabel?.trim() || 'VCC'
  const negativeRail = input.negativeSupplyLabel?.trim() || 'GND'
  const ground = input.groundLabel?.trim() || 'GND'

  const warnings: string[] = []

  const title = input.title?.trim() || 'Voltage follower'
  const documentId = stableId('opamp-follower')

  const devices: DeviceDefinition[] = [
    connector('j1', 'Input', 'J1', vinLabel, 'input signal'),
    {
      id: 'u1',
      name: 'Voltage follower op amp',
      kind: 'op-amp',
      category: 'analog',
      reference: 'U1',
      properties: {
        gain: '1 V/V',
        topology: 'voltage follower (buffer)',
      },
      terminals: [
        terminal('u1-in-plus', 'IN+', 'input', vinLabel, 'left', 0),
        terminal('u1-in-minus', 'IN-', 'input', voutLabel, 'bottom', 1),
        terminal('u1-out', 'OUT', 'output', voutLabel, 'right', 0),
        terminal('u1-v-plus', 'V+', 'input', positiveRail, 'top', 0),
        terminal('u1-v-minus', 'V-', 'input', negativeRail, 'bottom', 2),
      ],
    },
    connector('tp1', 'Output', 'TP1', voutLabel, 'buffered output'),
    powerSource('vcc1', positiveRail),
    groundDevice('gnd1', ground),
  ]

  const document = documentFile({
    id: documentId,
    title,
    description: 'Voltage follower (unity-gain buffer), gain 1 V/V, high input impedance, low output impedance.',
    devices,
    viewDevices: {
      j1: view(80, 300, 160, 88),
      u1: view(500, 280, OP_AMP_SIZE.width, OP_AMP_SIZE.height),
      tp1: view(820, 300, 160, 88),
      vcc1: view(500, 60, 160, 88),
      gnd1: view(500, 540, 160, 88),
    },
  })

  const assumptions = [
    'Used voltage follower (unity-gain buffer) topology.',
    'No gain resistors needed — output is connected directly to the inverting input.',
    'Provides high input impedance and low output impedance for signal buffering.',
  ]
  const tradeoffs = [
    'Voltage followers provide impedance buffering without gain. The op-amp must be stable at unity gain.',
    'The output swing is limited by the supply rails and the op-amp output stage.',
  ]

  return {
    candidate: candidate(title, document, assumptions, warnings, tradeoffs),
    assumptions,
    warnings,
    calculatedValues: {
      topology: 'voltage-follower',
      gain: 1,
    },
  }
}

function resolveNonInvertingResistors(
  input: GenerateOpAmpCircuitInput,
  targetGain: number,
): { r1Ohms: number; rfOhms: number; actualGain: number } {
  const hasBoth = input.r1Ohms !== undefined && input.rfOhms !== undefined
  if (hasBoth) {
    const r1Ohms = roundToE24(input.r1Ohms!)
    const rfOhms = roundToE24(input.rfOhms!)
    const actualGain = 1 + rfOhms / r1Ohms
    return { r1Ohms, rfOhms, actualGain }
  }

  const r1Ohms = input.r1Ohms !== undefined ? roundToE24(input.r1Ohms) : DEFAULT_R1_OHMS
  const idealRf = (targetGain - 1) * r1Ohms
  const rfOhms = input.rfOhms !== undefined ? roundToE24(input.rfOhms) : roundToE24(Math.max(0, idealRf))
  const actualGain = 1 + rfOhms / r1Ohms
  return { r1Ohms, rfOhms, actualGain }
}

function resolveInvertingResistors(
  input: GenerateOpAmpCircuitInput,
  targetGain: number,
): { r1Ohms: number; rfOhms: number; actualGain: number } {
  const hasBoth = input.r1Ohms !== undefined && input.rfOhms !== undefined
  if (hasBoth) {
    const r1Ohms = roundToE24(input.r1Ohms!)
    const rfOhms = roundToE24(input.rfOhms!)
    const actualGain = rfOhms / r1Ohms
    return { r1Ohms, rfOhms, actualGain }
  }

  const r1Ohms = input.r1Ohms !== undefined ? roundToE24(input.r1Ohms) : DEFAULT_R1_OHMS
  const idealRf = targetGain * r1Ohms
  const rfOhms = input.rfOhms !== undefined ? roundToE24(input.rfOhms) : roundToE24(Math.max(0, idealRf))
  const actualGain = rfOhms / r1Ohms
  return { r1Ohms, rfOhms, actualGain }
}

function buildOpAmpWarnings(
  gain: number,
  r1Ohms: number,
  rfOhms: number,
  topology: 'non-inverting' | 'inverting',
): string[] {
  const warnings: string[] = []
  if (gain > 100) {
    warnings.push(`Single-stage ${topology} gain of ${Math.round(gain)} is very high. Check the op-amp gain-bandwidth product for the target signal frequency.`)
  }
  if (rfOhms > 1_000_000) {
    warnings.push('Feedback resistor exceeds 1 Mohm. The circuit may be sensitive to noise and PCB leakage.')
  }
  if (r1Ohms < 100) {
    warnings.push('Gain resistor is below 100 ohms. The op-amp output may need to source significant current.')
  }
  if (gain < 0.1 && topology === 'inverting') {
    warnings.push('Inverting gain is less than 0.1. This is an attenuator — verify this is intentional.')
  }
  return warnings
}

function buildOpAmpAssumptions(
  topology: 'non-inverting' | 'inverting',
  r1Ohms: number,
  rfOhms: number,
  actualGain: number,
  targetGain: number,
  input: GenerateOpAmpCircuitInput,
): string[] {
  const hasBoth = input.r1Ohms !== undefined && input.rfOhms !== undefined
  const gainNote = hasBoth
    ? `Used user-provided R1 (${formatResistance(r1Ohms)}) and Rf (${formatResistance(rfOhms)}) and calculated the resulting gain of ${formatGain(actualGain)}.`
    : `Anchored R1 at ${formatResistance(r1Ohms)} and calculated Rf from target gain of ${formatGain(targetGain)} (actual ${formatGain(actualGain)}).`
  return [
    `Used ${topology} amplifier topology.`,
    gainNote,
    'Selected E24 resistor values for a deterministic first prototype.',
    'Assumes an ideal op-amp model. Verify bandwidth, slew rate, and output swing with real device parameters.',
  ]
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
      tags: ['agent', 'opamp', 'quick-build'],
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
    rationale: `Generated by the deterministic op-amp circuit blueprint tool. Assumptions: ${assumptions.join(' ')}`,
    tradeoffs,
    document,
    highlightedLabels: ['VIN', 'VOUT', 'VCC', 'GND', 'FB', 'SUM'].filter((label) => documentUsesLabel(document, label)),
    notes: assumptions,
    issues: warnings.map((message, index) => warningIssue(`opamp.warning.${index + 1}`, message)),
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

function powerSource(id: string, label: string): DeviceDefinition {
  return {
    id,
    name: `${label} supply`,
    kind: 'power-source',
    category: 'power',
    reference: label,
    properties: { voltage: label },
    terminals: [terminal(`${id}-out`, label, 'output', label, 'right', 0)],
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

function formatGain(value: number): string {
  return `${formatNumber(value)} V/V`
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return Number.parseFloat(value.toPrecision(4)).toString()
}
