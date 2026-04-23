import { invoke } from '@tauri-apps/api/core'
import type {
  DocumentFile,
  MobileSharePayload,
  MobileRenderSnapshot,
  MobileShareSession,
  OpenDocumentResult,
  SaveDocumentResult,
  ValidationReport,
} from '../types/document'

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function newDocumentCommand(title?: string) {
  return invoke<DocumentFile>('new_document', { title })
}

export async function validateDocumentCommand(document: DocumentFile) {
  return invoke<ValidationReport>('validate_document', { document })
}

export async function openDocumentFromPath(path: string) {
  return invoke<OpenDocumentResult>('open_document_from_path', { path })
}

export async function saveDocumentToPath(path: string, document: DocumentFile) {
  return invoke<SaveDocumentResult>('save_document_to_path', { path, document })
}

export async function startMobileShare(document: DocumentFile, snapshot: MobileRenderSnapshot) {
  return invoke<MobileShareSession>('start_mobile_share', { document, snapshot })
}

export async function stopMobileShare() {
  return invoke<void>('stop_mobile_share')
}

export async function fetchSharedSession(token: string) {
  const response = await fetch(`/api/session/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  })

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const payload = (await response.json()) as { message?: string }
      if (payload.message?.trim()) {
        message = payload.message.trim()
      }
    } catch {
      // ignore malformed error payloads
    }
    throw new Error(message)
  }

  return (await response.json()) as MobileSharePayload
}
