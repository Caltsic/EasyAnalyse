import type { DocumentFile } from '../types/document'
import type { BlueprintHashAlgorithm } from '../types/blueprint'

export const DOCUMENT_HASH_ALGORITHM = 'easyanalyse-document-canonical-sha256-v1' satisfies BlueprintHashAlgorithm

export function canonicalizeDocumentForHash(document: DocumentFile): unknown {
  const documentMeta: Record<string, unknown> = { ...document.document }
  delete documentMeta.updatedAt

  return {
    ...document,
    document: documentMeta,
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value))
}

export async function hashDocument(document: DocumentFile): Promise<string> {
  const canonicalJson = stableStringify(canonicalizeDocumentForHash(document))
  const digest = await sha256(canonicalJson)
  return `${DOCUMENT_HASH_ALGORITHM}:${digest}`
}

type StableJsonValue = string | number | boolean | null | StableJsonValue[] | { [key: string]: StableJsonValue }

function toStableJsonValue(value: unknown): StableJsonValue {
  if (value === null) {
    return null
  }

  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item))
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      return Number.isFinite(value) ? value : null
    case 'object': {
      const stableObject: { [key: string]: StableJsonValue } = {}
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        const item = (value as Record<string, unknown>)[key]
        if (item !== undefined) {
          stableObject[key] = toStableJsonValue(item)
        }
      }
      return stableObject
    }
    default:
      return null
  }
}

async function sha256(input: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const data = new TextEncoder().encode(input)
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data)
    return bytesToHex(new Uint8Array(hashBuffer))
  }

  return sha256WithNodeCrypto(input)
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface NodeHash {
  update(input: string, encoding: 'utf8'): NodeHash
  digest(encoding: 'hex'): string
}

interface NodeCryptoModule {
  createHash(algorithm: 'sha256'): NodeHash
}

async function sha256WithNodeCrypto(input: string) {
  const nodeCryptoSpecifier: string = 'node:crypto'
  const { createHash } = (await import(/* @vite-ignore */ nodeCryptoSpecifier)) as NodeCryptoModule
  return createHash('sha256').update(input, 'utf8').digest('hex')
}
