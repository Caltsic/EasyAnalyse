# EASYAnalyse Exchange Contract

This file is AI-facing documentation for the EASYAnalyse desktop tool.

Goal:
- Allow an AI to read, modify, generate, and repair circuit exchange JSON for this tool without ambiguity.
- Prioritize exact field contracts, invariants, allowed transformations, and save-blocking conditions.
- Prefer authoritative behavior over user-interface intuition.

Authoritative sources:
- `AI原生电路交换格式.schema.json`
- `AI原生电路交换格式设计.md`
- `AI原生电路表达与还原工具 PRD.md`
- Current implementation in `easyanalyse-desktop`

If this file conflicts with the JSON schema, the schema wins.
If this file conflicts with the desktop editor behavior, the schema and persisted JSON contract win.

## 1. Top-Level Contract

The persisted file is a single JSON document with this top-level shape:

```json
{
  "schemaVersion": "1.0.0",
  "document": {},
  "canvas": {},
  "components": [],
  "ports": [],
  "nodes": [],
  "wires": [],
  "annotations": [],
  "extensions": {}
}
```

Required top-level arrays:
- `components`
- `ports`
- `nodes`
- `wires`
- `annotations`

Important:
- This format is normalized.
- `ports` are not nested under `components`.
- `wires` do not store freehand endpoints; they reference `port` or `node`.
- `annotations` are top-level objects and cannot target `document` or another `annotation`.

## 2. Naming, Casing, and Serialization Rules

Use camelCase exactly as shown below.

Critical field names:
- `schemaVersion`
- `createdAt`
- `updatedAt`
- `componentId`
- `pinInfo`
- `connectedWireIds`
- `serialNumber`
- `entityType`
- `refId`
- `angleDeg`
- `edgeIndex`
- `bendPoints`

Do not emit snake_case variants such as:
- `angle_deg`
- `edge_index`
- `bend_points`
- `connected_wire_ids`
- `serial_number`

## 3. Document Object

`document` fields:

```json
{
  "id": "doc.xxx",
  "title": "Required non-empty string",
  "description": "optional",
  "createdAt": "optional ISO datetime",
  "updatedAt": "optional ISO datetime",
  "source": "human | ai | mixed | imported",
  "extensions": {}
}
```

Rules:
- `id` must be globally unique across every entity in the whole file.
- `title` must be non-empty at save time.
- The editor will auto-refresh `updatedAt`.

## 4. Canvas Object

`canvas` fields:

```json
{
  "origin": { "x": 0, "y": 0 },
  "width": 2400,
  "height": 1600,
  "units": "px",
  "grid": {
    "enabled": true,
    "size": 40
  },
  "extensions": {}
}
```

Rules:
- `units` is currently `px`.
- `origin` exists but the editor treats component, port, node, wire, and annotation coordinates as absolute canvas-space coordinates.

## 5. Component Entity

Shape:

```json
{
  "id": "component.xxx",
  "name": "Required non-empty string",
  "geometry": {},
  "description": "optional",
  "tags": ["optional", "strings"],
  "extensions": {}
}
```

Supported geometry variants:

Rectangle:

```json
{
  "type": "rectangle",
  "x": 100,
  "y": 80,
  "width": 220,
  "height": 136
}
```

Circle:

```json
{
  "type": "circle",
  "cx": 300,
  "cy": 200,
  "radius": 72
}
```

Triangle:

```json
{
  "type": "triangle",
  "vertices": [
    { "x": 400, "y": 100 },
    { "x": 500, "y": 260 },
    { "x": 300, "y": 260 }
  ]
}
```

Rules:
- `name` must be non-empty at save time.
- `geometry` is the authoritative persisted placement.
- Components may be rotated in the editor.
- Rotation is persisted only through an extension, not as a first-class schema field.

Current rotation extension:

```json
{
  "extensions": {
    "easyanalyse": {
      "rotationDeg": 90
    }
  }
}
```

Rotation notes:
- `rotationDeg` is optional.
- Missing `rotationDeg` means `0`.
- Persist rotation only under `extensions.easyanalyse.rotationDeg`.
- Do not invent parallel fields like `rotation`, `angle`, or `rotationRadians`.

## 6. Port Entity

Shape:

```json
{
  "id": "port.xxx",
  "componentId": "component.xxx",
  "name": "Required non-empty string",
  "direction": "input | output",
  "pinInfo": {
    "number": "optional",
    "label": "optional",
    "description": "optional"
  },
  "anchor": {},
  "description": "optional",
  "extensions": {}
}
```

Rules:
- `componentId` must reference an existing component.
- `name` must be non-empty at save time.
- Port position is not stored as free `x/y`.
- Port position is always derived from `component.geometry + anchor + component rotation`.

This is important:
- In the UI, the user can drag a port freely along the component boundary.
- Persisted JSON must still encode that final position as an `anchor`, not as arbitrary coordinates.

Supported anchor kinds:

Rectangle side anchor:

```json
{
  "kind": "rectangle-side",
  "side": "top | right | bottom | left",
  "offset": 0.0
}
```

Meaning:
- `offset` is normalized along that side, usually in `[0, 1]`.
- `0` means side start.
- `1` means side end.

Circle angle anchor:

```json
{
  "kind": "circle-angle",
  "angleDeg": 90
}
```

Meaning:
- Angle is measured in degrees around the circle center.

Triangle edge anchor:

```json
{
  "kind": "triangle-edge",
  "edgeIndex": 1,
  "offset": 0.25
}
```

Meaning:
- `edgeIndex` must be `0`, `1`, or `2`.
- The edge is the segment from vertex `edgeIndex` to vertex `(edgeIndex + 1) % 3`.
- `offset` is normalized along that edge.

Anchor compatibility rules:
- Rectangle component -> only `rectangle-side`
- Circle component -> only `circle-angle`
- Triangle component -> only `triangle-edge`

## 7. Node Entity

Shape:

```json
{
  "id": "node.xxx",
  "position": { "x": 0, "y": 0 },
  "connectedWireIds": ["wire.1", "wire.2"],
  "role": "generic | junction | branch",
  "description": "optional",
  "extensions": {}
}
```

Rules:
- `position` is absolute canvas-space.
- `connectedWireIds` is required in persisted JSON.
- `connectedWireIds` must exactly match the actual set of wires that reference this node.
- `connectedWireIds` must contain at least 2 wire IDs according to schema.

Important editor behavior:
- The editor recalculates `connectedWireIds` from actual `wire.source/target`.
- A node with fewer than 2 wires may temporarily exist during editing.
- Such a node blocks save/export because the persisted exchange format requires at least 2 connected wires.

AI guidance:
- Do not invent a standalone node.
- If you create a node, also create at least 2 wires that reference it.
- If you remove wires from a node and it drops below 2, either:
  - reconnect it, or
  - delete the node.

## 8. Wire Entity

Shape:

```json
{
  "id": "wire.xxx",
  "serialNumber": "Required non-empty string",
  "source": { "entityType": "port | node", "refId": "..." },
  "target": { "entityType": "port | node", "refId": "..." },
  "route": {},
  "description": "optional",
  "extensions": {}
}
```

Endpoint rules:
- `source.entityType` and `target.entityType` may only be `port` or `node`.
- `refId` must point to an existing entity of the declared type.
- A wire never directly targets a component or annotation.

Supported route variants:

Straight:

```json
{
  "kind": "straight"
}
```

Polyline:

```json
{
  "kind": "polyline",
  "bendPoints": [
    { "x": 320, "y": 160 },
    { "x": 360, "y": 220 }
  ]
}
```

Polyline rules:
- `bendPoints` must exist and contain at least 1 point.
- `bendPoints` contain only intermediate corners.
- Do not repeat source endpoint or target endpoint inside `bendPoints`.
- Order matters. Preserve the exact route order from source to target.
- The editor supports multiple bend points.

Save-time rule:
- `serialNumber` must be non-empty.

## 9. Annotation Entity

Shape:

```json
{
  "id": "annotation.xxx",
  "kind": "signal | note | label",
  "target": {
    "entityType": "component | port | node | wire",
    "refId": "..."
  },
  "text": "Required non-empty string",
  "position": { "x": 0, "y": 0 },
  "extensions": {}
}
```

Rules:
- `target.entityType` may only be:
  - `component`
  - `port`
  - `node`
  - `wire`
- `annotation` cannot target `document`.
- `annotation` cannot target another `annotation`.
- `text` must be non-empty at save time.
- `position` is optional. If omitted, the editor derives a default display offset from the target.

## 10. Global Invariants

These are mandatory for valid persisted files:

1. Every `id` in the entire document must be globally unique.
2. Every reference must resolve.
3. Every port anchor kind must match its component geometry kind.
4. Every node’s `connectedWireIds` must exactly equal the actual referencing wires.
5. Every persisted node must have at least 2 connected wires.
6. Every required string must be non-empty:
   - `document.title`
   - `component.name`
   - `port.name`
   - `wire.serialNumber`
   - `annotation.text`
7. Every polyline must have at least 1 bend point.
8. `bendPoints` must not duplicate the source or target endpoint coordinates.

## 11. What The Editor Auto-Normalizes

Before validation/save, the editor normalizes:
- `document.updatedAt`
- array ordering by `id`
- `node.connectedWireIds` from actual wire references
- blank required strings to a fallback value
- empty polyline `bendPoints` to a default intermediate point

Fallback behavior for blank required strings:
- blank document title -> `"Untitled circuit"`
- blank component name -> component `id`
- blank port name -> port `id`
- blank wire serial number -> wire `id`
- blank annotation text -> annotation `id`

Important:
- Normalization is not a license to emit sloppy JSON.
- AI should still produce correct, intentional values instead of relying on fallback repair.

## 12. Save-Blocking Conditions

The desktop tool will refuse to save/export when the normalized document still violates schema or semantic validation.

Common blockers:
- node has fewer than 2 connected wires
- missing component referenced by `port.componentId`
- missing endpoint referenced by a wire
- wrong anchor kind for a component geometry
- duplicate IDs
- malformed route contract

## 13. Construction Recipes

### 13.1 Add a component

Minimum valid component:

```json
{
  "id": "component.driver",
  "name": "Driver",
  "geometry": {
    "type": "rectangle",
    "x": 520,
    "y": 120,
    "width": 200,
    "height": 140
  }
}
```

### 13.2 Add a port on a component

Example for rectangle input:

```json
{
  "id": "port.driver.in",
  "componentId": "component.driver",
  "name": "IN",
  "direction": "input",
  "anchor": {
    "kind": "rectangle-side",
    "side": "left",
    "offset": 0.5
  }
}
```

### 13.3 Create a valid node fan-in / fan-out

Minimum valid node requires 2 wires:

```json
{
  "id": "node.mid.1",
  "position": { "x": 430, "y": 190 },
  "connectedWireIds": ["wire.1", "wire.2"],
  "role": "junction"
}
```

### 13.4 Create a straight wire

```json
{
  "id": "wire.1",
  "serialNumber": "W1",
  "source": { "entityType": "port", "refId": "port.mcu.pwm_out" },
  "target": { "entityType": "node", "refId": "node.mid.1" },
  "route": { "kind": "straight" }
}
```

### 13.5 Create a multi-bend wire

```json
{
  "id": "wire.2",
  "serialNumber": "W2",
  "source": { "entityType": "node", "refId": "node.mid.1" },
  "target": { "entityType": "port", "refId": "port.driver.in" },
  "route": {
    "kind": "polyline",
    "bendPoints": [
      { "x": 470, "y": 190 },
      { "x": 470, "y": 260 },
      { "x": 520, "y": 260 }
    ]
  }
}
```

### 13.6 Rotate a component

Persist rotation only via:

```json
{
  "extensions": {
    "easyanalyse": {
      "rotationDeg": 90
    }
  }
}
```

Rotation does not change persisted port anchor kind.
It changes rendered world position of ports by rotating the anchor-derived point around the component center.

### 13.7 Add annotations

Signal annotation on a port:

```json
{
  "id": "annotation.signal.1",
  "kind": "signal",
  "target": { "entityType": "port", "refId": "port.mcu.pwm_out" },
  "text": "3.3V PWM, 20kHz"
}
```

## 14. AI Editing Rules

Do:
- preserve all IDs unless the object is intentionally replaced
- preserve camelCase
- update all dependent references when renaming IDs
- keep `connectedWireIds` synchronized with actual wire references
- delete orphaned nodes that fall below 2 wires
- keep route order stable
- use `extensions.easyanalyse.rotationDeg` for rotation

Do not:
- switch to nested component->ports structure
- store free `x/y` on ports
- add unsupported entity types
- target annotations with annotations
- output empty required strings
- use snake_case aliases
- put source/target endpoints into `bendPoints`
- leave a polyline with empty `bendPoints`

## 15. AI Repair Strategy For Invalid Files

When repairing an invalid file, apply this order:

1. Fix casing and field names.
2. Resolve duplicate IDs.
3. Resolve broken references.
4. Fix anchor-kind vs geometry-kind mismatches.
5. Recompute `node.connectedWireIds`.
6. Remove or reconnect nodes with fewer than 2 wires.
7. Fill required non-empty strings.
8. Ensure every polyline has valid intermediate bend points.

## 16. Practical Notes About Editor Interaction

Current desktop behavior relevant to JSON:
- Component placement is click-to-place.
- Node placement is click-to-place.
- Ports are draggable along the component boundary, but persisted as anchors.
- Wires can be straight or multi-bend polyline.
- Component rotation exists and is persisted through extension state.
- Save is blocked on unresolved schema/semantic issues.

## 17. Minimal Valid Example

```json
{
  "schemaVersion": "1.0.0",
  "document": {
    "id": "doc.demo",
    "title": "PWM Driver Demo",
    "source": "human"
  },
  "canvas": {
    "origin": { "x": 0, "y": 0 },
    "width": 1600,
    "height": 900,
    "units": "px",
    "grid": {
      "enabled": true,
      "size": 40
    }
  },
  "components": [
    {
      "id": "component.mcu",
      "name": "MCU",
      "geometry": {
        "type": "rectangle",
        "x": 120,
        "y": 120,
        "width": 220,
        "height": 140
      }
    },
    {
      "id": "component.driver",
      "name": "Driver",
      "geometry": {
        "type": "rectangle",
        "x": 520,
        "y": 120,
        "width": 200,
        "height": 140
      },
      "extensions": {
        "easyanalyse": {
          "rotationDeg": 0
        }
      }
    }
  ],
  "ports": [
    {
      "id": "port.mcu.pwm_out",
      "componentId": "component.mcu",
      "name": "PWM_OUT",
      "direction": "output",
      "anchor": {
        "kind": "rectangle-side",
        "side": "right",
        "offset": 0.5
      }
    },
    {
      "id": "port.driver.in",
      "componentId": "component.driver",
      "name": "IN",
      "direction": "input",
      "anchor": {
        "kind": "rectangle-side",
        "side": "left",
        "offset": 0.5
      }
    }
  ],
  "nodes": [
    {
      "id": "node.mid.1",
      "position": { "x": 430, "y": 190 },
      "connectedWireIds": ["wire.1", "wire.2"],
      "role": "junction"
    }
  ],
  "wires": [
    {
      "id": "wire.1",
      "serialNumber": "W1",
      "source": { "entityType": "port", "refId": "port.mcu.pwm_out" },
      "target": { "entityType": "node", "refId": "node.mid.1" },
      "route": { "kind": "straight" }
    },
    {
      "id": "wire.2",
      "serialNumber": "W2",
      "source": { "entityType": "node", "refId": "node.mid.1" },
      "target": { "entityType": "port", "refId": "port.driver.in" },
      "route": {
        "kind": "polyline",
        "bendPoints": [{ "x": 470, "y": 190 }]
      }
    }
  ],
  "annotations": [
    {
      "id": "annotation.signal.1",
      "kind": "signal",
      "target": { "entityType": "port", "refId": "port.mcu.pwm_out" },
      "text": "3.3V PWM, 20kHz"
    }
  ]
}
```
