import type { DeviceDefinition, DeviceShape, Size } from '../types/document'

export type DeviceVisualKind =
  | 'module'
  | 'sensor'
  | 'connector'
  | 'resistor'
  | 'capacitor'
  | 'electrolytic-capacitor'
  | 'inductor'
  | 'ferrite-bead'
  | 'led'
  | 'diode'
  | 'flyback-diode'
  | 'rectifier-diode'
  | 'zener-diode'
  | 'tvs-diode'
  | 'nmos'
  | 'pmos'
  | 'npn-transistor'
  | 'pnp-transistor'
  | 'switch'
  | 'push-button'
  | 'crystal'
  | 'op-amp'

export interface DeviceVisualPreset {
  key: DeviceVisualKind
  baseShape: DeviceShape
  defaultSize: Size
  referencePrefix: string
  dedicatedSymbol: boolean
}

export interface DeviceTemplateDefinition {
  key: DeviceVisualKind
  kind: string
  label: string
  defaultName: string
  category?: string
}

type DeviceDescriptor =
  | string
  | Pick<DeviceDefinition, 'kind' | 'name' | 'category' | 'tags'>

const PRESETS: Record<DeviceVisualKind, DeviceVisualPreset> = {
  module: {
    key: 'module',
    baseShape: 'rectangle',
    defaultSize: { width: 220, height: 136 },
    referencePrefix: 'U',
    dedicatedSymbol: false,
  },
  sensor: {
    key: 'sensor',
    baseShape: 'triangle',
    defaultSize: { width: 228, height: 152 },
    referencePrefix: 'U',
    dedicatedSymbol: false,
  },
  connector: {
    key: 'connector',
    baseShape: 'circle',
    defaultSize: { width: 156, height: 156 },
    referencePrefix: 'J',
    dedicatedSymbol: false,
  },
  resistor: {
    key: 'resistor',
    baseShape: 'rectangle',
    defaultSize: { width: 188, height: 88 },
    referencePrefix: 'R',
    dedicatedSymbol: true,
  },
  capacitor: {
    key: 'capacitor',
    baseShape: 'rectangle',
    defaultSize: { width: 188, height: 102 },
    referencePrefix: 'C',
    dedicatedSymbol: true,
  },
  'electrolytic-capacitor': {
    key: 'electrolytic-capacitor',
    baseShape: 'rectangle',
    defaultSize: { width: 204, height: 112 },
    referencePrefix: 'C',
    dedicatedSymbol: true,
  },
  inductor: {
    key: 'inductor',
    baseShape: 'rectangle',
    defaultSize: { width: 220, height: 104 },
    referencePrefix: 'L',
    dedicatedSymbol: true,
  },
  'ferrite-bead': {
    key: 'ferrite-bead',
    baseShape: 'rectangle',
    defaultSize: { width: 176, height: 88 },
    referencePrefix: 'FB',
    dedicatedSymbol: true,
  },
  led: {
    key: 'led',
    baseShape: 'rectangle',
    defaultSize: { width: 212, height: 112 },
    referencePrefix: 'D',
    dedicatedSymbol: true,
  },
  diode: {
    key: 'diode',
    baseShape: 'rectangle',
    defaultSize: { width: 208, height: 104 },
    referencePrefix: 'D',
    dedicatedSymbol: true,
  },
  'flyback-diode': {
    key: 'flyback-diode',
    baseShape: 'rectangle',
    defaultSize: { width: 212, height: 108 },
    referencePrefix: 'D',
    dedicatedSymbol: true,
  },
  'rectifier-diode': {
    key: 'rectifier-diode',
    baseShape: 'rectangle',
    defaultSize: { width: 212, height: 108 },
    referencePrefix: 'D',
    dedicatedSymbol: true,
  },
  'zener-diode': {
    key: 'zener-diode',
    baseShape: 'rectangle',
    defaultSize: { width: 212, height: 108 },
    referencePrefix: 'D',
    dedicatedSymbol: true,
  },
  'tvs-diode': {
    key: 'tvs-diode',
    baseShape: 'rectangle',
    defaultSize: { width: 216, height: 112 },
    referencePrefix: 'D',
    dedicatedSymbol: true,
  },
  nmos: {
    key: 'nmos',
    baseShape: 'rectangle',
    defaultSize: { width: 212, height: 148 },
    referencePrefix: 'Q',
    dedicatedSymbol: true,
  },
  pmos: {
    key: 'pmos',
    baseShape: 'rectangle',
    defaultSize: { width: 212, height: 148 },
    referencePrefix: 'Q',
    dedicatedSymbol: true,
  },
  'npn-transistor': {
    key: 'npn-transistor',
    baseShape: 'rectangle',
    defaultSize: { width: 208, height: 148 },
    referencePrefix: 'Q',
    dedicatedSymbol: true,
  },
  'pnp-transistor': {
    key: 'pnp-transistor',
    baseShape: 'rectangle',
    defaultSize: { width: 208, height: 148 },
    referencePrefix: 'Q',
    dedicatedSymbol: true,
  },
  switch: {
    key: 'switch',
    baseShape: 'rectangle',
    defaultSize: { width: 200, height: 104 },
    referencePrefix: 'SW',
    dedicatedSymbol: true,
  },
  'push-button': {
    key: 'push-button',
    baseShape: 'rectangle',
    defaultSize: { width: 208, height: 118 },
    referencePrefix: 'SW',
    dedicatedSymbol: true,
  },
  crystal: {
    key: 'crystal',
    baseShape: 'rectangle',
    defaultSize: { width: 212, height: 110 },
    referencePrefix: 'Y',
    dedicatedSymbol: true,
  },
  'op-amp': {
    key: 'op-amp',
    baseShape: 'triangle',
    defaultSize: { width: 244, height: 168 },
    referencePrefix: 'U',
    dedicatedSymbol: true,
  },
}

const TEMPLATE_DEFINITIONS: Record<DeviceVisualKind, DeviceTemplateDefinition> = {
  module: {
    key: 'module',
    kind: 'module',
    label: 'Module',
    defaultName: 'Module',
  },
  sensor: {
    key: 'sensor',
    kind: 'sensor',
    label: 'Sensor',
    defaultName: 'Sensor',
    category: 'input',
  },
  connector: {
    key: 'connector',
    kind: 'connector',
    label: 'Connector',
    defaultName: 'Connector',
  },
  resistor: {
    key: 'resistor',
    kind: 'resistor',
    label: 'Resistor',
    defaultName: 'Resistor',
    category: 'passive',
  },
  capacitor: {
    key: 'capacitor',
    kind: 'capacitor',
    label: 'Capacitor',
    defaultName: 'Capacitor',
    category: 'passive',
  },
  'electrolytic-capacitor': {
    key: 'electrolytic-capacitor',
    kind: 'electrolytic-capacitor',
    label: 'Electrolytic Capacitor',
    defaultName: 'Electrolytic Capacitor',
    category: 'passive',
  },
  inductor: {
    key: 'inductor',
    kind: 'inductor',
    label: 'Inductor',
    defaultName: 'Inductor',
    category: 'passive',
  },
  'ferrite-bead': {
    key: 'ferrite-bead',
    kind: 'ferrite-bead',
    label: 'Ferrite Bead',
    defaultName: 'Ferrite Bead',
    category: 'passive',
  },
  led: {
    key: 'led',
    kind: 'led',
    label: 'LED',
    defaultName: 'LED',
    category: 'indicator',
  },
  diode: {
    key: 'diode',
    kind: 'diode',
    label: 'Diode',
    defaultName: 'Diode',
    category: 'discrete',
  },
  'flyback-diode': {
    key: 'flyback-diode',
    kind: 'flyback-diode',
    label: 'Flyback Diode',
    defaultName: 'Flyback Diode',
    category: 'protection',
  },
  'rectifier-diode': {
    key: 'rectifier-diode',
    kind: 'rectifier-diode',
    label: 'Rectifier Diode',
    defaultName: 'Rectifier Diode',
    category: 'power',
  },
  'zener-diode': {
    key: 'zener-diode',
    kind: 'zener-diode',
    label: 'Zener Diode',
    defaultName: 'Zener Diode',
    category: 'protection',
  },
  'tvs-diode': {
    key: 'tvs-diode',
    kind: 'tvs-diode',
    label: 'TVS Diode',
    defaultName: 'TVS Diode',
    category: 'protection',
  },
  nmos: {
    key: 'nmos',
    kind: 'nmos',
    label: 'NMOS',
    defaultName: 'NMOS',
    category: 'switching',
  },
  pmos: {
    key: 'pmos',
    kind: 'pmos',
    label: 'PMOS',
    defaultName: 'PMOS',
    category: 'switching',
  },
  'npn-transistor': {
    key: 'npn-transistor',
    kind: 'npn-transistor',
    label: 'NPN Transistor',
    defaultName: 'NPN Transistor',
    category: 'discrete',
  },
  'pnp-transistor': {
    key: 'pnp-transistor',
    kind: 'pnp-transistor',
    label: 'PNP Transistor',
    defaultName: 'PNP Transistor',
    category: 'discrete',
  },
  switch: {
    key: 'switch',
    kind: 'switch',
    label: 'Switch',
    defaultName: 'Switch',
    category: 'control',
  },
  'push-button': {
    key: 'push-button',
    kind: 'push-button',
    label: 'Push Button',
    defaultName: 'Push Button',
    category: 'control',
  },
  crystal: {
    key: 'crystal',
    kind: 'crystal',
    label: 'Crystal',
    defaultName: 'Crystal',
    category: 'timing',
  },
  'op-amp': {
    key: 'op-amp',
    kind: 'op-amp',
    label: 'Op-Amp',
    defaultName: 'Op-Amp',
    category: 'analog',
  },
}

const TEMPLATE_PICKER_ORDER: DeviceVisualKind[] = [
  'module',
  'resistor',
  'capacitor',
  'electrolytic-capacitor',
  'inductor',
  'ferrite-bead',
  'led',
  'diode',
  'flyback-diode',
  'rectifier-diode',
  'zener-diode',
  'tvs-diode',
  'switch',
  'push-button',
  'nmos',
  'pmos',
  'npn-transistor',
  'pnp-transistor',
  'crystal',
  'op-amp',
]

function toHaystack(device: DeviceDescriptor) {
  if (typeof device === 'string') {
    return normalize(device)
  }

  return normalize(
    [
      device.kind,
      device.name,
      device.category ?? '',
      ...(device.tags ?? []),
    ].join(' '),
  )
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[_/-]+/g, ' ')
    .replace(/[^\p{L}\p{N}+\-\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function includesAny(haystack: string, values: string[]) {
  return values.some((value) => haystack.includes(value))
}

export function getDeviceVisualPreset(device: DeviceDescriptor): DeviceVisualPreset {
  const haystack = ` ${toHaystack(device)} `

  if (includesAny(haystack, [' led ', 'light emitting diode', 'indicator led', 'indicator lamp', '发光二极管', '指示灯'])) {
    return PRESETS.led
  }

  if (includesAny(haystack, [' flyback', ' freewheel', ' freewheeling', ' snubber diode', '续流二极管', '续流管', '回扫二极管', '自由轮二极管'])) {
    return PRESETS['flyback-diode']
  }

  if (includesAny(haystack, [' rectifier', ' bridge rectifier', '整流二极管', '整流管', '桥式整流'])) {
    return PRESETS['rectifier-diode']
  }

  if (includesAny(haystack, [' tvs', ' transient voltage suppressor', '瞬态抑制二极管', '瞬态电压抑制二极管', '瞬态电压抑制'])) {
    return PRESETS['tvs-diode']
  }

  if (includesAny(haystack, [' zener', ' zener diode', '稳压二极管'])) {
    return PRESETS['zener-diode']
  }

  if (includesAny(haystack, [' diode ', 'schottky', '二极管', '肖特基'])) {
    return PRESETS.diode
  }

  if (
    includesAny(haystack, [
      ' electrolytic capacitor',
      ' polarized capacitor',
      'electrolytic',
      'aluminum cap',
      'tantalum cap',
      '电解电容',
      '极性电容',
      '钽电容',
    ])
  ) {
    return PRESETS['electrolytic-capacitor']
  }

  if (includesAny(haystack, [' ferrite bead', ' ferrite ', ' bead ', '磁珠', '铁氧体磁珠'])) {
    return PRESETS['ferrite-bead']
  }

  if (includesAny(haystack, [' inductor', ' choke', ' coil ', '电感', '扼流圈', '线圈'])) {
    return PRESETS.inductor
  }

  if (includesAny(haystack, [' resistor', ' shunt ', ' pull-up', ' pull down', '电阻', '分流电阻', '采样电阻', '上拉电阻', '下拉电阻'])) {
    return PRESETS.resistor
  }

  if (includesAny(haystack, [' capacitor', ' ceramic cap', ' film cap', '电容', '陶瓷电容', '薄膜电容'])) {
    return PRESETS.capacitor
  }

  if (
    includesAny(haystack, [
      ' push button',
      ' pushbutton',
      ' momentary button',
      ' tact switch',
      ' button ',
      '按键',
      '按钮',
      '轻触开关',
      '自复位开关',
    ])
  ) {
    return PRESETS['push-button']
  }

  if (includesAny(haystack, [' switch ', ' jumper', ' selector', '开关', '拨动开关', '选择开关', '跳线'])) {
    return PRESETS.switch
  }

  if (
    includesAny(haystack, [
      ' operational amplifier',
      'op amp',
      'op-amp',
      'opamp',
      ' comparator',
      '运放',
      '运算放大器',
      '比较器',
    ])
  ) {
    return PRESETS['op-amp']
  }

  if (includesAny(haystack, [' crystal', ' resonator', ' oscillator', ' clock source', '晶振', '谐振器', '振荡器'])) {
    return PRESETS.crystal
  }

  if (
    includesAny(haystack, [
      ' n-channel mosfet',
      ' n channel mosfet',
      ' nmos',
      ' mosfet n',
      'nmos管',
      'n沟道mos',
      'n沟道mosfet',
      'n沟道mos管',
    ])
  ) {
    return PRESETS.nmos
  }

  if (
    includesAny(haystack, [
      ' p-channel mosfet',
      ' p channel mosfet',
      ' pmos',
      ' mosfet p',
      'pmos管',
      'p沟道mos',
      'p沟道mosfet',
      'p沟道mos管',
    ])
  ) {
    return PRESETS.pmos
  }

  if (includesAny(haystack, [' mosfet ', ' mos 管 ', ' mos管 ', '场效应管'])) {
    return PRESETS.nmos
  }

  if (includesAny(haystack, [' npn transistor', ' npn ', 'bjt npn', 'npn三极管', 'npn晶体管'])) {
    return PRESETS['npn-transistor']
  }

  if (includesAny(haystack, [' pnp transistor', ' pnp ', 'bjt pnp', 'pnp三极管', 'pnp晶体管'])) {
    return PRESETS['pnp-transistor']
  }

  if (includesAny(haystack, [' transistor ', ' bjt ', '三极管', '晶体管'])) {
    return PRESETS['npn-transistor']
  }

  if (includesAny(haystack, [' connector', ' header', ' socket', ' jack', ' plug'])) {
    return PRESETS.connector
  }

  if (includesAny(haystack, [' sensor', ' detector', ' probe '])) {
    return PRESETS.sensor
  }

  return PRESETS.module
}

export function getDefaultShapeForKind(device: DeviceDescriptor): DeviceShape {
  return getDeviceVisualPreset(device).baseShape
}

export function getDefaultSizeForKind(device: DeviceDescriptor): Size {
  return getDeviceVisualPreset(device).defaultSize
}

export function getReferencePrefixForKind(device: DeviceDescriptor) {
  return getDeviceVisualPreset(device).referencePrefix
}

export function hasDedicatedDeviceSymbol(device: DeviceDescriptor) {
  return getDeviceVisualPreset(device).dedicatedSymbol
}

export function getDeviceTemplateDefinition(key: DeviceVisualKind) {
  return TEMPLATE_DEFINITIONS[key]
}

export function getDeviceTemplateOptions() {
  return TEMPLATE_PICKER_ORDER.map((key) => TEMPLATE_DEFINITIONS[key])
}
