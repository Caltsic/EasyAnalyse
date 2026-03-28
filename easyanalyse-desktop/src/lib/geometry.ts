import type {
  AnnotationTarget,
  ComponentEntity,
  ComponentGeometry,
  DocumentFile,
  EndpointRef,
  Point,
  PortAnchor,
  WireEntity,
} from '../types/document'
import { getComponentRotation } from './document'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export function getComponentBounds(geometry: ComponentGeometry): Bounds {
  switch (geometry.type) {
    case 'rectangle':
      return {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
      }
    case 'circle':
      return {
        x: geometry.cx - geometry.radius,
        y: geometry.cy - geometry.radius,
        width: geometry.radius * 2,
        height: geometry.radius * 2,
      }
    case 'triangle': {
      const xs = geometry.vertices.map((vertex) => vertex.x)
      const ys = geometry.vertices.map((vertex) => vertex.y)
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      const width = Math.max(...xs) - x
      const height = Math.max(...ys) - y

      return { x, y, width, height }
    }
  }
}

export function translateGeometry(
  geometry: ComponentGeometry,
  dx: number,
  dy: number,
): ComponentGeometry {
  switch (geometry.type) {
    case 'rectangle':
      return {
        ...geometry,
        x: geometry.x + dx,
        y: geometry.y + dy,
      }
    case 'circle':
      return {
        ...geometry,
        cx: geometry.cx + dx,
        cy: geometry.cy + dy,
      }
    case 'triangle':
      return {
        ...geometry,
        vertices: geometry.vertices.map((vertex) => ({
          x: vertex.x + dx,
          y: vertex.y + dy,
        })) as [Point, Point, Point],
      }
  }
}

export function getPortPosition(
  component: ComponentEntity,
  anchor: PortAnchor,
): Point {
  const basePoint = getPortBasePosition(component.geometry, anchor)
  const center = getGeometryCenter(component.geometry)
  return rotatePoint(basePoint, center, getComponentRotation(component))
}

function getPortBasePosition(
  geometry: ComponentGeometry,
  anchor: PortAnchor,
): Point {
  if (geometry.type === 'rectangle' && anchor.kind === 'rectangle-side') {
    const x2 = geometry.x + geometry.width
    const y2 = geometry.y + geometry.height

    switch (anchor.side) {
      case 'top':
        return {
          x: geometry.x + geometry.width * anchor.offset,
          y: geometry.y,
        }
      case 'right':
        return {
          x: x2,
          y: geometry.y + geometry.height * anchor.offset,
        }
      case 'bottom':
        return {
          x: geometry.x + geometry.width * anchor.offset,
          y: y2,
        }
      case 'left':
        return {
          x: geometry.x,
          y: geometry.y + geometry.height * anchor.offset,
        }
    }
  }

  if (geometry.type === 'circle' && anchor.kind === 'circle-angle') {
    const angle = (anchor.angleDeg * Math.PI) / 180
    return {
      x: geometry.cx + Math.cos(angle) * geometry.radius,
      y: geometry.cy + Math.sin(angle) * geometry.radius,
    }
  }

  if (geometry.type === 'triangle' && anchor.kind === 'triangle-edge') {
    const start = geometry.vertices[anchor.edgeIndex]
    const end = geometry.vertices[(anchor.edgeIndex + 1) % 3]

    return {
      x: start.x + (end.x - start.x) * anchor.offset,
      y: start.y + (end.y - start.y) * anchor.offset,
    }
  }

  return getGeometryCenter(geometry)
}

export function derivePortAnchor(
  component: ComponentEntity,
  point: Point,
): PortAnchor {
  const geometry = component.geometry
  const center = getGeometryCenter(geometry)
  const localPoint = rotatePoint(
    point,
    center,
    -getComponentRotation(component),
  )

  if (geometry.type === 'rectangle') {
    return deriveRectangleAnchor(geometry, localPoint)
  }

  if (geometry.type === 'circle') {
    return {
      kind: 'circle-angle',
      angleDeg:
        (Math.atan2(localPoint.y - geometry.cy, localPoint.x - geometry.cx) * 180) /
        Math.PI,
    }
  }

  return deriveTriangleAnchor(geometry.vertices, localPoint)
}

export function getGeometryCenter(geometry: ComponentGeometry): Point {
  switch (geometry.type) {
    case 'rectangle':
      return {
        x: geometry.x + geometry.width / 2,
        y: geometry.y + geometry.height / 2,
      }
    case 'circle':
      return { x: geometry.cx, y: geometry.cy }
    case 'triangle':
      return {
        x:
          (geometry.vertices[0].x +
            geometry.vertices[1].x +
            geometry.vertices[2].x) /
          3,
        y:
          (geometry.vertices[0].y +
            geometry.vertices[1].y +
            geometry.vertices[2].y) /
          3,
      }
  }
}

export function getEndpointPosition(
  document: DocumentFile,
  endpoint: EndpointRef,
): Point | null {
  if (endpoint.entityType === 'node') {
    return document.nodes.find((node) => node.id === endpoint.refId)?.position ?? null
  }

  const port = document.ports.find((item) => item.id === endpoint.refId)
  if (!port) {
    return null
  }

  const component = document.components.find(
    (item) => item.id === port.componentId,
  )

  return component ? getPortPosition(component, port.anchor) : null
}

export function getWirePoints(
  document: DocumentFile,
  wire: WireEntity,
): number[] | null {
  const source = getEndpointPosition(document, wire.source)
  const target = getEndpointPosition(document, wire.target)

  if (!source || !target) {
    return null
  }

  const points = [source]
  if (wire.route.kind === 'polyline') {
    points.push(...wire.route.bendPoints)
  }
  points.push(target)

  return points.flatMap((point) => [point.x, point.y])
}

export function getWireMidpoint(document: DocumentFile, wire: WireEntity): Point {
  const points = getWirePoints(document, wire)

  if (!points || points.length < 4) {
    return { x: 0, y: 0 }
  }

  const middle = Math.floor(points.length / 4) * 2
  return {
    x: points[middle],
    y: points[middle + 1],
  }
}

export function getTargetPosition(
  document: DocumentFile,
  target: AnnotationTarget,
): Point {
  switch (target.entityType) {
    case 'component': {
      const component = document.components.find((item) => item.id === target.refId)
      return component ? getGeometryCenter(component.geometry) : { x: 0, y: 0 }
    }
    case 'port': {
      const port = document.ports.find((item) => item.id === target.refId)
      const component = port
        ? document.components.find((item) => item.id === port.componentId)
        : undefined
      return port && component ? getPortPosition(component, port.anchor) : { x: 0, y: 0 }
    }
    case 'node': {
      const node = document.nodes.find((item) => item.id === target.refId)
      return node?.position ?? { x: 0, y: 0 }
    }
    case 'wire': {
      const wire = document.wires.find((item) => item.id === target.refId)
      return wire ? getWireMidpoint(document, wire) : { x: 0, y: 0 }
    }
    default:
      return { x: 0, y: 0 }
  }
}

export function isEndpointRef(
  candidate: EndpointRef | null | undefined,
): candidate is EndpointRef {
  return Boolean(candidate?.entityType && candidate?.refId)
}

export function midpoint(from: Point, to: Point): Point {
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
  }
}

export function rotatePoint(
  point: Point,
  center: Point,
  angleDeg: number,
): Point {
  if (!angleDeg) {
    return point
  }

  const angle = (angleDeg * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = point.x - center.x
  const dy = point.y - center.y

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function createPolylineBendPoint(
  source: Point,
  target: Point,
): Point[] {
  const horizontalGap = Math.abs(source.x - target.x)
  const verticalGap = Math.abs(source.y - target.y)

  if (horizontalGap > verticalGap) {
    return [{ x: (source.x + target.x) / 2, y: source.y }]
  }

  return [{ x: source.x, y: (source.y + target.y) / 2 }]
}

function deriveRectangleAnchor(
  geometry: Extract<ComponentGeometry, { type: 'rectangle' }>,
  point: Point,
): PortAnchor {
  const x2 = geometry.x + geometry.width
  const y2 = geometry.y + geometry.height
  const distances = [
    { side: 'top' as const, distance: Math.abs(point.y - geometry.y) },
    { side: 'right' as const, distance: Math.abs(point.x - x2) },
    { side: 'bottom' as const, distance: Math.abs(point.y - y2) },
    { side: 'left' as const, distance: Math.abs(point.x - geometry.x) },
  ]
  const side = distances.reduce((closest, current) =>
    current.distance < closest.distance ? current : closest,
  ).side

  if (side === 'top' || side === 'bottom') {
    return {
      kind: 'rectangle-side',
      side,
      offset: clamp((point.x - geometry.x) / geometry.width, 0, 1),
    }
  }

  return {
    kind: 'rectangle-side',
    side,
    offset: clamp((point.y - geometry.y) / geometry.height, 0, 1),
  }
}

function deriveTriangleAnchor(
  vertices: [Point, Point, Point],
  point: Point,
): PortAnchor {
  const edges = [
    [vertices[0], vertices[1]],
    [vertices[1], vertices[2]],
    [vertices[2], vertices[0]],
  ] as const

  const closest = edges
    .map(([start, end], edgeIndex) => {
      const projected = projectPointOnSegment(point, start, end)
      return {
        edgeIndex,
        offset: projected.t,
        distance:
          (projected.point.x - point.x) ** 2 + (projected.point.y - point.y) ** 2,
      }
    })
    .reduce((current, next) => (next.distance < current.distance ? next : current))

  return {
    kind: 'triangle-edge',
    edgeIndex: closest.edgeIndex as 0 | 1 | 2,
    offset: closest.offset,
  }
}

function projectPointOnSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (!lengthSquared) {
    return {
      point: start,
      t: 0,
    }
  }

  const rawT =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  const t = clamp(rawT, 0, 1)

  return {
    point: {
      x: start.x + dx * t,
      y: start.y + dy * t,
    },
    t,
  }
}
