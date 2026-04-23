# EASYAnalyse Semantic Circuit Exchange

Version: `4.0.0`

This is the only canonical EASYAnalyse exchange format used by the current desktop editor.

The format is intentionally semantic-first:

- no wires
- no junction nodes
- no bend points
- no standalone signal objects
- no topology reconstruction step during editing
- no persisted free terminal coordinates
- no persisted terminal-label coordinates

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
- `properties` can carry structured metadata such as `value`, `voltage`, `outputVoltage`, `nominalVoltage`, `frequency`, `package`, or `partNumber`
- `properties` is intentionally extensible; unknown keys are allowed, but the common keys above have shared meaning across schema, validation, and UI summaries
- `resistor`, `capacitor`, and `inductor` devices must persist a concrete electrical value under `properties.value`
- `crystal`, `oscillator`, and `resonator` devices must persist a concrete clock value under `properties.frequency`
- power-source devices should persist a concrete supply value under `properties.voltage`, `properties.outputVoltage`, or `properties.nominalVoltage` when the connected label is generic such as `VCC` or `VIN`

Common property intent:

- `value`: concrete electrical magnitude such as `10k`, `100nF`, `22uH`
- `voltage`: concrete supply or rail value such as `5V` or `12V`
- `outputVoltage`: regulator or source output rail value
- `nominalVoltage`: nominal operating voltage of a powered device
- `frequency`: timing value such as `8MHz` or `32.768kHz`
- `partNumber`, `package`, `topology`: descriptive metadata for readability and downstream tooling

### 5.1 Canonical Device Templates

The current desktop editor includes built-in schematic symbol templates for common device kinds.
These templates are derived from `devices[*].kind`; they do not introduce any new persisted `shape` values.

If a device matches one of the templates below, the renderer can apply the matching symbol and a default view size automatically.
That means AI output can usually omit `view.devices[deviceId].shape` and `view.devices[deviceId].size` for these parts unless a custom published layout is required.

Recommended canonical `kind` values:

| Device family | Canonical `kind` | Recommended reference prefix | Typical property |
| --- | --- | --- | --- |
| Resistor | `resistor` | `R` | `properties.value` |
| Capacitor | `capacitor` | `C` | `properties.value` |
| Electrolytic capacitor | `electrolytic-capacitor` | `C` | `properties.value` |
| Inductor | `inductor` | `L` | `properties.value` |
| Ferrite bead | `ferrite-bead` | `FB` | `properties.value` |
| LED | `led` | `D` | `properties.partNumber` or `properties.value` |
| General diode | `diode` | `D` | `properties.partNumber` |
| Flyback diode | `flyback-diode` | `D` | `properties.partNumber` |
| Rectifier diode | `rectifier-diode` | `D` | `properties.partNumber` |
| Zener diode | `zener-diode` | `D` | `properties.voltage` or `properties.partNumber` |
| TVS diode | `tvs-diode` | `D` | `properties.voltage` or `properties.partNumber` |
| N-channel MOSFET | `nmos` | `Q` | `properties.partNumber` |
| P-channel MOSFET | `pmos` | `Q` | `properties.partNumber` |
| NPN transistor | `npn-transistor` | `Q` | `properties.partNumber` |
| PNP transistor | `pnp-transistor` | `Q` | `properties.partNumber` |
| Switch | `switch` | `SW` | `properties.partNumber` |
| Push button | `push-button` | `SW` | `properties.partNumber` |
| Crystal / resonator | `crystal` | `Y` | `properties.frequency` |
| Operational amplifier | `op-amp` | `U` | `properties.partNumber` |

Template rules:

- prefer the canonical lowercase, hyphenated `kind` values above when they fit
- keep `name` human-readable, for example `Power LED`, `Current Sense Resistor`, or `Gate Pull-up`
- keep physical package data in `properties.package`; it is not the same thing as the editor's built-in schematic symbol template
- do not encode package, polarity, or role by inventing a new `shape`; use `kind`, terminals, and properties instead
- if the document needs a nonstandard visual treatment, use normal `view.devices[*]` overrides without changing the semantic `kind`
- for compatibility, the renderer also recognizes common Chinese aliases such as `电阻`, `电容`, `电解电容`, `电感`, `磁珠`, `发光二极管`, `续流二极管`, `整流二极管`, `开关`, `按键`, `MOS管`, `三极管`, `晶振`, and `运放`; generic `MOS管` defaults to `nmos`, and generic `三极管` defaults to `npn-transistor`

## 6. `terminals`

Terminals are nested under the owning device and are the only place where connectivity semantics are declared.

```json
{
  "id": "terminal.mcu.scl",
  "name": "OUTPUT_1_U1",
  "label": "SCL",
  "direction": "output",
  "description": "I2C clock pin",
  "required": true,
  "side": "right",
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

`direction` is the persisted terminal flow role. The project now stores only two terminal types so every saved terminal must resolve to either sink-like `input` or source-like `output`.

Examples:

- I2C `SCL` and `SDA`: choose `output` on the current signal-driving side and `input` on the receiving side
- UART `TX`: `output` on the transmitter side
- UART `RX`: `input` on the receiver side
- two-terminal passive parts, crystals, ferrite beads, and simple switches should still use explicit `input` / `output` to express the readable left-to-right signal path
- power entry pins and ground pins should usually be `input`; regulated rails and driven nets should usually be `output`

### 6.2 Layout Hints

Optional terminal layout fields:

- `side`: `left`, `right`, `top`, `bottom`, `auto`
- `order`: stable ordering within the same side

These are the only persisted placement hints for a terminal. The current editor keeps terminals bound to the owning device edge; it does not persist arbitrary terminal `x/y` coordinates.

Default side behavior when `side` is omitted:

- `output` -> `right`
- `input` -> `left`

Authoring advice:

- prefer explicit `left`, `right`, `top`, or `bottom` in saved examples when readability matters
- use `order` to keep dense parts stable and deterministic
- treat `auto` as an authoring shortcut, not as a precise published layout contract

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
- `OUTPUT_1_U3`

After that, the user or AI can replace the label with a semantic value such as `SCL`, `SDA`, `TX`, or `GND`.

### 6.5 Terminal and Pin Mapping Convention

When a device uses one of the canonical templates above, the AI should keep terminal naming and placement consistent with the template.
This makes the built-in symbol renderings immediately readable.

Recommended conventions:

- Two-terminal passives and crystals:
  persist left terminal as `direction = input`, right terminal as `direction = output`, and keep `side = left` / `side = right`
- Resistors, inductors, ferrite beads, switches, and crystals:
  prefer explicit readable names such as `INPUT_1_R1` and `OUTPUT_1_R1`, or concise names such as `IN` / `OUT`, `1` / `2`
- Capacitors:
  use `1` / `2` for non-polar parts; for electrolytics prefer `+` and `-` or `POS` and `NEG`
- Diodes and LEDs:
  prefer `A` and `K` or `ANODE` and `CATHODE`
- MOSFETs:
  prefer `G`, `D`, `S`; use `side = left` for gate, `side = top` for drain, `side = bottom` for source
- BJTs:
  prefer `B`, `C`, `E`; use `side = left` for base, `side = top` for collector, `side = bottom` for emitter
- Op-amps:
  prefer `IN-`, `IN+`, and `OUT`; use `side = left` for both inputs with stable `order`, and `side = right` for the output
- Optional op-amp power pins:
  if you include them, prefer `side = top` / `bottom` and keep them clearly named, for example `V+`, `V-`, `VCC`, or `VEE`

If published readability matters, set `side` and `order` explicitly instead of relying only on `direction`.

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
    "network.3v3": {
      "label": "3V3",
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

Notes:

- `position` is the top-left of the device view bounds in world coordinates
- `size` is a preferred device bounding box for layout readability
- the renderer may derive a built-in schematic symbol from `device.kind` while still keeping persisted `shape` limited to `rectangle`, `circle`, or `triangle`
- the current renderer may enlarge the effective display box at runtime to avoid terminal crowding; this does not change circuit truth
- terminal labels, label-avoidance, and leader lines are derived presentation behavior and are not persisted in the exchange document

### 7.3 `view.networkLines[networkLineId]`

Optional independent linear-network metadata:

- `label`: the shared terminal label represented by this independent network line
- `position`: the line center on the canvas
- `length`
- `orientation`: `horizontal`, `vertical`

Use `view.networkLines` for independent linear networks such as `3V3`, `5V`, `GND`, or other high-frequency rails that would otherwise flood device-focus views.

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

Validation is also a save gate. The current desktop app writes the file only when both of these are true:

- `schemaValid = true`
- `semanticValid = true`

If either check fails, save is rejected and the file is not written.

Implementation note:

- the current backend computes `semanticValid` from all `semantic.*` issues, not only error-severity ones
- that means warning-severity semantic issues still block save today
- document producers should therefore aim for zero semantic issues, not only zero semantic errors

### 8.1 What the implementation normalizes before save

The saved file is normalized output, not a byte-for-byte echo of the incoming JSON.

Current normalization behavior includes at least:

- `schemaVersion` is forced to `4.0.0`
- `document.updatedAt` is refreshed on normalization
- required strings such as `document.title`, `device.name`, and `device.kind` are trimmed and repaired when possible
- optional strings such as descriptions, labels, references, and device properties are trimmed; empty strings are removed
- `document.tags` and `device.tags` are deduplicated and sorted
- terminals are sorted by `order`, then `name`, then `id`
- missing terminal side defaults are derived directly from `direction`
- `view.canvas.units` is forced to `px`
- `view.canvas.background` is forced to `grid`
- `view.canvas.grid.majorEvery` is clamped to at least `2`
- `view.devices[*].rotationDeg` is normalized into `[0, 360)`
- `view.networkLines[*].orientation` defaults to `horizontal`
- `view.networkLines[*].length` is clamped into the supported range

### 8.2 Semantic checks currently enforced

Semantic validation currently checks at least:

1. duplicate IDs across document, devices, and terminals
2. missing device references inside `view.devices`
3. missing default focus device references
4. required terminals with no assigned label
5. value-bearing devices without a concrete electrical value
6. timing devices without a concrete frequency
7. power labels such as `VCC` that do not resolve to a concrete voltage through either the label text itself or a sourcing device property
8. independent network lines with empty labels
9. independent network lines whose labels are currently unused by all terminals

Current warning-severity semantic issues include cases such as:

- devices with no terminals

Under the current save gate, these warnings still make `semanticValid = false`.

## 9. AI Generation Rules

When generating semantic v4 JSON, the AI should follow these rules:

1. Output only the semantic v4 shape: `schemaVersion`, `document`, `devices`, `view`, and optional `extensions`.
2. Do not output legacy fields such as `components`, `ports`, `nodes`, `wires`, `signals`, or `signalId`.
3. Use real devices or meaningful subcircuits. Do not invent fake containers, bridge boxes, routing helpers, or placeholder modules unless the user explicitly asks for an abstract block diagram.
4. Treat every shared terminal `label` as a real electrical connection. If a terminal is not intentionally connected, keep its `label` device-specific such as `INPUT_1_U1`.
5. For passive parts such as resistors, capacitors, inductors, jumpers, and switches, both terminals must map to real labels. Do not leave floating components with meaningless endpoints.
6. Include explicit power and ground connectivity whenever the circuit meaning depends on it.
7. For passive parts and timing parts, fill the concrete electrical value before claiming the circuit is meaningful. A resistor or capacitor without a value is not a complete circuit description.
8. For generic power labels such as `VCC`, `VDD`, or `VIN`, include a concrete voltage either in the label itself such as `3V3` or in the sourcing device `properties`.
9. When protocol ownership or control flow matters, encode it directly in `direction`. For example, host-side I2C and UART control pins should usually be `output`, while the peripheral-side counterparts should be `input`.
10. Keep IDs globally unique and stable, preferably with readable prefixes such as `device.mcu`, `device.r1`, `terminal.mcu.swdio`, or `terminal.r1.a`.
11. Use `view.devices` to produce a readable layout: keep related devices near each other, prefer left-to-right signal flow, leave generous spacing, and keep enough whitespace that device names and terminal labels never crowd each other. As a rule, example layouts should look loose rather than compact.
12. Use explicit terminal `side` and `order` when you need stable published layouts. Do not invent free terminal coordinates.
13. Use `view.networkLines` for frequent shared rails such as `3V3`, `5V`, or `GND`. These lines are independent semantic view entities, not device-attached stubs.
14. Place independent network lines where they clarify the structure, typically above or below the related device cluster, and keep enough room between the line and the devices that the hierarchy remains obvious.
15. Return plain JSON without comments, markdown wrappers, or explanatory prose when the task is to generate a document.

### 9.1 Prefer Existing Templates

When generating a common device, prefer an existing canonical template before inventing a new `kind`.

Current expectations:

- if a device matches one of the canonical templates in section `5.1`, use that `kind`
- do not create near-duplicate kinds such as `indicator-light`, `power-rectifier`, or `nch-mos`; use `led`, `rectifier-diode`, and `nmos`
- for template-backed devices, omit `view.devices[*].shape` and `view.devices[*].size` unless you have a specific readability reason to override the built-in defaults
- when you do override `view.devices[*].size`, stay close to the template's natural aspect ratio; do not stretch a diode or resistor into a module-sized block
- keep template-compatible terminal naming, `side`, and `order` so the symbol stays readable without manual repair
- keep electrical meaning in `terminals[*].label`, `direction`, and properties; do not try to encode connectivity through visual tricks

## 10. Example Files

The repository includes multiple saveable semantic v4 examples intended for AI prompting and regression checks:

- `testJson/semantic-v4-demo.json`: minimal label-based I2C example
- `testJson/butterworth-4th-order-lowpass.json`: analog multi-stage filter with explicit input/output terminals, active stages, power rails, and rotated view metadata
- `testJson/rc-low-pass-filter.json`: simple RC low-pass example with explicit resistor and capacitor values
- `testJson/resistor-voltage-divider.json`: minimal divider with explicit source voltage
- `testJson/lm358-noninverting-amplifier.json`: operational-amplifier example with explicit power and signal labels
- `testJson/ripple-carry-adder-4bit.json`: digital arithmetic with repeated adder slices, carry-chain labels, and multi-bit I/O organization
- `testJson/stm32f103c8t6-minimum-system.json`: MCU minimum system board with regulator, reset, clock, SWD, and UART headers
- `testJson/stm32f103-pwm-motor-driver-18v.json`: STM32F103 PWM low-side motor driver with explicit 18V power, 3.3V regulation, MOSFET gate network, and flyback protection

## 11. Interaction Model

The editor derives behavior directly from semantic data:

### 11.1 Terminal color

- terminals with the same `label` share the same color group
- different non-empty labels must not reuse the same network color within one document
- render network colors as hexadecimal color codes
- avoid `#000000` and `#FFFFFF` when assigning network fill colors
- prefer large visual separation between different network colors instead of nearby hues
- common labels such as `SCL`, `SDA`, `3V3`, and `GND` may use stable preferred colors if uniqueness is still preserved
- input terminals should use a white border and output terminals should use a black border
- terminal labels themselves are derived overlay text, not persisted view coordinates
- the renderer may avoid label overlap, add leader lines, and keep labels above device bodies and network lines

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
- only opposite-flow or flexible neighbors are included in device focus
- same-direction same-level devices are suppressed instead of being shown as peers
- if one device touches both an upstream anchor label and a downstream anchor label, it prefers the downstream/right bucket
- device focus no longer uses a middle peer row; the focused neighborhood is left and right only
- the camera auto-fits the focused set with a clamped zoom range instead of zooming without limit
- labels represented by independent network lines may be folded locally so common rails do not dominate normal device focus
- this animation is derived from shared labels and terminal directions, not wire geometry

### 11.4 Focus independent network line

When the user clicks an independent network line:

- the editor uses that line's `label` as the focus target
- every device exposing that same label can be gathered into a network-focused layout
- devices may auto-rotate so the relevant terminals face the shared label rail
- this is especially useful for common nets such as `3V3`, `5V`, and `GND`

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
          "name": "INPUT_1_U1",
          "label": "3V3",
          "direction": "input",
          "side": "left",
          "order": 0
        },
        {
          "id": "terminal.mcu.gnd",
          "name": "INPUT_2_U1",
          "label": "GND",
          "direction": "input",
          "side": "left",
          "order": 1
        },
        {
          "id": "terminal.mcu.scl",
          "name": "OUTPUT_1_U1",
          "label": "SCL",
          "direction": "output",
          "side": "right",
          "order": 0
        },
        {
          "id": "terminal.mcu.sda",
          "name": "OUTPUT_2_U1",
          "label": "SDA",
          "direction": "output",
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
          "name": "INPUT_1_U2",
          "label": "3V3",
          "direction": "input",
          "side": "left",
          "order": 0
        },
        {
          "id": "terminal.sensor.gnd",
          "name": "INPUT_2_U2",
          "label": "GND",
          "direction": "input",
          "side": "left",
          "order": 1
        },
        {
          "id": "terminal.sensor.scl",
          "name": "INPUT_3_U2",
          "label": "SCL",
          "direction": "input",
          "side": "right",
          "order": 0
        },
        {
          "id": "terminal.sensor.sda",
          "name": "INPUT_4_U2",
          "label": "SDA",
          "direction": "input",
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
      "network.3v3": {
        "label": "3V3",
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
