import { invoke } from '@tauri-apps/api/core'
import type {
  DiffSummary,
  DocumentFile,
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

export async function summarizeDiffCommand(
  previous: DocumentFile,
  next: DocumentFile,
) {
  return invoke<DiffSummary>('summarize_diff', { previous, next })
}
