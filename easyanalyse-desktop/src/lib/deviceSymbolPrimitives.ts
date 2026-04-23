import type { DeviceVisualKind } from './deviceSymbols'

export type SymbolPaintRole = 'stroke' | 'accent'

export type DeviceSymbolPrimitive =
  | {
      type: 'line'
      points: number[]
      stroke: SymbolPaintRole
      strokeWidth: number
      closed?: boolean
      fill?: SymbolPaintRole | string
      dash?: number[]
      tension?: number
    }
  | {
      type: 'rect'
      x: number
      y: number
      width: number
      height: number
      radius?: number
      stroke?: SymbolPaintRole
      strokeWidth?: number
      fill?: SymbolPaintRole | string
    }
  | {
      type: 'circle'
      x: number
      y: number
      radius: number
      stroke?: SymbolPaintRole
      strokeWidth?: number
      fill?: SymbolPaintRole | string
    }
  | {
      type: 'text'
      x: number
      y: number
      text: string
      fill: SymbolPaintRole
      fontSize: number
      bold?: boolean
    }

const translucentFill = '#1FFFFFFF'
const softFill = '#29FFFFFF'
const brightFill = '#5CFFFFFF'

function leadLine(left: number, right: number, y: number) {
  return [left, y, right, y]
}

function line(
  points: number[],
  strokeWidth: number,
  options?: Partial<Extract<DeviceSymbolPrimitive, { type: 'line' }>>,
): DeviceSymbolPrimitive {
  return {
    type: 'line',
    points,
    stroke: options?.stroke ?? 'stroke',
    strokeWidth,
    closed: options?.closed,
    fill: options?.fill,
    dash: options?.dash,
    tension: options?.tension,
  }
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  strokeWidth: number,
  fill?: string,
): DeviceSymbolPrimitive {
  return {
    type: 'rect',
    x,
    y,
    width,
    height,
    radius,
    stroke: 'stroke',
    strokeWidth,
    fill,
  }
}

function circle(
  x: number,
  y: number,
  radius: number,
  fill: SymbolPaintRole | string,
  strokeWidth?: number,
): DeviceSymbolPrimitive {
  return {
    type: 'circle',
    x,
    y,
    radius,
    fill,
    stroke: strokeWidth ? 'stroke' : undefined,
    strokeWidth,
  }
}

function text(x: number, y: number, value: string, fontSize: number): DeviceSymbolPrimitive {
  return {
    type: 'text',
    x,
    y,
    text: value,
    fill: 'accent',
    fontSize,
    bold: true,
  }
}

function coilPoints(startX: number, endX: number, centerY: number, amplitude: number) {
  const segmentCount = 40
  const points: number[] = []
  for (let index = 0; index <= segmentCount; index += 1) {
    const t = index / segmentCount
    const x = startX + (endX - startX) * t
    const y = centerY - Math.sin(t * Math.PI * 4) * amplitude
    points.push(x, y)
  }
  return points
}

function bentCathodePoints(x: number, centerY: number, direction: 'up' | 'down') {
  const offset = direction === 'up' ? -1 : 1
  return [x - 7, centerY + 16 * offset, x + 1, centerY + 9 * offset, x + 7, centerY + 16 * offset]
}

function returnArcPoints(startX: number, endX: number, centerY: number) {
  const controlY = centerY - 26
  return [startX, centerY - 4, (startX + endX) / 2, controlY, endX, centerY - 4]
}

function arrowHead(x: number, y: number, angleDeg: number, size: number) {
  const radians = (angleDeg * Math.PI) / 180
  const left = radians + Math.PI * 0.82
  const right = radians - Math.PI * 0.82
  return [
    x,
    y,
    x + Math.cos(left) * size,
    y + Math.sin(left) * size,
    x,
    y,
    x + Math.cos(right) * size,
    y + Math.sin(right) * size,
  ]
}

function diodePrimitives(
  width: number,
  centerY: number,
  kind: 'diode' | 'flyback-diode' | 'rectifier-diode' | 'zener-diode' | 'tvs-diode' | 'led',
) {
  const primitives: DeviceSymbolPrimitive[] = []
  const leftLeadEnd = 64
  const triangleLeft = 74
  const triangleRight = width - 82
  const barX = width - 72

  primitives.push(line(leadLine(18, leftLeadEnd, centerY), 2.8))
  primitives.push(line([triangleLeft, centerY - 18, triangleLeft, centerY + 18, triangleRight, centerY], 2.8, { closed: true }))
  primitives.push(line(leadLine(barX, width - 18, centerY), 2.8))

  if (kind === 'rectifier-diode') {
    primitives.push(line([barX - 3, centerY - 22, barX - 3, centerY + 22], 2.6))
    primitives.push(line([barX + 5, centerY - 22, barX + 5, centerY + 22], 2.2))
  } else if (kind === 'zener-diode') {
    primitives.push(line([barX, centerY - 20, barX, centerY + 20], 2.2))
    primitives.push(line(bentCathodePoints(barX, centerY, 'up'), 2.2))
    primitives.push(line(bentCathodePoints(barX, centerY, 'down'), 2.2))
  } else if (kind === 'tvs-diode') {
    primitives.push(line([barX, centerY - 20, barX, centerY + 20], 2.2))
    primitives.push(line(bentCathodePoints(barX, centerY, 'up'), 2.4, { stroke: 'accent' }))
    primitives.push(line(bentCathodePoints(barX, centerY, 'down'), 2.4, { stroke: 'accent' }))
    primitives.push(line([barX + 12, centerY - 14, barX + 18, centerY - 6], 2.2, { stroke: 'accent' }))
    primitives.push(line([barX + 12, centerY + 14, barX + 18, centerY + 6], 2.2, { stroke: 'accent' }))
  } else {
    primitives.push(line([barX, centerY - 20, barX, centerY + 20], 2.2))
  }

  if (kind === 'flyback-diode') {
    primitives.push(line(returnArcPoints(triangleLeft + 4, barX - 8, centerY), 2.2, { stroke: 'accent', tension: 0.5 }))
    primitives.push(line(arrowHead(triangleLeft + 10, centerY - 8, 210, 7), 2, { stroke: 'accent' }))
  }

  if (kind === 'led') {
    primitives.push(line([barX - 10, centerY - 18, barX + 8, centerY - 34], 2.2, { stroke: 'accent' }))
    primitives.push(line(arrowHead(barX + 8, centerY - 34, -32, 7), 2, { stroke: 'accent' }))
    primitives.push(line([barX - 2, centerY - 6, barX + 16, centerY - 22], 2.2, { stroke: 'accent' }))
    primitives.push(line(arrowHead(barX + 16, centerY - 22, -32, 7), 2, { stroke: 'accent' }))
  }

  return primitives
}

export function getDeviceSymbolAccent(visualKind: string) {
  if (visualKind === 'led') {
    return '#EA580C'
  }
  if (
    visualKind === 'diode' ||
    visualKind === 'flyback-diode' ||
    visualKind === 'rectifier-diode' ||
    visualKind === 'zener-diode' ||
    visualKind === 'tvs-diode'
  ) {
    return '#475569'
  }
  if (
    visualKind === 'npn-transistor' ||
    visualKind === 'pnp-transistor' ||
    visualKind === 'nmos' ||
    visualKind === 'pmos'
  ) {
    return '#0F766E'
  }
  if (visualKind === 'crystal') {
    return '#4F46E5'
  }
  if (visualKind === 'op-amp') {
    return '#2563EB'
  }
  return '#64748B'
}

export function buildDeviceSymbolPrimitives(
  visualKind: DeviceVisualKind,
  width: number,
  height: number,
) {
  const centerY = height * 0.42
  const symbolStroke = Math.max(2.2, Math.min(width, height) * 0.016)

  switch (visualKind) {
    case 'resistor': {
      const bodyWidth = Math.max(64, Math.min(86, width * 0.34))
      const bodyHeight = Math.max(24, Math.min(32, height * 0.3))
      const bodyX = (width - bodyWidth) / 2
      const bodyY = centerY - bodyHeight / 2
      return [
        line(leadLine(18, bodyX, centerY), symbolStroke),
        rect(bodyX, bodyY, bodyWidth, bodyHeight, 4, symbolStroke, translucentFill),
        line(leadLine(bodyX + bodyWidth, width - 18, centerY), symbolStroke),
      ] satisfies DeviceSymbolPrimitive[]
    }
    case 'capacitor': {
      const leftPlate = width / 2 - 16
      const rightPlate = width / 2 + 16
      return [
        line(leadLine(18, leftPlate, centerY), symbolStroke),
        line(leadLine(rightPlate, width - 18, centerY), symbolStroke),
        line([leftPlate, centerY - 22, leftPlate, centerY + 22], symbolStroke),
        line([rightPlate, centerY - 22, rightPlate, centerY + 22], symbolStroke),
      ] satisfies DeviceSymbolPrimitive[]
    }
    case 'electrolytic-capacitor': {
      const leftPlate = width / 2 - 18
      const rightPlate = width / 2 + 18
      return [
        line(leadLine(18, leftPlate, centerY), symbolStroke),
        line(leadLine(rightPlate + 6, width - 18, centerY), symbolStroke),
        line([leftPlate, centerY - 24, leftPlate, centerY + 24], symbolStroke),
        line([rightPlate + 8, centerY - 24, rightPlate - 2, centerY - 8, rightPlate - 2, centerY + 8, rightPlate + 8, centerY + 24], symbolStroke, { tension: 0.45 }),
        line([leftPlate - 12, centerY - 10, leftPlate - 12, centerY + 10], 2.2, { stroke: 'accent' }),
        line([leftPlate - 20, centerY, leftPlate - 4, centerY], 2.2, { stroke: 'accent' }),
      ] satisfies DeviceSymbolPrimitive[]
    }
    case 'inductor': {
      const leftLeadEnd = 48
      const rightLeadStart = width - 48
      return [
        line(leadLine(18, leftLeadEnd, centerY), symbolStroke),
        line(coilPoints(leftLeadEnd, rightLeadStart, centerY, 14), symbolStroke),
        line(leadLine(rightLeadStart, width - 18, centerY), symbolStroke),
      ] satisfies DeviceSymbolPrimitive[]
    }
    case 'ferrite-bead': {
      const bodyWidth = Math.max(46, Math.min(58, width * 0.27))
      const bodyHeight = Math.max(24, Math.min(30, height * 0.28))
      const bodyX = (width - bodyWidth) / 2
      const bodyY = centerY - bodyHeight / 2
      const bandInset = Math.max(10, bodyWidth * 0.24)
      return [
        line(leadLine(18, width - 18, centerY), symbolStroke),
        rect(bodyX, bodyY, bodyWidth, bodyHeight, bodyHeight / 2, symbolStroke, '#24FFFFFF'),
        line([bodyX + bandInset, bodyY + 4, bodyX + bandInset, bodyY + bodyHeight - 4], 2.2, { stroke: 'accent' }),
        line([bodyX + bodyWidth - bandInset, bodyY + 4, bodyX + bodyWidth - bandInset, bodyY + bodyHeight - 4], 2.2, { stroke: 'accent' }),
      ] satisfies DeviceSymbolPrimitive[]
    }
    case 'diode':
    case 'flyback-diode':
    case 'rectifier-diode':
    case 'zener-diode':
    case 'tvs-diode':
    case 'led':
      return diodePrimitives(width, centerY, visualKind)
    case 'switch': {
      const leftContact = { x: 64, y: centerY + 10 }
      const rightContact = { x: width - 64, y: centerY - 10 }
      return [
        line(leadLine(18, leftContact.x - 8, leftContact.y), symbolStroke),
        line([rightContact.x + 8, rightContact.y, width - 18, rightContact.y], symbolStroke),
        circle(leftContact.x, leftContact.y, 5, 'stroke'),
        circle(rightContact.x, rightContact.y, 5, 'stroke'),
        line([leftContact.x + 2, leftContact.y - 4, rightContact.x - 20, rightContact.y - 18], symbolStroke),
      ] satisfies DeviceSymbolPrimitive[]
    }
    case 'push-button': {
      const contactY = centerY + 12
      const leftContact = { x: 66, y: contactY }
      const rightContact = { x: width - 66, y: contactY }
      const armY = contactY - 18
      const armLeftX = leftContact.x + 10
      const armRightX = rightContact.x - 22
      const plungerX = width / 2
      const plungerTopY = armY - 24
      return [
        line(leadLine(18, leftContact.x - 8, leftContact.y), symbolStroke),
        line([rightContact.x + 8, rightContact.y, width - 18, rightContact.y], symbolStroke),
        circle(leftContact.x, leftContact.y, 5, 'stroke'),
        circle(rightContact.x, rightContact.y, 5, 'stroke'),
        line([leftContact.x + 2, leftContact.y - 4, armLeftX, armY, armRightX, armY], symbolStroke),
        line([armRightX, armY, rightContact.x - 8, rightContact.y - 8], symbolStroke),
        line([plungerX, plungerTopY, plungerX, armY - 4], 2.4, { stroke: 'accent' }),
        line([plungerX - 14, plungerTopY, plungerX + 14, plungerTopY], 2.4, { stroke: 'accent' }),
      ] satisfies DeviceSymbolPrimitive[]
    }
    case 'crystal': {
      const plateLeft = width / 2 - 28
      const plateRight = width / 2 + 28
      return [
        line(leadLine(18, plateLeft, centerY), symbolStroke),
        line(leadLine(plateRight, width - 18, centerY), symbolStroke),
        line([plateLeft, centerY - 22, plateLeft, centerY + 22], symbolStroke),
        line([plateRight, centerY - 22, plateRight, centerY + 22], symbolStroke),
        rect(width / 2 - 10, centerY - 18, 20, 36, 5, 2.2, brightFill),
      ] satisfies DeviceSymbolPrimitive[]
    }
    case 'op-amp': {
      const midX = width * 0.5
      const triangleLeft = width * 0.26
      const triangleRight = width * 0.8
      const triangleTop = 28
      const triangleBottom = height - 54
      const triangleCenterY = (triangleTop + triangleBottom) / 2
      const inputTopY = triangleCenterY - 24
      const inputBottomY = triangleCenterY + 24
      return [
        line([triangleLeft, triangleTop, triangleRight, triangleCenterY, triangleLeft, triangleBottom], symbolStroke, { closed: true, fill: softFill }),
        line([18, inputTopY, triangleLeft, inputTopY], symbolStroke),
        line([18, inputBottomY, triangleLeft, inputBottomY], symbolStroke),
        line([triangleRight, triangleCenterY, width - 18, triangleCenterY], symbolStroke),
        text(triangleLeft - 22, inputTopY - 10, '-', 18),
        text(triangleLeft - 24, inputBottomY - 10, '+', 18),
        line([midX, 14, midX, triangleTop], 2.2, { stroke: 'accent' }),
        line([midX, triangleBottom, midX, triangleBottom + 14], 2.2, { stroke: 'accent' }),
      ] satisfies DeviceSymbolPrimitive[]
    }
    case 'npn-transistor':
    case 'pnp-transistor': {
      const circleX = width * 0.56
      const circleY = centerY + 6
      const radius = Math.max(28, Math.min(32, Math.min(width, height) * 0.2))
      const baseX = circleX - radius * 0.78
      const junction = { x: circleX + radius * 0.12, y: circleY }
      const terminalX = circleX + radius * 0.9
      const collectorY = circleY - radius * 0.82
      const emitterY = circleY + radius * 0.82
      const arrowPoint =
        visualKind === 'npn-transistor'
          ? { x: junction.x + (terminalX - junction.x) * 0.68, y: junction.y + (emitterY - junction.y) * 0.68 }
          : { x: junction.x + (terminalX - junction.x) * 0.5, y: junction.y + (emitterY - junction.y) * 0.5 }
      const arrowAngle = visualKind === 'npn-transistor' ? 44 : 224
      return [
        line([18, circleY, baseX, circleY], symbolStroke),
        line([baseX, circleY - radius * 0.6, baseX, circleY + radius * 0.6], symbolStroke),
        line([baseX, circleY, junction.x, junction.y], symbolStroke),
        line([junction.x, junction.y, terminalX, collectorY], symbolStroke),
        line([junction.x, junction.y, terminalX, emitterY], symbolStroke),
        line([terminalX, 18, terminalX, collectorY], symbolStroke),
        line([terminalX, emitterY, terminalX, height - 46], symbolStroke),
        { type: 'circle', x: circleX, y: circleY, radius, stroke: 'stroke', strokeWidth: 2.2 } satisfies DeviceSymbolPrimitive,
        line(arrowHead(arrowPoint.x, arrowPoint.y, arrowAngle, 8.5), 2.2, { stroke: 'accent' }),
      ] satisfies DeviceSymbolPrimitive[]
    }
    case 'nmos':
    case 'pmos': {
      const gateX = width * 0.38
      const bubbleRadius = 7
      const channelX = width * 0.56
      const diffusionX = width * 0.66
      const topTapY = centerY - 24
      const bottomTapY = centerY + 24
      const gateLeadEnd = visualKind === 'pmos' ? gateX - bubbleRadius * 2 - 4 : gateX - 10
      const primitives: DeviceSymbolPrimitive[] = [
        line([18, centerY, gateLeadEnd, centerY], symbolStroke),
        line([gateX, topTapY + 6, gateX, bottomTapY - 6], symbolStroke),
        line([diffusionX, 18, diffusionX, topTapY], symbolStroke),
        line([diffusionX, bottomTapY, diffusionX, height - 46], symbolStroke),
        line([channelX, topTapY, diffusionX, topTapY], symbolStroke),
        line([channelX, bottomTapY, diffusionX, bottomTapY], symbolStroke),
        line([channelX, topTapY + 4, channelX, centerY - 14], symbolStroke),
        line([channelX, centerY - 6, channelX, centerY + 6], symbolStroke),
        line([channelX, centerY + 14, channelX, bottomTapY - 4], symbolStroke),
        line([gateX + 10, centerY, channelX - 12, centerY], 2, { stroke: 'accent', dash: [8, 6] }),
      ]
      if (visualKind === 'pmos') {
        primitives.splice(2, 0, { type: 'circle', x: gateX - 10, y: centerY, radius: bubbleRadius, stroke: 'accent', strokeWidth: 2.2 })
      }
      return primitives
    }
    default:
      return []
  }
}
