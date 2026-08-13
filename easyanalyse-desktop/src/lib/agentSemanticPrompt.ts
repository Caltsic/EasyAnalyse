export const EASYANALYSE_SEMANTIC_V4_CONTRACT = [
  'Canonical EasyAnalyse semantic v4 contract:',
  '- The persisted circuit format is semantic-first. It has devices, terminals, terminal labels, and view metadata. It never has wires, nodes, junctions, bend points, free terminal coordinates, terminal-label coordinates, signal objects, signalId, component wrappers, or port wrappers.',
  '- Top-level DocumentFile shape is exactly { schemaVersion:"4.0.0", document:{...}, devices:[...], view:{...}, extensions? }. Required top-level fields are schemaVersion, document, devices, view.',
  '- document metadata needs a stable non-empty id and title. source should be human, ai, mixed, or imported when present. Use language "zh-CN" when responding to Chinese circuit requests unless the user asks otherwise.',
  '- Each device is one hardware block. Device id values are globally unique. Each device needs id, name, kind, terminals[]. reference is recommended. properties may contain value, voltage, outputVoltage, nominalVoltage, frequency, partNumber, package, topology.',
  '- Resistors, capacitors, inductors, ferrite beads, and other value-bearing passives must carry properties.value. Crystals, oscillators, and resonators must carry properties.frequency. Supply/regulator/source devices should carry voltage/outputVoltage/nominalVoltage.',
  '- Prefer canonical kinds: resistor, capacitor, electrolytic-capacitor, inductor, ferrite-bead, led, diode, flyback-diode, rectifier-diode, zener-diode, tvs-diode, nmos, pmos, npn-transistor, pnp-transistor, switch, push-button, crystal, oscillator, resonator, op-amp, controller, regulator, power-source, ground, connector, sensor, driver, transformer, relay, fuse, test-point.',
  '- Terminal id values are globally unique. Every terminal needs id, name, direction, and usually label. Allowed direction values are only input and output. Optional side is left/right/top/bottom/auto; optional order keeps side order deterministic. Optional pin carries physical pin number/name/bank metadata.',
  '- Connectivity is defined only by exact terminal.label equality. If VIN appears on three terminals, those three terminals are connected. view.networkLines never create connectivity.',
  '- Terminal pins, short terminal stubs, and terminal-label placement are rendered from the device template plus terminal.side and terminal.order. They are not persisted as wire segments or coordinates. Preserve terminal definitions, labels, side, order, role, and pin metadata when modifying a document.',
  '- For two-terminal passive devices, choose a readable signal flow: upstream terminal input, downstream terminal output, return-to-ground terminal output. Power entry pins and ground pins are usually input; regulated or driven rails are usually output.',
  '- view.canvas.units must be "px". view.devices is keyed by device id. view.devices[deviceId].position is the top-left of the rendered device bounds, not its center. view.networkLines is keyed by visual line id.',
  '- Each view.networkLines entry is { label, position:{x,y}, length?, orientation? }. orientation is horizontal or vertical. Its label must match an existing terminal label. A networkLine is an optional visual rail/label summary, never a wire and never the source of connectivity.',
  '- Built-in schematic templates are selected from devices[*].kind. Do not invent persisted shape names to express a package, role, polarity, or symbol variant. Package belongs in properties.package.',
  '- The renderer can enlarge effective device bounds around labels and terminals. Leave clear space between devices and between visual rails and devices.',
].join('\n')

export const EASYANALYSE_LAYOUT_AUTHORING_RULES = [
  'Canonical layout rules:',
  '- Use a wide grid for generated blueprints. A safe default is x=80,380,680,980,1280,1580 and y=96,320,544,768,992. Keep default rectangular devices at least 280 px apart horizontally and 180 px apart vertically.',
  '- For op-amp stages, put input source and bias/filter parts to the left, the op-amp near the middle, feedback parts above or below the op-amp, output/load parts to the right, and supply/ground rails outside the active device row.',
  '- For filters and cascaded amplifiers, use left-to-right stage order. Do not stack many devices at the same x/y. Split dense feedback networks onto separate rows.',
  '- view.networkLines are optional visual rails for labels already used by terminals. Good rail positions are above the top device row, below the bottom device row, or to the outside of the device columns. Do not run a networkLine through a device rectangle. If a clean rail cannot be drawn, omit the networkLine.',
  '- If a tool reports layout.device.overlap, prefer changing only view.devices positions. If it reports layout.network-line.device-overlap, prefer changing only that view.networkLines entry, or remove it if it is not essential. If it reports layout.text.device-overlap, increase spacing around the related terminal/network label or move the nearby device/rail.',
].join('\n')

export const EASYANALYSE_BLUEPRINT_CANDIDATE_CONTRACT = [
  'Blueprint candidate contract:',
  '- A candidate must contain title, summary, rationale, tradeoffs array, one complete semantic-v4 document, and issues array.',
  '- The document must be complete and standalone. For modifications, preserve all unchanged devices, terminals, terminal metadata, and view entries from the current document.',
  '- Candidate issues are human-visible caveats or advisory semantic/layout findings. They are not a substitute for fixing malformed persisted JSON.',
  '- Valid tiny topology example: R1.A label VIN, R1.B label VOUT, C1.A label VOUT, and C1.B label GND represents a VIN-to-VOUT resistor and VOUT-to-GND capacitor. No wire or node array is needed.',
].join('\n')
