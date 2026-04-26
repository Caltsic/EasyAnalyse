import { describe, expect, it, vi } from 'vitest'
import type { DocumentFile } from '../types/document'
import { DOCUMENT_HASH_ALGORITHM, canonicalizeDocumentForHash, hashDocument, stableStringify } from './documentHash'

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
          {
            id: 'r1-a',
            name: 'A',
            label: 'VIN',
            direction: 'input',
          },
          {
            id: 'r1-b',
            name: 'B',
            label: 'VOUT',
            direction: 'output',
          },
        ],
      },
    ],
    view: {
      canvas: {
        units: 'px',
        grid: {
          enabled: true,
          size: 16,
        },
      },
      devices: {
        r1: {
          position: { x: 10, y: 20 },
          shape: 'rectangle',
        },
      },
      networkLines: {
        vin: {
          label: 'VIN',
          position: { x: 0, y: 20 },
          orientation: 'horizontal',
        },
      },
    },
    ...overrides,
  }
}

describe('documentHash', () => {
  it('stableStringify sorts object keys without changing array order', () => {
    expect(stableStringify({ b: 1, a: [{ d: 4, c: 3 }, { b: 2, a: 1 }] })).toBe(
      '{"a":[{"c":3,"d":4},{"a":1,"b":2}],"b":1}',
    )
  })

  it('canonicalizeDocumentForHash ignores only document.updatedAt from document metadata', () => {
    const canonical = canonicalizeDocumentForHash(
      createDocument({ extensions: { updatedAt: 'kept-outside-document-meta' } }),
    ) as DocumentFile

    expect(canonical).toMatchObject({
      schemaVersion: '4.0.0',
      document: {
        id: 'doc-1',
        title: 'Reference circuit',
        createdAt: '2026-04-26T00:00:00.000Z',
        tags: ['demo'],
      },
      extensions: { updatedAt: 'kept-outside-document-meta' },
    })
    expect(canonical.document.updatedAt).toBeUndefined()
  })

  it('keeps the same hash when only document.updatedAt changes', async () => {
    const first = createDocument()
    const second = createDocument({
      document: {
        ...createDocument().document,
        updatedAt: '2026-04-27T01:00:00.000Z',
      },
    })

    await expect(hashDocument(second)).resolves.toBe(await hashDocument(first))
  })

  it('changes the hash when semantic document content changes', async () => {
    const first = createDocument()
    const terminalLabelChanged = createDocument({
      devices: [
        {
          ...createDocument().devices[0],
          terminals: [
            createDocument().devices[0].terminals[0],
            {
              ...createDocument().devices[0].terminals[1],
              label: 'VREF',
            },
          ],
        },
      ],
    })
    const viewChanged = createDocument({
      view: {
        ...createDocument().view,
        devices: {
          r1: {
            position: { x: 11, y: 20 },
            shape: 'rectangle',
          },
        },
      },
    })
    const deviceChanged = createDocument({
      devices: [
        {
          ...createDocument().devices[0],
          name: 'R1 changed',
        },
      ],
    })

    await expect(hashDocument(terminalLabelChanged)).resolves.not.toBe(await hashDocument(first))
    await expect(hashDocument(deviceChanged)).resolves.not.toBe(await hashDocument(first))
    await expect(hashDocument(viewChanged)).resolves.not.toBe(await hashDocument(first))
  })

  it('uses the Node crypto fallback when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined)
    try {
      await expect(hashDocument(createDocument())).resolves.toMatch(
        new RegExp(`^${DOCUMENT_HASH_ALGORITHM}:[a-f0-9]{64}$`),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('prefixes hashes with the canonical document hash algorithm', async () => {
    await expect(hashDocument(createDocument())).resolves.toMatch(new RegExp(`^${DOCUMENT_HASH_ALGORITHM}:[a-f0-9]{64}$`))
  })
})
