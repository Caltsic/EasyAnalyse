import { Circle, Group, Line, Rect, Text } from 'react-konva'
import type { DeviceVisualKind } from '../lib/deviceSymbols'
import {
  buildDeviceSymbolPrimitives,
  type DeviceSymbolPrimitive,
  type SymbolPaintRole,
} from '../lib/deviceSymbolPrimitives'

interface DeviceSymbolGlyphProps {
  visualKind: DeviceVisualKind
  width: number
  height: number
  stroke: string
  accent: string
}

function resolvePaint(roleOrColor: SymbolPaintRole | string | undefined, stroke: string, accent: string) {
  if (!roleOrColor) {
    return undefined
  }
  if (roleOrColor === 'stroke') {
    return stroke
  }
  if (roleOrColor === 'accent') {
    return accent
  }
  return roleOrColor
}

function renderPrimitive(
  primitive: DeviceSymbolPrimitive,
  index: number,
  stroke: string,
  accent: string,
) {
  switch (primitive.type) {
    case 'line':
      return (
        <Line
          key={index}
          points={primitive.points}
          stroke={resolvePaint(primitive.stroke, stroke, accent)}
          strokeWidth={primitive.strokeWidth}
          closed={primitive.closed}
          fill={resolvePaint(primitive.fill, stroke, accent)}
          dash={primitive.dash}
          tension={primitive.tension}
          lineCap="round"
          lineJoin="round"
        />
      )
    case 'rect':
      return (
        <Rect
          key={index}
          x={primitive.x}
          y={primitive.y}
          width={primitive.width}
          height={primitive.height}
          cornerRadius={primitive.radius}
          stroke={resolvePaint(primitive.stroke, stroke, accent)}
          strokeWidth={primitive.strokeWidth}
          fill={resolvePaint(primitive.fill, stroke, accent)}
        />
      )
    case 'circle':
      return (
        <Circle
          key={index}
          x={primitive.x}
          y={primitive.y}
          radius={primitive.radius}
          stroke={resolvePaint(primitive.stroke, stroke, accent)}
          strokeWidth={primitive.strokeWidth}
          fill={resolvePaint(primitive.fill, stroke, accent)}
        />
      )
    case 'text':
      return (
        <Text
          key={index}
          x={primitive.x}
          y={primitive.y}
          text={primitive.text}
          fill={resolvePaint(primitive.fill, stroke, accent)}
          fontSize={primitive.fontSize}
          fontStyle={primitive.bold ? 'bold' : 'normal'}
        />
      )
  }
}

export function DeviceSymbolGlyph({
  visualKind,
  width,
  height,
  stroke,
  accent,
}: DeviceSymbolGlyphProps) {
  const primitives = buildDeviceSymbolPrimitives(visualKind, width, height)
  return (
    <Group listening={false}>
      {primitives.map((primitive, index) => renderPrimitive(primitive, index, stroke, accent))}
    </Group>
  )
}
