import { describe, expect, it } from 'vitest'

declare const process: { env: Record<string, string | undefined> }
declare function require(moduleName: string): unknown

const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string }
import { runConfiguredAgentProvider } from './agentProviderClient'
import { createEmptyBlueprintWorkspace } from './blueprintWorkspace'
import { hashDocument } from './documentHash'
import { useBlueprintStore } from '../store/blueprintStore'
import type { DocumentFile } from '../types/document'
import type { AgentProviderPublicConfig } from '../types/settings'

const RUN_SMOKE = process.env.EASYANALYSE_RUN_DEEPSEEK_SMOKE === '1'
const SECRET_PATH = '/home/ubuntu/.config/EasyAnalyse/secrets/deepseek_api_key'

const deepseekProvider: AgentProviderPublicConfig = {
  id: 'deepseek-smoke',
  name: 'DeepSeek Smoke',
  kind: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  models: ['deepseek-chat'],
  defaultModel: 'deepseek-chat',
  apiKeyRef: 'secret-ref:deepseek-smoke-local-file',
}

const baseDocument: DocumentFile = {
  schemaVersion: '4.0.0',
  document: {
    id: 'smoke-base',
    title: 'Base divider',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
  },
  devices: [
    {
      id: 'r1',
      name: 'R1',
      kind: 'resistor',
      reference: 'R1',
      terminals: [
        { id: 'r1-a', name: 'A', label: 'VIN', direction: 'input' },
        { id: 'r1-b', name: 'B', label: 'VOUT', direction: 'output' },
      ],
    },
    {
      id: 'r2',
      name: 'R2',
      kind: 'resistor',
      reference: 'R2',
      terminals: [
        { id: 'r2-a', name: 'A', label: 'VOUT', direction: 'input' },
        { id: 'r2-b', name: 'B', label: 'GND', direction: 'output' },
      ],
    },
  ],
  view: {
    canvas: { units: 'px', grid: { enabled: true, size: 16 } },
    devices: {
      r1: { position: { x: 100, y: 100 }, shape: 'rectangle' },
      r2: { position: { x: 100, y: 260 }, shape: 'rectangle' },
    },
    networkLines: {},
  },
}

const maybeDescribe = RUN_SMOKE ? describe : describe.skip

maybeDescribe('DeepSeek real provider smoke', () => {
  it('generates and modifies EasyAnalyse blueprint candidates through the product provider client', async () => {
    const apiKey = readFileSync(SECRET_PATH, 'utf8').trim()
    expect(apiKey.length).toBeGreaterThan(0)
    await useBlueprintStore.getState().loadForMainDocument('/tmp/deepseek-smoke.easyanalyse.json', baseDocument)

    const generate = await runConfiguredAgentProvider({
      provider: deepseekProvider,
      modelId: 'deepseek-chat',
      apiKey,
      prompt: 'Create one complete semantic v4 blueprint for a simple LED current limiting circuit powered from VIN with GND. Return ONLY an AgentResponse JSON object. Required top-level keys: schemaVersion, semanticVersion, kind, summary, blueprints. Required literal values: schemaVersion="agent-response-v1", semanticVersion="easyanalyse-semantic-v4", kind="blueprints". The blueprints value MUST be an array with one candidate object, never an object and never a singular blueprint key. Candidate required keys: title, summary, rationale, tradeoffs, document, issues. The document must include at least a resistor device and an LED device, with terminal labels VIN, LED_OUT, and GND. Use schemaVersion "4.0.0" inside document and view.canvas.units "px".',
      currentDocument: baseDocument,
      includeDocumentContext: false,
      requestId: 'deepseek-smoke-generate',
      timeoutMs: 90_000,
      fetchImpl: fetch,
    })
    expect(generate.response.kind).toBe('blueprints')
    if (generate.response.kind !== 'blueprints') return
    expect(generate.response.blueprints.length).toBeGreaterThan(0)
    expect(generate.response.blueprints[0]!.document.devices.length).toBeGreaterThan(0)

    const modify = await runConfiguredAgentProvider({
      provider: deepseekProvider,
      modelId: 'deepseek-chat',
      apiKey,
      prompt: 'Modify the current document by adding an output test point device connected to VOUT. Return one complete blueprint candidate.',
      currentDocument: baseDocument,
      includeDocumentContext: true,
      requestId: 'deepseek-smoke-modify',
      timeoutMs: 90_000,
      fetchImpl: fetch,
    })
    expect(modify.response.kind).toBe('blueprints')
    if (modify.response.kind !== 'blueprints') return
    expect(modify.response.blueprints.length).toBeGreaterThan(0)
    expect(modify.response.blueprints[0]!.document.devices.length).toBeGreaterThan(baseDocument.devices.length)

    const mainHash = await hashDocument(baseDocument)
    useBlueprintStore.setState({
      workspace: createEmptyBlueprintWorkspace({
        mainDocument: { documentId: baseDocument.document.id, path: '/tmp/deepseek-smoke.easyanalyse.json', hash: mainHash },
      }),
    })
    const inserted = await useBlueprintStore.getState().addAgentBlueprintCandidates(
      [...generate.response.blueprints, ...modify.response.blueprints],
      { mainDocument: baseDocument, filePath: '/tmp/deepseek-smoke.easyanalyse.json', issues: [...generate.issues, ...modify.issues] },
    )
    expect(inserted.length).toBeGreaterThanOrEqual(2)
  }, 180_000)
})
