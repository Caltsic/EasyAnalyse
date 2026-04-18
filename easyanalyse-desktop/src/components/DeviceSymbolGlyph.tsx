import { Circle, Group, Line, Rect, Text } from 'react-konva'
import type { DeviceVisualKind } from '../lib/deviceSymbols'

interface DeviceSymbolGlyphProps {
  visualKind: DeviceVisualKind
  width: number
  height: number
  stroke: string
  accent: string
}

function buildLeadLine(left: number, right: number, y: number) {
  return [left, y, right, y]
}

function buildCoilPoints(startX: number, endX: number, centerY: number, amplitude: number) {
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

function buildBentCathodePoints(x: number, centerY: number, direction: 'up' | 'down') {
  const offset = direction === 'up' ? -1 : 1
  return [x - 7, centerY + 16 * offset, x + 1, centerY + 9 * offset, x + 7, centerY + 16 * offset]
}

function buildReturnArcPoints(startX: number, endX: number, centerY: number) {
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

function DeviceDiodeGlyph({
  width,
  centerY,
  stroke,
  accent,
  kind,
}: {
  width: number
  centerY: number
  stroke: string
  accent: string
  kind: 'diode' | 'flyback-diode' | 'rectifier-diode' | 'zener-diode' | 'tvs-diode' | 'led'
}) {
  const leftLeadEnd = 64
  const triangleLeft = 74
  const triangleRight = width - 82
  const barX = width - 72

  return (
    <>
      <Line points={buildLeadLine(18, leftLeadEnd, centerY)} stroke={stroke} strokeWidth={2.8} lineCap="round" />
      <Line
        points={[triangleLeft, centerY - 18, triangleLeft, centerY + 18, triangleRight, centerY]}
        closed
        stroke={stroke}
        strokeWidth={2.8}
        lineJoin="round"
      />
      <Line points={buildLeadLine(barX, width - 18, centerY)} stroke={stroke} strokeWidth={2.8} lineCap="round" />

      {kind === 'rectifier-diode' ? (
        <>
          <Line points={[barX - 3, centerY - 22, barX - 3, centerY + 22]} stroke={stroke} strokeWidth={2.6} />
          <Line points={[barX + 5, centerY - 22, barX + 5, centerY + 22]} stroke={stroke} strokeWidth={2.2} />
        </>
      ) : kind === 'zener-diode' ? (
        <>
          <Line points={[barX, centerY - 20, barX, centerY + 20]} stroke={stroke} strokeWidth={2.2} />
          <Line points={buildBentCathodePoints(barX, centerY, 'up')} stroke={stroke} strokeWidth={2.2} />
          <Line points={buildBentCathodePoints(barX, centerY, 'down')} stroke={stroke} strokeWidth={2.2} />
        </>
      ) : kind === 'tvs-diode' ? (
        <>
          <Line points={[barX, centerY - 20, barX, centerY + 20]} stroke={stroke} strokeWidth={2.2} />
          <Line points={buildBentCathodePoints(barX, centerY, 'up')} stroke={accent} strokeWidth={2.4} />
          <Line points={buildBentCathodePoints(barX, centerY, 'down')} stroke={accent} strokeWidth={2.4} />
          <Line points={[barX + 12, centerY - 14, barX + 18, centerY - 6]} stroke={accent} strokeWidth={2.2} />
          <Line points={[barX + 12, centerY + 14, barX + 18, centerY + 6]} stroke={accent} strokeWidth={2.2} />
        </>
      ) : (
        <Line points={[barX, centerY - 20, barX, centerY + 20]} stroke={stroke} strokeWidth={2.2} />
      )}

      {kind === 'flyback-diode' && (
        <>
          <Line
            points={buildReturnArcPoints(triangleLeft + 4, barX - 8, centerY)}
            stroke={accent}
            strokeWidth={2.2}
            tension={0.5}
            lineCap="round"
          />
          <Line
            points={arrowHead(triangleLeft + 10, centerY - 8, 210, 7)}
            stroke={accent}
            strokeWidth={2}
            lineCap="round"
          />
        </>
      )}

      {kind === 'led' && (
        <>
          <Line points={[barX - 10, centerY - 18, barX + 8, centerY - 34]} stroke={accent} strokeWidth={2.2} lineCap="round" />
          <Line points={arrowHead(barX + 8, centerY - 34, -32, 7)} stroke={accent} strokeWidth={2} lineCap="round" />
          <Line points={[barX - 2, centerY - 6, barX + 16, centerY - 22]} stroke={accent} strokeWidth={2.2} lineCap="round" />
          <Line points={arrowHead(barX + 16, centerY - 22, -32, 7)} stroke={accent} strokeWidth={2} lineCap="round" />
        </>
      )}
    </>
  )
}

export function DeviceSymbolGlyph({
  visualKind,
  width,
  height,
  stroke,
  accent,
}: DeviceSymbolGlyphProps) {
  const centerY = height * 0.42
  const symbolStroke = Math.max(2.2, Math.min(width, height) * 0.016)

  switch (visualKind) {
    case 'resistor': {
      const bodyWidth = Math.max(64, Math.min(86, width * 0.34))
      const bodyHeight = Math.max(24, Math.min(32, height * 0.3))
      const bodyX = (width - bodyWidth) / 2
      const bodyY = centerY - bodyHeight / 2
      return (
        <Group listening={false}>
          <Line points={buildLeadLine(18, bodyX, centerY)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Rect
            x={bodyX}
            y={bodyY}
            width={bodyWidth}
            height={bodyHeight}
            cornerRadius={4}
            stroke={stroke}
            strokeWidth={symbolStroke}
            fill="rgba(255,255,255,0.12)"
          />
          <Line points={buildLeadLine(bodyX + bodyWidth, width - 18, centerY)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
        </Group>
      )
    }
    case 'capacitor': {
      const leftPlate = width / 2 - 16
      const rightPlate = width / 2 + 16
      return (
        <Group listening={false}>
          <Line points={buildLeadLine(18, leftPlate, centerY)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={buildLeadLine(rightPlate, width - 18, centerY)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={[leftPlate, centerY - 22, leftPlate, centerY + 22]} stroke={stroke} strokeWidth={symbolStroke} />
          <Line points={[rightPlate, centerY - 22, rightPlate, centerY + 22]} stroke={stroke} strokeWidth={symbolStroke} />
        </Group>
      )
    }
    case 'electrolytic-capacitor': {
      const leftPlate = width / 2 - 18
      const rightPlate = width / 2 + 18
      return (
        <Group listening={false}>
          <Line points={buildLeadLine(18, leftPlate, centerY)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={buildLeadLine(rightPlate + 6, width - 18, centerY)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={[leftPlate, centerY - 24, leftPlate, centerY + 24]} stroke={stroke} strokeWidth={symbolStroke} />
          <Line
            points={[
              rightPlate + 8,
              centerY - 24,
              rightPlate - 2,
              centerY - 8,
              rightPlate - 2,
              centerY + 8,
              rightPlate + 8,
              centerY + 24,
            ]}
            stroke={stroke}
            strokeWidth={symbolStroke}
            tension={0.45}
            lineCap="round"
          />
          <Line points={[leftPlate - 12, centerY - 10, leftPlate - 12, centerY + 10]} stroke={accent} strokeWidth={2.2} />
          <Line points={[leftPlate - 20, centerY, leftPlate - 4, centerY]} stroke={accent} strokeWidth={2.2} />
        </Group>
      )
    }
    case 'inductor': {
      const leftLeadEnd = 48
      const rightLeadStart = width - 48
      return (
        <Group listening={false}>
          <Line points={buildLeadLine(18, leftLeadEnd, centerY)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line
            points={buildCoilPoints(leftLeadEnd, rightLeadStart, centerY, 14)}
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineCap="round"
            lineJoin="round"
          />
          <Line points={buildLeadLine(rightLeadStart, width - 18, centerY)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
        </Group>
      )
    }
    case 'ferrite-bead': {
      const bodyWidth = Math.max(46, Math.min(58, width * 0.27))
      const bodyHeight = Math.max(24, Math.min(30, height * 0.28))
      const bodyX = (width - bodyWidth) / 2
      const bodyY = centerY - bodyHeight / 2
      const bandInset = Math.max(10, bodyWidth * 0.24)
      return (
        <Group listening={false}>
          <Line points={buildLeadLine(18, width - 18, centerY)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Rect
            x={bodyX}
            y={bodyY}
            width={bodyWidth}
            height={bodyHeight}
            cornerRadius={bodyHeight / 2}
            stroke={stroke}
            strokeWidth={symbolStroke}
            fill="rgba(255,255,255,0.14)"
          />
          <Line
            points={[bodyX + bandInset, bodyY + 4, bodyX + bandInset, bodyY + bodyHeight - 4]}
            stroke={accent}
            strokeWidth={2.2}
            lineCap="round"
          />
          <Line
            points={[bodyX + bodyWidth - bandInset, bodyY + 4, bodyX + bodyWidth - bandInset, bodyY + bodyHeight - 4]}
            stroke={accent}
            strokeWidth={2.2}
            lineCap="round"
          />
        </Group>
      )
    }
    case 'diode':
    case 'flyback-diode':
    case 'rectifier-diode':
    case 'zener-diode':
    case 'tvs-diode':
    case 'led':
      return (
        <Group listening={false}>
          <DeviceDiodeGlyph width={width} centerY={centerY} stroke={stroke} accent={accent} kind={visualKind} />
        </Group>
      )
    case 'switch': {
      const leftContact = { x: 64, y: centerY + 10 }
      const rightContact = { x: width - 64, y: centerY - 10 }
      return (
        <Group listening={false}>
          <Line points={buildLeadLine(18, leftContact.x - 8, leftContact.y)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line
            points={[rightContact.x + 8, rightContact.y, width - 18, rightContact.y]}
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineCap="round"
          />
          <Circle x={leftContact.x} y={leftContact.y} radius={5} fill={stroke} />
          <Circle x={rightContact.x} y={rightContact.y} radius={5} fill={stroke} />
          <Line
            points={[leftContact.x + 2, leftContact.y - 4, rightContact.x - 20, rightContact.y - 18]}
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineCap="round"
          />
        </Group>
      )
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
      return (
        <Group listening={false}>
          <Line points={buildLeadLine(18, leftContact.x - 8, leftContact.y)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line
            points={[rightContact.x + 8, rightContact.y, width - 18, rightContact.y]}
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineCap="round"
          />
          <Circle x={leftContact.x} y={leftContact.y} radius={5} fill={stroke} />
          <Circle x={rightContact.x} y={rightContact.y} radius={5} fill={stroke} />
          <Line
            points={[leftContact.x + 2, leftContact.y - 4, armLeftX, armY, armRightX, armY]}
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineJoin="round"
            lineCap="round"
          />
          <Line
            points={[armRightX, armY, rightContact.x - 8, rightContact.y - 8]}
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineCap="round"
          />
          <Line
            points={[plungerX, plungerTopY, plungerX, armY - 4]}
            stroke={accent}
            strokeWidth={2.4}
            lineCap="round"
          />
          <Line
            points={[plungerX - 14, plungerTopY, plungerX + 14, plungerTopY]}
            stroke={accent}
            strokeWidth={2.4}
            lineCap="round"
          />
        </Group>
      )
    }
    case 'crystal': {
      const plateLeft = width / 2 - 28
      const plateRight = width / 2 + 28
      return (
        <Group listening={false}>
          <Line points={buildLeadLine(18, plateLeft, centerY)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={buildLeadLine(plateRight, width - 18, centerY)} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={[plateLeft, centerY - 22, plateLeft, centerY + 22]} stroke={stroke} strokeWidth={symbolStroke} />
          <Line points={[plateRight, centerY - 22, plateRight, centerY + 22]} stroke={stroke} strokeWidth={symbolStroke} />
          <Rect
            x={width / 2 - 10}
            y={centerY - 18}
            width={20}
            height={36}
            cornerRadius={5}
            stroke={accent}
            strokeWidth={2.2}
            fill="rgba(255,255,255,0.36)"
          />
        </Group>
      )
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
      return (
        <Group listening={false}>
          <Line
            points={[triangleLeft, triangleTop, triangleRight, triangleCenterY, triangleLeft, triangleBottom]}
            closed
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineJoin="round"
            fill="rgba(255,255,255,0.16)"
          />
          <Line points={[18, inputTopY, triangleLeft, inputTopY]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={[18, inputBottomY, triangleLeft, inputBottomY]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line
            points={[triangleRight, triangleCenterY, width - 18, triangleCenterY]}
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineCap="round"
          />
          <Text x={triangleLeft - 22} y={inputTopY - 10} text="-" fill={accent} fontSize={18} fontStyle="bold" />
          <Text x={triangleLeft - 24} y={inputBottomY - 10} text="+" fill={accent} fontSize={18} fontStyle="bold" />
          <Line points={[midX, 14, midX, triangleTop]} stroke={accent} strokeWidth={2.2} lineCap="round" />
          <Line points={[midX, triangleBottom, midX, triangleBottom + 14]} stroke={accent} strokeWidth={2.2} lineCap="round" />
        </Group>
      )
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
          ? {
              x: junction.x + (terminalX - junction.x) * 0.68,
              y: junction.y + (emitterY - junction.y) * 0.68,
            }
          : {
              x: junction.x + (terminalX - junction.x) * 0.5,
              y: junction.y + (emitterY - junction.y) * 0.5,
            }
      const arrowAngle = visualKind === 'npn-transistor' ? 44 : 224
      return (
        <Group listening={false}>
          <Line points={[18, circleY, baseX, circleY]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line
            points={[baseX, circleY - radius * 0.6, baseX, circleY + radius * 0.6]}
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineCap="round"
          />
          <Line points={[baseX, circleY, junction.x, junction.y]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={[junction.x, junction.y, terminalX, collectorY]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={[junction.x, junction.y, terminalX, emitterY]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={[terminalX, 18, terminalX, collectorY]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={[terminalX, emitterY, terminalX, height - 46]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Circle x={circleX} y={circleY} radius={radius} stroke={stroke} strokeWidth={2.2} />
          <Line
            points={arrowHead(arrowPoint.x, arrowPoint.y, arrowAngle, 8.5)}
            stroke={accent}
            strokeWidth={2.2}
            lineCap="round"
          />
        </Group>
      )
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
      return (
        <Group listening={false}>
          <Line points={[18, centerY, gateLeadEnd, centerY]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line
            points={[gateX, topTapY + 6, gateX, bottomTapY - 6]}
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineCap="round"
          />
          {visualKind === 'pmos' && <Circle x={gateX - 10} y={centerY} radius={bubbleRadius} stroke={accent} strokeWidth={2.2} />}
          <Line points={[diffusionX, 18, diffusionX, topTapY]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line
            points={[diffusionX, bottomTapY, diffusionX, height - 46]}
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineCap="round"
          />
          <Line points={[channelX, topTapY, diffusionX, topTapY]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line
            points={[channelX, bottomTapY, diffusionX, bottomTapY]}
            stroke={stroke}
            strokeWidth={symbolStroke}
            lineCap="round"
          />
          <Line points={[channelX, topTapY + 4, channelX, centerY - 14]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={[channelX, centerY - 6, channelX, centerY + 6]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line points={[channelX, centerY + 14, channelX, bottomTapY - 4]} stroke={stroke} strokeWidth={symbolStroke} lineCap="round" />
          <Line
            points={[gateX + 10, centerY, channelX - 12, centerY]}
            stroke={accent}
            strokeWidth={2}
            dash={[8, 6]}
            lineCap="round"
          />
        </Group>
      )
    }
    default:
      return null
  }
}
