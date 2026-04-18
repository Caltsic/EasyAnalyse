import { describe, expect, it } from 'vitest'
import type { DocumentFile } from '../types/document'
import { deriveCircuitInsights } from './circuitDescription'
import { normalizeDocumentLocal } from './document'
import { deriveFocusLayout } from './focusLayout'

function buildInsights(document: DocumentFile) {
  return deriveCircuitInsights(normalizeDocumentLocal(document))
}

describe('focusLayout', () => {
  it('keeps focus results on the left and right only for an active anchor', () => {
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
              name: 'PASSIVE_1_R2',
              label: 'NODE_OUT',
              direction: 'passive',
              logicalDirection: 'output',
              side: 'left',
              order: 0,
            },
            {
              id: 'terminal.feedback.in',
              name: 'PASSIVE_2_R2',
              label: 'NODE_IN',
              direction: 'passive',
              logicalDirection: 'input',
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
    expect(states.get('device.source')!.center.x).toBeLessThan(anchorX)
    expect(states.get('device.feedback')!.center.x).toBeGreaterThan(anchorX)
    expect(states.get('device.sink')!.center.x).toBeGreaterThan(anchorX)
    expect(states.has('device.same')).toBe(false)
    expect(
      [...states.entries()]
        .filter(([deviceId]) => deviceId !== 'device.anchor')
        .every(([, placement]) => placement.center.x !== anchorX),
    ).toBe(true)
  })

  it('uses logicalDirection to focus a passive anchor without losing flexible neighbors', () => {
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
              name: 'PASSIVE_1_R1',
              label: 'VIN',
              direction: 'passive',
              logicalDirection: 'input',
              side: 'left',
              order: 0,
            },
            {
              id: 'terminal.anchor.b',
              name: 'PASSIVE_2_R1',
              label: 'DIV_OUT',
              direction: 'passive',
              logicalDirection: 'output',
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
              name: 'PASSIVE_1_R2',
              label: 'DIV_OUT',
              direction: 'passive',
              logicalDirection: 'input',
              side: 'left',
              order: 0,
            },
            {
              id: 'terminal.lower.b',
              name: 'PASSIVE_2_R2',
              label: 'GND',
              direction: 'passive',
              logicalDirection: 'output',
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
})
