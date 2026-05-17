import type { DocumentFile } from '../types/document'

export interface AgentReferenceExample {
  id: string
  title: string
  tags: string[]
  rationale: string
  document: DocumentFile
}

const now = '2026-05-06T00:00:00.000Z'

export const AGENT_REFERENCE_EXAMPLES: readonly AgentReferenceExample[] = [
  {
    id: 'sallen-key-lowpass-reference',
    title: 'High-Q active low-pass filter semantic-v4 reference',
    tags: ['filter', 'low-pass', 'high-q', 'sallen-key', 'opamp', 'analog', 'square-wave'],
    rationale: 'Shows a second-order active low-pass style topology, source stimulus, feedback gain, and output test point using terminal labels only.',
    document: {
      schemaVersion: '4.0.0',
      document: { id: 'example-sallen-key-lowpass', title: 'High-Q active low-pass filter example', createdAt: now, updatedAt: now, tags: ['example', 'filter', 'active'] },
      devices: [
        { id: 'src1', name: 'VIN_SRC', kind: 'square_wave_source', properties: { frequency: '500 Hz' }, terminals: [
          { id: 'src1-out', name: 'OUT', label: 'VIN', direction: 'output' },
          { id: 'src1-gnd', name: 'GND', label: 'GND', direction: 'output' },
        ] },
        { id: 'r1', name: 'R1', kind: 'resistor', properties: { value: '7.96 kohm' }, terminals: [
          { id: 'r1-a', name: 'A', label: 'VIN', direction: 'input' },
          { id: 'r1-b', name: 'B', label: 'LP_N1', direction: 'output' },
        ] },
        { id: 'r2', name: 'R2', kind: 'resistor', properties: { value: '7.96 kohm' }, terminals: [
          { id: 'r2-a', name: 'A', label: 'LP_N1', direction: 'input' },
          { id: 'r2-b', name: 'B', label: 'LP_N2', direction: 'output' },
        ] },
        { id: 'c1', name: 'C1', kind: 'capacitor', properties: { value: '10 nF' }, terminals: [
          { id: 'c1-a', name: 'A', label: 'LP_N1', direction: 'input' },
          { id: 'c1-b', name: 'B', label: 'GND', direction: 'output' },
        ] },
        { id: 'c2', name: 'C2', kind: 'capacitor', properties: { value: '10 nF' }, terminals: [
          { id: 'c2-a', name: 'A', label: 'LP_N2', direction: 'input' },
          { id: 'c2-b', name: 'B', label: 'VOUT', direction: 'output' },
        ] },
        { id: 'u1', name: 'U1', kind: 'op_amp', properties: { partNumber: 'LM358-class', topology: 'non-inverting high-Q active low-pass stage' }, terminals: [
          { id: 'u1-inp', name: '+', label: 'LP_N2', direction: 'input' },
          { id: 'u1-inn', name: '-', label: 'FB_DIV', direction: 'input' },
          { id: 'u1-out', name: 'OUT', label: 'VOUT', direction: 'output' },
          { id: 'u1-vp', name: 'V+', label: 'VCC', direction: 'input' },
          { id: 'u1-vn', name: 'V-', label: 'GND', direction: 'input' },
        ] },
        { id: 'rf', name: 'RF', kind: 'resistor', properties: { value: '18 kohm' }, terminals: [
          { id: 'rf-a', name: 'A', label: 'VOUT', direction: 'input' },
          { id: 'rf-b', name: 'B', label: 'FB_DIV', direction: 'output' },
        ] },
        { id: 'rg', name: 'RG', kind: 'resistor', properties: { value: '10 kohm' }, terminals: [
          { id: 'rg-a', name: 'A', label: 'FB_DIV', direction: 'input' },
          { id: 'rg-b', name: 'B', label: 'GND', direction: 'output' },
        ] },
        { id: 'tpout', name: 'TP_VOUT', kind: 'test_point', terminals: [{ id: 'tpout-a', name: 'A', label: 'VOUT', direction: 'input' }] },
      ],
      view: {
        canvas: { units: 'px', grid: { enabled: true, size: 16 } },
        devices: {
          src1: { position: { x: 64, y: 160 }, shape: 'circle' },
          r1: { position: { x: 344, y: 160 }, shape: 'rectangle' },
          r2: { position: { x: 624, y: 160 }, shape: 'rectangle' },
          c1: { position: { x: 344, y: 380 }, shape: 'rectangle' },
          c2: { position: { x: 624, y: 380 }, shape: 'rectangle' },
          u1: { position: { x: 904, y: 160 }, shape: 'triangle' },
          rf: { position: { x: 904, y: -40 }, shape: 'rectangle' },
          rg: { position: { x: 1184, y: -40 }, shape: 'rectangle' },
          tpout: { position: { x: 1184, y: 160 }, shape: 'circle' },
        },
        networkLines: {
          vin: { label: 'VIN', position: { x: 144, y: 104 }, length: 180 },
          lp_n1: { label: 'LP_N1', position: { x: 424, y: 104 }, length: 180 },
          lp_n2: { label: 'LP_N2', position: { x: 704, y: 104 }, length: 180 },
          vout: { label: 'VOUT', position: { x: 1050, y: 104 }, length: 260 },
          fb_div: { label: 'FB_DIV', position: { x: 1040, y: 88 }, length: 220 },
          gnd: { label: 'GND', position: { x: 560, y: 540 }, length: 440 },
          vcc: { label: 'VCC', position: { x: 1040, y: -104 }, length: 320 },
        },
      },
    },
  },
  {
    id: 'rc-lowpass-reference',
    title: 'RC low-pass filter semantic-v4 reference',
    tags: ['rc', 'filter', 'low-pass', 'analog', 'passive'],
    rationale: 'Shows simple two-device analog connectivity by shared terminal labels and non-overlapping view positions.',
    document: {
      schemaVersion: '4.0.0',
      document: { id: 'example-rc-lowpass', title: 'RC low-pass filter example', createdAt: now, updatedAt: now, tags: ['example', 'rc'] },
      devices: [
        { id: 'r1', name: 'R1', kind: 'resistor', properties: { value: '10 kΩ' }, terminals: [
          { id: 'r1-a', name: 'A', label: 'VIN', direction: 'input' },
          { id: 'r1-b', name: 'B', label: 'VOUT', direction: 'output' },
        ] },
        { id: 'c1', name: 'C1', kind: 'capacitor', properties: { value: '100 nF' }, terminals: [
          { id: 'c1-a', name: 'A', label: 'VOUT', direction: 'input' },
          { id: 'c1-b', name: 'B', label: 'GND', direction: 'output' },
        ] },
        { id: 'tp1', name: 'TP_VOUT', kind: 'test_point', terminals: [{ id: 'tp1-a', name: 'A', label: 'VOUT', direction: 'input' }] },
      ],
      view: {
        canvas: { units: 'px', grid: { enabled: true, size: 16 } },
        devices: {
          r1: { position: { x: 80, y: 96 }, shape: 'rectangle' },
          c1: { position: { x: 360, y: 96 }, shape: 'rectangle' },
          tp1: { position: { x: 640, y: 96 }, shape: 'circle' },
        },
        networkLines: {
          vin: { label: 'VIN', position: { x: 104, y: 40 }, length: 180 },
          vout: { label: 'VOUT', position: { x: 488, y: 40 }, length: 260 },
          gnd: { label: 'GND', position: { x: 360, y: 260 }, length: 320 },
        },
      },
    },
  },
  {
    id: 'inverting-opamp-reference',
    title: 'Inverting op-amp amplifier semantic-v4 reference',
    tags: ['opamp', 'amplifier', 'analog', 'feedback'],
    rationale: 'Shows feedback topology using labels: the inverting node is one shared label across input resistor, feedback resistor, and op-amp input.',
    document: {
      schemaVersion: '4.0.0',
      document: { id: 'example-inverting-opamp', title: 'Inverting op-amp amplifier example', createdAt: now, updatedAt: now, tags: ['example', 'opamp'] },
      devices: [
        { id: 'rin', name: 'RIN', kind: 'resistor', properties: { value: '10 kΩ' }, terminals: [
          { id: 'rin-a', name: 'A', label: 'VIN', direction: 'input' },
          { id: 'rin-b', name: 'B', label: 'N_INV', direction: 'output' },
        ] },
        { id: 'rf', name: 'RF', kind: 'resistor', properties: { value: '100 kΩ' }, terminals: [
          { id: 'rf-a', name: 'A', label: 'VOUT', direction: 'input' },
          { id: 'rf-b', name: 'B', label: 'N_INV', direction: 'output' },
        ] },
        { id: 'u1', name: 'U1', kind: 'op_amp', properties: { partNumber: 'LM358' }, terminals: [
          { id: 'u1-inp', name: '+', label: 'GND', direction: 'input' },
          { id: 'u1-inn', name: '-', label: 'N_INV', direction: 'input' },
          { id: 'u1-out', name: 'OUT', label: 'VOUT', direction: 'output' },
          { id: 'u1-vp', name: 'V+', label: 'VCC', direction: 'input' },
          { id: 'u1-vn', name: 'V-', label: 'GND', direction: 'input' },
        ] },
      ],
      view: {
        canvas: { units: 'px', grid: { enabled: true, size: 16 } },
        devices: {
          rin: { position: { x: 80, y: 160 }, shape: 'rectangle' },
          rf: { position: { x: 360, y: -40 }, shape: 'rectangle' },
          u1: { position: { x: 640, y: 160 }, shape: 'triangle' },
        },
        networkLines: {
          vin: { label: 'VIN', position: { x: 160, y: 104 }, length: 220 },
          n_inv: { label: 'N_INV', position: { x: 420, y: 104 }, length: 220 },
          vout: { label: 'VOUT', position: { x: 760, y: 104 }, length: 260 },
          gnd: { label: 'GND', position: { x: 560, y: 392 }, length: 360 },
          vcc: { label: 'VCC', position: { x: 440, y: -104 }, length: 360 },
        },
      },
    },
  },
  {
    id: 'mcu-rs485-node-reference',
    title: 'MCU RS-485 interface node semantic-v4 reference',
    tags: ['mcu', 'rs485', 'digital', 'interface', 'power', 'complex'],
    rationale: 'Higher-complexity system example with MCU, transceiver, protection, biasing, decoupling, and connector represented by terminal labels only.',
    document: {
      schemaVersion: '4.0.0',
      document: { id: 'example-mcu-rs485-node', title: 'MCU RS-485 interface node example', createdAt: now, updatedAt: now, tags: ['example', 'mcu', 'rs485'] },
      devices: [
        { id: 'u_mcu', name: 'U_MCU', kind: 'mcu', properties: { partNumber: 'STM32-class MCU' }, terminals: [
          { id: 'mcu-tx', name: 'USART_TX', label: 'MCU_TX', direction: 'output' },
          { id: 'mcu-rx', name: 'USART_RX', label: 'MCU_RX', direction: 'input' },
          { id: 'mcu-de', name: 'RS485_DE', label: 'RS485_DE', direction: 'output' },
          { id: 'mcu-vdd', name: 'VDD', label: 'VCC_3V3', direction: 'input' },
          { id: 'mcu-gnd', name: 'GND', label: 'GND', direction: 'input' },
        ] },
        { id: 'u485', name: 'U485', kind: 'transceiver', properties: { partNumber: 'MAX3485-class' }, terminals: [
          { id: 'u485-di', name: 'DI', label: 'MCU_TX', direction: 'input' },
          { id: 'u485-ro', name: 'RO', label: 'MCU_RX', direction: 'output' },
          { id: 'u485-de', name: 'DE', label: 'RS485_DE', direction: 'input' },
          { id: 'u485-re', name: '/RE', label: 'RS485_DE', direction: 'input' },
          { id: 'u485-a', name: 'A', label: 'RS485_A', direction: 'output' },
          { id: 'u485-b', name: 'B', label: 'RS485_B', direction: 'output' },
          { id: 'u485-vcc', name: 'VCC', label: 'VCC_3V3', direction: 'input' },
          { id: 'u485-gnd', name: 'GND', label: 'GND', direction: 'input' },
        ] },
        { id: 'rt', name: 'RT', kind: 'resistor', properties: { value: '120 Ω' }, terminals: [
          { id: 'rt-a', name: 'A', label: 'RS485_A', direction: 'input' },
          { id: 'rt-b', name: 'B', label: 'RS485_B', direction: 'output' },
        ] },
        { id: 'tvs', name: 'D_TVS', kind: 'tvs_diode', terminals: [
          { id: 'tvs-a', name: 'A', label: 'RS485_A', direction: 'input' },
          { id: 'tvs-b', name: 'B', label: 'RS485_B', direction: 'input' },
          { id: 'tvs-g', name: 'GND', label: 'GND', direction: 'output' },
        ] },
        { id: 'j1', name: 'J1', kind: 'connector', terminals: [
          { id: 'j1-a', name: 'A', label: 'RS485_A', direction: 'input' },
          { id: 'j1-b', name: 'B', label: 'RS485_B', direction: 'input' },
          { id: 'j1-g', name: 'GND', label: 'GND', direction: 'input' },
        ] },
        { id: 'cdec', name: 'C_DEC', kind: 'capacitor', properties: { value: '100 nF' }, terminals: [
          { id: 'cdec-a', name: 'A', label: 'VCC_3V3', direction: 'input' },
          { id: 'cdec-b', name: 'B', label: 'GND', direction: 'output' },
        ] },
      ],
      view: {
        canvas: { units: 'px', grid: { enabled: true, size: 16 } },
        devices: {
          u_mcu: { position: { x: 64, y: 128 }, shape: 'rectangle' },
          u485: { position: { x: 364, y: 128 }, shape: 'rectangle' },
          rt: { position: { x: 664, y: -40 }, shape: 'rectangle' },
          tvs: { position: { x: 664, y: 184 }, shape: 'rectangle' },
          j1: { position: { x: 964, y: 128 }, shape: 'rectangle' },
          cdec: { position: { x: 364, y: 352 }, shape: 'rectangle' },
        },
        networkLines: {
          mcu_tx: { label: 'MCU_TX', position: { x: 260, y: 80 }, length: 220 },
          mcu_rx: { label: 'MCU_RX', position: { x: 260, y: 100 }, length: 220 },
          rs485_de: { label: 'RS485_DE', position: { x: 260, y: 480 }, length: 220 },
          rs485_a: { label: 'RS485_A', position: { x: 740, y: 80 }, length: 380 },
          rs485_b: { label: 'RS485_B', position: { x: 740, y: 100 }, length: 380 },
          vcc_3v3: { label: 'VCC_3V3', position: { x: 304, y: 80 }, length: 360 },
          gnd: { label: 'GND', position: { x: 520, y: 520 }, length: 640 },
        },
      },
    },
  },
]

export function selectAgentReferenceExamples(prompt: string, currentDocument: DocumentFile | null, limit = 2): AgentReferenceExample[] {
  const text = `${prompt} ${currentDocument?.document?.title ?? ''} ${(currentDocument?.document?.tags ?? []).join(' ')}`.toLowerCase()
  const scored = AGENT_REFERENCE_EXAMPLES.map((example, index) => ({
    example,
    index,
    score:
      example.tags.reduce((total, tag) => total + (text.includes(tag.toLowerCase()) ? 2 : 0), 0) +
      (example.id.includes('mcu') && /interface|rs485|can|uart|mcu|stm32|digital/.test(text) ? 3 : 0) +
      (example.id.includes('sallen-key') && /filter|low[- ]?pass|sallen|opamp|active|high[- ]?q|低通|滤波|高q|q值/i.test(text) ? 5 : 0),
  }))
  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, limit)
    .map((item) => item.example)
}

export function formatAgentReferenceExamplesForPrompt(examples: readonly AgentReferenceExample[]): string {
  const compact = examples.map((example) => ({
    id: example.id,
    title: example.title,
    rationale: example.rationale,
    document: example.document,
  }))
  return [
    'Reference EasyAnalyse semantic v4 examples. Follow their structure: devices with terminal labels define connectivity; view is only readable layout. Do not copy blindly if the user asks for a different circuit.',
    JSON.stringify(compact),
  ].join('\n')
}
