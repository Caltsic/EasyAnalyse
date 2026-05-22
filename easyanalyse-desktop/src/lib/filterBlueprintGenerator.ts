import type { AgentBlueprintCandidate } from '../types/agent'
import type { DeviceDefinition, DocumentFile, ValidationIssue } from '../types/document'

export type FilterBlueprintType = 'lowpass' | 'highpass'
export type FilterBlueprintTopology = 'auto' | 'passive-rc' | 'sallen-key'

export interface FilterBlueprintSupplyInput {
  positive?: string
  negative?: string
  ground?: string
}

export interface GenerateFilterBlueprintInput {
  filterType: FilterBlueprintType
  topology: FilterBlueprintTopology
  cutoffFrequencyHz: number
  q?: number
  gain?: number
  resistorOhms?: number
  capacitorFarads?: number
  preferredCapacitorFarads?: number
  title?: string
  supply?: FilterBlueprintSupplyInput
}

export interface GenerateFilterBlueprintOutput {
  candidate: AgentBlueprintCandidate
  assumptions: string[]
  calculatedValues: Record<string, number | string>
  warnings: string[]
}

interface RcChoice {
  resistorOhms: number
  capacitorFarads: number
  actualCutoffFrequencyHz: number
}

const TWO_PI = 2 * Math.PI
const DEFAULT_GRID_SIZE = 24
const DEFAULT_DEVICE_SIZE = { width: 180, height: 96 }
const OP_AMP_SIZE = { width: 220, height: 132 }
const E24_BASE = [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91]
const CAPACITOR_CHOICES_FARADS = [1e-9, 2.2e-9, 4.7e-9, 10e-9, 22e-9, 47e-9, 100e-9, 220e-9, 1e-6]

export function generateFilterBlueprint(input: GenerateFilterBlueprintInput): GenerateFilterBlueprintOutput {
  const topology = resolveTopology(input)
  if (topology === 'sallen-key') {
    return generateSallenKeyLowpass(input)
  }
  return generatePassiveRcFilter(input)
}

function resolveTopology(input: GenerateFilterBlueprintInput): Exclude<FilterBlueprintTopology, 'auto'> {
  if (input.topology !== 'auto') return input.topology
  if (input.filterType === 'lowpass' && (input.q ?? 0) > 0.8) return 'sallen-key'
  return 'passive-rc'
}

function generatePassiveRcFilter(input: GenerateFilterBlueprintInput): GenerateFilterBlueprintOutput {
  const rc = chooseRcValues(input)
  const filterName = input.filterType === 'lowpass' ? 'RC low-pass filter' : 'RC high-pass filter'
  const title = input.title?.trim() || `${filterName} ${formatFrequency(input.cutoffFrequencyHz)}`
  const documentId = stableId(`filter-${input.filterType}-passive-rc-${Math.round(input.cutoffFrequencyHz)}`)
  const resistorTerminals = input.filterType === 'lowpass'
    ? [
        terminal('r1-a', 'A', 'input', 'VIN', 'left', 0),
        terminal('r1-b', 'B', 'output', 'VOUT', 'right', 0),
      ]
    : [
        terminal('r1-a', 'A', 'input', 'VOUT', 'top', 0),
        terminal('r1-b', 'B', 'output', 'GND', 'bottom', 0),
      ]
  const capacitorTerminals = input.filterType === 'lowpass'
    ? [
        terminal('c1-a', 'A', 'input', 'VOUT', 'top', 0),
        terminal('c1-b', 'B', 'output', 'GND', 'bottom', 0),
      ]
    : [
        terminal('c1-a', 'A', 'input', 'VIN', 'left', 0),
        terminal('c1-b', 'B', 'output', 'VOUT', 'right', 0),
      ]
  const devices: DeviceDefinition[] = [
    connector('j1', 'Input', 'J1', 'VIN', 'input signal'),
    {
      id: 'r1',
      name: 'Filter resistor',
      kind: 'resistor',
      category: 'passive',
      reference: 'R1',
      properties: { value: formatResistance(rc.resistorOhms), topology: input.filterType === 'lowpass' ? 'series resistor' : 'shunt resistor' },
      terminals: resistorTerminals,
    },
    {
      id: 'c1',
      name: 'Filter capacitor',
      kind: 'capacitor',
      category: 'passive',
      reference: 'C1',
      properties: { value: formatCapacitance(rc.capacitorFarads), topology: input.filterType === 'lowpass' ? 'shunt capacitor' : 'series capacitor' },
      terminals: capacitorTerminals,
    },
    connector('tp1', 'Output', 'TP1', 'VOUT', 'filtered output'),
    groundDevice('gnd1', 'GND'),
  ]
  const document = documentFile({
    id: documentId,
    title,
    description: `${filterName}, target cutoff ${formatFrequency(input.cutoffFrequencyHz)}, actual cutoff ${formatFrequency(rc.actualCutoffFrequencyHz)}.`,
    devices,
    viewDevices: {
      j1: view(80, 220, 160, 88),
      r1: view(input.filterType === 'lowpass' ? 360 : 560, input.filterType === 'lowpass' ? 220 : 360),
      c1: view(input.filterType === 'lowpass' ? 560 : 360, input.filterType === 'lowpass' ? 360 : 220),
      tp1: view(820, 220, 160, 88),
      gnd1: view(560, 560, 160, 88),
    },
  })
  const assumptions = [
    `Selected passive RC ${input.filterType} topology.`,
    input.capacitorFarads || input.resistorOhms
      ? 'Used user-provided R/C value where supplied and calculated the complementary value.'
      : 'Selected a practical capacitor value and rounded the resistor to E24.',
  ]
  const warnings = ['A first-order passive RC filter has low roll-off and Q is not independently adjustable.']
  return {
    candidate: candidate(title, document, assumptions, warnings, ['Passive RC filters are simple but load-sensitive.']),
    assumptions,
    warnings,
    calculatedValues: {
      topology: 'passive-rc',
      filterType: input.filterType,
      resistorOhms: rc.resistorOhms,
      capacitorFarads: rc.capacitorFarads,
      targetCutoffFrequencyHz: input.cutoffFrequencyHz,
      actualCutoffFrequencyHz: rc.actualCutoffFrequencyHz,
    },
  }
}

function generateSallenKeyLowpass(input: GenerateFilterBlueprintInput): GenerateFilterBlueprintOutput {
  if (input.filterType !== 'lowpass') {
    throw new Error('Sallen-Key generation currently supports lowpass filters only.')
  }
  const rc = chooseRcValues(input)
  const targetQ = input.q && Number.isFinite(input.q) ? input.q : 0.707
  const requestedGain = input.gain && Number.isFinite(input.gain) ? input.gain : null
  const calculatedGain = requestedGain ?? 3 - 1 / Math.max(targetQ, 0.5)
  const gain = clamp(calculatedGain, 1, 2.95)
  const effectiveQ = 1 / (3 - gain)
  const rgOhms = 10_000
  const rfOhms = Math.max(0, roundToE24((gain - 1) * rgOhms))
  const positiveRail = input.supply?.positive?.trim() || 'VCC'
  const negativeRail = input.supply?.negative?.trim() || 'GND'
  const ground = input.supply?.ground?.trim() || 'GND'
  const title = input.title?.trim() || `Sallen-Key low-pass filter ${formatFrequency(input.cutoffFrequencyHz)}`
  const documentId = stableId(`filter-lowpass-sallen-key-${Math.round(input.cutoffFrequencyHz)}-${Math.round(effectiveQ * 100)}`)
  const devices: DeviceDefinition[] = [
    connector('j1', 'Input', 'J1', 'VIN', 'input signal'),
    resistor('r1', 'Input resistor 1', 'R1', 'VIN', 'SK_N1', rc.resistorOhms),
    resistor('r2', 'Input resistor 2', 'R2', 'SK_N1', 'SK_N2', rc.resistorOhms),
    capacitor('c1', 'Feedback capacitor', 'C1', 'SK_N1', 'VOUT', rc.capacitorFarads, 'feedback capacitor'),
    capacitor('c2', 'Shunt capacitor', 'C2', 'SK_N2', ground, rc.capacitorFarads, 'shunt capacitor'),
    {
      id: 'u1',
      name: 'Sallen-Key op amp',
      kind: 'op-amp',
      category: 'analog',
      reference: 'U1',
      properties: {
        gain: formatGain(gain),
        topology: 'Sallen-Key low-pass stage',
        cutoffFrequency: formatFrequency(rc.actualCutoffFrequencyHz),
        q: formatNumber(effectiveQ),
      },
      terminals: [
        terminal('u1-in-plus', 'IN+', 'input', 'SK_N2', 'left', 0),
        terminal('u1-in-minus', 'IN-', 'input', gain <= 1.01 ? 'VOUT' : 'SK_FB', 'left', 1),
        terminal('u1-out', 'OUT', 'output', 'VOUT', 'right', 0),
        terminal('u1-v-plus', 'V+', 'input', positiveRail, 'top', 0),
        terminal('u1-v-minus', 'V-', 'input', negativeRail, 'bottom', 0),
      ],
    },
    connector('tp1', 'Output', 'TP1', 'VOUT', 'filtered output'),
    powerSource('vcc1', positiveRail),
    groundDevice('gnd1', ground),
  ]
  const viewDevices = {
    j1: view(80, 320, 160, 88),
    r1: view(320, 320),
    r2: view(600, 320),
    c1: view(460, 120),
    c2: view(600, 520),
    u1: view(900, 300, OP_AMP_SIZE.width, OP_AMP_SIZE.height),
    tp1: view(1240, 320, 160, 88),
    vcc1: view(900, 80, 160, 88),
    gnd1: view(900, 560, 160, 88),
  }
  if (gain > 1.01) {
    devices.push(resistor('rg', 'Gain resistor to ground', 'RG', 'SK_FB', ground, rgOhms))
    devices.push(resistor('rf', 'Feedback gain resistor', 'RF', 'VOUT', 'SK_FB', rfOhms))
    Object.assign(viewDevices, {
      rg: view(1120, 520),
      rf: view(1120, 120),
    })
  }
  const document = documentFile({
    id: documentId,
    title,
    description: `Second-order Sallen-Key low-pass filter, target cutoff ${formatFrequency(input.cutoffFrequencyHz)}, Q ${formatNumber(effectiveQ)}, gain ${formatGain(gain)}.`,
    devices,
    viewDevices,
  })
  const assumptions = [
    'Selected equal-component Sallen-Key low-pass topology.',
    requestedGain === null ? 'Calculated non-inverting gain from Q using Q = 1 / (3 - K).' : 'Used requested non-inverting gain and reported the resulting Q.',
    'Selected equal R and C values for a compact deterministic first prototype.',
  ]
  const warnings: string[] = []
  if (targetQ > 5 || gain > 2.8) {
    warnings.push('High-Q Sallen-Key filters are very sensitive to component tolerance, op-amp bandwidth, and gain error.')
  }
  if (calculatedGain !== gain) {
    warnings.push('Requested Q or gain was clamped to keep the equal-component Sallen-Key stage below gain 3.')
  }
  return {
    candidate: candidate(title, document, assumptions, warnings, [
      'Equal-component Sallen-Key filters are simple but high-Q designs should be checked with real op-amp and tolerance models.',
    ]),
    assumptions,
    warnings,
    calculatedValues: {
      topology: 'sallen-key',
      filterType: 'lowpass',
      resistorOhms: rc.resistorOhms,
      capacitorFarads: rc.capacitorFarads,
      targetCutoffFrequencyHz: input.cutoffFrequencyHz,
      actualCutoffFrequencyHz: rc.actualCutoffFrequencyHz,
      q: effectiveQ,
      gain,
      ...(gain > 1.01 ? { rgOhms, rfOhms } : {}),
    },
  }
}

function chooseRcValues(input: GenerateFilterBlueprintInput): RcChoice {
  const requestedCapacitorFarads = input.capacitorFarads ?? input.preferredCapacitorFarads
  const seedCapacitorFarads = requestedCapacitorFarads ?? chooseCapacitorForCutoff(input.cutoffFrequencyHz)
  const resistorOhms = input.resistorOhms
    ? roundToE24(input.resistorOhms)
    : roundToE24(1 / (TWO_PI * input.cutoffFrequencyHz * seedCapacitorFarads))
  const capacitorFarads = requestedCapacitorFarads ?? 1 / (TWO_PI * input.cutoffFrequencyHz * resistorOhms)
  const actualCutoffFrequencyHz = 1 / (TWO_PI * resistorOhms * capacitorFarads)
  return { resistorOhms, capacitorFarads, actualCutoffFrequencyHz }
}

function chooseCapacitorForCutoff(cutoffFrequencyHz: number): number {
  let best = CAPACITOR_CHOICES_FARADS[3]!
  let bestScore = Number.POSITIVE_INFINITY
  for (const capacitorFarads of CAPACITOR_CHOICES_FARADS) {
    const resistorOhms = 1 / (TWO_PI * cutoffFrequencyHz * capacitorFarads)
    if (resistorOhms < 500 || resistorOhms > 2_000_000) continue
    const score = Math.abs(Math.log10(resistorOhms / 10_000))
    if (score < bestScore) {
      best = capacitorFarads
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
      tags: ['agent', 'filter', 'quick-build'],
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
    rationale: `Generated by the deterministic filter blueprint tool. Assumptions: ${assumptions.join(' ')}`,
    tradeoffs,
    document,
    highlightedLabels: ['VIN', 'VOUT', 'GND', 'VCC', 'SK_N1', 'SK_N2'].filter((label) => documentUsesLabel(document, label)),
    notes: assumptions,
    issues: warnings.map((message, index) => warningIssue(`filter.warning.${index + 1}`, message)),
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

function resistor(id: string, name: string, reference: string, inputLabel: string, outputLabel: string, resistorOhms: number): DeviceDefinition {
  return {
    id,
    name,
    kind: 'resistor',
    category: 'passive',
    reference,
    properties: { value: formatResistance(resistorOhms) },
    terminals: [
      terminal(`${id}-a`, 'A', 'input', inputLabel, 'left', 0),
      terminal(`${id}-b`, 'B', 'output', outputLabel, 'right', 0),
    ],
  }
}

function capacitor(id: string, name: string, reference: string, inputLabel: string, outputLabel: string, capacitorFarads: number, topology: string): DeviceDefinition {
  return {
    id,
    name,
    kind: 'capacitor',
    category: 'passive',
    reference,
    properties: { value: formatCapacitance(capacitorFarads), topology },
    terminals: [
      terminal(`${id}-a`, 'A', 'input', inputLabel, 'left', 0),
      terminal(`${id}-b`, 'B', 'output', outputLabel, 'right', 0),
    ],
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

function formatCapacitance(value: number): string {
  if (value >= 1e-6) return `${formatNumber(value / 1e-6)} uF`
  if (value >= 1e-9) return `${formatNumber(value / 1e-9)} nF`
  return `${formatNumber(value / 1e-12)} pF`
}

function formatFrequency(value: number): string {
  if (value >= 1_000_000) return `${formatNumber(value / 1_000_000)} MHz`
  if (value >= 1_000) return `${formatNumber(value / 1_000)} kHz`
  return `${formatNumber(value)} Hz`
}

function formatGain(value: number): string {
  return `${formatNumber(value)} V/V`
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return Number.parseFloat(value.toPrecision(4)).toString()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
