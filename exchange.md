# EASYAnalyse Semantic Circuit Exchange

Version: `4.0.0`

This is the only canonical EASYAnalyse exchange format used by the current desktop editor.

The format is intentionally semantic-first:

- no wires
- no junction nodes
- no bend points
- no standalone signal objects
- no topology reconstruction step during editing

Instead, a circuit is described through:

- `devices`: the hardware blocks
- `terminals`: each device's interfaces
- terminal `label`: the connectivity key
- `view`: layout and readability metadata

If multiple terminals share the same non-empty `label`, they are considered connected.

## 1. Design Goal

The purpose of this format is to let AI and engineers communicate hardware structure without forcing the AI to fabricate fake routing geometry.

The format must be:

1. easy for AI to generate
2. easy for humans to read
3. stable enough for validation
4. expressive enough to drive a clean semantic diagram

## 2. Core Rule

Connectivity is defined only by terminal labels.

That means:

- the editor does not need wires to understand connectivity
- the renderer can group devices by shared labels
- identical labels naturally produce identical terminal colors
- click and focus behavior can be derived from semantic relations instead of line topology

## 3. Top-Level Shape

```json
{
  "schemaVersion": "4.0.0",
  "document": {},
  "devices": [],
  "view": {},
  "extensions": {}
}
```

Top-level required fields:

- `schemaVersion`
- `document`
- `devices`
- `view`

## 4. `document`

`document` stores global metadata.

```json
{
  "id": "doc.demo",
  "title": "I2C Sensor Node",
  "description": "MCU with several I2C peripherals",
  "createdAt": "2026-04-14T12:00:00.000Z",
  "updatedAt": "2026-04-14T12:00:00.000Z",
  "source": "ai",
  "language": "zh-CN",
  "tags": ["i2c", "sensor"]
}
```

Rules:

- `id` must be globally unique across the whole file
- `title` must be non-empty
- `source` should be one of: `human`, `ai`, `mixed`, `imported`

## 5. `devices`

Each device is a readable hardware block.

```json
{
  "id": "device.mcu",
  "name": "STM32 Controller",
  "kind": "controller",
  "category": "logic",
  "reference": "U1",
  "description": "Main control MCU",
  "tags": ["mcu", "i2c"],
  "properties": {
    "partNumber": "STM32F103C8T6",
    "package": "LQFP-48"
  },
  "terminals": []
}
```

Rules:

- device `id` values must be globally unique
- `name` must be non-empty
- `kind` must be non-empty
- `reference` is recommended for EDA-like readability
- `properties` can carry structured metadata such as value, tolerance, package, part number, voltage, or notes

## 6. `terminals`

Terminals are nested under the owning device and are the only place where connectivity semantics are declared.

```json
{
  "id": "terminal.mcu.scl",
  "name": "I2C1_SCL_U1",
  "label": "SCL",
  "direction": "bidirectional",
  "description": "I2C clock pin",
  "required": true,
  "side": "left",
  "order": 0,
  "pin": {
    "number": "PB6",
    "name": "PB6"
  }
}
```

### 6.1 Direction

Allowed `direction` values:

- `input`
- `output`
- `bidirectional`
- `passive`
- `power-in`
- `power-out`
- `ground`
- `shield`
- `unspecified`

### 6.2 Layout Hints

Optional terminal layout fields:

- `side`: `left`, `right`, `top`, `bottom`, `auto`
- `order`: stable ordering within the same side

Default side behavior when `side` is omitted:

- `input`, `power-in`, `ground` -> `left`
- `output`, `power-out` -> `right`
- `bidirectional` -> `top`
- `passive`, `shield`, `unspecified` -> `bottom`

### 6.3 Connectivity

If two terminals share the same non-empty `label`, they are connected.

There is no other primary connectivity mechanism.

Rules:

- terminal `id` values must be globally unique across the whole file
- terminal `name` must be non-empty
- empty `label` means the terminal is not connected to any shared label group
- `required: true` without a non-empty `label` should produce a warning

### 6.4 Authoring Guidance

For new terminals, default `name` and `label` should be device-specific to avoid accidental shorting, for example:

- `INPUT_1_U1`
- `INPUT_1_U2`
- `INPUT_1_R1`

After that, the user or AI can replace the label with a semantic value such as `SCL`, `SDA`, `TX`, or `GND`.

## 7. `view`

`view` stores readability metadata only. It does not define circuit truth.

```json
{
  "canvas": {
    "units": "px",
    "grid": {
      "enabled": true,
      "size": 36,
      "majorEvery": 5
    },
    "background": "grid"
  },
  "devices": {
    "device.mcu": {
      "position": { "x": 280, "y": 320 },
      "size": { "width": 240, "height": 148 },
      "rotationDeg": 90,
      "shape": "rectangle"
    }
  },
  "networkLines": {
    "network.vcc": {
      "label": "VCC",
      "position": { "x": 720, "y": 120 },
      "length": 960,
      "orientation": "horizontal"
    },
    "network.gnd": {
      "label": "GND",
      "position": { "x": 720, "y": 560 },
      "length": 960,
      "orientation": "horizontal"
    }
  },
  "focus": {
    "defaultDeviceId": "device.mcu",
    "preferredDirection": "left-to-right"
  }
}
```

### 7.1 `view.canvas`

Current contract:

- the canvas is infinite
- `units` must be `"px"`
- `background` must be `"grid"` when present
- `grid.size` controls the base grid spacing
- `grid.majorEvery` controls major grid grouping

### 7.2 `view.devices[deviceId]`

Optional display metadata per device:

- `position`
- `size`
- `rotationDeg`: clockwise display rotation in degrees, normalized by the implementation into `[0, 360)`
- `shape`: `rectangle`, `circle`, `triangle`
- `locked`
- `collapsed`
- `groupId`

### 7.3 `view.networkLines[networkLineId]`

Optional independent linear-network metadata:

- `label`: the shared terminal label represented by this independent network line
- `position`: the line center on the canvas
- `length`
- `orientation`: `horizontal`, `vertical`

Use `view.networkLines` for independent linear networks such as `VCC`, `GND`, `3V3`, `5V`, or other high-frequency rails that would otherwise flood device-focus views.

Behavior:

- each network line is a first-class view entity at the same visual level as a device
- a network line is not attached to a specific terminal and does not belong to a device
- independent network lines do not change circuit truth
- terminal `label` values are still the only connectivity key
- terminals remain dots on devices; the line is only a semantic visual summary for that label group
- if a label already has an independent network line, normal device focus can suppress that label so common rails do not explode the layout
- focusing that independent network line gathers all devices exposing the same label

### 7.4 `view.focus`

Optional focus metadata:

- `defaultDeviceId`
- `preferredDirection`: `left-to-right`, `top-to-bottom`, `auto`

## 8. Validation Rules

The desktop app always validates the document and keeps the latest validation report visible in the UI.

Validation is advisory, not a save gate, as long as the document can still be normalized into the current semantic v4 model.

In practice, save should fail only when:

- the document cannot be parsed or normalized into the semantic v4 model
- the target file path cannot be written

Semantic validation currently checks at least:

1. duplicate IDs across document, devices, and terminals
2. missing device references inside `view.devices`
3. missing default focus device references
4. multiple output-like terminals inside one label group
5. required terminals with no assigned label

Warnings may still be shown for:

- devices with no terminals

## 9. AI Generation Rules

When generating semantic v4 JSON, the AI should follow these rules:

1. Output only the semantic v4 shape: `schemaVersion`, `document`, `devices`, `view`, and optional `extensions`.
2. Do not output legacy fields such as `components`, `ports`, `nodes`, `wires`, `signals`, or `signalId`.
3. Use real devices or meaningful subcircuits. Do not invent fake containers, bridge boxes, routing helpers, or placeholder modules unless the user explicitly asks for an abstract block diagram.
4. Treat every shared terminal `label` as a real electrical connection. If a terminal is not intentionally connected, keep its `label` device-specific such as `INPUT_1_U1`.
5. For passive parts such as resistors, capacitors, inductors, jumpers, and switches, both terminals must map to real labels. Do not leave floating components with meaningless endpoints.
6. Include explicit power and ground connectivity whenever the circuit meaning depends on it.
7. Use `properties` for structured data such as part number, electrical value, tolerance, package, voltage, or frequency. If an exact value is unknown, omit it or mark the uncertainty in `description` rather than fabricating precision.
8. Keep IDs globally unique and stable, preferably with readable prefixes such as `device.mcu`, `device.r1`, `terminal.mcu.swdio`, or `terminal.r1.a`.
9. Use `view.devices` to produce a readable layout: keep related devices near each other, prefer left-to-right signal flow, leave generous spacing, and keep enough whitespace that device names and terminal labels never crowd each other. As a rule, example layouts should look loose rather than compact.
10. Use `view.networkLines` for frequent shared rails such as `VCC`, `GND`, `3V3`, or `5V`. These lines are independent semantic view entities, not device-attached stubs.
11. Place independent network lines where they clarify the structure, typically above or below the related device cluster, and keep enough room between the line and the devices that the hierarchy remains obvious.
12. Return plain JSON without comments, markdown wrappers, or explanatory prose when the task is to generate a document.

## 10. Example Files

The repository includes multiple saveable semantic v4 examples intended for AI prompting and regression checks:

- `testJson/semantic-v4-demo.json`: minimal label-based I2C example
- `testJson/butterworth-4th-order-lowpass.json`: analog multi-stage filter with passives, active stages, power rails, and rotated view metadata
- `testJson/ripple-carry-adder-4bit.json`: digital arithmetic with repeated adder slices, carry-chain labels, and multi-bit I/O organization
- `testJson/stm32f103c8t6-minimum-system.json`: MCU minimum system board with regulator, reset, clock, SWD, and UART headers

## 11. Interaction Model

The editor derives behavior directly from semantic data:

### 11.1 Terminal color

- terminals with the same `label` share the same color group
- different non-empty labels must not reuse the same network color within one document
- render network colors as hexadecimal color codes
- avoid `#000000`, `#FFFFFF`, and the passive-terminal gray family when assigning network colors
- prefer large visual separation between different network colors instead of nearby hues
- common labels such as `SCL`, `SDA`, `VCC`, and `GND` may use stable preferred colors if uniqueness is still preserved
- passive terminals should use a gray border, ground terminals a black border, power-input terminals a red border, and bidirectional terminals a black inner ring plus white outer ring

### 11.2 Click device

When the user clicks a device:

- devices feeding its inputs are highlighted as upstream
- devices driven by its outputs are highlighted as downstream
- upstream highlighting reads as red
- downstream highlighting reads as green

### 11.3 Double click device

When the user double-clicks a device:

- the selected device becomes the anchor
- related devices are repacked with explicit spacing so they do not overlap
- related devices may auto-rotate so their relevant terminals face toward the anchor
- upstream related devices move toward the left side
- downstream related devices move toward the right side
- peer devices are arranged in ordered rows with gaps instead of stacking chaotically
- the camera auto-fits the focused set with a clamped zoom range instead of zooming without limit
- labels represented by independent network lines may be folded locally so common rails do not dominate normal device focus
- this animation is derived from shared labels and terminal directions, not wire geometry

### 11.4 Focus independent network line

When the user clicks an independent network line:

- the editor uses that line's `label` as the focus target
- every device exposing that same label can be gathered into a network-focused layout
- devices may auto-rotate so the relevant terminals face the shared label rail
- this is especially useful for common nets such as `VCC`, `GND`, and `3V3`

## 12. Example JSON

```json
{
  "schemaVersion": "4.0.0",
  "document": {
    "id": "doc.i2c-demo",
    "title": "I2C Sensor Hub",
    "source": "ai",
    "language": "zh-CN"
  },
  "devices": [
    {
      "id": "device.mcu",
      "name": "MCU",
      "kind": "controller",
      "reference": "U1",
      "terminals": [
        {
          "id": "terminal.mcu.vcc",
          "name": "POWER_IN_1_U1",
          "label": "VCC",
          "direction": "power-in",
          "side": "left",
          "order": 0
        },
        {
          "id": "terminal.mcu.gnd",
          "name": "GROUND_1_U1",
          "label": "GND",
          "direction": "ground",
          "side": "left",
          "order": 1
        },
        {
          "id": "terminal.mcu.scl",
          "name": "BIDIRECTIONAL_1_U1",
          "label": "SCL",
          "direction": "bidirectional",
          "side": "right",
          "order": 0
        },
        {
          "id": "terminal.mcu.sda",
          "name": "BIDIRECTIONAL_2_U1",
          "label": "SDA",
          "direction": "bidirectional",
          "side": "right",
          "order": 1
        }
      ]
    },
    {
      "id": "device.sensor",
      "name": "Temperature Sensor",
      "kind": "sensor",
      "reference": "U2",
      "terminals": [
        {
          "id": "terminal.sensor.vcc",
          "name": "POWER_IN_1_U2",
          "label": "VCC",
          "direction": "power-in",
          "side": "left",
          "order": 0
        },
        {
          "id": "terminal.sensor.gnd",
          "name": "GROUND_1_U2",
          "label": "GND",
          "direction": "ground",
          "side": "left",
          "order": 1
        },
        {
          "id": "terminal.sensor.scl",
          "name": "INPUT_1_U2",
          "label": "SCL",
          "direction": "input",
          "side": "right",
          "order": 0
        },
        {
          "id": "terminal.sensor.sda",
          "name": "BIDIRECTIONAL_1_U2",
          "label": "SDA",
          "direction": "bidirectional",
          "side": "right",
          "order": 1
        }
      ]
    }
  ],
  "view": {
    "canvas": {
      "units": "px",
      "grid": {
        "enabled": true,
        "size": 36,
        "majorEvery": 5
      },
      "background": "grid"
    },
    "devices": {
      "device.mcu": {
        "position": { "x": 220, "y": 240 },
        "size": { "width": 240, "height": 150 },
        "shape": "rectangle"
      },
      "device.sensor": {
        "position": { "x": 920, "y": 280 },
        "size": { "width": 220, "height": 132 },
        "rotationDeg": 90,
        "shape": "triangle"
      }
    },
    "networkLines": {
      "network.vcc": {
        "label": "VCC",
        "position": { "x": 580, "y": 100 },
        "length": 900,
        "orientation": "horizontal"
      },
      "network.gnd": {
        "label": "GND",
        "position": { "x": 580, "y": 520 },
        "length": 900,
        "orientation": "horizontal"
      }
    },
    "focus": {
      "defaultDeviceId": "device.mcu",
      "preferredDirection": "left-to-right"
    }
  }
}
```

## 13. Migration Notes

Documents based on legacy `components / ports / nodes / wires`, or on intermediate `signals + signalId` modeling, are not the canonical model anymore.

Any future migration logic should translate old formats into:

- `devices`
- nested `terminals`
- terminal `label` groups
- `view.devices`
- optional `view.networkLines`

New documents should be generated directly in semantic v4 form.
