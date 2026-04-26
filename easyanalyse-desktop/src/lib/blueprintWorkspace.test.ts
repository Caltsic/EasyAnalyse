import { describe, expect, it } from 'vitest'
import type { DocumentFile } from '../types/document'
import { DOCUMENT_HASH_ALGORITHM, hashDocument } from './documentHash'
import {
  createBlueprintFromDocument,
  createEmptyBlueprintWorkspace,
  deserializeBlueprintWorkspace,
  getBlueprintRuntimeState,
  getBlueprintSidecarPath,
  isBlueprintWorkspaceFile,
  normalizeBlueprintWorkspace,
  serializeBlueprintWorkspace,
} from './blueprintWorkspace'

function createDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'doc-1',
      title: 'Reference circuit',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T01:00:00.000Z',
      tags: ['demo'],
    },
    devices: [
      {
        id: 'r1',
        name: 'R1',
        kind: 'resistor',
        terminals: [
          { id: 'r1-a', name: 'A', label: 'VIN', direction: 'input' },
          { id: 'r1-b', name: 'B', label: 'VOUT', direction: 'output' },
        ],
      },
    ],
    view: {
      canvas: { units: 'px', grid: { enabled: true, size: 16 } },
      devices: { r1: { position: { x: 10, y: 20 }, shape: 'rectangle' } },
    },
    ...overrides,
  }
}

describe('blueprintWorkspace', () => {
  it('creates an explicit empty sidecar wrapper without adding blueprints to the main document', () => {
    const workspace = createEmptyBlueprintWorkspace({
      workspaceId: 'workspace-1',
      now: '2026-04-27T00:00:00.000Z',
      mainDocument: {
        documentId: 'doc-1',
        path: '/tmp/circuit.easyanalyse.json',
        hash: `${DOCUMENT_HASH_ALGORITHM}:abc`,
      },
    })

    expect(workspace).toEqual({
      blueprintWorkspaceVersion: '1.0.0',
      workspaceId: 'workspace-1',
      mainDocument: {
        documentId: 'doc-1',
        path: '/tmp/circuit.easyanalyse.json',
        hash: `${DOCUMENT_HASH_ALGORITHM}:abc`,
        hashAlgorithm: DOCUMENT_HASH_ALGORITHM,
      },
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
      blueprints: [],
    })
    expect('schemaVersion' in workspace).toBe(false)
  })

  it('creates blueprint records from documents and supports all lifecycle and validation states including invalid', async () => {
    const document = createDocument()
    const baseMainDocumentHash = `${DOCUMENT_HASH_ALGORITHM}:base`

    const invalidArchived = await createBlueprintFromDocument({
      id: 'bp-1',
      document,
      title: 'Archived invalid blueprint',
      lifecycleStatus: 'archived',
      validationState: 'invalid',
      source: 'manual_snapshot',
      baseMainDocumentHash,
      now: '2026-04-27T00:00:00.000Z',
      appliedInfo: {
        appliedAt: '2026-04-27T01:00:00.000Z',
        appliedToMainDocumentHash: `${DOCUMENT_HASH_ALGORITHM}:old-main`,
        sourceBlueprintDocumentHash: `${DOCUMENT_HASH_ALGORITHM}:old-blueprint`,
      },
    })
    const deletedUnknown = await createBlueprintFromDocument({
      id: 'bp-2',
      document,
      title: 'Deleted unknown blueprint',
      lifecycleStatus: 'deleted',
      validationState: 'unknown',
      source: 'agent_derived',
      now: '2026-04-27T02:00:00.000Z',
    })
    const activeValid = await createBlueprintFromDocument({
      id: 'bp-3',
      document,
      title: 'Active valid blueprint',
      validationState: 'valid',
      now: '2026-04-27T03:00:00.000Z',
    })

    expect(invalidArchived).toMatchObject({
      id: 'bp-1',
      title: 'Archived invalid blueprint',
      lifecycleStatus: 'archived',
      validationState: 'invalid',
      source: 'manual_snapshot',
      baseMainDocumentHash,
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
      appliedInfo: {
        appliedAt: '2026-04-27T01:00:00.000Z',
        appliedToMainDocumentHash: `${DOCUMENT_HASH_ALGORITHM}:old-main`,
        sourceBlueprintDocumentHash: `${DOCUMENT_HASH_ALGORITHM}:old-blueprint`,
      },
    })
    expect(invalidArchived.document).not.toBe(document)
    expect(invalidArchived.document).toEqual(document)
    expect(invalidArchived.documentHash).toBe(await hashDocument(invalidArchived.document))
    expect(deletedUnknown.lifecycleStatus).toBe('deleted')
    expect(deletedUnknown.validationState).toBe('unknown')
    expect(activeValid.lifecycleStatus).toBe('active')
    expect(activeValid.source).toBe('manual_snapshot')
  })

  it('captures an immutable document snapshot when creating a blueprint', async () => {
    const document = createDocument()
    const blueprint = await createBlueprintFromDocument({
      id: 'bp-snapshot',
      document,
      now: '2026-04-27T00:00:00.000Z',
    })
    const storedSnapshotHash = await hashDocument(blueprint.document)

    document.document.title = 'Mutated source title'
    document.devices[0].name = 'Mutated R1'

    expect(blueprint.document).not.toBe(document)
    expect(blueprint.document.document.title).toBe('Reference circuit')
    expect(blueprint.document.devices[0].name).toBe('R1')
    expect(blueprint.documentHash).toBe(storedSnapshotHash)
    expect(blueprint.documentHash).toBe(await hashDocument(blueprint.document))
    expect(blueprint.documentHash).not.toBe(await hashDocument(document))
  })

  it('normalizes legacy-ish workspaces by filling wrapper metadata while preserving blueprint documents', async () => {
    const document = createDocument()
    const documentHash = await hashDocument(document)
    const legacy = {
      blueprintWorkspaceVersion: '1.0.0',
      blueprints: [
        {
          id: 'bp-legacy',
          title: 'Legacy blueprint',
          lifecycleStatus: 'active',
          validationState: 'invalid',
          document,
          documentHash,
          source: 'manual_import',
          createdAt: '2026-04-26T00:00:00.000Z',
          updatedAt: '2026-04-26T00:00:00.000Z',
        },
      ],
    }

    const normalized = normalizeBlueprintWorkspace(legacy)

    expect(normalized.blueprintWorkspaceVersion).toBe('1.0.0')
    expect(normalized.workspaceId).toMatch(/^bpw-/)
    expect(normalized.createdAt).toBe('2026-04-26T00:00:00.000Z')
    expect(normalized.updatedAt).toBe('2026-04-26T00:00:00.000Z')
    expect(normalized.blueprints[0].document).toBe(document)
    expect(normalized.blueprints[0].validationState).toBe('invalid')
    expect(isBlueprintWorkspaceFile(normalized)).toBe(true)
  })

  it('rejects incompatible values and old records without document hashes', () => {
    expect(() => normalizeBlueprintWorkspace(null)).toThrow(/Blueprint workspace must be an object/)
    expect(() => normalizeBlueprintWorkspace({ schemaVersion: '4.0.0', document: {}, devices: [], view: {} })).toThrow(
      /Blueprint workspace version is required/,
    )
    expect(() =>
      normalizeBlueprintWorkspace({
        blueprintWorkspaceVersion: '1.0.0',
        blueprints: [
          {
            id: 'bp-no-hash',
            title: 'Missing hash',
            lifecycleStatus: 'active',
            validationState: 'valid',
            document: createDocument(),
            source: 'manual_import',
            createdAt: '2026-04-26T00:00:00.000Z',
            updatedAt: '2026-04-26T00:00:00.000Z',
          },
        ],
      }),
    ).toThrow(/documentHash is required/)
  })

  it('serializes and deserializes sidecars without treating invalid blueprints as non-applicable', async () => {
    const document = createDocument()
    const invalidBlueprint = await createBlueprintFromDocument({
      id: 'bp-invalid',
      document,
      title: 'Invalid is still serializable',
      lifecycleStatus: 'active',
      validationState: 'invalid',
      now: '2026-04-27T00:00:00.000Z',
    })
    const workspace = createEmptyBlueprintWorkspace({ workspaceId: 'workspace-1', now: '2026-04-27T00:00:00.000Z' })
    workspace.blueprints.push(invalidBlueprint)

    const deserialized = deserializeBlueprintWorkspace(serializeBlueprintWorkspace(workspace))

    expect(deserialized).toEqual(workspace)
    expect(getBlueprintRuntimeState(invalidBlueprint, invalidBlueprint.documentHash)).toEqual({
      isCurrentMainDocument: true,
      hasBaseHashMismatch: false,
    })
  })

  it('computes runtime currentness only by document hash, not appliedInfo', async () => {
    const document = createDocument()
    const record = await createBlueprintFromDocument({
      id: 'bp-applied',
      document,
      title: 'Applied before',
      baseMainDocumentHash: `${DOCUMENT_HASH_ALGORITHM}:base-main`,
      now: '2026-04-27T00:00:00.000Z',
      appliedInfo: {
        appliedAt: '2026-04-27T01:00:00.000Z',
        appliedToMainDocumentHash: `${DOCUMENT_HASH_ALGORITHM}:current-main`,
        sourceBlueprintDocumentHash: `${DOCUMENT_HASH_ALGORITHM}:not-current-blueprint`,
      },
    })

    expect(getBlueprintRuntimeState(record, `${DOCUMENT_HASH_ALGORITHM}:current-main`)).toEqual({
      isCurrentMainDocument: false,
      hasBaseHashMismatch: true,
    })
    expect(getBlueprintRuntimeState(record, record.documentHash)).toEqual({
      isCurrentMainDocument: true,
      hasBaseHashMismatch: true,
    })
  })

  it('derives deterministic sidecar paths beside the main document', () => {
    expect(getBlueprintSidecarPath('/path/foo.json')).toBe('/path/foo.easyanalyse-blueprints.json')
    expect(getBlueprintSidecarPath('/path/foo.easyanalyse.json')).toBe(
      '/path/foo.easyanalyse.easyanalyse-blueprints.json',
    )
    expect(getBlueprintSidecarPath('foo')).toBe('foo.easyanalyse-blueprints.json')
  })
})
