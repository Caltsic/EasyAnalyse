import { describe, expect, it } from 'vitest'
import type { DocumentFile } from '../types/document'
import { deriveCircuitInsights } from './circuitDescription'
import { normalizeDocumentLocal } from './document'
import { deriveFocusLayout } from './focusLayout'

function buildInsights(document: DocumentFile) {
  return deriveCircuitInsights(normalizeDocumentLocal(document))
}

describe('focusLayout', () => {
  it('keeps upstream and downstream neighbors on the sides while placing feedback devices below the anchor', () => {
    const insights = buildInsights({
      schemaVersion: '4.0.0',
      document: {
        id: 'doc.active-focus',
        title: 'Active Focus',
      },
      devices: [
        {
          id: 'device.source',
          name: 'Signal Source',
          kind: 'connector',
          reference: 'J1',
          terminals: [
            {
              id: 'terminal.source.out',
              name: 'OUTPUT_1_J1',
              label: 'NODE_IN',
              direction: 'output',
              side: 'right',
              order: 0,
            },
          ],
        },
        {
          id: 'device.same',
          name: 'Same-Level Input',
          kind: 'connector',
          reference: 'J2',
          terminals: [
            {
              id: 'terminal.same.in',
              name: 'INPUT_1_J2',
              label: 'NODE_IN',
              direction: 'input',
              side: 'left',
              order: 0,
            },
          ],
        },
        {
          id: 'device.anchor',
          name: 'MFB Stage',
          kind: 'op-amp',
          reference: 'U1A',
          terminals: [
            {
              id: 'terminal.anchor.in',
              name: 'INPUT_1_U1A',
              label: 'NODE_IN',
              direction: 'input',
              side: 'left',
              order: 0,
            },
            {
              id: 'terminal.anchor.out',
              name: 'OUTPUT_1_U1A',
              label: 'NODE_OUT',
              direction: 'output',
              side: 'right',
              order: 0,
            },
          ],
        },
        {
          id: 'device.feedback',
          name: 'Feedback Resistor',
          kind: 'resistor',
          reference: 'R2',
          properties: {
            value: '15.8k',
          },
          terminals: [
            {
              id: 'terminal.feedback.out',
              name: 'INPUT_1_R2',
              label: 'NODE_OUT',
              direction: 'input',
              side: 'left',
              order: 0,
            },
            {
              id: 'terminal.feedback.in',
              name: 'OUTPUT_1_R2',
              label: 'NODE_IN',
              direction: 'output',
              side: 'right',
              order: 1,
            },
          ],
        },
        {
          id: 'device.sink',
          name: 'Output Sink',
          kind: 'connector',
          reference: 'J3',
          terminals: [
            {
              id: 'terminal.sink.in',
              name: 'INPUT_1_J3',
              label: 'NODE_OUT',
              direction: 'input',
              side: 'left',
              order: 0,
            },
          ],
        },
      ],
      view: {
        canvas: {
          units: 'px',
        },
        devices: {
          'device.source': {
            position: { x: 120, y: 220 },
            size: { width: 160, height: 100 },
            shape: 'circle',
          },
          'device.same': {
            position: { x: 120, y: 380 },
            size: { width: 160, height: 100 },
            shape: 'circle',
          },
          'device.anchor': {
            position: { x: 480, y: 300 },
            size: { width: 240, height: 180 },
            shape: 'triangle',
          },
          'device.feedback': {
            position: { x: 840, y: 220 },
            size: { width: 180, height: 96 },
            shape: 'rectangle',
          },
          'device.sink': {
            position: { x: 840, y: 380 },
            size: { width: 160, height: 100 },
            shape: 'circle',
          },
        },
        networkLines: {},
        focus: {
          defaultDeviceId: 'device.anchor',
          preferredDirection: 'left-to-right',
        },
      },
    })

    const layout = deriveFocusLayout(insights, { type: 'device', id: 'device.anchor' })
    expect(layout).not.toBeNull()

    const states = layout!.states
    expect([...states.keys()].sort()).toEqual(
      ['device.anchor', 'device.feedback', 'device.sink', 'device.source'].sort(),
    )

    const anchorX = states.get('device.anchor')!.center.x
    const anchorY = states.get('device.anchor')!.center.y
    expect(states.get('device.source')!.center.x).toBeLessThan(anchorX)
    expect(states.get('device.sink')!.center.x).toBeGreaterThan(anchorX)
    expect(states.get('device.feedback')!.center.y).toBeGreaterThan(anchorY)
    expect(states.has('device.same')).toBe(false)
  })

  it('uses input/output terminal roles to focus a resistor anchor without losing neighbors', () => {
    const insights = buildInsights({
      schemaVersion: '4.0.0',
      document: {
        id: 'doc.passive-focus',
        title: 'Passive Focus',
      },
      devices: [
        {
          id: 'device.source',
          name: 'Input Source',
          kind: 'connector',
          reference: 'J1',
          terminals: [
            {
              id: 'terminal.source.vin',
              name: 'OUTPUT_1_J1',
              label: 'VIN',
              direction: 'output',
              side: 'right',
              order: 0,
            },
          ],
        },
        {
          id: 'device.anchor',
          name: 'Series Resistor',
          kind: 'resistor',
          reference: 'R1',
          properties: {
            value: '10k',
          },
          terminals: [
            {
              id: 'terminal.anchor.a',
              name: 'INPUT_1_R1',
              label: 'VIN',
              direction: 'input',
              side: 'left',
              order: 0,
            },
            {
              id: 'terminal.anchor.b',
              name: 'OUTPUT_1_R1',
              label: 'DIV_OUT',
              direction: 'output',
              side: 'right',
              order: 1,
            },
          ],
        },
        {
          id: 'device.lower',
          name: 'Lower Divider',
          kind: 'resistor',
          reference: 'R2',
          properties: {
            value: '33k',
          },
          terminals: [
            {
              id: 'terminal.lower.a',
              name: 'INPUT_1_R2',
              label: 'DIV_OUT',
              direction: 'input',
              side: 'left',
              order: 0,
            },
            {
              id: 'terminal.lower.b',
              name: 'OUTPUT_1_R2',
              label: 'GND',
              direction: 'output',
              side: 'right',
              order: 1,
            },
          ],
        },
        {
          id: 'device.adc',
          name: 'ADC Input',
          kind: 'connector',
          reference: 'J2',
          terminals: [
            {
              id: 'terminal.adc.in',
              name: 'INPUT_1_J2',
              label: 'DIV_OUT',
              direction: 'input',
              side: 'left',
              order: 0,
            },
          ],
        },
      ],
      view: {
        canvas: {
          units: 'px',
        },
        devices: {
          'device.source': {
            position: { x: 120, y: 300 },
            size: { width: 160, height: 100 },
            shape: 'circle',
          },
          'device.anchor': {
            position: { x: 460, y: 300 },
            size: { width: 180, height: 96 },
            shape: 'rectangle',
          },
          'device.lower': {
            position: { x: 800, y: 200 },
            size: { width: 180, height: 96 },
            shape: 'rectangle',
          },
          'device.adc': {
            position: { x: 800, y: 380 },
            size: { width: 160, height: 100 },
            shape: 'circle',
          },
        },
        networkLines: {},
        focus: {
          defaultDeviceId: 'device.anchor',
          preferredDirection: 'left-to-right',
        },
      },
    })

    const layout = deriveFocusLayout(insights, { type: 'device', id: 'device.anchor' })
    expect(layout).not.toBeNull()

    const states = layout!.states
    const anchorX = states.get('device.anchor')!.center.x
    expect(states.get('device.source')!.center.x).toBeLessThan(anchorX)
    expect(states.get('device.lower')!.center.x).toBeGreaterThan(anchorX)
    expect(states.get('device.adc')!.center.x).toBeGreaterThan(anchorX)
  })

  it('places shared feedback components in a row below the focused butterworth stage', () => {
    const insights = buildInsights({
      schemaVersion: '4.0.0',
      document: {
        id: 'doc.butterworth-focus',
        title: 'Butterworth Focus',
      },
      devices: [
        {
          id: 'device.input',
          name: 'Signal Input',
          kind: 'connector',
          reference: 'J1',
          terminals: [
            {
              id: 'terminal.input.vin',
              name: 'OUTPUT_1_J1',
              label: 'VIN',
              direction: 'output',
              side: 'right',
              order: 0,
            },
          ],
        },
        {
          id: 'device.stage1',
          name: 'MFB Filter Stage 1',
          kind: 'op-amp',
          reference: 'U1A',
          terminals: [
            {
              id: 'terminal.stage1.neg',
              name: 'INPUT_1_U1A',
              label: 'STAGE1_NEG',
              direction: 'input',
              side: 'left',
              order: 0,
            },
            {
              id: 'terminal.stage1.out',
              name: 'OUTPUT_1_U1A',
              label: 'STAGE1_OUT',
              direction: 'output',
              side: 'right',
              order: 0,
            },
          ],
        },
        {
          id: 'device.r1',
          name: 'Input Resistor R1',
          kind: 'resistor',
          reference: 'R1',
          terminals: [
            {
              id: 'terminal.r1.a',
              name: 'INPUT_1_R1',
              label: 'VIN',
              direction: 'input',
              side: 'left',
              order: 0,
            },
            {
              id: 'terminal.r1.b',
              name: 'OUTPUT_1_R1',
              label: 'STAGE1_NEG',
              direction: 'output',
              side: 'right',
              order: 1,
            },
          ],
        },
        {
          id: 'device.r2',
          name: 'Feedback Resistor R2',
          kind: 'resistor',
          reference: 'R2',
          terminals: [
            {
              id: 'terminal.r2.a',
              name: 'INPUT_1_R2',
              label: 'STAGE1_OUT',
              direction: 'input',
              side: 'left',
              order: 0,
            },
            {
              id: 'terminal.r2.b',
              name: 'OUTPUT_1_R2',
              label: 'STAGE1_NEG',
              direction: 'output',
              side: 'right',
              order: 1,
            },
          ],
        },
        {
          id: 'device.c1',
          name: 'Feedback Capacitor C1',
          kind: 'capacitor',
          reference: 'C1',
          terminals: [
            {
              id: 'terminal.c1.a',
              name: 'INPUT_1_C1',
              label: 'STAGE1_OUT',
              direction: 'input',
              side: 'left',
              order: 0,
            },
            {
              id: 'terminal.c1.b',
              name: 'OUTPUT_1_C1',
              label: 'STAGE1_NEG',
              direction: 'output',
              side: 'right',
              order: 1,
            },
          ],
        },
        {
          id: 'device.output',
          name: 'Stage Output',
          kind: 'connector',
          reference: 'J2',
          terminals: [
            {
              id: 'terminal.output.in',
              name: 'INPUT_1_J2',
              label: 'STAGE1_OUT',
              direction: 'input',
              side: 'left',
              order: 0,
            },
          ],
        },
      ],
      view: {
        canvas: {
          units: 'px',
        },
        devices: {
          'device.input': {
            position: { x: 100, y: 240 },
            size: { width: 160, height: 100 },
            shape: 'circle',
          },
          'device.stage1': {
            position: { x: 420, y: 240 },
            size: { width: 240, height: 180 },
            shape: 'triangle',
          },
          'device.r1': {
            position: { x: 120, y: 360 },
            size: { width: 180, height: 96 },
            shape: 'rectangle',
          },
          'device.r2': {
            position: { x: 760, y: 180 },
            size: { width: 180, height: 96 },
            shape: 'rectangle',
          },
          'device.c1': {
            position: { x: 760, y: 320 },
            size: { width: 180, height: 96 },
            shape: 'rectangle',
          },
          'device.output': {
            position: { x: 780, y: 360 },
            size: { width: 160, height: 100 },
            shape: 'circle',
          },
        },
        networkLines: {},
        focus: {
          defaultDeviceId: 'device.stage1',
          preferredDirection: 'left-to-right',
        },
      },
    })

    const layout = deriveFocusLayout(insights, { type: 'device', id: 'device.stage1' })
    expect(layout).not.toBeNull()

    const states = layout!.states
    const anchor = states.get('device.stage1')!
    const feedbackResistor = states.get('device.r2')!
    const feedbackCapacitor = states.get('device.c1')!

    expect(states.get('device.r1')!.center.x).toBeLessThan(anchor.center.x)
    expect(states.get('device.output')!.center.x).toBeGreaterThan(anchor.center.x)
    expect(feedbackResistor.center.y).toBeGreaterThan(anchor.center.y)
    expect(feedbackCapacitor.center.y).toBeGreaterThan(anchor.center.y)
    expect(feedbackResistor.center.y).toBe(feedbackCapacitor.center.y)
    expect(Math.abs(feedbackResistor.center.x - feedbackCapacitor.center.x)).toBeGreaterThan(0)
  })
})
